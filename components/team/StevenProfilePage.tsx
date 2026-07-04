"use client";

import { useState, useRef, useEffect, useCallback, useMemo, forwardRef, useImperativeHandle } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import type { SoundEngineerWork, MixVersion, MixComment } from "@/lib/types";

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

// Dropbox is an App-Folder-scoped app, so every dropboxPath ("/Projects/…") is
// RELATIVE to the app folder. In the owner's own Dropbox that app folder lives
// under this prefix. We use it only to build a plain web deep-link
// (https://www.dropbox.com/home/<full path>) that opens the folder for the
// logged-in owner — NO API call, NO token, NO shared link is created. If the
// folder doesn't open at the right place, this single string is the only thing
// to adjust (e.g. localized "Apps", or a different app-folder name).
const DROPBOX_APP_ROOT = "/Apps/redbloods-records";

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

// ── File role (mix / acapella / instrumental) — detected from the FILENAME only
//    (no DB). A "logical version" groups the files that share a base label so up
//    to 3 players stack under one version and share one comment thread. ─────────
type FileRole = "mix" | "acapella" | "instrumental" | "stems";
const ROLE_ORDER: FileRole[] = ["mix", "acapella", "instrumental", "stems"];
const ROLE_COLOR: Record<FileRole, string> = { mix: "#DC2626", acapella: "#A855F7", instrumental: "#3B82F6", stems: "#F59E0B" };
const ROLE_LABEL: Record<FileRole, { he: string; en: string }> = {
  mix:          { he: "מיקס",        en: "Mix" },
  acapella:     { he: "אקפלה",       en: "Acapella" },
  instrumental: { he: "אינסטרומנטל", en: "Instrumental" },
  stems:        { he: "ערוצים",      en: "Stems" },
};
const roleLabel = (r: FileRole, lang: Lang) => (lang === "en" ? ROLE_LABEL[r].en : ROLE_LABEL[r].he);
/** Audio files get a player; archives (stems/zip/rar) are download-only rows. */
const isAudioName = (n: string) => /\.(wav|mp3|m4a|aiff?|flac|ogg|aac|opus)$/i.test(n || "");

function detectRole(name: string): FileRole {
  const s = (name || "").toLowerCase();
  if (/(\.(zip|rar|7z)$|stems|ערוצים)/.test(s)) return "stems";
  if (/(instrumental|\binst\b|\bbeat\b|karaoke|אינסטרומנטל|אינסטרו|ביט)/.test(s)) return "instrumental";
  if (/(acapella|accapella|acappella|acapela|\bvocals?\b|\bvox\b|אקפלה|אקאפלה|אקפלת|ווקאל|וקאל|שירה)/.test(s)) return "acapella";
  return "mix";
}

// Display role — read from the role written into the stored name (the user's pick
// wins; the original filename is no longer stored). Handles every historical
// format:
//   OLD "… - {RoleEn} - {original}"  → earliest explicit " - Role - " segment.
//   a574bb6 "… - {RoleEn}[ n]"       → trailing " - Role".
//   NEW space "{proj} {label}[ {RoleEn}][ n]" → trailing " Role" (zip/rar → stems).
//   02823c9 Hebrew role word / plain mix → Hebrew match, else default mix.
function roleOfFile(name: string): FileRole {
  const n = name || "";
  const noExt = n.replace(/\.[^.]+$/, "");
  const low = noExt.toLowerCase();
  // 1) middle " - Role - " (earliest wins over a role word in a trailing original name)
  const segs: [FileRole, string][] = [
    ["mix", " - mix - "], ["acapella", " - acapella - "],
    ["instrumental", " - instrumental - "], ["stems", " - stems - "],
  ];
  let bestIdx = Infinity;
  let bestRole: FileRole | null = null;
  for (const [role, seg] of segs) { const i = low.indexOf(seg); if (i >= 0 && i < bestIdx) { bestIdx = i; bestRole = role; } }
  if (bestRole) return bestRole;
  // 2) trailing role, either " - Role" (old clean) or " Role" (new space format)
  if (/\.(zip|rar|7z)$/i.test(n)) return "stems";
  const tail = noExt.match(/[ ](?:- )?(mix|acapella|instrumental|stems)(?: \d+)?$/i);
  if (tail) return tail[1].toLowerCase() as FileRole;
  // 3) Hebrew role words (older files)
  if (/אקפלה|אקאפלה|ווקאל|וקאל|שירה/.test(n)) return "acapella";
  if (/אינסטרומנטל|אינסטרו|ביט/.test(n)) return "instrumental";
  if (/ערוצים/.test(n)) return "stems";
  return "mix";
}

// Clean display name shown in the UI (player title, file rows) — built from the
// VIEWER-facing project name + version label + role. The role word is ALWAYS
// English (Mix/Acapella/Instrumental/Stems) even in the Hebrew owner view, and a
// plain mix shows no role word. NEVER the stored Dropbox/original filename.
function fileDisplayName(project: string, label: string, role: FileRole): string {
  const rl = role === "mix" ? "" : ROLE_LABEL[role].en;
  return [project, label, rl].filter(Boolean).join(" ");
}

type RoledVersion = MixVersion & { role: FileRole };
type VersionGroup = { key: string; label: string; files: RoledVersion[]; primary: RoledVersion; latestAt: string };

// Strip a trailing role qualifier so "Mix 1 (acapella)" groups with "Mix 1".
function baseVersionKey(label: string): string {
  return (label || "")
    .replace(/[\s\-_()·|]*\b(acapella|accapella|acappella|acapela|vocals?|vox|instrumental|inst|beat)\b[\s\-_()·|]*$/i, "")
    .trim() || label;
}

// Group flat mix_versions rows into logical versions (code-only, no DB). Existing
// data has unique labels → each becomes a group of one (a single "mix" player).
function groupVersions(versions: MixVersion[]): VersionGroup[] {
  const map = new Map<string, VersionGroup>();
  for (const v of versions) {
    const rv: RoledVersion = { ...v, role: roleOfFile(v.fileName || v.label) };
    const key = baseVersionKey(v.label) || v.id;
    let g = map.get(key);
    if (!g) { g = { key, label: baseVersionKey(v.label) || v.label, files: [], primary: rv, latestAt: rv.createdAt }; map.set(key, g); }
    g.files.push(rv);
    if (rv.createdAt > g.latestAt) g.latestAt = rv.createdAt;
  }
  const groups = [...map.values()].map(g => {
    g.files.sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
    // Primary (holds the shared comment thread) = the mix, else any audio file,
    // else the first file. Keeps comments on a stable, playable file.
    g.primary = g.files.find(f => f.role === "mix")
      ?? g.files.find(f => isAudioName(f.fileName))
      ?? g.files[0];
    return g;
  });
  groups.sort((a, b) => (a.latestAt < b.latestAt ? 1 : -1)); // newest first
  return groups;
}

// A single active <audio> across all stacked players — starting one pauses others.
let activeStevenAudio: HTMLAudioElement | null = null;

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
/** Seconds → "M:SS". */
function fmtTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}
/** Strip a legacy "{id}-" prefix from an auto-generated label/name (display only). */
const stripId = (s: string, id: string) => (s.startsWith(`${id}-`) ? s.slice(id.length + 1) : s);
/** Relative "time ago" for a comment's created_at. */
function fmtRelative(iso: string, lang: Lang): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const m = Math.floor(Math.max(0, Date.now() - then) / 60000);
  if (m < 1)  return lang === "en" ? "just now" : "עכשיו";
  if (m < 60) return lang === "en" ? `${m}m ago` : `לפני ${m} דק׳`;
  const h = Math.floor(m / 60);
  if (h < 24) return lang === "en" ? `${h}h ago` : `לפני ${h} שע׳`;
  const d = Math.floor(h / 24);
  return lang === "en" ? `${d}d ago` : `לפני ${d} ימים`;
}
/** Cycling accent colors for comment index badges. */
const COMMENT_COLORS = ["#EF4444", "#A855F7", "#F59E0B", "#3B82F6", "#10B981"];

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
    mixVersions: "גרסאות למיקס", versionsEmptyTitle: "עדיין אין גרסאות מיקס", mixVersionsEmpty: "גרסאות המיקס (Mix 1, Mix 2...) יתווספו כאן בהמשך", openInDropbox: "📦 פתח תיקיית Dropbox", openMixFolder: "📦 פתח ב-Dropbox", vFolderPending: "התיקייה תיווצר אחרי העלאת גרסה ראשונה", vFolderOpenFail: "לא ניתן לפתוח את תיקיית Dropbox", noFilesLink: "אין עדיין תיקיית Dropbox מקושרת לעבודה זו",
    uploadVersion: "+ העלה גרסה / קובץ עבודה", phase2Tag: "פאזה 2", uploadComing: "העלאת גרסאות אמיתית ל-Dropbox תתווסף בפאזה הבאה",
    vLabelPh: "שם גרסה, למשל Mix 1", vChooseFile: "בחר קובץ", vFileHint: "WAV / MP3 / AIFF / M4A / FLAC / ZIP",
    vUploading: "מעלה קובץ…", vUploaded: "הגרסה הועלתה", vUploadFailed: "העלאת הגרסה נכשלה", vDeleted: "הגרסה נמחקה", vLoadFailed: "טעינת הגרסאות נכשלה",
    vLoading: "טוען גרסאות…", vEmpty: "עדיין אין גרסאות — העלה קובץ ראשון עם הכפתור למעלה",
    vSelectToPlay: "בחר גרסה מהרשימה כדי לנגן", vAudioLoading: "טוען קובץ…", vAudioError: "טעינת הקובץ נכשלה", vPlay: "נגן",
    pNoVersionsTitle: "עדיין אין גרסאות לניגון", pNoVersionsSub: "העלה גרסה ראשונה כדי להפעיל את הנגן", detailsAndInstructions: "פרטי עבודה והוראות למיקס",
    vColVersion: "שם גרסה", vColFile: "קובץ", vColType: "סוג", vColSize: "גודל", vColDate: "הועלה", vColStatus: "סטטוס", vColActions: "פעולות",
    vDelTitle: "למחוק את הגרסה?", vDelBody: "הקובץ יימחק מ-Dropbox ומהרשימה. פעולה בלתי הפיכה.", vDelYes: "מחק גרסה", vDownload: "הורדה",
    cSection: "הערות בזמן", cAdd: "הוסף הערה", cEmpty: "אין הערות לגרסה הזו עדיין", cPlaceholder: "כתוב הערה על הנקודה הזו…", cAtTime: "בזמן",
    cLoading: "טוען הערות…", cLoadFail: "טעינת ההערות נכשלה", cEdit: "ערוך", cDelete: "מחק", cDelTitle: "למחוק את ההערה?", cDelBody: "ההערה תוסר לצמיתות.",
    playerSection: "נגן והערות", playerEmptyTitle: "נגן והערות יתווספו בקרוב", playerEmpty: "נגן והערות לפי נקודות זמן בשיר יתווספו בקרוב",
    versionsForProject: "גרסאות לפרויקט", uploadFiles: "העלאת קבצים", projectFiles: "קבצי הפרויקט",
    uploadNewVersionBtn: "+ העלה גרסה חדשה", addToVersionBtn: "+ הוסף קובץ לגרסה הזו",
    uploadHint: "גרור קבצים לכאן · נגן = mp3/wav · ערוצים = zip/rar",
    rpTitle: "בחר סוג לכל קובץ", rpSubNew: "גרסה חדשה", rpSubExisting: "מוסיף לגרסה",
    rpHint: "מיקס/אקפלה/אינסטרומנטל = נגן · ערוצים = הורדה בלבד", rpUpload: "העלה",
    versionFiles: "קבצי הגרסה", versionFilesSub: "מסומנים בזמן אמת — הערות משותפות לגרסה זו",
    sharedComments: "הערות משותפות לגרסה", sharedCommentsSub: "ההערות משותפות לכל שלושת הקבצים",
    versionDetails: "פרטי הגרסה", vName: "שם הגרסה", vCreator: "יוצר", vCreatedAt: "נוצר בתאריך", vUpdatedAt: "עודכן לאחרונה",
    vFileCount: "קבצים בגרסה", vTotalSize: "גודל כולל", markApproved: "סמן גרסה לאישור", headerUpdated: "עודכן לאחרונה בגרסה",
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
    mixVersions: "Mix Versions", versionsEmptyTitle: "No mix versions yet", mixVersionsEmpty: "Mix versions (Mix 1, Mix 2...) will appear here", openInDropbox: "📦 Open Dropbox folder", openMixFolder: "📦 Open in Dropbox", vFolderPending: "The folder is created after the first version upload", vFolderOpenFail: "Couldn't open the Dropbox folder", noFilesLink: "No Dropbox folder linked to this job yet",
    uploadVersion: "+ Upload version / work file", phase2Tag: "Phase 2", uploadComing: "Real Dropbox version upload is coming in the next phase",
    vLabelPh: "Version name, e.g. Mix 1", vChooseFile: "Choose file", vFileHint: "WAV / MP3 / AIFF / M4A / FLAC / ZIP",
    vUploading: "Uploading…", vUploaded: "Version uploaded", vUploadFailed: "Version upload failed", vDeleted: "Version deleted", vLoadFailed: "Failed to load versions",
    vLoading: "Loading versions…", vEmpty: "No versions yet — upload the first file with the button above",
    vSelectToPlay: "Select a version to play", vAudioLoading: "Loading file…", vAudioError: "Failed to load the file", vPlay: "Play",
    pNoVersionsTitle: "No versions to play yet", pNoVersionsSub: "Upload the first version to start the player", detailsAndInstructions: "Job details & mix instructions",
    vColVersion: "Version", vColFile: "File", vColType: "Type", vColSize: "Size", vColDate: "Uploaded", vColStatus: "Status", vColActions: "Actions",
    vDelTitle: "Delete this version?", vDelBody: "The file will be removed from Dropbox and the list. This cannot be undone.", vDelYes: "Delete version", vDownload: "Download",
    cSection: "Timestamp comments", cAdd: "Add comment", cEmpty: "No comments on this version yet", cPlaceholder: "Write a note about this point…", cAtTime: "at",
    cLoading: "Loading comments…", cLoadFail: "Failed to load comments", cEdit: "Edit", cDelete: "Delete", cDelTitle: "Delete this comment?", cDelBody: "The comment will be permanently removed.",
    playerSection: "Player & Comments", playerEmptyTitle: "Player & comments coming soon", playerEmpty: "A player and time-stamped comments will be added soon",
    versionsForProject: "Project versions", uploadFiles: "Upload files", projectFiles: "Project files",
    uploadNewVersionBtn: "+ Upload new version", addToVersionBtn: "+ Add file to this version",
    uploadHint: "Drag files here · player = mp3/wav · stems = zip/rar",
    rpTitle: "Choose a type for each file", rpSubNew: "New version", rpSubExisting: "Adding to",
    rpHint: "Mix/Acapella/Instrumental = player · Stems = download only", rpUpload: "Upload",
    versionFiles: "Version files", versionFilesSub: "Marked in real time — comments are shared for this version",
    sharedComments: "Shared comments for this version", sharedCommentsSub: "Comments are shared across all three files",
    versionDetails: "Version details", vName: "Version name", vCreator: "Creator", vCreatedAt: "Created", vUpdatedAt: "Last updated",
    vFileCount: "Files in version", vTotalSize: "Total size", markApproved: "Mark version for approval", headerUpdated: "Version last updated",
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
        rows={4}
        style={{
          width: "100%", boxSizing: "border-box", resize: "vertical", minHeight: 96,
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
  const [loading, setLoading] = useState(true); // initial page load only — never re-armed after create
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
    finally { setLoading(false); }
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
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} style={{ background: CARD, border: `1px solid ${BDR2}`, borderRadius: 16, padding: "18px 20px 16px", minWidth: 0 }}>
                <Shimmer w="62%" h={10} r={5} style={{ marginBottom: 13 }} />
                <Shimmer w={64} h={30} r={8} />
              </div>
            ))
          ) : (
            <>
              <KpiCard label={t.kpiOpen}      value={open}         icon="📁" />
              <KpiCard label={t.kpiActive}    value={active}       icon="🎚" color={GREEN} />
              <KpiCard label={t.kpiDone}      value={done}         icon="✔" color={BLUE} />
              <KpiCard label={t.kpiDebt}      value={fmt(debt)}    icon="👛" color={BRAND} />
              <KpiCard label={t.kpiPaidMonth} value={fmt(paidSum)} icon="💳" color={GREEN} />
            </>
          )}
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
                  {loading ? (
                    Array.from({ length: 4 }).map((_, i) => (
                      <tr key={i} style={{ borderTop: `1px solid ${BDR}` }}>
                        <td colSpan={8} style={{ padding: "0 14px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 20, height: 45 }}>
                            <Shimmer w={140} h={13} /><Shimmer w={88} h={12} /><Shimmer w={64} h={22} r={999} />
                            <Shimmer w={62} h={12} /><Shimmer w={62} h={12} /><Shimmer w={50} h={12} />
                            <Shimmer w={64} h={22} r={999} /><div style={{ flex: 1 }} /><Shimmer w={70} h={24} r={10} />
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : works.length === 0 ? (
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
              {loading
                ? <RowsSkeleton rows={3} height={38} pad="14px 18px" />
                : <div style={{ padding: "28px 16px", textAlign: "center", fontSize: 12.5, color: MUTED }}>{t.noPayments}</div>}
            </div>
            <div style={sectionCard}>
              <div style={cardHead}>{t.recentFiles}</div>
              {loading
                ? <RowsSkeleton rows={3} height={38} pad="14px 18px" />
                : <div style={{ padding: "28px 16px", textAlign: "center", fontSize: 12.5, color: MUTED }}>{t.noRecentFiles}</div>}
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

// ── Loading skeletons (dark premium, subtle shimmer) — keep the modal's height
//    stable so nothing jumps when real data swaps in. Reuse global skeleton-sweep.
function Shimmer({ w, h = 12, r = 7, style }: { w: number | string; h?: number; r?: number; style?: React.CSSProperties }) {
  return (
    <div style={{ width: w, height: h, borderRadius: r, background: "rgba(255,255,255,0.05)", position: "relative", overflow: "hidden", flexShrink: 0, ...style }}>
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.08) 50%, transparent 100%)", animation: "skeleton-sweep 1.6s ease-in-out infinite" }} />
    </div>
  );
}
// Player placeholder — mirrors VersionPlayer's shape (title · waveform · transport).
function PlayerSkeleton() {
  const bars = Array.from({ length: 76 }, (_, i) => 0.2 + 0.8 * Math.abs(Math.sin(i * 0.7) * 0.6 + Math.sin(i * 0.23 + 1) * 0.4));
  return (
    <div style={{ padding: "18px 20px 20px" }}>
      <div style={{ marginBottom: 16 }}><Shimmer w={170} h={19} r={6} /></div>
      <div style={{ position: "relative", marginTop: 14, overflow: "hidden", borderRadius: 4 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 84 }}>
          {bars.map((h, i) => <div key={i} style={{ flex: 1, minWidth: 2, height: `${Math.round(h * 100)}%`, borderRadius: 2, background: "rgba(255,255,255,0.06)" }} />)}
        </div>
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.07) 50%, transparent 100%)", animation: "skeleton-sweep 1.6s ease-in-out infinite", pointerEvents: "none" }} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16 }}>
        <Shimmer w={82} h={12} />
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}>
          <Shimmer w={38} h={38} r={19} /><Shimmer w={38} h={38} r={19} /><Shimmer w={58} h={58} r={29} /><Shimmer w={38} h={38} r={19} />
        </div>
        <Shimmer w={82} h={12} />
      </div>
    </div>
  );
}
// A few placeholder rows (comments / versions list).
function RowsSkeleton({ rows, height, pad }: { rows: number; height: number; pad: string }) {
  return (
    <div style={{ padding: pad, display: "flex", flexDirection: "column", gap: 7 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, height, padding: "0 4px" }}>
          <Shimmer w={23} h={23} r={999} />
          <Shimmer w={`${55 - i * 8}%`} h={12} />
          <div style={{ flex: 1 }} />
          <Shimmer w={40} h={11} />
        </div>
      ))}
    </div>
  );
}

// ── Local mix-version player (premium dark card) — never touches the global
//    project player; streams the selected version via /api/dropbox/stream. ────────
type VersionPlayerHandle = {
  getCurrentTime: () => number;
  seek: (sec: number) => void;
  playFrom: (sec: number) => void;
};
const VersionPlayer = forwardRef<VersionPlayerHandle, {
  url: string; title: string; roleLabel: string; roleColor: string; compact?: boolean;
  shouldPlay: number; comments: MixComment[]; onDownload?: () => void; t: T;
}>(
function VersionPlayer({ url, title, roleLabel, roleColor, compact = false, shouldPlay, comments, onDownload, t }, ref) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const barRef   = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying]   = useState(false);
  const [cur, setCur]           = useState(0);
  const [dur, setDur]           = useState(0);
  const [loading, setLoading]   = useState(true);
  const [err, setErr]           = useState(false);
  const [dragging, setDragging] = useState(false);
  const [vol, setVol]           = useState(1);
  const [hoveredC, setHoveredC] = useState<string | null>(null); // marker under cursor
  const [pinnedC, setPinnedC]   = useState<string | null>(null); // marker clicked → bubble stays open

  const pct = dur > 0 ? Math.min(100, (cur / dur) * 100) : 0;

  // Decorative waveform bars — a static visual motif, NOT real audio analysis.
  const bars = useMemo(() => Array.from({ length: 76 }, (_, i) =>
    0.2 + 0.8 * Math.abs(Math.sin(i * 0.7) * 0.6 + Math.sin(i * 0.23 + 1) * 0.4)
  ), []);
  const playedBars = Math.round((pct / 100) * bars.length);

  // Start playback while pausing any other stacked player (single active audio).
  function startPlay(a: HTMLAudioElement) {
    if (activeStevenAudio && activeStevenAudio !== a) activeStevenAudio.pause();
    activeStevenAudio = a;
    a.play().catch(() => setErr(true));
  }

  useImperativeHandle(ref, () => ({
    getCurrentTime: () => audioRef.current?.currentTime ?? 0,
    seek: (sec: number) => { const a = audioRef.current; if (a) { a.currentTime = sec; setCur(sec); } },
    playFrom: (sec: number) => { const a = audioRef.current; if (!a) return; a.currentTime = sec; setCur(sec); startPlay(a); },
  }), []);

  useEffect(() => { if (shouldPlay > 0) { const a = audioRef.current; if (a) startPlay(a); } }, [shouldPlay]);
  useEffect(() => { const a = audioRef.current; return () => { a?.pause(); if (activeStevenAudio === a) activeStevenAudio = null; }; }, []);
  useEffect(() => { if (audioRef.current) audioRef.current.volume = vol; }, [vol]);

  function toggle() { const a = audioRef.current; if (!a || err) return; if (a.paused) startPlay(a); else a.pause(); }
  function seekTo(sec: number) { const a = audioRef.current; if (!a || !dur) return; const s = Math.min(dur, Math.max(0, sec)); a.currentTime = s; setCur(s); }
  function seekAt(clientX: number) { const bar = barRef.current; if (!bar || !dur) return; const rect = bar.getBoundingClientRect(); const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)); seekTo(ratio * dur); }

  const tBtn: React.CSSProperties = { width: compact ? 32 : 38, height: compact ? 32 : 38, borderRadius: "50%", flexShrink: 0, background: "rgba(255,255,255,0.05)", border: `1px solid ${BDR2}`, color: TEXT2, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit" };
  const waveH = compact ? 52 : 84;
  const bigBtn = compact ? 46 : 58;

  return (
    <div style={{ padding: compact ? "12px 15px 14px" : "16px 18px 18px", background: CARD2, border: `1px solid ${BDR}`, borderInlineStart: `3px solid ${roleColor}`, borderRadius: 14 }}>
      <audio
        ref={audioRef} src={url} preload="metadata"
        onLoadedMetadata={e => { setDur(e.currentTarget.duration || 0); setLoading(false); }}
        onCanPlay={() => setLoading(false)}
        onTimeUpdate={e => setCur(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => { setErr(true); setLoading(false); }}
      />

      {/* Header: role chip · filename · status · download */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: compact ? 9 : 12 }}>
        <span style={{ fontSize: 11, fontWeight: 900, color: "#fff", padding: "3px 11px", borderRadius: 8, background: roleColor, whiteSpace: "nowrap", flexShrink: 0 }}>{roleLabel}</span>
        <div title={title} style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, color: TEXT2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: "ltr", textAlign: "start", unicodeBidi: "plaintext" } as React.CSSProperties}>{title}</div>
        <span style={{ fontSize: 10.5, color: err ? RED : MUTED, whiteSpace: "nowrap", flexShrink: 0 }}>{err ? t.vAudioError : loading ? t.vAudioLoading : ""}</span>
        {onDownload && <button onClick={onDownload} title={t.vDownload} style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0, background: "rgba(255,255,255,0.05)", border: `1px solid ${BDR2}`, color: TEXT2, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.6l3.3-3.3L16.7 12 12 16.7 7.3 12l1.4-1.7L12 13.6V3zM5 19h14v2H5z"/></svg></button>}
      </div>

      {/* Waveform + comment markers (LTR) */}
      <div style={{ direction: "ltr", position: "relative", marginTop: 14 }}>
        <div
          ref={barRef}
          onPointerDown={e => { (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId); setDragging(true); seekAt(e.clientX); }}
          onPointerMove={e => { if (dragging) seekAt(e.clientX); }}
          onPointerUp={e => { setDragging(false); try { (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId); } catch {} }}
          style={{ display: "flex", alignItems: "flex-end", gap: 2, height: waveH, cursor: "pointer", touchAction: "none" }}
        >
          {bars.map((h, i) => (
            <div key={i} style={{ flex: 1, minWidth: 2, height: `${Math.round(h * 100)}%`, borderRadius: 2, background: i < playedBars ? `linear-gradient(180deg, #F87171, ${BRAND})` : "rgba(255,255,255,0.12)" }} />
          ))}
        </div>
        {dur > 0 && <div style={{ position: "absolute", top: -2, bottom: 0, left: `${pct}%`, width: 2, background: "#fff", opacity: 0.55, pointerEvents: "none" }} />}
        {dur > 0 && comments.map((c, i) => {
          const col  = COMMENT_COLORS[i % COMMENT_COLORS.length];
          const left = Math.min(100, Math.max(0, (c.timestampSeconds / dur) * 100));
          const show = hoveredC === c.id || pinnedC === c.id;
          return (
            <div key={c.id} style={{ position: "absolute", top: -9, left: `${left}%`, transform: "translateX(-50%)", zIndex: show ? 6 : 2 }}>
              {/* Floating comment bubble — appears on hover / when pinned; does not affect layout */}
              {show && (
                <div style={{
                  position: "absolute", bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)",
                  maxWidth: 190, padding: "5px 9px", borderRadius: 9, background: col, color: "#fff",
                  fontSize: 11, fontWeight: 700, lineHeight: 1.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  border: "1px solid rgba(255,255,255,0.22)", boxShadow: `0 7px 20px ${col}66, 0 2px 8px rgba(0,0,0,0.55)`,
                  pointerEvents: "none", unicodeBidi: "plaintext",
                }}>
                  {c.commentText}
                  {/* downward tail pointing at the marker */}
                  <span style={{ position: "absolute", top: "100%", left: "50%", transform: "translateX(-50%)", width: 0, height: 0, borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderTop: `6px solid ${col}` }} />
                </div>
              )}
              <button title={`${fmtTime(c.timestampSeconds)} · ${c.commentText}`}
                onClick={() => { seekTo(c.timestampSeconds); setPinnedC(c.id); }}
                onMouseEnter={() => setHoveredC(c.id)} onMouseLeave={() => setHoveredC(cur => (cur === c.id ? null : cur))}
                style={{ display: "block", width: 20, height: 20, borderRadius: "50%", background: col, color: "#fff", border: `2px solid ${CARD}`, fontSize: 10, fontWeight: 800, cursor: "pointer", lineHeight: "16px", textAlign: "center", boxShadow: show ? `0 0 0 3px ${col}44` : "none", transition: "box-shadow .12s ease" }}>{i + 1}</button>
            </div>
          );
        })}
      </div>

      {/* Transport: time · controls · volume */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: compact ? 10 : 16, direction: "ltr" }}>
        <span style={{ fontSize: 12, color: TEXT2, fontVariantNumeric: "tabular-nums", minWidth: 92, whiteSpace: "nowrap" }}>{fmtTime(cur)} <span style={{ color: MUTED }}>/ {fmtTime(dur)}</span></span>

        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}>
          <button onClick={() => seekTo(0)} title="Restart" style={tBtn}><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 5V1L7 6l5 5V7a5 5 0 11-5 5H5a7 7 0 107-7z"/></svg></button>
          <button onClick={() => seekTo(cur - 10)} title="-10s" style={tBtn}><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zM20 6l-9 6 9 6z"/></svg></button>
          <button onClick={toggle} disabled={err} title={playing ? "Pause" : t.vPlay}
            style={{ width: bigBtn, height: bigBtn, borderRadius: "50%", flexShrink: 0, border: "none", background: err ? "#3A3A44" : `linear-gradient(145deg, ${BRAND}, #B91C1C)`, color: "#fff", cursor: err ? "default" : "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", boxShadow: err ? "none" : `0 8px 22px ${BRAND}66` }}>
            {playing
              ? <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><rect x="6" y="5" width="4.4" height="14" rx="1.3"/><rect x="13.6" y="5" width="4.4" height="14" rx="1.3"/></svg>
              : <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff" style={{ marginInlineStart: 2 }}><path d="M8 5v14l11-7z"/></svg>}
          </button>
          <button onClick={() => seekTo(cur + 10)} title="+10s" style={tBtn}><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zM4 6l9 6-9 6z"/></svg></button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 92 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill={MUTED}><path d="M3 10v4h4l5 5V5L7 10H3zm13.5 2A4.5 4.5 0 0014 8v8a4.5 4.5 0 002.5-4z"/></svg>
          <input type="range" min={0} max={1} step={0.01} value={vol} onChange={e => setVol(Number(e.target.value))} style={{ width: 72, accentColor: BRAND, cursor: "pointer" }} />
        </div>
      </div>
    </div>
  );
});

// ── "Open Job" modal — clean workboard: instructions / versions / player ─────────
function WorkModal({ work, onChange, onDelete, onClose, notify, lang, t }: { work: Work; onChange: (patch: Partial<Work>) => void; onDelete: () => void; onClose: () => void; notify: (m: string) => void; lang: Lang; t: T }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const rtl = lang === "he";
  const narrow = useIsNarrow(760);

  // ── Mix versions (Phase 2) — real data from /api/sound-engineer/{workId}/versions
  const [versions, setVersions]   = useState<MixVersion[] | null>(null); // null = loading
  const [vLoadErr, setVLoadErr]   = useState(false);
  const [uploading, setUploading] = useState(false);
  const [drag, setDrag]           = useState(false);
  // Per-file role picker shown after files are chosen (before upload).
  const [rolePicker, setRolePicker] = useState<{ mode: "new" | "existing"; items: { file: File; role: FileRole }[] } | null>(null);
  const [delVersion, setDelVersion] = useState<MixVersion | null>(null);
  const [sel, setSel]             = useState<string | null>(null);                        // selected version id
  const [playReq, setPlayReq]     = useState<{ id: string; nonce: number } | null>(null); // explicit play request
  const newVersionInputRef = useRef<HTMLInputElement | null>(null);
  const addFileInputRef = useRef<HTMLInputElement | null>(null);

  // ── Timestamp comments for the selected version ──────────────────────────────
  const [comments, setComments]   = useState<MixComment[] | null>(null); // null = loading
  const [cLoadErr, setCLoadErr]   = useState(false);
  const [adding, setAdding]       = useState(false);
  const [addTs, setAddTs]         = useState(0);
  const [newText, setNewText]     = useState("");
  const [savingC, setSavingC]     = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText]   = useState("");
  const [delC, setDelC]           = useState<MixComment | null>(null);
  const playerRef = useRef<VersionPlayerHandle | null>(null);
  const byTs = (a: MixComment, b: MixComment) => a.timestampSeconds - b.timestampSeconds;

  // Load the selected logical version's comments (keyed on the group's primary
  // file id, so all stacked players share one thread).
  useEffect(() => {
    if (!sel) { setComments(null); return; }
    let alive = true;
    setComments(null); setCLoadErr(false); setAdding(false); setEditingId(null);
    fetch(`/api/sound-engineer/versions/${sel}/comments`)
      .then(r => r.json())
      .then(d => { if (!alive) return; if (d.ok) setComments((d.comments ?? []).slice().sort(byTs)); else setCLoadErr(true); })
      .catch(() => { if (alive) setCLoadErr(true); });
    return () => { alive = false; };
  }, [sel]);

  function openAddComment() {
    const ts = Math.max(0, Math.floor(playerRef.current?.getCurrentTime() ?? 0));
    setAddTs(ts); setNewText(""); setAdding(true);
  }
  function saveNewComment() {
    const text = newText.trim();
    if (!text || !sel || savingC) return;
    setSavingC(true);
    fetch(`/api/sound-engineer/versions/${sel}/comments`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timestampSeconds: addTs, commentText: text }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.ok && d.comment) {
          setComments(prev => [...(prev ?? []), d.comment as MixComment].sort(byTs));
          setAdding(false); setNewText("");
        } else notify(d.error || (rtl ? "שמירת ההערה נכשלה" : "Failed to save comment"));
      })
      .catch(() => notify(rtl ? "שמירת ההערה נכשלה" : "Failed to save comment"))
      .finally(() => setSavingC(false));
  }
  function saveEditComment(c: MixComment) {
    const text = editText.trim();
    if (!text) { setEditingId(null); return; }
    if (text === c.commentText) { setEditingId(null); return; }
    const prev = comments;
    setComments(cur => cur?.map(x => (x.id === c.id ? { ...x, commentText: text } : x)) ?? null);
    setEditingId(null);
    fetch(`/api/sound-engineer/comments/${c.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ commentText: text }),
    })
      .then(r => r.json())
      .then(d => { if (!d.ok) { setComments(prev); notify(rtl ? "השמירה נכשלה" : "Save failed"); } })
      .catch(() => { setComments(prev); notify(rtl ? "השמירה נכשלה" : "Save failed"); });
  }
  function confirmDeleteComment() {
    const c = delC; if (!c) return;
    setDelC(null);
    const prev = comments;
    setComments(cur => cur?.filter(x => x.id !== c.id) ?? null);
    fetch(`/api/sound-engineer/comments/${c.id}`, { method: "DELETE" })
      .then(r => r.json())
      .then(d => { if (!d.ok) { setComments(prev); notify(rtl ? "המחיקה נכשלה" : "Delete failed"); } })
      .catch(() => { setComments(prev); notify(rtl ? "המחיקה נכשלה" : "Delete failed"); });
  }

  useEffect(() => {
    let alive = true;
    setVersions(null); setVLoadErr(false);
    fetch(`/api/sound-engineer/${work.id}/versions`)
      .then(r => r.json())
      .then(d => {
        if (!alive) return;
        if (d.ok) {
          const list = (d.versions ?? []) as MixVersion[]; // server order = created_at desc → [0] is latest
          setVersions(list);
          // Auto-select the LATEST logical version (its primary file) so a player
          // is always ready and comments load for the shared thread.
          const gs = groupVersions(list);
          if (gs.length > 0) setSel(cur => (cur && list.some(v => v.id === cur) ? cur : gs[0].primary.id));
        } else setVLoadErr(true);
      })
      .catch(() => { if (alive) setVLoadErr(true); });
    return () => { alive = false; };
  }, [work.id]);

  // Upload ONE file. `label` + `addToExisting` group several files under one
  // logical version (no DB); no label → the server auto-assigns the next "Mix N".
  // `role` is the user's per-file pick → the server names the file accordingly.
  async function postOneFile(file: File, opts: { label?: string; addToExisting?: boolean; role?: FileRole }): Promise<MixVersion | null> {
    const fd = new FormData();
    fd.append("file", file);
    if (opts.label) fd.append("label", opts.label);
    if (opts.addToExisting) fd.append("addToExisting", "1");
    if (opts.role) fd.append("role", opts.role);
    try {
      const d = await fetch(`/api/sound-engineer/${work.id}/versions`, { method: "POST", body: fd }).then(r => r.json());
      if (d.ok && d.version) return d.version as MixVersion;
      notify(d.error || t.vUploadFailed);
      return null;
    } catch { notify(t.vUploadFailed); return null; }
  }

  // After files are chosen, open the per-file role picker (auto-suggested from the
  // filename; the user can change each before uploading). Nothing uploads yet.
  function openRolePicker(mode: "new" | "existing", list: FileList | null) {
    const files = list ? Array.from(list) : [];
    if (newVersionInputRef.current) newVersionInputRef.current.value = "";
    if (addFileInputRef.current) addFileInputRef.current.value = "";
    if (files.length === 0 || uploading) return;
    if (mode === "existing" && !selectedGroup) return;
    setRolePicker({ mode, items: files.map(f => ({ file: f, role: detectRole(f.name) })) });
  }

  // Confirm the picker → upload each file with its chosen role.
  async function runRolePickerUpload() {
    const picker = rolePicker;
    if (!picker || picker.items.length === 0 || uploading) return;
    setUploading(true);
    try {
      if (picker.mode === "new") {
        // First file creates the new "Mix N"; the rest join it (same label).
        const first = await postOneFile(picker.items[0].file, { role: picker.items[0].role });
        if (!first) return;
        const created = [first];
        for (let i = 1; i < picker.items.length; i++) {
          const v = await postOneFile(picker.items[i].file, { label: first.label, addToExisting: true, role: picker.items[i].role });
          if (v) created.push(v);
        }
        setVersions(prev => [...created, ...(prev ?? [])]);
        setSel(first.id);
        notify(t.vUploaded);
      } else {
        const label = selectedGroup?.label;
        if (!label) return;
        const created: MixVersion[] = [];
        for (const it of picker.items) {
          const v = await postOneFile(it.file, { label, addToExisting: true, role: it.role });
          if (v) created.push(v);
        }
        if (created.length > 0) { setVersions(prev => [...created, ...(prev ?? [])]); notify(t.vUploaded); }
      }
    } finally {
      setUploading(false);
      setRolePicker(null);
    }
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
    // Delete the whole LOGICAL version = every file in v's group (mix + acapella
    // + instrumental). For existing single-file versions this is just that file.
    const g = groups.find(x => x.files.some(f => f.id === v.id));
    const ids = g ? g.files.map(f => f.id) : [v.id];
    const idSet = new Set(ids);
    if (sel && idSet.has(sel)) {
      const restGroups = groups.filter(x => x.key !== g?.key);
      setSel(restGroups.length > 0 ? restGroups[0].primary.id : null);
    }
    const prev = versions;
    setVersions(cur => cur?.filter(x => !idSet.has(x.id)) ?? null);
    Promise.all(ids.map(id => fetch(`/api/sound-engineer/versions/${id}`, { method: "DELETE" }).then(r => r.json())))
      .then(results => { if (results.every(d => d.ok)) notify(t.vDeleted); else { setVersions(prev); notify(rtl ? "המחיקה נכשלה" : "Delete failed"); } })
      .catch(() => { setVersions(prev); notify(rtl ? "המחיקה נכשלה" : "Delete failed"); });
  }

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  // Logical versions (code-only grouping) + the selected one (matched via any of
  // its files → its primary). `sel` always holds the group's primary file id.
  const groups = useMemo(() => groupVersions(versions ?? []), [versions]);
  const selectedGroup = groups.find(g => g.files.some(f => f.id === sel)) ?? null;
  const primary = selectedGroup?.primary ?? null;

  // Mix Versions folder = the directory the versions physically live in. Every
  // version is stored DIRECTLY under it, so the parent dir of any version's
  // (app-relative) dropboxPath IS the folder. null until ≥1 version exists (the
  // folder is only created on first upload).
  const anyVer = versions && versions.length > 0 ? versions[0] : null;
  const mixFolderPath = anyVer?.dropboxPath && anyVer.dropboxPath.lastIndexOf("/") > 0
    ? anyVer.dropboxPath.slice(0, anyVer.dropboxPath.lastIndexOf("/"))
    : null;

  // Open the folder in Dropbox via a plain web deep-link — client-only, NO API,
  // NO token, NO shared link. window.open runs INSIDE the click gesture with a
  // real URL, so there's no pre-opened blank tab and no popup-blocker race; a
  // blocked open just toasts.
  function openMixFolder() {
    if (!mixFolderPath) return;
    const url = "https://www.dropbox.com/home" + encodeURI(DROPBOX_APP_ROOT + mixFolderPath);
    const w = window.open(url, "_blank", "noopener,noreferrer");
    if (!w) notify(t.vFolderOpenFail);
  }

  const innerHead: React.CSSProperties = { fontSize: 13.5, fontWeight: 800, color: TEXT, padding: "12px 16px", borderBottom: `1px solid ${BDR}` };
  const subCard: React.CSSProperties = { background: CARD2, border: `1px solid ${BDR}`, borderRadius: 14, overflow: "hidden" };
  const detailRow = (label: string, node: React.ReactNode) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, minHeight: 33, padding: "4px 0", borderBottom: `1px solid ${BDR}` }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: MUTED, flexShrink: 0 }}>{label}</span>
      <div style={{ display: "flex", justifyContent: "flex-end", minWidth: 0 }}>{node}</div>
    </div>
  );
  // Compact 2-column "field" cell (label above value) for the job-details card.
  const fieldCol: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 3, minWidth: 0 };
  const fieldLbl: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: "0.04em" };
  const field = (label: string, node: React.ReactNode) => (
    <div style={fieldCol}><span style={fieldLbl}>{label}</span><div style={{ minWidth: 0, display: "flex" }}>{node}</div></div>
  );

  const groupTitle = selectedGroup ? `${work.project} - ${selectedGroup.label}` : work.project;
  const totalSize = selectedGroup ? selectedGroup.files.reduce((s, f) => s + (f.fileSize ?? 0), 0) : 0;
  const colWrap: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 14, minWidth: 0 };

  const modal = (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 100001, background: "rgba(0,0,0,0.72)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div onClick={e => e.stopPropagation()} dir={rtl ? "rtl" : "ltr"} style={{
        background: CARD, border: `1px solid ${BRAND}33`, borderRadius: 20, width: "min(1400px, 97vw)", maxHeight: "94vh",
        display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: `0 24px 90px rgba(0,0,0,0.9), 0 0 60px ${BRAND}10`, fontFamily: "'Heebo', Arial, sans-serif",
      }}>
        {/* Header — version title · Steven · last updated */}
        <div style={{ padding: "18px 24px 16px", borderBottom: `1px solid ${BDR}`, flexShrink: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 10.5, fontWeight: 800, color: MUTED, letterSpacing: "0.09em", textTransform: "uppercase", marginBottom: 5 }}>{t.jobEyebrow}</div>
              <div title={groupTitle} style={{ fontSize: 23, fontWeight: 900, color: TEXT, lineHeight: 1.15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{groupTitle}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 10, flexWrap: "wrap" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 800, color: TEXT2, padding: "3px 10px", borderRadius: 999, background: "rgba(255,255,255,0.05)", border: `1px solid ${BDR2}` }}>🎧 Steven</span>
                {primary && <span style={{ fontSize: 11.5, color: MUTED }}>{t.headerUpdated}: <span style={{ direction: "ltr", unicodeBidi: "plaintext" } as React.CSSProperties}>{fmtDateTime(primary.updatedAt)}</span></span>}
              </div>
            </div>
            <button onClick={onClose} style={{ width: 34, height: 34, borderRadius: "50%", background: "rgba(255,255,255,0.06)", border: `1px solid ${BDR2}`, color: TEXT2, fontSize: 18, cursor: "pointer", flexShrink: 0, lineHeight: 1 }}>×</button>
          </div>
        </div>

        {/* Body — 3-column workboard: versions/files (left) · players+comments (center) · details (right) */}
        <div style={{ flex: 1, overflowY: "auto", padding: "18px 22px" }}>
          <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "300px minmax(0, 1fr) 320px", gap: 16, alignItems: "start" }}>

            {/* ═══ LEFT: versions · upload · project files · Dropbox ═══ */}
            <div style={{ ...colWrap, order: narrow ? 2 : 1 }}>
              {/* Versions for project */}
              <div style={subCard}>
                <div style={{ ...innerHead, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span>🎵 {t.versionsForProject}</span>
                  {groups.length > 0 && <span style={{ fontSize: 11, fontWeight: 800, color: MUTED }}>{groups.length}</span>}
                </div>
                {vLoadErr ? (
                  <div style={{ padding: "10px 16px 16px", fontSize: 12.5, color: RED }}>{t.vLoadFailed}</div>
                ) : versions === null ? (
                  <RowsSkeleton rows={3} height={34} pad="10px 12px 12px" />
                ) : groups.length === 0 ? (
                  <div style={{ padding: "10px 16px 18px", fontSize: 12, color: MUTED, textAlign: "center" }}>{t.vEmpty}</div>
                ) : (
                  <div style={{ padding: "8px 10px 10px", display: "flex", flexDirection: "column", gap: 5, maxHeight: 240, overflowY: "auto" }}>
                    {groups.map(g => {
                      const isSel = selectedGroup?.key === g.key;
                      const st = g.primary.status;
                      return (
                        <div key={g.key} onClick={() => setSel(g.primary.id)}
                          style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 10px", borderRadius: 11, cursor: "pointer", background: isSel ? `${BRAND}14` : "transparent", border: `1px solid ${isSel ? BRAND + "66" : "transparent"}`, transition: "background .12s" }}>
                          <button onClick={e => { e.stopPropagation(); setSel(g.primary.id); setPlayReq(p => ({ id: g.primary.id, nonce: (p?.nonce ?? 0) + 1 })); }} title={t.vPlay}
                            style={{ width: 30, height: 30, borderRadius: "50%", flexShrink: 0, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", background: isSel ? BRAND : `${BRAND}1A`, border: `1px solid ${BRAND}55`, color: isSel ? "#fff" : BRAND }}>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" style={{ marginInlineStart: 1 }}><path d="M8 5v14l11-7z"/></svg>
                          </button>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div title={g.label} style={{ fontSize: 12.5, fontWeight: 800, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.label}</div>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                              <span style={{ width: 6, height: 6, borderRadius: "50%", background: vStatusColor(st), flexShrink: 0 }} />
                              <span style={{ fontSize: 10, color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{vStatusLabel(st, lang)} · {g.files.length} {lang === "en" ? "files" : "קבצים"}</span>
                            </div>
                          </div>
                          <button onClick={e => { e.stopPropagation(); setDelVersion(g.primary); }} title={t.vDelYes}
                            style={{ background: "none", border: "none", color: "#7A4A4A", fontSize: 13, cursor: "pointer", flexShrink: 0 }}
                            onMouseEnter={e => (e.currentTarget.style.color = RED)} onMouseLeave={e => (e.currentTarget.style.color = "#7A4A4A")}>🗑</button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Upload — new version (dropzone) + add-to-selected-version */}
              <div style={subCard}>
                <div style={innerHead}>⬆ {t.uploadFiles}</div>
                <div style={{ padding: "12px 14px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
                  <input ref={newVersionInputRef} type="file" multiple accept=".wav,.mp3,.m4a,.aiff,.aif,.flac,.ogg,.zip,.rar,.7z" style={{ display: "none" }} onChange={e => openRolePicker("new", e.target.files)} />
                  <input ref={addFileInputRef} type="file" multiple accept=".wav,.mp3,.m4a,.aiff,.aif,.flac,.ogg,.zip,.rar,.7z" style={{ display: "none" }} onChange={e => openRolePicker("existing", e.target.files)} />
                  {/* Dropzone → NEW version */}
                  <div
                    onClick={() => { if (!uploading) newVersionInputRef.current?.click(); }}
                    onDragOver={e => { e.preventDefault(); if (!uploading && !drag) setDrag(true); }}
                    onDragLeave={e => { e.preventDefault(); setDrag(false); }}
                    onDrop={e => { e.preventDefault(); setDrag(false); if (!uploading) openRolePicker("new", e.dataTransfer.files); }}
                    style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, textAlign: "center", padding: "16px 12px", borderRadius: 12, cursor: uploading ? "default" : "pointer", border: `2px dashed ${drag ? BRAND : BDR2}`, background: drag ? `${BRAND}12` : "rgba(255,255,255,0.015)", transition: "all .15s" }}
                  >
                    <div style={{ fontSize: 22, opacity: 0.85, color: drag ? BRAND : TEXT2 }}>☁️</div>
                    <div style={{ fontSize: 12.5, fontWeight: 800, color: uploading ? BRAND : TEXT }}>{uploading ? t.vUploading : t.uploadNewVersionBtn}</div>
                    <div style={{ fontSize: 10, color: MUTED }}>{t.uploadHint}</div>
                  </div>
                  {/* Add file(s) to the SELECTED version */}
                  <button
                    onClick={() => { if (!uploading && selectedGroup) addFileInputRef.current?.click(); }}
                    disabled={uploading || !selectedGroup}
                    title={selectedGroup ? `${selectedGroup.label}` : undefined}
                    style={{ width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 12, fontWeight: 800, padding: "9px 12px", borderRadius: 10, fontFamily: "inherit", cursor: (uploading || !selectedGroup) ? "default" : "pointer", background: (uploading || !selectedGroup) ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.05)", border: `1px solid ${(uploading || !selectedGroup) ? BDR2 : BRAND + "45"}`, color: (uploading || !selectedGroup) ? MUTED : BRAND, opacity: uploading ? 0.6 : 1 }}>
                    {t.addToVersionBtn}{selectedGroup ? `: ${selectedGroup.label}` : ""}
                  </button>
                </div>
              </div>

              {/* Project files (files of the selected version) */}
              <div style={subCard}>
                <div style={innerHead}>📁 {t.projectFiles}</div>
                <div style={{ padding: "10px 12px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
                  {!selectedGroup ? (
                    <div style={{ fontSize: 12, color: MUTED, textAlign: "center", padding: "8px 0" }}>—</div>
                  ) : selectedGroup.files.map(f => {
                    const dName = fileDisplayName(work.project, selectedGroup.label, f.role);
                    return (
                    <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", borderRadius: 10, background: CARD, border: `1px solid ${BDR}` }}>
                      <span style={{ width: 26, height: 26, borderRadius: 7, flexShrink: 0, background: `${ROLE_COLOR[f.role]}22`, color: ROLE_COLOR[f.role], display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>{isAudioName(f.fileName) ? "🎵" : "📦"}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div title={dName} style={{ fontSize: 12, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", unicodeBidi: "plaintext" } as React.CSSProperties}>{dName}</div>
                        <div style={{ fontSize: 9.5, color: MUTED, marginTop: 1 }}>{roleLabel(f.role, lang)}{f.fileSize ? ` · ${fmtBytes(f.fileSize)}` : ""}</div>
                      </div>
                      <a href={f.url} target="_blank" rel="noopener noreferrer" title={t.vDownload}
                        style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0, background: "rgba(255,255,255,0.05)", border: `1px solid ${BDR2}`, color: TEXT2, display: "inline-flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.6l3.3-3.3L16.7 12 12 16.7 7.3 12l1.4-1.7L12 13.6V3zM5 19h14v2H5z"/></svg>
                      </a>
                    </div>
                    );
                  })}
                </div>
              </div>

              {/* Dropbox */}
              <button onClick={openMixFolder} disabled={!mixFolderPath} title={mixFolderPath ? undefined : t.vFolderPending}
                style={{ width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 12, fontWeight: 700, padding: "10px 12px", borderRadius: 12, fontFamily: "inherit", background: mixFolderPath ? "rgba(0,98,238,0.10)" : "rgba(255,255,255,0.03)", border: `1px solid ${mixFolderPath ? "rgba(0,98,238,0.28)" : BDR2}`, color: mixFolderPath ? "#4A9EFF" : MUTED, cursor: mixFolderPath ? "pointer" : "default" }}>
                {t.openMixFolder}
              </button>
            </div>

            {/* ═══ CENTER: version files (players) · shared comments ═══ */}
            <div style={{ ...colWrap, order: narrow ? 1 : 2 }}>
              {/* Version files — up to 3 stacked players */}
              <div style={subCard}>
                <div style={{ padding: "13px 16px", borderBottom: `1px solid ${BDR}` }}>
                  <div style={{ fontSize: 14.5, fontWeight: 800, color: TEXT }}>🎵 {t.versionFiles}</div>
                  <div style={{ fontSize: 11.5, color: MUTED, marginTop: 3 }}>{t.versionFilesSub}</div>
                </div>
                <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
                  {vLoadErr ? (
                    <div style={{ padding: "18px 0", fontSize: 12.5, color: RED, textAlign: "center" }}>{t.vLoadFailed}</div>
                  ) : (versions === null || (groups.length > 0 && !selectedGroup)) ? (
                    <PlayerSkeleton />
                  ) : selectedGroup ? (() => {
                    // Players ONLY for audio files. Archives (stems/zip/rar) live
                    // in "project files" as download rows, never as a player.
                    const audioFiles = selectedGroup.files.filter(f => isAudioName(f.fileName));
                    const stemsCount = selectedGroup.files.length - audioFiles.length;
                    const playerPrimaryId = (audioFiles.find(f => f.id === primary?.id) ?? audioFiles[0])?.id;
                    return (
                      <>
                        {audioFiles.map(f => (
                          <VersionPlayer
                            key={f.id}
                            ref={f.id === playerPrimaryId ? playerRef : undefined}
                            url={f.url}
                            title={fileDisplayName(work.project, selectedGroup.label, f.role)}
                            roleLabel={roleLabel(f.role, lang)}
                            roleColor={ROLE_COLOR[f.role]}
                            compact={f.id !== playerPrimaryId}
                            shouldPlay={playReq?.id === f.id ? playReq.nonce : 0}
                            comments={comments ?? []}
                            onDownload={() => window.open(f.url, "_blank", "noopener,noreferrer")}
                            t={t}
                          />
                        ))}
                        {audioFiles.length === 0 && (
                          <div style={{ padding: "20px 0" }}><EmptyZone icon="🎧" title={t.pNoVersionsTitle} subtitle={t.pNoVersionsSub} /></div>
                        )}
                        {stemsCount > 0 && (
                          <div style={{ fontSize: 11, color: MUTED, textAlign: "center", padding: "2px 0" }}>
                            📦 {stemsCount} {lang === "en" ? "archive file(s) — see project files" : "קבצי ערוצים/ארכיון — ראה קבצי הפרויקט"}
                          </div>
                        )}
                      </>
                    );
                  })() : (
                    <div style={{ padding: "26px 0" }}><EmptyZone icon="🎧" title={t.pNoVersionsTitle} subtitle={t.pNoVersionsSub} /></div>
                  )}
                </div>
              </div>

              {/* Shared comments for the version */}
              {selectedGroup && (
                <div style={subCard}>
                  <div style={{ padding: "12px 16px", borderBottom: `1px solid ${BDR}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 13.5, fontWeight: 800, color: TEXT }}>💬 {t.sharedComments}</div>
                      <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{t.sharedCommentsSub}</div>
                    </div>
                    <button onClick={openAddComment}
                      style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 800, padding: "6px 12px", borderRadius: 8, background: `${BRAND}16`, border: `1px solid ${BRAND}45`, color: BRAND, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>+ {t.cAdd}</button>
                  </div>
                  <div style={{ padding: "12px 16px 16px" }}>
                    {adding && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, padding: "8px 10px", borderRadius: 10, background: CARD, border: `1px solid ${BRAND}44` }}>
                        <span style={{ fontSize: 11, fontWeight: 800, color: BRAND, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{t.cAtTime} {fmtTime(addTs)}</span>
                        <input autoFocus value={newText} onChange={e => setNewText(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") saveNewComment(); if (e.key === "Escape") setAdding(false); }}
                          placeholder={t.cPlaceholder}
                          style={{ flex: 1, minWidth: 0, padding: "7px 10px", borderRadius: 8, background: "#0D0D12", color: TEXT, border: `1px solid ${BDR2}`, fontSize: 12.5, fontFamily: "inherit", outline: "none" }} />
                        <button onClick={saveNewComment} disabled={!newText.trim() || savingC}
                          style={{ fontSize: 11, fontWeight: 800, padding: "6px 12px", borderRadius: 8, background: BRAND, border: "none", color: "#fff", cursor: newText.trim() ? "pointer" : "default", opacity: newText.trim() && !savingC ? 1 : 0.5, fontFamily: "inherit" }}>{t.save}</button>
                        <button onClick={() => setAdding(false)}
                          style={{ fontSize: 11, fontWeight: 700, padding: "6px 10px", borderRadius: 8, background: "transparent", border: `1px solid ${BDR2}`, color: TEXT2, cursor: "pointer", fontFamily: "inherit" }}>{t.cancel}</button>
                      </div>
                    )}
                    {cLoadErr ? (
                      <div style={{ fontSize: 12, color: RED, padding: "6px 2px" }}>{t.cLoadFail}</div>
                    ) : comments === null ? (
                      <RowsSkeleton rows={2} height={44} pad="0" />
                    ) : comments.length === 0 ? (
                      !adding && <div style={{ fontSize: 12.5, color: MUTED, textAlign: "center", padding: "14px 0" }}>{t.cEmpty}</div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                        {comments.map((c, i) => {
                          const col = COMMENT_COLORS[i % COMMENT_COLORS.length];
                          const isEditing = editingId === c.id;
                          return (
                            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 13px", borderRadius: 11, background: CARD, border: `1px solid ${BDR}` }}>
                              <span style={{ width: 23, height: 23, borderRadius: "50%", flexShrink: 0, background: col, color: "#fff", fontSize: 11, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</span>
                              <button onClick={() => playerRef.current?.playFrom(c.timestampSeconds)} title={t.vPlay}
                                style={{ width: 26, height: 26, borderRadius: "50%", flexShrink: 0, background: `${BRAND}1A`, border: `1px solid ${BRAND}55`, color: BRAND, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" style={{ marginInlineStart: 1 }}><path d="M8 5v14l11-7z"/></svg>
                              </button>
                              <button onClick={() => playerRef.current?.seek(c.timestampSeconds)}
                                style={{ fontSize: 11.5, fontWeight: 800, color: col, background: "transparent", border: "none", cursor: "pointer", fontVariantNumeric: "tabular-nums", flexShrink: 0, fontFamily: "inherit" }}>{fmtTime(c.timestampSeconds)}</button>
                              {isEditing ? (
                                <input autoFocus value={editText} onChange={e => setEditText(e.target.value)}
                                  onKeyDown={e => { if (e.key === "Enter") saveEditComment(c); if (e.key === "Escape") setEditingId(null); }}
                                  onBlur={() => saveEditComment(c)}
                                  style={{ flex: 1, minWidth: 0, padding: "5px 9px", borderRadius: 7, background: "#0D0D12", color: TEXT, border: `1px solid ${BRAND}55`, fontSize: 12.5, fontFamily: "inherit", outline: "none" }} />
                              ) : (
                                <div onClick={() => playerRef.current?.seek(c.timestampSeconds)} title={c.commentText}
                                  style={{ flex: 1, minWidth: 0, fontSize: 13, color: TEXT, cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.commentText}</div>
                              )}
                              <span style={{ fontSize: 10, color: MUTED, flexShrink: 0, whiteSpace: "nowrap" }}>{fmtRelative(c.createdAt, lang)}</span>
                              {!isEditing && (
                                <button onClick={() => { setEditingId(c.id); setEditText(c.commentText); }} title={t.cEdit}
                                  style={{ background: "none", border: "none", color: MUTED, fontSize: 13, cursor: "pointer", flexShrink: 0 }}
                                  onMouseEnter={e => (e.currentTarget.style.color = TEXT2)} onMouseLeave={e => (e.currentTarget.style.color = MUTED)}>✎</button>
                              )}
                              <button onClick={() => setDelC(c)} title={t.cDelete}
                                style={{ background: "none", border: "none", color: "#7A4A4A", fontSize: 13, cursor: "pointer", flexShrink: 0 }}
                                onMouseEnter={e => (e.currentTarget.style.color = RED)} onMouseLeave={e => (e.currentTarget.style.color = "#7A4A4A")}>🗑</button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* ═══ RIGHT: version details · job details · instructions ═══ */}
            <div style={{ ...colWrap, order: 3 }}>
              {/* Version details */}
              <div style={subCard}>
                <div style={innerHead}>ℹ {t.versionDetails}</div>
                <div style={{ padding: "6px 16px 14px" }}>
                  {detailRow(t.vName, <span style={{ fontSize: 12.5, fontWeight: 800, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedGroup?.label ?? "—"}</span>)}
                  {detailRow(t.vCreator, <span style={{ fontSize: 12.5, fontWeight: 700, color: TEXT }}>{primary?.uploadedBy || "Steven"}</span>)}
                  {detailRow(t.status, primary
                    ? <InlineSelect<string> value={primary.status} display={vStatusLabel(primary.status, lang)} color={vStatusColor(primary.status)} options={VSTATUS_OPTIONS.map(o => ({ value: o, label: vStatusLabel(o, lang), color: vStatusColor(o) }))} onChange={v => setVersionStatus(primary, v)} />
                    : <span style={{ fontSize: 12.5, color: MUTED }}>—</span>)}
                  {detailRow(t.vCreatedAt, <span style={{ fontSize: 12, fontWeight: 700, color: TEXT, direction: "ltr", unicodeBidi: "plaintext" } as React.CSSProperties}>{primary ? fmtDateTime(primary.createdAt) : "—"}</span>)}
                  {detailRow(t.vUpdatedAt, <span style={{ fontSize: 12, fontWeight: 700, color: TEXT, direction: "ltr", unicodeBidi: "plaintext" } as React.CSSProperties}>{primary ? fmtDateTime(primary.updatedAt) : "—"}</span>)}
                  {detailRow(t.vFileCount, <span style={{ fontSize: 12.5, fontWeight: 700, color: TEXT }}>{selectedGroup ? `${selectedGroup.files.length} ${lang === "en" ? "files" : "קבצים"}` : "—"}</span>)}
                  {detailRow(t.vTotalSize, <span style={{ fontSize: 12.5, fontWeight: 700, color: TEXT }}>{totalSize > 0 ? fmtBytes(totalSize) : "—"}</span>)}
                  {primary && (
                    <button onClick={() => setVersionStatus(primary, "מאושר")} disabled={primary.status === "מאושר"}
                      style={{ width: "100%", marginTop: 14, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, fontSize: 12.5, fontWeight: 800, padding: "10px 14px", borderRadius: 11, fontFamily: "inherit", cursor: primary.status === "מאושר" ? "default" : "pointer", background: primary.status === "מאושר" ? "rgba(255,255,255,0.04)" : `${BRAND}16`, border: `1px solid ${primary.status === "מאושר" ? BDR2 : BRAND + "55"}`, color: primary.status === "מאושר" ? MUTED : BRAND }}>
                      ✓ {t.markApproved}
                    </button>
                  )}
                </div>
              </div>

              {/* Job details (compact) */}
              <div style={subCard}>
                <div style={innerHead}>{t.jobDetails}</div>
                <div style={{ padding: "10px 16px 12px" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 14px", alignItems: "start" }}>
                    {field(t.workType, <InlineSelect<WorkType> value={work.workType} display={wtLabel(work.workType, lang)} color={TEXT2} options={WORK_TYPES.map(o => ({ value: o, label: wtLabel(o, lang), color: TEXT2 }))} onChange={v => onChange({ workType: v })} />)}
                    {field(t.status, <InlineSelect<WorkStatus> value={work.status} display={statusLabel(work.status, lang)} color={STATUS_COLOR[work.status]} options={STATUS_OPTIONS.map(o => ({ value: o, label: statusLabel(o, lang), color: STATUS_COLOR[o] }))} onChange={v => onChange({ status: v })} />)}
                    {field(t.payment, <PayChip pay={work.pay} lang={lang} />)}
                    {field(t.agreedPrice, <PriceInput value={work.price} currency={work.currency} onCommit={n => { onChange({ price: n }); notify(t.priceSaved); }} onInvalid={() => notify(t.priceInvalid)} />)}
                    {field(t.startDate, <span style={{ fontSize: 12, fontWeight: 700, color: TEXT }}>{work.startDate}</span>)}
                    {field(t.deadline, <span style={{ fontSize: 12, fontWeight: 700, color: TEXT }}>{work.deadline}</span>)}
                  </div>
                  <div style={{ paddingTop: 12, marginTop: 10, borderTop: `1px solid ${BDR}` }}>
                    <button onClick={() => setConfirmOpen(true)}
                      style={{ width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, fontSize: 12, fontWeight: 700, padding: "8px 14px", borderRadius: 10, background: "transparent", border: `1px solid ${RED}44`, color: RED, cursor: "pointer", fontFamily: "inherit" }}>🗑 {t.deleteWork}</button>
                  </div>
                </div>
              </div>

              {/* Mix instructions (compact) */}
              <div style={subCard}>
                <div style={{ padding: "12px 16px", borderBottom: `1px solid ${BDR}` }}>
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: TEXT }}>🎚 {t.mixInstructions}</div>
                </div>
                <div style={{ padding: "12px 16px" }}>
                  <NotesEditor value={work.notes} placeholder={t.mixInstructionsPh} saveLabel={t.saveInstructions} onSave={v => { onChange({ notes: v }); notify(t.instructionsSaved); }} />
                </div>
              </div>
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

        {/* Delete-version confirmation */}
        {delVersion && (
          <div onClick={() => setDelVersion(null)} style={{ position: "fixed", inset: 0, zIndex: 100002, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
            <div onClick={e => e.stopPropagation()} dir={rtl ? "rtl" : "ltr"} style={{ background: CARD, border: `1px solid ${RED}44`, borderRadius: 16, width: "min(420px, 92vw)", padding: "22px 24px", boxShadow: "0 24px 80px rgba(0,0,0,0.9)", fontFamily: "'Heebo', Arial, sans-serif" }}>
              <div style={{ fontSize: 16, fontWeight: 900, color: TEXT, marginBottom: 10 }}>{t.vDelTitle}</div>
              <div style={{ fontSize: 13, color: TEXT2, lineHeight: 1.6, marginBottom: 8 }}>{t.vDelBody}</div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: TEXT, marginBottom: 16, direction: "ltr", textAlign: rtl ? "right" : "left" }}>{delVersion.label.startsWith(`${delVersion.id}-`) ? delVersion.label.slice(delVersion.id.length + 1) : delVersion.label}</div>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => setDelVersion(null)} style={{ ...ghostBtn, flex: 1, justifyContent: "center" }}>{t.confirmNo}</button>
                <button onClick={confirmDeleteVersion} style={{ flex: 1, padding: "10px 18px", borderRadius: 10, background: RED, border: "none", color: "#fff", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>🗑 {t.vDelYes}</button>
              </div>
            </div>
          </div>
        )}

        {/* Delete-comment confirmation */}
        {delC && (
          <div onClick={() => setDelC(null)} style={{ position: "fixed", inset: 0, zIndex: 100002, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
            <div onClick={e => e.stopPropagation()} dir={rtl ? "rtl" : "ltr"} style={{ background: CARD, border: `1px solid ${RED}44`, borderRadius: 16, width: "min(420px, 92vw)", padding: "22px 24px", boxShadow: "0 24px 80px rgba(0,0,0,0.9)", fontFamily: "'Heebo', Arial, sans-serif" }}>
              <div style={{ fontSize: 16, fontWeight: 900, color: TEXT, marginBottom: 10 }}>{t.cDelTitle}</div>
              <div style={{ fontSize: 13, color: TEXT2, lineHeight: 1.6, marginBottom: 8 }}>{t.cDelBody}</div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: TEXT, marginBottom: 16 }}>{fmtTime(delC.timestampSeconds)} · {delC.commentText}</div>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => setDelC(null)} style={{ ...ghostBtn, flex: 1, justifyContent: "center" }}>{t.confirmNo}</button>
                <button onClick={confirmDeleteComment} style={{ flex: 1, padding: "10px 18px", borderRadius: 10, background: RED, border: "none", color: "#fff", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>🗑 {t.cDelete}</button>
              </div>
            </div>
          </div>
        )}

        {/* Per-file role picker — opens after files are chosen, before upload */}
        {rolePicker && (
          <div onClick={() => { if (!uploading) setRolePicker(null); }} style={{ position: "fixed", inset: 0, zIndex: 100002, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
            <div onClick={e => e.stopPropagation()} dir={rtl ? "rtl" : "ltr"} style={{ background: CARD, border: `1px solid ${BRAND}44`, borderRadius: 16, width: "min(520px, 94vw)", maxHeight: "88vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 24px 80px rgba(0,0,0,0.9)", fontFamily: "'Heebo', Arial, sans-serif" }}>
              <div style={{ padding: "18px 22px 14px", borderBottom: `1px solid ${BDR}` }}>
                <div style={{ fontSize: 16, fontWeight: 900, color: TEXT }}>🎚 {t.rpTitle}</div>
                <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>
                  {rolePicker.mode === "new" ? t.rpSubNew : `${t.rpSubExisting}: ${selectedGroup?.label ?? ""}`} · {t.rpHint}
                </div>
              </div>
              <div style={{ padding: "14px 18px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
                {rolePicker.items.map((it, idx) => (
                  <div key={idx} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", borderRadius: 11, background: CARD2, border: `1px solid ${BDR}` }}>
                    <span style={{ width: 26, height: 26, borderRadius: 7, flexShrink: 0, background: `${ROLE_COLOR[it.role]}22`, color: ROLE_COLOR[it.role], display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>{isAudioName(it.file.name) ? "🎵" : "📦"}</span>
                    <div title={it.file.name} style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: "ltr", textAlign: "start", unicodeBidi: "plaintext" } as React.CSSProperties}>{it.file.name}</div>
                    <select value={it.role} onChange={e => { const role = e.target.value as FileRole; setRolePicker(p => p ? { ...p, items: p.items.map((x, i) => i === idx ? { ...x, role } : x) } : p); }}
                      style={{ flexShrink: 0, fontSize: 12, fontWeight: 700, padding: "6px 8px", borderRadius: 8, background: "#0D0D12", color: TEXT, border: `1px solid ${ROLE_COLOR[it.role]}66`, fontFamily: "inherit", outline: "none", cursor: "pointer" }}>
                      {ROLE_ORDER.map(r => <option key={r} value={r}>{roleLabel(r, lang)}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              <div style={{ padding: "14px 18px", borderTop: `1px solid ${BDR}`, display: "flex", gap: 10 }}>
                <button onClick={() => { if (!uploading) setRolePicker(null); }} disabled={uploading} style={{ ...ghostBtn, flex: 1, justifyContent: "center", opacity: uploading ? 0.6 : 1 }}>{t.cancel}</button>
                <button onClick={runRolePickerUpload} disabled={uploading} style={{ flex: 1, padding: "10px 18px", borderRadius: 10, background: uploading ? MUTED : BRAND, border: "none", color: "#fff", fontSize: 13, fontWeight: 800, cursor: uploading ? "default" : "pointer", fontFamily: "inherit" }}>{uploading ? t.vUploading : `⬆ ${t.rpUpload}`}</button>
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
