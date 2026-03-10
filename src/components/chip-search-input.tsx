"use client";

import { useState, useRef, useEffect, useCallback, forwardRef } from "react";

export type SearchField = {
  key: string;
  label: string;
};

export type SearchChip = {
  field: string;
  value: string;
};

const FIELD_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  title:     { bg: "bg-blue-900/50",    text: "text-blue-300",    border: "border-blue-700" },
  order:     { bg: "bg-purple-900/50",  text: "text-purple-300",  border: "border-purple-700" },
  item:      { bg: "bg-indigo-900/50",  text: "text-indigo-300",  border: "border-indigo-700" },
  tracking:  { bg: "bg-amber-900/50",   text: "text-amber-300",   border: "border-amber-700" },
  account:   { bg: "bg-teal-900/50",    text: "text-teal-300",    border: "border-teal-700" },
  condition: { bg: "bg-yellow-900/50",  text: "text-yellow-300",  border: "border-yellow-700" },
  notes:     { bg: "bg-slate-700/50",   text: "text-slate-300",   border: "border-slate-600" },
  product:   { bg: "bg-emerald-900/50", text: "text-emerald-300", border: "border-emerald-700" },
};

const DEFAULT_COLORS = { bg: "bg-slate-800", text: "text-slate-300", border: "border-slate-600" };

function colors(key: string) {
  return FIELD_COLORS[key] ?? DEFAULT_COLORS;
}

type Props = {
  fields: SearchField[];
  placeholder?: string;
  onChange: (chips: SearchChip[], freeText: string) => void;
  /** Debounce delay in ms for free-text changes. Chip changes fire immediately. */
  debounceMs?: number;
  /** Initial chips to populate (e.g. from saved state). Only used on mount. */
  initialChips?: SearchChip[];
  /** Initial free text to populate (e.g. from saved state). Only used on mount. */
  initialFreeText?: string;
};

/**
 * A search input that supports:
 * - Colored chip filters (field:value pairs)
 * - Autocomplete for field prefixes
 * - Free-text search for everything else
 * - Barcode scanner via forwarded ref
 *
 * Forward ref points to the internal <input> element (for barcode scanner integration).
 */
const ChipSearchInput = forwardRef<HTMLInputElement, Props>(
  function ChipSearchInput({ fields, placeholder, onChange, debounceMs = 300, initialChips, initialFreeText }, ref) {
    const [chips, setChips] = useState<SearchChip[]>(initialChips ?? []);
    const [input, setInput] = useState(initialFreeText ?? "");
    const [activeField, setActiveField] = useState<string | null>(null);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [highlightIdx, setHighlightIdx] = useState(0);

    const internalRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Stable ref to latest onChange to avoid stale closures
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    // Merge forwarded ref with internal ref
    const setInputRef = useCallback((el: HTMLInputElement | null) => {
      (internalRef as React.MutableRefObject<HTMLInputElement | null>).current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = el;
    }, [ref]);

    // Notify parent immediately when chips change
    const chipsRef = useRef(chips);
    chipsRef.current = chips;
    const inputRef2 = useRef(input);
    inputRef2.current = input;

    useEffect(() => {
      // Chips changed — notify immediately with current freeText
      const freeText = activeField ? "" : inputRef2.current;
      onChangeRef.current(chips, freeText);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chips]);

    // Debounced notification for free-text changes
    useEffect(() => {
      if (activeField) return; // Don't notify during value entry
      const timer = setTimeout(() => {
        onChangeRef.current(chipsRef.current, input);
      }, debounceMs);
      return () => clearTimeout(timer);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [input, activeField, debounceMs]);

    // Compute autocomplete suggestions
    const suggestions = (!activeField && input.length > 0)
      ? fields.filter(f => {
          const lower = input.toLowerCase();
          // Don't suggest fields that already have a chip
          const alreadyUsed = chips.some(c => c.field === f.key);
          return !alreadyUsed && (f.key.startsWith(lower) || f.label.toLowerCase().startsWith(lower));
        })
      : [];

    useEffect(() => {
      setShowSuggestions(suggestions.length > 0);
      setHighlightIdx(0);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [suggestions.length, input]);

    // Close suggestions on outside click
    useEffect(() => {
      function handler(e: MouseEvent) {
        if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
          setShowSuggestions(false);
        }
      }
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }, []);

    function selectField(fieldKey: string) {
      setActiveField(fieldKey);
      setInput("");
      setShowSuggestions(false);
      internalRef.current?.focus();
    }

    function commitChip(value: string) {
      if (!activeField || !value.trim()) return;
      setChips(prev => [...prev, { field: activeField, value: value.trim() }]);
      setActiveField(null);
      setInput("");
      internalRef.current?.focus();
    }

    function removeChip(idx: number) {
      setChips(prev => prev.filter((_, i) => i !== idx));
      internalRef.current?.focus();
    }

    function handleKeyDown(e: React.KeyboardEvent) {
      if (e.key === "Backspace" && input === "" && !activeField) {
        if (chips.length > 0) {
          e.preventDefault();
          removeChip(chips.length - 1);
        }
      } else if (e.key === "Backspace" && input === "" && activeField) {
        e.preventDefault();
        setActiveField(null);
      } else if (e.key === "Escape") {
        if (activeField) {
          setActiveField(null);
          setInput("");
        }
        setShowSuggestions(false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (activeField) {
          commitChip(input);
        } else if (showSuggestions && suggestions.length > 0) {
          selectField(suggestions[highlightIdx].key);
        }
        // For free text, the debounced effect handles notification
      } else if (e.key === "Tab" && showSuggestions && suggestions.length > 0) {
        e.preventDefault();
        selectField(suggestions[highlightIdx].key);
      } else if (e.key === "ArrowDown" && showSuggestions) {
        e.preventDefault();
        setHighlightIdx(i => Math.min(i + 1, suggestions.length - 1));
      } else if (e.key === "ArrowUp" && showSuggestions) {
        e.preventDefault();
        setHighlightIdx(i => Math.max(i - 1, 0));
      }
    }

    function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
      const val = e.target.value;

      // Detect "field:" typing pattern
      if (!activeField) {
        const colonIdx = val.indexOf(":");
        if (colonIdx > 0) {
          const prefix = val.slice(0, colonIdx).toLowerCase().trim();
          const matchedField = fields.find(f => f.key === prefix);
          if (matchedField) {
            const remainder = val.slice(colonIdx + 1);
            setActiveField(matchedField.key);
            setInput(remainder);
            setShowSuggestions(false);
            return;
          }
        }
      }

      setInput(val);
    }

    const activePlaceholder = activeField
      ? "type value, Enter to add..."
      : chips.length === 0
        ? placeholder
        : "add more filters or search...";

    return (
      <div ref={containerRef} className="relative">
        <div
          className="flex flex-wrap items-center gap-1.5 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 min-h-[38px] cursor-text focus-within:border-blue-600 transition-colors"
          onClick={() => internalRef.current?.focus()}
        >
          {/* Committed chips */}
          {chips.map((chip, idx) => {
            const c = colors(chip.field);
            return (
              <span
                key={`${chip.field}-${idx}`}
                className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium border ${c.bg} ${c.text} ${c.border}`}
              >
                <span className="opacity-60">{chip.field}:</span>
                <span>{chip.value}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); removeChip(idx); }}
                  className="ml-0.5 opacity-40 hover:opacity-100 text-xs leading-none"
                >
                  &times;
                </button>
              </span>
            );
          })}

          {/* Active field prefix (value mode) */}
          {activeField && (
            <span
              className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium border ${colors(activeField).bg} ${colors(activeField).text} ${colors(activeField).border}`}
            >
              {activeField}:
            </span>
          )}

          {/* Text input */}
          <input
            ref={setInputRef}
            type="text"
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={() => { if (suggestions.length > 0 && !activeField) setShowSuggestions(true); }}
            placeholder={activePlaceholder}
            className="flex-1 min-w-[140px] bg-transparent text-sm text-slate-300 placeholder-slate-600 outline-none"
          />
        </div>

        {/* Autocomplete dropdown */}
        {showSuggestions && (
          <div className="absolute z-50 mt-1 w-72 rounded border border-slate-700 bg-slate-900 shadow-xl py-1">
            {suggestions.map((field, idx) => {
              const c = colors(field.key);
              return (
                <button
                  key={field.key}
                  onMouseDown={(e) => { e.preventDefault(); selectField(field.key); }}
                  className={`w-full px-3 py-1.5 text-left text-sm flex items-center gap-2 ${
                    idx === highlightIdx ? "bg-slate-800" : "hover:bg-slate-800/50"
                  }`}
                >
                  <span className={`rounded px-1.5 py-0.5 text-xs font-medium border ${c.bg} ${c.text} ${c.border}`}>
                    {field.key}:
                  </span>
                  <span className="text-slate-400 text-xs">Search by {field.label.toLowerCase()}</span>
                </button>
              );
            })}
            <div className="border-t border-slate-800 mt-1 pt-1 px-3 py-1 text-xs text-slate-600">
              Tab/Enter to select field, or keep typing to search all
            </div>
          </div>
        )}
      </div>
    );
  }
);

export default ChipSearchInput;
