"use client";

import { useMemo } from "react";

export interface ChartSeries {
  name: string;
  color: string;
  points: { t: number; v: number }[];
}

interface LineChartProps {
  series: ChartSeries[];
  height?: number;
  unit?: string;
  yMin?: number;
  yMax?: number;
  thresholds?: { value: number; label: string }[];
  formatX?: (t: number) => string;
}

/**
 * Dependency-free SVG line chart (keeps the app installable without a chart
 * library). Handles gaps as path breaks, y-axis padding, time axis ticks and
 * optional threshold guides.
 */
export default function LineChart({
  series,
  height = 220,
  unit = "",
  yMin,
  yMax,
  thresholds = [],
  formatX,
}: LineChartProps) {
  const width = 720;
  const pad = { top: 14, right: 16, bottom: 26, left: 46 };

  const bounds = useMemo(() => {
    const all = series.flatMap((s) => s.points.map((p) => p.v)).filter((v) => Number.isFinite(v));
    if (all.length === 0) return { min: 0, max: 1, t0: 0, t1: 1 };
    const lo = yMin ?? Math.min(...all);
    const hi = yMax ?? Math.max(...all);
    const spread = Math.max(hi - lo, 1e-6);
    const times = series.flatMap((s) => s.points.map((p) => p.t));
    return {
      min: yMin ?? lo - spread * 0.1,
      max: yMax ?? hi + spread * 0.1,
      t0: Math.min(...times),
      t1: Math.max(...times),
    };
  }, [series, yMin, yMax]);

  const x = (t: number) =>
    pad.left +
    ((t - bounds.t0) / Math.max(bounds.t1 - bounds.t0, 1)) *
      (width - pad.left - pad.right);
  const y = (v: number) =>
    pad.top +
    (1 - (v - bounds.min) / Math.max(bounds.max - bounds.min, 1e-6)) *
      (height - pad.top - pad.bottom);

  const xTicks = useMemo(() => {
    const n = 5;
    return Array.from({ length: n }, (_, i) => bounds.t0 + ((bounds.t1 - bounds.t0) * i) / (n - 1));
  }, [bounds]);

  const fmt = formatX ?? ((t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));

  if (series.every((s) => s.points.length === 0)) {
    return <div className="chart-empty">No data in this range.</div>;
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="chart"
      role="img"
      aria-label="sensor history chart"
      preserveAspectRatio="none"
    >
      {/* horizontal gridlines */}
      {[0, 0.25, 0.5, 0.75, 1].map((f) => {
        const v = bounds.min + (bounds.max - bounds.min) * f;
        return (
          <g key={f}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={y(v)}
              y2={y(v)}
              className="gridline"
            />
            <text x={pad.left - 8} y={y(v) + 4} className="axis-label" textAnchor="end">
              {v.toFixed(Math.abs(bounds.max - bounds.min) < 5 ? 2 : 1)}
            </text>
          </g>
        );
      })}

      {/* thresholds */}
      {thresholds.map((t) => (
        <g key={t.label}>
          <line
            x1={pad.left}
            x2={width - pad.right}
            y1={y(t.value)}
            y2={y(t.value)}
            className="threshold"
          />
          <text x={width - pad.right} y={y(t.value) - 5} className="threshold-label" textAnchor="end">
            {t.label}
          </text>
        </g>
      ))}

      {/* x axis */}
      {xTicks.map((t, i) => (
        <text key={i} x={x(t)} y={height - 8} className="axis-label" textAnchor="middle">
          {fmt(t)}
        </text>
      ))}

      {/* series */}
      {series.map((s) => (
        <polyline
          key={s.name}
          className="series"
          stroke={s.color}
          points={s.points.map((p) => `${x(p.t)},${y(p.v)}`).join(" ")}
          fill="none"
        />
      ))}

      {/* unit legend */}
      {unit ? (
        <text x={pad.left - 8} y={10} className="axis-label" textAnchor="end">
          {unit}
        </text>
      ) : null}
    </svg>
  );
}
