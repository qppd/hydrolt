"use client";

import { useEffect, useState } from "react";
import Badge from "@/components/Badge";
import { useTelemetry } from "@/hooks/useTelemetry";
import { getSettings, saveSettings, sendCommand } from "@/lib/store";
import type { ControlSettings, OpMode } from "@/lib/types";

interface Toast {
  text: string;
  ok: boolean;
}

export default function ControlsPage() {
  const { state, online } = useTelemetry(5000);
  const [settings, setSettings] = useState<ControlSettings | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getSettings().then(setSettings).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  const mode: OpMode = state?.mode ?? "auto";

  async function command(type: "pump" | "fan" | "misting" | "mode", value: boolean | string) {
    setBusy(true);
    const res = await sendCommand(type, { value });
    setBusy(false);
    setToast({
      text: `${type} → ${String(value)} · ${res.status}${res.note ? ` (${res.note})` : ""} · cmd ${res.id || "n/a"}`,
      ok: res.status !== "failed" && res.status !== "rejected",
    });
  }

  async function manualDose(which: "N" | "P" | "K") {
    setBusy(true);
    const res = await sendCommand("dose", { value: which, duration_ms: 3000 });
    setBusy(false);
    setToast({
      text: `dose ${which} → 3000 ms · ${res.status}${res.note ? ` (${res.note})` : ""} · cmd ${res.id || "n/a"}`,
      ok: res.status !== "failed" && res.status !== "rejected",
    });
  }

  async function submitSettings(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!settings) return;
    setBusy(true);
    try {
      if (settings.ph_min >= settings.ph_max) throw new Error("pH min must be below pH max");
      if (settings.ec_min >= settings.ec_max) throw new Error("EC min must be below EC max");
      if (settings.npk_n_min >= settings.npk_n_max) throw new Error("N min must be below N max");
      if (settings.npk_p_min >= settings.npk_p_max) throw new Error("P min must be below P max");
      if (settings.npk_k_min >= settings.npk_k_max) throw new Error("K min must be below K max");
      if (settings.dosing_max_runtime_s < 1 || settings.dosing_max_runtime_s > 60)
        throw new Error("Dosing max runtime must be 1–60 s (firmware hard limit)");
      if (settings.npk_dosing_max_runtime_s < 1 || settings.npk_dosing_max_runtime_s > 60)
        throw new Error("NPK dose max runtime must be 1–60 s (firmware hard limit)");
      if (settings.npk_dose_cooldown_s < 30 || settings.npk_dose_cooldown_s > 3600)
        throw new Error("NPK dose cooldown must be 30–3600 s (firmware hard limit)");

      const { device_id: _ignored, ...patch } = settings;
      const saved = await saveSettings(patch);
      const res = await sendCommand("settings", patch as unknown as Record<string, unknown>);
      setSettings(saved);
      setToast({
        text: `Settings saved · device ${res.status} · cmd ${res.id || "n/a"}`,
        ok: res.status !== "failed",
      });
    } catch (err) {
      setToast({ text: err instanceof Error ? err.message : "Save failed", ok: false });
    } finally {
      setBusy(false);
    }
  }

  const set = <K extends keyof ControlSettings>(k: K, v: ControlSettings[K]) =>
    setSettings((s) => (s ? { ...s, [k]: v } : s));

  const manual = mode === "manual";

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Controls &amp; settings</h1>
          <p>
            Remote operations are authenticated and acknowledged by the controller. Safety
            interlocks (sensor validity, flow limits, humidity limits) still apply in manual
            mode.
          </p>
        </div>
        <div className="status-row">
          <Badge tone={online ? "ok" : "bad"}>
            <span className="dot" /> {online ? "ONLINE" : "OFFLINE"}
          </Badge>
          <Badge tone={manual ? "warn" : "info"}>{manual ? "MANUAL" : "AUTO"}</Badge>
        </div>
      </div>

      <p className="interlock">
        Manual controls are unlocked only in <strong>MANUAL mode</strong>. In AUTO mode the
        ESP32 runs dosing, irrigation, fan and misting logic locally — switch modes below to
        take over.
      </p>

      <section className="section grid grid-2">
        <div className="card">
          <header className="card-head">
            <h2>Operating mode</h2>
          </header>
          <div className="seg" style={{ marginBottom: 14 }}>
            <button className={mode === "auto" ? "on" : ""} disabled={busy} onClick={() => command("mode", "auto")}>
              AUTO
            </button>
            <button className={mode === "manual" ? "on" : ""} disabled={busy} onClick={() => command("mode", "manual")}>
              MANUAL
            </button>
          </div>

          <ul className="device-list">
            <li className={state?.pump_on ? "on" : "off"}>
              <span className={`led ${state?.pump_on ? "led-on" : ""}`} />
              <span className="device-name">
                Irrigation pump
                <small>Interlock: stops on low flow after 10 s startup delay</small>
              </span>
              <button
                className="btn"
                disabled={!manual || busy}
                onClick={() => command("pump", !state?.pump_on)}
              >
                {state?.pump_on ? "Stop" : "Start"}
              </button>
            </li>
            <li className={state?.fan_on ? "on" : "off"}>
              <span className={`led ${state?.fan_on ? "led-on" : ""}`} />
              <span className="device-name">
                Exhaust fan
                <small>Interlock: min run/off times enforced</small>
              </span>
              <button
                className="btn"
                disabled={!manual || busy}
                onClick={() => command("fan", !state?.fan_on)}
              >
                {state?.fan_on ? "Stop" : "Start"}
              </button>
            </li>
            <li className={state?.misting_on ? "on" : "off"}>
              <span className={`led ${state?.misting_on ? "led-on" : ""}`} />
              <span className="device-name">
                Misting
                <small>Interlock: blocked above humidity limit; max run time applies</small>
              </span>
              <button
                className="btn"
                disabled={!manual || busy}
                onClick={() => command("misting", !state?.misting_on)}
              >
                {state?.misting_on ? "Stop" : "Start"}
              </button>
            </li>
          </ul>

          <p className="hint" style={{ marginTop: 14 }}>
            Manual NPK dose — a bounded 3 s burst on the matching peristaltic channel.
            Rejected unless the NPK probe is answering and the pH/EC readings are valid.
          </p>
          <div className="btn-row">
            <button className="btn" disabled={!manual || busy} onClick={() => manualDose("N")}>
              Dose N
            </button>
            <button className="btn" disabled={!manual || busy} onClick={() => manualDose("P")}>
              Dose P
            </button>
            <button className="btn" disabled={!manual || busy} onClick={() => manualDose("K")}>
              Dose K
            </button>
          </div>

          <p className="hint">
            Commands are queued in <span className="mono">control_commands</span> and shown
            with their execution status (pending → acknowledged / failed).
          </p>
        </div>

        <form className="card" onSubmit={submitSettings}>
          <header className="card-head">
            <h2>Setpoints &amp; limits</h2>
            <Badge tone="info">applies to device</Badge>
          </header>

          <div className="form-grid">
            <label className="field">
              pH minimum
              <input
                type="number"
                step="0.01"
                min="0"
                max="14"
                value={settings?.ph_min ?? ""}
                onChange={(e) => set("ph_min", Number(e.target.value))}
              />
            </label>
            <label className="field">
              pH maximum
              <input
                type="number"
                step="0.01"
                min="0"
                max="14"
                value={settings?.ph_max ?? ""}
                onChange={(e) => set("ph_max", Number(e.target.value))}
              />
            </label>
            <label className="field">
              EC min (mS/cm)
              <input
                type="number"
                step="0.01"
                min="0"
                value={settings?.ec_min ?? ""}
                onChange={(e) => set("ec_min", Number(e.target.value))}
              />
            </label>
            <label className="field">
              EC max (mS/cm)
              <input
                type="number"
                step="0.01"
                min="0"
                value={settings?.ec_max ?? ""}
                onChange={(e) => set("ec_max", Number(e.target.value))}
              />
            </label>
            <label className="field">
              Temperature setpoint (°C)
              <input
                type="number"
                step="0.5"
                min="10"
                max="50"
                value={settings?.temperature_setpoint ?? ""}
                onChange={(e) => set("temperature_setpoint", Number(e.target.value))}
              />
            </label>
            <label className="field">
              Fan hysteresis (°C)
              <input
                type="number"
                step="0.5"
                min="0.5"
                max="10"
                value={settings?.temperature_hysteresis ?? ""}
                onChange={(e) => set("temperature_hysteresis", Number(e.target.value))}
              />
            </label>
            <label className="field">
              Humidity limit (%RH)
              <input
                type="number"
                step="1"
                min="30"
                max="99"
                value={settings?.humidity_limit ?? ""}
                onChange={(e) => set("humidity_limit", Number(e.target.value))}
              />
            </label>
            <label className="field">
              Minimum flow (L/min)
              <input
                type="number"
                step="0.1"
                min="0"
                value={settings?.min_flow_rate ?? ""}
                onChange={(e) => set("min_flow_rate", Number(e.target.value))}
              />
            </label>
            <label className="field">
              Dosing max runtime (s)
              <input
                type="number"
                step="1"
                min="1"
                max="60"
                value={settings?.dosing_max_runtime_s ?? ""}
                onChange={(e) => set("dosing_max_runtime_s", Number(e.target.value))}
              />
            </label>
            <label className="field">
              Dosing cooldown (s)
              <input
                type="number"
                step="5"
                min="5"
                max="3600"
                value={settings?.dosing_cooldown_s ?? ""}
                onChange={(e) => set("dosing_cooldown_s", Number(e.target.value))}
              />
            </label>
            <label className="field">
              Max misting (s)
              <input
                type="number"
                step="10"
                min="10"
                max="900"
                value={settings?.misting_max_s ?? ""}
                onChange={(e) => set("misting_max_s", Number(e.target.value))}
              />
            </label>

            <h3 className="hint" style={{ gridColumn: "1 / -1", margin: "10px 0 0" }}>
              NPK targets &amp; dosing — measured by the RS485 NPK probe (mg/kg), never
              derived from pH or EC
            </h3>
            <label className="field">
              Nitrogen min (mg/kg)
              <input
                type="number"
                step="1"
                min="0"
                value={settings?.npk_n_min ?? ""}
                onChange={(e) => set("npk_n_min", Number(e.target.value))}
              />
            </label>
            <label className="field">
              Nitrogen max (mg/kg)
              <input
                type="number"
                step="1"
                min="0"
                value={settings?.npk_n_max ?? ""}
                onChange={(e) => set("npk_n_max", Number(e.target.value))}
              />
            </label>
            <label className="field">
              Phosphorus min (mg/kg)
              <input
                type="number"
                step="1"
                min="0"
                value={settings?.npk_p_min ?? ""}
                onChange={(e) => set("npk_p_min", Number(e.target.value))}
              />
            </label>
            <label className="field">
              Phosphorus max (mg/kg)
              <input
                type="number"
                step="1"
                min="0"
                value={settings?.npk_p_max ?? ""}
                onChange={(e) => set("npk_p_max", Number(e.target.value))}
              />
            </label>
            <label className="field">
              Potassium min (mg/kg)
              <input
                type="number"
                step="1"
                min="0"
                value={settings?.npk_k_min ?? ""}
                onChange={(e) => set("npk_k_min", Number(e.target.value))}
              />
            </label>
            <label className="field">
              Potassium max (mg/kg)
              <input
                type="number"
                step="1"
                min="0"
                value={settings?.npk_k_max ?? ""}
                onChange={(e) => set("npk_k_max", Number(e.target.value))}
              />
            </label>
            <label className="field">
              NPK dose max runtime (s)
              <input
                type="number"
                step="1"
                min="1"
                max="60"
                value={settings?.npk_dosing_max_runtime_s ?? ""}
                onChange={(e) => set("npk_dosing_max_runtime_s", Number(e.target.value))}
              />
            </label>
            <label className="field">
              NPK dose cooldown (s)
              <input
                type="number"
                step="30"
                min="30"
                max="3600"
                value={settings?.npk_dose_cooldown_s ?? ""}
                onChange={(e) => set("npk_dose_cooldown_s", Number(e.target.value))}
              />
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <input
                type="checkbox"
                checked={settings?.npk_dosing_enabled ?? false}
                onChange={(e) => set("npk_dosing_enabled", e.target.checked)}
              />{" "}
              Automatic NPK dosing (kill switch — uncheck to freeze N/P/K pumps and only
              monitor)
            </label>
          </div>

          <div className="btn-row" style={{ marginTop: 16 }}>
            <button className="btn btn-primary" type="submit" disabled={busy || !settings}>
              {busy ? "Saving…" : "Save & send to device"}
            </button>
            <button
              className="btn"
              type="button"
              disabled={busy}
              onClick={() => getSettings().then(setSettings)}
            >
              Reset
            </button>
          </div>

          <p className="notice" style={{ marginTop: 14 }}>
            Values are validated in the browser and re-validated on the ESP32. Out-of-range
            commands are rejected with a reason instead of being applied.
          </p>
        </form>
      </section>

      {toast ? (
        <div className="toast" style={{ borderColor: toast.ok ? undefined : "#ff6b6b" }}>
          {toast.text}
        </div>
      ) : null}
    </>
  );
}
