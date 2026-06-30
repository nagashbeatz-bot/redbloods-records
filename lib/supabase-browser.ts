"use client";

import { createBrowserClient } from "@supabase/ssr";
import { ROLE_CACHE_KEY } from "./use-role";

/**
 * Browser Supabase client — uses the PUBLIC anon key only.
 * NEVER use SUPABASE_SECRET_KEY here; this code runs in the browser.
 * Used for login/logout and session-cookie management only — not data queries
 * (those stay on the server-only service-role client in lib/supabase.ts).
 */
export function createSupabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

/**
 * Canonical logout — the single sign-out path for the whole app (desktop
 * Sidebar + mobile nav). Clears the cached role, signs out of Supabase, and
 * redirects to /login. Do NOT recreate this elsewhere; import and call it.
 */
export async function signOutAndRedirect() {
  try { localStorage.removeItem(ROLE_CACHE_KEY); } catch { /* ignore */ }
  try { await createSupabaseBrowser().auth.signOut(); } catch { /* ignore */ }
  window.location.href = "/login";
}
