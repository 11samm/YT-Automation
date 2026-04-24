import { fal } from "@fal-ai/client";
import { promises as fs } from "fs";
import path from "path";
import { SceneInstruction, DOODLE_STYLE_SUFFIX } from "@/lib/schemas";
import { planSceneImage } from "./image-planner";

fal.config({ credentials: process.env.FAL_KEY! });

const MODEL_ID = "fal-ai/flux/schnell";

interface FalFluxResult {
  images: { url: string }[];
}

export interface ImageResult {
  filePath: string;
  /** The exact Flux prompt that was used — stored on SceneJob for redo editing */
  prompt: string;
}

/**
 * Build a fallback Flux prompt directly from scene fields (no AI planning).
 * Used when the image planner call fails.
 */
function buildFallbackPrompt(scene: SceneInstruction): string {
  return [
    DOODLE_STYLE_SUFFIX,
    scene.character_pose,
    scene.environment,
    scene.visual_mood,
  ].join(", ");
}

/**
 * Generate a single scene image via Fal.ai Flux.1 [schnell].
 *
 * Phase 1 — Gemini Flash plans the image: reads narration + scene fields and
 *   writes a detailed, story-relevant description.  Skipped when promptOverride
 *   is provided (user manually edited the prompt on redo).
 * Phase 2 — Flux generates the image.  DOODLE_STYLE_SUFFIX is always prepended
 *   so the art style is weighted highest regardless of the prompt source.
 *
 * Returns both the saved file path and the exact prompt used, so callers can
 * store the prompt for pre-filling the redo editor.
 */
export async function generateImage(
  scene: SceneInstruction,
  outputDir: string,
  promptOverride?: string,
): Promise<ImageResult> {
  // ── Phase 1: build prompt ─────────────────────────────────────────────────
  let prompt: string;

  if (promptOverride) {
    prompt = [DOODLE_STYLE_SUFFIX, promptOverride].join(", ");
    console.log(`[Scene ${scene.scene_id}] Using manual prompt override.`);
  } else {
    try {
      const plan = await planSceneImage(scene);
      const peopleTag = plan.num_people === 1 ? "1 person" : `${plan.num_people} people`;
      prompt = [DOODLE_STYLE_SUFFIX, peopleTag, plan.image_description].join(", ");
      console.log(
        `[Scene ${scene.scene_id}] Image plan (${plan.num_people} person(s)): ` +
        `${plan.image_description.slice(0, 100)}…`,
      );
    } catch (err) {
      console.warn(
        `[Scene ${scene.scene_id}] Image planner failed — using fallback prompt. ` +
        `Reason: ${(err as Error).message}`,
      );
      prompt = buildFallbackPrompt(scene);
    }
  }

  // ── Phase 2: generate ─────────────────────────────────────────────────────
  const result = await fal.subscribe(MODEL_ID, {
    input: {
      prompt,
      image_size: "landscape_16_9",
      num_images: 1,
      num_inference_steps: 4,
      enable_safety_checker: false,
    },
  }) as { data: FalFluxResult };

  const imageUrl = result.data?.images?.[0]?.url;
  if (!imageUrl) {
    throw new Error(`Fal.ai returned no image for scene ${scene.scene_id}`);
  }

  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error(`Failed to download image: ${response.status}`);

  const buffer = Buffer.from(await response.arrayBuffer());
  const filePath = path.join(outputDir, `scene_${scene.scene_id}.jpg`);
  await fs.writeFile(filePath, buffer);

  return { filePath, prompt };
}
