"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DEMO_MODE } from "@/lib/supabase";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/history", label: "History" },
  { href: "/controls", label: "Controls" },
  { href: "/alerts", label: "Alerts" },
  { href: "/login", label: "Sign in" },
];

export default function Nav() {
  const pathname = usePathname();
  return (
    <header className="nav">
      <div className="nav-inner">
        <Link href="/" className="brand">
          <span className="brand-mark">◗</span>
          <span>
            HYDROLYT <small>HydroLT</small>
          </span>
        </Link>

        <nav className="nav-links">
          {LINKS.map((l) => {
            const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
            return (
              <Link key={l.href} href={l.href} className={active ? "active" : undefined}>
                {l.label}
              </Link>
            );
          })}
        </nav>

        <span className={`mode-chip ${DEMO_MODE ? "warn" : ""}`}>
          {DEMO_MODE ? "DEMO DATA" : "LIVE"}
        </span>
      </div>
    </header>
  );
}
