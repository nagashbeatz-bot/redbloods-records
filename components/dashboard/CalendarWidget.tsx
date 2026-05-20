"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ParsedCalendarEvent } from "@/lib/calendar-utils";

type State =
  | { status: "loading" }
  | { status: "not_connected" }
  | { status: "error"; message: string }
  | { status: "ok"; today: ParsedCalendarEvent[]; tomorrow: ParsedCalendarEvent[] };

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
  const name  = e.artist || e.title;

  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "6px 0" }}>
      <div style={{
        width: 6, height: 6, borderRadius: "50%",
        background: color, flexShrink: 0, marginTop: 5,
      }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 10, color: "#555", fontWeight: 600, marginBottom: 1 }}>
          {fmtRange(e)}
        </div>
        <div style={{
          fontSize: 13, color: "#D0D0D0", fontWeight: 500,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {name}
        </div>
        {e.matchedProjectName && (
          <div style={{ fontSize: 10, color: "#A855F7", marginTop: 1 }}>
            → {e.matchedProjectName}
          </div>
        )}
      </div>
    </div>
  );
}

export default function CalendarWidget() {
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "loading" });
  const [isMobile, setIsMobile] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

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
    <div
      onClick={() => router.push("/setup/calendar")}
      style={{
        background: "#141414", border: "1px solid #252525",
        borderRadius: 16, padding: isMobile ? "14px 16px" : "18px 20px",
        cursor: "pointer", transition: "border-color 150ms",
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "#3A3A3A"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "#252525"; }}
    >
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 10,
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
          onClick={(e) => e.stopPropagation()}
          style={{ fontSize: 10, color: "#444", textDecoration: "none" }}
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
          onClick={(e) => e.stopPropagation()}
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
    return shell(<div style={{ color: "#EF4444", fontSize: 11 }}>שגיאה: {state.message}</div>);
  }

  const { today, tomorrow } = state;
  const allEvents = [...today, ...tomorrow];

  if (allEvents.length === 0) {
    return shell(
      <div style={{ color: "#333", fontSize: 12 }}>אין אירועים ב-48 השעות הקרובות</div>
    );
  }

  // ── Mobile: show only next event + "הצג עוד" ─────────────────────────────
  if (isMobile) {
    const next = allEvents[0];
    const rest = allEvents.slice(1);
    const isToday = today.includes(next);

    return shell(
      <div onClick={(e) => e.stopPropagation()}>
        {/* Next event */}
        <div style={{ marginBottom: rest.length > 0 ? 8 : 0 }}>
          <div style={{ fontSize: 10, color: "#444", fontWeight: 700, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>
            {isToday ? "היום" : "מחר"}
          </div>
          <EventRow e={next} />
        </div>

        {/* Remaining events — collapsed by default */}
        {rest.length > 0 && (
          <>
            {showAll && (
              <div style={{ borderTop: "1px solid #1E1E1E", paddingTop: 8, marginTop: 4 }}>
                {rest.map((e) => <EventRow key={e.id} e={e} />)}
              </div>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); setShowAll((v) => !v); }}
              style={{
                marginTop: 8, width: "100%", padding: "7px 0",
                borderRadius: 8, border: "1px solid #252525",
                background: "transparent", color: "#555",
                fontSize: 11, fontWeight: 600, cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {showAll ? "הצג פחות ▲" : `הצג עוד ${rest.length} אירועים ▼`}
            </button>
          </>
        )}
      </div>
    );
  }

  // ── Desktop: full view ────────────────────────────────────────────────────
  return shell(
    <>
      {today.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#444", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 4 }}>
            היום <span style={{ marginRight: 6, fontSize: 10, color: "#2A2A2A", background: "#1E1E1E", borderRadius: 8, padding: "1px 6px" }}>{today.length}</span>
          </div>
          {today.map((e) => <EventRow key={e.id} e={e} />)}
        </div>
      )}
      {tomorrow.length > 0 && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#444", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 4 }}>
            מחר <span style={{ marginRight: 6, fontSize: 10, color: "#2A2A2A", background: "#1E1E1E", borderRadius: 8, padding: "1px 6px" }}>{tomorrow.length}</span>
          </div>
          {tomorrow.map((e) => <EventRow key={e.id} e={e} />)}
        </div>
      )}
    </>
  );
}
