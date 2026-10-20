import RequireAuth from "@/components/RequireAuth";

/**
 * Route group for authenticated pages (dashboard, history, controls, alerts).
 * URLs are unchanged — the "(app)" segment is invisible in the address bar.
 * RequireAuth redirects to /login (no session) or /connect (no device yet).
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <RequireAuth>{children}</RequireAuth>;
}
