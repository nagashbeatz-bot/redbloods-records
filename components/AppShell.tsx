"use client";

import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";
import { Suspense } from "react";
import Sidebar from "./Sidebar";
import MobileNav from "./MobileNav";
import ChatPanel from "./ai/ChatPanel";
import MiniPlayer from "./ui/MiniPlayer";
import DebugOverlay from "./ui/DebugOverlay";
import { useProjects } from "@/components/ProjectsProvider";
import { usePlayerSafe } from "@/components/PlayerProvider";
import JahknoRadioPlayer from "@/components/radio/JahknoRadioPlayer";
import GlobalProjectDrawerProvider from "@/components/GlobalProjectDrawer";
import { useGlobalProjectDrawer } from "@/components/GlobalProjectDrawer";
import PushManager from "@/components/PushManager";
import NotificationsBell from "@/components/dashboard/NotificationsBell";
import QuickActionsModal from "@/components/quick-actions/QuickActionsModal";
import { useRole } from "@/lib/use-role";
import { MAI_AI_ENABLED } from "@/lib/feature-flags";

const CHAT_WIDTH    = 320; // px — agent chat panel
const SIDEBAR_WIDTH = 248; // px — desktop sidebar
const PLAYER_H      = 110; // px — desktop mini player (92px card + 18px bottom margin)
const MOBILE_PLAYER_H = 74; // px — mobile mini player (2-row card)

export default function AppShell({ children, topRight }: { children: React.ReactNode; topRight?: React.ReactNode }) {
  const [chatOpen, setChatOpen] = useState(false);
  const role = useRole();
  const isOwner = role === "owner"; // AI agent + tools are owner-only chrome
  const canRadio = role === "owner" || role === "shalev"; // the external LISTEN radio is available to the artist too
  // shalev + victor have no fixed bottom nav (their logout sits at the end of
  // their page content) → reserve no space for a bar. The paddingBottom below
  // then collapses to env(safe-area-inset-bottom) alone, which is exactly the
  // small iPhone inset we still want under the last card.
  const navH = role === "shalev" || role === "victor" ? 0 : 56;
  const { projects } = useProjects();
  const player = usePlayerSafe();
  const playerVisible = !!(player?.track);
  const [isMobile, setIsMobile] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<string | undefined>(undefined);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [quickActions, setQuickActions] = useState<{ open: boolean; projectId: string | null }>({ open: false, projectId: null });
  const contentRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const mobileNavRef = useRef<HTMLElement>(null);
  const pathname = usePathname();
  // Notifications bell is shown only on the dashboard, beside the LISTEN pill.
  const isDashboard = pathname === "/dashboard";

  useLayoutEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

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
    const handler = (e: Event) => {
      if (!MAI_AI_ENABLED) return; // AI disabled → never open the chat
      const prompt = (e as CustomEvent<string>).detail;
      if (!prompt) return;
      setChatOpen(true);
      setPendingPrompt(prompt);
    };
    window.addEventListener("rb:quicksend", handler);
    return () => window.removeEventListener("rb:quicksend", handler);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<string | null>).detail;
      setSelectedProjectId(id ?? null);
    };
    window.addEventListener("rb:project-selected", handler);
    return () => window.removeEventListener("rb:project-selected", handler);
  }, []);

  // Open the global quick-actions modal (e.g. from the "פעולות מהירות" button).
  useEffect(() => {
    const handler = (e: Event) => {
      const projectId = (e as CustomEvent<{ projectId?: string } | undefined>).detail?.projectId ?? null;
      setQuickActions({ open: true, projectId });
    };
    window.addEventListener("rb:quick-actions", handler);
    return () => window.removeEventListener("rb:quick-actions", handler);
  }, []);

  return (
    /*
      Root shell: position fixed + inset 0 fills the exact visual viewport on
      iOS PWA without any JavaScript. The browser always computes fixed insets
      correctly from frame 0 — no timers, no opacity hacks, no polling needed.

      flex-col so MobileNav (last child) anchors to the real bottom of the
      viewport by layout flow, not by position:fixed.
    */
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
        <Sidebar role={role} onOpenChat={() => setChatOpen(true)} />

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
              <div style={{
                position: "absolute",
                left: "50%",
                transform: "translateX(-50%)",
                textAlign: "center",
                lineHeight: 1.15,
                pointerEvents: "none",
              }}>
                <div style={{ fontSize: 15, fontWeight: 900, color: "#fff", letterSpacing: "-0.01em" }}>Redbloods</div>
                <div style={{ fontSize: 8, fontWeight: 800, color: "#DC2626", letterSpacing: "0.22em", textTransform: "uppercase" }}>Records</div>
              </div>
              {/* Bell on mobile sits on the topRight side (beside the compact "פעולות" pill),
                  away from the centered wordmark — avoids header crowding on small screens. */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {isDashboard && <NotificationsBell />}
                {topRight ?? <div style={{ width: 40 }} />}
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
                ) : (!isDashboard && <div />)}
                {isDashboard && <NotificationsBell />}
              </div>
              {topRight ?? (isOwner && MAI_AI_ENABLED ? (
                <button
                  onClick={() => setChatOpen(!chatOpen)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-xl border text-sm font-medium transition-all"
                  style={{
                    background: chatOpen ? "rgba(59,130,246,0.15)" : "#1A1A1A",
                    borderColor: chatOpen ? "rgba(59,130,246,0.4)" : "#2A2A2A",
                    color: chatOpen ? "#3B82F6" : "#888",
                  }}
                >
                  <span>✦</span>
                  {chatOpen ? "סגור סוכן" : "סוכן AI"}
                </button>
              ) : <div />)}
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
                    ? `calc(${navH}px + ${MOBILE_PLAYER_H + 16}px + env(safe-area-inset-bottom))`
                    : `calc(${navH}px + env(safe-area-inset-bottom))`
                  : playerVisible
                    ? PLAYER_H + 8
                    : undefined,
              }}
            >
              <GlobalProjectDrawerProvider>
                {children}
              </GlobalProjectDrawerProvider>
            </div>

            {/* Desktop chat panel */}
            <div
              className="hidden md:flex flex-col border-r flex-shrink-0 overflow-hidden transition-all duration-300"
              style={{
                background: "#141414",
                borderColor: "#2A2A2A",
                width: chatOpen ? CHAT_WIDTH : 0,
                opacity: chatOpen ? 1 : 0,
                pointerEvents: chatOpen ? "auto" : "none",
              }}
            >
              {MAI_AI_ENABLED && chatOpen && (
                <ChatPanel
                  projects={projects}
                  onClose={() => setChatOpen(false)}
                  pendingPrompt={pendingPrompt}
                  onPromptConsumed={() => setPendingPrompt(undefined)}
                  currentPage={pathname}
                  selectedProjectId={selectedProjectId ?? undefined}
                />
              )}
            </div>
          </div>
        </main>
      </div>

      {/*
        Mobile bottom nav — in layout flow (NOT position:fixed).
        Because the root shell is position:fixed inset:0, this flex child
        always sits at the real bottom of the viewport on first render,
        with no JavaScript, no timers, and no viewport hacks.
        Hidden on desktop via md:hidden inside MobileNav.
      */}
      <MobileNav onOpenChat={() => setChatOpen(true)} navRef={mobileNavRef} />

      {/* ── Overlays & floating elements ── */}

      {/* Mobile: full-screen chat */}
      {MAI_AI_ENABLED && chatOpen && (
        <div
          className="md:hidden"
          style={{ position: "fixed", inset: 0, zIndex: 50, background: "#0D0D0D" }}
        >
          <div style={{ position: "absolute", top: 12, left: 12, zIndex: 51 }}>
            <button
              onClick={() => setChatOpen(false)}
              style={{
                background: "#1A1A1A", border: "1px solid #2A2A2A",
                borderRadius: 10, padding: "8px 14px",
                color: "#888", fontSize: 13, cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              ✕ סגור
            </button>
          </div>
          <ChatPanel
            projects={projects}
            onClose={() => setChatOpen(false)}
            pendingPrompt={pendingPrompt}
            onPromptConsumed={() => setPendingPrompt(undefined)}
            currentPage={pathname}
            selectedProjectId={selectedProjectId ?? undefined}
          />
        </div>
      )}

      {/* Desktop mini player */}
      <div
        className="fixed bottom-0 z-50 hidden md:block"
        style={{
          left: chatOpen ? CHAT_WIDTH : 0,
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
      <div
        className="fixed left-0 right-0 z-50 md:hidden"
        style={{
          bottom: `calc(${navH}px + env(safe-area-inset-bottom))`,
          transform: playerVisible ? "translateY(0)" : "translateY(100%)",
          transition: "transform 0.25s",
          pointerEvents: playerVisible ? "auto" : "none",
        }}
      >
        <MiniPlayer mobile />
      </div>

      {/* MobileFAB (floating + quick-actions sheet) removed — the red
          "פעולות מהירות" button is now the single entry point. */}
      <PushManager />

      {quickActions.open && (
        <QuickActionsModal
          initialProjectId={quickActions.projectId}
          onClose={() => setQuickActions({ open: false, projectId: null })}
        />
      )}

      {/* Debug overlay — only active when ?debug=1 in URL */}
      <Suspense fallback={null}>
        <DebugOverlay shellRef={shellRef} navRef={mobileNavRef} />
      </Suspense>
    </div>
  );
}

// ── Mobile FAB ────────────────────────────────────────────────────────────────

function MobileFAB({ playerVisible }: { playerVisible: boolean }) {
  const [open, setOpen] = useState(false);
  const { openProject } = useGlobalProjectDrawer();
  const pathname = usePathname();

  const fabBottom = playerVisible
    ? `calc(56px + ${MOBILE_PLAYER_H}px + 12px + env(safe-area-inset-bottom))`
    : `calc(56px + 12px + env(safe-area-inset-bottom))`;

  function sendQuickPrompt(text: string) {
    setOpen(false);
    window.dispatchEvent(new CustomEvent("rb:quicksend", { detail: text }));
  }

  const actions = [
    { icon: "♫", label: "פרויקט חדש",  color: "#3B82F6", action: () => { setOpen(false); window.dispatchEvent(new CustomEvent("rb:new-project")); } },
    { icon: "📅", label: "קבע סשן",     color: "#60A5FA", action: () => sendQuickPrompt("קבע לי סשן חדש") },
    { icon: "₪",  label: "הוסף תשלום", color: "#34D399", action: () => sendQuickPrompt("הוסף תשלום לפרויקט") },
    { icon: "💸", label: "הוסף הוצאה", color: "#F59E0B", action: () => sendQuickPrompt("הוסף הוצאה") },
    { icon: "📦", label: "העלה קובץ",  color: "#A855F7", action: () => sendQuickPrompt("העלה קובץ לפרויקט") },
    { icon: "👥", label: "שלח לויקטור",color: "#EC4899", action: () => sendQuickPrompt("שלח פרויקט לויקטור") },
  ];

  if (typeof document === "undefined") return null;

  return (
    <>
      <button
        className="md:hidden fixed z-[9900]"
        onClick={() => setOpen(true)}
        style={{
          bottom: fabBottom, left: 16,
          width: 52, height: 52, borderRadius: "50%",
          background: "linear-gradient(135deg, #3B82F6, #A855F7)",
          border: "none", color: "#fff",
          fontSize: 24, fontWeight: 300, lineHeight: 1,
          cursor: "pointer",
          boxShadow: "0 4px 20px rgba(59,130,246,0.4)",
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "transform 0.15s, box-shadow 0.15s",
        }}
        aria-label="פעולות מהירות"
      >
        +
      </button>

      {open && createPortal(
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 99980,
            background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="rb-sheet-in"
            style={{
              position: "absolute", bottom: 0, left: 0, right: 0,
              background: "#141414", borderTop: "1px solid #2A2A2A",
              borderRadius: "20px 20px 0 0",
              paddingBottom: "env(safe-area-inset-bottom)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 2px" }}>
              <div style={{ width: 36, height: 4, borderRadius: 2, background: "#333" }} />
            </div>
            <div style={{ padding: "8px 0", fontSize: 11, color: "#444", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", textAlign: "center" }}>
              פעולות מהירות
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: "8px 16px 16px" }}>
              {actions.map(({ icon, label, color, action }) => (
                <button
                  key={label}
                  onClick={action}
                  style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "16px 16px", borderRadius: 14,
                    background: "#1A1A1A", border: "1px solid #252525",
                    color: "#CCC", fontSize: 14, fontWeight: 600,
                    cursor: "pointer", fontFamily: "inherit",
                    textAlign: "right",
                  }}
                >
                  <span style={{ fontSize: 22, color }}>{icon}</span>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
