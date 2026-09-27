"use client";

import { useEffect } from "react";
import { PRESENCE_HEARTBEAT_MS, PRESENCE_LAST_SEEN_THROTTLE_MS } from "@/lib/push-presence-pure";

/**
 * Portal presence ping — the ONE client side of the shared presence model (lib/push-presence-pure.ts) for Shalev,
 * Avi, DJ CLEANTONE, Steven and Victor. It pings the user's OWN ping route when the portal opens, every
 * PRESENCE_HEARTBEAT_MS while the page is visible, and when the page becomes visible again. The SERVER decides
 * everything: it records last-seen and sends the Owner ONE push only for a claimed NEW visit (30 minutes without any
 * ping) — a refresh, in-portal navigation, a re-render, a heartbeat or a second tab never pushes.
 *
 * `pingUrl` is null when the viewer is not that portal user (the Owner previewing a portal never pings; the routes
 * re-check the role anyway). The sessionStorage stamp only skips a ping this tab already sent within the throttle
 * window (a client nicety — never the dedupe; the server's claim is).
 *
 * Allowed ping routes (guard G4b maps each to the PORTAL_PRESENCE background writer): /api/red-artists/ping,
 * /api/label/artists/[id]/ping, /api/red-artists/cleantone/ping, /api/supplier/steven/ping, /api/vendor/victor/ping.
 */
export function usePortalPresence(pingUrl: string | null): void {
  useEffect(() => {
    if (!pingUrl) return;
    const stampKey = `rb_presence_ping:${pingUrl}`;
    const ping = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      try {
        const last = Number(sessionStorage.getItem(stampKey) ?? 0);
        if (Date.now() - last < PRESENCE_LAST_SEEN_THROTTLE_MS) return;
        sessionStorage.setItem(stampKey, String(Date.now()));
      } catch { /* sessionStorage unavailable — the server still decides */ }
      fetch(pingUrl, { method: "POST" }).catch(() => {});
    };
    ping();
    const timer = setInterval(ping, PRESENCE_HEARTBEAT_MS);
    const onVisible = () => { if (document.visibilityState === "visible") ping(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [pingUrl]);
}
