"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import type { SoundEngineerWork, MixVersion } from "@/lib/types";

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
// "חלקי" is DISPLAY-ONLY (derived when 0 < amountPaid < agreedPrice); it is NOT
// a selectable option (no payment_status column — a real 3-state needs SQL).
type PayStatus  = "שולם" | "חלקי" | "לא שולם";
type WorkType   = "מיקס מאסטרינג" | "מאסטרינג";
type Lang       = "he" | "en";

const WORK_TYPES: WorkType[]       = ["מיקס מאסטרינג", "מאסטרינג"];
const STATUS_OPTIONS: WorkStatus[] = ["פעיל", "הושלם", "בוטל"];
const PAY_OPTIONS: PayStatus[]     = ["שולם", "לא שולם"];   // selectable (חלקי is display-only)

const STATUS_EN: Record<WorkStatus, string> = { "פעיל": "Active", "הושלם": "Completed", "בוטל": "Canceled" };
const PAY_EN:    Record<PayStatus, string>  = { "שולם": "Paid", "חלקי": "Partial", "לא שולם": "Unpaid" };
const WT_EN:     Record<WorkType, string>   = { "מיקס מאסטרינג": "Mix & Mastering", "מאסטרינג": "Mastering" };
const statusLabel = (s: WorkStatus, lang: Lang) => (lang === "en" ? STATUS_EN[s] : s);
const payLabel    = (p: PayStatus, lang: Lang)  => (lang === "en" ? PAY_EN[p] : p);
const wtLabel     = (w: WorkType, lang: Lang)   => (lang === "en" ? WT_EN[w] : w);

// ── Mix-version status (Phase 2) — canonical Hebrew, EN display-only ─────────────
type VStatus = "בבדיקה" | "מוכן" | "מאושר" | "נדחה";
const VSTATUS_OPTIONS: VStatus[] = ["בבדיקה", "מוכן", "מאושר", "נדחה"];
const VSTATUS_COLOR: Record<VStatus, string> = { "בבדיקה": "#F59E0B", "מוכן": GREEN, "מאושר": BLUE, "נדחה": RED };
const VSTATUS_EN:    Record<VStatus, string> = { "בבדיקה": "In review", "מוכן": "Ready", "מאושר": "Approved", "נדחה": "Rejected" };
const vStatusLabel = (s: string, lang: Lang) => (lang === "en" && (s in VSTATUS_EN) ? VSTATUS_EN[s as VStatus] : s);
const vStatusColor = (s: string) => (s in VSTATUS_COLOR ? VSTATUS_COLOR[s as VStatus] : MUTED);

/** Human file size. */
function fmtBytes(b: number | null): string {
  if (b == null) return "—";
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  if (b >= 1e3) return `${Math.round(b / 1e3)} KB`;
  return `${b} B`;
}
/** ISO → "DD.MM.YY HH:MM" in Israel time (empty → "—"). */
function fmtDateTime(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const date = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", day: "2-digit", month: "2-digit", year: "2-digit" }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return `${date.replace(/\//g, ".")} ${time}`;
}

interface Work {
  id: string; project: string; workType: WorkType; status: WorkStatus;
  startDate: string; deadline: string; price: number; pay: PayStatus;
  amountPaid: number; currency: string; dbBacked: boolean;
  notes: string; filesLink: string | null;   // real fields from sound_engineer_work
}

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
// Pay status is derived from amounts (no payment_status column on this table).
// 3-state for DISPLAY (שולם / חלקי / לא שולם); only שולם & לא שולם are selectable.
function payFromAmounts(agreed: number, paid: number): PayStatus {
  if (agreed > 0 && paid >= agreed) return "שולם";
  if (paid > 0)                     return "חלקי";
  return "לא שולם";
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
    // Prefer the Steven/Bill-facing work title; fall back to the project name.
    project:    r.workTitle || r.projectName || "—",
    workType:   dbWorkTypeToUi(r.workType),
    status:     dbStatusToUi(r.status),
    startDate:  fmtDbDate(r.sentDate),
    deadline:   fmtDbDate(r.internalDeadline),
    price:      r.agreedPrice,
    pay:        payFromAmounts(r.agreedPrice, r.amountPaid),
    amountPaid: r.amountPaid,
    currency:   r.currency || "$",
    dbBacked:   true,
    notes:      r.notes || "",
    filesLink:  r.filesLink ?? null,
  };
}

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
    job: "עבודה:", jobEyebrow: "עבודה", workFiles: "קבצי עבודה", dragHere: "גרור לכאן קבצים", orClick: "או לחץ להעלאה ידנית", chooseFiles: "בחר קבצים", fileHint: "Stems, Mix, Master, Reference, ZIP", noFiles: "אין עדיין קבצים בעבודה הזו",
    openDropbox: "📦 פתח בדרופבוקס", jobDetails: "פרטי עבודה", agreedPrice: "מחיר שסוכם",
    mixInstructions: "הוראות למיקס", mixInstructionsSub: "מה שסטיבן צריך לדעת לפני שהוא מתחיל", mixInstructionsPh: "כתוב כאן הוראות למיקס — רפרנסים, דגשים על ווקאל/פזמון, מאסטרינג לסטרימינג...", saveInstructions: "שמור הוראות", instructionsSaved: "ההוראות נשמרו",
    mixVersions: "גרסאות למיקס", versionsEmptyTitle: "עדיין אין גרסאות מיקס", mixVersionsEmpty: "גרסאות המיקס (Mix 1, Mix 2...) יתווספו כאן בהמשך", openInDropbox: "📦 פתח תיקיית Dropbox", noFilesLink: "אין עדיין תיקיית Dropbox מקושרת לעבודה זו",
    uploadVersion: "+ העלה גרסה / קובץ עבודה", phase2Tag: "פאזה 2", uploadComing: "העלאת גרסאות אמיתית ל-Dropbox תתווסף בפאזה הבאה",
    vLabelPh: "שם גרסה (אופציונלי) — למשל Mix 1", vChooseFile: "בחר קובץ", vFileHint: "WAV / MP3 / AIFF / M4A / FLAC / ZIP",
    vUploading: "מעלה קובץ…", vUploaded: "הגרסה הועלתה", vUploadFailed: "העלאת הגרסה נכשלה", vDeleted: "הגרסה נמחקה", vLoadFailed: "טעינת הגרסאות נכשלה",
    vLoading: "טוען גרסאות…", vEmpty: "עדיין אין גרסאות — העלה קובץ ראשון עם הכפתור למעלה",
    vColVersion: "שם גרסה", vColFile: "קובץ", vColType: "סוג", vColSize: "גודל", vColDate: "הועלה", vColStatus: "סטטוס", vColActions: "פעולות",
    vDelTitle: "למחוק את הגרסה?", vDelBody: "הקובץ יימחק מ-Dropbox ומהרשימה. פעולה בלתי הפיכה.", vDelYes: "מחק גרסה", vDownload: "הורדה",
    playerSection: "נגן והערות", playerEmptyTitle: "נגן והערות יתווספו בקרוב", playerEmpty: "נגן והערות לפי נקודות זמן בשיר יתווספו בקרוב",
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
    job: "Job:", jobEyebrow: "Job", workFiles: "Work Files", dragHere: "Drag files here", orClick: "or click to upload manually", chooseFiles: "Choose Files", fileHint: "Stems, Mix, Master, Reference, ZIP", noFiles: "No files yet for this job",
    openDropbox: "📦 Open in Dropbox", jobDetails: "Job Details", agreedPrice: "Agreed Price",
    mixInstructions: "Mix Instructions", mixInstructionsSub: "What Steven needs to know before starting", mixInstructionsPh: "Write mix instructions here — references, vocal/chorus focus, streaming-ready master...", saveInstructions: "Save instructions", instructionsSaved: "Instructions saved",
    mixVersions: "Mix Versions", versionsEmptyTitle: "No mix versions yet", mixVersionsEmpty: "Mix versions (Mix 1, Mix 2...) will appear here", openInDropbox: "📦 Open Dropbox folder", noFilesLink: "No Dropbox folder linked to this job yet",
    uploadVersion: "+ Upload version / work file", phase2Tag: "Phase 2", uploadComing: "Real Dropbox version upload is coming in the next phase",
    vLabelPh: "Version name (optional) — e.g. Mix 1", vChooseFile: "Choose file", vFileHint: "WAV / MP3 / AIFF / M4A / FLAC / ZIP",
    vUploading: "Uploading…", vUploaded: "Version uploaded", vUploadFailed: "Version upload failed", vDeleted: "Version deleted", vLoadFailed: "Failed to load versions",
    vLoading: "Loading versions…", vEmpty: "No versions yet — upload the first file with the button above",
    vColVersion: "Version", vColFile: "File", vColType: "Type", vColSize: "Size", vColDate: "Uploaded", vColStatus: "Status", vColActions: "Actions",
    vDelTitle: "Delete this version?", vDelBody: "The file will be removed from Dropbox and the list. This cannot be undone.", vDelYes: "Delete version", vDownload: "Download",
    playerSection: "Player & Comments", playerEmptyTitle: "Player & comments coming soon", playerEmpty: "A player and time-stamped comments will be added soon",
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
const PAY_COLOR:    Record<PayStatus, string>  = { "שולם": GREEN, "חלקי": "#F59E0B", "לא שולם": RED };
function StatusChip({ status, lang }: { status: WorkStatus; lang: Lang }) {
  const c = STATUS_COLOR[status];
  return <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 11px", borderRadius: 8, whiteSpace: "nowrap", background: `${c}1A`, border: `1px solid ${c}40`, color: c }}>{statusLabel(status, lang)}</span>;
}
function PayChip({ pay, lang }: { pay: PayStatus; lang: Lang }) {
  const c = PAY_COLOR[pay];
  return <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 11px", borderRadius: 8, whiteSpace: "nowrap", background: `${c}14`, border: `1px solid ${c}40`, color: c }}>{payLabel(pay, lang)}</span>;
}

// ── Inline badge-dropdown (modern pill trigger + dark RTL popover via portal) ─────
//    Used in the table to change work status / payment status without a modal.
//    `display`/`color` reflect the CURRENT state (which may be a display-only
//    value like חלקי/בוטל not present in `options`); `options` = the selectable set.
function InlineSelect<V extends string>({
  value, display, color, options, onChange,
}: {
  value: V;
  display: string;
  color: string;
  options: { value: V; label: string; color: string }[];
  onChange: (v: V) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos]   = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  function openMenu() {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        onClick={openMenu}
        title="לחץ לשינוי"
        style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 8,
          whiteSpace: "nowrap", cursor: "pointer", fontFamily: "inherit",
          background: `${color}1A`, border: `1px solid ${color}40`, color,
          transition: "all .12s",
        }}
      >
        {display}
        <span style={{ fontSize: 8, opacity: 0.75, transform: open ? "rotate(180deg)" : "none", transition: "transform .12s" }}>▾</span>
      </button>
      {open && pos && createPortal(
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 200000 }} />
          <div dir="rtl" style={{
            position: "fixed", top: pos.top, right: pos.right, zIndex: 200001,
            background: "#14141A", border: `1px solid ${BDR2}`, borderRadius: 12,
            padding: 6, minWidth: 152, boxShadow: "0 14px 36px rgba(0,0,0,0.65)",
            display: "flex", flexDirection: "column", gap: 3,
          }}>
            {options.map(o => {
              const sel = o.value === value;
              return (
                <button
                  key={o.value}
                  onClick={() => { setOpen(false); if (o.value !== value) onChange(o.value); }}
                  onMouseEnter={e => { if (!sel) e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
                  onMouseLeave={e => { if (!sel) e.currentTarget.style.background = "transparent"; }}
                  style={{
                    display: "flex", alignItems: "center", gap: 9, width: "100%",
                    padding: "8px 11px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
                    fontSize: 12.5, fontWeight: 700, textAlign: "start",
                    background: sel ? `${o.color}18` : "transparent",
                    border: `1px solid ${sel ? o.color + "55" : "transparent"}`,
                    color: sel ? o.color : TEXT, transition: "background .1s",
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: o.color, flexShrink: 0 }} />
                  {o.label}
                  {sel && <span style={{ marginInlineStart: "auto", color: o.color, fontSize: 12 }}>✓</span>}
                </button>
              );
            })}
          </div>
        </>,
        document.body
      )}
    </>
  );
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
function PriceInput({ value, currency = "$", onCommit, onInvalid }: { value: number; currency?: string; onCommit: (n: number) => void; onInvalid: () => void }) {
  const [str, setStr] = useState(String(value));
  const [focus, setFocus] = useState(false);
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

  // Unified box: currency glyph + number share one bordered field so the symbol
  // can never "escape" outside the box. Whole box highlights on focus.
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 6, direction: "ltr",
      background: CARD, border: `1px solid ${focus ? BRAND : BDR2}`, borderRadius: 10,
      padding: "5px 12px", transition: "border-color .12s",
    }}>
      <span style={{ color: GREEN, fontWeight: 800, fontSize: 13 }}>{currency}</span>
      <input
        value={str}
        inputMode="numeric"
        onChange={e => setStr(e.target.value.replace(/[^\d]/g, ""))}
        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
        onFocus={() => setFocus(true)}
        onBlur={() => { setFocus(false); commit(); }}
        style={{ width: `${Math.max(3, str.length + 1)}ch`, minWidth: 34, maxWidth: 120, background: "transparent", color: GREEN, border: "none", padding: 0, fontSize: 13, fontWeight: 800, fontFamily: "inherit", outline: "none", textAlign: "left" }}
      />
    </div>
  );
}

// ── Editable mix instructions (real sound_engineer_work.notes) ───────────────────
//    Local draft; commits on blur or the explicit save button (only when changed).
function NotesEditor({ value, placeholder, saveLabel, onSave }: {
  value: string; placeholder: string; saveLabel: string; onSave: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  const dirty = draft.trim() !== (value ?? "").trim();
  const [focus, setFocus] = useState(false);

  function commit() {
    const v = draft.trim();
    if (v === (value ?? "").trim()) return; // unchanged → no save
    onSave(v);
  }

  return (
    <div>
      <textarea
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onFocus={() => setFocus(true)}
        onBlur={() => { setFocus(false); commit(); }}
        placeholder={placeholder}
        rows={8}
        style={{
          width: "100%", boxSizing: "border-box", resize: "vertical", minHeight: 210,
          background: CARD, color: TEXT, border: `1px solid ${focus ? BRAND : BDR2}`, borderRadius: 12,
          padding: "14px 16px", fontSize: 14, lineHeight: 1.8, fontFamily: "inherit", outline: "none",
          transition: "border-color .12s",
        }}
      />
      {dirty && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
          <button onClick={commit} style={{ fontSize: 12, fontWeight: 800, padding: "7px 16px", borderRadius: 9, background: `${BRAND}18`, border: `1px solid ${BRAND}55`, color: BRAND, cursor: "pointer", fontFamily: "inherit" }}>{saveLabel}</button>
        </div>
      )}
    </div>
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

function isoDay(offset = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
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

  // Load Steven's real work records from the existing API (also called after a
  // create so a new job is shown from the SERVER truth, never a local phantom).
  const reloadWorks = useCallback(async () => {
    try {
      const r = await fetch("/api/sound-engineer?engineer=Steven");
      const d = (await r.json()) as { ok: boolean; works?: SoundEngineerWork[] };
      if (d.ok && d.works) setWorks(d.works.map(mapRecord));
    } catch { /* silent */ }
  }, []);
  useEffect(() => { void reloadWorks(); }, [reloadWorks]);

  const openWork = works.find(w => w.id === openId) ?? null;

  // Edit a work: optimistic local update + PATCH to the existing API for DB-backed rows.
  // Persisted fields: work_type, status, agreed_price. (pay/dates stay display-only here.)
  async function updateWork(id: string, patch: Partial<Work>) {
    const target = works.find(w => w.id === id);
    setWorks(prev => prev.map(w => {
      if (w.id !== id) return w;
      const next = { ...w, ...patch };
      // Payment status has no column — a pay choice is stored as amountPaid
      // (שולם → full price, לא שולם → 0). Keep the derived label in sync.
      if (patch.pay !== undefined) {
        next.amountPaid = patch.pay === "שולם" ? w.price : 0;
        next.pay = payFromAmounts(w.price, next.amountPaid);
      }
      if (patch.price !== undefined) next.pay = payFromAmounts(next.price, next.amountPaid);
      return next;
    }));
    if (!target || !target.dbBacked) return; // manual "new work" rows are local-only

    // skipFinanceSync keeps these edits from creating/updating any Finance transaction.
    const body: Record<string, unknown> = { skipFinanceSync: true };
    if (patch.workType !== undefined) body.workType    = uiWorkTypeToDb(patch.workType);
    if (patch.status   !== undefined) body.status      = uiStatusToDb(patch.status);
    if (patch.price    !== undefined) body.agreedPrice = patch.price;
    if (patch.pay      !== undefined) body.amountPaid  = patch.pay === "שולם" ? target.price : 0;
    if (patch.notes    !== undefined) body.notes       = patch.notes;
    if (Object.keys(body).length === 1) return; // only the flag → nothing actually changed

    try {
      const res = await fetch(`/api/sound-engineer/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setWorks(prev => prev.map(w => (w.id === id ? target : w))); // revert on failure
        notify(rtl ? "השמירה נכשלה" : "Save failed");
      }
    } catch {
      setWorks(prev => prev.map(w => (w.id === id ? target : w))); // revert on failure
      notify(rtl ? "השמירה נכשלה" : "Save failed");
    }
  }
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
  // Open = not completed and not cancelled (same "open" rule as the Victor page /
  // the /team dashboard). Previously "עבודות פתוחות" showed the TOTAL job count.
  const open    = works.filter(w => w.status !== "הושלם" && w.status !== "בוטל").length;
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
          <KpiCard label={t.kpiOpen}      value={open}         icon="📁" />
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
                      <td style={{ padding: "11px 14px" }}>
                        <InlineSelect
                          value={w.status}
                          display={statusLabel(w.status, lang)}
                          color={STATUS_COLOR[w.status]}
                          options={[
                            { value: "פעיל"  as WorkStatus, label: statusLabel("פעיל",  lang), color: STATUS_COLOR["פעיל"]  },
                            { value: "הושלם" as WorkStatus, label: statusLabel("הושלם", lang), color: STATUS_COLOR["הושלם"] },
                          ]}
                          onChange={v => updateWork(w.id, { status: v })}
                        />
                      </td>
                      <td style={{ padding: "11px 14px", fontSize: 12, color: MUTED, whiteSpace: "nowrap" }}>{w.startDate}</td>
                      <td style={{ padding: "11px 14px", fontSize: 12, color: MUTED, whiteSpace: "nowrap" }}>{w.deadline}</td>
                      <td style={{ padding: "11px 14px", fontSize: 12.5, color: TEXT, fontWeight: 700, whiteSpace: "nowrap", direction: "ltr", textAlign: textStart }}>{fmt(w.price)}</td>
                      <td style={{ padding: "11px 14px" }}>
                        <InlineSelect
                          value={w.pay}
                          display={payLabel(w.pay, lang)}
                          color={PAY_COLOR[w.pay]}
                          options={[
                            { value: "שולם"    as PayStatus, label: payLabel("שולם",    lang), color: PAY_COLOR["שולם"]    },
                            { value: "לא שולם" as PayStatus, label: payLabel("לא שולם", lang), color: PAY_COLOR["לא שולם"] },
                          ]}
                          onChange={v => updateWork(w.id, { pay: v })}
                        />
                      </td>
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
      {newOpen && <NewWorkModal onClose={() => setNewOpen(false)} onCreated={() => { void reloadWorks(); notify(t.tJobAdded); }} lang={lang} t={t} />}
      <Toast msg={toast} />
    </div>
  );
}

// ── Narrow-viewport hook — lets the modal stack its top row on mobile ────────────
function useIsNarrow(max = 760): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const check = () => setNarrow(window.innerWidth <= max);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [max]);
  return narrow;
}

// ── Empty "ready work area" (versions / player) — structured, not tiny text ──────
function EmptyZone({ icon, title, subtitle }: { icon: string; title: string; subtitle?: string }) {
  return (
    <div style={{ margin: "14px 16px 16px", padding: "28px 20px", borderRadius: 14, border: `1.5px dashed ${BDR2}`, background: "rgba(255,255,255,0.015)", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 9 }}>
      <div style={{ width: 48, height: 48, borderRadius: "50%", background: `${BRAND}12`, border: `1px solid ${BRAND}30`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>{icon}</div>
      <div style={{ fontSize: 14, fontWeight: 800, color: TEXT2 }}>{title}</div>
      {subtitle && <div style={{ fontSize: 12, color: MUTED, maxWidth: 360, lineHeight: 1.65 }}>{subtitle}</div>}
    </div>
  );
}

// ── "Open Job" modal — clean workboard: instructions / versions / player ─────────
function WorkModal({ work, onChange, onDelete, onClose, notify, lang, t }: { work: Work; onChange: (patch: Partial<Work>) => void; onDelete: () => void; onClose: () => void; notify: (m: string) => void; lang: Lang; t: T }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const rtl = lang === "he";
  const narrow = useIsNarrow(760);

  // ── Mix versions (Phase 2) — real data from /api/sound-engineer/{workId}/versions
  const [versions, setVersions]   = useState<MixVersion[] | null>(null); // null = loading
  const [vLoadErr, setVLoadErr]   = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadLabel, setUploadLabel] = useState("");
  const [drag, setDrag]           = useState(false);
  const [delVersion, setDelVersion] = useState<MixVersion | null>(null);
  const versionInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let alive = true;
    setVersions(null); setVLoadErr(false);
    fetch(`/api/sound-engineer/${work.id}/versions`)
      .then(r => r.json())
      .then(d => { if (!alive) return; if (d.ok) setVersions(d.versions ?? []); else setVLoadErr(true); })
      .catch(() => { if (alive) setVLoadErr(true); });
    return () => { alive = false; };
  }, [work.id]);

  function uploadVersionFile(list: FileList | null) {
    const file = list?.[0];
    if (!file || uploading) return;
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    if (uploadLabel.trim()) fd.append("label", uploadLabel.trim());
    fetch(`/api/sound-engineer/${work.id}/versions`, { method: "POST", body: fd })
      .then(r => r.json())
      .then(d => {
        if (d.ok && d.version) {
          setVersions(prev => [d.version as MixVersion, ...(prev ?? [])]);
          setUploadLabel("");
          notify(t.vUploaded);
        } else {
          notify(d.error || t.vUploadFailed);
        }
      })
      .catch(() => notify(t.vUploadFailed))
      .finally(() => { setUploading(false); if (versionInputRef.current) versionInputRef.current.value = ""; });
  }

  function setVersionStatus(v: MixVersion, status: string) {
    const prev = versions;
    setVersions(cur => cur?.map(x => (x.id === v.id ? { ...x, status } : x)) ?? null);
    fetch(`/api/sound-engineer/versions/${v.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
    })
      .then(r => r.json())
      .then(d => { if (!d.ok) { setVersions(prev); notify(rtl ? "השמירה נכשלה" : "Save failed"); } })
      .catch(() => { setVersions(prev); notify(rtl ? "השמירה נכשלה" : "Save failed"); });
  }

  function confirmDeleteVersion() {
    const v = delVersion; if (!v) return;
    setDelVersion(null);
    const prev = versions;
    setVersions(cur => cur?.filter(x => x.id !== v.id) ?? null);
    fetch(`/api/sound-engineer/versions/${v.id}`, { method: "DELETE" })
      .then(r => r.json())
      .then(d => { if (d.ok) notify(t.vDeleted); else { setVersions(prev); notify(rtl ? "המחיקה נכשלה" : "Delete failed"); } })
      .catch(() => { setVersions(prev); notify(rtl ? "המחיקה נכשלה" : "Delete failed"); });
  }

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  const innerHead: React.CSSProperties = { fontSize: 13.5, fontWeight: 800, color: TEXT, padding: "12px 16px", borderBottom: `1px solid ${BDR}` };
  const subCard: React.CSSProperties = { background: CARD2, border: `1px solid ${BDR}`, borderRadius: 14, overflow: "hidden" };
  const detailRow = (label: string, node: React.ReactNode) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, minHeight: 44, padding: "8px 0", borderBottom: `1px solid ${BDR}` }}>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: MUTED, flexShrink: 0 }}>{label}</span>
      <div style={{ display: "flex", justifyContent: "flex-end", minWidth: 0 }}>{node}</div>
    </div>
  );

  const modal = (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 100001, background: "rgba(0,0,0,0.72)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div onClick={e => e.stopPropagation()} dir={rtl ? "rtl" : "ltr"} style={{
        background: CARD, border: `1px solid ${BRAND}33`, borderRadius: 20, width: "min(960px, 96vw)", maxHeight: "92vh",
        display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: `0 24px 90px rgba(0,0,0,0.9), 0 0 60px ${BRAND}10`, fontFamily: "'Heebo', Arial, sans-serif",
      }}>
        {/* Header */}
        <div style={{ padding: "20px 24px 18px", borderBottom: `1px solid ${BDR}`, flexShrink: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 10.5, fontWeight: 800, color: MUTED, letterSpacing: "0.09em", textTransform: "uppercase", marginBottom: 5 }}>{t.jobEyebrow}</div>
              <div style={{ fontSize: 23, fontWeight: 900, color: TEXT, lineHeight: 1.15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{work.project}</div>
            </div>
            <button onClick={onClose} style={{ width: 34, height: 34, borderRadius: "50%", background: "rgba(255,255,255,0.06)", border: `1px solid ${BDR2}`, color: TEXT2, fontSize: 18, cursor: "pointer", flexShrink: 0, lineHeight: 1 }}>×</button>
          </div>
          {/* Meta + live status */}
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 14, flexWrap: "wrap" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 800, color: TEXT2, padding: "4px 11px", borderRadius: 999, background: "rgba(255,255,255,0.05)", border: `1px solid ${BDR2}` }}>🎧 Steven</span>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: TEXT2 }}>{wtLabel(work.workType, lang)}</span>
            <span style={{ width: 4, height: 4, borderRadius: 999, background: MUTED, flexShrink: 0 }} />
            <StatusChip status={work.status} lang={lang} />
            <PayChip pay={work.pay} lang={lang} />
          </div>
        </div>

        {/* Body — workboard: instructions (top) / details / versions (middle) / player (bottom) */}
        <div style={{ flex: 1, overflowY: "auto", padding: "18px 24px", display: "flex", flexDirection: "column", gap: 16 }}>

          {/* TOP: Work details (side) + Mix instructions (wide, central) — per reference */}
          <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "minmax(280px, 1fr) minmax(0, 1.55fr)", gap: 16, alignItems: "start" }}>

            {/* Work details — narrower side card */}
            <div style={subCard}>
              <div style={innerHead}>{t.jobDetails}</div>
              <div style={{ padding: "6px 16px 12px" }}>
                {detailRow(t.project, <span style={{ fontSize: 12.5, fontWeight: 700, color: TEXT }}>{work.project}</span>)}
                {detailRow(t.workType, <PillGroup value={work.workType} options={WORK_TYPES} labelFor={o => wtLabel(o, lang)} onChange={v => onChange({ workType: v })} />)}
                {detailRow(t.status, <PillGroup value={work.status} options={STATUS_OPTIONS} colorFor={o => STATUS_COLOR[o]} labelFor={o => statusLabel(o, lang)} onChange={v => onChange({ status: v })} />)}
                {detailRow(t.startDate, <span style={{ fontSize: 12.5, fontWeight: 700, color: TEXT }}>{work.startDate}</span>)}
                {detailRow(t.deadline, <span style={{ fontSize: 12.5, fontWeight: 700, color: TEXT }}>{work.deadline}</span>)}
                {detailRow(t.agreedPrice, <PriceInput value={work.price} currency={work.currency} onCommit={n => { onChange({ price: n }); notify(t.priceSaved); }} onInvalid={() => notify(t.priceInvalid)} />)}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minHeight: 44, padding: "8px 0" }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: MUTED }}>{t.payment}</span>
                  <PayChip pay={work.pay} lang={lang} />
                </div>
                {/* Danger zone — delete this job (subtle, full-width) */}
                <div style={{ paddingTop: 14, marginTop: 4, borderTop: `1px solid ${BDR}` }}>
                  <button
                    onClick={() => setConfirmOpen(true)}
                    onMouseEnter={e => { e.currentTarget.style.background = `${RED}12`; e.currentTarget.style.borderColor = `${RED}80`; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = `${RED}44`; }}
                    style={{ width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, fontSize: 12.5, fontWeight: 700, padding: "9px 14px", borderRadius: 10, background: "transparent", border: `1px solid ${RED}44`, color: RED, cursor: "pointer", fontFamily: "inherit", transition: "all .12s" }}
                  >🗑 {t.deleteWork}</button>
                </div>
              </div>
            </div>

            {/* Mix instructions — wide, central work area, backed by real notes */}
            <div style={subCard}>
              <div style={{ padding: "13px 16px", borderBottom: `1px solid ${BDR}` }}>
                <div style={{ fontSize: 14.5, fontWeight: 800, color: TEXT }}>🎚 {t.mixInstructions}</div>
                <div style={{ fontSize: 11.5, color: MUTED, marginTop: 3 }}>{t.mixInstructionsSub}</div>
              </div>
              <div style={{ padding: "14px 16px" }}>
                <NotesEditor
                  value={work.notes}
                  placeholder={t.mixInstructionsPh}
                  saveLabel={t.saveInstructions}
                  onSave={v => { onChange({ notes: v }); notify(t.instructionsSaved); }}
                />
              </div>
            </div>
          </div>

          {/* MIDDLE: Mix versions — real upload + table (metadata in mix_versions only) */}
          <div style={subCard}>
            <div style={{ ...innerHead, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <span>🎵 {t.mixVersions}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {work.filesLink && (
                  <a href={work.filesLink} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, fontWeight: 700, padding: "5px 11px", borderRadius: 8, background: "rgba(0,98,238,0.12)", border: "1px solid rgba(0,98,238,0.3)", color: "#4A9EFF", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", textDecoration: "none" }}>{t.openInDropbox}</a>
                )}
                <button
                  onClick={() => { if (!uploading) versionInputRef.current?.click(); }}
                  disabled={uploading}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 800, padding: "6px 12px", borderRadius: 8, background: `${BRAND}16`, border: `1px solid ${BRAND}45`, color: BRAND, cursor: uploading ? "default" : "pointer", fontFamily: "inherit", whiteSpace: "nowrap", opacity: uploading ? 0.6 : 1 }}
                >{t.uploadVersion}</button>
              </div>
            </div>

            <input ref={versionInputRef} type="file" accept=".wav,.mp3,.m4a,.aiff,.aif,.flac,.ogg,.zip" style={{ display: "none" }} onChange={e => uploadVersionFile(e.target.files)} />

            {/* Upload zone: optional label + drag & drop / click */}
            <div style={{ padding: "14px 16px 8px", display: "flex", flexDirection: "column", gap: 10 }}>
              <input
                value={uploadLabel}
                onChange={e => setUploadLabel(e.target.value)}
                placeholder={t.vLabelPh}
                style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 10, background: CARD, color: TEXT, border: `1px solid ${BDR2}`, fontSize: 12.5, fontFamily: "inherit", outline: "none" }}
              />
              <div
                onClick={() => { if (!uploading) versionInputRef.current?.click(); }}
                onDragOver={e => { e.preventDefault(); if (!uploading && !drag) setDrag(true); }}
                onDragLeave={e => { e.preventDefault(); setDrag(false); }}
                onDrop={e => { e.preventDefault(); setDrag(false); if (!uploading) uploadVersionFile(e.dataTransfer.files); }}
                style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 5, textAlign: "center", padding: "20px 16px", borderRadius: 12, cursor: uploading ? "default" : "pointer", border: `2px dashed ${drag ? BRAND : BDR2}`, background: drag ? `${BRAND}12` : "rgba(255,255,255,0.015)", transition: "all .15s" }}
              >
                <div style={{ fontSize: 24, opacity: 0.85, color: drag ? BRAND : TEXT2 }}>☁️</div>
                <div style={{ fontSize: 13, fontWeight: 800, color: uploading ? BRAND : TEXT }}>{uploading ? t.vUploading : t.vChooseFile}</div>
                <div style={{ fontSize: 10.5, color: MUTED }}>{t.vFileHint}</div>
              </div>
            </div>

            {/* List / empty / loading */}
            {vLoadErr ? (
              <div style={{ padding: "8px 16px 18px", fontSize: 12.5, color: RED }}>{t.vLoadFailed}</div>
            ) : versions === null ? (
              <div style={{ padding: "8px 16px 18px", fontSize: 12.5, color: MUTED }}>{t.vLoading}</div>
            ) : versions.length === 0 ? (
              <div style={{ padding: "4px 16px 20px", fontSize: 12.5, color: MUTED, textAlign: "center" }}>{t.vEmpty}</div>
            ) : (
              <div style={{ padding: "2px 12px 14px", overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
                  <thead>
                    <tr>
                      {[t.vColVersion, t.vColFile, t.vColType, t.vColSize, t.vColDate, t.vColStatus, t.vColActions].map(h => (
                        <th key={h} style={{ padding: "8px 10px", textAlign: rtl ? "right" : "left", fontSize: 10, fontWeight: 700, color: MUTED, letterSpacing: "0.04em", textTransform: "uppercase", whiteSpace: "nowrap", borderBottom: `1px solid ${BDR}` }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {versions.map(v => (
                      <tr key={v.id} style={{ borderBottom: `1px solid ${BDR}` }}>
                        <td style={{ padding: "9px 10px", fontSize: 12.5, fontWeight: 700, color: TEXT, whiteSpace: "nowrap" }}>{v.label}</td>
                        <td style={{ padding: "9px 10px", fontSize: 12, color: TEXT2, maxWidth: 190, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.fileName}</td>
                        <td style={{ padding: "9px 10px", fontSize: 11.5, color: TEXT2, whiteSpace: "nowrap" }}>{(v.fileType || "—").toUpperCase()}</td>
                        <td style={{ padding: "9px 10px", fontSize: 12, color: TEXT2, whiteSpace: "nowrap", direction: "ltr", textAlign: rtl ? "right" : "left" }}>{fmtBytes(v.fileSize)}</td>
                        <td style={{ padding: "9px 10px", fontSize: 11.5, color: MUTED, whiteSpace: "nowrap", direction: "ltr", textAlign: rtl ? "right" : "left" }}>{fmtDateTime(v.uploadedAt)}</td>
                        <td style={{ padding: "9px 10px" }}>
                          <InlineSelect<string>
                            value={v.status}
                            display={vStatusLabel(v.status, lang)}
                            color={vStatusColor(v.status)}
                            options={VSTATUS_OPTIONS.map(s => ({ value: s as string, label: vStatusLabel(s, lang), color: VSTATUS_COLOR[s] }))}
                            onChange={s => setVersionStatus(v, s)}
                          />
                        </td>
                        <td style={{ padding: "9px 10px" }}>
                          <button onClick={() => setDelVersion(v)} title={t.vDelYes}
                            style={{ background: "none", border: "none", color: "#7A4A4A", fontSize: 14, cursor: "pointer" }}
                            onMouseEnter={e => (e.currentTarget.style.color = RED)} onMouseLeave={e => (e.currentTarget.style.color = "#7A4A4A")}>🗑</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* BOTTOM: Player + time-stamped comments — coming in phase 2 (real DB) */}
          <div style={subCard}>
            <div style={innerHead}>💬 {t.playerSection}</div>
            <EmptyZone icon="🎧" title={t.playerEmptyTitle} subtitle={t.playerEmpty} />
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

        {/* Delete-version confirmation */}
        {delVersion && (
          <div onClick={() => setDelVersion(null)} style={{ position: "fixed", inset: 0, zIndex: 100002, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
            <div onClick={e => e.stopPropagation()} dir={rtl ? "rtl" : "ltr"} style={{ background: CARD, border: `1px solid ${RED}44`, borderRadius: 16, width: "min(420px, 92vw)", padding: "22px 24px", boxShadow: "0 24px 80px rgba(0,0,0,0.9)", fontFamily: "'Heebo', Arial, sans-serif" }}>
              <div style={{ fontSize: 16, fontWeight: 900, color: TEXT, marginBottom: 10 }}>{t.vDelTitle}</div>
              <div style={{ fontSize: 13, color: TEXT2, lineHeight: 1.6, marginBottom: 8 }}>{t.vDelBody}</div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: TEXT, marginBottom: 16, direction: "ltr", textAlign: rtl ? "right" : "left" }}>{delVersion.label} · {delVersion.fileName}</div>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => setDelVersion(null)} style={{ ...ghostBtn, flex: 1, justifyContent: "center" }}>{t.confirmNo}</button>
                <button onClick={confirmDeleteVersion} style={{ flex: 1, padding: "10px 18px", borderRadius: 10, background: RED, border: "none", color: "#fff", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>🗑 {t.vDelYes}</button>
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
type ProjOpt = { id: string; name: string; artist: string };
function NewWorkModal({ onClose, onCreated, lang, t }: { onClose: () => void; onCreated: () => void; lang: Lang; t: T }) {
  const [mode, setMode]           = useState<"linked" | "standalone">("linked");
  const [projects, setProjects]   = useState<ProjOpt[]>([]);
  const [projectId, setProjectId] = useState("");
  const [workTitle, setWorkTitle] = useState("");
  const [workType, setWorkType] = useState<WorkType>("מיקס מאסטרינג");
  const [status, setStatus]     = useState<WorkStatus>("פעיל");
  const [startDate, setStartDate] = useState(() => isoDay(0));
  const [deadline, setDeadline] = useState(() => isoDay(3));
  const [price, setPrice]       = useState("200");
  const [pay, setPay]           = useState<PayStatus>("לא שולם");
  const [err, setErr]           = useState<string | null>(null);
  const [saving, setSaving]     = useState(false);
  const rtl = lang === "he";

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  // Existing projects for the "linked" mode picker (owner-only endpoint). Never
  // creates a projects row — a standalone work carries its own free-text title.
  useEffect(() => {
    let alive = true;
    fetch("/api/projects")
      .then(r => (r.ok ? r.json() : []))
      .then((arr: ProjOpt[]) => { if (alive && Array.isArray(arr)) setProjects(arr.map(p => ({ id: p.id, name: p.name, artist: p.artist }))); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // Persist to sound_engineer_work via the existing API, then let the parent
  // refetch from the SERVER (no local phantom). engineer is always Steven; no
  // Finance sync; never creates a project; never touches Viktor's vendor_project_work.
  async function save() {
    if (saving) return;
    if (mode === "linked" && !projectId) { setErr(rtl ? "יש לבחור פרויקט קיים" : "Please select an existing project"); return; }
    if (mode === "standalone" && !workTitle.trim()) { setErr(rtl ? "יש להזין שם עבודה" : "Please enter a work name"); return; }
    setErr(null); setSaving(true);
    try {
      const res = await fetch("/api/sound-engineer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId:        mode === "linked" ? projectId : null,
          workTitle:        mode === "standalone" ? workTitle.trim() : null,
          engineerName:     "Steven",
          workType:         uiWorkTypeToDb(workType),
          status:           uiStatusToDb(status),
          agreedPrice:      Number(price) || 0,
          amountPaid:       pay === "שולם" ? (Number(price) || 0) : 0,
          sentDate:         startDate.trim() || null,
          internalDeadline: deadline.trim() || null,
          skipFinanceSync:  true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) { setErr((data as { error?: string }).error || (rtl ? "השמירה נכשלה" : "Save failed")); setSaving(false); return; }
      onCreated();
      onClose();
    } catch {
      setErr(rtl ? "השמירה נכשלה" : "Save failed");
      setSaving(false);
    }
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
          {/* mode: link to an existing project OR a standalone (project-less) work */}
          <div style={{ display: "flex", gap: 6, background: CARD2, border: `1px solid ${BDR2}`, borderRadius: 12, padding: 4 }}>
            {([["linked", rtl ? "קישור לפרויקט קיים" : "Link to project"], ["standalone", rtl ? "עבודה עצמאית" : "Standalone"]] as const).map(([m, lbl]) => {
              const active = mode === m;
              return (
                <button key={m} type="button" onClick={() => { setMode(m); setErr(null); }} style={{
                  flex: 1, padding: "8px 0", borderRadius: 9, border: "none", cursor: "pointer", fontFamily: "inherit",
                  fontSize: 12.5, fontWeight: 800, background: active ? BRAND : "transparent", color: active ? "#fff" : TEXT2,
                }}>{lbl}</button>
              );
            })}
          </div>

          {mode === "linked"
            ? row(t.project, (
                <select
                  value={projectId}
                  onChange={e => setProjectId(e.target.value)}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${BDR2}`, background: CARD2, color: TEXT, fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box", colorScheme: "dark", cursor: "pointer" }}
                >
                  <option value="">{rtl ? "בחר פרויקט…" : "Select a project…"}</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.name}{p.artist ? ` — ${p.artist}` : ""}</option>
                  ))}
                </select>
              ))
            : row(rtl ? "שם העבודה" : "Work name", (
                <StyledInput value={workTitle} onChange={setWorkTitle} placeholder={rtl ? "לדוגמה: מיקס לסינגל" : "e.g. Mix for a single"} />
              ))}
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
          <button onClick={save} disabled={saving} style={{ flex: 1, padding: "10px 18px", borderRadius: 10, background: BRAND, border: "none", color: "#fff", fontSize: 13, fontWeight: 800, cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1, fontFamily: "inherit", boxShadow: "0 2px 14px rgba(220,38,38,0.4)" }}>{saving ? "…" : t.save}</button>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modal, document.body) : null;
}
