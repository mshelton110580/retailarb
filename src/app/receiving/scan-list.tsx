"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ReceivedUnit = {
  id: string;
  unitIndex: number;
  title: string;
  condition: string;
  receivedAt: string;
  notes: string | null;
  category: { id: string; name: string } | null;
};

type MatchedOrder = {
  orderId: string;
  shipmentId: string | null;
  items: Array<{ title: string; itemId: string; qty: number; price: string }>;
  checkedIn: boolean;
  expectedUnits: number;
  scannedUnits: number;
  scanStatus: string | null;
  isLot: boolean;
  lotSize: number | null;
  orderQty: number;
  receivedUnits: ReceivedUnit[];
};

export type ScanEntry =
  | {
      source: "scan";
      trackingLast8: string;
      date: string;
      scanIds: string[];
      scannedBy: string;
      notes: string | null;
      resolutionState: string;
      scanCount: number;
      matchedOrders: MatchedOrder[];
    }
  | {
      source: "import";
      trackingLast8: string;
      date: string;
      matchedOrders: MatchedOrder[];
    };

const conditionColors: Record<string, string> = {
  good: "bg-green-900 text-green-300",
  new_sealed: "bg-blue-900 text-blue-300",
  like_new: "bg-cyan-900 text-cyan-300",
  acceptable: "bg-yellow-900 text-yellow-300",
  damaged: "bg-red-900 text-red-300",
  wrong_item: "bg-orange-900 text-orange-300",
  missing_parts: "bg-amber-900 text-amber-300",
  defective: "bg-rose-900 text-rose-300",
};

type Category = {
  id: string;
  category_name: string;
  gtin: string | null;
};

export default function ScanList({ entries }: { entries: ScanEntry[] }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deletingUnit, setDeletingUnit] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [creatingCategory, setCreatingCategory] = useState<string | null>(null);
  const [newCategoryName, setNewCategoryName] = useState<string>("");

  async function handleDeleteLot(trackingLast8: string, scanIds: string[]) {
    if (!confirm(`Delete entire lot (...${trackingLast8})? This will delete ${scanIds.length} scan${scanIds.length > 1 ? "s" : ""} and reverse all check-ins.`)) return;
    setDeleting(trackingLast8);
    setMessage(null);
    try {
      for (const scanId of scanIds) {
        const res = await fetch(`/api/receiving/scan/${scanId}`, { method: "DELETE" });
        if (!res.ok) {
          const data = await res.json();
          setMessage(`Error deleting scan: ${data.error}`);
          setDeleting(null);
          return;
        }
      }
      setMessage(`✓ Deleted ${scanIds.length} scan${scanIds.length > 1 ? "s" : ""} for ...${trackingLast8}`);
      router.refresh();
    } catch {
      setMessage("Network error. Please try again.");
    } finally {
      setDeleting(null);
    }
  }

  async function handleDeleteUnit(unitId: string, unitIndex: number) {
    if (!confirm(`Delete unit #${unitIndex}?`)) return;
    setDeletingUnit(unitId);
    setMessage(null);
    try {
      const res = await fetch(`/api/receiving/unit/${unitId}`, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) { setMessage(data.message); router.refresh(); }
      else setMessage(`Error: ${data.error}`);
    } catch {
      setMessage("Network error. Please try again.");
    } finally {
      setDeletingUnit(null);
    }
  }

  async function loadCategories() {
    if (categories.length > 0) return;
    setLoadingCategories(true);
    try {
      const res = await fetch("/api/categories");
      const data = await res.json();
      if (res.ok) setCategories(data.categories);
    } catch (err) {
      console.error("Failed to load categories:", err);
    } finally {
      setLoadingCategories(false);
    }
  }

  async function handleCategoryChange(unitId: string, categoryId: string | null) {
    if (categoryId === "__CREATE_NEW__") {
      setCreatingCategory(unitId);
      setNewCategoryName("");
      return;
    }
    setMessage(null);
    try {
      const res = await fetch(`/api/receiving/unit/${unitId}/category`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId })
      });
      const data = await res.json();
      if (res.ok) { setMessage("Category updated"); setEditingCategory(null); router.refresh(); }
      else setMessage(`Error: ${data.error}`);
    } catch {
      setMessage("Network error. Please try again.");
    }
  }

  async function handleCreateNewCategory(unitId: string) {
    if (!newCategoryName.trim()) { setMessage("Category name cannot be empty"); return; }
    setMessage(null);
    try {
      const createRes = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newCategoryName.trim() })
      });
      const createData = await createRes.json();
      if (!createRes.ok) { setMessage(`Error creating category: ${createData.error}`); return; }
      const newCategoryId = createData.category?.id;
      if (!newCategoryId) { setMessage("Error: Failed to get new category ID"); return; }
      const assignRes = await fetch(`/api/receiving/unit/${unitId}/category`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId: newCategoryId })
      });
      if (assignRes.ok) {
        setMessage(`✓ Category "${newCategoryName.trim()}" created and assigned`);
        setCreatingCategory(null); setEditingCategory(null); setNewCategoryName("");
        setCategories([]); router.refresh();
      } else {
        const assignData = await assignRes.json();
        setMessage(`Error assigning category: ${assignData.error}`);
      }
    } catch {
      setMessage("Network error. Please try again.");
    }
  }

  function handleEditCategory(unitId: string) {
    setEditingCategory(unitId);
    setCreatingCategory(null);
    loadCategories();
  }

  function renderUnit(unit: ReceivedUnit) {
    return (
      <div key={unit.id} className="mt-0.5 space-y-1">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-500">#{unit.unitIndex}</span>
          <span className="text-slate-300">{unit.title}</span>
          <span className={`rounded px-1.5 py-0.5 text-[10px] ${conditionColors[unit.condition] ?? "bg-slate-700 text-slate-300"}`}>
            {unit.condition.replace(/_/g, " ")}
          </span>
          {unit.category && (
            <span className="rounded bg-indigo-900 px-1.5 py-0.5 text-[10px] text-indigo-300">{unit.category.name}</span>
          )}
          <span className="text-slate-600">{new Date(unit.receivedAt).toLocaleString()}</span>
          {unit.notes && <span className="text-slate-500 italic">({unit.notes})</span>}
          <button
            onClick={() => handleEditCategory(unit.id)}
            className="rounded border border-indigo-800 px-1.5 py-0.5 text-[10px] text-indigo-400 hover:bg-indigo-900"
            title="Edit category"
          >
            Edit Cat
          </button>
          <button
            onClick={() => handleDeleteUnit(unit.id, unit.unitIndex)}
            disabled={deletingUnit === unit.id}
            className="ml-auto rounded border border-red-800 px-1.5 py-0.5 text-[10px] text-red-400 hover:bg-red-900 disabled:opacity-50"
            title="Delete this unit"
          >
            {deletingUnit === unit.id ? "..." : "×"}
          </button>
        </div>

        {editingCategory === unit.id && !creatingCategory && (
          <div className="flex items-center gap-2 border-l-2 border-indigo-700 pl-2">
            <span className="text-[10px] text-slate-400">Category:</span>
            {loadingCategories ? (
              <span className="text-[10px] text-slate-500">Loading...</span>
            ) : (
              <>
                <select
                  className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-300"
                  defaultValue={unit.category?.id || ""}
                  onChange={(e) => handleCategoryChange(unit.id, e.target.value || null)}
                >
                  <option value="">-- No Category --</option>
                  <option value="__CREATE_NEW__" className="bg-green-900 text-green-300">+ Create New Category</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.category_name}</option>
                  ))}
                </select>
                <button
                  onClick={() => setEditingCategory(null)}
                  className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-slate-700"
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        )}

        {creatingCategory === unit.id && (
          <div className="flex items-center gap-2 border-l-2 border-green-700 pl-2">
            <span className="text-[10px] text-green-400">New Category:</span>
            <input
              type="text"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateNewCategory(unit.id);
                else if (e.key === "Escape") { setCreatingCategory(null); setNewCategoryName(""); }
              }}
              placeholder="Enter category name"
              className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-300 w-48"
              autoFocus
            />
            <button
              onClick={() => handleCreateNewCategory(unit.id)}
              disabled={!newCategoryName.trim()}
              className="rounded bg-green-600 hover:bg-green-700 px-2 py-1 text-[10px] text-white disabled:opacity-50"
            >
              Create
            </button>
            <button
              onClick={() => { setCreatingCategory(null); setNewCategoryName(""); }}
              className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-slate-700"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    );
  }

  function renderOrder(order: MatchedOrder, i: number) {
    const isMultiQtyLot = order.isLot && order.orderQty > 1 && order.lotSize;
    const lotLabel = isMultiQtyLot
      ? `${order.orderQty} lots × ${order.lotSize} units = ${order.orderQty * order.lotSize!} expected`
      : order.isLot
      ? `${order.scannedUnits} scanned (listed: ${order.expectedUnits})`
      : `${order.scannedUnits}/${order.expectedUnits} units`;

    return (
      <div key={i} className="rounded bg-slate-800 px-3 py-2">
        <div className="flex items-center gap-2 flex-wrap">
          <a href={`/orders/${order.orderId}`} className="text-xs font-medium text-blue-400 hover:underline">
            Order {order.orderId}
          </a>
          <span className={`rounded px-1.5 py-0.5 text-xs ${order.checkedIn ? "bg-emerald-900 text-emerald-300" : "bg-slate-700 text-slate-300"}`}>
            {order.checkedIn ? "Checked In" : "Not Checked In"}
          </span>
          {order.isLot && (
            <span className="rounded bg-fuchsia-900 px-1.5 py-0.5 text-xs text-fuchsia-300">
              {isMultiQtyLot ? `LOT ×${order.orderQty}` : "LOT"}
            </span>
          )}
          {order.isLot && order.shipmentId && (
            <a
              href={`/receiving?reconcile=${order.shipmentId}`}
              className="rounded border border-fuchsia-700 px-1.5 py-0.5 text-xs text-fuchsia-400 hover:bg-fuchsia-900/30"
            >
              Reconcile
            </a>
          )}
        </div>

        {isMultiQtyLot && (
          <p className="mt-1 text-xs text-fuchsia-400/70">{lotLabel} · scanned: {order.scannedUnits}</p>
        )}

        <div className="mt-1.5 border-l-2 border-slate-700 pl-2">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">Ordered Items</p>
          {order.items.map((item, j) => (
            <div key={j} className="flex items-center gap-2 text-xs text-slate-400">
              <a
                href={`https://www.ebay.com/itm/${item.itemId}`}
                target="_blank"
                rel="noreferrer"
                className="text-blue-400 hover:text-blue-300 hover:underline truncate max-w-[350px]"
                title={item.title ?? ""}
              >
                {item.title}
              </a>
              <span>(x{item.qty})</span>
              <span>${item.price}</span>
              <a href={`https://www.ebay.com/itm/${item.itemId}`} target="_blank" rel="noreferrer" className="text-slate-500 hover:text-blue-400" title="Open on eBay">↗</a>
            </div>
          ))}
        </div>

        {order.scannedUnits > 0 && (
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1.5 flex-1 rounded-full bg-slate-700 overflow-hidden">
              <div
                className={`h-full rounded-full ${order.isLot ? "bg-fuchsia-500" : order.scannedUnits >= order.expectedUnits ? "bg-green-500" : "bg-yellow-500"}`}
                style={{ width: `${Math.min(100, order.expectedUnits > 0 ? (order.scannedUnits / order.expectedUnits) * 100 : 100)}%` }}
              />
            </div>
            <span className="text-xs text-slate-400 whitespace-nowrap">{lotLabel}</span>
          </div>
        )}

        {order.receivedUnits.length > 0 && (
          <div className="mt-2 border-l-2 border-emerald-800 pl-2">
            <p className="text-[10px] uppercase tracking-wide text-slate-500">Received Units</p>
            {order.receivedUnits.map((unit) => renderUnit(unit))}
          </div>
        )}
      </div>
    );
  }

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h2 className="text-lg font-semibold">Receiving Log</h2>
      {message && (
        <p className="mt-2 rounded bg-slate-800 px-3 py-2 text-sm text-yellow-400">{message}</p>
      )}
      <div className="mt-3 space-y-2 text-sm text-slate-300">
        {entries.length === 0 ? (
          <p>No scans yet.</p>
        ) : (
          entries.map((entry, idx) => (
            <div key={idx} className="rounded border border-slate-800 p-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-medium">...{entry.trackingLast8}</span>
                    {entry.source === "scan" ? (
                      <>
                        {entry.scanCount > 1 && (
                          <span className="rounded bg-fuchsia-900 px-1.5 py-0.5 text-xs text-fuchsia-300">{entry.scanCount} units</span>
                        )}
                        <span className={`rounded px-1.5 py-0.5 text-xs ${entry.resolutionState === "MATCHED" ? "bg-green-900 text-green-300" : "bg-yellow-900 text-yellow-300"}`}>
                          {entry.resolutionState}
                        </span>
                      </>
                    ) : (
                      <span className="rounded bg-indigo-900 px-1.5 py-0.5 text-xs text-indigo-300">IMPORTED</span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {entry.source === "scan"
                      ? `${new Date(entry.date).toLocaleString()} · by ${entry.scannedBy}`
                      : new Date(entry.date).toLocaleString()}
                  </p>
                  {entry.source === "scan" && entry.notes && (
                    <p className="mt-1 text-xs text-slate-400">Notes: {entry.notes}</p>
                  )}
                </div>
                {entry.source === "scan" && (
                  <button
                    onClick={() => handleDeleteLot(entry.trackingLast8, entry.scanIds)}
                    disabled={deleting === entry.trackingLast8}
                    className="rounded border border-red-800 px-2 py-1 text-xs text-red-400 hover:bg-red-900 disabled:opacity-50"
                  >
                    {deleting === entry.trackingLast8 ? "Deleting..." : "Delete Lot"}
                  </button>
                )}
              </div>

              {entry.matchedOrders.length > 0 && (
                <div className="mt-2 space-y-2">
                  {entry.matchedOrders.map((order, i) => renderOrder(order, i))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
