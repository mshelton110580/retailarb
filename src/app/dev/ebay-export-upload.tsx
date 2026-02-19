"use client";

import { useState, useRef } from "react";

interface ImportResult {
  ok: boolean;
  parsed?: number;
  updated?: number;
  skipped?: number;
  notFound?: number;
  errors?: string[];
  error?: string;
}

export default function EbayExportUpload() {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setLoading(true);
    setResult(null);

    const form = new FormData();
    form.append("file", file);

    try {
      const res = await fetch("/api/orders/import-ebay-export", {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      setResult(data);
    } catch {
      setResult({ ok: false, error: "Network error — could not reach server." });
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setFile(null);
    setResult(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900">
      {/* Header / toggle */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between p-4 text-left"
      >
        <div>
          <h3 className="font-semibold text-slate-100">eBay Order Export — Backfill <code className="text-xs text-slate-400">original_total</code></h3>
          <p className="mt-0.5 text-xs text-slate-400">
            Upload an eBay "Orders" CSV export to populate original_total on historical orders.
            Only rows where original_total is currently null will be updated.
          </p>
        </div>
        <span className="ml-4 text-slate-400 text-lg leading-none">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="border-t border-slate-700 p-4 space-y-4">
          {/* Instructions */}
          <div className="rounded border border-slate-700 bg-slate-800 p-3 text-xs text-slate-300 space-y-1">
            <p className="font-medium text-slate-200">How to export from eBay:</p>
            <ol className="list-decimal list-inside space-y-0.5 text-slate-400">
              <li>Go to <strong>Seller Hub → Orders</strong></li>
              <li>Set date range to cover all historical orders</li>
              <li>Click <strong>Download report</strong> → <strong>Orders report</strong></li>
              <li>Wait for the email, then download the CSV or ZIP</li>
              <li>Upload below (ZIP or CSV both accepted)</li>
            </ol>
            <p className="text-slate-500 pt-1">
              Columns used: <code>Order number</code> and <code>Order total</code>.
              All other columns are ignored.
            </p>
          </div>

          {/* Upload form */}
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">
                Select file (.csv or .zip)
              </label>
              <input
                ref={inputRef}
                type="file"
                accept=".csv,.zip,text/csv,application/zip,application/x-zip-compressed"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setResult(null);
                }}
                className="block w-full text-sm text-slate-300
                  file:mr-3 file:py-1.5 file:px-3
                  file:rounded file:border-0
                  file:text-xs file:font-medium
                  file:bg-slate-700 file:text-slate-200
                  hover:file:bg-slate-600 cursor-pointer"
              />
              {file && (
                <p className="mt-1 text-xs text-slate-400">
                  {file.name} — {(file.size / 1024).toFixed(1)} KB
                </p>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={!file || loading}
                className="px-4 py-1.5 rounded bg-blue-600 text-sm font-medium text-white
                  hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {loading ? "Uploading…" : "Upload & Backfill"}
              </button>
              {(file || result) && (
                <button
                  type="button"
                  onClick={reset}
                  className="px-3 py-1.5 rounded border border-slate-600 text-xs text-slate-400 hover:text-slate-200"
                >
                  Clear
                </button>
              )}
            </div>
          </form>

          {/* Result */}
          {result && (
            <div className={`rounded border p-3 text-sm space-y-2 ${
              result.ok ? "border-green-700 bg-green-950" : "border-red-700 bg-red-950"
            }`}>
              {result.ok ? (
                <>
                  <p className="font-medium text-green-300">Import complete</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div className="rounded bg-slate-800 p-2">
                      <p className="text-slate-400">Parsed</p>
                      <p className="text-lg font-bold text-slate-100">{result.parsed ?? 0}</p>
                    </div>
                    <div className="rounded bg-slate-800 p-2">
                      <p className="text-slate-400">Updated</p>
                      <p className="text-lg font-bold text-green-400">{result.updated ?? 0}</p>
                    </div>
                    <div className="rounded bg-slate-800 p-2">
                      <p className="text-slate-400">Skipped (already set)</p>
                      <p className="text-lg font-bold text-yellow-400">{result.skipped ?? 0}</p>
                    </div>
                    <div className="rounded bg-slate-800 p-2">
                      <p className="text-slate-400">Not in DB</p>
                      <p className="text-lg font-bold text-slate-400">{result.notFound ?? 0}</p>
                    </div>
                  </div>
                  {result.errors && result.errors.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-red-300 mb-1">Row errors ({result.errors.length}):</p>
                      <ul className="text-xs text-red-400 space-y-0.5 max-h-32 overflow-y-auto">
                        {result.errors.map((e, i) => <li key={i}>{e}</li>)}
                      </ul>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-red-300">{result.error ?? "Unknown error"}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
