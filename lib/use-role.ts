"use client";

import { useEffect, useLayoutEffect, useState } from "react";

export const ROLE_CACHE_KEY = "rb_role";
export type ClientRole = "owner" | "victor" | "steven" | "shalev" | "cleantone" | "avi" | null;

/** The recognized roles, in ONE place. "avi" used to be missing from the two
 *  inline checks below, so his session resolved to `null` client-side — harmless
 *  for the portal (it falls back to the server-sent initialRole) but it meant
 *  AppShell could never grant him header chrome such as the bell. Every consumer
 *  treats "avi" exactly as it treated `null` (Sidebar → no nav items, MobileNav →
 *  no bottom bar), so nothing else changes shape. */
const CLIENT_ROLES = ["owner", "victor", "steven", "shalev", "cleantone", "avi"] as const;

function isClientRole(v: unknown): v is Exclude<ClientRole, null> {
  return typeof v === "string" && (CLIENT_ROLES as readonly string[]).includes(v);
}

// Runs before paint on the client (avoids nav flicker); falls back to useEffect on the server.
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Client-side role for UI gating ONLY (security is enforced server-side in
 * proxy.ts + route helpers). AppShell remounts on every navigation, so the
 * last-known role is cached in localStorage and hydrated before paint to keep
 * owner chrome stable. /api/me then confirms/refreshes it (and clears the cache
 * on unknown/denied so a stale owner cache can't linger after switching users).
 */
export function useRole(): ClientRole {
  const [role, setRole] = useState<ClientRole>(null);

  useIsoLayoutEffect(() => {
    try {
      const cached = localStorage.getItem(ROLE_CACHE_KEY);
      if (isClientRole(cached)) setRole(cached);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    let alive = true;
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : { role: "denied" }))
      .then((d) => {
        if (!alive) return;
        if (isClientRole(d?.role)) {
          setRole(d.role);
          try { localStorage.setItem(ROLE_CACHE_KEY, d.role); } catch { /* ignore */ }
        } else {
          setRole(null);
          try { localStorage.removeItem(ROLE_CACHE_KEY); } catch { /* ignore */ }
        }
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  return role;
}
