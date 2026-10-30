"use client";

import { useState } from "react";
import Badge from "@/components/Badge";
import { useAuth } from "@/hooks/useAuth";
import { DEMO_MODE, signIn, signOut, signUp } from "@/lib/firebase";

type Mode = "signin" | "signup";

export default function LoginPage() {
  const { user } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const emailNorm = email.trim();

    if (mode === "signup") {
      const { error, needsConfirm } = await signUp(emailNorm, password);
      setBusy(false);
      if (error) {
        setMessage(error.message);
        return;
      }
      if (needsConfirm) {
        setMessage("Account created. Check your email to confirm, then sign in.");
        setMode("signin");
        return;
      }
      setMessage("Account created and signed in — connecting a device next…");
      window.location.href = "/connect";
      return;
    }

    const { error } = await signIn(emailNorm, password);
    setBusy(false);
    setMessage(error ? error.message : "Signed in — continue to connect your device…");
    if (!error) window.location.href = "/connect";
  }

  const isDemo = DEMO_MODE;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{mode === "signup" ? "Create your account" : "Sign in"}</h1>
          <p>
            Create an account or sign in, then connect to your grow system using the
            controller&apos;s unique device ID. Roles: <strong>owner</strong> and{" "}
            <strong>operator</strong> can change settings and issue commands;{" "}
            <strong>viewer</strong> can only read data.
          </p>
        </div>
        <Badge tone={isDemo ? "warn" : "ok"}>
          {isDemo ? "DEMO MODE — AUTH DISABLED" : "FIREBASE AUTH"}
        </Badge>
      </div>

      <section className="grid grid-1">
        <form className="card" onSubmit={submit}>
          <header className="card-head">
            <h2>{mode === "signup" ? "Sign up" : "Account"}</h2>
          </header>

          <div className="btn-row" style={{ marginBottom: 16 }}>
            <button
              type="button"
              className={`btn ${mode === "signin" ? "btn-primary" : ""}`}
              onClick={() => { setMode("signin"); setMessage(null); }}
            >
              Sign in
            </button>
            <button
              type="button"
              className={`btn ${mode === "signup" ? "btn-primary" : ""}`}
              onClick={() => { setMode("signup"); setMessage(null); }}
            >
              Sign up
            </button>
          </div>

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
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                required
                minLength={mode === "signup" ? 8 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </label>
          </div>

          <div className="btn-row" style={{ marginTop: 16 }}>
            <button className="btn btn-primary" type="submit" disabled={busy || isDemo}>
              {busy
                ? mode === "signup" ? "Creating account…" : "Signing in…"
                : mode === "signup" ? "Create account" : "Sign in"}
            </button>
            {user ? (
              <button className="btn" type="button" onClick={() => signOut()}>
                Sign out
              </button>
            ) : null}
          </div>
          {message ? <p className="notice" style={{ marginTop: 14 }}>{message}</p> : null}

          <p className="hint" style={{ marginTop: 14 }}>
            {mode === "signup"
              ? "New here? Create an account above. Already have one? Switch to Sign in."
              : "No account yet? Switch to Sign up to create one."}
          </p>
        </form>

      </section>
    </>
  );
}
