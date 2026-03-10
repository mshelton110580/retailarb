/**
 * Parse a search string for field:value prefix syntax.
 *
 * Supports:
 *   "title:xbox"         → { field: "title", value: "xbox" }
 *   "tracking:1Z999"     → { field: "tracking", value: "1Z999" }
 *   "xbox controller"    → { field: null, value: "xbox controller" }
 *   "title:xbox one x"   → { field: "title", value: "xbox one x" }
 *
 * The field must be one of the allowed fields, otherwise the entire
 * string is treated as a global search.
 */
export function parseFieldSearch(
  raw: string,
  allowedFields: string[]
): { field: string | null; value: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { field: null, value: "" };

  const colonIdx = trimmed.indexOf(":");
  if (colonIdx > 0) {
    const prefix = trimmed.slice(0, colonIdx).toLowerCase();
    if (allowedFields.includes(prefix)) {
      const value = trimmed.slice(colonIdx + 1).trim();
      return { field: prefix, value };
    }
  }

  return { field: null, value: trimmed };
}
