/**
 * Server-side helper: compute the date range from searchParams.
 * Use this in server components to filter Prisma queries.
 */
export function getDateRangeFromParams(params: {
  range?: string;
  from?: string;
  to?: string;
}): { from: Date; to: Date } {
  const { range, from, to } = params;

  // If "All Time" is selected
  if (range === "all") {
    const fromDate = new Date("2000-01-01");
    fromDate.setHours(0, 0, 0, 0);
    return { from: fromDate, to: new Date() };
  }

  if (range === "30" || range === "60" || range === "90") {
    const days = Number(range);
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - days);
    fromDate.setHours(0, 0, 0, 0);
    return { from: fromDate, to: new Date() };
  }

  if (from && to) {
    const fromDate = new Date(from);
    fromDate.setHours(0, 0, 0, 0);
    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999);
    return { from: fromDate, to: toDate };
  }

  // Default: 90 days
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 90);
  fromDate.setHours(0, 0, 0, 0);
  return { from: fromDate, to: new Date() };
}
