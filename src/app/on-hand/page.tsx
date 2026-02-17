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
          order_id: true
        }
      }
    }
  });

  // Fetch all returns to calculate refunded amounts per order/item
  const returns = await prisma.returns.findMany({
    where: {
      order_id: { not: null },
      actual_refund: { not: null }
    },
    select: {
      order_id: true,
      item_id: true,
      ebay_item_id: true,
      actual_refund: true
    }
  });

  // Build a map of refunded amounts by order_id + item_id
  // Note: Some returns have ebay_item_id instead of item_id, so we need both
  const refundMap = new Map<string, number>();
  for (const ret of returns) {
    if (!ret.order_id || !ret.actual_refund) continue;

    // Use item_id if available, otherwise use ebay_item_id
    const itemId = ret.item_id || ret.ebay_item_id;
    if (!itemId) continue;

    const key = `${ret.order_id}-${itemId}`;
    const existing = refundMap.get(key) || 0;
    refundMap.set(key, existing + Number(ret.actual_refund));
  }

  // For lots and multi-qty items, we need to count how many units were scanned
  // to divide the price correctly
  const orderItemUnitCounts = new Map<string, number>();

  for (const unit of units) {
    if (unit.order_item_id) {
      const count = orderItemUnitCounts.get(unit.order_item_id) || 0;
      orderItemUnitCounts.set(unit.order_item_id, count + 1);
    }
  }

  // Group by product and inventory state
  const productMap = new Map<string, ProductStats>();
  const productUnits = new Map<string, UnitDetail[]>();

  for (const unit of units) {
    if (!unit.category) continue;

    const categoryId = unit.category.id;

    // Calculate per-unit cost by dividing total price by number of units scanned
    let itemCost = 0;
    if (unit.order_item) {
      const totalPrice = Number(unit.order_item.transaction_price);
      const totalShipping = Number(unit.order_item.shipping_cost) || 0;
      let totalCost = totalPrice + totalShipping;

      // Subtract any refunds for this order/item
      if (unit.order?.order_id && unit.order_item.item_id) {
        const refundKey = `${unit.order.order_id}-${unit.order_item.item_id}`;
        const refundAmount = refundMap.get(refundKey) || 0;
        totalCost = Math.max(0, totalCost - refundAmount);
      }

      // Get the number of units scanned for this order_item
      const unitsScanned = orderItemUnitCounts.get(unit.order_item.id) || 1;

      // Divide total cost by number of units scanned
      // This handles both lots (qty=1 but 3 units scanned → $30/3 = $10 each)
      // and multi-qty (qty=2, 2 units scanned → $60/2 = $30 each)
      // Now also accounts for refunds (full or partial)
      itemCost = totalCost / unitsScanned;
    }

    if (!productMap.has(categoryId)) {
      productMap.set(categoryId, {
        categoryId,
        productName: unit.category.category_name,
        gtin: unit.category.gtin,
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

    const stats = productMap.get(categoryId)!;

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
    if (!productUnits.has(categoryId)) {
      productUnits.set(categoryId, []);
    }

    productUnits.get(categoryId)!.push({
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
                    key={product.categoryId}
                    product={product}
                    units={productUnits.get(product.categoryId) || []}
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
