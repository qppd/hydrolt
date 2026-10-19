"use client";

import { useState } from "react";
import Badge from "@/components/Badge";
import { DEMO_MODE } from "@/lib/supabase";
import { signIn, signOut } from "@/lib/supabase";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const { error } = await signIn(email.trim(), password);
    setBusy(false);
    setMessage(error ? error.message : "Signed in — returning to the dashboard…");
    if (!error) window.location.href = "/";
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Sign in</h1>
          <p>
            The dashboard and device controls are protected by authenticated accounts.
            Roles: <strong>owner</strong> and <strong>operator</strong> can change settings
            and issue commands; <strong>viewer</strong> can only read data.
          </p>
        </div>
        <Badge tone={DEMO_MODE ? "warn" : "ok"}>
          {DEMO_MODE ? "DEMO MODE — AUTH DISABLED" : "SUPABASE AUTH"}
        </Badge>
      </div>

      <section className="grid grid-2">
        <form className="card" onSubmit={submit}>
          <header className="card-head">
            <h2>Account</h2>
          </header>
          <div className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
            <label className="field">
              Email
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </label>
            <label className="field">
              Password
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </label>
          </div>
          <div className="btn-row" style={{ marginTop: 16 }}>
            <button className="btn btn-primary" type="submit" disabled={busy || DEMO_MODE}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
            <button className="btn" type="button" onClick={() => signOut()}>
              Sign out
            </button>
          </div>
          {message ? <p className="notice" style={{ marginTop: 14 }}>{message}</p> : null}
        </form>

        <div className="card">
          <header className="card-head">
            <h2>Access control (FR-12)</h2>
          </header>
          <dl className="kv">
            <dt>Provider</dt>
            <dd>Supabase Auth (email / password)</dd>
            <dt>Roles</dt>
            <dd>owner · operator · viewer</dd>
            <dt>Enforcement</dt>
            <dd>PostgreSQL RLS + server-side command path</dd>
            <dt>Device keys</dt>
            <dd>stored as hashes only</dd>
          </dl>
          <p className="hint">
            Configure <span className="mono">NEXT_PUBLIC_SUPABASE_URL</span> and{" "}
            <span className="mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</span> in{" "}
            <span className="mono">.env.local</span> to enable real sign-in. See
            docs/setup.md §3.
          </p>
          <p className="hint">
            The ESP32 never exposes a public control endpoint: commands travel
            app → <span className="mono">control_commands</span> → server-side ingestion →
            MQTT → device, and the device validates every payload.
          </p>
        </div>
      </section>
    </>
  );
}
