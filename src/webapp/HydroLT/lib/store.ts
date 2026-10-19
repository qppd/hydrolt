import { DEMO_DEVICE_ID, demo, seedHistory } from "./demo";
import { DEMO_MODE, DEVICE_ID, supabase } from "./supabase";
import type {
  Alert,
  CommandStatus,
  CommandType,
  ControlSettings,
  Device,
  DeviceEvent,
  DeviceState,
  SensorReading,
} from "./types";

/**
 * Single data-access layer used by every page.
 *
 * Real mode  -> Supabase (PostgreSQL, RLS-protected).
 * Demo mode  -> in-memory simulated device (lib/demo.ts).
 *
 * Server-side ingestion (MQTT -> Supabase Edge Function) is what actually
 * writes telemetry and executes commands for the physical device; the browser
 * only inserts `control_commands` rows that are authorized by RLS.
 */

const deviceId = DEMO_MODE ? DEMO_DEVICE_ID : DEVICE_ID;

function fmt(d: Date) {
  return d.toISOString();
}

/* ------------------------------------------------------------------ device */

export async function getDevice(): Promise<Device> {
  if (DEMO_MODE || !supabase()) {
    return {
      id: DEMO_DEVICE_ID,
      name: "Greenhouse Controller",
      location: "Greenhouse 4 × 5 m — 2 towers",
      status: "online",
      firmware_version: "0.1.0-demo",
      last_seen_at: new Date().toISOString(),
    };
  }
  const { data, error } = await supabase()!
    .from("devices")
    .select("id,name,location,status,firmware_version,last_seen_at")
    .eq("id", deviceId)
    .single();
  if (error || !data) throw new Error(error?.message ?? "device not found");
  return data as Device;
}

/* --------------------------------------------------------------- readings */

export async function getLatestReading(): Promise<SensorReading> {
  if (DEMO_MODE || !supabase()) return demo.latest();
  const { data, error } = await supabase()!
    .from("sensor_readings")
    .select("*")
    .eq("device_id", deviceId)
    .order("recorded_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    return {
      device_id: deviceId,
      recorded_at: new Date().toISOString(),
      ph: null,
      ec: null,
      temperature: null,
      humidity: null,
      flow_rate: null,
      npk_n: null,
      npk_p: null,
      npk_k: null,
    };
  }
  return data[0] as SensorReading;
}

export type RangeKey = "6h" | "24h" | "7d" | "30d";

const RANGE_MS: Record<RangeKey, number> = {
  "6h": 6 * 3600_000,
  "24h": 24 * 3600_000,
  "7d": 7 * 24 * 3600_000,
  "30d": 30 * 24 * 3600_000,
};

const RANGE_MINUTES: Record<RangeKey, number> = {
  "6h": 5,
  "24h": 5,
  "7d": 30,
  "30d": 120,
};

export async function getReadings(range: RangeKey = "24h"): Promise<SensorReading[]> {
  if (DEMO_MODE || !supabase()) return seedHistory(RANGE_MS[range] / 60_000, RANGE_MINUTES[range]);
  const since = fmt(new Date(Date.now() - RANGE_MS[range]));
  const { data, error } = await supabase()!
    .from("sensor_readings")
    .select("*")
    .eq("device_id", deviceId)
    .gte("recorded_at", since)
    .order("recorded_at", { ascending: true })
    .limit(5000);
  if (error) throw new Error(error.message);
  return (data ?? []) as SensorReading[];
}

/* ------------------------------------------------------------------ state */

export async function getDeviceState(): Promise<DeviceState> {
  if (DEMO_MODE || !supabase()) {
    demo.latest(); // advance the simulation
    return demo.state;
  }
  const { data, error } = await supabase()!
    .from("device_states")
    .select("*")
    .eq("device_id", deviceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return data as DeviceState;
  return {
    device_id: deviceId,
    pump_on: false,
    fan_on: false,
    misting_on: false,
    mode: "auto",
    updated_at: new Date().toISOString(),
  };
}

/* --------------------------------------------------------------- settings */

/** Fallback limits used when a device has no saved settings row yet. */
export function defaultSettings(deviceIdValue: string = deviceId): ControlSettings {
  return {
    device_id: deviceIdValue,
    ph_min: 5.5,
    ph_max: 6.5,
    ec_min: 1.4,
    ec_max: 2.5,
    temperature_setpoint: 28,
    temperature_hysteresis: 2,
    humidity_limit: 85,
    min_flow_rate: 2,
    dosing_cooldown_s: 60,
    dosing_max_runtime_s: 20,
    misting_max_s: 120,
    npk_n_min: 80,
    npk_n_max: 160,
    npk_p_min: 20,
    npk_p_max: 50,
    npk_k_min: 100,
    npk_k_max: 200,
    npk_dosing_max_runtime_s: 5,
    npk_dose_cooldown_s: 300,
    npk_dosing_enabled: true,
  };
}

export async function getSettings(): Promise<ControlSettings> {
  if (DEMO_MODE || !supabase()) return demo.settings;
  const { data, error } = await supabase()!
    .from("control_settings")
    .select("*")
    .eq("device_id", deviceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ControlSettings) ?? defaultSettings();
}

export async function saveSettings(patch: Partial<ControlSettings>): Promise<ControlSettings> {
  if (DEMO_MODE || !supabase()) {
    demo.settings = { ...demo.settings, ...patch };
    return demo.settings;
  }
  const { data, error } = await supabase()!
    .from("control_settings")
    .upsert({ ...patch, device_id: deviceId, updated_at: new Date().toISOString() })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as ControlSettings;
}

/* ------------------------------------------------------------------ alerts */

export async function getAlerts(onlyOpen = false): Promise<Alert[]> {
  if (DEMO_MODE || !supabase()) {
    const rows = [...demo.alerts].sort(
      (a, b) => +new Date(b.created_at) - +new Date(a.created_at)
    );
    return onlyOpen ? rows.filter((a) => !a.resolved_at) : rows;
  }
  let q = supabase()!
    .from("alerts")
    .select("*")
    .eq("device_id", deviceId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (onlyOpen) q = q.is("resolved_at", null);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as Alert[];
}

export async function resolveAlert(id: string): Promise<void> {
  if (DEMO_MODE || !supabase()) {
    demo.resolveAlert(id);
    return;
  }
  const { error } = await supabase()!
    .from("alerts")
    .update({ resolved_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/* ------------------------------------------------------------------ events */

export async function getEvents(limit = 50): Promise<DeviceEvent[]> {
  if (DEMO_MODE || !supabase()) return demo.events;
  const { data, error } = await supabase()!
    .from("device_events")
    .select("*")
    .eq("device_id", deviceId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as DeviceEvent[];
}

/* ---------------------------------------------------------------- commands */

/**
 * Queue a remote command. In real mode this inserts into `control_commands`
 * (RLS restricts to owner/operator), which the server-side ingestion path
 * forwards to the device over MQTT; the device replies on .../ack.
 */
export async function sendCommand(
  type: CommandType,
  payload: Record<string, unknown>
): Promise<{ id: string; status: CommandStatus; note?: string }> {
  if (DEMO_MODE || !supabase()) {
    const id = `cmd-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
    applyDemoCommand(type, payload);
    return { id, status: "acknowledged", note: "demo device acknowledged" };
  }

  const { data: auth } = await supabase()!.auth.getSession();
  const { data, error } = await supabase()!
    .from("control_commands")
    .insert({
      device_id: deviceId,
      command_type: type,
      payload,
      status: "pending",
      created_by: auth.session?.user.id ?? null,
    })
    .select("id,status")
    .single();
  if (error) return { id: "", status: "failed", note: error.message };
  return { id: data.id, status: data.status as CommandStatus };
}

function applyDemoCommand(type: CommandType, payload: Record<string, unknown>) {
  const s = demo.state;
  const stamp = new Date().toISOString();
  switch (type) {
    case "pump":
      s.pump_on = Boolean(payload.value);
      break;
    case "fan":
      s.fan_on = Boolean(payload.value);
      break;
    case "misting":
      s.misting_on = Boolean(payload.value);
      break;
    case "mode":
      s.mode = payload.value === "manual" ? "manual" : "auto";
      break;
    case "settings":
      demo.settings = { ...demo.settings, ...(payload as Partial<ControlSettings>) };
      break;
    default:
      break;
  }
  s.updated_at = stamp;
}

/* -------------------------------------------------------------------- CSV */

export function readingsToCsv(rows: SensorReading[]): string {
  const header = "recorded_at,ph,ec,temperature,humidity,flow_rate,npk_n,npk_p,npk_k";
  const body = rows
    .map((r) =>
      [
        r.recorded_at,
        r.ph ?? "",
        r.ec ?? "",
        r.temperature ?? "",
        r.humidity ?? "",
        r.flow_rate ?? "",
        r.npk_n ?? "",
        r.npk_p ?? "",
        r.npk_k ?? "",
      ].join(",")
    )
    .join("\n");
  return `${header}\n${body}\n`;
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
