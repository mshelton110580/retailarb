"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import ImageUploadPanel from "@/components/image-upload-panel";
import { useBarcodeScanner } from "@/lib/use-barcode-scanner";

type LotBreakdownItem = { product: string; quantity: number; group?: string };

type OrderItemInfo = {
  itemId: string;
  orderItemId: string;
  title: string;
  qty: number;
};

type ShipmentInfo = {
  shipmentId: string;
  orderId: string;
  itemId: string;
  orderItemId: string;
  title: string;
  expectedUnits: number;
  itemBreakdown: LotBreakdownItem[];
  isLot: boolean;
  orderItems?: OrderItemInfo[];
};

type LotConfirmation = {
  shipmentId: string;
  orderId: string;
  itemId: string;
  orderItemId: string;
  title: string;
  totalUnits: number;
  itemBreakdown: LotBreakdownItem[];
  isMultiQty?: boolean;
  orderItems?: OrderItemInfo[];
  shipments?: ShipmentInfo[];
};

type ScanResultItem = {
  orderId: string;
  unitIndex: number;
  unitId: string;
  expectedUnits: number | string;
  scannedSoFar: number;
  remaining: number | null;
  scanStatus: string;
  isLot: boolean;
  lotSize: number | null;
  condition: string;
  lotConfirmation?: LotConfirmation;
  categoryInfo: {
    categoryId: string | null;
    confidence: "high" | "medium" | "low";
    requiresManualSelection: boolean;
    reason?: string;
    suggestedCategoryName?: string;
  };
  item: { title: string; itemId: string; qty: number; scannedForItem?: number; remainingForItem?: number | null };
  allItems: Array<{ title: string; qty: number; itemId: string }>;
  error?: string;
};

type PoolOrder = {
  orderId: string;
  title: string;
  capacity: number;
  scanned: number;
  isTarget: boolean;
};

type PoolInfo = {
  isSharedTracking: boolean;
  totalCapacity: number;
  totalScanned: number;
  orders: PoolOrder[];
};

type ScanResponse = {
  resolution: string;
  matchCount: number;
  message: string;
  results: ScanResultItem[];
  poolInfo?: PoolInfo | null;
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
  const submittingRef = useRef(false); // Synchronous guard against double-submission
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

  // Lot confirmation modal state
  type LotUnitState = { product: string; condition: string; notes: string };
  type LotBreakdownEdit = { product: string; quantity: number };
  type LotReceivedEdit = { product: string; expected: number; received: number; shipmentIdx?: number; group?: string };
  const [lotConfirmation, setLotConfirmation] = useState<LotConfirmation | null>(null);
  const [lotUnits, setLotUnits] = useState<LotUnitState[]>([]);
  const [lotBreakdownEdit, setLotBreakdownEdit] = useState<LotBreakdownEdit[]>([]);
  const [lotReceivedEdit, setLotReceivedEdit] = useState<LotReceivedEdit[]>([]);
  const [lotStep, setLotStep] = useState<"breakdown" | "confirm" | "conditions">("confirm");
  const [lotSubmitting, setLotSubmitting] = useState(false);

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
    if (!trackingValue.trim() || loading || submittingRef.current) return;
    submittingRef.current = true;

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
        } else if (data.results?.[0]?.lotConfirmation) {
          // Lot detected — open confirmation modal
          const lc = data.results[0].lotConfirmation;
          setLotConfirmation(lc);

          // Check if AI knows the per-product quantities
          const hasUnknownQty = lc.itemBreakdown.some(i => i.quantity === 0);

          if (hasUnknownQty && !lc.shipments) {
            // Unknown split — user needs to enter quantities (single shipment only)
            setLotBreakdownEdit(lc.itemBreakdown.map(i => ({ product: i.product, quantity: i.quantity })));
            setLotStep("breakdown");
            setLotUnits([]);
            setLotReceivedEdit([]);
          } else {
            // Known quantities — go to received confirmation step
            setLotStep("confirm");
            if (lc.shipments && lc.shipments.length > 0) {
              // Shared tracking: build received edit per shipment
              const received: LotReceivedEdit[] = [];
              lc.shipments.forEach((sh, shIdx) => {
                for (const item of sh.itemBreakdown) {
                  received.push({
                    product: item.product,
                    expected: item.quantity,
                    received: item.quantity,
                    shipmentIdx: shIdx,
                  });
                }
              });
              setLotReceivedEdit(received);
            } else {
              setLotReceivedEdit(lc.itemBreakdown.map(i => ({
                product: i.product,
                expected: i.quantity,
                received: i.quantity,
                group: i.group,
              })));
            }
            setLotUnits([]);
          }
          setStatus(null);
        } else if (data.poolInfo?.isSharedTracking && !data.results?.[0]?.lotConfirmation) {
          // Shared tracking without confirmation modal: show pool progress
          const { totalScanned, totalCapacity } = data.poolInfo;
          const remaining = totalCapacity - totalScanned;
          if (remaining <= 0) {
            setStatus(`✓ Shared box — ${totalScanned} of ${totalCapacity} total units — All done!`);
            setStatusType("success");
          } else {
            setStatus(`📦 Shared box — ${totalScanned} of ${totalCapacity} total units (${remaining} remaining)`);
            setStatusType("warning");
          }
        } else if (data.results?.[0]) {
          const r = data.results[0];
          if (r.isLot) {
            const lotDesc = r.lotSize ? `AI detected lot of ${r.lotSize}` : `${r.scannedSoFar} scanned`;
            setStatus(`📦 Lot — ${lotDesc} (${r.scannedSoFar} scanned so far). Needs reconciliation.`);
            setStatusType("lot");
          } else if (r.scanStatus === "complete") {
            setStatus(`✓ Unit ${r.unitIndex} of ${r.expectedUnits} — All units checked in!`);
            setStatusType("success");
          } else if (r.scanStatus === "partial") {
            const itemInfo = r.item;
            const hasMultipleItems = (r.allItems?.length ?? 0) > 1;
            if (hasMultipleItems && itemInfo) {
              const itemRemaining = itemInfo.remainingForItem ?? 0;
              if (itemRemaining === 0) {
                // Just finished this item, next scan will be a different item
                const nextItemIdx = r.allItems!.findIndex(i => i.itemId === itemInfo.itemId) + 1;
                const nextItem = r.allItems![nextItemIdx];
                setStatus(`✓ "${itemInfo.title}" complete (${itemInfo.qty}/${itemInfo.qty}). Next: "${nextItem?.title ?? "?"}" (${nextItem?.qty ?? "?"} units)`);
              } else {
                setStatus(`📋 "${itemInfo.title}" — ${itemInfo.scannedForItem} of ${itemInfo.qty} scanned, ${itemRemaining} remaining. (${r.scannedSoFar}/${r.expectedUnits} total)`);
              }
            } else {
              setStatus(`📋 Unit ${r.unitIndex} of ${r.expectedUnits} checked in — ${r.remaining} remaining`);
            }
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
        // Skip router.refresh() when lot confirmation modal is open —
        // the refresh can cause a re-render that loses modal state.
        if (!data.results?.[0]?.lotConfirmation) {
          router.refresh();
        }
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
      submittingRef.current = false;
    }
  }, [loading, router]);

  function handleTrackingKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation(); // Prevent form onSubmit from also firing
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

  function applyBreakdownToUnits(breakdown: LotBreakdownEdit[]) {
    // Move to the received confirmation step with expected = breakdown quantities
    setLotReceivedEdit(breakdown.map(i => ({
      product: i.product,
      expected: i.quantity,
      received: i.quantity,
    })));
    setLotUnits([]);
    setLotStep("confirm");
  }

  function buildUnitsFromReceived(receivedEdit: LotReceivedEdit[]): LotUnitState[] {
    const units: LotUnitState[] = [];
    for (const item of receivedEdit) {
      // Received units
      for (let i = 0; i < item.received; i++) {
        units.push({ product: item.product, condition: "good", notes: "" });
      }
      // Missing units
      const missing = item.expected - item.received;
      for (let i = 0; i < missing; i++) {
        units.push({ product: item.product, condition: "missing", notes: "Not received" });
      }
    }
    return units;
  }

  function handleReceivedConfirmAllGood() {
    const units = buildUnitsFromReceived(lotReceivedEdit);
    setLotUnits(units);
    handleLotConfirmWithUnits(units);
  }

  function handleReceivedGoToConditions() {
    const units = buildUnitsFromReceived(lotReceivedEdit);
    setLotUnits(units);
    setLotStep("conditions");
  }

  /** Send confirm request(s) — one per shipment for shared tracking, one otherwise */
  async function handleLotConfirmWithUnits(unitsOverride: LotUnitState[]) {
    if (!lotConfirmation || lotSubmitting) return;
    setLotSubmitting(true);
    try {
      if (lotConfirmation.shipments && lotConfirmation.shipments.length > 1) {
        // Shared tracking: split units by shipment and send parallel requests
        const shipmentUnits = new Map<number, LotUnitState[]>();
        // First build units from lotReceivedEdit which has shipmentIdx
        // But unitsOverride is a flat list built from lotReceivedEdit order.
        // We need to map them back. Rebuild from lotReceivedEdit with shipmentIdx.
        let unitIdx = 0;
        for (const item of lotReceivedEdit) {
          const shIdx = item.shipmentIdx ?? 0;
          if (!shipmentUnits.has(shIdx)) shipmentUnits.set(shIdx, []);
          // Received units
          for (let i = 0; i < item.received; i++) {
            const override = unitsOverride[unitIdx];
            shipmentUnits.get(shIdx)!.push(override ?? { product: item.product, condition: "good", notes: "" });
            unitIdx++;
          }
          // Missing units
          const missing = item.expected - item.received;
          for (let i = 0; i < missing; i++) {
            const override = unitsOverride[unitIdx];
            shipmentUnits.get(shIdx)!.push(override ?? { product: item.product, condition: "missing", notes: "Not received" });
            unitIdx++;
          }
        }

        let totalCreated = 0;
        const errors: string[] = [];

        const requests = Array.from(shipmentUnits.entries()).map(async ([shIdx, units]) => {
          const sh = lotConfirmation.shipments![shIdx];
          const res = await fetch("/api/receiving/confirm-lot", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              shipmentId: sh.shipmentId,
              orderId: sh.orderId,
              itemId: sh.itemId,
              orderItemId: sh.orderItemId,
              units: units.map(u => ({
                product: u.product,
                condition: u.condition,
                notes: u.notes || undefined,
              })),
              ...(!sh.isLot && sh.orderItems ? {
                isMultiQty: true,
                orderItems: sh.orderItems,
              } : {}),
            }),
          });
          const data = await res.json();
          if (res.ok) {
            totalCreated += data.unitsCreated;
          } else {
            errors.push(`Order ${sh.orderId}: ${data.error}`);
          }
        });

        await Promise.all(requests);

        if (errors.length > 0) {
          setStatus(`Partially saved — ${totalCreated} units. Errors: ${errors.join("; ")}`);
          setStatusType("warning");
        } else {
          setLotConfirmation(null);
          setResult(null);
          setStatus(`✓ ${totalCreated} units checked in across ${lotConfirmation.shipments.length} orders`);
          setStatusType("success");
        }
        if (trackingRef.current) trackingRef.current.value = "";
        trackingRef.current?.focus();
        router.refresh();
      } else {
        // Single shipment
        const res = await fetch("/api/receiving/confirm-lot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            shipmentId: lotConfirmation.shipmentId,
            orderId: lotConfirmation.orderId,
            itemId: lotConfirmation.itemId,
            orderItemId: lotConfirmation.orderItemId,
            units: unitsOverride.map(u => ({
              product: u.product,
              condition: u.condition,
              notes: u.notes || undefined,
            })),
            ...(lotConfirmation.isMultiQty ? {
              isMultiQty: true,
              orderItems: lotConfirmation.orderItems,
            } : {}),
          }),
        });
        const data = await res.json();
        if (res.ok) {
          setLotConfirmation(null);
          setResult(null);
          setStatus(`✓ ${data.unitsCreated} units checked in`);
          setStatusType("success");
          if (trackingRef.current) trackingRef.current.value = "";
          trackingRef.current?.focus();
          router.refresh();
        } else {
          setStatus(`Error: ${data.error}`);
          setStatusType("error");
        }
      }
    } catch {
      setStatus("Network error confirming lot");
      setStatusType("error");
    } finally {
      setLotSubmitting(false);
    }
  }

  async function handleLotConfirm() {
    if (!lotConfirmation || lotSubmitting) return;
    setLotSubmitting(true);
    try {
      const res = await fetch("/api/receiving/confirm-lot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shipmentId: lotConfirmation.shipmentId,
          orderId: lotConfirmation.orderId,
          itemId: lotConfirmation.itemId,
          orderItemId: lotConfirmation.orderItemId,
          units: lotUnits.map(u => ({
            product: u.product,
            condition: u.condition,
            notes: u.notes || undefined,
          })),
          ...(lotConfirmation.isMultiQty ? {
            isMultiQty: true,
            orderItems: lotConfirmation.orderItems,
          } : {}),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setLotConfirmation(null);
        setResult(null);
        setStatus(`✓ ${data.unitsCreated} units checked in`);
        setStatusType("success");
        if (trackingRef.current) trackingRef.current.value = "";
        trackingRef.current?.focus();
        router.refresh();
      } else {
        setStatus(`Error: ${data.error}`);
        setStatusType("error");
      }
    } catch {
      setStatus("Network error confirming lot");
      setStatusType("error");
    } finally {
      setLotSubmitting(false);
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

          {/* Shared tracking: single combined progress bar */}
          {result?.poolInfo?.isSharedTracking && (
            <div className="mt-3">
              <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    result.poolInfo.totalScanned >= result.poolInfo.totalCapacity ? "bg-green-500" : "bg-blue-500"
                  }`}
                  style={{ width: `${Math.min(100, result.poolInfo.totalCapacity > 0 ? (result.poolInfo.totalScanned / result.poolInfo.totalCapacity) * 100 : 0)}%` }}
                />
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {result.poolInfo.totalScanned} of {result.poolInfo.totalCapacity} units · {result.poolInfo.orders.length} orders in this box
              </p>
            </div>
          )}

          {!result?.poolInfo?.isSharedTracking && result?.results?.map((r, i) => (
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
                <div className="mt-2 space-y-2">
                  {/* Per-item progress for multi-item orders */}
                  {(r.allItems?.length ?? 0) > 1 && r.item?.scannedForItem != null ? (
                    <>
                      {r.allItems!.map((item, j) => {
                        // Calculate scanned count per item from overall progress
                        let itemScanned = 0;
                        let runningBefore = 0;
                        for (let k = 0; k < j; k++) runningBefore += r.allItems![k].qty;
                        const runningAfter = runningBefore + item.qty;
                        if (r.scannedSoFar >= runningAfter) {
                          itemScanned = item.qty; // fully done
                        } else if (r.scannedSoFar > runningBefore) {
                          itemScanned = r.scannedSoFar - runningBefore; // partially done
                        }
                        const isCurrentItem = item.itemId === r.item!.itemId;
                        const isDone = itemScanned >= item.qty;
                        return (
                          <div key={j} className={`rounded p-2 ${isCurrentItem ? "bg-slate-800 border border-blue-800" : "bg-slate-800/50"}`}>
                            <div className="flex items-center justify-between">
                              <p className={`text-xs ${isCurrentItem ? "text-blue-300 font-medium" : isDone ? "text-green-400" : "text-slate-500"}`}>
                                {isCurrentItem && "▶ "}{item.title}
                              </p>
                              <span className={`text-xs ${isDone ? "text-green-400" : isCurrentItem ? "text-blue-300" : "text-slate-500"}`}>
                                {itemScanned}/{item.qty}
                              </span>
                            </div>
                            <div className="mt-1 h-1.5 rounded-full bg-slate-700 overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${isDone ? "bg-green-500" : isCurrentItem ? "bg-blue-500" : "bg-slate-600"}`}
                                style={{ width: `${Math.min(100, item.qty > 0 ? (itemScanned / item.qty) * 100 : 0)}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                      <p className="text-xs text-slate-500">
                        {r.scannedSoFar} of {r.expectedUnits} total units scanned
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            r.scanStatus === "complete" ? "bg-green-500" : "bg-yellow-500"
                          }`}
                          style={{ width: `${Math.min(100, (r.scannedSoFar / (r.expectedUnits as number)) * 100)}%` }}
                        />
                      </div>
                      <p className="text-xs text-slate-500">
                        {r.scannedSoFar} of {r.expectedUnits} units scanned
                        {r.remaining !== null && r.remaining > 0 && ` — ${r.remaining} remaining`}
                      </p>
                    </>
                  )}
                </div>
              )}

              {r.isLot && (
                <div className="mt-2 space-y-1">
                  {r.lotSize ? (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-purple-400">Lot of {r.lotSize}</span>
                        <span className="text-xs text-purple-300 font-medium">{r.scannedSoFar}/{r.lotSize}</span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${r.scannedSoFar >= r.lotSize ? "bg-green-500" : "bg-purple-500"}`}
                          style={{ width: `${Math.min(100, r.lotSize > 0 ? (r.scannedSoFar / r.lotSize) * 100 : 0)}%` }}
                        />
                      </div>
                      <p className="text-xs text-slate-500">
                        {r.scannedSoFar >= r.lotSize
                          ? "All units scanned — ready for reconciliation"
                          : `${r.lotSize - r.scannedSoFar} remaining — keep scanning`}
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-purple-400">
                      {r.scannedSoFar} units scanned so far. Keep scanning to count all units in the lot.
                    </p>
                  )}
                </div>
              )}

              {/* Item details (single-item orders only — multi-item shown in progress above) */}
              {(r.allItems?.length ?? 0) <= 1 && (
                <div className="mt-2">
                  {r.allItems?.map((item, j) => (
                    <p key={j} className="text-xs text-slate-400">
                      {item.title} (listed qty: {item.qty})
                    </p>
                  ))}
                </div>
              )}
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

      {/* Lot confirmation modal */}
      {lotConfirmation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-lg border border-blue-800 bg-slate-900 p-6 shadow-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-blue-400">
              {lotConfirmation.shipments
                ? `Shared Box — ${lotConfirmation.shipments.length} Orders (${lotConfirmation.totalUnits} items)`
                : lotConfirmation.isMultiQty
                  ? `Multi-Qty Order (${lotConfirmation.totalUnits} items)`
                  : "Lot Detected"}
            </h3>
            <p className="mt-1 text-xs text-slate-500 truncate">{lotConfirmation.title}</p>

            {/* Step 1: Edit breakdown — shown when AI doesn't know per-product quantities */}
            {lotStep === "breakdown" && (
              <div className="mt-4">
                <p className="text-sm text-slate-300 mb-3">
                  {lotConfirmation.totalUnits} items detected — how many of each?
                </p>
                <div className="space-y-2">
                  {lotBreakdownEdit.map((item, i) => (
                    <div key={i} className="flex items-center gap-3 rounded bg-slate-800 px-3 py-2">
                      <span className="flex-1 text-sm text-slate-200">{item.product}</span>
                      <input
                        type="number"
                        min={0}
                        max={lotConfirmation.totalUnits}
                        value={item.quantity || ""}
                        onChange={(e) => {
                          const updated = [...lotBreakdownEdit];
                          updated[i] = { ...item, quantity: parseInt(e.target.value) || 0 };
                          setLotBreakdownEdit(updated);
                        }}
                        className="w-16 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-center text-slate-200"
                        placeholder="qty"
                      />
                    </div>
                  ))}
                </div>
                {(() => {
                  const total = lotBreakdownEdit.reduce((s, i) => s + i.quantity, 0);
                  const expected = lotConfirmation.totalUnits;
                  const isValid = total === expected;
                  return (
                    <div className="mt-3">
                      <p className={`text-xs ${isValid ? "text-green-400" : "text-yellow-400"}`}>
                        {total} of {expected} assigned
                        {!isValid && ` — must equal ${expected}`}
                      </p>
                      <button
                        onClick={() => applyBreakdownToUnits(lotBreakdownEdit)}
                        disabled={!isValid}
                        className="mt-3 w-full rounded-lg bg-blue-600 hover:bg-blue-700 px-4 py-3 text-sm font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Continue
                      </button>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Step 2: Expected vs Received — user confirms what arrived */}
            {lotStep === "confirm" && (
              <>
                <div className="mt-4 space-y-2">
                  {(() => {
                    const hasShipments = lotConfirmation.shipments && lotConfirmation.shipments.length > 1;

                    // Group items by shipment for display
                    const shipmentGroups: Array<{ label: string; orderId: string; items: Array<{ item: LotReceivedEdit; globalIdx: number }> }> = [];

                    if (hasShipments) {
                      const byShipment = new Map<number, Array<{ item: LotReceivedEdit; globalIdx: number }>>();
                      lotReceivedEdit.forEach((item, i) => {
                        const shIdx = item.shipmentIdx ?? 0;
                        if (!byShipment.has(shIdx)) byShipment.set(shIdx, []);
                        byShipment.get(shIdx)!.push({ item, globalIdx: i });
                      });
                      for (const [shIdx, items] of byShipment) {
                        const sh = lotConfirmation.shipments![shIdx];
                        shipmentGroups.push({
                          label: `Order ${sh.orderId} — ${sh.expectedUnits} items`,
                          orderId: sh.orderId,
                          items,
                        });
                      }
                    } else {
                      // Group by lot label (e.g., "Lot A", "Lot B") if present
                      const hasGroups = lotReceivedEdit.some(i => i.group);
                      if (hasGroups) {
                        const byGroup = new Map<string, Array<{ item: LotReceivedEdit; globalIdx: number }>>();
                        lotReceivedEdit.forEach((item, i) => {
                          const g = item.group ?? "";
                          if (!byGroup.has(g)) byGroup.set(g, []);
                          byGroup.get(g)!.push({ item, globalIdx: i });
                        });
                        for (const [g, items] of byGroup) {
                          const groupExpected = items.reduce((s, i) => s + i.item.expected, 0);
                          shipmentGroups.push({
                            label: g ? `${g} — ${groupExpected} items` : "",
                            orderId: lotConfirmation.orderId,
                            items,
                          });
                        }
                      } else {
                        shipmentGroups.push({
                          label: "",
                          orderId: lotConfirmation.orderId,
                          items: lotReceivedEdit.map((item, i) => ({ item, globalIdx: i })),
                        });
                      }
                    }

                    return shipmentGroups.map((group, gIdx) => (
                      <div key={gIdx}>
                        {group.label && (
                          <p className="text-xs font-medium text-slate-400 mt-3 mb-1 px-1">{group.label}</p>
                        )}
                        {gIdx === 0 && (
                          <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-1 items-center text-xs text-slate-500 px-3 mb-1">
                            <span>Product</span>
                            <span className="w-16 text-center">Expected</span>
                            <span className="w-20 text-center">Received</span>
                          </div>
                        )}
                        {group.items.map(({ item, globalIdx }) => {
                          const isMissing = item.received < item.expected;
                          return (
                            <div key={globalIdx} className={`grid grid-cols-[1fr_auto_auto] gap-x-3 items-center rounded px-3 py-2 ${isMissing ? "bg-red-950/40 border border-red-900/50" : "bg-slate-800"}`}>
                              <span className="text-sm text-slate-200">{item.product}</span>
                              <span className="w-16 text-center text-sm text-slate-400">{item.expected}</span>
                              <input
                                type="number"
                                min={0}
                                max={item.expected}
                                value={item.received}
                                onChange={(e) => {
                                  const updated = [...lotReceivedEdit];
                                  const val = parseInt(e.target.value) || 0;
                                  updated[globalIdx] = { ...item, received: Math.min(val, item.expected) };
                                  setLotReceivedEdit(updated);
                                }}
                                className="w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-center text-slate-200"
                              />
                            </div>
                          );
                        })}
                      </div>
                    ));
                  })()}
                </div>

                {(() => {
                  const totalExpected = lotReceivedEdit.reduce((s, i) => s + i.expected, 0);
                  const totalReceived = lotReceivedEdit.reduce((s, i) => s + i.received, 0);
                  const totalMissing = totalExpected - totalReceived;
                  return (
                    <>
                      <div className="mt-3 flex justify-between text-xs px-1">
                        <span className="text-slate-500">{totalReceived} of {totalExpected} received</span>
                        {totalMissing > 0 && (
                          <span className="text-red-400 font-medium">{totalMissing} missing</span>
                        )}
                      </div>

                      <div className="mt-4">
                        <p className="text-sm font-medium text-slate-200">
                          {totalReceived === 0
                            ? "No items received?"
                            : `Are all ${totalReceived} received items in good condition?`}
                        </p>
                        <div className="mt-3 flex gap-3">
                          <button
                            onClick={() => handleReceivedConfirmAllGood()}
                            disabled={lotSubmitting || totalReceived === 0}
                            className="flex-1 rounded-lg bg-green-600 hover:bg-green-700 px-4 py-3 text-sm font-medium text-white transition-colors disabled:opacity-50"
                          >
                            {lotSubmitting ? "Saving..." : "Yes, All Good"}
                          </button>
                          <button
                            onClick={() => handleReceivedGoToConditions()}
                            disabled={totalReceived === 0}
                            className="flex-1 rounded-lg border border-yellow-700 px-4 py-3 text-sm font-medium text-yellow-400 hover:bg-yellow-900/30 transition-colors disabled:opacity-50"
                          >
                            No, Some Have Issues
                          </button>
                        </div>
                      </div>
                    </>
                  );
                })()}
              </>
            )}

            {/* Step 3: Set conditions per unit */}
            {lotStep === "conditions" && (
              <div className="mt-4 space-y-2">
                {(() => {
                  // Split into received (editable) and missing (read-only)
                  const receivedUnits = lotUnits.filter(u => u.condition !== "missing");
                  const missingUnits = lotUnits.filter(u => u.condition === "missing");

                  // Group received units by product for display
                  const groups: Array<{ product: string; indices: number[] }> = [];
                  const productIndices = new Map<string, number[]>();
                  lotUnits.forEach((u, idx) => {
                    if (u.condition === "missing") return;
                    const existing = productIndices.get(u.product);
                    if (existing) {
                      existing.push(idx);
                    } else {
                      const arr = [idx];
                      productIndices.set(u.product, arr);
                      groups.push({ product: u.product, indices: arr });
                    }
                  });

                  return (
                    <>
                      {groups.map((group) => (
                        <div key={group.product} className="rounded border border-slate-800 p-3">
                          <p className="text-sm font-medium text-slate-300 mb-2">{group.product}</p>
                          {group.indices.map((unitIdx, j) => {
                            const unit = lotUnits[unitIdx];
                            if (!unit) return null;
                            const isGood = unit.condition === "good";
                            return (
                              <div key={unitIdx} className={`flex items-center gap-2 py-1 ${!isGood ? "bg-red-950/30 rounded px-2 -mx-1" : ""}`}>
                                <span className="text-xs text-slate-500 w-6">#{j + 1}</span>
                                <select
                                  value={unit.condition}
                                  onChange={(e) => {
                                    const updated = [...lotUnits];
                                    updated[unitIdx] = { ...unit, condition: e.target.value };
                                    setLotUnits(updated);
                                  }}
                                  className="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-300"
                                >
                                  {conditions.length === 0 ? (
                                    <option value="good">Good</option>
                                  ) : (
                                    conditions.filter(c => c !== "missing").map(c => (
                                      <option key={c} value={c}>
                                        {c.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())}
                                      </option>
                                    ))
                                  )}
                                </select>
                                {!isGood && (
                                  <input
                                    type="text"
                                    value={unit.notes}
                                    onChange={(e) => {
                                      const updated = [...lotUnits];
                                      updated[unitIdx] = { ...unit, notes: e.target.value };
                                      setLotUnits(updated);
                                    }}
                                    placeholder="Notes"
                                    className="w-32 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-300"
                                  />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ))}

                      {missingUnits.length > 0 && (
                        <div className="rounded border border-red-900/50 bg-red-950/20 p-3">
                          <p className="text-sm font-medium text-red-400 mb-1">Missing ({missingUnits.length})</p>
                          {(() => {
                            const missingByProduct = new Map<string, number>();
                            for (const u of missingUnits) {
                              missingByProduct.set(u.product, (missingByProduct.get(u.product) ?? 0) + 1);
                            }
                            return Array.from(missingByProduct).map(([product, count]) => (
                              <div key={product} className="flex items-center justify-between text-xs text-red-300 py-0.5">
                                <span>{product}</span>
                                <span>x{count}</span>
                              </div>
                            ));
                          })()}
                        </div>
                      )}
                    </>
                  );
                })()}

                <div className="flex gap-3 pt-3">
                  <button
                    onClick={() => setLotStep("confirm")}
                    className="rounded border border-slate-700 px-4 py-2 text-sm text-slate-400 hover:bg-slate-800"
                  >
                    Back
                  </button>
                  <button
                    onClick={() => handleLotConfirm()}
                    disabled={lotSubmitting}
                    className="flex-1 rounded-lg bg-blue-600 hover:bg-blue-700 px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50"
                  >
                    {lotSubmitting ? "Saving..." : `Confirm ${lotUnits.length} Items`}
                  </button>
                </div>
              </div>
            )}

            <button
              onClick={() => {
                setLotConfirmation(null);
                setStatus("Lot confirmation skipped — scan items individually");
                setStatusType("warning");
              }}
              className="mt-4 w-full text-center text-xs text-slate-500 hover:text-slate-400"
            >
              Skip — scan items one at a time instead
            </button>
          </div>
        </div>
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
