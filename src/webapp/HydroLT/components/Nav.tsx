"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useRole } from "@/hooks/useRole";
import { usePairedDevice } from "@/lib/device";
import { DEMO_MODE } from "@/lib/firebase";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/history", label: "History" },
  { href: "/controls", label: "Controls" },
  { href: "/alerts", label: "Alerts" },
  { href: "/connect", label: "Connect" },
];

export default function Nav() {
  const pathname = usePathname();
  const { user, signOut } = useAuth();
  const { isOwner } = useRole();
  const { deviceId } = usePairedDevice();
  const authed = DEMO_MODE || !!user;

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
          {isOwner ? (
            <Link href="/users" className={pathname.startsWith("/users") ? "active" : undefined}>
              Users
            </Link>
          ) : null}
        </nav>

        <span className={`mode-chip ${DEMO_MODE ? "warn" : ""}`}>
          {DEMO_MODE ? "DEMO DATA" : deviceId ? "DEVICE LINKED" : "NO DEVICE"}
        </span>

        {authed ? (
          <span className="mode-chip" title={user?.email ?? undefined}>
            {user?.email ?? "demo user"}
          </span>
        ) : (
          <>
            <Link href="/login" className="mode-chip">
              Sign in
            </Link>
            <Link href="/signup" className="mode-chip">
              Sign up
            </Link>
          </>
        )}

        {authed ? (
          <button className="mode-chip" onClick={() => signOut()} title="Sign out">
            Sign out
          </button>
        ) : null}
      </div>
    </header>
  );
}
