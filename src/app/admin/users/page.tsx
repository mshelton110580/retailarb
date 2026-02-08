import PageHeader from "@/components/page-header";
import { prisma } from "@/lib/db";
import CreateUserForm from "./user-form";

type UserSummary = {
  id: string;
  email: string;
  role: string;
  created_at: Date;
};

export default async function AdminUsersPage() {
  const users = await prisma.users.findMany({
    select: { id: true, email: true, role: true, created_at: true },
    orderBy: { created_at: "desc" }
  });

  return (
    <div className="space-y-6">
      <PageHeader title="User Management" />
      <CreateUserForm />
      <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-lg font-semibold">Users</h2>
        <div className="mt-3 space-y-2 text-sm text-slate-300">
          {users.map((user: UserSummary) => (
            <div key={user.id} className="flex items-center justify-between rounded border border-slate-800 p-3">
              <div>
                <p className="font-medium">{user.email}</p>
                <p className="text-xs text-slate-400">Role: {user.role}</p>
              </div>
              <span className="text-xs text-slate-400">
                {user.created_at.toISOString().slice(0, 10)}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
