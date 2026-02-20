"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";

type Account = { id: string; ebay_username: string | null };

type OrderItem = {
  itemId: string;
  title: string;
  qty: number;
  price: number;
};

type TrackingNumber = {
  number: string;
  carrier: string | null;
};

type Shipment = {
  derivedStatus: string;
  deliveredAt: string | null;
  checkedInAt: string | null;
  expectedUnits: number;
  scannedUnits: number;
  scanStatus: string;
  isLot: boolean;
  trackingNumbers: TrackingNumber[];
};

type Order = {
  orderId: string;
  purchaseDate: string;
  orderStatus: string;
  originalTotal: number | null;
  subtotal: number | null;
  shippingCost: number | null;
  taxAmount: number | null;
  currentTotal: number | null;
  hasRefund: boolean;
  shipToCity: string | null;
  shipToState: string | null;
  shipToPostal: string | null;
  orderUrl: string;
  ebayAccountId: string;
  ebayUsername: string | null;
  items: OrderItem[];
  shipment: Shipment | null;
};

const SHIP_STATUSES = [
  { value: "delivered", label: "Delivered" },
  { value: "shipped", label: "Shipped" },
  { value: "pre_shipment", label: "Pre-Shipment" },
  { value: "pending", label: "Pending" },
  { value: "late", label: "Late" },
  { value: "not_delivered", label: "Not Delivered" },
  { value: "not_received", label: "Never Shipped" },
  { value: "canceled", label: "Canceled" },
];

const ORDER_STATUSES = [
  "Complete", "Active", "Cancelled", "Invalid", "InProcess", "Shipped",
];

const SORT_FIELDS = [
  { value: "purchaseDate", label: "Purchase Date" },
  { value: "total", label: "Total" },
  { value: "status", label: "Order Status" },
];

const shipStatusColor: Record<string, string> = {
  delivered: "bg-green-900 text-green-300",
  shipped: "bg-blue-900 text-blue-300",
  pre_shipment: "bg-yellow-900 text-yellow-300",
  pending: "bg-gray-700 text-gray-300",
  late: "bg-orange-900 text-orange-300",
  not_delivered: "bg-red-900 text-red-300",
  not_received: "bg-rose-900 text-rose-300",
  canceled: "bg-red-950 text-red-400",
};

function fmt$(n: number | null | undefined) {
  if (n == null) return "—";
  return `$${n.toFixed(2)}`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString();
}

export default function OrderSearch({ accounts }: { accounts: Account[] }) {
  // Search & filter state
  const [search, setSearch] = useState("");
  const [trackingScan, setTrackingScan] = useState("");
  const [filterShipStatus, setFilterShipStatus] = useState<string[]>([]);
  const [filterOrderStatus, setFilterOrderStatus] = useState<string[]>([]);
  const [filterCheckedIn, setFilterCheckedIn] = useState("");
  const [filterAccountId, setFilterAccountId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortBy, setSortBy] = useState("purchaseDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Data state
  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;

  // Expanded rows
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const trackingRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchOrders = useCallback(async (resetOffset = false) => {
    setLoading(true);
    const currentOffset = resetOffset ? 0 : offset;
    if (resetOffset) setOffset(0);

    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (trackingScan) params.set("tracking", trackingScan);
    if (filterShipStatus.length) params.set("shipStatus", filterShipStatus.join(","));
    if (filterOrderStatus.length) params.set("status", filterOrderStatus.join(","));
    if (filterCheckedIn) params.set("checkedIn", filterCheckedIn);
    if (filterAccountId) params.set("accountId", filterAccountId);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    params.set("sortBy", sortBy);
    params.set("sortDir", sortDir);
    params.set("limit", String(LIMIT));
    params.set("offset", String(currentOffset));

    try {
      const res = await fetch(`/api/orders/search?${params}`);
      const data = await res.json();
      setOrders(data.orders ?? []);
      setTotal(data.total ?? 0);
    } catch {
      // silently fail — loading state will clear
    } finally {
      setLoading(false);
    }
  }, [search, trackingScan, filterShipStatus, filterOrderStatus, filterCheckedIn, filterAccountId, dateFrom, dateTo, sortBy, sortDir, offset]);

  // Debounced search on text input changes
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchOrders(true);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, trackingScan, filterShipStatus, filterOrderStatus, filterCheckedIn, filterAccountId, dateFrom, dateTo, sortBy, sortDir]);

  useEffect(() => {
    if (offset > 0) fetchOrders(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset]);

  // Initial load
  useEffect(() => {
    fetchOrders(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleShipStatus(val: string) {
    setFilterShipStatus(prev => prev.includes(val) ? prev.filter(s => s !== val) : [...prev, val]);
  }
  function toggleOrderStatus(val: string) {
    setFilterOrderStatus(prev => prev.includes(val) ? prev.filter(s => s !== val) : [...prev, val]);
  }
  function toggleSort(field: string) {
    if (sortBy === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortBy(field); setSortDir("desc"); }
  }
  function toggleExpand(orderId: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(orderId) ? next.delete(orderId) : next.add(orderId);
      return next;
    });
  }
  function handleTrackingKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") setTrackingScan((e.target as HTMLInputElement).value.trim());
  }

  const SortIcon = ({ field }: { field: string }) =>
    sortBy !== field ? <span className="ml-1 text-slate-600">↕</span>
    : <span className="ml-1 text-blue-400">{sortDir === "asc" ? "↑" : "↓"}</span>;

  return (
    <div className="space-y-4">
      {/* ── Filters ── */}
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-4 space-y-4">

        {/* Row 1: Global search + tracking scan */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-slate-500">Search (order, item ID, title, tracking, account)</label>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Type to search…"
              className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-600"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">Tracking scan (barcode or last digits)</label>
            <div className="flex gap-2">
              <input
                ref={trackingRef}
                type="text"
                placeholder="Scan or type tracking…"
                onKeyDown={handleTrackingKey}
                className="flex-1 rounded border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-600"
              />
              <button
                onClick={() => {
                  const val = trackingRef.current?.value.trim() ?? "";
                  setTrackingScan(val);
                }}
                className="rounded bg-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-600"
              >
                Find
              </button>
              {trackingScan && (
                <button
                  onClick={() => { setTrackingScan(""); if (trackingRef.current) trackingRef.current.value = ""; }}
                  className="rounded bg-slate-800 px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-700"
                >
                  ×
                </button>
              )}
            </div>
            {trackingScan && (
              <p className="mt-1 text-xs text-blue-400">Filtering by tracking: …{trackingScan.slice(-12)}</p>
            )}
          </div>
        </div>

        {/* Row 2: Date range + account + checked-in */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="mb-1 block text-xs text-slate-500">From</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-300 focus:outline-none focus:border-blue-600" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">To</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-300 focus:outline-none focus:border-blue-600" />
          </div>
          {accounts.length > 1 && (
            <div>
              <label className="mb-1 block text-xs text-slate-500">eBay Account</label>
              <select value={filterAccountId} onChange={e => setFilterAccountId(e.target.value)}
                className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-300 focus:outline-none">
                <option value="">All accounts</option>
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>{a.ebay_username ?? a.id}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs text-slate-500">Check-in</label>
            <select value={filterCheckedIn} onChange={e => setFilterCheckedIn(e.target.value)}
              className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-300 focus:outline-none">
              <option value="">Any</option>
              <option value="yes">Checked in</option>
              <option value="no">Not checked in</option>
            </select>
          </div>
        </div>

        {/* Row 3: Shipment status chips */}
        <div>
          <p className="mb-1.5 text-xs text-slate-500">Shipment status</p>
          <div className="flex flex-wrap gap-1.5">
            {SHIP_STATUSES.map(s => (
              <button
                key={s.value}
                onClick={() => toggleShipStatus(s.value)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  filterShipStatus.includes(s.value)
                    ? (shipStatusColor[s.value] ?? "bg-blue-700 text-blue-100")
                    : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Row 4: Order status chips */}
        <div>
          <p className="mb-1.5 text-xs text-slate-500">eBay order status</p>
          <div className="flex flex-wrap gap-1.5">
            {ORDER_STATUSES.map(s => (
              <button
                key={s}
                onClick={() => toggleOrderStatus(s)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  filterOrderStatus.includes(s)
                    ? "bg-blue-700 text-blue-100"
                    : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Row 5: Sort + clear */}
        <div className="flex items-center justify-between gap-3 flex-wrap border-t border-slate-800 pt-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Sort:</span>
            {SORT_FIELDS.map(f => (
              <button
                key={f.value}
                onClick={() => toggleSort(f.value)}
                className={`rounded px-2 py-1 text-xs transition-colors ${
                  sortBy === f.value ? "bg-blue-900 text-blue-300" : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                }`}
              >
                {f.label}<SortIcon field={f.value} />
              </button>
            ))}
          </div>
          <button
            onClick={() => {
              setSearch(""); setTrackingScan(""); setFilterShipStatus([]); setFilterOrderStatus([]);
              setFilterCheckedIn(""); setFilterAccountId(""); setDateFrom(""); setDateTo("");
              setSortBy("purchaseDate"); setSortDir("desc");
              if (trackingRef.current) trackingRef.current.value = "";
            }}
            className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-400 hover:bg-slate-800"
          >
            Clear all filters
          </button>
        </div>
      </div>

      {/* ── Results header ── */}
      <div className="flex items-center justify-between text-sm text-slate-400">
        <span>
          {loading ? "Searching…" : `${total} order${total !== 1 ? "s" : ""}`}
          {(search || trackingScan || filterShipStatus.length || filterOrderStatus.length || filterCheckedIn || filterAccountId || dateFrom || dateTo) && " (filtered)"}
        </span>
        <span className="text-xs text-slate-600">Showing {offset + 1}–{Math.min(offset + LIMIT, total)} of {total}</span>
      </div>

      {/* ── Results table ── */}
      <div className="rounded-lg border border-slate-800 bg-slate-900 overflow-hidden">
        {orders.length === 0 && !loading ? (
          <p className="p-6 text-sm text-slate-500 text-center">No orders match your filters.</p>
        ) : (
          <div className="divide-y divide-slate-800">
            {orders.map(order => {
              const isExpanded = expanded.has(order.orderId);
              const shipment = order.shipment;
              const totalItems = order.items.reduce((s, i) => s + i.qty, 0);

              return (
                <div key={order.orderId} className={`transition-colors ${isExpanded ? "bg-slate-850" : "hover:bg-slate-800/50"}`}>
                  {/* ── Main row ── */}
                  <div
                    className="flex items-center gap-3 px-4 py-3 cursor-pointer"
                    onClick={() => toggleExpand(order.orderId)}
                  >
                    {/* Expand caret */}
                    <span className="text-slate-600 text-xs w-3 flex-shrink-0">{isExpanded ? "▼" : "▶"}</span>

                    {/* Order ID */}
                    <div className="w-40 flex-shrink-0">
                      <Link
                        href={`/orders/${order.orderId}`}
                        className="text-xs font-mono text-blue-400 hover:underline"
                        onClick={e => e.stopPropagation()}
                      >
                        {order.orderId}
                      </Link>
                    </div>

                    {/* Date */}
                    <div className="w-24 flex-shrink-0 text-xs text-slate-400">
                      {fmtDate(order.purchaseDate)}
                    </div>

                    {/* Account */}
                    {accounts.length > 1 && (
                      <div className="w-28 flex-shrink-0 text-xs text-slate-500 truncate" title={order.ebayUsername ?? ""}>
                        {order.ebayUsername ?? "—"}
                      </div>
                    )}

                    {/* Items summary */}
                    <div className="flex-1 min-w-0">
                      <div className="truncate text-xs text-slate-300" title={order.items.map(i => i.title).join("; ")}>
                        {order.items.length === 0 ? "—"
                          : order.items.length === 1
                            ? <>{order.items[0].title}{order.items[0].qty > 1 ? <span className="ml-1 text-slate-500">×{order.items[0].qty}</span> : null}</>
                            : <>{order.items[0].title} <span className="text-slate-500">+{order.items.length - 1} more ({totalItems} units)</span></>
                        }
                      </div>
                    </div>

                    {/* Total */}
                    <div className="w-24 flex-shrink-0 text-right">
                      <span className={`text-xs font-medium ${order.hasRefund ? "text-amber-400" : "text-slate-200"}`}>
                        {fmt$(order.originalTotal)}
                      </span>
                      {order.hasRefund && <span className="ml-1 text-amber-500 text-xs">⚠</span>}
                    </div>

                    {/* Ship status */}
                    <div className="w-28 flex-shrink-0">
                      {shipment ? (
                        <span className={`inline-block rounded px-2 py-0.5 text-[10px] font-medium ${shipStatusColor[shipment.derivedStatus] ?? "bg-slate-700 text-slate-300"}`}>
                          {shipment.derivedStatus.replace(/_/g, " ")}
                        </span>
                      ) : <span className="text-xs text-slate-600">—</span>}
                    </div>

                    {/* Check-in */}
                    <div className="w-24 flex-shrink-0">
                      <span className={`inline-block rounded px-2 py-0.5 text-[10px] font-medium ${shipment?.checkedInAt ? "bg-emerald-900 text-emerald-300" : "bg-slate-800 text-slate-500"}`}>
                        {shipment?.checkedInAt ? `✓ ${new Date(shipment.checkedInAt).toLocaleDateString()}` : "Not in"}
                      </span>
                    </div>

                    {/* eBay link */}
                    <a
                      href={order.orderUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="flex-shrink-0 text-xs text-slate-600 hover:text-blue-400"
                      title="View on eBay"
                    >
                      ↗
                    </a>
                  </div>

                  {/* ── Expanded detail ── */}
                  {isExpanded && (
                    <div className="border-t border-slate-800 bg-slate-950/50 px-4 py-3 space-y-3">
                      {/* Item list */}
                      <div>
                        <p className="mb-1.5 text-[10px] uppercase tracking-widest text-slate-600">Items</p>
                        <div className="space-y-1">
                          {order.items.map((item, i) => (
                            <div key={i} className="flex items-center gap-2 text-xs">
                              <a
                                href={`https://www.ebay.com/itm/${item.itemId}`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-blue-400 hover:underline truncate max-w-[480px]"
                                title={item.title}
                              >
                                {item.title}
                              </a>
                              <span className="text-slate-500 flex-shrink-0">×{item.qty}</span>
                              <span className="text-slate-400 flex-shrink-0">{fmt$(item.price)}</span>
                              <span className="text-slate-600 flex-shrink-0 font-mono text-[10px]">{item.itemId}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Order financials */}
                      <div className="flex flex-wrap gap-4 text-xs">
                        <div>
                          <span className="text-slate-500">Subtotal </span>
                          <span className="text-slate-300">{fmt$(order.subtotal)}</span>
                        </div>
                        {(order.shippingCost ?? 0) > 0 ? (
                          <div><span className="text-slate-500">Shipping </span><span className="text-slate-300">{fmt$(order.shippingCost)}</span></div>
                        ) : (
                          <span className="text-emerald-400">✓ Free shipping</span>
                        )}
                        {(order.taxAmount ?? 0) > 0 && (
                          <div><span className="text-slate-500">Tax </span><span className="text-slate-300">{fmt$(order.taxAmount)}</span></div>
                        )}
                        <div><span className="text-slate-500">Order Total </span><span className="font-medium text-slate-200">{fmt$(order.originalTotal)}</span></div>
                        {order.hasRefund && (
                          <div><span className="text-slate-500">Current </span><span className="text-amber-400">{fmt$(order.currentTotal)} ⚠ refund</span></div>
                        )}
                        {order.shipToState && (
                          <div><span className="text-slate-500">Ship to </span><span className="text-slate-400">{[order.shipToCity, order.shipToState, order.shipToPostal].filter(Boolean).join(", ")}</span></div>
                        )}
                        <div><span className="text-slate-500">eBay status </span><span className="text-slate-400">{order.orderStatus}</span></div>
                        {order.ebayUsername && accounts.length > 1 && (
                          <div><span className="text-slate-500">Account </span><span className="text-slate-400">{order.ebayUsername}</span></div>
                        )}
                      </div>

                      {/* Tracking */}
                      {shipment && shipment.trackingNumbers.length > 0 && (
                        <div>
                          <p className="mb-1 text-[10px] uppercase tracking-widest text-slate-600">Tracking</p>
                          <div className="flex flex-wrap gap-3">
                            {shipment.trackingNumbers.map((t, i) => (
                              <span key={i} className="text-xs font-mono text-slate-400">
                                {t.carrier && <span className="text-slate-600 mr-1">{t.carrier}</span>}
                                {t.number}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Shipment details */}
                      {shipment && (
                        <div className="flex flex-wrap gap-4 text-xs">
                          {shipment.deliveredAt && (
                            <div><span className="text-slate-500">Delivered </span><span className="text-slate-300">{fmtDate(shipment.deliveredAt)}</span></div>
                          )}
                          <div>
                            <span className="text-slate-500">Scan </span>
                            <span className="text-slate-400">{shipment.scannedUnits}/{shipment.expectedUnits} units · {shipment.scanStatus}</span>
                          </div>
                        </div>
                      )}

                      {/* Action links */}
                      <div className="flex gap-3 pt-1">
                        <Link
                          href={`/orders/${order.orderId}`}
                          className="rounded bg-slate-800 px-3 py-1 text-xs text-slate-300 hover:bg-slate-700 transition-colors"
                        >
                          Order details →
                        </Link>
                        <a
                          href={order.orderUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded bg-slate-800 px-3 py-1 text-xs text-slate-300 hover:bg-slate-700 transition-colors"
                        >
                          View on eBay ↗
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Pagination ── */}
      {total > LIMIT && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-xs text-slate-500">Page {Math.floor(offset / LIMIT) + 1} of {Math.ceil(total / LIMIT)}</span>
          <div className="flex gap-2">
            <button onClick={() => setOffset(Math.max(0, offset - LIMIT))} disabled={offset === 0 || loading}
              className="rounded border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-800 disabled:opacity-40">Previous</button>
            <button onClick={() => setOffset(offset + LIMIT)} disabled={offset + LIMIT >= total || loading}
              className="rounded border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-800 disabled:opacity-40">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
