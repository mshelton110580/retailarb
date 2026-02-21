"use client";

import { useState, useEffect } from "react";
import ImageUploadPanel from "@/components/image-upload-panel";

type LotUnit = {
  id: string;
  unitIndex: number;
  title: string;
  condition: string;
  inventoryState: string;
  notes: string | null;
  category: { id: string; name: string } | null;
  isNonGood: boolean;
  images: { id: string; url: string; createdAt: string }[];
  imageCount: number;
  needsImages: boolean;
};

type ShipmentInfo = {
  id: string;
  orderId: string;
  orderQty: number;
  scannedUnits: number;
  expectedUnits: number;
  expectedTotal: number | null;
  missingUnits: number;
  isLot: boolean;
  lotSize: number | null;
  isMixedLot: boolean;
  reconciliationStatus: string;
  scanStatus: string;
  tracking: { tracking_number: string; carrier: string | null }[];
  items: { id: string; itemId: string; title: string; qty: number; price: string }[];
};

type ReconciliationData = {
  shipment: ShipmentInfo;
  units: LotUnit[];
};

const GOOD_CONDITIONS = new Set(["good", "new", "like_new", "acceptable", "excellent"]);
const STATES = [
  { value: "on_hand", label: "On Hand" },
  { value: "to_be_returned", label: "To Return" },
  { value: "parts_repair", label: "Parts/Repair" },
  { value: "returned", label: "Returned" },
  { value: "missing", label: "Missing" },
  { value: "possible_chargeback", label: "Possible Chargeback" },
];
const CONDITIONS = [
  "good", "new", "like_new", "acceptable", "excellent",
  "pressure mark", "damaged", "wrong_item", "missing_parts",
  "defective", "dim power/ glitchy", "no power", "cracked screen",
  "water damage", "parts only",
];

function conditionColor(c: string) {
  return GOOD_CONDITIONS.has(c?.toLowerCase() ?? "")
    ? "bg-green-900 text-green-300"
    : "bg-red-900 text-red-300";
}
function stateColor(s: string) {
  if (s === "on_hand") return "text-green-400";
  if (s === "to_be_returned") return "text-yellow-400";
  if (s === "parts_repair") return "text-red-400";
  if (s === "missing") return "text-orange-400";
  if (s === "possible_chargeback") return "text-rose-400";
  return "text-slate-500";
}

export default function LotReconciliation({ shipmentId, onDone }: { shipmentId: string; onDone: () => void }) {
  const [data, setData] = useState<ReconciliationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [unitEdits, setUnitEdits] = useState<Record<string, Partial<LotUnit & { condition: string; inventoryState: string; categoryId: string | null; notes: string }>>>({});
  const [imageUploadUnit, setImageUploadUnit] = useState<{ unitId: string; unitIndex: number; title: string } | null>(null);
  const [showAddMissing, setShowAddMissing] = useState(false);
  const [addMissingCount, setAddMissingCount] = useState(1);
  const [addMissingNotes, setAddMissingNotes] = useState("");
  const [addingMissing, setAddingMissing] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reconciliation/${shipmentId}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load");
      setData(json);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [shipmentId]);

  function editUnit(unitId: string, field: string, value: any) {
    setUnitEdits((prev) => ({
      ...prev,
      [unitId]: { ...prev[unitId], [field]: value },
    }));
  }

  function getUnitValue<K extends keyof LotUnit>(unit: LotUnit, field: K) {
    return (unitEdits[unit.id] as any)?.[field] ?? unit[field];
  }

  async function handleAction(action: "mark_reviewed" | "override_reviewed") {
    setSaving(true);
    setMessage(null);
    try {
      const updates = Object.entries(unitEdits).map(([unitId, edits]) => ({
        unitId,
        condition: (edits as any).condition,
        inventoryState: (edits as any).inventoryState,
        categoryId: (edits as any).categoryId,
        notes: (edits as any).notes,
      })).filter((u) => Object.keys(u).length > 1);

      const res = await fetch(`/api/reconciliation/${shipmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, unitUpdates: updates }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to save");
      setMessage({ type: "success", text: action === "mark_reviewed" ? "Lot marked as reviewed." : "Review overridden." });
      await load();
      setTimeout(onDone, 1200);
    } catch (e: any) {
      setMessage({ type: "error", text: e.message });
    } finally {
      setSaving(false);
    }
  }

  async function handleAddMissing() {
    if (addMissingCount < 1) return;
    setAddingMissing(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/reconciliation/${shipmentId}/add-unit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: addMissingCount, notes: addMissingNotes || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to add units");
      setMessage({ type: "success", text: `Added ${addMissingCount} missing unit${addMissingCount !== 1 ? "s" : ""}. Lot re-opened for review.` });
      setShowAddMissing(false);
      setAddMissingCount(1);
      setAddMissingNotes("");
      setUnitEdits({});
      await load();
    } catch (e: any) {
      setMessage({ type: "error", text: e.message });
    } finally {
      setAddingMissing(false);
    }
  }

  if (loading) return <div className="p-6 text-center text-slate-500 text-sm animate-pulse">Loading lot data...</div>;
  if (error) return <div className="p-6 text-center text-red-400 text-sm">{error}</div>;
  if (!data) return null;

  const { shipment, units } = data;
  const nonGoodMissingImages = units.filter((u) => u.needsImages);
  const isReviewed = shipment.reconciliationStatus === "reviewed" || shipment.reconciliationStatus === "overridden";
  const hasEdits = Object.keys(unitEdits).length > 0;

  return (
    <div className="space-y-4">
      {imageUploadUnit && (
        <ImageUploadPanel
          receivedUnitId={imageUploadUnit.unitId}
          unitTitle={imageUploadUnit.title}
          unitIndex={imageUploadUnit.unitIndex}
          onClose={() => { setImageUploadUnit(null); load(); }}
        />
      )}

      {/* Lot summary header */}
      <div className="rounded-lg border border-fuchsia-800 bg-fuchsia-900/10 p-4 space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <a href={`/orders/${shipment.orderId}`} className="font-medium text-blue-400 hover:underline text-sm">
                Order {shipment.orderId}
              </a>
              <span className="rounded px-1.5 py-0.5 text-xs bg-fuchsia-900 text-fuchsia-300">LOT</span>
              {shipment.isMixedLot && (
                <span className="rounded px-1.5 py-0.5 text-xs bg-amber-900 text-amber-300">⚠ Mixed Lot</span>
              )}
              {isReviewed && (
                <span className="rounded px-1.5 py-0.5 text-xs bg-green-900 text-green-300">
                  ✓ {shipment.reconciliationStatus === "overridden" ? "Overridden" : "Reviewed"}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-1">
              qty: {shipment.orderQty} · scanned: {shipment.scannedUnits}
              {shipment.lotSize ? ` · ${shipment.lotSize} per lot` : ""}
              {shipment.expectedTotal ? ` · expected: ${shipment.expectedTotal}` : ""}
            </p>
            {shipment.missingUnits > 0 && (
              <p className="text-xs text-amber-400 mt-0.5">
                ⚠ {shipment.missingUnits} unit{shipment.missingUnits !== 1 ? "s" : ""} appear{shipment.missingUnits === 1 ? "s" : ""} to be missing — scan more or confirm shortage in reconciliation
              </p>
            )}
          </div>
        </div>

        {/* Order items */}
        {shipment.items.map((item) => (
          <div key={item.id} className="text-xs text-slate-300 flex items-center gap-2">
            <a href={`https://www.ebay.com/itm/${item.itemId}`} target="_blank" rel="noreferrer"
              className="text-blue-400 hover:underline truncate max-w-xs" title={item.title}>
              {item.title}
            </a>
            <span className="text-slate-500">×{item.qty}</span>
            <span className="text-slate-500">${item.price}</span>
          </div>
        ))}
      </div>

      {/* Missing images warning */}
      {nonGoodMissingImages.length > 0 && !isReviewed && (
        <div className="rounded-lg border border-amber-700 bg-amber-900/20 p-3 text-sm text-amber-300">
          ⚠ {nonGoodMissingImages.length} non-good unit{nonGoodMissingImages.length !== 1 ? "s" : ""} missing photos.
          Add photos before marking reviewed, or use Override.
        </div>
      )}

      {/* Unit table */}
      <div className="rounded-lg border border-slate-800 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="border-b border-slate-800 bg-slate-900">
            <tr className="text-left text-slate-400">
              <th className="px-3 py-2 w-8">#</th>
              <th className="px-3 py-2">Title</th>
              <th className="px-3 py-2 w-32">Condition</th>
              <th className="px-3 py-2 w-28">State</th>
              <th className="px-3 py-2 w-36">Category</th>
              <th className="px-3 py-2 w-24">Photos</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 bg-slate-900/50">
            {units.map((unit) => {
              const cond = getUnitValue(unit, "condition") as string;
              const state = getUnitValue(unit, "inventoryState") as string;
              const isEdited = !!unitEdits[unit.id];

              return (
                <tr key={unit.id} className={`transition-colors ${isEdited ? "bg-blue-900/10" : ""}`}>
                  <td className="px-3 py-2 text-slate-500 font-mono">{unit.unitIndex}</td>
                  <td className="px-3 py-2">
                    <p className="text-slate-300 truncate max-w-[200px]" title={unit.title}>{unit.title}</p>
                    {unit.notes && <p className="text-slate-500 italic truncate">{unit.notes}</p>}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={cond}
                      onChange={(e) => editUnit(unit.id, "condition", e.target.value)}
                      className={`w-full rounded px-1.5 py-0.5 text-xs border-0 capitalize cursor-pointer ${conditionColor(cond)}`}
                    >
                      {CONDITIONS.map((c) => (
                        <option key={c} value={c} className="bg-slate-800 text-slate-200 capitalize">{c}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={state}
                      onChange={(e) => editUnit(unit.id, "inventoryState", e.target.value)}
                      className={`w-full rounded px-1.5 py-0.5 text-xs border-0 cursor-pointer bg-slate-800 ${stateColor(state)}`}
                    >
                      {STATES.map((s) => (
                        <option key={s.value} value={s.value} className="bg-slate-800 text-slate-200">{s.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    {unit.category ? (
                      <span className="text-indigo-300 truncate block max-w-[120px]" title={unit.category.name}>
                        {unit.category.name}
                      </span>
                    ) : (
                      <span className="text-slate-600 italic">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {unit.isNonGood ? (
                      <div className="flex items-center gap-1.5">
                        {unit.imageCount > 0 ? (
                          <span className="text-green-400">✓ {unit.imageCount}</span>
                        ) : (
                          <span className="text-red-400">⚠ 0</span>
                        )}
                        <button
                          onClick={() => setImageUploadUnit({ unitId: unit.id, unitIndex: unit.unitIndex, title: unit.title })}
                          className="rounded border border-slate-600 px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-slate-700"
                        >
                          + Add
                        </button>
                        {unit.images.slice(0, 2).map((img) => (
                          <a key={img.id} href={img.url} target="_blank" rel="noreferrer">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={img.url} alt="" className="w-7 h-7 rounded object-cover ring-1 ring-slate-600" />
                          </a>
                        ))}
                      </div>
                    ) : (
                      <span className="text-slate-600 text-[10px]">N/A</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Message */}
      {message && (
        <div className={`rounded-lg p-3 text-sm ${message.type === "success" ? "bg-green-900/30 border border-green-700 text-green-300" : "bg-red-900/30 border border-red-700 text-red-300"}`}>
          {message.text}
        </div>
      )}

      {/* Add Missing Units */}
      {!showAddMissing ? (
        <button
          onClick={() => setShowAddMissing(true)}
          className="w-full rounded-lg border border-dashed border-slate-600 px-4 py-2 text-sm text-slate-400 hover:border-slate-400 hover:text-slate-200 transition-colors text-left"
        >
          + Add Missing Units
        </button>
      ) : (
        <div className="rounded-lg border border-orange-800 bg-orange-900/10 p-4 space-y-3">
          <p className="text-sm font-medium text-orange-300">Add Missing Units</p>
          <p className="text-xs text-slate-400">
            Creates additional unit records with condition <span className="font-mono bg-slate-800 px-1 rounded">missing</span>.
            The lot will be re-opened for review after adding.
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-400">Count</label>
              <input
                type="number"
                min={1}
                max={100}
                value={addMissingCount}
                onChange={(e) => setAddMissingCount(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-16 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-slate-200 text-center"
              />
            </div>
            <div className="flex items-center gap-2 flex-1 min-w-[180px]">
              <label className="text-xs text-slate-400 whitespace-nowrap">Notes</label>
              <input
                type="text"
                placeholder="Optional note"
                value={addMissingNotes}
                onChange={(e) => setAddMissingNotes(e.target.value)}
                className="flex-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-slate-200 placeholder-slate-600"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleAddMissing}
              disabled={addingMissing}
              className="rounded-lg bg-orange-700 hover:bg-orange-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 transition-colors"
            >
              {addingMissing ? "Adding..." : `Add ${addMissingCount} Unit${addMissingCount !== 1 ? "s" : ""}`}
            </button>
            <button
              onClick={() => { setShowAddMissing(false); setAddMissingCount(1); setAddMissingNotes(""); }}
              className="text-xs text-slate-500 hover:text-slate-300"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-3 flex-wrap">
        {!isReviewed ? (
          <>
            <button
              onClick={() => handleAction("mark_reviewed")}
              disabled={saving}
              className="rounded-lg bg-green-600 hover:bg-green-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 transition-colors"
            >
              {saving ? "Saving..." : "Mark as Reviewed"}
            </button>
            {nonGoodMissingImages.length > 0 && (
              <button
                onClick={() => handleAction("override_reviewed")}
                disabled={saving}
                className="rounded-lg border border-amber-600 px-4 py-2 text-sm font-medium text-amber-400 hover:bg-amber-900/20 disabled:opacity-50 transition-colors"
              >
                Override — Mark Reviewed Anyway
              </button>
            )}
          </>
        ) : (
          <button
            onClick={() => handleAction("override_reviewed")}
            disabled={saving}
            className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-medium text-slate-400 hover:bg-slate-800 disabled:opacity-50"
          >
            Re-open for Edits
          </button>
        )}
        {hasEdits && (
          <span className="text-xs text-blue-400">● Unsaved edits — will be saved on review</span>
        )}
        <button onClick={onDone} className="ml-auto text-xs text-slate-500 hover:text-slate-300">← Back</button>
      </div>
    </div>
  );
}
