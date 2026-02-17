"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Category = {
  id: string;
  category_name: string;
  gtin: string | null;
  unitCount: number;
};

type Merge = {
  id: string;
  fromCategoryName: string;
  toCategoryId: string;
  createdAt: string;
};

export default function CategoryManager({
  categories,
  merges
}: {
  categories: Category[];
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

  const filteredCategories = categories.filter(c =>
    c.category_name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  async function handleMergeCategories() {
    if (!selectedFrom || !selectedTo) {
      setMessage("Please select both source and target categories");
      setMessageType("error");
      return;
    }

    if (selectedFrom === selectedTo) {
      setMessage("Source and target categories must be different");
      setMessageType("error");
      return;
    }

    const fromCategory = categories.find(c => c.id === selectedFrom);
    const toCategory = categories.find(c => c.id === selectedTo);

    if (!fromCategory || !toCategory) {
      setMessage("Invalid category selection");
      setMessageType("error");
      return;
    }

    const confirmMsg = `Merge "${fromCategory.category_name}" (${fromCategory.unitCount} units) into "${toCategory.category_name}" (${toCategory.unitCount} units)?\n\nThis will:\n- Move all ${fromCategory.unitCount} units to "${toCategory.category_name}"\n- Delete the "${fromCategory.category_name}" category\n- This action cannot be undone`;

    if (!confirm(confirmMsg)) {
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const res = await fetch("/api/admin/categories/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromCategoryId: selectedFrom,
          toCategoryId: selectedTo
        })
      });

      const data = await res.json();

      if (res.ok) {
        setMessage(`✓ Successfully merged "${fromCategory.category_name}" into "${toCategory.category_name}". ${data.unitsTransferred} units transferred.`);
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
    if (!confirm("Delete this merge mapping? Future scans will prompt for category selection again.")) {
      return;
    }

    setDeletingMerge(mergeId);
    setMessage(null);

    try {
      const res = await fetch(`/api/categories/merge/${mergeId}`, {
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

  const getCategoryName = (id: string) => {
    return categories.find(c => c.id === id)?.category_name || "Unknown";
  };

  return (
    <div className="space-y-6">
      {/* Merge Categories Section */}
      <section className="rounded-lg border border-slate-800 bg-slate-900 p-6">
        <h2 className="text-lg font-semibold">Merge Existing Categories</h2>
        <p className="text-sm text-slate-400 mt-1">
          Consolidate duplicate categories by merging all units from one category into another.
          The source category will be deleted after the merge.
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
              Source Category (will be deleted)
            </label>
            <select
              value={selectedFrom}
              onChange={(e) => setSelectedFrom(e.target.value)}
              className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-300"
            >
              <option value="">-- Select category to merge from --</option>
              {categories.map(cat => (
                <option key={cat.id} value={cat.id}>
                  {cat.category_name} ({cat.unitCount} units)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Target Category (will receive units)
            </label>
            <select
              value={selectedTo}
              onChange={(e) => setSelectedTo(e.target.value)}
              className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-300"
            >
              <option value="">-- Select category to merge into --</option>
              {categories.map(cat => (
                <option key={cat.id} value={cat.id}>
                  {cat.category_name} ({cat.unitCount} units)
                </option>
              ))}
            </select>
          </div>
        </div>

        <button
          onClick={handleMergeCategories}
          disabled={loading || !selectedFrom || !selectedTo}
          className="mt-4 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Merging..." : "Merge Categories"}
        </button>
      </section>

      {/* Category List */}
      <section className="rounded-lg border border-slate-800 bg-slate-900 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">All Categories ({categories.length})</h2>
          <input
            type="text"
            placeholder="Search categories..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="rounded border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-300 w-64"
          />
        </div>

        <div className="space-y-1 max-h-96 overflow-y-auto">
          {filteredCategories.map(cat => (
            <div
              key={cat.id}
              className="flex items-center justify-between rounded px-3 py-2 hover:bg-slate-800"
            >
              <div>
                <span className="text-sm text-slate-300">{cat.category_name}</span>
                <span className="ml-2 text-xs text-slate-500">
                  ({cat.unitCount} {cat.unitCount === 1 ? "unit" : "units"})
                </span>
              </div>
              {cat.gtin && (
                <span className="text-xs text-slate-600">GTIN: {cat.gtin}</span>
              )}
            </div>
          ))}
          {filteredCategories.length === 0 && (
            <p className="text-sm text-slate-500 text-center py-8">
              No categories found matching "{searchTerm}"
            </p>
          )}
        </div>
      </section>

      {/* Merge Mappings */}
      <section className="rounded-lg border border-slate-800 bg-slate-900 p-6">
        <h2 className="text-lg font-semibold mb-4">Category Merge Mappings ({merges.length})</h2>
        <p className="text-sm text-slate-400 mb-4">
          These mappings automatically redirect detected category names to existing categories.
        </p>

        {merges.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-8">
            No merge mappings yet. They will appear here when you merge categories during scanning.
          </p>
        ) : (
          <div className="space-y-2">
            {merges.map(merge => (
              <div
                key={merge.id}
                className="flex items-center justify-between rounded border border-slate-800 bg-slate-950 px-4 py-2"
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm text-slate-400">"{merge.fromCategoryName}"</span>
                  <span className="text-slate-600">→</span>
                  <span className="text-sm text-slate-300">{getCategoryName(merge.toCategoryId)}</span>
                  <span className="text-xs text-slate-600">
                    {new Date(merge.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <button
                  onClick={() => handleDeleteMerge(merge.id)}
                  disabled={deletingMerge === merge.id}
                  className="rounded border border-red-800 px-2 py-1 text-xs text-red-400 hover:bg-red-900 disabled:opacity-50"
                >
                  {deletingMerge === merge.id ? "..." : "Delete"}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
