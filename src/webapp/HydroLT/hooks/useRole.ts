"use client";

import { useEffect, useState } from "react";
import { useAuth } from "./useAuth";
import { DEMO_MODE, getUserRole } from "@/lib/firebase";
import type { UserRole } from "@/lib/types";

export interface RoleState {
  role: UserRole;
  isOwner: boolean;
  loading: boolean;
}

/**
 * Tracks the current user's role from /users/{uid}/role in RTDB.
 * In demo mode the user is always "owner" so the full UI is accessible.
 */
export function useRole(): RoleState {
  const { user, loading: authLoading } = useAuth();
  const [role, setRole] = useState<UserRole>("viewer");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (DEMO_MODE) {
      setRole("owner");
      setLoading(false);
      return;
    }
    if (authLoading) return;
    if (!user) {
      setRole("viewer");
      setLoading(false);
      return;
    }
    let cancelled = false;
    getUserRole(user.uid).then((r) => {
      if (!cancelled) {
        setRole(r);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [user, authLoading]);

  return { role, isOwner: role === "owner", loading };
}
