"use client";

import { useState, useEffect } from "react";

export default function BackfillOriginalTotals() {
  const [status, setStatus] = useState<{ total: number; withOriginal: number } | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ updated: number; errors: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function fetchStatus() {
    const res = await fetch("/api/dev/backfill-original-totals");
    const data = await res.json();
    if (data.total) setStatus(data);
  }

  useEffect(() => { fetchStatus(); }, []);

  async function handleRun() {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/dev/backfill-original-totals", { method: "POST" });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? "Failed");
      } else {
        setResult({ updated: data.updated, errors: data.errors });
        await fetchStatus();
      }
    } catch {
      setError("Network error");
    } finally {
      setRunning(false);
    }
  }

  const pct = status ? Math.round((status.withOriginal / status.total) * 100) : 0;
  const done = status?.withOriginal === status?.total && !!status;

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900 p-4 space-y-4">
      <div>
        <h3 className="font-semibold text-slate-100">Backfill Original Order Totals</h3>
        <p className="mt-0.5 text-xs text-slate-400">
          Re-fetches all orders from the eBay Trading API to populate{" "}
          <code>original_total</code> (pre-refund subtotal) using the{" "}
          <code>Subtotal</code> and <code>AdjustmentAmount</code> fields
          already returned by the API. No browser or login required.
        </p>
      </div>

      {status && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>{status.withOriginal} / {status.total} orders have original_total</span>
            <span className="font-mono">{pct}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-slate-700 overflow-hidden">
            <div
              className="h-full rounded-full bg-green-500 transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {result && (
        <p className="text-xs text-green-400">
          Done — {result.updated} orders updated{result.errors > 0 ? `, ${result.errors} errors` : ""}.
        </p>
      )}

      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}

      <button
        type="button"
        onClick={handleRun}
        disabled={running || done}
        className="px-4 py-1.5 rounded bg-blue-600 text-sm font-medium text-white
          hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {running ? "Running… (this may take a minute)" : done ? "All orders backfilled" : "Run Backfill"}
      </button>
    </div>
  );
}
