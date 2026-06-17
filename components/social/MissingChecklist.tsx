"use client";

import type { MissingItem } from "@/lib/social-missing-checker";

interface Props {
  missing: MissingItem[];
}

const severityIcon: Record<string, string> = {
  urgent: "🔴",
  warning: "🟡",
  info: "🔵",
};

export default function MissingChecklist({ missing }: Props) {
  if (missing.length === 0) {
    return (
      <div style={{
        padding: "14px 16px", borderRadius: 12,
        background: "#10B98111", border: "1px solid #10B98133",
        fontSize: 13, color: "#10B981", fontWeight: 600,
      }}>
        ✅ הקמפיין נראה מוכן
      </div>
    );
  }

  const urgentCount = missing.filter((m) => m.severity === "urgent").length;

  return (
    <div style={{ background: "#1A1A1A", borderRadius: 12, border: "1px solid #2A2A2A", overflow: "hidden" }}>
      <div style={{
        padding: "10px 14px",
        borderBottom: "1px solid #222",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#AAA" }}>מה חסר בקמפיין</div>
        {urgentCount > 0 && (
          <span style={{
            fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10,
            background: "#EF444422", border: "1px solid #EF444444", color: "#EF4444",
          }}>
            {urgentCount} דחוף
          </span>
        )}
      </div>
      <div style={{ padding: "8px 0" }}>
        {missing.map((m, i) => (
          <div
            key={i}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "7px 14px",
              fontSize: 13,
              color: m.severity === "urgent" ? "#EF4444" : m.severity === "warning" ? "#F59E0B" : "#888",
            }}
          >
            <span style={{ fontSize: 12 }}>{severityIcon[m.severity]}</span>
            {m.label}
          </div>
        ))}
      </div>
    </div>
  );
}
