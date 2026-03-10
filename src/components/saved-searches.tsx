"use client";

import { useState, useRef, useEffect } from "react";

type SavedEntry<T> = {
  name: string;
  state: T;
  savedAt: string;
};

type Props<T> = {
  /** localStorage key namespace (e.g. "units_saved_searches") */
  storageKey: string;
  /** Return current filter/search state to save */
  getCurrentState: () => T;
  /** Restore a previously saved state */
  onRestore: (state: T) => void;
};

function loadEntries<T>(storageKey: string): SavedEntry<T>[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

function saveEntries<T>(storageKey: string, entries: SavedEntry<T>[]) {
  localStorage.setItem(storageKey, JSON.stringify(entries));
}

export default function SavedSearches<T>({ storageKey, getCurrentState, onRestore }: Props<T>) {
  const [entries, setEntries] = useState<SavedEntry<T>[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // Load from localStorage on mount
  useEffect(() => {
    setEntries(loadEntries(storageKey));
  }, [storageKey]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSaving(false);
        setName("");
        setConfirmDelete(null);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Focus name input when saving
  useEffect(() => {
    if (saving) nameRef.current?.focus();
  }, [saving]);

  function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const entry: SavedEntry<T> = {
      name: trimmed,
      state: getCurrentState(),
      savedAt: new Date().toISOString(),
    };
    // Replace if same name exists, otherwise prepend
    const updated = entries.filter(e => e.name !== trimmed);
    updated.unshift(entry);
    setEntries(updated);
    saveEntries(storageKey, updated);
    setName("");
    setSaving(false);
  }

  function handleRestore(entry: SavedEntry<T>) {
    onRestore(entry.state);
    setOpen(false);
  }

  function handleDelete(entryName: string) {
    if (confirmDelete !== entryName) {
      setConfirmDelete(entryName);
      return;
    }
    const updated = entries.filter(e => e.name !== entryName);
    setEntries(updated);
    saveEntries(storageKey, updated);
    setConfirmDelete(null);
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => { setOpen(o => !o); setSaving(false); setConfirmDelete(null); }}
        className={`text-xs px-2.5 py-1 rounded border flex items-center gap-1.5 transition-colors ${
          open
            ? "border-slate-500 bg-slate-800 text-slate-200"
            : "border-slate-700 text-slate-400 hover:bg-slate-800"
        }`}
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
        </svg>
        Saved
        {entries.length > 0 && (
          <span className="bg-slate-700 text-slate-300 rounded-full px-1.5 text-[10px] font-medium">
            {entries.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-72 rounded-lg border border-slate-700 bg-slate-900 shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800">
            <span className="text-xs font-medium text-slate-300">Saved Searches</span>
            {!saving ? (
              <button
                onClick={() => setSaving(true)}
                className="text-xs text-blue-400 hover:text-blue-300"
              >
                + Save current
              </button>
            ) : (
              <button
                onClick={() => { setSaving(false); setName(""); }}
                className="text-xs text-slate-500 hover:text-slate-300"
              >
                Cancel
              </button>
            )}
          </div>

          {/* Save form */}
          {saving && (
            <div className="px-3 py-2 border-b border-slate-800 flex gap-2">
              <input
                ref={nameRef}
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") { setSaving(false); setName(""); } }}
                placeholder="Name this search..."
                className="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-300 placeholder-slate-600 outline-none focus:border-blue-600"
              />
              <button
                onClick={handleSave}
                disabled={!name.trim()}
                className="rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Save
              </button>
            </div>
          )}

          {/* Saved entries list */}
          <div className="max-h-64 overflow-y-auto">
            {entries.length === 0 ? (
              <p className="px-3 py-4 text-xs text-slate-600 text-center">No saved searches yet</p>
            ) : (
              entries.map(entry => (
                <div
                  key={entry.name}
                  className="flex items-center gap-2 px-3 py-2 hover:bg-slate-800/50 group border-b border-slate-800/50 last:border-0"
                >
                  <button
                    onClick={() => handleRestore(entry)}
                    className="flex-1 text-left min-w-0"
                  >
                    <div className="text-xs font-medium text-slate-300 truncate">{entry.name}</div>
                    <div className="text-[10px] text-slate-600">
                      {new Date(entry.savedAt).toLocaleDateString()}
                    </div>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(entry.name); }}
                    className={`flex-shrink-0 text-xs px-1.5 py-0.5 rounded transition-colors ${
                      confirmDelete === entry.name
                        ? "bg-red-900/50 text-red-400 border border-red-700"
                        : "text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100"
                    }`}
                    title={confirmDelete === entry.name ? "Click again to confirm" : "Delete"}
                  >
                    {confirmDelete === entry.name ? "Confirm?" : "\u00d7"}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
