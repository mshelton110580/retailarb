"use client";

import { signOut } from "next-auth/react";

export default function SignOutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: "/login" })}
      className="text-slate-500 hover:text-slate-300 transition-colors"
    >
      Sign Out
    </button>
  );
}
