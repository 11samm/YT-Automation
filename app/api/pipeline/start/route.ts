import { spawn } from "child_process";
import path from "path";
import { promises as fs } from "fs";
import { v4 as uuidv4 } from "uuid";
import { NextResponse } from "next/server";
import { z } from "zod";
import { PipelineJob } from "@/lib/schemas";

const bodySchema = z.object({
  topic: z.string().min(5).max(300),
  targetDurationSeconds: z.number().int().min(60).max(960).default(600),
});

const JOBS_DIR = path.join(process.cwd(), "jobs");

async function createPendingJob(topic: string, targetDurationSeconds: number): Promise<PipelineJob> {
  await fs.mkdir(JOBS_DIR, { recursive: true });
  const job: PipelineJob = {
    job_id: uuidv4(),
    topic,
    target_duration_seconds: targetDurationSeconds,
    created_at: new Date().toISOString(),
    status: "pending",
    stage: "setup",
    progress_percent: 0,
    scenes: [],
  };
  await fs.writeFile(
    path.join(JOBS_DIR, `${job.job_id}.json`),
    JSON.stringify(job, null, 2),
    "utf8",
  );
  return job;
}

/**
 * POST /api/pipeline/start
 * Body: { topic: string, targetDurationSeconds: number }
 * Spawns the pipeline orchestrator as a detached background process.
 * Returns: { jobId, status }
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "topic (5–300 chars) and targetDurationSeconds (60–960) required" },
      { status: 400 }
    );
  }

  const { topic, targetDurationSeconds } = parsed.data;

  // Pre-create the job file so /status can return immediately
  const job = await createPendingJob(topic, targetDurationSeconds);

  const workerScript = path.join(process.cwd(), "pipeline", "run.ts");
  const isWin = process.platform === "win32";
  const tsnodeBin = path.join(
    process.cwd(),
    "node_modules",
    ".bin",
    isWin ? "ts-node.cmd" : "ts-node",
  );

  const child = spawn(
    tsnodeBin,
    [
      "--project", path.join(process.cwd(), "tsconfig.node.json"),
      "-r", "tsconfig-paths/register",
      workerScript,
      // --topic is intentionally omitted: multi-word topics break when shell: true
      // joins the arg array into a flat string on Windows. The topic and duration
      // are already persisted in the job file; run.ts reads them from there.
      "--job-id", job.job_id,
      "--ui-mode",
    ],
    {
      detached: true,
      stdio: "ignore",
      shell: isWin,
      env: { ...process.env },
    }
  );

  child.unref();

  return NextResponse.json({ jobId: job.job_id, status: "pending" });
}
