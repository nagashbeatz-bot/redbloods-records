"use client";

import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";
import { Suspense } from "react";
import Sidebar from "./Sidebar";
import MobileNav from "./MobileNav";
import MiniPlayer from "./ui/MiniPlayer";
import DebugOverlay from "./ui/DebugOverlay"; // TEMP unmounted while ViewportProbe is in use — see bottom of the shell
import ViewportProbe from "./ui/ViewportProbe";
import { useProjects } from "@/components/ProjectsProvider";
import { usePlayerSafe } from "@/components/PlayerProvider";
import JahknoRadioPlayer from "@/components/radio/JahknoRadioPlayer";
import GlobalProjectDrawerProvider from "@/components/GlobalProjectDrawer";
import PushManager from "@/components/PushManager";
import NotificationsBell from "@/components/dashboard/NotificationsBell";
import QuickActionsButton from "@/components/quick-actions/QuickActionsButton";
import QuickActionsModal from "@/components/quick-actions/QuickActionsModal";
import { useRole } from "@/lib/use-role";
import { useIsClient } from "@/lib/use-is-client";

const SIDEBAR_WIDTH = 248; // px — desktop sidebar
const PLAYER_H      = 110; // px — desktop mini player (92px card + 18px bottom margin)
const MOBILE_PLAYER_H = 74; // px — mobile mini player (2-row card)

export default function AppShell({ children }: { children: React.ReactNode }) {
  const role = useRole();
  const isOwner = role === "owner"; // AI agent + tools + quick actions are owner-only chrome
  // The bell is the one piece of header chrome the suppliers and the two portal
  // artists get too. It is safe to share because every /api/notifications handler
  // uses the user-scoped client, so RLS (recipient_user_id = auth.uid()) limits
  // each of them to their OWN rows — none of them can see or mark anyone else's.
  // Shalev + Avi were added so their "ביט חדש מחכה לך" notice has somewhere to
  // land in-app; it grants them no beat-management rights (those stay requireOwner).
  const canSeeBell = isOwner || role === "victor" || role === "steven" || role === "shalev" || role === "avi";
  const canRadio = role === "owner" || role === "shalev"; // the external LISTEN radio is available to the artist too
  // shalev + victor + cleantone + avi have no fixed bottom nav (their logout sits
  // at the end of their page content) → reserve no space for a bar. The
  // paddingBottom below then collapses to env(safe-area-inset-bottom) alone,
  // which is exactly the small iPhone inset we still want under the last card.
  // Avi was missing here while MobileNav already gave him no bar at all (it
  // returns null on an empty tab list), so 56px was reserved for a bar that does
  // not exist: the mini player floated 56px up with page content showing through
  // the gap beneath it. navH feeds BOTH the player's `bottom` and the content
  // paddingBottom, so listing him fixes the float and the dead gap together.
  //
  // This role list is now ONLY the pre-measurement / no-nav-rendered fallback —
  // see measuredNavH below, which is the real source of truth once available.
  // Kept (not removed) so first paint and any role with genuinely no <nav>
  // still get the exact same numbers as before.
  const navH = role === "shalev" || role === "victor" || role === "cleantone" || role === "avi" ? 0 : 56;
  const { projects } = useProjects();
  const player = usePlayerSafe();
  const playerVisible = !!(player?.track);
  const [isMobile, setIsMobile] = useState(false);
  // The Victor work sheet is a full-screen mobile overlay (z-1001). While it is
  // open it dispatches "rb:victor-sheet" so the ONE mobile MiniPlayer below can
  // be lifted above it — Victor reuses the same instance, no second player.
  const [victorSheetOpen, setVictorSheetOpen] = useState(false);
  const [quickActions, setQuickActions] = useState<{ open: boolean; projectId: string | null; clientName: string | null; date: string | null; time: string | null }>({ open: false, projectId: null, clientName: null, date: null, time: null });
  const contentRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const mobileNavRef = useRef<HTMLElement>(null);
  // The bottom nav is portalled to <body> (MobileNav.tsx) and mounts AFTER the
  // client flag flips — later than this component's first layout effect — so a
  // plain ref would still be null when we try to measure it. A callback ref tells
  // us the moment the real node exists (and when it goes away): navEl drives the
  // measurement below, mobileNavRef is kept in sync for DebugOverlay.
  const [navEl, setNavEl] = useState<HTMLElement | null>(null);
  const setMobileNav = useCallback((el: HTMLElement | null) => {
    mobileNavRef.current = el;
    setNavEl(el);
  }, []);
  const isClient = useIsClient(); // portal target (document.body) exists only on the client
  const pathname = usePathname();

  useLayoutEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // ── Single source of truth for "how much space does the real bottom nav
  //    take" — replaces the old approach of guessing 56px in three unrelated
  //    places (this file's navH, and two now-unused globals.css classes).
  //    getBoundingClientRect().height on the ACTUAL <nav> already includes its
  //    own paddingBottom:env(safe-area-inset-bottom) (MobileNav.tsx), so once a
  //    measurement exists it is the WHOLE clearance value — no separate safe-area
  //    term is added on top of it (that would double-count the inset).
  //    null = "not measured yet" OR "this role renders no <nav> at all" — both
  //    cases fall back to the exact old formula (navH guess + explicit safe-area)
  //    via navClearance below, so behavior is unchanged until/unless a real nav
  //    exists to measure. useLayoutEffect (not useEffect) mirrors the isMobile
  //    check above — no visible flash before first paint.
  //    Keyed on navEl (the callback-ref node), not on `role`: the nav is portalled
  //    and mounts/unmounts on its own schedule, so the effect re-runs exactly when
  //    the node appears or disappears.
  const [measuredNavH, setMeasuredNavH] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!navEl) { setMeasuredNavH(null); return; }
    const measure = () => setMeasuredNavH(Math.round(navEl.getBoundingClientRect().height));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(navEl);
    return () => ro.disconnect();
  }, [navEl]);
  const navClearance = measuredNavH != null
    ? `${measuredNavH}px`
    : `calc(${navH}px + env(safe-area-inset-bottom))`;

  // Scroll to top on route change.
  // contentRef.scrollTo covers desktop (inner scroll container).
  // window.scrollTo covers mobile (body scroll after CSS override).
  useEffect(() => {
    contentRef.current?.scrollTo(0, 0);
    window.scrollTo(0, 0);
  }, [pathname]);

  // Auto-mark past sessions as "התקיים" on every app load
  useEffect(() => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const clientNow =
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
      `T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    fetch("/api/sessions/auto-mark", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientNow }),
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const handler = (e: Event) => setVictorSheetOpen(!!(e as CustomEvent<boolean>).detail);
    window.addEventListener("rb:victor-sheet", handler);
    return () => window.removeEventListener("rb:victor-sheet", handler);
  }, []);

  // Open the global quick-actions modal (e.g. from the "פעולות מהירות" button, or
  // pre-filled from the Shalev portal's per-day "קבע סשן" button).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ projectId?: string; clientName?: string; date?: string; time?: string } | undefined>).detail;
      setQuickActions({
        open: true,
        projectId: detail?.projectId ?? null,
        clientName: detail?.clientName ?? null,
        date: detail?.date ?? null,
        time: detail?.time ?? null,
      });
    };
    window.addEventListener("rb:quick-actions", handler);
    return () => window.removeEventListener("rb:quick-actions", handler);
  }, []);

  return (
    /*
      GlobalProjectDrawerProvider wraps the ENTIRE shell, header included: the
      notifications bell sits in the header and calls openProject() when a
      notification is tied to a project. While the provider only wrapped
      {children}, that call silently hit the NOOP context on every page whose
      own page.tsx did not add a provider of its own.
      The drawers it renders portal to document.body, so wrapping more of the
      tree changes nothing about layout.
    */
    <GlobalProjectDrawerProvider>
    {/*
      Root shell: position fixed + inset 0 fills the exact visual viewport on
      iOS PWA without any JavaScript. The browser always computes fixed insets
      correctly from frame 0 — no timers, no opacity hacks, no polling needed.

      flex-col so MobileNav (last child) anchors to the real bottom of the
      viewport by layout flow, not by position:fixed.
    */}
    <div
      ref={shellRef}
      className="app-shell-root"
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        background: "#0D0D0D",
      }}
    >
      {/* ── Inner row: sidebar (desktop) + main content ── */}
      <div className="app-shell-row" style={{ display: "flex", flex: 1, minHeight: 0 }}>

        {/* Desktop sidebar — hidden on mobile */}
        <Sidebar role={role} />

        {/* Main column: header + scrollable content + desktop chat panel */}
        <main
          className="app-shell-main"
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            overflow: "hidden",
          }}
        >
          {/* Top bar */}
          <header
            style={{
              height: 60, flexShrink: 0,
              background: "#141414",
              borderBottom: "1px solid rgba(255,255,255,0.07)",
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "0 14px",
              position: "sticky", top: 0, zIndex: 40,
            }}
          >
            {/* Mobile header — CSS hidden on desktop (no JS flash) */}
            <div className="flex md:hidden" style={{ width: "100%", alignItems: "center", justifyContent: "space-between", position: "relative" }}>
              {canRadio ? <JahknoRadioPlayer playerOffset={0} sidebarWidth={0} variant="mobile" /> : <div style={{ width: 40 }} />}
              {/* data-rb-logo + pointerEvents:auto: the wordmark is the 5-tap switch for the
                  temporary ViewportProbe (ui/ViewportProbe.tsx). It has no other behaviour
                  and nothing sits under it (it is centred between the bell and the radio pill),
                  so hit-testing it changes nothing visible. touch-action/user-select stop
                  iOS double-tap-zoom and text selection on the rapid taps. */}
              <div data-rb-logo style={{
                position: "absolute",
                left: "50%",
                transform: "translateX(-50%)",
                textAlign: "center",
                lineHeight: 1.15,
                pointerEvents: "auto",
                touchAction: "manipulation",
                userSelect: "none",
                WebkitUserSelect: "none",
                WebkitTouchCallout: "none",
              }}>
                <div style={{ fontSize: 15, fontWeight: 900, color: "#fff", letterSpacing: "-0.01em" }}>Redbloods</div>
                <div style={{ fontSize: 8, fontWeight: 800, color: "#DC2626", letterSpacing: "0.22em", textTransform: "uppercase" }}>Records</div>
              </div>
              {/* Bell + "פעולות" pill sit together on the far side, away from the
                  centered wordmark — avoids header crowding on small screens.
                  Identical on every route (no per-page override); the pill is
                  owner-only, the bell is owner + Victor. */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {canSeeBell && <NotificationsBell />}
                {isOwner ? <QuickActionsButton /> : <div style={{ width: 40 }} />}
              </div>
            </div>

            {/* Desktop header — CSS hidden on mobile (no JS flash) */}
            <div className="hidden md:flex" style={{ width: "100%", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {canRadio ? (
                  <JahknoRadioPlayer
                    playerOffset={playerVisible ? PLAYER_H : 0}
                    sidebarWidth={SIDEBAR_WIDTH}
                    variant="desktop"
                  />
                ) : <div />}
                {canSeeBell && <NotificationsBell />}
              </div>
              {/* Owner chrome, identical on every route. */}
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {isOwner && <QuickActionsButton />}
              </div>
            </div>
          </header>

          {/* Content row: page + desktop chat sidebar */}
          <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
            {/* Scrollable page content */}
            <div
              ref={contentRef}
              className="app-shell-content"
              style={{
                flex: 1,
                overflowY: "auto",
                overflowX: "hidden",
                /*
                  Desktop: inner scroll container.
                  Mobile: CSS overrides overflow to visible + removes transform,
                  so the body scrolls instead (iOS touch fix — see globals.css).
                  paddingBottom reserves space for:
                    - mobile bottom nav (56px + safe-area) always on mobile
                    - mini player height when visible
                */
                paddingBottom: isMobile
                  ? playerVisible
                    ? `calc(${navClearance} + ${MOBILE_PLAYER_H + 16}px)`
                    : navClearance
                  : playerVisible
                    ? PLAYER_H + 8
                    : undefined,
              }}
            >
              {children}
            </div>

          </div>
        </main>
      </div>

      {/*
        Mobile bottom nav. Rendered by MobileNav through a portal directly under
        <body> (position:fixed;bottom:0 from globals.css's mobile-scope
        .app-shell-nav rule), so it sits outside this shell's overflow chain and is
        positioned against the viewport only. Its height (safe-area padding
        included) and the mobile mini player's `bottom` come from measuring the
        real <nav> node through the setMobileNav callback ref — see
        navEl/measuredNavH/navClearance above — not guessed.
        Hidden on desktop via md:hidden inside MobileNav.
      */}
      <MobileNav navRef={setMobileNav} />

      {/* ── Overlays & floating elements ── */}

      {/* Desktop mini player */}
      <div
        className="fixed bottom-0 z-50 hidden md:block"
        style={{
          left: 0,
          right: SIDEBAR_WIDTH,
          transform: playerVisible ? "translateY(0)" : "translateY(100%)",
          transition: "left 0.3s, transform 0.25s",
        }}
      >
        <MiniPlayer />
      </div>

      {/* Mobile mini player — above bottom nav */}
      {/* pointer-events:none when hidden — iOS Safari keeps touch hitbox at
          layout position even after transform, so the invisible wrapper would
          block taps on content below if pointer-events were left as "auto". */}
      {/* Portalled to <body> like the bottom nav: same fixed/viewport isolation,
          same z-index (50, or 1002 over the Victor sheet) so its stacking against
          the nav and page content is unchanged. Context (player/projects) flows
          through the portal. Player/Radio logic untouched. */}
      {isClient && createPortal(
        <div
          data-rb-miniplayer
          className="fixed left-0 right-0 z-50 md:hidden"
          style={{
            // navClearance clears the fixed bottom nav (its OWN measured height,
            // safe-area included — see measuredNavH above). The Victor work sheet
            // (position:fixed inset:0) COVERS that nav, so while it is open there is
            // nothing to clear — drop the navClearance term and dock flush to the
            // viewport bottom (same as the roles that have no bottom nav). Nothing
            // else about the wrapper changes: still position:fixed, still
            // viewport-relative, no transform/height change.
            bottom: victorSheetOpen
              ? "env(safe-area-inset-bottom)"
              : navClearance,
            transform: playerVisible ? "translateY(0)" : "translateY(100%)",
            transition: "transform 0.25s",
            pointerEvents: playerVisible ? "auto" : "none",
            // Lift above the Victor work sheet (z-1001) so that overlay reuses THIS
            // MiniPlayer instead of rendering its own. Its inner sub-modals are all
            // ≥ z-2000, so they still sit above the player.
            zIndex: victorSheetOpen ? 1002 : undefined,
          }}
        >
          <MiniPlayer mobile />
        </div>,
        document.body
      )}

      {/* MobileFAB (floating + quick-actions sheet) removed — the red
          "פעולות מהירות" button is now the single entry point. */}
      <PushManager />

      {quickActions.open && (
        <QuickActionsModal
          initialProjectId={quickActions.projectId}
          initialClientName={quickActions.clientName}
          initialDate={quickActions.date}
          initialTime={quickActions.time}
          onClose={() => setQuickActions({ open: false, projectId: null, clientName: null, date: null, time: null })}
        />
      )}

      {/* TEMPORARY diagnostic (nav-jump bug): ViewportProbe replaces DebugOverlay while
          it is in use so the two never overlap. OFF by default; 5 taps on the logo (or
          ?debug=1 / ?debug=0) toggle it. To go back: delete this line and restore
            <Suspense fallback={null}><DebugOverlay shellRef={shellRef} navRef={mobileNavRef} /></Suspense>
          (DebugOverlay.tsx itself is untouched). */}
      <ViewportProbe measuredNavH={measuredNavH} />
    </div>
    </GlobalProjectDrawerProvider>
  );
}
