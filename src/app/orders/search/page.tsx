import OrderSearch from "./order-search";
import PageHeader from "@/components/page-header";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/rbac";
import { redirect } from "next/navigation";

export default async function OrderSearchPage() {
  const auth = await requireRole(["ADMIN", "RECEIVER"]);
  if (!auth.ok) redirect("/login");

  const accounts = await prisma.ebay_accounts.findMany({
    select: { id: true, ebay_username: true },
    orderBy: { ebay_username: "asc" },
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Order Search" />
      <OrderSearch accounts={accounts} />
    </div>
  );
}
