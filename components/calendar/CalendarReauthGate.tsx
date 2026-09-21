"use client";

/**
 * App-wide, fully blocking "Google Calendar connection required" gate.
 *
 * Mounted once in the root layout, so it sits above every page/AppShell. Google
 * Calendar is a REQUIRED connection for Redbloods OS, so the owner's FIRST entry
 * of each local day runs ONE LIGHT credentials check (/api/calendar/auth-check —
 * no calendar sync):
 *
 *   ok                          → app opens (and today's marker is stored)
 *   needs_reauth / not_connected → blocking connect screen (NO marker)
 *   unknown / non-200 / network / timeout → app released, NEVER locked
 *                                           (today's marker IS stored)
 *
 * Once-a-day rule: when the daily check finishes — or hits the client timeout —
 * with anything except a blocking verdict, the browser-LOCAL date (never UTC) is
 * stored in localStorage (MARKER_KEY). A transient failure therefore neither locks
 * the app nor earns a second check the same day. While the marker equals today's
 * local date every entry/refresh/navigation opens the app instantly — no request,
 * no spinner, no cover. There are NO other automatic checks (no focus / interval /
 * navigation re-checks). Only a blocking verdict (needs_reauth / not_connected)
 * leaves NO marker — and clears one written by an earlier timeout — because the app
 * stays blocked until Google is connected; a refresh must not escape the block.
 *
 * The one exception is the explicit reconnect button: it clears the marker before
 * leaving for OAuth, so the return from Google runs one verification check.
 *
 * While the daily check is in flight a short, clean loading cover blocks
 * interaction so the app cannot be used before the verdict. That cover has a hard
 * client budget (INITIAL_BUDGET_MS): a slow/failed check releases the app instead
 * of holding it for the server's own timeout. A definitive answer that arrives
 * later still blocks.
 *
 * Blocking model: the cover is portalled to a dedicated <body> child; every OTHER
 * body child (app root, sidebar, mini player, bottom nav, other portals — kept up
 * to date by a MutationObserver) is made `inert`, so neither mouse nor keyboard can
 * reach anything behind it. Scroll is locked, ESC is swallowed in the capture
 * phase, there is no close button and the backdrop ignores clicks.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";
import { ROLE_CACHE_KEY } from "@/lib/use-role";

const CHECK_URL           = "/api/calendar/auth-check";
const INITIAL_BUDGET_MS   = 3_000;        // max time the entry loading cover may hold the app
const FETCH_ABORT_MS      = 15_000;       // hygiene: never let a hung request pin the check
const MARKER_KEY          = "calendar_auth_last_check"; // YYYY-MM-DD (browser-local) of the last verified-ok check
const Z_INDEX             = 2147483000;

type View = "idle" | "checking" | "needs_reauth" | "not_connected";

/** Browser-LOCAL calendar day as YYYY-MM-DD — deliberately not UTC (toISOString). */
function localDateStr(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function readMarker(): string | null {
  try { return localStorage.getItem(MARKER_KEY); } catch { return null; }
}
function writeMarker(day: string): void {
  try { localStorage.setItem(MARKER_KEY, day); } catch { /* storage unavailable → just check again next entry */ }
}
function clearMarker(): void {
  try { localStorage.removeItem(MARKER_KEY); } catch { /* ignore */ }
}

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
  const pathname = usePathname();
  const [view, setView] = useState<View>("idle");
  const viewRef        = useRef<View>("idle");
  const attempted      = useRef(false); // at most ONE automatic check per page load
  const excluded       = isExcludedPath(pathname);

  const applyView = useCallback((v: View) => { viewRef.current = v; setView(v); }, []);

  /**
   * Transient / inconclusive end of the daily check (unknown, network, timeout,
   * non-200…): release the app AND count today's check as done. No-op while a
   * connect screen is showing — a blocked app never gets a marker.
   */
  const settleInconclusive = useCallback((day: string) => {
    if (viewRef.current === "needs_reauth" || viewRef.current === "not_connected") return;
    writeMarker(day);
    if (viewRef.current === "checking") applyView("idle");
  }, [applyView]);

  /** Blocking verdict: show the connect screen and make sure NO marker survives. */
  const block = useCallback((v: "needs_reauth" | "not_connected") => {
    clearMarker();   // also removes one written by the timeout if this answer arrived late
    applyView(v);
  }, [applyView]);

  const runCheck = useCallback(async (day: string) => {
    const ctrl = new AbortController();
    const abortTimer = setTimeout(() => ctrl.abort(), FETCH_ABORT_MS);
    try {
      const res = await fetch(CHECK_URL, { cache: "no-store", credentials: "same-origin", signal: ctrl.signal });
      if (!res.ok) { settleInconclusive(day); return; }   // 401/403/429/5xx → never lock, counts as today's check
      const data = await res.json() as { state?: string; needsReauth?: boolean };
      if (data.state === "needs_reauth" && data.needsReauth === true) {
        block("needs_reauth");
      } else if (data.state === "not_connected") {
        block("not_connected");
      } else if (data.state === "ok") {
        writeMarker(day);                                 // verified → no more checks today
        applyView("idle");
      } else {
        settleInconclusive(day);                          // "unknown" / malformed → never lock
      }
    } catch {
      settleInconclusive(day);                            // network error / abort / bad JSON → never lock
    } finally {
      clearTimeout(abortTimer);
    }
  }, [applyView, block, settleInconclusive]);

  // The daily check. Layout effect so the cover is up before first paint and the app
  // is never usable ahead of the verdict. Nothing re-triggers it: no focus / interval /
  // navigation listeners — `attempted` also stops route changes from re-running it.
  useLayoutEffect(() => {
    if (excluded || attempted.current) return;
    if (cachedRoleIsNotOwner()) return;
    const today = localDateStr();
    if (readMarker() === today) return;   // already verified today → open instantly (no request, no spinner)

    attempted.current = true;
    applyView("checking");
    // Hard client budget: still waiting after 3s → release the app; the day counts as
    // checked. A blocking answer arriving later still blocks (and clears the marker).
    setTimeout(() => { if (viewRef.current === "checking") settleInconclusive(today); }, INITIAL_BUDGET_MS);
    runCheck(today);
  }, [excluded, runCheck, settleInconclusive, applyView]);

  if (view === "idle" || excluded) return null;
  return <GateOverlay mode={view} />;
}

// ─── The blocking cover / modal ──────────────────────────────────────────────

function GateOverlay({ mode }: { mode: Exclude<View, "idle"> }) {
  const [host, setHost]       = useState<HTMLElement | null>(null);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const cardRef   = useRef<HTMLDivElement>(null);

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

    // Surface a failed/cancelled OAuth return (…/setup/calendar?error=…) — the page is hidden behind us.
    try {
      const err = new URLSearchParams(window.location.search).get("error");
      if (err && err.length <= 200) setOauthError(err);
    } catch { /* ignore */ }

    // Back/forward cache restore after leaving for Google: re-arm the button.
    const onShow = () => setBusy(false);
    window.addEventListener("pageshow", onShow);

    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pageshow", onShow);
      mo.disconnect();
      inerted.forEach((el) => el.removeAttribute("inert"));
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overflow = htmlOverflow;
    };
  }, [host]);

  // Focus follows the mode: the connect button when there is one, else the card,
  // so focus never stays on an (inert) element of the app.
  useEffect(() => {
    if (!host) return;
    const raf = requestAnimationFrame(() => (buttonRef.current ?? cardRef.current)?.focus());
    return () => cancelAnimationFrame(raf);
  }, [host, mode]);

  async function reconnect() {
    setBusy(true);
    setError(null);
    // Explicit reconnect: drop today's marker BEFORE leaving for OAuth so the return
    // from Google runs one verification check (not the regular daily check).
    clearMarker();
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

  const loading = mode === "checking";
  const copy = mode === "not_connected"
    ? {
        title: "Google Calendar אינו מחובר",
        desc:  "כדי להמשיך להשתמש ב-Redbloods OS, יש לחבר את Google Calendar.",
        cta:   "🔗 חבר עם Google",
      }
    : {
        title: "Google Calendar התנתק",
        desc:  "החיבור ל-Google Calendar נותק או פג. כדי להמשיך להשתמש ב-Redbloods OS, יש לחבר מחדש את היומן.",
        cta:   "🔗 חבר מחדש עם Google",
      };

  return createPortal(
    <div
      style={{
        position: "fixed", inset: 0, zIndex: Z_INDEX,
        background: loading ? "#0A0A0A" : "rgba(6,6,8,0.9)",
        backdropFilter: loading ? undefined : "blur(6px)",
        WebkitBackdropFilter: loading ? undefined : "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24, overflow: "hidden", overscrollBehavior: "contain", touchAction: "none",
        fontFamily: "Heebo, sans-serif", direction: "rtl",
      }}
    >
      {loading ? (
        <div ref={cardRef} tabIndex={-1} role="status" aria-live="polite" aria-busy="true"
             style={{ outline: "none", textAlign: "center" }}>
          <style>{"@keyframes rb-gate-spin{to{transform:rotate(360deg)}}"}</style>
          <div style={{
            width: 34, height: 34, margin: "0 auto 14px", borderRadius: "50%",
            border: "3px solid #262626", borderTopColor: "#DC2626",
            animation: "rb-gate-spin .8s linear infinite",
          }} />
          <div style={{ color: "#8A8A8A", fontSize: 13 }}>בודק חיבור ל-Google Calendar…</div>
        </div>
      ) : (
        <div
          ref={cardRef} tabIndex={-1}
          role="alertdialog" aria-modal="true"
          aria-labelledby="cal-reauth-title" aria-describedby="cal-reauth-desc"
          style={{
            background: "#141414", border: "1px solid #252525", borderRadius: 20,
            padding: "40px 48px", maxWidth: 480, width: "100%", textAlign: "right",
            boxShadow: "0 24px 80px rgba(0,0,0,0.7)", boxSizing: "border-box", outline: "none",
          }}
        >
          <div style={{ fontSize: 36, marginBottom: 8 }}>📅</div>
          <h1 id="cal-reauth-title" style={{ color: "#F0F0F0", fontSize: 22, fontWeight: 700, margin: 0 }}>
            {copy.title}
          </h1>
          <p id="cal-reauth-desc" style={{ color: "#8A8A8A", fontSize: 14, marginTop: 8, lineHeight: 1.7 }}>
            {copy.desc}
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
            {busy ? "מעביר לגוגל..." : copy.cta}
          </button>
        </div>
      )}
    </div>,
    host,
  );
}
