"use client";

import { useState, useEffect, useRef } from "react";

interface Progress {
  total: number;
  withOriginal: number;
  needsScrape: number;
  states: Record<string, number>;
}

export default function ScrapeOrderTotals() {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enqueued, setEnqueued] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchProgress() {
    try {
      const res = await fetch("/api/dev/scrape-order-totals");
      const data = await res.json();
      if (data.ok !== false) setProgress(data);
    } catch {
      // ignore polling errors
    }
  }

  useEffect(() => {
    fetchProgress();
  }, []);

  // Poll while jobs are running (PENDING state > 0)
  useEffect(() => {
    if (!running) return;
    pollRef.current = setInterval(() => {
      fetchProgress().then(() => {
        // Stop polling when no more PENDING
        setProgress(prev => {
          if (prev && (prev.states["PENDING"] ?? 0) === 0 && prev.withOriginal > 0) {
            setRunning(false);
          }
          return prev;
        });
      });
    }, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [running]);

  async function handleStart(reset = false) {
    setError(null);
    setRunning(true);
    setEnqueued(null);
    try {
      const res = await fetch("/api/dev/scrape-order-totals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset })
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? "Failed to start");
        setRunning(false);
        return;
      }
      setEnqueued(data.enqueued);
      if (data.enqueued === 0) {
        setRunning(false);
        await fetchProgress();
      }
    } catch {
      setError("Network error");
      setRunning(false);
    }
  }

  const pending = progress?.states["PENDING"] ?? 0;
  const done = progress?.states["DONE"] ?? 0;
  const failed = progress?.states["FAILED"] ?? 0;
  const needsLogin = progress?.states["NEEDS_LOGIN"] ?? 0;
  const pct = progress ? Math.round((progress.withOriginal / progress.total) * 100) : 0;

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900 p-4 space-y-4">
      <div>
        <h3 className="font-semibold text-slate-100">Scrape Order Totals</h3>
        <p className="mt-0.5 text-xs text-slate-400">
          Uses a headless browser with your saved eBay session to visit each order page and extract
          the original pre-refund order total. Runs at 1 order at a time to avoid detection.
        </p>
      </div>

      {/* Progress bar */}
      {progress && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>{progress.withOriginal} / {progress.total} orders scraped</span>
            <span className="font-mono">{pct}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-slate-700 overflow-hidden">
            <div
              className="h-full rounded-full bg-green-500 transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="grid grid-cols-4 gap-2 text-xs">
            <div className="rounded bg-slate-800 p-2 text-center">
              <p className="text-slate-500">Pending</p>
              <p className="text-slate-200 font-bold text-base">{pending}</p>
            </div>
            <div className="rounded bg-slate-800 p-2 text-center">
              <p className="text-slate-500">Done</p>
              <p className="text-green-400 font-bold text-base">{done}</p>
            </div>
            <div className="rounded bg-slate-800 p-2 text-center">
              <p className="text-slate-500">Failed</p>
              <p className="text-red-400 font-bold text-base">{failed}</p>
            </div>
            <div className="rounded bg-slate-800 p-2 text-center">
              <p className="text-slate-500">Needs login</p>
              <p className="text-yellow-400 font-bold text-base">{needsLogin}</p>
            </div>
          </div>
        </div>
      )}

      {enqueued !== null && (
        <p className="text-xs text-slate-400">
          {enqueued === 0
            ? "No orders need scraping — all already have original_total set."
            : `${enqueued} jobs enqueued. Worker is processing orders now…`}
        </p>
      )}

      {needsLogin > 0 && (
        <div className="rounded border border-yellow-700 bg-yellow-950/30 p-3 text-xs text-yellow-300">
          {needsLogin} order(s) need a valid eBay session. Re-authenticate the eBay account in Settings,
          then click "Retry failed / needs-login" below.
        </div>
      )}

      {error && (
        <div className="rounded border border-red-700 bg-red-950 p-3 text-xs text-red-300">{error}</div>
      )}

      <div className="flex gap-3 flex-wrap">
        <button
          type="button"
          onClick={() => handleStart(false)}
          disabled={running || (progress?.needsScrape === 0)}
          className="px-4 py-1.5 rounded bg-blue-600 text-sm font-medium text-white
            hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {running ? "Running…" : "Start Scrape"}
        </button>
        {(failed > 0 || needsLogin > 0) && (
          <button
            type="button"
            onClick={() => handleStart(true)}
            disabled={running}
            className="px-4 py-1.5 rounded border border-slate-600 text-sm text-slate-300
              hover:text-white hover:border-slate-400 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Retry failed / needs-login
          </button>
        )}
        <button
          type="button"
          onClick={fetchProgress}
          disabled={running}
          className="px-3 py-1.5 rounded border border-slate-700 text-xs text-slate-400 hover:text-slate-200"
        >
          Refresh
        </button>
      </div>
    </div>
  );
}
