import { DEMO_DEVICE_ID, demo, seedHistory } from "./demo";
import { activeDeviceId } from "./device";
import { DEMO_MODE, fbDb } from "./firebase";
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
 * Real mode  -> Firebase Realtime Database (RTDB-security protected).
 * Demo mode  -> in-memory simulated device (lib/demo.ts).
 *
 * RTDB layout (mirrored by the firmware in HydroLT.ino):
 *   devices/{id}/info        { name, location, status, firmware_version }
 *   devices/{id}/telemetry   { ts, ph, ec, temp, hum, flow, npk_n, ... }
 *   devices/{id}/history     { <pushKey>: { ...same as telemetry... } }
 *   devices/{id}/state       { pump, fan, misting, mode, ... }
 *   devices/{id}/settings    { ph_min, ph_max, ... }
 *   devices/{id}/commands    { <pushKey>: { cmd, value, ... } }  (web -> device)
 *   devices/{id}/alerts      { <pushKey>: { severity, type, msg, resolved } }
 *   devices/{id}/events      { <pushKey>: { event, details, ts } }
 */

function deviceId(): string {
  return activeDeviceId();
}

function devicePath(...parts: string[]): string {
  return ["devices", deviceId(), ...parts].join("/");
}

/* ------------------------------------------------------ type adaptation */

/** Firmware telemetry JSON -> SensorReading */
function rowToReading(key: string, v: Record<string, unknown>): SensorReading {
  const ts = typeof v.ts === "number" && v.ts > 1700000000
    ? new Date(v.ts * 1000).toISOString()
    : typeof v.device_ms === "number"
      ? new Date(Date.now() - v.device_ms).toISOString()
      : new Date().toISOString();
  const num = (x: unknown): number | null =>
    typeof x === "number" && Number.isFinite(x) ? x : null;
  return {
    id: key,
    device_id: deviceId(),
    recorded_at: ts,
    ph: num(v.ph),
    ec: num(v.ec),
    temperature: num(v.temp),
    humidity: num(v.hum),
    flow_rate: num(v.flow),
    npk_n: num(v.npk_n),
    npk_p: num(v.npk_p),
    npk_k: num(v.npk_k),
    source: "device",
  };
}

/* ------------------------------------------------------------------ device */

export async function getDevice(): Promise<Device> {
  if (DEMO_MODE || !fbDb()) {
    return {
      id: DEMO_DEVICE_ID,
      name: "Greenhouse Controller",
      location: "Greenhouse 4 × 5 m — 2 towers",
      status: "online",
      firmware_version: "0.1.0-demo",
      last_seen_at: new Date().toISOString(),
    };
  }
  const { ref, get } = await import("firebase/database");
  const [infoSnap, statusSnap, teleSnap] = await Promise.all([
    get(ref(fbDb()!, devicePath("info"))),
    get(ref(fbDb()!, devicePath("status"))),
    get(ref(fbDb()!, devicePath("telemetry", "ts"))),
  ]);
  const info = infoSnap.val() ?? {};
  const status = statusSnap.val();
  const ts = teleSnap.val();
  return {
    id: deviceId(),
    name: info.name ?? "Greenhouse Controller",
    location: info.location ?? null,
    status: status === "online" ? "online" : "offline",
    firmware_version: info.firmware_version ?? null,
    last_seen_at:
      typeof ts === "number" && ts > 1700000000
        ? new Date(ts * 1000).toISOString()
        : null,
  };
}

/* --------------------------------------------------------------- readings */

export async function getLatestReading(): Promise<SensorReading> {
  if (DEMO_MODE || !fbDb()) return demo.latest();
  const { ref, get } = await import("firebase/database");
  const snap = await get(ref(fbDb()!, devicePath("telemetry")));
  if (!snap.exists()) {
    return {
      device_id: deviceId(),
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
  return rowToReading("latest", snap.val());
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
  if (DEMO_MODE || !fbDb()) return seedHistory(RANGE_MS[range] / 60_000, RANGE_MINUTES[range]);
  const { ref, get } = await import("firebase/database");
  const snap = await get(ref(fbDb()!, devicePath("history")));
  if (!snap.exists()) return [];
  const cutoff = Date.now() - RANGE_MS[range];
  const rows: SensorReading[] = [];
  const val = snap.val() as Record<string, Record<string, unknown>>;
  for (const [key, v] of Object.entries(val)) {
    const r = rowToReading(key, v);
    if (new Date(r.recorded_at).getTime() >= cutoff) rows.push(r);
  }
  rows.sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime());
  return rows;
}

/* ------------------------------------------------------------------ state */

export async function getDeviceState(): Promise<DeviceState> {
  if (DEMO_MODE || !fbDb()) {
    demo.latest(); // advance the simulation
    return demo.state;
  }
  const { ref, get } = await import("firebase/database");
  const snap = await get(ref(fbDb()!, devicePath("state")));
  const v = snap.val() ?? {};
  const num = (x: unknown) => (typeof x === "number" ? x : 0);
  return {
    device_id: deviceId(),
    pump_on: num(v.pump) === 1,
    fan_on: num(v.fan) === 1,
    misting_on: num(v.misting) === 1,
    dosing_a_on: num(v.doseA) === 1,
    dosing_b_on: num(v.doseB) === 1,
    dosing_n_on: num(v.doseN) === 1,
    dosing_p_on: num(v.doseP) === 1,
    dosing_k_on: num(v.doseK) === 1,
    mode: v.mode === "manual" ? "manual" : "auto",
    updated_at:
      typeof v.updated_at === "number" && v.updated_at > 1700000000
        ? new Date(v.updated_at * 1000).toISOString()
        : new Date().toISOString(),
  };
}

/* --------------------------------------------------------------- settings */

/** Fallback limits used when a device has no saved settings node yet. */
export function defaultSettings(deviceIdValue: string = deviceId()): ControlSettings {
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
  if (DEMO_MODE || !fbDb()) return demo.settings;
  const { ref, get } = await import("firebase/database");
  const snap = await get(ref(fbDb()!, devicePath("settings")));
  if (!snap.exists()) return defaultSettings();
  return { ...defaultSettings(), ...(snap.val() as Partial<ControlSettings>) };
}

export async function saveSettings(patch: Partial<ControlSettings>): Promise<ControlSettings> {
  if (DEMO_MODE || !fbDb()) {
    demo.settings = { ...demo.settings, ...patch };
    return demo.settings;
  }
  const { ref, update } = await import("firebase/database");
  const { device_id: _drop, ...rest } = patch;
  await update(ref(fbDb()!, devicePath("settings")), rest);
  return getSettings();
}

/* ------------------------------------------------------------------ alerts */

export async function getAlerts(onlyOpen = false): Promise<Alert[]> {
  if (DEMO_MODE || !fbDb()) {
    const rows = [...demo.alerts].sort(
      (a, b) => +new Date(b.created_at) - +new Date(a.created_at)
    );
    return onlyOpen ? rows.filter((a) => !a.resolved_at) : rows;
  }
  const { ref, get } = await import("firebase/database");
  const snap = await get(ref(fbDb()!, devicePath("alerts")));
  if (!snap.exists()) return [];
  const val = snap.val() as Record<string, Record<string, unknown>>;
  const rows: Alert[] = Object.entries(val).map(([key, v]) => ({
    id: key,
    device_id: deviceId(),
    severity: (v.severity as Alert["severity"]) ?? "info",
    alert_type: String(v.type ?? "unknown"),
    message: String(v.msg ?? ""),
    created_at:
      typeof v.ts === "number" && v.ts > 1700000000
        ? new Date(v.ts * 1000).toISOString()
        : new Date().toISOString(),
    resolved_at: v.resolved === true ? new Date().toISOString() : null,
  }));
  rows.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
  return onlyOpen ? rows.filter((a) => !a.resolved_at) : rows;
}

export async function resolveAlert(id: string): Promise<void> {
  if (DEMO_MODE || !fbDb()) {
    demo.resolveAlert(id);
    return;
  }
  const { ref, update } = await import("firebase/database");
  await update(ref(fbDb()!, devicePath("alerts", id)), {
    resolved: true,
    resolved_at: new Date().toISOString(),
  });
}

/* ------------------------------------------------------------------ events */

export async function getEvents(limit = 50): Promise<DeviceEvent[]> {
  if (DEMO_MODE || !fbDb()) return demo.events;
  const { ref, get } = await import("firebase/database");
  const snap = await get(ref(fbDb()!, devicePath("events")));
  if (!snap.exists()) return [];
  const val = snap.val() as Record<string, Record<string, unknown>>;
  const rows: DeviceEvent[] = Object.entries(val).map(([key, v]) => ({
    id: key,
    device_id: deviceId(),
    event_type: String(v.event ?? "unknown"),
    details: (typeof v.details === "string" ? { info: v.details } : v.details ?? {}) as Record<string, unknown>,
    created_at:
      typeof v.ts === "number" && v.ts > 1700000000
        ? new Date(v.ts * 1000).toISOString()
        : new Date().toISOString(),
  }));
  rows.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
  return rows.slice(0, limit);
}

/* ---------------------------------------------------------------- commands */

/**
 * Queue a remote command. In real mode this pushes a node under
 * devices/{id}/commands; the firmware's RTDB stream picks it up, validates and
 * executes it, writes an ack, then removes the node.
 */
export async function sendCommand(
  type: CommandType,
  payload: Record<string, unknown>
): Promise<{ id: string; status: CommandStatus; note?: string }> {
  if (DEMO_MODE || !fbDb()) {
    const id = `cmd-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
    applyDemoCommand(type, payload);
    return { id, status: "acknowledged", note: "demo device acknowledged" };
  }

  const { ref, push, set } = await import("firebase/database");
  const cmdRef = push(ref(fbDb()!, devicePath("commands")));
  const body: Record<string, unknown> = {
    cmd: type,
    id: cmdRef.key,
    created_at: new Date().toISOString(),
    ...payload,
  };
  const { getCurrentUser } = await import("./firebase");
  const user = await getCurrentUser();
  if (user) body.created_by = user.uid;
  await set(cmdRef, body);
  return { id: cmdRef.key ?? "", status: "pending", note: "sent to device" };
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
