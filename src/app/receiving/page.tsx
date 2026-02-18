import PageHeader from "@/components/page-header";
import DateRangeFilter from "@/components/date-range-filter";
import { getDateRangeFromParams } from "@/lib/date-range";
import { prisma } from "@/lib/db";
import ReceivingForm from "./receiving-form";
import ScanList from "./scan-list";

export default async function ReceivingPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const dateRange = getDateRangeFromParams(params);

  const scans = await prisma.receiving_scans.findMany({
    where: {
      scanned_at: {
        gte: dateRange.from,
        lte: dateRange.to,
      },
    },
    orderBy: { scanned_at: "desc" },
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

  // Enrich scans with matched order info including received unit details
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

      const matchedOrders = await Promise.all(
        trackingMatches
          .filter((m) => m.shipment?.order)
          .map(async (m) => {
            // Get received units for this order to show per-unit condition
            const units = await prisma.received_units.findMany({
              where: { order_id: m.shipment!.order_id },
              orderBy: { unit_index: "asc" },
              include: {
                listing: { select: { title: true } },
                category: { select: { id: true, category_name: true } }
              }
            });

            return {
              orderId: m.shipment!.order_id,
              items: m.shipment!.order!.order_items.map((i) => ({
                title: i.title,
                itemId: i.item_id,
                qty: i.qty,
                price: Number(i.transaction_price).toFixed(2)
              })),
              checkedIn: Boolean(m.shipment!.checked_in_at),
              expectedUnits: m.shipment!.expected_units,
              scannedUnits: m.shipment!.scanned_units,
              scanStatus: m.shipment!.scan_status,
              isLot: m.shipment!.is_lot,
              receivedUnits: units.map((u) => ({
                id: u.id,
                unitIndex: u.unit_index,
                title: u.listing?.title ?? "Unknown",
                condition: u.condition_status,
                receivedAt: u.received_at.toISOString(),
                notes: u.notes,
                category: u.category ? {
                  id: u.category.id,
                  name: u.category.category_name
                } : null
              }))
            };
          })
      );

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

  // Group scans by tracking_last8 (for lots where multiple units share same tracking)
  const groupedScans = enrichedScans.reduce((groups, scan) => {
    const existing = groups.find(g => g.tracking_last8 === scan.tracking_last8);
    if (existing) {
      existing.scans.push(scan);
    } else {
      groups.push({
        tracking_last8: scan.tracking_last8,
        scans: [scan]
      });
    }
    return groups;
  }, [] as Array<{ tracking_last8: string; scans: typeof enrichedScans }>);

  return (
    <div className="space-y-6">
      <PageHeader title="Receiving" />
      <div className="flex items-center justify-between">
        <DateRangeFilter />
        <span className="text-sm text-slate-400">{enrichedScans.length} scans</span>
      </div>
      <ReceivingForm />
      <ScanList groupedScans={groupedScans} />
    </div>
  );
}
