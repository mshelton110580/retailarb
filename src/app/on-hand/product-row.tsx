"use client";

import { useState } from "react";
import Link from "next/link";

type UnitDetail = {
  id: string;
  order_id: string;
  item_id: string;
  title: string | null;
  unit_index: number;
  condition_status: string;
  inventory_state: string;
  received_at: Date;
  unitCost: number;
  notes: string | null;
};

type ProductRowProps = {
  product: {
    categoryId: string;
    productName: string;
    gtin: string | null;
    onHand: number;
    toBeReturned: number;
    partsRepair: number;
    returned: number;
    missing: number;
    possibleChargeback: number;
    totalValue: number;
    onHandValue: number;
    toBeReturnedValue: number;
    partsRepairValue: number;
  };
  units: UnitDetail[];
};

function formatInventoryState(state: string): string {
  switch (state) {
    case "on_hand":
      return "On Hand";
    case "to_be_returned":
      return "To Be Returned";
    case "parts_repair":
      return "Parts/Repair";
    case "returned":
      return "Returned";
    case "missing":
      return "Missing";
    case "possible_chargeback":
      return "Possible Chargeback";
    default:
      return state;
  }
}

function getStateColor(state: string): string {
  switch (state) {
    case "on_hand":
      return "text-green-400";
    case "to_be_returned":
      return "text-yellow-400";
    case "parts_repair":
      return "text-red-400";
    case "returned":
      return "text-slate-400";
    case "missing":
      return "text-orange-400";
    case "possible_chargeback":
      return "text-rose-400";
    default:
      return "text-slate-400";
  }
}

export default function ProductRow({ product, units }: ProductRowProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr
        className="hover:bg-slate-800/50 transition-colors cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="p-3">
          <div className="flex items-center gap-2">
            <svg
              className={`w-4 h-4 text-slate-400 transition-transform ${
                expanded ? "rotate-90" : ""
              }`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
            <div className="font-medium text-sm">{product.productName}</div>
          </div>
        </td>
        <td className="p-3 text-center">
          <span className="text-xs font-mono text-slate-400">
            {product.gtin || "—"}
          </span>
        </td>
        <td className="p-3 text-center">
          <div className="flex flex-col items-center">
            <span className="text-sm font-medium text-green-400">
              {product.onHand}
            </span>
            {product.onHandValue > 0 && (
              <span className="text-xs text-slate-500">
                ${product.onHandValue.toFixed(0)}
              </span>
            )}
          </div>
        </td>
        <td className="p-3 text-center">
          <div className="flex flex-col items-center">
            <span className="text-sm font-medium text-yellow-400">
              {product.toBeReturned}
            </span>
            {product.toBeReturnedValue > 0 && (
              <span className="text-xs text-slate-500">
                ${product.toBeReturnedValue.toFixed(0)}
              </span>
            )}
          </div>
        </td>
        <td className="p-3 text-center">
          <div className="flex flex-col items-center">
            <span className="text-sm font-medium text-red-400">
              {product.partsRepair}
            </span>
            {product.partsRepairValue > 0 && (
              <span className="text-xs text-slate-500">
                ${product.partsRepairValue.toFixed(0)}
              </span>
            )}
          </div>
        </td>
        <td className="p-3 text-center">
          <span className="text-sm text-slate-400">{product.returned}</span>
        </td>
        <td className="p-3 text-right">
          <span className="text-sm font-medium">
            ${product.totalValue.toFixed(2)}
          </span>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={7} className="bg-slate-800/30 p-0">
            <div className="p-4">
              <h4 className="text-xs font-semibold text-slate-400 mb-3 uppercase tracking-wide">
                Individual Items ({units.length})
              </h4>
              <div className="space-y-2">
                {units.map((unit) => (
                  <div
                    key={unit.id}
                    className="bg-slate-900/50 rounded border border-slate-700 p-3 text-xs"
                  >
                    {unit.title && (
                      <div className="text-slate-300 font-medium mb-2 leading-snug">
                        {unit.title}
                      </div>
                    )}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                      <div>
                        <div className="text-slate-500 mb-1">Order</div>
                        <Link
                          href={`/orders/${unit.order_id}`}
                          className="text-blue-400 hover:underline font-mono"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {unit.order_id}
                        </Link>
                      </div>
                      <div>
                        <div className="text-slate-500 mb-1">Item ID</div>
                        <a
                          href={`https://www.ebay.com/itm/${unit.item_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 hover:underline font-mono"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {unit.item_id}
                        </a>
                      </div>
                      <div>
                        <div className="text-slate-500 mb-1">Unit #</div>
                        <div className="font-medium">{unit.unit_index}</div>
                      </div>
                      <div>
                        <div className="text-slate-500 mb-1">Status</div>
                        <div className={`font-medium ${getStateColor(unit.inventory_state)}`}>
                          {formatInventoryState(unit.inventory_state)}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500 mb-1">Value</div>
                        <div className="font-medium">${unit.unitCost.toFixed(2)}</div>
                      </div>
                      <div>
                        <div className="text-slate-500 mb-1">Condition</div>
                        <div className="font-medium capitalize">{unit.condition_status}</div>
                      </div>
                      <div>
                        <div className="text-slate-500 mb-1">Scanned</div>
                        <div className="font-medium">
                          {new Date(unit.received_at).toLocaleDateString()}
                        </div>
                      </div>
                      {unit.notes && (
                        <div className="col-span-2 md:col-span-3">
                          <div className="text-slate-500 mb-1">Notes</div>
                          <div className="text-slate-300">{unit.notes}</div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
