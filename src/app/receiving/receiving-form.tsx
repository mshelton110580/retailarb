"use client";

import { useState } from "react";

export default function ReceivingForm() {
  const [status, setStatus] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      tracking: form.get("tracking"),
      condition_status: form.get("condition_status")
    };
    const res = await fetch("/api/receiving/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    setStatus(res.ok ? "Scan recorded." : "Scan failed.");
    if (res.ok) {
      event.currentTarget.reset();
    }
  }

  return (
    <form className="rounded-lg border border-slate-800 bg-slate-900 p-4" onSubmit={onSubmit}>
      <h2 className="text-lg font-semibold">Scan tracking</h2>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <input
          className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
          name="tracking"
          placeholder="Tracking number"
          required
        />
        <input
          className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
          name="condition_status"
          defaultValue="good"
          required
        />
      </div>
      <button className="mt-3 rounded bg-blue-500 px-4 py-2 text-sm text-white" type="submit">
        Save scan
      </button>
      {status ? <p className="mt-2 text-sm text-slate-300">{status}</p> : null}
    </form>
  );
}
