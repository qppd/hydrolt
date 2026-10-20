"use client";

import { useCallback, useEffect, useState } from "react";
import Badge from "@/components/Badge";
import LineChart, { type ChartSeries } from "@/components/LineChart";
import {
  downloadCsv,
  getEvents,
  getReadings,
  readingsToCsv,
  type RangeKey,
} from "@/lib/store";
import type { DeviceEvent, SensorReading } from "@/lib/types";

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "6h", label: "6 h" },
  { key: "24h", label: "24 h" },
  { key: "7d", label: "7 d" },
  { key: "30d", label: "30 d" },
];

export default function HistoryPage() {
  const [range, setRange] = useState<RangeKey>("24h");
  const [rows, setRows] = useState<SensorReading[]>([]);
  const [events, setEvents] = useState<DeviceEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [readings, evs] = await Promise.all([getReadings(range), getEvents(40)]);
      setRows(readings);
      setEvents(evs);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load history");
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    load();
  }, [load]);

  const t = (r: SensorReading) => +new Date(r.recorded_at);

  const series: ChartSeries[] = [
    { name: "pH", color: "#35d39a", points: rows.map((r) => ({ t: t(r), v: r.ph ?? NaN })) },
    { name: "EC", color: "#4cc9f0", points: rows.map((r) => ({ t: t(r), v: r.ec ?? NaN })) },
  ];
  const climate: ChartSeries[] = [
    { name: "Temp", color: "#ffb648", points: rows.map((r) => ({ t: t(r), v: r.temperature ?? NaN })) },
    { name: "Humidity", color: "#7aa2ff", points: rows.map((r) => ({ t: t(r), v: r.humidity ?? NaN })) },
  ];
  const flow: ChartSeries[] = [
    { name: "Flow", color: "#35d39a", points: rows.map((r) => ({ t: t(r), v: r.flow_rate ?? NaN })) },
  ];
  const npk: ChartSeries[] = [
    { name: "N", color: "#7aa2ff", points: rows.map((r) => ({ t: t(r), v: r.npk_n ?? NaN })) },
    { name: "P", color: "#ffb648", points: rows.map((r) => ({ t: t(r), v: r.npk_p ?? NaN })) },
    { name: "K", color: "#c792ea", points: rows.map((r) => ({ t: t(r), v: r.npk_k ?? NaN })) },
  ];

  const dateFmt = (d: number) =>
    new Date(d).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>History &amp; reports</h1>
          <p>
            Timestamped sensor readings, device activity and fault events. Export the current
            range as CSV for record-keeping.
          </p>
        </div>
        <div className="btn-row">
          <div className="seg">
            {RANGES.map((r) => (
              <button
                key={r.key}
                className={range === r.key ? "on" : undefined}
                onClick={() => setRange(r.key)}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button
            className="btn btn-primary"
            disabled={rows.length === 0}
            onClick={() =>
              downloadCsv(`hydrolyt-${range}-${new Date().toISOString().slice(0, 10)}.csv`, readingsToCsv(rows))
            }
          >
            Download CSV ({rows.length})
          </button>
        </div>
      </div>

      {error ? <p className="interlock">{error}</p> : null}
      {loading ? <p className="hint">Loading readings…</p> : null}

      <section className="card">
        <header className="card-head">
          <h2>Nutrient solution</h2>
          <Badge tone="info">pH · EC</Badge>
        </header>
        <LineChart
          series={series}
          unit="pH / mS·cm⁻¹"
          formatX={dateFmt}
          thresholds={[
            { value: 6.5, label: "pH max" },
            { value: 5.5, label: "pH min" },
          ]}
        />
        <div className="legend">
          <span style={{ ["--c" as string]: "#35d39a" }}>pH</span>
          <span style={{ ["--c" as string]: "#4cc9f0" }}>EC (mS/cm)</span>
        </div>
      </section>

      <section className="card section">
        <header className="card-head">
          <h2>Greenhouse climate</h2>
          <Badge tone="info">°C · %RH</Badge>
        </header>
        <LineChart series={climate} unit="°C / %RH" formatX={dateFmt} />
        <div className="legend">
          <span style={{ ["--c" as string]: "#ffb648" }}>Temperature (°C)</span>
          <span style={{ ["--c" as string]: "#7aa2ff" }}>Humidity (%RH)</span>
        </div>
      </section>

      <section className="card section">
        <header className="card-head">
          <h2>Irrigation flow</h2>
          <Badge tone="info">L/min</Badge>
        </header>
        <LineChart
          series={flow}
          unit="L/min"
          yMin={0}
          formatX={dateFmt}
          thresholds={[{ value: 2, label: "min flow 2.00" }]}
        />
      </section>

      <section className="card section">
        <header className="card-head">
          <h2>NPK nutrition</h2>
          <Badge tone="info">mg/kg · RS485 probe</Badge>
        </header>
        <LineChart series={npk} unit="mg/kg" yMin={0} formatX={dateFmt} />
        <div className="legend">
          <span style={{ ["--c" as string]: "#7aa2ff" }}>Nitrogen (80–160)</span>
          <span style={{ ["--c" as string]: "#ffb648" }}>Phosphorus (20–50)</span>
          <span style={{ ["--c" as string]: "#c792ea" }}>Potassium (100–200)</span>
        </div>
      </section>

      <section className="section grid grid-2">
        <div className="card">
          <header className="card-head">
            <h2>Recent readings</h2>
            <Badge tone="muted">{rows.length} rows</Badge>
          </header>
          <div className="table-wrap" style={{ maxHeight: 340, overflowY: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>pH</th>
                  <th>EC</th>
                  <th>Temp</th>
                  <th>RH</th>
                  <th>Flow</th>
                  <th>N</th>
                  <th>P</th>
                  <th>K</th>
                </tr>
              </thead>
              <tbody>
                {[...rows]
                  .reverse()
                  .slice(0, 100)
                  .map((r, i) => (
                    <tr key={`${r.recorded_at}-${i}`}>
                      <td>{dateFmt(t(r))}</td>
                      <td>{r.ph ?? "—"}</td>
                      <td>{r.ec ?? "—"}</td>
                      <td>{r.temperature ?? "—"}</td>
                      <td>{r.humidity ?? "—"}</td>
                      <td>{r.flow_rate ?? "—"}</td>
                      <td>{r.npk_n ?? "—"}</td>
                      <td>{r.npk_p ?? "—"}</td>
                      <td>{r.npk_k ?? "—"}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <header className="card-head">
            <h2>Device events &amp; faults</h2>
            <Badge tone="muted">{events.length}</Badge>
          </header>
          <div className="table-wrap" style={{ maxHeight: 340, overflowY: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Event</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td>{dateFmt(+new Date(e.created_at))}</td>
                    <td>
                      <Badge
                        tone={
                          e.event_type.includes("fail") || e.event_type === "watchdog"
                            ? "warn"
                            : "muted"
                        }
                      >
                        {e.event_type}
                      </Badge>
                    </td>
                    <td className="wrap mono">
                      {e.details ? JSON.stringify(e.details) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}
