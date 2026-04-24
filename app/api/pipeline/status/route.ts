import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { PipelineJob } from "@/lib/schemas";

const JOBS_DIR = path.join(process.cwd(), "jobs");

/**
 * GET /api/pipeline/status?jobId=<uuid>
 * Returns the current state of a pipeline job by reading its JSON file.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get("jobId");

  if (!jobId || !/^[0-9a-f-]{36}$/.test(jobId)) {
    return NextResponse.json({ error: "jobId query parameter is required" }, { status: 400 });
  }

  const filePath = path.join(JOBS_DIR, `${jobId}.json`);

  try {
    const data = await fs.readFile(filePath, "utf8");
    const job: PipelineJob = JSON.parse(data);
    return NextResponse.json(job);
  } catch {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
}
