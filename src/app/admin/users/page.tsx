import PageHeader from "@/components/page-header";
import { prisma } from "@/lib/db";
import Link from "next/link";
import UserManagement from "./user-form";

export default async function AdminUsersPage() {
  const users = await prisma.users.findMany({
    select: { id: true, email: true, role: true, created_at: true },
    orderBy: { created_at: "desc" },
  });

  const serialized = users.map(u => ({
    ...u,
    created_at: u.created_at.toISOString(),
  }));

  return (
    <div className="space-y-6">
      <PageHeader title="User Management">
        <Link href="/admin/products" className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">
          Products
        </Link>
      </PageHeader>
      <UserManagement initialUsers={serialized} />
    </div>
  );
}
