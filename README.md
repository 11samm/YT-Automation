# YT-Automation

**Turn a topic into a narrated, illustrated video—with review at each creative stage.**

YT-Automation is a local video production pipeline with a Next.js dashboard and a command-line interface. It generates structured scripts, creates scene illustrations, synthesizes narration, and assembles the results into a downloadable MP4 using FFmpeg.

## How it works

1. **Choose a topic and duration** — describe the video you want to make.
2. **Review the script** — inspect generated scenes and narration before moving ahead.
3. **Refine the illustrations** — review scene images, edit prompts, and regenerate individual scenes.
4. **Approve production** — continue once the scene assets are ready.
5. **Render and download** — combine illustrated scenes, narration, transitions, and background audio into a final video.

## Highlights

- **AI scripting and visual planning** powered by Google Gemini.
- **Consistent illustration style** using Flux.1 Schnell through fal.ai.
- **Narration options** for ElevenLabs, OpenAI TTS, or local Kokoro synthesis.
- **Human review controls** for scripts and individual scene images, plus an automatic CLI mode.
- **Local rendering** at 1920 × 1080 and 30 fps, with crossfade transitions and background audio mixing.
- **Inspectable jobs and outputs** stored as local files, including per-job logs and generated media.

The current renderer turns static illustrations into narrated scene clips. YouTube uploading and scheduling are outside the implemented pipeline.

## Built with

**Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · FFmpeg**

AI integrations use `@google/genai`, `@fal-ai/client`, and provider-specific speech APIs. Pipeline state is stored in local JSON job files.

## Getting started

### 1. Install dependencies

Use Node.js compatible with Next.js 16 and npm:

```sh
git clone https://github.com/11samm/YT-Automation.git
cd YT-Automation
npm install
```

Install FFmpeg and FFprobe if they are not available on your system. The project includes `ffmpeg-static`; explicit binary paths are useful if its downloaded binary is unavailable or you want a particular system build.

### 2. Configure the environment

Copy [.env.example](.env.example) to **`.env`** in the project root. The CLI loads this file through `dotenv/config`, and Next.js also reads it.

Set the following values:

```dotenv
GEMINI_API_KEY=your_gemini_api_key
FAL_KEY=your_fal_ai_api_key
TTS_PROVIDER=elevenlabs
TTS_API_KEY=your_tts_api_key
MUSIC_PROVIDER=ffmpeg
```

- **Gemini and fal.ai:** use API credentials with access to the models referenced in `pipeline/`.
- **ElevenLabs:** optionally set `ELEVENLABS_VOICE_ID` to your chosen voice.
- **OpenAI speech:** set `TTS_PROVIDER=openai`, use the matching `TTS_API_KEY`, and optionally set `OPENAI_TTS_VOICE`.
- **Local speech:** set `TTS_PROVIDER=kokoro`; optionally set `KOKORO_VOICE`. This mode downloads model assets on first use.
- **Background audio:** `MUSIC_PROVIDER=ffmpeg` creates a local ambient track. A custom HTTP music service can be configured with `MUSIC_PROVIDER=api`, `MUSIC_API_URL`, and `MUSIC_API_KEY`.
- **Media binaries:** set `FFMPEG_PATH` and `FFPROBE_PATH` to full executable paths when needed.

Keep API credentials in your local environment files. Cloud generation uses your provider accounts and may incur usage charges.

### 3. Open the dashboard

```sh
npm run dev
```

Open [localhost:3000](http://localhost:3000), enter a topic, and follow the script and image approval steps.

### Command-line usage

```sh
# Interactive approvals
npm run pipeline -- --topic "How a city gets its drinking water" --duration 5

# Run without approval pauses
npm run pipeline -- --topic "How a city gets its drinking water" --duration 5 --auto-approve
```

`--duration` is measured in minutes and defaults to 10. The CLI also accepts `--job-id` for an existing job.

## Files and outputs

```text
app/api/pipeline/  # Start, status, approval, and scene-editing endpoints
components/       # Dashboard and review interface
pipeline/         # Script, image, speech, music, orchestration, and rendering
lib/              # Schemas and media-binary resolution
jobs/             # Per-job JSON state
output/<job-id>/   # Generated assets, pipeline.log, and final.mp4
```

## Running in production

```sh
npm run build
npm start
```

Use a persistent Node.js environment with writable storage and permission to launch child processes. The dashboard starts a background pipeline process, and jobs and media depend on local disk. A static export or short-lived serverless function alone does not provide that runtime.

The renderer attempts NVIDIA NVENC encoding and includes a software fallback. Rendering speed and codec compatibility depend on the installed FFmpeg build. If narration generation fails, the orchestrator can substitute silence; check the job log and preview the final audio before publishing a video.
