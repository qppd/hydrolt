"use client";

import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { DEMO_MODE, signOut, supabase } from "@/lib/supabase";

export interface AuthState {
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

/**
 * Tracks the Supabase session. In demo mode there is no user and the hook
 * reports "signed in" implicitly (the app is open), so pages never redirect
 * to /login while previewing with simulated data.
 */
export function useAuth(): AuthState {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(!DEMO_MODE);

  useEffect(() => {
    const sb = supabase();
    if (!sb) return;

    sb.auth.getUser().then(({ data }) => {
      setUser(data.user ?? null);
      setLoading(false);
    });

    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const doSignOut = useCallback(async () => {
    await signOut();
    setUser(null);
  }, []);

  return { user, loading, signOut: doSignOut };
}
