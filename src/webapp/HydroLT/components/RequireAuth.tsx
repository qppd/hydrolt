"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { usePairedDevice } from "@/lib/device";
import { DEMO_MODE } from "@/lib/supabase";

/**
 * Route guard wrapping every page under app/(app).
 *
 * Flow: sign in / sign up  →  connect a device by its unique ID  →  dashboard.
 * - Not signed in        → redirected to /login
 * - Signed in, no device → redirected to /connect
 * - Demo mode            → no auth, simulated device is always "connected"
 */
export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { deviceId, ready: deviceReady } = usePairedDevice();
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    if (DEMO_MODE) {
      setAllowed(true);
      return;
    }
    if (loading || !deviceReady) return;
    if (!user) {
      setAllowed(false);
      router.replace("/login");
      return;
    }
    if (!deviceId) {
      setAllowed(false);
      router.replace("/connect");
      return;
    }
    setAllowed(true);
  }, [user, loading, deviceId, deviceReady, router]);

  if (DEMO_MODE) return <>{children}</>;
  if (!allowed) {
    return (
      <p className="hint" style={{ padding: "2rem 0" }}>
        {loading || !deviceReady ? "Checking your session…" : "Redirecting…"}
      </p>
    );
  }
  return <>{children}</>;
}
