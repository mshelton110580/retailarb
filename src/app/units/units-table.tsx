"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";

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

const BUILTIN_CONDITIONS = [
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

const ALL_COLUMNS = [
  { key: "title",    label: "Title",     sortable: true,  defaultWidth: 260 },
  { key: "order",    label: "Order",     sortable: false, defaultWidth: 140 },
  { key: "tracking", label: "Tracking",  sortable: false, defaultWidth: 130 },
  { key: "category", label: "Category",  sortable: true,  defaultWidth: 140 },
  { key: "condition",label: "Condition", sortable: true,  defaultWidth: 150 },
  { key: "state",    label: "State",     sortable: true,  defaultWidth: 110 },
  { key: "received", label: "Received",  sortable: true,  defaultWidth: 100 },
  { key: "notes",    label: "Notes",     sortable: false, defaultWidth: 200 },
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
  return Object.fromEntries(ALL_COLUMNS.map(c => [c.key, true])) as Record<ColKey, boolean>;
}

function stateColor(state: string) {
  return STATES.find(s => s.value === state)?.color ?? "text-slate-400";
}
function stateLabel(state: string) {
  return STATES.find(s => s.value === state)?.label ?? state;
}

// ─── Inline Condition Cell ───────────────────────────────────────────────────

function ConditionCell({
  unit,
  conditions,
  onUpdated,
}: {
  unit: Unit;
  conditions: string[];
  onUpdated: (unitId: string, condition: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(unit.condition);
  const [newInput, setNewInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [dropPos, setDropPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editing) return;
    function handler(e: MouseEvent) {
      if (
        dropRef.current && !dropRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        setEditing(false);
        setNewInput("");
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [editing]);

  function openDropdown(e: React.MouseEvent) {
    e.stopPropagation();
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    // Position below the trigger, clamped so it doesn't go off the right edge
    const left = Math.min(rect.left, window.innerWidth - 216);
    setDropPos({ top: rect.bottom + 4, left });
    setEditing(true);
  }

  async function save(condition: string) {
    if (condition === value) { setEditing(false); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/units/${unit.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ condition })
      });
      if (res.ok) { setValue(condition); onUpdated(unit.id, condition); }
    } finally { setSaving(false); setEditing(false); setNewInput(""); }
  }

  async function saveNew() {
    const trimmed = newInput.trim();
    if (trimmed) await save(trimmed);
  }

  const filteredConditions = newInput.trim()
    ? conditions.filter(c => c.toLowerCase().includes(newInput.trim().toLowerCase()))
    : conditions;
  const isExactMatch = conditions.some(c => c.toLowerCase() === newInput.trim().toLowerCase());

  const dropdown = editing && dropPos ? createPortal(
    <div
      ref={dropRef}
      style={{ position: "fixed", top: dropPos.top, left: dropPos.left, zIndex: 9999, width: 208 }}
      className="bg-slate-900 border border-slate-600 rounded shadow-xl p-2 space-y-1.5"
      onClick={e => e.stopPropagation()}
    >
      <input
        type="text"
        value={newInput}
        onChange={e => setNewInput(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter") {
            if (filteredConditions.length === 1) save(filteredConditions[0]);
            else if (newInput.trim() && !isExactMatch) saveNew();
            else if (filteredConditions.length > 0) save(filteredConditions[0]);
          }
          if (e.key === "Escape") { setEditing(false); setNewInput(""); }
        }}
        placeholder="Search or add condition…"
        className="w-full rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-xs text-slate-200 placeholder-slate-500"
        autoFocus
      />
      <div className="max-h-48 overflow-y-auto space-y-0.5">
        {filteredConditions.map(c => (
          <button key={c} disabled={saving} onClick={() => save(c)}
            className={`w-full text-left text-xs px-2 py-1 rounded capitalize transition-colors ${
              c === value ? "bg-blue-700 text-white" : "text-slate-300 hover:bg-slate-700"
            }`}>
            {c}
          </button>
        ))}
        {newInput.trim() && !isExactMatch && (
          <button disabled={saving} onClick={saveNew}
            className="w-full text-left text-xs px-2 py-1 rounded text-sky-400 hover:bg-slate-700 transition-colors">
            + Add &ldquo;{newInput.trim()}&rdquo;
          </button>
        )}
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <>
      <span
        ref={triggerRef}
        className={`text-xs capitalize cursor-pointer hover:underline decoration-dotted ${
          value ? "text-slate-400 hover:text-slate-200" : "text-slate-600 italic hover:text-slate-400"
        }`}
        onClick={openDropdown}
        title="Click to change condition"
      >
        {value ?? "No condition"}
      </span>
      {dropdown}
    </>
  );
}

// ─── Inline Category Cell ────────────────────────────────────────────────────

function CategoryCell({
  unit,
  categories,
  onUpdated,
  onCategoryCreated,
}: {
  unit: Unit;
  categories: Category[];
  onUpdated: (unitId: string, category: { id: string; name: string } | null) => void;
  onCategoryCreated: (cat: Category) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(unit.category);
  const [saving, setSaving] = useState(false);
  const [newInput, setNewInput] = useState("");
  const [creating, setCreating] = useState(false);
  const [dropPos, setDropPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editing) return;
    function handler(e: MouseEvent) {
      if (
        dropRef.current && !dropRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        setEditing(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [editing]);

  function openDropdown(e: React.MouseEvent) {
    e.stopPropagation();
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const left = Math.min(rect.left, window.innerWidth - 216);
    setDropPos({ top: rect.bottom + 4, left });
    setEditing(true);
  }

  async function save(categoryId: string | null) {
    const newCat = categoryId ? categories.find(c => c.id === categoryId) ?? null : null;
    const newValue = newCat ? { id: newCat.id, name: newCat.category_name } : null;
    if (categoryId === (value?.id ?? null)) { setEditing(false); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/units/${unit.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId })
      });
      if (res.ok) { setValue(newValue); onUpdated(unit.id, newValue); }
    } finally { setSaving(false); setEditing(false); }
  }

  async function createNew() {
    const trimmed = newInput.trim();
    if (!trimmed) return;
    setCreating(true);
    try {
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed })
      });
      const data = await res.json();
      if (res.ok || res.status === 409) {
        const cat: Category = data.category;
        onCategoryCreated(cat);
        await save(cat.id);
        setNewInput("");
      }
    } finally { setCreating(false); }
  }

  const filteredCategories = newInput.trim()
    ? categories.filter(c => c.category_name.toLowerCase().includes(newInput.trim().toLowerCase()))
    : categories;
  const isExactCatMatch = categories.some(c => c.category_name.toLowerCase() === newInput.trim().toLowerCase());

  const dropdown = editing && dropPos ? createPortal(
    <div
      ref={dropRef}
      style={{ position: "fixed", top: dropPos.top, left: dropPos.left, zIndex: 9999, width: 208 }}
      className="bg-slate-900 border border-slate-600 rounded shadow-xl p-2 space-y-1.5"
      onClick={e => e.stopPropagation()}
    >
      <input
        type="text"
        value={newInput}
        onChange={e => setNewInput(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter") {
            if (filteredCategories.length === 1 && !newInput.trim()) save(filteredCategories[0].id);
            else if (newInput.trim() && !isExactCatMatch) createNew();
            else if (filteredCategories.length === 1) save(filteredCategories[0].id);
          }
          if (e.key === "Escape") { setEditing(false); setNewInput(""); }
        }}
        placeholder="Search or add category…"
        className="w-full rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-xs text-slate-200 placeholder-slate-500"
        autoFocus
      />
      <div className="max-h-48 overflow-y-auto space-y-0.5">
        {!newInput.trim() && (
          <button disabled={saving || creating} onClick={() => save(null)}
            className={`w-full text-left text-xs px-2 py-1 rounded italic transition-colors ${
              !value ? "bg-blue-700 text-white" : "text-slate-500 hover:bg-slate-700"
            }`}>
            Uncategorized
          </button>
        )}
        {filteredCategories.map(c => (
          <button key={c.id} disabled={saving || creating} onClick={() => save(c.id)}
            className={`w-full text-left text-xs px-2 py-1 rounded transition-colors ${
              c.id === value?.id ? "bg-blue-700 text-white" : "text-slate-300 hover:bg-slate-700"
            }`}>
            {c.category_name}
          </button>
        ))}
        {newInput.trim() && !isExactCatMatch && (
          <button disabled={saving || creating} onClick={createNew}
            className="w-full text-left text-xs px-2 py-1 rounded text-sky-400 hover:bg-slate-700 transition-colors">
            {creating ? "Creating…" : `+ Add "${newInput.trim()}"`}
          </button>
        )}
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <>
      <span
        ref={triggerRef}
        className={`text-xs cursor-pointer hover:underline decoration-dotted ${
          value ? "text-slate-300 hover:text-slate-100" : "text-slate-600 italic hover:text-slate-400"
        }`}
        onClick={openDropdown}
        title="Click to change category"
      >
        {value ? value.name : "Uncategorized"}
        {saving && <span className="ml-1 text-slate-500">…</span>}
      </span>
      {dropdown}
    </>
  );
}

// ─── Inline Notes Cell ───────────────────────────────────────────────────────

function NotesCell({
  unit,
  onUpdated,
}: {
  unit: Unit;
  onUpdated: (unitId: string, notes: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(unit.notes ?? "");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); }
  }, [editing]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/units/${unit.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: value })
      });
      if (res.ok) onUpdated(unit.id, value.trim() || null);
    } finally { setSaving(false); setEditing(false); }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); save(); }
    if (e.key === "Escape") { setValue(unit.notes ?? ""); setEditing(false); }
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-1" onClick={e => e.stopPropagation()}>
        <textarea ref={inputRef} value={value} onChange={e => setValue(e.target.value)}
          onKeyDown={handleKeyDown} onBlur={save} rows={2}
          className="w-full rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-200 resize-none"
          placeholder="Notes…" disabled={saving} />
        <div className="text-xs text-slate-600">Enter to save · Esc to cancel</div>
      </div>
    );
  }

  return (
    <span
      className={`text-xs cursor-pointer block truncate ${
        unit.notes ? "text-slate-400 hover:text-slate-200" : "text-slate-700 hover:text-slate-500 italic"
      }`}
      onClick={e => { e.stopPropagation(); setValue(unit.notes ?? ""); setEditing(true); }}
      title={unit.notes ? `${unit.notes} — click to edit` : "Click to add notes"}
    >
      {unit.notes ?? "Add notes…"}
    </span>
  );
}

// ─── New Category Modal ───────────────────────────────────────────────────────

function NewCategoryModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (cat: Category) => void;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed })
      });
      const data = await res.json();
      if (res.ok) {
        onCreated({ id: data.category.id, category_name: data.category.category_name });
        onClose();
      } else if (res.status === 409) {
        onCreated({ id: data.category.id, category_name: data.category.category_name });
        onClose();
      } else {
        setError(data.error ?? "Failed to create category");
      }
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-80 rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-slate-200 mb-3">New Category</h3>
        <input type="text" value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") submit(); if (e.key === "Escape") onClose(); }}
          placeholder="Category name…" autoFocus
          className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 mb-3" />
        {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose}
            className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-800">
            Cancel
          </button>
          <button onClick={submit} disabled={saving || !name.trim()}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40">
            {saving ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Table Component ─────────────────────────────────────────────────────

export default function UnitsTable({ categories: initialCategories }: { categories: Category[] }) {
  const [search, setSearch] = useState("");
  const [trackingScan, setTrackingScan] = useState("");
  const [filterStates, setFilterStates] = useState<string[]>([]);
  const [filterConditions, setFilterConditions] = useState<string[]>([]);
  const [filterCategoryId, setFilterCategoryId] = useState("");
  const [sortBy, setSortBy] = useState("receivedAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [units, setUnits] = useState<Unit[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const LIMIT = 100;

  const [categories, setCategories] = useState<Category[]>(initialCategories);
  const [showNewCategoryModal, setShowNewCategoryModal] = useState(false);
  const [conditions, setConditions] = useState<string[]>(BUILTIN_CONDITIONS);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPanel, setBulkPanel] = useState(false);
  const [bulkCondition, setBulkCondition] = useState("");
  const [bulkCategoryId, setBulkCategoryId] = useState("__unchanged__");
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [newBulkConditionInput, setNewBulkConditionInput] = useState("");
  const [newBulkCategoryInput, setNewBulkCategoryInput] = useState("");
  const [creatingBulkCategory, setCreatingBulkCategory] = useState(false);
  const [bulkConditionSearch, setBulkConditionSearch] = useState("");
  const [bulkCategorySearch, setBulkCategorySearch] = useState("");

  const [colWidths, setColWidths] = useState<Record<ColKey, number>>(
    () => Object.fromEntries(ALL_COLUMNS.map(c => [c.key, c.defaultWidth])) as Record<ColKey, number>
  );
  const [colVisible, setColVisible] = useState<Record<ColKey, boolean>>(
    () => Object.fromEntries(ALL_COLUMNS.map(c => [c.key, true])) as Record<ColKey, boolean>
  );
  const [showColPanel, setShowColPanel] = useState(false);

  useEffect(() => {
    setColWidths(loadWidths());
    setColVisible(loadVisible());
    fetch("/api/units/conditions")
      .then(r => r.json())
      .then(d => { if (d.conditions) setConditions(d.conditions); })
      .catch(() => {});
  }, []);

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
      setColWidths(prev => ({ ...prev, [dragCol.current!]: Math.max(60, dragStartW.current + delta) }));
    }
    function onUp() {
      dragCol.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setColWidths(prev => { localStorage.setItem(LS_WIDTHS, JSON.stringify(prev)); return prev; });
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
    setColWidths(w); setColVisible(v);
    localStorage.setItem(LS_WIDTHS, JSON.stringify(w));
    localStorage.setItem(LS_VISIBLE, JSON.stringify(v));
  }

  const visibleCols = ALL_COLUMNS.filter(c => colVisible[c.key]);
  const colSpan = 1 + visibleCols.length;
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
    } finally { setLoading(false); }
  }, [search, trackingScan, filterStates, filterConditions, filterCategoryId, sortBy, sortDir, offset]);

  useEffect(() => { fetchUnits(true); }, // eslint-disable-next-line react-hooks/exhaustive-deps
  [search, trackingScan, filterStates, filterConditions, filterCategoryId, sortBy, sortDir]);

  useEffect(() => { if (offset > 0) fetchUnits(false); }, // eslint-disable-next-line react-hooks/exhaustive-deps
  [offset]);

  function toggleSort(field: string) {
    if (sortBy === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortBy(field); setSortDir("desc"); }
  }

  function toggleSelectAll() {
    setSelected(selected.size === units.length ? new Set() : new Set(units.map(u => u.id)));
  }

  function toggleSelect(id: string) {
    setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }

  function toggleStateFilter(val: string) {
    setFilterStates(prev => prev.includes(val) ? prev.filter(s => s !== val) : [...prev, val]);
  }

  function toggleConditionFilter(val: string) {
    setFilterConditions(prev => prev.includes(val) ? prev.filter(s => s !== val) : [...prev, val]);
  }

  function handleConditionUpdated(unitId: string, condition: string) {
    setUnits(prev => prev.map(u => u.id === unitId ? { ...u, condition } : u));
    setConditions(prev => {
      const lower = condition.toLowerCase();
      return prev.some(c => c.toLowerCase() === lower) ? prev : [...prev, condition];
    });
  }

  function handleNotesUpdated(unitId: string, notes: string | null) {
    setUnits(prev => prev.map(u => u.id === unitId ? { ...u, notes } : u));
  }

  function handleCategoryUpdated(unitId: string, category: { id: string; name: string } | null) {
    setUnits(prev => prev.map(u => u.id === unitId ? { ...u, category } : u));
  }

  function handleNewCategoryCreated(cat: Category) {
    setCategories(prev => {
      if (prev.some(c => c.id === cat.id)) return prev;
      return [...prev, cat].sort((a, b) => a.category_name.localeCompare(b.category_name));
    });
  }

  function addNewBulkCondition() {
    const trimmed = newBulkConditionInput.trim();
    if (!trimmed) return;
    setConditions(prev => {
      const lower = trimmed.toLowerCase();
      return prev.some(c => c.toLowerCase() === lower) ? prev : [...prev, trimmed];
    });
    setBulkCondition(trimmed);
    setNewBulkConditionInput("");
  }

  async function addNewBulkCategory() {
    const trimmed = newBulkCategoryInput.trim();
    if (!trimmed) return;
    setCreatingBulkCategory(true);
    try {
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed })
      });
      const data = await res.json();
      if (res.ok || res.status === 409) {
        const cat: Category = data.category;
        handleNewCategoryCreated(cat);
        setBulkCategoryId(cat.id);
        setNewBulkCategoryInput("");
      }
    } finally { setCreatingBulkCategory(false); }
  }

  async function applyBulkEdit() {
    if (selected.size === 0) return;
    const updates: Record<string, any> = {};
    if (bulkCondition) updates.condition = bulkCondition;
    if (bulkCategoryId !== "__unchanged__") updates.categoryId = bulkCategoryId === "__none__" ? null : bulkCategoryId;
    if (Object.keys(updates).length === 0) { setBulkMessage({ type: "error", text: "No changes selected." }); return; }
    setBulkLoading(true); setBulkMessage(null);
    try {
      const res = await fetch("/api/units/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unitIds: Array.from(selected), updates })
      });
      const data = await res.json();
      if (res.ok) {
        setBulkMessage({ type: "success", text: `Updated ${data.updated} unit(s).` });
        setSelected(new Set()); setBulkCondition(""); setBulkCategoryId("__unchanged__"); setNewBulkConditionInput(""); setNewBulkCategoryInput(""); setBulkConditionSearch(""); setBulkCategorySearch("");
        fetchUnits(true);
      } else {
        setBulkMessage({ type: "error", text: data.error ?? "Update failed." });
      }
    } catch { setBulkMessage({ type: "error", text: "Network error." }); }
    finally { setBulkLoading(false); }
  }

  function handleTrackingKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") setTrackingScan((e.target as HTMLInputElement).value.trim());
  }

  const SortIcon = ({ field }: { field: string }) => {
    if (sortBy !== field) return <span className="text-slate-600 ml-1">↕</span>;
    return <span className="text-blue-400 ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>;
  };

  const colSortKey: Partial<Record<ColKey, string>> = {
    title: "title", category: "category", condition: "condition", state: "state", received: "receivedAt",
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
        return (
          <CategoryCell
            unit={unit}
            categories={categories}
            onUpdated={handleCategoryUpdated}
            onCategoryCreated={handleNewCategoryCreated}
          />
        );
      case "condition":
        return <ConditionCell unit={unit} conditions={conditions} onUpdated={handleConditionUpdated} />;
      case "state":
        return <span className={`text-xs font-medium ${stateColor(unit.state)}`}>{stateLabel(unit.state)}</span>;
      case "received":
        return <span className="text-xs text-slate-500 whitespace-nowrap">{new Date(unit.receivedAt).toLocaleDateString()}</span>;
      case "notes":
        return <NotesCell unit={unit} onUpdated={handleNotesUpdated} />;
      case "photos":
        return unit.images?.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {unit.images.slice(0, 3).map((img) => (
              <a key={img.id} href={img.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt="Unit photo"
                  className="h-10 w-10 rounded border border-slate-700 object-cover hover:opacity-80 transition-opacity" />
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
      {showNewCategoryModal && (
        <NewCategoryModal onClose={() => setShowNewCategoryModal(false)} onCreated={handleNewCategoryCreated} />
      )}

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
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-slate-400">Category</label>
              <button onClick={() => setShowNewCategoryModal(true)}
                className="text-xs text-blue-400 hover:text-blue-300">+ New</button>
            </div>
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
              {conditions.map(c => (
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
                  <input type="text" value={bulkConditionSearch}
                    onChange={e => setBulkConditionSearch(e.target.value)}
                    placeholder="Search conditions…"
                    className="w-full rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-xs text-slate-200 placeholder-slate-500 mb-1" />
                  <div className="max-h-32 overflow-y-auto rounded border border-slate-700 bg-slate-950 mb-2 space-y-0.5 p-1">
                    <button onClick={() => { setBulkCondition(""); setBulkConditionSearch(""); }}
                      className={`w-full text-left text-xs px-2 py-1 rounded transition-colors ${bulkCondition === "" ? "bg-blue-700 text-white" : "text-slate-500 hover:bg-slate-800 italic"}`}>
                      — no change —
                    </button>
                    {conditions
                      .filter(c => !bulkConditionSearch.trim() || c.toLowerCase().includes(bulkConditionSearch.toLowerCase()))
                      .map(c => (
                        <button key={c} onClick={() => { setBulkCondition(c); setBulkConditionSearch(""); }}
                          className={`w-full text-left text-xs px-2 py-1 rounded capitalize transition-colors ${bulkCondition === c ? "bg-blue-700 text-white" : "text-slate-300 hover:bg-slate-800"}`}>
                          {c}
                        </button>
                      ))
                    }
                  </div>
                  <div className="flex gap-1.5">
                    <input type="text" value={newBulkConditionInput}
                      onChange={e => setNewBulkConditionInput(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") addNewBulkCondition(); }}
                      placeholder="New condition…"
                      className="flex-1 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-200 placeholder-slate-600" />
                    <button onClick={addNewBulkCondition} disabled={!newBulkConditionInput.trim()}
                      className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-40">
                      Add
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Set Category</label>
                  <input type="text" value={bulkCategorySearch}
                    onChange={e => setBulkCategorySearch(e.target.value)}
                    placeholder="Search categories…"
                    className="w-full rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-xs text-slate-200 placeholder-slate-500 mb-1" />
                  <div className="max-h-32 overflow-y-auto rounded border border-slate-700 bg-slate-950 mb-2 space-y-0.5 p-1">
                    {!bulkCategorySearch.trim() && (
                      <>
                        <button onClick={() => { setBulkCategoryId("__unchanged__"); setBulkCategorySearch(""); }}
                          className={`w-full text-left text-xs px-2 py-1 rounded transition-colors ${bulkCategoryId === "__unchanged__" ? "bg-blue-700 text-white" : "text-slate-500 hover:bg-slate-800 italic"}`}>
                          — no change —
                        </button>
                        <button onClick={() => { setBulkCategoryId("__none__"); setBulkCategorySearch(""); }}
                          className={`w-full text-left text-xs px-2 py-1 rounded transition-colors ${bulkCategoryId === "__none__" ? "bg-blue-700 text-white" : "text-slate-500 hover:bg-slate-800 italic"}`}>
                          Remove category
                        </button>
                      </>
                    )}
                    {categories
                      .filter(c => !bulkCategorySearch.trim() || c.category_name.toLowerCase().includes(bulkCategorySearch.toLowerCase()))
                      .map(c => (
                        <button key={c.id} onClick={() => { setBulkCategoryId(c.id); setBulkCategorySearch(""); }}
                          className={`w-full text-left text-xs px-2 py-1 rounded transition-colors ${bulkCategoryId === c.id ? "bg-blue-700 text-white" : "text-slate-300 hover:bg-slate-800"}`}>
                          {c.category_name}
                        </button>
                      ))
                    }
                  </div>
                  <div className="flex gap-1.5">
                    <input type="text" value={newBulkCategoryInput}
                      onChange={e => setNewBulkCategoryInput(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") addNewBulkCategory(); }}
                      placeholder="New category…"
                      className="flex-1 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-200 placeholder-slate-600" />
                    <button onClick={addNewBulkCategory} disabled={creatingBulkCategory || !newBulkCategoryInput.trim()}
                      className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-40">
                      {creatingBulkCategory ? "…" : "Add"}
                    </button>
                  </div>
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
            {visibleCols.map(col => <col key={col.key} style={{ width: colWidths[col.key] }} />)}
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
                  <th key={col.key} className="px-3 py-3 relative select-none" style={{ overflow: "hidden" }}>
                    <div className="flex items-center gap-1 overflow-hidden">
                      <span
                        className={sortField ? "cursor-pointer hover:text-slate-300 truncate" : "truncate"}
                        onClick={sortField ? () => toggleSort(sortField) : undefined}
                        title={col.label}
                      >
                        {col.label}{sortField && <SortIcon field={sortField} />}
                      </span>
                    </div>
                    <div className="absolute right-0 top-0 h-full w-2 cursor-col-resize hover:bg-blue-500/30 active:bg-blue-500/50 group"
                      onMouseDown={e => onResizeMouseDown(e, col.key)} title="Drag to resize">
                      <div className="absolute right-0.5 top-1/4 h-1/2 w-px bg-slate-600 group-hover:bg-blue-400" />
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {loading && units.length === 0 ? (
              <tr><td colSpan={colSpan} className="px-3 py-8 text-center text-slate-500 text-sm">Loading...</td></tr>
            ) : units.length === 0 ? (
              <tr><td colSpan={colSpan} className="px-3 py-8 text-center text-slate-500 text-sm">No units found.</td></tr>
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
