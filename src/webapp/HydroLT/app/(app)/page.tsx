"use client";

import { useEffect, useState } from "react";
import Badge from "@/components/Badge";
import DevicePanel from "@/components/DevicePanel";
import LineChart, { type ChartSeries } from "@/components/LineChart";
import StatCard from "@/components/StatCard";
import { useTelemetry } from "@/hooks/useTelemetry";
import { getReadings } from "@/lib/store";
import type { SensorReading } from "@/lib/types";

function fmtTime(iso: string | number | null) {
  if (!iso) return "—";
  const d = typeof iso === "number" ? new Date(iso) : new Date(iso);
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

type Status = "ok" | "warn" | "bad" | "muted";

function rangeStatus(v: number | null | undefined, lo: number, hi: number): Status {
  if (v == null || Number.isNaN(v)) return "muted";
  if (v < lo || v > hi) return "warn";
  return "ok";
}

export default function DashboardPage() {
  const { reading, state, device, alerts, loading, error, lastUpdate, online } =
    useTelemetry(4000);
  const [series, setSeries] = useState<ChartSeries[]>([]);
  const [npkSeries, setNpkSeries] = useState<ChartSeries[]>([]);

  useEffect(() => {
    let alive = true;
    getReadings("6h")
      .then((rows: SensorReading[]) => {
        if (!alive) return;
        setSeries([
          {
            name: "pH",
            color: "#35d39a",
            points: rows.map((r) => ({ t: +new Date(r.recorded_at), v: r.ph ?? NaN })),
          },
          {
            name: "EC (mS/cm)",
            color: "#4cc9f0",
            points: rows.map((r) => ({ t: +new Date(r.recorded_at), v: r.ec ?? NaN })),
          },
        ]);
        setNpkSeries([
          {
            name: "N",
            color: "#7aa2ff",
            points: rows.map((r) => ({ t: +new Date(r.recorded_at), v: r.npk_n ?? NaN })),
          },
          {
            name: "P",
            color: "#ffb648",
            points: rows.map((r) => ({ t: +new Date(r.recorded_at), v: r.npk_p ?? NaN })),
          },
          {
            name: "K",
            color: "#c792ea",
            points: rows.map((r) => ({ t: +new Date(r.recorded_at), v: r.npk_k ?? NaN })),
          },
        ]);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const r = reading;
  const phStatus = rangeStatus(r?.ph, 5.5, 6.5);
  const ecStatus = rangeStatus(r?.ec, 1.4, 2.5);
  const tempStatus: Status =
    r?.temperature == null ? "muted" : r.temperature >= 34 ? "warn" : "ok";
  const humStatus: Status =
    r?.humidity == null ? "muted" : r.humidity >= 85 ? "warn" : "ok";
  const flowStatus: Status =
    r?.flow_rate == null
      ? "muted"
      : state?.pump_on
        ? r.flow_rate >= 2
          ? "ok"
          : "bad"
        : "muted";
  const nStatus = rangeStatus(r?.npk_n, 80, 160);
  const pStatus = rangeStatus(r?.npk_p, 20, 50);
  const kStatus = rangeStatus(r?.npk_k, 100, 200);

  const last = alerts.find((a) => !a.resolved_at);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Greenhouse dashboard</h1>
          <p>
            Live monitoring of the two vertical melon towers — nutrient solution, climate,
            irrigation and actuator state.
          </p>
        </div>
        <div className="status-row">
          <Badge tone={online ? "ok" : "bad"}>
            <span className="dot" /> {online ? "DEVICE ONLINE" : "OFFLINE"}
          </Badge>
          <Badge tone={(state?.mode ?? "auto") === "auto" ? "info" : "warn"}>
            {(state?.mode ?? "auto") === "auto" ? "AUTO MODE" : "MANUAL MODE"}
          </Badge>
          <span title="Last successful update">
            Last update: {lastUpdate ? fmtTime(lastUpdate) : "—"}
          </span>
        </div>
      </div>

      {error ? <p className="interlock">Backend error: {error}</p> : null}
      {loading && !r ? <p className="hint">Loading sensor data…</p> : null}

      <section className="grid grid-stats">
        <StatCard
          label="pH"
          value={r?.ph != null ? r.ph.toFixed(2) : "—"}
          target="5.50 – 6.50"
          status={phStatus}
          footer={`Recorded ${fmtTime(r?.recorded_at ?? null)}`}
        />
        <StatCard
          label="EC"
          value={r?.ec != null ? r.ec.toFixed(2) : "—"}
          unit="mS/cm"
          target="1.40 – 2.50"
          status={ecStatus}
          footer="Conductivity only — NPK comes from the probe"
        />
        <StatCard
          label="Air temp"
          value={r?.temperature != null ? r.temperature.toFixed(1) : "—"}
          unit="°C"
          target="fan ≥ 28"
          status={tempStatus}
          footer="Fan on at setpoint, 2 °C hysteresis"
        />
        <StatCard
          label="Humidity"
          value={r?.humidity != null ? r.humidity.toFixed(0) : "—"}
          unit="%RH"
          target="limit 85"
          status={humStatus}
          footer="Misting blocked at/above limit"
        />
        <StatCard
          label="Water flow"
          value={r?.flow_rate != null ? r.flow_rate.toFixed(2) : "—"}
          unit="L/min"
          target="min 2.00"
          status={flowStatus}
          footer={state?.pump_on ? "Pump running" : "Pump idle"}
        />
        <StatCard
          label="Nitrogen (N)"
          value={r?.npk_n != null ? r.npk_n.toFixed(1) : "—"}
          unit="mg/kg"
          target="80 – 160"
          status={nStatus}
          footer={nStatus === "muted" ? "NPK probe offline or not fitted" : "RS485 NPK probe"}
        />
        <StatCard
          label="Phosphorus (P)"
          value={r?.npk_p != null ? r.npk_p.toFixed(1) : "—"}
          unit="mg/kg"
          target="20 – 50"
          status={pStatus}
          footer={pStatus === "muted" ? "NPK probe offline or not fitted" : "RS485 NPK probe"}
        />
        <StatCard
          label="Potassium (K)"
          value={r?.npk_k != null ? r.npk_k.toFixed(1) : "—"}
          unit="mg/kg"
          target="100 – 200"
          status={kStatus}
          footer={kStatus === "muted" ? "NPK probe offline or not fitted" : "RS485 NPK probe"}
        />
      </section>

      <section className="section grid grid-2">
        <DevicePanel state={state} mode={state?.mode ?? "auto"} />

        <section className="card">
          <header className="card-head">
            <h2>System health</h2>
            <Badge tone={device?.status === "online" ? "ok" : "bad"}>
              {device?.status ?? "unknown"}
            </Badge>
          </header>
          <dl className="kv">
            <dt>Controller</dt>
            <dd>{device?.name ?? "—"}</dd>
            <dt>Location</dt>
            <dd>{device?.location ?? "—"}</dd>
            <dt>Firmware</dt>
            <dd className="mono">{device?.firmware_version ?? "—"}</dd>
            <dt>Last seen</dt>
            <dd>{fmtTime(device?.last_seen_at ?? null)}</dd>
            <dt>Open alerts</dt>
            <dd>{alerts.length}</dd>
          </dl>
          {last ? (
            <p className="notice" style={{ marginTop: 14 }}>
              <strong>{last.alert_type}</strong> — {last.message}
            </p>
          ) : (
            <p className="hint">No open alerts. All monitored values are within limits.</p>
          )}
        </section>
      </section>

      <section className="section card">
        <header className="card-head">
          <h2>Recent trend — pH &amp; EC (last 6 hours)</h2>
          <a className="btn" href="/history">
            Open history
          </a>
        </header>
        <LineChart
          series={series}
          unit="pH / mS·cm⁻¹"
          thresholds={[
            { value: 6.5, label: "pH max 6.50" },
            { value: 5.5, label: "pH min 5.50" },
          ]}
        />
        <div className="legend">
          <span style={{ ["--c" as string]: "#35d39a" }}>pH</span>
          <span style={{ ["--c" as string]: "#4cc9f0" }}>EC (mS/cm)</span>
        </div>
      </section>

      <section className="section card">
        <header className="card-head">
          <h2>NPK trend (last 6 hours)</h2>
          <a className="btn" href="/history">
            Open history
          </a>
        </header>
        <LineChart series={npkSeries} unit="mg/kg (NPK probe)" yMin={0} />
        <div className="legend">
          <span style={{ ["--c" as string]: "#7aa2ff" }}>Nitrogen (target 80–160)</span>
          <span style={{ ["--c" as string]: "#ffb648" }}>Phosphorus (target 20–50)</span>
          <span style={{ ["--c" as string]: "#c792ea" }}>Potassium (target 100–200)</span>
        </div>

      </section>
    </>
  );
}
