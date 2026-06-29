"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import type { SoundEngineerWork } from "@/lib/types";

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

// ── Types + options (UI-only; no DB). State stays Hebrew-canonical; English is
//    a display-only translation via mappers below. ────────────────────────────────
type WorkStatus = "פעיל" | "הושלם" | "בוטל";
type PayStatus  = "שולם" | "לא שולם";
type WorkType   = "מיקס מאסטרינג" | "מאסטרינג";
type Lang       = "he" | "en";

const WORK_TYPES: WorkType[]       = ["מיקס מאסטרינג", "מאסטרינג"];
const STATUS_OPTIONS: WorkStatus[] = ["פעיל", "הושלם", "בוטל"];
const PAY_OPTIONS: PayStatus[]     = ["שולם", "לא שולם"];

const STATUS_EN: Record<WorkStatus, string> = { "פעיל": "Active", "הושלם": "Completed", "בוטל": "Canceled" };
const PAY_EN:    Record<PayStatus, string>  = { "שולם": "Paid", "לא שולם": "Unpaid" };
const WT_EN:     Record<WorkType, string>   = { "מיקס מאסטרינג": "Mix & Mastering", "מאסטרינג": "Mastering" };
const statusLabel = (s: WorkStatus, lang: Lang) => (lang === "en" ? STATUS_EN[s] : s);
const payLabel    = (p: PayStatus, lang: Lang)  => (lang === "en" ? PAY_EN[p] : p);
const wtLabel     = (w: WorkType, lang: Lang)   => (lang === "en" ? WT_EN[w] : w);

interface Work {
  id: string; project: string; workType: WorkType; status: WorkStatus;
  startDate: string; deadline: string; price: number; pay: PayStatus;
  amountPaid: number; currency: string; dbBacked: boolean;
}
interface WorkFile { id: string; name: string; time: string; size?: number; url?: string }

// ── DB ↔ UI mapping (the page UI has fewer enum values than the DB) ───────────────
//   DB SoundEngineerStatus:   לא נשלח | נשלח | בתהליך | חזר | אושר | בוטל
//   UI WorkStatus:            פעיל | הושלם | בוטל
//   DB SoundEngineerWorkType: מיקס | מאסטר | מיקס + מאסטר | תיקונים
//   UI WorkType:              מיקס מאסטרינג | מאסטרינג
function dbStatusToUi(s: string): WorkStatus {
  if (s === "אושר") return "הושלם";
  if (s === "בוטל") return "בוטל";
  return "פעיל"; // לא נשלח / נשלח / בתהליך / חזר
}
function uiStatusToDb(s: WorkStatus): string {
  if (s === "הושלם") return "אושר";
  if (s === "בוטל") return "בוטל";
  return "בתהליך"; // פעיל
}
function dbWorkTypeToUi(w: string): WorkType {
  return w === "מאסטר" ? "מאסטרינג" : "מיקס מאסטרינג";
}
function uiWorkTypeToDb(w: WorkType): string {
  return w === "מאסטרינג" ? "מאסטר" : "מיקס + מאסטר";
}
// Pay status is display-only, derived from amounts (no payment_status column on this table).
function payFromAmounts(agreed: number, paid: number): PayStatus {
  return agreed > 0 && paid >= agreed ? "שולם" : "לא שולם";
}
// DB dates are ISO (yyyy-mm-dd); UI shows DD.MM.YY.
function fmtDbDate(d: string | null): string {
  if (!d) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${m[3]}.${m[2]}.${m[1].slice(2)}` : d;
}
function mapRecord(r: SoundEngineerWork): Work {
  return {
    id:         r.id,
    project:    r.projectName,
    workType:   dbWorkTypeToUi(r.workType),
    status:     dbStatusToUi(r.status),
    startDate:  fmtDbDate(r.sentDate),
    deadline:   fmtDbDate(r.internalDeadline),
    price:      r.agreedPrice,
    pay:        payFromAmounts(r.agreedPrice, r.amountPaid),
    amountPaid: r.amountPaid,
    currency:   r.currency || "$",
    dbBacked:   true,
  };
}

const INITIAL_FILES: WorkFile[] = [
  { id: "f1", name: "stems.zip",           time: "02.06.26 09:10" },
  { id: "f2", name: "rough mix.wav",       time: "02.06.26 09:12" },
  { id: "f3", name: "My Story Mix v1.wav", time: "31.05.26 09:17" },
  { id: "f4", name: "My Story Mix v2.wav", time: "02.06.26 10:24" },
];

// ── Local translations (page-scoped, NOT global i18n) ────────────────────────────
const TR = {
  he: {
    breadcrumb: "צוות / ספקים", profileTitle: "פרופיל ספק —", role: "איש סאונד / מיקס ומאסטר", active: "פעיל",
    back: "→ חזרה לרשימה", newWork: "+ עבודה חדשה ל-Steven",
    soundSupplier: "ספק סאונד", supplierType: "סוג ספק: איש סאונד", updatedToday: "עודכן לאחרונה: היום",
    kpiOpen: "עבודות פתוחות", kpiActive: "עבודות פעילות", kpiDone: "עבודות הושלמו", kpiDebt: "חוב ל-Steven", kpiPaidMonth: "שולם החודש",
    payHistory: "היסטוריית תשלומים", recentFiles: "קבצים אחרונים", viewAll: "הצג הכל →", paid: "שולם",
    noPayments: "אין עדיין תשלומים ל-Steven", noRecentFiles: "אין עדיין קבצים אחרונים",
    soundJobs: "עבודות סאונד", project: "פרויקט", workType: "סוג עבודה", status: "סטטוס", startDate: "תאריך התחלה", deadline: "דדליין", price: "מחיר", payment: "תשלום", action: "פעולה", openJob: "פתח עבודה", noJobs: "אין עדיין עבודות ל-Steven",
    job: "עבודה:", workFiles: "קבצי עבודה", dragHere: "גרור לכאן קבצים", orClick: "או לחץ להעלאה ידנית", chooseFiles: "בחר קבצים", fileHint: "Stems, Mix, Master, Reference, ZIP", noFiles: "אין עדיין קבצים בעבודה הזו",
    openDropbox: "📦 פתח בדרופבוקס", jobDetails: "פרטי עבודה", agreedPrice: "מחיר שסוכם", briefNotes: "הערות לבריף",
    brief: ["ווקאל קדמי ונקי", "לשמור על האנרגיה בפזמון", "Reference: Drake / PARTYNEXTDOOR vibe", "מאסטר מוכן לסטרימינג"],
    newWorkTitle: "עבודה חדשה ל-Steven", projectName: "שם הפרויקט", priceLabel: "מחיר ($)", save: "שמור", cancel: "ביטול", required: "יש להזין שם פרויקט",
    tAdded: "הקבצים נוספו לעבודה", tRemoved: "הקובץ הוסר", tNoPlay: "אין קובץ לניגון כרגע", tNoDownload: "אין קובץ להורדה כרגע", tNoDropbox: "אין עדיין קישור Dropbox לעבודה הזו",
    tJobAdded: "עבודה חדשה נוספה", tViewAllPay: "היסטוריית תשלומים מלאה תהיה זמינה בקרוב", tViewAllFiles: "רשימת הקבצים המלאה תהיה זמינה בקרוב",
    langHe: "השפה הוחלפה לעברית", langEn: "השפה הוחלפה לאנגלית",
    deleteWork: "מחק עבודה", confirmTitle: "למחוק את העבודה של Steven?", confirmBody: "הפעולה תסיר את העבודה מעמוד Steven. היא לא תמחק פרויקט, קבצים או כספים.",
    confirmYes: "מחק", confirmNo: "ביטול", tDeleted: "העבודה נמחקה", priceSaved: "המחיר נשמר", priceInvalid: "מחיר לא תקין",
  },
  en: {
    breadcrumb: "Team / Suppliers", profileTitle: "Supplier Profile —", role: "Sound Engineer / Mix & Master", active: "Active",
    back: "← Back to list", newWork: "+ New work for Steven",
    soundSupplier: "Sound Supplier", supplierType: "Supplier type: Sound Engineer", updatedToday: "Updated today",
    kpiOpen: "Open Jobs", kpiActive: "Active Jobs", kpiDone: "Completed Jobs", kpiDebt: "Debt to Steven", kpiPaidMonth: "Paid This Month",
    payHistory: "Payment History", recentFiles: "Recent Files", viewAll: "View All →", paid: "Paid",
    noPayments: "No Steven payments yet", noRecentFiles: "No recent files yet",
    soundJobs: "Sound Jobs", project: "Project", workType: "Work Type", status: "Status", startDate: "Start Date", deadline: "Deadline", price: "Price", payment: "Payment", action: "Action", openJob: "Open Job", noJobs: "No Steven jobs yet",
    job: "Job:", workFiles: "Work Files", dragHere: "Drag files here", orClick: "or click to upload manually", chooseFiles: "Choose Files", fileHint: "Stems, Mix, Master, Reference, ZIP", noFiles: "No files yet for this job",
    openDropbox: "📦 Open in Dropbox", jobDetails: "Job Details", agreedPrice: "Agreed Price", briefNotes: "Brief Notes",
    brief: ["Clean upfront vocal", "Keep the chorus energy", "Reference: Drake / PARTYNEXTDOOR vibe", "Streaming-ready master"],
    newWorkTitle: "New Work for Steven", projectName: "Project name", priceLabel: "Price ($)", save: "Save", cancel: "Cancel", required: "Project name is required",
    tAdded: "Files added to job", tRemoved: "File removed", tNoPlay: "No playable file yet", tNoDownload: "No downloadable file yet", tNoDropbox: "No Dropbox link for this job yet",
    tJobAdded: "Job added", tViewAllPay: "Full payment history coming soon", tViewAllFiles: "Full file list coming soon",
    langHe: "Language switched to Hebrew", langEn: "Language switched to English",
    deleteWork: "Delete job", confirmTitle: "Delete Steven's job?", confirmBody: "This removes the job from Steven's page. It will not delete the project, files or finances.",
    confirmYes: "Delete", confirmNo: "Cancel", tDeleted: "Job deleted", priceSaved: "Price saved", priceInvalid: "Invalid price",
  },
};
type T = (typeof TR)["he"];

// ── Chips ───────────────────────────────────────────────────────────────────────
const STATUS_COLOR: Record<WorkStatus, string> = { "פעיל": GREEN, "הושלם": BLUE, "בוטל": RED };
function StatusChip({ status, lang }: { status: WorkStatus; lang: Lang }) {
  const c = STATUS_COLOR[status];
  return <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 11px", borderRadius: 8, whiteSpace: "nowrap", background: `${c}1A`, border: `1px solid ${c}40`, color: c }}>{statusLabel(status, lang)}</span>;
}
function PayChip({ pay, lang }: { pay: PayStatus; lang: Lang }) {
  const c = pay === "שולם" ? GREEN : MUTED;
  return <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 11px", borderRadius: 8, whiteSpace: "nowrap", background: `${c}14`, border: `1px solid ${c}40`, color: pay === "שולם" ? GREEN : TEXT2 }}>{payLabel(pay, lang)}</span>;
}

// ── Modern pill / segmented control ──────────────────────────────────────────────
function PillGroup<V extends string>({ value, options, onChange, colorFor, labelFor }: { value: V; options: readonly V[]; onChange: (v: V) => void; colorFor?: (o: V) => string; labelFor?: (o: V) => string }) {
  return (
    <div style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-start" }}>
      {options.map(o => {
        const sel = o === value;
        const c = colorFor ? colorFor(o) : BRAND;
        return (
          <button key={o} onClick={() => onChange(o)} style={{
            fontSize: 12, fontWeight: 800, padding: "6px 13px", borderRadius: 999, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
            background: sel ? `${c}1F` : "transparent", border: `1px solid ${sel ? c + "66" : BDR2}`, color: sel ? c : TEXT2, transition: "all .12s",
          }}>{labelFor ? labelFor(o) : o}</button>
        );
      })}
    </div>
  );
}
function StyledInput({ value, onChange, placeholder, type = "text", inputMode }: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string; inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"] }) {
  return (
    <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} type={type} inputMode={inputMode} style={{
      background: CARD, color: TEXT, border: `1px solid ${BDR2}`, borderRadius: 9, padding: "8px 12px",
      fontSize: 12.5, fontWeight: 600, fontFamily: "inherit", outline: "none", width: "100%", boxSizing: "border-box",
    }} />
  );
}

// ── Editable price field (no spinner / inner icon; red focus) ────────────────────
//    Commits ONLY on Enter or blur — never per keystroke. Empty/non-numeric reverts.
function PriceInput({ value, onCommit, onInvalid }: { value: number; onCommit: (n: number) => void; onInvalid: () => void }) {
  const [str, setStr] = useState(String(value));
  useEffect(() => { setStr(String(value)); }, [value]);

  function commit() {
    const trimmed = str.trim();
    if (trimmed === "" || !/^\d+$/.test(trimmed)) {
      setStr(String(value)); // revert to last valid value
      onInvalid();
      return;
    }
    const n = Number(trimmed);
    if (n === value) return;  // unchanged → no save
    onCommit(n);
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, direction: "ltr" }}>
      <span style={{ color: GREEN, fontWeight: 800, fontSize: 12.5 }}>$</span>
      <input
        value={str}
        inputMode="numeric"
        onChange={e => setStr(e.target.value.replace(/[^\d]/g, ""))}
        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
        onFocus={e => (e.currentTarget.style.borderColor = BRAND)}
        onBlur={e => { e.currentTarget.style.borderColor = BDR2; commit(); }}
        style={{ width: 72, background: CARD, color: GREEN, border: `1px solid ${BDR2}`, borderRadius: 8, padding: "6px 10px", fontSize: 12.5, fontWeight: 800, fontFamily: "inherit", outline: "none", textAlign: "left" }}
      />
    </span>
  );
}

// ── Toast (no browser alert) ─────────────────────────────────────────────────────
function Toast({ msg }: { msg: string | null }) {
  if (!msg || typeof document === "undefined") return null;
  return createPortal(
    <div style={{ position: "fixed", bottom: 26, left: "50%", transform: "translateX(-50%)", zIndex: 100002,
      background: "#1A1C22", border: `1px solid ${BDR2}`, color: TEXT, fontSize: 13, fontWeight: 700,
      padding: "11px 20px", borderRadius: 12, boxShadow: "0 8px 30px rgba(0,0,0,0.6)",
      fontFamily: "'Heebo', Arial, sans-serif", pointerEvents: "none" }}>{msg}</div>,
    document.body,
  );
}

function KpiCard({ label, value, icon, color = TEXT }: { label: string; value: string | number; icon: string; color?: string }) {
  return (
    <div style={{ background: CARD, border: `1px solid ${BDR2}`, borderRadius: 16, padding: "18px 20px 16px", position: "relative", overflow: "hidden", minWidth: 0 }}>
      <div style={{ position: "absolute", bottom: -10, insetInlineStart: -6, fontSize: 58, opacity: 0.05, lineHeight: 1, userSelect: "none", pointerEvents: "none" }}>{icon}</div>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: MUTED, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 10 }}>{label}</div>
      <div style={{ fontSize: 32, fontWeight: 900, color, letterSpacing: "-0.04em", lineHeight: 1 }}>{value}</div>
    </div>
  );
}

const sectionCard: React.CSSProperties = { background: CARD, border: `1px solid ${BDR}`, borderRadius: 18, overflow: "hidden" };
const cardHead: React.CSSProperties = { padding: "14px 20px", borderBottom: `1px solid ${BDR}`, fontSize: 14, fontWeight: 800, color: TEXT };
const ghostBtn: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, padding: "10px 16px", borderRadius: 10, background: "rgba(255,255,255,0.05)", border: `1px solid ${BDR2}`, color: TEXT2, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" };

function nowStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function isoDay(offset = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function fmtSize(b?: number): string {
  if (!b) return "";
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  if (b >= 1e3) return `${Math.round(b / 1e3)} KB`;
  return `${b} B`;
}

export default function StevenProfilePage() {
  const router = useRouter();
  const [works, setWorks]   = useState<Work[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [lang, setLang]     = useState<Lang>("he");
  const [toast, setToast]   = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const t = TR[lang];
  const rtl = lang === "he";
  const textStart = rtl ? "right" : "left";

  function notify(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }

  // Load Steven's real work records from the existing API.
  useEffect(() => {
    let alive = true;
    fetch("/api/sound-engineer?engineer=Steven")
      .then(r => r.json())
      .then((d: { ok: boolean; works?: SoundEngineerWork[] }) => {
        if (alive && d.ok && d.works) setWorks(d.works.map(mapRecord));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const openWork = works.find(w => w.id === openId) ?? null;

  // Edit a work: optimistic local update + PATCH to the existing API for DB-backed rows.
  // Persisted fields: work_type, status, agreed_price. (pay/dates stay display-only here.)
  async function updateWork(id: string, patch: Partial<Work>) {
    const target = works.find(w => w.id === id);
    setWorks(prev => prev.map(w => {
      if (w.id !== id) return w;
      const next = { ...w, ...patch };
      if (patch.price !== undefined) next.pay = payFromAmounts(next.price, next.amountPaid);
      return next;
    }));
    if (!target || !target.dbBacked) return; // manual "new work" rows are local-only

    // skipFinanceSync keeps these edits from creating/updating any Finance transaction.
    const body: Record<string, unknown> = { skipFinanceSync: true };
    if (patch.workType !== undefined) body.workType    = uiWorkTypeToDb(patch.workType);
    if (patch.status   !== undefined) body.status      = uiStatusToDb(patch.status);
    if (patch.price    !== undefined) body.agreedPrice = patch.price;
    if (Object.keys(body).length === 1) return; // only the flag → nothing actually changed

    try {
      const res = await fetch(`/api/sound-engineer/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) notify(rtl ? "השמירה נכשלה" : "Save failed");
    } catch {
      notify(rtl ? "השמירה נכשלה" : "Save failed");
    }
  }
  const addWork = (w: Work) => setWorks(prev => [w, ...prev]);

  // Delete a job: optimistic remove + close, then DELETE for DB-backed rows.
  // Local-only rows ("+ עבודה חדשה") are just dropped from state. Removes ONLY
  // sound_engineer_work here — the linked project_action is not touched (no action
  // id on this page). Finance/transactions/Dropbox/projects are never deleted.
  async function deleteWork(id: string) {
    const target = works.find(w => w.id === id);
    setWorks(prev => prev.filter(w => w.id !== id));
    setOpenId(null);
    notify(t.tDeleted);
    if (target?.dbBacked) {
      try {
        const res = await fetch(`/api/sound-engineer/${id}`, { method: "DELETE" });
        if (!res.ok) notify(rtl ? "המחיקה נכשלה" : "Delete failed");
      } catch {
        notify(rtl ? "המחיקה נכשלה" : "Delete failed");
      }
    }
  }

  const fmt = (n: number) => `$${n.toLocaleString("en-US")}`;
  const active  = works.filter(w => w.status === "פעיל").length;
  const done    = works.filter(w => w.status === "הושלם").length;
  const debt    = works.reduce((s, w) => s + Math.max(0, w.price - w.amountPaid), 0);
  const paidSum = works.reduce((s, w) => s + w.amountPaid, 0);

  return (
    <div dir={rtl ? "rtl" : "ltr"} style={{ minHeight: "100%", background: BG, color: TEXT, fontFamily: "'Heebo', Arial, sans-serif", padding: "32px 28px 80px" }}>
      <div style={{ maxWidth: 1600, margin: "0 auto" }}>

        <div style={{ marginBottom: 14 }}>
          <button onClick={() => router.push("/team")} style={{
            display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 10,
            background: CARD, border: `1px solid ${BDR2}`, color: TEXT2, fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
          }}>{t.back}</button>
        </div>

        {/* ── Header ── */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 22 }}>
          <button onClick={() => setNewOpen(true)} style={{
            padding: "10px 20px", borderRadius: 12, background: BRAND, border: "none", color: "#fff",
            fontSize: 14, fontWeight: 800, cursor: "pointer", fontFamily: "inherit",
            boxShadow: "0 2px 16px rgba(220,38,38,0.35)", whiteSpace: "nowrap",
          }}>{t.newWork}</button>

          <div style={{ textAlign: "center", flex: 1, minWidth: 240 }}>
            <div style={{ fontSize: 12, color: MUTED, letterSpacing: "0.06em", marginBottom: 3 }}>{t.breadcrumb}</div>
            <h1 style={{ fontSize: 30, fontWeight: 900, margin: 0, letterSpacing: "-0.02em" }}>{t.profileTitle} <span style={{ color: BRAND }}>Steven</span></h1>
            <div style={{ fontSize: 13, color: TEXT2, marginTop: 6 }}>{t.role}</div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: GREEN, boxShadow: `0 0 6px ${GREEN}88` }} />
              <span style={{ fontSize: 12, color: GREEN, fontWeight: 600 }}>{t.active}</span>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 280 }}>
            {/* Page-local language toggle (UI only — no global i18n) */}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <div style={{ display: "inline-flex", gap: 4, background: CARD, border: `1px solid ${BDR2}`, borderRadius: 10, padding: 4 }}>
                {(["he", "en"] as const).map(l => {
                  const sel = lang === l;
                  return (
                    <button key={l} onClick={() => { setLang(l); notify(l === "he" ? TR[l].langHe : TR[l].langEn); }} style={{
                      fontSize: 12, fontWeight: 800, padding: "5px 14px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
                      background: sel ? `${BRAND}1F` : "transparent", border: `1px solid ${sel ? BRAND + "66" : "transparent"}`, color: sel ? BRAND : TEXT2, transition: "all .12s",
                    }}>{l === "he" ? "עברית" : "English"}</button>
                  );
                })}
              </div>
            </div>
            <div style={{ background: CARD, border: `1px solid ${BDR2}`, borderRadius: 16, padding: "14px 18px", display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{ textAlign: textStart }}>
                <span style={{ fontSize: 10.5, fontWeight: 800, padding: "2px 9px", borderRadius: 7, background: `${BRAND}1A`, border: `1px solid ${BRAND}40`, color: BRAND }}>{t.soundSupplier}</span>
                <div style={{ fontSize: 20, fontWeight: 900, color: TEXT, margin: "8px 0 2px" }}>Steven</div>
                <div style={{ fontSize: 11.5, color: TEXT2, lineHeight: 1.7 }}>
                  <div>{t.supplierType}</div>
                  <div>{t.updatedToday}</div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: rtl ? "flex-end" : "flex-start", gap: 5, color: GREEN }}>
                    <span>{t.active}</span><span style={{ width: 7, height: 7, borderRadius: "50%", background: GREEN }} />
                  </div>
                </div>
              </div>
              <div style={{ width: 60, height: 60, borderRadius: "50%", flexShrink: 0, background: `linear-gradient(135deg, ${BRAND}33, ${BRAND}66)`,
                border: `2px solid ${BRAND}66`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, fontWeight: 900, color: "#fff", boxShadow: `0 0 18px ${BRAND}22` }}>S</div>
            </div>
          </div>
        </div>

        {/* ── KPI row (5 cards) ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 20 }}>
          <KpiCard label={t.kpiOpen}      value={works.length} icon="📁" />
          <KpiCard label={t.kpiActive}    value={active}       icon="🎚" color={GREEN} />
          <KpiCard label={t.kpiDone}      value={done}         icon="✔" color={BLUE} />
          <KpiCard label={t.kpiDebt}      value={fmt(debt)}    icon="👛" color={BRAND} />
          <KpiCard label={t.kpiPaidMonth} value={fmt(paidSum)} icon="💳" color={GREEN} />
        </div>

        {/* ── Main grid ── */}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2.4fr) minmax(300px, 1fr)", gap: 16, alignItems: "start" }}>

          <div style={sectionCard}>
            <div style={cardHead}>{t.soundJobs}</div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", minWidth: 660, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: CARD2 }}>
                    {[t.project, t.workType, t.status, t.startDate, t.deadline, t.price, t.payment, t.action].map(h => (
                      <th key={h} style={{ padding: "10px 14px", textAlign: textStart, fontSize: 10, fontWeight: 700, color: MUTED, letterSpacing: "0.05em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {works.length === 0 ? (
                    <tr><td colSpan={8} style={{ padding: "44px 14px", textAlign: "center", fontSize: 13, color: MUTED }}>{t.noJobs}</td></tr>
                  ) : works.map((w, i) => (
                    <tr key={w.id} style={{ borderTop: `1px solid ${BDR}`, background: i % 2 ? "rgba(255,255,255,0.01)" : "transparent" }}>
                      <td style={{ padding: "11px 14px", fontSize: 13, fontWeight: 700, color: TEXT, whiteSpace: "nowrap" }}><span style={{ marginInlineEnd: 5 }}>🎵</span>{w.project}</td>
                      <td style={{ padding: "11px 14px", fontSize: 12, color: TEXT2, whiteSpace: "nowrap" }}>{wtLabel(w.workType, lang)}</td>
                      <td style={{ padding: "11px 14px" }}><StatusChip status={w.status} lang={lang} /></td>
                      <td style={{ padding: "11px 14px", fontSize: 12, color: MUTED, whiteSpace: "nowrap" }}>{w.startDate}</td>
                      <td style={{ padding: "11px 14px", fontSize: 12, color: MUTED, whiteSpace: "nowrap" }}>{w.deadline}</td>
                      <td style={{ padding: "11px 14px", fontSize: 12.5, color: TEXT, fontWeight: 700, whiteSpace: "nowrap", direction: "ltr", textAlign: textStart }}>{fmt(w.price)}</td>
                      <td style={{ padding: "11px 14px" }}><PayChip pay={w.pay} lang={lang} /></td>
                      <td style={{ padding: "11px 14px" }}>
                        <button onClick={() => setOpenId(w.id)}
                          onMouseEnter={e => { e.currentTarget.style.background = "#E4E4EA"; e.currentTarget.style.boxShadow = "0 0 8px rgba(255,255,255,0.16)"; }}
                          onMouseLeave={e => { e.currentTarget.style.background = "#D7D7DD"; e.currentTarget.style.boxShadow = "none"; }}
                          style={{ fontSize: 11, fontWeight: 700, color: "#1A1A20", padding: "5px 13px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.18)", background: "#D7D7DD", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", transition: "background 0.15s, box-shadow 0.15s" }}>{t.openJob}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Side cards (empty states — no mock data) */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={sectionCard}>
              <div style={cardHead}>{t.payHistory}</div>
              <div style={{ padding: "28px 16px", textAlign: "center", fontSize: 12.5, color: MUTED }}>{t.noPayments}</div>
            </div>
            <div style={sectionCard}>
              <div style={cardHead}>{t.recentFiles}</div>
              <div style={{ padding: "28px 16px", textAlign: "center", fontSize: 12.5, color: MUTED }}>{t.noRecentFiles}</div>
            </div>
          </div>
        </div>
      </div>

      {openWork && <WorkModal work={openWork} onChange={patch => updateWork(openWork.id, patch)} onDelete={() => deleteWork(openWork.id)} onClose={() => setOpenId(null)} notify={notify} lang={lang} t={t} />}
      {newOpen && <NewWorkModal onClose={() => setNewOpen(false)} onAdd={w => { addWork(w); notify(t.tJobAdded); }} lang={lang} t={t} />}
      <Toast msg={toast} />
    </div>
  );
}

// ── "Open Job" modal — single screen, one Drag & Drop file zone ──────────────────
function WorkModal({ work, onChange, onDelete, onClose, notify, lang, t }: { work: Work; onChange: (patch: Partial<Work>) => void; onDelete: () => void; onClose: () => void; notify: (m: string) => void; lang: Lang; t: T }) {
  const [files, setFiles] = useState<WorkFile[]>(INITIAL_FILES);
  const [drag, setDrag] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rtl = lang === "he";

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => { document.removeEventListener("keydown", h); audioRef.current?.pause(); };
  }, [onClose]);

  function addFiles(list: FileList | null) {
    const picked = Array.from(list ?? []);
    if (!picked.length) return;
    setFiles(prev => [...prev, ...picked.map((f, i) => ({ id: `${Date.now()}_${i}`, name: f.name, time: nowStamp(), size: f.size, url: URL.createObjectURL(f) }))]);
    notify(t.tAdded);
  }
  function removeFile(f: WorkFile) {
    if (f.url) URL.revokeObjectURL(f.url);
    setFiles(prev => prev.filter(x => x.id !== f.id));
    notify(t.tRemoved);
  }
  function playFile(f: WorkFile) {
    if (!f.url) { notify(t.tNoPlay); return; }
    audioRef.current?.pause();
    const a = new Audio(f.url); audioRef.current = a;
    a.play().catch(() => notify(t.tNoPlay));
  }
  function downloadFile(f: WorkFile) {
    if (!f.url) { notify(t.tNoDownload); return; }
    const a = document.createElement("a"); a.href = f.url; a.download = f.name;
    document.body.appendChild(a); a.click(); a.remove();
  }

  const innerHead: React.CSSProperties = { fontSize: 13.5, fontWeight: 800, color: TEXT, padding: "12px 16px", borderBottom: `1px solid ${BDR}` };
  const subCard: React.CSSProperties = { background: CARD2, border: `1px solid ${BDR}`, borderRadius: 14, overflow: "hidden" };
  const detailRow = (label: string, node: React.ReactNode) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "9px 0", borderBottom: `1px solid ${BDR}` }}>
      <span style={{ fontSize: 12.5, color: MUTED }}>{label}</span>{node}
    </div>
  );

  const modal = (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 100001, background: "rgba(0,0,0,0.72)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div onClick={e => e.stopPropagation()} dir={rtl ? "rtl" : "ltr"} style={{
        background: CARD, border: `1px solid ${BRAND}33`, borderRadius: 20, width: "min(1080px, 96vw)", maxHeight: "92vh",
        display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: `0 24px 90px rgba(0,0,0,0.9), 0 0 60px ${BRAND}10`, fontFamily: "'Heebo', Arial, sans-serif",
      }}>
        <input ref={inputRef} type="file" multiple style={{ display: "none" }} onChange={e => { addFiles(e.target.files); if (e.target) e.target.value = ""; }} />

        {/* Header */}
        <div style={{ padding: "20px 24px 16px", borderBottom: `1px solid ${BDR}`, flexShrink: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 900, color: TEXT }}>{t.job} {work.project}</div>
              <div style={{ fontSize: 13, color: TEXT2, marginTop: 4 }}>Steven • {wtLabel(work.workType, lang)}</div>
            </div>
            <button onClick={onClose} style={{ width: 34, height: 34, borderRadius: "50%", background: "rgba(255,255,255,0.06)", border: `1px solid ${BDR2}`, color: TEXT2, fontSize: 18, cursor: "pointer", flexShrink: 0, lineHeight: 1 }}>×</button>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <StatusChip status={work.status} lang={lang} />
            <PayChip pay={work.pay} lang={lang} />
          </div>
        </div>

        {/* Body — no tabs */}
        <div style={{ flex: 1, overflowY: "auto", padding: "18px 24px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 1fr) minmax(0, 1.6fr)", gap: 16, alignItems: "start" }}>

            {/* Work details */}
            <div style={subCard}>
              <div style={innerHead}>{t.jobDetails}</div>
              <div style={{ padding: "6px 16px 12px" }}>
                {detailRow(t.project, <span style={{ fontSize: 12.5, fontWeight: 700, color: TEXT }}>{work.project}</span>)}
                {detailRow(t.workType, <PillGroup value={work.workType} options={WORK_TYPES} labelFor={o => wtLabel(o, lang)} onChange={v => onChange({ workType: v })} />)}
                {detailRow(t.status, <PillGroup value={work.status} options={STATUS_OPTIONS} colorFor={o => STATUS_COLOR[o]} labelFor={o => statusLabel(o, lang)} onChange={v => onChange({ status: v })} />)}
                {detailRow(t.startDate, <span style={{ fontSize: 12.5, fontWeight: 700, color: TEXT }}>{work.startDate}</span>)}
                {detailRow(t.deadline, <span style={{ fontSize: 12.5, fontWeight: 700, color: TEXT }}>{work.deadline}</span>)}
                {detailRow(t.agreedPrice, <PriceInput value={work.price} onCommit={n => { onChange({ price: n }); notify(t.priceSaved); }} onInvalid={() => notify(t.priceInvalid)} />)}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "9px 0" }}>
                  <span style={{ fontSize: 12.5, color: MUTED }}>{t.payment}</span>
                  <PayChip pay={work.pay} lang={lang} />
                </div>
                {/* Danger zone — delete this job (subtle, not primary) */}
                <div style={{ paddingTop: 12, marginTop: 2, borderTop: `1px solid ${BDR}`, display: "flex", justifyContent: "flex-start" }}>
                  <button
                    onClick={() => setConfirmOpen(true)}
                    onMouseEnter={e => { e.currentTarget.style.background = "#3A1212"; e.currentTarget.style.borderColor = RED; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = `${RED}55`; }}
                    style={{ fontSize: 12, fontWeight: 700, padding: "7px 14px", borderRadius: 9, background: "transparent", border: `1px solid ${RED}55`, color: RED, cursor: "pointer", fontFamily: "inherit", transition: "all .12s" }}
                  >🗑 {t.deleteWork}</button>
                </div>
              </div>
            </div>

            {/* Files */}
            <div style={subCard}>
              <div style={{ ...innerHead, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span>{t.workFiles} <span style={{ color: MUTED, fontWeight: 700 }}>({files.length})</span></span>
                <button onClick={() => notify(t.tNoDropbox)} style={{ fontSize: 11, fontWeight: 700, padding: "5px 11px", borderRadius: 8, background: "rgba(0,98,238,0.12)", border: "1px solid rgba(0,98,238,0.3)", color: "#4A9EFF", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>{t.openDropbox}</button>
              </div>
              <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
                <div
                  onClick={() => inputRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); if (!drag) setDrag(true); }}
                  onDragLeave={e => { e.preventDefault(); setDrag(false); }}
                  onDrop={e => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6,
                    textAlign: "center", padding: "26px 16px", borderRadius: 14, cursor: "pointer",
                    border: `2px dashed ${drag ? BRAND : BDR2}`, background: drag ? `${BRAND}12` : "rgba(255,255,255,0.015)",
                    boxShadow: drag ? `0 0 22px ${BRAND}33` : "none", transition: "all .15s",
                  }}
                >
                  <div style={{ fontSize: 30, lineHeight: 1, opacity: 0.85, color: drag ? BRAND : TEXT2 }}>☁️</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: TEXT }}>{t.dragHere}</div>
                  <div style={{ fontSize: 12, color: TEXT2 }}>{t.orClick}</div>
                  <div style={{ fontSize: 10.5, color: MUTED }}>{t.fileHint}</div>
                  <button onClick={e => { e.stopPropagation(); inputRef.current?.click(); }} style={{ marginTop: 6, fontSize: 11.5, fontWeight: 700, padding: "7px 16px", borderRadius: 9, background: `${BRAND}14`, border: `1px solid ${BRAND}40`, color: BRAND, cursor: "pointer", fontFamily: "inherit" }}>{t.chooseFiles}</button>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflowY: "auto" }}>
                  {files.length ? files.map(f => {
                    const isAudio = /\.(wav|mp3|m4a|flac|aiff?)$/i.test(f.name);
                    const sz = fmtSize(f.size);
                    return (
                      <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", borderRadius: 9, background: CARD, border: `1px solid ${BDR}` }}>
                        <span style={{ fontSize: 14, color: isAudio ? BRAND : TEXT2, flexShrink: 0 }}>{isAudio ? "〰" : "🗎"}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
                          <div style={{ fontSize: 10, color: MUTED, marginTop: 1 }}>{f.time}{sz ? ` · ${sz}` : ""}</div>
                        </div>
                        {isAudio && <button onClick={() => playFile(f)} title="play" style={{ width: 26, height: 26, borderRadius: "50%", flexShrink: 0, background: `${BRAND}22`, border: `1px solid ${BRAND}55`, color: "#fff", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>▶</button>}
                        <button onClick={() => downloadFile(f)} title="download" style={{ background: "none", border: "none", color: MUTED, fontSize: 14, cursor: "pointer", flexShrink: 0 }}>⬇</button>
                        <button onClick={() => removeFile(f)} title="remove" style={{ background: "none", border: "none", color: "#7A4A4A", fontSize: 13, cursor: "pointer", flexShrink: 0 }}
                          onMouseEnter={e => (e.currentTarget.style.color = RED)} onMouseLeave={e => (e.currentTarget.style.color = "#7A4A4A")}>🗑</button>
                      </div>
                    );
                  }) : (
                    <div style={{ fontSize: 12, color: MUTED, textAlign: "center", padding: "14px 0" }}>{t.noFiles}</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Brief notes */}
          <div style={{ ...subCard, marginTop: 16 }}>
            <div style={innerHead}>{t.briefNotes}</div>
            <div style={{ padding: "12px 16px", display: "flex", flexWrap: "wrap", gap: "10px 18px" }}>
              {t.brief.map(b => (
                <div key={b} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: TEXT2 }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: BRAND, flexShrink: 0 }} />{b}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Delete confirmation (in-app, no browser confirm) */}
        {confirmOpen && (
          <div onClick={() => setConfirmOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 100002, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
            <div onClick={e => e.stopPropagation()} dir={rtl ? "rtl" : "ltr"} style={{ background: CARD, border: `1px solid ${RED}44`, borderRadius: 16, width: "min(420px, 92vw)", padding: "22px 24px", boxShadow: "0 24px 80px rgba(0,0,0,0.9)", fontFamily: "'Heebo', Arial, sans-serif" }}>
              <div style={{ fontSize: 16, fontWeight: 900, color: TEXT, marginBottom: 10 }}>{t.confirmTitle}</div>
              <div style={{ fontSize: 13, color: TEXT2, lineHeight: 1.6, marginBottom: 18 }}>{t.confirmBody}</div>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => setConfirmOpen(false)} style={{ ...ghostBtn, flex: 1, justifyContent: "center" }}>{t.confirmNo}</button>
                <button onClick={() => { setConfirmOpen(false); onDelete(); }} style={{ flex: 1, padding: "10px 18px", borderRadius: 10, background: RED, border: "none", color: "#fff", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>🗑 {t.confirmYes}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modal, document.body) : null;
}

// ── "New Work for Steven" modal ──────────────────────────────────────────────────
function NewWorkModal({ onClose, onAdd, lang, t }: { onClose: () => void; onAdd: (w: Work) => void; lang: Lang; t: T }) {
  const [project, setProject]   = useState("");
  const [workType, setWorkType] = useState<WorkType>("מיקס מאסטרינג");
  const [status, setStatus]     = useState<WorkStatus>("פעיל");
  const [startDate, setStartDate] = useState(() => isoDay(0));
  const [deadline, setDeadline] = useState(() => isoDay(3));
  const [price, setPrice]       = useState("200");
  const [pay, setPay]           = useState<PayStatus>("לא שולם");
  const [err, setErr]           = useState<string | null>(null);
  const rtl = lang === "he";

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  function save() {
    if (!project.trim()) { setErr(t.required); return; }
    onAdd({
      id: (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
      project: project.trim(), workType, status,
      startDate: startDate.trim() || "—", deadline: deadline.trim() || "—",
      price: Number(price) || 0, pay,
      amountPaid: pay === "שולם" ? Number(price) || 0 : 0, currency: "$", dbBacked: false,
    });
    onClose();
  }

  const row = (label: string, node: React.ReactNode) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: TEXT2 }}>{label}</span>{node}
    </div>
  );

  const modal = (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 100001, background: "rgba(0,0,0,0.72)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div onClick={e => e.stopPropagation()} dir={rtl ? "rtl" : "ltr"} style={{ background: CARD, border: `1px solid ${BRAND}33`, borderRadius: 20, width: "min(540px, 96vw)", maxHeight: "92vh", overflowY: "auto", boxShadow: `0 24px 90px rgba(0,0,0,0.9), 0 0 60px ${BRAND}10`, fontFamily: "'Heebo', Arial, sans-serif", padding: "22px 24px 20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 18, fontWeight: 900, color: TEXT }}>{t.newWorkTitle}</div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(255,255,255,0.06)", border: `1px solid ${BDR2}`, color: TEXT2, fontSize: 18, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {row(t.project, <StyledInput value={project} onChange={setProject} placeholder={t.projectName} />)}
          {row(t.workType, <PillGroup value={workType} options={WORK_TYPES} labelFor={o => wtLabel(o, lang)} onChange={setWorkType} />)}
          {row(t.status, <PillGroup value={status} options={STATUS_OPTIONS} colorFor={o => STATUS_COLOR[o]} labelFor={o => statusLabel(o, lang)} onChange={setStatus} />)}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {row(t.startDate, <StyledInput value={startDate} onChange={setStartDate} placeholder="2026-07-01" />)}
            {row(t.deadline, <StyledInput value={deadline} onChange={setDeadline} placeholder="2026-07-03" />)}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "end" }}>
            {row(t.priceLabel, <StyledInput value={price} onChange={setPrice} placeholder="200" inputMode="numeric" />)}
            {row(t.payment, <PillGroup value={pay} options={PAY_OPTIONS} colorFor={o => (o === "שולם" ? GREEN : MUTED)} labelFor={o => payLabel(o, lang)} onChange={setPay} />)}
          </div>
          {err && <div style={{ fontSize: 12, color: RED }}>{err}</div>}
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button onClick={onClose} style={{ ...ghostBtn, flex: 1, justifyContent: "center" }}>{t.cancel}</button>
          <button onClick={save} style={{ flex: 1, padding: "10px 18px", borderRadius: 10, background: BRAND, border: "none", color: "#fff", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", boxShadow: "0 2px 14px rgba(220,38,38,0.4)" }}>{t.save}</button>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modal, document.body) : null;
}
