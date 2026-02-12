"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DisconnectEbayButton({ accountId, username }: { accountId: string; username: string }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleDisconnect() {
    if (!confirm(`Disconnect eBay account "${username}"? You can reconnect it later.`)) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/ebay-accounts?id=${accountId}`, { method: "DELETE" });
      if (res.ok) {
        router.refresh();
      } else {
        alert("Failed to disconnect account");
      }
    } catch {
      alert("Failed to disconnect account");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleDisconnect}
      disabled={loading}
      className="rounded border border-red-700 bg-red-900/30 px-2 py-1 text-xs text-red-400 hover:bg-red-900/60 disabled:opacity-50"
    >
      {loading ? "Disconnecting..." : "Disconnect"}
    </button>
  );
}
