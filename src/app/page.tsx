import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import Link from "next/link";

export default async function Home() {
  const session = await getServerSession(authOptions);

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-slate-800 bg-slate-900 p-6">
        <h1 className="text-3xl font-semibold">ArbDesk</h1>
        <p className="mt-2 text-slate-300">
          Full-stack eBay retail arbitrage workspace for sniping, orders, receiving, and returns.
        </p>
        <div className="mt-4 flex gap-3">
          {session ? (
            <>
              <Link className="rounded bg-blue-500 px-4 py-2 text-white" href="/targets">
                Go to targets
              </Link>
              <Link className="rounded border border-slate-700 px-4 py-2" href="/orders">
                View orders
              </Link>
            </>
          ) : (
            <Link className="rounded bg-blue-500 px-4 py-2 text-white" href="/login">
              Sign in
            </Link>
          )}
        </div>
      </section>
      <section className="grid gap-4 md:grid-cols-3">
        {[
          {
            title: "Targets & Sniping",
            description: "Track auctions, schedule snipes, and reconcile outcomes."
          },
          {
            title: "Orders & Inventory",
            description: "Sync orders from eBay and monitor delivery status."
          },
          {
            title: "Returns",
            description: "Manual filings with automated return status and label scraping."
          }
        ].map((card) => (
          <div key={card.title} className="rounded-lg border border-slate-800 bg-slate-900 p-4">
            <h2 className="text-lg font-semibold">{card.title}</h2>
            <p className="mt-1 text-sm text-slate-300">{card.description}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
