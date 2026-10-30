"use client";

import { useCallback, useEffect, useState } from "react";
import { DEMO_MODE, DEVICE_ID, fbAuth, fbDb } from "./firebase";
import { DEMO_DEVICE_ID } from "./demo";
import { useAuth } from "@/hooks/useAuth";

/**
 * Device pairing ("connect to the machine").
 *
 * The pairing is scoped to the signed-in account and persisted in TWO places:
 *  1. RTDB  `users/{uid}/deviceId`       — source of truth, survives browser
 *     switches and localStorage clears. Written by pairDevice (the user may
 *     write their own /users/{uid} record per the RTDB rules).
 *  2. RTDB  `devices/{id}/users/{uid}`   — device-side link record used by the
 *     owner's Users module (owners may read the whole list).
 *  3. localStorage `hydrolyt.deviceId.<uid>` — fast local cache.
 *
 * On app load the hook restores the account's device from RTDB if the local
 * cache is empty, and migrates the pre-account-scoping legacy key
 * (`hydrolyt.deviceId`) so existing users keep their pairing.
 */

const STORAGE_KEY = "hydrolyt.deviceId";
const LEGACY_STORAGE_KEY = "hydrolyt.deviceId";
const CHANGE_EVENT = "hydrolyt:devicechange";

function notifyDeviceChange() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGE_EVENT));
}

export interface PairedDevice {
  id: string;
  name: string | null;
  location: string | null;
  status: string | null;
  firmware_version: string | null;
}

/** localStorage key for the currently signed-in user (null when signed out). */
function scopedStorageKey(uid?: string | null): string | null {
  if (typeof window === "undefined") return null;
  if (DEMO_MODE) return STORAGE_KEY;
  const u = uid ?? fbAuth()?.currentUser?.uid;
  return u ? `${STORAGE_KEY}.${u}` : null;
}

export function getPairedDeviceId(): string | null {
  if (typeof window === "undefined") return null;
  if (DEMO_MODE) return DEMO_DEVICE_ID;
  const key = scopedStorageKey();
  if (!key) return null;
  return window.localStorage.getItem(key);
}

export function activeDeviceId(): string {
  return getPairedDeviceId() ?? (DEMO_MODE ? DEMO_DEVICE_ID : DEVICE_ID);
}

export function isPaired(): boolean {
  return getPairedDeviceId() !== null;
}

/**
 * Persist the account→device link server-side so the connection is remembered
 * even after the browser cache is gone. Writes the user's own record
 * (users/{uid}/deviceId) and the device-side link (devices/{id}/users/{uid}).
 */
async function persistLink(uid: string, id: string): Promise<void> {
  const d = fbDb();
  if (!d) return;
  const { ref, set } = await import("firebase/database");
  try {
    await set(ref(d, `users/${uid}/deviceId`), id);
  } catch (e) {
    console.warn("Failed to persist account device link", e);
  }
  try {
    const userRef = ref(d, `devices/${id}/users/${uid}`);
    const { get } = await import("firebase/database");
    const snap = await get(userRef);
    if (!snap.exists()) {
      await set(userRef, {
        linked_at: new Date().toISOString(),
        role: "owner",
      });
    }
  } catch (e) {
    console.warn("Failed to write device-side link", e);
  }
}

/** Remove the server-side account→device link. */
async function unpersistLink(uid: string, id: string): Promise<void> {
  const d = fbDb();
  if (!d) return;
  const { ref, remove } = await import("firebase/database");
  try {
    await remove(ref(d, `users/${uid}/deviceId`));
  } catch (e) {
    console.warn("Failed to clear account device link", e);
  }
  try {
    await remove(ref(d, `devices/${id}/users/${uid}`));
  } catch (e) {
    console.warn("Failed to clear device-side link", e);
  }
}

export async function pairDevice(rawId: string): Promise<PairedDevice> {
  const id = rawId.trim();
  if (!id) throw new Error("Enter the device ID.");
  if (DEMO_MODE || !fbDb()) {
    const device: PairedDevice = {
      id: DEMO_DEVICE_ID,
      name: "Greenhouse Controller (simulated)",
      location: "Greenhouse 4 × 5 m — 2 towers",
      status: "online",
      firmware_version: "0.1.0-demo",
    };
    window.localStorage.setItem(STORAGE_KEY, device.id);
    notifyDeviceChange();
    return device;
  }
  const auth = fbAuth();
  const uid = auth?.currentUser?.uid;
  const key = scopedStorageKey(uid);
  if (!uid || !key) throw new Error("Sign in to link a device.");

  const { ref, get } = await import("firebase/database");
  const snap = await get(ref(fbDb()!, `devices/${id}/info`));
  if (!snap.exists()) {
    const root = await get(ref(fbDb()!, `devices/${id}`));
    if (!root.exists())
      throw new Error("No device with that ID. Check the ID in the serial monitor at boot.");
  }
  const info = snap.val() ?? {};
  window.localStorage.setItem(key, id);
  // Remove the legacy global key once migrated to the account-scoped key.
  window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  notifyDeviceChange();

  await persistLink(uid, id);

  return {
    id,
    name: info.name ?? null,
    location: info.location ?? null,
    status: info.status ?? null,
    firmware_version: info.firmware_version ?? null,
  };
}

export function unpairDevice(): void {
  const deviceId = getPairedDeviceId();
  if (!deviceId) return;

  const auth = fbAuth();
  const uid = auth?.currentUser?.uid;
  if (uid) void unpersistLink(uid, deviceId);

  if (typeof window !== "undefined") {
    const key = scopedStorageKey(uid);
    if (key) window.localStorage.removeItem(key);
    notifyDeviceChange();
  }
}

export function usePairedDevice() {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const sync = () => setDeviceId(getPairedDeviceId());

    async function restoreFromServer() {
      const d = fbDb();
      if (!uid || DEMO_MODE || !d) {
        sync();
        setReady(true);
        return;
      }
      const local = getPairedDeviceId();
      if (local) {
        sync();
        setReady(true);
        return;
      }
      // No local pairing: try the account's persisted device link.
      try {
        const { ref, get } = await import("firebase/database");
        const snap = await get(ref(d, `users/${uid}/deviceId`));
        if (cancelled) return;
        if (snap.exists()) {
          const key = scopedStorageKey(uid);
          if (key) window.localStorage.setItem(key, String(snap.val()));
        } else {
          // Legacy pre-account-scoping key → adopt it for this account.
          const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
          if (legacy) {
            const key = scopedStorageKey(uid);
            if (key) {
              window.localStorage.setItem(key, legacy);
              window.localStorage.removeItem(LEGACY_STORAGE_KEY);
              void persistLink(uid, legacy);
            }
          }
        }
      } catch (e) {
        console.warn("Failed to restore device link", e);
      }
      if (cancelled) return;
      sync();
      setReady(true);
    }

    void restoreFromServer();
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      cancelled = true;
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [uid]); // re-sync whenever the signed-in account changes

  const pair = useCallback(async (rawId: string) => {
    const d = await pairDevice(rawId);
    setDeviceId(d.id);
    return d;
  }, []);

  const unpair = useCallback(() => {
    unpairDevice();
    setDeviceId(null);
  }, []);

  return { deviceId, ready, pair, unpair };
}
