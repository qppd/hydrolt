"use client";

import { useCallback, useEffect, useState } from "react";
import { DEMO_MODE, DEVICE_ID, fbAuth, fbDb } from "./firebase";
import { DEMO_DEVICE_ID } from "./demo";

/**
 * Device pairing ("connect to the machine").
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

export function getPairedDeviceId(): string | null {
  if (typeof window === "undefined") return null;
  if (DEMO_MODE) return DEMO_DEVICE_ID;
  return window.localStorage.getItem(STORAGE_KEY);
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
  const { ref, get } = await import("firebase/database");
  const snap = await get(ref(fbDb()!, `devices/${id}/info`));
  if (!snap.exists()) {
    const root = await get(ref(fbDb()!, `devices/${id}`));
    if (!root.exists())
      throw new Error("No device with that ID. Check the ID in the serial monitor at boot.");
  }
  const info = snap.val() ?? {};
  window.localStorage.setItem(STORAGE_KEY, id);
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
    window.localStorage.removeItem(STORAGE_KEY);
    notifyDeviceChange();
  }
}

export function usePairedDevice() {
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
  }, []);

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
