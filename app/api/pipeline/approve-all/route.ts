import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { PipelineJob } from "@/lib/schemas";

const JOBS_DIR = path.join(process.cwd(), "jobs");

const bodySchema = z.object({
  jobId: z.string().uuid(),
});

/**
 * POST /api/pipeline/approve-all
 * Atomically marks every scene that has a generated image as approved,
 * then sets all_scenes_approved=true in a single file write.
 * This avoids the race condition caused by N concurrent approve-scene calls
 * each doing their own read-modify-write on the same JSON file.
 */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "jobId required" }, { status: 400 });
  }

  const { jobId } = parsed.data;
  const filePath = path.join(JOBS_DIR, `${jobId}.json`);

  try {
    const data = await fs.readFile(filePath, "utf8");
    const job: PipelineJob = JSON.parse(data);

    let approvedCount = 0;
    for (const scene of job.scenes) {
      if (scene.status === "image_done") {
        scene.approved = true;
        approvedCount++;
      }
    }

    if (approvedCount === 0) {
      return NextResponse.json({ error: "No scenes with images to approve" }, { status: 400 });
    }

    job.all_scenes_approved = true;

    await fs.writeFile(filePath, JSON.stringify(job, null, 2), "utf8");
    return NextResponse.json({ ok: true, approvedCount });
  } catch {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
}
