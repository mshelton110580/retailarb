"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function MarkDeliveredButton({ shipmentId }: { shipmentId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleClick() {
    if (!confirm("Mark this shipment as delivered? This overrides the eBay tracking status.")) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/shipments/${shipmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark_delivered" }),
      });
      if (res.ok) {
        setDone(true);
        router.refresh();
      } else {
        const data = await res.json();
        alert(`Error: ${data.error}`);
      }
    } catch {
      alert("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return <span className="rounded bg-green-900 px-2 py-0.5 text-xs text-green-300">✓ Marked Delivered</span>;
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="rounded border border-green-700 px-2 py-0.5 text-xs text-green-400 hover:bg-green-900/40 disabled:opacity-50"
    >
      {loading ? "Saving..." : "Mark Delivered"}
    </button>
  );
}
