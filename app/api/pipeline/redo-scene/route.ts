import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { PipelineJob } from "@/lib/schemas";
import { generateImage } from "@/pipeline/image-generator";
import { generateTTS } from "@/pipeline/tts-generator";

const JOBS_DIR = path.join(process.cwd(), "jobs");
const OUTPUT_BASE = path.join(process.cwd(), "output");

const bodySchema = z.object({
  jobId: z.string().uuid(),
  sceneId: z.number().int().positive(),
  /** Optional: tweak the visual prompt before regenerating */
  promptOverride: z.string().optional(),
});

/**
 * POST /api/pipeline/redo-scene
 * Regenerates the image (and optionally TTS) for a single scene.
 * Safe to call while orchestrator is waiting for all_scenes_approved.
 */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "jobId and sceneId required" }, { status: 400 });

  const { jobId, sceneId, promptOverride } = parsed.data;
  const filePath = path.join(JOBS_DIR, `${jobId}.json`);

  try {
    const data = await fs.readFile(filePath, "utf8");
    const job: PipelineJob = JSON.parse(data);

    const sceneJob = job.scenes.find((s) => s.scene_id === sceneId);
    if (!sceneJob) return NextResponse.json({ error: `Scene ${sceneId} not found` }, { status: 404 });

    const sceneInstruction = job.script?.scenes.find((s) => s.scene_id === sceneId);
    if (!sceneInstruction) return NextResponse.json({ error: "Scene instruction not found in script" }, { status: 409 });

    const outputDir = path.join(OUTPUT_BASE, jobId);

    // Reset approval status
    sceneJob.approved = false;
    sceneJob.status = "pending";
    sceneJob.image_path = undefined;
    sceneJob.saliency = undefined;
    sceneJob.clip_path = undefined;
    sceneJob.error = undefined;
    await fs.writeFile(filePath, JSON.stringify(job, null, 2), "utf8");

    // Regenerate image (fast: ~3–6s with Fal.ai)
    let imageResult: Awaited<ReturnType<typeof generateImage>>;
    try {
      imageResult = await generateImage(sceneInstruction, outputDir, promptOverride || undefined);
    } catch (err) {
      sceneJob.status = "failed";
      sceneJob.error = err instanceof Error ? err.message : String(err);
      await fs.writeFile(filePath, JSON.stringify(job, null, 2), "utf8");
      return NextResponse.json({ error: sceneJob.error }, { status: 502 });
    }

    // Also regenerate TTS if audio doesn't exist (in case narration was edited)
    let audioPath = sceneJob.audio_path;
    if (!audioPath) {
      try {
        audioPath = await generateTTS(sceneInstruction.narration_text, sceneId, outputDir);
      } catch {
        // TTS failure is non-critical for the image redo
      }
    }

    sceneJob.image_path = imageResult.filePath;
    sceneJob.image_prompt = imageResult.prompt;
    sceneJob.audio_path = audioPath;
    sceneJob.status = "image_done";
    await fs.writeFile(filePath, JSON.stringify(job, null, 2), "utf8");

    return NextResponse.json({ ok: true, sceneId });
  } catch {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
}
