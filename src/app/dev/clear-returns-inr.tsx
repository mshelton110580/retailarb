"use client";

import { useState } from "react";

type Counts = {
  orders: number;
  order_items: number;
  shipments: number;
  received_units: number;
  returns: number;
  inr_cases: number;
};

export default function ClearAndReimport() {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  function addLog(msg: string) {
    setLog((prev) => [...prev, msg]);
  }

  async function fetchCounts() {
    const res = await fetch("/api/dev/clear-returns-inr");
    if (res.ok) setCounts(await res.json());
  }

  async function handleClearAll() {
    if (!confirm(
      "This will delete ALL orders, order items, shipments, received units, returns, and INR cases.\n\nAre you sure?"
    )) return;
    setLoading(true);
    setLog([]);
    try {
      const res = await fetch("/api/dev/clear-returns-inr", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        const d = data.deleted;
        addLog(`✓ Cleared: ${d.orders} orders, ${d.order_items} items, ${d.shipments} shipments, ${d.received_units} received units, ${d.returns} returns, ${d.inr_cases} INR cases`);
        setCounts({ orders: 0, order_items: 0, shipments: 0, received_units: 0, returns: 0, inr_cases: 0 });
      } else {
        addLog(`✗ Error: ${data.error}`);
      }
    } catch (e: any) {
      addLog(`✗ Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleSyncOrders() {
    setLoading(true);
    addLog("Syncing orders…");
    try {
      const res = await fetch("/api/orders/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await res.json();
      if (data.ok) {
        addLog(`✓ Orders synced: ${data.synced} orders`);
      } else {
        addLog(`✗ Order sync error: ${data.error}`);
      }
    } catch (e: any) {
      addLog(`✗ Order sync error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleSyncReturns() {
    setLoading(true);
    addLog("Syncing returns & INR…");
    try {
      const res = await fetch("/api/sync/returns", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        const s = data.synced;
        addLog(`✓ Returns synced: ${s.returns} returns, ${s.inquiries} inquiries, ${s.cases} cases`);
        if (data.errors?.length) addLog(`⚠ Errors: ${data.errors.join("; ")}`);
      } else {
        addLog(`✗ Returns sync error: ${data.error}`);
      }
    } catch (e: any) {
      addLog(`✗ Returns sync error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900 p-4 space-y-4">
      {/* Step 1: Check current state */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={fetchCounts}
          disabled={loading}
          className="rounded bg-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-600 disabled:opacity-50"
        >
          Check Counts
        </button>
        {counts && (
          <span className="text-sm text-slate-400">
            {counts.orders} orders · {counts.order_items} items · {counts.shipments} shipments ·{" "}
            {counts.received_units} received · {counts.returns} returns · {counts.inr_cases} INR
          </span>
        )}
      </div>

      {/* Step 2: Clear */}
      <div className="space-y-1">
        <p className="text-xs text-slate-500">Step 1 — Clear everything (orders, items, shipments, received units, returns, INR)</p>
        <button
          onClick={handleClearAll}
          disabled={loading}
          className="rounded bg-red-800 px-3 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-50"
        >
          {loading ? "Working…" : "Clear All Data"}
        </button>
      </div>

      {/* Step 3: Sync orders */}
      <div className="space-y-1">
        <p className="text-xs text-slate-500">Step 2 — Reimport orders from eBay (90-day window)</p>
        <button
          onClick={handleSyncOrders}
          disabled={loading}
          className="rounded bg-blue-700 px-3 py-1.5 text-sm text-white hover:bg-blue-600 disabled:opacity-50"
        >
          {loading ? "Working…" : "Sync Orders"}
        </button>
      </div>

      {/* Step 4: Sync returns & INR */}
      <div className="space-y-1">
        <p className="text-xs text-slate-500">Step 3 — Reimport returns & INR cases (run after orders)</p>
        <button
          onClick={handleSyncReturns}
          disabled={loading}
          className="rounded bg-blue-700 px-3 py-1.5 text-sm text-white hover:bg-blue-600 disabled:opacity-50"
        >
          {loading ? "Working…" : "Sync Returns & INR"}
        </button>
      </div>

      {/* Log output */}
      {log.length > 0 && (
        <div className="rounded border border-slate-700 bg-slate-950 p-3 space-y-1">
          {log.map((line, i) => (
            <p key={i} className="text-xs font-mono text-slate-300">{line}</p>
          ))}
        </div>
      )}
    </div>
  );
}
