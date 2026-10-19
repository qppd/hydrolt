"use client";

export type BadgeTone = "ok" | "warn" | "bad" | "muted" | "info";

export default function Badge({
  tone = "muted",
  children,
}: {
  tone?: BadgeTone;
  children: React.ReactNode;
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
