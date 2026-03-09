import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// NOTE: Images served from PostgreSQL. If migrating to object storage (R2),
// replace the DB read with a redirect to the object URL.
// See prisma/schema.prisma comment on unit_images for migration path.

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const image = await prisma.unit_images.findUnique({
    where: { id: params.id },
    select: { image_data: true, content_type: true },
  });

  if (!image || !image.image_data) {
    return new NextResponse("Not found", { status: 404 });
  }

  return new NextResponse(new Uint8Array(image.image_data), {
    status: 200,
    headers: {
      "Content-Type": image.content_type,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
