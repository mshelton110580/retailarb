"use client";

import { useState } from "react";

export default function TargetForm() {
  const [status, setStatus] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      item_id: form.get("item_id"),
      type: form.get("type"),
      max_snipe_bid: form.get("max_snipe_bid") || undefined,
      best_offer_amount: form.get("best_offer_amount") || undefined,
      lead_seconds: Number(form.get("lead_seconds")),
      notes: form.get("notes") || undefined
    };
    const res = await fetch("/api/targets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    setStatus(res.ok ? "Target saved." : "Failed to save target.");
    if (res.ok) {
      event.currentTarget.reset();
    }
  }

  return (
    <form className="rounded-lg border border-slate-800 bg-slate-900 p-4" onSubmit={onSubmit}>
      <h2 className="text-lg font-semibold">Add target</h2>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <input
          className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
          name="item_id"
          placeholder="Item ID"
          required
        />
        <select
          className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
          name="type"
          defaultValue="AUCTION"
        >
          <option value="AUCTION">Auction</option>
          <option value="BIN">Buy It Now</option>
          <option value="BEST_OFFER">Best Offer</option>
        </select>
        <input
          className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
          name="lead_seconds"
          type="number"
          min={3}
          max={10}
          defaultValue={5}
        />
        <input
          className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
          name="max_snipe_bid"
          placeholder="Max snipe bid"
        />
        <input
          className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
          name="best_offer_amount"
          placeholder="Best offer amount"
        />
        <input
          className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm md:col-span-3"
          name="notes"
          placeholder="Notes"
        />
      </div>
      <button className="mt-3 rounded bg-blue-500 px-4 py-2 text-sm text-white" type="submit">
        Save target
      </button>
      {status ? <p className="mt-2 text-sm text-slate-300">{status}</p> : null}
    </form>
  );
}
