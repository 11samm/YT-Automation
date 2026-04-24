import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { PipelineJob } from "@/lib/schemas";

const JOBS_DIR = path.join(process.cwd(), "jobs");

const bodySchema = z.object({ jobId: z.string().uuid() });

/**
 * POST /api/pipeline/approve-script
 * Sets script_approved=true in the job file.
 * The orchestrator is polling for this signal and will proceed to image generation.
 */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "jobId required" }, { status: 400 });

  const { jobId } = parsed.data;
  const filePath = path.join(JOBS_DIR, `${jobId}.json`);

  try {
    const data = await fs.readFile(filePath, "utf8");
    const job: PipelineJob = JSON.parse(data);

    if (job.status !== "awaiting_script_approval") {
      return NextResponse.json(
        { error: `Job is in status "${job.status}", not awaiting script approval` },
        { status: 409 },
      );
    }

    job.script_approved = true;
    await fs.writeFile(filePath, JSON.stringify(job, null, 2), "utf8");
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
}
