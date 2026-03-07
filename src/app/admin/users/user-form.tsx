"use client";

import { useState } from "react";

type User = {
  id: string;
  email: string;
  role: string;
  created_at: string;
};

export default function UserManagement({ initialUsers }: { initialUsers: User[] }) {
  const [users, setUsers] = useState<User[]>(initialUsers);
  const [status, setStatus] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetStatus, setResetStatus] = useState<string | null>(null);

  async function onCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      email: form.get("email"),
      password: form.get("password"),
      role: form.get("role"),
    };
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const { user } = await res.json();
      setUsers(prev => [user, ...prev]);
      setStatus("User created.");
      event.currentTarget.reset();
    } else {
      const data = await res.json().catch(() => null);
      setStatus(data?.error ?? "Failed to create user.");
    }
  }

  async function onDelete(userId: string, email: string) {
    if (!confirm(`Delete user ${email}? This cannot be undone.`)) return;
    const res = await fetch(`/api/admin/users/${userId}`, { method: "DELETE" });
    if (res.ok) {
      setUsers(prev => prev.filter(u => u.id !== userId));
    } else {
      const data = await res.json().catch(() => null);
      alert(data?.error ?? "Failed to delete user.");
    }
  }

  async function onResetPassword(userId: string) {
    if (newPassword.length < 8) {
      setResetStatus("Password must be at least 8 characters.");
      return;
    }
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: newPassword }),
    });
    if (res.ok) {
      setResetTarget(null);
      setNewPassword("");
      setResetStatus(null);
    } else {
      setResetStatus("Failed to reset password.");
    }
  }

  return (
    <div className="space-y-6">
      {/* Create user */}
      <form className="rounded-lg border border-slate-800 bg-slate-900 p-4" onSubmit={onCreate}>
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

      {/* User list */}
      <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-lg font-semibold">Users</h2>
        <div className="mt-3 space-y-2 text-sm text-slate-300">
          {users.map(user => (
            <div key={user.id} className="rounded border border-slate-800 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{user.email}</p>
                  <p className="text-xs text-slate-400">
                    Role: {user.role} &middot; Created: {user.created_at.slice(0, 10)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setResetTarget(resetTarget === user.id ? null : user.id);
                      setNewPassword("");
                      setResetStatus(null);
                    }}
                    className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:bg-slate-800"
                  >
                    Reset password
                  </button>
                  <button
                    onClick={() => onDelete(user.id, user.email)}
                    className="rounded border border-red-900 px-2 py-1 text-xs text-red-400 hover:bg-red-950"
                  >
                    Delete
                  </button>
                </div>
              </div>
              {resetTarget === user.id && (
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="password"
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    placeholder="New password (min 8 chars)"
                    className="flex-1 rounded border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm"
                  />
                  <button
                    onClick={() => onResetPassword(user.id)}
                    className="rounded bg-blue-500 px-3 py-1.5 text-xs text-white"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => { setResetTarget(null); setNewPassword(""); setResetStatus(null); }}
                    className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  {resetStatus && <span className="text-xs text-red-400">{resetStatus}</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
