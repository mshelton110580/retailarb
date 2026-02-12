"use client";

import { useState } from "react";

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
  const [status, setStatus] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setStatus(null);
    setResult(null);

    const form = new FormData(event.currentTarget);
    const payload = {
      tracking: form.get("tracking"),
      condition_status: form.get("condition_status"),
      notes: form.get("notes") || undefined
    };

    try {
      const res = await fetch("/api/receiving/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (res.ok) {
        setResult(data);
        if (data.resolution === "MATCHED") {
          setStatus(`Matched ${data.matchCount} tracking record(s). ${data.receivedUnits} item(s) checked in.`);
        } else {
          setStatus("No matching tracking number found. Scan saved as UNRESOLVED.");
        }
        event.currentTarget.reset();
      } else {
        setStatus(`Error: ${data.error || "Scan failed"}`);
      }
    } catch (err) {
      setStatus("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <form className="rounded-lg border border-slate-800 bg-slate-900 p-4" onSubmit={onSubmit}>
        <h2 className="text-lg font-semibold">Scan Tracking Number</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <input
            className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            name="tracking"
            placeholder="Scan or enter tracking number"
            autoFocus
            required
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
          <p className={`mt-2 text-sm ${result?.resolution === "MATCHED" ? "text-green-400" : "text-yellow-400"}`}>
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
