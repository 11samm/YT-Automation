import { spawn } from "child_process";
import path from "path";
import { resolveFfmpegBinary } from "@/lib/ffmpeg-binary";
import { SceneInstruction, PipelineJob } from "@/lib/schemas";

const FPS = 30;
const OUTPUT_W = 1920;
const OUTPUT_H = 1080;

// ─── FFmpeg Helpers ─────────────────────────────────────────────────────────

function spawnFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = resolveFfmpegBinary();
    const proc = spawn(ffmpeg, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr?.on("data", (c: Buffer) => { stderr += c.toString(); });
    proc.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        reject(new Error(`ffmpeg not found at "${ffmpeg}". Set FFMPEG_PATH or install system ffmpeg with NVENC support.`));
      } else {
        reject(err);
      }
    });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-800)}`));
    });
  });
}

// ─── Per-Scene Clip Render ──────────────────────────────────────────────────

/**
 * Render a single static scene clip.
 * Input: static image + narration audio.
 * Output: h264_nvenc encoded MP4 clip (no pan/zoom — transitions handled at assembly).
 */
export async function renderSceneClip(
  scene: SceneInstruction,
  imagePath: string,
  audioPath: string,
  outputDir: string,
): Promise<string> {
  const outputPath = path.join(outputDir, `scene_${scene.scene_id}_clip.mp4`);

  const args = [
    "-loop", "1", "-i", imagePath,
    "-i", audioPath,
    "-filter_complex",
    `[0:v]scale=${OUTPUT_W}:${OUTPUT_H}:flags=lanczos,fps=${FPS},format=yuv420p[v]`,
    "-map", "[v]",
    "-map", "1:a",
    "-c:v", "h264_nvenc",
    "-preset", "p4",
    "-rc", "vbr",
    "-cq", "23",
    "-b:v", "0",
    "-c:a", "aac", "-b:a", "192k",
    "-shortest",
    "-y", outputPath,
  ];

  try {
    await spawnFfmpeg(args);
  } catch (nvencErr) {
    // Fall back to libx264 if NVENC is not available
    console.warn(`NVENC unavailable for scene ${scene.scene_id}, falling back to libx264: ${(nvencErr as Error).message}`);
    const softwareArgs = args.map((a, i) => {
      if (a === "h264_nvenc") return "libx264";
      if (a === "p4" && args[i - 1] === "-preset") return "medium";
      if (a === "vbr" && args[i - 1] === "-rc") return null;
      if (a === "-rc") return null;
      return a;
    }).filter((a): a is string => a !== null);

    await spawnFfmpeg(softwareArgs);
  }

  return outputPath;
}

// ─── Final Assembly ─────────────────────────────────────────────────────────

const XFADE_DURATION = 0.5; // seconds for the crossfade between scenes

/**
 * Assemble all scene clips with 0.5 s crossfade transitions, then mix in
 * background music with ducking.  Each clip is a separate -i input so FFmpeg's
 * xfade filter can chain them; the narration audio streams are concat-ed and
 * amix-ed with the music in the same filter_complex pass.
 */
export async function renderFinalVideo(
  job: PipelineJob,
  musicPath: string,
  outputDir: string,
): Promise<string> {
  const completedScenes = job.scenes
    .filter((s) => s.clip_path && s.status === "clip_done")
    .sort((a, b) => a.scene_id - b.scene_id);

  if (completedScenes.length === 0) {
    throw new Error("No completed scene clips to assemble");
  }

  const durationMap = new Map(
    (job.script?.scenes ?? []).map((s) => [s.scene_id, s.duration_seconds]),
  );
  const clipPaths = completedScenes.map((s) => s.clip_path!);
  const durations = completedScenes.map((s) => durationMap.get(s.scene_id) ?? 5);
  const N = clipPaths.length;
  const musicIdx = N; // music is the last -i input

  const outputPath = path.join(outputDir, "final.mp4");

  // ── Inputs: one per clip, then music ──────────────────────────────────────
  const inputArgs: string[] = [
    ...clipPaths.flatMap((p) => ["-i", p]),
    "-i", musicPath,
  ];

  // ── Video xfade chain ─────────────────────────────────────────────────────
  // offset_i = cumulative duration up to clip i — (i+1) * XFADE_DURATION
  // This is where in the combined stream the next transition should start.
  const videoFilters: string[] = [];
  if (N > 1) {
    let cumDur = 0;
    for (let i = 0; i < N - 1; i++) {
      cumDur += durations[i];
      const offset = Math.max(0, cumDur - (i + 1) * XFADE_DURATION);
      const inA = i === 0 ? "[0:v]" : `[xv${i}]`;
      const inB = `[${i + 1}:v]`;
      const out = i === N - 2 ? "[vout]" : `[xv${i + 1}]`;
      videoFilters.push(`${inA}${inB}xfade=transition=fade:duration=${XFADE_DURATION}:offset=${offset}${out}`);
    }
  }
  const videoOut = N === 1 ? "[0:v]" : "[vout]";

  // ── Audio: concat narration streams, then duck with music ─────────────────
  const audioFilters: string[] = [];
  let narrationLabel: string;
  if (N === 1) {
    narrationLabel = "[0:a]";
  } else {
    const audioInputLabels = Array.from({ length: N }, (_, i) => `[${i}:a]`).join("");
    audioFilters.push(`${audioInputLabels}concat=n=${N}:v=0:a=1[narration]`);
    narrationLabel = "[narration]";
  }
  audioFilters.push(`[${musicIdx}:a]volume=0.12[music_ducked]`);
  audioFilters.push(`${narrationLabel}[music_ducked]amix=inputs=2:duration=first:dropout_transition=3[audio_out]`);

  const filterComplex = [...videoFilters, ...audioFilters].join(";");

  const args = [
    ...inputArgs,
    "-filter_complex", filterComplex,
    "-map", videoOut,
    "-map", "[audio_out]",
    "-c:v", "h264_nvenc",
    "-preset", "p4",
    "-rc", "vbr",
    "-cq", "21",
    "-b:v", "0",
    "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart",
    "-y", outputPath,
  ];

  try {
    await spawnFfmpeg(args);
  } catch (nvencErr) {
    console.warn(`NVENC unavailable for final render, falling back to libx264: ${(nvencErr as Error).message}`);
    const softwareArgs = args.map((a, i) => {
      if (a === "h264_nvenc") return "libx264";
      if (a === "p4" && args[i - 1] === "-preset") return "medium";
      if (a === "vbr" && args[i - 1] === "-rc") return null;
      if (a === "-rc") return null;
      return a;
    }).filter((a): a is string => a !== null);

    await spawnFfmpeg(softwareArgs);
  }

  return outputPath;
}
