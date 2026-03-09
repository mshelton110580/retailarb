import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import sharp from "sharp";

// NOTE: Images stored in PostgreSQL (unit_images.image_data) for environment isolation.
// If volume grows beyond ~1GB, migrate to Cloudflare R2 object storage.
// See prisma/schema.prisma comment on unit_images for migration path.

const MAX_WIDTH = 1920;
const JPEG_QUALITY = 80;

// POST /api/uploads/session/[sessionId]/photos
// Accepts multipart/form-data with one or more "photo" files
// No auth required — session ID is the secret (shared via QR code)
export async function POST(
  req: Request,
  { params }: { params: { sessionId: string } }
) {
  const session = await prisma.upload_sessions.findUnique({
    where: { id: params.sessionId },
    select: { id: true, received_unit_id: true, expires_at: true },
  });

  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  if (session.expires_at < new Date()) {
    return NextResponse.json({ error: "Session expired" }, { status: 410 });
  }

  const formData = await req.formData();
  const files = formData.getAll("photo") as File[];

  if (!files.length) return NextResponse.json({ error: "No photos provided" }, { status: 400 });

  const saved: Array<{ id: string; url: string }> = [];

  for (const file of files) {
    if (!file.size) continue;

    const buffer = Buffer.from(await file.arrayBuffer());

    // Compress with sharp: resize if larger than MAX_WIDTH, convert to JPEG
    const compressed = await sharp(buffer)
      .rotate() // auto-rotate based on EXIF
      .resize({ width: MAX_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY, progressive: true })
      .toBuffer();

    const filename = `${params.sessionId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;

    const image = await prisma.unit_images.create({
      data: {
        received_unit_id: session.received_unit_id,
        upload_session_id: session.id,
        image_data: compressed,
        content_type: "image/jpeg",
        filename,
      },
    });

    saved.push({ id: image.id, url: `/api/images/${image.id}` });
  }

  // Return updated image list for the session
  const allImages = await prisma.unit_images.findMany({
    where: { upload_session_id: session.id },
    orderBy: { created_at: "asc" },
    select: { id: true, created_at: true },
  });

  return NextResponse.json({
    uploaded: saved,
    images: allImages.map((img) => ({
      id: img.id,
      url: `/api/images/${img.id}`,
      createdAt: img.created_at,
    })),
  });
}
