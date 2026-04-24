import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";

const OUTPUT_BASE = path.join(process.cwd(), "output");

/**
 * GET /api/download-video?path=<absolute-or-relative-path>
 * Streams a rendered MP4 from the local output/ directory.
 * Only serves files inside the output/ directory (path traversal guard).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const filePath = searchParams.get("path");

  if (!filePath) {
    return NextResponse.json({ error: "path parameter is required" }, { status: 400 });
  }

  // Resolve and guard against path traversal
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(OUTPUT_BASE)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  try {
    const buffer = await fs.readFile(resolved);
    const filename = path.basename(resolved);
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": buffer.byteLength.toString(),
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
