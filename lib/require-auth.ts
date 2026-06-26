import "server-only";

import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase-server";

/** Returns the authenticated Supabase user, or null when not signed in. */
export async function getAuthUser() {
  try {
    const supabase = await createSupabaseServer();
    const { data } = await supabase.auth.getUser();
    return data.user ?? null;
  } catch {
    return null;
  }
}

/**
 * Defense-in-depth guard for API route handlers. The proxy (proxy.ts) is the
 * primary gate; this re-checks the session per route so a matcher change can
 * never silently expose an endpoint.
 *
 * Usage at the top of a handler:
 *   const unauth = await requireAuth();
 *   if (unauth) return unauth;
 */
export async function requireAuth(): Promise<NextResponse | null> {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return null;
}
