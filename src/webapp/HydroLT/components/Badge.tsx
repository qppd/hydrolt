"use client";

export type BadgeTone = "ok" | "warn" | "bad" | "muted" | "info";

export default function Badge({
  tone = "muted",
  children,
  style,
}: {
  tone?: BadgeTone;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return <span className={`badge badge-${tone}`} style={style}>{children}</span>;
}
