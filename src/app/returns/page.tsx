import PageHeader from "@/components/page-header";
import SyncReturnsButton from "@/components/sync-returns-button";
import { prisma } from "@/lib/db";
import Link from "next/link";
import ReturnActions from "./return-actions";

export default async function ReturnsPage() {
  const returns = await prisma.returns.findMany({
    include: {
      order: { include: { order_items: true } },
      listing: { select: { title: true } },
    },
    orderBy: { created_at: "desc" },
  });

  const stateColors: Record<string, string> = {
    RETURN_STARTED: "bg-yellow-900 text-yellow-300",
    RETURN_DELIVERED: "bg-blue-900 text-blue-300",
    REFUND_ISSUED: "bg-green-900 text-green-300",
    RETURN_CLOSED: "bg-slate-700 text-slate-300",
    RETURN_ESCALATED: "bg-red-900 text-red-300",
    RETURN_REQUESTED: "bg-orange-900 text-orange-300",
    RETURN_SHIPPED: "bg-cyan-900 text-cyan-300",
    PENDING: "bg-slate-700 text-slate-300",
    ACTIVE: "bg-yellow-900 text-yellow-300",
    COMPLETE: "bg-green-900 text-green-300",
    FAILED: "bg-red-900 text-red-300",
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Returns">
        <SyncReturnsButton />
      </PageHeader>

      {/* Summary */}
      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className="text-sm text-slate-400">Total Returns</p>
          <p className="mt-1 text-2xl font-semibold">{returns.length}</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className="text-sm text-yellow-400">Open / Active</p>
          <p className="mt-1 text-2xl font-semibold">
            {returns.filter((r) =>
              r.ebay_state && !["RETURN_CLOSED", "REFUND_ISSUED"].includes(r.ebay_state)
            ).length}
          </p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className="text-sm text-green-400">Refunded</p>
          <p className="mt-1 text-2xl font-semibold">
            {returns.filter((r) => r.ebay_state === "REFUND_ISSUED").length}
          </p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className="text-sm text-red-400">Escalated</p>
          <p className="mt-1 text-2xl font-semibold">
            {returns.filter((r) => r.escalated).length}
          </p>
        </div>
      </div>

      {/* Returns List */}
      <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-lg font-semibold mb-3">All Returns</h2>
        <div className="space-y-3 text-sm text-slate-300">
          {returns.length === 0 ? (
            <p className="text-slate-500">No returns found. Click "Sync Returns & INR from eBay" to fetch data.</p>
          ) : (
            returns.map((ret) => {
              const orderItems = ret.order?.order_items ?? [];
              const matchedItem = orderItems.find((i) => i.item_id === ret.item_id);
              const displayTitle = ret.listing?.title ?? matchedItem?.title ?? `Item ${ret.item_id ?? "Unknown"}`;

              return (
                <div key={ret.id} className="rounded border border-slate-800 p-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      {/* Status badges */}
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        {ret.ebay_return_id && (
                          <span className="rounded bg-purple-900 px-2 py-0.5 text-xs text-purple-300">
                            eBay #{ret.ebay_return_id}
                          </span>
                        )}
                        <span className={`rounded px-2 py-0.5 text-xs ${
                          stateColors[ret.ebay_state ?? ret.scrape_state] ?? "bg-slate-700 text-slate-300"
                        }`}>
                          {ret.ebay_state ?? ret.scrape_state}
                        </span>
                        {ret.ebay_type && (
                          <span className="rounded bg-slate-700 px-2 py-0.5 text-xs text-slate-300">
                            {ret.ebay_type}
                          </span>
                        )}
                        {ret.escalated && (
                          <span className="rounded bg-red-900 px-2 py-0.5 text-xs text-red-300">ESCALATED</span>
                        )}
                      </div>

                      {/* Item info with eBay link */}
                      {ret.item_id && (
                        <div className="flex items-center gap-2 mb-1">
                          <a
                            href={`https://www.ebay.com/itm/${ret.item_id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-400 hover:text-blue-300 hover:underline truncate max-w-[400px]"
                          >
                            {displayTitle}
                          </a>
                          <a
                            href={`https://www.ebay.com/itm/${ret.item_id}`}
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
                        <Link href={`/orders/${ret.order_id}`} className="text-blue-400 hover:underline">
                          Order {ret.order_id}
                        </Link>
                        <a
                          href={ret.order?.order_url ?? "#"}
                          target="_blank"
                          rel="noreferrer"
                          className="text-slate-500 hover:text-blue-400"
                        >
                          eBay Order ↗
                        </a>
                      </div>

                      {/* Details */}
                      <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
                        {ret.return_reason && <span>Reason: {ret.return_reason}</span>}
                        {ret.buyer_login_name && <span>Buyer: {ret.buyer_login_name}</span>}
                        {ret.refund_amount && (
                          <span className="text-yellow-400">
                            Refund: ${Number(ret.refund_amount).toFixed(2)} {ret.refund_currency ?? ""}
                          </span>
                        )}
                        {ret.creation_date && (
                          <span>Created: {ret.creation_date.toISOString().slice(0, 10)}</span>
                        )}
                        {ret.respond_by_date && (
                          <span className="text-orange-400">
                            Respond by: {ret.respond_by_date.toISOString().slice(0, 10)}
                          </span>
                        )}
                        {ret.last_synced_at && (
                          <span>Synced: {ret.last_synced_at.toISOString().slice(0, 16).replace("T", " ")}</span>
                        )}
                      </div>

                      {ret.notes && (
                        <p className="mt-1 text-xs text-slate-500 italic">Notes: {ret.notes}</p>
                      )}
                    </div>
                  </div>

                  {/* Actions for manual returns */}
                  {!ret.ebay_return_id && <ReturnActions returnId={ret.id} />}
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
