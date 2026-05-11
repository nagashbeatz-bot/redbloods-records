"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import type { ParsedCalendarEvent } from "@/lib/calendar-utils";
import { formatDateShort } from "@/lib/calendar-utils";
import EventCard from "@/components/calendar/EventCard";

type State =
  | { status: "loading" }
  | { status: "not_connected" }
  | { status: "error"; message: string }
  | { status: "ok"; today: ParsedCalendarEvent[]; week: ParsedCalendarEvent[] };

// Group week events by date
function groupByDate(events: ParsedCalendarEvent[]): [string, ParsedCalendarEvent[]][] {
  const map = new Map<string, ParsedCalendarEvent[]>();
  for (const e of events) {
    const key = e.startTime.slice(0, 10); // YYYY-MM-DD
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(e);
  }
  return Array.from(map.entries());
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
          setState({ status: "ok", today: data.today, week: data.week });
        }
      })
      .catch((e) => setState({ status: "error", message: e.message }));
  }, []);

  // ── Loading ─────────────────────────────────────────────────────────────────
  if (state.status === "loading") {
    return (
      <CalendarShell>
        <div style={{ color: "#333", fontSize: 12, padding: "8px 0" }}>טוען יומן...</div>
      </CalendarShell>
    );
  }

  // ── Not connected ───────────────────────────────────────────────────────────
  if (state.status === "not_connected") {
    return (
      <CalendarShell>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "6px 0",
          }}
        >
          <span style={{ color: "#444", fontSize: 12 }}>יומן לא מחובר</span>
          <Link
            href="/setup/calendar"
            style={{
              fontSize: 11,
              color: "#3B82F6",
              textDecoration: "none",
              padding: "3px 10px",
              borderRadius: 6,
              border: "1px solid rgba(59,130,246,0.2)",
              background: "rgba(59,130,246,0.06)",
            }}
          >
            חבר →
          </Link>
        </div>
      </CalendarShell>
    );
  }

  // ── Error ───────────────────────────────────────────────────────────────────
  if (state.status === "error") {
    return (
      <CalendarShell>
        <div style={{ color: "#EF4444", fontSize: 11, padding: "6px 0" }}>
          שגיאה: {state.message}
        </div>
      </CalendarShell>
    );
  }

  const { today, week } = state;
  const weekGroups = groupByDate(week);

  // If nothing at all — show clean empty state
  if (today.length === 0 && week.length === 0) {
    return (
      <CalendarShell>
        <div style={{ color: "#333", fontSize: 12, padding: "6px 0" }}>
          אין אירועים ב-7 הימים הקרובים
        </div>
      </CalendarShell>
    );
  }

  return (
    <div
      style={{
        background: "#141414",
        border: "1px solid #252525",
        borderRadius: 20,
        padding: "20px 22px",
      }}
    >
      {/* ── Today ────────────────────────────────────────────────────────── */}
      {today.length > 0 && (
        <section style={{ marginBottom: week.length > 0 ? 24 : 0 }}>
          <SectionTitle label="היום ביומן" count={today.length} />
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
            {today.map((e) => (
              <EventCard key={e.id} event={e} />
            ))}
          </div>
        </section>
      )}

      {/* ── Week ─────────────────────────────────────────────────────────── */}
      {week.length > 0 && (
        <section>
          <SectionTitle label="השבוע הקרוב" count={week.length} />
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 10 }}>
            {weekGroups.map(([date, events]) => (
              <div key={date}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#444",
                    marginBottom: 5,
                    textTransform: "uppercase",
                    letterSpacing: "0.03em",
                  }}
                >
                  {formatDateShort(events[0].startTime)}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {events.map((e) => (
                    <EventCard key={e.id} event={e} compact />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Footer: link to setup */}
      <div
        style={{
          marginTop: 16,
          paddingTop: 12,
          borderTop: "1px solid #1A1A1A",
          display: "flex",
          justifyContent: "flex-end",
        }}
      >
        <Link
          href="/setup/calendar"
          style={{ fontSize: 11, color: "#2A2A2A", textDecoration: "none" }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLAnchorElement).style.color = "#666")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLAnchorElement).style.color = "#2A2A2A")}
        >
          הגדרות יומן
        </Link>
      </div>
    </div>
  );
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function CalendarShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "#141414",
        border: "1px solid #252525",
        borderRadius: 20,
        padding: "16px 20px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 10,
          color: "#333",
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        }}
      >
        <span>📅</span> יומן
      </div>
      {children}
    </div>
  );
}

function SectionTitle({ label, count }: { label: string; count: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "#555",
          letterSpacing: "0.05em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 10,
          color: "#333",
          background: "#1E1E1E",
          borderRadius: 10,
          padding: "1px 6px",
        }}
      >
        {count}
      </span>
    </div>
  );
}
