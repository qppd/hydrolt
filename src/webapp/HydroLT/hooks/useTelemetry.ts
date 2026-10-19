"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getAlerts,
  getDevice,
  getDeviceState,
  getLatestReading,
} from "@/lib/store";
import type { Alert, Device, DeviceState, SensorReading } from "@/lib/types";

export interface TelemetrySnapshot {
  reading: SensorReading | null;
  state: DeviceState | null;
  device: Device | null;
  alerts: Alert[];
  loading: boolean;
  error: string | null;
  lastUpdate: number | null;
  online: boolean;
  refresh: () => void;
}

/**
 * Polls device state every few seconds. Uses a plain interval instead of
 * WebSockets so the dashboard also works against the demo simulator, and
 * swaps to Supabase realtime when a real backend is connected.
 */
export function useTelemetry(intervalMs = 4000): TelemetrySnapshot {
  const [reading, setReading] = useState<SensorReading | null>(null);
  const [state, setState] = useState<DeviceState | null>(null);
  const [device, setDevice] = useState<Device | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(() => {
    Promise.all([getLatestReading(), getDeviceState(), getDevice(), getAlerts(true)])
      .then(([r, s, d, a]) => {
        if (!mounted.current) return;
        setReading(r);
        setState(s);
        setDevice(d);
        setAlerts(a);
        setLastUpdate(Date.now());
        setError(null);
      })
      .catch((e: unknown) => {
        if (!mounted.current) return;
        setError(e instanceof Error ? e.message : "Failed to reach the device backend");
      })
      .finally(() => mounted.current && setLoading(false));
  }, []);

  useEffect(() => {
    mounted.current = true;
    refresh();
    const id = setInterval(refresh, intervalMs);
    return () => {
      mounted.current = false;
      clearInterval(id);
    };
  }, [refresh, intervalMs]);

  const online =
    lastUpdate !== null &&
    Date.now() - lastUpdate < Math.max(intervalMs * 3, 12_000) &&
    device?.status !== "offline";

  return { reading, state, device, alerts, loading, error, lastUpdate, online, refresh };
}
