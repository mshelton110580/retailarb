import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";

export async function GET() {
  const auth = await requireRole(["ADMIN"]);
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const [unit_images, received_units, receiving_scans] = await Promise.all([
    prisma.unit_images.count(),
    prisma.received_units.count(),
    prisma.receiving_scans.count(),
  ]);

  return NextResponse.json({ unit_images, received_units, receiving_scans });
}

export async function POST() {
  const auth = await requireRole(["ADMIN"]);
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  // Delete in FK-safe order
  const [unit_images, received_units, receiving_scans] = await Promise.all([
    prisma.unit_images.deleteMany(),
    prisma.received_units.deleteMany(),
  ]).then(async ([imgs, units]) => {
    const scans = await prisma.receiving_scans.deleteMany();
    // Reset shipment check-in state
    await prisma.shipments.updateMany({
      data: {
        checked_in_at: null,
        checked_in_by: null,
        scanned_units: 0,
        scan_status: "pending",
        is_lot: false,
      }
    });
    return [imgs.count, units.count, scans.count];
  });

  return NextResponse.json({
    ok: true,
    deleted: { unit_images, received_units, receiving_scans }
  });
}
