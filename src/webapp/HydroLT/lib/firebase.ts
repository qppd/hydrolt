import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth, type User } from "firebase/auth";
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
 * Send the email verification link to a user. Tries the app's own origin as
 * the continue URL first; if the Firebase project hasn't allowlisted that
 * domain yet (auth/unauthorized-continue-uri), falls back to Firebase's
 * default action URL so the email is still delivered.
 */
async function sendVerificationEmail(user: User) {
  const { sendEmailVerification } = await import("firebase/auth");
  const url =
    typeof window !== "undefined"
      ? `${window.location.origin}/login`
      : "https://hydrolyt.vercel.app/login";
  try {
    await sendEmailVerification(user, { url });
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === "auth/unauthorized-continue-uri") {
      // Domain not allowlisted in the Firebase console → use the default
      // action URL (always allowlisted) so the email still gets delivered.
      await sendEmailVerification(user);
    } else {
      throw e;
    }
  }
}

/**
 * Create a new account. Firebase verifies the email in most configurations,
 * so the user may need to confirm before their first sign-in — `needsConfirm`
 * reports that case. A verification email is sent right after account
 * creation (Firebase does NOT send one automatically from
 * `createUserWithEmailAndPassword`).
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
    if (needsConfirm && cred.user) {
      try {
        await sendVerificationEmail(cred.user);
      } catch (e) {
        console.warn("Failed to send verification email", e);
      }
    }
    return { error: null, needsConfirm };
  } catch (e) {
    return { error: e instanceof Error ? e : new Error(String(e)), needsConfirm: false };
  }
}

/** Re-send the email verification link to the signed-in user. */
export async function resendVerificationEmail(): Promise<{ error: Error | null }> {
  const a = fbAuth();
  if (!a) return { error: new Error("Demo mode — authentication is disabled.") };
  try {
    if (!a.currentUser) return { error: new Error("You are not signed in.") };
    await sendVerificationEmail(a.currentUser);
    return { error: null };
  } catch (e) {
    return { error: e instanceof Error ? e : new Error(String(e)) };
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

/** Get UIDs of users linked to a device. */
export async function getUserIdsForDevice(deviceId: string): Promise<string[]> {
  const d = fbDb();
  if (!d) return [];
  const { ref, get } = await import("firebase/database");
  const snap = await get(ref(d, `devices/${deviceId}/users`));
  if (!snap.exists()) return [];
  return Object.keys(snap.val() as Record<string, unknown>);
}

/** List all users connected to a specific device (owner only). */
export async function listUsersForDevice(deviceId: string): Promise<UserRecord[]> {
  const d = fbDb();
  if (!d) return [];
  const { ref, get } = await import("firebase/database");

  const userSnap = await get(ref(d, `devices/${deviceId}/users`));
  if (!userSnap.exists()) return [];

  const uidList = Object.keys(userSnap.val() as Record<string, unknown>);
  if (uidList.length === 0) return [];

  const promises = uidList.map(async (uid) => {
    const [roleSnap, activeSnap, emailSnap] = await Promise.all([
      get(ref(d, `users/${uid}/role`)),
      get(ref(d, `users/${uid}/active`)),
      get(ref(d, `users/${uid}/email`)),
    ]);
    return {
      uid,
      email: emailSnap.exists() ? String(emailSnap.val()) : "",
      role: roleSnap.exists() ? (roleSnap.val() as UserRole) : "viewer",
      active: activeSnap.exists() ? activeSnap.val() !== false : true,
      created_at: "",
    };
  });

  const results = await Promise.all(promises);
  results.sort((a, b) => {
    if (a.role === "owner" && b.role !== "owner") return -1;
    if (b.role === "owner" && a.role !== "owner") return 1;
    return a.email.localeCompare(b.email);
  });
  return results;
}
