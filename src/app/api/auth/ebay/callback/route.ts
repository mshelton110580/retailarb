import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { exchangeCode } from "@/lib/ebay/oauth";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });

async function fetchEbayUsername(accessToken: string): Promise<string | null> {
  try {
    const body = `<?xml version="1.0" encoding="utf-8"?>
    <GetUserRequest xmlns="urn:ebay:apis:eBLBaseComponents">
      <DetailLevel>ReturnSummary</DetailLevel>
    </GetUserRequest>`;
    const response = await fetch("https://api.ebay.com/ws/api.dll", {
      method: "POST",
      headers: {
        "Content-Type": "text/xml",
        "X-EBAY-API-CALL-NAME": "GetUser",
        "X-EBAY-API-SITEID": "0",
        "X-EBAY-API-COMPATIBILITY-LEVEL": "1415",
        "X-EBAY-API-APP-NAME": process.env.EBAY_CLIENT_ID ?? "",
        "X-EBAY-API-IAF-TOKEN": accessToken
      },
      body
    });
    const xml = await response.text();
    const data = parser.parse(xml);
    return data?.GetUserResponse?.User?.UserID ?? null;
  } catch {
    return null;
  }
}

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

    // Try to get the actual eBay username via GetUser API call
    const ebayUsername = await fetchEbayUsername(data.access_token) ?? data?.user_name ?? "ebay-user";

    // Check if this eBay account is already connected (avoid duplicates)
    const existing = await prisma.ebay_accounts.findFirst({
      where: { owner_user_id: session.user.id, ebay_username: ebayUsername }
    });

    if (existing) {
      // Update the existing account with fresh tokens
      await prisma.ebay_accounts.update({
        where: { id: existing.id },
        data: {
          token_encrypted: encrypt(data.access_token),
          refresh_token_encrypted: encrypt(data.refresh_token),
          token_expiry,
          scopes: data.scope ?? existing.scopes
        }
      });
    } else {
      await prisma.ebay_accounts.create({
        data: {
          owner_user_id: session.user.id,
          ebay_username: ebayUsername,
          token_encrypted: encrypt(data.access_token),
          refresh_token_encrypted: encrypt(data.refresh_token),
          token_expiry,
          scopes: data.scope ?? ""
        }
      });
    }
    return NextResponse.redirect(new URL("/ebay-accounts?connected=true", req.url));
  } catch (error) {
    console.error("OAuth callback failed", error);
    return NextResponse.redirect(new URL("/ebay-accounts?error=oauth_failed", req.url));
  }
}
