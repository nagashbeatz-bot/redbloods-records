"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import type { VictorMonthStats, VendorWork } from "@/lib/types";
import { segmentVictorWork } from "@/lib/victor-segments";
import VictorDrawer from "./VictorDrawer";

// ── Helpers ───────────────────────────────────────────────────────────────────

function currentMonthStr(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function heMonth(ym: string): string {
  const HE = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
  const [y, m] = ym.split("-");
  return `${HE[parseInt(m, 10) - 1]} ${y}`;
}

function paceColor(approved: number, expected: number): string {
  if (expected === 0) return "#10B981";
  const ratio = approved / expected;
  if (ratio >= 0.9) return "#10B981";
  if (ratio >= 0.6) return "#F59E0B";
  return "#EF4444";
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const [, m, day] = d.split("-");
  return `${day}/${m}`;
}

// ── Work item row inside the modal ────────────────────────────────────────────

function WorkModalRow({ w }: { w: VendorWork }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: 3,
      padding: "9px 12px", background: "#1A1A1A",
      border: "1px solid #252525", borderRadius: 10, marginBottom: 6,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#D0D0D0" }}>
          {w.projectName}{w.artist ? ` — ${w.artist}` : ""}
        </span>
        <span style={{ fontSize: 11, color: "#555" }}>
          {w.daysSinceSent !== null ? `לפני ${w.daysSinceSent} ימים` : ""}
        </span>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, color: "#888" }}>סטטוס: {w.status}</span>
        {w.workState && <span style={{ fontSize: 11, color: "#888" }}>מצב: {w.workState}</span>}
        <span style={{ fontSize: 11, color: "#666" }}>נשלח: {fmtDate(w.sentDate)}</span>
        {w.returnedDate && <span style={{ fontSize: 11, color: "#666" }}>חזר: {fmtDate(w.returnedDate)}</span>}
      </div>
    </div>
  );
}

// ── Stat box — clickable ──────────────────────────────────────────────────────

interface StatBoxProps {
  label: string;
  value: number;
  color?: string;
  onClick: () => void;
}

function StatBox({ label, value, color = "#D0D0D0", onClick }: StatBoxProps) {
  return (
    <button
      onClick={onClick}
      style={{
        background: "#1A1A1A", border: "1px solid #252525", borderRadius: 10,
        padding: "10px 12px", flex: "1 1 80px", textAlign: "center",
        cursor: "pointer", fontFamily: "inherit",
        transition: "border-color 0.15s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#3A3A3A")}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#252525")}
    >
      <div style={{ fontSize: 20, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 10, color: "#555", marginTop: 2 }}>{label}</div>
    </button>
  );
}

// ── Work list modal ───────────────────────────────────────────────────────────

interface WorkModalProps {
  title: string;
  items: VendorWork[];
  note?: string;
  onClose: () => void;
}

function WorkModal({ title, items, note, onClose }: WorkModalProps) {
  return createPortal(
    <div
      style={{ position: "fixed", inset: 0, zIndex: 99999, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}
    >
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.65)" }} />
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative", zIndex: 1, direction: "rtl",
          background: "#141414", border: "1px solid #252525", borderRadius: 16,
          width: "min(480px, 95vw)", maxHeight: "70vh", display: "flex", flexDirection: "column",
          boxShadow: "0 20px 60px rgba(0,0,0,0.8)",
        }}
      >
        <div style={{ padding: "14px 18px 10px", borderBottom: "1px solid #1E1E1E", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#F0F0F0" }}>{title}</span>
            <span style={{ fontSize: 12, color: "#555", marginRight: 8 }}>({items.length})</span>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#555", fontSize: 18, cursor: "pointer", lineHeight: 1 }}>✕</button>
        </div>
        {note && (
          <div style={{ padding: "6px 18px", background: "#1A1A1A", borderBottom: "1px solid #1E1E1E" }}>
            <span style={{ fontSize: 11, color: "#666" }}>{note}</span>
          </div>
        )}
        <div style={{ overflowY: "auto", flex: 1, padding: "10px 16px 16px" }}>
          {items.length === 0 ? (
            <div style={{ color: "#444", fontSize: 13, padding: "20px 0", textAlign: "center" }}>אין פרויקטים</div>
          ) : (
            items.map((w) => <WorkModalRow key={w.id} w={w} />)
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function VictorCard() {
  const [month, setMonth]         = useState(currentMonthStr());
  const [stats, setStats]         = useState<VictorMonthStats | null>(null);
  const [work,  setWork]          = useState<VendorWork[]>([]);
  const [loading, setLoading]     = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [modal, setModal]         = useState<{ title: string; items: VendorWork[]; note?: string } | null>(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch(`/api/vendor/victor?month=${month}`);
      const data = await res.json() as { ok: boolean; stats: VictorMonthStats; work: VendorWork[] };
      if (data.ok) {
        setStats(data.stats);
        setWork(data.work ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  const openModal = useCallback((key: keyof ReturnType<typeof segmentVictorWork>, title: string, note?: string) => {
    const seg = segmentVictorWork(work, month);
    setModal({ title, items: seg[key], note });
  }, [work, month]);

  const pace = stats ? paceColor(stats.paceValue, stats.expectedByNow) : "#888";

  return (
    <>
      <div style={{
        background: "#141414", border: "1px solid #252525", borderRadius: 16,
        padding: "20px 22px", marginBottom: 12,
      }}>
        {/* Header row */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 40, height: 40, borderRadius: "50%",
                background: "linear-gradient(135deg,#7C3AED,#A855F7)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 18, fontWeight: 800, color: "#fff",
              }}>V</div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: "#F0F0F0" }}>Victor</div>
                <div style={{ fontSize: 11, color: "#666" }}>ביטמייקר / מפיק · פעיל</div>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              style={{
                background: "#1A1A1A", border: "1px solid #2A2A2A", borderRadius: 8,
                color: "#888", fontSize: 11, padding: "3px 8px", fontFamily: "inherit",
              }}
            />
          </div>
        </div>

        {/* Stats grid */}
        {loading ? (
          <div style={{ color: "#444", fontSize: 13, padding: "12px 0" }}>טוען...</div>
        ) : stats ? (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
              <StatBox label="פעילים"  value={stats.active}    color="#A855F7"
                onClick={() => openModal("pureActive", `פעילים — ${heMonth(month)}`)} />
              <StatBox label="הושלמו"  value={stats.completed} color="#10B981"
                onClick={() => openModal("completed", `הושלמו — ${heMonth(month)}`)} />
              <StatBox label="בוטלו"   value={stats.cancelled} color="#555"
                onClick={() => openModal("cancelled", `בוטלו — ${heMonth(month)}`)} />
              <StatBox label="תקועים"  value={stats.stuck}     color={stats.stuck > 0 ? "#EF4444" : "#555"}
                onClick={() => openModal("stuck", "תקועים — כל הזמן", "פרויקטים פתוחים שעברו את הדדליין — מכל החודשים")} />
            </div>
            <div style={{ fontSize: 10, color: "#3A3A3A", marginBottom: 10, textAlign: "left" }}>
              לחץ על קובייה לפרטים
            </div>

            {/* Pace bar */}
            <div style={{
              background: "#1A1A1A", border: "1px solid #252525", borderRadius: 10,
              padding: "10px 14px", marginBottom: 10,
            }}>
              <div style={{ marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: pace, fontWeight: 700 }}>
                  {stats.paceValue > stats.expectedByNow
                    ? `מעל הקצב — ${stats.paceValue} בפועל מתוך ${stats.expectedByNow} צפוי עד היום`
                    : stats.paceValue === stats.expectedByNow
                    ? `בקצב טוב — ${stats.paceValue} בפועל מתוך ${stats.expectedByNow} צפוי עד היום`
                    : `מתחת לקצב — ${stats.paceValue} בפועל מתוך ${stats.expectedByNow} צפוי עד היום`}
                </span>
              </div>
              <div style={{ height: 4, background: "#252525", borderRadius: 4, overflow: "hidden" }}>
                <div style={{
                  height: "100%", borderRadius: 4,
                  background: pace,
                  width: `${Math.min(100, stats.expectedByNow > 0 ? (stats.paceValue / stats.expectedByNow) * 100 : 100)}%`,
                  transition: "width 0.4s",
                }} />
              </div>
              <div style={{ marginTop: 6, fontSize: 10, color: "#444" }}>
                יעד חודשי: {stats.goal} פרויקטים · הקצב מחושב לפי נשלחו החודש (פעיל + הושלם)
              </div>
            </div>
          </>
        ) : (
          <div style={{ color: "#555", fontSize: 13 }}>לא ניתן לטעון נתונים</div>
        )}

        {/* Open drawer button */}
        <button
          onClick={() => setDrawerOpen(true)}
          style={{
            width: "100%", padding: "9px 0", borderRadius: 10,
            border: "1px solid #2A2A2A", background: "#1A1A1A",
            color: "#A855F7", fontSize: 13, fontWeight: 600,
            cursor: "pointer", fontFamily: "inherit", marginTop: 4,
          }}
        >
          פתח כרטיס ויקטור ▸
        </button>
      </div>

      {modal && (
        <WorkModal
          title={modal.title}
          items={modal.items}
          note={modal.note}
          onClose={() => setModal(null)}
        />
      )}

      {drawerOpen && (
        <VictorDrawer
          month={month}
          onClose={() => setDrawerOpen(false)}
          onStatsRefresh={fetchStats}
        />
      )}
    </>
  );
}
