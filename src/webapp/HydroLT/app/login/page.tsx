"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Badge from "@/components/Badge";
import { useAuth } from "@/hooks/useAuth";
import { DEMO_MODE, resendVerificationEmail, signIn, signOut } from "@/lib/firebase";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmail(email: string): string | null {
  if (!email) return "Email is required.";
  if (!EMAIL_RE.test(email)) return "Enter a valid email address (e.g. you@example.com).";
  return null;
}

export default function LoginPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);

    const emailNorm = email.trim();
    const emailError = validateEmail(emailNorm);
    const passwordError = !password ? "Password is required." : undefined;

    const nextErrors = { email: emailError ?? undefined, password: passwordError };
    setErrors(nextErrors);
    if (emailError || passwordError) return;

    setBusy(true);
    const { error } = await signIn(emailNorm, password);
    setBusy(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    setMessage("Signed in. Opening Connect so you can link your device...");
    router.push("/connect");
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
          <p>Access your grow system dashboard.</p>
        </div>
        <Badge tone={isDemo ? "warn" : "ok"}>
          {isDemo ? "DEMO MODE — AUTH DISABLED" : "FIREBASE AUTH"}
        </Badge>
      </div>

      <section className="grid grid-1">
        <form className="card" onSubmit={handleSubmit} noValidate>
          <header className="card-head">
            <h2>Account</h2>
          </header>

          <div className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
            <label className="field">
              Email
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (errors.email) setErrors((p) => ({ ...p, email: undefined }));
                }}
                placeholder="you@example.com"
                aria-invalid={!!errors.email}
              />
              {errors.email ? <span className="field-error">{errors.email}</span> : null}
            </label>
            <label className="field">
              Password
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (errors.password) setErrors((p) => ({ ...p, password: undefined }));
                }}
                placeholder="••••••••"
                aria-invalid={!!errors.password}
              />
              {errors.password ? <span className="field-error">{errors.password}</span> : null}
            </label>
          </div>

          <div className="btn-row" style={{ marginTop: 16 }}>
            <button className="btn btn-primary" type="submit" disabled={busy || isDemo}>
              {busy ? "Signing in..." : "Sign in"}
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

          <p className="hint" style={{ marginTop: 14 }}>
            Don&apos;t have an account? <Link href="/signup">Sign up</Link> instead.
          </p>
        </form>
      </section>
    </>
  );
}
