import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getDatabase, type Database } from "firebase/database";

/**
 * Firebase core: Auth (email/password) + Realtime Database.
 *
 * Demo mode = no Firebase env configured (or explicitly forced). The whole UI
 * works against the simulated device in lib/demo.ts so the dashboard can be
 * reviewed before the backend exists.
 */

const cfg = {
  apiKey: process.env.NEXT_PUBLIC_FB_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FB_AUTH_DOMAIN,
  databaseURL: process.env.NEXT_PUBLIC_FB_DATABASE_URL,
  projectId: process.env.NEXT_PUBLIC_FB_PROJECT_ID,
};
const forceDemo = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

export const DEMO_MODE = forceDemo || !cfg.apiKey || !cfg.databaseURL;

/** Fallback device ID used before the user connects a device (demo/kiosk). */
export const DEVICE_ID =
  process.env.NEXT_PUBLIC_DEVICE_ID ?? "hydro-demo-01";

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Database | null = null;

function init() {
  if (DEMO_MODE || app) return;
  app = initializeApp(cfg as Record<string, string>);
  auth = getAuth(app);
  db = getDatabase(app);
}

/** Firebase Auth instance, or null in demo mode. */
export function fbAuth(): Auth | null {
  if (DEMO_MODE) return null;
  init();
  return auth;
}

/** Firebase Realtime Database instance, or null in demo mode. */
export function fbDb(): Database | null {
  if (DEMO_MODE) return null;
  init();
  return db;
}

/* ------------------------------------------------------------------- auth */

export async function signIn(email: string, password: string) {
  const a = fbAuth();
  if (!a) return { error: new Error("Demo mode — authentication is disabled.") };
  try {
    const { signInWithEmailAndPassword } = await import("firebase/auth");
    await signInWithEmailAndPassword(a, email, password);
    return { error: null };
  } catch (e) {
    return { error: e instanceof Error ? e : new Error(String(e)) };
  }
}

/**
 * Create a new account. Firebase verifies the email in most configurations,
 * so the user may need to confirm before their first sign-in — `needsConfirm`
 * reports that case.
 */
export async function signUp(email: string, password: string) {
  const a = fbAuth();
  if (!a)
    return { error: new Error("Demo mode — authentication is disabled."), needsConfirm: false };
  try {
    const { createUserWithEmailAndPassword } = await import("firebase/auth");
    const cred = await createUserWithEmailAndPassword(a, email, password);
    // record the account + default role (RTDB rules restrict self-assignment
    // of privileged roles — see docs/database-schema.md)
    const d = fbDb();
    if (d && cred.user) {
      const { ref, set } = await import("firebase/database");
      await set(ref(d, `users/${cred.user.uid}`), {
        email,
        role: "viewer",
        active: true,
        created_at: new Date().toISOString(),
      });
    }
    const needsConfirm = !cred.user.emailVerified;
    return { error: null, needsConfirm };
  } catch (e) {
    return { error: e instanceof Error ? e : new Error(String(e)), needsConfirm: false };
  }
}

/** Currently signed-in user UID/email, or null. */
export async function getCurrentUser(): Promise<{ uid: string; email: string | null } | null> {
  const a = fbAuth();
  if (!a) return null;
  const u = a.currentUser;
  if (u) return { uid: u.uid, email: u.email };
  // one-shot session resolution for the first render
  const { onAuthStateChanged } = await import("firebase/auth");
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(a, (user) => {
      unsub();
      resolve(user ? { uid: user.uid, email: user.email } : null);
    });
  });
}

export async function signOut() {
  const a = fbAuth();
  if (!a) return;
  const { signOut: fbSignOut } = await import("firebase/auth");
  await fbSignOut(a);
}

/* --------------------------------------------------------------- user role */

import type { UserRole, UserRecord } from "./types";

/** Read the current user's role from /users/{uid}/role. */
export async function getUserRole(uid: string): Promise<UserRole> {
  const d = fbDb();
  if (!d) return "viewer";
  const { ref, get } = await import("firebase/database");
  const snap = await get(ref(d, `users/${uid}/role`));
  return snap.exists() ? (snap.val() as UserRole) : "viewer";
}

/** Read whether the current user is active. */
export async function getUserActive(uid: string): Promise<boolean> {
  const d = fbDb();
  if (!d) return true;
  const { ref, get } = await import("firebase/database");
  const snap = await get(ref(d, `users/${uid}/active`));
  return snap.exists() ? snap.val() === true : true;
}

/** List all users (owner only — RTDB rules must grant read on /users). */
export async function listUsers(): Promise<UserRecord[]> {
  const d = fbDb();
  if (!d) return [];
  const { ref, get } = await import("firebase/database");
  const snap = await get(ref(d, "users"));
  if (!snap.exists()) return [];
  const val = snap.val() as Record<string, Record<string, unknown>>;
  return Object.entries(val).map(([uid, v]) => ({
    uid,
    email: String(v.email ?? ""),
    role: (v.role as UserRole) ?? "viewer",
    active: v.active !== false, // default true for legacy users without the field
    created_at: String(v.created_at ?? ""),
  }));
}

/** Change a user's role (owner only). */
export async function setUserRole(uid: string, role: UserRole): Promise<void> {
  const d = fbDb();
  if (!d) throw new Error("Not connected to database");
  const { ref, update } = await import("firebase/database");
  await update(ref(d, `users/${uid}`), { role });
}

/** Activate / deactivate a user (owner only). */
export async function setUserActive(uid: string, active: boolean): Promise<void> {
  const d = fbDb();
  if (!d) throw new Error("Not connected to database");
  const { ref, update } = await import("firebase/database");
  await update(ref(d, `users/${uid}`), { active });
}
