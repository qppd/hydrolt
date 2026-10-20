"use client";

import { useCallback, useEffect, useState } from "react";
import { DEMO_MODE, fbAuth, signOut } from "@/lib/firebase";

export interface AuthUser {
  uid: string;
  email: string | null;
}

export interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

/**
 * Tracks the Firebase Auth session. In demo mode there is no user and the
 * hook reports "signed in" implicitly (the app is open), so pages never
 * redirect to /login while previewing with simulated data.
 */
export function useAuth(): AuthState {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(!DEMO_MODE);

  useEffect(() => {
    const a = fbAuth();
    if (!a) return;
    let unsub = () => {};
    let cancelled = false;

    import("firebase/auth").then(({ onAuthStateChanged }) => {
      if (cancelled) return;
      unsub = onAuthStateChanged(a, (u) => {
        setUser(u ? { uid: u.uid, email: u.email } : null);
        setLoading(false);
      });
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  const doSignOut = useCallback(async () => {
    await signOut();
    setUser(null);
  }, []);

  return { user, loading, signOut: doSignOut };
}
