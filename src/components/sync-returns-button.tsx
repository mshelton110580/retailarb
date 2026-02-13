"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SyncReturnsButton() {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function handleSync() {
    setSyncing(true);
    setResult(null);

    try {
      const res = await fetch("/api/sync/returns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();

      if (res.ok) {
        const msg = `Synced ${data.synced?.returns ?? 0} returns, ${data.synced?.inquiries ?? 0} INR inquiries, ${data.synced?.cases ?? 0} cases`;
        setResult(data.errors?.length ? `${msg} (${data.errors.length} errors)` : msg);
        router.refresh();
      } else {
        setResult(`Error: ${data.error}`);
      }
    } catch {
      setResult("Network error. Please try again.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={handleSync}
        disabled={syncing}
        className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
      >
        {syncing ? "Syncing from eBay..." : "Sync Returns & INR from eBay"}
      </button>
      {result && (
        <span className="text-sm text-slate-400">{result}</span>
      )}
    </div>
  );
}
