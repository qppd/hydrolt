"use client";

import { useCallback, useEffect, useState } from "react";
import { DEMO_MODE, DEVICE_ID, supabase } from "./supabase";
import { DEMO_DEVICE_ID } from "./demo";

/**
 * Device pairing ("connect to the machine").
 *
 * After signing in, the user connects to their controller by entering its
 * unique device ID (the UUID in public.devices, printed on the device label
 * and shown on the serial monitor at boot). The ID is verified against the
 * devices table (RLS-protected) and then stored in localStorage so every
 * page reads telemetry for the connected machine.
 *
 * In demo mode the simulated device is always connected.
 */

const STORAGE_KEY = "hydrolt.deviceId";

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
  if (DEMO_MODE || !supabase()) {
    // Demo: accept the simulated device ID (or anything — show the sim).
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
  const { data, error } = await supabase()!
    .from("devices")
    .select("id,name,location,status,firmware_version")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data)
    throw new Error(
      "No device with that ID. Check the ID on the device label or serial monitor (115200 baud)."
    );
  window.localStorage.setItem(STORAGE_KEY, data.id);
  return data as PairedDevice;
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
