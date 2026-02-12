"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ReceivedUnit = {
  unitIndex: number;
  title: string;
  condition: string;
  receivedAt: string;
  notes: string | null;
};

type EnrichedScan = {
  id: string;
  tracking_last8: string;
  resolution_state: string;
  scanned_at: string;
  scanned_by: string;
  notes: string | null;
  matchedOrders: Array<{
    orderId: string;
    items: Array<{ title: string; qty: number; price: string }>;
    checkedIn: boolean;
    expectedUnits: number;
    scannedUnits: number;
    scanStatus: string | null;
    isLot: boolean;
    receivedUnits: ReceivedUnit[];
  }>;
};

const conditionColors: Record<string, string> = {
  good: "bg-green-900 text-green-300",
  "new_sealed": "bg-blue-900 text-blue-300",
  "like_new": "bg-cyan-900 text-cyan-300",
  acceptable: "bg-yellow-900 text-yellow-300",
  damaged: "bg-red-900 text-red-300",
  wrong_item: "bg-orange-900 text-orange-300",
  missing_parts: "bg-amber-900 text-amber-300",
  defective: "bg-rose-900 text-rose-300",
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
                <div className="mt-2 space-y-2">
                  {scan.matchedOrders.map((order, i) => (
                    <div key={i} className="rounded bg-slate-800 px-3 py-2">
                      {/* Order header */}
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
                        {order.isLot && (
                          <span className="rounded bg-fuchsia-900 px-1.5 py-0.5 text-xs text-fuchsia-300">
                            LOT
                          </span>
                        )}
                      </div>

                      {/* Order items (what was ordered) */}
                      <div className="mt-1.5 border-l-2 border-slate-700 pl-2">
                        <p className="text-[10px] uppercase tracking-wide text-slate-500">Ordered Items</p>
                        {order.items.map((item, j) => (
                          <p key={j} className="text-xs text-slate-400">
                            {item.title} (x{item.qty}) — ${item.price}
                          </p>
                        ))}
                      </div>

                      {/* Scan progress */}
                      {order.scannedUnits > 0 && (
                        <div className="mt-2">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 flex-1 rounded-full bg-slate-700 overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  order.isLot ? "bg-fuchsia-500" :
                                  order.scannedUnits >= order.expectedUnits ? "bg-green-500" : "bg-yellow-500"
                                }`}
                                style={{ width: `${Math.min(100, order.expectedUnits > 0 ? (order.scannedUnits / order.expectedUnits) * 100 : 100)}%` }}
                              />
                            </div>
                            <span className="text-xs text-slate-400 whitespace-nowrap">
                              {order.isLot
                                ? `${order.scannedUnits} scanned (listed: ${order.expectedUnits})`
                                : `${order.scannedUnits}/${order.expectedUnits} units`}
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Received units (per-unit condition details) */}
                      {order.receivedUnits.length > 0 && (
                        <div className="mt-2 border-l-2 border-emerald-800 pl-2">
                          <p className="text-[10px] uppercase tracking-wide text-slate-500">Received Units</p>
                          {order.receivedUnits.map((unit, k) => (
                            <div key={k} className="mt-0.5 flex items-center gap-2 text-xs">
                              <span className="text-slate-500">#{unit.unitIndex}</span>
                              <span className="text-slate-300">{unit.title}</span>
                              <span className={`rounded px-1.5 py-0.5 text-[10px] ${conditionColors[unit.condition] ?? "bg-slate-700 text-slate-300"}`}>
                                {unit.condition.replace(/_/g, " ")}
                              </span>
                              <span className="text-slate-600">
                                {new Date(unit.receivedAt).toLocaleString()}
                              </span>
                              {unit.notes && (
                                <span className="text-slate-500 italic">({unit.notes})</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
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
