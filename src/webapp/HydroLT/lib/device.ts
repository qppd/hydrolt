"use client";

import { useCallback, useEffect, useState } from "react";
import { DEMO_MODE, DEVICE_ID, fbAuth, fbDb } from "./firebase";
import { DEMO_DEVICE_ID } from "./demo";
import { useAuth } from "@/hooks/useAuth";

/**
 * Device pairing ("connect to the machine").
 *
 * The pairing is scoped to the signed-in account: each user links their own
 * device by entering its unique ID on /connect. localStorage keys are
 * per-user (`hydrolyt.deviceId.<uid>`), so a newly created account is NEVER
 * auto-connected to a device that a previous account on the same browser
 * paired — a fresh account must link a device ID itself.
 */

const STORAGE_KEY = "hydrolyt.deviceId";
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
function scopedStorageKey(): string | null {
  if (typeof window === "undefined") return null;
  if (DEMO_MODE) return STORAGE_KEY;
  const uid = fbAuth()?.currentUser?.uid;
  return uid ? `${STORAGE_KEY}.${uid}` : null;
}

export function getPairedDeviceId(): string | null {
  if (typeof window === "undefined") return null;
  if (DEMO_MODE) return DEMO_DEVICE_ID;
  const key = scopedStorageKey();
  return key ? window.localStorage.getItem(key) : null;
}

export function activeDeviceId(): string {
  return getPairedDeviceId() ?? (DEMO_MODE ? DEMO_DEVICE_ID : DEVICE_ID);
}

export function isPaired(): boolean {
  return getPairedDeviceId() !== null;
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
  const key = scopedStorageKey();
  if (!key) throw new Error("Sign in to link a device.");

  const { ref, get } = await import("firebase/database");
  const snap = await get(ref(fbDb()!, `devices/${id}/info`));
  if (!snap.exists()) {
    const root = await get(ref(fbDb()!, `devices/${id}`));
    if (!root.exists())
      throw new Error("No device with that ID. Check the ID in the serial monitor at boot.");
  }
  const info = snap.val() ?? {};
  window.localStorage.setItem(key, id);
  notifyDeviceChange();

  // Link current user to device
  try {
    const auth = fbAuth();
    if (auth?.currentUser) {
      const { set } = await import("firebase/database");
      const userRef = ref(fbDb()!, `devices/${id}/users/${auth.currentUser.uid}`);
      const userSnap = await get(userRef);
      if (!userSnap.exists()) {
        await set(userRef, {
          linked_at: new Date().toISOString(),
          role: "owner",
        });
      }
    }
  } catch (e) {
    console.warn("Failed to link user to device", e);
  }

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

  try {
    const auth = fbAuth();
    if (auth?.currentUser && fbDb()) {
      import("firebase/database").then(({ ref, get, remove }) => {
        const userRef = ref(fbDb()!, `devices/${deviceId}/users/${auth.currentUser!.uid}`);
        get(userRef).then((snap: any) => {
          if (snap.exists()) remove(userRef);
        }).catch(() => {});
      });
    }
  } catch (e) {
    console.warn("Failed to unlink user from device", e);
  }

  if (typeof window !== "undefined") {
    const key = scopedStorageKey();
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
    const sync = () => setDeviceId(getPairedDeviceId());
    sync();
    setReady(true);
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
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
