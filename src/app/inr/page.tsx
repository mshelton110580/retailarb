import PageHeader from "@/components/page-header";
import SyncReturnsButton from "@/components/sync-returns-button";
import { prisma } from "@/lib/db";
import Link from "next/link";
import INRAction from "./inr-action";

export default async function INRPage() {
  // Fetch INR cases from database (both synced from eBay and manually filed)
  const inrCases = await prisma.inr_cases.findMany({
    include: {
      order: { include: { order_items: true } },
      listing: { select: { title: true } },
    },
    orderBy: { created_at: "desc" },
  });

  // Also fetch late/not-delivered shipments that don't have INR cases yet
  const lateShipments = await prisma.shipments.findMany({
    where: {
      derived_status: { in: ["late", "not_delivered"] },
      order: {
        inr_cases: { none: {} },
      },
    },
    include: {
      order: { include: { order_items: true } },
      tracking_numbers: true,
    },
    orderBy: { last_refreshed_at: "desc" },
  });

  const statusColors: Record<string, string> = {
    OPEN: "bg-yellow-900 text-yellow-300",
    ON_HOLD: "bg-orange-900 text-orange-300",
    CLOSED: "bg-slate-700 text-slate-300",
    WAITING_FOR_SELLER_RESPONSE: "bg-red-900 text-red-300",
    WAITING_FOR_BUYER_RESPONSE: "bg-blue-900 text-blue-300",
    ESCALATED: "bg-red-900 text-red-300",
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Item Not Received (INR)">
        <SyncReturnsButton />
      </PageHeader>

      {/* Summary */}
      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className="text-sm text-slate-400">Total INR Cases</p>
          <p className="mt-1 text-2xl font-semibold">{inrCases.length}</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className="text-sm text-yellow-400">Open</p>
          <p className="mt-1 text-2xl font-semibold">
            {inrCases.filter((c) =>
              c.ebay_status && !["CLOSED"].includes(c.ebay_status)
            ).length}
          </p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className="text-sm text-red-400">Escalated to Case</p>
          <p className="mt-1 text-2xl font-semibold">
            {inrCases.filter((c) => c.escalated_to_case).length}
          </p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className="text-sm text-amber-400">Late Shipments (No INR)</p>
          <p className="mt-1 text-2xl font-semibold">{lateShipments.length}</p>
        </div>
      </div>

      {/* Synced INR Cases */}
      <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-lg font-semibold mb-3">INR Cases</h2>
        <div className="space-y-3 text-sm text-slate-300">
          {inrCases.length === 0 ? (
            <p className="text-slate-500">No INR cases found. Click "Sync Returns & INR from eBay" to fetch data.</p>
          ) : (
            inrCases.map((inr) => {
              const orderItems = inr.order?.order_items ?? [];
              const matchedItem = orderItems.find((i) => i.item_id === inr.item_id);
              const displayTitle = inr.listing?.title ?? matchedItem?.title ?? `Item ${inr.item_id ?? "Unknown"}`;

              return (
                <div key={inr.id} className="rounded border border-slate-800 p-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      {/* Status badges */}
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        {inr.ebay_inquiry_id && (
                          <span className="rounded bg-amber-900 px-2 py-0.5 text-xs text-amber-300">
                            eBay Inquiry #{inr.ebay_inquiry_id}
                          </span>
                        )}
                        <span className={`rounded px-2 py-0.5 text-xs ${
                          statusColors[inr.ebay_status ?? ""] ?? "bg-slate-700 text-slate-300"
                        }`}>
                          {inr.ebay_status ?? inr.status_text ?? "Unknown"}
                        </span>
                        {inr.escalated_to_case && (
                          <span className="rounded bg-red-900 px-2 py-0.5 text-xs text-red-300">
                            ESCALATED {inr.case_id ? `(Case ${inr.case_id})` : ""}
                          </span>
                        )}
                      </div>

                      {/* Item info with eBay link */}
                      {inr.item_id && (
                        <div className="flex items-center gap-2 mb-1">
                          <a
                            href={`https://www.ebay.com/itm/${inr.item_id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-400 hover:text-blue-300 hover:underline truncate max-w-[400px]"
                          >
                            {displayTitle}
                          </a>
                          <a
                            href={`https://www.ebay.com/itm/${inr.item_id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-slate-500 hover:text-blue-400 flex-shrink-0"
                            title="Open item on eBay"
                          >
                            ↗
                          </a>
                        </div>
                      )}

                      {/* Order link */}
                      <div className="flex items-center gap-3 text-xs text-slate-400">
                        <Link href={`/orders/${inr.order_id}`} className="text-blue-400 hover:underline">
                          Order {inr.order_id}
                        </Link>
                        {inr.order?.order_url && (
                          <a
                            href={inr.order.order_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-slate-500 hover:text-blue-400"
                          >
                            eBay Order ↗
                          </a>
                        )}
                      </div>

                      {/* Details */}
                      <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
                        {inr.buyer_login_name && <span>Buyer: {inr.buyer_login_name}</span>}
                        {inr.claim_amount && (
                          <span className="text-yellow-400">
                            Claim: ${Number(inr.claim_amount).toFixed(2)} {inr.claim_currency ?? ""}
                          </span>
                        )}
                        {inr.creation_date && (
                          <span>Created: {inr.creation_date.toISOString().slice(0, 10)}</span>
                        )}
                        {inr.respond_by_date && (
                          <span className="text-orange-400">
                            Respond by: {inr.respond_by_date.toISOString().slice(0, 10)}
                          </span>
                        )}
                        {inr.last_synced_at && (
                          <span>Synced: {inr.last_synced_at.toISOString().slice(0, 16).replace("T", " ")}</span>
                        )}
                      </div>

                      {inr.notes && (
                        <p className="mt-1 text-xs text-slate-500 italic">Notes: {inr.notes}</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* Late Shipments Without INR */}
      {lateShipments.length > 0 && (
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h2 className="text-lg font-semibold mb-3">Late Shipments — Consider Filing INR</h2>
          <p className="text-xs text-slate-500 mb-3">
            These shipments are late or not delivered and don't have an INR case yet.
          </p>
          <div className="space-y-3 text-sm text-slate-300">
            {lateShipments.map((shipment) => (
              <div key={shipment.id} className="rounded border border-slate-800 p-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="rounded bg-amber-900 px-2 py-0.5 text-xs text-amber-300">
                        {shipment.derived_status}
                      </span>
                    </div>

                    {/* Order items with eBay links */}
                    {shipment.order?.order_items?.map((item) => (
                      <div key={item.id} className="flex items-center gap-2 text-xs mb-1">
                        <a
                          href={`https://www.ebay.com/itm/${item.item_id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-400 hover:text-blue-300 hover:underline truncate max-w-[400px]"
                        >
                          {item.title}
                        </a>
                        <span className="text-slate-500">x{item.qty}</span>
                        <a
                          href={`https://www.ebay.com/itm/${item.item_id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-slate-500 hover:text-blue-400"
                          title="Open item on eBay"
                        >
                          ↗
                        </a>
                      </div>
                    ))}

                    <div className="flex items-center gap-3 text-xs text-slate-400 mt-1">
                      <Link href={`/orders/${shipment.order_id}`} className="text-blue-400 hover:underline">
                        Order {shipment.order_id}
                      </Link>
                      {shipment.order?.order_url && (
                        <a
                          href={shipment.order.order_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-slate-500 hover:text-blue-400"
                        >
                          eBay Order ↗
                        </a>
                      )}
                      {shipment.tracking_numbers?.map((tn) => (
                        <span key={tn.id} className="text-slate-500">
                          {tn.carrier}: {tn.tracking_number}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                <INRAction orderId={shipment.order_id} />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
