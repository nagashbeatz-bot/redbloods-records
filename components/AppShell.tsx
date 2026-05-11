"use client";

import { useState, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import ChatPanel from "./ai/ChatPanel";
import MiniPlayer from "./ui/MiniPlayer";
import { useProjects } from "@/components/ProjectsProvider";
import { usePlayerSafe } from "@/components/PlayerProvider";

const CHAT_WIDTH    = 320; // px — agent chat panel (left side in RTL)
const SIDEBAR_WIDTH = 224; // px — navigation sidebar (right side in RTL, w-56)
const PLAYER_H      = 60;  // px — mini player height

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [chatOpen, setChatOpen] = useState(true);
  const { projects } = useProjects();
  const player = usePlayerSafe();
  const playerVisible = !!(player?.track);

  const [pendingPrompt, setPendingPrompt] = useState<string | undefined>(undefined);
  const contentRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [pathname]);

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
      <Sidebar />

      <main className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header
          className="h-14 flex items-center justify-between px-6 border-b sticky top-0 z-40"
          style={{ background: "#141414", borderColor: "#2A2A2A" }}
        >
          <div />
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
            className="flex-1 overflow-auto"
            style={{ paddingBottom: playerVisible ? PLAYER_H + 8 : 0 }}
          >
            {children}
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

      {/* Mobile: full-width player */}
      <div
        className="fixed bottom-0 left-0 right-0 z-50 md:hidden"
        style={{
          transform: playerVisible ? "translateY(0)" : "translateY(100%)",
          transition: "transform 0.25s",
        }}
      >
        <MiniPlayer />
      </div>
    </div>
  );
}
