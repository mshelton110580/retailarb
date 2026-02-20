import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";

/**
 * POST /api/dev/save-ebay-session
 *
 * Accepts a raw Cookie header string copied from browser DevTools and
 * converts it into a Playwright storageState JSON saved to the first
 * eBay account.
 *
 * The cookie string is the value of the `Cookie:` request header — e.g.:
 *   s=BAQAAAXz...; dp1=bu1p/QEBfX0DAA**...; nonsession=...
 *
 * ADMIN only.
 */
export async function POST(req: Request) {
  const auth = await requireRole(["ADMIN"]);
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const body = await req.json().catch(() => null);
  if (!body?.cookieString || typeof body.cookieString !== "string") {
    return NextResponse.json({ error: "cookieString required" }, { status: 400 });
  }

  const raw = body.cookieString.trim();
  if (!raw) return NextResponse.json({ error: "cookieString is empty" }, { status: 400 });

  // Parse "name=value; name2=value2" into Playwright cookie objects for ebay.com
  const cookies = raw
    .split(";")
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const eqIdx = part.indexOf("=");
      const name = eqIdx === -1 ? part : part.slice(0, eqIdx).trim();
      const value = eqIdx === -1 ? "" : part.slice(eqIdx + 1).trim();
      return {
        name,
        value,
        domain: ".ebay.com",
        path: "/",
        expires: -1,
        httpOnly: false,
        secure: true,
        sameSite: "None" as const
      };
    })
    .filter(c => c.name.length > 0);

  if (cookies.length === 0) {
    return NextResponse.json({ error: "No cookies found in the provided string" }, { status: 400 });
  }

  const storageState = {
    cookies,
    origins: []
  };

  const account = await prisma.ebay_accounts.findFirst({
    select: { id: true }
  });

  if (!account) {
    return NextResponse.json({ error: "No eBay account found" }, { status: 404 });
  }

  await prisma.ebay_accounts.update({
    where: { id: account.id },
    data: { playwright_state: JSON.stringify(storageState) }
  });

  return NextResponse.json({ ok: true, cookieCount: cookies.length });
}
