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

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  "פעיל":         { bg: "rgba(245,158,11,0.12)",  color: AMBER  },
  "הושלם":        { bg: "rgba(139,92,246,0.12)",  color: PURPLE },
  "בוטל":         { bg: "rgba(239,68,68,0.12)",   color: RED    },
  "ממתין":        { bg: "rgba(82,82,106,0.12)",   color: MUTED  },
  "נשלח":         { bg: "rgba(59,130,246,0.12)",  color: "#60A5FA" },
  "הושלם ✓":      { bg: "rgba(16,185,129,0.12)",  color: GREEN  },
};
const SALARY_STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  "שולם":         { bg: "rgba(16,185,129,0.12)", color: GREEN  },
  "נשלח לכספים": { bg: "rgba(139,92,246,0.12)", color: PURPLE },
  "צפוי":         { bg: "rgba(245,158,11,0.12)", color: AMBER  },
  "לא שולם":      { bg: "rgba(239,68,68,0.12)",  color: RED    },
  "חלקי":         { bg: "rgba(245,158,11,0.12)", color: AMBER  },
  "בוטל":         { bg: "rgba(82,82,106,0.12)",  color: MUTED  },
};

function StatusChip({ status }: { status: string }) {
  const s = STATUS_COLORS[status] ?? { bg: "rgba(255,255,255,0.06)", color: TEXT2 };
  return (
    <span style={{
      padding: "2px 9px", borderRadius: 7,
      background: s.bg, color: s.color,
      fontSize: 10, fontWeight: 700, whiteSpace: "nowrap",
    }}>{status}</span>
  );
}

function SalaryChip({ status }: { status: string }) {
  const s = SALARY_STATUS_COLORS[status] ?? { bg: "rgba(255,255,255,0.06)", color: TEXT2 };
  return (
    <span style={{
      padding: "2px 8px", borderRadius: 6,
      background: s.bg, color: s.color,
      fontSize: 10, fontWeight: 700, whiteSpace: "nowrap",
    }}>{status}</span>
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

  const currency     = stats?.salaryCurrency ?? "$";
  const salary       = stats?.monthlySalary ?? 0;
  const goal         = stats?.goal ?? 0;
  const completed    = stats?.completed ?? 0;
  const active       = stats?.active ?? 0;
  const stuck        = stats?.stuck ?? 0;
  const pct          = goal > 0 ? Math.min(100, Math.round((completed / goal) * 100)) : 0;

  const displayWork = work.slice(0, 12);

  const allFiles = work.flatMap(w => [
    ...(w.filesReceived ?? []).map(f => ({ ...f, dir: "in",  project: w.projectName })),
    ...(w.filesSent    ?? []).map(f => ({ ...f, dir: "out", project: w.projectName })),
  ]);

  const currentSalaryRec = salaryMonths.find(s => s.workMonth === month);
  const historyMonths    = [...salaryMonths].reverse().filter(s => s.workMonth !== month);

  const btnStyle: React.CSSProperties = {
    background: "none", border: "none", outline: "none",
    fontFamily: "inherit", cursor: "pointer", padding: 0,
  };

  return (
    <div style={{
      minHeight: "100%", background: BG, color: TEXT,
      fontFamily: "'Heebo', Arial, sans-serif", direction: "rtl",
      padding: "28px 24px 80px",
    }}>
      <div style={{ maxWidth: 1220, margin: "0 auto" }}>

        {/* ── Top bar: breadcrumb + month switcher ── */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          {/* Back */}
          <button
            onClick={() => router.push("/team")}
            style={{ ...btnStyle, display: "flex", alignItems: "center", gap: 6, color: TEXT2, fontSize: 13, fontWeight: 700 }}
          >
            ← חזרה לרשימה
          </button>

          {/* Title */}
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 11, color: MUTED, letterSpacing: "0.06em", marginBottom: 2 }}>צוות / ספקים</div>
            <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0, letterSpacing: "-0.02em" }}>
              פרופיל ספק — <span style={{ color: PURPLE }}>Victor</span>
            </h1>
          </div>

          {/* Month switcher */}
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            background: CARD, border: `1px solid ${BDR2}`, borderRadius: 12,
            padding: "7px 14px",
          }}>
            <button onClick={() => setMonth(m => prevMonth(m))} style={{ ...btnStyle, fontSize: 18, color: TEXT2, lineHeight: 1 }}>‹</button>
            <div style={{ minWidth: 130, textAlign: "center" }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: TEXT }}>{monthLabel(month)}</div>
              {loading && <div style={{ fontSize: 9, color: MUTED }}>טוען...</div>}
            </div>
            <button onClick={() => setMonth(m => nextMonth(m))} style={{ ...btnStyle, fontSize: 18, color: TEXT2, lineHeight: 1 }}>›</button>
          </div>
        </div>

        {/* ── Victor Info Card ── */}
        <div style={{
          background: CARD, border: `1px solid ${BDR2}`, borderRadius: 16,
          padding: "18px 24px", display: "flex", alignItems: "center",
          gap: 20, marginBottom: 16,
        }}>
          {/* Avatar */}
          <div style={{
            width: 64, height: 64, borderRadius: "50%", flexShrink: 0,
            background: `linear-gradient(135deg, ${PURPLE}44 0%, #1a1035 100%)`,
            border: `2px solid ${PURPLE}44`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 24, fontWeight: 900, color: PURPLE,
          }}>V</div>

          {/* Info */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 18, fontWeight: 900, color: TEXT }}>Victor</span>
              <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 6, background: `${PURPLE}18`, border: `1px solid ${PURPLE}33`, color: PURPLE, fontWeight: 700 }}>מפיק ביטים</span>
            </div>
            <div style={{ fontSize: 12, color: TEXT2, marginTop: 4 }}>הפקה · סאונד עיצוב · ביטים</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: GREEN, fontWeight: 700 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: GREEN, display: "inline-block" }} />
                פעיל
              </span>
              <span style={{ fontSize: 11, color: MUTED }}>·</span>
              <span style={{ fontSize: 11, color: MUTED }}>תאריך התחלה: 12.03.2024</span>
              <span style={{ fontSize: 11, color: MUTED }}>·</span>
              <span style={{ fontSize: 11, color: MUTED }}>תחום עיסוק: הפקה · ביטים</span>
            </div>
          </div>

          {/* Action */}
          <button style={{
            padding: "8px 18px", borderRadius: 10, flexShrink: 0,
            background: `${PURPLE}14`, border: `1px solid ${PURPLE}33`,
            color: PURPLE, fontSize: 12, fontWeight: 700,
            cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6,
          }}>
            ✉ שלח הודעה
          </button>
        </div>

        {/* ── KPI Row ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginBottom: 16 }}>
          {[
            { label: "יעד חודשי כולל", value: goal > 0 ? goal : "—", sub: "פרויקטים", color: TEXT,   icon: "🎯" },
            { label: "הושלמו",          value: completed,              sub: `מתוך ${goal}`,   color: PURPLE, icon: "✅" },
            { label: "בתהליך",          value: active,                 sub: "פרויקטים",       color: AMBER,  icon: "🔄" },
            { label: "באיחור",          value: stuck,                  sub: "תקועים",         color: stuck > 0 ? RED : MUTED, icon: "⚠️" },
            {
              label: "שכר חודשי",
              value: currentSalaryRec ? fmt(currentSalaryRec.amount, currentSalaryRec.currency) : (salary > 0 ? fmt(salary, currency) : "—"),
              sub: currentSalaryRec?.status ?? (stats?.paymentStatus ?? ""),
              color: GREEN,
              icon: "₪",
            },
          ].map(({ label, value, sub, color, icon }) => (
            <div key={label} style={{
              background: CARD, border: `1px solid ${BDR2}`, borderRadius: 14,
              padding: "14px 16px", position: "relative", overflow: "hidden",
            }}>
              <div style={{
                position: "absolute", bottom: -6, left: -4,
                fontSize: 48, opacity: 0.05, userSelect: "none", pointerEvents: "none", lineHeight: 1,
              }}>{icon}</div>
              <div style={{ fontSize: 9, fontWeight: 700, color: MUTED, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 8 }}>{label}</div>
              <div style={{ fontSize: 26, fontWeight: 900, color, letterSpacing: "-0.04em", lineHeight: 1 }}>{value}</div>
              {sub && <div style={{ fontSize: 10, color: TEXT2, marginTop: 6 }}>{sub}</div>}
            </div>
          ))}
        </div>

        {/* ── Main 3-Column Layout ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 268px 268px", gap: 14, alignItems: "start" }}>

          {/* ── Col 1: Projects Table ── */}
          <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 16, overflow: "hidden" }}>
            <div style={{
              padding: "12px 16px", borderBottom: `1px solid ${BDR}`,
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: TEXT }}>פרויקטים</span>
                <span style={{ fontSize: 10, padding: "1px 8px", borderRadius: 6, background: `${PURPLE}18`, color: PURPLE, fontWeight: 700 }}>{work.length}</span>
              </div>
              <span style={{ fontSize: 11, color: MUTED }}>ב{monthLabel(month)}</span>
            </div>

            {loading ? (
              <div style={{ padding: "16px 16px" }}>
                {[1,2,3,4,5].map(i => (
                  <div key={i} style={{ height: 12, background: "rgba(255,255,255,0.05)", borderRadius: 5, marginBottom: 10 }} />
                ))}
              </div>
            ) : displayWork.length === 0 ? (
              <div style={{ padding: 32, textAlign: "center" }}>
                <div style={{ fontSize: 32, opacity: 0.2, marginBottom: 8 }}>📋</div>
                <div style={{ fontSize: 13, color: MUTED }}>אין פרויקטים לחודש זה</div>
              </div>
            ) : (
              <>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: CARD2 }}>
                      {["שם פרויקט", "אמן / לקוח", "דד ליין", "סטטוס", "פעולה"].map(h => (
                        <th key={h} style={{
                          padding: "8px 12px", textAlign: "right",
                          fontSize: 9, fontWeight: 700, color: MUTED,
                          letterSpacing: "0.06em", textTransform: "uppercase",
                          whiteSpace: "nowrap",
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {displayWork.map((w, idx) => (
                      <tr key={w.id} style={{
                        borderTop: `1px solid ${BDR}`,
                        background: idx % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)",
                      }}>
                        <td style={{
                          padding: "9px 12px", fontSize: 12, fontWeight: 600, color: TEXT,
                          maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          <span style={{ marginLeft: 4 }}>🎵</span>{w.projectName}
                        </td>
                        <td style={{ padding: "9px 12px", fontSize: 11, color: TEXT2, whiteSpace: "nowrap" }}>
                          {w.artist || "—"}
                        </td>
                        <td style={{ padding: "9px 12px", fontSize: 11, color: MUTED, whiteSpace: "nowrap" }}>
                          {fmtDate(w.internalDeadline)}
                        </td>
                        <td style={{ padding: "9px 12px" }}>
                          <StatusChip status={w.status} />
                        </td>
                        <td style={{ padding: "9px 12px" }}>
                          <button style={{
                            ...btnStyle, fontSize: 10, fontWeight: 700, color: MUTED,
                            padding: "3px 8px", borderRadius: 6,
                            border: `1px solid ${BDR}`, background: CARD2,
                          }}>
                            פתח פרויקט
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {work.length > 12 && (
                  <div style={{ padding: "10px 16px", borderTop: `1px solid ${BDR}`, textAlign: "center" }}>
                    <span style={{ fontSize: 11, color: MUTED }}>+ {work.length - 12} פרויקטים נוספים</span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* ── Col 2: Capacity + Files ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

            {/* Capacity Card */}
            <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 16, padding: "16px 18px" }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: TEXT, marginBottom: 14 }}>קיבולת חודשית</div>

              {/* Big counter */}
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 4 }}>
                <span style={{ fontSize: 36, fontWeight: 900, color: PURPLE, letterSpacing: "-0.04em" }}>{completed}</span>
                <span style={{ fontSize: 18, fontWeight: 700, color: MUTED }}>/ {goal}</span>
              </div>
              <div style={{ fontSize: 11, color: TEXT2, marginBottom: 12 }}>פרויקטים הושלמו</div>

              {/* Progress bar */}
              <div style={{ height: 10, background: CARD2, borderRadius: 5, overflow: "hidden", marginBottom: 6 }}>
                <div style={{
                  height: "100%", borderRadius: 5,
                  width: `${pct}%`,
                  background: `linear-gradient(90deg, ${PURPLE} 0%, #A855F7 100%)`,
                  transition: "width 0.4s ease",
                }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: MUTED, marginBottom: 14 }}>
                <span>{pct}% מהיעד החודשי</span>
                {pct >= 60
                  ? <span style={{ color: GREEN, fontWeight: 700 }}>במסלול ✓</span>
                  : pct > 0
                    ? <span style={{ color: AMBER, fontWeight: 700 }}>מאחור</span>
                    : null
                }
              </div>

              {/* Stats */}
              {stats && (
                <div style={{ display: "flex", flexDirection: "column", gap: 7, borderTop: `1px solid ${BDR}`, paddingTop: 12 }}>
                  {[
                    { label: "בתהליך",        value: active,             color: AMBER  },
                    { label: "דורשים בדיקה",   value: stats.needsReview,  color: AMBER  },
                    { label: "דורשים תיקון",   value: stats.needsFix,     color: RED    },
                    { label: "תקועים",         value: stats.stuck,        color: stuck > 0 ? RED : MUTED },
                    { label: "קצב נוכחי",      value: stats.paceValue,    color: TEXT2  },
                    { label: "יעד לעכשיו",     value: stats.expectedByNow,color: TEXT2  },
                  ].filter(r => r.value !== 0 && r.value !== null && r.value !== undefined).map(r => (
                    <div key={r.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                      <span style={{ color: MUTED }}>{r.label}</span>
                      <span style={{ fontWeight: 800, color: r.color }}>{r.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Files Card */}
            <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 16, padding: "16px 18px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: TEXT }}>קבצים</span>
                <button style={{
                  ...btnStyle, fontSize: 10, fontWeight: 700, color: PURPLE,
                  padding: "3px 10px", borderRadius: 7,
                  border: `1px solid ${PURPLE}33`, background: `${PURPLE}10`,
                }}>
                  + העלאה
                </button>
              </div>

              {allFiles.length === 0 ? (
                <div style={{ fontSize: 12, color: MUTED, textAlign: "center", padding: "12px 0" }}>
                  אין קבצים לחודש זה
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflowY: "auto" }}>
                  {allFiles.slice(0, 14).map((f, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderRadius: 8, background: CARD2 }}>
                      <span style={{ fontSize: 13, flexShrink: 0 }}>{f.dir === "in" ? "📥" : "📤"}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {f.dropboxShareUrl ? (
                            <a href={f.dropboxShareUrl} target="_blank" rel="noopener noreferrer" style={{ color: TEXT, textDecoration: "none" }}>{f.name}</a>
                          ) : f.name}
                        </div>
                        <div style={{ fontSize: 9, color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.project}</div>
                      </div>
                      {f.versionLabel && <span style={{ fontSize: 9, color: MUTED, flexShrink: 0 }}>{f.versionLabel}</span>}
                    </div>
                  ))}
                  {allFiles.length > 14 && (
                    <div style={{ fontSize: 10, color: MUTED, textAlign: "center", paddingTop: 4 }}>
                      + {allFiles.length - 14} קבצים נוספים
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Col 3: Salary ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

            {/* Current month salary */}
            <div style={{ background: CARD, border: `1px solid ${BDR2}`, borderRadius: 16, padding: "16px 18px" }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: TEXT, marginBottom: 14 }}>
                משכורות — {monthLabel(month)}
              </div>

              {/* Salary amount */}
              <div style={{
                fontSize: 32, fontWeight: 900, letterSpacing: "-0.04em",
                color: currentSalaryRec ? GREEN : (salary > 0 ? GREEN : MUTED),
                marginBottom: 4,
              }}>
                {currentSalaryRec
                  ? fmt(currentSalaryRec.amount, currentSalaryRec.currency)
                  : salary > 0 ? fmt(salary, currency) : "—"}
              </div>
              <div style={{ fontSize: 10, color: MUTED, marginBottom: 14 }}>סה"כ שכר חודשי</div>

              {/* Salary details */}
              {currentSalaryRec ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: `1px solid ${BDR}`, paddingTop: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: MUTED }}>סטטוס תשלום</span>
                    <SalaryChip status={currentSalaryRec.status} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 11, color: MUTED }}>תאריך תשלום</span>
                    <span style={{ fontSize: 11, color: TEXT2, fontWeight: 700 }}>{fmtDate(currentSalaryRec.dueDate)}</span>
                  </div>
                  {currentSalaryRec.transactionId && (
                    <div style={{ fontSize: 10, color: MUTED }}>TX: {currentSalaryRec.transactionId.slice(0, 8)}...</div>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: 11, color: MUTED, borderTop: `1px solid ${BDR}`, paddingTop: 12 }}>
                  אין רשומת שכר לחודש זה
                </div>
              )}
            </div>

            {/* Salary history */}
            <div style={{ background: CARD, border: `1px solid ${BDR}`, borderRadius: 16, padding: "16px 18px" }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: TEXT, marginBottom: 12 }}>היסטוריית תשלומים</div>

              {salaryLoading ? (
                <div>
                  {[1,2,3].map(i => <div key={i} style={{ height: 12, background: "rgba(255,255,255,0.05)", borderRadius: 4, marginBottom: 8 }} />)}
                </div>
              ) : historyMonths.length === 0 ? (
                <div style={{ fontSize: 12, color: MUTED }}>אין היסטוריה</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 7, maxHeight: 280, overflowY: "auto" }}>
                  {historyMonths.map((s, i) => {
                    const sc = SALARY_STATUS_COLORS[s.status] ?? { color: MUTED };
                    return (
                      <div key={i} style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "9px 11px", borderRadius: 10,
                        background: CARD2, border: `1px solid ${BDR}`,
                        cursor: "pointer",
                      }}
                        onClick={() => setMonth(s.workMonth)}
                      >
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: TEXT }}>{monthLabel(s.workMonth)}</div>
                          <div style={{ fontSize: 9, color: MUTED, marginTop: 2 }}>{fmtDate(s.dueDate)}</div>
                        </div>
                        <div style={{ textAlign: "left" }}>
                          <div style={{ fontSize: 12, fontWeight: 800, color: GREEN, marginBottom: 3 }}>{fmt(s.amount, s.currency)}</div>
                          <SalaryChip status={s.status} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Show all link */}
              {salaryMonths.length > 5 && (
                <div style={{ marginTop: 10, textAlign: "center" }}>
                  <span style={{ fontSize: 11, color: MUTED, cursor: "default" }}>הצג הכל ←</span>
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
