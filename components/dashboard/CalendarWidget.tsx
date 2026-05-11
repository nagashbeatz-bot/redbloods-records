"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import type { ParsedCalendarEvent } from "@/lib/calendar-utils";

type State =
  | { status: "loading" }
  | { status: "not_connected" }
  | { status: "error"; message: string }
  | { status: "ok"; today: ParsedCalendarEvent[]; tomorrow: ParsedCalendarEvent[] };

// Format time for display
function fmtTime(iso: string): string {
  if (!iso.includes("T")) return "כל היום";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function fmtRange(e: ParsedCalendarEvent): string {
  if (e.isAllDay) return "כל היום";
  return `${fmtTime(e.startTime)}–${fmtTime(e.endTime)}`;
}

const TYPE_COLORS: Record<string, string> = {
  "סשן":       "#A855F7",
  "חזרה":      "#3B82F6",
  "הופעה":     "#EC4899",
  "סאונדצ'ק":  "#F97316",
  "פגישה":     "#10B981",
  "אחר":       "#6B7280",
};

function EventRow({ e }: { e: ParsedCalendarEvent }) {
  const color = TYPE_COLORS[e.type] ?? "#6B7280";
  const label = fmtRange(e);
  const name  = e.artist || e.title;

  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "5px 0" }}>
      {/* Color dot */}
      <div style={{
        width: 6, height: 6, borderRadius: "50%",
        background: color, flexShrink: 0, marginTop: 5,
      }} />
      <div style={{ minWidth: 0 }}>
        {/* Time */}
        <div style={{ fontSize: 10, color: "#555", fontWeight: 600, marginBottom: 1 }}>
          {label}
        </div>
        {/* Title */}
        <div style={{
          fontSize: 12, color: "#D0D0D0", fontWeight: 500,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {name}
        </div>
        {/* Project match */}
        {e.matchedProjectName && (
          <div style={{ fontSize: 10, color: "#A855F7", marginTop: 1 }}>
            → {e.matchedProjectName}
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, events }: { title: string; events: ParsedCalendarEvent[] }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        fontSize: 10, fontWeight: 700, color: "#444",
        letterSpacing: "0.05em", textTransform: "uppercase",
        marginBottom: 4,
      }}>
        {title}
        <span style={{
          marginRight: 6, fontSize: 10, color: "#2A2A2A",
          background: "#1E1E1E", borderRadius: 8, padding: "1px 6px",
        }}>
          {events.length}
        </span>
      </div>
      {events.map((e) => <EventRow key={e.id} e={e} />)}
    </div>
  );
}

export default function CalendarWidget() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    fetch("/api/calendar/events")
      .then((r) => r.json())
      .then((data) => {
        if (data.error === "not_connected") {
          setState({ status: "not_connected" });
        } else if (data.error) {
          setState({ status: "error", message: data.error });
        } else {
          setState({ status: "ok", today: data.today ?? [], tomorrow: data.week ?? [] });
        }
      })
      .catch((e) => setState({ status: "error", message: e.message }));
  }, []);

  const shell = (content: React.ReactNode) => (
    <div style={{
      background: "#141414", border: "1px solid #252525",
      borderRadius: 20, padding: "18px 20px",
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 12,
      }}>
        <div style={{
          fontSize: 11, fontWeight: 700, color: "#555",
          letterSpacing: "0.05em", textTransform: "uppercase",
          display: "flex", alignItems: "center", gap: 6,
        }}>
          <span>📅</span> 48 השעות הקרובות
        </div>
        <Link
          href="/setup/calendar"
          style={{ fontSize: 10, color: "#2A2A2A", textDecoration: "none" }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLAnchorElement).style.color = "#555")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLAnchorElement).style.color = "#2A2A2A")}
        >
          יומן מלא ↗
        </Link>
      </div>
      {content}
    </div>
  );

  if (state.status === "loading") {
    return shell(<div style={{ color: "#333", fontSize: 12 }}>טוען יומן...</div>);
  }

  if (state.status === "not_connected") {
    return shell(
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ color: "#444", fontSize: 12 }}>יומן לא מחובר</span>
        <Link
          href="/setup/calendar"
          style={{
            fontSize: 11, color: "#3B82F6", textDecoration: "none",
            padding: "3px 10px", borderRadius: 6,
            border: "1px solid rgba(59,130,246,0.2)",
            background: "rgba(59,130,246,0.06)",
          }}
        >
          חבר →
        </Link>
      </div>
    );
  }

  if (state.status === "error") {
    return shell(
      <div style={{ color: "#EF4444", fontSize: 11 }}>שגיאה: {state.message}</div>
    );
  }

  const { today, tomorrow } = state;

  if (today.length === 0 && tomorrow.length === 0) {
    return shell(
      <div style={{ color: "#333", fontSize: 12 }}>
        אין אירועים מתוכננים ב-48 השעות הקרובות
      </div>
    );
  }

  return shell(
    <>
      {today.length > 0 && <Section title="היום" events={today} />}
      {tomorrow.length > 0 && <Section title="מחר" events={tomorrow} />}
    </>
  );
}
