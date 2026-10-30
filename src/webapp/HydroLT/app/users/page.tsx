"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Badge from "@/components/Badge";
import { useAuth } from "@/hooks/useAuth";
import { useRole } from "@/hooks/useRole";
import {
  DEMO_MODE,
  listUsers,
  setUserRole,
  setUserActive,
} from "@/lib/firebase";
import type { UserRole, UserRecord } from "@/lib/types";

const ROLES: UserRole[] = ["owner", "operator", "viewer"];

export default function UsersPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { isOwner, loading: roleLoading } = useRole();

  const [users, setUsers] = useState<UserRecord[]>([]);
  const [busy, setBusy] = useState<string | null>(null); // uid being modified
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Guard: only owners can see this page
  useEffect(() => {
    if (authLoading || roleLoading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (!isOwner) {
      router.replace("/");
      return;
    }
  }, [user, authLoading, isOwner, roleLoading, router]);

  // Load user list
  useEffect(() => {
    if (!isOwner || authLoading || roleLoading) return;
    loadUsers();
  }, [isOwner, authLoading, roleLoading]);

  async function loadUsers() {
    try {
      const list = await listUsers();
      // Sort: owners first, then by email
      list.sort((a, b) => {
        if (a.role === "owner" && b.role !== "owner") return -1;
        if (b.role === "owner" && a.role !== "owner") return 1;
        return a.email.localeCompare(b.email);
      });
      setUsers(list);
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load users");
    }
  }

  async function changeRole(uid: string, role: UserRole) {
    setBusy(uid);
    setError(null);
    try {
      await setUserRole(uid, role);
      setUsers((prev) =>
        prev.map((u) => (u.uid === uid ? { ...u, role } : u))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update role");
    } finally {
      setBusy(null);
    }
  }

  async function toggleActive(uid: string, active: boolean) {
    setBusy(uid);
    setError(null);
    try {
      await setUserActive(uid, active);
      setUsers((prev) =>
        prev.map((u) => (u.uid === uid ? { ...u, active } : u))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update status");
    } finally {
      setBusy(null);
    }
  }

  if (authLoading || roleLoading) {
    return <p className="hint" style={{ padding: "2rem 0" }}>Checking permissions…</p>;
  }

  if (!isOwner) {
    return <p className="hint" style={{ padding: "2rem 0" }}>Redirecting…</p>;
  }

  const isSelf = (uid: string) => uid === user?.uid;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>User management</h1>
          <p>
            Manage accounts registered on HydroLT. Change roles (owner, operator,
            viewer) or deactivate users to revoke access.
          </p>
        </div>
        <Badge tone="ok">OWNER</Badge>
      </div>

      {error ? (
        <p className="notice" style={{ marginBottom: 16, borderLeftColor: "var(--red)" }}>
          {error}
        </p>
      ) : null}

      <section className="card">
        <header className="card-head">
          <h2>Registered users</h2>
          <Badge tone="muted">{users.length} user{users.length !== 1 ? "s" : ""}</Badge>
        </header>

        {!loaded ? (
          <p className="hint">Loading users…</p>
        ) : users.length === 0 ? (
          <p className="hint">No users found.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.uid} style={{ opacity: u.active ? 1 : 0.5 }}>
                    <td>
                      {u.email || <span className="hint">no email</span>}
                      {isSelf(u.uid) ? (
                        <Badge tone="info" style={{ marginLeft: 8 }}>you</Badge>
                      ) : null}
                    </td>
                    <td>
                      <select
                        value={u.role}
                        disabled={isSelf(u.uid) || busy === u.uid}
                        onChange={(e) =>
                          changeRole(u.uid, e.target.value as UserRole)
                        }
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <Badge tone={u.active ? "ok" : "bad"}>
                        {u.active ? "ACTIVE" : "INACTIVE"}
                      </Badge>
                    </td>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {u.created_at
                        ? new Date(u.created_at).toLocaleDateString()
                        : "—"}
                    </td>
                    <td>
                      {isSelf(u.uid) ? (
                        <span className="hint">—</span>
                      ) : (
                        <button
                          className={`btn ${u.active ? "btn-danger" : "btn-primary"}`}
                          disabled={busy === u.uid}
                          onClick={() => toggleActive(u.uid, !u.active)}
                          style={{ fontSize: 12, padding: "5px 10px" }}
                        >
                          {busy === u.uid
                            ? "…"
                            : u.active
                              ? "Deactivate"
                              : "Activate"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="hint" style={{ marginTop: 14 }}>
          Owners can change any user&apos;s role and activate/deactivate accounts.
          You cannot modify your own role or deactivate yourself.
        </p>
      </section>
    </>
  );
}
