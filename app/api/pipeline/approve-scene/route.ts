import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { PipelineJob } from "@/lib/schemas";

const JOBS_DIR = path.join(process.cwd(), "jobs");

const bodySchema = z.object({
  jobId: z.string().uuid(),
  sceneId: z.number().int().positive(),
  /** When true, also checks if all scenes are now approved and sets all_scenes_approved */
  checkAllDone: z.boolean().default(true),
});

/**
 * POST /api/pipeline/approve-scene
 * Marks a single scene's image as approved.
 * If all scenes are now approved, sets all_scenes_approved=true (orchestrator proceeds).
 */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "jobId and sceneId required" }, { status: 400 });

  const { jobId, sceneId, checkAllDone } = parsed.data;
  const filePath = path.join(JOBS_DIR, `${jobId}.json`);

  try {
    const data = await fs.readFile(filePath, "utf8");
    const job: PipelineJob = JSON.parse(data);

    const scene = job.scenes.find((s) => s.scene_id === sceneId);
    if (!scene) return NextResponse.json({ error: `Scene ${sceneId} not found` }, { status: 404 });

    scene.approved = true;

    // Auto-set all_scenes_approved if every scene with an image is approved
    if (checkAllDone) {
      const scenesWithImages = job.scenes.filter((s) => s.status === "image_done" || s.approved);
      const allApproved = scenesWithImages.length > 0 &&
        scenesWithImages.every((s) => s.approved === true);

      if (allApproved) {
        job.all_scenes_approved = true;
      }
    }

    await fs.writeFile(filePath, JSON.stringify(job, null, 2), "utf8");
    return NextResponse.json({ ok: true, allApproved: job.all_scenes_approved ?? false });
  } catch {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
}
