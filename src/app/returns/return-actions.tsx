"use client";

import { useState } from "react";

export default function ReturnActions({ returnId }: { returnId: string }) {
  const [status, setStatus] = useState<string | null>(null);

  async function markFiled() {
    const res = await fetch("/api/returns/filed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ returnId })
    });
    setStatus(res.ok ? "Return filed. Scrape scheduled." : "Failed to update return.");
  }

  async function refresh() {
    const res = await fetch("/api/returns/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ returnId })
    });
    setStatus(res.ok ? "Refresh queued." : "Refresh failed or rate limited.");
  }

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <button className="rounded bg-blue-500 px-3 py-1 text-xs text-white" onClick={markFiled}>
        I filed the return
      </button>
      <button className="rounded border border-slate-700 px-3 py-1 text-xs" onClick={refresh}>
        Refresh now
      </button>
      {status ? <p className="w-full text-xs text-slate-400">{status}</p> : null}
    </div>
  );
}
