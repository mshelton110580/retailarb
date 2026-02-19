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
  const [bulkState, setBulkState] = useState("");
  const [bulkCondition, setBulkCondition] = useState("");
  const [bulkCategoryId, setBulkCategoryId] = useState("__unchanged__");
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

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

  // Fetch on filter/sort change (reset to page 0)
  useEffect(() => {
    fetchUnits(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, trackingScan, filterStates, filterConditions, filterCategoryId, sortBy, sortDir]);

  // Fetch on page change
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
    if (bulkState) updates.state = bulkState;
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
        setBulkState("");
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

  // Tracking scan: auto-submit on Enter or after ~300ms pause (barcode scanners send Enter)
  function handleTrackingKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      setTrackingScan((e.target as HTMLInputElement).value.trim());
    }
  }

  const SortIcon = ({ field }: { field: string }) => {
    if (sortBy !== field) return <span className="text-slate-600 ml-1">↕</span>;
    return <span className="text-blue-400 ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>;
  };

  return (
    <div className="space-y-4">
      {/* Filters Row */}
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Text search */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Search (title, order, condition, notes)</label>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-300 placeholder-slate-600"
            />
          </div>

          {/* Tracking scan */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Tracking number / barcode scan</label>
            <div className="flex gap-2">
              <input
                ref={trackingRef}
                type="text"
                defaultValue={trackingScan}
                onKeyDown={handleTrackingKey}
                placeholder="Scan or type tracking..."
                className="flex-1 rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-300 placeholder-slate-600"
              />
              {trackingScan && (
                <button
                  onClick={() => { setTrackingScan(""); if (trackingRef.current) trackingRef.current.value = ""; }}
                  className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:bg-slate-800"
                >
                  Clear
                </button>
              )}
            </div>
            {trackingScan && (
              <p className="text-xs text-blue-400 mt-1">Filtering: …{trackingScan.slice(-12)}</p>
            )}
          </div>

          {/* Category filter */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Category</label>
            <select
              value={filterCategoryId}
              onChange={e => setFilterCategoryId(e.target.value)}
              className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-300"
            >
              <option value="">All categories</option>
              <option value="none">Uncategorized</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.category_name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* State filter */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Inventory State</label>
            <div className="flex flex-wrap gap-2">
              {STATES.map(s => (
                <button
                  key={s.value}
                  onClick={() => toggleStateFilter(s.value)}
                  className={`rounded px-2.5 py-1 text-xs font-medium border transition-colors ${
                    filterStates.includes(s.value)
                      ? "border-blue-600 bg-blue-900/40 text-blue-300"
                      : "border-slate-700 text-slate-400 hover:bg-slate-800"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Condition filter */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Condition</label>
            <div className="flex flex-wrap gap-1.5">
              {CONDITIONS.map(c => (
                <button
                  key={c}
                  onClick={() => toggleConditionFilter(c)}
                  className={`rounded px-2 py-0.5 text-xs border transition-colors capitalize ${
                    filterConditions.includes(c)
                      ? "border-blue-600 bg-blue-900/40 text-blue-300"
                      : "border-slate-700 text-slate-400 hover:bg-slate-800"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Sort controls */}
        <div className="flex items-center gap-3 pt-1 border-t border-slate-800">
          <span className="text-xs text-slate-500">Sort by:</span>
          {SORT_FIELDS.map(f => (
            <button
              key={f.value}
              onClick={() => toggleSort(f.value)}
              className={`text-xs px-2 py-1 rounded border ${
                sortBy === f.value
                  ? "border-blue-600 bg-blue-900/40 text-blue-300"
                  : "border-slate-700 text-slate-500 hover:bg-slate-800"
              }`}
            >
              {f.label}<SortIcon field={f.value} />
            </button>
          ))}
          <span className="ml-auto text-xs text-slate-500">
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
              <button
                onClick={() => setBulkPanel(p => !p)}
                className="rounded bg-blue-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-600"
              >
                {bulkPanel ? "Hide Edit" : "Bulk Edit"}
              </button>
              <button
                onClick={() => setSelected(new Set())}
                className="rounded border border-slate-600 px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-800"
              >
                Clear
              </button>
            </div>
          </div>

          {bulkPanel && (
            <div className="space-y-3">
              {bulkMessage && (
                <div className={`rounded p-2 text-xs ${
                  bulkMessage.type === "success"
                    ? "bg-green-900/30 border border-green-700 text-green-300"
                    : "bg-red-900/30 border border-red-700 text-red-300"
                }`}>
                  {bulkMessage.text}
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Set State</label>
                  <select
                    value={bulkState}
                    onChange={e => setBulkState(e.target.value)}
                    className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-300"
                  >
                    <option value="">— no change —</option>
                    {STATES.map(s => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Set Condition</label>
                  <select
                    value={bulkCondition}
                    onChange={e => setBulkCondition(e.target.value)}
                    className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-300"
                  >
                    <option value="">— no change —</option>
                    {CONDITIONS.map(c => (
                      <option key={c} value={c} className="capitalize">{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Set Category</label>
                  <select
                    value={bulkCategoryId}
                    onChange={e => setBulkCategoryId(e.target.value)}
                    className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-300"
                  >
                    <option value="__unchanged__">— no change —</option>
                    <option value="__none__">Remove category</option>
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>{c.category_name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <button
                onClick={applyBulkEdit}
                disabled={bulkLoading}
                className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {bulkLoading ? "Applying..." : `Apply to ${selected.size} unit${selected.size !== 1 ? "s" : ""}`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border border-slate-800 bg-slate-900 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-800">
            <tr className="text-left text-xs font-medium text-slate-400">
              <th className="px-3 py-3 w-8">
                <input
                  type="checkbox"
                  checked={units.length > 0 && selected.size === units.length}
                  onChange={toggleSelectAll}
                  className="rounded"
                />
              </th>
              <th className="px-3 py-3 cursor-pointer hover:text-slate-300" onClick={() => toggleSort("title")}>
                Title <SortIcon field="title" />
              </th>
              <th className="px-3 py-3">Order</th>
              <th className="px-3 py-3">Tracking</th>
              <th className="px-3 py-3 cursor-pointer hover:text-slate-300" onClick={() => toggleSort("category")}>
                Category <SortIcon field="category" />
              </th>
              <th className="px-3 py-3 cursor-pointer hover:text-slate-300" onClick={() => toggleSort("condition")}>
                Condition <SortIcon field="condition" />
              </th>
              <th className="px-3 py-3 cursor-pointer hover:text-slate-300" onClick={() => toggleSort("state")}>
                State <SortIcon field="state" />
              </th>
              <th className="px-3 py-3 cursor-pointer hover:text-slate-300" onClick={() => toggleSort("receivedAt")}>
                Received <SortIcon field="receivedAt" />
              </th>
              <th className="px-3 py-3">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {loading && units.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-slate-500 text-sm">
                  Loading...
                </td>
              </tr>
            ) : units.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-slate-500 text-sm">
                  No units found.
                </td>
              </tr>
            ) : (
              units.map(unit => (
                <tr
                  key={unit.id}
                  className={`hover:bg-slate-800/50 transition-colors ${selected.has(unit.id) ? "bg-blue-900/20" : ""}`}
                  onClick={() => toggleSelect(unit.id)}
                  style={{ cursor: "pointer" }}
                >
                  <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected.has(unit.id)}
                      onChange={() => toggleSelect(unit.id)}
                      className="rounded"
                    />
                  </td>
                  <td className="px-3 py-2.5 max-w-xs">
                    <div className="truncate text-slate-300 font-medium" title={unit.title}>
                      {unit.title}
                    </div>
                    <div className="text-xs text-slate-500">Unit #{unit.unitIndex}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    <a
                      href={`/orders/${unit.orderId}`}
                      className="font-mono text-xs text-blue-400 hover:underline"
                      onClick={e => e.stopPropagation()}
                    >
                      {unit.orderId}
                    </a>
                  </td>
                  <td className="px-3 py-2.5">
                    {unit.trackingNumbers.length > 0 ? (
                      <div className="space-y-0.5">
                        {unit.trackingNumbers.slice(0, 2).map((t, i) => (
                          <div key={i} className="font-mono text-xs text-slate-500 truncate max-w-[120px]" title={t}>
                            …{t.slice(-12)}
                          </div>
                        ))}
                        {unit.trackingNumbers.length > 2 && (
                          <div className="text-xs text-slate-600">+{unit.trackingNumbers.length - 2} more</div>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-600">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {unit.category ? (
                      <span className="text-xs text-slate-300">{unit.category.name}</span>
                    ) : (
                      <span className="text-xs text-slate-600 italic">Uncategorized</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="text-xs capitalize text-slate-400">{unit.condition}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`text-xs font-medium ${stateColor(unit.state)}`}>
                      {stateLabel(unit.state)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-500 whitespace-nowrap">
                    {new Date(unit.receivedAt).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2.5 max-w-[150px]">
                    {unit.notes ? (
                      <span className="text-xs text-slate-400 truncate block" title={unit.notes}>
                        {unit.notes}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-700">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > LIMIT && (
        <div className="flex items-center justify-between text-sm text-slate-400">
          <span>
            Showing {offset + 1}–{Math.min(offset + LIMIT, total)} of {total.toLocaleString()}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setOffset(Math.max(0, offset - LIMIT))}
              disabled={offset === 0}
              className="rounded border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-800 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              onClick={() => setOffset(offset + LIMIT)}
              disabled={offset + LIMIT >= total}
              className="rounded border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-800 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
