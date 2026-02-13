"use client";

import { useState } from "react";

export default function INRAction({ orderId }: { orderId: string }) {
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function markFiled() {
    setLoading(true);
    try {
      const res = await fetch("/api/inr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: orderId })
      });
      if (res.ok) {
        setStatus("INR filed.");
      } else if (res.status === 409) {
        setStatus("INR already exists for this order.");
      } else {
        setStatus("Failed to file INR.");
        setLoading(false);
      }
    } catch {
      setStatus("Failed to file INR.");
      setLoading(false);
    }
  }

  return (
    <div className="mt-3 flex items-center gap-3">
      <button
        className="rounded bg-blue-500 px-3 py-1 text-xs text-white disabled:opacity-50 disabled:cursor-not-allowed"
        onClick={markFiled}
        disabled={loading}
      >
        {loading ? "Filing..." : "INR filed"}
      </button>
      {status ? <span className="text-xs text-slate-400">{status}</span> : null}
    </div>
  );
}
