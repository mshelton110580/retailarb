"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";

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
  const [pendingCategorySelection, setPendingCategorySelection] = useState<{
    unitId: string;
    unitIndex: number;
    title: string;
    reason: string;
  } | null>(null);

  // Keep tracking input focused at all times for barcode scanner
  useEffect(() => {
    trackingRef.current?.focus();

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "SELECT" || target.tagName === "BUTTON" || (target as HTMLInputElement).name === "notes") return;
      setTimeout(() => trackingRef.current?.focus(), 50);
    };

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

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
            setStatus(`📦 Lot detected — Unit ${r.unitIndex} scanned (listed qty: 1). Mark as "Check Quantity"`);
            setStatusType("lot");
          } else if (r.scanStatus === "complete") {
            setStatus(`✓ Unit ${r.unitIndex} of ${r.expectedUnits} — All units checked in!`);
            setStatusType("success");
          } else if (r.scanStatus === "partial") {
            setStatus(`📋 Unit ${r.unitIndex} of ${r.expectedUnits} checked in — ${r.remaining} remaining`);
            setStatusType("warning");
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

  async function handleCategorySelection(unitId: string, categoryId: string | null) {
    try {
      const res = await fetch(`/api/receiving/unit/${unitId}/category`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId })
      });

      if (res.ok) {
        setPendingCategorySelection(null);
        setStatus("✓ Category assigned successfully");
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

  // Check if scan result requires manual category selection
  useEffect(() => {
    if (result?.results?.[0]?.categoryInfo?.requiresManualSelection) {
      const r = result.results[0];
      setPendingCategorySelection({
        unitId: r.unitId,
        unitIndex: r.unitIndex,
        title: r.item.title,
        reason: r.categoryInfo.reason || "Manual selection required"
      });
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
            <option value="good">Good</option>
            <option value="new">New / Sealed</option>
            <option value="like_new">Like New</option>
            <option value="acceptable">Acceptable</option>
            <option value="damaged">Damaged</option>
            <option value="wrong_item">Wrong Item</option>
            <option value="missing_parts">Missing Parts</option>
            <option value="defective">Defective</option>
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

      {/* Category selection prompt */}
      {pendingCategorySelection && (
        <div className="rounded-lg border border-indigo-800 bg-slate-900 p-4">
          <h3 className="text-sm font-semibold text-indigo-400">Category Selection Required</h3>
          <p className="mt-1 text-xs text-slate-400">
            Unit #{pendingCategorySelection.unitIndex}: {pendingCategorySelection.title}
          </p>
          <p className="mt-1 text-xs text-yellow-400">
            {pendingCategorySelection.reason}
          </p>

          <div className="mt-3 space-y-2">
            {loadingCategories ? (
              <p className="text-sm text-slate-500">Loading categories...</p>
            ) : (
              <>
                <label className="block text-xs text-slate-400">
                  Select product category for this unit:
                </label>
                <select
                  className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                  onChange={(e) => handleCategorySelection(pendingCategorySelection.unitId, e.target.value || null)}
                  defaultValue=""
                >
                  <option value="">-- Select Category --</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.category_name}
                    </option>
                  ))}
                </select>

                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setPendingCategorySelection(null);
                      setStatus("⚠ Category selection skipped - you can assign it later from the scans list");
                      setStatusType("warning");
                    }}
                    className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-800"
                  >
                    Skip (Assign Later)
                  </button>
                  <a
                    href="/on-hand"
                    className="rounded border border-indigo-700 px-3 py-1.5 text-xs text-indigo-400 hover:bg-indigo-900"
                  >
                    View All Products
                  </a>
                </div>

                <p className="text-[10px] text-slate-500">
                  Tip: You can also edit the category later from the scans list below using the "Edit Cat" button.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
