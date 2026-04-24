import { spawn } from "child_process";
import { openSync } from "fs";
import path from "path";
import { promises as fs } from "fs";
import { v4 as uuidv4 } from "uuid";
import { NextResponse } from "next/server";
import { z } from "zod";
import { PipelineJob } from "@/lib/schemas";

const bodySchema = z.object({
  topic: z.string().min(5).max(300),
  targetDurationSeconds: z.number().int().min(60).max(960).default(600),
  ttsProvider: z.enum(["elevenlabs", "kokoro", "openai"]).default("elevenlabs"),
  kokoroVoice: z.enum(["af_bella", "am_echo"]).default("af_bella"),
});

const JOBS_DIR = path.join(process.cwd(), "jobs");

async function createPendingJob(
  topic: string,
  targetDurationSeconds: number,
  ttsProvider: string,
  kokoroVoice: string,
): Promise<PipelineJob> {
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
    tts_provider: ttsProvider,
    kokoro_voice: ttsProvider === "kokoro" ? kokoroVoice : undefined,
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

  const { topic, targetDurationSeconds, ttsProvider, kokoroVoice } = parsed.data;

  // Pre-create the job file so /status can return immediately
  const job = await createPendingJob(topic, targetDurationSeconds, ttsProvider, kokoroVoice);

  const outputDir = path.join(process.cwd(), "output", job.job_id);
  await fs.mkdir(outputDir, { recursive: true });
  const logPath = path.join(outputDir, "pipeline.log");
  const logFd = openSync(logPath, "a");

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
      "--transpile-only",
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
      stdio: ["ignore", logFd, logFd],
      shell: isWin,
      env: {
        ...process.env,
        TTS_PROVIDER: ttsProvider,
        // Pass TTS vars explicitly — Next.js may not expose all .env vars in process.env
        ...(process.env.TTS_API_KEY        ? { TTS_API_KEY:         process.env.TTS_API_KEY }        : {}),
        ...(process.env.ELEVENLABS_VOICE_ID ? { ELEVENLABS_VOICE_ID: process.env.ELEVENLABS_VOICE_ID } : {}),
        ...(process.env.OPENAI_TTS_VOICE    ? { OPENAI_TTS_VOICE:    process.env.OPENAI_TTS_VOICE }    : {}),
        ...(ttsProvider === "kokoro"         ? { KOKORO_VOICE: kokoroVoice }                           : {}),
        ...(process.env.HF_TOKEN            ? { HF_TOKEN:            process.env.HF_TOKEN }            : {}),
      },
    }
  );

  child.unref();

  return NextResponse.json({ jobId: job.job_id, status: "pending" });
}
