import PageHeader from "@/components/page-header";
import { prisma } from "@/lib/db";
import Link from "next/link";
import ProductRow from "./product-row";

type ProductStats = {
  productId: string;
  productName: string;
  gtin: string | null;
  onHand: number;
  toBeReturned: number;
  partsRepair: number;
  returned: number;
  missing: number;
  totalValue: number;
  onHandValue: number;
  toBeReturnedValue: number;
  partsRepairValue: number;
};

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

export default async function OnHandPage() {
  // Fetch all received units with their categories and order item prices
  const units = await prisma.received_units.findMany({
    where: {
      product_id: { not: null }
    },
    select: {
      id: true,
      item_id: true,
      order_id: true,
      order_item_id: true,
      unit_index: true,
      condition_status: true,
      inventory_state: true,
      received_at: true,
      notes: true,
      product: true,
      order_item: {
        select: {
          id: true,
          item_id: true,
          title: true,
          transaction_price: true,
          shipping_cost: true,
          qty: true
        }
      },
      order: {
        select: {
          order_id: true,
          totals: true,           // Current order total from eBay (includes shipping, after refunds)
          original_total: true    // Frozen at first sync — used to calculate refund amount
        }
      }
    }
  });

  // Fetch all returns to calculate refunded amounts and original costs per order/item
  const returns = await prisma.returns.findMany({
    where: {
      order_id: { not: null },
      OR: [
        { actual_refund: { not: null } },
        { refund_amount: { not: null } },
        { estimated_refund: { not: null } }  // Include all returns with estimated_refund
      ]
    },
    select: {
      order_id: true,
      item_id: true,
      ebay_item_id: true,
      refund_amount: true,
      actual_refund: true,
      estimated_refund: true,  // This is the original total paid (item + shipping)
      return_shipped_date: true,
      return_delivered_date: true,
      refund_issued_date: true,
      ebay_state: true,
      ebay_status: true,
      order: {
        select: {
          totals: true,  // Current order total after any refunds
          order_items: {
            select: {
              item_id: true,
              transaction_price: true,
              shipping_cost: true,
              qty: true
            }
          }
        }
      }
    }
  });

  // Build a map of order_id -> original_total from the units' order relation.
  // original_total is captured at first sync and never overwritten — it is the pre-refund order total.
  // For older orders without original_total, we fall back to estimated_refund per-item (legacy path).
  const orderOriginalTotalMap = new Map<string, number>(); // order_id -> original_total
  for (const unit of units) {
    if (unit.order?.order_id && unit.order.original_total != null) {
      if (!orderOriginalTotalMap.has(unit.order.order_id)) {
        orderOriginalTotalMap.set(unit.order.order_id, Number(unit.order.original_total));
      }
    }
  }

  // Build maps for refunded amounts, original costs, and return info by order_id + item_id.
  // Note: Some returns have ebay_item_id instead of item_id, so we need both.
  const refundMap = new Map<string, number>();
  // originalCostMap is the legacy fallback for orders without original_total on the order record.
  // Key: "orderId-itemId", value: estimated_refund (per-item original cost proxy from Returns API).
  const originalCostMap = new Map<string, number>();
  const returnInfoMap = new Map<string, {
    refundAmount: number;
    wasReturned: boolean;  // true if return was delivered
    wasShipped: boolean;   // true if return was shipped
  }>();

  for (const ret of returns) {
    if (!ret.order_id) continue;

    // Use item_id if available, otherwise use ebay_item_id
    const itemId = ret.item_id || ret.ebay_item_id;
    if (!itemId) continue;

    const key = `${ret.order_id}-${itemId}`;

    // Legacy fallback: track estimated_refund as original cost for orders without original_total
    if (ret.estimated_refund && !orderOriginalTotalMap.has(ret.order_id)) {
      originalCostMap.set(key, Number(ret.estimated_refund));
    }

    // Refund amount for this item:
    // Prefer original_total on the order (works for all refund types incl. INR/courtesy)
    // Fall back to estimated_refund - current_total for legacy orders
    let refundAmount = 0;

    if (ret.order) {
      let currentOrderTotal = 0;
      if (ret.order.totals && typeof ret.order.totals === 'object' && 'total' in ret.order.totals) {
        currentOrderTotal = Number((ret.order.totals as any).total);
      }

      // If the order has original_total, that's the canonical pre-refund amount.
      // The refund shown in the return record's estimated_refund is per-item, so we
      // skip computing order-level refund here — it will be computed per-unit in the
      // cost section below using original_total - totals.total.
      // We still populate refundMap for the *legacy* path using estimated_refund.
      if (!orderOriginalTotalMap.has(ret.order_id)) {
        const estimatedRefund = ret.estimated_refund ? Number(ret.estimated_refund) : 0;
        if (estimatedRefund > 0 && estimatedRefund >= currentOrderTotal) {
          refundAmount = estimatedRefund - currentOrderTotal;
        }
      }
    }

    if (refundAmount > 0) {
      const existing = refundMap.get(key) || 0;
      refundMap.set(key, existing + refundAmount);

      returnInfoMap.set(key, {
        refundAmount: refundAmount,
        wasReturned: Boolean(ret.return_delivered_date),
        wasShipped: Boolean(ret.return_shipped_date)
      });
    }
  }

  // Build per-order subtotal sum using distinct order_items per order
  // Used to allocate shipping proportionally across items in multi-item orders
  const orderItemPriceSum = new Map<string, number>(); // order_id -> sum of all items' transaction_price * qty
  const seenOrderItems = new Set<string>();
  for (const unit of units) {
    if (unit.order_item && unit.order?.order_id) {
      if (!seenOrderItems.has(unit.order_item.id)) {
        seenOrderItems.add(unit.order_item.id);
        const itemSubtotal = Number(unit.order_item.transaction_price) * unit.order_item.qty;
        const existing = orderItemPriceSum.get(unit.order.order_id) || 0;
        orderItemPriceSum.set(unit.order.order_id, existing + itemSubtotal);
      }
    }
  }

  // For lots and multi-qty items, we need to count how many units were scanned
  // to divide the price correctly. Also track good vs not-good units for smart refund distribution
  const orderItemUnitCounts = new Map<string, number>();
  const orderItemBadUnits = new Map<string, Set<string>>();  // Map of order_item_id -> set of bad/parts unit IDs
  const goodConditionSet = new Set(["good", "new", "like_new", "acceptable", "excellent"]);
  // A unit is "bad" if its condition is not good, OR if it's parts/repair/missing (not resaleable)
  const isBadUnit = (u: { condition_status: string; inventory_state: string }) =>
    !goodConditionSet.has(u.condition_status?.toLowerCase() ?? "") || u.inventory_state === "parts_repair" || u.inventory_state === "missing";

  for (const unit of units) {
    if (unit.order_item_id) {
      const count = orderItemUnitCounts.get(unit.order_item_id) || 0;
      orderItemUnitCounts.set(unit.order_item_id, count + 1);

      // Track bad/parts units — refunds are distributed to these first
      if (isBadUnit(unit)) {
        if (!orderItemBadUnits.has(unit.order_item_id)) {
          orderItemBadUnits.set(unit.order_item_id, new Set());
        }
        orderItemBadUnits.get(unit.order_item_id)!.add(unit.id);
      }
    }
  }

  // Group by product name (not product_id) to combine duplicate products
  const productMap = new Map<string, ProductStats>();
  const productUnits = new Map<string, UnitDetail[]>();

  for (const unit of units) {
    if (!unit.product) continue;

    // Group by name (case-insensitive) to combine "TI-83 Plus" with "TI-83 PLUS"
    const productKey = unit.product.product_name.toLowerCase();

    // Calculate per-unit cost with smart refund distribution
    let itemCost = 0;
    if (unit.order_item) {
      let totalCost = 0;
      const orderId = unit.order?.order_id;
      const refundKey = orderId && unit.order_item.item_id
        ? `${orderId}-${unit.order_item.item_id}`
        : null;

      // Determine the original (pre-refund) order total.
      // Priority 1: original_total on the order record (set at first sync, never overwritten).
      //             Works for all refund types (returns, INR, eBay-courtesy).
      // Priority 2: Legacy fallback — estimated_refund per-item from Returns API.
      //             Only covers orders that went through eBay's return flow AND lack original_total.
      const orderOriginalTotal = orderId ? orderOriginalTotalMap.get(orderId) : undefined;
      const itemSubtotalSum = orderId ? (orderItemPriceSum.get(orderId) || 0) : 0;

      if (orderOriginalTotal != null) {
        // Use original_total as the order's cost basis. Allocate to this item proportionally.
        if (itemSubtotalSum > 0 && unit.order_item) {
          const itemSubtotal = Number(unit.order_item.transaction_price) * unit.order_item.qty;
          const shippingRatio = itemSubtotal / itemSubtotalSum;
          const totalShipping = Math.max(0, orderOriginalTotal - itemSubtotalSum);
          totalCost = itemSubtotal + totalShipping * shippingRatio;
        } else {
          totalCost = orderOriginalTotal;
        }
      } else if (refundKey && originalCostMap.has(refundKey)) {
        // Legacy: estimated_refund acts as per-item original cost (includes shipping for that item)
        totalCost = originalCostMap.get(refundKey)!;
      } else if (unit.order?.totals && typeof unit.order.totals === 'object' && 'total' in unit.order.totals) {
        // No original_total and no return record — use current totals.total as best available cost.
        // (This is the post-refund total, so cost may be understated if a refund exists without a return record.)
        const orderTotal = Number((unit.order.totals as any).total);

        if (itemSubtotalSum > 0 && unit.order_item) {
          const totalShipping = Math.max(0, orderTotal - itemSubtotalSum);
          const itemSubtotal = Number(unit.order_item.transaction_price) * unit.order_item.qty;
          const shippingRatio = itemSubtotal / itemSubtotalSum;
          const allocatedShipping = totalShipping * shippingRatio;
          totalCost = itemSubtotal + allocatedShipping;
        } else {
          totalCost = orderTotal;
        }
      }

      // Refund amount for this item:
      // If original_total is available, compute order-level refund = original_total - current_total,
      // then allocate to this item proportionally (same ratio as cost allocation).
      let refundAmount = 0;
      if (orderOriginalTotal != null && unit.order?.totals &&
          typeof unit.order.totals === 'object' && 'total' in unit.order.totals) {
        const currentOrderTotal = Number((unit.order.totals as any).total);
        const orderRefund = Math.max(0, orderOriginalTotal - currentOrderTotal);
        if (orderRefund > 0 && itemSubtotalSum > 0 && unit.order_item) {
          const itemSubtotal = Number(unit.order_item.transaction_price) * unit.order_item.qty;
          refundAmount = orderRefund * (itemSubtotal / itemSubtotalSum);
        } else if (orderRefund > 0) {
          refundAmount = orderRefund;
        }
      } else {
        // Legacy path: use refundMap built from estimated_refund
        refundAmount = refundKey ? (refundMap.get(refundKey) || 0) : 0;
      }
      const unitsScanned = orderItemUnitCounts.get(unit.order_item.id) || 1;
      const badUnitsSet = orderItemBadUnits.get(unit.order_item.id);
      const badUnitsCount = badUnitsSet ? badUnitsSet.size : 0;
      const isThisUnitBad = badUnitsSet ? badUnitsSet.has(unit.id) : false;

      // Cost distribution logic:
      // - Base per-unit cost = originalCost / totalUnits (all units share cost equally)
      // - Refund is then applied proportionally to bad/parts units first
      // - If refund exactly covers N bad units' average cost, those units get $0
      //   and good units retain their full per-unit cost (no refund benefit to good units)
      // - If no refund: all units (including parts/repair) carry their share of the cost
      // - If full refund: all units = $0

      const perUnitCost = totalCost / unitsScanned;

      if (refundAmount <= 0) {
        // No refund — all units share cost equally, including parts/repair
        itemCost = perUnitCost;
      } else if (refundAmount >= totalCost) {
        // Full refund — everything is $0
        itemCost = 0;
      } else {
        // Partial refund — apply to bad/parts units first, then spill to good units
        const badUnitsTotalCost = perUnitCost * badUnitsCount;
        const goodUnitsCount = unitsScanned - badUnitsCount;

        if (refundAmount <= badUnitsTotalCost) {
          // Refund fits within the bad units' share — distribute evenly across bad units
          if (isThisUnitBad) {
            const refundPerBadUnit = refundAmount / badUnitsCount;
            itemCost = Math.max(0, perUnitCost - refundPerBadUnit);
          } else {
            itemCost = perUnitCost; // Good units unaffected
          }
        } else {
          // Refund exceeds all bad units' cost — bad units go to $0, remainder hits good units
          if (isThisUnitBad) {
            itemCost = 0;
          } else {
            const remainingRefund = refundAmount - badUnitsTotalCost;
            const refundPerGoodUnit = remainingRefund / Math.max(1, goodUnitsCount);
            itemCost = Math.max(0, perUnitCost - refundPerGoodUnit);
          }
        }
      }
    }

    if (!productMap.has(productKey)) {
      productMap.set(productKey, {
        productId: unit.product.id, // Keep first product ID for reference
        productName: unit.product.product_name,
        gtin: unit.product.gtin, // Keep first GTIN found (may be null)
        onHand: 0,
        toBeReturned: 0,
        partsRepair: 0,
        returned: 0,
        missing: 0,
        totalValue: 0,
        onHandValue: 0,
        toBeReturnedValue: 0,
        partsRepairValue: 0
      });
    }

    const stats = productMap.get(productKey)!;

    stats.totalValue += itemCost;

    switch (unit.inventory_state) {
      case "on_hand":
        stats.onHand++;
        stats.onHandValue += itemCost;
        break;
      case "to_be_returned":
        stats.toBeReturned++;
        stats.toBeReturnedValue += itemCost;
        break;
      case "parts_repair":
        stats.partsRepair++;
        stats.partsRepairValue += itemCost;
        break;
      case "returned":
        stats.returned++;
        break;
      case "missing":
        stats.missing++;
        break;
    }

    // Store unit details for expandable view
    if (!productUnits.has(productKey)) {
      productUnits.set(productKey, []);
    }

    productUnits.get(productKey)!.push({
      id: unit.id,
      order_id: unit.order?.order_id || "Unknown",
      item_id: unit.item_id,
      title: unit.order_item?.title ?? null,
      unit_index: unit.unit_index,
      condition_status: unit.condition_status,
      inventory_state: unit.inventory_state,
      received_at: unit.received_at,
      unitCost: itemCost,
      notes: unit.notes
    });
  }

  const products = Array.from(productMap.values()).sort((a, b) =>
    a.productName.localeCompare(b.productName)
  );

  // Calculate totals across all products
  const totals = {
    onHand: products.reduce((sum, p) => sum + p.onHand, 0),
    toBeReturned: products.reduce((sum, p) => sum + p.toBeReturned, 0),
    partsRepair: products.reduce((sum, p) => sum + p.partsRepair, 0),
    returned: products.reduce((sum, p) => sum + p.returned, 0),
    missing: products.reduce((sum, p) => sum + p.missing, 0),
    onHandValue: products.reduce((sum, p) => sum + p.onHandValue, 0),
    toBeReturnedValue: products.reduce((sum, p) => sum + p.toBeReturnedValue, 0),
    partsRepairValue: products.reduce((sum, p) => sum + p.partsRepairValue, 0),
    totalValue: products.reduce((sum, p) => sum + p.totalValue, 0)
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Items on Hand" />

      {/* Summary Dashboard */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="rounded-lg border border-green-800 bg-slate-900 p-4">
          <h3 className="text-sm font-medium text-slate-400">On Hand (Good)</h3>
          <p className="mt-1 text-2xl font-bold text-green-400">{totals.onHand}</p>
          <p className="mt-1 text-xs text-slate-500">
            ${totals.onHandValue.toFixed(2)} total value
          </p>
        </div>

        <div className="rounded-lg border border-yellow-800 bg-slate-900 p-4">
          <h3 className="text-sm font-medium text-slate-400">To Be Returned</h3>
          <p className="mt-1 text-2xl font-bold text-yellow-400">{totals.toBeReturned}</p>
          <p className="mt-1 text-xs text-slate-500">
            ${totals.toBeReturnedValue.toFixed(2)} total value
          </p>
        </div>

        <div className="rounded-lg border border-red-800 bg-slate-900 p-4">
          <h3 className="text-sm font-medium text-slate-400">Parts / Repair</h3>
          <p className="mt-1 text-2xl font-bold text-red-400">{totals.partsRepair}</p>
          <p className="mt-1 text-xs text-slate-500">
            ${totals.partsRepairValue.toFixed(2)} total value
          </p>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h3 className="text-sm font-medium text-slate-400">Returned</h3>
          <p className="mt-1 text-2xl font-bold text-slate-300">{totals.returned}</p>
          <p className="mt-1 text-xs text-slate-500">Completed returns</p>
        </div>

        {totals.missing > 0 && (
          <div className="rounded-lg border border-orange-800 bg-slate-900 p-4">
            <h3 className="text-sm font-medium text-slate-400">Missing</h3>
            <p className="mt-1 text-2xl font-bold text-orange-400">{totals.missing}</p>
            <p className="mt-1 text-xs text-slate-500">Short-shipped lot units</p>
          </div>
        )}
      </div>

      {/* Product Breakdown Table */}
      <div className="rounded-lg border border-slate-800 bg-slate-900">
        <div className="border-b border-slate-800 p-4">
          <h2 className="text-lg font-semibold">Inventory by Product</h2>
          <p className="text-sm text-slate-400 mt-1">
            {products.length} products tracked • Values adjusted for refunds
          </p>
        </div>

        {products.length === 0 ? (
          <div className="p-8 text-center text-slate-500">
            <p>No products on hand yet.</p>
            <p className="text-sm mt-1">
              Scan items in the <Link href="/receiving" className="text-blue-400 hover:underline">Receiving</Link> page to start tracking inventory.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-slate-800">
                <tr className="text-left text-xs font-medium text-slate-400">
                  <th className="p-3">Product</th>
                  <th className="p-3 text-center">GTIN</th>
                  <th className="p-3 text-center">On Hand</th>
                  <th className="p-3 text-center">To Return</th>
                  <th className="p-3 text-center">Parts/Repair</th>
                  <th className="p-3 text-center">Returned</th>
                  <th className="p-3 text-right">Total Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {products.map((product) => (
                  <ProductRow
                    key={product.productName}
                    product={product}
                    units={productUnits.get(product.productName.toLowerCase()) || []}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
