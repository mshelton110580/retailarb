// Off/include/exclude tri-state cycling for search filter chips.
//
// A chip starts "off". Clicking cycles off -> include -> exclude -> off.
// A group of chips (e.g. ship status) is represented as Map<string, TriState>
// (only "off" entries are typically omitted from the map — see `encode`).
//
// URL / localStorage serialization stays backward compatible with the old
// string[]-of-included-values format: an unprefixed value means "include"
// (exactly what pre-tri-state code wrote), and a "!"-prefixed value means
// "exclude" (new). Values still in "off" state are simply absent.

export type TriState = "off" | "include" | "exclude";

/** off -> include -> exclude -> off */
export function cycle(state: TriState): TriState {
  if (state === "off") return "include";
  if (state === "include") return "exclude";
  return "off";
}

/** Map -> string[] for URL params / localStorage. include: "v", exclude: "!v", off omitted. */
export function encode(values: Map<string, TriState>): string[] {
  const out: string[] = [];
  for (const [key, state] of values) {
    if (state === "include") out.push(key);
    else if (state === "exclude") out.push(`!${key}`);
  }
  return out;
}

/** string[] -> Map. Unprefixed = include (back-compat with pre-tri-state values). "!v" = exclude. Values not in `valid` are dropped. */
export function decode(raw: string[], valid: Set<string>): Map<string, TriState> {
  const out = new Map<string, TriState>();
  for (const entry of raw) {
    if (entry.startsWith("!")) {
      const value = entry.slice(1);
      if (valid.has(value)) out.set(value, "exclude");
    } else {
      if (valid.has(entry)) out.set(entry, "include");
    }
  }
  return out;
}

/**
 * True when (no includes OR candidates intersect includes) AND candidates
 * intersect no excludes. `candidates` is the set of filter-keys that apply
 * to one row (e.g. a single derived ship status, or all case-filter keys
 * that currently apply to an order).
 */
export function matches(candidates: string[], filter: Map<string, TriState>): boolean {
  let hasIncludes = false;
  let includeHit = false;
  for (const [key, state] of filter) {
    if (state === "exclude") {
      if (candidates.includes(key)) return false;
    } else if (state === "include") {
      hasIncludes = true;
      if (!includeHit && candidates.includes(key)) includeHit = true;
    }
  }
  return !hasIncludes || includeHit;
}
