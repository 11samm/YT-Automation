import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { resolveFfmpegBinary } from "@/lib/ffmpeg-binary";

/**
 * Generate a background music track for the full video.
 *
 * Provider selection via MUSIC_PROVIDER env var:
 *   "api"    — POST to MUSIC_API_URL with { duration, style } → binary audio response
 *   "ffmpeg" — Generate an ambient sine-wave track locally (no API key required)
 *
 * Defaults to "ffmpeg" fallback if MUSIC_PROVIDER is not set.
 */
const MUSIC_PROVIDER = (process.env.MUSIC_PROVIDER ?? "ffmpeg").toLowerCase();
const MUSIC_API_URL = process.env.MUSIC_API_URL ?? "";
const MUSIC_API_KEY = process.env.MUSIC_API_KEY ?? "";

async function generateViaApi(durationSeconds: number, outputPath: string): Promise<void> {
  if (!MUSIC_API_URL) {
    throw new Error("MUSIC_API_URL is required when MUSIC_PROVIDER=api");
  }

  const res = await fetch(MUSIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(MUSIC_API_KEY ? { Authorization: `Bearer ${MUSIC_API_KEY}` } : {}),
    },
    body: JSON.stringify({
      duration: durationSeconds,
      style: "cinematic ambient documentary tension",
      format: "mp3",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Music API failed (${res.status}): ${text}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(outputPath, buffer);
}

function generateViaFfmpeg(durationSeconds: number, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = resolveFfmpegBinary();

    // Generate a layered ambient tone: low drone + subtle tremolo
    // Uses two sine waves (55Hz + 110Hz) with slight phase offset for depth
    const filterComplex = [
      // Bass drone
      `sine=frequency=55:duration=${durationSeconds}[bass]`,
      // Harmonic overtone at half volume
      `sine=frequency=110:duration=${durationSeconds}[mid]`,
      // Mix them
      "[bass][mid]amix=inputs=2:normalize=0[mix]",
      // Apply reverb-like effect with aecho and gentle low-pass
      "[mix]aecho=0.8:0.88:60|90:0.4|0.3[echo]",
      `[echo]volume=0.3,lowpass=f=400[out]`,
    ].join(";");

    const args = [
      "-f", "lavfi",
      "-i", `aevalsrc=0:d=${durationSeconds}`, // dummy input
      "-filter_complex", filterComplex,
      "-map", "[out]",
      "-c:a", "libmp3lame",
      "-b:a", "128k",
      "-y", outputPath,
    ];

    const proc = spawn(ffmpeg, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr?.on("data", (c: Buffer) => { stderr += c.toString(); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg music gen failed (exit ${code}): ${stderr.slice(-500)}`));
    });
  });
}

/**
 * Generate background music. Returns the path to the generated audio file.
 * The file is written to `outputDir/background_music.mp3`.
 */
export async function generateMusic(
  durationSeconds: number,
  outputDir: string,
): Promise<string> {
  const outputPath = path.join(outputDir, "background_music.mp3");

  if (MUSIC_PROVIDER === "api" && MUSIC_API_URL) {
    await generateViaApi(durationSeconds, outputPath);
  } else {
    await generateViaFfmpeg(durationSeconds, outputPath);
  }

  return outputPath;
}
