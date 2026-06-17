"use client";

import type { SocialContentItem, SocialContentStatus } from "@/lib/types";
import { SOCIAL_CONTENT_STATUS_LABELS } from "@/lib/types";

const GROUPS: { label: string; statuses: SocialContentStatus[]; color: string }[] = [
  { label: "מוכן להעלאה", statuses: ["ready", "scheduled"], color: "#10B981" },
  { label: "צריך צילום",  statuses: ["idea", "needs_shoot"], color: "#F59E0B" },
  { label: "בעריכה",      statuses: ["shot", "in_edit", "needs_review"], color: "#8B5CF6" },
  { label: "פורסם",       statuses: ["posted"], color: "#22C55E" },
];

export default function KPICards({ items }: { items: SocialContentItem[] }) {
  const total = items.filter((i) => i.status !== "cancelled").length;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
      {/* Total */}
      <div
        style={{
          gridColumn: "1 / -1",
          background: "#1A1A1A",
          borderRadius: 12,
          padding: "12px 16px",
          border: "1px solid #2A2A2A",
        }}
      >
        <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>סה"כ תכנים</div>
        <div style={{ fontSize: 24, fontWeight: 700, color: "#F0F0F0" }}>{total}</div>
      </div>

      {GROUPS.map(({ label, statuses, color }) => {
        const count = items.filter((i) => statuses.includes(i.status)).length;
        return (
          <div
            key={label}
            style={{
              background: "#1A1A1A",
              borderRadius: 12,
              padding: "12px 16px",
              border: `1px solid ${count > 0 ? color + "33" : "#2A2A2A"}`,
            }}
          >
            <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: count > 0 ? color : "#444" }}>{count}</div>
          </div>
        );
      })}
    </div>
  );
}
