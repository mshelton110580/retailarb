import PageHeader from "@/components/page-header";
import { prisma } from "@/lib/db";
import Link from "next/link";
import ProductRow from "./product-row";

type ProductStats = {
  categoryId: string;
  productName: string;
  gtin: string | null;
  onHand: number;
  toBeReturned: number;
  partsRepair: number;
  returned: number;
  totalValue: number;
  onHandValue: number;
  toBeReturnedValue: number;
  partsRepairValue: number;
};

type UnitDetail = {
  id: string;
  order_id: string;
  item_id: string;
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
      category_id: { not: null }
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
      category: true,
      order_item: {
        select: {
          id: true,
          item_id: true,
          transaction_price: true,
          shipping_cost: true,
          qty: true
        }
      },
      order: {
        select: {
          order_id: true,
          totals: true  // Current order total from eBay (includes shipping, after refunds)
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

  // Build maps for refunded amounts, original costs, and return info by order_id + item_id
  // Note: Some returns have ebay_item_id instead of item_id, so we need both
  const refundMap = new Map<string, number>();
  const originalCostMap = new Map<string, number>();  // estimated_refund = original total paid
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

    // Calculate actual refund amount
    // Priority order:
    // 1. Use actual_refund if available AND it's not equal to estimated_refund (most reliable)
    // 2. Calculate as estimated_refund - current_order_total (most accurate method)
    // 3. Use refund_amount only if calculation method fails
    let refundAmount = 0;
    const estimatedRefund = ret.estimated_refund ? Number(ret.estimated_refund) : 0;

    // Check if actual_refund is set and is a partial refund (not equal to estimated_refund)
    if (ret.actual_refund && Number(ret.actual_refund) !== estimatedRefund) {
      refundAmount = Number(ret.actual_refund);
    } else if (ret.estimated_refund && ret.order) {
      // Use order.totals.total (current order total from eBay) if available
      // This is the most accurate as it reflects the post-refund total
      let currentOrderTotal = 0;

      if (ret.order.totals && typeof ret.order.totals === 'object' && 'total' in ret.order.totals) {
        currentOrderTotal = Number((ret.order.totals as any).total);
      } else if (ret.order.order_items) {
        // Fallback: sum up order items
        currentOrderTotal = ret.order.order_items.reduce((sum, item) => {
          if (item.item_id === itemId) {
            return sum + Number(item.transaction_price) + Number(item.shipping_cost || 0);
          }
          return sum;
        }, 0);
      }

      // If estimated_refund > current_total, a refund was issued
      if (estimatedRefund > currentOrderTotal && currentOrderTotal > 0) {
        refundAmount = estimatedRefund - currentOrderTotal;
      }
    } else if (ret.refund_amount && Number(ret.refund_amount) !== estimatedRefund) {
      // Only use refund_amount as last resort, and only if it's not equal to estimated_refund
      refundAmount = Number(ret.refund_amount);
    }

    // Track ORIGINAL order total (estimated_refund = what was originally paid before refund)
    // This is used for calculating per-unit costs based on original value
    if (ret.estimated_refund) {
      originalCostMap.set(key, Number(ret.estimated_refund));
    }

    // If we have a refund, track it
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

  // For lots and multi-qty items, we need to count how many units were scanned
  // to divide the price correctly. Also track good vs not-good units for smart refund distribution
  const orderItemUnitCounts = new Map<string, number>();
  const orderItemBadUnits = new Map<string, Set<string>>();  // Map of order_item_id -> set of bad unit IDs
  const badConditions = ["damaged", "wrong_item", "missing_parts", "defective"];

  for (const unit of units) {
    if (unit.order_item_id) {
      const count = orderItemUnitCounts.get(unit.order_item_id) || 0;
      orderItemUnitCounts.set(unit.order_item_id, count + 1);

      // Track bad units for smart refund distribution
      if (badConditions.includes(unit.condition_status)) {
        if (!orderItemBadUnits.has(unit.order_item_id)) {
          orderItemBadUnits.set(unit.order_item_id, new Set());
        }
        orderItemBadUnits.get(unit.order_item_id)!.add(unit.id);
      }
    }
  }

  // Group by product name (not category_id) to combine duplicate products
  const productMap = new Map<string, ProductStats>();
  const productUnits = new Map<string, UnitDetail[]>();

  for (const unit of units) {
    if (!unit.category) continue;

    const productKey = unit.category.category_name; // Group by name, not ID

    // Calculate per-unit cost with smart refund distribution
    let itemCost = 0;
    if (unit.order_item) {
      let totalCost = 0;
      const refundKey = unit.order?.order_id && unit.order_item.item_id
        ? `${unit.order.order_id}-${unit.order_item.item_id}`
        : null;

      // First, try to get the original cost from estimated_refund (most accurate for refunded orders)
      if (refundKey && originalCostMap.has(refundKey)) {
        totalCost = originalCostMap.get(refundKey)!;
      } else if (unit.order?.totals && typeof unit.order.totals === 'object' && 'total' in unit.order.totals) {
        // Use order.totals.total from eBay (always accurate, includes shipping)
        totalCost = Number((unit.order.totals as any).total);
      }
      // Note: We don't use transaction_price + shipping_cost as a fallback because:
      // - shipping_cost is often missing or inaccurate
      // - order.totals.total should always be available from eBay sync

      const refundAmount = refundKey ? (refundMap.get(refundKey) || 0) : 0;
      const unitsScanned = orderItemUnitCounts.get(unit.order_item.id) || 1;
      const badUnitsSet = orderItemBadUnits.get(unit.order_item.id);
      const badUnitsCount = badUnitsSet ? badUnitsSet.size : 0;
      const isThisUnitBad = badUnitsSet ? badUnitsSet.has(unit.id) : false;

      // Smart refund distribution for lots with partial refunds
      if (refundAmount > 0 && refundAmount < totalCost && unitsScanned > 1) {
        // Partial refund on a lot
        const perUnitCost = totalCost / unitsScanned;

        if (badUnitsCount === 0) {
          // All units are good - distribute refund equally
          itemCost = (totalCost - refundAmount) / unitsScanned;
        } else {
          // Mixed good/bad units
          const badUnitsTotalCost = perUnitCost * badUnitsCount;
          const goodUnitsCount = unitsScanned - badUnitsCount;

          if (refundAmount <= badUnitsTotalCost) {
            // Refund is less than or equal to bad units' cost - apply to bad units only
            if (isThisUnitBad) {
              const refundPerBadUnit = refundAmount / badUnitsCount;
              itemCost = Math.max(0, perUnitCost - refundPerBadUnit);
            } else {
              itemCost = perUnitCost; // Good units keep full cost
            }
          } else {
            // Refund exceeds bad units' cost - zero out bad units and apply remainder to good units
            if (isThisUnitBad) {
              itemCost = 0; // Bad units are fully refunded
            } else {
              // Remaining refund after zeroing out bad units
              const remainingRefund = refundAmount - badUnitsTotalCost;
              const refundPerGoodUnit = remainingRefund / goodUnitsCount;
              itemCost = Math.max(0, perUnitCost - refundPerGoodUnit);
            }
          }
        }
      } else {
        // Full refund, no refund, or single unit - use simple distribution
        const costAfterRefund = Math.max(0, totalCost - refundAmount);
        itemCost = costAfterRefund / unitsScanned;
      }
    }

    if (!productMap.has(productKey)) {
      productMap.set(productKey, {
        categoryId: unit.category.id, // Keep first category ID for reference
        productName: unit.category.category_name,
        gtin: unit.category.gtin, // Keep first GTIN found (may be null)
        onHand: 0,
        toBeReturned: 0,
        partsRepair: 0,
        returned: 0,
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
    }

    // Store unit details for expandable view
    if (!productUnits.has(productKey)) {
      productUnits.set(productKey, []);
    }

    productUnits.get(productKey)!.push({
      id: unit.id,
      order_id: unit.order?.order_id || "Unknown",
      item_id: unit.item_id,
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
                    units={productUnits.get(product.productName) || []}
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
