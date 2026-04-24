import { fal } from "@fal-ai/client";
import { promises as fs } from "fs";
import path from "path";
import { SceneInstruction, DOODLE_STYLE_SUFFIX } from "@/lib/schemas";

fal.config({ credentials: process.env.FAL_KEY! });

const MODEL_ID = "fal-ai/flux/schnell";

/** Assembles the Fal.ai image prompt from scene fields + global style suffix.
 *  DOODLE_STYLE_SUFFIX is placed FIRST so diffusion models weight it highest,
 *  preventing any scene-specific description from overriding the art style. */
export function buildFluxPrompt(scene: SceneInstruction): string {
  return [
    DOODLE_STYLE_SUFFIX,
    scene.character_pose,
    scene.environment,
    scene.visual_mood,
  ].join(", ");
}

interface FalFluxResult {
  images: { url: string }[];
}

/**
 * Generate a single scene image via Fal.ai Flux.1 [schnell].
 * Downloads the result to `outputDir/scene_{scene_id}.jpg`.
 */
export async function generateImage(
  scene: SceneInstruction,
  outputDir: string,
): Promise<string> {
  const prompt = buildFluxPrompt(scene);

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

  return filePath;
}
