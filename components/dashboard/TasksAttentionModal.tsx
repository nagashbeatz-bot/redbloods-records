"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export interface AttentionTask {
  id:        string;
  title:     string;
  due_date?: string | null;
}

/** Add n days to a YYYY-MM-DD string, returning YYYY-MM-DD (UTC-anchored, DST-safe). */
function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * "בדיקת משימות" — lists open tasks due today or overdue, with per-task actions.
 * Uses the existing PATCH /api/tasks/[id] endpoint only:
 *   • בוצע        → { status: "בוצע" }  (the API syncs completion to Google Tasks)
 *   • דחה למחר/לתאריך → { due_date }     (no Google sync — date-only patch)
 * After a successful patch it calls the parent callbacks so the dashboard list
 * updates in place without a full reload.
 */
export default function TasksAttentionModal({
  tasks, today, onClose, onDone, onDefer,
}: {
  tasks:   AttentionTask[];
  today:   string;
  onClose: () => void;
  onDone:  (id: string) => void;
  onDefer: (id: string, newDate: string) => void;
}) {
  const [busyId,    setBusyId]    = useState<string | null>(null);
  const [error,     setError]     = useState("");
  const [pickerId,  setPickerId]  = useState<string | null>(null);
  const [pickDate,  setPickDate]  = useState(addDays(today, 1));

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  async function patch(id: string, body: Record<string, unknown>): Promise<boolean> {
    setBusyId(id);
    setError("");
    try {
      const res = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("שגיאה");
      return true;
    } catch {
      setError("הפעולה נכשלה, נסה שוב");
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function markDone(id: string) {
    if (await patch(id, { status: "בוצע" })) onDone(id);
  }
  async function deferTo(id: string, date: string) {
    if (await patch(id, { due_date: date })) { setPickerId(null); onDefer(id, date); }
  }

  function dueLabel(due?: string | null): { text: string; color: string } {
    if (!due) return { text: "ללא תאריך", color: "#606060" };
    if (due < today) return { text: "באיחור", color: "#EF4444" };
    if (due === today) return { text: "היום", color: "#F59E0B" };
    return { text: due, color: "#606060" };
  }

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 199999, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.78)", backdropFilter: "blur(4px)" }} />
      <div dir="rtl" style={{
        position: "relative", width: 520, maxWidth: "92vw", maxHeight: "84vh", overflowY: "auto",
        borderRadius: 20, background: "linear-gradient(160deg, #15151B 0%, #0F0F14 100%)",
        border: "1.5px solid rgba(245,158,11,0.28)", boxShadow: "0 32px 80px rgba(0,0,0,0.85)",
        padding: "22px 22px 18px", display: "flex", flexDirection: "column", gap: 14, fontFamily: "inherit",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ fontSize: 20 }}>📝</span>
            <div>
              <div style={{ fontSize: 16, fontWeight: 900, color: "#F2F2F2" }}>בדיקת משימות</div>
              <div style={{ fontSize: 11.5, color: "#A0A0A0" }}>
                {tasks.length} {tasks.length === 1 ? "משימה להיום / באיחור" : "משימות להיום / באיחור"}
              </div>
            </div>
          </div>
          <button onClick={onClose} aria-label="סגור" style={{ width: 30, height: 30, borderRadius: "50%", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.04)", color: "#A0A0A0", fontSize: 15, cursor: "pointer", fontFamily: "inherit" }}>✕</button>
        </div>

        {error && <div style={{ fontSize: 12, color: "#EF4444" }}>{error}</div>}

        {tasks.length === 0 ? (
          <div style={{ fontSize: 13, color: "#606060", textAlign: "center", padding: "24px 0" }}>
            ✅ אין משימות שדורשות טיפול
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {tasks.map((t) => {
              const dl   = dueLabel(t.due_date);
              const busy = busyId === t.id;
              return (
                <div key={t.id} style={{ background: "#181818", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 13, padding: "13px 14px", display: "flex", flexDirection: "column", gap: 9, opacity: busy ? 0.5 : 1 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: "#F2F2F2", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
                    <span style={{ fontSize: 10.5, fontWeight: 800, color: dl.color, background: `${dl.color}1A`, border: `1px solid ${dl.color}3A`, borderRadius: 6, padding: "2px 8px", flexShrink: 0 }}>{dl.text}</span>
                  </div>

                  {pickerId === t.id ? (
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input
                        type="date" value={pickDate} min={addDays(today, 1)}
                        onChange={(e) => setPickDate(e.target.value)}
                        style={{ flex: 1, padding: "7px 10px", borderRadius: 9, border: "1px solid #303030", background: "#111", color: "#E8E8E8", fontSize: 12.5, fontFamily: "inherit", colorScheme: "dark", outline: "none" }}
                      />
                      <button onClick={() => deferTo(t.id, pickDate)} disabled={busy || !pickDate} style={actBtn("#3B82F6", busy || !pickDate)}>אישור</button>
                      <button onClick={() => setPickerId(null)} disabled={busy} style={actBtn("#606060", busy)}>ביטול</button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                      <button onClick={() => markDone(t.id)} disabled={busy} style={actBtn("#10B981", busy)}>✓ בוצע</button>
                      <button onClick={() => deferTo(t.id, addDays(today, 1))} disabled={busy} style={actBtn("#F59E0B", busy)}>דחה למחר</button>
                      <button onClick={() => { setPickDate(addDays(today, 1)); setPickerId(t.id); }} disabled={busy} style={actBtn("#3B82F6", busy)}>דחה לתאריך</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <button onClick={onClose} style={{ alignSelf: "flex-start", background: "none", border: "none", color: "#606060", fontSize: 12, cursor: "pointer", fontFamily: "inherit", padding: 0 }}>
          סגור
        </button>
      </div>
    </div>,
    document.body
  );
}

function actBtn(color: string, disabled: boolean): React.CSSProperties {
  return {
    padding: "6px 12px", borderRadius: 9, cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "inherit", fontSize: 12, fontWeight: 600,
    border: `1px solid ${color}45`, background: `${color}16`, color,
    opacity: disabled ? 0.5 : 1,
  };
}
