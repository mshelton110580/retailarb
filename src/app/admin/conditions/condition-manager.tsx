"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const BUILTIN_CONDITIONS = ["good"];

type Condition = {
  name: string;
  unitCount: number;
  isBuiltin: boolean;
};

export default function ConditionManager({ conditions }: { conditions: Condition[] }) {
  const router = useRouter();
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [deletingName, setDeletingName] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [search, setSearch] = useState("");

  const filtered = conditions.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  async function handleAdd() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setAdding(true);
    setAddError(null);
    try {
      // Conditions are derived from received_units — "adding" a builtin is a no-op,
      // but custom ones only appear once a unit uses them. We surface a message here
      // explaining that; the real add path is via scan/receiving/units pages.
      const duplicate = conditions.some(c => c.name.toLowerCase() === trimmed.toLowerCase());
      if (duplicate) {
        setAddError("A condition with that name already exists.");
        return;
      }
      // Conditions don't live in their own table — they're derived from received_units.
      // Adding here just adds it to the BUILTIN list client-side; persisting custom
      // additions requires going through unit assignment. Show informational message.
      setAddError("Conditions are created automatically when assigned to a unit. Assign this condition to a unit via the Units page to create it.");
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(condition: Condition) {
    if (condition.isBuiltin) return;
    if (condition.unitCount > 0) return; // Button should be disabled, but guard anyway

    if (!confirm(`Delete condition "${condition.name}"? It has no units and will be removed from the list.`)) return;

    setDeletingName(condition.name);
    setMessage(null);
    try {
      const res = await fetch("/api/units/conditions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ condition: condition.name })
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: `"${condition.name}" removed from the conditions list.` });
        router.refresh();
      } else {
        setMessage({ type: "error", text: data.error ?? "Delete failed." });
      }
    } catch {
      setMessage({ type: "error", text: "Network error." });
    } finally {
      setDeletingName(null);
    }
  }

  const [recomputing, setRecomputing] = useState(false);
  const [recomputeResult, setRecomputeResult] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  async function handleRecompute() {
    if (!confirm(
      "Recompute inventory states for all units?\n\n" +
      "This will:\n" +
      "• Re-evaluate every return against its units\n" +
      "• Reset good-condition units in completed returns back to On Hand\n" +
      "• Move bad-condition units with no return to To Return\n\n" +
      "This cannot be undone."
    )) return;

    setRecomputing(true);
    setRecomputeResult(null);
    try {
      const res = await fetch("/api/admin/recompute-states", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setRecomputeResult({
          type: "success",
          text: `Done. ${data.total} unit${data.total !== 1 ? "s" : ""} updated ` +
                `(${data.returnPass} from returns, ${data.orphanPass} bad-condition orphans).`
        });
      } else {
        setRecomputeResult({ type: "error", text: data.error ?? "Recompute failed." });
      }
    } catch {
      setRecomputeResult({ type: "error", text: "Network error." });
    } finally {
      setRecomputing(false);
    }
  }

  const builtinCount = conditions.filter(c => c.isBuiltin).length;
  const customCount = conditions.filter(c => !c.isBuiltin).length;

  return (
    <div className="space-y-6">
      {message && (
        <div className={`rounded-lg border p-3 text-sm ${
          message.type === "success"
            ? "border-green-800 bg-green-900/30 text-green-300"
            : "border-red-800 bg-red-900/30 text-red-300"
        }`}>
          {message.text}
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-slate-700 bg-slate-900 p-4">
          <p className="text-xs text-slate-400">Total Conditions</p>
          <p className="text-2xl font-semibold mt-1">{conditions.length}</p>
        </div>
        <div className="rounded-lg border border-slate-700 bg-slate-900 p-4">
          <p className="text-xs text-slate-400">Built-in</p>
          <p className="text-2xl font-semibold mt-1 text-slate-400">{builtinCount}</p>
        </div>
        <div className="rounded-lg border border-slate-700 bg-slate-900 p-4">
          <p className="text-xs text-slate-400">Custom</p>
          <p className="text-2xl font-semibold mt-1 text-blue-400">{customCount}</p>
        </div>
      </div>

      {/* Conditions List */}
      <section className="rounded-lg border border-slate-800 bg-slate-900 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">All Conditions</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Built-in conditions cannot be deleted. Custom conditions can only be deleted when no units use them.
            </p>
          </div>
          <input
            type="text"
            placeholder="Search conditions..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="rounded border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-300 w-56"
          />
        </div>

        <div className="space-y-1">
          {filtered.map(c => (
            <div key={c.name}
              className="flex items-center justify-between rounded px-3 py-2 hover:bg-slate-800"
            >
              <div className="flex items-center gap-3">
                <span className="text-sm text-slate-300 capitalize">{c.name}</span>
                <span className="text-xs text-slate-500">
                  {c.unitCount} {c.unitCount === 1 ? "unit" : "units"}
                </span>
                {c.isBuiltin && (
                  <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
                    BUILT-IN
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {!c.isBuiltin && c.unitCount > 0 && (
                  <span className="text-xs text-slate-600 italic">
                    reassign units to delete
                  </span>
                )}
                {!c.isBuiltin && (
                  <button
                    onClick={() => handleDelete(c)}
                    disabled={c.unitCount > 0 || deletingName === c.name}
                    title={c.unitCount > 0 ? `${c.unitCount} unit(s) still use this condition` : "Delete condition"}
                    className="rounded border border-red-800 px-2 py-1 text-xs text-red-400 hover:bg-red-900/40 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    {deletingName === c.name ? "..." : "Delete"}
                  </button>
                )}
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="text-sm text-slate-500 text-center py-8">
              No conditions found{search ? ` matching "${search}"` : ""}.
            </p>
          )}
        </div>
      </section>

      {/* Info about adding */}
      <section className="rounded-lg border border-slate-700 bg-slate-800/40 p-5">
        <h2 className="text-sm font-semibold text-slate-300 mb-1">Adding Custom Conditions</h2>
        <p className="text-xs text-slate-400">
          Custom conditions are created automatically when assigned to a unit during receiving or on the Units page.
          They appear here once at least one unit uses them. To retire a custom condition, reassign all units
          using it to a different condition — it will then become deletable.
        </p>
      </section>

      {/* Recompute Inventory States */}
      <section className="rounded-lg border border-amber-800/50 bg-amber-900/10 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-amber-300 mb-1">Recompute Inventory States</h2>
            <p className="text-xs text-slate-400 max-w-xl">
              Re-evaluates every unit&apos;s inventory state against current return data and condition.
              Good-condition units in completed returns are reset to <span className="text-slate-300">On Hand</span>.
              Bad-condition units with no return are moved to <span className="text-slate-300">To Return</span>.
              Run this after bulk condition changes or if states look incorrect.
            </p>
            {recomputeResult && (
              <div className={`mt-2 rounded px-3 py-2 text-xs ${
                recomputeResult.type === "success"
                  ? "bg-green-900/30 border border-green-800 text-green-300"
                  : "bg-red-900/30 border border-red-800 text-red-300"
              }`}>
                {recomputeResult.text}
              </div>
            )}
          </div>
          <button
            onClick={handleRecompute}
            disabled={recomputing}
            className="shrink-0 rounded border border-amber-700 bg-amber-900/30 px-4 py-2 text-sm font-medium text-amber-300 hover:bg-amber-900/60 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {recomputing ? "Recomputing…" : "Recompute States"}
          </button>
        </div>
      </section>
    </div>
  );
}
