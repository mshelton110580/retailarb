import PageHeader from "@/components/page-header";
import { prisma } from "@/lib/db";
import ReceivingForm from "./receiving-form";
import ScanList from "./scan-list";

export default async function ReceivingPage() {
  const scans = await prisma.receiving_scans.findMany({
    orderBy: { scanned_at: "desc" },
    take: 50,
    include: {
      scanner: { select: { email: true } }
    }
  });

  // Get received_units grouped by the tracking_last8 to show what was checked in
  const receivedUnits = await prisma.received_units.findMany({
    select: {
      order_id: true,
      item_id: true,
      condition_status: true,
      received_at: true,
      listing: { select: { title: true } }
    }
  });

  // Build a map of order_id -> received items for display
  const receivedByOrder = new Map<string, Array<{ title: string; condition: string }>>();
  for (const ru of receivedUnits) {
    const arr = receivedByOrder.get(ru.order_id) ?? [];
    arr.push({ title: ru.listing?.title ?? "Unknown", condition: ru.condition_status });
    receivedByOrder.set(ru.order_id, arr);
  }

  // Enrich scans with matched order info
  const enrichedScans = await Promise.all(
    scans.map(async (scan) => {
      const trackingMatches = await prisma.tracking_numbers.findMany({
        where: { tracking_number: { endsWith: scan.tracking_last8 } },
        include: {
          shipment: {
            include: {
              order: { include: { order_items: true } }
            }
          }
        }
      });

      const matchedOrders = trackingMatches
        .filter((m) => m.shipment?.order)
        .map((m) => ({
          orderId: m.shipment!.order_id,
          items: m.shipment!.order!.order_items.map((i) => ({
            title: i.title,
            qty: i.qty
          })),
          checkedIn: Boolean(m.shipment!.checked_in_at)
        }));

      return {
        id: scan.id,
        tracking_last8: scan.tracking_last8,
        resolution_state: scan.resolution_state,
        scanned_at: scan.scanned_at.toISOString(),
        scanned_by: scan.scanner?.email ?? "Unknown",
        notes: scan.notes,
        matchedOrders
      };
    })
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Receiving" />
      <ReceivingForm />
      <ScanList scans={enrichedScans} />
    </div>
  );
}
