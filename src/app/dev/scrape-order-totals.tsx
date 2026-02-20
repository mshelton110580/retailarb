"use client";

import { useState, useEffect, useRef } from "react";

interface SessionInfo {
  id: string;
  username: string;
  hasSession: boolean;
  sessionType?: "profile" | "cookies" | "none";
}

interface Progress {
  total: number;
  withOriginal: number;
  needsScrape: number;
  states: Record<string, number>;
  sessionStatus: SessionInfo[];
  hasProfileDir?: boolean;
}

export default function ScrapeOrderTotals() {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enqueued, setEnqueued] = useState<{ orders: number; batches: number } | null>(null);
  const [cookieInput, setCookieInput] = useState("");
  const [savingSession, setSavingSession] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
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

  // Poll while jobs are pending
  useEffect(() => {
    if (!running) return;
    pollRef.current = setInterval(() => {
      fetchProgress().then(() => {
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
      setEnqueued({ orders: data.enqueued, batches: data.batches ?? 0 });
      if (data.enqueued === 0) {
        setRunning(false);
        await fetchProgress();
      }
    } catch {
      setError("Network error");
      setRunning(false);
    }
  }

  async function handleSaveSession() {
    const raw = cookieInput.trim();
    if (!raw) return;
    setSavingSession(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const res = await fetch("/api/dev/save-ebay-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookieString: raw })
      });
      const data = await res.json();
      if (!data.ok) {
        setSaveError(data.error ?? "Failed to save session");
      } else {
        setSaveSuccess(true);
        setCookieInput("");
        await fetchProgress();
      }
    } catch {
      setSaveError("Network error");
    } finally {
      setSavingSession(false);
    }
  }

  const pending = progress?.states["PENDING"] ?? 0;
  const done = progress?.states["DONE"] ?? 0;
  const failed = progress?.states["FAILED"] ?? 0;
  const needsLogin = progress?.states["NEEDS_LOGIN"] ?? 0;
  const pct = progress ? Math.round((progress.withOriginal / progress.total) * 100) : 0;
  const hasSession = progress?.sessionStatus?.every(s => s.hasSession) ?? false;
  const accounts = progress?.sessionStatus ?? [];

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900 p-4 space-y-4">
      <div>
        <h3 className="font-semibold text-slate-100">Scrape Order Totals</h3>
        <p className="mt-0.5 text-xs text-slate-400">
          Visits each eBay order page to extract the original pre-refund total.
          Computes: <code>original_total = current_total + refunds</code>.
        </p>
      </div>

      {/* Session status */}
      {accounts.map(a => (
        <div key={a.id} className={`rounded border px-3 py-2.5 text-xs ${
          a.hasSession
            ? "border-green-700 bg-green-950/30"
            : "border-yellow-700 bg-yellow-950/30"
        }`}>
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full flex-shrink-0 ${a.hasSession ? "bg-green-400" : "bg-yellow-400"}`} />
            <span className="font-mono text-slate-200">{a.username}</span>
            <span className="text-slate-400">
              {a.hasSession ? "eBay session active" : "No eBay session — paste cookies below to connect"}
            </span>
          </div>

          {/* Cookie paste form — shown when no session */}
          {!a.hasSession && (
            <div className="mt-3 space-y-2">
              <p className="text-slate-300 font-medium">Connect your eBay session</p>
              <ol className="list-decimal list-inside space-y-1 text-slate-400">
                <li>Open <a href="https://www.ebay.com" target="_blank" rel="noopener noreferrer" className="text-blue-400 underline">ebay.com</a> in your browser (sign in if needed)</li>
                <li>Open DevTools (F12) → Network tab → click any request to ebay.com</li>
                <li>In the Headers panel, find <span className="font-mono text-slate-200">Cookie:</span> and copy its entire value</li>
                <li>Paste it below:</li>
              </ol>
              <textarea
                value={cookieInput}
                onChange={e => { setCookieInput(e.target.value); setSaveSuccess(false); setSaveError(null); }}
                placeholder="Paste Cookie header value here… (starts with something like: s=BAQAAAXz...)"
                rows={3}
                className="w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-xs font-mono
                  text-slate-200 placeholder-slate-600 focus:border-blue-500 focus:outline-none resize-none"
              />
              {saveError && (
                <p className="text-red-400 text-xs">{saveError}</p>
              )}
              {saveSuccess && (
                <p className="text-green-400 text-xs">Session saved. You can now start the scrape.</p>
              )}
              <button
                type="button"
                onClick={handleSaveSession}
                disabled={savingSession || !cookieInput.trim()}
                className="px-3 py-1.5 rounded bg-blue-600 text-xs font-medium text-white
                  hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {savingSession ? "Saving…" : "Save Session"}
              </button>
            </div>
          )}
        </div>
      ))}

      {/* Progress bar */}
      {progress && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>{progress.withOriginal} / {progress.total} orders have original_total</span>
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
          {enqueued.orders === 0
            ? "No orders need scraping — all already have original_total set."
            : `${enqueued.orders} orders enqueued in ${enqueued.batches} batches. Worker is processing now…`}
        </p>
      )}

      {error && (
        <div className="rounded border border-red-700 bg-red-950 p-3 text-xs text-red-300">{error}</div>
      )}

      <div className="flex gap-3 flex-wrap">
        <button
          type="button"
          onClick={() => handleStart(false)}
          disabled={running || !hasSession || (progress?.needsScrape === 0)}
          className="px-4 py-1.5 rounded bg-blue-600 text-sm font-medium text-white
            hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {running ? "Running…" : "Start Scrape"}
        </button>
        {(failed > 0 || needsLogin > 0) && (
          <button
            type="button"
            onClick={() => handleStart(true)}
            disabled={running || !hasSession}
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
