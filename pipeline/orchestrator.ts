import { promises as fs } from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import pLimit from "p-limit";

import {
  PipelineJob, SceneJob, JobStatus, JobStage, VideoScript,
} from "@/lib/schemas";
import { generateScript } from "./script-generator";
import { generateImage } from "./image-generator";
import { generateTTS } from "./tts-generator";
import { generateMusic } from "./music-generator";
import { renderSceneClip, renderFinalVideo } from "./renderer";

// ─── Constants ───────────────────────────────────────────────────────────────

const JOBS_DIR = path.join(process.cwd(), "jobs");
const OUTPUT_BASE = path.join(process.cwd(), "output");
const CONCURRENCY = 4;
const POLL_INTERVAL_MS = 2000;
const APPROVAL_TIMEOUT_MS = 60 * 60 * 1000; // 60 min max wait

// ─── Job File Helpers ────────────────────────────────────────────────────────

async function ensureDirs(...dirs: string[]): Promise<void> {
  for (const dir of dirs) await fs.mkdir(dir, { recursive: true });
}

export async function saveJob(job: PipelineJob): Promise<void> {
  await ensureDirs(JOBS_DIR);
  await fs.writeFile(
    path.join(JOBS_DIR, `${job.job_id}.json`),
    JSON.stringify(job, null, 2),
    "utf8",
  );
}

export async function loadJob(jobId: string): Promise<PipelineJob | null> {
  try {
    const data = await fs.readFile(path.join(JOBS_DIR, `${jobId}.json`), "utf8");
    return JSON.parse(data) as PipelineJob;
  } catch {
    return null;
  }
}

function createJob(topic: string, targetDurationSeconds: number, jobId?: string): PipelineJob {
  return {
    job_id: jobId ?? uuidv4(),
    topic,
    target_duration_seconds: targetDurationSeconds,
    created_at: new Date().toISOString(),
    status: "pending",
    stage: "setup",
    progress_percent: 0,
    scenes: [],
  };
}

function setStatus(job: PipelineJob, status: JobStatus, stage: JobStage, progress: number) {
  job.status = status;
  job.stage = stage;
  job.progress_percent = progress;
}

// ─── Approval Gate ───────────────────────────────────────────────────────────

/**
 * Poll the job file on disk until the given boolean field is true.
 * The orchestrator writes to the in-memory job object, but approval signals
 * are written by API routes directly to disk — so we re-read from disk.
 */
async function waitForSignal(
  jobId: string,
  field: "script_approved" | "all_scenes_approved",
  autoApprove = false,
): Promise<void> {
  if (autoApprove) return;

  const start = Date.now();
  while (Date.now() - start < APPROVAL_TIMEOUT_MS) {
    const fresh = await loadJob(jobId);
    if (fresh?.[field]) return;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Approval timeout: "${field}" was never set within 60 minutes`);
}

/**
 * After approval, re-read the job from disk to pick up any edits the user
 * made to scene narrations via the API (e.g. updated narration_text).
 */
async function syncFromDisk(job: PipelineJob): Promise<void> {
  const fresh = await loadJob(job.job_id);
  if (fresh?.script) job.script = fresh.script;
  if (fresh?.scenes) job.scenes = fresh.scenes;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Main Pipeline Run ────────────────────────────────────────────────────────

export async function run(
  topic: string,
  targetDurationSeconds: number,
  options: { jobId?: string; autoApprove?: boolean } = {},
): Promise<string> {
  const { autoApprove = false } = options;
  const job = createJob(topic, targetDurationSeconds, options.jobId);
  const outputDir = path.join(OUTPUT_BASE, job.job_id);

  await ensureDirs(JOBS_DIR, outputDir);
  await saveJob(job);

  console.log(`[Pipeline] Job ${job.job_id} — topic: "${topic}" — ${Math.round(targetDurationSeconds / 60)}min`);

  try {
    // ── Phase 1: Script Generation ───────────────────────────────────────────
    setStatus(job, "scripting", "setup", 5);
    await saveJob(job);

    console.log("[Phase 1] Generating script via Gemini...");
    const script: VideoScript = await generateScript(topic, targetDurationSeconds);

    job.script = script;
    job.scenes = script.scenes.map((s) => ({
      scene_id: s.scene_id,
      status: "pending" as const,
    }));

    setStatus(job, "awaiting_script_approval", "script_review", 12);
    await saveJob(job);

    console.log(`[Phase 1] Script ready — ${script.scenes.length} scenes, ~${Math.round(script.total_duration_seconds / 60)}min`);
    if (autoApprove) {
      console.log("[Phase 1] Auto-approving script...");
    } else {
      console.log("[Phase 1] Waiting for script approval via UI or API...");
    }

    await waitForSignal(job.job_id, "script_approved", autoApprove);

    // Re-sync in case user edited narrations while reviewing
    await syncFromDisk(job);

    // ── Phase 2: Image + TTS Generation (parallel) ───────────────────────────
    setStatus(job, "generating_images", "image_review", 20);
    await saveJob(job);

    console.log("[Phase 2] Generating images + TTS in parallel...");

    const musicPromise = generateMusic(job.script!.total_duration_seconds, outputDir)
      .then((p) => { console.log("[Phase 2] Music done."); return p; })
      .catch((err: Error) => { console.error("[Phase 2] Music failed:", err.message); return null; });

    const limit = pLimit(CONCURRENCY);

    await Promise.allSettled(
      job.script!.scenes.map((scene) =>
        limit(async () => {
          const sceneJob = job.scenes.find((s) => s.scene_id === scene.scene_id)!;
          try {
            console.log(`[Scene ${scene.scene_id}] Image + TTS...`);
            const [imagePath, audioPath] = await Promise.all([
              generateImage(scene, outputDir),
              generateTTS(scene.narration_text, scene.scene_id, outputDir),
            ]);
            Object.assign(sceneJob, { image_path: imagePath, audio_path: audioPath, status: "image_done" });
            await saveJob(job);
            console.log(`[Scene ${scene.scene_id}] Image done.`);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            Object.assign(sceneJob, { status: "failed", error: message });
            await saveJob(job);
            console.error(`[Scene ${scene.scene_id}] Image failed: ${message}`);
          }
        })
      )
    );

    // ── Phase 3: Wait for image approval ─────────────────────────────────────
    setStatus(job, "awaiting_image_approval", "image_review", 50);
    await saveJob(job);

    console.log("[Phase 3] All images generated. Waiting for approval via UI...");
    if (autoApprove) {
      console.log("[Phase 3] Auto-approving all images...");
    }

    await waitForSignal(job.job_id, "all_scenes_approved", autoApprove);

    // Re-sync scenes — user may have triggered redo operations that updated image paths
    await syncFromDisk(job);

    // ── Phase 4: Saliency analysis + clip rendering ───────────────────────────
    setStatus(job, "rendering_clips", "rendering", 60);
    await saveJob(job);

    console.log("[Phase 4] Rendering clips...");

    const approvedScenes = job.script!.scenes.filter((scene) => {
      const sceneJob = job.scenes.find((s) => s.scene_id === scene.scene_id);
      return sceneJob?.status === "image_done" && sceneJob.image_path && sceneJob.audio_path;
    });

    await Promise.allSettled(
      approvedScenes.map((scene) =>
        limit(async () => {
          const sceneJob = job.scenes.find((s) => s.scene_id === scene.scene_id)!;
          try {
            console.log(`[Scene ${scene.scene_id}] Rendering clip...`);
            const clipPath = await renderSceneClip(scene, sceneJob.image_path!, sceneJob.audio_path!, outputDir);
            Object.assign(sceneJob, { clip_path: clipPath, status: "clip_done" });

            // Update progress
            const done = job.scenes.filter((s) => s.status === "clip_done").length;
            job.progress_percent = 60 + Math.floor((done / approvedScenes.length) * 30);

            await saveJob(job);
            console.log(`[Scene ${scene.scene_id}] Clip done.`);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            Object.assign(sceneJob, { status: "failed", error: message });
            await saveJob(job);
            console.error(`[Scene ${scene.scene_id}] Render failed: ${message}`);
          }
        })
      )
    );

    const doneCount = job.scenes.filter((s) => s.status === "clip_done").length;
    if (doneCount === 0) throw new Error("All scene clips failed — cannot assemble final video");

    // ── Phase 5: Final assembly ───────────────────────────────────────────────
    setStatus(job, "rendering", "rendering", 92);
    await saveJob(job);

    const musicPath = await musicPromise;
    const effectiveMusicPath = musicPath ?? await generateSilentAudio(job.script!.total_duration_seconds, outputDir);

    console.log(`[Phase 5] Assembling final video (${doneCount} clips)...`);
    const outputPath = await renderFinalVideo(job, effectiveMusicPath, outputDir);

    job.output_path = outputPath;
    setStatus(job, "complete", "complete", 100);
    await saveJob(job);

    console.log(`[Pipeline] COMPLETE → ${outputPath}`);
    return job.job_id;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    job.status = "failed";
    job.error = message;
    await saveJob(job);
    console.error(`[Pipeline] FAILED: ${message}`);
    throw err;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function generateSilentAudio(durationSeconds: number, outputDir: string): Promise<string> {
  const { spawn } = await import("child_process");
  const { resolveFfmpegBinary } = await import("@/lib/ffmpeg-binary");
  const silentPath = path.join(outputDir, "silence.mp3");

  return new Promise((resolve, reject) => {
    const ffmpeg = resolveFfmpegBinary();
    const args = [
      "-f", "lavfi", "-i", `anullsrc=r=44100:cl=stereo:d=${durationSeconds}`,
      "-c:a", "libmp3lame", "-b:a", "64k",
      "-y", silentPath,
    ];
    const proc = spawn(ffmpeg, args, { stdio: "ignore" });
    proc.on("close", (code) => {
      if (code === 0) resolve(silentPath);
      else reject(new Error(`Silent audio gen failed (exit ${code})`));
    });
    proc.on("error", reject);
  });
}
