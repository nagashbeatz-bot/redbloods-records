"use client";

import type { ParsedCalendarEvent } from "@/lib/calendar-utils";
import { formatTime, formatDuration } from "@/lib/calendar-utils";

// ─── Event type config ────────────────────────────────────────────────────────

const TYPE_CONFIG = {
  "סשן":        { emoji: "🎙", color: "#3B82F6" },
  "הופעה":      { emoji: "🎤", color: "#EC4899" },
  "חזרה":       { emoji: "🥁", color: "#F59E0B" },
  "סאונדצ'ק":   { emoji: "🎚", color: "#10B981" },
  "פגישה":      { emoji: "💬", color: "#A855F7" },
  "אחר":        { emoji: "📌", color: "#6B7280" },
} as const;

interface Props {
  event: ParsedCalendarEvent;
  /** Compact variant used inside the week section */
  compact?: boolean;
}

export default function EventCard({ event, compact = false }: Props) {
  const cfg = TYPE_CONFIG[event.type] ?? TYPE_CONFIG["אחר"];

  if (compact) {
    // ── Compact (week view) ─────────────────────────────────────────────────
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "6px 10px",
          borderRadius: 8,
          background: "#1A1A1A",
          borderRight: `2px solid ${cfg.color}`,
        }}
      >
        <span style={{ fontSize: 13 }}>{cfg.emoji}</span>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "#D0D0D0",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {event.artist ? `${event.artist}` : event.title}
            {event.context && (
              <span style={{ fontWeight: 400, color: "#666" }}> · {event.context}</span>
            )}
          </div>

          {event.matchedProjectName && (
            <div style={{ fontSize: 10, color: "#3B82F6", marginTop: 1 }}>
              → {event.matchedProjectName}
            </div>
          )}
        </div>

        <div style={{ textAlign: "left", flexShrink: 0 }}>
          <div style={{ fontSize: 11, color: "#555", whiteSpace: "nowrap" }}>
            {event.isAllDay ? "כל היום" : formatTime(event.startTime)}
          </div>
          {event.durationMinutes > 0 && (
            <div style={{ fontSize: 10, color: "#3A3A3A" }}>
              {formatDuration(event.durationMinutes)}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Full card (today view) ──────────────────────────────────────────────────
  return (
    <div
      style={{
        padding: "10px 14px",
        borderRadius: 10,
        background: `${cfg.color}0A`,
        border: `1px solid ${cfg.color}22`,
        borderRight: `3px solid ${cfg.color}`,
      }}
    >
      {/* Top row: type badge + time */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: event.artist ? 4 : 0,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: cfg.color,
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          {cfg.emoji} {event.type}
        </span>

        <div style={{ textAlign: "left" }}>
          <span style={{ fontSize: 12, color: "#888", fontWeight: 500 }}>
            {event.isAllDay ? "כל היום" : formatTime(event.startTime)}
          </span>
          {event.durationMinutes > 0 && (
            <span style={{ fontSize: 11, color: "#444", marginRight: 6 }}>
              ({formatDuration(event.durationMinutes)})
            </span>
          )}
        </div>
      </div>

      {/* Artist */}
      {event.artist && (
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "#E0E0E0",
            marginBottom: event.context ? 2 : 0,
          }}
        >
          {event.artist}
        </div>
      )}

      {/* Context (project / location) */}
      {event.context && (
        <div style={{ fontSize: 12, color: "#666" }}>{event.context}</div>
      )}

      {/* Physical location */}
      {event.location && (
        <div style={{ fontSize: 11, color: "#444", marginTop: 3 }}>📍 {event.location}</div>
      )}

      {/* Matched Monday project */}
      {event.matchedProjectName && (
        <div
          style={{
            display: "inline-block",
            marginTop: 6,
            fontSize: 11,
            color: "#3B82F6",
            background: "rgba(59,130,246,0.08)",
            border: "1px solid rgba(59,130,246,0.2)",
            borderRadius: 6,
            padding: "1px 7px",
          }}
        >
          → {event.matchedProjectName}
        </div>
      )}
    </div>
  );
}
