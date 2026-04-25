import { z } from "zod";

// ─── Art Style ──────────────────────────────────────────────────────────────

export const DOODLE_STYLE_SUFFIX =
  "2D flat cartoon animation, clean educational animation style, " +
  "every single character has a perfectly round plain white balloon head " +
  "with two small black dot eyes and a short straight horizontal black line mouth, " +
  "completely neutral deadpan expression, no smile, no frown, no smirk, " +
  "no blushing, no rosy or pink cheeks, no red marks on the face, " +
  "the head is solid matte white with only the black eyes and black mouth line, " +
  "simple cartoon body shapes, " +
  "bold black outlines, flat solid color fills, clean vector illustration, " +
  "simple solid-color backgrounds with minimal detail, muted neutral color palette, " +
  "soft ambient lighting only, no dramatic shadows, no noir lighting, " +
  "no gradients, no textures, no photorealism, no detailed anatomy, no realistic skin or hair, " +
  "absolutely no text, no words, no letters, no numbers, no writing of any kind anywhere in the image";

// ─── Camera Instructions ────────────────────────────────────────────────────

export const CameraInstruction = z.enum([
  "slow_zoom_face",
  "slow_zoom_object",
  "pull_back_reveal",
  "pan_left_to_right",
  "pan_right_to_left",
  "pan_up_reveal",
  "static_hold",
  "subtle_drift",
]);

export type CameraInstructionType = z.infer<typeof CameraInstruction>;

// ─── Scene Schema ───────────────────────────────────────────────────────────

export const SceneSchema = z.object({
  scene_id: z.number().int().positive(),
  level_number: z.number().int().min(1),
  level_title: z.string(),
  duration_seconds: z.number().min(5).max(45),
  narration_text: z.string().min(10),
  character_pose: z.string(),
  environment: z.string(),
  visual_mood: z.string(),
  camera_instruction: CameraInstruction,
  transition: z.enum(["fade", "cut"]),
});

export type SceneInstruction = z.infer<typeof SceneSchema>;

// ─── VideoScript Schema ─────────────────────────────────────────────────────

export const VideoScriptSchema = z.object({
  title: z.string(),
  youtube_description: z.string(),
  tags: z.array(z.string()).max(30).optional().default([]),
  total_duration_seconds: z.number().min(30).max(3600),
  levels: z.array(z.object({
    level_number: z.number().int(),
    level_title: z.string(),
  })),
  // Max raised to 300 — multi-chapter pipeline can produce many short scenes
  scenes: z.array(SceneSchema).min(1).max(300),
});

export type VideoScript = z.infer<typeof VideoScriptSchema>;

// ─── Saliency Schema ────────────────────────────────────────────────────────

export const SaliencySchema = z.object({
  primary_subject_description: z.string(),
  target_x_percent: z.number().min(0).max(100),
  target_y_percent: z.number().min(0).max(100),
  motion_type: CameraInstruction,
  start_zoom_factor: z.number().min(1.0).max(1.2),
  end_zoom_factor: z.number().min(1.0).max(1.2),
  confidence: z.number().min(0).max(1),
  override_reason: z.string().optional(),
});

export type SaliencyResult = z.infer<typeof SaliencySchema>;

// ─── Job Status & Stage ─────────────────────────────────────────────────────

export type JobStatus =
  | "pending"
  | "scripting"
  | "awaiting_script_approval"
  | "generating_images"
  | "awaiting_image_approval"
  | "rendering_clips"
  | "rendering"
  | "complete"
  | "failed";

export type JobStage =
  | "setup"
  | "script_review"
  | "image_review"
  | "rendering"
  | "complete";

// ─── Scene Job ──────────────────────────────────────────────────────────────

export interface SceneJob {
  scene_id: number;
  image_path?: string;
  /** The Flux prompt used to generate the current image — shown pre-filled in the redo editor */
  image_prompt?: string;
  audio_path?: string;
  /** Set when TTS failed and scene fell back to silence — visible in job JSON for debugging */
  tts_error?: string;
  saliency?: SaliencyResult;
  clip_path?: string;
  /** User decision: undefined = pending review, true = approved, false = needs redo */
  approved?: boolean;
  status: "pending" | "image_done" | "audio_done" | "saliency_done" | "clip_done" | "failed";
  error?: string;
}

// ─── Pipeline Job ───────────────────────────────────────────────────────────

export interface PipelineJob {
  job_id: string;
  topic: string;
  target_duration_seconds: number;
  created_at: string;
  status: JobStatus;
  stage: JobStage;
  progress_percent: number;
  error?: string;
  script?: VideoScript;
  scenes: SceneJob[];
  output_path?: string;
  /** Written by approve-script API; orchestrator polls for this */
  script_approved?: boolean;
  /** Written by approve-all API; orchestrator polls for this */
  all_scenes_approved?: boolean;
  /** TTS provider chosen at job creation: "elevenlabs" | "kokoro" | "openai" */
  tts_provider?: string;
  /** Kokoro voice used when tts_provider === "kokoro": "af_bella" | "am_echo" */
  kokoro_voice?: string;
}

// ─── Duration Presets ───────────────────────────────────────────────────────

export const DURATION_PRESETS = [
  { label: "3 min",  seconds: 180,  scenes: "5–8"   },
  { label: "5 min",  seconds: 300,  scenes: "8–12"  },
  { label: "8 min",  seconds: 480,  scenes: "12–18" },
  { label: "10 min", seconds: 600,  scenes: "18–22" },
  { label: "12 min", seconds: 720,  scenes: "22–28" },
  { label: "15 min", seconds: 900,  scenes: "28–35" },
] as const;

// ─── Gemini JSON Schemas ────────────────────────────────────────────────────

export const VIDEO_SCRIPT_GEMINI_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    youtube_description: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    total_duration_seconds: { type: "number" },
    levels: {
      type: "array",
      items: {
        type: "object",
        properties: {
          level_number: { type: "integer" },
          level_title: { type: "string" },
        },
        required: ["level_number", "level_title"],
      },
    },
    scenes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          scene_id: { type: "integer" },
          level_number: { type: "integer" },
          level_title: { type: "string" },
          duration_seconds: { type: "number" },
          narration_text: { type: "string" },
          character_pose: { type: "string" },
          environment: { type: "string" },
          visual_mood: { type: "string" },
          camera_instruction: {
            type: "string",
            enum: [
              "slow_zoom_face", "slow_zoom_object", "pull_back_reveal",
              "pan_left_to_right", "pan_right_to_left", "pan_up_reveal",
              "static_hold", "subtle_drift",
            ],
          },
          transition: { type: "string", enum: ["fade", "cut"] },
        },
        required: [
          "scene_id", "level_number", "level_title", "duration_seconds",
          "narration_text", "character_pose", "environment", "visual_mood",
          "camera_instruction", "transition",
        ],
      },
    },
  },
  required: ["title", "youtube_description", "total_duration_seconds", "levels", "scenes"],
} as const;

export const SALIENCY_GEMINI_SCHEMA = {
  type: "object",
  properties: {
    primary_subject_description: { type: "string" },
    target_x_percent: { type: "number" },
    target_y_percent: { type: "number" },
    motion_type: {
      type: "string",
      enum: [
        "slow_zoom_face", "slow_zoom_object", "pull_back_reveal",
        "pan_left_to_right", "pan_right_to_left", "pan_up_reveal",
        "static_hold", "subtle_drift",
      ],
    },
    start_zoom_factor: { type: "number" },
    end_zoom_factor: { type: "number" },
    confidence: { type: "number" },
    override_reason: { type: "string" },
  },
  required: [
    "primary_subject_description", "target_x_percent", "target_y_percent",
    "motion_type", "start_zoom_factor", "end_zoom_factor", "confidence",
  ],
} as const;

// ─── Prompts ────────────────────────────────────────────────────────────────

export const SCRIPT_SYSTEM_PROMPT =
  "You are writing a dramatic, second-person voiceover script for a YouTube video in the style " +
  "of a gritty psychological documentary-animation. The viewer is the main character. " +
  "Write in strict second-person (\"You...\"). Use short, punchy, emotionally weighted sentences. " +
  "Do NOT be cheerful or educational in tone. The structure must escalate through clearly labeled " +
  "Levels or Years, each with a title. Output only valid JSON matching the provided schema.\n\n" +
  "CRITICAL RULE for the character_pose field:\n" +
  "You MUST explicitly state the character's orientation in every scene using one of these exact phrases: " +
  "'facing the camera', 'profile view', or 'seen from behind'. " +
  "NEVER write actions that require the character to twist or look backwards — this causes AI image " +
  "generators to draw a face on the back of the head. " +
  "Example good poses: 'standing at a desk facing the camera, arms crossed', " +
  "'sitting in profile view, staring at the horizon', 'walking away seen from behind'. " +
  "Example bad poses: 'turning to look over their shoulder', 'looking back at the camera while running'.";

export const SALIENCY_PROMPT =
  "You are a cinematographer for a 2D animated documentary. Analyze this doodle-style illustration. " +
  "The intended camera move for this scene is: \"{camera_instruction}\". " +
  "Identify the primary focal subject. Return JSON with: " +
  "target_x_percent/target_y_percent (focal point as % of image dimensions), " +
  "motion_type (confirm or override the suggestion), " +
  "start_zoom_factor/end_zoom_factor (1.0–1.2 only — keep movements slow and cinematic, never exceed 1.2), " +
  "override_reason (if you changed motion_type, explain why).";
