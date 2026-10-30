"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Badge from "@/components/Badge";
import { DEMO_MODE, signUp } from "@/lib/firebase";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

function validateEmail(email: string): string | null {
  if (!email) return "Email is required.";
  if (!EMAIL_RE.test(email)) return "Enter a valid email address (e.g. you@example.com).";
  return null;
}

function validatePassword(password: string): string | null {
  if (!password) return "Password is required.";
  if (password.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters.`;
  return null;
}

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string; confirm?: string }>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);

    const emailNorm = email.trim();
    const emailError = validateEmail(emailNorm);
    const passwordError = validatePassword(password);
    const confirmError = !confirm
      ? "Please confirm your password."
      : confirm !== password
        ? "Passwords do not match."
        : undefined;

    const nextErrors = {
      email: emailError ?? undefined,
      password: passwordError ?? undefined,
      confirm: confirmError,
    };
    setErrors(nextErrors);
    if (emailError || passwordError || confirmError) return;

    setBusy(true);
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
  }

  const isDemo = DEMO_MODE;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Create your account</h1>
          <p>Sign up to monitor your grow system. You&apos;ll link a device right after.</p>
        </div>
        <Badge tone={isDemo ? "warn" : "ok"}>
          {isDemo ? "DEMO MODE — AUTH DISABLED" : "FIREBASE AUTH"}
        </Badge>
      </div>

      <section className="grid grid-1">
        <form className="card" onSubmit={handleSubmit} noValidate>
          <header className="card-head">
            <h2>Sign up</h2>
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
                autoComplete="new-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (errors.password) setErrors((p) => ({ ...p, password: undefined }));
                  if (errors.confirm) setErrors((p) => ({ ...p, confirm: undefined }));
                }}
                placeholder="At least 8 characters"
                aria-invalid={!!errors.password}
              />
              {errors.password ? <span className="field-error">{errors.password}</span> : null}
            </label>
            <label className="field">
              Confirm password
              <input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => {
                  setConfirm(e.target.value);
                  if (errors.confirm) setErrors((p) => ({ ...p, confirm: undefined }));
                }}
                placeholder="Repeat your password"
                aria-invalid={!!errors.confirm}
              />
              {errors.confirm ? <span className="field-error">{errors.confirm}</span> : null}
            </label>
          </div>

          <div className="btn-row" style={{ marginTop: 16 }}>
            <button className="btn btn-primary" type="submit" disabled={busy || isDemo}>
              {busy ? "Creating account..." : "Sign up"}
            </button>
          </div>

          {message ? <p className="notice" style={{ marginTop: 14 }}>{message}</p> : null}

          <p className="hint" style={{ marginTop: 14 }}>
            Already have an account? <Link href="/login">Sign in</Link> instead.
          </p>
        </form>
      </section>
    </>
  );
}
