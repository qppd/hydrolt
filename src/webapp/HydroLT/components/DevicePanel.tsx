"use client";

import Badge from "./Badge";
import type { DeviceState } from "@/lib/types";

/**
 * Read-only actuator status block for the dashboard.
 * Safety interlocks and manual controls live on /controls.
 */
export default function DevicePanel({ state, mode }: { state: DeviceState | null; mode: "auto" | "manual" }) {
  const items = [
    { key: "Irrigation pump", on: state?.pump_on ?? false, note: "220 V submersible" },
    { key: "Exhaust fan", on: state?.fan_on ?? false, note: "220 V ventilation" },
    { key: "Misting", on: state?.misting_on ?? false, note: "cooling assist" },
    { key: "Dosing pump A", on: state?.dosing_a_on ?? false, note: "pH-up / nutrient" },
    { key: "Dosing pump B", on: state?.dosing_b_on ?? false, note: "pH-down" },
    { key: "Dosing pump N", on: state?.dosing_n_on ?? false, note: "nitrogen source" },
    { key: "Dosing pump P", on: state?.dosing_p_on ?? false, note: "phosphorus source" },
    { key: "Dosing pump K", on: state?.dosing_k_on ?? false, note: "potassium source" },
  ];

  return (
    <section className="card">
      <header className="card-head">
        <h2>Device status</h2>
        <Badge tone={mode === "auto" ? "ok" : "warn"}>{mode === "auto" ? "AUTO" : "MANUAL"}</Badge>
      </header>

      <ul className="device-list">
        {items.map((it) => (
          <li key={it.key} className={it.on ? "on" : "off"}>
            <span className={`led ${it.on ? "led-on" : ""}`} aria-hidden />
            <span className="device-name">
              {it.key}
              <small>{it.note}</small>
            </span>
            <span className="device-state">{it.on ? "ON" : "OFF"}</span>
          </li>
        ))}
      </ul>

      <p className="hint">
        Local automation keeps running on the ESP32 even when this page is closed or the
        internet is down.
      </p>
    </section>
  );
}
