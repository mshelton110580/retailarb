import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { writeFile } from "fs/promises";
import { join } from "path";

/**
 * POST /api/dev/upload-tmp
 *
 * Saves an uploaded file to /tmp on the server for inspection.
 * ADMIN only. No database changes.
 */
export async function POST(req: Request) {
  const auth = await requireRole(["ADMIN"]);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const formData = await req.formData();
  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "No file uploaded (field name: 'file')" }, { status: 400 });
  }

  const uploadedFile = file as File;
  const safeName = uploadedFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const destPath = join("/tmp", safeName);

  const buffer = Buffer.from(await uploadedFile.arrayBuffer());
  await writeFile(destPath, buffer);

  return NextResponse.json({
    ok: true,
    savedTo: destPath,
    fileName: uploadedFile.name,
    sizeBytes: buffer.length,
    sizeKB: (buffer.length / 1024).toFixed(1),
  });
}
