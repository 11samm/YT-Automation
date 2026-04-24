import { promises as fs } from "fs";
import path from "path";

/**
 * TTS provider selection via TTS_PROVIDER env var.
 * Supported: "elevenlabs" (default) | "openai" | "kokoro"
 */
const TTS_PROVIDER = (process.env.TTS_PROVIDER ?? "elevenlabs").toLowerCase();
const TTS_API_KEY = process.env.TTS_API_KEY!;

// ElevenLabs defaults
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID ?? "pNInz6obpgDQGcFmaJgB"; // Adam
const ELEVENLABS_MODEL = "eleven_turbo_v2_5";

// OpenAI TTS defaults
const OPENAI_TTS_VOICE = process.env.OPENAI_TTS_VOICE ?? "onyx";
const OPENAI_TTS_MODEL = "tts-1";

// Kokoro-82M defaults — voices: af_bella (American Female) | am_echo (American Male)
const KOKORO_VOICE = process.env.KOKORO_VOICE ?? "af_bella";
const KOKORO_MODEL = "onnx-community/Kokoro-82M-v1.0";

// Module-level cache so the model loads only once per pipeline run
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _kokoroInstance: any = null;

async function getKokoroTTS() {
  if (!_kokoroInstance) {
    // Set HF_TOKEN so @huggingface/transformers can download the gated model
    if (process.env.HF_TOKEN) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const transformers = await import("@huggingface/transformers" as any);
      if (transformers?.env) transformers.env.huggingface_token = process.env.HF_TOKEN;
    }

    // Dynamic import keeps the heavy ONNX runtime out of the require graph
    // when Kokoro is not the active provider.
    const { KokoroTTS } = await import("kokoro-js");
    _kokoroInstance = await KokoroTTS.from_pretrained(KOKORO_MODEL, {
      dtype: "q8", // quantised 8-bit — good balance of speed vs quality
    });
  }
  return _kokoroInstance;
}

/** Encode a Float32Array of PCM samples as a WAV buffer (mono, 16-bit). */
function float32ToWav(samples: Float32Array, sampleRate: number): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = numChannels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * blockAlign;

  const buf = Buffer.allocUnsafe(44 + dataSize);
  let off = 0;

  buf.write("RIFF", off); off += 4;
  buf.writeUInt32LE(36 + dataSize, off); off += 4;
  buf.write("WAVE", off); off += 4;
  buf.write("fmt ", off); off += 4;
  buf.writeUInt32LE(16, off); off += 4;
  buf.writeUInt16LE(1, off); off += 2;            // PCM
  buf.writeUInt16LE(numChannels, off); off += 2;
  buf.writeUInt32LE(sampleRate, off); off += 4;
  buf.writeUInt32LE(byteRate, off); off += 4;
  buf.writeUInt16LE(blockAlign, off); off += 2;
  buf.writeUInt16LE(bitsPerSample, off); off += 2;
  buf.write("data", off); off += 4;
  buf.writeUInt32LE(dataSize, off); off += 4;

  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(s * 32767), off);
    off += 2;
  }

  return buf;
}

async function generateKokoro(text: string): Promise<{ buffer: Buffer; ext: "wav" }> {
  const tts = await getKokoroTTS();
  const result = await tts.generate(text, { voice: KOKORO_VOICE });
  const buffer = float32ToWav(result.audio, result.sampling_rate);
  return { buffer, ext: "wav" };
}

async function generateElevenLabs(text: string): Promise<Buffer> {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": TTS_API_KEY,
      },
      body: JSON.stringify({
        text,
        model_id: ELEVENLABS_MODEL,
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.80,
          style: 0.15,
          use_speaker_boost: true,
        },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`ElevenLabs TTS failed (${res.status}): ${err}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

async function generateOpenAI(text: string): Promise<Buffer> {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TTS_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_TTS_MODEL,
      voice: OPENAI_TTS_VOICE,
      input: text,
      response_format: "mp3",
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI TTS failed (${res.status}): ${err}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

/**
 * Generate narration audio for a single scene.
 *
 * - ElevenLabs / OpenAI → `outputDir/scene_{id}_narration.mp3`
 * - Kokoro-82M          → `outputDir/scene_{id}_narration.wav`
 *
 * FFmpeg (used in the renderer) handles both formats transparently.
 */
export async function generateTTS(
  narrationText: string,
  sceneId: number,
  outputDir: string,
): Promise<string> {
  if (TTS_PROVIDER === "kokoro") {
    const { buffer, ext } = await generateKokoro(narrationText);
    const filePath = path.join(outputDir, `scene_${sceneId}_narration.${ext}`);
    await fs.writeFile(filePath, buffer);
    return filePath;
  }

  let buffer: Buffer;

  if (TTS_PROVIDER === "openai") {
    buffer = await generateOpenAI(narrationText);
  } else {
    buffer = await generateElevenLabs(narrationText);
  }

  const filePath = path.join(outputDir, `scene_${sceneId}_narration.mp3`);
  await fs.writeFile(filePath, buffer);
  return filePath;
}
