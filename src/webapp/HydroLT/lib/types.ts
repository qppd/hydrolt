/**
 * Shared domain types — mirror the RTDB layout in docs/database-schema.md.
 */

export type Severity = "info" | "warning" | "critical";
export type OpMode = "auto" | "manual";
export type DeviceStatus = "online" | "offline" | "maintenance";
export type UserRole = "owner" | "operator" | "viewer";

export interface SensorReading {
  id?: string;
  device_id: string;
  recorded_at: string;
  ph: number | null;
  ec: number | null; // mS/cm
  temperature: number | null; // °C
  humidity: number | null; // %RH
  flow_rate: number | null; // L/min
  npk_n: number | null; // mg/kg — measured by the RS485 NPK probe
  npk_p: number | null; // mg/kg
  npk_k: number | null; // mg/kg
  source?: "device" | "simulated";
}

export interface Device {
  id: string;
  name: string;
  location?: string;
  status: DeviceStatus;
  firmware_version?: string | null;
  last_seen_at: string | null;
}

export interface DeviceState {
  device_id: string;
  pump_on: boolean;
  fan_on: boolean;
  misting_on: boolean;
  dosing_a_on?: boolean;
  dosing_b_on?: boolean;
  dosing_n_on?: boolean;
  dosing_p_on?: boolean;
  dosing_k_on?: boolean;
  mode: OpMode;
  updated_at: string;
}

export interface ControlSettings {
  device_id: string;
  ph_min: number;
  ph_max: number;
  ec_min: number;
  ec_max: number;
  temperature_setpoint: number;
  temperature_hysteresis: number;
  humidity_limit: number;
  min_flow_rate: number;
  dosing_cooldown_s: number;
  dosing_max_runtime_s: number;
  misting_max_s: number;
  npk_n_min: number;
  npk_n_max: number;
  npk_p_min: number;
  npk_p_max: number;
  npk_k_min: number;
  npk_k_max: number;
  npk_dosing_max_runtime_s: number;
  npk_dose_cooldown_s: number;
  npk_dosing_enabled: boolean;
}

export interface Alert {
  id: string;
  device_id: string;
  severity: Severity;
  alert_type: string;
  message: string;
  created_at: string;
  resolved_at: string | null;
}

export interface DeviceEvent {
  id: string;
  device_id: string;
  event_type: string;
  details?: Record<string, unknown>;
  created_at: string;
}

export type CommandType = "pump" | "fan" | "misting" | "mode" | "settings" | "dose" | "restart";
export type CommandStatus = "pending" | "sent" | "acknowledged" | "failed" | "rejected";

export interface ControlCommand {
  id: string;
  device_id: string;
  command_type: CommandType;
  payload: Record<string, unknown>;
  status: CommandStatus;
  created_at: string;
  executed_at?: string | null;
}

export interface Profile {
  id: string;
  full_name: string | null;
  role: UserRole;
}

/** Payload published by the ESP32 to hydro/{deviceId}/telemetry */
export interface TelemetryPayload {
  ts: number;
  ph?: number;
  ec?: number;
  temp?: number;
  hum?: number;
  npk_n?: number;
  npk_p?: number;
  npk_k?: number;
  flow: number;
  flags?: { ph: boolean; ec: boolean; climate: boolean; flow: boolean; npk?: boolean };
}
