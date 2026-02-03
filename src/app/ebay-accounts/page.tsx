import PageHeader from "@/components/page-header";
import { prisma } from "@/lib/db";
import Link from "next/link";

const scope = "https://api.ebay.com/oauth/api_scope";

export default async function EbayAccountsPage() {
  const accounts = await prisma.ebay_accounts.findMany({
    select: { id: true, ebay_username: true, last_sync_at: true, created_at: true }
  });
  const clientId = process.env.EBAY_CLIENT_ID ?? "";
  const redirectUri = process.env.EBAY_REDIRECT_URI ?? "";
  const oauthUrl = `https://auth.ebay.com/oauth2/authorize?client_id=${encodeURIComponent(
    clientId
  )}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(
    scope
  )}`;

  return (
    <div className="space-y-6">
      <PageHeader title="eBay Accounts">
        <Link className="rounded bg-blue-500 px-3 py-2 text-sm text-white" href={oauthUrl}>
          Connect account
        </Link>
      </PageHeader>
      <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-lg font-semibold">Connected accounts</h2>
        <div className="mt-3 space-y-2 text-sm text-slate-300">
          {accounts.length === 0 ? (
            <p>No accounts connected.</p>
          ) : (
            accounts.map((account) => (
              <div key={account.id} className="flex items-center justify-between rounded border border-slate-800 p-3">
                <div>
                  <p className="font-medium">{account.ebay_username}</p>
                  <p className="text-xs text-slate-400">
                    Last sync: {account.last_sync_at?.toISOString() ?? "Never"}
                  </p>
                </div>
                <span className="text-xs text-slate-400">
                  Added {account.created_at.toISOString().slice(0, 10)}
                </span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
