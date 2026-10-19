"use client";

import { useCallback, useEffect, useState } from "react";
import Badge, { type BadgeTone } from "@/components/Badge";
import { useTelemetry } from "@/hooks/useTelemetry";
import { getEvents, getAlerts, resolveAlert } from "@/lib/store";
import type { Alert, DeviceEvent } from "@/lib/types";

const TONE: Record<Alert["severity"], BadgeTone> = {
  critical: "bad",
  warning: "warn",
  info: "info",
};

function ago(iso: string) {
  const ms = Date.now() - +new Date(iso);
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export default function AlertsPage() {
  const { device, online } = useTelemetry(6000);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [events, setEvents] = useState<DeviceEvent[]>([]);
  const [openOnly, setOpenOnly] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, e] = await Promise.all([getAlerts(false), getEvents(30)]);
      setAlerts(a);
      setEvents(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const shown = openOnly ? alerts.filter((a) => !a.resolved_at) : alerts;
  const openCount = alerts.filter((a) => !a.resolved_at).length;
  const critical = alerts.filter((a) => !a.resolved_at && a.severity === "critical").length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Alerts &amp; device health</h1>
          <p>
            Out-of-range readings, sensor faults, low flow, dosing problems and connectivity
            events raised by the controller.
          </p>
        </div>
        <div className="btn-row">
          <div className="seg">
            <button className={!openOnly ? "on" : ""} onClick={() => setOpenOnly(false)}>
              All
            </button>
            <button className={openOnly ? "on" : ""} onClick={() => setOpenOnly(true)}>
              Open ({openCount})
            </button>
          </div>
          <button className="btn" onClick={load}>
            Refresh
          </button>
        </div>
      </div>

      <section className="grid grid-stats">
        <article className={`stat ${critical ? "stat-bad" : "stat-ok"}`}>
          <header>
            <span className="stat-label">Open critical</span>
          </header>
          <div className="stat-value">{critical}</div>
        </article>
        <article className={`stat ${openCount ? "stat-warn" : "stat-ok"}`}>
          <header>
            <span className="stat-label">Open total</span>
          </header>
          <div className="stat-value">{openCount}</div>
        </article>
        <article className={`stat ${online ? "stat-ok" : "stat-bad"}`}>
          <header>
            <span className="stat-label">Connection</span>
          </header>
          <div className="stat-value" style={{ fontSize: 22, marginTop: 14 }}>
            {online ? "ONLINE" : "OFFLINE"}
          </div>
        </article>
        <article className="stat">
          <header>
            <span className="stat-label">Last seen</span>
          </header>
          <div className="stat-value" style={{ fontSize: 20, marginTop: 14 }}>
            {device?.last_seen_at ? ago(device.last_seen_at) : "—"}
          </div>
        </article>
      </section>

      <section className="section grid grid-2">
        <div className="card">
          <header className="card-head">
            <h2>Alert history</h2>
            <Badge tone={openCount ? "warn" : "ok"}>{openCount} open</Badge>
          </header>

          {loading ? <p className="hint">Loading…</p> : null}
          {!loading && shown.length === 0 ? (
            <p className="hint">No alerts match this filter.</p>
          ) : null}

          {shown.map((a) => (
            <article
              key={a.id}
              className={`alert-item sev-${a.severity} ${a.resolved_at ? "resolved" : ""}`}
            >
              <div className="alert-body">
                <div className="btn-row">
                  <Badge tone={TONE[a.severity]}>{a.severity.toUpperCase()}</Badge>
                  <span className="mono">{a.alert_type}</span>
                </div>
                <p>{a.message}</p>
                <div className="alert-meta">
                  <span>{ago(a.created_at)}</span>
                  <span>{new Date(a.created_at).toLocaleString()}</span>
                  <span>{a.resolved_at ? "resolved" : "open"}</span>
                </div>
              </div>
              {!a.resolved_at ? (
                <button
                  className="btn"
                  onClick={async () => {
                    await resolveAlert(a.id);
                    setAlerts((prev) =>
                      prev.map((x) =>
                        x.id === a.id ? { ...x, resolved_at: new Date().toISOString() } : x
                      )
                    );
                  }}
                >
                  Resolve
                </button>
              ) : null}
            </article>
          ))}
        </div>

        <div className="card">
          <header className="card-head">
            <h2>Device health</h2>
            <Badge tone={online ? "ok" : "bad"}>{device?.status ?? "unknown"}</Badge>
          </header>
          <dl className="kv">
            <dt>Device</dt>
            <dd>{device?.name ?? "—"}</dd>
            <dt>Firmware</dt>
            <dd className="mono">{device?.firmware_version ?? "—"}</dd>
            <dt>Last seen</dt>
            <dd>{device?.last_seen_at ? new Date(device.last_seen_at).toLocaleString() : "—"}</dd>
          </dl>

          <h3 style={{ margin: "18px 0 8px", fontSize: 14 }}>Recent events</h3>
          <div className="table-wrap" style={{ maxHeight: 300, overflowY: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Event</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td>{ago(e.created_at)}</td>
                    <td>
                      <Badge tone="muted">{e.event_type}</Badge>
                    </td>
                    <td className="wrap mono">{e.details ? JSON.stringify(e.details) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="hint">
            Offline behavior: if the controller disconnects, the ESP32 keeps running its local
            automation and safety checks, then replays events when it reconnects.
          </p>
        </div>
      </section>
    </>
  );
}
