"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Product = {
  id: string;
  product_name: string;
  gtin: string | null;
  unitCount: number;
};

type DuplicateGroup = {
  normalizedName: string;
  products: Product[];
};

type Merge = {
  id: string;
  fromProductName: string;
  toProductId: string;
  createdAt: string;
};

export default function ProductManager({
  allProducts,
  duplicates,
  uniqueProducts,
  merges
}: {
  allProducts: Product[];
  duplicates: DuplicateGroup[];
  uniqueProducts: Product[];
  merges: Merge[];
}) {
  const router = useRouter();
  const [selectedFrom, setSelectedFrom] = useState<string>("");
  const [selectedTo, setSelectedTo] = useState<string>("");
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<"success" | "error">("success");
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [deletingMerge, setDeletingMerge] = useState<string | null>(null);
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);
  const [showAddMapping, setShowAddMapping] = useState(false);
  const [newMappingFrom, setNewMappingFrom] = useState("");
  const [newMappingTo, setNewMappingTo] = useState("");
  const [savingMapping, setSavingMapping] = useState(false);
  const [editingMerge, setEditingMerge] = useState<string | null>(null);
  const [editMappingTo, setEditMappingTo] = useState("");
  const [productUnits, setProductUnits] = useState<Record<string, {
    id: string; orderId: string; unitIndex: number; title: string;
    condition: string; state: string; receivedAt: string;
  }[]>>({});
  const [loadingUnits, setLoadingUnits] = useState<string | null>(null);

  async function toggleProduct(productId: string) {
    if (expandedProduct === productId) {
      setExpandedProduct(null);
      return;
    }
    setExpandedProduct(productId);
    if (productUnits[productId]) return; // already loaded

    setLoadingUnits(productId);
    try {
      const res = await fetch(`/api/products/units?productId=${productId}`);
      const data = await res.json();
      setProductUnits(prev => ({ ...prev, [productId]: data }));
    } catch {
      setProductUnits(prev => ({ ...prev, [productId]: [] }));
    } finally {
      setLoadingUnits(null);
    }
  }

  function formatState(state: string) {
    switch (state) {
      case "on_hand": return "On Hand";
      case "to_be_returned": return "To Return";
      case "parts_repair": return "Parts/Repair";
      case "returned": return "Returned";
      default: return state;
    }
  }

  function stateColor(state: string) {
    switch (state) {
      case "on_hand": return "text-green-400";
      case "to_be_returned": return "text-yellow-400";
      case "parts_repair": return "text-red-400";
      case "returned": return "text-slate-500";
      default: return "text-slate-400";
    }
  }

  const filteredProducts = allProducts.filter(c =>
    c.product_name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredDuplicates = duplicates.filter(d =>
    d.normalizedName.includes(searchTerm.toLowerCase())
  );

  const getProductName = (id: string) => {
    return allProducts.find(c => c.id === id)?.product_name || "Unknown";
  };

  async function handleMergeProducts() {
    if (!selectedFrom || !selectedTo) {
      setMessage("Please select both source and target products");
      setMessageType("error");
      return;
    }

    if (selectedFrom === selectedTo) {
      setMessage("Source and target products must be different");
      setMessageType("error");
      return;
    }

    const fromProduct = allProducts.find(c => c.id === selectedFrom);
    const toProduct = allProducts.find(c => c.id === selectedTo);

    if (!fromProduct || !toProduct) {
      setMessage("Invalid product selection");
      setMessageType("error");
      return;
    }

    const confirmMsg = `Merge "${fromProduct.product_name}" (${fromProduct.unitCount} units) into "${toProduct.product_name}" (${toProduct.unitCount} units)?\n\nThis will:\n- Move all ${fromProduct.unitCount} units to "${toProduct.product_name}"\n- Delete the "${fromProduct.product_name}" product\n- This action cannot be undone`;

    if (!confirm(confirmMsg)) {
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const res = await fetch("/api/admin/products/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromProductId: selectedFrom,
          toProductId: selectedTo
        })
      });

      const data = await res.json();

      if (res.ok) {
        setMessage(`✓ Successfully merged "${fromProduct.product_name}" into "${toProduct.product_name}". ${data.unitsTransferred} units transferred.`);
        setMessageType("success");
        setSelectedFrom("");
        setSelectedTo("");
        router.refresh();
      } else {
        setMessage(`Error: ${data.error}`);
        setMessageType("error");
      }
    } catch (err) {
      setMessage("Network error. Please try again.");
      setMessageType("error");
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteMerge(mergeId: string) {
    if (!confirm("Delete this merge mapping? Future scans will prompt for product selection again.")) {
      return;
    }

    setDeletingMerge(mergeId);
    setMessage(null);

    try {
      const res = await fetch(`/api/products/merge/${mergeId}`, {
        method: "DELETE"
      });

      if (res.ok) {
        setMessage("✓ Merge mapping deleted");
        setMessageType("success");
        router.refresh();
      } else {
        const data = await res.json();
        setMessage(`Error: ${data.error}`);
        setMessageType("error");
      }
    } catch {
      setMessage("Network error. Please try again.");
      setMessageType("error");
    } finally {
      setDeletingMerge(null);
    }
  }

  async function handleAddMapping() {
    if (!newMappingFrom.trim() || !newMappingTo) {
      setMessage("Please enter a product name and select a target product");
      setMessageType("error");
      return;
    }

    setSavingMapping(true);
    setMessage(null);

    try {
      const res = await fetch("/api/products/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromProductName: newMappingFrom.trim(),
          toProductId: newMappingTo
        })
      });

      const data = await res.json();

      if (res.ok) {
        setMessage(`Mapping added: "${newMappingFrom.trim()}" → "${getProductName(newMappingTo)}"`);
        setMessageType("success");
        setNewMappingFrom("");
        setNewMappingTo("");
        setShowAddMapping(false);
        router.refresh();
      } else {
        setMessage(`Error: ${data.error}`);
        setMessageType("error");
      }
    } catch {
      setMessage("Network error. Please try again.");
      setMessageType("error");
    } finally {
      setSavingMapping(false);
    }
  }

  async function handleEditMapping(mergeId: string, fromProductName: string) {
    if (!editMappingTo) {
      setMessage("Please select a target product");
      setMessageType("error");
      return;
    }

    setSavingMapping(true);
    setMessage(null);

    try {
      const res = await fetch("/api/products/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromProductName,
          toProductId: editMappingTo
        })
      });

      const data = await res.json();

      if (res.ok) {
        setMessage(`Mapping updated: "${fromProductName}" → "${getProductName(editMappingTo)}"`);
        setMessageType("success");
        setEditingMerge(null);
        setEditMappingTo("");
        router.refresh();
      } else {
        setMessage(`Error: ${data.error}`);
        setMessageType("error");
      }
    } catch {
      setMessage("Network error. Please try again.");
      setMessageType("error");
    } finally {
      setSavingMapping(false);
    }
  }

  async function handleQuickMerge(duplicateGroup: DuplicateGroup) {
    // Find the product with the most units as the target
    const sorted = [...duplicateGroup.products].sort((a, b) => b.unitCount - a.unitCount);
    const target = sorted[0];
    const sources = sorted.slice(1);

    if (sources.length === 0) return;

    const confirmMsg = `Quick merge all duplicates of "${duplicateGroup.normalizedName}"?\n\n` +
      `Target (keep): "${target.product_name}" (${target.unitCount} units)\n\n` +
      `Will merge and delete:\n` +
      sources.map(s => `  - "${s.product_name}" (${s.unitCount} units)`).join('\n') +
      `\n\nTotal units after merge: ${sorted.reduce((sum, c) => sum + c.unitCount, 0)}\n\n` +
      `IMPORTANT: Merge mappings will be created so these product names\n` +
      `automatically map to "${target.product_name}" in future scans.`;

    if (!confirm(confirmMsg)) return;

    setLoading(true);
    setMessage(null);

    try {
      let totalTransferred = 0;

      for (const source of sources) {
        const res = await fetch("/api/admin/products/merge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fromProductId: source.id,
            toProductId: target.id
          })
        });

        const data = await res.json();
        if (!res.ok) {
          setMessage(`Error merging "${source.product_name}": ${data.error}`);
          setMessageType("error");
          setLoading(false);
          return;
        }
        totalTransferred += data.unitsTransferred;
      }

      const totalAliases = sources.reduce((sum, s, idx) => {
        // We don't have the individual aliasesPreserved counts here, but we know at minimum
        // one alias was created per source product
        return sum + 1;
      }, 0);

      setMessage(`✓ Successfully merged ${sources.length} duplicate products into "${target.product_name}". ${totalTransferred} units transferred. ${totalAliases} aliases preserved for future auto-detection.`);
      setMessageType("success");
      router.refresh();
    } catch {
      setMessage("Network error. Please try again.");
      setMessageType("error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Duplicate Products - Show First */}
      {duplicates.length > 0 && (
        <section className="rounded-lg border border-yellow-800 bg-yellow-900/20 p-6">
          <h2 className="text-lg font-semibold text-yellow-400">⚠️ Duplicate Products Found ({duplicates.length} groups)</h2>
          <p className="text-sm text-yellow-300/80 mt-1">
            These products have exact duplicates (case-insensitive). Click "Quick Merge" to automatically merge all duplicates into the product with the most units.
          </p>

          <div className="mt-4 space-y-3">
            {filteredDuplicates.map((group, idx) => {
              const sorted = [...group.products].sort((a, b) => b.unitCount - a.unitCount);
              const target = sorted[0];
              const totalUnits = sorted.reduce((sum, c) => sum + c.unitCount, 0);

              return (
                <div key={idx} className="rounded-lg border border-yellow-700 bg-yellow-900/30 p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-yellow-200 mb-2">
                        "{group.normalizedName}" - {group.products.length} duplicates, {totalUnits} total units
                      </p>
                      <div className="space-y-1">
                        {sorted.map((cat, i) => (
                          <div key={cat.id} className="flex items-center gap-2 text-xs">
                            {i === 0 && (
                              <span className="rounded bg-green-900 px-1.5 py-0.5 text-green-300 text-[10px] font-medium">
                                KEEP
                              </span>
                            )}
                            {i > 0 && (
                              <span className="rounded bg-red-900 px-1.5 py-0.5 text-red-300 text-[10px] font-medium">
                                DELETE
                              </span>
                            )}
                            <span className="text-yellow-100">"{cat.product_name}"</span>
                            <span className="text-yellow-400">({cat.unitCount} units)</span>
                            {cat.gtin && <span className="text-yellow-600 text-[10px]">GTIN: {cat.gtin}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                    <button
                      onClick={() => handleQuickMerge(group)}
                      disabled={loading}
                      className="ml-4 rounded bg-yellow-600 hover:bg-yellow-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                    >
                      Quick Merge
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Merge Products Section */}
      <section className="rounded-lg border border-slate-800 bg-slate-900 p-6">
        <h2 className="text-lg font-semibold">Merge Existing Products</h2>
        <p className="text-sm text-slate-400 mt-1">
          Consolidate duplicate products by merging all units from one product into another.
          The source product will be deleted after the merge.
        </p>

        {message && (
          <div className={`mt-4 rounded-lg border p-3 ${
            messageType === "success"
              ? "border-green-800 bg-green-900/30 text-green-300"
              : "border-red-800 bg-red-900/30 text-red-300"
          }`}>
            {message}
          </div>
        )}

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Source Product (will be deleted)
            </label>
            <select
              value={selectedFrom}
              onChange={(e) => setSelectedFrom(e.target.value)}
              className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-300"
            >
              <option value="">-- Select product to merge from --</option>
              {allProducts.map(cat => (
                <option key={cat.id} value={cat.id}>
                  {cat.product_name} ({cat.unitCount} units)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Target Product (will receive units)
            </label>
            <select
              value={selectedTo}
              onChange={(e) => setSelectedTo(e.target.value)}
              className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-300"
            >
              <option value="">-- Select product to merge into --</option>
              {allProducts.map(cat => (
                <option key={cat.id} value={cat.id}>
                  {cat.product_name} ({cat.unitCount} units)
                </option>
              ))}
            </select>
          </div>
        </div>

        <button
          onClick={handleMergeProducts}
          disabled={loading || !selectedFrom || !selectedTo}
          className="mt-4 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Merging..." : "Merge Products"}
        </button>
      </section>

      {/* Product List */}
      <section className="rounded-lg border border-slate-800 bg-slate-900 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">All Products ({allProducts.length})</h2>
          <input
            type="text"
            placeholder="Search products..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="rounded border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-300 w-64"
          />
        </div>

        <div className="space-y-1 max-h-[600px] overflow-y-auto">
          {filteredProducts.map(cat => (
            <div key={cat.id}>
              <div
                className="flex items-center justify-between rounded px-3 py-2 hover:bg-slate-800 cursor-pointer"
                onClick={() => toggleProduct(cat.id)}
              >
                <div className="flex items-center gap-2">
                  <svg
                    className={`w-3 h-3 text-slate-500 transition-transform flex-shrink-0 ${expandedProduct === cat.id ? "rotate-90" : ""}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  <span className="text-sm text-slate-300">{cat.product_name}</span>
                  <span className="text-xs text-slate-500">
                    ({cat.unitCount} {cat.unitCount === 1 ? "unit" : "units"})
                  </span>
                </div>
                {cat.gtin && (
                  <span className="text-xs text-slate-600">GTIN: {cat.gtin}</span>
                )}
              </div>

              {expandedProduct === cat.id && (
                <div className="ml-6 mb-2 rounded border border-slate-700 bg-slate-950">
                  {loadingUnits === cat.id ? (
                    <p className="px-3 py-3 text-xs text-slate-500">Loading...</p>
                  ) : (productUnits[cat.id] ?? []).length === 0 ? (
                    <p className="px-3 py-3 text-xs text-slate-500">No units found.</p>
                  ) : (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-700 text-left text-slate-500">
                          <th className="px-3 py-2">Title</th>
                          <th className="px-3 py-2">Order</th>
                          <th className="px-3 py-2">Condition</th>
                          <th className="px-3 py-2">State</th>
                          <th className="px-3 py-2">Received</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {(productUnits[cat.id] ?? []).map(unit => (
                          <tr key={unit.id} className="hover:bg-slate-900">
                            <td className="px-3 py-2 text-slate-300 max-w-xs truncate" title={unit.title}>
                              {unit.title}
                            </td>
                            <td className="px-3 py-2 font-mono text-slate-400">{unit.orderId}</td>
                            <td className="px-3 py-2 text-slate-400 capitalize">{unit.condition}</td>
                            <td className={`px-3 py-2 font-medium ${stateColor(unit.state)}`}>
                              {formatState(unit.state)}
                            </td>
                            <td className="px-3 py-2 text-slate-500">
                              {new Date(unit.receivedAt).toLocaleDateString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          ))}
          {filteredProducts.length === 0 && (
            <p className="text-sm text-slate-500 text-center py-8">
              No products found matching "{searchTerm}"
            </p>
          )}
        </div>
      </section>

      {/* Merge Mappings */}
      <section className="rounded-lg border border-slate-800 bg-slate-900 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">Product Merge Mappings ({merges.length})</h2>
            <p className="text-sm text-slate-400 mt-1">
              These mappings automatically redirect detected product names to existing products.
            </p>
          </div>
          <button
            onClick={() => { setShowAddMapping(!showAddMapping); setEditingMerge(null); }}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
          >
            {showAddMapping ? "Cancel" : "Add Mapping"}
          </button>
        </div>

        {showAddMapping && (
          <div className="mb-4 rounded border border-blue-800 bg-blue-900/20 p-4">
            <h3 className="text-sm font-medium text-blue-300 mb-3">New Product Mapping</h3>
            <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr_auto] items-end">
              <div>
                <label className="block text-xs text-slate-400 mb-1">From Product Name</label>
                <input
                  type="text"
                  value={newMappingFrom}
                  onChange={(e) => setNewMappingFrom(e.target.value)}
                  placeholder="e.g. TI-84 Plus CE Calculator"
                  className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-300"
                />
              </div>
              <span className="text-slate-600 pb-2 hidden md:block">→</span>
              <div>
                <label className="block text-xs text-slate-400 mb-1">To Product</label>
                <select
                  value={newMappingTo}
                  onChange={(e) => setNewMappingTo(e.target.value)}
                  className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-300"
                >
                  <option value="">-- Select target product --</option>
                  {allProducts.map(cat => (
                    <option key={cat.id} value={cat.id}>
                      {cat.product_name} ({cat.unitCount} units)
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={handleAddMapping}
                disabled={savingMapping || !newMappingFrom.trim() || !newMappingTo}
                className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {savingMapping ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        )}

        {merges.length === 0 && !showAddMapping ? (
          <p className="text-sm text-slate-500 text-center py-8">
            No merge mappings yet. Click "Add Mapping" to create one, or they will appear here when you merge products.
          </p>
        ) : (
          <div className="space-y-2">
            {merges.map(merge => (
              <div
                key={merge.id}
                className="rounded border border-slate-800 bg-slate-950 px-4 py-2"
              >
                {editingMerge === merge.id ? (
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-sm text-slate-400">"{merge.fromProductName}"</span>
                    <span className="text-slate-600">→</span>
                    <select
                      value={editMappingTo}
                      onChange={(e) => setEditMappingTo(e.target.value)}
                      className="flex-1 min-w-[200px] rounded border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-300"
                    >
                      <option value="">-- Select target product --</option>
                      {allProducts.map(cat => (
                        <option key={cat.id} value={cat.id}>
                          {cat.product_name} ({cat.unitCount} units)
                        </option>
                      ))}
                    </select>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleEditMapping(merge.id, merge.fromProductName)}
                        disabled={savingMapping || !editMappingTo}
                        className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                      >
                        {savingMapping ? "..." : "Save"}
                      </button>
                      <button
                        onClick={() => { setEditingMerge(null); setEditMappingTo(""); }}
                        className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-400 hover:bg-slate-800"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-slate-400">"{merge.fromProductName}"</span>
                      <span className="text-slate-600">→</span>
                      <span className="text-sm text-slate-300">{getProductName(merge.toProductId)}</span>
                      <span className="text-xs text-slate-600">
                        {new Date(merge.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setEditingMerge(merge.id);
                          setEditMappingTo(merge.toProductId);
                          setShowAddMapping(false);
                        }}
                        className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:bg-slate-800"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteMerge(merge.id)}
                        disabled={deletingMerge === merge.id}
                        className="rounded border border-red-800 px-2 py-1 text-xs text-red-400 hover:bg-red-900 disabled:opacity-50"
                      >
                        {deletingMerge === merge.id ? "..." : "Delete"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
