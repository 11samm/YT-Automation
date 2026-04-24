import { GoogleGenAI } from "@google/genai";
import { SceneInstruction, DOODLE_STYLE_SUFFIX } from "@/lib/schemas";

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ImagePlan {
  /** Detailed Flux image prompt (≤120 words), already respecting art style */
  image_description: string;
  /** Number of human characters visible in the frame — almost always 1 */
  num_people: number;
}

// ─── Gemini response schema ───────────────────────────────────────────────────

const IMAGE_PLAN_GEMINI_SCHEMA = {
  type: "object",
  properties: {
    image_description: { type: "string" },
    num_people:        { type: "integer" },
  },
  required: ["image_description", "num_people"],
} as const;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Use Gemini Flash to translate a SceneInstruction into a rich, story-relevant
 * image description for Flux.  The planner reads the narration text so the
 * resulting illustration actually matches what is being said, rather than just
 * reflecting the bare pose/environment fields.
 */
export async function planSceneImage(scene: SceneInstruction): Promise<ImagePlan> {
  const prompt = [
    "You are an image director for a 2D flat cartoon animated YouTube channel.",
    "Your job is to write a detailed, story-relevant image description for a single illustration.",
    "",
    "SCENE INFO:",
    `Narration (what is being said in this scene): "${scene.narration_text}"`,
    `Character pose: ${scene.character_pose}`,
    `Environment: ${scene.environment}`,
    `Visual mood: ${scene.visual_mood}`,
    "",
    "REQUIRED ART STYLE (must be respected in your description):",
    DOODLE_STYLE_SUFFIX,
    "",
    "RULES:",
    "- Show exactly 1 person unless the narration explicitly involves multiple people interacting.",
    "- The character MUST have a round plain white balloon head, two small black dot eyes,",
    "  and a simple line mouth — no other facial features ever.",
    "- BACKGROUNDS must be rich and story-relevant. Always include at least 3 specific props or",
    "  environmental details that directly reflect what the narration is about.",
    "  Example (job loss): cluttered desk, cardboard box of belongings, empty office chair behind,",
    "  fluorescent ceiling light, gray cubicle partition walls.",
    "  Example (street): concrete sidewalk, streetlamp, parked cars, building facades in background.",
    "  NEVER leave the background as a plain flat color with nothing in it.",
    "- Use a CLEAN, FLAT art style: muted solid colors, simple shapes, soft ambient lighting.",
    "  No dark noir lighting. No dramatic shadows. No gritty or photorealistic detail.",
    "- NEVER describe any text, words, letters, signs, neon signs, banners, labels, or writing",
    "  of any kind. If a sign or screen appears in the scene, describe it as blank or off.",
    "- Specify the floor/ground, walls or horizon, ceiling or sky where applicable.",
    "- Be concrete: name objects, their flat colors, and their position in the frame.",
    "- Keep image_description under 140 words.",
    "- Set num_people to the exact number of human characters visible (usually 1).",
  ].join("\n");

  const response = await genAI.models.generateContent({
    model: "gemini-3.1-flash-lite-preview",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      responseMimeType: "application/json",
      responseSchema: IMAGE_PLAN_GEMINI_SCHEMA as object,
      temperature: 0.7,
      maxOutputTokens: 512,
    },
  });

  const raw = response.text;
  if (!raw) throw new Error(`Gemini Flash returned empty plan for scene ${scene.scene_id}`);

  return JSON.parse(raw) as ImagePlan;
}
