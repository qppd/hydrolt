import type { ReactNode } from "react";

interface StatCardProps {
  label: string;
  value: string;
  unit?: string;
  target?: string;
  status?: "ok" | "warn" | "bad" | "muted";
  icon?: ReactNode;
  footer?: ReactNode;
}

export default function StatCard({
  label,
  value,
  unit,
  target,
  status = "ok",
  icon,
  footer,
}: StatCardProps) {
  return (
    <article className={`stat stat-${status}`}>
      <header>
        <span className="stat-label">
          {icon ? <span className="stat-icon">{icon}</span> : null}
          {label}
        </span>
        {target ? <span className="stat-target">{target}</span> : null}
      </header>
      <div className="stat-value">
        {value}
        {unit ? <span className="stat-unit">{unit}</span> : null}
      </div>
      {footer ? <footer className="stat-footer">{footer}</footer> : null}
    </article>
  );
}
