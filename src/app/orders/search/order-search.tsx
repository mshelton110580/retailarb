"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
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

type ReturnCase = {
  id: string;
  ebayReturnId: string;
  state: string | null;
  status: string | null;
  escalated: boolean;
  refundAmount: number | null;
  url: string;
};

type InrCase = {
  id: string;
  ebayInquiryId: string;
  status: string | null;
  escalatedToCase: boolean;
  caseId: string | null;
  claimAmount: number | null;
  url: string;
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
  needsReturn: boolean;
  shipToCity: string | null;
  shipToState: string | null;
  shipToPostal: string | null;
  orderUrl: string;
  ebayAccountId: string;
  ebayUsername: string | null;
  items: OrderItem[];
  shipment: Shipment | null;
  returnCase: ReturnCase | null;
  inrCase: InrCase | null;
};

// ── Column definitions ─────────────────────────────────────────────────────

type ColKey =
  | "orderId"
  | "date"
  | "account"
  | "item"
  | "itemId"
  | "qty"
  | "price"
  | "total"
  | "shipStatus"
  | "checkedIn"
  | "returnCase"
  | "inrCase"
  | "escalated";

// Which columns trigger a server-side re-fetch vs. client-side sort
type SortMode = "server" | "client";

// Map from ColKey to the sortBy param value sent to the API (server-sort cols only)
const SERVER_SORT_KEY: Partial<Record<ColKey, string>> = {
  date:  "purchaseDate",
  total: "total",
};

type ColDef = {
  key: ColKey;
  label: string;
  defaultOn: boolean;
  itemsOnly?: boolean;
  sortMode: SortMode;
  // For client sort: how to extract a comparable primitive from an Order (or ItemRow)
  sortValue?: (order: Order, itemRow?: ItemRow) => string | number | boolean | null;
};

const ALL_COLS: ColDef[] = [
  {
    key: "orderId", label: "Order #", defaultOn: true, sortMode: "client",
    sortValue: o => o.orderId,
  },
  {
    key: "date", label: "Date", defaultOn: true, sortMode: "server",
  },
  {
    key: "account", label: "Account", defaultOn: true, sortMode: "client",
    sortValue: o => o.ebayUsername ?? "",
  },
  {
    key: "item", label: "Item / Title", defaultOn: true, sortMode: "client",
    sortValue: (o, row) => row ? row.title : (o.items[0]?.title ?? ""),
  },
  {
    key: "itemId", label: "Item ID", defaultOn: true, itemsOnly: true, sortMode: "client",
    sortValue: (_o, row) => row?.itemId ?? "",
  },
  {
    key: "qty", label: "Qty", defaultOn: true, itemsOnly: true, sortMode: "client",
    sortValue: (_o, row) => row?.qty ?? 0,
  },
  {
    key: "price", label: "Price", defaultOn: true, itemsOnly: true, sortMode: "client",
    sortValue: (_o, row) => row?.price ?? 0,
  },
  {
    key: "total", label: "Order Total", defaultOn: true, sortMode: "server",
  },
  {
    key: "shipStatus", label: "Ship Status", defaultOn: true, sortMode: "client",
    sortValue: o => o.shipment?.derivedStatus ?? "",
  },
  {
    key: "checkedIn", label: "Check-in", defaultOn: true, sortMode: "client",
    sortValue: o => o.shipment?.checkedInAt ? 1 : 0,
  },
  {
    key: "returnCase", label: "Return", defaultOn: true, sortMode: "client",
    sortValue: o => o.returnCase ? (o.returnCase.escalated ? 2 : 1) : 0,
  },
  {
    key: "inrCase", label: "INR", defaultOn: true, sortMode: "client",
    sortValue: o => o.inrCase ? (o.inrCase.escalatedToCase ? 2 : 1) : 0,
  },
  {
    key: "escalated", label: "Escalated", defaultOn: false, sortMode: "client",
    sortValue: o => (o.returnCase?.escalated || o.inrCase?.escalatedToCase) ? 1 : 0,
  },
];

const DEFAULT_ON = new Set(ALL_COLS.filter(c => c.defaultOn).map(c => c.key));

// ── Misc constants ──────────────────────────────────────────────────────────

const SHIP_STATUSES = [
  { value: "delivered",     label: "Delivered" },
  { value: "shipped",       label: "Shipped" },
  { value: "not_delivered", label: "Not Delivered" },
  { value: "not_received",  label: "Never Shipped" },
];

const ORDER_STATUSES = [
  "Completed", "Cancelled",
];

const shipStatusColor: Record<string, string> = {
  delivered:     "bg-green-900 text-green-300",
  shipped:       "bg-blue-900 text-blue-300",
  not_delivered: "bg-red-900 text-red-300",
  not_received:  "bg-rose-900 text-rose-300",
};

function fmt$(n: number | null | undefined) {
  if (n == null) return "—";
  return `$${n.toFixed(2)}`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString();
}

type GroupBy = "items" | "orders";

type ItemRow = {
  key: string;
  itemId: string;
  title: string;
  qty: number;
  price: number;
  order: Order;
};

// ── Return/INR badge helpers ────────────────────────────────────────────────

function ReturnBadge({ r }: { r: ReturnCase }) {
  const state = (r.state ?? r.status ?? "").replace(/_/g, " ").toLowerCase();
  const color = r.escalated
    ? "bg-red-900 text-red-300"
    : state.includes("closed") || state.includes("refund")
      ? "bg-slate-700 text-slate-400"
      : "bg-orange-900 text-orange-300";
  return (
    <a href={r.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
      title={`Return: ${r.state ?? r.status ?? "—"}${r.refundAmount != null ? ` · ${fmt$(r.refundAmount)}` : ""}`}
      className={`inline-block rounded px-2 py-0.5 text-[10px] font-medium hover:opacity-80 ${color}`}>
      {r.escalated ? "⚠ Esc" : "Return"} ↗
    </a>
  );
}

function InrBadge({ c }: { c: InrCase }) {
  const color = c.escalatedToCase
    ? "bg-red-900 text-red-300"
    : c.status === "CLOSED" || c.status === "CS_CLOSED"
      ? "bg-slate-700 text-slate-400"
      : "bg-yellow-900 text-yellow-300";
  return (
    <a href={c.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
      title={`INR: ${c.status ?? "—"}${c.claimAmount != null ? ` · ${fmt$(c.claimAmount)}` : ""}${c.escalatedToCase && c.caseId ? ` (Case ${c.caseId})` : ""}`}
      className={`inline-block rounded px-2 py-0.5 text-[10px] font-medium hover:opacity-80 ${color}`}>
      {c.escalatedToCase ? "⚠ Esc INR" : "INR"} ↗
    </a>
  );
}

function EscalatedBadge({ order }: { order: Order }) {
  const retEsc = order.returnCase?.escalated;
  const inrEsc = order.inrCase?.escalatedToCase;
  if (!retEsc && !inrEsc) return <span className="text-xs text-slate-600">—</span>;
  return (
    <span className="inline-flex gap-1 flex-wrap">
      {retEsc && (
        <a href={order.returnCase!.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
          className="inline-block rounded px-2 py-0.5 text-[10px] font-medium bg-red-900 text-red-300 hover:opacity-80">
          Return ↗
        </a>
      )}
      {inrEsc && (
        <a href={order.inrCase!.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
          className="inline-block rounded px-2 py-0.5 text-[10px] font-medium bg-red-900 text-red-300 hover:opacity-80">
          INR ↗
        </a>
      )}
    </span>
  );
}

// ── Column picker popover ───────────────────────────────────────────────────

function ColumnPicker({
  visibleCols, onChange, groupBy,
}: {
  visibleCols: Set<ColKey>;
  onChange: (cols: Set<ColKey>) => void;
  groupBy: GroupBy;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  function toggle(key: ColKey) {
    const next = new Set(visibleCols);
    next.has(key) ? next.delete(key) : next.add(key);
    onChange(next);
  }

  const filteredCols = ALL_COLS.filter(c => groupBy === "items" ? true : !c.itemsOnly);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`rounded border px-3 py-1 text-xs transition-colors ${open ? "border-blue-600 bg-slate-800 text-blue-300" : "border-slate-700 bg-slate-900 text-slate-400 hover:bg-slate-800"}`}
      >
        Columns {open ? "▲" : "▼"}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-48 rounded-lg border border-slate-700 bg-slate-900 shadow-xl p-2 space-y-0.5">
          <p className="px-2 pt-1 pb-2 text-[10px] uppercase tracking-widest text-slate-600">Visible columns</p>
          {filteredCols.map(col => (
            <label key={col.key} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-slate-800 cursor-pointer">
              <input type="checkbox" checked={visibleCols.has(col.key)} onChange={() => toggle(col.key)} className="accent-blue-500" />
              <span className="text-xs text-slate-300">{col.label}</span>
            </label>
          ))}
          <div className="border-t border-slate-800 mt-2 pt-2 px-2">
            <button
              onClick={() => onChange(new Set(ALL_COLS.filter(c => c.defaultOn).map(c => c.key)))}
              className="text-[10px] text-slate-500 hover:text-slate-300"
            >Reset to defaults</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Width classes per column ────────────────────────────────────────────────

const colWidth: Partial<Record<ColKey, string>> = {
  orderId:    "w-28 flex-shrink-0",
  date:       "w-24 flex-shrink-0",
  account:    "w-24 flex-shrink-0",
  item:       "flex-1 min-w-0",
  itemId:     "w-28 flex-shrink-0",
  qty:        "w-12 flex-shrink-0 text-right",
  price:      "w-16 flex-shrink-0 text-right",
  total:      "w-20 flex-shrink-0 text-right",
  shipStatus: "w-28 flex-shrink-0",
  checkedIn:  "w-20 flex-shrink-0",
  returnCase: "w-20 flex-shrink-0",
  inrCase:    "w-20 flex-shrink-0",
  escalated:  "w-24 flex-shrink-0",
};

// ── Persistence helpers ──────────────────────────────────────────────────────

const STORAGE_KEY = "arbdesk_search_filters";

type DatePreset = "30" | "60" | "90" | "all";

type SavedFilters = {
  groupBy: GroupBy;
  visibleCols: ColKey[];
  sortBy: string;
  sortDir: "asc" | "desc";
  clientSortCol: ColKey | null;
  clientSortDir: "asc" | "desc";
  search: string;
  filterShipStatus: string[];
  filterOrderStatus: string[];
  filterCheckedIn: string;
  filterAccountId: string;
  datePreset: DatePreset;
  dateFrom: string;
  dateTo: string;
};

const VALID_SHIP_STATUSES = new Set(SHIP_STATUSES.map(s => s.value));
const VALID_ORDER_STATUSES = new Set(ORDER_STATUSES);

function loadSaved(): Partial<SavedFilters> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: Partial<SavedFilters> = JSON.parse(raw);
    // Strip out any stale filter values that no longer exist
    if (parsed.filterShipStatus) {
      parsed.filterShipStatus = parsed.filterShipStatus.filter(v => VALID_SHIP_STATUSES.has(v));
    }
    if (parsed.filterOrderStatus) {
      parsed.filterOrderStatus = parsed.filterOrderStatus.filter(v => VALID_ORDER_STATUSES.has(v));
    }
    return parsed;
  } catch { return {}; }
}

function datePresetFrom(preset: DatePreset): string {
  if (preset === "all") return "";
  const d = new Date();
  d.setDate(d.getDate() - parseInt(preset));
  return d.toISOString().slice(0, 10);
}

// ── Main component ──────────────────────────────────────────────────────────

export default function OrderSearch({ accounts }: { accounts: Account[] }) {
  // Load persisted state once (before first render)
  const saved = useMemo(() => loadSaved(), []);

  const [groupBy, setGroupBy] = useState<GroupBy>(saved.groupBy ?? "items");
  const [visibleCols, setVisibleCols] = useState<Set<ColKey>>(
    saved.visibleCols ? new Set(saved.visibleCols) : DEFAULT_ON
  );

  // Server-sort state (triggers API refetch)
  const [sortBy, setSortBy] = useState(saved.sortBy ?? "purchaseDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">(saved.sortDir ?? "desc");

  // Client-sort state (sorts current page in-place)
  const [clientSortCol, setClientSortCol] = useState<ColKey | null>(saved.clientSortCol ?? null);
  const [clientSortDir, setClientSortDir] = useState<"asc" | "desc">(saved.clientSortDir ?? "asc");

  // Date preset — "90" means last 90 days, "all" means no date filter
  const [datePreset, setDatePreset] = useState<DatePreset>(saved.datePreset ?? "90");

  // Search & filter state
  const [search, setSearch] = useState(saved.search ?? "");
  const [trackingScan, setTrackingScan] = useState("");
  const [filterShipStatus, setFilterShipStatus] = useState<string[]>(saved.filterShipStatus ?? []);
  const [filterOrderStatus, setFilterOrderStatus] = useState<string[]>(saved.filterOrderStatus ?? []);
  const [filterCheckedIn, setFilterCheckedIn] = useState(saved.filterCheckedIn ?? "");
  const [filterAccountId, setFilterAccountId] = useState(saved.filterAccountId ?? "");
  // Manual date range — only used when datePreset is overridden by manual input
  const [dateFrom, setDateFrom] = useState(saved.datePreset === "all" || (saved.datePreset == null && !saved.dateFrom) ? "" : (saved.dateFrom ?? ""));
  const [dateTo, setDateTo] = useState(saved.dateTo ?? "");

  // Data state
  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;

  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const trackingRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Resolve effective dateFrom: preset takes priority over manual input
  const effectiveDateFrom = datePreset !== "all" ? datePresetFrom(datePreset) : dateFrom;

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
    if (effectiveDateFrom) params.set("dateFrom", effectiveDateFrom);
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
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [search, trackingScan, filterShipStatus, filterOrderStatus, filterCheckedIn, filterAccountId, effectiveDateFrom, dateTo, sortBy, sortDir, offset]);

  // Persist filter state to localStorage whenever it changes
  useEffect(() => {
    try {
      const toSave: SavedFilters = {
        groupBy, visibleCols: Array.from(visibleCols) as ColKey[],
        sortBy, sortDir, clientSortCol, clientSortDir,
        search, filterShipStatus, filterOrderStatus, filterCheckedIn, filterAccountId,
        datePreset, dateFrom, dateTo,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch { /* ignore storage errors */ }
  }, [groupBy, visibleCols, sortBy, sortDir, clientSortCol, clientSortDir, search, filterShipStatus, filterOrderStatus, filterCheckedIn, filterAccountId, datePreset, dateFrom, dateTo]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { fetchOrders(true); }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, trackingScan, filterShipStatus, filterOrderStatus, filterCheckedIn, filterAccountId, effectiveDateFrom, dateTo, sortBy, sortDir]);

  useEffect(() => {
    if (offset > 0) fetchOrders(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset]);

  useEffect(() => { fetchOrders(true); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // ── Flatten + client-sort ─────────────────────────────────────────────────

  const itemRows = useMemo<ItemRow[]>(() => {
    const rows: ItemRow[] = [];
    for (const order of orders) {
      if (order.items.length === 0) {
        rows.push({ key: `${order.orderId}-__empty`, itemId: "", title: "—", qty: 0, price: 0, order });
      } else {
        order.items.forEach((item, idx) => {
          rows.push({ key: `${order.orderId}-${item.itemId}-${idx}`, itemId: item.itemId, title: item.title, qty: item.qty, price: item.price, order });
        });
      }
    }
    return rows;
  }, [orders]);

  // Apply client-side sort to item rows
  const sortedItemRows = useMemo<ItemRow[]>(() => {
    if (!clientSortCol) return itemRows;
    const colDef = ALL_COLS.find(c => c.key === clientSortCol);
    if (!colDef?.sortValue) return itemRows;
    const dir = clientSortDir === "asc" ? 1 : -1;
    return [...itemRows].sort((a, b) => {
      const av = colDef.sortValue!(a.order, a) ?? "";
      const bv = colDef.sortValue!(b.order, b) ?? "";
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return 0;
    });
  }, [itemRows, clientSortCol, clientSortDir]);

  // Apply client-side sort to orders
  const sortedOrders = useMemo<Order[]>(() => {
    if (!clientSortCol) return orders;
    const colDef = ALL_COLS.find(c => c.key === clientSortCol);
    if (!colDef?.sortValue) return orders;
    const dir = clientSortDir === "asc" ? 1 : -1;
    return [...orders].sort((a, b) => {
      const av = colDef.sortValue!(a) ?? "";
      const bv = colDef.sortValue!(b) ?? "";
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return 0;
    });
  }, [orders, clientSortCol, clientSortDir]);

  // ── Sort handlers ─────────────────────────────────────────────────────────

  function handleColSort(col: ColDef) {
    if (col.sortMode === "server") {
      const apiKey = SERVER_SORT_KEY[col.key] ?? col.key;
      // Clear client sort
      setClientSortCol(null);
      if (sortBy === apiKey) {
        setSortDir(d => d === "asc" ? "desc" : "asc");
      } else {
        setSortBy(apiKey);
        setSortDir("desc");
      }
    } else {
      // Clear server sort indicator (keep server sort params unchanged — data doesn't reload)
      if (clientSortCol === col.key) {
        setClientSortDir(d => d === "asc" ? "desc" : "asc");
      } else {
        setClientSortCol(col.key);
        setClientSortDir("asc");
      }
    }
  }

  function getSortIcon(col: ColDef): React.ReactNode {
    if (col.sortMode === "server") {
      const apiKey = SERVER_SORT_KEY[col.key] ?? col.key;
      if (sortBy !== apiKey || clientSortCol !== null) return <span className="ml-1 text-slate-600 text-[10px]">↕</span>;
      return <span className="ml-1 text-blue-400 text-[10px]">{sortDir === "asc" ? "↑" : "↓"}</span>;
    } else {
      if (clientSortCol !== col.key) return <span className="ml-1 text-slate-600 text-[10px]">↕</span>;
      return <span className="ml-1 text-blue-400 text-[10px]">{clientSortDir === "asc" ? "↑" : "↓"}</span>;
    }
  }

  function toggleShipStatus(val: string) {
    setFilterShipStatus(prev => prev.includes(val) ? prev.filter(s => s !== val) : [...prev, val]);
  }
  function toggleOrderStatus(val: string) {
    setFilterOrderStatus(prev => prev.includes(val) ? prev.filter(s => s !== val) : [...prev, val]);
  }
  function toggleExpand(key: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }
  function handleTrackingKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") setTrackingScan((e.target as HTMLInputElement).value.trim());
  }

  const multiAccount = accounts.length > 1;

  // Columns to actually render
  const itemsCols = ALL_COLS.filter(c => {
    if (!visibleCols.has(c.key)) return false;
    if (c.key === "account" && !multiAccount) return false;
    return true;
  });

  const ordersCols = ALL_COLS.filter(c => {
    if (!visibleCols.has(c.key)) return false;
    if (c.itemsOnly) return false;
    if (c.key === "account" && !multiAccount) return false;
    return true;
  });

  // ── Cell renderers ────────────────────────────────────────────────────────

  function renderItemCell(key: ColKey, row: ItemRow) {
    const { order } = row;
    const shipment = order.shipment;
    switch (key) {
      case "orderId":
        return (
          <Link href={`/orders/${order.orderId}`} className="text-[10px] font-mono text-blue-400 hover:underline"
            onClick={e => e.stopPropagation()} title={order.orderId}>
            {order.orderId.slice(-8)}
          </Link>
        );
      case "date":
        return <span className="text-xs text-slate-500">{fmtDate(order.purchaseDate)}</span>;
      case "account":
        return <span className="text-xs text-slate-500 truncate" title={order.ebayUsername ?? ""}>{order.ebayUsername ?? "—"}</span>;
      case "item":
        return (
          <div className="min-w-0">
            {row.itemId ? (
              <a href={`https://www.ebay.com/itm/${row.itemId}`} target="_blank" rel="noreferrer"
                className="truncate block text-xs text-slate-200 hover:text-blue-400"
                title={row.title} onClick={e => e.stopPropagation()}>
                {row.title}
              </a>
            ) : (
              <span className="text-xs text-slate-500">{row.title}</span>
            )}
          </div>
        );
      case "itemId":
        return <span className="text-[10px] font-mono text-slate-600">{row.itemId || "—"}</span>;
      case "qty":
        return <span className="text-xs text-slate-400">{row.qty > 0 ? `×${row.qty}` : "—"}</span>;
      case "price":
        return <span className="text-xs text-slate-300">{row.qty > 0 ? fmt$(row.price) : "—"}</span>;
      case "total":
        return (
          <span className={`text-xs ${order.hasRefund ? "text-amber-400" : "text-slate-400"}`}>
            {fmt$(order.originalTotal)}{order.hasRefund ? " ⚠" : ""}
          </span>
        );
      case "shipStatus":
        return shipment
          ? <span className={`inline-block rounded px-2 py-0.5 text-[10px] font-medium ${shipStatusColor[shipment.derivedStatus] ?? "bg-slate-700 text-slate-300"}`}>
              {shipment.derivedStatus.replace(/_/g, " ")}
            </span>
          : <span className="text-xs text-slate-600">—</span>;
      case "checkedIn":
        return (
          <span className={`inline-block rounded px-2 py-0.5 text-[10px] font-medium ${shipment?.checkedInAt ? "bg-emerald-900 text-emerald-300" : "bg-slate-800 text-slate-500"}`}>
            {shipment?.checkedInAt ? "✓ In" : "Not in"}
          </span>
        );
      case "returnCase":
        if (order.returnCase) return <ReturnBadge r={order.returnCase} />;
        if (order.needsReturn) return (
          <a href={`https://order.ebay.com/ord/show?orderId=${order.orderId}`} target="_blank" rel="noreferrer"
            title="Received in bad condition — click to open this order on eBay and use 'More actions' > 'Return this item'"
            onClick={e => e.stopPropagation()}
            className="inline-block rounded px-2 py-0.5 text-[10px] font-medium bg-orange-950 border border-orange-800 text-orange-400 hover:bg-orange-900 transition-colors">
            File Return ↗
          </a>
        );
        return <span className="text-xs text-slate-600">—</span>;
      case "inrCase": {
        if (order.inrCase) return <InrBadge c={order.inrCase} />;
        const inrStatus = order.shipment?.derivedStatus;
        if (inrStatus === "not_received" || inrStatus === "not_delivered") {
          return (
            <a href={`https://order.ebay.com/ord/show?orderId=${order.orderId}`} target="_blank" rel="noreferrer"
              title="No INR filed — click to open this order on eBay and use 'More actions' > 'I didn't receive it'"
              onClick={e => e.stopPropagation()}
              className="inline-block rounded px-2 py-0.5 text-[10px] font-medium bg-yellow-950 border border-yellow-800 text-yellow-400 hover:bg-yellow-900 transition-colors">
              File INR ↗
            </a>
          );
        }
        return <span className="text-xs text-slate-600">—</span>;
      }
      case "escalated":
        return <EscalatedBadge order={order} />;
      default: return null;
    }
  }

  function renderOrderCell(key: ColKey, order: Order) {
    const shipment = order.shipment;
    const totalItems = order.items.reduce((s, i) => s + i.qty, 0);
    switch (key) {
      case "orderId":
        return (
          <Link href={`/orders/${order.orderId}`} className="text-xs font-mono text-blue-400 hover:underline"
            onClick={e => e.stopPropagation()}>
            {order.orderId}
          </Link>
        );
      case "date":
        return <span className="text-xs text-slate-400">{fmtDate(order.purchaseDate)}</span>;
      case "account":
        return <span className="text-xs text-slate-500 truncate" title={order.ebayUsername ?? ""}>{order.ebayUsername ?? "—"}</span>;
      case "item":
        return (
          <div className="truncate text-xs text-slate-300" title={order.items.map(i => i.title).join("; ")}>
            {order.items.length === 0 ? "—"
              : order.items.length === 1
                ? <>{order.items[0].title}{order.items[0].qty > 1 ? <span className="ml-1 text-slate-500">×{order.items[0].qty}</span> : null}</>
                : <>{order.items[0].title} <span className="text-slate-500">+{order.items.length - 1} more ({totalItems} units)</span></>
            }
          </div>
        );
      case "total":
        return (
          <span className={`text-xs font-medium ${order.hasRefund ? "text-amber-400" : "text-slate-200"}`}>
            {fmt$(order.originalTotal)}{order.hasRefund ? " ⚠" : ""}
          </span>
        );
      case "shipStatus":
        return shipment
          ? <span className={`inline-block rounded px-2 py-0.5 text-[10px] font-medium ${shipStatusColor[shipment.derivedStatus] ?? "bg-slate-700 text-slate-300"}`}>
              {shipment.derivedStatus.replace(/_/g, " ")}
            </span>
          : <span className="text-xs text-slate-600">—</span>;
      case "checkedIn":
        return (
          <span className={`inline-block rounded px-2 py-0.5 text-[10px] font-medium ${shipment?.checkedInAt ? "bg-emerald-900 text-emerald-300" : "bg-slate-800 text-slate-500"}`}>
            {shipment?.checkedInAt ? `✓ ${new Date(shipment.checkedInAt).toLocaleDateString()}` : "Not in"}
          </span>
        );
      case "returnCase":
        if (order.returnCase) return <ReturnBadge r={order.returnCase} />;
        if (order.needsReturn) return (
          <a href={`https://order.ebay.com/ord/show?orderId=${order.orderId}`} target="_blank" rel="noreferrer"
            title="Received in bad condition — click to open this order on eBay and use 'More actions' > 'Return this item'"
            onClick={e => e.stopPropagation()}
            className="inline-block rounded px-2 py-0.5 text-[10px] font-medium bg-orange-950 border border-orange-800 text-orange-400 hover:bg-orange-900 transition-colors">
            File Return ↗
          </a>
        );
        return <span className="text-xs text-slate-600">—</span>;
      case "inrCase": {
        if (order.inrCase) return <InrBadge c={order.inrCase} />;
        const inrStatus = order.shipment?.derivedStatus;
        if (inrStatus === "not_received" || inrStatus === "not_delivered") {
          return (
            <a href={`https://order.ebay.com/ord/show?orderId=${order.orderId}`} target="_blank" rel="noreferrer"
              title="No INR filed — click to open this order on eBay and use 'More actions' > 'I didn't receive it'"
              onClick={e => e.stopPropagation()}
              className="inline-block rounded px-2 py-0.5 text-[10px] font-medium bg-yellow-950 border border-yellow-800 text-yellow-400 hover:bg-yellow-900 transition-colors">
              File INR ↗
            </a>
          );
        }
        return <span className="text-xs text-slate-600">—</span>;
      }
      case "escalated":
        return <EscalatedBadge order={order} />;
      case "itemId": case "qty": case "price": return null;
      default: return null;
    }
  }

  // ── Header row ────────────────────────────────────────────────────────────

  function HeaderRow({ cols }: { cols: ColDef[] }) {
    return (
      <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-700 bg-slate-950">
        {/* Spacer for expand caret */}
        <span className="w-3 flex-shrink-0" />
        {cols.map(c => (
          <button
            key={c.key}
            onClick={() => handleColSort(c)}
            className={`${colWidth[c.key] ?? "flex-shrink-0"} flex items-center text-left text-[10px] font-semibold uppercase tracking-wider transition-colors hover:text-slate-200 ${
              (c.sortMode === "server" && sortBy === (SERVER_SORT_KEY[c.key] ?? c.key) && clientSortCol === null) ||
              (c.sortMode === "client" && clientSortCol === c.key)
                ? "text-blue-400"
                : "text-slate-500"
            }`}
          >
            <span className="truncate">{c.label}</span>
            {getSortIcon(c)}
          </button>
        ))}
        {/* Spacer for eBay ↗ */}
        <span className="flex-shrink-0 w-3" />
      </div>
    );
  }

  // ── Expanded detail (shared) ───────────────────────────────────────────────

  function ExpandedDetail({ order }: { order: Order }) {
    const shipment = order.shipment;
    return (
      <div className="border-t border-slate-800 bg-slate-950/50 px-4 py-3 space-y-3">
        <div className="flex flex-wrap gap-4 text-xs">
          <div><span className="text-slate-500">Order </span>
            <Link href={`/orders/${order.orderId}`} className="font-mono text-blue-400 hover:underline">{order.orderId}</Link>
          </div>
          <div><span className="text-slate-500">Subtotal </span><span className="text-slate-300">{fmt$(order.subtotal)}</span></div>
          {(order.shippingCost ?? 0) > 0
            ? <div><span className="text-slate-500">Shipping </span><span className="text-slate-300">{fmt$(order.shippingCost)}</span></div>
            : <span className="text-emerald-400">✓ Free shipping</span>}
          {(order.taxAmount ?? 0) > 0 && <div><span className="text-slate-500">Tax </span><span className="text-slate-300">{fmt$(order.taxAmount)}</span></div>}
          <div><span className="text-slate-500">Order Total </span><span className="font-medium text-slate-200">{fmt$(order.originalTotal)}</span></div>
          {order.hasRefund && <div><span className="text-slate-500">Current </span><span className="text-amber-400">{fmt$(order.currentTotal)} ⚠ refund</span></div>}
          {order.shipToState && <div><span className="text-slate-500">Ship to </span><span className="text-slate-400">{[order.shipToCity, order.shipToState, order.shipToPostal].filter(Boolean).join(", ")}</span></div>}
          <div><span className="text-slate-500">eBay status </span><span className="text-slate-400">{order.orderStatus}</span></div>
          {order.ebayUsername && multiAccount && <div><span className="text-slate-500">Account </span><span className="text-slate-400">{order.ebayUsername}</span></div>}
        </div>
        {(order.returnCase || order.inrCase) && (
          <div className="flex flex-wrap gap-4 text-xs">
            {order.returnCase && (
              <div><span className="text-slate-500">Return </span>
                <a href={order.returnCase.url} target="_blank" rel="noreferrer" className="text-orange-400 hover:underline">
                  {order.returnCase.state ?? order.returnCase.status ?? "Open"}
                  {order.returnCase.refundAmount != null ? ` · ${fmt$(order.returnCase.refundAmount)}` : ""}
                  {order.returnCase.escalated ? " · Escalated" : ""}
                </a>
              </div>
            )}
            {order.inrCase && (
              <div><span className="text-slate-500">INR </span>
                <a href={order.inrCase.url} target="_blank" rel="noreferrer" className="text-yellow-400 hover:underline">
                  {order.inrCase.status ?? "Open"}
                  {order.inrCase.claimAmount != null ? ` · ${fmt$(order.inrCase.claimAmount)}` : ""}
                  {order.inrCase.escalatedToCase ? ` · Case ${order.inrCase.caseId}` : ""}
                </a>
              </div>
            )}
          </div>
        )}
        {shipment && shipment.trackingNumbers.length > 0 && (
          <div className="flex flex-wrap gap-3">
            {shipment.trackingNumbers.map((t, i) => (
              <span key={i} className="text-xs font-mono text-slate-400">
                {t.carrier && <span className="text-slate-600 mr-1">{t.carrier}</span>}{t.number}
              </span>
            ))}
          </div>
        )}
        {shipment && (
          <div className="flex flex-wrap gap-4 text-xs">
            {shipment.deliveredAt && <div><span className="text-slate-500">Delivered </span><span className="text-slate-300">{fmtDate(shipment.deliveredAt)}</span></div>}
            <div><span className="text-slate-500">Scan </span><span className="text-slate-400">{shipment.scannedUnits}/{shipment.expectedUnits} units · {shipment.scanStatus}</span></div>
          </div>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          <Link href={`/orders/${order.orderId}`} className="rounded bg-slate-800 px-3 py-1 text-xs text-slate-300 hover:bg-slate-700 transition-colors">
            Order details →
          </Link>
          <a href={order.orderUrl} target="_blank" rel="noreferrer" className="rounded bg-slate-800 px-3 py-1 text-xs text-slate-300 hover:bg-slate-700 transition-colors">
            View on eBay ↗
          </a>
          <a href={`https://order.ebay.com/ord/show?orderId=${order.orderId}`} target="_blank" rel="noreferrer"
            title="Opens this order on eBay — click 'More actions' then 'Return this item'"
            className="rounded bg-orange-950 border border-orange-800 px-3 py-1 text-xs text-orange-300 hover:bg-orange-900 transition-colors">
            File Return ↗
          </a>
          <a href={`https://order.ebay.com/ord/show?orderId=${order.orderId}`} target="_blank" rel="noreferrer"
            title="Opens this order on eBay — click 'More actions' then 'I didn't receive it'"
            className="rounded bg-yellow-950 border border-yellow-800 px-3 py-1 text-xs text-yellow-300 hover:bg-yellow-900 transition-colors">
            File INR ↗
          </a>
        </div>
      </div>
    );
  }

  // ── Expanded detail for orders view (includes item list) ─────────────────

  function ExpandedOrderDetail({ order }: { order: Order }) {
    const shipment = order.shipment;
    return (
      <div className="border-t border-slate-800 bg-slate-950/50 px-4 py-3 space-y-3">
        <div>
          <p className="mb-1.5 text-[10px] uppercase tracking-widest text-slate-600">Items</p>
          <div className="space-y-1">
            {order.items.map((item, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <a href={`https://www.ebay.com/itm/${item.itemId}`} target="_blank" rel="noreferrer"
                  className="text-blue-400 hover:underline truncate max-w-[480px]" title={item.title}>
                  {item.title}
                </a>
                <span className="text-slate-500 flex-shrink-0">×{item.qty}</span>
                <span className="text-slate-400 flex-shrink-0">{fmt$(item.price)}</span>
                <span className="text-slate-600 flex-shrink-0 font-mono text-[10px]">{item.itemId}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-4 text-xs">
          <div><span className="text-slate-500">Subtotal </span><span className="text-slate-300">{fmt$(order.subtotal)}</span></div>
          {(order.shippingCost ?? 0) > 0
            ? <div><span className="text-slate-500">Shipping </span><span className="text-slate-300">{fmt$(order.shippingCost)}</span></div>
            : <span className="text-emerald-400">✓ Free shipping</span>}
          {(order.taxAmount ?? 0) > 0 && <div><span className="text-slate-500">Tax </span><span className="text-slate-300">{fmt$(order.taxAmount)}</span></div>}
          <div><span className="text-slate-500">Order Total </span><span className="font-medium text-slate-200">{fmt$(order.originalTotal)}</span></div>
          {order.hasRefund && <div><span className="text-slate-500">Current </span><span className="text-amber-400">{fmt$(order.currentTotal)} ⚠ refund</span></div>}
          {order.shipToState && <div><span className="text-slate-500">Ship to </span><span className="text-slate-400">{[order.shipToCity, order.shipToState, order.shipToPostal].filter(Boolean).join(", ")}</span></div>}
          <div><span className="text-slate-500">eBay status </span><span className="text-slate-400">{order.orderStatus}</span></div>
          {order.ebayUsername && multiAccount && <div><span className="text-slate-500">Account </span><span className="text-slate-400">{order.ebayUsername}</span></div>}
        </div>
        {(order.returnCase || order.inrCase) && (
          <div className="flex flex-wrap gap-4 text-xs">
            {order.returnCase && (
              <div><span className="text-slate-500">Return </span>
                <a href={order.returnCase.url} target="_blank" rel="noreferrer" className="text-orange-400 hover:underline">
                  {order.returnCase.state ?? order.returnCase.status ?? "Open"}
                  {order.returnCase.refundAmount != null ? ` · ${fmt$(order.returnCase.refundAmount)}` : ""}
                  {order.returnCase.escalated ? " · Escalated" : ""}
                </a>
              </div>
            )}
            {order.inrCase && (
              <div><span className="text-slate-500">INR </span>
                <a href={order.inrCase.url} target="_blank" rel="noreferrer" className="text-yellow-400 hover:underline">
                  {order.inrCase.status ?? "Open"}
                  {order.inrCase.claimAmount != null ? ` · ${fmt$(order.inrCase.claimAmount)}` : ""}
                  {order.inrCase.escalatedToCase ? ` · Case ${order.inrCase.caseId}` : ""}
                </a>
              </div>
            )}
          </div>
        )}
        {shipment && shipment.trackingNumbers.length > 0 && (
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-widest text-slate-600">Tracking</p>
            <div className="flex flex-wrap gap-3">
              {shipment.trackingNumbers.map((t, i) => (
                <span key={i} className="text-xs font-mono text-slate-400">
                  {t.carrier && <span className="text-slate-600 mr-1">{t.carrier}</span>}{t.number}
                </span>
              ))}
            </div>
          </div>
        )}
        {shipment && (
          <div className="flex flex-wrap gap-4 text-xs">
            {shipment.deliveredAt && <div><span className="text-slate-500">Delivered </span><span className="text-slate-300">{fmtDate(shipment.deliveredAt)}</span></div>}
            <div><span className="text-slate-500">Scan </span><span className="text-slate-400">{shipment.scannedUnits}/{shipment.expectedUnits} units · {shipment.scanStatus}</span></div>
          </div>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          <Link href={`/orders/${order.orderId}`} className="rounded bg-slate-800 px-3 py-1 text-xs text-slate-300 hover:bg-slate-700 transition-colors">
            Order details →
          </Link>
          <a href={order.orderUrl} target="_blank" rel="noreferrer" className="rounded bg-slate-800 px-3 py-1 text-xs text-slate-300 hover:bg-slate-700 transition-colors">
            View on eBay ↗
          </a>
          <a href={`https://order.ebay.com/ord/show?orderId=${order.orderId}`} target="_blank" rel="noreferrer"
            title="Opens this order on eBay — click 'More actions' then 'Return this item'"
            className="rounded bg-orange-950 border border-orange-800 px-3 py-1 text-xs text-orange-300 hover:bg-orange-900 transition-colors">
            File Return ↗
          </a>
          <a href={`https://order.ebay.com/ord/show?orderId=${order.orderId}`} target="_blank" rel="noreferrer"
            title="Opens this order on eBay — click 'More actions' then 'I didn't receive it'"
            className="rounded bg-yellow-950 border border-yellow-800 px-3 py-1 text-xs text-yellow-300 hover:bg-yellow-900 transition-colors">
            File INR ↗
          </a>
        </div>
      </div>
    );
  }

  // ── JSX ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* ── Filters ── */}
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-4 space-y-4">

        {/* Row 1: Global search + tracking scan */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-slate-500">Search (order, item ID, title, tracking, account)</label>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Type to search…"
              className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-600" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">Tracking scan (barcode or last digits)</label>
            <div className="flex gap-2">
              <input ref={trackingRef} type="text" placeholder="Scan or type tracking…" onKeyDown={handleTrackingKey}
                className="flex-1 rounded border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-600" />
              <button onClick={() => { const val = trackingRef.current?.value.trim() ?? ""; setTrackingScan(val); }}
                className="rounded bg-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-600">Find</button>
              {trackingScan && (
                <button onClick={() => { setTrackingScan(""); if (trackingRef.current) trackingRef.current.value = ""; }}
                  className="rounded bg-slate-800 px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-700">×</button>
              )}
            </div>
            {trackingScan && <p className="mt-1 text-xs text-blue-400">Filtering by tracking: …{trackingScan.slice(-12)}</p>}
          </div>
        </div>

        {/* Row 2: Date presets + account + checked-in */}
        <div className="flex flex-wrap items-end gap-3">
          {/* Date presets */}
          <div>
            <p className="mb-1.5 text-xs text-slate-500">Date range</p>
            <div className="flex items-center gap-1">
              {(["30", "60", "90", "all"] as DatePreset[]).map(p => (
                <button
                  key={p}
                  onClick={() => { setDatePreset(p); setDateFrom(""); setDateTo(""); }}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                    datePreset === p ? "bg-blue-700 text-blue-100" : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                  }`}
                >
                  {p === "all" ? "All time" : `${p}d`}
                </button>
              ))}
            </div>
          </div>

          {/* Manual date override — shown always, but grayed when a preset is active */}
          <div className="flex items-end gap-2">
            <div>
              <label className="mb-1 block text-xs text-slate-500">From</label>
              <input
                type="date"
                value={datePreset !== "all" ? effectiveDateFrom : dateFrom}
                onChange={e => { setDatePreset("all"); setDateFrom(e.target.value); }}
                className="rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-blue-600"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">To</label>
              <input
                type="date"
                value={dateTo}
                onChange={e => { setDatePreset("all"); setDateTo(e.target.value); }}
                className="rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-blue-600"
              />
            </div>
          </div>

          {/* Account */}
          {accounts.length > 1 && (
            <div>
              <label className="mb-1 block text-xs text-slate-500">eBay Account</label>
              <select value={filterAccountId} onChange={e => setFilterAccountId(e.target.value)}
                className="rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-300 focus:outline-none">
                <option value="">All accounts</option>
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>{a.ebay_username ?? a.id}</option>
                ))}
              </select>
            </div>
          )}

          {/* Check-in */}
          <div>
            <label className="mb-1 block text-xs text-slate-500">Check-in</label>
            <select value={filterCheckedIn} onChange={e => setFilterCheckedIn(e.target.value)}
              className="rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-300 focus:outline-none">
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
              <button key={s.value} onClick={() => toggleShipStatus(s.value)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  filterShipStatus.includes(s.value)
                    ? (shipStatusColor[s.value] ?? "bg-blue-700 text-blue-100")
                    : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                }`}>
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
              <button key={s} onClick={() => toggleOrderStatus(s)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  filterOrderStatus.includes(s) ? "bg-blue-700 text-blue-100" : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                }`}>
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Row 5: Group by + columns + clear */}
        <div className="flex items-center justify-between gap-3 flex-wrap border-t border-slate-800 pt-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Group by:</span>
            <button onClick={() => setGroupBy("items")}
              className={`rounded px-2.5 py-1 text-xs transition-colors ${groupBy === "items" ? "bg-indigo-800 text-indigo-200" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>
              Items
            </button>
            <button onClick={() => setGroupBy("orders")}
              className={`rounded px-2.5 py-1 text-xs transition-colors ${groupBy === "orders" ? "bg-indigo-800 text-indigo-200" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>
              Orders
            </button>
          </div>
          <div className="flex items-center gap-2">
            <ColumnPicker visibleCols={visibleCols} onChange={setVisibleCols} groupBy={groupBy} />
            <button
              onClick={() => {
                setSearch(""); setTrackingScan(""); setFilterShipStatus([]); setFilterOrderStatus([]);
                setFilterCheckedIn(""); setFilterAccountId(""); setDateFrom(""); setDateTo("");
                setDatePreset("90");
                setSortBy("purchaseDate"); setSortDir("desc"); setClientSortCol(null);
                if (trackingRef.current) trackingRef.current.value = "";
              }}
              className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-400 hover:bg-slate-800"
            >
              Clear filters
            </button>
          </div>
        </div>
      </div>

      {/* ── Results header ── */}
      <div className="flex items-center justify-between text-sm text-slate-400">
        <span>
          {loading ? "Searching…" : groupBy === "items"
            ? `${sortedItemRows.length} item${sortedItemRows.length !== 1 ? "s" : ""} across ${total} order${total !== 1 ? "s" : ""}`
            : `${total} order${total !== 1 ? "s" : ""}`}
          {(search || trackingScan || filterShipStatus.length || filterOrderStatus.length || filterCheckedIn || filterAccountId || effectiveDateFrom || dateTo) && " (filtered)"}
        </span>
        <span className="text-xs text-slate-600">Showing {offset + 1}–{Math.min(offset + LIMIT, total)} of {total} orders</span>
      </div>

      {/* ── Results table ── */}
      <div className="rounded-lg border border-slate-800 bg-slate-900 overflow-hidden">
        {orders.length === 0 && !loading ? (
          <p className="p-6 text-sm text-slate-500 text-center">No orders match your filters.</p>
        ) : groupBy === "items" ? (

          /* ── Items view ── */
          <>
            <HeaderRow cols={itemsCols} />
            <div className="divide-y divide-slate-800">
              {sortedItemRows.map(row => {
                const { order } = row;
                const isExpanded = expanded.has(row.key);
                return (
                  <div key={row.key} className={`transition-colors ${isExpanded ? "" : "hover:bg-slate-800/50"}`}>
                    <div className="flex items-center gap-3 px-4 py-3 cursor-pointer" onClick={() => toggleExpand(row.key)}>
                      <span className="text-slate-600 text-xs w-3 flex-shrink-0">{isExpanded ? "▼" : "▶"}</span>
                      {itemsCols.map(c => (
                        <div key={c.key} className={colWidth[c.key] ?? "flex-shrink-0"}>
                          {renderItemCell(c.key, row)}
                        </div>
                      ))}
                      <a href={order.orderUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                        className="flex-shrink-0 text-xs text-slate-600 hover:text-blue-400" title="View on eBay">↗</a>
                    </div>
                    {isExpanded && <ExpandedDetail order={order} />}
                  </div>
                );
              })}
            </div>
          </>

        ) : (

          /* ── Orders view ── */
          <>
            <HeaderRow cols={ordersCols} />
            <div className="divide-y divide-slate-800">
              {sortedOrders.map(order => {
                const isExpanded = expanded.has(order.orderId);
                return (
                  <div key={order.orderId} className={`transition-colors ${isExpanded ? "" : "hover:bg-slate-800/50"}`}>
                    <div className="flex items-center gap-3 px-4 py-3 cursor-pointer" onClick={() => toggleExpand(order.orderId)}>
                      <span className="text-slate-600 text-xs w-3 flex-shrink-0">{isExpanded ? "▼" : "▶"}</span>
                      {ordersCols.map(c => (
                        <div key={c.key} className={colWidth[c.key] ?? "flex-shrink-0"}>
                          {renderOrderCell(c.key, order)}
                        </div>
                      ))}
                      <a href={order.orderUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                        className="flex-shrink-0 text-xs text-slate-600 hover:text-blue-400" title="View on eBay">↗</a>
                    </div>
                    {isExpanded && <ExpandedOrderDetail order={order} />}
                  </div>
                );
              })}
            </div>
          </>

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
