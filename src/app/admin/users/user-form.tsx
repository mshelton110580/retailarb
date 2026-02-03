"use client";

import { useState } from "react";

export default function CreateUserForm() {
  const [status, setStatus] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      email: form.get("email"),
      password: form.get("password"),
      role: form.get("role")
    };
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    setStatus(res.ok ? "User created." : "Failed to create user.");
    if (res.ok) {
      event.currentTarget.reset();
    }
  }

  return (
    <form className="rounded-lg border border-slate-800 bg-slate-900 p-4" onSubmit={onSubmit}>
      <h2 className="text-lg font-semibold">Create user</h2>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <input
          className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
          name="email"
          type="email"
          placeholder="email@example.com"
          required
        />
        <input
          className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
          name="password"
          type="password"
          placeholder="Password"
          minLength={8}
          required
        />
        <select
          className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
          name="role"
          defaultValue="VIEWER"
        >
          <option value="ADMIN">Admin</option>
          <option value="RECEIVER">Receiver</option>
          <option value="VIEWER">Viewer</option>
        </select>
      </div>
      <button className="mt-3 rounded bg-blue-500 px-4 py-2 text-sm text-white" type="submit">
        Save user
      </button>
      {status ? <p className="mt-2 text-sm text-slate-300">{status}</p> : null}
    </form>
  );
}
