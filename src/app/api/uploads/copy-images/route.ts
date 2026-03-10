import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { z } from "zod";

const schema = z.object({
  sourceUnitId: z.string().min(1),
  targetUnitIds: z.array(z.string().min(1)).min(1),
});

// POST /api/uploads/copy-images
// Copies all images from sourceUnitId to each targetUnitId
// Used after grouped photo upload — one unit gets photos via QR, then copies to siblings
export async function POST(req: Request) {
  const auth = await requireRole(["ADMIN", "RECEIVER"]);
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const body = schema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const { sourceUnitId, targetUnitIds } = body.data;

  // Get source images
  const sourceImages = await prisma.unit_images.findMany({
    where: { received_unit_id: sourceUnitId },
    select: { image_data: true, content_type: true, filename: true },
  });

  if (sourceImages.length === 0) {
    return NextResponse.json({ copied: 0 });
  }

  // Copy each image to each target unit
  let copied = 0;
  for (const targetId of targetUnitIds) {
    for (const img of sourceImages) {
      await prisma.unit_images.create({
        data: {
          received_unit_id: targetId,
          image_data: img.image_data,
          content_type: img.content_type,
          filename: img.filename,
        },
      });
      copied++;
    }
  }

  return NextResponse.json({ copied });
}
