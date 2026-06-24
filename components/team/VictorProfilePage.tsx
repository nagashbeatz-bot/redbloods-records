"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { VictorMonthStats, VendorWork, VictorSalaryMonth } from "@/lib/types";

const BRAND   = "#DC2626";
const CARD    = "#111318";
const CARD2   = "#0D0D12";
const BDR     = "rgba(255,255,255,0.07)";
const BDR2    = "rgba(255,255,255,0.11)";
const TEXT    = "#F2F2F2";
const TEXT2   = "#A0A0B0";
const MUTED   = "#52526A";
const GREEN   = "#10B981";
const PURPLE  = "#8B5CF6";
const AMBER   = "#F59E0B";
const RED     = "#EF4444";
const BG      = "#0A0A0D";

function fmt(n: number, curr = "$") {
  return `${curr}${n.toLocaleString()}`;
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" });
  } catch { return d; }
}

function monthLabel(ym: string) {
  try {
    const [y, m] = ym.split("-");
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("he-IL", { month: "long", year: "numeric" });
  } catch { return ym; }
}

function prevMonth(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function nextMonth(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

type StatusColor = { bg: string; color: string; label: string };
const STATUS_COLORS: Record<string, StatusColor> = {
  "פעיל":  { bg: "rgba(16,185,129,0.12)", color: GREEN,  label: "פעיל" },
  "הושלם": { bg: "rgba(139,92,246,0.12)", color: PURPLE, label: "הושלם" },
  "בוטל":  { bg: "rgba(239,68,68,0.12)",  color: RED,    label: "בוטל" },
};
const SALARY_STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  "שולם":         { bg: "rgba(16,185,129,0.12)", color: GREEN },
  "נשלח לכספים": { bg: "rgba(139,92,246,0.12)", color: PURPLE },
  "צפוי":         { bg: "rgba(245,158,11,0.12)", color: AMBER },
  "לא שולם":      { bg: "rgba(239,68,68,0.12)",  color: RED },
  "חלקי":         { bg: "rgba(245,158,11,0.12)", color: AMBER },
  "בוטל":         { bg: "rgba(82,82,106,0.12)",  color: MUTED },
};

function StatusChip({ status }: { status: string }) {
  const s = STATUS_COLORS[status] ?? { bg: "rgba(255,255,255,0.06)", color: TEXT2, label: status };
  return (
    <span style={{
      padding: "2px 10px", borderRadius: 8,
      background: s.bg, color: s.color,
      fontSize: 11, fontWeight: 700,
      whiteSpace: "nowrap",
    }}>{s.label ?? status}</span>
  );
}

function KpiCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color: string }) {
  return (
    <div style={{
      background: CARD, border: `1px solid ${BDR2}`, borderRadius: 14,
      padding: "14px 16px", display: "flex", flexDirection: "column", gap: 6,
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, letterSpacing: "0.07em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 900, color, letterSpacing: "-0.03em", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: TEXT2 }}>{sub}</div>}
    </div>
  );
}

export default function VictorProfilePage() {
  const router = useRouter();
  const [month, setMonth] = useState(currentMonth);
  const [stats, setStats] = useState<VictorMonthStats | null>(null);
  const [work, setWork] = useState<VendorWork[]>([]);
  const [salaryMonths, setSalaryMonths] = useState<VictorSalaryMonth[]>([]);
  const [loading, setLoading] = useState(true);
  const [salaryLoading, setSalaryLoading] = useState(true);

  const fetchMonth = useCallback(async (m: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/vendor/victor?month=${m}`);
      const data = await res.json();
      if (data.ok) {
        setStats(data.stats ?? null);
        setWork(data.work ?? []);
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  const fetchSalary = useCallback(async (year: number) => {
    setSalaryLoading(true);
    try {
      const res = await fetch(`/api/vendor/victor/salary?year=${year}`);
      const data = await res.json();
      if (data.ok) setSalaryMonths(data.months ?? []);
    } catch { /* silent */ }
    finally { setSalaryLoading(false); }
  }, []);

  useEffect(() => { fetchMonth(month); }, [month, fetchMonth]);
  useEffect(() => {
    const year = Number(month.split("-")[0]);
    fetchSalary(year);
  }, [month, fetchSalary]);

  const currency = stats?.salaryCurrency ?? "$";
  const salary   = stats?.monthlySalary ?? 0;

  // Progress bar: completed / goal
  const goal     = stats?.goal ?? 0;
  const completed = stats?.completed ?? 0;
  const pct = goal > 0 ? Math.min(100, Math.round((completed / goal) * 100)) : 0;

  // Active work for the projects list
  const activeWork = work.filter(w => w.status === "פעיל");
  const completedWork = work.filter(w => w.status === "הושלם");
  const displayWork = [...activeWork, ...completedWork].slice(0, 20);

  // Files from work
  const allFiles = work.flatMap(w =>
    [...(w.filesReceived ?? []).map(f => ({ ...f, dir: "התקבל", project: w.projectName })),
     ...(w.filesSent ?? []).map(f => ({ ...f, dir: "נשלח",   project: w.projectName }))]
  );

  // Current month salary record
  const currentSalaryRec = salaryMonths.find(s => s.workMonth === month);

  const inputStyle: React.CSSProperties = {
    background: "none", border: "none", outline: "none",
    fontFamily: "inherit", color: TEXT, cursor: "pointer",
    fontSize: 14, fontWeight: 700, padding: 0,
  };

  return (
    <div style={{ minHeight: "100%", background: BG, color: TEXT, fontFamily: "'Heebo', Arial, sans-serif", direction: "rtl", padding: "28px 32px 60px" }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
        <button
          onClick={() => router.push("/team")}
          style={{ ...inputStyle, display: "flex", alignItems: "center", gap: 6, color: TEXT2, cursor: "pointer" }}
        >
          ← חזרה לרשימה
        </button>
        <div style={{ flex: 1, textAlign: "center" }}>
          <h1 style={{ fontSize: 24, fontWeight: 900, margin: 0, letterSpacing: "-0.02em" }}>
            פרופיל ספק — <span style={{ color: PURPLE }}>Victor</span>
          </h1>
        </div>
        <div style={{ width: 120 }} />
      </div>

      {/* ── Month Switcher ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: 16, marginBottom: 28,
        background: CARD, border: `1px solid ${BDR}`, borderRadius: 14, padding: "10px 20px",
        width: "fit-content", margin: "0 auto 28px",
      }}>
        <button onClick={() => setMonth(m => prevMonth(m))} style={{ ...inputStyle, fontSize: 20, color: TEXT2 }}>‹</button>
        <div style={{ minWidth: 160, textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: TEXT }}>{monthLabel(month)}</div>
          {loading && <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>טוען...</div>}
        </div>
        <button onClick={() => setMonth(m => nextMonth(m))} style={{ ...inputStyle, fontSize: 20, color: TEXT2 }}>›</button>
      </div>

      {/* ── Victor Info Card ── */}
      <div style={{
        background: CARD, border: `1px solid ${BDR2}`, borderRadius: 16, padding: "20px 24px",
        display: "flex", alignItems: "center", gap: 24, marginBottom: 20,
      }}>
        <div style={{
          width: 72, height: 72, borderRadius: "50%",
          background: `linear-gradient(135deg, ${PURPLE}55 0%, #1a1035 100%)`,
          border: `2px solid ${PURPLE}55`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 28, fontWeight: 900, color: PURPLE, flexShrink: 0,
        }}>V</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 20, fontWeight: 900, color: TEXT }}>Victor</div>
          <div style={{ fontSize: 13, color: TEXT2, marginTop: 3 }}>מפיק ביטים · הפקה, סאונד עיצוב</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
            <span style={{ fontSize: 11, padding: "2px 10px", borderRadius: 8, background: "rgba(16,185,129,0.12)", color: GREEN, fontWeight: 700 }}>פעיל</span>
            <span style={{ fontSize: 11, color: MUTED }}>ספק מאז ינואר 2026</span>
          </div>
        </div>
        <button style={{
          padding: "9px 20px", borderRadius: 10,
          background: `${PURPLE}18`, border: `1px solid ${PURPLE}44`,
          color: PURPLE, fontSize: 13, fontWeight: 700,
          cursor: "pointer", fontFamily: "inherit",
        }}>
          שלח הודעה
        </button>
      </div>

      {/* ── KPI Row ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 20 }}>
        <KpiCard label="שכר חודשי" value={salary > 0 ? fmt(salary, currency) : "—"} color={GREEN} sub={currentSalaryRec ? currentSalaryRec.status : stats?.paymentStatus ?? ""} />
        <KpiCard label="יעד חודשי" value={goal > 0 ? `${goal} פרויקטים` : "—"} color={TEXT} />
        <KpiCard label="הושלמו" value={stats?.completed ?? 0} color={PURPLE} sub={`מתוך ${goal}`} />
        <KpiCard label="בתהליך" value={stats?.active ?? 0} color={AMBER} />
        <KpiCard label="באיחור / תקועים" value={stats?.stuck ?? 0} color={stats?.stuck ? RED : MUTED} />
      </div>

      {/* ── 3-Column Layout ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 280px 280px", gap: 16 }}>

        {/* ── Column 1: Projects Table ── */}
        <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 16, overflow: "hidden" }}>
          <div style={{ padding: "14px 18px", borderBottom: `1px solid ${BDR}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: TEXT }}>פרויקטים</span>
            <span style={{ fontSize: 11, color: MUTED }}>{work.length} סה"כ</span>
          </div>
          {loading ? (
            <div style={{ padding: 24 }}>
              {[1,2,3].map(i => (
                <div key={i} style={{ height: 14, background: "rgba(255,255,255,0.05)", borderRadius: 6, marginBottom: 10 }} />
              ))}
            </div>
          ) : displayWork.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: MUTED, fontSize: 13 }}>אין פרויקטים לחודש זה</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: CARD2 }}>
                    {["פרויקט", "אמן", "דדליין", "סטטוס"].map(h => (
                      <th key={h} style={{ padding: "8px 14px", textAlign: "right", fontSize: 10, fontWeight: 700, color: MUTED, letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayWork.map(w => (
                    <tr key={w.id} style={{ borderTop: `1px solid ${BDR}` }}>
                      <td style={{ padding: "10px 14px", fontSize: 13, fontWeight: 600, color: TEXT, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.projectName}</td>
                      <td style={{ padding: "10px 14px", fontSize: 12, color: TEXT2, whiteSpace: "nowrap" }}>{w.artist}</td>
                      <td style={{ padding: "10px 14px", fontSize: 11, color: MUTED, whiteSpace: "nowrap" }}>{fmtDate(w.internalDeadline)}</td>
                      <td style={{ padding: "10px 14px" }}><StatusChip status={w.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Column 2: Capacity + Files ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Capacity Card */}
          <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 16, padding: "16px 18px" }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: TEXT, marginBottom: 14 }}>קיבולת חודשית</div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: TEXT2 }}>{completed} / {goal} הושלמו</span>
              <span style={{ fontSize: 12, fontWeight: 800, color: PURPLE }}>{pct}%</span>
            </div>
            <div style={{ height: 8, background: CARD2, borderRadius: 4, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${pct}%`, background: `linear-gradient(90deg, ${PURPLE}, #A855F7)`, borderRadius: 4, transition: "width 0.4s ease" }} />
            </div>
            {stats && (
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                {stats.needsReview > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: AMBER }}>
                    <span>דורשים בדיקה</span><span style={{ fontWeight: 800 }}>{stats.needsReview}</span>
                  </div>
                )}
                {stats.needsFix > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: RED }}>
                    <span>דורשים תיקון</span><span style={{ fontWeight: 800 }}>{stats.needsFix}</span>
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: MUTED }}>
                  <span>קצב נוכחי</span><span style={{ fontWeight: 700, color: TEXT2 }}>{stats.paceValue}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: MUTED }}>
                  <span>יעד לעכשיו</span><span style={{ fontWeight: 700, color: TEXT2 }}>{stats.expectedByNow}</span>
                </div>
              </div>
            )}
          </div>

          {/* Files Card */}
          <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 16, padding: "16px 18px", flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: TEXT, marginBottom: 12 }}>קבצים</div>
            {allFiles.length === 0 ? (
              <div style={{ fontSize: 12, color: MUTED }}>אין קבצים לחודש זה</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 200, overflowY: "auto" }}>
                {allFiles.slice(0, 12).map((f, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
                    <span style={{ color: f.dir === "התקבל" ? GREEN : PURPLE, fontWeight: 700, flexShrink: 0 }}>{f.dir === "התקבל" ? "↓" : "↑"}</span>
                    <span style={{ color: TEXT2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                      {f.dropboxShareUrl ? (
                        <a href={f.dropboxShareUrl} target="_blank" rel="noopener noreferrer" style={{ color: TEXT2, textDecoration: "none" }}>{f.name}</a>
                      ) : f.name}
                    </span>
                    {f.versionLabel && <span style={{ color: MUTED, flexShrink: 0 }}>{f.versionLabel}</span>}
                  </div>
                ))}
                {allFiles.length > 12 && <div style={{ fontSize: 10, color: MUTED }}>ועוד {allFiles.length - 12}...</div>}
              </div>
            )}
          </div>
        </div>

        {/* ── Column 3: Salary ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Current month salary */}
          <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 16, padding: "16px 18px" }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: TEXT, marginBottom: 12 }}>שכר — {monthLabel(month)}</div>
            {currentSalaryRec ? (
              <>
                <div style={{ fontSize: 28, fontWeight: 900, color: GREEN, letterSpacing: "-0.03em" }}>
                  {fmt(currentSalaryRec.amount, currentSalaryRec.currency)}
                </div>
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                    <span style={{ color: MUTED }}>סטטוס</span>
                    <span style={{ fontWeight: 800, color: SALARY_STATUS_COLORS[currentSalaryRec.status]?.color ?? TEXT2 }}>{currentSalaryRec.status}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                    <span style={{ color: MUTED }}>תאריך תשלום</span>
                    <span style={{ color: TEXT2 }}>{fmtDate(currentSalaryRec.dueDate)}</span>
                  </div>
                  {currentSalaryRec.transactionId && (
                    <div style={{ fontSize: 10, color: MUTED, marginTop: 4 }}>TX: {currentSalaryRec.transactionId.slice(0, 8)}...</div>
                  )}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 24, fontWeight: 900, color: salary > 0 ? GREEN : MUTED, letterSpacing: "-0.03em" }}>
                {salary > 0 ? fmt(salary, currency) : "—"}
              </div>
            )}
          </div>

          {/* Salary History */}
          <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 16, padding: "16px 18px", flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: TEXT, marginBottom: 12 }}>היסטוריית שכר</div>
            {salaryLoading ? (
              <div>
                {[1,2,3].map(i => <div key={i} style={{ height: 12, background: "rgba(255,255,255,0.05)", borderRadius: 4, marginBottom: 8 }} />)}
              </div>
            ) : salaryMonths.length === 0 ? (
              <div style={{ fontSize: 12, color: MUTED }}>אין רשומות שכר</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 240, overflowY: "auto" }}>
                {[...salaryMonths].reverse().map((s, i) => {
                  const sc = SALARY_STATUS_COLORS[s.status] ?? { color: MUTED, bg: "transparent" };
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", borderRadius: 10, background: CARD2, border: `1px solid ${BDR}` }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: TEXT }}>{monthLabel(s.workMonth)}</div>
                        <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>{fmtDate(s.dueDate)}</div>
                      </div>
                      <div style={{ textAlign: "left" }}>
                        <div style={{ fontSize: 13, fontWeight: 800, color: GREEN }}>{fmt(s.amount, s.currency)}</div>
                        <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 5, background: sc.bg, color: sc.color, fontWeight: 700 }}>{s.status}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
