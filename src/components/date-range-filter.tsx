"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback, useMemo } from "react";

type PresetDays = 30 | 60 | 90 | "all";

/**
 * Compute the ISO date string (YYYY-MM-DD) for N days ago from today.
 */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Parse the current date range from URL search params.
 * Defaults to 90 days if nothing is set.
 */
function parseDateRange(params: URLSearchParams): {
  from: string;
  to: string;
  activePreset: PresetDays | "custom" | null;
} {
  const range = params.get("range");
  const fromParam = params.get("from");
  const toParam = params.get("to");

  // If "All Time" is selected
  if (range === "all") {
    return { from: "2000-01-01", to: todayStr(), activePreset: "all" };
  }

  // If a preset range is specified
  if (range === "30" || range === "60" || range === "90") {
    const days = Number(range) as 30 | 60 | 90;
    return { from: daysAgo(days), to: todayStr(), activePreset: days };
  }

  // If custom dates are specified
  if (fromParam && toParam) {
    return { from: fromParam, to: toParam, activePreset: "custom" };
  }

  // Default: 90 days
  return { from: daysAgo(90), to: todayStr(), activePreset: 90 };
}

export default function DateRangeFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const { from, to, activePreset } = useMemo(
    () => parseDateRange(searchParams),
    [searchParams]
  );

  const updateParams = useCallback(
    (updates: Record<string, string>, remove?: string[]) => {
      const params = new URLSearchParams(searchParams.toString());
      // Remove specified keys
      if (remove) {
        for (const key of remove) params.delete(key);
      }
      // Set new values
      for (const [key, val] of Object.entries(updates)) {
        params.set(key, val);
      }
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams]
  );

  const selectPreset = useCallback(
    (days: PresetDays) => {
      updateParams({ range: String(days) }, ["from", "to"]);
    },
    [updateParams]
  );

  const applyCustom = useCallback(
    (newFrom: string, newTo: string) => {
      updateParams({ from: newFrom, to: newTo }, ["range"]);
    },
    [updateParams]
  );

  const presets: PresetDays[] = [30, 60, 90, "all"];

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {/* Preset buttons */}
      {presets.map((days) => (
        <button
          key={days}
          onClick={() => selectPreset(days)}
          className={`rounded px-3 py-1.5 font-medium transition-colors ${
            activePreset === days
              ? "bg-blue-600 text-white"
              : "bg-slate-800 text-slate-300 hover:bg-slate-700"
          }`}
        >
          {days === "all" ? "All Time" : `${days}d`}
        </button>
      ))}

      {/* Separator */}
      <span className="text-slate-600">|</span>

      {/* Custom date inputs */}
      <div className="flex items-center gap-1.5">
        <input
          type="date"
          value={from}
          onChange={(e) => applyCustom(e.target.value, to)}
          className="rounded bg-slate-800 px-2 py-1.5 text-xs text-slate-300 border border-slate-700 focus:border-blue-500 focus:outline-none"
        />
        <span className="text-slate-500">to</span>
        <input
          type="date"
          value={to}
          onChange={(e) => applyCustom(from, e.target.value)}
          className="rounded bg-slate-800 px-2 py-1.5 text-xs text-slate-300 border border-slate-700 focus:border-blue-500 focus:outline-none"
        />
      </div>

      {/* Active range label */}
      <span className="text-xs text-slate-500 ml-1">
        {from} — {to}
      </span>
    </div>
  );
}
