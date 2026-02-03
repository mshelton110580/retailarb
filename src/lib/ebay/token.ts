import { prisma } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { refreshToken } from "./oauth";

export async function getValidAccessToken(accountId: string) {
  const account = await prisma.ebay_accounts.findUnique({ where: { id: accountId } });
  if (!account) {
    throw new Error("Account not found");
  }
  const now = new Date();
  if (account.token_expiry > now) {
    return { token: decrypt(account.token_encrypted), account };
  }
  const refresh = decrypt(account.refresh_token_encrypted);
  const data = await refreshToken(refresh);
  const token_expiry = new Date(Date.now() + data.expires_in * 1000);
  const updated = await prisma.ebay_accounts.update({
    where: { id: accountId },
    data: {
      token_encrypted: encrypt(data.access_token),
      refresh_token_encrypted: encrypt(data.refresh_token ?? refresh),
      token_expiry,
      scopes: data.scope ?? account.scopes
    }
  });
  return { token: decrypt(updated.token_encrypted), account: updated };
}
