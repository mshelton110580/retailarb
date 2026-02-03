import PageHeader from "@/components/page-header";
import { prisma } from "@/lib/db";
import ReturnActions from "./return-actions";
import { getPublicPath } from "@/lib/storage";

export default async function ReturnsPage() {
  const returns = await prisma.returns.findMany({
    include: { order: true },
    orderBy: { filed_manually_at: "desc" }
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Returns" />
      <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="space-y-3 text-sm text-slate-300">
          {returns.length === 0 ? (
            <p>No returns yet.</p>
          ) : (
            returns.map((ret) => (
              <div key={ret.id} className="rounded border border-slate-800 p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Order {ret.order_id}</p>
                    <p className="text-xs text-slate-400">
                      Status: {ret.status_scraped ?? "Pending"} · State: {ret.scrape_state}
                    </p>
                  </div>
                  <a
                    className="text-xs text-blue-400"
                    href={ret.order.order_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open order details
                  </a>
                </div>
                {ret.label_pdf_path ? (
                  <a
                    className="mt-2 inline-block text-xs text-blue-400"
                    href={getPublicPath(ret.label_pdf_path)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Print label
                  </a>
                ) : null}
                <ReturnActions returnId={ret.id} />
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
