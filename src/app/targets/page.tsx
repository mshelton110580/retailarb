import PageHeader from "@/components/page-header";
import TargetForm from "./target-form";
import { prisma } from "@/lib/db";

export default async function TargetsPage() {
  const targets = await prisma.targets.findMany({
    include: { listing: true },
    orderBy: { created_at: "desc" }
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Targets" />
      <TargetForm />
      <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-lg font-semibold">All targets</h2>
        <div className="mt-3 space-y-3 text-sm text-slate-300">
          {targets.length === 0 ? (
            <p>No targets yet.</p>
          ) : (
            targets.map((target) => (
              <div key={target.item_id} className="rounded border border-slate-800 p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">
                      {target.item_id} - {target.type}
                    </p>
                    <p className="text-xs text-slate-400">Status: {target.status}</p>
                  </div>
                  <a
                    className="text-xs text-blue-400"
                    href={`https://www.ebay.com/itm/${target.item_id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open listing
                  </a>
                </div>
                {target.listing ? (
                  <p className="mt-2 text-xs text-slate-400">
                    {target.listing.title} · Current {target.listing.current_price?.toString() ?? "-"}
                  </p>
                ) : null}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
