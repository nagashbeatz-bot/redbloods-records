"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import type { VictorMonthStats, VendorWork, VictorStatus } from "@/lib/types";
import { VICTOR_STATUSES } from "@/lib/types";
import { useGlobalProjectDrawer } from "@/components/GlobalProjectDrawer";

// ── Helpers ───────────────────────────────────────────────────────────────────

function heMonth(ym: string): string {
  const HE = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
  const [y, m] = ym.split("-");
  return `${HE[parseInt(m, 10) - 1]} ${y}`;
}

function statusColor(s: VictorStatus): string {
  const map: Record<VictorStatus, string> = {
    "לא נשלח":            "#555",
    "נשלח לויקטור":       "#3B82F6",
    "בעבודה אצל ויקטור": "#A855F7",
    "מחכה לקבצים":        "#F59E0B",
    "הוחזר מויקטור":      "#2DD4BF",
    "דורש תיקונים":       "#F59E0B",
    "אושר":               "#10B981",
    "לא רלוונטי":         "#444",
  };
  return map[s] ?? "#888";
}

const STATUS_GROUPS: { label: string; statuses: VictorStatus[] }[] = [
  { label: "פעיל",    statuses: ["נשלח לויקטור", "בעבודה אצל ויקטור", "מחכה לקבצים"] },
  { label: "הוחזר",  statuses: ["הוחזר מויקטור", "דורש תיקונים"] },
  { label: "סגור",   statuses: ["אושר", "לא רלוונטי", "לא נשלח"] },
];

// ── Section divider ───────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, color: "#555", letterSpacing: "0.07em",
      textTransform: "uppercase", margin: "18px 0 10px",
      borderTop: "1px solid #252525", paddingTop: 14,
    }}>{children}</div>
  );
}

// ── Stat row ─────────────────────────────────────────────────────────────────

function StatRow({ label, value, color = "#D0D0D0" }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", padding: "5px 0",
      borderBottom: "1px solid #1E1E1E", fontSize: 13,
    }}>
      <span style={{ color: "#666" }}>{label}</span>
      <span style={{ color, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

// ── Work row ─────────────────────────────────────────────────────────────────

function WorkRow({ work, onOpenProject }: { work: VendorWork; onOpenProject: (id: string) => void }) {
  const col = statusColor(work.status);
  return (
    <div
      onClick={() => onOpenProject(work.projectId)}
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "8px 10px", background: "#1A1A1A", border: "1px solid #252525",
        borderRadius: 10, marginBottom: 6, cursor: "pointer",
      }}
    >
      <div>
        <div style={{ fontSize: 13, color: "#D0D0D0", fontWeight: 600 }}>
          {work.projectName}{work.artist ? ` — ${work.artist}` : ""}
        </div>
        {work.sentDate && (
          <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>
            נשלח: {work.sentDate.split("-").reverse().join(".")}
            {work.isStuck && <span style={{ color: "#EF4444", marginRight: 8 }}> ⚠ תקוע</span>}
          </div>
        )}
      </div>
      <div style={{
        fontSize: 11, fontWeight: 700, color: col,
        background: `${col}18`, border: `1px solid ${col}33`,
        borderRadius: 6, padding: "2px 8px", whiteSpace: "nowrap",
      }}>
        {work.status}
      </div>
    </div>
  );
}

// ── Main drawer ───────────────────────────────────────────────────────────────

interface Props {
  month: string;
  onClose: () => void;
  onStatsRefresh: () => void;
}

export default function VictorDrawer({ month, onClose, onStatsRefresh }: Props) {
  const [stats, setStats]   = useState<VictorMonthStats | null>(null);
  const [work, setWork]     = useState<VendorWork[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"מדדים" | "פרויקטים" | "הגדרות">("מדדים");
  const { openProject } = useGlobalProjectDrawer();

  // Settings edit state
  const [goal, setGoal]           = useState("");
  const [salary, setSalary]       = useState("");
  const [salCurrency, setSalCurrency] = useState("$");
  const [payDay, setPayDay]       = useState("");
  const [stuckDays, setStuckDays] = useState("");
  const [payStatus, setPayStatus] = useState("צפוי");
  const [saving, setSaving]       = useState(false);
  const [saveMsg, setSaveMsg]     = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch(`/api/vendor/victor?month=${month}`);
      const data = await res.json() as { ok: boolean; stats: VictorMonthStats; work: VendorWork[] };
      if (data.ok) {
        setStats(data.stats);
        setWork(data.work);
        // Seed settings fields
        setGoal(String(data.stats.goal));
        setSalary(String(data.stats.monthlySalary));
        setSalCurrency(data.stats.salaryCurrency);
        setPayStatus(data.stats.paymentStatus);
      }
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Also fetch stuckAfterDays from settings
  useEffect(() => {
    fetch("/api/vendor/victor/settings")
      .then((r) => r.json())
      .then((d: { ok: boolean; settings: { stuckAfterDays: number; salaryPayDay: number } }) => {
        if (d.ok) {
          setStuckDays(String(d.settings.stuckAfterDays));
          setPayDay(String(d.settings.salaryPayDay));
        }
      })
      .catch(() => {});
  }, []);

  const saveSettings = async () => {
    setSaving(true);
    setSaveMsg("");
    try {
      await fetch("/api/vendor/victor/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          monthlyGoal:    Number(goal),
          monthlySalary:  Number(salary),
          salaryCurrency: salCurrency,
          salaryPayDay:   Number(payDay),
          stuckAfterDays: Number(stuckDays),
        }),
      });
      setSaveMsg("נשמר ✓");
      onStatsRefresh();
    } finally {
      setSaving(false);
    }
  };

  const markPayment = async (status: string) => {
    await fetch(`/api/vendor/victor/settings?payment=${month}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setPayStatus(status);
    onStatsRefresh();
  };

  // Group work by status group
  const grouped = STATUS_GROUPS.map((g) => ({
    ...g,
    items: work.filter((w) => g.statuses.includes(w.status)),
  }));

  return createPortal(
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        display: "flex", alignItems: "flex-start", justifyContent: "flex-end",
      }}
      onClick={onClose}
    >
      {/* Backdrop */}
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)" }} />

      {/* Panel */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative", zIndex: 1,
          width: "min(520px, 100vw)", height: "100dvh",
          background: "#141414", borderLeft: "1px solid #252525",
          display: "flex", flexDirection: "column", overflowY: "auto",
          direction: "rtl",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "18px 20px 14px", borderBottom: "1px solid #252525",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          position: "sticky", top: 0, background: "#141414", zIndex: 10,
        }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#F0F0F0" }}>Victor — כרטיס מלא</div>
            <div style={{ fontSize: 11, color: "#555" }}>{heMonth(month)}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#555", fontSize: 20, cursor: "pointer", lineHeight: 1 }}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid #252525", padding: "0 20px" }}>
          {(["מדדים", "פרויקטים", "הגדרות"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                background: "none", border: "none", cursor: "pointer",
                fontFamily: "inherit", fontSize: 13, fontWeight: activeTab === tab ? 700 : 400,
                color: activeTab === tab ? "#A855F7" : "#555",
                padding: "10px 14px",
                borderBottom: activeTab === tab ? "2px solid #A855F7" : "2px solid transparent",
                marginBottom: -1,
              }}
            >{tab}</button>
          ))}
        </div>

        {/* Content */}
        <div style={{ padding: "16px 20px 40px", flex: 1 }}>
          {loading ? (
            <div style={{ color: "#444", fontSize: 13, padding: 20 }}>טוען...</div>
          ) : (

            // ── מדדים ─────────────────────────────────────────────────────────
            activeTab === "מדדים" && stats ? (
              <>
                <div style={{ fontSize: 13, color: "#888", marginBottom: 12 }}>
                  ביטמייקר / מפיק · שכר: {stats.salaryCurrency}{stats.monthlySalary} / חודש
                </div>

                <StatRow label="יעד חודשי"          value={`${stats.goal} פרויקטים`} />
                <StatRow label="נשלחו לויקטור"      value={stats.sent}     color="#3B82F6" />
                <StatRow label="בעבודה / פעיל"      value={stats.inProgress} color="#A855F7" />
                <StatRow label="חזרו מויקטור"       value={stats.returned}  color="#2DD4BF" />
                <StatRow label="אושרו"              value={stats.approved}  color="#10B981" />
                <StatRow label="דורשים תיקון"       value={stats.needsFix}  color="#F59E0B" />
                <StatRow label="נכנסו לפרויקט"      value={stats.enteredProject} color="#2DD4BF" />
                <StatRow label="תקועים"             value={stats.stuck}     color={stats.stuck > 0 ? "#EF4444" : "#555"} />
                <StatRow label="אחוז הצלחה"         value={`${stats.successRate}%`} color={stats.successRate >= 70 ? "#10B981" : "#F59E0B"} />

                <SectionTitle>קצב מול יעד</SectionTitle>
                <div style={{ background: "#1A1A1A", border: "1px solid #252525", borderRadius: 10, padding: "12px 14px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <span style={{ fontSize: 12, color: "#666" }}>אושרו</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: stats.approved >= stats.expectedByNow ? "#10B981" : "#EF4444" }}>
                      {stats.approved} / {stats.expectedByNow} צפוי עד עכשיו
                    </span>
                  </div>
                  <div style={{ height: 6, background: "#252525", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{
                      height: "100%", borderRadius: 4,
                      background: stats.approved >= stats.expectedByNow ? "#10B981" : stats.approved >= stats.expectedByNow * 0.6 ? "#F59E0B" : "#EF4444",
                      width: `${Math.min(100, stats.expectedByNow > 0 ? (stats.approved / stats.expectedByNow) * 100 : 100)}%`,
                    }} />
                  </div>
                  {stats.approved < stats.expectedByNow && (
                    <div style={{ fontSize: 11, color: "#EF4444", marginTop: 6 }}>
                      ⚠ מתחת לקצב — יעד חודשי: {stats.goal}
                    </div>
                  )}
                </div>

                <SectionTitle>תשלום {heMonth(month)}</SectionTitle>
                <div style={{ display: "flex", gap: 8 }}>
                  {["שולם", "צפוי", "לא שולם"].map((s) => (
                    <button
                      key={s}
                      onClick={() => markPayment(s)}
                      style={{
                        flex: 1, padding: "8px 0", borderRadius: 8, fontFamily: "inherit",
                        fontSize: 12, fontWeight: 600, cursor: "pointer",
                        background: payStatus === s ? `${s === "שולם" ? "#10B981" : s === "לא שולם" ? "#EF4444" : "#F59E0B"}22` : "#1A1A1A",
                        border: `1px solid ${payStatus === s ? (s === "שולם" ? "#10B981" : s === "לא שולם" ? "#EF4444" : "#F59E0B") : "#2A2A2A"}`,
                        color: payStatus === s ? (s === "שולם" ? "#10B981" : s === "לא שולם" ? "#EF4444" : "#F59E0B") : "#555",
                      }}
                    >{s}</button>
                  ))}
                </div>
              </>
            ) :

            // ── פרויקטים ──────────────────────────────────────────────────────
            activeTab === "פרויקטים" ? (
              <>
                {work.length === 0 ? (
                  <div style={{ color: "#444", fontSize: 13, padding: "20px 0" }}>
                    אין פרויקטים מקושרים לויקטור בחודש זה
                  </div>
                ) : (
                  grouped.map((g) =>
                    g.items.length > 0 ? (
                      <div key={g.label}>
                        <SectionTitle>{g.label} ({g.items.length})</SectionTitle>
                        {g.items.map((w) => (
                          <WorkRow key={w.id} work={w} onOpenProject={openProject} />
                        ))}
                      </div>
                    ) : null
                  )
                )}
              </>
            ) :

            // ── הגדרות ─────────────────────────────────────────────────────────
            activeTab === "הגדרות" ? (
              <>
                <SectionTitle>יעד ומדדים</SectionTitle>

                {[
                  { label: "יעד חודשי (פרויקטים מאושרים)", val: goal,      set: setGoal,      type: "number" },
                  { label: "ימים עד תקוע",                 val: stuckDays, set: setStuckDays,  type: "number" },
                ].map(({ label, val, set, type }) => (
                  <div key={label} style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 11, color: "#555", marginBottom: 4 }}>{label}</div>
                    <input
                      type={type}
                      value={val}
                      onChange={(e) => set(e.target.value)}
                      style={{
                        width: "100%", background: "#1A1A1A", border: "1px solid #2A2A2A",
                        borderRadius: 8, color: "#D0D0D0", fontSize: 13,
                        padding: "7px 10px", fontFamily: "inherit",
                      }}
                    />
                  </div>
                ))}

                <SectionTitle>שכר ותשלום</SectionTitle>

                <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: "#555", marginBottom: 4 }}>שכר חודשי</div>
                    <input
                      type="number"
                      value={salary}
                      onChange={(e) => setSalary(e.target.value)}
                      style={{ width: "100%", background: "#1A1A1A", border: "1px solid #2A2A2A", borderRadius: 8, color: "#D0D0D0", fontSize: 13, padding: "7px 10px", fontFamily: "inherit" }}
                    />
                  </div>
                  <div style={{ width: 70 }}>
                    <div style={{ fontSize: 11, color: "#555", marginBottom: 4 }}>מטבע</div>
                    <select
                      value={salCurrency}
                      onChange={(e) => setSalCurrency(e.target.value)}
                      style={{ width: "100%", background: "#1A1A1A", border: "1px solid #2A2A2A", borderRadius: 8, color: "#D0D0D0", fontSize: 13, padding: "7px 6px", fontFamily: "inherit" }}
                    >
                      {["$", "₪", "€", "£"].map((c) => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                </div>

                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11, color: "#555", marginBottom: 4 }}>יום תשלום בחודש</div>
                  <input
                    type="number"
                    value={payDay}
                    onChange={(e) => setPayDay(e.target.value)}
                    min={1} max={28}
                    style={{ width: "100%", background: "#1A1A1A", border: "1px solid #2A2A2A", borderRadius: 8, color: "#D0D0D0", fontSize: 13, padding: "7px 10px", fontFamily: "inherit" }}
                  />
                </div>

                <button
                  onClick={saveSettings}
                  disabled={saving}
                  style={{
                    width: "100%", padding: "10px 0", borderRadius: 10, fontFamily: "inherit",
                    fontSize: 13, fontWeight: 700, cursor: saving ? "wait" : "pointer",
                    background: "rgba(168,85,247,0.15)", border: "1px solid rgba(168,85,247,0.3)",
                    color: "#A855F7", marginTop: 8, opacity: saving ? 0.7 : 1,
                  }}
                >{saving ? "שומר..." : "שמור הגדרות"}</button>

                {saveMsg && <div style={{ fontSize: 12, color: "#10B981", textAlign: "center", marginTop: 8 }}>{saveMsg}</div>}
              </>
            ) : null
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
