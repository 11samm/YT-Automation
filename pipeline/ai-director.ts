import { GoogleGenAI } from "@google/genai";
import { promises as fs } from "fs";
import {
  SaliencyResult,
  SaliencySchema,
  SALIENCY_GEMINI_SCHEMA,
  SALIENCY_PROMPT,
  SceneInstruction,
} from "@/lib/schemas";

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

/**
 * Analyze a generated scene image with Gemini Vision.
 * The camera_instruction from the script is injected as a strong prior —
 * the AI confirms it or overrides it with a reason.
 */
export async function analyzeSaliency(
  imagePath: string,
  scene: SceneInstruction,
): Promise<SaliencyResult> {
  const imageData = await fs.readFile(imagePath);
  const base64 = imageData.toString("base64");

  // Determine MIME type from extension
  const ext = imagePath.toLowerCase().split(".").pop();
  const mimeType = ext === "png" ? "image/png" : "image/jpeg";

  const prompt = SALIENCY_PROMPT.replace("{camera_instruction}", scene.camera_instruction);

  const response = await genAI.models.generateContent({
    model: "gemini-3.1-flash-lite-preview",
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType, data: base64 } },
          { text: prompt },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: SALIENCY_GEMINI_SCHEMA as object,
      temperature: 0.2,
    },
  });

  const raw = response.text;
  if (!raw) throw new Error(`Gemini Vision returned empty response for scene ${scene.scene_id}`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `Gemini Vision returned invalid JSON for scene ${scene.scene_id}: ${(e as Error).message}`
    );
  }

  const result = SaliencySchema.safeParse(parsed);
  if (!result.success) {
    console.warn(`Saliency validation warnings for scene ${scene.scene_id}:`, result.error.issues);
    // Clamp and coerce values manually if validation fails
    const raw = parsed as Record<string, unknown>;
    return {
      primary_subject_description: String(raw.primary_subject_description ?? "Subject"),
      target_x_percent: Math.max(0, Math.min(100, Number(raw.target_x_percent ?? 50))),
      target_y_percent: Math.max(0, Math.min(100, Number(raw.target_y_percent ?? 50))),
      motion_type: scene.camera_instruction, // fall back to script's instruction
      start_zoom_factor: Math.max(1.0, Math.min(1.5, Number(raw.start_zoom_factor ?? 1.0))),
      end_zoom_factor: Math.max(1.0, Math.min(1.5, Number(raw.end_zoom_factor ?? 1.2))),
      confidence: Math.max(0, Math.min(1, Number(raw.confidence ?? 0.7))),
      override_reason: typeof raw.override_reason === "string" ? raw.override_reason : undefined,
    };
  }

  return result.data;
}
