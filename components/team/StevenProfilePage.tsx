"use client";

import { useState, useRef, useEffect, useCallback, useMemo, forwardRef, useImperativeHandle } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { useRole } from "@/lib/use-role";
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

interface Work {
  id: string; project: string; workType: WorkType; status: WorkStatus;
  startDate: string; deadline: string; price: number; pay: PayStatus;
  amountPaid: number; currency: string; dbBacked: boolean;
  notes: string; filesLink: string | null;   // real fields from sound_engineer_work
  paymentDate: string | null;                 // YYYY-MM-DD when marked paid (null = unpaid/legacy)
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
    paymentDate: r.paymentDate ?? null,
  };
}

// ── Local translations (page-scoped, NOT global i18n) ────────────────────────────
const TR = {
  he: {
    breadcrumb: "צוות / ספקים", profileTitle: "פרופיל ספק —", role: "איש סאונד / מיקס ומאסטר", active: "פעיל",
    back: "→ חזרה לרשימה", newWork: "+ עבודה חדשה ל-Steven",
    soundSupplier: "ספק סאונד", supplierType: "סוג ספק: איש סאונד", updatedToday: "עודכן לאחרונה: היום",
    kpiOpen: "עבודות פתוחות", kpiActive: "עבודות פעילות", kpiDone: "עבודות הושלמו", kpiDebt: "חוב ל-Steven", kpiPaidMonth: "שולם",
    payHistory: "היסטוריית תשלומים", recentFiles: "קבצים אחרונים", viewAll: "הצג הכל →", paid: "שולם", payDateTitle: "תאריך תשלום", payDateField: "תאריך תשלום",
    noPayments: "אין עדיין תשלומים ל-Steven", noRecentFiles: "אין עדיין קבצים אחרונים",
    soundJobs: "עבודות סאונד", project: "פרויקט", workType: "סוג עבודה", status: "סטטוס", startDate: "תאריך התחלה", deadline: "דדליין", price: "מחיר", payment: "תשלום", action: "פעולות", openJob: "פתח עבודה", noJobs: "אין עדיין עבודות ל-Steven",
    job: "עבודה:", jobEyebrow: "עבודה", workFiles: "קבצי עבודה", dragHere: "גרור לכאן קבצים", orClick: "או לחץ להעלאה ידנית", chooseFiles: "בחר קבצים", fileHint: "Stems, Mix, Master, Reference, ZIP", noFiles: "אין עדיין קבצים בעבודה הזו",
    openDropbox: "📦 פתח בדרופבוקס", jobDetails: "פרטי עבודה", agreedPrice: "מחיר שסוכם",
    mixInstructions: "הוראות למיקס", mixInstructionsSub: "מה שסטיבן צריך לדעת לפני שהוא מתחיל", mixInstructionsPh: "כתוב כאן הוראות למיקס — רפרנסים, דגשים על ווקאל/פזמון, מאסטרינג לסטרימינג...", saveInstructions: "שמור הוראות", instructionsSaved: "ההוראות נשמרו",
    mixVersions: "גרסאות למיקס", versionsEmptyTitle: "עדיין אין גרסאות מיקס", mixVersionsEmpty: "גרסאות המיקס (Mix 1, Mix 2...) יתווספו כאן בהמשך", openInDropbox: "📦 פתח תיקיית Dropbox", openMixFolder: "📦 פתח ב-Dropbox", vFolderPending: "התיקייה תיווצר אחרי העלאת גרסה ראשונה", vFolderOpenFail: "לא ניתן לפתוח את תיקיית Dropbox", noFilesLink: "אין עדיין תיקיית Dropbox מקושרת לעבודה זו", sendNotes: "שלח הערות", sendNotesSoon: "יחובר בהמשך", sendNotesSent: "ההערות נשלחו ל-Steven", sendNotesFail: "שליחת ההערות נכשלה",
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
    versionsForProject: "גרסאות לפרויקט", uploadFiles: "העלאת קבצים", projectFiles: "קבצי הפרויקט", wmMatSub: "Rough Mix · רפרנסים · Stems · הוראות",
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
    // Work Materials (what Redbloods sends to the engineer)
    wmButton: "חומרי עבודה", wmTitle: "חומרי עבודה", wmSubtitle: "מה ששלחנו ל-Steven כדי לעבוד", wmReadOnly: "תצוגת Steven — קריאה בלבד",
    wmOpenWork: "פתח עבודה", wmSendToSteven: "שלח ל-Steven", wmSending: "שולח…", wmSentToSteven: "נשלח ל-Steven", wmSendFail: "שליחה ל-Steven נכשלה", wmSendAgain: "כבר נשלח ל-Steven. לשלוח שוב?", wmOpenFolder: "📦 פתח תיקייה ב-Dropbox", wmFolderPending: "התיקייה תיווצר אחרי ההעלאה הראשונה", wmFolderFail: "לא ניתן לפתוח את תיקיית Dropbox",
    wmNoProject: "לעבודה זו אין פרויקט מקושר — חומרי עבודה זמינים רק לעבודה עם פרויקט.",
    wmLoadFail: "טעינת חומרי העבודה נכשלה",
    wmInstructions: "הוראות עבודה", wmBpm: "BPM", wmKey: "סולם / Key", wmNotes: "הערות חשובות למיקס",
    wmNotesPh: "דגשים על ווקאל/פזמון, מאסטרינג לסטרימינג, מה חשוב…", wmSaveMeta: "שמור הוראות", wmMetaSaved: "ההוראות נשמרו", wmMetaFail: "השמירה נכשלה",
    wmRough: "Rough Mix", wmReferences: "רפרנסים", wmStems: "ערוצים וקבצי עבודה", wmDocs: "מסמכים",
    wmRoughSub: "העלאת מיקס גס לעבודה", wmReferencesSub: "רפרנסי אודיו או קישורים חיצוניים", wmStemsSub: "ערוצי Stems או קבוצות ערוצים", wmDocsSub: "קבצי טקסט, מילים, הערות ועוד",
    wmCompare: "השוואה מהירה", wmCompareRough: "Rough Mix (המקורי ששלחנו)", wmCompareLatest: "Latest Mix (הגרסה האחרונה של Steven)", wmCompareReference: "Reference (שהועלה)",
    wmCompareHint: "לחיצה על Play בשני הנגנים תשמיע כל אחד בנפרד.", wmNoLatest: "אין עדיין גרסת מיקס מ-Steven להשוואה", wmNoReference: "אין עדיין reference שהועלה", wmSyncNote: "השוואה לפי זמן ניגון",
    wmUploadRough: "+ העלה Rough Mix", wmUploadRef: "+ הוסף רפרנס", wmUploadStems: "+ העלה Stems", wmUploadDoc: "+ הוסף מסמך",
    wmUploadingRough: "מעלה Rough Mix…", wmUploadingRef: "מעלה רפרנס…", wmUploadingStems: "מעלה Stems…", wmUploadingDoc: "מעלה מסמך…",
    wmUpProgress: "מעלה קובץ…", wmUpSaving: "שומר ל-Dropbox…", wmTooLarge: "הקובץ גדול מדי. המגבלה להעלאה דרך המערכת היא 1GB. העלה ישירות ל-Dropbox.",
    wmEmpty: "אין עדיין", wmDownload: "הורדה", wmDelete: "מחק",
    wmUploading: "מעלה…", wmUploaded: "הקובץ הועלה", wmUploadFail: "ההעלאה נכשלה", wmDeleted: "הקובץ נמחק", wmDeleteFail: "המחיקה נכשלה",
    wmDelTitle: "למחוק את הקובץ?", wmDelBody: "הקובץ יימחק מ-Dropbox ומחומרי העבודה. פעולה בלתי הפיכה.",
  },
  en: {
    breadcrumb: "Team / Suppliers", profileTitle: "Supplier Profile —", role: "Sound Engineer / Mix & Master", active: "Active",
    back: "← Back to list", newWork: "+ New work for Steven",
    soundSupplier: "Sound Supplier", supplierType: "Supplier type: Sound Engineer", updatedToday: "Updated today",
    kpiOpen: "Open Jobs", kpiActive: "Active Jobs", kpiDone: "Completed Jobs", kpiDebt: "Debt to Steven", kpiPaidMonth: "Paid",
    payHistory: "Payment History", recentFiles: "Recent Files", viewAll: "View All →", paid: "Paid", payDateTitle: "Payment date", payDateField: "Payment date",
    noPayments: "No Steven payments yet", noRecentFiles: "No recent files yet",
    soundJobs: "Sound Jobs", project: "Project", workType: "Work Type", status: "Status", startDate: "Start Date", deadline: "Deadline", price: "Price", payment: "Payment", action: "Actions", openJob: "Open Work", noJobs: "No Steven jobs yet",
    job: "Job:", jobEyebrow: "Job", workFiles: "Work Files", dragHere: "Drag files here", orClick: "or click to upload manually", chooseFiles: "Choose Files", fileHint: "Stems, Mix, Master, Reference, ZIP", noFiles: "No files yet for this job",
    openDropbox: "📦 Open in Dropbox", jobDetails: "Job Details", agreedPrice: "Agreed Price",
    mixInstructions: "Mix Instructions", mixInstructionsSub: "What Steven needs to know before starting", mixInstructionsPh: "Write mix instructions here — references, vocal/chorus focus, streaming-ready master...", saveInstructions: "Save instructions", instructionsSaved: "Instructions saved",
    mixVersions: "Mix Versions", versionsEmptyTitle: "No mix versions yet", mixVersionsEmpty: "Mix versions (Mix 1, Mix 2...) will appear here", openInDropbox: "📦 Open Dropbox folder", openMixFolder: "📦 Open in Dropbox", vFolderPending: "The folder is created after the first version upload", vFolderOpenFail: "Couldn't open the Dropbox folder", noFilesLink: "No Dropbox folder linked to this job yet", sendNotes: "Send notes", sendNotesSoon: "Coming soon", sendNotesSent: "Notes sent to Steven", sendNotesFail: "Failed to send notes",
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
    versionsForProject: "Project versions", uploadFiles: "Upload files", projectFiles: "Project files", wmMatSub: "Rough Mix · References · Stems · Instructions",
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
    // Work Materials (what Redbloods sends to the engineer)
    wmButton: "Work Materials", wmTitle: "Work Materials", wmSubtitle: "What we sent you to work with", wmReadOnly: "Read only",
    wmOpenWork: "Open Work", wmSendToSteven: "Send to Steven", wmSending: "Sending…", wmSentToSteven: "Sent to Steven", wmSendFail: "Failed to send to Steven", wmSendAgain: "Already sent to Steven. Send again?", wmOpenFolder: "📦 Open Dropbox Folder", wmFolderPending: "The folder is created after the first upload", wmFolderFail: "Couldn't open the Dropbox folder",
    wmNoProject: "This job has no linked project — work materials require a project.",
    wmLoadFail: "Failed to load work materials",
    wmInstructions: "Work Instructions", wmBpm: "BPM", wmKey: "Key", wmNotes: "Important mix notes",
    wmNotesPh: "Vocal/chorus focus, streaming-ready master, what matters…", wmSaveMeta: "Save instructions", wmMetaSaved: "Instructions saved", wmMetaFail: "Save failed",
    wmRough: "Rough Mix", wmReferences: "References", wmStems: "Stems & Work Files", wmDocs: "Documents",
    wmRoughSub: "The rough mix to work from", wmReferencesSub: "Audio references or external links", wmStemsSub: "Stem files or channel bundles", wmDocsSub: "Text files, lyrics, notes and more",
    wmCompare: "Quick compare", wmCompareRough: "Rough Mix (what we sent)", wmCompareLatest: "Latest Mix (Steven's latest)", wmCompareReference: "Reference (uploaded)",
    wmCompareHint: "Press Play on either player — one plays at a time.", wmNoLatest: "No mix from Steven yet to compare", wmNoReference: "No reference uploaded yet", wmSyncNote: "A/B by playback time",
    wmUploadRough: "+ Upload Rough Mix", wmUploadRef: "+ Add reference", wmUploadStems: "+ Upload Stems", wmUploadDoc: "+ Add document",
    wmUploadingRough: "Uploading Rough Mix…", wmUploadingRef: "Uploading reference…", wmUploadingStems: "Uploading Stems…", wmUploadingDoc: "Uploading document…",
    wmUpProgress: "Uploading file…", wmUpSaving: "Saving to Dropbox…", wmTooLarge: "File too large. The in-app upload limit is 1GB. Upload it directly to Dropbox.",
    wmEmpty: "Nothing yet", wmDownload: "Download", wmDelete: "Delete",
    wmUploading: "Uploading…", wmUploaded: "File uploaded", wmUploadFail: "Upload failed", wmDeleted: "File removed", wmDeleteFail: "Delete failed",
    wmDelTitle: "Delete this file?", wmDelBody: "The file will be removed from Dropbox and work materials. This cannot be undone.",
  },
};
type T = (typeof TR)["he"];

// ── Chips ───────────────────────────────────────────────────────────────────────
// הושלם = green (done); פעיל = blue (in-progress, NOT green); בוטל = red.
const STATUS_COLOR: Record<WorkStatus, string> = { "פעיל": BLUE, "הושלם": GREEN, "בוטל": RED };
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
    <div style={{ position: "fixed", bottom: 26, left: "50%", transform: "translateX(-50%)", zIndex: 200003,
      background: "#1A1C22", border: `1px solid ${BDR2}`, color: TEXT, fontSize: 13, fontWeight: 700,
      padding: "11px 20px", borderRadius: 12, boxShadow: "0 8px 30px rgba(0,0,0,0.6)",
      fontFamily: "'Heebo', Arial, sans-serif", pointerEvents: "none" }}>{msg}</div>,
    document.body,
  );
}

// ── Clean line-icons (mobile polish — replace stock emoji on the Steven page).
// Stroked, inherit currentColor, vertically centered for inline use in headers.
function LineIcon({ paths, size = 15, fill = false }: { paths: string; size?: number; fill?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? "currentColor" : "none"} stroke={fill ? "none" : "currentColor"} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }} aria-hidden>
      <path d={paths} />
    </svg>
  );
}
const SlidersIcon    = ({ size = 15 }: { size?: number }) => <LineIcon size={size} paths="M4 21v-6M4 11V3M12 21v-8M12 9V3M20 21v-4M20 13V3M1 15h6M9 9h6M17 17h6" />;
const InfoIcon       = ({ size = 15 }: { size?: number }) => <LineIcon size={size} paths="M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v5M12 7.5v.5" />;
const MusicIcon      = ({ size = 15 }: { size?: number }) => <LineIcon size={size} paths="M9 18V5l11-2v13M9 18a3 3 0 11-6 0 3 3 0 016 0zM20 16a3 3 0 11-6 0 3 3 0 016 0z" />;
const FolderIcon     = ({ size = 15 }: { size?: number }) => <LineIcon size={size} paths="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />;
const FileIcon       = ({ size = 15 }: { size?: number }) => <LineIcon size={size} paths="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5zM14 3v5h5M9 13h6M9 17h6" />;
const HeadphonesIcon = ({ size = 15 }: { size?: number }) => <LineIcon size={size} paths="M4 14v-2a8 8 0 0116 0v2M4 14a2 2 0 012 2v2a2 2 0 01-2 2 2 2 0 01-2-2v-2a2 2 0 012-2zM20 14a2 2 0 00-2 2v2a2 2 0 002 2 2 2 0 002-2v-2a2 2 0 00-2-2z" />;
const BoxIcon        = ({ size = 15 }: { size?: number }) => <LineIcon size={size} paths="M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8" />;
const NoteIcon       = ({ size = 15 }: { size?: number }) => <LineIcon size={size} paths="M4 4h11l5 5v11a0 0 0 010 0H4a0 0 0 010 0V4zM8 11h8M8 15h5" />;
const ScaleIcon      = ({ size = 15 }: { size?: number }) => <LineIcon size={size} paths="M12 3v18M6 21h12M12 5l-7 2 3 6a3 3 0 01-6 0l3-6M12 5l7 2-3 6a3 3 0 006 0l-3-6" />;
const UploadIcon     = ({ size = 15 }: { size?: number }) => <LineIcon size={size} paths="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 15V3M7 8l5-5 5 5" />;
const ArrowUpRight   = ({ size = 15 }: { size?: number }) => <LineIcon size={size} paths="M7 17L17 7M8 7h9v9" />;

function KpiCard({ label, value, icon, color = TEXT }: { label: string; value: string | number; icon: string; color?: string }) {
  const narrow = useIsNarrow(760); // tighter cards on mobile — less empty space
  return (
    <div style={{ background: CARD, border: `1px solid ${BDR2}`, borderRadius: 16, padding: narrow ? "10px 14px 9px" : "18px 20px 16px", position: "relative", overflow: "hidden", minWidth: 0 }}>
      <div style={{ position: "absolute", bottom: -10, insetInlineStart: -6, fontSize: narrow ? 38 : 58, opacity: 0.05, lineHeight: 1, userSelect: "none", pointerEvents: "none" }}>{icon}</div>
      <div style={{ fontSize: narrow ? 9.5 : 10.5, fontWeight: 700, color: MUTED, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: narrow ? 4 : 10 }}>{label}</div>
      <div style={{ fontSize: narrow ? 23 : 32, fontWeight: 900, color, letterSpacing: "-0.04em", lineHeight: 1 }}>{value}</div>
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

// ── Steven push-notifications opt-in (English; Steven only; rendered by the
//    parent behind an isSteven gate). Never requests permission on mount — only
//    reads the current state; the browser prompt fires ONLY on the button tap. ──
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
function vapidToUint8(base64: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr.buffer as ArrayBuffer;
}
type StevenPushState = "loading" | "unsupported" | "ios-needs-pwa" | "default" | "working" | "granted" | "denied";
function StevenPushCard() {
  const [state, setState] = useState<StevenPushState>("loading");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    if (!supported) {
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const standalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
      setState(isIOS && !standalone ? "ios-needs-pwa" : "unsupported");
      return;
    }
    // READ the current permission — this does NOT prompt.
    if (Notification.permission === "denied") { setState("denied"); return; }
    if (Notification.permission === "granted") {
      navigator.serviceWorker.getRegistration()
        .then(async (reg) => { const sub = reg ? await reg.pushManager.getSubscription() : null; setState(sub ? "granted" : "default"); })
        .catch(() => setState("default"));
      return;
    }
    setState("default");
  }, []);

  async function enable() {
    setErr(null);
    setState("working");
    try {
      const perm = await Notification.requestPermission(); // ← fires on tap only (user gesture)
      if (perm !== "granted") { setState(perm === "denied" ? "denied" : "default"); return; }
      await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      const sub = existing ?? await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidToUint8(VAPID_PUBLIC_KEY),
      });
      const res = await fetch("/api/supplier/steven/push-subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      if (!res.ok) throw new Error("save failed");
      setState("granted");
    } catch {
      setErr("Couldn't enable notifications. Please try again.");
      setState("default");
    }
  }

  if (state === "loading") return null;

  const actionable = state === "default" || state === "working";
  let sub: string | null = null; let subColor = MUTED;
  if (state === "granted")       { sub = "Notifications enabled"; subColor = GREEN; }
  else if (state === "denied")   sub = "Notifications blocked. Enable them in your iPhone settings.";
  else if (state === "ios-needs-pwa") sub = "Add this page to your Home Screen and open it from the icon to enable notifications.";
  else if (state === "unsupported")   sub = "Notifications are not supported on this device.";
  else if (actionable)           sub = "Get a push the moment a payment is confirmed.";

  return (
    <div style={{ background: CARD, border: `1px solid ${BDR2}`, borderRadius: 14, padding: "12px 16px", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
        <span style={{ color: TEXT2, display: "inline-flex", flexShrink: 0 }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0"/></svg>
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: TEXT }}>Notifications</div>
          {sub && <div style={{ fontSize: 11.5, color: subColor, marginTop: 2, lineHeight: 1.5 }}>{sub}</div>}
          {err && <div style={{ fontSize: 11.5, color: "#F87171", marginTop: 2 }}>{err}</div>}
        </div>
      </div>
      {actionable && (
        <button type="button" onClick={enable} disabled={state === "working"}
          style={{ fontSize: 12.5, fontWeight: 800, padding: "8px 16px", borderRadius: 10, border: "none", background: BRAND, color: "#fff", cursor: state === "working" ? "wait" : "pointer", fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0, opacity: state === "working" ? 0.7 : 1 }}>
          {state === "working" ? "Enabling…" : "Enable notifications"}
        </button>
      )}
    </div>
  );
}

export default function StevenProfilePage({ initialLang = "he", initialRole = null }: { initialLang?: Lang; initialRole?: "owner" | "victor" | "steven" | null }) {
  const router = useRouter();
  const [works, setWorks]   = useState<Work[]>([]);
  const [loading, setLoading] = useState(true); // initial page load only — never re-armed after create
  const [openId, setOpenId] = useState<string | null>(null);
  const [focusNotesId, setFocusNotesId] = useState<string | null>(null); // deep-link → scroll modal to shared comments (one-shot)
  const [openMaterialsId, setOpenMaterialsId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [payModal, setPayModal] = useState<{ workId: string; project: string } | null>(null); // "שולם" → date modal
  // Drag-to-reorder + full-row hover state (works table).
  const [dragId, setDragId]   = useState<string | null>(null); // row being dragged
  const [overId, setOverId]   = useState<string | null>(null); // current drop target
  const [hoverId, setHoverId] = useState<string | null>(null); // row under cursor (glow)
  // Signed-in role — derived from `clientRole ?? initialRole` so it's correct on the
  // VERY FIRST render (SSR + hydration), before useRole()'s /api/me resolves. We key
  // off `=== "steven"` (never `!isOwner`), so an unknown/null role is NON-owner and
  // never flashes the owner view.
  const clientRole = useRole();
  const effectiveRole = clientRole ?? initialRole;
  const isSteven = effectiveRole === "steven";
  // Positive owner gate — true ONLY for owner (never steven/victor/unknown/null),
  // so owner-only actions don't rely on "not steven".
  const isOwner = effectiveRole === "owner";

  // Language. Steven is ENGLISH-ONLY: the effective `lang` is forced to "en", the
  // toggle is hidden, and nothing is read from / written to localStorage. Owner/Victor
  // start from the server-provided initialLang ("he") and can toggle within the
  // session (not persisted — same as before).
  const [langState, setLangState] = useState<Lang>(initialLang);
  const lang = isSteven ? "en" : langState;
  const [toast, setToast]   = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const t = TR[lang];
  const rtl = lang === "he";
  const textStart = rtl ? "right" : "left";
  // Mobile layout: below 760px the desktop two-column body (jobs table + side
  // card) can't fit, so we stack to a single column and tighten the chrome.
  const narrow = useIsNarrow(760);

  function notify(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }

  // Load Steven's real work records from the existing API (also called after a
  // create so a new job is shown from the SERVER truth, never a local phantom).
  const reloadWorks = useCallback(async () => {
    try {
      // steven → sanitized supplier list (financials stripped, own works only);
      // owner → the full internal list.
      const url = isSteven ? "/api/supplier/steven" : "/api/sound-engineer?engineer=Steven";
      const r = await fetch(url);
      const d = (await r.json()) as { ok: boolean; works?: SoundEngineerWork[] };
      if (d.ok && d.works) setWorks(d.works.map(mapRecord));
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [isSteven]);
  useEffect(() => { void reloadWorks(); }, [reloadWorks]);

  // Deep link from a "New mix notes" push: /team/steven?work={id}&notes=1 opens
  // that work's modal and (notes=1) scrolls it to the shared comments. Parsed
  // ONCE on mount into a ref, then the query is stripped so a later refresh never
  // re-opens. NO push is sent here — this is pure client navigation. A plain
  // /team/steven visit (no ?work) is untouched.
  const deepLinkRef = useRef<{ id: string; notes: boolean } | null>(null);
  const [deepLinkReady, setDeepLinkReady] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") { setDeepLinkReady(true); return; }
    const sp = new URLSearchParams(window.location.search);
    const wid = sp.get("work");
    if (wid) {
      deepLinkRef.current = { id: wid, notes: sp.get("notes") === "1" };
      router.replace("/team/steven"); // clean URL → refresh won't reopen
    }
    setDeepLinkReady(true);
  }, [router]);
  // Apply the pending deep link once the works list has loaded (consume once).
  useEffect(() => {
    if (!deepLinkReady) return;
    const dl = deepLinkRef.current;
    if (!dl || !works.length) return;
    if (works.some(w => w.id === dl.id)) {
      setOpenId(dl.id);
      if (dl.notes) setFocusNotesId(dl.id);
    }
    deepLinkRef.current = null;
  }, [works, deepLinkReady]);

  // Presence beacon — fire once when Steven lands on his page. The SERVER decides
  // whether to actually push (login dedupe + 30-min visit cooldown), so a refresh
  // never spams; owner never fires this. NOT /api/push/check.
  useEffect(() => {
    if (!isSteven) return;
    fetch("/api/supplier/steven/ping", { method: "POST" }).catch(() => {});
  }, [isSteven]);

  const openWork = works.find(w => w.id === openId) ?? null;
  const materialsWork = works.find(w => w.id === openMaterialsId) ?? null;

  // Edit a work: optimistic local update + PATCH to the existing API for DB-backed rows.
  // Persisted fields: work_type, status, agreed_price. (pay/dates stay display-only here.)
  async function updateWork(id: string, patch: Partial<Work>): Promise<boolean> {
    if (isSteven) return false; // steven can't edit works (status/pay/price owner-only)
    const target = works.find(w => w.id === id);
    setWorks(prev => prev.map(w => {
      if (w.id !== id) return w;
      const next = { ...w, ...patch };
      // Payment status has no column — a pay choice is stored as amountPaid
      // (שולם → full price, לא שולם → 0). Keep the derived label in sync.
      if (patch.pay !== undefined) {
        next.amountPaid = patch.pay === "שולם" ? w.price : 0;
        next.pay = payFromAmounts(w.price, next.amountPaid);
        // "שולם" → paymentDate arrives in `patch` (from the modal); "לא שולם" clears it.
        if (patch.pay === "לא שולם") next.paymentDate = null;
      }
      if (patch.price !== undefined) next.pay = payFromAmounts(next.price, next.amountPaid);
      return next;
    }));
    if (!target || !target.dbBacked) return true; // manual "new work" rows are local-only

    // skipFinanceSync keeps these edits from creating/updating any Finance transaction.
    const body: Record<string, unknown> = { skipFinanceSync: true };
    if (patch.workType !== undefined) body.workType    = uiWorkTypeToDb(patch.workType);
    if (patch.status   !== undefined) body.status      = uiStatusToDb(patch.status);
    if (patch.price    !== undefined) body.agreedPrice = patch.price;
    if (patch.pay      !== undefined) body.amountPaid  = patch.pay === "שולם" ? target.price : 0;
    if (patch.notes    !== undefined) body.notes       = patch.notes;
    // Payment date: explicit value from the modal, or cleared when unmarking paid.
    if (patch.paymentDate !== undefined) body.paymentDate = patch.paymentDate;
    else if (patch.pay === "לא שולם")    body.paymentDate = null;
    if (Object.keys(body).length === 1) return true; // only the flag → nothing actually changed

    try {
      const res = await fetch(`/api/sound-engineer/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setWorks(prev => prev.map(w => (w.id === id ? target : w))); // revert on failure
        notify(rtl ? "השמירה נכשלה" : "Save failed");
        return false;
      }
      return true;
    } catch {
      setWorks(prev => prev.map(w => (w.id === id ? target : w))); // revert on failure
      notify(rtl ? "השמירה נכשלה" : "Save failed");
      return false;
    }
  }

  // After a paid/unpaid change is persisted, reconcile the linked Finance expense
  // (create/update when paid, delete when not) — safe, id-linked, owner-only route.
  async function syncPaymentExpense(id: string) {
    if (isSteven) return; // Finance is owner-only
    const target = works.find(w => w.id === id);
    if (!target || !target.dbBacked) return; // local-only rows never hit Finance
    try {
      const res = await fetch(`/api/sound-engineer/${id}/payment-expense`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) notify(rtl ? "סנכרון לכספים נכשל — בדוק ב-Finance" : "Finance sync failed — check Finance");
    } catch {
      notify(rtl ? "סנכרון לכספים נכשל — בדוק ב-Finance" : "Finance sync failed — check Finance");
    }
  }
  // Delete a job: optimistic remove + close, then DELETE for DB-backed rows.
  // Local-only rows ("+ עבודה חדשה") are just dropped from state. Removes ONLY
  // sound_engineer_work here — the linked project_action is not touched (no action
  // id on this page). Finance/transactions/Dropbox/projects are never deleted.
  async function deleteWork(id: string) {
    if (isSteven) return; // delete is owner-only
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

  // Move dragged work to just before the drop target, optimistically, then persist
  // the new order (owner-only route). Reverts + toasts on failure.
  async function reorderWorks(fromId: string, toId: string) {
    if (isSteven) return; // reorder is owner-only
    if (!fromId || fromId === toId) return;
    const prev = works;
    const moved = prev.find(w => w.id === fromId);
    if (!moved) return;
    const rest = prev.filter(w => w.id !== fromId);
    const at = rest.findIndex(w => w.id === toId);
    if (at < 0) return;
    const next = [...rest.slice(0, at), moved, ...rest.slice(at)];
    setWorks(next); // optimistic
    try {
      const res = await fetch("/api/sound-engineer/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: next.map(w => w.id) }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setWorks(prev); // revert
      notify(rtl ? "שמירת הסדר נכשלה" : "Reorder failed");
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
  // Payment history — paid works, newest payment first (legacy/no-date rows sort last).
  const paidWorks = [...works].filter(w => w.pay === "שולם").sort((a, b) => (b.paymentDate || "").localeCompare(a.paymentDate || ""));

  return (
    <div dir={rtl ? "rtl" : "ltr"} style={{ minHeight: "100%", background: BG, color: TEXT, fontFamily: "'Heebo', Arial, sans-serif", padding: narrow ? "16px 16px calc(104px + env(safe-area-inset-bottom))" : "32px 28px 80px", boxSizing: "border-box" }}>
      <div style={{ maxWidth: 1600, margin: "0 auto" }}>

        {/* Back to the /team list — owner only; Steven has just this one page. */}
        {!isSteven && <div style={{ marginBottom: 14 }}>
          <button onClick={() => router.push("/team")} style={{
            display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 10,
            background: CARD, border: `1px solid ${BDR2}`, color: TEXT2, fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
          }}>{t.back}</button>
        </div>}

        {/* ── Header ── */}
        <div style={{ display: "flex", flexDirection: narrow ? "column" : "row", alignItems: narrow ? "stretch" : "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 22 }}>
          {!isSteven ? (
            <button onClick={() => setNewOpen(true)} style={{
              padding: "10px 20px", borderRadius: 12, background: BRAND, border: "none", color: "#fff",
              fontSize: 14, fontWeight: 800, cursor: "pointer", fontFamily: "inherit",
              boxShadow: "0 2px 16px rgba(220,38,38,0.35)", whiteSpace: "nowrap",
            }}>{t.newWork}</button>
          ) : <div style={{ minWidth: 1 }} />}

          <div style={{ textAlign: "center", flex: 1, minWidth: 240 }}>
            <div style={{ fontSize: 12, color: MUTED, letterSpacing: "0.06em", marginBottom: 3 }}>{t.breadcrumb}</div>
            <h1 style={{ fontSize: narrow ? 23 : 30, fontWeight: 900, margin: 0, letterSpacing: "-0.02em" }}>{t.profileTitle} <span style={{ color: BRAND }}>Steven</span></h1>
            <div style={{ fontSize: 13, color: TEXT2, marginTop: 6 }}>{t.role}</div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: GREEN, boxShadow: `0 0 6px ${GREEN}88` }} />
              <span style={{ fontSize: 12, color: GREEN, fontWeight: 600 }}>{t.active}</span>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: narrow ? 0 : 280 }}>
            {/* Page-local language toggle (UI only) — owner/Victor only. Steven is
                English-only, so no toggle is shown and no language is persisted. */}
            {!isSteven && <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <div style={{ display: "inline-flex", gap: 4, background: CARD, border: `1px solid ${BDR2}`, borderRadius: 10, padding: 4 }}>
                {(["he", "en"] as const).map(l => {
                  const sel = lang === l;
                  return (
                    <button key={l} onClick={() => { setLangState(l); notify(l === "he" ? TR[l].langHe : TR[l].langEn); }} style={{
                      fontSize: 12, fontWeight: 800, padding: "5px 14px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
                      background: sel ? `${BRAND}1F` : "transparent", border: `1px solid ${sel ? BRAND + "66" : "transparent"}`, color: sel ? BRAND : TEXT2, transition: "all .12s",
                    }}>{l === "he" ? "עברית" : "English"}</button>
                  );
                })}
              </div>
            </div>}
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

        {/* Steven-only: enable iPhone/PWA push (user-gesture opt-in). Owner never sees this. */}
        {isSteven && <StevenPushCard />}

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
              <KpiCard label={t.kpiActive}    value={active}       icon="🎚" color={BLUE} />
              <KpiCard label={t.kpiDone}      value={done}         icon="✔" color={GREEN} />
              {/* Financial KPIs — read-only figures; shown to Steven too. */}
              <KpiCard label={t.kpiDebt}      value={fmt(debt)}    icon="👛" color={BRAND} />
              <KpiCard label={t.kpiPaidMonth} value={fmt(paidSum)} icon="💳" color={GREEN} />
            </>
          )}
        </div>

        {/* ── Main grid ── (jobs table + Payment History side card, both roles) */}
        {/* Mobile: single column so the jobs table isn't crushed by the 300px
            side card. minmax(0,1fr) lets the table's own overflow-x:auto wrapper
            shrink and scroll internally instead of overflowing the page. */}
        <div style={{ display: "grid", gridTemplateColumns: narrow ? "minmax(0, 1fr)" : "minmax(0, 2.4fr) minmax(300px, 1fr)", gap: 16, alignItems: "start" }}>

          <div style={sectionCard}>
            <div style={cardHead}>{t.soundJobs}</div>
            {narrow ? (
              /* Mobile: each job is a self-contained card (no wide desktop table
                 → no horizontal scroll). Same handlers as the table rows. */
              <div style={{ padding: "10px 12px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
                {loading ? (
                  <RowsSkeleton rows={4} height={96} pad="0" />
                ) : works.length === 0 ? (
                  <div style={{ padding: "34px 14px", textAlign: "center", fontSize: 13, color: MUTED }}>{t.noJobs}</div>
                ) : works.map(w => (
                  <div key={w.id} onClick={() => setOpenId(w.id)} style={{ background: CARD2, border: `1px solid ${BDR}`, borderRadius: 14, padding: 14, display: "flex", flexDirection: "column", gap: 12, cursor: "pointer", minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 14.5, fontWeight: 800, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.project}</div>
                        <div style={{ fontSize: 12, color: TEXT2, marginTop: 2 }}>{wtLabel(w.workType, lang)}</div>
                      </div>
                      <div onClick={e => e.stopPropagation()} style={{ flexShrink: 0 }}>
                        {isSteven ? (
                          <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 11px", borderRadius: 8, whiteSpace: "nowrap", background: `${STATUS_COLOR[w.status]}1A`, border: `1px solid ${STATUS_COLOR[w.status]}40`, color: STATUS_COLOR[w.status] }}>{statusLabel(w.status, lang)}</span>
                        ) : (
                          <InlineSelect value={w.status} display={statusLabel(w.status, lang)} color={STATUS_COLOR[w.status]} options={[{ value: "פעיל" as WorkStatus, label: statusLabel("פעיל", lang), color: STATUS_COLOR["פעיל"] }, { value: "הושלם" as WorkStatus, label: statusLabel("הושלם", lang), color: STATUS_COLOR["הושלם"] }]} onChange={v => updateWork(w.id, { status: v })} />
                        )}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "6px 16px", fontSize: 12 }}>
                      <span style={{ color: MUTED }}>{t.deadline}: <span style={{ color: TEXT2, fontWeight: 600 }}>{w.deadline || "—"}</span></span>
                      <span style={{ color: MUTED }}>{t.price}: <span style={{ color: TEXT, fontWeight: 800, direction: "ltr", unicodeBidi: "plaintext" } as React.CSSProperties}>{fmt(w.price)}</span></span>
                      <span onClick={e => e.stopPropagation()}>
                        {isSteven ? (
                          <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 11px", borderRadius: 8, whiteSpace: "nowrap", background: `${PAY_COLOR[w.pay]}1A`, border: `1px solid ${PAY_COLOR[w.pay]}40`, color: PAY_COLOR[w.pay] }}>{payLabel(w.pay, lang)}</span>
                        ) : (
                          <InlineSelect value={w.pay} display={payLabel(w.pay, lang)} color={PAY_COLOR[w.pay]} options={[{ value: "שולם" as PayStatus, label: payLabel("שולם", lang), color: PAY_COLOR["שולם"] }, { value: "לא שולם" as PayStatus, label: payLabel("לא שולם", lang), color: PAY_COLOR["לא שולם"] }]} onChange={v => { if (v === "שולם") setPayModal({ workId: w.id, project: w.project }); else void (async () => { const ok = await updateWork(w.id, { pay: v }); if (ok) await syncPaymentExpense(w.id); })(); }} />
                        )}
                      </span>
                    </div>
                    <div onClick={e => e.stopPropagation()} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      {/* Dark outline (not a solid white button) so it belongs to the dark UI. */}
                      <button onClick={() => setOpenMaterialsId(w.id)} style={{ fontSize: 11.5, fontWeight: 700, color: TEXT, padding: "7px 10px", borderRadius: 9, border: `1px solid ${BDR2}`, background: "rgba(255,255,255,0.05)", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}><SlidersIcon size={13} /> {t.wmButton}</button>
                      <button onClick={() => setOpenId(w.id)} style={{ fontSize: 11.5, fontWeight: 700, color: "#F0B24A", padding: "7px 10px", borderRadius: 9, border: "1px solid rgba(245,158,11,0.45)", background: "rgba(245,158,11,0.10)", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.openJob}</button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", minWidth: 660, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: CARD2 }}>
                    <th aria-hidden style={{ width: 26 }} />
                    {[t.project, t.workType, t.status, t.deadline, t.price, t.payment].map(h => (
                      <th key={h} style={{ padding: "10px 14px", textAlign: textStart, fontSize: 10, fontWeight: 700, color: MUTED, letterSpacing: "0.05em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                    {/* Actions column — subtle spotlight so the row-action area reads as one group */}
                    <th style={{ padding: "10px 14px", textAlign: "center", fontSize: 10, fontWeight: 800, color: "#E4DAC4", letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap", background: "radial-gradient(ellipse at center, rgba(245,158,11,0.12), rgba(245,158,11,0) 72%)" }}>{t.action}</th>
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
                    <tr key={w.id}
                      onClick={() => setOpenId(w.id)}
                      onMouseEnter={() => setHoverId(w.id)}
                      onMouseLeave={() => setHoverId(cur => (cur === w.id ? null : cur))}
                      onDragOver={e => { if (dragId) { e.preventDefault(); if (overId !== w.id) setOverId(w.id); } }}
                      onDrop={e => { if (dragId) { e.preventDefault(); void reorderWorks(dragId, w.id); } setDragId(null); setOverId(null); }}
                      style={{
                        borderTop: overId === w.id && dragId ? `2px solid ${BRAND}` : `1px solid ${BDR}`,
                        background: dragId === w.id ? "rgba(220,38,38,0.05)" : hoverId === w.id ? "rgba(220,38,38,0.08)" : (i % 2 ? "rgba(255,255,255,0.01)" : "transparent"),
                        opacity: dragId === w.id ? 0.5 : 1,
                        cursor: "pointer",
                        transition: "background 0.12s ease",
                      }}>
                      <td onClick={e => e.stopPropagation()} style={{ padding: "0 4px", textAlign: "center", width: 26 }}>
                        {/* Reorder handle — owner only. */}
                        {!isSteven && <span
                          draggable
                          onDragStart={e => { setDragId(w.id); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", w.id); } catch {} }}
                          onDragEnd={() => { setDragId(null); setOverId(null); }}
                          title={rtl ? "גרור לשינוי סדר" : "Drag to reorder"}
                          style={{ cursor: "grab", color: dragId === w.id ? BRAND : MUTED, fontSize: 15, lineHeight: 1, userSelect: "none", display: "inline-block", padding: "8px 2px" }}>⠿</span>}
                      </td>
                      <td style={{ padding: "11px 14px", fontSize: 13, fontWeight: 700, color: TEXT, whiteSpace: "nowrap" }}>{w.project}</td>
                      <td style={{ padding: "11px 14px", fontSize: 12, color: TEXT2, whiteSpace: "nowrap" }}>{wtLabel(w.workType, lang)}</td>
                      <td onClick={e => e.stopPropagation()} style={{ padding: "11px 14px" }}>
                        {isSteven ? (
                          // Steven: status is READ-ONLY (a colored badge, not a select).
                          <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 11px", borderRadius: 8, whiteSpace: "nowrap", background: `${STATUS_COLOR[w.status]}1A`, border: `1px solid ${STATUS_COLOR[w.status]}40`, color: STATUS_COLOR[w.status] }}>{statusLabel(w.status, lang)}</span>
                        ) : (
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
                        )}
                      </td>
                      <td style={{ padding: "11px 14px", fontSize: 12, color: MUTED, whiteSpace: "nowrap" }}>{w.deadline}</td>
                      {/* Price — read-only text for both roles. */}
                      <td style={{ padding: "11px 14px", fontSize: 12.5, color: TEXT, fontWeight: 700, whiteSpace: "nowrap", direction: "ltr", textAlign: textStart }}>{fmt(w.price)}</td>
                      {/* Payment — read-only badge for Steven; editable select for owner. */}
                      <td onClick={e => e.stopPropagation()} style={{ padding: "11px 14px" }}>
                        {isSteven ? (
                          <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 11px", borderRadius: 8, whiteSpace: "nowrap", background: `${PAY_COLOR[w.pay]}1A`, border: `1px solid ${PAY_COLOR[w.pay]}40`, color: PAY_COLOR[w.pay] }}>{payLabel(w.pay, lang)}</span>
                        ) : (
                          <InlineSelect
                            value={w.pay}
                            display={payLabel(w.pay, lang)}
                            color={PAY_COLOR[w.pay]}
                            options={[
                              { value: "שולם"    as PayStatus, label: payLabel("שולם",    lang), color: PAY_COLOR["שולם"]    },
                              { value: "לא שולם" as PayStatus, label: payLabel("לא שולם", lang), color: PAY_COLOR["לא שולם"] },
                            ]}
                            onChange={v => { if (v === "שולם") setPayModal({ workId: w.id, project: w.project }); else void (async () => { const ok = await updateWork(w.id, { pay: v }); if (ok) await syncPaymentExpense(w.id); })(); }}
                          />
                        )}
                      </td>
                      <td onClick={e => e.stopPropagation()} style={{ padding: "10px 14px", textAlign: "center" }}>
                        <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, flexWrap: "wrap" }}>
                          {/* Work Materials — light style, sits on the RIGHT (RTL first) */}
                          <button onClick={() => setOpenMaterialsId(w.id)} title={t.wmTitle}
                            onMouseEnter={e => { e.currentTarget.style.background = "#E9E9EF"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.35)"; e.currentTarget.style.boxShadow = "0 0 10px rgba(255,255,255,0.18)"; }}
                            onMouseLeave={e => { e.currentTarget.style.background = "#D7D7DD"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.18)"; e.currentTarget.style.boxShadow = "none"; }}
                            style={{ fontSize: 11, fontWeight: 800, color: "#1A1A20", padding: "5px 13px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.18)", background: "#D7D7DD", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", transition: "background 0.15s, box-shadow 0.15s, border-color 0.15s", display: "inline-flex", alignItems: "center", gap: 6 }}><SlidersIcon size={13} /> {t.wmButton}</button>
                          {/* Open Job — dark w/ amber/gold border, sits on the LEFT (RTL second) */}
                          <button onClick={() => setOpenId(w.id)}
                            onMouseEnter={e => { e.currentTarget.style.background = "rgba(245,158,11,0.20)"; e.currentTarget.style.borderColor = "rgba(245,158,11,0.70)"; }}
                            onMouseLeave={e => { e.currentTarget.style.background = "rgba(245,158,11,0.10)"; e.currentTarget.style.borderColor = "rgba(245,158,11,0.45)"; }}
                            style={{ fontSize: 11, fontWeight: 700, color: "#F0B24A", padding: "5px 13px", borderRadius: 10, border: "1px solid rgba(245,158,11,0.45)", background: "rgba(245,158,11,0.10)", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", transition: "background 0.15s, border-color 0.15s" }}>{t.openJob}</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}
          </div>

          {/* Side cards — Payment History (read-only; shown to Steven too). */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={sectionCard}>
              <div style={cardHead}>{t.payHistory}</div>
              {loading ? (
                <RowsSkeleton rows={3} height={38} pad="14px 18px" />
              ) : paidWorks.length === 0 ? (
                <div style={{ padding: "28px 16px", textAlign: "center", fontSize: 12.5, color: MUTED }}>{t.noPayments}</div>
              ) : (
                <div style={{ padding: "10px 14px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                  {paidWorks.map(w => (
                    <div key={w.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "9px 12px", background: CARD2, border: `1px solid ${BDR}`, borderRadius: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div title={w.project} style={{ fontSize: 12.5, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.project}</div>
                        <div style={{ fontSize: 11, color: MUTED, marginTop: 1 }}>{w.paymentDate ? fmtDbDate(w.paymentDate) : "—"}</div>
                      </div>
                      <div style={{ fontSize: 12.5, fontWeight: 800, color: GREEN, whiteSpace: "nowrap", direction: "ltr" }}>{fmt(w.amountPaid)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {openWork && <WorkModal work={openWork} isSteven={isSteven} isOwner={isOwner} focusNotes={focusNotesId === openWork.id} onChange={patch => updateWork(openWork.id, patch)} onDelete={() => deleteWork(openWork.id)} onClose={() => { setOpenId(null); setFocusNotesId(null); }} onOpenMaterials={() => { const id = openWork.id; setOpenId(null); setFocusNotesId(null); setOpenMaterialsId(id); }} notify={notify} lang={lang} t={t} />}
      {materialsWork && <WorkMaterialsModal work={materialsWork} isSteven={isSteven} isOwner={isOwner} onClose={() => setOpenMaterialsId(null)} onOpenWork={() => { const id = materialsWork.id; setOpenMaterialsId(null); setOpenId(id); }} notify={notify} lang={lang} t={t} />}
      {payModal && <PaymentDateModal project={payModal.project} initialDate={isoDay(0)} lang={lang} t={t} onClose={() => setPayModal(null)} onSave={async date => { const wid = payModal.workId; setPayModal(null); const ok = await updateWork(wid, { pay: "שולם", paymentDate: date }); if (ok) await syncPaymentExpense(wid); }} />}
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
function EmptyZone({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle?: string }) {
  return (
    <div style={{ margin: "14px 16px 16px", padding: "28px 20px", borderRadius: 14, border: `1.5px dashed ${BDR2}`, background: "rgba(255,255,255,0.015)", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 9 }}>
      <div style={{ width: 48, height: 48, borderRadius: "50%", background: `${BRAND}12`, border: `1px solid ${BRAND}30`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, color: BRAND }}>{icon}</div>
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
  // Optional A/B-compare hooks (Work Materials). onPlayStart fires when this player
  // begins playing; onTime reports currentTime on every tick. Both no-ops elsewhere.
  onPlayStart?: () => void; onTime?: (sec: number) => void;
  // Drag a comment marker to a new time. Absent → markers are click-to-seek only.
  onCommentMove?: (id: string, newTs: number) => void;
  // Cross-highlight with the shared list: report the marker under the cursor / being
  // dragged; activeCommentId (from the list) glows the matching marker here.
  onCommentHover?: (id: string) => void; onCommentLeave?: () => void; activeCommentId?: string | null;
}>(
function VersionPlayer({ url, title, roleLabel, roleColor, compact = false, shouldPlay, comments, onDownload, t, onPlayStart, onTime, onCommentMove, onCommentHover, onCommentLeave, activeCommentId }, ref) {
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
  const [dragC, setDragC]       = useState<{ id: string; ts: number; startX: number; moved: boolean } | null>(null); // marker being dragged

  const pct = dur > 0 ? Math.min(100, (cur / dur) * 100) : 0;
  // Mobile: tighten the waveform and transport so the card never forces a width
  // wider than a phone viewport (volume slider is dropped — device volume is used).
  const narrow = useIsNarrow(760);

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

  // Mobile forces a compact size regardless of the `compact` prop, so the
  // primary/compare players don't render at desktop scale on a phone.
  const tSize  = narrow ? 30 : (compact ? 32 : 38);
  const tBtn: React.CSSProperties = { width: tSize, height: tSize, borderRadius: "50%", flexShrink: 0, background: "rgba(255,255,255,0.05)", border: `1px solid ${BDR2}`, color: TEXT2, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit" };
  const waveH = narrow ? 40 : (compact ? 52 : 84);
  const bigBtn = narrow ? 40 : (compact ? 46 : 58);

  return (
    <div style={{ padding: narrow ? "10px 12px 11px" : (compact ? "12px 15px 14px" : "16px 18px 18px"), background: CARD2, border: `1px solid ${BDR}`, borderInlineStart: `3px solid ${roleColor}`, borderRadius: 14 }}>
      <audio
        ref={audioRef} src={url} preload="metadata"
        onLoadedMetadata={e => { setDur(e.currentTarget.duration || 0); setLoading(false); }}
        onCanPlay={() => setLoading(false)}
        onTimeUpdate={e => { setCur(e.currentTarget.currentTime); onTime?.(e.currentTarget.currentTime); }}
        onPlay={() => { setPlaying(true); onPlayStart?.(); }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => { setErr(true); setLoading(false); }}
      />

      {/* Header: role chip · filename · status · download */}
      <div style={{ display: "flex", alignItems: "center", gap: narrow ? 8 : 10, marginBottom: narrow ? 6 : (compact ? 9 : 12) }}>
        <span style={{ fontSize: narrow ? 10 : 11, fontWeight: 900, color: "#fff", padding: narrow ? "2px 9px" : "3px 11px", borderRadius: 8, background: roleColor, whiteSpace: "nowrap", flexShrink: 0 }}>{roleLabel}</span>
        <div title={title} style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, color: TEXT2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: "ltr", textAlign: "start", unicodeBidi: "plaintext" } as React.CSSProperties}>{title}</div>
        {/* Loading text is hidden on mobile so it never squeezes the title; errors still show. */}
        {(err || !narrow) && <span style={{ fontSize: 10.5, color: err ? RED : MUTED, whiteSpace: "nowrap", flexShrink: 0 }}>{err ? t.vAudioError : loading ? t.vAudioLoading : ""}</span>}
        {onDownload && <button onClick={onDownload} title={t.vDownload} style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0, background: "rgba(255,255,255,0.05)", border: `1px solid ${BDR2}`, color: TEXT2, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.6l3.3-3.3L16.7 12 12 16.7 7.3 12l1.4-1.7L12 13.6V3zM5 19h14v2H5z"/></svg></button>}
      </div>

      {/* Waveform + comment markers (LTR) */}
      <div style={{ direction: "ltr", position: "relative", marginTop: narrow ? 6 : 14 }}>
        <div
          ref={barRef}
          onPointerDown={e => { (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId); setDragging(true); seekAt(e.clientX); }}
          onPointerMove={e => { if (dragging) seekAt(e.clientX); }}
          onPointerUp={e => { setDragging(false); try { (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId); } catch {} }}
          style={{ display: "flex", alignItems: "flex-end", gap: narrow ? 1 : 2, height: waveH, cursor: "pointer", touchAction: "none" }}
        >
          {bars.map((h, i) => (
            <div key={i} style={{ flex: 1, minWidth: narrow ? 1 : 2, height: `${Math.round(h * 100)}%`, borderRadius: 2, background: i < playedBars ? `linear-gradient(180deg, #F87171, ${BRAND})` : "rgba(255,255,255,0.12)" }} />
          ))}
        </div>
        {dur > 0 && <div style={{ position: "absolute", top: -2, bottom: 0, left: `${pct}%`, width: 2, background: "#fff", opacity: 0.55, pointerEvents: "none" }} />}
        {dur > 0 && comments.map((c, i) => {
          const col  = roleColor; // each player shows only its own role's comments → role-colored markers
          const isDragging = dragC?.id === c.id;
          const ts   = isDragging ? dragC!.ts : c.timestampSeconds;
          const left = Math.min(100, Math.max(0, (ts / dur) * 100));
          const show = hoveredC === c.id || pinnedC === c.id;
          const linked = activeCommentId === c.id; // hovered from the shared list below
          const highlight = show || isDragging || linked;
          const canDrag = !!onCommentMove; // dur>0 already guaranteed by the outer guard
          return (
            <div key={c.id} style={{ position: "absolute", top: -9, left: `${left}%`, transform: "translateX(-50%)", zIndex: highlight ? 7 : 2 }}>
              {/* Floating comment bubble — hover / pinned; hidden while dragging (time chip shows instead) */}
              {show && !isDragging && (
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
              {/* Live time chip while dragging this marker */}
              {isDragging && dragC!.moved && (
                <div style={{ position: "absolute", bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)", padding: "3px 8px", borderRadius: 8, background: "#0D0D12", color: "#fff", fontSize: 11, fontWeight: 800, whiteSpace: "nowrap", border: `1px solid ${col}`, fontVariantNumeric: "tabular-nums", pointerEvents: "none" }}>{fmtTime(ts)}</div>
              )}
              <button title={`${fmtTime(c.timestampSeconds)} · ${c.commentText}`}
                onPointerDown={canDrag ? (e => { e.stopPropagation(); try { (e.currentTarget as HTMLButtonElement).setPointerCapture(e.pointerId); } catch {} onCommentHover?.(c.id); setDragC({ id: c.id, ts: c.timestampSeconds, startX: e.clientX, moved: false }); }) : undefined}
                onPointerMove={canDrag ? (e => {
                  if (dragC?.id !== c.id) return;
                  e.stopPropagation();
                  const bar = barRef.current; if (!bar) return;
                  const rect = bar.getBoundingClientRect();
                  const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
                  const newTs = ratio * dur;
                  const moved = dragC.moved || Math.abs(e.clientX - dragC.startX) > 3;
                  // Scrub THIS player to the marker's live position (preserves play/pause;
                  // seekTo only sets currentTime). Only once it's a real drag, so a plain
                  // click still seeks via pointerup, not mid-move.
                  if (moved) seekTo(newTs);
                  setDragC({ id: c.id, ts: newTs, startX: dragC.startX, moved });
                }) : undefined}
                onPointerUp={canDrag ? (e => {
                  e.stopPropagation();
                  try { (e.currentTarget as HTMLButtonElement).releasePointerCapture(e.pointerId); } catch {}
                  const d = dragC; setDragC(null);
                  if (!d || d.id !== c.id) return;
                  if (d.moved) { const nt = Math.min(Math.floor(dur), Math.max(0, Math.round(d.ts))); if (nt !== c.timestampSeconds) onCommentMove!(c.id, nt); onCommentLeave?.(); }
                  else { seekTo(c.timestampSeconds); setPinnedC(c.id); }
                }) : undefined}
                onClick={canDrag ? undefined : (() => { seekTo(c.timestampSeconds); setPinnedC(c.id); })}
                onMouseEnter={() => { setHoveredC(c.id); onCommentHover?.(c.id); }} onMouseLeave={() => { setHoveredC(cur => (cur === c.id ? null : cur)); onCommentLeave?.(); }}
                style={{ display: "block", width: 20, height: 20, borderRadius: "50%", background: col, color: "#fff", border: `2px solid ${CARD}`, fontSize: 10, fontWeight: 800, cursor: canDrag ? (isDragging ? "grabbing" : "grab") : "pointer", lineHeight: "16px", textAlign: "center", boxShadow: highlight ? `0 0 0 3px ${col}66, 0 0 10px ${col}` : "none", transform: highlight ? "scale(1.18)" : "scale(1)", transition: "box-shadow .14s ease, transform .14s ease", touchAction: "none", userSelect: "none" } as React.CSSProperties}>{i + 1}</button>
            </div>
          );
        })}
      </div>

      {/* Transport: time · controls · volume */}
      <div style={{ display: "flex", alignItems: "center", gap: narrow ? 8 : 12, marginTop: narrow ? 8 : (compact ? 10 : 16), direction: "ltr" }}>
        <span style={{ fontSize: 12, color: TEXT2, fontVariantNumeric: "tabular-nums", minWidth: narrow ? 0 : 92, whiteSpace: "nowrap", flexShrink: 0 }}>{fmtTime(cur)} <span style={{ color: MUTED }}>/ {fmtTime(dur)}</span></span>

        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: narrow ? 8 : 12, minWidth: 0 }}>
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

        {/* Volume — hidden on mobile (device volume is used); keeps the transport
            row from overflowing a phone viewport. */}
        {!narrow && (
          <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 92 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill={MUTED}><path d="M3 10v4h4l5 5V5L7 10H3zm13.5 2A4.5 4.5 0 0014 8v8a4.5 4.5 0 002.5-4z"/></svg>
            <input type="range" min={0} max={1} step={0.01} value={vol} onChange={e => setVol(Number(e.target.value))} style={{ width: 72, accentColor: BRAND, cursor: "pointer" }} />
          </div>
        )}
      </div>
    </div>
  );
});

// ── "Open Job" modal — clean workboard: instructions / versions / player ─────────
function WorkModal({ work, isSteven, isOwner, focusNotes = false, onChange, onDelete, onClose, onOpenMaterials, notify, lang, t }: { work: Work; isSteven: boolean; isOwner: boolean; focusNotes?: boolean; onChange: (patch: Partial<Work>) => void; onDelete: () => void; onClose: () => void; onOpenMaterials: () => void; notify: (m: string) => void; lang: Lang; t: T }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const rtl = lang === "he";
  // Endpoint base by role: steven → sanitized supplier surface; owner → internal.
  // versions/comments SUFFIXES match; only the prefix (and /work for versions) differ.
  const API = isSteven ? "/api/supplier/steven" : "/api/sound-engineer";
  const versionsUrl = isSteven ? `/api/supplier/steven/work/${work.id}/versions` : `/api/sound-engineer/${work.id}/versions`;
  const commentsUrl = (vid: string) => `${API}/versions/${vid}/comments`;
  const commentUrl  = (cid: string) => `${API}/comments/${cid}`;
  const narrow = useIsNarrow(760);

  // ── Mix versions (Phase 2) — real data from /api/sound-engineer/{workId}/versions
  const [versions, setVersions]   = useState<MixVersion[] | null>(null); // null = loading
  const [vLoadErr, setVLoadErr]   = useState(false);
  const [uploading, setUploading] = useState(false);
  const [drag, setDrag]           = useState(false);
  // Per-file role picker shown after files are chosen (before upload).
  const [rolePicker, setRolePicker] = useState<{ mode: "new" | "existing"; items: { file: File; role: FileRole }[]; label?: string } | null>(null);
  const [upProgress, setUpProgress] = useState<{ done: number; total: number; current: string } | null>(null); // batch upload progress
  const [rpError, setRpError]       = useState<string | null>(null); // inline error in the role picker
  const [delVersion, setDelVersion] = useState<MixVersion | null>(null);
  const [sel, setSel]             = useState<string | null>(null);                        // selected version id
  const [playReq, setPlayReq]     = useState<{ id: string; nonce: number } | null>(null); // explicit play request
  const newVersionInputRef = useRef<HTMLInputElement | null>(null);
  const addFileInputRef = useRef<HTMLInputElement | null>(null);

  // ── Timestamp comments for the selected version ──────────────────────────────
  const [comments, setComments]   = useState<MixComment[] | null>(null); // null = loading
  const [cLoadErr, setCLoadErr]   = useState(false);
  // Deep-link (?notes=1): scroll to the shared-comments block ONCE, after the
  // comments have loaded. No highlight / glow / animation.
  const notesRef = useRef<HTMLDivElement>(null);
  const notesScrolledRef = useRef(false);
  useEffect(() => {
    if (!focusNotes || comments === null || notesScrolledRef.current) return;
    notesScrolledRef.current = true;
    notesRef.current?.scrollIntoView({ block: "start" });
  }, [focusNotes, comments]);

  // "Send notes" → owner-only route builds the text SERVER-SIDE and pushes an
  // IDENTICAL "New mix notes" notification to owner + Steven. Manual click ONLY
  // (never on load / refresh / comment-add). No dedup: repeatable by design; the
  // in-flight guard just blocks a double-tap.
  const [sendingNotes, setSendingNotes] = useState(false);
  async function sendNotes() {
    if (sendingNotes) return;
    setSendingNotes(true);
    try {
      const res = await fetch(`/api/sound-engineer/${work.id}/notify-notes`, { method: "POST" });
      const d = await res.json().catch(() => ({} as { ok?: boolean }));
      if (res.ok && d.ok) notify(t.sendNotesSent);
      else throw new Error();
    } catch {
      notify(t.sendNotesFail);
    } finally {
      setSendingNotes(false);
    }
  }
  const [adding, setAdding]       = useState(false);
  const [addTs, setAddTs]         = useState(0);
  const [newText, setNewText]     = useState("");
  const [savingC, setSavingC]     = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText]   = useState("");
  const [delC, setDelC]           = useState<MixComment | null>(null);
  const [addRole, setAddRole]     = useState<FileRole | null>(null); // role the new comment attaches to
  const [rolePick, setRolePick]   = useState(false);                 // fallback picker when no active player
  const [hoverCommentId, setHoverCommentId] = useState<string | null>(null); // cross-highlight marker ⇄ shared list
  const playerRefs = useRef<Record<string, VersionPlayerHandle | null>>({}); // per-file player handles (by file id)
  const lastActiveIdRef = useRef<string | null>(null);               // file id of the last-played stacked player
  const byTs = (a: MixComment, b: MixComment) => a.timestampSeconds - b.timestampSeconds;

  // Load the selected logical version's comments (keyed on the group's primary
  // file id, so all stacked players share one thread).
  useEffect(() => {
    if (!sel) { setComments(null); return; }
    let alive = true;
    setComments(null); setCLoadErr(false); setAdding(false); setEditingId(null); setRolePick(false);
    lastActiveIdRef.current = null;
    fetch(commentsUrl(sel))
      .then(r => r.json())
      .then(d => { if (!alive) return; if (d.ok) setComments((d.comments ?? []).slice().sort(byTs)); else setCLoadErr(true); })
      .catch(() => { if (alive) setCLoadErr(true); });
    return () => { alive = false; };
  }, [sel]);

  // Decide which role the new comment belongs to: the last-played stacked player,
  // else the sole audio player, else fall back to a small role picker.
  function openAddComment() {
    const active = lastActiveIdRef.current ? audioFiles.find(f => f.id === lastActiveIdRef.current) : null;
    const target = active ?? (audioFiles.length === 1 ? audioFiles[0] : null);
    if (!target) { setNewText(""); setAdding(false); setRolePick(true); return; }
    const ts = Math.max(0, Math.floor(playerRefs.current[target.id]?.getCurrentTime() ?? 0));
    setAddRole(target.role); setAddTs(ts); setNewText(""); setRolePick(false); setAdding(true);
  }
  // Picker choice → open the add form for that role (time from the primary player if any).
  function chooseAddRole(role: FileRole) {
    const pid = playerPrimaryId;
    const ts = Math.max(0, Math.floor((pid ? playerRefs.current[pid]?.getCurrentTime() : 0) ?? 0));
    setAddRole(role); setAddTs(ts); setNewText(""); setRolePick(false); setAdding(true);
  }
  function saveNewComment() {
    const text = newText.trim();
    if (!text || !sel || savingC) return;
    setSavingC(true);
    fetch(commentsUrl(sel), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timestampSeconds: addTs, commentText: text, role: addRole }),
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
    fetch(commentUrl(c.id), {
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
    fetch(commentUrl(c.id), { method: "DELETE" })
      .then(r => r.json())
      .then(d => { if (!d.ok) { setComments(prev); notify(rtl ? "המחיקה נכשלה" : "Delete failed"); } })
      .catch(() => { setComments(prev); notify(rtl ? "המחיקה נכשלה" : "Delete failed"); });
  }
  // Drag a marker → new timestamp (same comment id → same role only). Optimistic + revert.
  function moveComment(id: string, newTs: number) {
    const prev = comments;
    const target = prev?.find(x => x.id === id);
    if (!target || target.timestampSeconds === newTs) return;
    setComments(cur => cur ? cur.map(x => (x.id === id ? { ...x, timestampSeconds: newTs } : x)).sort(byTs) : null);
    fetch(commentUrl(id), {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ timestampSeconds: newTs }),
    })
      .then(r => r.json())
      .then(d => { if (!d.ok) { setComments(prev); notify(rtl ? "עדכון הזמן נכשל" : "Failed to update time"); } })
      .catch(() => { setComments(prev); notify(rtl ? "עדכון הזמן נכשל" : "Failed to update time"); });
  }

  useEffect(() => {
    let alive = true;
    setVersions(null); setVLoadErr(false);
    fetch(versionsUrl)
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
      const d = await fetch(versionsUrl, { method: "POST", body: fd }).then(r => r.json());
      if (d.ok && d.version) return d.version as MixVersion;
      return null; // caller (runRolePickerUpload) shows a friendly inline error
    } catch { return null; }
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

  // Confirm the picker → upload each file with its chosen role, one at a time, with
  // a visible per-file counter. On failure it STOPS with an inline error, keeps the
  // modal + role choices, and drops the already-succeeded files so a retry continues
  // WITHOUT duplicating (the version label is carried so remaining files join it).
  async function runRolePickerUpload() {
    const picker = rolePicker;
    if (!picker || picker.items.length === 0 || uploading) return;
    const total = picker.items.length;
    // Established version label: an existing-version selection, or one carried from a
    // previous partial attempt. Empty for a fresh "new" batch (first file creates it).
    let label: string | undefined = picker.label ?? (picker.mode === "existing" ? selectedGroup?.label : undefined);
    if (picker.mode === "existing" && !label) return;
    setUploading(true); setRpError(null);
    const created: MixVersion[] = [];
    try {
      for (let i = 0; i < total; i++) {
        const it = picker.items[i];
        setUpProgress({ done: i, total, current: it.file.name });
        const v = label
          ? await postOneFile(it.file, { label, addToExisting: true, role: it.role })
          : await postOneFile(it.file, { role: it.role }); // first file of a NEW version
        if (!v) {
          // Persist what succeeded (so it isn't lost / re-uploaded), carry the label,
          // and keep only the remaining files in the picker for a clean retry.
          if (created.length > 0) {
            setVersions(prev => [...created, ...(prev ?? [])]);
            if (picker.mode === "new" && !picker.label) setSel(created[0].id);
          }
          setRolePicker({ mode: picker.mode, items: picker.items.slice(i), label });
          setRpError(rtl ? "העלאת קובץ נכשלה — נסה שוב" : "A file failed to upload — try again");
          return;
        }
        if (!label) label = v.label; // first NEW file established the version label
        created.push(v);
      }
      setUpProgress({ done: total, total, current: "" });
      setVersions(prev => [...created, ...(prev ?? [])]);
      if (picker.mode === "new" && !picker.label && created[0]) setSel(created[0].id);
      notify(t.vUploaded);
      setRolePicker(null);
    } catch {
      setRpError(rtl ? "העלאה נכשלה — נסה שוב" : "Upload failed — try again");
    } finally {
      setUploading(false);
      setUpProgress(null);
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

  // Audio players in the selected version (archives are download-only rows, not players).
  const audioFiles = useMemo(() => (selectedGroup?.files ?? []).filter(f => isAudioName(f.fileName)), [selectedGroup]);
  const playerPrimaryId = useMemo(() => (audioFiles.find(f => f.id === primary?.id) ?? audioFiles[0])?.id, [audioFiles, primary]);
  // A comment's logical role, or null = legacy/shared (כללי).
  const roleOfComment = (c: MixComment): FileRole | null =>
    (c.role === "mix" || c.role === "acapella" || c.role === "instrumental" || c.role === "stems") ? c.role : null;
  // Shared-list display order (RENDER ONLY — never mutates content/timestamps/DB):
  // fixed file-type order Mix → Instrumental → Acapella (→ stems → legacy/null),
  // then within a group by song timestamp, then created_at. Numbering is rebuilt
  // from this sorted order.
  const COMMENT_ROLE_RANK: Record<string, number> = { mix: 0, instrumental: 1, acapella: 2, stems: 3 };
  const commentSort = (a: MixComment, b: MixComment): number => {
    const ra = COMMENT_ROLE_RANK[roleOfComment(a) ?? ""] ?? 4;
    const rb = COMMENT_ROLE_RANK[roleOfComment(b) ?? ""] ?? 4;
    if (ra !== rb) return ra - rb;
    if (a.timestampSeconds !== b.timestampSeconds) return a.timestampSeconds - b.timestampSeconds;
    return (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
  };
  // Bottom-list playback: the player matching the comment's role, else the primary player.
  const playerForComment = (c: MixComment): VersionPlayerHandle | null => {
    const r = roleOfComment(c);
    const f = r ? audioFiles.find(af => af.role === r) : null;
    const id = f?.id ?? playerPrimaryId;
    return id ? (playerRefs.current[id] ?? null) : null;
  };

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
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 100001, background: "rgba(0,0,0,0.72)", backdropFilter: "blur(4px)", display: "flex", alignItems: narrow ? "stretch" : "center", justifyContent: "center", padding: narrow ? 10 : 24 }}>
      <div onClick={e => e.stopPropagation()} dir={rtl ? "rtl" : "ltr"} style={{
        background: CARD, border: `1px solid ${BRAND}33`, borderRadius: 20, width: narrow ? "100%" : "min(1400px, 97vw)", maxWidth: "100%", maxHeight: "94vh",
        display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: `0 24px 90px rgba(0,0,0,0.9), 0 0 60px ${BRAND}10`, fontFamily: "'Heebo', Arial, sans-serif",
      }}>
        {/* Header — version title · Steven · last updated */}
        <div style={{ padding: narrow ? "11px 14px 10px" : "18px 24px 16px", borderBottom: `1px solid ${BDR}`, flexShrink: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 10.5, fontWeight: 800, color: MUTED, letterSpacing: "0.09em", textTransform: "uppercase", marginBottom: narrow ? 2 : 5 }}>{t.jobEyebrow}</div>
              <div title={groupTitle} style={{ fontSize: narrow ? 19 : 23, fontWeight: 900, color: TEXT, lineHeight: 1.15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{groupTitle}</div>
              <div style={{ display: "flex", alignItems: "center", gap: narrow ? 7 : 9, marginTop: narrow ? 6 : 10, flexWrap: "wrap" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 800, color: TEXT2, padding: "3px 10px", borderRadius: 999, background: "rgba(255,255,255,0.05)", border: `1px solid ${BDR2}` }}><HeadphonesIcon size={12} /> Steven</span>
                {primary && <span style={{ fontSize: narrow ? 11 : 11.5, color: MUTED }}>{t.headerUpdated}: <span style={{ direction: "ltr", unicodeBidi: "plaintext" } as React.CSSProperties}>{fmtDateTime(primary.updatedAt)}</span></span>}
              </div>
            </div>
            <button onClick={onClose} aria-label="Close" style={{ width: narrow ? 30 : 34, height: narrow ? 30 : 34, borderRadius: "50%", background: "rgba(255,255,255,0.06)", border: `1px solid ${BDR2}`, color: TEXT2, cursor: "pointer", flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
          </div>
        </div>

        {/* Body — 3-column workboard: versions/files (left) · players+comments (center) · details (right) */}
        <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "thin", padding: narrow ? "14px 14px calc(20px + env(safe-area-inset-bottom))" : "18px 22px" }}>
          <div style={{ display: "grid", gridTemplateColumns: narrow ? "minmax(0, 1fr)" : "300px minmax(0, 1fr) 320px", gap: 16, alignItems: "start" }}>

            {/* ═══ LEFT: versions · upload · project files · Dropbox ═══ */}
            <div style={{ ...colWrap, order: narrow ? 2 : 1 }}>
              {/* Versions for project */}
              <div style={subCard}>
                <div style={{ ...innerHead, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><MusicIcon /> {t.versionsForProject}</span>
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
                          {/* Delete a whole version — owner only. */}
                          {!isSteven && <button onClick={e => { e.stopPropagation(); setDelVersion(g.primary); }} title={t.vDelYes}
                            style={{ background: "none", border: "none", color: "#7A4A4A", fontSize: 13, cursor: "pointer", flexShrink: 0 }}
                            onMouseEnter={e => (e.currentTarget.style.color = RED)} onMouseLeave={e => (e.currentTarget.style.color = "#7A4A4A")}>🗑</button>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Upload — new version (dropzone). Distinct amber accent so the
                  action area reads apart from the static info cards. */}
              <div style={{ ...subCard, border: "1px solid rgba(245,158,11,0.28)" }}>
                <div style={innerHead}><span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><UploadIcon /> {t.uploadFiles}</span></div>
                <div style={{ padding: "12px 14px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
                  <input ref={newVersionInputRef} type="file" multiple accept=".wav,.mp3,.m4a,.aiff,.aif,.flac,.ogg,.zip,.rar,.7z" style={{ display: "none" }} onChange={e => openRolePicker("new", e.target.files)} />
                  <input ref={addFileInputRef} type="file" multiple accept=".wav,.mp3,.m4a,.aiff,.aif,.flac,.ogg,.zip,.rar,.7z" style={{ display: "none" }} onChange={e => openRolePicker("existing", e.target.files)} />
                  {/* Dropzone → NEW version */}
                  <div
                    onClick={() => { if (!uploading) newVersionInputRef.current?.click(); }}
                    onDragOver={e => { e.preventDefault(); if (!uploading && !drag) setDrag(true); }}
                    onDragLeave={e => { e.preventDefault(); setDrag(false); }}
                    onDrop={e => { e.preventDefault(); setDrag(false); if (!uploading) openRolePicker("new", e.dataTransfer.files); }}
                    style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, textAlign: "center", padding: "16px 12px", borderRadius: 12, cursor: uploading ? "default" : "pointer", border: `2px dashed ${drag ? "#F59E0B" : "rgba(245,158,11,0.42)"}`, background: drag ? "rgba(245,158,11,0.12)" : "rgba(245,158,11,0.05)", transition: "all .15s" }}
                  >
                    <div style={{ opacity: 0.9, color: drag ? "#F59E0B" : "#D89A3A", display: "flex", justifyContent: "center" }}><UploadIcon size={26} /></div>
                    <div style={{ fontSize: 12.5, fontWeight: 800, color: uploading ? BRAND : TEXT }}>{uploading ? t.vUploading : t.uploadNewVersionBtn}</div>
                    <div style={{ fontSize: 10, color: MUTED }}>{t.uploadHint}</div>
                  </div>
                  {/* "Add file to this version" now lives in the center "Version
                      files" card header (it acts on the SELECTED version, not general
                      upload). The hidden addFileInputRef input stays here. */}
                </div>
              </div>

              {/* Project files (files of the selected version) */}
              <div style={subCard}>
                <div style={innerHead}><span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><FolderIcon /> {t.projectFiles}</span></div>
                <div style={{ padding: "10px 12px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
                  {!selectedGroup ? (
                    <div style={{ fontSize: 12, color: MUTED, textAlign: "center", padding: "8px 0" }}>—</div>
                  ) : selectedGroup.files.map(f => {
                    const dName = fileDisplayName(work.project, selectedGroup.label, f.role);
                    return (
                    <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", borderRadius: 10, background: CARD, border: `1px solid ${BDR}` }}>
                      <span style={{ width: 26, height: 26, borderRadius: 7, flexShrink: 0, background: `${ROLE_COLOR[f.role]}22`, color: ROLE_COLOR[f.role], display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{isAudioName(f.fileName) ? <MusicIcon size={14} /> : <BoxIcon size={14} />}</span>
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

              {/* Work Materials shortcut — neutral secondary card (below project
                  files, above Dropbox). Jumps to what we SENT the engineer. */}
              <button type="button" onClick={onOpenMaterials}
                style={{ width: "100%", textAlign: rtl ? "right" : "left", display: "flex", alignItems: "center", gap: 11, padding: "11px 13px", borderRadius: 12, fontFamily: "inherit", cursor: "pointer", background: "rgba(255,255,255,0.05)", border: `1px solid ${BDR2}` }}
                onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.09)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.borderColor = BDR2; }}>
                <span style={{ flexShrink: 0, opacity: 0.9, color: TEXT2, display: "inline-flex" }}><SlidersIcon size={18} /></span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 12.5, fontWeight: 800, color: TEXT }}>{t.wmButton}</span>
                  <span style={{ display: "block", fontSize: 10.5, color: MUTED, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.wmMatSub}</span>
                </span>
                <span style={{ color: TEXT2, flexShrink: 0, display: "inline-flex" }}><ArrowUpRight size={16} /></span>
              </button>

              {/* Dropbox folder — exposes a raw project path → owner only (hidden from Steven). */}
              {!isSteven && <button onClick={openMixFolder} disabled={!mixFolderPath} title={mixFolderPath ? undefined : t.vFolderPending}
                style={{ width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 12, fontWeight: 700, padding: "10px 12px", borderRadius: 12, fontFamily: "inherit", background: mixFolderPath ? "rgba(0,98,238,0.10)" : "rgba(255,255,255,0.03)", border: `1px solid ${mixFolderPath ? "rgba(0,98,238,0.28)" : BDR2}`, color: mixFolderPath ? "#4A9EFF" : MUTED, cursor: mixFolderPath ? "pointer" : "default" }}>
                {t.openMixFolder}
              </button>}

              {/* Send notes — OWNER ONLY (positive isOwner). Manual click fires an
                  identical "New mix notes" push to owner + Steven via the
                  owner-gated notify-notes route. NEVER auto-fires. Same size/width
                  as the Dropbox button, purple to signal a different action. */}
              {isOwner && <button type="button" onClick={sendNotes} disabled={sendingNotes}
                onMouseEnter={e => { if (sendingNotes) return; e.currentTarget.style.background = "rgba(168,85,247,0.20)"; e.currentTarget.style.borderColor = "rgba(168,85,247,0.60)"; }}
                onMouseLeave={e => { if (sendingNotes) return; e.currentTarget.style.background = "rgba(168,85,247,0.10)"; e.currentTarget.style.borderColor = "rgba(168,85,247,0.35)"; }}
                style={{ width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 12, fontWeight: 700, padding: "10px 12px", borderRadius: 12, marginTop: 8, fontFamily: "inherit", background: "rgba(168,85,247,0.10)", border: "1px solid rgba(168,85,247,0.35)", color: "#C084FC", cursor: sendingNotes ? "wait" : "pointer", opacity: sendingNotes ? 0.7 : 1, transition: "background 0.15s, border-color 0.15s" }}>
                {sendingNotes ? t.wmSending : t.sendNotes}
              </button>}
            </div>

            {/* ═══ CENTER: version files (players) · add-comment action (shared list is full-width below) ═══ */}
            <div style={{ ...colWrap, order: narrow ? 1 : 2 }}>
              {/* Version files — up to 3 stacked players */}
              <div style={subCard}>
                <div style={{ padding: "13px 16px", borderBottom: `1px solid ${BDR}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 800, color: TEXT, display: "inline-flex", alignItems: "center", gap: 7 }}><MusicIcon size={16} /> {t.versionFiles}</div>
                    <div style={{ fontSize: 11.5, color: MUTED, marginTop: 3 }}>{t.versionFilesSub}</div>
                  </div>
                  {selectedGroup && (
                    <button
                      onClick={() => { if (!uploading) addFileInputRef.current?.click(); }}
                      disabled={uploading}
                      title={selectedGroup.label}
                      style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 11.5, fontWeight: 800, padding: "7px 13px", borderRadius: 10, fontFamily: "inherit", cursor: uploading ? "default" : "pointer", background: `${BRAND}16`, border: `1px solid ${BRAND}45`, color: BRAND, opacity: uploading ? 0.6 : 1, whiteSpace: "nowrap" }}>
                      {t.addToVersionBtn}: {selectedGroup.label}
                    </button>
                  )}
                </div>
                <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
                  {vLoadErr ? (
                    <div style={{ padding: "18px 0", fontSize: 12.5, color: RED, textAlign: "center" }}>{t.vLoadFailed}</div>
                  ) : (versions === null || (groups.length > 0 && !selectedGroup)) ? (
                    <PlayerSkeleton />
                  ) : selectedGroup ? (() => {
                    // Players ONLY for audio files. Archives (stems/zip/rar) live
                    // in "project files" as download rows, never as a player.
                    const stemsCount = selectedGroup.files.length - audioFiles.length;
                    return (
                      <>
                        {audioFiles.map(f => (
                          <VersionPlayer
                            key={f.id}
                            ref={el => { playerRefs.current[f.id] = el; }}
                            url={f.url}
                            title={fileDisplayName(work.project, selectedGroup.label, f.role)}
                            roleLabel={roleLabel(f.role, lang)}
                            roleColor={ROLE_COLOR[f.role]}
                            compact={f.id !== playerPrimaryId}
                            shouldPlay={playReq?.id === f.id ? playReq.nonce : 0}
                            comments={(comments ?? []).filter(c => c.role === f.role)}
                            onPlayStart={() => { lastActiveIdRef.current = f.id; }}
                            onCommentMove={isSteven ? undefined : moveComment}
                            onCommentHover={setHoverCommentId}
                            onCommentLeave={() => setHoverCommentId(null)}
                            activeCommentId={hoverCommentId}
                            onDownload={() => window.open(f.url, "_blank", "noopener,noreferrer")}
                            t={t}
                          />
                        ))}
                        {audioFiles.length === 0 && (
                          <div style={{ padding: "20px 0" }}><EmptyZone icon={<HeadphonesIcon size={22} />} title={t.pNoVersionsTitle} subtitle={t.pNoVersionsSub} /></div>
                        )}
                        {stemsCount > 0 && (
                          <div style={{ fontSize: 11, color: MUTED, textAlign: "center", padding: "2px 0", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%" }}>
                            <BoxIcon size={13} /> {stemsCount} {lang === "en" ? "archive file(s) — see project files" : "קבצי ערוצים/ארכיון — ראה קבצי הפרויקט"}
                          </div>
                        )}
                      </>
                    );
                  })() : (
                    <div style={{ padding: "26px 0" }}><EmptyZone icon={<HeadphonesIcon size={22} />} title={t.pNoVersionsTitle} subtitle={t.pNoVersionsSub} /></div>
                  )}
                </div>
              </div>

              {/* Add-a-comment action — owner only. Steven's comments are view-only
                  (phase 1); creation is blocked here AND server-side. */}
              {selectedGroup && !isSteven && (
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button onClick={openAddComment}
                    style={{ flex: "1 1 200px", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 12, fontWeight: 800, padding: "10px 14px", borderRadius: 11, fontFamily: "inherit", cursor: "pointer", background: "rgba(255,255,255,0.04)", border: `1px solid ${BDR2}`, color: TEXT2 }}
                    onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.07)"; e.currentTarget.style.color = TEXT; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.color = TEXT2; }}>
                    💬 {t.cAdd}
                  </button>
                </div>
              )}

            </div>

            {/* ═══ RIGHT: version details · job details · instructions ═══ */}
            <div style={{ ...colWrap, order: 3 }}>
              {/* Version details */}
              <div style={subCard}>
                <div style={innerHead}><span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><InfoIcon /> {t.versionDetails}</span></div>
                <div style={{ padding: "6px 16px 14px" }}>
                  {detailRow(t.vName, <span style={{ fontSize: 12.5, fontWeight: 800, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedGroup?.label ?? "—"}</span>)}
                  {detailRow(t.vCreator, <span style={{ fontSize: 12.5, fontWeight: 700, color: TEXT }}>{primary?.uploadedBy || "Steven"}</span>)}
                  {detailRow(t.vCreatedAt, <span style={{ fontSize: 12, fontWeight: 700, color: TEXT, direction: "ltr", unicodeBidi: "plaintext" } as React.CSSProperties}>{primary ? fmtDateTime(primary.createdAt) : "—"}</span>)}
                  {detailRow(t.vUpdatedAt, <span style={{ fontSize: 12, fontWeight: 700, color: TEXT, direction: "ltr", unicodeBidi: "plaintext" } as React.CSSProperties}>{primary ? fmtDateTime(primary.updatedAt) : "—"}</span>)}
                  {detailRow(t.vFileCount, <span style={{ fontSize: 12.5, fontWeight: 700, color: TEXT }}>{selectedGroup ? `${selectedGroup.files.length} ${lang === "en" ? "files" : "קבצים"}` : "—"}</span>)}
                  {detailRow(t.vTotalSize, <span style={{ fontSize: 12.5, fontWeight: 700, color: TEXT }}>{totalSize > 0 ? fmtBytes(totalSize) : "—"}</span>)}
                </div>
              </div>

              {/* Job details (compact) */}
              <div style={subCard}>
                <div style={innerHead}>{t.jobDetails}</div>
                <div style={{ padding: "10px 16px 12px" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 14px", alignItems: "start" }}>
                    {/* workType + status — editable for owner, READ-ONLY for Steven. */}
                    {field(t.workType, isSteven
                      ? <span style={{ fontSize: 12.5, fontWeight: 700, color: TEXT }}>{wtLabel(work.workType, lang)}</span>
                      : <InlineSelect<WorkType> value={work.workType} display={wtLabel(work.workType, lang)} color={TEXT2} options={WORK_TYPES.map(o => ({ value: o, label: wtLabel(o, lang), color: TEXT2 }))} onChange={v => onChange({ workType: v })} />)}
                    {field(t.status, isSteven
                      ? <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 11px", borderRadius: 8, background: `${STATUS_COLOR[work.status]}1A`, border: `1px solid ${STATUS_COLOR[work.status]}40`, color: STATUS_COLOR[work.status] }}>{statusLabel(work.status, lang)}</span>
                      : <InlineSelect<WorkStatus> value={work.status} display={statusLabel(work.status, lang)} color={STATUS_COLOR[work.status]} options={[
                          { value: "פעיל"  as WorkStatus, label: statusLabel("פעיל",  lang), color: STATUS_COLOR["פעיל"]  },
                          { value: "הושלם" as WorkStatus, label: statusLabel("הושלם", lang), color: STATUS_COLOR["הושלם"] },
                        ]} onChange={v => onChange({ status: v })} />)}
                    {/* payment + agreed price — owner only; hidden from Steven. */}
                    {!isSteven && field(t.payment, <PayChip pay={work.pay} lang={lang} />)}
                    {!isSteven && field(t.agreedPrice, <PriceInput value={work.price} currency={work.currency} onCommit={n => { onChange({ price: n }); notify(t.priceSaved); }} onInvalid={() => notify(t.priceInvalid)} />)}
                    {field(t.startDate, <span style={{ fontSize: 12, fontWeight: 700, color: TEXT }}>{work.startDate}</span>)}
                    {field(t.deadline, <span style={{ fontSize: 12, fontWeight: 700, color: TEXT }}>{work.deadline}</span>)}
                  </div>
                  {/* Delete job — owner only. */}
                  {!isSteven && <div style={{ paddingTop: 12, marginTop: 10, borderTop: `1px solid ${BDR}` }}>
                    <button onClick={() => setConfirmOpen(true)}
                      style={{ width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, fontSize: 12, fontWeight: 700, padding: "8px 14px", borderRadius: 10, background: "transparent", border: `1px solid ${RED}44`, color: RED, cursor: "pointer", fontFamily: "inherit" }}>🗑 {t.deleteWork}</button>
                  </div>}
                </div>
              </div>

              {/* Mix instructions (compact) — owner only; Steven reads instructions
                  via Work Materials instead, so this box is hidden for him. */}
              {!isSteven && <div style={subCard}>
                <div style={{ padding: "12px 16px", borderBottom: `1px solid ${BDR}` }}>
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: TEXT, display: "inline-flex", alignItems: "center", gap: 7 }}><SlidersIcon size={15} /> {t.mixInstructions}</div>
                </div>
                <div style={{ padding: "12px 16px" }}>
                  <NotesEditor value={work.notes} placeholder={t.mixInstructionsPh} saveLabel={t.saveInstructions} onSave={v => { onChange({ notes: v }); notify(t.instructionsSaved); }} />
                </div>
              </div>}
            </div>

          </div>

          {/* ═══ FULL-WIDTH: unified shared comments for the version — below the 3-column grid ═══ */}
          {selectedGroup && (
            <div ref={notesRef} style={{ ...subCard, marginTop: 16 }}>
              <div style={{ padding: "12px 16px", borderBottom: `1px solid ${BDR}` }}>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: TEXT }}>💬 {t.sharedComments}</div>
                <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{t.sharedCommentsSub}</div>
              </div>
              <div style={{ padding: "12px 16px 16px" }}>
                {rolePick && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, padding: "8px 10px", borderRadius: 10, background: CARD, border: `1px solid ${BRAND}44`, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: TEXT2, whiteSpace: "nowrap" }}>{rtl ? "שייך הערה ל:" : "Attach comment to:"}</span>
                    {(["mix", "acapella", "instrumental"] as FileRole[]).map(r => (
                      <button key={r} onClick={() => chooseAddRole(r)}
                        style={{ fontSize: 11, fontWeight: 800, padding: "5px 11px", borderRadius: 8, background: `${ROLE_COLOR[r]}1A`, border: `1px solid ${ROLE_COLOR[r]}55`, color: ROLE_COLOR[r], cursor: "pointer", fontFamily: "inherit" }}>
                        {roleLabel(r, lang)}
                      </button>
                    ))}
                    <button onClick={() => setRolePick(false)}
                      style={{ fontSize: 11, fontWeight: 700, padding: "5px 9px", borderRadius: 8, background: "transparent", border: `1px solid ${BDR2}`, color: TEXT2, cursor: "pointer", fontFamily: "inherit" }}>{t.cancel}</button>
                  </div>
                )}
                {adding && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, padding: "8px 10px", borderRadius: 10, background: CARD, border: `1px solid ${BRAND}44` }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: BRAND, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{t.cAtTime} {fmtTime(addTs)}</span>
                    {addRole && <span style={{ fontSize: 9.5, fontWeight: 800, color: ROLE_COLOR[addRole], background: `${ROLE_COLOR[addRole]}1A`, border: `1px solid ${ROLE_COLOR[addRole]}40`, padding: "2px 7px", borderRadius: 6, whiteSpace: "nowrap" }}>{roleLabel(addRole, lang)}</span>}
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
                  !adding && !rolePick && <div style={{ fontSize: 12.5, color: MUTED, textAlign: "center", padding: "14px 0" }}>{t.cEmpty}</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 7, maxHeight: 360, overflowY: "auto" }}>
                    {[...comments].sort(commentSort).map((c, i) => {
                      const cr = roleOfComment(c);
                      const col = cr ? ROLE_COLOR[cr] : MUTED;
                      const isEditing = editingId === c.id;
                      return (
                        <div key={c.id}
                          onMouseEnter={() => setHoverCommentId(c.id)} onMouseLeave={() => setHoverCommentId(cur => (cur === c.id ? null : cur))}
                          style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 13px", borderRadius: 11, background: hoverCommentId === c.id ? `${col}14` : CARD, border: `1px solid ${hoverCommentId === c.id ? col : BDR}`, boxShadow: hoverCommentId === c.id ? `0 0 0 1px ${col}55, 0 0 12px ${col}55` : "none", transition: "background .15s ease, border-color .15s ease, box-shadow .15s ease" }}>
                          <span style={{ width: 23, height: 23, borderRadius: "50%", flexShrink: 0, background: col, color: "#fff", fontSize: 11, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</span>
                          <button onClick={() => playerForComment(c)?.playFrom(c.timestampSeconds)} title={t.vPlay}
                            style={{ width: 26, height: 26, borderRadius: "50%", flexShrink: 0, background: `${BRAND}1A`, border: `1px solid ${BRAND}55`, color: BRAND, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" style={{ marginInlineStart: 1 }}><path d="M8 5v14l11-7z"/></svg>
                          </button>
                          <button onClick={() => playerForComment(c)?.seek(c.timestampSeconds)}
                            style={{ fontSize: 11.5, fontWeight: 800, color: col, background: "transparent", border: "none", cursor: "pointer", fontVariantNumeric: "tabular-nums", flexShrink: 0, fontFamily: "inherit" }}>{fmtTime(c.timestampSeconds)}</button>
                          <span style={{ fontSize: 9.5, fontWeight: 800, color: col, background: `${col}1A`, border: `1px solid ${col}40`, padding: "2px 7px", borderRadius: 6, flexShrink: 0, whiteSpace: "nowrap" }}>{cr ? roleLabel(cr, lang) : (rtl ? "כללי" : "Shared")}</span>
                          {isEditing ? (
                            <input autoFocus value={editText} onChange={e => setEditText(e.target.value)}
                              onKeyDown={e => { if (e.key === "Enter") saveEditComment(c); if (e.key === "Escape") setEditingId(null); }}
                              onBlur={() => saveEditComment(c)}
                              style={{ flex: 1, minWidth: 0, padding: "5px 9px", borderRadius: 7, background: "#0D0D12", color: TEXT, border: `1px solid ${BRAND}55`, fontSize: 12.5, fontFamily: "inherit", outline: "none" }} />
                          ) : (
                            <div onClick={() => playerForComment(c)?.seek(c.timestampSeconds)} title={c.commentText}
                              style={{ flex: 1, minWidth: 0, fontSize: 13, color: TEXT, cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.commentText}</div>
                          )}
                          <span style={{ fontSize: 10, color: MUTED, flexShrink: 0, whiteSpace: "nowrap" }}>{fmtRelative(c.createdAt, lang)}</span>
                          {/* edit + delete — owner only; Steven's comments are view-only. */}
                          {!isSteven && !isEditing && (
                            <button onClick={() => { setEditingId(c.id); setEditText(c.commentText); }} title={t.cEdit}
                              style={{ background: "none", border: "none", color: MUTED, fontSize: 13, cursor: "pointer", flexShrink: 0 }}
                              onMouseEnter={e => (e.currentTarget.style.color = TEXT2)} onMouseLeave={e => (e.currentTarget.style.color = MUTED)}>✎</button>
                          )}
                          {!isSteven && <button onClick={() => setDelC(c)} title={t.cDelete}
                            style={{ background: "none", border: "none", color: "#7A4A4A", fontSize: 13, cursor: "pointer", flexShrink: 0 }}
                            onMouseEnter={e => (e.currentTarget.style.color = RED)} onMouseLeave={e => (e.currentTarget.style.color = "#7A4A4A")}>🗑</button>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
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
          <div onClick={() => { if (!uploading) { setRolePicker(null); setRpError(null); } }} style={{ position: "fixed", inset: 0, zIndex: 100002, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
            <div onClick={e => e.stopPropagation()} dir={rtl ? "rtl" : "ltr"} style={{ background: CARD, border: `1px solid ${BRAND}44`, borderRadius: 16, width: "min(520px, 94vw)", maxHeight: "88vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 24px 80px rgba(0,0,0,0.9)", fontFamily: "'Heebo', Arial, sans-serif" }}>
              <div style={{ padding: "18px 22px 14px", borderBottom: `1px solid ${BDR}` }}>
                <div style={{ fontSize: 16, fontWeight: 900, color: TEXT, display: "inline-flex", alignItems: "center", gap: 7 }}><SlidersIcon size={16} /> {t.rpTitle}</div>
                <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>
                  {rolePicker.mode === "new" ? t.rpSubNew : `${t.rpSubExisting}: ${selectedGroup?.label ?? ""}`} · {t.rpHint}
                </div>
              </div>
              <div style={{ padding: "14px 18px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
                {rolePicker.items.map((it, idx) => (
                  <div key={idx} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", borderRadius: 11, background: CARD2, border: `1px solid ${BDR}` }}>
                    <span style={{ width: 26, height: 26, borderRadius: 7, flexShrink: 0, background: `${ROLE_COLOR[it.role]}22`, color: ROLE_COLOR[it.role], display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{isAudioName(it.file.name) ? <MusicIcon size={14} /> : <BoxIcon size={14} />}</span>
                    <div title={it.file.name} style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: "ltr", textAlign: "start", unicodeBidi: "plaintext" } as React.CSSProperties}>{it.file.name}</div>
                    <select value={it.role} onChange={e => { const role = e.target.value as FileRole; setRpError(null); setRolePicker(p => p ? { ...p, items: p.items.map((x, i) => i === idx ? { ...x, role } : x) } : p); }}
                      style={{ flexShrink: 0, fontSize: 12, fontWeight: 700, padding: "6px 8px", borderRadius: 8, background: "#0D0D12", color: TEXT, border: `1px solid ${ROLE_COLOR[it.role]}66`, fontFamily: "inherit", outline: "none", cursor: "pointer" }}>
                      {ROLE_ORDER.map(r => <option key={r} value={r}>{roleLabel(r, lang)}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              {/* Batch progress (per file) + inline error — modal stays open on failure */}
              {(rpError || upProgress) && (
                <div style={{ padding: "0 18px 4px", display: "flex", flexDirection: "column", gap: 8 }}>
                  <style>{"@keyframes wm-spin{to{transform:rotate(360deg)}}"}</style>
                  {rpError && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 600, color: "#FCA5A5", background: "rgba(239,68,68,0.1)", border: `1px solid ${RED}44`, borderRadius: 10, padding: "8px 11px" }}>⚠ {rpError}</div>
                  )}
                  {upProgress && (
                    <div style={{ background: "#0D0D12", border: `1px solid ${BDR}`, borderRadius: 11, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 7 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontSize: 12, color: TEXT2, fontWeight: 700 }}>
                        <span>{rtl ? "מעלה" : "Uploading"} {Math.min(upProgress.done + 1, upProgress.total)} {rtl ? "מתוך" : "of"} {upProgress.total}</span>
                        <WMSpinner size={12} color={BRAND} />
                      </div>
                      {upProgress.current && <div title={upProgress.current} style={{ fontSize: 11, color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: "ltr", textAlign: rtl ? "right" : "left" } as React.CSSProperties}>{upProgress.current}</div>}
                      <div style={{ height: 4, borderRadius: 4, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                        <div style={{ height: "100%", borderRadius: 4, background: `linear-gradient(90deg, ${BRAND}, #F87171)`, width: `${Math.round((upProgress.done / upProgress.total) * 100)}%`, transition: "width 0.2s ease" }} />
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div style={{ padding: "14px 18px", borderTop: `1px solid ${BDR}`, display: "flex", gap: 10 }}>
                <button onClick={() => { if (!uploading) { setRolePicker(null); setRpError(null); } }} disabled={uploading} style={{ ...ghostBtn, flex: 1, justifyContent: "center", opacity: uploading ? 0.6 : 1 }}>{t.cancel}</button>
                <button onClick={runRolePickerUpload} disabled={uploading} style={{ flex: 1, padding: "10px 18px", borderRadius: 10, background: uploading ? MUTED : BRAND, border: "none", color: "#fff", fontSize: 13, fontWeight: 800, cursor: uploading ? "default" : "pointer", fontFamily: "inherit", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7 }}>{uploading ? <><WMSpinner size={12} color="#fff" /> {t.vUploading}</> : `⬆ ${t.rpUpload}`}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modal, document.body) : null;
}

// ── "Work Materials" modal — what Redbloods SENDS to the engineer ────────────────
//    (Rough Mix / References / Stems / instructions text + a quick Rough↔Latest
//    compare). Files live in projects.files (category "חומרי עבודה"); text in
//    projects.work_materials. Owner (he) = full; "Steven view" (en) = read-only.
type WMMaterial = {
  name: string; url: string; dropboxPath: string;
  materialType: "rough" | "reference" | "stems" | "doc";
  kind: "audio" | "archive" | "doc"; durationSeconds: number | null; size: number | null;
};
type WMData = {
  projectLinked: boolean;
  materials: WMMaterial[];
  meta: { bpm?: string; key?: string; instructions?: string };
  latestMix: { url: string; fileName: string; label: string; durationSeconds: number | null } | null;
};

// Payment-date modal — shown when a work's payment is set to "שולם". Confirm the
// date (defaults to today) or cancel (status stays unchanged). Dark, RTL-aware.
function PaymentDateModal({ project, initialDate, onSave, onClose, lang, t }: { project: string; initialDate: string; onSave: (date: string) => void; onClose: () => void; lang: Lang; t: T }) {
  const rtl = lang === "he";
  const [date, setDate] = useState(initialDate);
  const modal = (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }} style={{ position: "fixed", inset: 0, zIndex: 200000, background: "rgba(0,0,0,0.72)", backdropFilter: "blur(5px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div dir={rtl ? "rtl" : "ltr"} onClick={e => e.stopPropagation()}
        style={{ background: CARD, border: `1px solid ${BDR2}`, borderRadius: 18, width: "min(380px, 94vw)", padding: "22px 22px 18px", boxShadow: "0 24px 70px rgba(0,0,0,0.85)", fontFamily: "'Heebo', Arial, sans-serif", color: TEXT }}>
        <div style={{ fontSize: 16, fontWeight: 900 }}>💵 {t.payDateTitle}</div>
        <div title={project} style={{ fontSize: 12, color: TEXT2, marginTop: 3, marginBottom: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{project}</div>
        <label style={{ fontSize: 11, fontWeight: 700, color: MUTED, display: "block", marginBottom: 6 }}>{t.payDateField}</label>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} autoFocus
          style={{ width: "100%", boxSizing: "border-box", background: "#0D0D12", border: `1px solid ${BDR2}`, borderRadius: 10, color: TEXT, colorScheme: "dark", fontSize: 14, padding: "10px 12px", outline: "none", fontFamily: "inherit" }} />
        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <button type="button" onClick={onClose}
            style={{ flex: 1, padding: "10px 0", borderRadius: 10, border: `1px solid ${BDR2}`, background: "transparent", color: TEXT2, cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>{t.cancel}</button>
          <button type="button" onClick={() => { if (date) onSave(date); }} disabled={!date}
            style={{ flex: 1, padding: "10px 0", borderRadius: 10, border: "none", background: date ? GREEN : MUTED, color: "#fff", cursor: date ? "pointer" : "default", fontSize: 13, fontWeight: 800, fontFamily: "inherit" }}>{t.save}</button>
        </div>
      </div>
    </div>
  );
  return typeof document !== "undefined" ? createPortal(modal, document.body) : null;
}

// Small inline spinner (keyframes injected once inside the modal). No library.
function WMSpinner({ size = 13, color = "#fff" }: { size?: number; color?: string }) {
  return <span style={{ width: size, height: size, border: `2px solid ${color}44`, borderTopColor: color, borderRadius: "50%", display: "inline-block", animation: "wm-spin 0.7s linear infinite", flexShrink: 0 }} />;
}

// Per-row kebab menu (download / delete) for the Work-Materials cards. Closes via
// a fixed transparent backdrop; sits above the modal's own stacking context.
function WMKebab({ readOnly, onDownload, onDelete, t, rtl }: { readOnly: boolean; onDownload: () => void; onDelete: () => void; t: T; rtl: boolean }) {
  const [open, setOpen] = useState(false);
  const item: React.CSSProperties = { display: "block", width: "100%", textAlign: rtl ? "right" : "left", padding: "8px 13px", background: "transparent", border: "none", color: TEXT2, fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" };
  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <button type="button" onClick={() => setOpen(o => !o)} title="•••"
        style={{ width: 28, height: 28, borderRadius: 8, background: open ? "rgba(255,255,255,0.06)" : "transparent", border: "none", color: open ? TEXT2 : MUTED, cursor: "pointer", fontSize: 17, lineHeight: 1, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>⋮</button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 200004 }} />
          <div style={{ position: "absolute", top: "calc(100% + 4px)", [rtl ? "left" : "right"]: 0, zIndex: 200005, background: "#181820", border: `1px solid ${BDR2}`, borderRadius: 10, boxShadow: "0 12px 30px rgba(0,0,0,0.7)", minWidth: 150, overflow: "hidden", padding: "4px 0" } as React.CSSProperties}>
            <button type="button" onClick={() => { setOpen(false); onDownload(); }} style={item}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>⬇ {t.wmDownload}</button>
            {!readOnly && (
              <button type="button" onClick={() => { setOpen(false); onDelete(); }} style={{ ...item, color: "#FCA5A5" }}
                onMouseEnter={e => (e.currentTarget.style.background = "rgba(239,68,68,0.1)")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>🗑 {t.wmDelete}</button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// Compact audio row (Work-Materials cards): small inline play toggle + kebab.
// Reuses the module-level single-active guard so only one thing ever plays.
function WMAudioRow({ name, meta, url, readOnly, onDownload, onDelete, t, rtl }: { name: string; meta: string; url: string; readOnly: boolean; onDownload: () => void; onDelete: () => void; t: T; rtl: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => { const a = audioRef.current; return () => { a?.pause(); if (activeStevenAudio === a) activeStevenAudio = null; }; }, []);
  function toggle() {
    const a = audioRef.current; if (!a) return;
    if (a.paused) { if (activeStevenAudio && activeStevenAudio !== a) activeStevenAudio.pause(); activeStevenAudio = a; a.play().catch(() => {}); }
    else a.pause();
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", background: "#0D0D12", border: `1px solid ${BDR}`, borderRadius: 11 }}>
      <audio ref={audioRef} src={url} preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
      <button type="button" onClick={toggle} title={t.vPlay}
        style={{ width: 34, height: 34, borderRadius: "50%", flexShrink: 0, border: "none", background: `linear-gradient(145deg, ${BRAND}, #B91C1C)`, color: "#fff", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", boxShadow: `0 3px 12px ${BRAND}55` }}>
        {playing ? <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff"><rect x="6" y="5" width="4.4" height="14" rx="1.3"/><rect x="13.6" y="5" width="4.4" height="14" rx="1.3"/></svg>
                 : <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff" style={{ marginInlineStart: 2 }}><path d="M8 5v14l11-7z"/></svg>}
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div title={name} style={{ fontSize: 12.5, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: "ltr", textAlign: rtl ? "right" : "left", unicodeBidi: "plaintext" } as React.CSSProperties}>{name}</div>
        <div style={{ fontSize: 10.5, color: MUTED, marginTop: 1, direction: "ltr", textAlign: rtl ? "right" : "left" } as React.CSSProperties}>{meta}</div>
      </div>
      <WMKebab readOnly={readOnly} onDownload={onDownload} onDelete={onDelete} t={t} rtl={rtl} />
    </div>
  );
}

// Compact non-audio row (stems/docs): icon + name + kebab (download / delete).
function WMFileRow({ icon, name, meta, readOnly, onDownload, onDelete, t, rtl }: { icon: React.ReactNode; name: string; meta: string; readOnly: boolean; onDownload: () => void; onDelete: () => void; t: T; rtl: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", background: "#0D0D12", border: `1px solid ${BDR}`, borderRadius: 11 }}>
      <span style={{ flexShrink: 0, width: 34, display: "inline-flex", alignItems: "center", justifyContent: "center", color: TEXT2 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div title={name} style={{ fontSize: 12.5, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: "ltr", textAlign: rtl ? "right" : "left", unicodeBidi: "plaintext" } as React.CSSProperties}>{name}</div>
        <div style={{ fontSize: 10.5, color: MUTED, marginTop: 1, direction: "ltr", textAlign: rtl ? "right" : "left" } as React.CSSProperties}>{meta}</div>
      </div>
      <WMKebab readOnly={readOnly} onDownload={onDownload} onDelete={onDelete} t={t} rtl={rtl} />
    </div>
  );
}

function WorkMaterialsModal({ work, isSteven, isOwner, onClose, onOpenWork, notify, lang, t }: { work: Work; isSteven: boolean; isOwner: boolean; onClose: () => void; onOpenWork: () => void; notify: (m: string) => void; lang: Lang; t: T }) {
  const rtl = lang === "he";
  // Read-only when Steven is signed in (materials are owner-managed), or in the
  // owner's English "Steven view" preview.
  const readOnly = isSteven || lang === "en";
  const narrow = useIsNarrow(760);

  const [data, setData]         = useState<WMData | null>(null); // null = loading
  const [loadErr, setLoadErr]   = useState(false);
  const [sendingSteven, setSendingSteven] = useState(false); // "Send to Steven" push in flight
  const [instr, setInstr]       = useState("");
  const [instrFocus, setInstrFocus] = useState(false); // textarea focus → slightly stronger glow
  const [savingMeta, setSaving] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null); // materialType being uploaded
  const [upPct, setUpPct] = useState<number | null>(null);         // real request-body upload %, null when idle
  const [delTarget, setDelTarget] = useState<WMMaterial | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState<string | null>(null); // inline error banner (visible above the modal's z-index)

  const roughRef = useRef<HTMLInputElement | null>(null);
  const refRef   = useRef<HTMLInputElement | null>(null);
  const stemsRef = useRef<HTMLInputElement | null>(null);
  const docRef   = useRef<HTMLInputElement | null>(null);
  // Guard against setState after unmount, and abort an in-flight upload on close.
  const aliveRef = useRef(true);
  const xhrRef   = useRef<XMLHttpRequest | null>(null);
  const abortRef = useRef<AbortController | null>(null); // cancels an in-flight chunked upload
  useEffect(() => () => { aliveRef.current = false; xhrRef.current?.abort(); abortRef.current?.abort(); }, []);

  // A/B compare — last playback time shared between the two compare players. When
  // one starts playing it jumps to this time, so switching Rough↔Latest keeps the
  // same position. Single-active (activeStevenAudio) still prevents overlap.
  const cmpTimeRef   = useRef(0);
  const cmpRoughRef  = useRef<VersionPlayerHandle | null>(null);
  const cmpLatestRef = useRef<VersionPlayerHandle | null>(null);
  const cmpRefRef    = useRef<VersionPlayerHandle | null>(null);
  function syncTo(ref: React.MutableRefObject<VersionPlayerHandle | null>) {
    const api = ref.current;
    if (!api) return;
    const target = cmpTimeRef.current;
    if (Math.abs(api.getCurrentTime() - target) > 1) api.seek(target);
  }

  // steven → sanitized read-only supplier endpoint (opaque file URLs, no raw path).
  const url = isSteven
    ? `/api/supplier/steven/work/${work.id}/work-materials`
    : `/api/sound-engineer/${work.id}/work-materials`;

  useEffect(() => {
    let alive = true;
    setData(null); setLoadErr(false);
    fetch(url)
      .then(r => r.json())
      .then(d => {
        if (!alive) return;
        if (d.ok) {
          const wd: WMData = { projectLinked: !!d.projectLinked, materials: d.materials ?? [], meta: d.meta ?? {}, latestMix: d.latestMix ?? null };
          setData(wd);
          setInstr(wd.meta.instructions ?? "");
        } else setLoadErr(true);
      })
      .catch(() => { if (alive) setLoadErr(true); });
    return () => { alive = false; };
  }, [url]);

  async function reload() {
    try {
      const d = await fetch(url).then(r => r.json());
      if (d.ok) setData(cur => (cur ? { ...cur, materials: d.materials ?? [], latestMix: d.latestMix ?? null } : cur));
    } catch { /* silent */ }
  }

  async function saveMeta() {
    if (savingMeta || readOnly) return;
    setSaving(true); setErr(null);
    try {
      const d = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ instructions: instr }) }).then(r => r.json());
      if (d.ok) notify(t.wmMetaSaved);
      else setErr(d.error || t.wmMetaFail);
    } catch { setErr(t.wmMetaFail); }
    finally { setSaving(false); }
  }

  // "Send to Steven" → owner-only route builds the text + pushes to owner+steven.
  // Manual click only; server dedups and asks to confirm a resend. No auto-fire.
  async function sendToSteven() {
    if (sendingSteven) return;
    setSendingSteven(true);
    try {
      const base = `/api/sound-engineer/${work.id}/notify-mix-ready`;
      let res = await fetch(base, { method: "POST" });
      let d = await res.json().catch(() => ({} as { ok?: boolean; alreadySent?: boolean }));
      if (res.ok && d.alreadySent) {
        if (typeof window !== "undefined" && window.confirm(t.wmSendAgain)) {
          res = await fetch(`${base}?resend=1`, { method: "POST" });
          d = await res.json().catch(() => ({}));
        } else { setSendingSteven(false); return; }
      }
      if (res.ok && d.ok) notify(t.wmSentToSteven);
      else throw new Error();
    } catch {
      notify(t.wmSendFail);
    } finally {
      setSendingSteven(false);
    }
  }

  // Dispatch by size: >1GB rejected; >140MB uses the chunked upload-session flow
  // (Dropbox single-shot maxes at 150MB); otherwise the existing single-shot path.
  const MAX_BYTES   = 1024 * 1024 * 1024;   // 1GB hard limit
  const CHUNK_LIMIT = 140 * 1024 * 1024;    // switch to chunked above this
  function doUpload(file: File, materialType: string) {
    if (uploading) return; // one upload at a time
    if (file.size > MAX_BYTES) { setErr(t.wmTooLarge); return; }
    if (file.size > CHUNK_LIMIT) { void chunkedUpload(file, materialType); return; }
    singleUpload(file, materialType);
  }

  // Single-shot upload (≤140MB): XHR gives a REAL request-body progress %; once it
  // hits 100% the server is still pushing to Dropbox → "saving" phase. No fake %.
  function singleUpload(file: File, materialType: string) {
    setUploading(materialType); setUpPct(0); setErr(null);
    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open("POST", url);
    xhr.upload.onprogress = e => { if (aliveRef.current && e.lengthComputable) setUpPct(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      xhrRef.current = null;
      if (!aliveRef.current) return;
      let d: { ok?: boolean; error?: string } = {};
      try { d = JSON.parse(xhr.responseText); } catch { /* non-JSON */ }
      if (xhr.status >= 200 && xhr.status < 300 && d.ok) {
        void reload().then(() => { if (!aliveRef.current) return; setUploading(null); setUpPct(null); notify(t.wmUploaded); });
      } else {
        setErr(d.error || t.wmUploadFail); setUploading(null); setUpPct(null);
      }
    };
    xhr.onerror = () => { xhrRef.current = null; if (!aliveRef.current) return; setErr(t.wmUploadFail); setUploading(null); setUpPct(null); };
    const fd = new FormData();
    fd.append("file", file);
    fd.append("materialType", materialType);
    xhr.send(fd);
  }

  // Chunked upload (>140MB, up to 1GB): Dropbox upload session — 8MB chunks stream
  // through the server one at a time (never the whole file in memory / over the
  // proxy). Real progress by bytes sent; a friendly error on failure (retry = pick
  // the file again). No public share link; persisted to projects.files on finish.
  async function chunkedUpload(file: File, materialType: string) {
    setUploading(materialType); setUpPct(0); setErr(null);
    const CHUNK = 8 * 1024 * 1024;
    const total = file.size;
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    const ac = new AbortController();
    abortRef.current = ac;
    const post = (qs: string, body: Blob) => fetch(`${url}/chunk?${qs}`, { method: "POST", body, signal: ac.signal });
    try {
      // start — first chunk opens the session
      let offset = Math.min(CHUNK, total);
      let res = await post("action=start", file.slice(0, offset));
      let d = await res.json().catch(() => ({} as { ok?: boolean; sessionId?: string; error?: string }));
      if (!res.ok || !d.ok || !d.sessionId) throw new Error();
      const sessionId = d.sessionId;
      if (aliveRef.current) setUpPct(Math.min(99, Math.round((offset / total) * 100)));
      // append the middle chunks; the final chunk goes through finish (commit)
      while (offset < total) {
        const end = Math.min(offset + CHUNK, total);
        const isLast = end >= total;
        const qs = isLast
          ? `action=finish&sessionId=${encodeURIComponent(sessionId)}&offset=${offset}&materialType=${encodeURIComponent(materialType)}&ext=${encodeURIComponent(ext)}`
          : `action=append&sessionId=${encodeURIComponent(sessionId)}&offset=${offset}`;
        if (isLast && aliveRef.current) setUpPct(100); // → "שומר ל-Dropbox…"
        res = await post(qs, file.slice(offset, end));
        d = await res.json().catch(() => ({}));
        if (!res.ok || !d.ok) throw new Error();
        offset = end;
        if (!isLast && aliveRef.current) setUpPct(Math.min(99, Math.round((offset / total) * 100)));
      }
      abortRef.current = null;
      if (!aliveRef.current) return;
      await reload().then(() => { if (aliveRef.current) { setUploading(null); setUpPct(null); notify(t.wmUploaded); } });
    } catch {
      abortRef.current = null;
      if (aliveRef.current) { setErr(t.wmUploadFail); setUploading(null); setUpPct(null); }
    }
  }
  function onPick(e: React.ChangeEvent<HTMLInputElement>, materialType: string) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) doUpload(f, materialType);
  }

  async function confirmDelete() {
    const m = delTarget;
    if (!m || deleting) return;
    setDeleting(true);
    try {
      const d = await fetch(`${url}?path=${encodeURIComponent(m.dropboxPath)}`, { method: "DELETE" }).then(r => r.json());
      if (d.ok) { setData(cur => (cur ? { ...cur, materials: cur.materials.filter(x => x.dropboxPath !== m.dropboxPath) } : cur)); notify(t.wmDeleted); }
      else setErr(d.error || t.wmDeleteFail);
    } catch { setErr(t.wmDeleteFail); }
    finally { setDeleting(false); setDelTarget(null); }
  }

  // ── styles ──
  const sec: React.CSSProperties = { background: CARD2, border: `1px solid ${BDR}`, borderRadius: 14, padding: "14px 16px" };
  // Instructions area gets a very soft language-tinted glow (red for the Hebrew
  // owner UI, blue for Steven's English) that strengthens slightly on focus.
  const glowAccent = rtl ? "#EF4444" : "#4A9EFF";
  const instrGlow: React.CSSProperties = {
    borderColor: `${glowAccent}${instrFocus ? "5C" : "2E"}`,
    boxShadow: instrFocus
      ? `0 0 18px ${glowAccent}2A, inset 0 0 0 1px ${glowAccent}22`
      : `0 0 13px ${glowAccent}12, inset 0 0 0 1px ${glowAccent}0F`,
    transition: "border-color .18s ease, box-shadow .18s ease",
  };
  const secHead: React.CSSProperties = { fontSize: 13.5, fontWeight: 800, color: TEXT, marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 };
  const inp: React.CSSProperties = { width: "100%", boxSizing: "border-box", background: "#0D0D12", border: `1px solid ${BDR2}`, borderRadius: 10, color: TEXT, colorScheme: "dark", fontSize: 13, padding: "9px 12px", outline: "none", fontFamily: "inherit" };
  const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: MUTED, display: "block", marginBottom: 5 };
  const ROLE_C: Record<string, string> = { rough: BRAND, reference: BLUE, stems: "#F59E0B", doc: MUTED, latest: GREEN };

  function emptyLine(label: string) {
    return <div style={{ padding: "18px 0", textAlign: "center", fontSize: 12, color: MUTED }}>{label}</div>;
  }

  // Display name = Steven-visible project name (work.project) + material type —
  // NEVER the stored Dropbox/original filename. References are always numbered;
  // other types get a number only when there is more than one of that type.
  const TYPE_DISPLAY: Record<string, string> = { rough: "Rough Mix", reference: "Reference", stems: "Stems", doc: "Instructions" };
  function dispName(mt: string, idx: number, count: number): string {
    const label = TYPE_DISPLAY[mt] ?? mt;
    const numbered = mt === "reference" || count > 1;
    return `${work.project} ${label}${numbered ? " " + (idx + 1) : ""}`.trim();
  }
  function metaStr(m: WMMaterial): string {
    const ext = (m.name.split(".").pop() ?? "").toUpperCase();
    return [ext, m.durationSeconds ? fmtTime(m.durationSeconds) : null, m.size ? fmtBytes(m.size) : null].filter(Boolean).join(" · ");
  }
  const dl = (m: WMMaterial) => () => window.open(m.url, "_blank", "noopener,noreferrer");

  const materials = data?.materials ?? [];
  const rough      = materials.filter(m => m.materialType === "rough");
  const references = materials.filter(m => m.materialType === "reference");
  const stems      = materials.filter(m => m.materialType === "stems");
  const docs       = materials.filter(m => m.materialType === "doc");
  const roughAudio = rough.find(m => m.kind === "audio") ?? null;
  // The uploaded reference for the compare strip: the first audio reference
  // (same single-select approach as roughAudio — no carousel). refIdx keeps the
  // "Reference N" numbering aligned with the References card.
  const refAudio   = references.find(m => m.kind === "audio") ?? null;
  const refIdx     = refAudio ? references.indexOf(refAudio) : 0;

  // Instructions folder path — derived from any material's dropboxPath parent (the
  // folder only exists once at least one file was uploaded). Same client-only
  // deep-link as the mix folder: NO API, NO token, NO shared link.
  const anyMat = materials.find(m => m.dropboxPath && m.dropboxPath.lastIndexOf("/") > 0) ?? null;
  const instrFolderPath = anyMat ? anyMat.dropboxPath.slice(0, anyMat.dropboxPath.lastIndexOf("/")) : null;
  function openInstrFolder() {
    if (!instrFolderPath) return;
    const w = window.open("https://www.dropbox.com/home" + encodeURI(DROPBOX_APP_ROOT + instrFolderPath), "_blank", "noopener,noreferrer");
    if (!w) notify(t.wmFolderFail);
  }

  // Build the row elements for a card from its materials (audio → player row,
  // archive/doc → download row). idx/count drive the display numbering.
  function rowsFor(list: WMMaterial[], mt: string) {
    return list.map((m, i) => {
      const name = dispName(mt, i, list.length);
      return m.kind === "audio"
        ? <WMAudioRow key={m.dropboxPath} name={name} meta={metaStr(m)} url={m.url} readOnly={readOnly} onDownload={dl(m)} onDelete={() => setDelTarget(m)} t={t} rtl={rtl} />
        : <WMFileRow key={m.dropboxPath} icon={m.kind === "archive" ? <BoxIcon size={15} /> : <FileIcon size={15} />} name={name} meta={metaStr(m)} readOnly={readOnly} onDownload={dl(m)} onDelete={() => setDelTarget(m)} t={t} rtl={rtl} />;
    });
  }

  // One material card (header + subtitle + upload button + rows). A plain render
  // FUNCTION (not a nested component) so the audio rows keep a stable identity and
  // never remount / stop playing when the parent re-renders (e.g. while typing).
  const cardStyle: React.CSSProperties = { background: CARD2, border: `1px solid ${BDR}`, borderRadius: 16, padding: "15px 15px 14px", display: "flex", flexDirection: "column", gap: 12, minWidth: 0 };
  const UPLOADING_LABEL: Record<string, string> = { rough: t.wmUploadingRough, reference: t.wmUploadingRef, stems: t.wmUploadingStems, doc: t.wmUploadingDoc };
  function renderCard(_icon: string, title: string, subtitle: string, uploadLabel: string, mt: string, inputRef: React.RefObject<HTMLInputElement | null>, list: WMMaterial[]) {
    const rows = rowsFor(list, mt);
    const busy = uploading === mt;   // this card is the one uploading
    return (
      <div style={cardStyle}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: TEXT, display: "inline-flex", alignItems: "center", gap: 7 }}>{mt === "rough" ? <MusicIcon size={15} /> : mt === "reference" ? <HeadphonesIcon size={15} /> : mt === "stems" ? <BoxIcon size={15} /> : <FileIcon size={15} />} {title}</div>
          <div style={{ fontSize: 11, color: MUTED, marginTop: 3, lineHeight: 1.5 }}>{subtitle}</div>
        </div>
        {!readOnly && (
          <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading !== null}
            style={{ width: "100%", fontSize: 11.5, fontWeight: 800, padding: "8px 10px", borderRadius: 10, background: `${BRAND}16`, border: `1px solid ${BRAND}45`, color: BRAND, cursor: uploading ? "wait" : "pointer", fontFamily: "inherit", whiteSpace: "nowrap", opacity: uploading && !busy ? 0.45 : 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            {busy ? <><WMSpinner size={12} color={BRAND} /> {UPLOADING_LABEL[mt]}</> : uploadLabel}
          </button>
        )}
        {busy && (
          <div style={{ background: "#0D0D12", border: `1px solid ${BDR}`, borderRadius: 11, padding: "10px 11px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11, color: TEXT2, fontWeight: 600 }}>
              <span>{upPct !== null && upPct < 100 ? t.wmUpProgress : t.wmUpSaving}</span>
              {upPct !== null && upPct < 100 && <span style={{ fontVariantNumeric: "tabular-nums" }}>{upPct}%</span>}
            </div>
            <div style={{ height: 4, borderRadius: 4, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
              <div style={{ height: "100%", borderRadius: 4, background: `linear-gradient(90deg, ${BRAND}, #F87171)`, width: upPct !== null && upPct < 100 ? `${upPct}%` : "100%", transition: "width 0.2s ease", ...(upPct !== null && upPct >= 100 ? { animation: "wm-pulse 1s ease-in-out infinite" } : {}) }} />
            </div>
            <Shimmer w="100%" h={34} r={10} />
          </div>
        )}
        {rows.length > 0
          ? <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{rows}</div>
          : (busy ? null : <div style={{ padding: "18px 8px", textAlign: "center", fontSize: 11.5, color: MUTED, border: `1px dashed ${BDR2}`, borderRadius: 11, background: "rgba(255,255,255,0.01)" }}>{t.wmEmpty}</div>)}
      </div>
    );
  }

  const modal = (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }} style={{ position: "fixed", inset: 0, zIndex: 200000, background: "rgba(0,0,0,0.72)", backdropFilter: "blur(5px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: narrow ? "10px 8px" : "4vh 12px", overflowY: "auto" }}>
      <div dir={rtl ? "rtl" : "ltr"} onClick={e => e.stopPropagation()}
        style={{ background: CARD, border: `1px solid ${BDR2}`, borderRadius: 20, width: narrow ? "100%" : "min(1320px, 96vw)", maxWidth: "100%", maxHeight: "94vh", overflowY: "auto", scrollbarWidth: "thin", boxShadow: "0 32px 80px rgba(0,0,0,0.85)", fontFamily: "'Heebo', Arial, sans-serif", color: TEXT }}>
        <style>{"@keyframes wm-spin{to{transform:rotate(360deg)}}@keyframes wm-pulse{0%,100%{opacity:1}50%{opacity:.5}}@keyframes wm-glow{0%,100%{box-shadow:0 0 0 0 rgba(16,185,129,0)}50%{box-shadow:0 0 9px 1px rgba(16,185,129,.32)}}"}</style>
        {/* Hidden file inputs live INSIDE the panel so a programmatic .click() can
            never bubble to the overlay backdrop and close the modal (owner only). */}
        {!readOnly && (
          <>
            <input ref={roughRef} type="file" accept="audio/*,.wav,.mp3,.aiff,.aif,.m4a,.flac,.ogg" style={{ display: "none" }} onChange={e => onPick(e, "rough")} />
            <input ref={refRef}   type="file" accept="audio/*,.wav,.mp3,.aiff,.aif,.m4a,.flac,.ogg" style={{ display: "none" }} onChange={e => onPick(e, "reference")} />
            <input ref={stemsRef} type="file" accept=".zip,.rar,.7z,.wav,.aiff,.aif,.mp3,.flac,.ogg,.m4a" style={{ display: "none" }} onChange={e => onPick(e, "stems")} />
            <input ref={docRef}   type="file" style={{ display: "none" }} onChange={e => onPick(e, "doc")} />
          </>
        )}

        {/* Header */}
        <div style={{ position: "sticky", top: 0, zIndex: 2, background: CARD, borderBottom: `1px solid ${BDR}`, padding: narrow ? "13px 14px" : "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: narrow ? 15 : 17, fontWeight: 900, letterSpacing: "-0.01em", display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}><SlidersIcon size={17} /><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{t.wmTitle} <span style={{ color: MUTED, fontWeight: 700, fontSize: 13 }}>— {work.project}</span></span></div>
            <div style={{ fontSize: 12, color: TEXT2, marginTop: 3 }}>{t.wmSubtitle}{readOnly && <span style={{ marginInlineStart: 8, fontSize: 10.5, fontWeight: 800, color: MUTED, border: `1px solid ${BDR2}`, borderRadius: 7, padding: "1px 7px" }}>👁 {t.wmReadOnly}</span>}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end", rowGap: 8 }}>
            <button type="button" onClick={onOpenWork}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(245,158,11,0.20)"; e.currentTarget.style.borderColor = "rgba(245,158,11,0.70)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(245,158,11,0.10)"; e.currentTarget.style.borderColor = "rgba(245,158,11,0.45)"; }}
              style={{ fontSize: 12, fontWeight: 800, padding: "7px 13px", borderRadius: 10, background: "rgba(245,158,11,0.10)", border: "1px solid rgba(245,158,11,0.45)", color: "#F0B24A", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", transition: "background 0.15s, border-color 0.15s", display: "inline-flex", alignItems: "center", gap: 6 }}><ArrowUpRight size={14} /> {t.wmOpenWork}</button>
            {/* Send to Steven — general work action, OWNER ONLY (positive gate:
                effectiveRole==="owner", never "not steven"). Manual push to
                owner+steven via the owner-gated notify-mix-ready route. */}
            {isOwner && <button type="button" onClick={sendToSteven} disabled={sendingSteven}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(16,185,129,0.20)"; e.currentTarget.style.borderColor = "rgba(16,185,129,0.70)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(16,185,129,0.10)"; e.currentTarget.style.borderColor = "rgba(16,185,129,0.45)"; }}
              style={{ fontSize: 12, fontWeight: 800, padding: "7px 13px", borderRadius: 10, background: "rgba(16,185,129,0.10)", border: "1px solid rgba(16,185,129,0.45)", color: "#34D399", cursor: sendingSteven ? "wait" : "pointer", fontFamily: "inherit", whiteSpace: "nowrap", transition: "background 0.15s, border-color 0.15s", opacity: sendingSteven ? 0.7 : 1 }}>{sendingSteven ? t.wmSending : t.wmSendToSteven}</button>}
            {/* Open Dropbox folder — exposes a raw project path → owner only. */}
            {!isSteven && <button type="button" onClick={openInstrFolder} disabled={!instrFolderPath} title={instrFolderPath ? undefined : t.wmFolderPending}
              style={{ fontSize: 12, fontWeight: 800, padding: "7px 13px", borderRadius: 10, background: instrFolderPath ? "rgba(0,98,238,0.10)" : "rgba(255,255,255,0.03)", border: `1px solid ${instrFolderPath ? "rgba(0,98,238,0.28)" : BDR2}`, color: instrFolderPath ? "#4A9EFF" : MUTED, cursor: instrFolderPath ? "pointer" : "default", fontFamily: "inherit", whiteSpace: "nowrap" }}>{t.wmOpenFolder}</button>}
            <button type="button" onClick={onClose} aria-label="Close" style={{ width: narrow ? 30 : 32, height: narrow ? 30 : 32, borderRadius: "50%", background: "rgba(255,255,255,0.06)", border: `1px solid ${BDR2}`, color: TEXT2, cursor: "pointer", flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", marginInlineStart: 2 }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
          </div>
        </div>

        <div style={{ padding: narrow ? "14px 14px calc(22px + env(safe-area-inset-bottom))" : "18px 20px 22px", display: "flex", flexDirection: "column", gap: 16 }}>
          {err && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontSize: 12.5, fontWeight: 600, color: "#FCA5A5", background: "rgba(239,68,68,0.1)", border: `1px solid ${RED}44`, borderRadius: 10, padding: "9px 12px" }}>
              <span>⚠ {err}</span>
              <button onClick={() => setErr(null)} style={{ background: "none", border: "none", color: "#FCA5A5", cursor: "pointer", fontSize: 15, lineHeight: 1, flexShrink: 0 }}>✕</button>
            </div>
          )}
          {loadErr ? (
            <div style={{ padding: "34px 0", textAlign: "center", fontSize: 13, color: RED }}>{t.wmLoadFail}</div>
          ) : data === null ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Shimmer w="100%" h={120} r={14} /><Shimmer w="100%" h={90} r={14} /><Shimmer w="100%" h={90} r={14} />
            </div>
          ) : !data.projectLinked ? (
            <EmptyZone icon="🔗" title={t.wmNoProject} />
          ) : (
            <>
              {/* Instructions — free text only (no BPM/Key) */}
              <div style={{ ...sec, ...instrGlow }}>
                <div style={secHead}><span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><NoteIcon /> {t.wmInstructions}</span></div>
                <label style={lbl}>{t.wmNotes}</label>
                {readOnly ? (
                  /* Steven / read-only: a comfortable note that auto-grows to the
                     text — never a choked, scrolling input. */
                  <div dir="auto" style={{ ...inp, minHeight: 0, lineHeight: 1.7, whiteSpace: "pre-wrap", overflowWrap: "anywhere", cursor: "default", padding: "12px 14px" }}>
                    {instr ? instr : <span style={{ color: MUTED }}>{t.wmNotesPh}</span>}
                  </div>
                ) : (
                  <textarea value={instr} onChange={e => setInstr(e.target.value)} onFocus={() => setInstrFocus(true)} onBlur={() => setInstrFocus(false)} placeholder={t.wmNotesPh} rows={narrow ? 8 : 6} dir="auto" style={{ ...inp, resize: "vertical", lineHeight: 1.6, minHeight: narrow ? 188 : 140 }} />
                )}
                {!readOnly && (
                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                    <button type="button" onClick={saveMeta} disabled={savingMeta}
                      style={{ fontSize: 12.5, fontWeight: 800, padding: "8px 18px", borderRadius: 10, background: BRAND, border: "none", color: "#fff", cursor: savingMeta ? "wait" : "pointer", fontFamily: "inherit", opacity: savingMeta ? 0.7 : 1 }}>
                      {t.wmSaveMeta}
                    </button>
                  </div>
                )}
              </div>

              {/* Material cards — Rough Mix / References / Stems / Documents */}
              <div style={{ display: "grid", gridTemplateColumns: narrow ? "minmax(0, 1fr)" : "repeat(auto-fit, minmax(240px, 1fr))", gap: 14, alignItems: "start" }}>
                {renderCard("🎵", t.wmRough,      t.wmRoughSub,      t.wmUploadRough, "rough",     roughRef, rough)}
                {renderCard("🎧", t.wmReferences, t.wmReferencesSub, t.wmUploadRef,   "reference", refRef,   references)}
                {renderCard("📦", t.wmStems,      t.wmStemsSub,      t.wmUploadStems, "stems",     stemsRef, stems)}
                {renderCard("📄", t.wmDocs,       t.wmDocsSub,       t.wmUploadDoc,   "doc",       docRef,   docs)}
              </div>

              {/* Quick compare — Rough vs Latest Mix (A/B by playback time) */}
              <div style={{ ...sec, border: `1px solid ${BRAND}40`, padding: "16px 18px" }}>
                <div style={{ ...secHead, marginBottom: 4 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><ScaleIcon /> {t.wmCompare}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: TEXT2, border: `1px solid ${BDR2}`, background: "rgba(255,255,255,0.04)", borderRadius: 7, padding: "2px 9px", whiteSpace: "nowrap" }}>{t.wmSyncNote}</span>
                </div>
                <div style={{ fontSize: 11.5, color: MUTED, marginBottom: 12 }}>{t.wmCompareHint}</div>
                <div style={{ display: "grid", gridTemplateColumns: narrow ? "minmax(0, 1fr)" : "1fr 1fr", gap: 14 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: TEXT2, marginBottom: 8 }}>{t.wmCompareRough}</div>
                    {roughAudio
                      ? <VersionPlayer ref={cmpRoughRef} url={roughAudio.url} title={dispName("rough", 0, 1)} roleLabel={t.wmRough} roleColor={ROLE_C.rough} shouldPlay={0} comments={[]} onDownload={dl(roughAudio)} onPlayStart={() => syncTo(cmpRoughRef)} onTime={sec => { cmpTimeRef.current = sec; }} t={t} />
                      : emptyLine(t.wmEmpty)}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: TEXT2, marginBottom: 8 }}>{t.wmCompareLatest}</div>
                    {data.latestMix
                      ? <VersionPlayer ref={cmpLatestRef} url={data.latestMix.url} title={`${work.project} ${data.latestMix.label}`.trim()} roleLabel="Latest Mix" roleColor={ROLE_C.latest} shouldPlay={0} comments={[]} onDownload={() => window.open(data.latestMix!.url, "_blank", "noopener,noreferrer")} onPlayStart={() => syncTo(cmpLatestRef)} onTime={sec => { cmpTimeRef.current = sec; }} t={t} />
                      : emptyLine(t.wmNoLatest)}
                  </div>
                </div>
                {/* Reference — one WIDE player on its own row below the A/B pair.
                    Same design/behavior; shows the uploaded reference or a clean
                    empty state. minWidth:0 keeps it responsive on mobile. */}
                <div style={{ marginTop: 14, minWidth: 0 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: TEXT2, marginBottom: 8 }}>{t.wmCompareReference}</div>
                  {refAudio
                    ? <VersionPlayer ref={cmpRefRef} url={refAudio.url} title={dispName("reference", refIdx, references.length)} roleLabel={t.wmReferences} roleColor={ROLE_C.reference} shouldPlay={0} comments={[]} onDownload={dl(refAudio)} onPlayStart={() => syncTo(cmpRefRef)} onTime={sec => { cmpTimeRef.current = sec; }} t={t} />
                    : emptyLine(t.wmNoReference)}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Delete confirm */}
      {delTarget && (
        <div onClick={e => { e.stopPropagation(); if (!deleting) setDelTarget(null); }} style={{ position: "fixed", inset: 0, zIndex: 200001, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
          <div dir={rtl ? "rtl" : "ltr"} onClick={e => e.stopPropagation()} style={{ background: "#161616", border: `1px solid ${BDR2}`, borderRadius: 16, padding: "22px 24px", width: "min(360px, 100%)", boxSizing: "border-box", textAlign: "center", boxShadow: "0 20px 60px rgba(0,0,0,0.9)" }}>
            <div style={{ fontSize: 26, marginBottom: 8 }}>🗑</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: TEXT, marginBottom: 6 }}>{t.wmDelTitle}</div>
            <div style={{ fontSize: 12.5, color: TEXT2, marginBottom: 18, lineHeight: 1.6 }}>{t.wmDelBody}</div>
            <div style={{ display: "flex", gap: 10 }}>
              <button type="button" onClick={() => setDelTarget(null)} disabled={deleting} style={{ flex: 1, padding: "9px 0", borderRadius: 10, border: `1px solid ${BDR2}`, background: "transparent", color: TEXT2, cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>{t.confirmNo}</button>
              <button type="button" onClick={confirmDelete} disabled={deleting} style={{ flex: 1, padding: "9px 0", borderRadius: 10, border: `1px solid ${RED}66`, background: deleting ? "rgba(239,68,68,0.06)" : "rgba(239,68,68,0.14)", color: RED, cursor: deleting ? "default" : "pointer", fontSize: 13, fontWeight: 800, fontFamily: "inherit", opacity: deleting ? 0.7 : 1 }}>{t.wmDelete}</button>
            </div>
          </div>
        </div>
      )}
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
