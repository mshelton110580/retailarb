"use client";

import { useState } from "react";

export default function INRAction({ orderId }: { orderId: string }) {
  const [status, setStatus] = useState<string | null>(null);

  async function markFiled() {
    const res = await fetch("/api/inr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_id: orderId })
    });
    setStatus(res.ok ? "INR filed." : "Failed to file INR.");
  }

  return (
    <div className="mt-3 flex items-center gap-3">
      <button className="rounded bg-blue-500 px-3 py-1 text-xs text-white" onClick={markFiled}>
        INR filed
      </button>
      {status ? <span className="text-xs text-slate-400">{status}</span> : null}
    </div>
  );
}
