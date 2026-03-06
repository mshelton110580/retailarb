import { prisma } from "@/lib/db";

/**
 * Search for tracking numbers that match the given input.
 * Handles all carrier formats including USPS barcodes with 420+ZIP prefixes.
 *
 * Strategy:
 * 1. Case-insensitive contains match (works for typed partial input like "1z")
 * 2. Progressive prefix stripping — if the input is longer than any stored
 *    tracking number, strip characters from the front until a match is found.
 *    This handles USPS barcodes where 420+ZIP is prepended to the tracking number.
 * 3. Digits-only suffix match as final fallback (barcode scanners for numeric carriers)
 */
export async function findTrackingOrderIds(input: string): Promise<string[]> {
  if (!input.trim()) return [];

  const trimmed = input.trim();

  // 1. Contains match — handles typed partial searches and exact full tracking numbers
  const containsMatches = await prisma.tracking_numbers.findMany({
    where: { tracking_number: { contains: trimmed, mode: "insensitive" } },
    select: { shipment: { select: { order_id: true } } },
  });
  if (containsMatches.length > 0) {
    return [...new Set(
      containsMatches.map(m => m.shipment?.order_id).filter((id): id is string => Boolean(id))
    )];
  }

  // 2. Progressive prefix strip — for USPS barcodes with 420+ZIP prefix
  //    The tracking number is always at the end, so strip from the front
  if (trimmed.length > 18) {
    // Try stripping up to 13 chars from front (420 + 5-digit ZIP = 8, or 420 + 9-digit ZIP+4 = 13)
    for (let strip = 3; strip <= Math.min(13, trimmed.length - 12); strip++) {
      const suffix = trimmed.slice(strip);
      const matches = await prisma.tracking_numbers.findMany({
        where: { tracking_number: { equals: suffix, mode: "insensitive" } },
        select: { shipment: { select: { order_id: true } } },
      });
      if (matches.length > 0) {
        return [...new Set(
          matches.map(m => m.shipment?.order_id).filter((id): id is string => Boolean(id))
        )];
      }
    }
  }

  // 3. Digits-only suffix match — for barcode scanners on numeric carriers
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length >= 12) {
    const last12 = digits.slice(-12);
    const matches = await prisma.tracking_numbers.findMany({
      where: { tracking_number: { endsWith: last12 } },
      select: { shipment: { select: { order_id: true } } },
    });
    if (matches.length > 0) {
      return [...new Set(
        matches.map(m => m.shipment?.order_id).filter((id): id is string => Boolean(id))
      )];
    }
  }

  return [];
}
