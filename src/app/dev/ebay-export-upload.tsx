"use client";

import { useState, useRef } from "react";

interface InspectResult {
  fileName?: string;
  zipContents?: string[];
  totalColumns?: number;
  totalDataRows?: number;
  headers?: string[];
  detectedOrderIdColumn?: string | null;
  detectedOrderIdIndex?: number | null;
  detectedOrderTotalColumn?: string | null;
  detectedOrderTotalIndex?: number | null;
  mappingReady?: boolean;
  sampleRows?: Record<string, string>[];
  error?: string;
}

interface ImportResult {
  ok: boolean;
  parsed?: number;
  updated?: number;
  skipped?: number;
  notFound?: number;
  errors?: string[];
  error?: string;
}

type Stage = "idle" | "inspecting" | "inspected" | "importing" | "done";

export default function EbayExportUpload() {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [inspect, setInspect] = useState<InspectResult | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setFile(null);
    setStage("idle");
    setInspect(null);
    setImportResult(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleInspect(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setStage("inspecting");
    setInspect(null);

    const form = new FormData();
    form.append("file", file);

    try {
      const res = await fetch("/api/orders/inspect-ebay-export", { method: "POST", body: form });
      const data: InspectResult = await res.json();
      setInspect(data);
      setStage("inspected");
    } catch {
      setInspect({ error: "Network error — could not reach server." });
      setStage("inspected");
    }
  }

  async function handleImport() {
    if (!file || !inspect?.mappingReady) return;
    setStage("importing");
    setImportResult(null);

    const form = new FormData();
    form.append("file", file);

    try {
      const res = await fetch("/api/orders/import-ebay-export", { method: "POST", body: form });
      const data: ImportResult = await res.json();
      setImportResult(data);
      setStage("done");
    } catch {
      setImportResult({ ok: false, error: "Network error — could not reach server." });
      setStage("done");
    }
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
          <h3 className="font-semibold text-slate-100">
            eBay Order Export —{" "}
            <code className="text-xs text-slate-400">original_total</code> Backfill
          </h3>
          <p className="mt-0.5 text-xs text-slate-400">
            Upload an eBay "Orders" CSV or ZIP export to inspect its structure, then optionally backfill
            original_total on historical orders.
          </p>
        </div>
        <span className="ml-4 text-slate-400 text-lg leading-none">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="border-t border-slate-700 p-4 space-y-5">

          {/* Instructions */}
          <div className="rounded border border-slate-700 bg-slate-800 p-3 text-xs text-slate-300 space-y-1">
            <p className="font-medium text-slate-200">How to export from eBay Seller Hub:</p>
            <ol className="list-decimal list-inside space-y-0.5 text-slate-400">
              <li>Go to <strong>Seller Hub → Orders</strong></li>
              <li>Set date range to cover all historical orders</li>
              <li>Click <strong>Download report</strong> → <strong>Orders report</strong></li>
              <li>Download the CSV or ZIP when the email arrives</li>
              <li>Upload below — the file will be inspected first, no data will be changed</li>
            </ol>
          </div>

          {/* Step 1: File picker + Inspect */}
          <form onSubmit={handleInspect} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">
                Step 1 — Select file (.csv or .zip)
              </label>
              <input
                ref={inputRef}
                type="file"
                accept=".csv,.zip,text/csv,application/zip,application/x-zip-compressed"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setStage("idle");
                  setInspect(null);
                  setImportResult(null);
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
                disabled={!file || stage === "inspecting" || stage === "importing"}
                className="px-4 py-1.5 rounded bg-slate-600 text-sm font-medium text-white
                  hover:bg-slate-500 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {stage === "inspecting" ? "Inspecting…" : "Inspect File"}
              </button>
              {stage !== "idle" && (
                <button
                  type="button"
                  onClick={reset}
                  className="px-3 py-1.5 rounded border border-slate-600 text-xs text-slate-400 hover:text-slate-200"
                >
                  Reset
                </button>
              )}
            </div>
          </form>

          {/* Inspect results */}
          {inspect && (
            <div className="space-y-4">
              {inspect.error ? (
                <div className="rounded border border-red-700 bg-red-950 p-3 text-sm text-red-300">
                  {inspect.error}
                </div>
              ) : (
                <>
                  {/* File summary */}
                  <div className="rounded border border-slate-700 bg-slate-800 p-3 space-y-2">
                    <p className="text-xs font-semibold text-slate-300 uppercase tracking-wide">File Summary</p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      <div>
                        <p className="text-slate-500">File</p>
                        <p className="text-slate-200 truncate font-mono">{inspect.fileName}</p>
                      </div>
                      <div>
                        <p className="text-slate-500">Data rows</p>
                        <p className="text-slate-200 font-bold">{inspect.totalDataRows?.toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-slate-500">Columns</p>
                        <p className="text-slate-200 font-bold">{inspect.totalColumns}</p>
                      </div>
                      <div>
                        <p className="text-slate-500">Mapping</p>
                        <p className={inspect.mappingReady ? "text-green-400 font-bold" : "text-red-400 font-bold"}>
                          {inspect.mappingReady ? "Ready" : "Incomplete"}
                        </p>
                      </div>
                    </div>

                    {/* ZIP contents */}
                    {inspect.zipContents && (
                      <div>
                        <p className="text-slate-500 text-xs mb-1">ZIP contents:</p>
                        <ul className="text-xs font-mono text-slate-400 space-y-0.5">
                          {inspect.zipContents.map((f, i) => <li key={i}>{f}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>

                  {/* Column mapping */}
                  <div className="rounded border border-slate-700 bg-slate-800 p-3 space-y-2">
                    <p className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Detected Column Mapping</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      <div className={`rounded p-2 border ${inspect.detectedOrderIdColumn ? "border-green-700 bg-green-950/40" : "border-red-700 bg-red-950/40"}`}>
                        <p className="text-slate-400 mb-0.5">Order ID column</p>
                        {inspect.detectedOrderIdColumn ? (
                          <p className="font-mono text-green-300">
                            [{inspect.detectedOrderIdIndex}] {inspect.detectedOrderIdColumn}
                          </p>
                        ) : (
                          <p className="text-red-400">Not detected</p>
                        )}
                      </div>
                      <div className={`rounded p-2 border ${inspect.detectedOrderTotalColumn ? "border-green-700 bg-green-950/40" : "border-red-700 bg-red-950/40"}`}>
                        <p className="text-slate-400 mb-0.5">Order total column</p>
                        {inspect.detectedOrderTotalColumn ? (
                          <p className="font-mono text-green-300">
                            [{inspect.detectedOrderTotalIndex}] {inspect.detectedOrderTotalColumn}
                          </p>
                        ) : (
                          <p className="text-red-400">Not detected</p>
                        )}
                      </div>
                    </div>
                    {!inspect.mappingReady && (
                      <p className="text-xs text-yellow-400 mt-1">
                        One or more required columns could not be auto-detected. Review the headers below
                        and let me know the correct column names so the mapping can be updated.
                      </p>
                    )}
                  </div>

                  {/* All headers */}
                  <div className="rounded border border-slate-700 bg-slate-800 p-3 space-y-2">
                    <p className="text-xs font-semibold text-slate-300 uppercase tracking-wide">
                      All Columns ({inspect.totalColumns})
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {inspect.headers?.map((h, i) => (
                        <span
                          key={i}
                          className={`px-2 py-0.5 rounded text-xs font-mono border ${
                            i === inspect.detectedOrderIdIndex
                              ? "border-green-600 bg-green-950 text-green-300"
                              : i === inspect.detectedOrderTotalIndex
                              ? "border-blue-600 bg-blue-950 text-blue-300"
                              : "border-slate-600 bg-slate-700 text-slate-300"
                          }`}
                        >
                          {i}: {h}
                        </span>
                      ))}
                    </div>
                    <p className="text-xs text-slate-500">
                      <span className="inline-block w-2 h-2 rounded-sm bg-green-800 mr-1" />green = order ID &nbsp;
                      <span className="inline-block w-2 h-2 rounded-sm bg-blue-800 mr-1" />blue = order total
                    </p>
                  </div>

                  {/* Sample rows */}
                  {inspect.sampleRows && inspect.sampleRows.length > 0 && (
                    <div className="rounded border border-slate-700 bg-slate-800 p-3 space-y-2">
                      <p className="text-xs font-semibold text-slate-300 uppercase tracking-wide">
                        Sample Rows (first {inspect.sampleRows.length})
                      </p>
                      <div className="overflow-x-auto">
                        <table className="text-xs w-full">
                          <thead>
                            <tr>
                              {inspect.headers?.map((h, i) => (
                                <th
                                  key={i}
                                  className={`text-left px-2 py-1 border-b border-slate-700 whitespace-nowrap font-mono font-normal ${
                                    i === inspect.detectedOrderIdIndex ? "text-green-400" :
                                    i === inspect.detectedOrderTotalIndex ? "text-blue-400" :
                                    "text-slate-500"
                                  }`}
                                >
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {inspect.sampleRows.map((row, ri) => (
                              <tr key={ri} className="border-b border-slate-800 hover:bg-slate-700/30">
                                {inspect.headers?.map((h, i) => (
                                  <td
                                    key={i}
                                    className={`px-2 py-1 font-mono whitespace-nowrap ${
                                      i === inspect.detectedOrderIdIndex ? "text-green-300" :
                                      i === inspect.detectedOrderTotalIndex ? "text-blue-300" :
                                      "text-slate-400"
                                    }`}
                                  >
                                    {row[h] || <span className="text-slate-600">—</span>}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Step 2: Run backfill */}
                  <div className={`rounded border p-3 space-y-3 ${inspect.mappingReady ? "border-slate-600" : "border-slate-700 opacity-50"}`}>
                    <div>
                      <p className="text-xs font-semibold text-slate-300 uppercase tracking-wide">
                        Step 2 — Run Backfill
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        Only rows where <code>original_total</code> is currently null will be updated.
                        Orders already set, or not found in the database, will be skipped.
                      </p>
                    </div>
                    {stage !== "done" && (
                      <button
                        type="button"
                        onClick={handleImport}
                        disabled={!inspect.mappingReady || stage === "importing"}
                        className="px-4 py-1.5 rounded bg-blue-600 text-sm font-medium text-white
                          hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {stage === "importing" ? "Running backfill…" : `Run Backfill (${inspect.totalDataRows?.toLocaleString()} rows)`}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Import result */}
          {importResult && (
            <div className={`rounded border p-3 text-sm space-y-3 ${
              importResult.ok ? "border-green-700 bg-green-950" : "border-red-700 bg-red-950"
            }`}>
              {importResult.ok ? (
                <>
                  <p className="font-medium text-green-300">Backfill complete</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div className="rounded bg-slate-800 p-2">
                      <p className="text-slate-400">Parsed</p>
                      <p className="text-lg font-bold text-slate-100">{importResult.parsed ?? 0}</p>
                    </div>
                    <div className="rounded bg-slate-800 p-2">
                      <p className="text-slate-400">Updated</p>
                      <p className="text-lg font-bold text-green-400">{importResult.updated ?? 0}</p>
                    </div>
                    <div className="rounded bg-slate-800 p-2">
                      <p className="text-slate-400">Skipped (already set)</p>
                      <p className="text-lg font-bold text-yellow-400">{importResult.skipped ?? 0}</p>
                    </div>
                    <div className="rounded bg-slate-800 p-2">
                      <p className="text-slate-400">Not in DB</p>
                      <p className="text-lg font-bold text-slate-400">{importResult.notFound ?? 0}</p>
                    </div>
                  </div>
                  {importResult.errors && importResult.errors.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-red-300 mb-1">Row errors ({importResult.errors.length}):</p>
                      <ul className="text-xs text-red-400 space-y-0.5 max-h-32 overflow-y-auto">
                        {importResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                      </ul>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-red-300">{importResult.error ?? "Unknown error"}</p>
              )}
            </div>
          )}

        </div>
      )}
    </div>
  );
}
