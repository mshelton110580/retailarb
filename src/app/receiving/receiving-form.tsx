"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import ImageUploadPanel from "@/components/image-upload-panel";
import { useBarcodeScanner } from "@/lib/use-barcode-scanner";

type ScanResultItem = {
  orderId: string;
  unitIndex: number;
  unitId: string;
  expectedUnits: number | string;
  scannedSoFar: number;
  remaining: number | null;
  scanStatus: string;
  isLot: boolean;
  condition: string;
  categoryInfo: {
    categoryId: string | null;
    confidence: "high" | "medium" | "low";
    requiresManualSelection: boolean;
    reason?: string;
    suggestedCategoryName?: string;
  };
  item: { title: string; itemId: string; qty: number };
  allItems: Array<{ title: string; qty: number; itemId: string }>;
  error?: string;
};

type ScanResponse = {
  resolution: string;
  matchCount: number;
  message: string;
  results: ScanResultItem[];
};

type Category = {
  id: string;
  category_name: string;
  gtin: string | null;
};

export default function ReceivingForm() {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  const [statusType, setStatusType] = useState<"success" | "warning" | "error" | "lot">("success");
  const [result, setResult] = useState<ScanResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const trackingRef = useRef<HTMLInputElement>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(false);
  // Image upload panel state — triggered when a non-good unit is scanned
  const [imageUploadUnit, setImageUploadUnit] = useState<{
    unitId: string;
    unitIndex: number;
    title: string;
  } | null>(null);

  const [conditions, setConditions] = useState<string[]>([]);

  // Fetch conditions from database on mount
  useEffect(() => {
    fetch("/api/units/conditions")
      .then(r => r.json())
      .then(data => { if (data.conditions) setConditions(data.conditions); })
      .catch(() => {});
  }, []);

  const [pendingCategorySelection, setPendingCategorySelection] = useState<{
    unitId: string;
    unitIndex: number;
    title: string;
    reason: string;
    suggestedCategoryName?: string;
  } | null>(null);
  const [editedCategoryName, setEditedCategoryName] = useState<string>("");
  const [createMergeMapping, setCreateMergeMapping] = useState<boolean>(true);

  // Detect barcode scanner input and route to tracking field
  useBarcodeScanner(trackingRef, (value) => {
    submitScan(value);
  });

  const submitScan = useCallback(async (trackingValue: string) => {
    if (!trackingValue.trim() || loading) return;

    setLoading(true);
    setStatus(null);
    setResult(null);

    const conditionSelect = formRef.current?.querySelector<HTMLSelectElement>('select[name="condition_status"]');
    const notesInput = formRef.current?.querySelector<HTMLInputElement>('input[name="notes"]');

    const payload = {
      tracking: trackingValue.trim(),
      condition_status: conditionSelect?.value || "good",
      notes: notesInput?.value || undefined
    };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const res = await fetch("/api/receiving/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      const data: ScanResponse = await res.json();

      if (res.ok) {
        setResult(data);

        if (data.resolution === "UNRESOLVED") {
          setStatus("⚠ No matching tracking number found. Scan saved as UNRESOLVED.");
          setStatusType("warning");
        } else if (data.results?.[0]) {
          const r = data.results[0];
          if (r.isLot) {
            setStatus(`📦 Lot — Unit ${r.unitIndex} scanned (${r.scannedSoFar} total, qty: ${r.item?.qty ?? "?"}). Needs reconciliation.`);
            setStatusType("lot");
          } else if (r.scanStatus === "complete") {
            setStatus(`✓ Unit ${r.unitIndex} of ${r.expectedUnits} — All units checked in!`);
            setStatusType("success");
          } else if (r.scanStatus === "partial") {
            setStatus(`📋 Unit ${r.unitIndex} of ${r.expectedUnits} checked in — ${r.remaining} remaining`);
            setStatusType("warning");
          }

          // Trigger image upload for non-good conditions
          const goodConditions = new Set(["good", "new", "like_new", "acceptable", "excellent"]);
          const condition = r.condition ?? payload.condition_status;
          if (!goodConditions.has(condition?.toLowerCase() ?? "") && r.unitId) {
            setImageUploadUnit({
              unitId: r.unitId,
              unitIndex: r.unitIndex,
              title: r.item?.title ?? "Unknown",
            });
          }
        } else {
          setStatus(data.message || "Scan processed.");
          setStatusType("success");
        }

        // Clear only the tracking field, keep condition and notes for batch scanning
        if (trackingRef.current) trackingRef.current.value = "";
        trackingRef.current?.focus();
        router.refresh();
      } else {
        setStatus(`Error: ${(data as any).error || "Scan failed"}`);
        setStatusType("error");
        trackingRef.current?.focus();
      }
    } catch (err: any) {
      if (err.name === "AbortError") {
        setStatus("⏳ Scan is taking longer than expected. It may have succeeded — refreshing...");
      } else {
        setStatus("⚠ Response interrupted, but scan may have succeeded. Refreshing...");
      }
      setStatusType("warning");
      if (trackingRef.current) trackingRef.current.value = "";
      trackingRef.current?.focus();
      setTimeout(() => router.refresh(), 1000);
    } finally {
      setLoading(false);
    }
  }, [loading, router]);

  function handleTrackingKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      const value = (e.target as HTMLInputElement).value;
      if (value.trim().length >= 8) {
        submitScan(value);
      }
    }
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trackingValue = trackingRef.current?.value || "";
    submitScan(trackingValue);
  }

  async function loadCategories() {
    if (categories.length > 0) return;

    setLoadingCategories(true);
    try {
      const res = await fetch("/api/categories");
      const data = await res.json();
      if (res.ok) {
        setCategories(data.categories);
      }
    } catch (err) {
      console.error("Failed to load categories:", err);
    } finally {
      setLoadingCategories(false);
    }
  }

  async function handleCategorySelection(unitId: string, categoryId: string | null, suggestedName?: string, shouldCreateMerge?: boolean) {
    try {
      // Only create merge mapping if explicitly requested
      if (categoryId && suggestedName && shouldCreateMerge) {
        const mergeRes = await fetch("/api/categories/merge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fromCategoryName: suggestedName,
            toCategoryId: categoryId
          })
        });

        if (!mergeRes.ok) {
          const mergeData = await mergeRes.json();
          setStatus(`Error creating merge: ${mergeData.error}`);
          setStatusType("error");
          return;
        }
      }

      // Assign category to the unit
      const res = await fetch(`/api/receiving/unit/${unitId}/category`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId })
      });

      if (res.ok) {
        setPendingCategorySelection(null);
        if (suggestedName && categoryId && shouldCreateMerge) {
          setStatus(`✓ Category merged: "${suggestedName}" → existing category. Future scans will auto-merge.`);
        } else if (suggestedName && categoryId && !shouldCreateMerge) {
          setStatus(`✓ Category assigned (no alias created). "${suggestedName}" will prompt again on future scans.`);
        } else {
          setStatus("✓ Category assigned successfully");
        }
        setStatusType("success");
        router.refresh();
      } else {
        const data = await res.json();
        setStatus(`Error assigning category: ${data.error}`);
        setStatusType("error");
      }
    } catch {
      setStatus("Network error while assigning category");
      setStatusType("error");
    }
  }

  async function handleCreateNewCategory(unitId: string, categoryName: string) {
    try {
      // Create the new category
      const createRes = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: categoryName })
      });

      if (!createRes.ok) {
        const createData = await createRes.json();
        setStatus(`Error creating category: ${createData.error}`);
        setStatusType("error");
        return;
      }

      const createData = await createRes.json();
      const newCategoryId = createData.category?.id;

      if (!newCategoryId) {
        setStatus("Error: Failed to get new category ID");
        setStatusType("error");
        return;
      }

      // Assign the new category to the unit
      const assignRes = await fetch(`/api/receiving/unit/${unitId}/category`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId: newCategoryId })
      });

      if (assignRes.ok) {
        setPendingCategorySelection(null);
        setStatus(`✓ New category "${categoryName}" created and assigned`);
        setStatusType("success");
        router.refresh();
      } else {
        const assignData = await assignRes.json();
        setStatus(`Error assigning new category: ${assignData.error}`);
        setStatusType("error");
      }
    } catch {
      setStatus("Network error while creating category");
      setStatusType("error");
    }
  }

  // Check if scan result requires manual category selection
  useEffect(() => {
    if (result?.results?.[0]?.categoryInfo?.requiresManualSelection) {
      const r = result.results[0];
      const suggestedName = r.categoryInfo.suggestedCategoryName || "";
      setPendingCategorySelection({
        unitId: r.unitId,
        unitIndex: r.unitIndex,
        title: r.item.title,
        reason: r.categoryInfo.reason || "Manual selection required",
        suggestedCategoryName: suggestedName
      });
      setEditedCategoryName(suggestedName);
      setCreateMergeMapping(true); // Default to creating merge mapping
      loadCategories();
    }
  }, [result]);

  const statusColorMap = {
    success: "text-green-400 border-green-800",
    warning: "text-yellow-400 border-yellow-800",
    error: "text-red-400 border-red-800",
    lot: "text-purple-400 border-purple-800"
  };
  const statusColor = statusColorMap[statusType] || "text-slate-400 border-slate-800";

  return (
    <div className="space-y-4">
      <form ref={formRef} className="rounded-lg border border-slate-800 bg-slate-900 p-4" onSubmit={onSubmit}>
        <h2 className="text-lg font-semibold">Scan Tracking Number</h2>
        <p className="text-xs text-slate-500 mt-1">Scan barcode or type tracking number and press Enter. Scan once per unit.</p>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <input
            ref={trackingRef}
            className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-mono"
            name="tracking"
            placeholder="Scan or enter tracking number"
            autoFocus
            autoComplete="off"
            required
            onKeyDown={handleTrackingKeyDown}
          />
          <select
            className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            name="condition_status"
            defaultValue="good"
          >
            {conditions.length === 0 ? (
              <option value="good">Good</option>
            ) : (
              conditions.map(c => (
                <option key={c} value={c}>
                  {c.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())}
                </option>
              ))
            )}
          </select>
          <input
            className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            name="notes"
            placeholder="Notes (optional)"
          />
        </div>
        <button
          className="mt-3 rounded bg-blue-500 px-4 py-2 text-sm text-white disabled:opacity-50"
          type="submit"
          disabled={loading}
        >
          {loading ? "Scanning..." : "Save Scan"}
        </button>
      </form>

      {/* Scan result feedback */}
      {status && (
        <div className={`rounded-lg border p-4 ${statusColor} bg-slate-900`}>
          <p className="text-sm font-semibold">{status}</p>

          {result?.results?.map((r, i) => (
            <div key={i} className="mt-3 rounded border border-slate-800 p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-blue-400">Order {r.orderId}</p>
                <div className="flex gap-2">
                  {r.isLot ? (
                    <span className="rounded px-2 py-0.5 text-xs bg-purple-900 text-purple-300">
                      Lot — Check Quantity
                    </span>
                  ) : r.scanStatus === "complete" ? (
                    <span className="rounded px-2 py-0.5 text-xs bg-green-900 text-green-300">
                      Complete ({r.scannedSoFar}/{r.expectedUnits})
                    </span>
                  ) : (
                    <span className="rounded px-2 py-0.5 text-xs bg-yellow-900 text-yellow-300">
                      Partial ({r.scannedSoFar}/{r.expectedUnits})
                    </span>
                  )}
                  <span className="rounded px-2 py-0.5 text-xs bg-slate-800 text-slate-300">
                    {r.condition}
                  </span>
                </div>
              </div>

              {/* Progress bar */}
              {!r.isLot && typeof r.expectedUnits === "number" && r.expectedUnits > 0 && (
                <div className="mt-2">
                  <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        r.scanStatus === "complete" ? "bg-green-500" : "bg-yellow-500"
                      }`}
                      style={{ width: `${Math.min(100, (r.scannedSoFar / (r.expectedUnits as number)) * 100)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {r.scannedSoFar} of {r.expectedUnits} units scanned
                    {r.remaining !== null && r.remaining > 0 && ` — ${r.remaining} remaining`}
                  </p>
                </div>
              )}

              {r.isLot && (
                <div className="mt-2">
                  <p className="text-xs text-purple-400">
                    {r.scannedSoFar} units scanned so far (listed qty: 1). Keep scanning to count all units in the lot.
                  </p>
                </div>
              )}

              {/* Item details */}
              <div className="mt-2">
                {r.allItems?.map((item, j) => (
                  <p key={j} className="text-xs text-slate-400">
                    {item.title} (listed qty: {item.qty})
                  </p>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Image upload panel — shown immediately after non-good scan */}
      {imageUploadUnit && (
        <ImageUploadPanel
          receivedUnitId={imageUploadUnit.unitId}
          unitTitle={imageUploadUnit.title}
          unitIndex={imageUploadUnit.unitIndex}
          onClose={() => setImageUploadUnit(null)}
        />
      )}

      {/* Category selection modal (blocking overlay) */}
      {pendingCategorySelection && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-lg border border-indigo-800 bg-slate-900 p-6 shadow-2xl mx-4">
            <h3 className="text-lg font-semibold text-indigo-400">⚠️ Category Selection Required</h3>
            <p className="mt-2 text-sm text-slate-300">
              <strong>Unit #{pendingCategorySelection.unitIndex}:</strong> {pendingCategorySelection.title}
            </p>

            {pendingCategorySelection.suggestedCategoryName && (
              <div className="mt-3 space-y-2">
                <div className="rounded-lg bg-blue-900/30 border border-blue-800 p-3">
                  <p className="text-sm font-medium text-blue-300">
                    System detected: <span className="font-bold text-blue-200">{pendingCategorySelection.suggestedCategoryName}</span>
                  </p>
                  <p className="mt-1 text-xs text-blue-400">
                    Edit the name below, create as new, or merge with existing category
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">
                    Category Name:
                  </label>
                  <input
                    type="text"
                    value={editedCategoryName}
                    onChange={(e) => setEditedCategoryName(e.target.value)}
                    className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                    placeholder="Enter category name"
                  />
                </div>
              </div>
            )}

            <div className="mt-4 space-y-4">
              {loadingCategories ? (
                <p className="text-sm text-slate-500">Loading categories...</p>
              ) : (
                <>
                  {/* Create new category button */}
                  {pendingCategorySelection.suggestedCategoryName && (
                    <button
                      onClick={() => handleCreateNewCategory(
                        pendingCategorySelection.unitId,
                        editedCategoryName.trim()
                      )}
                      disabled={!editedCategoryName.trim()}
                      className="w-full rounded-lg bg-green-600 hover:bg-green-700 px-4 py-3 text-sm font-medium text-white transition-colors shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      ✓ Create New Category{editedCategoryName.trim() ? `: "${editedCategoryName.trim()}"` : ""}
                    </button>
                  )}

                  {/* Assign to existing category */}
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-2">
                      Or assign to existing category:
                    </label>
                    <select
                      className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-300 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                      onChange={(e) => {
                        if (e.target.value) {
                          handleCategorySelection(
                            pendingCategorySelection.unitId,
                            e.target.value,
                            editedCategoryName.trim() || pendingCategorySelection.suggestedCategoryName,
                            createMergeMapping
                          );
                        }
                      }}
                      defaultValue=""
                    >
                      <option value="">-- Select Existing Category --</option>
                      {categories.map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.category_name}
                        </option>
                      ))}
                    </select>

                    {/* Checkbox to control merge mapping creation */}
                    <div className="mt-3 flex items-start gap-2">
                      <input
                        type="checkbox"
                        id="createMergeMapping"
                        checked={createMergeMapping}
                        onChange={(e) => setCreateMergeMapping(e.target.checked)}
                        className="mt-0.5 rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-indigo-500"
                      />
                      <label htmlFor="createMergeMapping" className="text-xs text-slate-400 cursor-pointer">
                        <span className="font-medium text-slate-300">Create alias for future scans</span>
                        <br />
                        {createMergeMapping ? (
                          <span className="text-green-400">
                            ✓ "{editedCategoryName.trim() || pendingCategorySelection.suggestedCategoryName}" will automatically map to selected category in future scans
                          </span>
                        ) : (
                          <span className="text-yellow-400">
                            ⚠ One-time assignment only. You'll be prompted again if this name appears in future scans.
                          </span>
                        )}
                      </label>
                    </div>
                  </div>

                  <div className="flex gap-3 pt-2 border-t border-slate-800">
                    <button
                      onClick={() => {
                        setPendingCategorySelection(null);
                        setStatus("⚠ Category selection skipped - you can assign it later from the scans list");
                        setStatusType("warning");
                      }}
                      className="flex-1 rounded border border-slate-700 px-4 py-2 text-sm text-slate-400 hover:bg-slate-800 transition-colors mt-2"
                    >
                      Skip for Now
                    </button>
                    <a
                      href="/on-hand"
                      className="flex-1 rounded border border-indigo-700 px-4 py-2 text-sm text-center text-indigo-400 hover:bg-indigo-900 transition-colors mt-2"
                    >
                      View All Products
                    </a>
                  </div>

                  <p className="text-xs text-slate-500 text-center">
                    You can edit the category later using the "Edit Cat" button on the scans list.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
