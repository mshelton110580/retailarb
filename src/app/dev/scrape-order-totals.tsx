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
  profileDir?: string;
  hasProfileDir?: boolean;
}

export default function ScrapeOrderTotals() {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enqueued, setEnqueued] = useState<{ orders: number; batches: number } | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);
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
          Visits each eBay order page with your saved browser session to extract the original
          pre-refund total. Computes: <code>original_total = current_total + refunds</code>.
          Runs 1 order at a time.
        </p>
      </div>

      {/* Session status */}
      {accounts.length > 0 && (
        <div className="space-y-1.5">
          {accounts.map(a => (
            <div key={a.id} className={`flex items-center gap-2 rounded border px-3 py-2 text-xs ${
              a.hasSession
                ? "border-green-700 bg-green-950/30 text-green-300"
                : "border-yellow-700 bg-yellow-950/30 text-yellow-300"
            }`}>
              <span className={`h-2 w-2 rounded-full ${a.hasSession ? "bg-green-400" : "bg-yellow-400"}`} />
              <span className="font-mono">{a.username}</span>
              <span className="text-slate-400 ml-1">
                {a.hasSession
                  ? a.sessionType === "profile"
                    ? "Session active (persistent profile)"
                    : "Session active (saved cookies)"
                  : "No session — capture required before scraping"}
              </span>
              {!a.hasSession && (
                <button
                  type="button"
                  onClick={() => setShowInstructions(v => !v)}
                  className="ml-auto text-yellow-300 hover:text-yellow-100 underline"
                >
                  {showInstructions ? "Hide instructions" : "How to capture"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Session capture instructions */}
      {showInstructions && (
        <div className="rounded border border-slate-600 bg-slate-800 p-3 space-y-3 text-xs text-slate-300">
          <p className="font-semibold text-slate-200">Option A — Local capture script (easiest)</p>
          <p className="text-slate-400">
            Run this on your local machine. It opens a browser, you sign in, and it saves the
            session to the app automatically. No server display needed.
          </p>
          <ol className="list-decimal list-inside space-y-1.5 text-slate-400">
            <li>
              Find your account ID (check the URL of this page or run on server:
              <code className="block mt-0.5 bg-slate-900 rounded px-2 py-1 text-slate-200 font-mono">
                psql $DATABASE_URL -c &quot;SELECT id, ebay_username FROM ebay_accounts;&quot;
              </code>
            </li>
            <li>
              Get your session cookie — log in, open DevTools → Application → Cookies, copy
              <code className="mx-1 bg-slate-900 rounded px-1 text-slate-200">next-auth.session-token</code>
            </li>
            <li>
              Run the capture script locally:
              <code className="block mt-0.5 bg-slate-900 rounded px-2 py-1 text-slate-200 font-mono whitespace-pre-wrap break-all">
                {`APP_URL=https://68.183.121.176:3000 ACCOUNT_ID=<id> SESSION_COOKIE=<token> node scripts/capture-ebay-session.js`}
              </code>
            </li>
            <li>Refresh this page — the session indicator turns green once cookies are saved.</li>
          </ol>

          <p className="font-semibold text-slate-200 pt-1 border-t border-slate-700">Option B — Server-side persistent profile</p>
          <p className="text-slate-400">
            More durable (never expires). Requires a display (VNC or X11 forwarding).
          </p>
          <ol className="list-decimal list-inside space-y-1.5 text-slate-400">
            <li>
              SSH into the server with X11 forwarding:
              <code className="block mt-0.5 bg-slate-900 rounded px-2 py-1 text-slate-200 font-mono">
                ssh -X arbdesk
              </code>
            </li>
            <li>
              Run the login script:
              <code className="block mt-0.5 bg-slate-900 rounded px-2 py-1 text-slate-200 font-mono">
                cd /opt/retailarb && DISPLAY=localhost:10.0 node scripts/ebay-login.js
              </code>
              Sign in to eBay in the browser that opens, then close it.
            </li>
            <li>Refresh this page — session indicator turns green once the profile directory exists.</li>
          </ol>
        </div>
      )}

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
            : `${enqueued.orders} orders enqueued in ${enqueued.batches} batches (${15} orders/batch). Worker is processing now…`}
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
