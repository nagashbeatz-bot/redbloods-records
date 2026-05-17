"use client";

import { useState, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import ChatPanel from "./ai/ChatPanel";
import MiniPlayer from "./ui/MiniPlayer";
import { useProjects } from "@/components/ProjectsProvider";
import { usePlayerSafe } from "@/components/PlayerProvider";
import JahknoRadioPlayer from "@/components/radio/JahknoRadioPlayer";
import GlobalProjectDrawerProvider from "@/components/GlobalProjectDrawer";

const CHAT_WIDTH    = 320; // px — agent chat panel (left side in RTL)
const SIDEBAR_WIDTH = 224; // px — navigation sidebar (right side in RTL, w-56)
const PLAYER_H      = 60;  // px — mini player height

const MOBILE_NAV_H = 56; // px — bottom nav height on mobile
const MOBILE_PLAYER_H = 50; // px — compact mobile player height

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [chatOpen, setChatOpen] = useState(false);
  const { projects } = useProjects();
  const player = usePlayerSafe();
  const playerVisible = !!(player?.track);
  const [isMobile, setIsMobile] = useState(false);

  const [pendingPrompt, setPendingPrompt] = useState<string | undefined>(undefined);
  const contentRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [pathname]);

  // Auto-mark past sessions as "התקיים" on every app load (global — all projects)
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
    }).catch(() => {}); // fire-and-forget, non-fatal
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

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "#0D0D0D" }}>
      <Sidebar onOpenChat={() => setChatOpen(true)} />

      <main className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header
          className="h-14 flex items-center justify-between px-6 border-b sticky top-0 z-40"
          style={{ background: "#141414", borderColor: "#2A2A2A" }}
        >
          {/* Left side — Jahkno Radio trigger (hidden on mobile) */}
          <div className="hidden md:block">
            <JahknoRadioPlayer
              playerOffset={playerVisible ? PLAYER_H : 0}
              sidebarWidth={SIDEBAR_WIDTH}
            />
          </div>

          {/* Mobile left placeholder */}
          <div className="md:hidden" />

          {/* Right side — AI agent toggle */}
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

        <div className="flex flex-1 min-h-0">
          {/* Page content — bottom padding when player visible */}
          <div
            ref={contentRef}
            className="flex-1 overflow-auto pb-16 md:pb-0"
            style={{
              paddingBottom: playerVisible
                ? isMobile
                  ? MOBILE_NAV_H + MOBILE_PLAYER_H + 8
                  : PLAYER_H + 8
                : undefined,
            }}
          >
            <GlobalProjectDrawerProvider>
              {children}
            </GlobalProjectDrawerProvider>
          </div>

          {/* Chat sidebar */}
          <div
            className="hidden md:flex flex-col border-r flex-shrink-0 sticky top-14 overflow-hidden transition-all duration-300"
            style={{
              background: "#141414",
              borderColor: "#2A2A2A",
              height: `calc(100vh - 56px)`,
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
              />
            )}
          </div>
        </div>
      </main>

      {/* Mobile chat overlay */}
      {chatOpen && (
        <div className="md:hidden fixed inset-0 z-50" style={{ background: "#0D0D0D" }}>
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
          />
        </div>
      )}

      {/*
        Mini Player — RTL layout:
          RIGHT side = Sidebar (w-56 = 224px) — navigation, in-flow
          LEFT  side = Chat panel (320px) — agent, in-flow

        The player must avoid overlapping the chat panel on the left.
        We set:  left = CHAT_WIDTH when chat open, 0 when closed
                 right = SIDEBAR_WIDTH (always — sidebar is always visible)
      */}
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

      {/* Mobile: full-width player — sits above bottom nav (56 px) */}
      <div
        className="fixed left-0 right-0 z-50 md:hidden"
        style={{
          bottom: 56,
          transform: playerVisible ? "translateY(0)" : "translateY(100%)",
          transition: "transform 0.25s",
        }}
      >
        <MiniPlayer mobile />
      </div>
    </div>
  );
}
