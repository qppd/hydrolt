"use client";

import { useCallback, useEffect, useState } from "react";
import { DEMO_MODE, DEVICE_ID, fbDb } from "./firebase";
import { DEMO_DEVICE_ID } from "./demo";

/**
 * Device pairing ("connect to the machine").
 *
 * After signing in, the user connects to their controller by entering its
 * unique device ID (configured as DEVICE_ID in HydroLT.ino and printed on the
 * serial monitor at boot). The ID is verified against devices/{id}/info in
 * the Realtime Database and then stored in localStorage so every page reads
 * telemetry for that machine.
 *
 * In demo mode the simulated device is always connected.
 */

const STORAGE_KEY = "hydrolyt.deviceId";

export interface PairedDevice {
  id: string;
  name: string | null;
  location: string | null;
  status: string | null;
  firmware_version: string | null;
}

/** Currently connected device ID, or null when not paired yet. */
export function getPairedDeviceId(): string | null {
  if (typeof window === "undefined") return null;
  if (DEMO_MODE) return DEMO_DEVICE_ID;
  return window.localStorage.getItem(STORAGE_KEY);
}

/** Device ID used by the data layer: paired device, else env default. */
export function activeDeviceId(): string {
  return getPairedDeviceId() ?? (DEMO_MODE ? DEMO_DEVICE_ID : DEVICE_ID);
}

export function isPaired(): boolean {
  return getPairedDeviceId() !== null;
}

/**
 * Verify a device ID against the backend and remember it.
 * Throws with a friendly message when the device does not exist.
 */
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
    return device;
  }
  const { ref, get } = await import("firebase/database");
  const snap = await get(ref(fbDb()!, `devices/${id}/info`));
  if (!snap.exists()) {
    // fall back: firmware may not have written /info yet — the node itself
    // existing is enough proof the device is registered
    const root = await get(ref(fbDb()!, `devices/${id}`));
    if (!root.exists())
      throw new Error(
        "No device with that ID. Check the ID in the serial monitor at boot (115200 baud)."
      );
  }
  const info = snap.val() ?? {};
  window.localStorage.setItem(STORAGE_KEY, id);
  return {
    id,
    name: info.name ?? null,
    location: info.location ?? null,
    status: info.status ?? null,
    firmware_version: info.firmware_version ?? null,
  };
}

/** Forget the connected device (must connect again to see data). */
export function unpairDevice(): void {
  if (typeof window !== "undefined") window.localStorage.removeItem(STORAGE_KEY);
}

/** React hook: connected device + pair/unpair with re-render. */
export function usePairedDevice() {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setDeviceId(getPairedDeviceId());
    setReady(true);
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
