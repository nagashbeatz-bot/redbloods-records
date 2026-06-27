"use client";

import { useEffect, useLayoutEffect, useState } from "react";

export const ROLE_CACHE_KEY = "rb_role";
export type ClientRole = "owner" | "victor" | null;

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
      if (cached === "owner" || cached === "victor") setRole(cached);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    let alive = true;
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : { role: "denied" }))
      .then((d) => {
        if (!alive) return;
        if (d?.role === "owner" || d?.role === "victor") {
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
