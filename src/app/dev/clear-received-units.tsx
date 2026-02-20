"use client";

import { useState } from "react";

type Counts = {
  unit_images: number;
  received_units: number;
  receiving_scans: number;
};

export default function ClearReceivedUnits() {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  function addLog(msg: string) {
    setLog((prev) => [...prev, msg]);
  }

  async function fetchCounts() {
    const res = await fetch("/api/dev/clear-received-units");
    if (res.ok) setCounts(await res.json());
  }

  async function handleClear() {
    if (!confirm(
      "This will delete ALL received units, unit photos, and receiving scans.\n\nShipment check-in state will be reset.\n\nAre you sure?"
    )) return;
    setLoading(true);
    setLog([]);
    try {
      const res = await fetch("/api/dev/clear-received-units", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        const d = data.deleted;
        addLog(`✓ Cleared: ${d.received_units} received units, ${d.unit_images} photos, ${d.receiving_scans} scans`);
        addLog("✓ Shipment check-in state reset");
        setCounts({ unit_images: 0, received_units: 0, receiving_scans: 0 });
      } else {
        addLog(`✗ Error: ${data.error}`);
      }
    } catch (e: any) {
      addLog(`✗ Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900 p-4 space-y-4">
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
            {counts.received_units} received units · {counts.unit_images} photos · {counts.receiving_scans} scans
          </span>
        )}
      </div>

      <div className="space-y-1">
        <p className="text-xs text-slate-500">
          Clears received units, photos, and receiving scans. Resets shipment check-in state.
          Orders, shipments, returns, and INR cases are <span className="text-slate-300">not</span> affected.
        </p>
        <button
          onClick={handleClear}
          disabled={loading}
          className="rounded bg-orange-800 px-3 py-1.5 text-sm text-white hover:bg-orange-700 disabled:opacity-50"
        >
          {loading ? "Clearing…" : "Clear Received Units"}
        </button>
      </div>

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
