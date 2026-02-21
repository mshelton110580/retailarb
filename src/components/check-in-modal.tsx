"use client";

import { useState, useCallback } from "react";
import ImageUploadPanel from "@/components/image-upload-panel";

const CONDITIONS = [
  { value: "good",               label: "Good" },
  { value: "new",                label: "New / Sealed" },
  { value: "like_new",           label: "Like New" },
  { value: "acceptable",         label: "Acceptable" },
  { value: "pressure mark",      label: "Pressure Mark" },
  { value: "damaged",            label: "Damaged" },
  { value: "wrong_item",         label: "Wrong Item" },
  { value: "missing_parts",      label: "Missing Parts" },
  { value: "defective",          label: "Defective" },
  { value: "dim power/ glitchy", label: "Dim Power / Glitchy" },
  { value: "no power",           label: "No Power" },
  { value: "cracked screen",     label: "Cracked Screen" },
  { value: "water damage",       label: "Water Damage" },
  { value: "parts only",         label: "Parts Only" },
];

const GOOD_CONDITIONS = new Set(["good", "new", "like_new", "acceptable", "excellent"]);

type Category = { id: string; category_name: string };

type ScanResult = {
  unitIndex: number;
  unitId: string;
  scanStatus: string;
  isLot: boolean;
  categoryInfo: {
    categoryId: string | null;
    requiresManualSelection: boolean;
    reason?: string;
    suggestedCategoryName?: string;
  };
  item: { title: string; itemId: string; qty: number };
};

type Props = {
  orderId: string;
  trackingNumber: string | null;
  itemTitle: string;
  /** Total qty across all order items */
  totalQty: number;
  /** Units already scanned/checked-in for this shipment */
  alreadyScanned: number;
  onClose: () => void;
  onSuccess: () => void;
};

type Step = "form" | "scanning" | "unit_form" | "photos" | "category" | "done";

export default function CheckInModal({
  orderId, trackingNumber, itemTitle, totalQty, alreadyScanned, onClose, onSuccess,
}: Props) {
  const remaining = Math.max(0, totalQty - alreadyScanned);

  // Form state
  const [condition, setCondition] = useState("good");
  const [notes, setNotes] = useState("");
  const [perUnit, setPerUnit] = useState(false); // step through each unit individually

  // Progress state (used in scanning / per-unit modes)
  const [currentUnit, setCurrentUnit] = useState(alreadyScanned + 1); // 1-based index of unit being scanned
  const [unitCondition, setUnitCondition] = useState("good");
  const [unitNotes, setUnitNotes] = useState("");
  const [scannedSoFar, setScannedSoFar] = useState(0); // how many we've done this session
  const [isLot, setIsLot] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("form");

  // Photo step
  const [photoQueue, setPhotoQueue] = useState<Array<{ unitId: string; unitIndex: number; title: string }>>([]);
  const [photoQueueIndex, setPhotoQueueIndex] = useState(0);

  // Category step
  const [pendingCategory, setPendingCategory] = useState<{
    unitId: string; unitIndex: number; title: string;
    reason: string; suggestedCategoryName?: string;
    afterCategory: () => void; // what to do after category is resolved
  } | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [editedCategoryName, setEditedCategoryName] = useState("");
  const [createMerge, setCreateMerge] = useState(true);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [categoryLoading, setCategoryLoading] = useState(false);

  const loadCategories = useCallback(async () => {
    setCategoryLoading(true);
    try {
      const res = await fetch("/api/categories");
      if (res.ok) setCategories((await res.json()).categories ?? []);
    } finally { setCategoryLoading(false); }
  }, []);

  // ── Core scan call ────────────────────────────────────────────────────────

  async function doScan(cond: string, n: string | undefined): Promise<ScanResult | null> {
    const res = await fetch("/api/receiving/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tracking: trackingNumber, condition_status: cond, notes: n || undefined }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? "Scan failed"); return null; }
    if (data.resolution === "UNRESOLVED") { setError(`Tracking not matched: ${data.message}`); return null; }
    return data.results?.[0] ?? null;
  }

  // ── "All same condition" flow ─────────────────────────────────────────────
  // Calls scan API `remaining` times sequentially with the same condition.

  async function submitAll() {
    if (!trackingNumber) { setError("No tracking number for this shipment."); return; }
    setLoading(true);
    setError(null);
    setStep("scanning");
    setScannedSoFar(0);

    const photosNeeded: Array<{ unitId: string; unitIndex: number; title: string }> = [];
    let lotDetected = false;

    for (let i = 0; i < remaining; i++) {
      setCurrentUnit(alreadyScanned + i + 1);
      const result = await doScan(condition, notes.trim() || undefined);
      if (!result) { setLoading(false); setStep("form"); return; }

      setScannedSoFar(i + 1);
      if (result.isLot) lotDetected = true;

      // Category needs selection — pause and handle it, then continue loop
      if (result.categoryInfo?.requiresManualSelection) {
        await new Promise<void>(resolve => {
          setPendingCategory({
            unitId: result.unitId, unitIndex: result.unitIndex, title: result.item.title,
            reason: result.categoryInfo.reason ?? "Manual selection required",
            suggestedCategoryName: result.categoryInfo.suggestedCategoryName,
            afterCategory: resolve,
          });
          setEditedCategoryName(result.categoryInfo.suggestedCategoryName ?? "");
          setCreateMerge(true);
          setSelectedCategoryId("");
          loadCategories();
          setStep("category");
        });
        setStep("scanning");
      }

      if (!GOOD_CONDITIONS.has(condition)) {
        photosNeeded.push({ unitId: result.unitId, unitIndex: result.unitIndex, title: result.item.title });
      }
    }

    setLoading(false);
    setIsLot(lotDetected);

    if (photosNeeded.length > 0) {
      setPhotoQueue(photosNeeded);
      setPhotoQueueIndex(0);
      setStep("photos");
    } else {
      setStep("done");
      onSuccess();
    }
  }

  // ── Per-unit flow ─────────────────────────────────────────────────────────
  // Shows a condition form for each unit before scanning it.

  function startPerUnit() {
    setPerUnit(true);
    setUnitCondition("good");
    setUnitNotes("");
    setCurrentUnit(alreadyScanned + 1);
    setScannedSoFar(0);
    setStep("unit_form");
  }

  async function submitUnit() {
    if (!trackingNumber) { setError("No tracking number for this shipment."); return; }
    setLoading(true);
    setError(null);

    const result = await doScan(unitCondition, unitNotes.trim() || undefined);
    setLoading(false);
    if (!result) return;

    const newScanned = scannedSoFar + 1;
    setScannedSoFar(newScanned);
    if (result.isLot) setIsLot(true);

    const isBad = !GOOD_CONDITIONS.has(unitCondition);

    const afterThis = () => {
      const moreToGo = newScanned < remaining;
      if (moreToGo) {
        setCurrentUnit(alreadyScanned + newScanned + 1);
        setUnitCondition("good");
        setUnitNotes("");
        setStep("unit_form");
      } else {
        setStep("done");
        onSuccess();
      }
    };

    if (result.categoryInfo?.requiresManualSelection) {
      setPendingCategory({
        unitId: result.unitId, unitIndex: result.unitIndex, title: result.item.title,
        reason: result.categoryInfo.reason ?? "Manual selection required",
        suggestedCategoryName: result.categoryInfo.suggestedCategoryName,
        afterCategory: isBad
          ? () => {
              setPhotoQueue([{ unitId: result.unitId, unitIndex: result.unitIndex, title: result.item.title }]);
              setPhotoQueueIndex(0);
              setStep("photos");
              // After photos, call afterThis
              // We'll handle this via photoQueue drain
            }
          : afterThis,
      });
      setEditedCategoryName(result.categoryInfo.suggestedCategoryName ?? "");
      setCreateMerge(true);
      setSelectedCategoryId("");
      loadCategories();
      setStep("category");
    } else if (isBad) {
      setPhotoQueue([{ unitId: result.unitId, unitIndex: result.unitIndex, title: result.item.title }]);
      setPhotoQueueIndex(0);
      // After photo panel closes, call afterThis
      setStep("photos");
    } else {
      afterThis();
    }
  }

  // ── Category handlers ─────────────────────────────────────────────────────

  async function handleCategoryAssign(categoryId: string | null, suggestedName?: string, shouldMerge?: boolean) {
    if (!pendingCategory) return;
    setCategoryLoading(true);
    try {
      if (categoryId && suggestedName && shouldMerge) {
        await fetch("/api/categories/merge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fromCategoryName: suggestedName, toCategoryId: categoryId }),
        });
      }
      await fetch(`/api/receiving/unit/${pendingCategory.unitId}/category`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId }),
      });
      const cb = pendingCategory.afterCategory;
      setPendingCategory(null);
      cb();
    } finally { setCategoryLoading(false); }
  }

  async function handleCreateNewCategory(name: string) {
    if (!pendingCategory) return;
    setCategoryLoading(true);
    try {
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        const data = await res.json();
        await handleCategoryAssign(data.category?.id, undefined, false);
      }
    } finally { setCategoryLoading(false); }
  }

  function skipCategory() {
    if (!pendingCategory) return;
    const cb = pendingCategory.afterCategory;
    setPendingCategory(null);
    cb();
  }

  // ── Photo queue drain ─────────────────────────────────────────────────────

  function onPhotoClosed() {
    const nextIndex = photoQueueIndex + 1;
    if (nextIndex < photoQueue.length) {
      setPhotoQueueIndex(nextIndex);
    } else {
      // All photos done
      if (perUnit && scannedSoFar < remaining) {
        setCurrentUnit(alreadyScanned + scannedSoFar + 1);
        setUnitCondition("good");
        setUnitNotes("");
        setStep("unit_form");
      } else {
        setStep("done");
        onSuccess();
      }
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const currentPhoto = photoQueue[photoQueueIndex];
  if (step === "photos" && currentPhoto) {
    return (
      <ImageUploadPanel
        receivedUnitId={currentPhoto.unitId}
        unitTitle={currentPhoto.title}
        unitIndex={currentPhoto.unitIndex}
        onClose={onPhotoClosed}
      />
    );
  }

  const headerTitle =
    step === "category" ? "Select Category" :
    step === "scanning" ? "Checking In…" :
    step === "unit_form" ? `Unit ${currentUnit} of ${totalQty}` :
    "Check In";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <div>
            <h3 className="text-sm font-semibold text-slate-200">{headerTitle}</h3>
            <p className="text-xs text-slate-500 truncate max-w-[280px]" title={itemTitle}>
              {orderId} · {itemTitle}
            </p>
          </div>
          {step !== "scanning" && (
            <button onClick={onClose} className="rounded border border-slate-700 px-2.5 py-1 text-xs text-slate-400 hover:bg-slate-800">
              Cancel
            </button>
          )}
        </div>

        {/* ── Initial form ── */}
        {step === "form" && (
          <div className="p-5 space-y-4">
            {!trackingNumber && (
              <div className="rounded-lg bg-yellow-900/30 border border-yellow-700 p-3 text-xs text-yellow-300">
                No tracking number on record for this shipment.
              </div>
            )}

            {remaining > 1 && (
              <div className="rounded-lg bg-slate-800 border border-slate-700 p-3 text-xs text-slate-400">
                This order has <span className="text-slate-200 font-medium">{totalQty} units</span>
                {alreadyScanned > 0 && <span> ({alreadyScanned} already checked in, {remaining} remaining)</span>}.
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-400">Condition</label>
              <select value={condition} onChange={e => setCondition(e.target.value)}
                className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-600">
                {CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-400">Notes (optional)</label>
              <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="e.g. cracked corner, missing cable"
                className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-600"
                onKeyDown={e => { if (e.key === "Enter" && remaining <= 1) submitAll(); }} />
            </div>

            {error && (
              <div className="rounded-lg bg-red-900/30 border border-red-700 p-3 text-sm text-red-300">{error}</div>
            )}

            <div className={`grid gap-2 ${remaining > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
              <button onClick={submitAll} disabled={loading || !trackingNumber}
                className="rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 py-2.5 text-sm font-semibold text-white transition-colors">
                {loading ? "Checking in…" : remaining > 1 ? `All ${remaining} — Same Condition` : "Check In"}
              </button>
              {remaining > 1 && (
                <button onClick={startPerUnit} disabled={loading || !trackingNumber}
                  className="rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-50 py-2.5 text-sm font-semibold text-slate-200 transition-colors">
                  Per Unit
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Scanning progress ── */}
        {step === "scanning" && (
          <div className="p-8 text-center space-y-3">
            <div className="text-sm text-slate-300 animate-pulse">
              Checking in unit {currentUnit} of {totalQty}…
            </div>
            <div className="w-full bg-slate-800 rounded-full h-2">
              <div
                className="bg-emerald-600 h-2 rounded-full transition-all"
                style={{ width: `${(scannedSoFar / remaining) * 100}%` }}
              />
            </div>
            <div className="text-xs text-slate-500">{scannedSoFar} / {remaining} done</div>
          </div>
        )}

        {/* ── Per-unit condition form ── */}
        {step === "unit_form" && (
          <div className="p-5 space-y-4">
            <div className="text-xs text-slate-500">
              Unit {currentUnit} of {totalQty}
              {remaining > 1 && <span className="ml-2 text-slate-600">({remaining - scannedSoFar} remaining after this)</span>}
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-400">Condition</label>
              <select value={unitCondition} onChange={e => setUnitCondition(e.target.value)}
                className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-600">
                {CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-400">Notes (optional)</label>
              <input type="text" value={unitNotes} onChange={e => setUnitNotes(e.target.value)}
                placeholder="e.g. cracked corner"
                className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-600"
                onKeyDown={e => { if (e.key === "Enter") submitUnit(); }} />
            </div>

            {error && (
              <div className="rounded-lg bg-red-900/30 border border-red-700 p-3 text-sm text-red-300">{error}</div>
            )}

            <button onClick={submitUnit} disabled={loading}
              className="w-full rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 py-2.5 text-sm font-semibold text-white transition-colors">
              {loading ? "Scanning…" : scannedSoFar + 1 < remaining ? `Scan Unit ${currentUnit} →` : "Scan Final Unit"}
            </button>

            {isLot && (
              <div className="rounded-lg bg-amber-900/30 border border-amber-700 p-2 text-xs text-amber-300">
                📦 Lot detected — scanned units exceed order qty
              </div>
            )}
          </div>
        )}

        {/* ── Category selection ── */}
        {step === "category" && pendingCategory && (
          <div className="p-5 space-y-4">
            <div className="rounded-lg bg-slate-800 border border-slate-700 p-3 text-xs text-slate-400">
              <span className="text-slate-500">Reason: </span>{pendingCategory.reason}
            </div>

            {pendingCategory.suggestedCategoryName && (
              <div className="text-xs text-slate-400">
                Detected: <span className="font-semibold text-blue-300">{pendingCategory.suggestedCategoryName}</span>
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-400">Category name</label>
              <input type="text" value={editedCategoryName} onChange={e => setEditedCategoryName(e.target.value)}
                className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-600" />
            </div>

            <button
              onClick={() => handleCreateNewCategory(editedCategoryName.trim() || pendingCategory.suggestedCategoryName || "")}
              disabled={categoryLoading || !editedCategoryName.trim()}
              className="w-full rounded-lg bg-blue-700 hover:bg-blue-600 disabled:opacity-50 py-2 text-xs font-semibold text-white transition-colors">
              Create New Category
            </button>

            <div className="border-t border-slate-800 pt-4 space-y-2">
              <label className="block text-xs font-medium text-slate-400">Or assign to existing</label>
              {categoryLoading ? (
                <p className="text-xs text-slate-600 animate-pulse">Loading…</p>
              ) : (
                <>
                  <select value={selectedCategoryId} onChange={e => setSelectedCategoryId(e.target.value)}
                    className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-600">
                    <option value="">— pick a category —</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.category_name}</option>)}
                  </select>

                  {selectedCategoryId && pendingCategory.suggestedCategoryName && (
                    <label className="flex items-start gap-2 text-xs text-slate-400 cursor-pointer">
                      <input type="checkbox" checked={createMerge} onChange={e => setCreateMerge(e.target.checked)}
                        className="mt-0.5 accent-blue-500" />
                      <span>Auto-map &ldquo;{pendingCategory.suggestedCategoryName}&rdquo; to this in future scans</span>
                    </label>
                  )}

                  <button
                    onClick={() => handleCategoryAssign(selectedCategoryId || null, pendingCategory.suggestedCategoryName, createMerge)}
                    disabled={categoryLoading || !selectedCategoryId}
                    className="w-full rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-50 py-2 text-xs font-semibold text-slate-200 transition-colors">
                    Assign to Selected
                  </button>
                </>
              )}
            </div>

            <button onClick={skipCategory} className="w-full text-xs text-slate-600 hover:text-slate-400 py-1">
              Skip for now
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
