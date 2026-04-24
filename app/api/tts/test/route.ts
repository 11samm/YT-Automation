import { NextResponse } from "next/server";
import { z } from "zod";

// Force Node.js runtime — required for ONNX native bindings (Kokoro)
export const runtime = "nodejs";

const bodySchema = z.object({
  provider: z.enum(["elevenlabs", "kokoro", "openai"]).default("elevenlabs"),
  kokoroVoice: z.enum(["af_bella", "am_echo"]).default("af_bella"),
});

const TEST_TEXT = "Hello world. Your voice engine is working correctly.";

// ─── WAV encoder (used for Kokoro PCM output) ────────────────────────────────

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
  buf.writeUInt16LE(1, off); off += 2;
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

// ─── Provider implementations ────────────────────────────────────────────────

async function testElevenLabs(): Promise<{ buffer: Buffer; contentType: string }> {
  const apiKey = process.env.TTS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID ?? "pNInz6obpgDQGcFmaJgB";

  if (!apiKey) throw new Error("TTS_API_KEY is not set in .env");

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
    body: JSON.stringify({
      text: TEST_TEXT,
      model_id: "eleven_turbo_v2_5",
      voice_settings: { stability: 0.45, similarity_boost: 0.80, style: 0.15, use_speaker_boost: true },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ElevenLabs returned ${res.status}: ${body.slice(0, 200)}`);
  }

  return { buffer: Buffer.from(await res.arrayBuffer()), contentType: "audio/mpeg" };
}

async function testOpenAI(): Promise<{ buffer: Buffer; contentType: string }> {
  const apiKey = process.env.TTS_API_KEY;
  const voice = process.env.OPENAI_TTS_VOICE ?? "onyx";

  if (!apiKey) throw new Error("TTS_API_KEY is not set in .env");

  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "tts-1", voice, input: TEST_TEXT, response_format: "mp3" }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenAI TTS returned ${res.status}: ${body.slice(0, 200)}`);
  }

  return { buffer: Buffer.from(await res.arrayBuffer()), contentType: "audio/mpeg" };
}

async function testKokoro(voice: string): Promise<{ buffer: Buffer; contentType: string }> {
  // @huggingface/transformers reads process.env.HF_TOKEN automatically for gated model downloads
  const { KokoroTTS } = await import("kokoro-js");
  const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8" });
  const result = await tts.generate(TEST_TEXT, { voice });
  return { buffer: float32ToWav(result.audio, result.sampling_rate), contentType: "audio/wav" };
}

// ─── Route handler ───────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { provider, kokoroVoice } = parsed.data;

  try {
    let result: { buffer: Buffer; contentType: string };

    if (provider === "elevenlabs") {
      result = await testElevenLabs();
    } else if (provider === "openai") {
      result = await testOpenAI();
    } else {
      result = await testKokoro(kokoroVoice);
    }

    return new NextResponse(result.buffer, {
      headers: {
        "Content-Type": result.contentType,
        "Content-Length": String(result.buffer.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
