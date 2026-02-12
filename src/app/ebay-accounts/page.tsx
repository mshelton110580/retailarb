import PageHeader from "@/components/page-header";
import DisconnectEbayButton from "@/components/disconnect-ebay-button";
import { prisma } from "@/lib/db";
import Link from "next/link";

// Comprehensive scopes for Trading API, Post-Order API, Fulfillment, etc.
const scopes = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.marketing.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.marketing",
  "https://api.ebay.com/oauth/api_scope/sell.inventory.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
  "https://api.ebay.com/oauth/api_scope/sell.analytics.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.finances",
  "https://api.ebay.com/oauth/api_scope/sell.payment.dispute",
  "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.reputation",
  "https://api.ebay.com/oauth/api_scope/sell.reputation.readonly",
  "https://api.ebay.com/oauth/api_scope/commerce.notification.subscription",
  "https://api.ebay.com/oauth/api_scope/commerce.notification.subscription.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.stores",
  "https://api.ebay.com/oauth/api_scope/sell.stores.readonly",
].join(" ");

export default async function EbayAccountsPage() {
  const accounts = await prisma.ebay_accounts.findMany({
    select: {
      id: true,
      ebay_username: true,
      last_sync_at: true,
      created_at: true,
      token_expiry: true,
      scopes: true,
    },
  });
  const clientId = process.env.EBAY_CLIENT_ID ?? "";
  const redirectUri = process.env.EBAY_REDIRECT_URI ?? "";
  const oauthUrl = `https://auth.ebay.com/oauth2/authorize?client_id=${encodeURIComponent(
    clientId
  )}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(
    scopes
  )}`;

  return (
    <div className="space-y-6">
      <PageHeader title="eBay Accounts">
        <Link className="rounded bg-blue-500 px-3 py-2 text-sm text-white hover:bg-blue-600" href={oauthUrl}>
          Connect account
        </Link>
      </PageHeader>

      <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-lg font-semibold">Connected accounts</h2>
        <div className="mt-3 space-y-2 text-sm text-slate-300">
          {accounts.length === 0 ? (
            <p>No accounts connected. Click &quot;Connect account&quot; to link your eBay account.</p>
          ) : (
            accounts.map((account) => {
              const isExpired = account.token_expiry < new Date();
              return (
                <div
                  key={account.id}
                  className="flex items-center justify-between rounded border border-slate-800 p-3"
                >
                  <div className="space-y-1">
                    <p className="font-medium">{account.ebay_username}</p>
                    <p className="text-xs text-slate-400">
                      Last sync: {account.last_sync_at?.toISOString().slice(0, 16).replace("T", " ") ?? "Never"}
                    </p>
                    <p className="text-xs text-slate-400">
                      Token: {isExpired ? (
                        <span className="text-red-400">Expired</span>
                      ) : (
                        <span className="text-green-400">
                          Valid until {account.token_expiry.toISOString().slice(0, 16).replace("T", " ")}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-slate-400">
                      Added {account.created_at.toISOString().slice(0, 10)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link
                      className="rounded border border-blue-700 bg-blue-900/30 px-2 py-1 text-xs text-blue-400 hover:bg-blue-900/60"
                      href={oauthUrl}
                    >
                      Re-authenticate
                    </Link>
                    <DisconnectEbayButton accountId={account.id} username={account.ebay_username} />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-lg font-semibold">Troubleshooting</h2>
        <div className="mt-3 space-y-2 text-sm text-slate-400">
          <p>
            If you&apos;re seeing errors when syncing returns or orders, try clicking{" "}
            <strong className="text-slate-200">Re-authenticate</strong> to refresh your eBay token with updated permissions.
          </p>
          <p>
            If that doesn&apos;t work, click <strong className="text-slate-200">Disconnect</strong> to remove the account,
            then click <strong className="text-slate-200">Connect account</strong> to re-link it from scratch.
          </p>
        </div>
      </section>
    </div>
  );
}
