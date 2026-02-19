"use client";

import { useState, useRef } from "react";

export default function UploadTmp() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [result, setResult] = useState<{ savedTo?: string; sizeKB?: string; error?: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setStatus("uploading");
    setResult(null);

    const form = new FormData();
    form.append("file", file);

    try {
      const res = await fetch("/api/dev/upload-tmp", { method: "POST", body: form });
      const data = await res.json();
      if (data.ok) {
        setResult({ savedTo: data.savedTo, sizeKB: data.sizeKB });
        setStatus("done");
      } else {
        setResult({ error: data.error ?? "Upload failed" });
        setStatus("error");
      }
    } catch {
      setResult({ error: "Network error" });
      setStatus("error");
    }
  }

  function reset() {
    setFile(null);
    setStatus("idle");
    setResult(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900 p-4 space-y-3">
      <div>
        <h3 className="font-semibold text-slate-100">Upload File to /tmp</h3>
        <p className="mt-0.5 text-xs text-slate-400">
          Saves the file to <code>/tmp/</code> on the server for inspection. No data is changed.
        </p>
      </div>

      <form onSubmit={handleUpload} className="space-y-3">
        <input
          ref={inputRef}
          type="file"
          onChange={(e) => { setFile(e.target.files?.[0] ?? null); setStatus("idle"); setResult(null); }}
          className="block w-full text-sm text-slate-300
            file:mr-3 file:py-1.5 file:px-3
            file:rounded file:border-0
            file:text-xs file:font-medium
            file:bg-slate-700 file:text-slate-200
            hover:file:bg-slate-600 cursor-pointer"
        />
        {file && (
          <p className="text-xs text-slate-400">{file.name} — {(file.size / 1024).toFixed(1)} KB</p>
        )}
        <div className="flex gap-3">
          <button
            type="submit"
            disabled={!file || status === "uploading"}
            className="px-4 py-1.5 rounded bg-slate-600 text-sm font-medium text-white
              hover:bg-slate-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {status === "uploading" ? "Uploading…" : "Upload to /tmp"}
          </button>
          {status !== "idle" && (
            <button type="button" onClick={reset}
              className="px-3 py-1.5 rounded border border-slate-600 text-xs text-slate-400 hover:text-slate-200">
              Reset
            </button>
          )}
        </div>
      </form>

      {result && (
        <div className={`rounded border p-3 text-sm ${result.error ? "border-red-700 bg-red-950 text-red-300" : "border-green-700 bg-green-950 text-green-300"}`}>
          {result.error
            ? result.error
            : <>Saved to <code className="text-green-200">{result.savedTo}</code> ({result.sizeKB} KB)</>
          }
        </div>
      )}
    </div>
  );
}
