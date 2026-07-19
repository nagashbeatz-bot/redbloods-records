"use client";

// ── Dashboard notifications bell + dropdown ────────────────────────────────
// UI ONLY — mock data, no fetch / no agent_alerts / no push / no API / no DB.
// Structured so future wiring is a one-liner: replace MOCK_NOTIFICATIONS with a
// real source (same NotificationItem shape) and the whole UI keeps working.

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";

// ── Data shape (ready for real data later) ─────────────────────────────────
type NotifType = "warning" | "deadline" | "session" | "file" | "followup" | "version" | "payment" | "victor";

export interface NotificationItem {
  id: string;
  type: NotifType;
  title: string;
  desc: string;
  time: string;   // display string (mock-only; real data would format from a timestamp)
  unread: boolean;
}

// ── Per-type icon color / tint (matches the existing dashboard palette) ─────
const TYPE_STYLE: Record<NotifType, { color: string; bg: string }> = {
  warning:  { color: "#EF4444", bg: "rgba(239,68,68,0.12)"  },
  deadline: { color: "#F59E0B", bg: "rgba(245,158,11,0.12)" },
  session:  { color: "#3B82F6", bg: "rgba(59,130,246,0.12)" },
  file:     { color: "#06B6D4", bg: "rgba(6,182,212,0.12)"  },
  followup: { color: "#10B981", bg: "rgba(16,185,129,0.12)" },
  version:  { color: "#A855F7", bg: "rgba(168,85,247,0.12)" },
  payment:  { color: "#10B981", bg: "rgba(16,185,129,0.12)" },
  victor:   { color: "#A855F7", bg: "rgba(168,85,247,0.12)" },
};

// ── Mock notifications (TODO: replace with real data — same shape) ──────────
const MOCK_NOTIFICATIONS: NotificationItem[] = [
  { id: "n1", type: "warning",  title: "תשלום באיחור",        desc: "פרויקט קרן אלדין — 3 ימים באיחור",      time: "לפני שעה",    unread: true  },
  { id: "n2", type: "deadline", title: "דדליין עבר",           desc: "מאסטרינג לשיר 'ילד חרא'",               time: "לפני 3 שעות", unread: true  },
  { id: "n3", type: "session",  title: "סשן מחר",              desc: "הקלטה עם טייגוסטי — מחר ב-18:00",       time: "לפני 5 שעות", unread: true  },
  { id: "n4", type: "file",     title: "קובץ חדש עלה",         desc: "Dropbox: קבצים נוספו לפרויקט",          time: "אתמול",        unread: true  },
  { id: "n5", type: "followup", title: "צריך פולואפ",          desc: "הצעת מחיר ממתינה לתשובה",               time: "אתמול",        unread: true  },
  { id: "n6", type: "version",  title: "גרסה חדשה מ-Steven",   desc: "מיקס 3 הועלה לפרויקט Tasty",            time: "לפני יומיים",  unread: true  },
  { id: "n7", type: "payment",  title: "תשלום התקבל",          desc: "פרויקט תראות סומן כשולם",              time: "לפני 3 ימים",  unread: false },
  { id: "n8", type: "victor",   title: "עדכון מויקטור",        desc: "העבודה חזרה לבדיקה",                    time: "לפני 4 ימים",  unread: false },
];

// ── Icons (inline SVG, currentColor — matches the de-emoji direction) ───────
const ic = { fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

function BellIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ic}>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

function TypeIcon({ type, size = 17 }: { type: NotifType; size?: number }) {
  switch (type) {
    case "warning":
      return (<svg width={size} height={size} viewBox="0 0 24 24" {...ic}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>);
    case "deadline":
      return (<svg width={size} height={size} viewBox="0 0 24 24" {...ic}><path d="M5 22h14" /><path d="M5 2h14" /><path d="M17 22v-4.2a2 2 0 0 0-.6-1.4L12 12l-4.4 4.4a2 2 0 0 0-.6 1.4V22" /><path d="M7 2v4.2a2 2 0 0 0 .6 1.4L12 12l4.4-4.4A2 2 0 0 0 17 6.2V2" /></svg>);
    case "session":
      return (<svg width={size} height={size} viewBox="0 0 24 24" {...ic}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" /></svg>);
    case "file":
      return (<svg width={size} height={size} viewBox="0 0 24 24" {...ic}><path d="M12 13v8" /><path d="m8 17 4-4 4 4" /><path d="M20 16.6A5 5 0 0 0 18 7h-1.3A8 8 0 1 0 4 15.2" /></svg>);
    case "followup":
      return (<svg width={size} height={size} viewBox="0 0 24 24" {...ic}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" /></svg>);
    case "version":
      return (<svg width={size} height={size} viewBox="0 0 24 24" {...ic}><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>);
    case "payment":
      return (<svg width={size} height={size} viewBox="0 0 24 24" {...ic}><path d="M22 11.1V12a10 10 0 1 1-5.9-9.1" /><path d="m9 11 3 3L22 4" /></svg>);
    case "victor":
      return (<svg width={size} height={size} viewBox="0 0 24 24" {...ic}><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>);
  }
}

// ── Panel geometry ─────────────────────────────────────────────────────────
const PANEL_W = 344;

interface PanelPos { top: number; left: number; width: number; }

export default function NotificationsBell() {
  const [open, setOpen]       = useState(false);
  const [tab, setTab]         = useState<"all" | "unread">("all");
  const [mounted, setMounted] = useState(false);
  const [pos, setPos]         = useState<PanelPos | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setMounted(true), []);

  const items       = MOCK_NOTIFICATIONS;
  const unreadCount = items.filter((n) => n.unread).length;
  const shown       = tab === "unread" ? items.filter((n) => n.unread) : items;

  // Position the panel under the bell, clamped to the viewport.
  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const isMobile = window.innerWidth < 768;
    const width = isMobile ? Math.min(PANEL_W, window.innerWidth - 24) : PANEL_W;
    let left = r.left + r.width / 2 - width / 2;          // centered under the bell…
    left = Math.max(12, Math.min(left, window.innerWidth - width - 12)); // …then clamped
    setPos({ top: r.bottom + 8, left, width });
  }, []);

  // Recompute on open + while open (resize / scroll).
  useEffect(() => {
    if (!open) return;
    place();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, place]);

  return (
    <>
      {/* ── Bell button (sits next to LISTEN) ── */}
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        title="התראות"
        aria-label="התראות"
        className="rb-bell-btn"
        style={{
          position: "relative",
          width: 34, height: 34, borderRadius: "50%",
          flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: open ? "rgba(220,38,38,0.12)" : "#161616",
          border: `1px solid ${open ? "rgba(220,38,38,0.45)" : "#242424"}`,
          color: open ? "#EF4444" : "#9A9A9A",
          cursor: "pointer",
          transition: "background 0.15s, border-color 0.15s, color 0.15s",
          fontFamily: "inherit",
        }}
        onMouseEnter={(e) => {
          if (open) return;
          e.currentTarget.style.background = "#1E1E1E";
          e.currentTarget.style.borderColor = "#333";
          e.currentTarget.style.color = "#CFCFCF";
        }}
        onMouseLeave={(e) => {
          if (open) return;
          e.currentTarget.style.background = "#161616";
          e.currentTarget.style.borderColor = "#242424";
          e.currentTarget.style.color = "#9A9A9A";
        }}
      >
        <BellIcon size={18} />
        {unreadCount > 0 && (
          <span
            style={{
              position: "absolute", top: -4, right: -4,
              minWidth: 17, height: 17, padding: "0 4px",
              borderRadius: 9,
              background: "#DC2626",
              border: "2px solid #141414",   // matches the header bg, so it reads as a cutout
              color: "#fff", fontSize: 10, fontWeight: 800, lineHeight: 1,
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 0 8px rgba(220,38,38,0.6)",
            }}
          >
            {unreadCount}
          </span>
        )}
      </button>

      {/* ── Dropdown (portal — avoids header/main overflow clipping) ── */}
      {mounted && open && pos && createPortal(
        <>
          {/* click-outside backdrop (transparent) */}
          <div
            onClick={() => setOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 9997, background: "transparent" }}
          />
          <div
            dir="rtl"
            role="dialog"
            aria-label="התראות"
            style={{
              position: "fixed",
              top: pos.top, left: pos.left, width: pos.width,
              maxHeight: "min(70vh, 560px)",
              zIndex: 9998,
              display: "flex", flexDirection: "column",
              background: "#181818",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 18,
              boxShadow: "0 24px 64px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.04)",
              overflow: "hidden",
              fontFamily: "'Heebo', Arial, sans-serif",
            }}
          >
            {/* Header: title + filter tabs */}
            <div style={{ padding: "14px 16px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 11 }}>
                <span style={{ fontSize: 15, fontWeight: 900, color: "#F2F2F2", letterSpacing: "-0.01em" }}>התראות</span>
                <span style={{ fontSize: 11, color: "#606060" }}>{unreadCount} חדשות</span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <FilterPill label="הכל"     active={tab === "all"}    onClick={() => setTab("all")} />
                <FilterPill label="לא נקראו" active={tab === "unread"} onClick={() => setTab("unread")} count={unreadCount} />
              </div>
            </div>

            {/* List */}
            <div style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>
              {shown.length === 0 ? (
                <div style={{ padding: "40px 16px", textAlign: "center", color: "#606060", fontSize: 13 }}>
                  אין התראות חדשות
                </div>
              ) : (
                shown.map((n) => <NotificationRow key={n.id} n={n} />)
              )}
            </div>

            {/* Footer (visual only — no navigation for now) */}
            <button
              type="button"
              className="rb-bell-footer"
              onClick={() => { /* visual-only: no navigation yet */ }}
              style={{
                flexShrink: 0,
                width: "100%",
                padding: "12px 16px",
                borderTop: "1px solid rgba(255,255,255,0.06)",
                background: "transparent",
                border: "none",
                borderTopWidth: 1, borderTopStyle: "solid", borderTopColor: "rgba(255,255,255,0.06)",
                color: "#9A9A9A", fontSize: 12.5, fontWeight: 600,
                cursor: "pointer", fontFamily: "inherit", textAlign: "center",
                transition: "color 0.15s, background 0.15s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "#E8E8E8"; e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "#9A9A9A"; e.currentTarget.style.background = "transparent"; }}
            >
              לכל ההתראות ←
            </button>
          </div>
        </>,
        document.body
      )}
    </>
  );
}

// ── Filter pill ────────────────────────────────────────────────────────────
function FilterPill({ label, active, onClick, count }: { label: string; active: boolean; onClick: () => void; count?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "5px 13px", borderRadius: 99,
        fontSize: 12, fontWeight: 700, fontFamily: "inherit",
        cursor: "pointer",
        background: active ? "rgba(220,38,38,0.12)" : "transparent",
        border: `1px solid ${active ? "rgba(220,38,38,0.5)" : "rgba(255,255,255,0.10)"}`,
        color: active ? "#F87171" : "#8A8A8A",
        transition: "all 0.15s",
      }}
      onMouseEnter={(e) => { if (!active) { e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)"; e.currentTarget.style.color = "#C0C0C0"; } }}
      onMouseLeave={(e) => { if (!active) { e.currentTarget.style.borderColor = "rgba(255,255,255,0.10)"; e.currentTarget.style.color = "#8A8A8A"; } }}
    >
      {count != null && (
        <span style={{
          minWidth: 16, height: 16, padding: "0 4px", borderRadius: 8,
          background: active ? "rgba(220,38,38,0.35)" : "rgba(255,255,255,0.10)",
          color: active ? "#FCA5A5" : "#B0B0B0",
          fontSize: 10, fontWeight: 800, lineHeight: 1,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
        }}>{count}</span>
      )}
      {label}
    </button>
  );
}

// ── One notification row ───────────────────────────────────────────────────
function NotificationRow({ n }: { n: NotificationItem }) {
  const ts = TYPE_STYLE[n.type];
  return (
    <div
      className="rb-bell-row"
      style={{
        position: "relative",
        display: "flex", alignItems: "flex-start", gap: 12,
        padding: "13px 16px",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
        background: n.unread ? "rgba(255,255,255,0.015)" : "transparent",
        cursor: "pointer",
        transition: "background 0.13s",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = n.unread ? "rgba(255,255,255,0.015)" : "transparent"; }}
    >
      {/* Text (right-aligned in RTL) */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          {n.unread && (
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#DC2626", flexShrink: 0, boxShadow: "0 0 5px rgba(220,38,38,0.7)" }} />
          )}
          <span style={{
            fontSize: 13.5, fontWeight: n.unread ? 800 : 700, color: n.unread ? "#F2F2F2" : "#C8C8C8",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{n.title}</span>
        </div>
        <div style={{ fontSize: 12, color: "#8C8C8C", marginTop: 3, lineHeight: 1.45, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {n.desc}
        </div>
        <div style={{ fontSize: 10.5, color: "#585858", marginTop: 5 }}>{n.time}</div>
      </div>

      {/* Icon (left in RTL) */}
      <div style={{
        width: 36, height: 36, borderRadius: 11, flexShrink: 0,
        background: ts.bg, color: ts.color,
        border: `1px solid ${ts.color}33`,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <TypeIcon type={n.type} />
      </div>
    </div>
  );
}
