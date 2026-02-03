"use client";

import { useState } from "react";

export default function RefreshButton() {
  const [status, setStatus] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/orders/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    setStatus(res.ok ? "Sync queued." : "Failed to queue sync.");
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button className="rounded bg-blue-500 px-3 py-2 text-sm text-white" onClick={refresh}>
        Refresh now
      </button>
      {status ? <span className="text-xs text-slate-400">{status}</span> : null}
    </div>
  );
}
