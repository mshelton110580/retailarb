"use client";

import { useState } from "react";
import LotReconciliation from "@/components/lot-reconciliation";
import Link from "next/link";

type Shipment = {
  id: string;
  order_id: string;
  scanned_units: number;
  expected_units: number;
  is_lot: boolean;
  lot_size: number | null;
  reconciliation_status: string;
  items: { title: string; qty: number; itemId: string }[];
};

export default function CheckQuantityPanel({ shipments }: { shipments: Shipment[] }) {
  const [activeShipmentId, setActiveShipmentId] = useState<string | null>(null);

  if (activeShipmentId) {
    return (
      <LotReconciliation
        shipmentId={activeShipmentId}
        onDone={() => setActiveShipmentId(null)}
      />
    );
  }

  const pending = shipments.filter((s) => s.reconciliation_status !== "reviewed" && s.reconciliation_status !== "overridden");
  const reviewed = shipments.filter((s) => s.reconciliation_status === "reviewed" || s.reconciliation_status === "overridden");

  function renderShipment(s: Shipment) {
    const lotSize = s.lot_size ?? (s.expected_units > 0 ? Math.round(s.scanned_units / s.expected_units) : null);
    return (
      <div
        key={s.id}
        className="rounded-lg border border-slate-800 bg-slate-900 p-3 cursor-pointer hover:border-fuchsia-700 hover:bg-slate-800/50 transition-colors"
        onClick={() => setActiveShipmentId(s.id)}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href={`/orders/${s.order_id}`}
              className="text-sm font-medium text-blue-400 hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              Order {s.order_id}
            </Link>
            <span className="rounded px-1.5 py-0.5 text-xs bg-fuchsia-900 text-fuchsia-300">LOT</span>
            {(s.reconciliation_status === "reviewed" || s.reconciliation_status === "overridden") ? (
              <span className="rounded px-1.5 py-0.5 text-xs bg-green-900 text-green-300">
                ✓ {s.reconciliation_status === "overridden" ? "Overridden" : "Reviewed"}
              </span>
            ) : (
              <span className="rounded px-1.5 py-0.5 text-xs bg-amber-900 text-amber-300">Needs Review</span>
            )}
          </div>
          <span className="text-xs text-slate-500">
            {s.scanned_units} scanned
            {lotSize && s.expected_units > 0 ? ` (${s.expected_units} × ${lotSize})` : ""}
          </span>
        </div>
        {s.items.map((item, i) => (
          <p key={i} className="mt-1 text-xs text-slate-400 truncate" title={item.title}>
            {item.title} <span className="text-slate-600">×{item.qty}</span>
          </p>
        ))}
        <p className="mt-2 text-xs text-fuchsia-400 hover:text-fuchsia-300">Click to review →</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {pending.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-amber-400 uppercase tracking-wider">
            Needs Review ({pending.length})
          </p>
          {pending.map(renderShipment)}
        </div>
      )}
      {reviewed.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-green-400 uppercase tracking-wider">
            Reviewed ({reviewed.length})
          </p>
          {reviewed.map(renderShipment)}
        </div>
      )}
      {shipments.length === 0 && (
        <p className="text-sm text-slate-500">No lots pending reconciliation.</p>
      )}
    </div>
  );
}
