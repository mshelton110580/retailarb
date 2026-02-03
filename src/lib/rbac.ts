import { getServerSession } from "next-auth";
import { authOptions } from "./auth";

export async function requireRole(roles: string[]) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.role || !roles.includes(session.user.role)) {
    return { ok: false, session: null };
  }
  return { ok: true, session };
}
