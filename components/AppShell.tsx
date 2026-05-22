"use client";

import { useState, useEffect, useRef } from "react";
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

const CHAT_WIDTH    = 320; // px — agent chat panel
const SIDEBAR_WIDTH = 224; // px — desktop sidebar (w-56)
const PLAYER_H      = 60;  // px — desktop mini player
const MOBILE_PLAYER_H = 50; // px — mobile mini player

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [chatOpen, setChatOpen] = useState(false);
  const { projects } = useProjects();
  const player = usePlayerSafe();
  const playerVisible = !!(player?.track);
  const [isMobile, setIsMobile] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<string | undefined>(undefined);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const mobileNavRef = useRef<HTMLElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Scroll content to top on route change (instant — not smooth, to avoid iOS touch lock)
  useEffect(() => {
    contentRef.current?.scrollTo(0, 0);
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
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        background: "#0D0D0D",
      }}
    >
      {/* ── Inner row: sidebar (desktop) + main content ── */}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>

        {/* Desktop sidebar — hidden on mobile */}
        <Sidebar onOpenChat={() => setChatOpen(true)} />

        {/* Main column: header + scrollable content + desktop chat panel */}
        <main
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
            className="flex items-center justify-between px-4 md:px-6 border-b"
            style={{
              background: "#141414",
              borderColor: "#2A2A2A",
              paddingTop: "max(14px, env(safe-area-inset-top))",
              paddingBottom: 14,
              minHeight: 56,
              flexShrink: 0,
            }}
          >
            <div className="hidden md:block">
              <JahknoRadioPlayer
                playerOffset={playerVisible ? PLAYER_H : 0}
                sidebarWidth={SIDEBAR_WIDTH}
              />
            </div>
            <div className="md:hidden" />
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
          </header>

          {/* Content row: page + desktop chat sidebar */}
          <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
            {/* Scrollable page content */}
            <div
              ref={contentRef}
              style={{
                flex: 1,
                overflowY: "auto",
                overflowX: "hidden",
                paddingBottom: playerVisible
                  ? isMobile ? MOBILE_PLAYER_H + 16 : PLAYER_H + 8
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
              {chatOpen && (
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
      {chatOpen && (
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
      <div
        className="fixed left-0 right-0 z-50 md:hidden"
        style={{
          bottom: `calc(56px + env(safe-area-inset-bottom))`,
          transform: playerVisible ? "translateY(0)" : "translateY(100%)",
          transition: "transform 0.25s",
        }}
      >
        <MiniPlayer mobile />
      </div>

      <MobileFAB playerVisible={playerVisible} />
      <PushManager />

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
    ? `calc(56px + 50px + 12px + env(safe-area-inset-bottom))`
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
