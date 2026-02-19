import "./globals.css";
import type { ReactNode } from "react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import Link from "next/link";

export const metadata = {
  title: "ArbDesk",
  description: "Retail arbitrage operations for eBay buyers."
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession(authOptions);

  return (
    <html lang="en">
      <body>
        <div className="min-h-screen">
          <header className="border-b border-slate-800 bg-slate-900">
            <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
              <Link href="/" className="text-xl font-semibold">
                ArbDesk
              </Link>
              <nav className="flex items-center gap-4 text-sm text-slate-200">
                {session ? (
                  <>
                    <Link href="/targets">Targets</Link>
                    <Link href="/orders">Orders</Link>
                    <Link href="/inventory">Inventory</Link>
                    <Link href="/on-hand">On Hand</Link>
                    <Link href="/ebay-accounts">eBay Accounts</Link>
                    <Link href="/receiving">Receiving</Link>
                    <Link href="/units">Units</Link>
                    <Link href="/returns">Returns</Link>
                    <Link href="/inr">INR</Link>
                    <Link href="/inbound">Inbound</Link>
                    <Link href="/settings">Settings</Link>
                    <Link href="/admin/users">Admin</Link>
                  </>
                ) : (
                  <Link href="/login">Login</Link>
                )}
              </nav>
            </div>
          </header>
          <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
