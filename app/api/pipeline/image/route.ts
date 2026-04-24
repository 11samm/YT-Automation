import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { PipelineJob } from "@/lib/schemas";

const JOBS_DIR = path.join(process.cwd(), "jobs");

/**
 * GET /api/pipeline/image?jobId=xxx&sceneId=n
 * Serves a generated scene image from the local output directory.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get("jobId");
  const sceneId = parseInt(searchParams.get("sceneId") ?? "", 10);

  if (!jobId || !/^[0-9a-f-]{36}$/.test(jobId) || isNaN(sceneId)) {
    return NextResponse.json({ error: "jobId and sceneId required" }, { status: 400 });
  }

  try {
    const data = await fs.readFile(path.join(JOBS_DIR, `${jobId}.json`), "utf8");
    const job: PipelineJob = JSON.parse(data);

    const scene = job.scenes.find((s) => s.scene_id === sceneId);
    if (!scene?.image_path) {
      return NextResponse.json({ error: "Image not yet generated" }, { status: 404 });
    }

    const buffer = await fs.readFile(scene.image_path);
    const ext = scene.image_path.toLowerCase().split(".").pop();
    const contentType = ext === "png" ? "image/png" : "image/jpeg";

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
