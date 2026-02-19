import { redirect } from "next/navigation";
import { requireRole } from "@/lib/rbac";
import PageHeader from "@/components/page-header";
import EbayExportUpload from "./ebay-export-upload";
import UploadTmp from "./upload-tmp";
import ScrapeOrderTotals from "./scrape-order-totals";

/**
 * /dev — Hidden developer tools page.
 * Not linked from the main nav. Access by typing the URL directly.
 * ADMIN role required.
 */
export default async function DevPage() {
  const auth = await requireRole(["ADMIN"]);
  if (!auth.ok) redirect("/login");

  return (
    <div className="space-y-6">
      <PageHeader title="Developer Tools" />

      <div className="rounded-lg border border-yellow-800 bg-yellow-950/30 px-4 py-3 text-sm text-yellow-300">
        This page is not linked from the main navigation. It is intended for admin-only maintenance tasks
        and data backfill operations. Changes made here directly affect the production database.
      </div>

      {/* File upload to /tmp for inspection */}
      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500">
          File Inspection
        </h2>
        <UploadTmp />
      </section>

      {/* Scrape original order totals from eBay order pages */}
      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500">
          Order Total Backfill
        </h2>
        <ScrapeOrderTotals />
      </section>

      {/* eBay Export Backfill */}
      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500">
          Data Backfill
        </h2>
        <EbayExportUpload />
      </section>
    </div>
  );
}
