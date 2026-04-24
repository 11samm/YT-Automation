import { promises as fs } from "fs";
import path from "path";

/**
 * TTS provider selection via TTS_PROVIDER env var.
 * Supported: "elevenlabs" (default) | "openai"
 */
const TTS_PROVIDER = (process.env.TTS_PROVIDER ?? "elevenlabs").toLowerCase();
const TTS_API_KEY = process.env.TTS_API_KEY!;

// ElevenLabs defaults
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID ?? "pNInz6obpgDQGcFmaJgB"; // Adam
const ELEVENLABS_MODEL = "eleven_turbo_v2_5";

// OpenAI TTS defaults
const OPENAI_TTS_VOICE = process.env.OPENAI_TTS_VOICE ?? "onyx";
const OPENAI_TTS_MODEL = "tts-1";

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
 * Writes the result to `outputDir/scene_{sceneId}_narration.mp3`.
 */
export async function generateTTS(
  narrationText: string,
  sceneId: number,
  outputDir: string,
): Promise<string> {
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
