"use client";

import { useState } from "react";
import type { SocialContentItem, SocialContentStatus, SocialPlatform } from "@/lib/types";
import {
  SOCIAL_CONTENT_STATUS_LABELS,
  SOCIAL_CONTENT_STATUS_COLORS,
  SOCIAL_CONTENT_STATUSES,
  SOCIAL_PLATFORMS,
  SOCIAL_PLATFORM_LABELS,
  SOCIAL_PLATFORM_ICONS,
} from "@/lib/types";

interface Props {
  items: SocialContentItem[];
  onUpdate: (id: string, patch: Partial<SocialContentItem>) => Promise<unknown>;
  onDelete: (id: string) => Promise<void>;
}

function formatDate(d: string | null) {
  if (!d) return "—";
  const [, m, day] = d.split("-");
  return `${parseInt(day)}/${parseInt(m)}`;
}

function isOverdue(item: SocialContentItem) {
  if (!item.due_date || item.status === "posted" || item.status === "cancelled") return false;
  return item.due_date < new Date().toISOString().slice(0, 10);
}

export default function ContentItemsTable({ items, onUpdate, onDelete }: Props) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  async function handleStatusChange(id: string, status: SocialContentStatus) {
    await onUpdate(id, { status });
  }

  async function handleDelete(id: string) {
    if (confirmDeleteId !== id) { setConfirmDeleteId(id); return; }
    await onDelete(id);
    setConfirmDeleteId(null);
  }

  if (items.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "40px 0", color: "#555", fontSize: 14 }}>
        אין תכנים עדיין — לחץ &quot;+ תוכן חדש&quot; להתחלה
      </div>
    );
  }

  return (
    <>
      {/* Desktop table */}
      <div className="hidden md:block" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #2A2A2A" }}>
              {["תוכן", "סוג", "פלטפורמה", "סטטוס", "תאריך יעד", "אחראי", ""].map((h) => (
                <th key={h} style={{ padding: "8px 10px", color: "#555", fontWeight: 600, textAlign: "right", whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const overdue = isOverdue(item);
              return (
                <tr key={item.id} style={{ borderBottom: "1px solid #1E1E1E" }}>
                  <td style={{ padding: "10px 10px", color: "#E0E0E0", fontWeight: 600, maxWidth: 180 }}>
                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</div>
                    {item.hook && <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>{item.hook}</div>}
                  </td>
                  <td style={{ padding: "10px 10px", color: "#888", whiteSpace: "nowrap" }}>{item.content_type || "—"}</td>
                  <td style={{ padding: "10px 10px", whiteSpace: "nowrap" }}>
                    {item.platform ? (
                      <span style={{ display: "flex", alignItems: "center", gap: 4, color: "#AAA" }}>
                        <span>{SOCIAL_PLATFORM_ICONS[item.platform as SocialPlatform]}</span>
                        {SOCIAL_PLATFORM_LABELS[item.platform as SocialPlatform]}
                      </span>
                    ) : "—"}
                  </td>
                  <td style={{ padding: "10px 10px" }}>
                    <select
                      value={item.status}
                      onChange={(e) => handleStatusChange(item.id, e.target.value as SocialContentStatus)}
                      style={{
                        fontSize: 12, fontWeight: 700, padding: "3px 8px", borderRadius: 20,
                        border: "none", cursor: "pointer", fontFamily: "inherit",
                        background: SOCIAL_CONTENT_STATUS_COLORS[item.status] + "22",
                        color: SOCIAL_CONTENT_STATUS_COLORS[item.status],
                      }}
                    >
                      {SOCIAL_CONTENT_STATUSES.map((s) => (
                        <option key={s} value={s}>{SOCIAL_CONTENT_STATUS_LABELS[s]}</option>
                      ))}
                    </select>
                  </td>
                  <td style={{ padding: "10px 10px", whiteSpace: "nowrap", color: overdue ? "#EF4444" : "#888" }}>
                    {formatDate(item.due_date)}
                    {overdue && <span style={{ fontSize: 10, marginRight: 4 }}>⚠</span>}
                  </td>
                  <td style={{ padding: "10px 10px", color: "#888", whiteSpace: "nowrap" }}>{item.owner_name || "—"}</td>
                  <td style={{ padding: "10px 10px", whiteSpace: "nowrap" }}>
                    <button
                      onClick={() => handleDelete(item.id)}
                      title={confirmDeleteId === item.id ? "לחץ שוב למחיקה" : "מחק"}
                      style={{
                        background: confirmDeleteId === item.id ? "#EF444422" : "transparent",
                        border: "none", cursor: "pointer",
                        color: confirmDeleteId === item.id ? "#EF4444" : "#444",
                        fontSize: 14, padding: "4px 8px", borderRadius: 6,
                      }}
                    >
                      {confirmDeleteId === item.id ? "מחק?" : "🗑"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {items.map((item) => {
          const overdue = isOverdue(item);
          const statusColor = SOCIAL_CONTENT_STATUS_COLORS[item.status];
          return (
            <div
              key={item.id}
              style={{
                background: "#1A1A1A", borderRadius: 12,
                border: `1px solid ${overdue ? "#EF444433" : "#2A2A2A"}`,
                padding: "12px 14px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#E0E0E0" }}>{item.title}</div>
                  {item.content_type && <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>{item.content_type}</div>}
                </div>
                <select
                  value={item.status}
                  onChange={(e) => handleStatusChange(item.id, e.target.value as SocialContentStatus)}
                  style={{
                    fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 20,
                    border: "none", cursor: "pointer", fontFamily: "inherit",
                    background: statusColor + "22", color: statusColor,
                  }}
                >
                  {SOCIAL_CONTENT_STATUSES.map((s) => (
                    <option key={s} value={s}>{SOCIAL_CONTENT_STATUS_LABELS[s]}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: "flex", gap: 12, fontSize: 12, color: "#666" }}>
                {item.platform && (
                  <span>{SOCIAL_PLATFORM_ICONS[item.platform as SocialPlatform]} {SOCIAL_PLATFORM_LABELS[item.platform as SocialPlatform]}</span>
                )}
                {item.due_date && (
                  <span style={{ color: overdue ? "#EF4444" : "#666" }}>
                    {overdue && "⚠ "}{formatDate(item.due_date)}
                  </span>
                )}
                {item.owner_name && <span>{item.owner_name}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
