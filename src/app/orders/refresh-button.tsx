"use client";

import { useState } from "react";

export default function RefreshButton() {
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    setStatus("Syncing orders from eBay...");
    try {
      const res = await fetch("/api/orders/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      if (res.ok) {
        const data = await res.json();
        setStatus(`Synced ${data.synced ?? 0} orders. Refreshing...`);
        setTimeout(() => window.location.reload(), 1500);
      } else {
        const data = await res.json().catch(() => ({}));
        setStatus(`Sync failed: ${data.error ?? "Unknown error"}`);
      }
    } catch (err: any) {
      setStatus(`Sync error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        className="rounded bg-blue-500 px-3 py-2 text-sm text-white disabled:opacity-50"
        onClick={refresh}
        disabled={loading}
      >
        {loading ? "Syncing..." : "Refresh now"}
      </button>
      {status ? <span className="text-xs text-slate-400">{status}</span> : null}
    </div>
  );
}
