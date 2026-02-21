"use client";

import { useState, useEffect, useCallback } from "react";
import ImageUploadPanel from "@/components/image-upload-panel";

const CONDITIONS = [
  { value: "good",              label: "Good" },
  { value: "new",               label: "New / Sealed" },
  { value: "like_new",          label: "Like New" },
  { value: "acceptable",        label: "Acceptable" },
  { value: "pressure mark",     label: "Pressure Mark" },
  { value: "damaged",           label: "Damaged" },
  { value: "wrong_item",        label: "Wrong Item" },
  { value: "missing_parts",     label: "Missing Parts" },
  { value: "defective",         label: "Defective" },
  { value: "dim power/ glitchy",label: "Dim Power / Glitchy" },
  { value: "no power",          label: "No Power" },
  { value: "cracked screen",    label: "Cracked Screen" },
  { value: "water damage",      label: "Water Damage" },
  { value: "parts only",        label: "Parts Only" },
];

const GOOD_CONDITIONS = new Set(["good", "new", "like_new", "acceptable", "excellent"]);

type Category = { id: string; category_name: string };

type ScanResult = {
  orderId: string;
  unitIndex: number;
  unitId: string;
  scanStatus: string;
  isLot: boolean;
  condition: string;
  categoryInfo: {
    categoryId: string | null;
    confidence: "high" | "medium" | "low";
    requiresManualSelection: boolean;
    reason?: string;
    suggestedCategoryName?: string;
  };
  item: { title: string; itemId: string; qty: number };
};

type Props = {
  orderId: string;
  trackingNumber: string | null;
  itemTitle: string;
  onClose: () => void;
  onSuccess: () => void;
};

type Step = "form" | "photos" | "category" | "done";

export default function CheckInModal({ orderId, trackingNumber, itemTitle, onClose, onSuccess }: Props) {
  const [condition, setCondition] = useState("good");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("form");

  // Photo step
  const [photoUnit, setPhotoUnit] = useState<{ unitId: string; unitIndex: number; title: string } | null>(null);

  // Category step
  const [pendingCategory, setPendingCategory] = useState<{
    unitId: string;
    unitIndex: number;
    title: string;
    reason: string;
    suggestedCategoryName?: string;
  } | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [editedCategoryName, setEditedCategoryName] = useState("");
  const [createMerge, setCreateMerge] = useState(true);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [categoryLoading, setCategoryLoading] = useState(false);

  const loadCategories = useCallback(async () => {
    setCategoryLoading(true);
    try {
      const res = await fetch("/api/categories");
      if (res.ok) {
        const data = await res.json();
        setCategories(data.categories ?? []);
      }
    } finally {
      setCategoryLoading(false);
    }
  }, []);

  async function submit() {
    if (!trackingNumber) {
      setError("No tracking number available for this shipment.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/receiving/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tracking: trackingNumber, condition_status: condition, notes: notes.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Scan failed");
        return;
      }
      if (data.resolution === "UNRESOLVED") {
        setError(`Tracking number not matched: ${data.message}`);
        return;
      }

      const result: ScanResult = data.results?.[0];
      if (!result) {
        setError("No result returned from scan");
        return;
      }

      const isBadCondition = !GOOD_CONDITIONS.has(condition);

      if (result.categoryInfo?.requiresManualSelection) {
        setPendingCategory({
          unitId: result.unitId,
          unitIndex: result.unitIndex,
          title: result.item.title,
          reason: result.categoryInfo.reason ?? "Manual selection required",
          suggestedCategoryName: result.categoryInfo.suggestedCategoryName,
        });
        setEditedCategoryName(result.categoryInfo.suggestedCategoryName ?? "");
        setCreateMerge(true);
        loadCategories();
        setStep("category");
      } else if (isBadCondition) {
        setPhotoUnit({ unitId: result.unitId, unitIndex: result.unitIndex, title: result.item.title });
        setStep("photos");
      } else {
        setStep("done");
        onSuccess();
      }
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  }

  async function handleCategoryAssign(categoryId: string | null, suggestedName?: string, shouldMerge?: boolean) {
    if (!pendingCategory) return;
    setCategoryLoading(true);
    try {
      if (categoryId && suggestedName && shouldMerge) {
        await fetch("/api/categories/merge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fromCategoryName: suggestedName, toCategoryId: categoryId }),
        });
      }
      await fetch(`/api/receiving/unit/${pendingCategory.unitId}/category`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId }),
      });

      const isBadCondition = !GOOD_CONDITIONS.has(condition);
      if (isBadCondition) {
        setPhotoUnit({ unitId: pendingCategory.unitId, unitIndex: pendingCategory.unitIndex, title: pendingCategory.title });
        setStep("photos");
      } else {
        setStep("done");
        onSuccess();
      }
    } finally {
      setCategoryLoading(false);
    }
  }

  async function handleCreateNewCategory(name: string) {
    if (!pendingCategory) return;
    setCategoryLoading(true);
    try {
      const createRes = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (createRes.ok) {
        const data = await createRes.json();
        await handleCategoryAssign(data.category?.id, undefined, false);
      }
    } finally {
      setCategoryLoading(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (step === "photos" && photoUnit) {
    return (
      <ImageUploadPanel
        receivedUnitId={photoUnit.unitId}
        unitTitle={photoUnit.title}
        unitIndex={photoUnit.unitIndex}
        onClose={() => { onSuccess(); }}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <div>
            <h3 className="text-sm font-semibold text-slate-200">
              {step === "category" ? "Select Category" : "Check In"}
            </h3>
            <p className="text-xs text-slate-500 truncate max-w-[280px]" title={itemTitle}>
              {orderId} · {itemTitle}
            </p>
          </div>
          <button onClick={onClose} className="rounded border border-slate-700 px-2.5 py-1 text-xs text-slate-400 hover:bg-slate-800">
            Cancel
          </button>
        </div>

        {/* ── Form step ── */}
        {step === "form" && (
          <div className="p-5 space-y-4">
            {!trackingNumber && (
              <div className="rounded-lg bg-yellow-900/30 border border-yellow-700 p-3 text-xs text-yellow-300">
                No tracking number on record for this shipment.
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-400">Condition</label>
              <select
                value={condition}
                onChange={e => setCondition(e.target.value)}
                className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-600"
              >
                {CONDITIONS.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-400">Notes (optional)</label>
              <input
                type="text"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="e.g. cracked corner, missing cable"
                className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-600"
                onKeyDown={e => { if (e.key === "Enter") submit(); }}
              />
            </div>

            {error && (
              <div className="rounded-lg bg-red-900/30 border border-red-700 p-3 text-sm text-red-300">
                {error}
              </div>
            )}

            <button
              onClick={submit}
              disabled={loading || !trackingNumber}
              className="w-full rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 py-2.5 text-sm font-semibold text-white transition-colors"
            >
              {loading ? "Checking in…" : "Check In"}
            </button>
          </div>
        )}

        {/* ── Category step ── */}
        {step === "category" && pendingCategory && (
          <div className="p-5 space-y-4">
            <div className="rounded-lg bg-slate-800 border border-slate-700 p-3 text-xs text-slate-400">
              <span className="text-slate-500">Reason: </span>{pendingCategory.reason}
            </div>

            {pendingCategory.suggestedCategoryName && (
              <div className="text-xs text-slate-400">
                System detected: <span className="font-semibold text-blue-300">{pendingCategory.suggestedCategoryName}</span>
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-400">Category name</label>
              <input
                type="text"
                value={editedCategoryName}
                onChange={e => setEditedCategoryName(e.target.value)}
                className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-600"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => handleCreateNewCategory(editedCategoryName.trim() || pendingCategory.suggestedCategoryName || "")}
                disabled={categoryLoading || !editedCategoryName.trim()}
                className="flex-1 rounded-lg bg-blue-700 hover:bg-blue-600 disabled:opacity-50 py-2 text-xs font-semibold text-white transition-colors"
              >
                Create New Category
              </button>
            </div>

            <div className="border-t border-slate-800 pt-4">
              <label className="mb-1.5 block text-xs font-medium text-slate-400">
                Or assign to existing category
              </label>
              {categoryLoading ? (
                <p className="text-xs text-slate-600 animate-pulse">Loading categories…</p>
              ) : (
                <>
                  <select
                    value={selectedCategoryId}
                    onChange={e => setSelectedCategoryId(e.target.value)}
                    className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-600"
                  >
                    <option value="">— pick a category —</option>
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>{c.category_name}</option>
                    ))}
                  </select>

                  {selectedCategoryId && pendingCategory.suggestedCategoryName && (
                    <label className="mt-2 flex items-start gap-2 text-xs text-slate-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={createMerge}
                        onChange={e => setCreateMerge(e.target.checked)}
                        className="mt-0.5 accent-blue-500"
                      />
                      <span>
                        Auto-map &ldquo;{pendingCategory.suggestedCategoryName}&rdquo; to this category in future scans
                      </span>
                    </label>
                  )}

                  <button
                    onClick={() => handleCategoryAssign(selectedCategoryId || null, pendingCategory.suggestedCategoryName, createMerge)}
                    disabled={categoryLoading || !selectedCategoryId}
                    className="mt-3 w-full rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-50 py-2 text-xs font-semibold text-slate-200 transition-colors"
                  >
                    Assign to Selected
                  </button>
                </>
              )}
            </div>

            <button
              onClick={() => { const isBad = !GOOD_CONDITIONS.has(condition); if (isBad && pendingCategory) { setPhotoUnit({ unitId: pendingCategory.unitId, unitIndex: pendingCategory.unitIndex, title: pendingCategory.title }); setStep("photos"); } else { onSuccess(); } }}
              className="w-full text-xs text-slate-600 hover:text-slate-400 py-1"
            >
              Skip category for now
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
