import { GoogleGenAI } from "@google/genai";
import {
  VideoScript,
  VideoScriptSchema,
  SceneInstruction,
  CameraInstructionType,
  SCRIPT_SYSTEM_PROMPT,
} from "@/lib/schemas";

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

// ─── Internal types ───────────────────────────────────────────────────────────

interface ChapterBrief {
  chapter_number: number;
  level_title: string;
  duration_seconds: number;
  theme: string;
}

interface VideoOutline {
  title: string;
  youtube_description: string;
  /** Locked character appearance repeated in every chapter call for consistency */
  character_description: string;
  chapters: ChapterBrief[];
}

interface RawScene {
  // duration_seconds is intentionally absent — we calculate it from word count
  narration_text: string;
  character_pose: string;
  environment: string;
  visual_mood: string;
  camera_instruction: string;
  transition: string;
}

// TTS speaks at ~3.5 words per second; scene duration is derived from narration length.
const TTS_WORDS_PER_SECOND = 3.5;
// Gemini chooses narration length in this range — more words = longer clip.
const MIN_WORDS_PER_SCENE = 18;  // ~5 s — quick punchy cut
const MAX_WORDS_PER_SCENE = 35;  // ~10 s — heavy emotional beat
// Average used only for scene-count estimation.
const AVG_WORDS_PER_SCENE = Math.round((MIN_WORDS_PER_SCENE + MAX_WORDS_PER_SCENE) / 2);

function durationFromNarration(narrationText: string): number {
  const wordCount = narrationText.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(3, Math.round(wordCount / TTS_WORDS_PER_SECOND));
}

// ─── Gemini response schemas ──────────────────────────────────────────────────

const OUTLINE_GEMINI_SCHEMA = {
  type: "object",
  properties: {
    title:                 { type: "string" },
    youtube_description:   { type: "string" },
    character_description: { type: "string" },
    chapters: {
      type: "array",
      items: {
        type: "object",
        properties: {
          chapter_number:   { type: "integer" },
          level_title:      { type: "string" },
          duration_seconds: { type: "integer" },
          theme:            { type: "string" },
        },
        required: ["chapter_number", "level_title", "duration_seconds", "theme"],
      },
    },
  },
  required: ["title", "youtube_description", "character_description", "chapters"],
} as const;

const CAMERA_ENUM_VALUES = [
  "slow_zoom_face", "slow_zoom_object", "pull_back_reveal",
  "pan_left_to_right", "pan_right_to_left", "pan_up_reveal",
  "static_hold", "subtle_drift",
];

const CHAPTER_SCENES_GEMINI_SCHEMA = {
  type: "object",
  properties: {
    scenes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          // duration_seconds omitted — calculated from narration word count
          narration_text:      { type: "string" },
          character_pose:      { type: "string" },
          environment:         { type: "string" },
          visual_mood:         { type: "string" },
          camera_instruction:  { type: "string", enum: CAMERA_ENUM_VALUES },
          transition:          { type: "string", enum: ["fade", "cut"] },
        },
        required: [
          "narration_text", "character_pose",
          "environment", "visual_mood", "camera_instruction", "transition",
        ],
      },
    },
  },
  required: ["scenes"],
} as const;


// ─── Phase 1: Outline ─────────────────────────────────────────────────────────

async function generateOutline(
  topic: string,
  totalDurationSeconds: number,
): Promise<VideoOutline> {
  const totalMinutes = Math.round(totalDurationSeconds / 60);

  // Each chapter covers ~70 s of content — small enough for reliable scene generation
  const numChapters   = Math.max(2, Math.ceil(totalDurationSeconds / 70));
  const baseChapDur   = Math.floor(totalDurationSeconds / numChapters);
  const lastChapDur   = totalDurationSeconds - baseChapDur * (numChapters - 1);

  const chapterDurDesc = numChapters > 1
    ? `Chapters 1–${numChapters - 1}: ${baseChapDur}s each. Chapter ${numChapters}: ${lastChapDur}s.`
    : `Chapter 1: ${totalDurationSeconds}s.`;

  const prompt = [
    SCRIPT_SYSTEM_PROMPT,
    "",
    `Create a chapter-by-chapter outline for a ${totalMinutes}-minute YouTube video.`,
    `Topic: "${topic}"`,
    "",
    `Divide the video into exactly ${numChapters} chapters that escalate dramatically.`,
    chapterDurDesc,
    `The sum of all chapter duration_seconds MUST equal exactly ${totalDurationSeconds}.`,
    "",
    "For each chapter provide:",
    "  level_title: short dramatic chapter name (e.g. 'The Recruit', 'The Breaking Point').",
    "  theme: 1-2 sentences on the emotional arc and key events — this guides scene writing.",
    "",
    "Also provide:",
    "  character_description: describe ONLY the character's clothing and outfit for this story.",
    "    DO NOT describe face shape, head shape, hair, eyes, skin, or any facial features.",
    "    The art style automatically gives every character a round white featureless head with dot eyes.",
    "    Example: 'wrinkled charcoal three-piece suit, loosened black tie, scuffed Oxford shoes'.",
    "    Keep it under 12 words.",
    "  title: compelling YouTube video title.",
    "  youtube_description: 40-60 word video description.",
  ].join("\n");

  const response = await genAI.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      responseMimeType: "application/json",
      responseSchema: OUTLINE_GEMINI_SCHEMA as object,
      temperature: 0.85,
      maxOutputTokens: 4096,
    },
  });

  const raw = response.text;
  if (!raw) throw new Error("Gemini returned empty outline");

  return JSON.parse(raw) as VideoOutline;
}

// ─── Phase 2: Scenes per chapter ─────────────────────────────────────────────

async function generateChapterScenes(
  topic: string,
  outline: VideoOutline,
  chapter: ChapterBrief,
  startSceneId: number,
): Promise<SceneInstruction[]> {
  const targetSeconds = chapter.duration_seconds;

  // Scene count derived from word-count math using the average word target.
  // Gemini will vary individual scenes between MIN and MAX, so the average
  // governs how many scenes fit in the chapter duration.
  const targetWords      = Math.round(targetSeconds * TTS_WORDS_PER_SECOND);
  const targetSceneCount = Math.max(3, Math.round(targetWords / AVG_WORDS_PER_SCENE));

  function buildPrompt(sceneCount: number): string {
    return [
      `You are writing scenes for ONE chapter of a YouTube video.`,
      "",
      `VIDEO TOPIC: "${topic}"`,
      `CHAPTER ${chapter.chapter_number}: "${chapter.level_title}"`,
      `CHAPTER THEME: ${chapter.theme}`,
      "",
      `CHARACTER OUTFIT (include in every character_pose): "${outline.character_description}"`,
      "",
      `Write exactly ${sceneCount} scenes for this chapter.`,
      `WORD COUNT CONTROLS CLIP DURATION (3.5 words = 1 second of TTS audio):`,
      `  - Quick punchy cut  → ${MIN_WORDS_PER_SCENE}–20 words → ~5 s`,
      `  - Standard beat     → 22–28 words → ~7 s`,
      `  - Heavy impact beat → 30–${MAX_WORDS_PER_SCENE} words → ~9–10 s`,
      `YOU are the director. Choose the word count for each scene based on its emotional weight.`,
      `Total chapter should be ~${targetSeconds}s: ${sceneCount} scenes averaging ~${AVG_WORDS_PER_SCENE} words each.`,
      "",
      "FIELD CONSTRAINTS:",
      `  narration_text: ${MIN_WORDS_PER_SCENE}–${MAX_WORDS_PER_SCENE} words chosen by you based on scene weight. Second-person ('You...'). Dark and punchy.`,
      "  character_pose: body position + outfit ONLY. Max 12 words.",
      "    MUST include one of: 'facing the camera', 'profile view', 'seen from behind'.",
      "    NEVER describe face, hair, eyes, skin, or any facial features.",
      `    Example: 'standing facing the camera, arms crossed, ${outline.character_description}'`,
      "  environment: max 10 words.",
      "  visual_mood: max 8 words.",
      "",
      "STYLE: gritty psychological 2D flat cartoon documentary.",
      "TONE: second-person, short punchy sentences, psychological weight, dark.",
      "VISUAL CONSISTENCY: same outfit in every scene.",
      "NO TWISTING POSES: no poses requiring looking backwards.",
      "Alternate 'fade' and 'cut' transitions naturally.",
    ].join("\n");
  }

  // Attempt schedule: reduce by 1 scene per retry so we lose as little
  // content as possible while still escaping token-limit truncations.
  const attemptCounts = [
    targetSceneCount,
    Math.max(3, targetSceneCount - 1),
    Math.max(3, targetSceneCount - 2),
    Math.max(3, targetSceneCount - 3),
  ];

  for (let attempt = 0; attempt < attemptCounts.length; attempt++) {
    const sceneCount = attemptCounts[attempt];
    let raw: string | null | undefined;

    try {
      const response = await genAI.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: [{ role: "user", parts: [{ text: buildPrompt(sceneCount) }] }],
        config: {
          responseMimeType: "application/json",
          responseSchema: CHAPTER_SCENES_GEMINI_SCHEMA as object,
          temperature: 0.9,
          maxOutputTokens: 8192,
        },
      });
      raw = response.text;
    } catch (err) {
      console.warn(`[Script] Chapter ${chapter.chapter_number} attempt ${attempt + 1} API error:`, err);
      continue;
    }

    if (!raw) {
      console.warn(`[Script] Chapter ${chapter.chapter_number} attempt ${attempt + 1}: empty response`);
      continue;
    }

    let parsed: { scenes: RawScene[] };
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.warn(
        `[Script] Chapter ${chapter.chapter_number} attempt ${attempt + 1}: ` +
        `JSON truncated (${raw.length} chars) — retrying with ${attemptCounts[attempt + 1] ?? "N/A"} scenes…`,
      );
      continue;
    }

    const rawScenes = parsed.scenes ?? [];
    if (rawScenes.length === 0) {
      console.warn(`[Script] Chapter ${chapter.chapter_number} attempt ${attempt + 1}: no scenes returned`);
      continue;
    }

    // Duration is derived from actual word count — no Gemini guessing involved
    return rawScenes.map((sc, i): SceneInstruction => ({
      scene_id:           startSceneId + i,
      level_number:       chapter.chapter_number,
      level_title:        chapter.level_title,
      duration_seconds:   durationFromNarration(sc.narration_text),
      narration_text:     sc.narration_text,
      character_pose:     sc.character_pose,
      environment:        sc.environment,
      visual_mood:        sc.visual_mood,
      camera_instruction: sc.camera_instruction as CameraInstructionType,
      transition:         sc.transition as "fade" | "cut",
    }));
  }

  // All attempts exhausted — log and return empty rather than crashing the pipeline
  console.error(
    `[Script] ✗ Chapter ${chapter.chapter_number} "${chapter.level_title}" ` +
    `failed all attempts — skipping (video will be shorter than requested)`,
  );
  return [];
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate a complete video script using a two-phase pipeline:
 *   Phase 1 — one small call produces a chapter outline (title, character, themes).
 *   Phase 2 — one call per chapter generates only that chapter's scenes.
 *
 * This avoids token-limit truncation and makes duration math trivially enforceable
 * per-chapter rather than asking Gemini to manage a whole video's worth of arithmetic.
 */
export async function generateScript(
  topic: string,
  targetDurationSeconds: number,
): Promise<VideoScript> {
  // ── Phase 1 ──────────────────────────────────────────────────────────────────
  console.log("[Script] Phase 1 — generating chapter outline…");
  const outline = await generateOutline(topic, targetDurationSeconds);
  const chapterSummary = outline.chapters
    .map((c) => `"${c.level_title}" (${c.duration_seconds}s)`)
    .join(", ");
  console.log(`[Script] Outline — ${outline.chapters.length} chapters: ${chapterSummary}`);
  console.log(`[Script] Character: ${outline.character_description}`);

  // ── Phase 2 ──────────────────────────────────────────────────────────────────
  const allScenes: SceneInstruction[] = [];
  let sceneIdCounter = 1;

  for (const chapter of outline.chapters) {
    console.log(
      `[Script] Phase 2 — chapter ${chapter.chapter_number}/${outline.chapters.length}` +
      ` "${chapter.level_title}" (${chapter.duration_seconds}s)…`,
    );
    const scenes = await generateChapterScenes(topic, outline, chapter, sceneIdCounter);
    allScenes.push(...scenes);
    sceneIdCounter += scenes.length;
    const chapterActual = scenes.reduce((s, sc) => s + sc.duration_seconds, 0);
    console.log(`[Script]   → ${scenes.length} scenes, ${chapterActual}s`);
  }

  const totalActual = allScenes.reduce((s, sc) => s + sc.duration_seconds, 0);
  console.log(
    `[Script] ✓ Complete — ${allScenes.length} scenes, ` +
    `${totalActual}s total (target: ${targetDurationSeconds}s)`,
  );

  const script: VideoScript = {
    title:                    outline.title,
    youtube_description:      outline.youtube_description,
    tags:                     [],
    total_duration_seconds:   targetDurationSeconds,
    levels:                   outline.chapters.map((c) => ({
      level_number: c.chapter_number,
      level_title:  c.level_title,
    })),
    scenes: allScenes,
  };

  const validation = VideoScriptSchema.safeParse(script);
  if (!validation.success) {
    console.warn("[Script] Validation warnings:", validation.error.issues);
  }

  return script;
}
