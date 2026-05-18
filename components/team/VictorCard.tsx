"use client";

import { useState, useEffect, useCallback } from "react";
import type { VictorMonthStats, VendorWork } from "@/lib/types";
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

// ── Stat pill ─────────────────────────────────────────────────────────────────

function StatBox({ label, value, color = "#D0D0D0" }: { label: string; value: number; color?: string }) {
  return (
    <div style={{
      background: "#1A1A1A", border: "1px solid #252525", borderRadius: 10,
      padding: "10px 12px", flex: "1 1 80px", textAlign: "center",
    }}>
      <div style={{ fontSize: 20, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 10, color: "#555", marginTop: 2 }}>{label}</div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function VictorCard() {
  const [month, setMonth]         = useState(currentMonthStr());
  const [stats, setStats]         = useState<VictorMonthStats | null>(null);
  const [loading, setLoading]     = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch(`/api/vendor/victor?month=${month}`);
      const data = await res.json() as { ok: boolean; stats: VictorMonthStats };
      if (data.ok) setStats(data.stats);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  const pace      = stats ? paceColor(stats.paceValue, stats.expectedByNow) : "#888";
  const belowPace = stats ? stats.paceValue < stats.expectedByNow : false;
  const payColor  = stats?.paymentStatus === "שולם" ? "#10B981"
                  : stats?.paymentStatus === "לא שולם" ? "#EF4444"
                  : "#F59E0B";

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
            {/* Month picker */}
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              style={{
                background: "#1A1A1A", border: "1px solid #2A2A2A", borderRadius: 8,
                color: "#888", fontSize: 11, padding: "3px 8px", fontFamily: "inherit",
              }}
            />
            {/* Payment status */}
            {stats && (
              <div style={{ fontSize: 11, color: payColor, fontWeight: 600 }}>
                {stats.salaryCurrency}{stats.monthlySalary} · {stats.paymentStatus}
              </div>
            )}
          </div>
        </div>

        {/* Stats grid */}
        {loading ? (
          <div style={{ color: "#444", fontSize: 13, padding: "12px 0" }}>טוען...</div>
        ) : stats ? (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
              <StatBox label="פעילים"  value={stats.active}    color="#A855F7" />
              <StatBox label="הושלמו"  value={stats.completed} color="#10B981" />
              <StatBox label="בוטלו"   value={stats.cancelled} color="#555" />
              <StatBox label="תקועים"  value={stats.stuck}     color={stats.stuck > 0 ? "#EF4444" : "#555"} />
            </div>

            {/* Pace bar */}
            <div style={{
              background: "#1A1A1A", border: "1px solid #252525", borderRadius: 10,
              padding: "10px 14px", marginBottom: 10,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: "#666" }}>
                  קצב מול יעד — {heMonth(month)}
                </span>
                <span style={{ fontSize: 11, color: pace, fontWeight: 700 }}>
                  {stats.paceValue} / {stats.expectedByNow} צפוי עד עכשיו
                </span>
              </div>
              <div style={{ height: 4, background: "#252525", borderRadius: 4, overflow: "hidden" }}>
                <div style={{
                  height: "100%", borderRadius: 4,
                  background: pace,
                  width: `${Math.min(100, stats.expectedByNow > 0 ? (stats.approved / stats.expectedByNow) * 100 : 100)}%`,
                  transition: "width 0.4s",
                }} />
              </div>
              {belowPace && (
                <div style={{ fontSize: 10, color: "#EF4444", marginTop: 5 }}>
                  ⚠ ויקטור מתחת לקצב החודשי — יעד: {stats.goal}
                </div>
              )}
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
