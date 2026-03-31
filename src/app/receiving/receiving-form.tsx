"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import ImageUploadPanel from "@/components/image-upload-panel";
import { useBarcodeScanner } from "@/lib/use-barcode-scanner";

type LotBreakdownItem = {
  product: string;
  quantity: number;
  group?: string;
  productId?: string | null;
  confidence?: string;
  requiresManualSelection?: boolean;
  suggestedProductName?: string;
};

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
  productInfo: {
    productId: string | null;
    confidence: "high" | "medium" | "low";
    requiresManualSelection: boolean;
    reason?: string;
    suggestedProductName?: string;
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

type Product = {
  id: string;
  product_name: string;
  gtin: string | null;
};

export default function ReceivingForm() {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  const [statusType, setStatusType] = useState<"success" | "warning" | "error" | "lot">("success");
  const [result, setResult] = useState<ScanResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const submittingRef = useRef(false); // Synchronous guard against double-submission
  const modalKeysRef = useRef({ lastTime: 0, burst: 0 }); // Detect scanner input in modal
  const formRef = useRef<HTMLFormElement>(null);
  const trackingRef = useRef<HTMLInputElement>(null);
  const [productOptions, setProductOptions] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  // Image upload panel state — triggered when a non-good unit is scanned
  const [imageUploadUnit, setImageUploadUnit] = useState<{
    unitId: string;
    unitIndex: number;
    title: string;
    groupUnitIds?: string[];
  } | null>(null);
  // Photo queue for lot/multi-unit — grouped by eBay item (one QR per item)
  const [lotPhotoQueue, setLotPhotoQueue] = useState<Array<{
    unitId: string;
    unitIndex: number;
    title: string;
    groupUnitIds?: string[];
  }>>([]);

  const [conditions, setConditions] = useState<string[]>([]);

  // Lot confirmation modal state
  type LotUnitState = { product: string; condition: string; notes: string; productId?: string | null };
  type LotBreakdownEdit = { product: string; quantity: number };
  type LotReceivedEdit = {
    product: string; expected: number; received: number; shipmentIdx?: number; group?: string;
    productId?: string | null; confidence?: string; requiresManualSelection?: boolean;
  };
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

  const [pendingProductSelection, setPendingProductSelection] = useState<{
    unitId: string;
    unitIndex: number;
    title: string;
    reason: string;
    suggestedProductName?: string;
  } | null>(null);
  const [editedProductName, setEditedProductName] = useState<string>("");
  const [createMergeMapping, setCreateMergeMapping] = useState<boolean>(true);

  // Detect barcode scanner input and route to tracking field
  useBarcodeScanner(trackingRef, (value) => {
    if (lotConfirmation) return; // Block scanner while lot confirmation modal is open
    submitScan(value);
  });

  const submitScan = useCallback(async (trackingValue: string) => {
    if (!trackingValue.trim() || loading || submittingRef.current || lotConfirmation) return;
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

        if ((data as any).duplicate) {
          setStatus(`⚠ ${data.message}`);
          setStatusType("warning");
        } else if (data.resolution === "UNRESOLVED") {
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
                productId: i.productId,
                confidence: i.confidence,
                requiresManualSelection: i.requiresManualSelection,
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
  }, [loading, lotConfirmation, router]);

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

  async function loadProducts() {
    if (productOptions.length > 0) return;

    setLoadingProducts(true);
    try {
      const res = await fetch("/api/products");
      const data = await res.json();
      if (res.ok) {
        setProductOptions(data.products);
      }
    } catch (err) {
      console.error("Failed to load products:", err);
    } finally {
      setLoadingProducts(false);
    }
  }

  async function handleProductSelection(unitId: string, productId: string | null, suggestedName?: string, shouldCreateMerge?: boolean) {
    try {
      // Only create merge mapping if explicitly requested
      if (productId && suggestedName && shouldCreateMerge) {
        const mergeRes = await fetch("/api/products/merge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fromProductName: suggestedName,
            toProductId: productId
          })
        });

        if (!mergeRes.ok) {
          const mergeData = await mergeRes.json();
          setStatus(`Error creating merge: ${mergeData.error}`);
          setStatusType("error");
          return;
        }
      }

      // Assign product to the unit
      const res = await fetch(`/api/receiving/unit/${unitId}/product`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId })
      });

      if (res.ok) {
        setPendingProductSelection(null);
        if (suggestedName && productId && shouldCreateMerge) {
          setStatus(`✓ Product merged: "${suggestedName}" → existing product. Future scans will auto-merge.`);
        } else if (suggestedName && productId && !shouldCreateMerge) {
          setStatus(`✓ Product assigned (no alias created). "${suggestedName}" will prompt again on future scans.`);
        } else {
          setStatus("✓ Product assigned successfully");
        }
        setStatusType("success");
        router.refresh();
      } else {
        const data = await res.json();
        setStatus(`Error assigning product: ${data.error}`);
        setStatusType("error");
      }
    } catch {
      setStatus("Network error while assigning product");
      setStatusType("error");
    }
  }

  async function handleCreateNewProduct(unitId: string, productName: string) {
    try {
      // Create the new product
      const createRes = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: productName })
      });

      if (!createRes.ok) {
        const createData = await createRes.json();
        setStatus(`Error creating product: ${createData.error}`);
        setStatusType("error");
        return;
      }

      const createData = await createRes.json();
      const newProductId = createData.product?.id;

      if (!newProductId) {
        setStatus("Error: Failed to get new product ID");
        setStatusType("error");
        return;
      }

      // Assign the new product to the unit
      const assignRes = await fetch(`/api/receiving/unit/${unitId}/product`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: newProductId })
      });

      if (assignRes.ok) {
        setPendingProductSelection(null);
        setStatus(`✓ New product "${productName}" created and assigned`);
        setStatusType("success");
        router.refresh();
      } else {
        const assignData = await assignRes.json();
        setStatus(`Error assigning new product: ${assignData.error}`);
        setStatusType("error");
      }
    } catch {
      setStatus("Network error while creating product");
      setStatusType("error");
    }
  }

  /** Group non-good units by product name into grouped photo sessions (one QR per eBay item) */
  function buildPhotoGroups(units: Array<{ id: string; unitIndex: number; condition: string; product: string }>) {
    const goodConditions = new Set(["good", "new", "like_new", "acceptable", "excellent"]);
    const needPhotos = units.filter(u => !goodConditions.has(u.condition?.toLowerCase() ?? ""));
    if (needPhotos.length === 0) return [];

    // If only one unit needs photos, no grouping needed
    if (needPhotos.length === 1) {
      return [{ unitId: needPhotos[0].id, unitIndex: needPhotos[0].unitIndex, title: needPhotos[0].product }];
    }

    // Group by product name — one QR code per distinct product
    const byProduct = new Map<string, typeof needPhotos>();
    for (const u of needPhotos) {
      const key = u.product || "Unknown";
      if (!byProduct.has(key)) byProduct.set(key, []);
      byProduct.get(key)!.push(u);
    }

    const groups: Array<{ unitId: string; unitIndex: number; title: string; groupUnitIds?: string[] }> = [];
    for (const [product, productUnits] of byProduct) {
      if (productUnits.length === 1) {
        groups.push({ unitId: productUnits[0].id, unitIndex: productUnits[0].unitIndex, title: product });
      } else {
        // Grouped: primary unit is the first, all unit IDs passed for single QR
        groups.push({
          unitId: productUnits[0].id,
          unitIndex: productUnits[0].unitIndex,
          title: product,
          groupUnitIds: productUnits.map(u => u.id),
        });
      }
    }
    return groups;
  }

  /** Start photo upload flow from a list of photo groups */
  function startPhotoFlow(groups: Array<{ unitId: string; unitIndex: number; title: string; groupUnitIds?: string[] }>) {
    if (groups.length === 0) {
      trackingRef.current?.focus();
      return;
    }
    setLotPhotoQueue(groups.slice(1));
    setImageUploadUnit(groups[0]);
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
        units.push({ product: item.product, condition: "good", notes: "", productId: item.productId });
      }
      // Missing units
      const missing = item.expected - item.received;
      for (let i = 0; i < missing; i++) {
        units.push({ product: item.product, condition: "missing", notes: "Not received", productId: item.productId });
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
        const allCreatedUnits: Array<{ id: string; unitIndex: number; condition: string; product: string }> = [];

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
                productId: u.productId || undefined,
              })),
              ...(!sh.isLot && sh.orderItems ? {
                isMultiQty: true,
                orderItems: sh.orderItems,
              } : {}),
            }),
          });
          const data = await res.json();
          if (res.ok) {
            totalCreated += data.unitsReceived ?? data.unitsCreated;
            if (data.units) allCreatedUnits.push(...data.units);
          } else {
            errors.push(`Order ${sh.orderId}: ${data.error}`);
          }
        });

        await Promise.all(requests);

        const photoGroups = buildPhotoGroups(allCreatedUnits);

        if (errors.length > 0) {
          setStatus(`Partially saved — ${totalCreated} units. Errors: ${errors.join("; ")}`);
          setStatusType("warning");
        } else {
          setLotConfirmation(null);
          setResult(null);
          setStatus(`✓ ${totalCreated} units checked in across ${lotConfirmation.shipments.length} orders${photoGroups.length > 0 ? ` — ${photoGroups.reduce((s, g) => s + (g.groupUnitIds?.length ?? 1), 0)} need photos` : ""}`);
          setStatusType(photoGroups.length > 0 ? "warning" : "success");
        }
        if (trackingRef.current) trackingRef.current.value = "";
        setTimeout(() => trackingRef.current?.focus(), 100);
        router.refresh();

        startPhotoFlow(photoGroups);
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
              productId: u.productId || undefined,
            })),
            ...(lotConfirmation.isMultiQty ? {
              isMultiQty: true,
              orderItems: lotConfirmation.orderItems,
            } : {}),
          }),
        });
        const data = await res.json();
        if (res.ok) {
          const createdUnits: Array<{ id: string; unitIndex: number; condition: string; product: string }> = data.units ?? [];
          const photoGroups = buildPhotoGroups(createdUnits);

          setLotConfirmation(null);
          setResult(null);
          const received = data.unitsReceived ?? data.unitsCreated;
          const missing = data.unitsMissing ?? 0;
          const missingText = missing > 0 ? ` (${missing} missing)` : "";
          const photoCount = photoGroups.reduce((s, g) => s + (g.groupUnitIds?.length ?? 1), 0);
          setStatus(`✓ ${received} units checked in${missingText}${photoCount > 0 ? ` — ${photoCount} need photos` : ""}`);
          setStatusType(photoCount > 0 ? "warning" : "success");
          if (trackingRef.current) trackingRef.current.value = "";
          setTimeout(() => trackingRef.current?.focus(), 100);
          router.refresh();

          startPhotoFlow(photoGroups);
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
            productId: u.productId || undefined,
          })),
          ...(lotConfirmation.isMultiQty ? {
            isMultiQty: true,
            orderItems: lotConfirmation.orderItems,
          } : {}),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        const createdUnits: Array<{ id: string; unitIndex: number; condition: string; product: string }> = data.units ?? [];
        const photoGroups = buildPhotoGroups(createdUnits);
        const photoCount = photoGroups.reduce((s, g) => s + (g.groupUnitIds?.length ?? 1), 0);

        setLotConfirmation(null);
        setResult(null);
        setStatus(`✓ ${data.unitsCreated} units checked in${photoCount > 0 ? ` — ${photoCount} need photos` : ""}`);
        setStatusType(photoCount > 0 ? "warning" : "success");
        if (trackingRef.current) trackingRef.current.value = "";
        setTimeout(() => trackingRef.current?.focus(), 100);
        router.refresh();

        startPhotoFlow(photoGroups);
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

  // Check if scan result requires manual product selection
  useEffect(() => {
    if (result?.results?.[0]?.productInfo?.requiresManualSelection) {
      const r = result.results[0];
      const suggestedName = r.productInfo.suggestedProductName || "";
      setPendingProductSelection({
        unitId: r.unitId,
        unitIndex: r.unitIndex,
        title: r.item.title,
        reason: r.productInfo.reason || "Manual selection required",
        suggestedProductName: suggestedName
      });
      setEditedProductName(suggestedName);
      setCreateMergeMapping(true); // Default to creating merge mapping
      loadProducts();
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
            className={`rounded border px-3 py-2 text-sm font-mono ${lotConfirmation ? "border-fuchsia-700 bg-slate-900 text-slate-500" : "border-slate-700 bg-slate-950"}`}
            name="tracking"
            placeholder={lotConfirmation ? "Complete lot confirmation first..." : "Scan or enter tracking number"}
            autoFocus
            autoComplete="off"
            required
            disabled={!!lotConfirmation}
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
          queueRemaining={imageUploadUnit.groupUnitIds ? 0 : lotPhotoQueue.length}
          groupUnitIds={imageUploadUnit.groupUnitIds}
          onClose={() => {
            if (lotPhotoQueue.length > 0) {
              // Advance to next group in the photo queue
              setImageUploadUnit(lotPhotoQueue[0]);
              setLotPhotoQueue(prev => prev.slice(1));
            } else {
              setImageUploadUnit(null);
              trackingRef.current?.focus();
            }
          }}
        />
      )}

      {/* Lot confirmation modal */}
      {lotConfirmation && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onKeyDown={(e) => {
            // Block Enter everywhere in the modal — barcode scanners send Enter
            // after digits which could accidentally trigger "Yes, All Good" or
            // "Continue" buttons. Users must click buttons to confirm.
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              return;
            }
            // Detect barcode scanner rapid-fire input and block it from
            // corrupting number fields in the modal. Scanner sends 20+ chars
            // in <200ms. Normal human typing is 1 char every 100-300ms.
            if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
              const now = Date.now();
              const elapsed = now - modalKeysRef.current.lastTime;
              modalKeysRef.current.lastTime = now;
              modalKeysRef.current.burst = elapsed < 80 ? modalKeysRef.current.burst + 1 : 0;
              if (modalKeysRef.current.burst >= 3) {
                e.preventDefault();
                e.stopPropagation();
              }
            }
          }}
        >
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
                          const needsSelection = item.requiresManualSelection && !item.productId;
                          return (
                            <div key={globalIdx} className={`grid grid-cols-[1fr_auto_auto] gap-x-3 items-center rounded px-3 py-2 ${needsSelection ? "bg-yellow-950/40 border border-yellow-800/50" : isMissing ? "bg-red-950/40 border border-red-900/50" : "bg-slate-800"}`}>
                              <div className="min-w-0">
                                {needsSelection ? (
                                  <div>
                                    <div className="flex items-center gap-1 mb-1">
                                      <span className="text-xs text-yellow-400 font-medium">Select product:</span>
                                    </div>
                                    <select
                                      className="w-full rounded border border-yellow-700 bg-slate-950 px-2 py-1 text-sm text-slate-200"
                                      value={item.productId ?? ""}
                                      onFocus={() => loadProducts()}
                                      onChange={(e) => {
                                        const updated = [...lotReceivedEdit];
                                        const selectedId = e.target.value || null;
                                        const selectedProduct = productOptions.find(p => p.id === selectedId);
                                        updated[globalIdx] = {
                                          ...item,
                                          productId: selectedId,
                                          requiresManualSelection: !selectedId,
                                          product: selectedProduct?.product_name ?? item.product,
                                        };
                                        setLotReceivedEdit(updated);
                                      }}
                                    >
                                      <option value="">— {item.product} (unmatched) —</option>
                                      {productOptions.map(p => (
                                        <option key={p.id} value={p.id}>{p.product_name}</option>
                                      ))}
                                    </select>
                                  </div>
                                ) : (
                                  <span className="text-sm text-slate-200">{item.product}</span>
                                )}
                              </div>
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
                  const hasUnresolvedProducts = lotReceivedEdit.some(i => i.requiresManualSelection && !i.productId);
                  return (
                    <>
                      <div className="mt-3 flex justify-between text-xs px-1">
                        <span className="text-slate-500">{totalReceived} of {totalExpected} received</span>
                        {totalMissing > 0 && (
                          <span className="text-red-400 font-medium">{totalMissing} missing</span>
                        )}
                      </div>

                      {hasUnresolvedProducts && (
                        <p className="mt-2 text-xs text-yellow-400 px-1">Select a product for highlighted items before confirming</p>
                      )}

                      <div className="mt-4">
                        <p className="text-sm font-medium text-slate-200">
                          {totalReceived === 0
                            ? "Confirm nothing was received?"
                            : `Are all ${totalReceived} received items in good condition?`}
                        </p>
                        <div className="mt-3 flex gap-3">
                          {totalReceived === 0 ? (
                            <button
                              onClick={() => handleReceivedConfirmAllGood()}
                              disabled={lotSubmitting}
                              className="flex-1 rounded-lg bg-red-600 hover:bg-red-700 px-4 py-3 text-sm font-medium text-white transition-colors disabled:opacity-50"
                            >
                              {lotSubmitting ? "Saving..." : `Confirm All ${totalExpected} Missing`}
                            </button>
                          ) : (
                            <>
                              <button
                                onClick={() => handleReceivedConfirmAllGood()}
                                disabled={lotSubmitting || hasUnresolvedProducts}
                                className="flex-1 rounded-lg bg-green-600 hover:bg-green-700 px-4 py-3 text-sm font-medium text-white transition-colors disabled:opacity-50"
                              >
                                {lotSubmitting ? "Saving..." : "Yes, All Good"}
                              </button>
                              <button
                                onClick={() => handleReceivedGoToConditions()}
                                disabled={hasUnresolvedProducts}
                                className="flex-1 rounded-lg border border-yellow-700 px-4 py-3 text-sm font-medium text-yellow-400 hover:bg-yellow-900/30 transition-colors disabled:opacity-50"
                              >
                                No, Some Have Issues
                              </button>
                            </>
                          )}
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
                setLotUnits([]);
                setLotBreakdownEdit([]);
                setLotReceivedEdit([]);
                setLotStep("confirm");
                setResult(null);
                setStatus("Scan cancelled");
                setStatusType("warning");
                setTimeout(() => trackingRef.current?.focus(), 100);
              }}
              className="mt-4 w-full text-center text-xs text-slate-500 hover:text-slate-400"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Product selection modal (blocking overlay) */}
      {pendingProductSelection && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-lg border border-indigo-800 bg-slate-900 p-6 shadow-2xl mx-4">
            <h3 className="text-lg font-semibold text-indigo-400">⚠️ Product Selection Required</h3>
            <p className="mt-2 text-sm text-slate-300">
              <strong>Unit #{pendingProductSelection.unitIndex}:</strong> {pendingProductSelection.title}
            </p>

            {pendingProductSelection.suggestedProductName && (
              <div className="mt-3 space-y-2">
                <div className="rounded-lg bg-blue-900/30 border border-blue-800 p-3">
                  <p className="text-sm font-medium text-blue-300">
                    System detected: <span className="font-bold text-blue-200">{pendingProductSelection.suggestedProductName}</span>
                  </p>
                  <p className="mt-1 text-xs text-blue-400">
                    Edit the name below, create as new, or merge with existing product
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">
                    Product Name:
                  </label>
                  <input
                    type="text"
                    value={editedProductName}
                    onChange={(e) => setEditedProductName(e.target.value)}
                    className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                    placeholder="Enter product name"
                  />
                </div>
              </div>
            )}

            <div className="mt-4 space-y-4">
              {loadingProducts ? (
                <p className="text-sm text-slate-500">Loading products...</p>
              ) : (
                <>
                  {/* Create new product button */}
                  {pendingProductSelection.suggestedProductName && (
                    <button
                      onClick={() => handleCreateNewProduct(
                        pendingProductSelection.unitId,
                        editedProductName.trim()
                      )}
                      disabled={!editedProductName.trim()}
                      className="w-full rounded-lg bg-green-600 hover:bg-green-700 px-4 py-3 text-sm font-medium text-white transition-colors shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      ✓ Create New Product{editedProductName.trim() ? `: "${editedProductName.trim()}"` : ""}
                    </button>
                  )}

                  {/* Assign to existing product */}
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-2">
                      Or assign to existing product:
                    </label>
                    <select
                      className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-300 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                      onChange={(e) => {
                        if (e.target.value) {
                          handleProductSelection(
                            pendingProductSelection.unitId,
                            e.target.value,
                            editedProductName.trim() || pendingProductSelection.suggestedProductName,
                            createMergeMapping
                          );
                        }
                      }}
                      defaultValue=""
                    >
                      <option value="">-- Select Existing Product --</option>
                      {productOptions.map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.product_name}
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
                            ✓ "{editedProductName.trim() || pendingProductSelection.suggestedProductName}" will automatically map to selected product in future scans
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
                        setPendingProductSelection(null);
                        setStatus("⚠ Product selection skipped - you can assign it later from the scans list");
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
                    You can edit the product later using the "Edit Product" button on the scans list.
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
