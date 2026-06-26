"use client";

import { createBrowserClient } from "@supabase/ssr";

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
