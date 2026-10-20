import type {
  Alert,
  ControlSettings,
  DeviceEvent,
  DeviceState,
  SensorReading,
} from "./types";

/**
 * Simulated device — used when Firebase is not configured (demo mode).
 *
 * The simulator mirrors the firmware's behavior closely enough for UI review:
 * pH/EC random-walk inside the configured bands, climate following a daily
 * curve, fan cycling with hysteresis, and occasional faults/alerts.
 */

export const DEMO_DEVICE_ID = "hydro-demo-01";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number, d = 2) => Number(v.toFixed(d));

function randomWalk(prev: number, step: number, lo: number, hi: number) {
  return clamp(prev + (Math.random() - 0.5) * step, lo, hi);
}

/** Deterministic-ish seeded history so charts look realistic on first load. */
export function seedHistory(minutes: number, intervalMinutes = 5): SensorReading[] {
  const now = Date.now();
  const points = Math.floor((minutes * 60_000) / (intervalMinutes * 60_000));
  const rows: SensorReading[] = [];
  let ph = 6.05;
  let ec = 1.95;
  let temp = 27.5;
  let hum = 72;
  let flow = 0;
  let npkN = 118;
  let npkP = 34;
  let npkK = 152;

  for (let i = points; i >= 0; i--) {
    const t = new Date(now - i * intervalMinutes * 60_000);
    const hour = t.getHours() + t.getMinutes() / 60;
    // daily temperature curve: warm 10:00–16:00
    const dayFactor = Math.sin(((hour - 8) / 24) * Math.PI * 2);
    temp = randomWalk(temp + dayFactor * 0.35, 0.6, 21, 36);
    hum = randomWalk(hum - dayFactor * 0.6, 2.5, 55, 92);
    ph = randomWalk(ph, 0.06, 5.3, 6.8);
    ec = randomWalk(ec, 0.05, 1.3, 2.6);
    // NPK drifts much more slowly than pH/EC (probe polls every 10 s on device)
    npkN = randomWalk(npkN, 3.5, 55, 205);
    npkP = randomWalk(npkP, 1.4, 12, 62);
    npkK = randomWalk(npkK, 4.5, 70, 255);
    // pump runs 6 min every 30 min
    const duty = (now - i * intervalMinutes * 60_000) % (30 * 60_000);
    flow = duty < 6 * 60_000 ? round(3.4 + (Math.random() - 0.5) * 0.5) : 0;

    rows.push({
      device_id: DEMO_DEVICE_ID,
      recorded_at: t.toISOString(),
      ph: round(ph),
      ec: round(ec),
      temperature: round(temp, 1),
      humidity: round(hum, 1),
      flow_rate: flow,
      npk_n: round(npkN, 1),
      npk_p: round(npkP, 1),
      npk_k: round(npkK, 1),
      source: "simulated",
    });
  }
  return rows;
}

class DemoDevice {
  started = Date.now();
  state: DeviceState = {
    device_id: DEMO_DEVICE_ID,
    pump_on: false,
    fan_on: false,
    misting_on: false,
    dosing_a_on: false,
    dosing_b_on: false,
    dosing_n_on: false,
    dosing_p_on: false,
    dosing_k_on: false,
    mode: "auto",
    updated_at: new Date().toISOString(),
  };

  settings: ControlSettings = {
    device_id: DEMO_DEVICE_ID,
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

  alerts: Alert[] = [
    {
      id: "a1",
      device_id: DEMO_DEVICE_ID,
      severity: "warning",
      alert_type: "dosing_no_response",
      message: "pH still slightly above target after the last dose — check formulation and probe calibration.",
      created_at: new Date(Date.now() - 1000 * 60 * 42).toISOString(),
      resolved_at: null,
    },
    {
      id: "a2",
      device_id: DEMO_DEVICE_ID,
      severity: "info",
      alert_type: "wifi_loss",
      message: "Wi-Fi dropped for 38 s. Local automation continued without interruption.",
      created_at: new Date(Date.now() - 1000 * 60 * 190).toISOString(),
      resolved_at: new Date(Date.now() - 1000 * 60 * 189).toISOString(),
    },
    {
      id: "a3",
      device_id: DEMO_DEVICE_ID,
      severity: "critical",
      alert_type: "low_flow",
      message: "Flow 0.80 L/min below minimum 2.00 L/min — irrigation pump stopped. Check tubing and filter.",
      created_at: new Date(Date.now() - 1000 * 60 * 60 * 9).toISOString(),
      resolved_at: new Date(Date.now() - 1000 * 60 * 60 * 8.8).toISOString(),
    },
    {
      id: "a4",
      device_id: DEMO_DEVICE_ID,
      severity: "warning",
      alert_type: "npk_k_low",
      message:
        "Potassium below target (mg/kg) — a bounded NPK burst was applied automatically and the reading returned to band after the mix cycle.",
      created_at: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
      resolved_at: new Date(Date.now() - 1000 * 60 * 60 * 4.7).toISOString(),
    },
  ];

  events: DeviceEvent[] = [
    { id: "e1", device_id: DEMO_DEVICE_ID, event_type: "boot", created_at: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString(), details: { reset_reason: 3 } },
    { id: "e2", device_id: DEMO_DEVICE_ID, event_type: "watchdog", created_at: new Date(Date.now() - 1000 * 60 * 60 * 25.9).toISOString(), details: { recovered: true } },
    { id: "e3", device_id: DEMO_DEVICE_ID, event_type: "db_loss", created_at: new Date(Date.now() - 1000 * 60 * 190).toISOString(), details: { reconnects: 1 } },
    { id: "e4", device_id: DEMO_DEVICE_ID, event_type: "sensor_fail", created_at: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(), details: { sensor: "ec" } },
  ];

  /** Live "latest" reading, derived from time so the dashboard keeps moving. */
  latest(): SensorReading {
    const elapsedMin = (Date.now() - this.started) / 60_000;
    const hour = new Date().getHours() + new Date().getMinutes() / 60;
    const dayFactor = Math.sin(((hour - 8) / 24) * Math.PI * 2);

    const ph = round(clamp(6.05 + Math.sin(elapsedMin / 7) * 0.18, 5.2, 6.9));
    const ec = round(clamp(1.95 + Math.sin(elapsedMin / 11 + 1) * 0.12, 1.2, 2.7));
    const temperature = round(clamp(27.8 + dayFactor * 3.2 + Math.sin(elapsedMin / 5) * 0.4, 20, 38), 1);
    const humidity = round(clamp(72 - dayFactor * 8 + Math.sin(elapsedMin / 9) * 3, 50, 95), 1);

    // irrigation duty: 6 min on / 24 min off
    const duty = (Date.now() - this.started) % (30 * 60_000);
    const pump_on = duty < 6 * 60_000;
    const flow_rate = pump_on ? round(3.4 + Math.sin(elapsedMin * 3) * 0.25) : 0;

    // NPK: slow drift, with occasional sub-band dips that trigger a bounded
    // burst on the matching peristaltic channel (mirrors firmware behaviour)
    const s = this.settings;
    const npk_n = round(clamp(118 + Math.sin(elapsedMin / 17) * 55, 45, 215), 1);
    const npk_p = round(clamp(34 + Math.sin(elapsedMin / 23 + 2) * 16, 10, 66), 1);
    const npk_k = round(clamp(152 + Math.sin(elapsedMin / 13 + 1) * 60, 60, 265), 1);
    const npkDoseAllowed = s.npk_dosing_enabled && pump_on;
    const doseWindow = Math.sin(elapsedMin * 4) > 0.9;
    const dosing_n_on = npkDoseAllowed && npk_n < s.npk_n_min && doseWindow;
    const dosing_p_on = npkDoseAllowed && npk_p < s.npk_p_min && doseWindow;
    const dosing_k_on = npkDoseAllowed && npk_k < s.npk_k_min && doseWindow;

    // environment logic mirrors the firmware
    const fan_on = temperature >= this.settings.temperature_setpoint;
    const misting_on = fan_on && humidity < this.settings.humidity_limit - 5 && pump_on === false && Math.sin(elapsedMin / 13) > 0.6;

    this.state = {
      ...this.state,
      pump_on,
      fan_on,
      misting_on,
      dosing_n_on,
      dosing_p_on,
      dosing_k_on,
      updated_at: new Date().toISOString(),
    };

    return {
      device_id: DEMO_DEVICE_ID,
      recorded_at: new Date().toISOString(),
      ph,
      ec,
      temperature,
      humidity,
      flow_rate,
      npk_n,
      npk_p,
      npk_k,
      source: "simulated",
    };
  }

  resolveAlert(id: string) {
    const a = this.alerts.find((x) => x.id === id);
    if (a && !a.resolved_at) a.resolved_at = new Date().toISOString();
  }
}

export const demo = new DemoDevice();
