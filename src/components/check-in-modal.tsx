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

type Product = { id: string; product_name: string };

type ScanResult = {
  unitIndex: number;
  unitId: string;
  scanStatus: string;
  isLot: boolean;
  productInfo: {
    productId: string | null;
    confidence: "high" | "medium" | "low";
    requiresManualSelection: boolean;
    reason?: string;
    suggestedProductName?: string;
  };
  item: { title: string; itemId: string; qty: number };
};

// Show the product step when manual selection is required OR when the product
// was auto-assigned but confidence is not high (let user confirm or correct it).
function needsProductStep(productInfo: ScanResult["productInfo"]): boolean {
  if (productInfo.requiresManualSelection) return true;
  if (productInfo.productId && productInfo.confidence !== "high") return true;
  return false;
}

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

type Step = "form" | "scanning" | "unit_form" | "photos" | "product" | "done";

export default function CheckInModal({
  orderId, trackingNumber, itemTitle, totalQty, alreadyScanned, onClose, onSuccess,
}: Props) {
  const remaining = Math.max(0, totalQty - alreadyScanned);

  // Form state
  const [condition, setCondition] = useState("good");
  const [notes, setNotes] = useState("");
  const [perUnit, setPerUnit] = useState(false); // step through each unit individually
  const [isLotMode, setIsLotMode] = useState(false);
  const [lotCount, setLotCount] = useState(totalQty > 1 ? totalQty : 2);
  const [lotPerUnitProduct, setLotPerUnitProduct] = useState(false);

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
  const [photoQueue, setPhotoQueue] = useState<Array<{ unitId: string; unitIndex: number; title: string; groupUnitIds?: string[] }>>([]);
  const [photoQueueIndex, setPhotoQueueIndex] = useState(0);

  // Product step
  const [pendingProduct, setPendingProduct] = useState<{
    unitId: string; unitIndex: number; title: string;
    reason: string; suggestedProductName?: string;
    assignedProductId: string | null; // already-auto-assigned id (for confirm/change flow)
    afterProduct: () => void; // what to do after product is resolved
  } | null>(null);
  const [productOptions, setProductOptions] = useState<Product[]>([]);
  const [editedProductName, setEditedProductName] = useState("");
  const [createMerge, setCreateMerge] = useState(true);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [productLoading, setProductLoading] = useState(false);

  const loadProducts = useCallback(async () => {
    setProductLoading(true);
    try {
      const res = await fetch("/api/products");
      if (res.ok) setProductOptions((await res.json()).products ?? []);
    } finally { setProductLoading(false); }
  }, []);

  // Helper: open the product step and return a promise that resolves when user acts.
  function pauseForProduct(result: ScanResult): Promise<void> {
    return new Promise<void>(resolve => {
      setPendingProduct({
        unitId: result.unitId, unitIndex: result.unitIndex, title: result.item.title,
        reason: result.productInfo.reason ?? "Manual selection required",
        suggestedProductName: result.productInfo.suggestedProductName,
        assignedProductId: result.productInfo.productId,
        afterProduct: resolve,
      });
      setEditedProductName(result.productInfo.suggestedProductName ?? "");
      setCreateMerge(true);
      setSelectedProductId(result.productInfo.productId ?? "");
      loadProducts();
      setStep("product");
    });
  }

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
  // Calls scan API `effectiveRemaining` times sequentially with the same condition.

  async function submitAll() {
    if (!trackingNumber) { setError("No tracking number for this shipment."); return; }
    const effectiveRemaining = isLotMode ? Math.max(lotCount - alreadyScanned, 1) : remaining;
    setLoading(true);
    setError(null);
    setStep("scanning");
    setScannedSoFar(0);

    const photosNeeded: Array<{ unitId: string; unitIndex: number; title: string }> = [];
    let lotDetected = false;

    for (let i = 0; i < effectiveRemaining; i++) {
      setCurrentUnit(alreadyScanned + i + 1);
      const result = await doScan(condition, notes.trim() || undefined);
      if (!result) { setLoading(false); setStep("form"); return; }

      setScannedSoFar(i + 1);
      if (result.isLot) lotDetected = true;

      // Show product step when: manual selection required, low/medium confidence auto-assign,
      // or lot with per-unit product mode enabled.
      const showProduct =
        needsProductStep(result.productInfo) ||
        (result.isLot && lotPerUnitProduct);

      if (showProduct) {
        await pauseForProduct(result);
        setStep("scanning");
      }

      if (!GOOD_CONDITIONS.has(condition)) {
        photosNeeded.push({ unitId: result.unitId, unitIndex: result.unitIndex, title: result.item.title });
      }
    }

    setLoading(false);
    setIsLot(lotDetected);

    if (photosNeeded.length > 0) {
      // Group photos by title (eBay item) — one QR code per item
      if (photosNeeded.length > 1) {
        const grouped: Array<{ unitId: string; unitIndex: number; title: string; groupUnitIds?: string[] }> = [];
        const byTitle = new Map<string, typeof photosNeeded>();
        for (const u of photosNeeded) {
          const key = u.title;
          if (!byTitle.has(key)) byTitle.set(key, []);
          byTitle.get(key)!.push(u);
        }
        for (const [title, units] of byTitle) {
          if (units.length === 1) {
            grouped.push(units[0]);
          } else {
            grouped.push({
              unitId: units[0].unitId,
              unitIndex: units[0].unitIndex,
              title,
              groupUnitIds: units.map(u => u.unitId),
            });
          }
        }
        setPhotoQueue(grouped);
      } else {
        setPhotoQueue(photosNeeded);
      }
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
    const effectiveRemaining = isLotMode ? Math.max(lotCount - alreadyScanned, 1) : remaining;
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
      const moreToGo = newScanned < effectiveRemaining;
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

    if (needsProductStep(result.productInfo)) {
      // After product is resolved, go to photos or next unit
      const afterCat = isBad
        ? () => {
            setPhotoQueue([{ unitId: result.unitId, unitIndex: result.unitIndex, title: result.item.title }]);
            setPhotoQueueIndex(0);
            setStep("photos");
          }
        : afterThis;
      setPendingProduct({
        unitId: result.unitId, unitIndex: result.unitIndex, title: result.item.title,
        reason: result.productInfo.reason ?? "Manual selection required",
        suggestedProductName: result.productInfo.suggestedProductName,
        assignedProductId: result.productInfo.productId,
        afterProduct: afterCat,
      });
      setEditedProductName(result.productInfo.suggestedProductName ?? "");
      setCreateMerge(true);
      setSelectedProductId(result.productInfo.productId ?? "");
      loadProducts();
      setStep("product");
    } else if (isBad) {
      setPhotoQueue([{ unitId: result.unitId, unitIndex: result.unitIndex, title: result.item.title }]);
      setPhotoQueueIndex(0);
      // After photo panel closes, call afterThis
      setStep("photos");
    } else {
      afterThis();
    }
  }

  // ── Product handlers ─────────────────────────────────────────────────────

  async function handleProductAssign(productId: string | null, suggestedName?: string, shouldMerge?: boolean) {
    if (!pendingProduct) return;
    setProductLoading(true);
    try {
      if (productId && suggestedName && shouldMerge) {
        await fetch("/api/products/merge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fromProductName: suggestedName, toProductId: productId }),
        });
      }
      await fetch(`/api/receiving/unit/${pendingProduct.unitId}/product`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId }),
      });
      const cb = pendingProduct.afterProduct;
      setPendingProduct(null);
      cb();
    } finally { setProductLoading(false); }
  }

  async function handleCreateNewProduct(name: string) {
    if (!pendingProduct) return;
    setProductLoading(true);
    try {
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        const data = await res.json();
        await handleProductAssign(data.product?.id, undefined, false);
      }
    } finally { setProductLoading(false); }
  }

  function skipProduct() {
    if (!pendingProduct) return;
    const cb = pendingProduct.afterProduct;
    setPendingProduct(null);
    cb();
  }

  // ── Photo queue drain ─────────────────────────────────────────────────────

  function onPhotoClosed() {
    const effectiveRemaining = isLotMode ? Math.max(lotCount - alreadyScanned, 1) : remaining;
    const nextIndex = photoQueueIndex + 1;
    if (nextIndex < photoQueue.length) {
      setPhotoQueueIndex(nextIndex);
    } else {
      // All photos done
      if (perUnit && scannedSoFar < effectiveRemaining) {
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
    const remainingInQueue = photoQueue.length - photoQueueIndex - 1;
    return (
      <ImageUploadPanel
        receivedUnitId={currentPhoto.unitId}
        unitTitle={currentPhoto.title}
        unitIndex={currentPhoto.unitIndex}
        queueRemaining={currentPhoto.groupUnitIds ? 0 : remainingInQueue}
        groupUnitIds={currentPhoto.groupUnitIds}
        onClose={onPhotoClosed}
      />
    );
  }

  const effectiveTotal = isLotMode ? lotCount : totalQty;
  const effectiveRemaining = isLotMode ? Math.max(lotCount - alreadyScanned, 1) : remaining;

  const headerTitle =
    step === "product" ? "Select Product" :
    step === "scanning" ? "Checking In…" :
    step === "unit_form" ? `Unit ${currentUnit} of ${effectiveTotal}` :
    "Check In";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-start justify-between px-4 py-3 border-b border-slate-800 gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-200">{headerTitle}</h3>
              <span className="text-xs text-slate-600">{orderId}</span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5 leading-snug">{itemTitle}</p>
          </div>
          {step !== "scanning" && (
            <button onClick={onClose} className="flex-shrink-0 rounded border border-slate-700 px-2.5 py-1 text-xs text-slate-400 hover:bg-slate-800">
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

            {effectiveRemaining > 1 && !isLotMode && (
              <div className="rounded-lg bg-slate-800 border border-slate-700 p-3 text-xs text-slate-400">
                This order has <span className="text-slate-200 font-medium">{totalQty} units</span>
                {alreadyScanned > 0 && <span> ({alreadyScanned} already checked in, {effectiveRemaining} remaining)</span>}.
              </div>
            )}

            {/* Lot toggle */}
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
                <input type="checkbox" checked={isLotMode} onChange={e => setIsLotMode(e.target.checked)}
                  className="accent-amber-500" />
                This is a lot (received more units than ordered)
              </label>
            </div>

            {isLotMode && (
              <div className="space-y-2">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-400">
                    Total units received
                  </label>
                  <input
                    type="number"
                    min={totalQty + 1}
                    value={lotCount}
                    onChange={e => setLotCount(Math.max(totalQty + 1, parseInt(e.target.value) || totalQty + 1))}
                    className="w-full rounded border border-amber-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-amber-500"
                  />
                  <p className="mt-1 text-xs text-slate-600">
                    Order qty: {totalQty} · Lot will scan {lotCount - alreadyScanned} units · server detects lot at unit {totalQty + 1}
                  </p>
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
                  <input type="checkbox" checked={lotPerUnitProduct} onChange={e => setLotPerUnitProduct(e.target.checked)}
                    className="accent-fuchsia-500" />
                  Mixed lot — assign product per unit
                </label>
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
                onKeyDown={e => { if (e.key === "Enter" && effectiveRemaining <= 1) submitAll(); }} />
            </div>

            {error && (
              <div className="rounded-lg bg-red-900/30 border border-red-700 p-3 text-sm text-red-300">{error}</div>
            )}

            <div className={`grid gap-2 ${effectiveRemaining > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
              <button onClick={submitAll} disabled={loading || !trackingNumber}
                className="rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 py-2.5 text-sm font-semibold text-white transition-colors">
                {loading ? "Checking in…" : effectiveRemaining > 1 ? `All ${effectiveRemaining} — Same Condition` : "Check In"}
              </button>
              {effectiveRemaining > 1 && (
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
              Checking in unit {currentUnit} of {effectiveTotal}…
            </div>
            <div className="w-full bg-slate-800 rounded-full h-2">
              <div
                className="bg-emerald-600 h-2 rounded-full transition-all"
                style={{ width: `${(scannedSoFar / effectiveRemaining) * 100}%` }}
              />
            </div>
            <div className="text-xs text-slate-500">{scannedSoFar} / {effectiveRemaining} done</div>
          </div>
        )}

        {/* ── Per-unit condition form ── */}
        {step === "unit_form" && (
          <div className="p-5 space-y-4">
            <div className="text-xs text-slate-500">
              Unit {currentUnit} of {effectiveTotal}
              {effectiveRemaining > 1 && <span className="ml-2 text-slate-600">({effectiveRemaining - scannedSoFar} remaining after this)</span>}
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
              {loading ? "Scanning…" : scannedSoFar + 1 < effectiveRemaining ? `Scan Unit ${currentUnit} →` : "Scan Final Unit"}
            </button>

            {isLot && (
              <div className="rounded-lg bg-amber-900/30 border border-amber-700 p-2 text-xs text-amber-300">
                📦 Lot detected — scanned units exceed order qty
              </div>
            )}
          </div>
        )}

        {/* ── Product selection ── */}
        {step === "product" && pendingProduct && (
          <div className="p-5 space-y-4">
            <div className="rounded-lg bg-slate-800 border border-slate-700 p-3 text-xs text-slate-400">
              <span className="text-slate-500">Reason: </span>{pendingProduct.reason}
            </div>

            {/* Auto-assigned product — show a Keep button prominently */}
            {pendingProduct.assignedProductId && !pendingProduct.suggestedProductName && (
              <div className="rounded-lg bg-green-900/20 border border-green-800 p-3 text-xs">
                <p className="text-slate-400 mb-1">Auto-assigned product:</p>
                <p className="font-semibold text-green-300">
                  {productOptions.find(c => c.id === pendingProduct.assignedProductId)?.product_name ?? "…"}
                </p>
              </div>
            )}

            {pendingProduct.suggestedProductName && (
              <div className="text-xs text-slate-400">
                Detected: <span className="font-semibold text-blue-300">{pendingProduct.suggestedProductName}</span>
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-400">Product name</label>
              <input type="text" value={editedProductName} onChange={e => setEditedProductName(e.target.value)}
                className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-600" />
            </div>

            <button
              onClick={() => handleCreateNewProduct(editedProductName.trim() || pendingProduct.suggestedProductName || "")}
              disabled={productLoading || !editedProductName.trim()}
              className="w-full rounded-lg bg-blue-700 hover:bg-blue-600 disabled:opacity-50 py-2 text-xs font-semibold text-white transition-colors">
              Create New Product
            </button>

            <div className="border-t border-slate-800 pt-4 space-y-2">
              <label className="block text-xs font-medium text-slate-400">Or assign to existing</label>
              {productLoading ? (
                <p className="text-xs text-slate-600 animate-pulse">Loading…</p>
              ) : (
                <>
                  <select value={selectedProductId} onChange={e => setSelectedProductId(e.target.value)}
                    className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-600">
                    <option value="">— pick a product —</option>
                    {productOptions.map(c => <option key={c.id} value={c.id}>{c.product_name}</option>)}
                  </select>

                  {selectedProductId && pendingProduct.suggestedProductName && (
                    <label className="flex items-start gap-2 text-xs text-slate-400 cursor-pointer">
                      <input type="checkbox" checked={createMerge} onChange={e => setCreateMerge(e.target.checked)}
                        className="mt-0.5 accent-blue-500" />
                      <span>Auto-map &ldquo;{pendingProduct.suggestedProductName}&rdquo; to this in future scans</span>
                    </label>
                  )}

                  <button
                    onClick={() => handleProductAssign(selectedProductId || null, pendingProduct.suggestedProductName, createMerge)}
                    disabled={productLoading || !selectedProductId}
                    className="w-full rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-50 py-2 text-xs font-semibold text-slate-200 transition-colors">
                    Assign to Selected
                  </button>
                </>
              )}
            </div>

            {/* Keep button — only shown when a product was already auto-assigned */}
            {pendingProduct.assignedProductId && (
              <button
                onClick={() => { const cb = pendingProduct.afterProduct; setPendingProduct(null); cb(); }}
                disabled={productLoading}
                className="w-full rounded-lg border border-green-700 text-green-400 hover:bg-green-900/20 disabled:opacity-50 py-2 text-xs font-semibold transition-colors">
                Keep Auto-Assigned Product
              </button>
            )}

            <button onClick={skipProduct} className="w-full text-xs text-slate-600 hover:text-slate-400 py-1">
              Skip for now
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
