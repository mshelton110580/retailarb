"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";

type ScanResult = {
  resolution: string;
  matchCount: number;
  receivedUnits: number;
  orders: Array<{
    orderId: string;
    items: Array<{ title: string; qty: number; itemId: string }>;
  }>;
};

export default function ReceivingForm() {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  const [statusType, setStatusType] = useState<"success" | "warning" | "error">("success");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const trackingRef = useRef<HTMLInputElement>(null);

  // Keep tracking input focused at all times for barcode scanner
  useEffect(() => {
    trackingRef.current?.focus();

    // Re-focus on tracking input if user clicks elsewhere on the page
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Don't steal focus from other form controls
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

      const data = await res.json();

      if (res.ok) {
        setResult(data);
        if (data.resolution === "MATCHED") {
          setStatus(`✓ Matched ${data.matchCount} tracking record(s). ${data.receivedUnits} item(s) checked in.`);
          setStatusType("success");
        } else {
          setStatus("⚠ No matching tracking number found. Scan saved as UNRESOLVED.");
          setStatusType("warning");
        }
        // Clear only the tracking field, keep condition and notes for batch scanning
        if (trackingRef.current) trackingRef.current.value = "";
        trackingRef.current?.focus();
        router.refresh();
      } else {
        setStatus(`Error: ${data.error || "Scan failed"}`);
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

  // Handle Enter key on tracking input — auto-submit without needing to click button
  function handleTrackingKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault(); // Prevent default form submit which reloads page
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

  const statusColor = statusType === "success" ? "text-green-400" : statusType === "warning" ? "text-yellow-400" : "text-red-400";

  return (
    <div className="space-y-4">
      <form ref={formRef} className="rounded-lg border border-slate-800 bg-slate-900 p-4" onSubmit={onSubmit}>
        <h2 className="text-lg font-semibold">Scan Tracking Number</h2>
        <p className="text-xs text-slate-500 mt-1">Scan barcode or type tracking number and press Enter</p>
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
        {status && (
          <p className={`mt-2 text-sm font-medium ${statusColor}`}>
            {status}
          </p>
        )}
      </form>

      {result?.resolution === "MATCHED" && result.orders.length > 0 && (
        <div className="rounded-lg border border-green-800 bg-slate-900 p-4">
          <h3 className="text-sm font-semibold text-green-400">Matched Orders</h3>
          {result.orders.map((order, i) => (
            <div key={i} className="mt-2 rounded border border-slate-800 p-3">
              <p className="text-sm font-medium">Order {order.orderId}</p>
              {order.items?.map((item, j) => (
                <p key={j} className="text-xs text-slate-400">
                  {item.title} (x{item.qty})
                </p>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
