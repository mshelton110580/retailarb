import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { exchangeCode } from "@/lib/ebay/oauth";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(new URL("/ebay-accounts?error=missing_code", req.url));
  }
  try {
    const redirectUri = process.env.EBAY_REDIRECT_URI ?? "";
    const data = await exchangeCode(code, redirectUri);
    const token_expiry = new Date(Date.now() + data.expires_in * 1000);
    await prisma.ebay_accounts.create({
      data: {
        owner_user_id: session.user.id,
        ebay_username: data?.user_name ?? "ebay-user",
        token_encrypted: encrypt(data.access_token),
        refresh_token_encrypted: encrypt(data.refresh_token),
        token_expiry,
        scopes: data.scope ?? ""
      }
    });
    return NextResponse.redirect(new URL("/ebay-accounts?connected=true", req.url));
  } catch (error) {
    console.error("OAuth callback failed", error);
    return NextResponse.redirect(new URL("/ebay-accounts?error=oauth_failed", req.url));
  }
}
