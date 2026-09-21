"use client";

/**
 * App-wide, fully blocking "reconnect Google Calendar" gate.
 *
 * Mounted once in the root layout, so it sits above every page/AppShell. It runs
 * a LIGHT credentials check (/api/calendar/auth-check — no calendar sync) and
 * shows the blocking modal ONLY when the server says `needsReauth: true`, which
 * it does solely for a definitive invalid_grant / missing refresh token.
 *
 * Transient trouble (network error, timeout, non-200, state "unknown", 401/403)
 * never locks the app: anything that is not an explicit needs_reauth is ignored,
 * and once blocked only an explicit "ok"/"not_connected" lifts it.
 *
 * Blocking model: the modal is portalled to a dedicated <body> child; every OTHER
 * body child (app root, sidebar, mini player, bottom nav, other portals — kept
 * up to date by a MutationObserver) is made `inert`, so neither mouse nor
 * keyboard can reach anything behind it. Scroll is locked, ESC is swallowed in
 * the capture phase, there is no close button and the backdrop ignores clicks.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";
import { ROLE_CACHE_KEY } from "@/lib/use-role";

const CHECK_URL          = "/api/calendar/auth-check";
const MIN_GAP_MS         = 5_000;        // never check more often than this on wake events
const RECHECK_HEALTHY_MS = 10 * 60_000; // focus/visibility re-check throttle while healthy
const INTERVAL_HEALTHY_MS = 30 * 60_000; // long-lived tabs / PWA
const POLL_BLOCKED_MS    = 30_000;       // while blocked: notice a reconnect done elsewhere
const Z_INDEX            = 2147483000;

/** Pages where there is no owner session to check (or the app is intentionally locked). */
function isExcludedPath(pathname: string | null): boolean {
  return !!pathname && (pathname === "/login" || pathname.startsWith("/login/") || pathname === "/maintenance");
}

/** Non-owners can't (and needn't) run the check. Unknown/uncached → let the server decide. */
function cachedRoleIsNotOwner(): boolean {
  try {
    const cached = localStorage.getItem(ROLE_CACHE_KEY);
    return !!cached && cached !== "owner";
  } catch {
    return false;
  }
}

export default function CalendarReauthGate() {
  const pathname  = usePathname();
  const [blocked, setBlocked] = useState(false);
  const blockedRef  = useRef(false);
  const inFlight    = useRef(false);
  const lastCheck   = useRef(0);
  const excluded    = isExcludedPath(pathname);
  const excludedRef = useRef(excluded);
  excludedRef.current = excluded;

  const runCheck = useCallback(async () => {
    if (inFlight.current || excludedRef.current) return;
    if (!blockedRef.current && cachedRoleIsNotOwner()) return;
    inFlight.current = true;
    lastCheck.current = Date.now();
    try {
      const res = await fetch(CHECK_URL, { cache: "no-store", credentials: "same-origin" });
      if (!res.ok) return;                       // 401/403/5xx → unknown → never lock
      const data = await res.json() as { state?: string; needsReauth?: boolean };
      if (data.needsReauth === true && data.state === "needs_reauth") {
        blockedRef.current = true; setBlocked(true);
      } else if (data.state === "ok" || data.state === "not_connected") {
        blockedRef.current = false; setBlocked(false);
      }
      // any other answer ("unknown", malformed) → leave the current state untouched
    } catch {
      // network error / timeout / bad JSON → unknown → never lock, never unlock
    } finally {
      inFlight.current = false;
    }
  }, []);

  // Initial check on load + re-checks (focus, long-lived tab, fast poll while blocked).
  useEffect(() => {
    if (excluded) return;
    runCheck();

    const onWake = () => {
      if (document.visibilityState === "hidden") return;
      const gap = Date.now() - lastCheck.current;
      if (gap < MIN_GAP_MS) return;             // focus events can fire in bursts
      if (blockedRef.current || gap > RECHECK_HEALTHY_MS) runCheck();
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);

    const healthy = setInterval(() => { if (!blockedRef.current && document.visibilityState === "visible") runCheck(); }, INTERVAL_HEALTHY_MS);
    const poll    = setInterval(() => { if (blockedRef.current) runCheck(); }, POLL_BLOCKED_MS);

    return () => {
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
      clearInterval(healthy);
      clearInterval(poll);
    };
  }, [excluded, runCheck]);

  if (!blocked || excluded) return null;
  return <BlockingOverlay />;
}

// ─── The blocking modal ──────────────────────────────────────────────────────

function BlockingOverlay() {
  const [host, setHost]       = useState<HTMLElement | null>(null);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Own <body> child: everything else gets `inert`, this stays interactive.
  useEffect(() => {
    const el = document.createElement("div");
    el.setAttribute("data-calendar-reauth-gate", "");
    document.body.appendChild(el);
    setHost(el);
    return () => { el.remove(); setHost(null); };
  }, []);

  useEffect(() => {
    if (!host) return;

    // 1) inert everything behind (and anything appended later).
    const inerted = new Set<Element>();
    const applyInert = () => {
      for (const child of Array.from(document.body.children)) {
        if (child === host || inerted.has(child) || child.hasAttribute("inert")) continue;
        child.setAttribute("inert", "");
        inerted.add(child);
      }
    };
    applyInert();
    const mo = new MutationObserver(applyInert);
    mo.observe(document.body, { childList: true });

    // 2) scroll lock.
    const bodyOverflow = document.body.style.overflow;
    const htmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    // 3) ESC (and nothing else) is swallowed before any app handler sees it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); }
    };
    window.addEventListener("keydown", onKey, true);

    // 4) focus the primary action once inert has released the previous focus.
    const raf = requestAnimationFrame(() => buttonRef.current?.focus());

    // Surface a failed/cancelled OAuth return (…/setup/calendar?error=…) — the page is hidden behind us.
    try {
      const err = new URLSearchParams(window.location.search).get("error");
      if (err && err.length <= 200) setOauthError(err);
    } catch { /* ignore */ }

    // Back/forward cache restore after leaving for Google: re-arm the button.
    const onShow = () => setBusy(false);
    window.addEventListener("pageshow", onShow);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pageshow", onShow);
      mo.disconnect();
      inerted.forEach((el) => el.removeAttribute("inert"));
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overflow = htmlOverflow;
    };
  }, [host]);

  async function reconnect() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/calendar/auth");   // existing OAuth flow
      const d = await r.json();
      if (d.url) { window.location.href = d.url; return; }
      setError(d.error ?? "לא ניתן לפתוח את החיבור. נסה שוב.");
    } catch {
      setError("שגיאת רשת. נסה שוב.");
    }
    setBusy(false);
  }

  if (!host) return null;

  return createPortal(
    <div
      style={{
        position: "fixed", inset: 0, zIndex: Z_INDEX,
        background: "rgba(6,6,8,0.9)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24, overflow: "hidden", overscrollBehavior: "contain", touchAction: "none",
        fontFamily: "Heebo, sans-serif", direction: "rtl",
      }}
    >
      <div
        role="alertdialog" aria-modal="true"
        aria-labelledby="cal-reauth-title" aria-describedby="cal-reauth-desc"
        style={{
          background: "#141414", border: "1px solid #252525", borderRadius: 20,
          padding: "40px 48px", maxWidth: 480, width: "100%", textAlign: "right",
          boxShadow: "0 24px 80px rgba(0,0,0,0.7)", boxSizing: "border-box",
        }}
      >
        <div style={{ fontSize: 36, marginBottom: 8 }}>📅</div>
        <h1 id="cal-reauth-title" style={{ color: "#F0F0F0", fontSize: 22, fontWeight: 700, margin: 0 }}>
          Google Calendar התנתק
        </h1>
        <p id="cal-reauth-desc" style={{ color: "#8A8A8A", fontSize: 14, marginTop: 8, lineHeight: 1.7 }}>
          החיבור ל-Google Calendar נותק או פג.
          <br />
          כדי להמשיך להשתמש ב-Redbloods OS, יש לחבר מחדש את היומן.
        </p>

        {oauthError && (
          <div style={{
            background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)",
            borderRadius: 10, padding: "12px 16px", color: "#EF4444", fontSize: 13, marginTop: 16,
          }}>
            החיבור לא הושלם: {oauthError}
          </div>
        )}
        {error && (
          <div role="alert" style={{
            background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)",
            borderRadius: 10, padding: "12px 16px", color: "#EF4444", fontSize: 13, marginTop: 16,
          }}>
            {error}
          </div>
        )}

        <button
          ref={buttonRef}
          onClick={reconnect}
          disabled={busy}
          style={{
            marginTop: 24, width: "100%", padding: "13px 24px", borderRadius: 12,
            border: `1px solid ${busy ? "transparent" : "rgba(59,130,246,0.25)"}`,
            background: busy ? "#1A1A1A" : "rgba(59,130,246,0.15)",
            color: busy ? "#444" : "#3B82F6",
            fontSize: 15, fontWeight: 600, cursor: busy ? "default" : "pointer", fontFamily: "inherit",
          }}
        >
          {busy ? "מעביר לגוגל..." : "🔗 חבר מחדש עם Google"}
        </button>
      </div>
    </div>,
    host,
  );
}
