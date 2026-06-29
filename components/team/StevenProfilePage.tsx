"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";

// ── Design tokens (same system as Victor; Steven accent = red/bordeaux) ─────────
const BRAND  = "#DC2626";
const BG     = "#0A0A0D";
const CARD   = "#111318";
const CARD2  = "#0D0D12";
const BDR    = "rgba(255,255,255,0.07)";
const BDR2   = "rgba(255,255,255,0.11)";
const TEXT   = "#F2F2F2";
const TEXT2  = "#A0A0B0";
const MUTED  = "#52526A";
const GREEN  = "#10B981";
const BLUE   = "#3B82F6"; // calm "completed" accent
const RED    = "#EF4444";

// ── Types + options (UI-only; no DB) ────────────────────────────────────────────
type WorkStatus = "פעיל" | "הושלם" | "בוטל";
type PayStatus  = "שולם" | "לא שולם";
type WorkType   = "מיקס מאסטרינג" | "מאסטרינג";

const WORK_TYPES: WorkType[]       = ["מיקס מאסטרינג", "מאסטרינג"];
const STATUS_OPTIONS: WorkStatus[] = ["פעיל", "הושלם", "בוטל"];
const PAY_OPTIONS: PayStatus[]     = ["שולם", "לא שולם"];

interface Work {
  id: string; project: string; workType: WorkType; status: WorkStatus;
  deadline: string; price: number; pay: PayStatus;
}

const INITIAL_WORKS: Work[] = [
  { id: "1", project: "My Story",      workType: "מיקס מאסטרינג", status: "פעיל",  deadline: "03.07.26", price: 170, pay: "לא שולם" },
  { id: "2", project: "Heart of Time", workType: "מאסטרינג",      status: "הושלם", deadline: "01.07.26", price: 90,  pay: "שולם" },
  { id: "3", project: "Closer Part 2", workType: "מיקס מאסטרינג", status: "פעיל",  deadline: "—",        price: 170, pay: "לא שולם" },
  { id: "4", project: "City Lights",   workType: "מיקס מאסטרינג", status: "פעיל",  deadline: "28.06.26", price: 110, pay: "לא שולם" },
  { id: "5", project: "Late Nights",   workType: "מאסטרינג",      status: "הושלם", deadline: "25.06.26", price: 120, pay: "שולם" },
  { id: "6", project: "Echoes",        workType: "מיקס מאסטרינג", status: "בוטל",  deadline: "—",        price: 160, pay: "לא שולם" },
];

const BRIEF = ["ווקאל קדמי ונקי", "לשמור על האנרגיה בפזמון", "Reference: Drake / PARTYNEXTDOOR vibe", "מאסטר מוכן לסטרימינג"];
const CHECKLIST = [
  { label: "Stems התקבלו", done: true },
  { label: "Reference התקבל", done: true },
  { label: "הערות מיקס התקבלו", done: true },
  { label: "אישור סופי", done: false },
];
const INITIAL_MODAL_FILES = ["stems.zip", "rough mix.wav", "My Story Mix v1.wav", "My Story Mix v2.wav"];
const TIMELINE = ["נפתחה עבודה", "פעיל", "הושלם"];
function timelineCurrent(status: WorkStatus): number { return status === "הושלם" ? 2 : 1; }

// ── Chips ───────────────────────────────────────────────────────────────────────
const STATUS_COLOR: Record<WorkStatus, string> = { "פעיל": GREEN, "הושלם": BLUE, "בוטל": RED };
function StatusChip({ status }: { status: WorkStatus }) {
  const c = STATUS_COLOR[status];
  return <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 11px", borderRadius: 8, whiteSpace: "nowrap", background: `${c}1A`, border: `1px solid ${c}40`, color: c }}>{status}</span>;
}
function PayChip({ pay }: { pay: PayStatus }) {
  const c = pay === "שולם" ? GREEN : MUTED;
  return <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 11px", borderRadius: 8, whiteSpace: "nowrap", background: `${c}14`, border: `1px solid ${c}40`, color: pay === "שולם" ? GREEN : TEXT2 }}>{pay}</span>;
}

// ── Modern dark form controls ────────────────────────────────────────────────────
function StyledSelect({ value, onChange, options, color }: { value: string; onChange: (v: string) => void; options: readonly string[]; color?: string }) {
  return (
    <div style={{ position: "relative", display: "inline-flex" }}>
      <select value={value} onChange={e => onChange(e.target.value)} style={{
        appearance: "none", WebkitAppearance: "none", MozAppearance: "none",
        background: CARD, color: color ?? TEXT, border: `1px solid ${color ? color + "55" : BDR2}`, borderRadius: 9,
        padding: "8px 30px 8px 12px", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit",
        cursor: "pointer", outline: "none", colorScheme: "dark", direction: "rtl", width: "100%", minWidth: 120,
      }}>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: MUTED, fontSize: 10 }}>▾</span>
    </div>
  );
}
function StyledInput({ value, onChange, placeholder, type = "text" }: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} type={type} style={{
      background: CARD, color: TEXT, border: `1px solid ${BDR2}`, borderRadius: 9, padding: "8px 12px",
      fontSize: 12.5, fontWeight: 600, fontFamily: "inherit", outline: "none", width: "100%", boxSizing: "border-box", direction: "rtl",
    }} />
  );
}

// ── Toast (no browser alert) ─────────────────────────────────────────────────────
function Toast({ msg }: { msg: string | null }) {
  if (!msg || typeof document === "undefined") return null;
  return createPortal(
    <div style={{ position: "fixed", bottom: 26, left: "50%", transform: "translateX(-50%)", zIndex: 100002,
      background: "#1A1C22", border: `1px solid ${BDR2}`, color: TEXT, fontSize: 13, fontWeight: 700,
      padding: "11px 20px", borderRadius: 12, boxShadow: "0 8px 30px rgba(0,0,0,0.6)", direction: "rtl",
      fontFamily: "'Heebo', Arial, sans-serif", pointerEvents: "none" }}>{msg}</div>,
    document.body,
  );
}

function KpiCard({ label, value, icon, color = TEXT }: { label: string; value: string | number; icon: string; color?: string }) {
  return (
    <div style={{ background: CARD, border: `1px solid ${BDR2}`, borderRadius: 16, padding: "18px 20px 16px", position: "relative", overflow: "hidden", minWidth: 0 }}>
      <div style={{ position: "absolute", bottom: -10, left: -6, fontSize: 58, opacity: 0.05, lineHeight: 1, userSelect: "none", pointerEvents: "none" }}>{icon}</div>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: MUTED, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 10 }}>{label}</div>
      <div style={{ fontSize: 32, fontWeight: 900, color, letterSpacing: "-0.04em", lineHeight: 1 }}>{value}</div>
    </div>
  );
}

const sectionCard: React.CSSProperties = { background: CARD, border: `1px solid ${BDR}`, borderRadius: 18, overflow: "hidden" };
const cardHead: React.CSSProperties = { padding: "14px 20px", borderBottom: `1px solid ${BDR}`, fontSize: 14, fontWeight: 800, color: TEXT };
const ghostBtn: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, padding: "10px 16px", borderRadius: 10, background: "rgba(255,255,255,0.05)", border: `1px solid ${BDR2}`, color: TEXT2, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" };

export default function StevenProfilePage() {
  const router = useRouter();
  const [works, setWorks]   = useState<Work[]>(INITIAL_WORKS);
  const [openId, setOpenId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [toast, setToast]   = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function notify(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }

  const openWork = works.find(w => w.id === openId) ?? null;
  const updateWork = (id: string, patch: Partial<Work>) => setWorks(prev => prev.map(w => (w.id === id ? { ...w, ...patch } : w)));
  const addWork = (w: Work) => setWorks(prev => [w, ...prev]);

  const fmt = (n: number) => `$${n.toLocaleString("en-US")}`;
  const active = works.filter(w => w.status === "פעיל").length;
  const done   = works.filter(w => w.status === "הושלם").length;

  return (
    <div dir="rtl" style={{ minHeight: "100%", background: BG, color: TEXT, fontFamily: "'Heebo', Arial, sans-serif", padding: "32px 28px 80px" }}>
      <div style={{ maxWidth: 1600, margin: "0 auto" }}>

        <div style={{ marginBottom: 14 }}>
          <button onClick={() => router.push("/team")} style={{
            display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 10,
            background: CARD, border: `1px solid ${BDR2}`, color: TEXT2, fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
          }}>← חזרה לרשימה</button>
        </div>

        {/* ── Header ── */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 22 }}>
          <button onClick={() => setNewOpen(true)} style={{
            padding: "10px 20px", borderRadius: 12, background: BRAND, border: "none", color: "#fff",
            fontSize: 14, fontWeight: 800, cursor: "pointer", fontFamily: "inherit",
            boxShadow: "0 2px 16px rgba(220,38,38,0.35)", whiteSpace: "nowrap",
          }}>+ עבודה חדשה ל-Steven</button>

          <div style={{ textAlign: "center", flex: 1, minWidth: 240 }}>
            <div style={{ fontSize: 12, color: MUTED, letterSpacing: "0.06em", marginBottom: 3 }}>צוות / ספקים</div>
            <h1 style={{ fontSize: 30, fontWeight: 900, margin: 0, letterSpacing: "-0.02em" }}>פרופיל ספק — <span style={{ color: BRAND }}>Steven</span></h1>
            <div style={{ fontSize: 13, color: TEXT2, marginTop: 6 }}>איש סאונד / מיקס ומאסטר</div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: GREEN, boxShadow: `0 0 6px ${GREEN}88` }} />
              <span style={{ fontSize: 12, color: GREEN, fontWeight: 600 }}>פעיל</span>
            </div>
          </div>

          <div style={{ background: CARD, border: `1px solid ${BDR2}`, borderRadius: 16, padding: "14px 18px", display: "flex", alignItems: "center", gap: 16, minWidth: 280 }}>
            <div style={{ textAlign: "right" }}>
              <span style={{ fontSize: 10.5, fontWeight: 800, padding: "2px 9px", borderRadius: 7, background: `${BRAND}1A`, border: `1px solid ${BRAND}40`, color: BRAND }}>ספק סאונד</span>
              <div style={{ fontSize: 20, fontWeight: 900, color: TEXT, margin: "8px 0 2px" }}>Steven</div>
              <div style={{ fontSize: 11.5, color: TEXT2, lineHeight: 1.7 }}>
                <div>סוג ספק: איש סאונד</div>
                <div>עודכן לאחרונה: היום</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 5, color: GREEN }}>
                  <span>פעיל</span><span style={{ width: 7, height: 7, borderRadius: "50%", background: GREEN }} />
                </div>
              </div>
            </div>
            <div style={{ width: 60, height: 60, borderRadius: "50%", flexShrink: 0, background: `linear-gradient(135deg, ${BRAND}33, ${BRAND}66)`,
              border: `2px solid ${BRAND}66`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, fontWeight: 900, color: "#fff", boxShadow: `0 0 18px ${BRAND}22` }}>S</div>
          </div>
        </div>

        {/* ── KPI row (5 cards) ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 20 }}>
          <KpiCard label="עבודות פתוחות" value={works.length} icon="📁" />
          <KpiCard label="עבודות פעילות" value={active}       icon="🎚" color={GREEN} />
          <KpiCard label="עבודות הושלמו" value={done}         icon="✔" color={BLUE} />
          <KpiCard label="חוב ל-Steven"  value={fmt(340)}     icon="👛" color={BRAND} />
          <KpiCard label="שולם החודש"    value={fmt(170)}     icon="💳" color={GREEN} />
        </div>

        {/* ── Main grid ── */}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2.4fr) minmax(300px, 1fr)", gap: 16, alignItems: "start" }}>

          <div style={sectionCard}>
            <div style={cardHead}>עבודות סאונד</div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", minWidth: 560, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: CARD2 }}>
                    {["פרויקט", "סוג עבודה", "סטטוס", "דדליין", "מחיר", "תשלום", "פעולה"].map(h => (
                      <th key={h} style={{ padding: "10px 14px", textAlign: "right", fontSize: 10, fontWeight: 700, color: MUTED, letterSpacing: "0.05em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {works.map((w, i) => (
                    <tr key={w.id} style={{ borderTop: `1px solid ${BDR}`, background: i % 2 ? "rgba(255,255,255,0.01)" : "transparent" }}>
                      <td style={{ padding: "11px 14px", fontSize: 13, fontWeight: 700, color: TEXT, whiteSpace: "nowrap" }}><span style={{ marginLeft: 5 }}>🎵</span>{w.project}</td>
                      <td style={{ padding: "11px 14px", fontSize: 12, color: TEXT2, whiteSpace: "nowrap" }}>{w.workType}</td>
                      <td style={{ padding: "11px 14px" }}><StatusChip status={w.status} /></td>
                      <td style={{ padding: "11px 14px", fontSize: 12, color: MUTED, whiteSpace: "nowrap" }}>{w.deadline}</td>
                      <td style={{ padding: "11px 14px", fontSize: 12.5, color: TEXT, fontWeight: 700, whiteSpace: "nowrap", direction: "ltr", textAlign: "right" }}>{fmt(w.price)}</td>
                      <td style={{ padding: "11px 14px" }}><PayChip pay={w.pay} /></td>
                      <td style={{ padding: "11px 14px" }}>
                        <button onClick={() => setOpenId(w.id)}
                          onMouseEnter={e => { e.currentTarget.style.background = "#E4E4EA"; e.currentTarget.style.boxShadow = "0 0 8px rgba(255,255,255,0.16)"; }}
                          onMouseLeave={e => { e.currentTarget.style.background = "#D7D7DD"; e.currentTarget.style.boxShadow = "none"; }}
                          style={{ fontSize: 11, fontWeight: 700, color: "#1A1A20", padding: "5px 13px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.18)", background: "#D7D7DD", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", transition: "background 0.15s, box-shadow 0.15s" }}>פתח עבודה</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Side cards */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={sectionCard}>
              <div style={cardHead}>היסטוריית תשלומים</div>
              <div style={{ padding: "10px 16px", display: "flex", flexDirection: "column", gap: 4 }}>
                {[
                  { proj: "My Story",      m: "יוני 2026", a: fmt(170), d: "10.06.26" },
                  { proj: "Heart of Time", m: "מאי 2026",  a: fmt(220), d: "10.05.26" },
                  { proj: "Closer Part 2", m: "אפר׳ 2026", a: fmt(195), d: "10.04.26" },
                  { proj: "Late Nights",   m: "מרץ 2026",  a: fmt(160), d: "10.03.26" },
                ].map(p => (
                  <div key={p.proj} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "10px 6px", borderBottom: `1px solid ${BDR}` }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.proj}</div>
                      <div style={{ fontSize: 11, color: TEXT2, marginTop: 2 }}>{p.m} · {p.d}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                      <span style={{ fontSize: 13, fontWeight: 800, color: TEXT, direction: "ltr" }}>{p.a}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, color: GREEN, background: `${GREEN}14`, border: `1px solid ${GREEN}33`, borderRadius: 6, padding: "2px 8px" }}>שולם</span>
                    </div>
                  </div>
                ))}
                <button onClick={() => notify("היסטוריית תשלומים מלאה תהיה זמינה בקרוב")} style={{ fontSize: 11.5, color: BRAND, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: "8px 6px", textAlign: "right" }}>הצג הכל →</button>
              </div>
            </div>

            <div style={sectionCard}>
              <div style={cardHead}>קבצים אחרונים</div>
              <div style={{ padding: "10px 16px", display: "flex", flexDirection: "column", gap: 4 }}>
                {[
                  { n: "My Story Mix v2.wav", t: "10:24 02.06.26" },
                  { n: "Heart of Time Master.mp3", t: "14:08 01.06.26" },
                  { n: "Closer Part 2 Mix v1.wav", t: "09:17 31.05.26" },
                  { n: "Vocal Comp Take 3.wav", t: "11:02 30.05.26" },
                ].map(f => (
                  <div key={f.n} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 6px", borderBottom: `1px solid ${BDR}` }}>
                    <span style={{ fontSize: 15, color: BRAND, flexShrink: 0 }}>〰</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.n}</div>
                      <div style={{ fontSize: 10, color: MUTED, marginTop: 1 }}>{f.t}</div>
                    </div>
                  </div>
                ))}
                <button onClick={() => notify("רשימת הקבצים המלאה תהיה זמינה בקרוב")} style={{ fontSize: 11.5, color: BRAND, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: "8px 6px", textAlign: "right" }}>הצג הכל →</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {openWork && <WorkModal work={openWork} onChange={patch => updateWork(openWork.id, patch)} onClose={() => setOpenId(null)} notify={notify} />}
      {newOpen && <NewWorkModal onClose={() => setNewOpen(false)} onAdd={w => { addWork(w); notify("עבודה חדשה נוספה"); }} />}
      <Toast msg={toast} />
    </div>
  );
}

// ── "פתח עבודה" modal ───────────────────────────────────────────────────────────
function WorkModal({ work, onChange, onClose, notify }: { work: Work; onChange: (patch: Partial<Work>) => void; onClose: () => void; notify: (m: string) => void }) {
  const [tab, setTab] = useState("סקירה");
  const [saved, setSaved] = useState(false);
  const [files, setFiles] = useState<string[]>(INITIAL_MODAL_FILES);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  const fmt = (n: number) => `$${n.toLocaleString("en-US")}`;
  const curStage = timelineCurrent(work.status);
  const TABS = ["סקירה", "קבצים", "גרסאות", "תשלומים", "הערות"];
  const innerHead: React.CSSProperties = { fontSize: 13.5, fontWeight: 800, color: TEXT, padding: "12px 16px", borderBottom: `1px solid ${BDR}` };
  const subCard: React.CSSProperties = { background: CARD2, border: `1px solid ${BDR}`, borderRadius: 14, overflow: "hidden" };

  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []).map(f => f.name);
    if (picked.length) { setFiles(prev => [...prev, ...picked]); notify(`נוספו ${picked.length} קבצים (מקומי בלבד)`); }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const modal = (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 100001, background: "rgba(0,0,0,0.72)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div onClick={e => e.stopPropagation()} dir="rtl" style={{
        background: CARD, border: `1px solid ${BRAND}33`, borderRadius: 20, width: "min(1180px, 96vw)", maxHeight: "92vh",
        display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: `0 24px 90px rgba(0,0,0,0.9), 0 0 60px ${BRAND}10`, fontFamily: "'Heebo', Arial, sans-serif",
      }}>
        <input ref={fileInputRef} type="file" multiple style={{ display: "none" }} onChange={onPickFiles} />
        {/* Header */}
        <div style={{ padding: "20px 24px 14px", borderBottom: `1px solid ${BDR}`, flexShrink: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 900, color: TEXT }}>עבודה: {work.project}</div>
              <div style={{ fontSize: 13, color: TEXT2, marginTop: 4 }}>Steven • {work.workType}</div>
            </div>
            <button onClick={onClose} style={{ width: 34, height: 34, borderRadius: "50%", background: "rgba(255,255,255,0.06)", border: `1px solid ${BDR2}`, color: TEXT2, fontSize: 18, cursor: "pointer", flexShrink: 0, lineHeight: 1 }}>×</button>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <StatusChip status={work.status} />
            <PayChip pay={work.pay} />
          </div>
          <div style={{ display: "flex", gap: 20, marginTop: 14 }}>
            {TABS.map(t => (
              <button key={t} onClick={() => setTab(t)} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: "6px 0", fontSize: 13.5, fontWeight: tab === t ? 800 : 600, color: tab === t ? TEXT : MUTED, borderBottom: `2px solid ${tab === t ? BRAND : "transparent"}` }}>{t}</button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "18px 24px" }}>
          {tab === "סקירה" ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, alignItems: "start" }}>
              <div style={subCard}>
                <div style={innerHead}>פרטי עבודה</div>
                <div style={{ padding: "6px 16px 12px" }}>
                  {[
                    { l: "פרויקט", node: <span style={{ fontSize: 12.5, fontWeight: 700, color: TEXT }}>{work.project}</span> },
                    { l: "סוג עבודה", node: <StyledSelect value={work.workType} options={WORK_TYPES} onChange={v => onChange({ workType: v as WorkType })} /> },
                    { l: "סטטוס", node: <StyledSelect value={work.status} options={STATUS_OPTIONS} color={STATUS_COLOR[work.status]} onChange={v => onChange({ status: v as WorkStatus })} /> },
                    { l: "דדליין", node: <span style={{ fontSize: 12.5, fontWeight: 700, color: TEXT }}>{work.deadline}</span> },
                    { l: "מחיר שסוכם", node: <span style={{ fontSize: 12.5, fontWeight: 700, color: GREEN, direction: "ltr" }}>{fmt(work.price)}</span> },
                    { l: "תשלום", node: <StyledSelect value={work.pay} options={PAY_OPTIONS} color={work.pay === "שולם" ? GREEN : undefined} onChange={v => onChange({ pay: v as PayStatus })} /> },
                    { l: "עודכן לאחרונה", node: <span style={{ fontSize: 12.5, fontWeight: 700, color: TEXT }}>היום</span> },
                  ].map((r, i, arr) => (
                    <div key={r.l} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "9px 0", borderBottom: i < arr.length - 1 ? `1px solid ${BDR}` : "none" }}>
                      <span style={{ fontSize: 12.5, color: MUTED }}>{r.l}</span>
                      {r.node}
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={subCard}>
                  <div style={innerHead}>הערות לבריף</div>
                  <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
                    {BRIEF.map(b => (
                      <div key={b} style={{ display: "flex", alignItems: "flex-start", gap: 9, fontSize: 12.5, color: TEXT2, lineHeight: 1.5 }}>
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: BRAND, flexShrink: 0, marginTop: 5 }} />{b}
                      </div>
                    ))}
                  </div>
                </div>
                <div style={subCard}>
                  <div style={innerHead}>צ׳קליסט לפני סיום</div>
                  <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 11 }}>
                    {CHECKLIST.map(c => (
                      <div key={c.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 12.5, color: TEXT2 }}>
                        <span>{c.label}</span>
                        <span style={{ width: 18, height: 18, borderRadius: 5, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, background: c.done ? BRAND : "transparent", border: `1.5px solid ${c.done ? BRAND : BDR2}`, color: "#fff" }}>{c.done ? "✓" : ""}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={subCard}>
                  <div style={innerHead}>קבצים וגרסאות</div>
                  <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
                    {files.map((name, idx) => {
                      const isAudio = /\.(wav|mp3|m4a|flac|aiff?)$/i.test(name);
                      return (
                        <div key={`${name}-${idx}`} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", borderRadius: 9, background: CARD, border: `1px solid ${BDR}` }}>
                          <span style={{ fontSize: 14, color: isAudio ? BRAND : TEXT2, flexShrink: 0 }}>{isAudio ? "〰" : "🗎"}</span>
                          <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                          {isAudio && <button onClick={() => notify("אין קובץ לניגון כרגע")} title="נגן" style={{ width: 26, height: 26, borderRadius: "50%", flexShrink: 0, background: `${BRAND}22`, border: `1px solid ${BRAND}55`, color: "#fff", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>▶</button>}
                          <button onClick={() => notify("אין קובץ להורדה כרגע")} title="הורד" style={{ background: "none", border: "none", color: MUTED, fontSize: 14, cursor: "pointer", flexShrink: 0 }}>⬇</button>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div style={subCard}>
                  <div style={innerHead}>ציר זמן</div>
                  <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 0 }}>
                    {TIMELINE.map((stage, i) => {
                      const isDone = i < curStage, current = i === curStage;
                      const c = current ? BRAND : isDone ? GREEN : MUTED;
                      return (
                        <div key={stage} style={{ display: "flex", alignItems: "center", gap: 11, position: "relative", paddingBottom: i < TIMELINE.length - 1 ? 16 : 0 }}>
                          {i < TIMELINE.length - 1 && <span style={{ position: "absolute", right: 6.5, top: 14, bottom: 0, width: 2, background: isDone ? GREEN : BDR }} />}
                          <span style={{ width: 14, height: 14, borderRadius: "50%", flexShrink: 0, zIndex: 1, background: current ? BRAND : isDone ? GREEN : "transparent", border: `2px solid ${c}`, boxShadow: current ? `0 0 8px ${BRAND}88` : "none" }} />
                          <span style={{ fontSize: 12.5, fontWeight: current ? 800 : 600, color: current ? TEXT : isDone ? TEXT2 : MUTED }}>{stage}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: "48px 0", color: MUTED, fontSize: 13 }}>אזור &quot;{tab}&quot; יהיה זמין בקרוב</div>
          )}
        </div>

        {/* Footer */}
        <div style={{ flexShrink: 0, borderTop: `1px solid ${BDR}`, padding: "12px 24px", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", justifyContent: "flex-start" }}>
          <button onClick={() => notify("אין עדיין קישור Dropbox לעבודה הזו")} style={ghostBtn}>📦 פתח בדרופבוקס</button>
          <button onClick={() => fileInputRef.current?.click()} style={ghostBtn}>↑ העלה קבצים</button>
          <button onClick={() => { setSaved(true); notify("נשמר"); setTimeout(() => setSaved(false), 2000); }} style={{ ...ghostBtn, background: saved ? `${GREEN}18` : ghostBtn.background, border: `1px solid ${saved ? GREEN + "55" : BDR2}`, color: saved ? GREEN : TEXT2 }}>{saved ? "✓ נשמר" : "💾 שמור שינויים"}</button>
          <div style={{ flex: 1 }} />
          <button onClick={() => { onChange({ status: "הושלם" }); notify("העבודה סומנה כהושלמה"); }} style={{ padding: "10px 18px", borderRadius: 10, background: BRAND, border: "none", color: "#fff", fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", boxShadow: "0 2px 14px rgba(220,38,38,0.4)" }}>סמן כהושלם</button>
          <button onClick={() => { onChange({ status: "בוטל" }); notify("העבודה בוטלה"); }} style={{ padding: "10px 18px", borderRadius: 10, background: "transparent", border: `1px solid ${RED}66`, color: RED, fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>בטל עבודה</button>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modal, document.body) : null;
}

// ── "עבודה חדשה ל-Steven" modal ──────────────────────────────────────────────────
function NewWorkModal({ onClose, onAdd }: { onClose: () => void; onAdd: (w: Work) => void }) {
  const [project, setProject]   = useState("");
  const [workType, setWorkType] = useState<WorkType>("מיקס מאסטרינג");
  const [status, setStatus]     = useState<WorkStatus>("פעיל");
  const [deadline, setDeadline] = useState("");
  const [price, setPrice]       = useState("");
  const [pay, setPay]           = useState<PayStatus>("לא שולם");
  const [err, setErr]           = useState<string | null>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  function save() {
    if (!project.trim()) { setErr("יש להזין שם פרויקט"); return; }
    onAdd({
      id: (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
      project: project.trim(), workType, status,
      deadline: deadline.trim() || "—",
      price: Number(price) || 0, pay,
    });
    onClose();
  }

  const row = (label: string, node: React.ReactNode) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: TEXT2 }}>{label}</span>
      {node}
    </div>
  );

  const modal = (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 100001, background: "rgba(0,0,0,0.72)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div onClick={e => e.stopPropagation()} dir="rtl" style={{ background: CARD, border: `1px solid ${BRAND}33`, borderRadius: 20, width: "min(520px, 96vw)", maxHeight: "92vh", overflowY: "auto", boxShadow: `0 24px 90px rgba(0,0,0,0.9), 0 0 60px ${BRAND}10`, fontFamily: "'Heebo', Arial, sans-serif", padding: "22px 24px 20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 18, fontWeight: 900, color: TEXT }}>עבודה חדשה ל-Steven</div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(255,255,255,0.06)", border: `1px solid ${BDR2}`, color: TEXT2, fontSize: 18, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {row("פרויקט", <StyledInput value={project} onChange={setProject} placeholder="שם הפרויקט" />)}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {row("סוג עבודה", <StyledSelect value={workType} options={WORK_TYPES} onChange={v => setWorkType(v as WorkType)} />)}
            {row("סטטוס", <StyledSelect value={status} options={STATUS_OPTIONS} color={STATUS_COLOR[status]} onChange={v => setStatus(v as WorkStatus)} />)}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {row("דדליין", <StyledInput value={deadline} onChange={setDeadline} placeholder="03.07.26" />)}
            {row("מחיר ($)", <StyledInput value={price} onChange={setPrice} placeholder="170" type="number" />)}
          </div>
          {row("תשלום", <StyledSelect value={pay} options={PAY_OPTIONS} color={pay === "שולם" ? GREEN : undefined} onChange={v => setPay(v as PayStatus)} />)}
          {err && <div style={{ fontSize: 12, color: RED }}>{err}</div>}
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button onClick={onClose} style={{ ...ghostBtn, flex: 1, justifyContent: "center" }}>ביטול</button>
          <button onClick={save} style={{ flex: 1, padding: "10px 18px", borderRadius: 10, background: BRAND, border: "none", color: "#fff", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", boxShadow: "0 2px 14px rgba(220,38,38,0.4)" }}>שמור</button>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modal, document.body) : null;
}
