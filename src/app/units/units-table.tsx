"use client";

import { useState, useEffect, useRef, useCallback } from "react";

type Category = { id: string; category_name: string };

type Unit = {
  id: string;
  orderId: string;
  itemId: string;
  unitIndex: number;
  condition: string;
  state: string;
  receivedAt: string;
  notes: string | null;
  category: { id: string; name: string } | null;
  title: string;
  trackingNumbers: string[];
  images: Array<{ id: string; url: string }>;
};

const STATES = [
  { value: "on_hand", label: "On Hand", color: "text-green-400" },
  { value: "to_be_returned", label: "To Return", color: "text-yellow-400" },
  { value: "parts_repair", label: "Parts/Repair", color: "text-red-400" },
  { value: "returned", label: "Returned", color: "text-slate-500" },
];

const CONDITIONS = [
  "good", "new", "like_new", "acceptable", "excellent",
  "pressure mark", "damaged", "wrong_item", "missing_parts",
  "defective", "dim power/ glitchy", "no power", "cracked screen",
  "water damage", "parts only"
];

const SORT_FIELDS = [
  { value: "receivedAt", label: "Received Date" },
  { value: "title", label: "Title" },
  { value: "condition", label: "Condition" },
  { value: "state", label: "State" },
  { value: "category", label: "Category" },
];

// All available columns, in display order
const ALL_COLUMNS = [
  { key: "title",    label: "Title",     sortable: true,  defaultWidth: 260 },
  { key: "order",    label: "Order",     sortable: false, defaultWidth: 140 },
  { key: "tracking", label: "Tracking",  sortable: false, defaultWidth: 130 },
  { key: "category", label: "Category",  sortable: true,  defaultWidth: 140 },
  { key: "condition",label: "Condition", sortable: true,  defaultWidth: 120 },
  { key: "state",    label: "State",     sortable: true,  defaultWidth: 110 },
  { key: "received", label: "Received",  sortable: true,  defaultWidth: 100 },
  { key: "notes",    label: "Notes",     sortable: false, defaultWidth: 160 },
  { key: "photos",   label: "Photos",    sortable: false, defaultWidth: 120 },
] as const;

type ColKey = (typeof ALL_COLUMNS)[number]["key"];

const LS_WIDTHS = "units_col_widths";
const LS_VISIBLE = "units_col_visible";

function loadWidths(): Record<ColKey, number> {
  try {
    const v = localStorage.getItem(LS_WIDTHS);
    if (v) return JSON.parse(v);
  } catch {}
  return Object.fromEntries(ALL_COLUMNS.map(c => [c.key, c.defaultWidth])) as Record<ColKey, number>;
}

function loadVisible(): Record<ColKey, boolean> {
  try {
    const v = localStorage.getItem(LS_VISIBLE);
    if (v) return JSON.parse(v);
  } catch {}
  // all visible by default
  return Object.fromEntries(ALL_COLUMNS.map(c => [c.key, true])) as Record<ColKey, boolean>;
}

function stateColor(state: string) {
  return STATES.find(s => s.value === state)?.color ?? "text-slate-400";
}
function stateLabel(state: string) {
  return STATES.find(s => s.value === state)?.label ?? state;
}

export default function UnitsTable({ categories }: { categories: Category[] }) {
  // Filters
  const [search, setSearch] = useState("");
  const [trackingScan, setTrackingScan] = useState("");
  const [filterStates, setFilterStates] = useState<string[]>([]);
  const [filterConditions, setFilterConditions] = useState<string[]>([]);
  const [filterCategoryId, setFilterCategoryId] = useState("");
  const [sortBy, setSortBy] = useState("receivedAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Data
  const [units, setUnits] = useState<Unit[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const LIMIT = 100;

  // Selection
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Bulk edit
  const [bulkPanel, setBulkPanel] = useState(false);
  const [bulkCondition, setBulkCondition] = useState("");
  const [bulkCategoryId, setBulkCategoryId] = useState("__unchanged__");
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Column widths & visibility (loaded from localStorage after mount)
  const [colWidths, setColWidths] = useState<Record<ColKey, number>>(
    () => Object.fromEntries(ALL_COLUMNS.map(c => [c.key, c.defaultWidth])) as Record<ColKey, number>
  );
  const [colVisible, setColVisible] = useState<Record<ColKey, boolean>>(
    () => Object.fromEntries(ALL_COLUMNS.map(c => [c.key, true])) as Record<ColKey, boolean>
  );
  const [showColPanel, setShowColPanel] = useState(false);

  // Load persisted prefs on mount
  useEffect(() => {
    setColWidths(loadWidths());
    setColVisible(loadVisible());
  }, []);

  // Drag-resize state
  const dragCol = useRef<ColKey | null>(null);
  const dragStartX = useRef(0);
  const dragStartW = useRef(0);

  function onResizeMouseDown(e: React.MouseEvent, col: ColKey) {
    e.preventDefault();
    e.stopPropagation();
    dragCol.current = col;
    dragStartX.current = e.clientX;
    dragStartW.current = colWidths[col];

    function onMove(ev: MouseEvent) {
      if (!dragCol.current) return;
      const delta = ev.clientX - dragStartX.current;
      const newW = Math.max(60, dragStartW.current + delta);
      setColWidths(prev => ({ ...prev, [dragCol.current!]: newW }));
    }
    function onUp() {
      dragCol.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      // Persist
      setColWidths(prev => {
        localStorage.setItem(LS_WIDTHS, JSON.stringify(prev));
        return prev;
      });
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function toggleColVisible(key: ColKey) {
    setColVisible(prev => {
      const next = { ...prev, [key]: !prev[key] };
      localStorage.setItem(LS_VISIBLE, JSON.stringify(next));
      return next;
    });
  }

  function resetColumns() {
    const w = Object.fromEntries(ALL_COLUMNS.map(c => [c.key, c.defaultWidth])) as Record<ColKey, number>;
    const v = Object.fromEntries(ALL_COLUMNS.map(c => [c.key, true])) as Record<ColKey, boolean>;
    setColWidths(w);
    setColVisible(v);
    localStorage.setItem(LS_WIDTHS, JSON.stringify(w));
    localStorage.setItem(LS_VISIBLE, JSON.stringify(v));
  }

  const visibleCols = ALL_COLUMNS.filter(c => colVisible[c.key]);
  const colSpan = 1 + visibleCols.length; // +1 for checkbox

  // Barcode scan input ref
  const trackingRef = useRef<HTMLInputElement>(null);

  const fetchUnits = useCallback(async (resetOffset = false) => {
    setLoading(true);
    const currentOffset = resetOffset ? 0 : offset;
    if (resetOffset) setOffset(0);

    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (trackingScan) params.set("tracking", trackingScan);
    if (filterStates.length) params.set("state", filterStates.join(","));
    if (filterConditions.length) params.set("condition", filterConditions.join(","));
    if (filterCategoryId) params.set("categoryId", filterCategoryId);
    params.set("sortBy", sortBy);
    params.set("sortDir", sortDir);
    params.set("limit", String(LIMIT));
    params.set("offset", String(currentOffset));

    try {
      const res = await fetch(`/api/units?${params}`);
      const data = await res.json();
      setUnits(data.units ?? []);
      setTotal(data.total ?? 0);
    } finally {
      setLoading(false);
    }
  }, [search, trackingScan, filterStates, filterConditions, filterCategoryId, sortBy, sortDir, offset]);

  useEffect(() => {
    fetchUnits(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, trackingScan, filterStates, filterConditions, filterCategoryId, sortBy, sortDir]);

  useEffect(() => {
    if (offset > 0) fetchUnits(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset]);

  function toggleSort(field: string) {
    if (sortBy === field) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortDir("desc");
    }
  }

  function toggleSelectAll() {
    if (selected.size === units.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(units.map(u => u.id)));
    }
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleStateFilter(val: string) {
    setFilterStates(prev =>
      prev.includes(val) ? prev.filter(s => s !== val) : [...prev, val]
    );
  }

  function toggleConditionFilter(val: string) {
    setFilterConditions(prev =>
      prev.includes(val) ? prev.filter(s => s !== val) : [...prev, val]
    );
  }

  async function applyBulkEdit() {
    if (selected.size === 0) return;
    const updates: Record<string, any> = {};
    if (bulkCondition) updates.condition = bulkCondition;
    if (bulkCategoryId !== "__unchanged__") {
      updates.categoryId = bulkCategoryId === "__none__" ? null : bulkCategoryId;
    }
    if (Object.keys(updates).length === 0) {
      setBulkMessage({ type: "error", text: "No changes selected." });
      return;
    }
    setBulkLoading(true);
    setBulkMessage(null);
    try {
      const res = await fetch("/api/units/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unitIds: Array.from(selected), updates })
      });
      const data = await res.json();
      if (res.ok) {
        setBulkMessage({ type: "success", text: `Updated ${data.updated} unit(s).` });
        setSelected(new Set());
        setBulkCondition("");
        setBulkCategoryId("__unchanged__");
        fetchUnits(true);
      } else {
        setBulkMessage({ type: "error", text: data.error ?? "Update failed." });
      }
    } catch {
      setBulkMessage({ type: "error", text: "Network error." });
    } finally {
      setBulkLoading(false);
    }
  }

  function handleTrackingKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      setTrackingScan((e.target as HTMLInputElement).value.trim());
    }
  }

  const SortIcon = ({ field }: { field: string }) => {
    if (sortBy !== field) return <span className="text-slate-600 ml-1">↕</span>;
    return <span className="text-blue-400 ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>;
  };

  // Map col key -> sort field name
  const colSortKey: Partial<Record<ColKey, string>> = {
    title: "title", category: "category", condition: "condition",
    state: "state", received: "receivedAt",
  };

  function renderCell(col: ColKey, unit: Unit) {
    switch (col) {
      case "title":
        return (
          <>
            <div className="truncate text-slate-300 font-medium" title={unit.title}>{unit.title}</div>
            <div className="text-xs text-slate-500">Unit #{unit.unitIndex}</div>
          </>
        );
      case "order":
        return (
          <a href={`/orders/${unit.orderId}`} className="font-mono text-xs text-blue-400 hover:underline"
            onClick={e => e.stopPropagation()}>
            {unit.orderId}
          </a>
        );
      case "tracking":
        return unit.trackingNumbers.length > 0 ? (
          <div className="space-y-0.5">
            {unit.trackingNumbers.slice(0, 2).map((t, i) => (
              <div key={i} className="font-mono text-xs text-slate-500 truncate" title={t}>…{t.slice(-12)}</div>
            ))}
            {unit.trackingNumbers.length > 2 && (
              <div className="text-xs text-slate-600">+{unit.trackingNumbers.length - 2} more</div>
            )}
          </div>
        ) : <span className="text-xs text-slate-600">—</span>;
      case "category":
        return unit.category
          ? <span className="text-xs text-slate-300">{unit.category.name}</span>
          : <span className="text-xs text-slate-600 italic">Uncategorized</span>;
      case "condition":
        return <span className="text-xs capitalize text-slate-400">{unit.condition}</span>;
      case "state":
        return <span className={`text-xs font-medium ${stateColor(unit.state)}`}>{stateLabel(unit.state)}</span>;
      case "received":
        return <span className="text-xs text-slate-500 whitespace-nowrap">{new Date(unit.receivedAt).toLocaleDateString()}</span>;
      case "notes":
        return unit.notes
          ? <span className="text-xs text-slate-400 truncate block" title={unit.notes}>{unit.notes}</span>
          : <span className="text-xs text-slate-700">—</span>;
      case "photos":
        return unit.images?.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {unit.images.slice(0, 3).map((img) => (
              <a key={img.id} href={img.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.url}
                  alt="Unit photo"
                  className="h-10 w-10 rounded border border-slate-700 object-cover hover:opacity-80 transition-opacity"
                />
              </a>
            ))}
            {unit.images.length > 3 && (
              <span className="flex h-10 w-10 items-center justify-center rounded border border-slate-700 text-xs text-slate-500">
                +{unit.images.length - 3}
              </span>
            )}
          </div>
        ) : <span className="text-xs text-slate-700">—</span>;
    }
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Search (title, order, condition, notes)</label>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-300 placeholder-slate-600" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Tracking number / barcode scan</label>
            <div className="flex gap-2">
              <input ref={trackingRef} type="text" defaultValue={trackingScan} onKeyDown={handleTrackingKey}
                placeholder="Scan or type tracking..."
                className="flex-1 rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-300 placeholder-slate-600" />
              {trackingScan && (
                <button onClick={() => { setTrackingScan(""); if (trackingRef.current) trackingRef.current.value = ""; }}
                  className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:bg-slate-800">Clear</button>
              )}
            </div>
            {trackingScan && <p className="text-xs text-blue-400 mt-1">Filtering: …{trackingScan.slice(-12)}</p>}
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Category</label>
            <select value={filterCategoryId} onChange={e => setFilterCategoryId(e.target.value)}
              className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-300">
              <option value="">All categories</option>
              <option value="none">Uncategorized</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.category_name}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Inventory State</label>
            <div className="flex flex-wrap gap-2">
              {STATES.map(s => (
                <button key={s.value} onClick={() => toggleStateFilter(s.value)}
                  className={`rounded px-2.5 py-1 text-xs font-medium border transition-colors ${
                    filterStates.includes(s.value) ? "border-blue-600 bg-blue-900/40 text-blue-300" : "border-slate-700 text-slate-400 hover:bg-slate-800"}`}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Condition</label>
            <div className="flex flex-wrap gap-1.5">
              {CONDITIONS.map(c => (
                <button key={c} onClick={() => toggleConditionFilter(c)}
                  className={`rounded px-2 py-0.5 text-xs border transition-colors capitalize ${
                    filterConditions.includes(c) ? "border-blue-600 bg-blue-900/40 text-blue-300" : "border-slate-700 text-slate-400 hover:bg-slate-800"}`}>
                  {c}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-1 border-t border-slate-800">
          <span className="text-xs text-slate-500">Sort by:</span>
          {SORT_FIELDS.map(f => (
            <button key={f.value} onClick={() => toggleSort(f.value)}
              className={`text-xs px-2 py-1 rounded border ${sortBy === f.value ? "border-blue-600 bg-blue-900/40 text-blue-300" : "border-slate-700 text-slate-500 hover:bg-slate-800"}`}>
              {f.label}<SortIcon field={f.value} />
            </button>
          ))}

          {/* Columns button */}
          <div className="relative ml-auto">
            <button onClick={() => setShowColPanel(p => !p)}
              className={`text-xs px-2.5 py-1 rounded border flex items-center gap-1.5 ${showColPanel ? "border-slate-500 bg-slate-800 text-slate-200" : "border-slate-700 text-slate-400 hover:bg-slate-800"}`}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7" />
              </svg>
              Columns
            </button>
            {showColPanel && (
              <div className="absolute right-0 top-full mt-1 z-50 w-52 rounded-lg border border-slate-700 bg-slate-900 shadow-xl p-3 space-y-1">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-slate-300">Show / Hide Columns</span>
                  <button onClick={resetColumns} className="text-xs text-slate-500 hover:text-slate-300">Reset</button>
                </div>
                {ALL_COLUMNS.map(col => (
                  <label key={col.key} className="flex items-center gap-2 cursor-pointer py-0.5">
                    <input type="checkbox" checked={colVisible[col.key]} onChange={() => toggleColVisible(col.key)}
                      className="rounded" />
                    <span className="text-xs text-slate-300">{col.label}</span>
                    <span className="ml-auto text-xs text-slate-600">{colWidths[col.key]}px</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <span className="text-xs text-slate-500">
            {loading ? "Loading..." : `${total.toLocaleString()} units`}
          </span>
        </div>
      </div>

      {/* Bulk edit panel */}
      {selected.size > 0 && (
        <div className="rounded-lg border border-blue-800 bg-blue-900/20 p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-blue-300">
              {selected.size} unit{selected.size !== 1 ? "s" : ""} selected
            </span>
            <div className="flex gap-2">
              <button onClick={() => setBulkPanel(p => !p)}
                className="rounded bg-blue-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-600">
                {bulkPanel ? "Hide Edit" : "Bulk Edit"}
              </button>
              <button onClick={() => setSelected(new Set())}
                className="rounded border border-slate-600 px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-800">
                Clear
              </button>
            </div>
          </div>
          {bulkPanel && (
            <div className="space-y-3">
              {bulkMessage && (
                <div className={`rounded p-2 text-xs ${bulkMessage.type === "success" ? "bg-green-900/30 border border-green-700 text-green-300" : "bg-red-900/30 border border-red-700 text-red-300"}`}>
                  {bulkMessage.text}
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Set Condition</label>
                  <p className="text-xs text-slate-500 mb-1">State recalculates from condition + return status.</p>
                  <select value={bulkCondition} onChange={e => setBulkCondition(e.target.value)}
                    className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-300">
                    <option value="">— no change —</option>
                    {CONDITIONS.map(c => <option key={c} value={c} className="capitalize">{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Set Category</label>
                  <select value={bulkCategoryId} onChange={e => setBulkCategoryId(e.target.value)}
                    className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-300">
                    <option value="__unchanged__">— no change —</option>
                    <option value="__none__">Remove category</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.category_name}</option>)}
                  </select>
                </div>
              </div>
              <button onClick={applyBulkEdit} disabled={bulkLoading}
                className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {bulkLoading ? "Applying..." : `Apply to ${selected.size} unit${selected.size !== 1 ? "s" : ""}`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border border-slate-800 bg-slate-900 overflow-x-auto">
        <table className="text-sm" style={{ tableLayout: "fixed", width: Math.max(36 + visibleCols.reduce((s, c) => s + colWidths[c.key], 0), 600) }}>
          <colgroup>
            <col style={{ width: 36 }} />
            {visibleCols.map(col => (
              <col key={col.key} style={{ width: colWidths[col.key] }} />
            ))}
          </colgroup>
          <thead className="border-b border-slate-800">
            <tr className="text-left text-xs font-medium text-slate-400">
              <th className="px-3 py-3">
                <input type="checkbox"
                  checked={units.length > 0 && selected.size === units.length}
                  onChange={toggleSelectAll} className="rounded" />
              </th>
              {visibleCols.map(col => {
                const sortField = colSortKey[col.key];
                return (
                  <th key={col.key} className="px-3 py-3 relative select-none"
                    style={{ overflow: "hidden" }}>
                    <div className="flex items-center gap-1 overflow-hidden">
                      <span
                        className={sortField ? "cursor-pointer hover:text-slate-300 truncate" : "truncate"}
                        onClick={sortField ? () => toggleSort(sortField) : undefined}
                        title={col.label}
                      >
                        {col.label}
                        {sortField && <SortIcon field={sortField} />}
                      </span>
                    </div>
                    {/* Resize handle */}
                    <div
                      className="absolute right-0 top-0 h-full w-2 cursor-col-resize hover:bg-blue-500/30 active:bg-blue-500/50 group"
                      onMouseDown={e => onResizeMouseDown(e, col.key)}
                      title="Drag to resize"
                    >
                      <div className="absolute right-0.5 top-1/4 h-1/2 w-px bg-slate-600 group-hover:bg-blue-400" />
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {loading && units.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className="px-3 py-8 text-center text-slate-500 text-sm">Loading...</td>
              </tr>
            ) : units.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className="px-3 py-8 text-center text-slate-500 text-sm">No units found.</td>
              </tr>
            ) : (
              units.map(unit => (
                <tr key={unit.id}
                  className={`hover:bg-slate-800/50 transition-colors cursor-pointer ${selected.has(unit.id) ? "bg-blue-900/20" : ""}`}
                  onClick={() => toggleSelect(unit.id)}>
                  <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(unit.id)}
                      onChange={() => toggleSelect(unit.id)} className="rounded" />
                  </td>
                  {visibleCols.map(col => (
                    <td key={col.key} className="px-3 py-2.5 overflow-hidden">
                      {renderCell(col.key, unit)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > LIMIT && (
        <div className="flex items-center justify-between text-sm text-slate-400">
          <span>Showing {offset + 1}–{Math.min(offset + LIMIT, total)} of {total.toLocaleString()}</span>
          <div className="flex gap-2">
            <button onClick={() => setOffset(Math.max(0, offset - LIMIT))} disabled={offset === 0}
              className="rounded border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-800 disabled:opacity-40">Previous</button>
            <button onClick={() => setOffset(offset + LIMIT)} disabled={offset + LIMIT >= total}
              className="rounded border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-800 disabled:opacity-40">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
