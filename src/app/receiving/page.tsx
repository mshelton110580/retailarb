import PageHeader from "@/components/page-header";
import { prisma } from "@/lib/db";
import ReceivingForm from "./receiving-form";

export default async function ReceivingPage() {
  const scans = await prisma.receiving_scans.findMany({
    orderBy: { scanned_at: "desc" },
    take: 20
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Receiving" />
      <ReceivingForm />
      <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-lg font-semibold">Recent scans</h2>
        <div className="mt-3 space-y-2 text-sm text-slate-300">
          {scans.length === 0 ? (
            <p>No scans yet.</p>
          ) : (
            scans.map((scan) => (
              <div key={scan.id} className="rounded border border-slate-800 p-3">
                <p>
                  {scan.tracking_last8} · {scan.resolution_state}
                </p>
                <p className="text-xs text-slate-400">
                  {scan.scanned_at.toISOString()}
                </p>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
