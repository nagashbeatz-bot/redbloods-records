"use client";

/**
 * App-wide, fully blocking "Google Calendar connection required" gate.
 *
 * Mounted once in the root layout, so it sits above every page/AppShell. Google
 * Calendar is a REQUIRED connection for Redbloods OS, so on entry (owner) it runs
 * a LIGHT credentials check (/api/calendar/auth-check — no calendar sync):
 *
 *   ok                          → app opens immediately
 *   needs_reauth / not_connected → blocking connect screen
 *   unknown / non-200 / network / timeout → app released, NEVER locked
 *
 * While that first check is in flight a short, clean loading cover blocks
 * interaction so the app cannot be used for a few moments before the verdict. That
 * cover has a hard client budget (INITIAL_BUDGET_MS): a slow/failed check releases
 * the app instead of holding it for the server's own timeout. A definitive answer
 * that arrives later still blocks.
 *
 * Once a connect screen is showing, only an explicit "ok" lifts it — transient
 * answers change nothing.
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
const FETCH_ABORT_MS      = 15_000;       // hygiene: never let a hung request pin `inFlight`
const MIN_GAP_MS          = 5_000;        // never check more often than this on wake events
const RECHECK_HEALTHY_MS  = 10 * 60_000;  // focus/visibility re-check throttle while healthy
const INTERVAL_HEALTHY_MS = 30 * 60_000;  // long-lived tabs / PWA
const POLL_BLOCKED_MS     = 30_000;       // while blocked: notice a reconnect done elsewhere
const Z_INDEX             = 2147483000;

type View = "idle" | "checking" | "needs_reauth" | "not_connected";

const isBlocking = (v: View) => v === "needs_reauth" || v === "not_connected";

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
  const inFlight       = useRef(false);
  const lastCheck      = useRef(0);
  const initialDone    = useRef(false);
  const excluded       = isExcludedPath(pathname);
  const excludedRef    = useRef(excluded);
  excludedRef.current  = excluded;

  const applyView = useCallback((v: View) => { viewRef.current = v; setView(v); }, []);

  /** Ends the entry loading cover without a verdict (no-op if a connect screen is showing). */
  const finishInitial = useCallback(() => {
    initialDone.current = true;
    if (viewRef.current === "checking") applyView("idle");
  }, [applyView]);

  const runCheck = useCallback(async () => {
    if (inFlight.current || excludedRef.current) return;
    if (!isBlocking(viewRef.current) && cachedRoleIsNotOwner()) { finishInitial(); return; }
    inFlight.current = true;
    lastCheck.current = Date.now();
    const ctrl = new AbortController();
    const abortTimer = setTimeout(() => ctrl.abort(), FETCH_ABORT_MS);
    try {
      const res = await fetch(CHECK_URL, { cache: "no-store", credentials: "same-origin", signal: ctrl.signal });
      if (!res.ok) { finishInitial(); return; }          // 401/403/5xx → unknown → never lock
      const data = await res.json() as { state?: string; needsReauth?: boolean };
      if (data.state === "needs_reauth" && data.needsReauth === true) {
        initialDone.current = true; applyView("needs_reauth");
      } else if (data.state === "not_connected") {
        initialDone.current = true; applyView("not_connected");
      } else if (data.state === "ok") {
        initialDone.current = true; applyView("idle");
      } else {
        finishInitial();                                  // "unknown" / malformed → never lock
      }
    } catch {
      finishInitial();                                    // network error / abort / bad JSON → never lock
    } finally {
      clearTimeout(abortTimer);
      inFlight.current = false;
    }
  }, [applyView, finishInitial]);

  // Entry check (before first paint, so the app is never usable ahead of the verdict)
  // + re-checks (focus, long-lived tab, fast poll while blocked).
  useLayoutEffect(() => {
    if (excluded) return;

    let budget: ReturnType<typeof setTimeout> | undefined;
    if (!initialDone.current && !cachedRoleIsNotOwner()) {
      applyView("checking");
      budget = setTimeout(finishInitial, INITIAL_BUDGET_MS);
    }
    runCheck();

    const onWake = () => {
      if (document.visibilityState === "hidden") return;
      const gap = Date.now() - lastCheck.current;
      if (gap < MIN_GAP_MS) return;             // focus events can fire in bursts
      if (isBlocking(viewRef.current) || gap > RECHECK_HEALTHY_MS) runCheck();
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);

    const healthy = setInterval(() => {
      if (!isBlocking(viewRef.current) && document.visibilityState === "visible") runCheck();
    }, INTERVAL_HEALTHY_MS);
    const poll = setInterval(() => { if (isBlocking(viewRef.current)) runCheck(); }, POLL_BLOCKED_MS);

    return () => {
      clearTimeout(budget);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
      clearInterval(healthy);
      clearInterval(poll);
    };
  }, [excluded, runCheck, finishInitial, applyView]);

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
