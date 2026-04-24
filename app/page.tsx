"use client";

import {
  useState, useEffect, useRef, useCallback,
} from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { PipelineJob, SceneJob, DURATION_PRESETS } from "@/lib/schemas";

// ─── Types ───────────────────────────────────────────────────────────────────

type DurationPreset = { label: string; seconds: number; scenes: string };

const DURATION_OPTIONS: DurationPreset[] = [
  { label: "1 min",  seconds: 60,   scenes: "2–3 scenes"   },
  { label: "3 min",  seconds: 180,  scenes: "5–8 scenes"   },
  { label: "5 min",  seconds: 300,  scenes: "8–12 scenes"  },
  { label: "8 min",  seconds: 480,  scenes: "12–18 scenes" },
  { label: "10 min", seconds: 600,  scenes: "18–22 scenes" },
  { label: "12 min", seconds: 720,  scenes: "22–28 scenes" },
  { label: "15 min", seconds: 900,  scenes: "28–35 scenes" },
];

const CAMERA_LABELS: Record<string, string> = {
  slow_zoom_face: "Slow zoom — face",
  slow_zoom_object: "Slow zoom — object",
  pull_back_reveal: "Pull back reveal",
  pan_left_to_right: "Pan left → right",
  pan_right_to_left: "Pan right → left",
  pan_up_reveal: "Pan up reveal",
  static_hold: "Static hold",
  subtle_drift: "Subtle drift",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatSeconds(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function cn(...classes: (string | false | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

// ─── Stage Indicator ─────────────────────────────────────────────────────────

const STAGES = ["Setup", "Script", "Images", "Render", "Done"] as const;
type StageName = typeof STAGES[number];

function stageFromJob(job: PipelineJob | null): StageName {
  if (!job) return "Setup";
  switch (job.status) {
    case "pending": case "scripting": return "Script";
    case "awaiting_script_approval": return "Script";
    case "generating_images": case "awaiting_image_approval": return "Images";
    case "rendering_clips": case "rendering": return "Render";
    case "complete": return "Done";
    case "failed": return "Setup";
    default: return "Setup";
  }
}

function StageIndicator({ current }: { current: StageName }) {
  const idx = STAGES.indexOf(current);
  return (
    <div className="flex items-center gap-0">
      {STAGES.map((stage, i) => {
        const done = i < idx;
        const active = i === idx;
        return (
          <div key={stage} className="flex items-center">
            <div className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors",
              done && "text-emerald-400",
              active && "text-white",
              !done && !active && "text-zinc-600",
            )}>
              <span className={cn(
                "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold border",
                done && "bg-emerald-500 border-emerald-500 text-black",
                active && "bg-white border-white text-black",
                !done && !active && "border-zinc-700 text-zinc-600",
              )}>
                {done ? "✓" : i + 1}
              </span>
              {stage}
            </div>
            {i < STAGES.length - 1 && (
              <div className={cn("w-6 h-px", i < idx ? "bg-emerald-500" : "bg-zinc-800")} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Setup Form ───────────────────────────────────────────────────────────────

function SetupForm({ onStart }: { onStart: (topic: string, duration: number) => void }) {
  const [topic, setTopic] = useState("");
  const [duration, setDuration] = useState(600);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleStart() {
    if (!topic.trim()) return;
    setError(null);
    setStarting(true);
    try {
      onStart(topic.trim(), duration);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setStarting(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto py-16 px-6 space-y-8">
      <div className="text-center space-y-2">
        <div className="text-5xl mb-4">🎬</div>
        <h2 className="text-xl font-bold text-white">New Video</h2>
        <p className="text-zinc-500 text-sm">Gritty POV documentary · Doodle art · Ken Burns motion</p>
      </div>

      <div className="space-y-5">
        {/* Topic */}
        <div className="space-y-2">
          <label className="text-sm text-zinc-300 font-medium">Video Topic</label>
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !starting && handleStart()}
            placeholder='"POV: Your Life as Every Level of Navy SEAL"'
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500"
            disabled={starting}
          />
        </div>

        {/* Duration */}
        <div className="space-y-2">
          <label className="text-sm text-zinc-300 font-medium">Target Duration</label>
          <div className="grid grid-cols-3 gap-2">
            {DURATION_OPTIONS.map((opt) => (
              <button
                key={opt.seconds}
                onClick={() => setDuration(opt.seconds)}
                className={cn(
                  "py-2.5 px-3 rounded-lg border text-left transition-all",
                  duration === opt.seconds
                    ? "border-white bg-white/10 text-white"
                    : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-300",
                )}
              >
                <div className="text-sm font-semibold">{opt.label}</div>
                <div className="text-[10px] text-zinc-500 mt-0.5">{opt.scenes}</div>
              </button>
            ))}
          </div>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <Button
          onClick={handleStart}
          disabled={starting || !topic.trim()}
          className="w-full bg-white text-black hover:bg-zinc-200 font-semibold py-2.5"
        >
          {starting ? "Starting…" : "Generate Script →"}
        </Button>
      </div>
    </div>
  );
}

// ─── Loading State ────────────────────────────────────────────────────────────

function LoadingPanel({ message }: { message: string }) {
  const [dots, setDots] = useState("");
  useEffect(() => {
    const t = setInterval(() => setDots((d) => d.length >= 3 ? "" : d + "."), 500);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex flex-col items-center justify-center h-full py-24 space-y-4 text-zinc-500">
      <div className="w-6 h-6 border-2 border-zinc-600 border-t-white rounded-full animate-spin" />
      <p className="text-sm">{message}{dots}</p>
    </div>
  );
}

// ─── Script Review ────────────────────────────────────────────────────────────

interface ScriptReviewProps {
  job: PipelineJob;
  onApprove: () => void;
  approving: boolean;
}

function ScriptReviewLeft({ job, editingScene, onEditScene, onSaveEdit }:
  { job: PipelineJob; editingScene: number | null; onEditScene: (id: number, text: string) => void; onSaveEdit: () => void }
) {
  const [editText, setEditText] = useState("");
  const scenes = job.script?.scenes ?? [];

  function startEdit(id: number, text: string) {
    setEditText(text);
    onEditScene(id, text);
  }

  return (
    <div className="space-y-1 overflow-y-auto h-full pr-1">
      {scenes.map((scene) => {
        const isEditing = editingScene === scene.scene_id;
        return (
          <div key={scene.scene_id} className={cn(
            "rounded-lg p-3 border transition-colors",
            isEditing ? "border-zinc-500 bg-zinc-800" : "border-zinc-800 bg-zinc-900/50 hover:border-zinc-700",
          )}>
            <div className="flex items-start justify-between gap-2 mb-1.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] text-zinc-500 font-mono">#{scene.scene_id}</span>
                <Badge className="text-[9px] px-1.5 py-0 bg-zinc-800 text-zinc-300 border-zinc-700">
                  {scene.level_title}
                </Badge>
                <Badge className="text-[9px] px-1.5 py-0 bg-zinc-800/50 text-zinc-500 border-zinc-800">
                  {CAMERA_LABELS[scene.camera_instruction] ?? scene.camera_instruction}
                </Badge>
              </div>
              <span className="text-[10px] text-zinc-600 shrink-0">{scene.duration_seconds}s</span>
            </div>

            {isEditing ? (
              <div className="space-y-1.5">
                <textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  rows={4}
                  className="w-full bg-zinc-900 border border-zinc-600 rounded px-2 py-1.5 text-xs text-zinc-200 resize-none focus:outline-none focus:border-zinc-400"
                />
                <div className="flex gap-1.5">
                  <Button
                    className="text-xs py-1 h-auto bg-white text-black hover:bg-zinc-200"
                    onClick={() => { onEditScene(scene.scene_id, editText); onSaveEdit(); }}
                  >Save</Button>
                  <Button
                    variant="outline"
                    className="text-xs py-1 h-auto border-zinc-700 text-zinc-400 hover:text-white"
                    onClick={() => onEditScene(-1, "")}
                  >Cancel</Button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2">
                <p className="text-xs text-zinc-300 leading-relaxed flex-1 line-clamp-3">
                  {scene.narration_text}
                </p>
                <button
                  onClick={() => startEdit(scene.scene_id, scene.narration_text)}
                  className="text-[10px] text-zinc-600 hover:text-zinc-400 shrink-0 pt-0.5"
                >
                  edit
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ScriptReviewRight({ job, onApprove, approving }: ScriptReviewProps) {
  const script = job.script;
  if (!script) return null;

  return (
    <div className="space-y-6 h-full overflow-y-auto pr-1">
      <div>
        <h2 className="text-xl font-bold text-white leading-tight mb-2">{script.title}</h2>
        <p className="text-sm text-zinc-400 leading-relaxed line-clamp-4">{script.youtube_description}</p>
      </div>

      <div className="flex gap-3 text-sm">
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 flex-1 text-center">
          <div className="text-2xl font-bold text-white">{script.scenes.length}</div>
          <div className="text-[11px] text-zinc-500 mt-0.5">Scenes</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 flex-1 text-center">
          <div className="text-2xl font-bold text-white">{script.levels.length}</div>
          <div className="text-[11px] text-zinc-500 mt-0.5">Levels</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 flex-1 text-center">
          <div className="text-2xl font-bold text-white">{formatSeconds(script.total_duration_seconds)}</div>
          <div className="text-[11px] text-zinc-500 mt-0.5">Runtime</div>
        </div>
      </div>

      <div>
        <p className="text-xs text-zinc-500 font-semibold uppercase tracking-widest mb-2">Chapters</p>
        <div className="space-y-1">
          {script.levels.map((l) => (
            <div key={l.level_number} className="flex items-center gap-2 text-sm">
              <span className="text-zinc-600 font-mono text-xs w-12">Lv {l.level_number}</span>
              <span className="text-zinc-300">{l.level_title}</span>
            </div>
          ))}
        </div>
      </div>

      <Button
        onClick={onApprove}
        disabled={approving}
        className="w-full bg-white text-black hover:bg-zinc-200 font-semibold py-3"
      >
        {approving ? "Approving…" : "✓ Approve Script — Generate Images →"}
      </Button>

      <p className="text-xs text-zinc-600 text-center">
        You can edit narration text in the scene list on the left before approving.
      </p>
    </div>
  );
}

// ─── Image Review ─────────────────────────────────────────────────────────────

interface SceneCardProps {
  job: PipelineJob;
  scene: { scene_id: number; level_title?: string; narration_text?: string; camera_instruction?: string };
  sceneJob: SceneJob;
  onApprove: () => void;
  onRedo: () => void;
  redoing: boolean;
}

function SceneCard({ job, scene, sceneJob, onApprove, onRedo, redoing }: SceneCardProps) {
  const hasImage = sceneJob.status === "image_done" && sceneJob.image_path;
  const isGenerating = sceneJob.status === "pending" || redoing;
  const approved = sceneJob.approved;
  const failed = sceneJob.status === "failed";

  return (
    <div className={cn(
      "rounded-xl border overflow-hidden flex flex-col transition-all",
      approved ? "border-emerald-700 shadow-emerald-950/50 shadow-lg" : "border-zinc-800",
      failed && "border-red-900/50",
    )}>
      {/* Image area */}
      <div className="relative bg-zinc-900 aspect-video">
        {hasImage && !redoing ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/pipeline/image?jobId=${job.job_id}&sceneId=${scene.scene_id}&t=${Date.now()}`}
            alt={`Scene ${scene.scene_id}`}
            className="w-full h-full object-cover"
          />
        ) : isGenerating ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <div className="w-5 h-5 border-2 border-zinc-600 border-t-zinc-300 rounded-full animate-spin" />
            <span className="text-xs text-zinc-600">{redoing ? "Redoing…" : "Generating…"}</span>
          </div>
        ) : failed ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs text-red-500">Failed</span>
          </div>
        ) : null}

        {approved && !redoing && (
          <div className="absolute top-2 right-2 bg-emerald-500 text-black text-[10px] font-bold px-2 py-0.5 rounded-full">
            ✓ OK
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3 bg-zinc-950 flex-1 flex flex-col gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] text-zinc-600 font-mono">#{scene.scene_id}</span>
          {scene.level_title && (
            <Badge className="text-[9px] px-1.5 py-0 bg-zinc-800 text-zinc-400 border-zinc-700">
              {scene.level_title}
            </Badge>
          )}
        </div>
        {scene.narration_text && (
          <p className="text-[11px] text-zinc-500 leading-relaxed line-clamp-2">
            {scene.narration_text}
          </p>
        )}

        {/* Actions */}
        <div className="flex gap-1.5 mt-auto pt-1">
          <Button
            onClick={onApprove}
            disabled={!hasImage || approved || redoing}
            className={cn(
              "flex-1 text-xs py-1.5 h-auto font-semibold",
              approved
                ? "bg-emerald-800 text-emerald-200 cursor-default"
                : "bg-white text-black hover:bg-zinc-200",
            )}
          >
            {approved ? "Approved" : "✓ Approve"}
          </Button>
          <Button
            onClick={onRedo}
            disabled={redoing || !hasImage && !failed}
            variant="outline"
            className="flex-1 text-xs py-1.5 h-auto border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500"
          >
            {redoing ? "…" : "↺ Redo"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ImageReviewPanel({ job, onApproveAll, approvingAll }:
  { job: PipelineJob; onApproveAll: () => void; approvingAll: boolean }) {
  const [redoingScenes, setRedoingScenes] = useState<Set<number>>(new Set());

  const approvedCount = job.scenes.filter((s) => s.approved).length;
  const doneCount = job.scenes.filter((s) => s.status === "image_done").length;
  const totalCount = job.scenes.length;
  const allApproved = job.all_scenes_approved ||
    (doneCount > 0 && job.scenes.filter((s) => s.status === "image_done").every((s) => s.approved));

  async function approveScene(sceneId: number) {
    await fetch("/api/pipeline/approve-scene", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: job.job_id, sceneId }),
    });
  }

  async function redoScene(sceneId: number) {
    setRedoingScenes((s) => new Set(s).add(sceneId));
    try {
      await fetch("/api/pipeline/redo-scene", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.job_id, sceneId }),
      });
    } finally {
      setRedoingScenes((s) => { const n = new Set(s); n.delete(sceneId); return n; });
    }
  }

  const isGenerating = job.status === "generating_images";

  return (
    <div className="h-full flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 shrink-0">
        <div className="space-y-0.5">
          <h3 className="text-sm font-semibold text-white">
            {isGenerating ? "Generating images…" : "Review images"}
          </h3>
          <p className="text-xs text-zinc-500">
            {doneCount}/{totalCount} generated · {approvedCount} approved
            {isGenerating && " · More arriving…"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={onApproveAll}
            disabled={doneCount === 0 || allApproved || approvingAll}
            className="text-xs py-2 h-auto bg-white text-black hover:bg-zinc-200 font-semibold"
          >
            {approvingAll ? "Approving…" : allApproved ? "✓ All Approved" : `Approve All & Render →`}
          </Button>
        </div>
      </div>

      {isGenerating && doneCount < totalCount && (
        <Progress value={(doneCount / totalCount) * 100} className="h-1 bg-zinc-800 shrink-0" />
      )}

      {/* Grid */}
      <div className="overflow-y-auto flex-1">
        <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
          {job.script?.scenes.map((scene) => {
            const sceneJob = job.scenes.find((s) => s.scene_id === scene.scene_id) ?? {
              scene_id: scene.scene_id, status: "pending" as const,
            };
            return (
              <SceneCard
                key={scene.scene_id}
                job={job}
                scene={scene}
                sceneJob={sceneJob}
                onApprove={() => approveScene(scene.scene_id)}
                onRedo={() => redoScene(scene.scene_id)}
                redoing={redoingScenes.has(scene.scene_id)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Render Panel ─────────────────────────────────────────────────────────────

function RenderPanel({ job }: { job: PipelineJob }) {
  const clipsDone = job.scenes.filter((s) => s.status === "clip_done").length;
  const totalClips = job.scenes.filter((s) => s.approved || s.status === "clip_done").length;

  const messages: Record<string, string> = {
    rendering_clips: `Rendering clips — ${clipsDone}/${totalClips} done`,
    rendering: "Assembling final video…",
  };

  return (
    <div className="flex flex-col items-center justify-center h-full py-16 space-y-6 text-center">
      <div className="w-10 h-10 border-2 border-zinc-600 border-t-white rounded-full animate-spin" />
      <div className="space-y-2">
        <h3 className="text-white font-semibold">{messages[job.status] ?? "Rendering…"}</h3>
        <p className="text-xs text-zinc-500">{job.progress_percent}% complete</p>
      </div>
      <Progress value={job.progress_percent} className="w-64 h-2 bg-zinc-800" />
      <p className="text-xs text-zinc-600 max-w-xs">
        Hardware encoding with h264_nvenc. This may take a few minutes for longer videos.
      </p>
    </div>
  );
}

// ─── Complete Panel ───────────────────────────────────────────────────────────

function CompletePanel({ job, onNewVideo }: { job: PipelineJob; onNewVideo: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full py-16 space-y-6 text-center">
      <div className="text-5xl">✓</div>
      <div className="space-y-2">
        <h3 className="text-xl font-bold text-white">Video Complete!</h3>
        <p className="text-sm text-zinc-400 italic">{job.script?.title}</p>
        <p className="text-xs text-zinc-600 font-mono break-all max-w-md">{job.output_path}</p>
      </div>
      <div className="flex gap-3">
        <a
          href={`/api/download-video?path=${encodeURIComponent(job.output_path ?? "")}`}
          className="px-5 py-2.5 rounded-lg bg-white text-black font-semibold text-sm hover:bg-zinc-200 transition-colors"
        >
          ↓ Download MP4
        </a>
        <Button
          variant="outline"
          onClick={onNewVideo}
          className="border-zinc-700 text-zinc-300 hover:text-white text-sm"
        >
          + New Video
        </Button>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3 max-w-sm">
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 text-center">
          <div className="text-lg font-bold text-white">{job.scenes.filter(s => s.status === "clip_done").length}</div>
          <div className="text-[10px] text-zinc-500">Scenes</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 text-center">
          <div className="text-lg font-bold text-white">{formatSeconds(job.script?.total_duration_seconds ?? 0)}</div>
          <div className="text-[10px] text-zinc-500">Runtime</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 text-center">
          <div className="text-lg font-bold text-white">{job.script?.levels.length ?? 0}</div>
          <div className="text-[10px] text-zinc-500">Levels</div>
        </div>
      </div>
    </div>
  );
}

// ─── Failed Panel ─────────────────────────────────────────────────────────────

function FailedPanel({ job, onNewVideo }: { job: PipelineJob; onNewVideo: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full py-16 space-y-4 text-center">
      <div className="text-4xl">✗</div>
      <h3 className="text-white font-semibold">Pipeline Failed</h3>
      {job.error && (
        <div className="text-xs text-red-400 bg-red-950/40 border border-red-900 rounded-lg p-3 max-w-md break-all">
          {job.error}
        </div>
      )}
      <Button onClick={onNewVideo} className="bg-white text-black hover:bg-zinc-200">
        Try Again
      </Button>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [activeJob, setActiveJob] = useState<PipelineJob | null>(null);
  const [starting, setStarting] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approvingAll, setApprovingAll] = useState(false);
  const [editingScene, setEditingScene] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Polling ──────────────────────────────────────────────────────────────────
  const stopPoll = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  useEffect(() => {
    if (!activeJob || activeJob.status === "complete" || activeJob.status === "failed") {
      stopPoll();
      return;
    }
    const poll = async () => {
      try {
        const res = await fetch(`/api/pipeline/status?jobId=${activeJob.job_id}`);
        if (!res.ok) return;
        const fresh: PipelineJob = await res.json();
        setActiveJob(fresh);
      } catch { /* ignore */ }
    };
    poll();
    pollRef.current = setInterval(poll, 2500);
    return stopPoll;
  }, [activeJob?.job_id, activeJob?.status, stopPoll]);

  // ── Actions ──────────────────────────────────────────────────────────────────
  async function handleStart(topic: string, targetDurationSeconds: number) {
    setStarting(true);
    try {
      const res = await fetch("/api/pipeline/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, targetDurationSeconds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to start");
      // Fetch the initial job state
      const jobRes = await fetch(`/api/pipeline/status?jobId=${data.jobId}`);
      const job: PipelineJob = await jobRes.json();
      setActiveJob(job);
    } finally {
      setStarting(false);
    }
  }

  async function handleApproveScript() {
    if (!activeJob) return;
    setApproving(true);
    try {
      await fetch("/api/pipeline/approve-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: activeJob.job_id }),
      });
    } finally {
      setApproving(false);
    }
  }

  async function handleApproveAll() {
    if (!activeJob) return;
    setApprovingAll(true);
    try {
      // Single atomic request: the server marks all scenes + sets all_scenes_approved in one write,
      // avoiding the read-modify-write race condition of N concurrent approve-scene calls.
      await fetch("/api/pipeline/approve-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: activeJob.job_id }),
      });
    } finally {
      setApprovingAll(false);
    }
  }

  async function handleSaveSceneEdit() {
    if (!activeJob || editingScene === null) return;
    const scene = activeJob.script?.scenes.find((s) => s.scene_id === editingScene);
    if (!scene) return;
    await fetch("/api/pipeline/update-scene", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: activeJob.job_id, sceneId: editingScene, narration_text: scene.narration_text }),
    });
    setEditingScene(null);
  }

  const stage = stageFromJob(activeJob);
  const isScripting = activeJob?.status === "scripting" || activeJob?.status === "pending";
  const isScriptReady = activeJob?.status === "awaiting_script_approval";
  const isGeneratingImages = activeJob?.status === "generating_images";
  const isImageReview = activeJob?.status === "awaiting_image_approval" || activeJob?.status === "generating_images";
  const isRendering = activeJob?.status === "rendering_clips" || activeJob?.status === "rendering";
  const isComplete = activeJob?.status === "complete";
  const isFailed = activeJob?.status === "failed";

  function resetToSetup() {
    stopPoll();
    setActiveJob(null);
    setApproving(false);
    setApprovingAll(false);
    setEditingScene(null);
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-3 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-sm font-bold tracking-tight">YT Automation Pipeline</h1>
          <p className="text-[10px] text-zinc-600">Ken Burns · Gemini · Flux · FFmpeg</p>
        </div>
        <div className="flex items-center gap-4">
          {activeJob && <StageIndicator current={stage} />}
          {activeJob && !isComplete && !isFailed && (
            <button onClick={resetToSetup} className="text-xs text-zinc-600 hover:text-zinc-400">
              ✕ New
            </button>
          )}
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">
        {!activeJob && !starting ? (
          <SetupForm onStart={handleStart} />
        ) : starting ? (
          <LoadingPanel message="Starting pipeline" />
        ) : isScripting ? (
          <div className="flex-1">
            <LoadingPanel message="Writing your script with Gemini 1.5 Flash" />
          </div>
        ) : isScriptReady ? (
          /* Split pane: scene list | script overview */
          <div className="flex-1 flex overflow-hidden gap-0">
            <div className="w-[42%] border-r border-zinc-800 flex flex-col overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-800 shrink-0">
                <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest">
                  Scenes ({activeJob!.script?.scenes.length ?? 0})
                </p>
                <p className="text-[10px] text-zinc-600 mt-0.5">Click "edit" to modify narration text</p>
              </div>
              <div className="flex-1 overflow-y-auto p-3">
                <ScriptReviewLeft
                  job={activeJob!}
                  editingScene={editingScene}
                  onEditScene={(id, _text) => setEditingScene(id === -1 ? null : id)}
                  onSaveEdit={handleSaveSceneEdit}
                />
              </div>
            </div>
            <div className="flex-1 flex flex-col overflow-hidden p-6">
              <ScriptReviewRight job={activeJob!} onApprove={handleApproveScript} approving={approving} />
            </div>
          </div>
        ) : isImageReview ? (
          /* Full width image gallery */
          <div className="flex-1 flex flex-col overflow-hidden p-5">
            <ImageReviewPanel
              job={activeJob!}
              onApproveAll={handleApproveAll}
              approvingAll={approvingAll}
            />
          </div>
        ) : isRendering ? (
          <div className="flex-1"><RenderPanel job={activeJob!} /></div>
        ) : isComplete ? (
          <div className="flex-1"><CompletePanel job={activeJob!} onNewVideo={resetToSetup} /></div>
        ) : isFailed ? (
          <div className="flex-1"><FailedPanel job={activeJob!} onNewVideo={resetToSetup} /></div>
        ) : null}
      </div>
    </div>
  );
}
