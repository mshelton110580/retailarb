"use client";

import { useState, useRef } from "react";
import PageHeader from "@/components/page-header";
import Link from "next/link";

interface ImportRow {
  timestamp: string;
  tracking: string;
  quantity: number;
  condition_status: string;
  inventory_id?: string;
}

interface ImportResult {
  row: number;
  tracking: string;
  status: "imported" | "skipped" | "error";
  message: string;
  unitsCreated?: number;
}

interface ImportSummary {
  imported: number;
  skipped: number;
  errors: number;
  total: number;
}

// Column name aliases accepted from the sheet
const COL_ALIASES: Record<string, string> = {
  // Timestamp
  "timestamp": "timestamp",
  // Tracking
  "tracking scan number": "tracking",
  "tracking": "tracking",
  "tracking number": "tracking",
  // Quantity
  "tracking scan quantity": "quantity",
  "quantity": "quantity",
  "qty": "quantity",
  // Condition
  "tracking scan status": "condition_status",
  "status": "condition_status",
  "condition": "condition_status",
  "condition status": "condition_status",
  // Inventory ID
  "inventory id": "inventory_id",
  "inventoryid": "inventory_id",
};

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    const cols: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        cols.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
    cols.push(current);
    rows.push(cols);
  }
  return rows;
}

function csvToRows(text: string): { rows: ImportRow[]; errors: string[] } {
  // Strip UTF-8 BOM if present (Google Sheets CSV export adds this)
  const cleaned = text.replace(/^\uFEFF/, "");
  const parsed = parseCSV(cleaned);
  if (parsed.length < 2) return { rows: [], errors: ["CSV has no data rows"] };

  // Map header columns — strip BOM and non-printable chars from each header
  const headers = parsed[0].map((h) => h.replace(/^\uFEFF/, "").trim().toLowerCase());
  const colIndex: Record<string, number> = {};
  headers.forEach((h, i) => {
    const mapped = COL_ALIASES[h];
    if (mapped && !(mapped in colIndex)) colIndex[mapped] = i;
  });
  // If the first column header is blank but has date-like data, treat it as timestamp
  if (!("timestamp" in colIndex) && headers[0] === "" && parsed.length > 1) {
    const sample = parsed[1][0]?.trim() ?? "";
    if (sample && /\d{4}|\d{1,2}\/\d{1,2}\/\d{4}/.test(sample)) {
      colIndex["timestamp"] = 0;
    }
  }

  const errors: string[] = [];
  if (!("tracking" in colIndex)) {
    errors.push(`Missing required column: tracking scan number (found: ${headers.filter(Boolean).join(", ")})`);
  }
  if (errors.length) return { rows: [], errors };

  const rows: ImportRow[] = [];
  for (let i = 1; i < parsed.length; i++) {
    const cols = parsed[i];
    const tracking = (cols[colIndex["tracking"]] ?? "").replace(/\0/g, "").replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim();
    if (!tracking) continue;

    rows.push({
      timestamp: colIndex["timestamp"] !== undefined ? (cols[colIndex["timestamp"]]?.trim() ?? "") : "",
      tracking,
      quantity: colIndex["quantity"] !== undefined ? (parseInt(cols[colIndex["quantity"]] ?? "1", 10) || 1) : 1,
      condition_status: colIndex["condition_status"] !== undefined ? (cols[colIndex["condition_status"]]?.trim() || "good") : "good",
      inventory_id: colIndex["inventory_id"] !== undefined ? (cols[colIndex["inventory_id"]]?.trim() || undefined) : undefined,
    });
  }

  return { rows, errors: [] };
}

export default function ImportCSVPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportRow[]>([]);
  const [parseError, setParseError] = useState<string>("");
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [results, setResults] = useState<ImportResult[]>([]);
  const [fileName, setFileName] = useState<string>("");
  const [sheetUrl, setSheetUrl] = useState<string>("");
  const [fetchingSheet, setFetchingSheet] = useState(false);

  function handleFile(file: File) {
    setFileName(file.name);
    setParseError("");
    setSummary(null);
    setResults([]);

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const { rows, errors } = csvToRows(text);
      if (errors.length) {
        setParseError(errors.join("; "));
        setPreview([]);
      } else {
        setPreview(rows);
      }
    };
    reader.readAsText(file);
  }

  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null);

  async function handleImport() {
    if (preview.length === 0) return;
    setImporting(true);
    setSummary(null);
    setResults([]);
    setParseError("");

    const BATCH_SIZE = 25;
    const allResults: ImportResult[] = [];
    let totalImported = 0, totalSkipped = 0, totalErrors = 0;

    try {
      for (let offset = 0; offset < preview.length; offset += BATCH_SIZE) {
        const batch = preview.slice(offset, offset + BATCH_SIZE);
        setImportProgress({ done: offset, total: preview.length });

        const res = await fetch("/api/receiving/import-csv", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: batch }),
        });

        const bodyText = await res.text();
        if (!res.ok) {
          let errMsg = "Import failed";
          try { errMsg = JSON.parse(bodyText).error ?? errMsg; } catch { if (bodyText.trim()) errMsg = bodyText.slice(0, 200); }
          setParseError(`Batch ${Math.floor(offset / BATCH_SIZE) + 1} failed: ${errMsg}`);
          setImporting(false);
          setImportProgress(null);
          return;
        }

        let data: any;
        try { data = JSON.parse(bodyText); } catch {
          setParseError(`Batch ${Math.floor(offset / BATCH_SIZE) + 1} returned invalid response`);
          setImporting(false);
          setImportProgress(null);
          return;
        }

        allResults.push(...(data.results ?? []));
        totalImported += data.summary?.imported ?? 0;
        totalSkipped += data.summary?.skipped ?? 0;
        totalErrors += data.summary?.errors ?? 0;
      }

      setImportProgress({ done: preview.length, total: preview.length });
      setSummary({ imported: totalImported, skipped: totalSkipped, errors: totalErrors, total: preview.length });
      setResults(allResults);
    } catch (err: any) {
      setParseError(err.message ?? "Import failed");
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  async function handleFetchSheet() {
    if (!sheetUrl.trim()) return;
    setFetchingSheet(true);
    setParseError("");
    setSummary(null);
    setResults([]);
    setFileName("");

    try {
      const res = await fetch("/api/receiving/fetch-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: sheetUrl }),
      });
      const bodyText = await res.text();
      if (!res.ok) {
        let errMsg = "Failed to fetch sheet";
        try { errMsg = JSON.parse(bodyText).error ?? errMsg; } catch { if (bodyText.trim()) errMsg = bodyText.slice(0, 200); }
        setParseError(errMsg);
        return;
      }
      const csvText = bodyText;
      const { rows, errors } = csvToRows(csvText);
      if (errors.length) {
        setParseError(errors.join("; "));
        setPreview([]);
      } else {
        setFileName("Google Sheet (live)");
        setPreview(rows);
      }
    } catch (err: any) {
      setParseError(err.message ?? "Failed to fetch sheet");
    } finally {
      setFetchingSheet(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Import Scan Data (CSV)">
        <Link href="/receiving" className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">
          ← Back to Receiving
        </Link>
      </PageHeader>

      {/* Instructions */}
      <section className="rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm text-slate-400 space-y-2">
        <p className="font-medium text-slate-300">How to import from Google Sheets</p>
        <ol className="list-decimal list-inside space-y-1">
          <li>Open your Google Sheet and click the <strong className="text-slate-300">checkin</strong> tab</li>
          <li>Go to <strong className="text-slate-300">File → Download → Comma Separated Values (.csv)</strong></li>
          <li>Upload the downloaded file below</li>
        </ol>
        <p className="text-xs text-slate-500 mt-2">
          Expected columns: <code className="bg-slate-800 px-1 rounded">Tracking Scan Number</code>, <code className="bg-slate-800 px-1 rounded">Tracking Scan Quantity</code>, <code className="bg-slate-800 px-1 rounded">Tracking Scan Status</code>, <code className="bg-slate-800 px-1 rounded">Timestamp</code>, <code className="bg-slate-800 px-1 rounded">Inventory ID</code> (optional)
        </p>
        <p className="text-xs text-slate-500">
          Rows where the tracking number already has the same number of units checked in will be skipped automatically.
        </p>
      </section>

      {/* Google Sheets URL */}
      <section className="rounded-lg border border-slate-800 bg-slate-900 p-4 space-y-3">
        <p className="text-sm font-medium text-slate-300">Import from Google Sheets URL</p>
        <div className="flex gap-2">
          <input
            type="url"
            placeholder="https://docs.google.com/spreadsheets/d/..."
            value={sheetUrl}
            onChange={(e) => setSheetUrl(e.target.value)}
            className="flex-1 rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={handleFetchSheet}
            disabled={fetchingSheet || !sheetUrl.trim()}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 whitespace-nowrap"
          >
            {fetchingSheet ? "Fetching…" : "Load Sheet"}
          </button>
        </div>
        <p className="text-xs text-slate-500">Sheet must be set to <strong className="text-slate-400">Anyone with the link can view</strong>. Include the tab's <code className="bg-slate-800 px-1 rounded">gid=</code> parameter in the URL.</p>
      </section>

      <div className="flex items-center gap-3 text-xs text-slate-500">
        <div className="flex-1 border-t border-slate-800" />
        <span>or upload a file</span>
        <div className="flex-1 border-t border-slate-800" />
      </div>

      {/* Upload area */}
      <section
        className="rounded-lg border-2 border-dashed border-slate-700 bg-slate-900 p-8 text-center cursor-pointer hover:border-slate-500 transition-colors"
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => fileRef.current?.click()}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
        {fileName && fileName !== "Google Sheet (live)" ? (
          <p className="text-slate-300 font-medium">{fileName}</p>
        ) : (
          <p className="text-slate-400">Drop CSV file here or click to browse</p>
        )}
      </section>

      {parseError && (
        <div className="rounded-lg border border-red-800 bg-red-950 p-3 text-sm text-red-300">{parseError}</div>
      )}

      {/* Preview */}
      {preview.length > 0 && !summary && (
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">{preview.length} rows ready to import</h2>
            <button
              onClick={handleImport}
              disabled={importing}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {importing && importProgress
                ? `Importing… ${importProgress.done}/${importProgress.total}`
                : importing ? "Importing…" : `Import ${preview.length} rows`}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-slate-300">
              <thead>
                <tr className="border-b border-slate-700 text-left text-slate-500">
                  <th className="pb-1 pr-4">#</th>
                  <th className="pb-1 pr-4">Tracking</th>
                  <th className="pb-1 pr-4">Qty</th>
                  <th className="pb-1 pr-4">Condition</th>
                  <th className="pb-1 pr-4">Timestamp</th>
                  <th className="pb-1">Inventory ID</th>
                </tr>
              </thead>
              <tbody>
                {preview.slice(0, 50).map((row, i) => (
                  <tr key={i} className="border-b border-slate-800">
                    <td className="py-1 pr-4 text-slate-500">{i + 1}</td>
                    <td className="py-1 pr-4 font-mono">{row.tracking}</td>
                    <td className="py-1 pr-4">{row.quantity}</td>
                    <td className="py-1 pr-4">{row.condition_status}</td>
                    <td className="py-1 pr-4 text-slate-400">{row.timestamp || "—"}</td>
                    <td className="py-1 text-slate-400">{row.inventory_id || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.length > 50 && (
              <p className="mt-2 text-xs text-slate-500">…and {preview.length - 50} more rows (showing first 50)</p>
            )}
          </div>
        </section>
      )}

      {/* Results */}
      {summary && (
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4 space-y-4">
          <h2 className="font-semibold">Import complete</h2>
          <div className="grid grid-cols-4 gap-4 text-center">
            <div className="rounded border border-slate-700 p-3">
              <p className="text-2xl font-bold text-green-400">{summary.imported}</p>
              <p className="text-xs text-slate-400 mt-1">Imported</p>
            </div>
            <div className="rounded border border-slate-700 p-3">
              <p className="text-2xl font-bold text-slate-400">{summary.skipped}</p>
              <p className="text-xs text-slate-400 mt-1">Skipped</p>
            </div>
            <div className="rounded border border-slate-700 p-3">
              <p className="text-2xl font-bold text-red-400">{summary.errors}</p>
              <p className="text-xs text-slate-400 mt-1">Errors</p>
            </div>
            <div className="rounded border border-slate-700 p-3">
              <p className="text-2xl font-bold text-white">{summary.total}</p>
              <p className="text-xs text-slate-400 mt-1">Total rows</p>
            </div>
          </div>

          {results.some((r) => r.status !== "imported") && (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Non-imported rows</p>
              {results
                .filter((r) => r.status !== "imported")
                .map((r) => (
                  <div key={r.row} className={`flex items-start gap-2 rounded px-2 py-1 text-xs ${
                    r.status === "error" ? "bg-red-950 text-red-300" : "bg-slate-800 text-slate-400"
                  }`}>
                    <span className="shrink-0 font-medium">Row {r.row}</span>
                    <span className="font-mono truncate">{r.tracking || "—"}</span>
                    <span className="ml-auto shrink-0">{r.message}</span>
                  </div>
                ))}
            </div>
          )}

          <button
            onClick={() => { setPreview([]); setSummary(null); setResults([]); setFileName(""); setSheetUrl(""); if (fileRef.current) fileRef.current.value = ""; }}
            className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
          >
            Import another file
          </button>
        </section>
      )}
    </div>
  );
}
