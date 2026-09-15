import PageHeader from "@/components/page-header";
import Link from "next/link";
import DateRangeFilter from "@/components/date-range-filter";
import { getDateRangeFromParams } from "@/lib/date-range";
import { getReceivingEntries, RECEIVING_PAGE_SIZE } from "@/lib/receiving-entries";
import ReceivingForm from "./receiving-form";
import ScanList from "./scan-list";

export default async function ReceivingPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const dateRange = getDateRangeFromParams(params, 30);

  const { entries, scanCount, importedOrderCount } = await getReceivingEntries(dateRange);

  return (
    <div className="space-y-6">
      <PageHeader title="Receiving">
        <Link href="/receiving/import" className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">
          Import CSV
        </Link>
      </PageHeader>
      <div className="flex items-center justify-between">
        <DateRangeFilter defaultDays={30} />
        <span className="text-sm text-slate-400">{scanCount} scans · {importedOrderCount} imported</span>
      </div>
      <ReceivingForm />
      <ScanList
        initialEntries={entries.slice(0, RECEIVING_PAGE_SIZE)}
        totalEntries={entries.length}
      />
    </div>
  );
}
