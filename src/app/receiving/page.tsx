import PageHeader from "@/components/page-header";
import Link from "next/link";
import DateRangeFilter from "@/components/date-range-filter";
import { getDateRangeFromParams } from "@/lib/date-range";
import { prisma } from "@/lib/db";
import ReceivingForm from "./receiving-form";
import ScanList from "./scan-list";
import type { ScanEntry } from "./scan-list";

// Matches the same logic used by the scanner (scan/route.ts) and receiving_scans.tracking_last8
function trackingLast8(value: string): string {
  return value.replace(/\D/g, "").slice(-8);
}

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

  // Fetch tracking numbers so we can map order_id -> tracking last 8 for imported items
  const trackingNumbers = await prisma.tracking_numbers.findMany({
    select: { tracking_number: true, shipment: { select: { order_id: true } } }
  });

  // Helper to fetch matched orders for a tracking number query
  async function fetchMatchedOrders(
    trackingMatches: Awaited<ReturnType<typeof prisma.tracking_numbers.findMany<{
      include: { shipment: { include: { order: { include: { order_items: true } } } } }
    }>>>
  ) {
    return Promise.all(
      trackingMatches
        .filter((m) => m.shipment?.order)
        .map(async (m) => {
          const units = await prisma.received_units.findMany({
            where: { order_id: m.shipment!.order_id },
            orderBy: { unit_index: "asc" },
            include: {
              listing: { select: { title: true } },
              category: { select: { id: true, category_name: true } }
            }
          });
          const orderItems = m.shipment!.order!.order_items;
          const orderQty = orderItems.reduce((s, i) => s + i.qty, 0);
          const lotSize = m.shipment!.lot_size ??
            (m.shipment!.is_lot && orderQty > 0 ? Math.ceil(m.shipment!.scanned_units / orderQty) : null);
          return {
            orderId: m.shipment!.order_id,
            shipmentId: m.shipment!.id,
            items: orderItems.map((i) => ({
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
            lotSize,
            orderQty,
            receivedUnits: units.map((u) => ({
              id: u.id,
              unitIndex: u.unit_index,
              title: u.listing?.title ?? "Unknown",
              condition: u.condition_status,
              receivedAt: u.received_at.toISOString(),
              notes: u.notes,
              category: u.category ? { id: u.category.id, name: u.category.category_name } : null
            }))
          };
        })
    );
  }

  // Enrich scans — exact match first, fall back to last-8 digit suffix
  const enrichedScans = await Promise.all(
    scans.map(async (scan) => {
      let trackingMatches = scan.tracking_full
        ? await prisma.tracking_numbers.findMany({
            where: { tracking_number: scan.tracking_full },
            include: { shipment: { include: { order: { include: { order_items: true } } } } }
          })
        : [];

      if (trackingMatches.length === 0) {
        trackingMatches = await prisma.tracking_numbers.findMany({
          where: { tracking_number: { endsWith: scan.tracking_last8 } },
          include: { shipment: { include: { order: { include: { order_items: true } } } } }
        });
      }

      return {
        id: scan.id,
        tracking_last8: scan.tracking_last8,
        resolution_state: scan.resolution_state,
        scanned_at: scan.scanned_at.toISOString(),
        scanned_by: scan.scanner?.email ?? "Unknown",
        notes: scan.notes,
        matchedOrders: await fetchMatchedOrders(trackingMatches)
      };
    })
  );

  // Group scans by tracking_last8
  const groupedScans = enrichedScans.reduce((groups, scan) => {
    const existing = groups.find(g => g.tracking_last8 === scan.tracking_last8);
    if (existing) {
      existing.scans.push(scan);
    } else {
      groups.push({ tracking_last8: scan.tracking_last8, scans: [scan] });
    }
    return groups;
  }, [] as Array<{ tracking_last8: string; scans: typeof enrichedScans }>);

  // Order IDs already shown via manual scans
  const scannedOrderIds = new Set(
    enrichedScans.flatMap(s => s.matchedOrders.map(o => o.orderId))
  );

  // Map order_id -> tracking last 8 digits
  const orderToTrackingLast8 = new Map<string, string>();
  for (const tn of trackingNumbers) {
    if (tn.shipment?.order_id) {
      orderToTrackingLast8.set(tn.shipment.order_id, trackingLast8(tn.tracking_number));
    }
  }

  // Fetch imported units within date range
  const importedUnitsRaw = await prisma.received_units.findMany({
    where: { received_at: { gte: dateRange.from, lte: dateRange.to } },
    orderBy: { received_at: "desc" },
    include: {
      listing: { select: { title: true } },
      category: { select: { id: true, category_name: true } },
      order: {
        include: {
          order_items: true,
          shipments: { select: { id: true, expected_units: true, scanned_units: true, scan_status: true, is_lot: true, lot_size: true, checked_in_at: true } }
        }
      }
    }
  });

  type ImportOrderMap = {
    orderId: string;
    shipmentId: string | null;
    trackingLast8: string;
    receivedAt: string;
    receivedUnits: ScanEntry["matchedOrders"][0]["receivedUnits"];
    items: ScanEntry["matchedOrders"][0]["items"];
    expectedUnits: number;
    scannedUnits: number;
    scanStatus: string | null;
    isLot: boolean;
    lotSize: number | null;
    orderQty: number;
    checkedIn: boolean;
  };

  const importGroupsByOrder = new Map<string, ImportOrderMap>();

  for (const unit of importedUnitsRaw) {
    if (!unit.order_id || scannedOrderIds.has(unit.order_id)) continue;
    const tl8 = orderToTrackingLast8.get(unit.order_id) ?? "????????";
    const shipment = unit.order?.shipments?.[0];
    if (!importGroupsByOrder.has(unit.order_id)) {
      const orderItems = unit.order?.order_items ?? [];
      const oQty = orderItems.reduce((s, i) => s + i.qty, 0);
      const isLot = shipment?.is_lot ?? false;
      const lotSize = shipment?.lot_size ??
        (isLot && oQty > 0 ? Math.ceil((shipment?.scanned_units ?? 0) / oQty) : null);
      importGroupsByOrder.set(unit.order_id, {
        orderId: unit.order_id,
        shipmentId: shipment?.id ?? null,
        trackingLast8: tl8,
        receivedAt: unit.received_at.toISOString(),
        receivedUnits: [],
        items: orderItems.map(i => ({
          title: i.title ?? ("Item " + i.item_id),
          itemId: i.item_id,
          qty: i.qty,
          price: Number(i.transaction_price).toFixed(2)
        })),
        expectedUnits: shipment?.expected_units ?? 0,
        scannedUnits: shipment?.scanned_units ?? 0,
        scanStatus: shipment?.scan_status ?? null,
        isLot,
        lotSize,
        orderQty: oQty,
        checkedIn: Boolean(shipment?.checked_in_at)
      });
    }
    importGroupsByOrder.get(unit.order_id)!.receivedUnits.push({
      id: unit.id,
      unitIndex: unit.unit_index,
      title: unit.listing?.title ?? "Unknown",
      condition: unit.condition_status,
      receivedAt: unit.received_at.toISOString(),
      notes: unit.notes,
      category: unit.category ? { id: unit.category.id, name: unit.category.category_name } : null
    });
  }

  // Group import orders by tracking last 8
  const importGroupsByTracking = new Map<string, ImportOrderMap[]>();
  for (const group of importGroupsByOrder.values()) {
    const arr = importGroupsByTracking.get(group.trackingLast8) ?? [];
    arr.push(group);
    importGroupsByTracking.set(group.trackingLast8, arr);
  }

  // Build unified entries list sorted by date (newest first)
  const entries: ScanEntry[] = [];

  for (const group of groupedScans) {
    const latestScan = group.scans[0];
    entries.push({
      source: "scan",
      trackingLast8: group.tracking_last8,
      date: latestScan.scanned_at,
      scanIds: group.scans.map(s => s.id),
      scannedBy: latestScan.scanned_by,
      notes: latestScan.notes,
      resolutionState: latestScan.resolution_state,
      scanCount: group.scans.length,
      matchedOrders: (() => {
        const seen = new Set<string>();
        return group.scans.flatMap(s => s.matchedOrders).filter(o => {
          if (seen.has(o.orderId)) return false;
          seen.add(o.orderId);
          return true;
        });
      })()
    });
  }

  for (const [tl8, orders] of importGroupsByTracking) {
    entries.push({
      source: "import",
      trackingLast8: tl8,
      date: orders[0].receivedAt,
      matchedOrders: orders.map(o => ({
        orderId: o.orderId,
        shipmentId: o.shipmentId,
        items: o.items,
        checkedIn: o.checkedIn,
        expectedUnits: o.expectedUnits,
        scannedUnits: o.scannedUnits,
        scanStatus: o.scanStatus,
        isLot: o.isLot,
        lotSize: o.lotSize,
        orderQty: o.orderQty,
        receivedUnits: o.receivedUnits
      }))
    });
  }

  entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <div className="space-y-6">
      <PageHeader title="Receiving">
        <Link href="/receiving/import" className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">
          Import CSV
        </Link>
      </PageHeader>
      <div className="flex items-center justify-between">
        <DateRangeFilter />
        <span className="text-sm text-slate-400">{enrichedScans.length} scans · {importGroupsByOrder.size} imported</span>
      </div>
      <ReceivingForm />
      <ScanList entries={entries} />
    </div>
  );
}
