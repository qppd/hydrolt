"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Badge from "@/components/Badge";
import { useAuth } from "@/hooks/useAuth";
import {
  DEMO_MODE,
  resendVerificationEmail,
  signIn,
  signOut,
  signUp,
} from "@/lib/firebase";

export default function LoginPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleAction(action: "signin" | "signup", e?: React.FormEvent) {
    if (e) e.preventDefault();
    const emailNorm = email.trim();
    if (!emailNorm || !password) {
      setMessage("Please enter both email and password.");
      return;
    }
    setBusy(true);
    setMessage(null);

    if (action === "signup") {
      const { error, needsConfirm } = await signUp(emailNorm, password);
      setBusy(false);
      if (error) {
        setMessage(error.message);
        return;
      }
      if (needsConfirm) {
        setMessage("Account created. Check your email to confirm, then sign in.");
        return;
      }
      // New accounts are never auto-connected: send them to /connect so they
      // must link a device ID themselves before the dashboard unlocks.
      setMessage("Account created and signed in. Link your device on the Connect page.");
      router.push("/connect");
      return;
    }

    const { error } = await signIn(emailNorm, password);
    setBusy(false);
    setMessage(error ? error.message : "Signed in. Opening Connect so you can link your device...");
    if (!error) router.push("/connect");
  }

  async function handleResend() {
    setBusy(true);
    setMessage(null);
    const { error } = await resendVerificationEmail();
    setBusy(false);
    setMessage(
      error
        ? `Could not send the email: ${error.message}`
        : "Verification email sent — check your inbox (and spam folder)."
    );
  }

  const isDemo = DEMO_MODE;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Sign in</h1>
        </div>
        <Badge tone={isDemo ? "warn" : "ok"}>
          {isDemo ? "DEMO MODE — AUTH DISABLED" : "FIREBASE AUTH"}
        </Badge>
      </div>

      <section className="grid grid-1">
        <form className="card" onSubmit={(e) => handleAction("signin", e)}>
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
            <button
              className="btn btn-primary"
              type="submit"
              disabled={busy || isDemo}
            >
              {busy ? "Signing in…" : "Sign in"}
            </button>
            <button
              className="btn"
              type="button"
              disabled={busy || isDemo}
              onClick={() => handleAction("signup")}
            >
              {busy ? "Creating account…" : "Sign up"}
            </button>
            {user ? (
              <button className="btn" type="button" onClick={() => signOut()}>
                Sign out
              </button>
            ) : null}
            {user ? (
              <button
                className="btn"
                type="button"
                disabled={busy}
                onClick={handleResend}
                title="Re-send the email verification link"
              >
                {busy ? "Sending..." : "Resend verification email"}
              </button>
            ) : null}
          </div>
          {message ? <p className="notice" style={{ marginTop: 14 }}>{message}</p> : null}
        </form>
      </section>
    </>
  );
}
