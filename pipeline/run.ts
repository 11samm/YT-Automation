/**
 * CLI entry point for the YouTube Automation Pipeline.
 *
 * Usage (direct CLI — interactive approval via Enter key):
 *   npm run pipeline -- --topic "POV: Your Life as Every Level of Navy SEAL" --duration 10
 *
 * Flags:
 *   --topic, -t       Video topic (required)
 *   --duration, -d    Target length in minutes (default: 10)
 *   --job-id          Pre-existing job ID to resume/attach to
 *   --auto-approve    Skip all approval gates (fully automated run)
 *   --ui-mode         Spawned by API route; orchestrator polls for signals from UI
 */

import "dotenv/config";
import * as readline from "readline";
import { run, loadJob, saveJob } from "./orchestrator";

function parseArgs() {
  const args = process.argv.slice(2);

  const jobIdIdx = args.findIndex((a) => a === "--job-id");
  const jobId = jobIdIdx !== -1 ? args[jobIdIdx + 1] : undefined;

  const uiMode = args.includes("--ui-mode");
  const autoApprove = args.includes("--auto-approve");

  // In UI mode the job file is already written with the full topic and duration,
  // so we don't need (or trust) the --topic CLI argument — it breaks on Windows
  // because shell: true splits multi-word topics at spaces.
  // We return sentinel values here and resolve them from the job file in main().
  if (uiMode && jobId) {
    return { topic: "", targetDurationSeconds: 0, autoApprove, uiMode, jobId };
  }

  // Direct CLI usage still requires --topic
  const topicIdx = args.findIndex((a) => a === "--topic" || a === "-t");
  if (topicIdx === -1 || !args[topicIdx + 1]) {
    console.error('Usage: npm run pipeline -- --topic "Your topic" [--duration 10]');
    process.exit(1);
  }

  const durationIdx = args.findIndex((a) => a === "--duration" || a === "-d");
  const durationMin = durationIdx !== -1 ? parseInt(args[durationIdx + 1], 10) : 10;

  return {
    topic: args[topicIdx + 1],
    targetDurationSeconds: (isNaN(durationMin) ? 10 : durationMin) * 60,
    autoApprove,
    uiMode,
    jobId,
  };
}

async function promptEnter(message: string): Promise<void> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(message, () => { rl.close(); resolve(); });
    rl.on("close", resolve); // also resolves if stdin is closed
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForJobStatus(jobId: string, status: string): Promise<void> {
  while (true) {
    const job = await loadJob(jobId);
    if (!job || job.status === status || job.status === "failed" || job.status === "complete") return;
    await sleep(2000);
  }
}

/**
 * Interactive CLI approval flow — for direct use in a terminal.
 * Monitors the job file and prompts the user to approve at each gate.
 */
async function interactiveCliFlow(jobId: string, runPromise: Promise<string>): Promise<void> {
  console.log("\n[Waiting for script generation...]\n");

  await waitForJobStatus(jobId, "awaiting_script_approval");
  const scriptJob = await loadJob(jobId);
  if (scriptJob?.script) {
    console.log(`\n✓ Script ready: "${scriptJob.script.title}"`);
    console.log(`  Scenes: ${scriptJob.script.scenes.length} | Duration: ~${Math.round(scriptJob.script.total_duration_seconds / 60)}min`);
    console.log("  Levels:");
    scriptJob.script.levels.forEach((l) => console.log(`    Level ${l.level_number}: ${l.level_title}`));
  }

  await promptEnter("\n  → Press ENTER to approve the script and start image generation... ");
  const sJob = await loadJob(jobId);
  if (sJob) { sJob.script_approved = true; await saveJob(sJob); }

  console.log("\n[Generating images... please wait]\n");
  await waitForJobStatus(jobId, "awaiting_image_approval");
  const imgJob = await loadJob(jobId);
  const total = imgJob?.scenes.length ?? 0;
  const done = imgJob?.scenes.filter((s) => s.status === "image_done").length ?? 0;
  console.log(`\n✓ Images ready: ${done}/${total} scenes generated.`);
  console.log("  (Open the dashboard at http://localhost:3000 to view individual images.)");

  await promptEnter("\n  → Press ENTER to approve all images and start rendering... ");
  const iJob = await loadJob(jobId);
  if (iJob) {
    iJob.all_scenes_approved = true;
    iJob.scenes.forEach((s) => { if (s.status === "image_done") s.approved = true; });
    await saveJob(iJob);
  }

  const finalJobId = await runPromise;
  const finalJob = await loadJob(finalJobId);
  if (finalJob?.output_path) {
    console.log(`\n✓ Output: ${finalJob.output_path}`);
  }
}

async function main() {
  let { topic, targetDurationSeconds, autoApprove, uiMode, jobId } = parseArgs();

  // In UI mode the topic and duration live in the job file — resolve them now.
  if (uiMode && jobId) {
    const existingJob = await loadJob(jobId);
    if (!existingJob) {
      console.error(`[Pipeline] Job file not found for id: ${jobId}`);
      process.exit(1);
    }
    topic = existingJob.topic;
    targetDurationSeconds = existingJob.target_duration_seconds;
  }

  if (!uiMode) {
    console.log("═".repeat(60));
    console.log(" YouTube Automation Pipeline");
    console.log("═".repeat(60));
    console.log(`  Topic:    "${topic}"`);
    console.log(`  Duration: ${Math.round(targetDurationSeconds / 60)} minutes`);
    console.log(`  Mode:     ${autoApprove ? "Automated" : "Interactive"}`);
    console.log("═".repeat(60));
  }

  try {
    if (uiMode) {
      // API-spawned: orchestrator polls for signals from the UI, no CLI interaction
      await run(topic, targetDurationSeconds, { jobId, autoApprove: false });
    } else if (autoApprove) {
      await run(topic, targetDurationSeconds, { jobId, autoApprove: true });
    } else {
      // Interactive CLI: run orchestrator in background, approve via Enter
      const finalJobId = jobId ?? "pending";
      let resolvedJobId = finalJobId;

      const runPromise = run(topic, targetDurationSeconds, { jobId, autoApprove: false })
        .then((id) => { resolvedJobId = id; return id; });

      // Give orchestrator a moment to create the job file
      await sleep(1500);

      // Find the job ID if not preset (new job)
      if (!jobId) {
        // The run() function creates a new UUID — we need to find it
        // Easiest: poll for newest job file
        const jobsDir = require("path").join(process.cwd(), "jobs");
        let found = false;
        for (let i = 0; i < 10; i++) {
          try {
            const files = require("fs").readdirSync(jobsDir) as string[];
            if (files.length > 0) {
              const newest = files.sort((a: string, b: string) => b.localeCompare(a))[0];
              resolvedJobId = newest.replace(".json", "");
              found = true;
              break;
            }
          } catch { /* continue */ }
          await sleep(500);
        }
        if (!found) {
          console.error("Could not determine job ID");
          process.exit(1);
        }
      }

      await interactiveCliFlow(resolvedJobId, runPromise);
    }

    if (!uiMode) {
      console.log("\n" + "═".repeat(60));
      console.log("✓ Pipeline complete!");
      console.log("═".repeat(60));
    }
    process.exit(0);
  } catch (err) {
    if (!uiMode) console.error("\n✗ Pipeline failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
