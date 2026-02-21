"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Link from "next/link";
import CheckInModal from "@/components/check-in-modal";

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
  | "refund"
  | "shipStatus"
  | "checkedIn"
  | "returnCase"
  | "inrCase"
  | "escalated";

type ColDef = {
  key: ColKey;
  label: string;
  defaultOn: boolean;
  itemsOnly?: boolean;
  sortValue?: (order: Order, itemRow?: ItemRow) => string | number | boolean | null;
};

const ALL_COLS: ColDef[] = [
  { key: "orderId",    label: "Order #",      defaultOn: true,  sortValue: o => o.orderId },
  { key: "date",       label: "Date",         defaultOn: true,  sortValue: o => o.purchaseDate },
  { key: "account",   label: "Account",      defaultOn: true,  sortValue: o => o.ebayUsername ?? "" },
  { key: "item",       label: "Item / Title", defaultOn: true,  sortValue: (o, row) => row ? row.title : (o.items[0]?.title ?? "") },
  { key: "itemId",    label: "Item ID",      defaultOn: true,  itemsOnly: true, sortValue: (_o, row) => row?.itemId ?? "" },
  { key: "qty",        label: "Qty",          defaultOn: true,  itemsOnly: true, sortValue: (_o, row) => row?.qty ?? 0 },
  { key: "price",      label: "Price",        defaultOn: true,  itemsOnly: true, sortValue: (_o, row) => row?.price ?? 0 },
  { key: "total",      label: "Order Total",  defaultOn: true,  sortValue: o => o.originalTotal ?? 0 },
  { key: "refund",     label: "Refund",       defaultOn: true,  sortValue: o => o.hasRefund ? (o.currentTotal != null && o.currentTotal <= 0 ? 2 : 1) : 0 },
  { key: "shipStatus", label: "Ship Status",  defaultOn: true,  sortValue: o => o.shipment?.derivedStatus ?? "" },
  { key: "checkedIn",  label: "Check-in",     defaultOn: true,  sortValue: o => o.shipment?.checkedInAt ? 1 : 0 },
  { key: "returnCase", label: "Return",       defaultOn: true,  sortValue: o => o.returnCase ? (o.returnCase.escalated ? 2 : 1) : 0 },
  { key: "inrCase",    label: "INR",          defaultOn: true,  sortValue: o => o.inrCase ? (o.inrCase.escalatedToCase ? 2 : 1) : 0 },
  { key: "escalated",  label: "Escalated",    defaultOn: false, sortValue: o => (o.returnCase?.escalated || o.inrCase?.escalatedToCase) ? 1 : 0 },
];

const DEFAULT_ON = new Set(ALL_COLS.filter(c => c.defaultOn).map(c => c.key));

// ── Misc constants ──────────────────────────────────────────────────────────

const SHIP_STATUSES = [
  { value: "delivered",     label: "Delivered" },
  { value: "shipped",       label: "Shipped" },
  { value: "not_delivered", label: "Not Delivered" },
  { value: "not_received",  label: "Never Shipped" },
];

const ORDER_STATUSES = ["Completed", "Cancelled"];

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

function RefundBadge({ order }: { order: Order }) {
  if (!order.hasRefund) return <span className="text-xs text-slate-600">—</span>;
  const full = isFullRefund(order);
  if (full) {
    return (
      <span className="inline-flex flex-col">
        <span className="inline-block rounded px-2 py-0.5 text-[10px] font-medium bg-red-950 border border-red-800 text-red-300">
          Full Refund
        </span>
        {order.originalTotal != null && (
          <span className="text-[10px] text-red-400 mt-0.5">{fmt$(order.originalTotal)}</span>
        )}
      </span>
    );
  }
  // partial
  const refundAmt = order.originalTotal != null && order.currentTotal != null
    ? order.originalTotal - order.currentTotal
    : null;
  return (
    <span className="inline-flex flex-col">
      <span className="inline-block rounded px-2 py-0.5 text-[10px] font-medium bg-amber-950 border border-amber-800 text-amber-300">
        Partial Refund
      </span>
      {refundAmt != null && order.originalTotal != null && (
        <span className="text-[10px] text-amber-400 mt-0.5">{fmt$(refundAmt)} / {fmt$(order.originalTotal)}</span>
      )}
    </span>
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

// ── Default column widths (px) — "item" is flex-1 and has no fixed width ────

const DEFAULT_COL_WIDTHS: Partial<Record<ColKey, number>> = {
  orderId:    112,
  date:       96,
  account:    96,
  itemId:     112,
  qty:        48,
  price:      64,
  total:      80,
  refund:     144,
  shipStatus: 112,
  checkedIn:  80,
  returnCase: 80,
  inrCase:    80,
  escalated:  96,
};

const MIN_COL_WIDTH = 40;

// ── Persistence helpers ──────────────────────────────────────────────────────

const STORAGE_KEY = "arbdesk_search_filters";

type DatePreset = "30" | "60" | "90" | "all";

type CaseFilter = "needsReturn" | "hasOpenReturn" | "hasClosedReturn" | "hasOpenInr" | "hasClosedInr" | "needsInr" | "anyRefund" | "fullRefund" | "partialRefund" | "noRefund";

type SavedFilters = {
  groupBy: GroupBy;
  visibleCols: ColKey[];
  colWidths: Partial<Record<ColKey, number>>;
  sortBy: ColKey;
  sortDir: "asc" | "desc";
  search: string;
  filterShipStatus: string[];
  filterOrderStatus: string[];
  filterCheckedIn: string;
  filterAccountId: string;
  filterCase: CaseFilter[];
  datePreset: DatePreset;
  dateFrom: string;
  dateTo: string;
};

const VALID_SHIP_STATUSES = new Set(SHIP_STATUSES.map(s => s.value));
const VALID_ORDER_STATUSES = new Set(ORDER_STATUSES);
const VALID_CASE_FILTERS = new Set<CaseFilter>(["needsReturn", "hasOpenReturn", "hasClosedReturn", "hasOpenInr", "hasClosedInr", "needsInr", "anyRefund", "fullRefund", "partialRefund", "noRefund"]);

function loadSaved(): Partial<SavedFilters> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: Partial<SavedFilters> = JSON.parse(raw);
    if (parsed.filterShipStatus) {
      parsed.filterShipStatus = parsed.filterShipStatus.filter(v => VALID_SHIP_STATUSES.has(v));
    }
    if (parsed.filterOrderStatus) {
      parsed.filterOrderStatus = parsed.filterOrderStatus.filter(v => VALID_ORDER_STATUSES.has(v));
    }
    if (parsed.filterCase) {
      parsed.filterCase = parsed.filterCase.filter(v => VALID_CASE_FILTERS.has(v));
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

// ── Case filter helpers ───────────────────────────────────────────────────────

function isReturnClosed(r: ReturnCase): boolean {
  const state = (r.state ?? r.status ?? "").replace(/_/g, " ").toLowerCase();
  return state.includes("closed") || state.includes("refund");
}

function isInrClosed(c: InrCase): boolean {
  return c.status === "CLOSED" || c.status === "CS_CLOSED";
}

function isFullRefund(o: Order): boolean {
  return o.hasRefund && o.currentTotal != null && o.currentTotal <= 0;
}

function isPartialRefund(o: Order): boolean {
  return o.hasRefund && o.currentTotal != null && o.currentTotal > 0;
}

// ── Case filter predicate ─────────────────────────────────────────────────────

function matchesCaseFilter(order: Order, filters: CaseFilter[]): boolean {
  if (filters.length === 0) return true;
  return filters.every(f => {
    switch (f) {
      case "needsReturn": return order.needsReturn && !order.returnCase;
      case "hasOpenReturn":   return order.returnCase != null && !isReturnClosed(order.returnCase);
      case "hasClosedReturn": return order.returnCase != null && isReturnClosed(order.returnCase);
      case "hasOpenInr":      return order.inrCase != null && !isInrClosed(order.inrCase);
      case "hasClosedInr":    return order.inrCase != null && isInrClosed(order.inrCase);
      case "needsInr": {
        const s = order.shipment?.derivedStatus;
        // Only actionable for active (non-cancelled, non-refunded) orders with unshipped/undelivered items
        return (s === "not_received" || s === "not_delivered")
          && !order.inrCase
          && order.orderStatus !== "Cancelled"
          && !order.hasRefund;
      }
      case "anyRefund":     return order.hasRefund;
      case "fullRefund":    return isFullRefund(order);
      case "partialRefund": return isPartialRefund(order);
      case "noRefund":      return !order.hasRefund;
    }
  });
}

// ── Fetch params builder ──────────────────────────────────────────────────────

function buildParams(opts: {
  search: string; trackingScan: string; filterShipStatus: string[];
  filterOrderStatus: string[]; filterCheckedIn: string; filterAccountId: string;
  effectiveDateFrom: string; dateTo: string; sortBy: ColKey; sortDir: "asc" | "desc";
  limit: number; offset: number;
}) {
  const p = new URLSearchParams();
  if (opts.search) p.set("search", opts.search);
  if (opts.trackingScan) p.set("tracking", opts.trackingScan);
  if (opts.filterShipStatus.length) p.set("shipStatus", opts.filterShipStatus.join(","));
  if (opts.filterOrderStatus.length) p.set("status", opts.filterOrderStatus.join(","));
  if (opts.filterCheckedIn) p.set("checkedIn", opts.filterCheckedIn);
  if (opts.filterAccountId) p.set("accountId", opts.filterAccountId);
  if (opts.effectiveDateFrom) p.set("dateFrom", opts.effectiveDateFrom);
  if (opts.dateTo) p.set("dateTo", opts.dateTo);
  // All sort is client-side; use server default for consistent page ordering
  p.set("sortBy", "purchaseDate");
  p.set("sortDir", "desc");
  p.set("limit", String(opts.limit));
  p.set("offset", String(opts.offset));
  return p;
}

const PAGE_SIZE = 250;

// ── Main component ──────────────────────────────────────────────────────────

export default function OrderSearch({ accounts }: { accounts: Account[] }) {
  const saved = useMemo(() => loadSaved(), []);

  const [groupBy, setGroupBy] = useState<GroupBy>(saved.groupBy ?? "items");
  const [visibleCols, setVisibleCols] = useState<Set<ColKey>>(
    saved.visibleCols ? new Set(saved.visibleCols) : DEFAULT_ON
  );
  const [colWidths, setColWidths] = useState<Partial<Record<ColKey, number>>>(() => ({
    ...DEFAULT_COL_WIDTHS,
    ...(saved.colWidths ?? {}),
  }));
  const resizeRef = useRef<{ col: ColKey; startX: number; startW: number } | null>(null);

  // Single unified sort (always client-side now — all data is in memory)
  const [sortBy, setSortBy] = useState<ColKey>(saved.sortBy ?? "date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">(saved.sortDir ?? "desc");

  const [datePreset, setDatePreset] = useState<DatePreset>(saved.datePreset ?? "90");

  const [search, setSearch] = useState(saved.search ?? "");
  const [trackingScan, setTrackingScan] = useState("");
  const [filterShipStatus, setFilterShipStatus] = useState<string[]>(saved.filterShipStatus ?? []);
  const [filterOrderStatus, setFilterOrderStatus] = useState<string[]>(saved.filterOrderStatus ?? []);
  const [filterCheckedIn, setFilterCheckedIn] = useState(saved.filterCheckedIn ?? "");
  const [filterAccountId, setFilterAccountId] = useState(saved.filterAccountId ?? "");
  const [filterCase, setFilterCase] = useState<CaseFilter[]>(saved.filterCase ?? []);
  const [dateFrom, setDateFrom] = useState(saved.datePreset === "all" || (saved.datePreset == null && !saved.dateFrom) ? "" : (saved.dateFrom ?? ""));
  const [dateTo, setDateTo] = useState(saved.dateTo ?? "");

  // Data state — orders accumulate as background pages load
  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [loadedPages, setLoadedPages] = useState(0);   // how many pages fetched
  const [loadingFirst, setLoadingFirst] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [checkInTarget, setCheckInTarget] = useState<{
    orderId: string;
    trackingNumber: string | null;
    itemTitle: string;
    totalQty: number;
    alreadyScanned: number;
  } | null>(null);

  function triggerCheckIn(order: Order, e: React.MouseEvent) {
    e.stopPropagation();
    const tracking = order.shipment?.trackingNumbers?.[0]?.number ?? null;
    const title = order.items[0]?.title ?? order.orderId;
    const totalQty = order.items.reduce((s, i) => s + i.qty, 0) || 1;
    const alreadyScanned = order.shipment?.scannedUnits ?? 0;
    setCheckInTarget({ orderId: order.orderId, trackingNumber: tracking, itemTitle: title, totalQty, alreadyScanned });
  }

  const trackingRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Cancel token: increment to abort in-flight background loads on filter change
  const fetchGenRef = useRef(0);

  const effectiveDateFrom = datePreset !== "all" ? datePresetFrom(datePreset) : dateFrom;

  // ── Fetch all pages for current filters ──────────────────────────────────

  const fetchAll = useCallback(async (filterSnapshot: {
    search: string; trackingScan: string; filterShipStatus: string[];
    filterOrderStatus: string[]; filterCheckedIn: string; filterAccountId: string;
    effectiveDateFrom: string; dateTo: string; sortBy: ColKey; sortDir: "asc" | "desc";
  }) => {
    const gen = ++fetchGenRef.current;

    setOrders([]);
    setTotal(0);
    setLoadedPages(0);
    setExpanded(new Set());
    setLoadingFirst(true);

    // Fetch first page
    const p1 = buildParams({ ...filterSnapshot, limit: PAGE_SIZE, offset: 0 });
    let firstData: { orders: Order[]; total: number } | null = null;
    try {
      const res = await fetch(`/api/orders/search?${p1}`);
      if (gen !== fetchGenRef.current) return;
      firstData = await res.json();
    } catch {
      if (gen !== fetchGenRef.current) return;
    } finally {
      if (gen === fetchGenRef.current) setLoadingFirst(false);
    }

    if (!firstData) return;
    const serverTotal = firstData.total;
    setTotal(serverTotal);
    setOrders(firstData.orders);
    setLoadedPages(1);

    if (firstData.orders.length >= serverTotal) return; // all loaded

    // Background: fetch remaining pages
    setLoadingMore(true);
    let offset = PAGE_SIZE;
    while (offset < serverTotal) {
      if (gen !== fetchGenRef.current) { setLoadingMore(false); return; }
      const p = buildParams({ ...filterSnapshot, limit: PAGE_SIZE, offset });
      try {
        const res = await fetch(`/api/orders/search?${p}`);
        if (gen !== fetchGenRef.current) { setLoadingMore(false); return; }
        const data = await res.json();
        if (gen !== fetchGenRef.current) { setLoadingMore(false); return; }
        setOrders(prev => [...prev, ...(data.orders ?? [])]);
        setLoadedPages(prev => prev + 1);
      } catch {
        if (gen !== fetchGenRef.current) { setLoadingMore(false); return; }
        break;
      }
      offset += PAGE_SIZE;
    }
    if (gen === fetchGenRef.current) setLoadingMore(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Persist filters ───────────────────────────────────────────────────────

  useEffect(() => {
    try {
      const toSave: SavedFilters = {
        groupBy, visibleCols: Array.from(visibleCols) as ColKey[], colWidths,
        sortBy, sortDir,
        search, filterShipStatus, filterOrderStatus, filterCheckedIn, filterAccountId, filterCase,
        datePreset, dateFrom, dateTo,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch { /* ignore */ }
  }, [groupBy, visibleCols, colWidths, sortBy, sortDir, search, filterShipStatus, filterOrderStatus, filterCheckedIn, filterAccountId, filterCase, datePreset, dateFrom, dateTo]);

  // ── Debounced refetch on filter change ────────────────────────────────────

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const snapshot = { search, trackingScan, filterShipStatus, filterOrderStatus, filterCheckedIn, filterAccountId, effectiveDateFrom, dateTo, sortBy, sortDir };
    debounceRef.current = setTimeout(() => { fetchAll(snapshot); }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, trackingScan, filterShipStatus, filterOrderStatus, filterCheckedIn, filterAccountId, effectiveDateFrom, dateTo]);

  useEffect(() => {
    const snapshot = { search, trackingScan, filterShipStatus, filterOrderStatus, filterCheckedIn, filterAccountId, effectiveDateFrom, dateTo, sortBy, sortDir };
    fetchAll(snapshot);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Flatten to item rows ──────────────────────────────────────────────────

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

  // ── Client-side sort ──────────────────────────────────────────────────────

  const colDef = useMemo(() => ALL_COLS.find(c => c.key === sortBy), [sortBy]);

  const sortedItemRows = useMemo<ItemRow[]>(() => {
    const filtered = filterCase.length > 0
      ? itemRows.filter(row => matchesCaseFilter(row.order, filterCase))
      : itemRows;
    if (!colDef?.sortValue) return filtered;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = colDef.sortValue!(a.order, a) ?? "";
      const bv = colDef.sortValue!(b.order, b) ?? "";
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return 0;
    });
  }, [itemRows, colDef, sortDir, filterCase]);

  const sortedOrders = useMemo<Order[]>(() => {
    const filtered = filterCase.length > 0
      ? orders.filter(o => matchesCaseFilter(o, filterCase))
      : orders;
    if (!colDef?.sortValue) return filtered;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = colDef.sortValue!(a) ?? "";
      const bv = colDef.sortValue!(b) ?? "";
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return 0;
    });
  }, [orders, colDef, sortDir, filterCase]);

  // ── Sort handler ──────────────────────────────────────────────────────────

  function handleColSort(col: ColDef) {
    if (sortBy === col.key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortBy(col.key);
      setSortDir("asc");
    }
  }

  function getSortIcon(col: ColDef): React.ReactNode {
    if (sortBy !== col.key) return <span className="ml-1 text-slate-600 text-[10px]">↕</span>;
    return <span className="ml-1 text-blue-400 text-[10px]">{sortDir === "asc" ? "↑" : "↓"}</span>;
  }

  function toggleShipStatus(val: string) {
    setFilterShipStatus(prev => prev.includes(val) ? prev.filter(s => s !== val) : [...prev, val]);
  }
  function toggleOrderStatus(val: string) {
    setFilterOrderStatus(prev => prev.includes(val) ? prev.filter(s => s !== val) : [...prev, val]);
  }
  function toggleCaseFilter(val: CaseFilter) {
    setFilterCase(prev => prev.includes(val) ? prev.filter(s => s !== val) : [...prev, val]);
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

  // ── Column resize ─────────────────────────────────────────────────────────

  function getCellStyle(key: ColKey): React.CSSProperties {
    if (key === "item" && !colWidths[key]) return { flex: 1, minWidth: 0, overflow: "hidden" };
    const w = colWidths[key] ?? DEFAULT_COL_WIDTHS[key] ?? 80;
    return { width: w, flexShrink: 0, overflow: "hidden" };
  }

  function startResize(e: React.MouseEvent, col: ColKey) {
    e.preventDefault();
    e.stopPropagation();
    const startW = colWidths[col] ?? DEFAULT_COL_WIDTHS[col] ?? 80;
    const startX = e.clientX;
    resizeRef.current = { col, startX, startW };

    function onMove(ev: MouseEvent) {
      const r = resizeRef.current;
      if (!r) return;
      const delta = ev.clientX - r.startX;
      const newW = Math.max(MIN_COL_WIDTH, r.startW + delta);
      setColWidths(prev => ({ ...prev, [r.col]: newW }));
    }
    function onUp() {
      resizeRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  const multiAccount = accounts.length > 1;

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
            {fmt$(order.originalTotal)}
          </span>
        );
      case "refund":
        return <RefundBadge order={order} />;
      case "shipStatus":
        return shipment
          ? <span className={`inline-block rounded px-2 py-0.5 text-[10px] font-medium ${shipStatusColor[shipment.derivedStatus] ?? "bg-slate-700 text-slate-300"}`}>
              {shipment.derivedStatus.replace(/_/g, " ")}
            </span>
          : <span className="text-xs text-slate-600">—</span>;
      case "checkedIn":
        return (
          <button
            onClick={e => { if (!shipment?.checkedInAt) triggerCheckIn(order, e); else e.stopPropagation(); }}
            title={shipment?.checkedInAt ? `Checked in ${new Date(shipment.checkedInAt).toLocaleDateString()}` : "Click to check in"}
            className={`inline-block rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
              shipment?.checkedInAt
                ? "bg-emerald-900 text-emerald-300 cursor-default"
                : "bg-slate-800 text-slate-500 hover:bg-slate-700 hover:text-slate-300 cursor-pointer"
            }`}
          >
            {shipment?.checkedInAt ? "✓ In" : "Not in"}
          </button>
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
        const canFileInr = (inrStatus === "not_received" || inrStatus === "not_delivered")
          && order.orderStatus !== "Cancelled" && !order.hasRefund;
        if (canFileInr) {
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
            {fmt$(order.originalTotal)}
          </span>
        );
      case "refund":
        return <RefundBadge order={order} />;
      case "shipStatus":
        return shipment
          ? <span className={`inline-block rounded px-2 py-0.5 text-[10px] font-medium ${shipStatusColor[shipment.derivedStatus] ?? "bg-slate-700 text-slate-300"}`}>
              {shipment.derivedStatus.replace(/_/g, " ")}
            </span>
          : <span className="text-xs text-slate-600">—</span>;
      case "checkedIn":
        return (
          <button
            onClick={e => { if (!shipment?.checkedInAt) triggerCheckIn(order, e); else e.stopPropagation(); }}
            title={shipment?.checkedInAt ? `Checked in ${new Date(shipment.checkedInAt).toLocaleDateString()}` : "Click to check in"}
            className={`inline-block rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
              shipment?.checkedInAt
                ? "bg-emerald-900 text-emerald-300 cursor-default"
                : "bg-slate-800 text-slate-500 hover:bg-slate-700 hover:text-slate-300 cursor-pointer"
            }`}
          >
            {shipment?.checkedInAt ? `✓ ${new Date(shipment.checkedInAt).toLocaleDateString()}` : "Not in"}
          </button>
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
        const canFileInr = (inrStatus === "not_received" || inrStatus === "not_delivered")
          && order.orderStatus !== "Cancelled" && !order.hasRefund;
        if (canFileInr) {
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

  // ── Expanded detail panels ────────────────────────────────────────────────

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

  // ── Header row ────────────────────────────────────────────────────────────

  function HeaderRow({ cols }: { cols: ColDef[] }) {
    return (
      <div className="flex items-center gap-3 px-4 border-b border-slate-700 bg-slate-950 h-9 select-none">
        <span className="w-3 flex-shrink-0" />
        {cols.map(c => (
          <div
            key={c.key}
            style={{ ...getCellStyle(c.key), position: "relative" }}
            className="flex items-center"
          >
            <button
              onClick={() => handleColSort(c)}
              className={`flex items-center text-left text-[10px] font-semibold uppercase tracking-wider transition-colors hover:text-slate-200 truncate w-full ${
                sortBy === c.key ? "text-blue-400" : "text-slate-500"
              }`}
            >
              <span className="truncate">{c.label}</span>
              {getSortIcon(c)}
            </button>
            <span
              onMouseDown={e => startResize(e, c.key)}
              onDoubleClick={() => setColWidths(prev => {
                const next = { ...prev };
                delete next[c.key];
                return next;
              })}
              title="Drag to resize · double-click to reset"
              className="absolute right-0 top-0 h-full w-2 cursor-col-resize flex items-center justify-center group"
              style={{ userSelect: "none" }}
            >
              <span className="w-px h-4 bg-slate-700 group-hover:bg-blue-500 transition-colors" />
            </span>
          </div>
        ))}
        <span className="flex-shrink-0 w-3" />
      </div>
    );
  }

  // ── Case filter counts (computed over all loaded orders) ─────────────────

  const caseFilterCounts = useMemo(() => {
    const counts: Record<CaseFilter, number> = {
      needsReturn: 0, hasOpenReturn: 0, hasClosedReturn: 0,
      hasOpenInr: 0, hasClosedInr: 0, needsInr: 0,
      anyRefund: 0, fullRefund: 0, partialRefund: 0, noRefund: 0,
    };
    for (const o of orders) {
      if (o.needsReturn && !o.returnCase) counts.needsReturn++;
      if (o.returnCase) {
        if (isReturnClosed(o.returnCase)) counts.hasClosedReturn++;
        else counts.hasOpenReturn++;
      }
      if (o.inrCase) {
        if (isInrClosed(o.inrCase)) counts.hasClosedInr++;
        else counts.hasOpenInr++;
      }
      const s = o.shipment?.derivedStatus;
      if ((s === "not_received" || s === "not_delivered") && !o.inrCase
          && o.orderStatus !== "Cancelled" && !o.hasRefund) counts.needsInr++;
      if (o.hasRefund) {
        counts.anyRefund++;
        if (isFullRefund(o)) counts.fullRefund++;
        else counts.partialRefund++;
      } else {
        counts.noRefund++;
      }
    }
    return counts;
  }, [orders]);

  // ── JSX ───────────────────────────────────────────────────────────────────

  const rowCount = groupBy === "items" ? sortedItemRows.length : sortedOrders.length;
  const loadedCount = orders.length;
  const isLoading = loadingFirst || loadingMore;

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

        {/* Row 5: Returns & INR chips */}
        <div>
          <p className="mb-1.5 text-xs text-slate-500">Returns &amp; INR</p>
          <div className="flex flex-wrap gap-1.5">
            {([
              { value: "needsReturn"   as CaseFilter, label: "Needs Return",    activeClass: "bg-orange-950 border border-orange-800 text-orange-300" },
              { value: "hasOpenReturn" as CaseFilter, label: "Open Return",     activeClass: "bg-orange-900 text-orange-200" },
              { value: "hasClosedReturn" as CaseFilter, label: "Closed Return", activeClass: "bg-slate-700 text-slate-300" },
              { value: "needsInr"      as CaseFilter, label: "Needs INR",       activeClass: "bg-yellow-950 border border-yellow-800 text-yellow-300" },
              { value: "hasOpenInr"    as CaseFilter, label: "Open INR",        activeClass: "bg-yellow-900 text-yellow-200" },
              { value: "hasClosedInr"  as CaseFilter, label: "Closed INR",      activeClass: "bg-slate-700 text-slate-300" },
            ]).map(chip => {
              const count = caseFilterCounts[chip.value];
              return (
                <button key={chip.value} onClick={() => toggleCaseFilter(chip.value)}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                    filterCase.includes(chip.value) ? chip.activeClass : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                  }`}>
                  {chip.label}
                  {count > 0 && (
                    <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                      filterCase.includes(chip.value) ? "bg-black/30 text-current" : "bg-slate-700 text-slate-300"
                    }`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Row 6: Refund chips */}
        <div>
          <p className="mb-1.5 text-xs text-slate-500">Refunds</p>
          <div className="flex flex-wrap gap-1.5">
            {([
              { value: "noRefund"      as CaseFilter, label: "No Refund",      activeClass: "bg-slate-600 text-slate-200" },
              { value: "anyRefund"     as CaseFilter, label: "Any Refund",     activeClass: "bg-amber-950 border border-amber-800 text-amber-300" },
              { value: "fullRefund"    as CaseFilter, label: "Full Refund",    activeClass: "bg-red-950 border border-red-800 text-red-300" },
              { value: "partialRefund" as CaseFilter, label: "Partial Refund", activeClass: "bg-amber-900 text-amber-200" },
            ]).map(chip => {
              const count = caseFilterCounts[chip.value];
              return (
                <button key={chip.value} onClick={() => toggleCaseFilter(chip.value)}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                    filterCase.includes(chip.value) ? chip.activeClass : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                  }`}>
                  {chip.label}
                  {count > 0 && (
                    <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                      filterCase.includes(chip.value) ? "bg-black/30 text-current" : "bg-slate-700 text-slate-300"
                    }`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Row 7: Group by + columns + clear */}
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
                setFilterCheckedIn(""); setFilterAccountId(""); setFilterCase([]); setDateFrom(""); setDateTo("");
                setDatePreset("90");
                setSortBy("date"); setSortDir("desc");
                if (trackingRef.current) trackingRef.current.value = "";
              }}
              className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-400 hover:bg-slate-800"
            >
              Clear filters
            </button>
            <button
              onClick={() => setColWidths({ ...DEFAULT_COL_WIDTHS })}
              className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-400 hover:bg-slate-800"
              title="Reset all column widths to defaults"
            >
              Reset widths
            </button>
          </div>
        </div>
      </div>

      {/* ── Results header ── */}
      <div className="flex items-center justify-between text-sm text-slate-400">
        <span>
          {loadingFirst ? "Loading…" : (
            <>
              <span className="font-medium text-slate-200">{rowCount.toLocaleString()}</span>
              {groupBy === "items" ? " items" : " orders"}
              {filterCase.length > 0 || rowCount < loadedCount ? (
                <span className="text-slate-500"> (filtered from {loadedCount.toLocaleString()})</span>
              ) : null}
              {total > 0 && loadedCount < total ? (
                <span className="text-slate-500"> · {loadedCount.toLocaleString()} of {total.toLocaleString()} loaded</span>
              ) : null}
            </>
          )}
        </span>
        {loadingMore && (
          <span className="text-xs text-blue-500 animate-pulse">Loading more…</span>
        )}
      </div>

      {/* ── Results table ── */}
      <div className="rounded-lg border border-slate-800 bg-slate-900 overflow-hidden">
        {loadingFirst ? (
          <p className="p-6 text-sm text-slate-500 text-center">Loading orders…</p>
        ) : rowCount === 0 ? (
          <p className="p-6 text-sm text-slate-500 text-center">No orders match your filters.</p>
        ) : groupBy === "items" ? (
          <>
            <HeaderRow cols={itemsCols} />
            <div>
              {sortedItemRows.map(row => {
                const { order } = row;
                const isExpanded = expanded.has(row.key);
                return (
                  <div key={row.key} className={`border-b border-slate-800 ${isExpanded ? "" : "hover:bg-slate-800/50"} transition-colors`}>
                    <div className="flex items-center gap-3 px-4 h-12 cursor-pointer" onClick={() => toggleExpand(row.key)}>
                      <span className="text-slate-600 text-xs w-3 flex-shrink-0">{isExpanded ? "▼" : "▶"}</span>
                      {itemsCols.map(c => (
                        <div key={c.key} style={getCellStyle(c.key)}>
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
          <>
            <HeaderRow cols={ordersCols} />
            <div>
              {sortedOrders.map(order => {
                const isExpanded = expanded.has(order.orderId);
                return (
                  <div key={order.orderId} className={`border-b border-slate-800 ${isExpanded ? "" : "hover:bg-slate-800/50"} transition-colors`}>
                    <div className="flex items-center gap-3 px-4 h-12 cursor-pointer" onClick={() => toggleExpand(order.orderId)}>
                      <span className="text-slate-600 text-xs w-3 flex-shrink-0">{isExpanded ? "▼" : "▶"}</span>
                      {ordersCols.map(c => (
                        <div key={c.key} style={getCellStyle(c.key)}>
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

      {!isLoading && loadedCount > 0 && loadedCount < total && (
        <p className="text-center text-xs text-slate-600">
          {loadedCount.toLocaleString()} of {total.toLocaleString()} orders loaded
        </p>
      )}

      {checkInTarget && (
        <CheckInModal
          orderId={checkInTarget.orderId}
          trackingNumber={checkInTarget.trackingNumber}
          itemTitle={checkInTarget.itemTitle}
          totalQty={checkInTarget.totalQty}
          alreadyScanned={checkInTarget.alreadyScanned}
          onClose={() => setCheckInTarget(null)}
          onSuccess={() => {
            setCheckInTarget(null);
            // Refresh order data to reflect new check-in status
            const snapshot = { search, trackingScan, filterShipStatus, filterOrderStatus, filterCheckedIn, filterAccountId, effectiveDateFrom, dateTo, sortBy, sortDir };
            fetchAll(snapshot);
          }}
        />
      )}
    </div>
  );
}
