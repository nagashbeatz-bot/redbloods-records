"use client";

import type { SocialContentItem, SocialContentStatus } from "@/lib/types";

const GROUPS: { label: string; statuses: SocialContentStatus[]; color: string; emoji: string }[] = [
  { label: "מוכן להעלאה", statuses: ["ready", "scheduled"], color: "#10B981", emoji: "⬆" },
  { label: "צריך צילום",  statuses: ["idea", "needs_shoot"], color: "#F59E0B", emoji: "🎬" },
  { label: "בעריכה",      statuses: ["shot", "in_edit", "needs_review"], color: "#8B5CF6", emoji: "✂" },
  { label: "פורסם",       statuses: ["posted"], color: "#22C55E", emoji: "✓" },
];

export default function KPICards({ items }: { items: SocialContentItem[] }) {
  const activeItems = items.filter((i) => i.status !== "cancelled");
  const total = activeItems.length;
  const today = new Date().toISOString().slice(0, 10);
  const overdueCount = activeItems.filter(
    (i) => i.due_date && i.due_date < today && i.status !== "posted"
  ).length;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
      {/* Total */}
      <div style={{
        background: "#1A1A1A", borderRadius: 12, padding: "12px 14px",
        border: "1px solid #2A2A2A", position: "relative",
      }}>
        <div style={{ fontSize: 10, color: "#555", marginBottom: 4, fontWeight: 600 }}>סה"כ תכנים</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: "#F0F0F0" }}>{total}</div>
        {overdueCount > 0 && (
          <div style={{
            position: "absolute", top: 8, left: 8,
            fontSize: 10, fontWeight: 700, color: "#EF4444",
            background: "#EF444422", borderRadius: 8, padding: "2px 6px",
          }}>
            ⚠ {overdueCount} דחוף
          </div>
        )}
      </div>

      {GROUPS.map(({ label, statuses, color, emoji }) => {
        const count = activeItems.filter((i) => statuses.includes(i.status)).length;
        const hasOverdue = statuses.some((s) => s !== "posted" && s !== "idea") &&
          activeItems.some((i) => statuses.includes(i.status) && i.due_date && i.due_date < today);
        return (
          <div
            key={label}
            style={{
              background: "#1A1A1A", borderRadius: 12, padding: "12px 14px",
              border: `1px solid ${count > 0 ? color + "33" : "#2A2A2A"}`,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ fontSize: 10, color: "#555", marginBottom: 4, fontWeight: 600, flex: 1 }}>{label}</div>
              <span style={{ fontSize: 14 }}>{emoji}</span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: count > 0 ? color : "#333" }}>{count}</div>
            {hasOverdue && count > 0 && (
              <div style={{ fontSize: 10, color: "#EF4444", marginTop: 2 }}>⚠ דחוף</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
