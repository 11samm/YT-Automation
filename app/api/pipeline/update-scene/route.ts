import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { PipelineJob } from "@/lib/schemas";

const JOBS_DIR = path.join(process.cwd(), "jobs");

const bodySchema = z.object({
  jobId: z.string().uuid(),
  sceneId: z.number().int().positive(),
  narration_text: z.string().min(10).optional(),
  camera_instruction: z.string().optional(),
});

/**
 * PATCH /api/pipeline/update-scene
 * Allows editing a scene's narration_text (and optionally camera_instruction)
 * during the script approval stage. Updates job.script.scenes[i].
 */
export async function PATCH(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const { jobId, sceneId, narration_text, camera_instruction } = parsed.data;
  const filePath = path.join(JOBS_DIR, `${jobId}.json`);

  try {
    const data = await fs.readFile(filePath, "utf8");
    const job: PipelineJob = JSON.parse(data);

    if (!job.script) return NextResponse.json({ error: "No script in job" }, { status: 409 });

    const scene = job.script.scenes.find((s) => s.scene_id === sceneId);
    if (!scene) return NextResponse.json({ error: `Scene ${sceneId} not found` }, { status: 404 });

    if (narration_text !== undefined) scene.narration_text = narration_text;
    if (camera_instruction !== undefined) {
      (scene as Record<string, unknown>).camera_instruction = camera_instruction;
    }

    await fs.writeFile(filePath, JSON.stringify(job, null, 2), "utf8");
    return NextResponse.json({ ok: true, scene });
  } catch {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
}
