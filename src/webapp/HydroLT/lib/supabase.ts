import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const forceDemo = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

/**
 * Demo mode = no Supabase configured (or explicitly forced). The whole UI works
 * against the simulated device in lib/demo.ts so the dashboard can be reviewed
 * before the backend exists.
 */
export const DEMO_MODE = forceDemo || !url || !anonKey;

export const DEVICE_ID =
  process.env.NEXT_PUBLIC_DEVICE_ID ?? "hydro-demo-01";

let client: SupabaseClient | null = null;

/** Returns the Supabase browser client, or null when running in demo mode. */
export function supabase(): SupabaseClient | null {
  if (DEMO_MODE) return null;
  if (!client) client = createClient(url as string, anonKey as string);
  return client;
}

export async function signIn(email: string, password: string) {
  const sb = supabase();
  if (!sb) return { error: new Error("Demo mode — authentication is disabled.") };
  const { error } = await sb.auth.signInWithPassword({ email, password });
  return { error };
}

/**
 * Create a new account. Returns `needsConfirm` when the project requires
 * email confirmation before the first sign-in.
 */
export async function signUp(email: string, password: string) {
  const sb = supabase();
  if (!sb)
    return { error: new Error("Demo mode — authentication is disabled."), needsConfirm: false };
  const { data, error } = await sb.auth.signUp({ email, password });
  const needsConfirm = !error && !data.session;
  return { error, needsConfirm };
}

/** Currently signed-in user, or null. */
export async function getCurrentUser(): Promise<User | null> {
  const sb = supabase();
  if (!sb) return null;
  const { data } = await sb.auth.getUser();
  return data.user ?? null;
}

export async function signOut() {
  const sb = supabase();
  if (!sb) return;
  await sb.auth.signOut();
}
