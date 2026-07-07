"use client";

import { useState, useEffect } from "react";
import type { AgentAlert, AlertSeverity } from "@/lib/types";
import { MAI_AI_ENABLED } from "@/lib/feature-flags";

// ── Category definitions ──────────────────────────────────────────────────────

const CATEGORIES = [
  {
    key: "deadline",
    label: "דדליינים",
    icon: "📅",
    types: ["overdue_deadline", "deadline_approaching"],
    color: "#EF4444",
  },
  {
    key: "finance",
    label: "כספים",
    icon: "₪",
    types: ["payment_overdue", "project_no_pricing"],
    color: "#F59E0B",
  },
  {
    key: "sessions",
    label: "סשנים",
    icon: "🎵",
    types: ["session_needs_update", "stale_session"],
    color: "#3B82F6",
  },
  {
    key: "victor",
    label: "ויקטור",
    icon: "👤",
    types: ["victor_stuck", "victor_below_pace"],
    color: "#A855F7",
  },
] as const;

const SEV_WEIGHT: Record<AlertSeverity, number> = {
  urgent: 4, important: 3, warning: 2, info: 1,
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function AgentSummaryCard() {
  const [alerts, setAlerts] = useState<AgentAlert[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!MAI_AI_ENABLED) return; // agent disabled → no fetch; card stays hidden (returns null below)
    fetch("/api/agent/alerts?status=new&limit=50")
      .then((r) => r.json())
      .then((d) => {
        setAlerts(Array.isArray(d) ? d : []);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  if (!MAI_AI_ENABLED || !loaded || alerts.length === 0) return null;

  const urgent = alerts.filter(
    (a) => a.severity === "urgent" || a.severity === "important"
  ).length;

  const categories = CATEGORIES.map((cat) => ({
    ...cat,
    count: alerts.filter((a) => cat.types.includes(a.type as never)).length,
  })).filter((c) => c.count > 0);

  // Top alert (highest severity)
  const topAlert = [...alerts].sort(
    (a, b) => SEV_WEIGHT[b.severity] - SEV_WEIGHT[a.severity]
  )[0];

  return (
    <div
      style={{
        background: "#141414",
        border: "1px solid #2A2A2A",
        borderRadius: 16,
        padding: "16px 20px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Subtle left accent */}
      <div
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: 3,
          background: urgent > 0
            ? "linear-gradient(180deg, #EF4444, #F59E0B)"
            : "linear-gradient(180deg, #3B82F6, #A855F7)",
          borderRadius: "0 16px 16px 0",
        }}
      />

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <span style={{ fontSize: 18 }}>🤖</span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#E5E5E5" }}>
            הסוכן שם לב
          </div>
          <div style={{ fontSize: 12, color: "#666", marginTop: 1 }}>
            {alerts.length} התראות פתוחות
            {urgent > 0 && (
              <span style={{ color: "#EF4444", marginRight: 6, fontWeight: 600 }}>
                · {urgent} דחופות
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Top alert preview */}
      {topAlert && (
        <div
          style={{
            background: "#1A1A1A",
            border: "1px solid #252525",
            borderRadius: 10,
            padding: "10px 12px",
            marginBottom: 14,
          }}
        >
          <div style={{ fontSize: 12, color: "#888", marginBottom: 3 }}>
            <SeverityBadge severity={topAlert.severity} />
            <span style={{ marginRight: 6 }}>{topAlert.title}</span>
          </div>
          <div style={{ fontSize: 12, color: "#CCC", lineHeight: 1.5 }}>
            {topAlert.message}
          </div>
        </div>
      )}

      {/* Category chips */}
      {categories.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {categories.map((cat) => (
            <div
              key={cat.key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "5px 10px",
                borderRadius: 8,
                background: `${cat.color}15`,
                border: `1px solid ${cat.color}30`,
                fontSize: 12,
                color: cat.color,
                fontWeight: 600,
              }}
            >
              <span style={{ fontSize: 14 }}>{cat.icon}</span>
              {cat.label}
              <span
                style={{
                  background: cat.color,
                  color: "#000",
                  borderRadius: 99,
                  padding: "1px 6px",
                  fontSize: 11,
                  fontWeight: 700,
                  minWidth: 18,
                  textAlign: "center",
                }}
              >
                {cat.count}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Link to insights */}
      <div style={{ marginTop: 14, textAlign: "left" }}>
        <a
          href="/insights"
          style={{
            fontSize: 12,
            color: "#3B82F6",
            textDecoration: "none",
            fontWeight: 500,
          }}
        >
          ← ראה את כל ההתראות
        </a>
      </div>
    </div>
  );
}

// ── Severity badge ─────────────────────────────────────────────────────────────

const SEV_STYLE: Record<AlertSeverity, { label: string; color: string; bg: string }> = {
  urgent:    { label: "דחוף",    color: "#EF4444", bg: "rgba(239,68,68,0.15)" },
  important: { label: "חשוב",    color: "#F59E0B", bg: "rgba(245,158,11,0.15)" },
  warning:   { label: "שים לב",  color: "#60A5FA", bg: "rgba(96,165,250,0.15)" },
  info:      { label: "מידע",    color: "#9CA3AF", bg: "rgba(156,163,175,0.15)" },
};

function SeverityBadge({ severity }: { severity: AlertSeverity }) {
  const s = SEV_STYLE[severity];
  return (
    <span
      style={{
        display: "inline-block",
        padding: "1px 6px",
        borderRadius: 6,
        fontSize: 10,
        fontWeight: 700,
        color: s.color,
        background: s.bg,
        marginLeft: 4,
      }}
    >
      {s.label}
    </span>
  );
}
