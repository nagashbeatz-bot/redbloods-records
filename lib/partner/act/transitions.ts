/**
 * SUNNY UNIVERSAL ACTION LAYER — the status TRANSITION MODEL (guard G3). Every status / stage / state / outcome /
 * confirmation vocabulary Redbloods declares has a lifecycle here: how a value is set (which action), which moves carry
 * side effects, and which values are derived (never set directly). States come from the domain vocabularies themselves,
 * so a new value cannot appear without the model seeing it. Classification only — nothing here executes.
 */
import { CLIENT_VOCABULARIES } from "@/lib/partner/system/clients";
import { LABEL_VOCABULARIES } from "@/lib/partner/system/label-artists";
import { MIX_VOCABULARIES } from "@/lib/partner/system/mix";
import { PROJECT_VOCABULARIES } from "@/lib/partner/system/projects";
import { RF_VOCABULARIES } from "@/lib/partner/system/red-films";
import { SHOW_VOCABULARIES } from "@/lib/partner/system/shows";
import { VICTOR_VOCABULARIES } from "@/lib/partner/system/victor";
import { WORK_DOMAINS } from "@/lib/partner/system/work-domains";

/** Vocabulary values carry annotations like "לא התחיל (default)"; the state is the value before the annotation. */
export const stateOf = (v: string) => v.replace(/\s*\(.*\)\s*$/, "").trim();
const S = (xs: readonly string[]) => xs.map(stateOf);
const WD = (id: string, k: string): readonly string[] => (WORK_DOMAINS.find((w) => w.id === id)?.vocabularies[k] ?? []) as readonly string[];

export interface SpecialTransition { to: string; from?: string; via: string; effectsHe: string }
export interface Lifecycle {
  id: string;
  /** "<DOMAIN>.<vocabulary key>" — the vocabulary this lifecycle covers. */
  vocabulary: string;
  states: readonly string[];
  /** FREE = the Boss (or the owning user) may pick any value through `setBy`; DERIVED = computed, never set directly;
   *  WORKFLOW = moved by specific actions only. */
  kind: "FREE" | "DERIVED" | "WORKFLOW";
  setBy: readonly string[];
  special: readonly SpecialTransition[];
  terminal: readonly string[];
  noteHe?: string;
}
const L = (l: Lifecycle) => l;

export const LIFECYCLES: readonly Lifecycle[] = [
  L({ id: "PROJECT_STATUS", vocabulary: "PROJECT.status", states: S(PROJECT_VOCABULARIES.status), kind: "FREE", setBy: ["PROJECT.CHANGE_STATUS"], terminal: ["הושלם", "בוטל"],
    special: [
      { to: "הושלם", via: "PROJECT.STATUS_COMPLETE_CLIENT_FLOW", effectsHe: "זרימת סיום מול הלקוח (קבצים / תזכורות)" },
      { to: "בוטל", via: "PROJECT.STATUS_CANCEL_BALANCE", effectsHe: "הכנסות פתוחות מבוטלות" },
      { to: "הושלם", via: "PROJECT.STEVEN_COMPLETION", effectsHe: "אוטומטי: העבודה האחרונה של סטיבן אושרה" },
      { to: "במיקס", via: "MIX.ASSIGN_ENGINEER", effectsHe: "הגדרת מיקס מעבירה את הפרויקט למיקס" },
    ] }),
  L({ id: "PROPOSAL_STATUS", vocabulary: "CLIENT.proposalStatuses", states: S(CLIENT_VOCABULARIES.proposalStatuses), kind: "FREE", setBy: ["CLIENT.UPDATE_PROPOSAL"], terminal: ["נסגר", "לא נסגר"],
    special: [{ to: "נסגר", via: "CLIENT.CONVERT_PROPOSAL", effectsHe: "המרה לפרויקט (לא טרנזקציונית)" }, { to: "לא נסגר", via: "CLIENT.MARK_PROPOSAL_LOST", effectsHe: "לוח ישן" }] }),
  L({ id: "CLIENT_STATUS", vocabulary: "CLIENT.clientStatuses", states: S(CLIENT_VOCABULARIES.clientStatuses), kind: "FREE", setBy: ["CLIENT.UPDATE_CLIENT", "CLIENT.CREATE_CLIENT"], terminal: [], special: [{ to: "חדש", via: "CLIENT.AUTO_CREATE_CLIENT", effectsHe: "אוטומטי מאמן של פרויקט" }] }),
  L({ id: "MEETING_STATUS", vocabulary: "CLIENT.meetingStatuses", states: S(CLIENT_VOCABULARIES.meetingStatuses), kind: "FREE", setBy: ["CLIENT.MEETING_HELD_OR_CANCELLED", "PROJECT.EDIT_MEETING", "UPDATE_MEETING"], terminal: ["התקיימה", "בוטלה"], special: [], noteHe: "היומן לא מתעדכן בשינוי פגישה" }),
  L({ id: "MEETINGS_STATUS", vocabulary: "MEETINGS.status", states: S(WD("MEETINGS", "status")), kind: "FREE", setBy: ["CLIENT.MEETING_HELD_OR_CANCELLED", "UPDATE_MEETING"], terminal: ["התקיימה", "בוטלה"], special: [] }),
  L({ id: "LABEL_ARTIST_STATUS", vocabulary: "LABEL.artistStatuses", states: S(LABEL_VOCABULARIES.artistStatuses), kind: "FREE", setBy: ["LABEL.UPDATE_LABEL_ARTIST", "UPDATE_LABEL_ARTIST_NOTES_STATUS"], terminal: [], special: [] }),
  L({ id: "RELEASE_STAGE", vocabulary: "LABEL.releaseStages", states: S(LABEL_VOCABULARIES.releaseStages), kind: "FREE", setBy: ["LABEL.UPDATE_RELEASE", "PROJECT.UPDATE_RELEASE", "CHANGE_RELEASE_STAGE"], terminal: ["יצא"], special: [], noteHe: "אין קצב ריליס מוגדר — לעולם לא להמציא" }),
  L({ id: "MEDIA_INCOME_STATUS", vocabulary: "LABEL.mediaStatuses", states: S(LABEL_VOCABULARIES.mediaStatuses), kind: "WORKFLOW", setBy: ["LABEL.MEDIA_INCOME"], terminal: ["בוטל"], special: [{ to: "בוטל", via: "LABEL.MEDIA_INCOME", effectsHe: "ביטול יוצר רשומת היפוך" }] }),
  L({ id: "BEAT_STATUS", vocabulary: "LABEL.beatStatuses", states: S(LABEL_VOCABULARIES.beatStatuses), kind: "FREE", setBy: ["LABEL.BEAT_UPLOAD_EDIT_DELETE"], terminal: [], special: [] }),
  L({ id: "SHOW_STATUS_LABEL", vocabulary: "LABEL.showStatuses", states: S(LABEL_VOCABULARIES.showStatuses), kind: "FREE", setBy: ["SHOW.EDIT_SHOW", "LABEL.SHOW_LIFECYCLE"], terminal: ["בוצע", "בוטל"], special: [] }),
  L({ id: "SHOW_STATUS", vocabulary: "SHOW.statuses", states: S(SHOW_VOCABULARIES.statuses), kind: "FREE", setBy: ["SHOW.EDIT_SHOW"], terminal: ["בוצע", "בוטל"],
    special: [
      { to: "בוצע", via: "SHOW.CLOSE_SHOW", effectsHe: "סגירה + מי קיבל תשלום → כספים / מאזן אמן" },
      { to: "בוטל", via: "SHOW.CANCEL_SHOW", effectsHe: "ביטול שורות כספים / משימות" },
      { to: "ממתין לתשובה", via: "SHOW.CREATE_SHOW", effectsHe: "יצירה (ברירת מחדל)" },
    ] }),
  L({ id: "SHOW_PAYMENT_STATUS", vocabulary: "SHOW.paymentStatuses", states: S(SHOW_VOCABULARIES.paymentStatuses), kind: "FREE", setBy: ["SHOW.EDIT_SHOW"], terminal: ["שולם", "בוטל"], special: [], noteHe: "מקדמה = D5 ממתין להחלטה" }),
  L({ id: "SHOW_PAYMENT_STATUS_LABEL", vocabulary: "LABEL.showPaymentStatuses", states: S(LABEL_VOCABULARIES.showPaymentStatuses), kind: "FREE", setBy: ["SHOW.EDIT_SHOW"], terminal: ["שולם", "בוטל"], special: [] }),
  L({ id: "DJ_CONFIRMATION", vocabulary: "SHOW.djConfirmation", states: S(SHOW_VOCABULARIES.djConfirmation), kind: "WORKFLOW", setBy: ["SHOW.DJ_CONFIRM"], terminal: [], special: [{ to: "ממתין לאישור", via: "SHOW.ASSIGN_DJ", effectsHe: "בחירת DJ מאפסת אישור" }], noteHe: "רק ה-DJ מאשר בפורטל שלו" }),
  L({ id: "DJ_CONFIRMATION_LABEL", vocabulary: "LABEL.djConfirmationStatuses", states: S(LABEL_VOCABULARIES.djConfirmationStatuses), kind: "WORKFLOW", setBy: ["LABEL.DJ_CONFIRM"], terminal: [], special: [] }),
  L({ id: "REHEARSAL_OPERATIONAL", vocabulary: "SHOW.rehearsalOperational", states: S(SHOW_VOCABULARIES.rehearsalOperational), kind: "FREE", setBy: ["SHOW.REHEARSAL"], terminal: ["בוצע", "בוטל"], special: [{ to: "התקיים", via: "PROJECT.AUTO_MARK_HELD", effectsHe: "סימון אוטומטי — לעולם לא נספר" }], noteHe: "D6 ממתין להחלטה" }),
  L({ id: "MIX_WORK_STATUS", vocabulary: "MIX.workStatus", states: S(MIX_VOCABULARIES.workStatus), kind: "FREE", setBy: ["MIX.EDIT_WORK"], terminal: ["אושר", "בוטל"],
    special: [{ to: "אושר", via: "MIX.MARK_COMPLETED", effectsHe: "Push לסטיבן + בקשת קבצים סופיים; ייתכן סיום פרויקט" }, { to: "נשלח", via: "MIX.SEND_TO_ENGINEER", effectsHe: "Push למהנדס" }, { to: "לא נשלח", via: "MIX.ASSIGN_ENGINEER", effectsHe: "יצירה" }] }),
  L({ id: "STEVEN_UI_STATUS", vocabulary: "MIX.stevenUiStatus", states: S(MIX_VOCABULARIES.stevenUiStatus), kind: "DERIVED", setBy: [], terminal: [], special: [], noteHe: "מיפוי תצוגה של סטטוס העבודה" }),
  L({ id: "STEVEN_UI_PAY", vocabulary: "MIX.stevenUiPay", states: S(MIX_VOCABULARIES.stevenUiPay), kind: "DERIVED", setBy: [], terminal: [], special: [], noteHe: "חלקי ≠ שולם" }),
  L({ id: "MIX_VERSION_STATUS", vocabulary: "MIX.versionStatus", states: S(MIX_VOCABULARIES.versionStatus), kind: "FREE", setBy: ["MIX.EDIT_OR_DELETE_VERSION", "UPDATE_MIX_VERSION_STATUS_OR_LABEL"], terminal: [], special: [{ to: "בבדיקה", via: "MIX.UPLOAD_VERSION", effectsHe: "העלאה" }] }),
  L({ id: "MIX_COMMENT_STATUS", vocabulary: "MIX.commentStatus", states: S(MIX_VOCABULARIES.commentStatus), kind: "WORKFLOW", setBy: ["MIX.RESOLVE_COMMENT", "RESOLVE_MIX_COMMENT", "REOPEN_MIX_COMMENT"], terminal: [], special: [{ to: "open", via: "MIX.ADD_COMMENT", effectsHe: "יצירה" }] }),
  L({ id: "ALBUM_TRACK_MIX_MASTER", vocabulary: "MIX.albumTrackMixMaster", states: S(MIX_VOCABULARIES.albumTrackMixMaster), kind: "FREE", setBy: ["PROJECT.ALBUM_TRACKS", "UPDATE_ALBUM_TRACK"], terminal: ["הושלם"], special: [] }),
  L({ id: "PROJECT_MIX_STAGES", vocabulary: "MIX.projectMixStages", states: S(MIX_VOCABULARIES.projectMixStages), kind: "FREE", setBy: ["PROJECT.CHANGE_STATUS"], terminal: [], special: [] }),
  L({ id: "RF_PRODUCTION_STATUS", vocabulary: "RF.productionStatus", states: S(RF_VOCABULARIES.productionStatus), kind: "FREE", setBy: ["RF.EDIT_PRODUCTION"], terminal: ["פורסם", "בוטל"],
    special: [{ to: "בוטל", via: "RF.CANCEL_PRODUCTION", effectsHe: "ניקוי משימות / יומן (רץ לפני השמירה — דורש הקשחה)" }, { to: "רעיון", via: "RF.CREATE_PRODUCTION", effectsHe: "יצירה" }, { to: "מאושר", via: "RF.MARK_PRODUCTION_APPROVED", effectsHe: "D7 ממתין להחלטה" }] }),
  L({ id: "RF_EDIT_STATUS", vocabulary: "RF.editStatus", states: S(RF_VOCABULARIES.editStatus), kind: "FREE", setBy: ["RF.EDIT_PRODUCTION"], terminal: ["פורסם"], special: [] }),
  L({ id: "RF_COLLECTION_STATUS", vocabulary: "RF.collectionStatus", states: S(RF_VOCABULARIES.collectionStatus), kind: "FREE", setBy: ["RF.EDIT_PRODUCTION"], terminal: [], special: [], noteHe: "תכנון ≠ גבייה בפועל" }),
  L({ id: "RF_BUDGET_ITEM_STATUS", vocabulary: "RF.budgetItemStatus", states: S(RF_VOCABULARIES.budgetItemStatus), kind: "FREE", setBy: ["RF.BUDGET_LINES"], terminal: ["שולם", "בוטל"], special: [] }),
  L({ id: "CLIP_DEAL_STATUS", vocabulary: "RF.clipDealStatus", states: S(RF_VOCABULARIES.clipDealStatus), kind: "DERIVED", setBy: [], terminal: [], special: [], noteHe: "נגזר מתשלומי הקליפ" }),
  L({ id: "CLIP_PAYMENT_STATUS", vocabulary: "RF.clipPaymentStatus", states: S(RF_VOCABULARIES.clipPaymentStatus), kind: "FREE", setBy: ["RF.CLIP_PAYMENTS", "PROJECT.EDIT_TRANSACTION"], terminal: [], special: [] }),
  L({ id: "VICTOR_STATUS", vocabulary: "VICTOR.status", states: S(VICTOR_VOCABULARIES.status), kind: "FREE", setBy: ["VICTOR.CHANGE_STATUS"], terminal: ["הושלם", "בוטל"], special: [{ to: "פעיל", via: "VICTOR.SEND_TO_VICTOR", effectsHe: "יצירה + רשומת שליחה" }] }),
  L({ id: "VICTOR_WORK_STATE", vocabulary: "VICTOR.workState", states: S(VICTOR_VOCABULARIES.workState), kind: "FREE", setBy: ["VICTOR.CHANGE_STATUS", "UPDATE_VICTOR_WORK_STATE"], terminal: [], special: [] }),
  L({ id: "VICTOR_OUTCOME", vocabulary: "VICTOR.outcome", states: S(VICTOR_VOCABULARIES.outcome), kind: "FREE", setBy: ["VICTOR.CHANGE_STATUS", "UPDATE_VICTOR_OUTCOME"], terminal: [], special: [] }),
  L({ id: "SESSION_STATUS", vocabulary: "SESSIONS.status", states: S(WD("SESSIONS", "status")), kind: "FREE", setBy: ["PROJECT.EDIT_SESSION"], terminal: ["התקיים", "בוטל", "לא הגיע"],
    special: [{ to: "התקיים", via: "PROJECT.AUTO_MARK_HELD", effectsHe: "אוטומטי בטעינת עמוד (שעון המכשיר)" }, { to: "מתוכנן", via: "PROJECT.CALENDAR_PULL", effectsHe: "משיכת יומן כשהאירוע זז קדימה" }] }),
  L({ id: "SESSION_REHEARSAL_STATUS", vocabulary: "SESSIONS.rehearsalStatus", states: S(WD("SESSIONS", "rehearsalStatus")), kind: "FREE", setBy: ["SHOW.REHEARSAL"], terminal: ["בוצע", "בוטל"], special: [], noteHe: "D6 ממתין להחלטה" }),
  L({ id: "TASK_STATUS", vocabulary: "TASKS.status", states: S(WD("TASKS", "status")), kind: "FREE", setBy: ["PROJECT.EDIT_TASK"], terminal: ["בוצע", "בוטל"], special: [{ to: "בוצע", via: "CALENDAR.SYNC_COMPLETED_TASKS", effectsHe: "סנכרון Google Tasks" }] }),
  L({ id: "ALBUM_TRACK_STATUS", vocabulary: "ALBUMS.trackStatus", states: S(WD("ALBUMS", "trackStatus")), kind: "FREE", setBy: ["PROJECT.ALBUM_TRACKS", "UPDATE_ALBUM_TRACK"], terminal: ["הושלם", "בוטל"], special: [] }),
  L({ id: "ALBUM_MIX_MASTER_STATUS", vocabulary: "ALBUMS.mixMasterStatus", states: S(WD("ALBUMS", "mixMasterStatus")), kind: "FREE", setBy: ["PROJECT.ALBUM_TRACKS", "UPDATE_ALBUM_TRACK"], terminal: ["הושלם"], special: [] }),
  L({ id: "DELIVERY_STATUS", vocabulary: "DELIVERY.deliveryStatus", states: S(WD("DELIVERY", "deliveryStatus")), kind: "WORKFLOW", setBy: ["PROJECT.DELIVERY"], terminal: ["delivered"], special: [] }),
  L({ id: "SOCIAL_CAMPAIGN_STATUS", vocabulary: "SOCIAL.campaignStatus", states: S(WD("SOCIAL", "campaignStatus")), kind: "FREE", setBy: ["PROJECT.SOCIAL"], terminal: ["completed"], special: [] }),
  L({ id: "SOCIAL_CONTENT_STATUS", vocabulary: "SOCIAL.contentStatus", states: S(WD("SOCIAL", "contentStatus")), kind: "FREE", setBy: ["PROJECT.SOCIAL", "UPDATE_SOCIAL_CONTENT"], terminal: ["published", "posted", "cancelled"], special: [] }),
];

/** Every vocabulary key that names a status / stage / state / outcome / confirmation (the set G3 must cover). */
export const STATUS_VOCAB_RE = /status|stage|state|outcome|confirmation|operational/i;
export function statusVocabularies(): Array<{ key: string; values: readonly string[] }> {
  const out: Array<{ key: string; values: readonly string[] }> = [];
  const add = (d: string, v: Record<string, unknown>) => { for (const [k, vals] of Object.entries(v)) if (Array.isArray(vals) && STATUS_VOCAB_RE.test(k) && !/ballHolder/.test(k)) out.push({ key: `${d}.${k}`, values: S(vals as string[]) }); };
  add("CLIENT", CLIENT_VOCABULARIES); add("LABEL", LABEL_VOCABULARIES); add("MIX", MIX_VOCABULARIES); add("PROJECT", PROJECT_VOCABULARIES);
  add("RF", RF_VOCABULARIES); add("SHOW", SHOW_VOCABULARIES); add("VICTOR", VICTOR_VOCABULARIES);
  for (const w of WORK_DOMAINS) add(w.id, w.vocabularies);
  return out;
}
