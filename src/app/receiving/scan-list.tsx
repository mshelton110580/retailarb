"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type EnrichedScan = {
  id: string;
  tracking_last8: string;
  resolution_state: string;
  scanned_at: string;
  scanned_by: string;
  notes: string | null;
  matchedOrders: Array<{
    orderId: string;
    items: Array<{ title: string; qty: number }>;
    checkedIn: boolean;
  }>;
};

export default function ScanList({ scans }: { scans: EnrichedScan[] }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleDelete(scanId: string) {
    if (!confirm("Delete this scan? This will reverse the check-in and remove received units for the matched order(s).")) {
      return;
    }

    setDeleting(scanId);
    setMessage(null);

    try {
      const res = await fetch(`/api/receiving/scan/${scanId}`, {
        method: "DELETE"
      });
      const data = await res.json();

      if (res.ok) {
        setMessage(data.message);
        router.refresh();
      } else {
        setMessage(`Error: ${data.error}`);
      }
    } catch {
      setMessage("Network error. Please try again.");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h2 className="text-lg font-semibold">Recent Scans</h2>
      {message && (
        <p className="mt-2 rounded bg-slate-800 px-3 py-2 text-sm text-yellow-400">{message}</p>
      )}
      <div className="mt-3 space-y-2 text-sm text-slate-300">
        {scans.length === 0 ? (
          <p>No scans yet.</p>
        ) : (
          scans.map((scan) => (
            <div key={scan.id} className="rounded border border-slate-800 p-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-medium">...{scan.tracking_last8}</span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs ${
                        scan.resolution_state === "MATCHED"
                          ? "bg-green-900 text-green-300"
                          : "bg-yellow-900 text-yellow-300"
                      }`}
                    >
                      {scan.resolution_state}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {new Date(scan.scanned_at).toLocaleString()} · by {scan.scanned_by}
                  </p>
                  {scan.notes && (
                    <p className="mt-1 text-xs text-slate-400">Notes: {scan.notes}</p>
                  )}
                </div>
                <button
                  onClick={() => handleDelete(scan.id)}
                  disabled={deleting === scan.id}
                  className="rounded border border-red-800 px-2 py-1 text-xs text-red-400 hover:bg-red-900 disabled:opacity-50"
                >
                  {deleting === scan.id ? "Deleting..." : "Delete"}
                </button>
              </div>

              {scan.matchedOrders.length > 0 && (
                <div className="mt-2 space-y-1">
                  {scan.matchedOrders.map((order, i) => (
                    <div key={i} className="rounded bg-slate-800 px-2 py-1.5">
                      <div className="flex items-center gap-2">
                        <a
                          href={`/orders/${order.orderId}`}
                          className="text-xs font-medium text-blue-400 hover:underline"
                        >
                          Order {order.orderId}
                        </a>
                        <span
                          className={`rounded px-1.5 py-0.5 text-xs ${
                            order.checkedIn
                              ? "bg-emerald-900 text-emerald-300"
                              : "bg-slate-700 text-slate-300"
                          }`}
                        >
                          {order.checkedIn ? "Checked In" : "Not Checked In"}
                        </span>
                      </div>
                      {order.items.map((item, j) => (
                        <p key={j} className="text-xs text-slate-400">
                          {item.title} (x{item.qty})
                        </p>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
