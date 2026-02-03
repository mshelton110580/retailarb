"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";

export default function LoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    setLoading(true);
    const result = await signIn("credentials", {
      redirect: true,
      email,
      password,
      callbackUrl: "/"
    });
    if (result?.error) {
      setError("Invalid credentials.");
    }
    setLoading(false);
  }

  return (
    <form className="mt-4 space-y-4" onSubmit={onSubmit}>
      <div>
        <label className="text-sm text-slate-200" htmlFor="email">
          Email
        </label>
        <input
          className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
          id="email"
          name="email"
          type="email"
          required
        />
      </div>
      <div>
        <label className="text-sm text-slate-200" htmlFor="password">
          Password
        </label>
        <input
          className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
          id="password"
          name="password"
          type="password"
          required
        />
      </div>
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      <button
        className="w-full rounded bg-blue-500 px-4 py-2 text-white disabled:opacity-50"
        type="submit"
        disabled={loading}
      >
        {loading ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
