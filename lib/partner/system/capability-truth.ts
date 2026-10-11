/**
 * Sunny CAPABILITY TRUTH — "סאני, את יכולה לעשות את זה?" answered from ONE source (pure, 2026-10-11).
 *
 * Why: the hand-written capability texts (limitations, the business-action reasons, the calendar / connector / finance
 * notes) drifted from the Universal Action Layer — Sunny was told "no calendar write / finance execution is off / no
 * client actions" while she was executing exactly those after the Boss's approval. Every execution statement is now
 * DERIVED here from the action registry (lib/partner/act) and the system domains; the knowledge capability
 * action_registry serves it (mode can_i), system_awareness carries a derived actions line per domain (limitations / overview), and the Claude connector
 * applies its LIVE state on top (applyCapabilityRuntime: which switches are on, what this token was granted, and whether
 * Sunny has ever executed the action) — the code says what EXISTS, the connector says what works HERE.
 *
 * States (closed vocabulary):
 *   READ                       Sunny can read it (a registered read capability).
 *   EXECUTABLE_AFTER_APPROVAL  a typed action Sunny runs through Claude after the Boss approves its exact preview.
 *   CONFIGURED_NOT_VERIFIED    executable in code and allowed here, but Sunny has no successful execution of it yet.
 *   PREPARE_ONLY               Sunny prepares / explains; the Boss performs it himself (OAuth, a device, the dashboard).
 *   BLOCKED_PERMISSION         a security boundary, another person's own act, a switch that is off, or a missing scope.
 *   BLOCKED_TECHNICAL          needs a primitive / hardening / a data model / an Owner decision first.
 *   SYSTEM_AUTOMATIC           Redbloods does it by itself — nobody's action.
 *   NOT_REGISTERED             nothing in the registry matches — never proof it cannot exist; ask / look further.
 * Never a generic writer, never an execution: this module only describes.
 */
import { ACTION_CONTRACTS } from "../act/registry";
import { COVERAGE_MATRIX, HUMAN_BOUNDARIES } from "../act/matrix";
import { ALL_PRIMITIVES } from "../act/primitives";
import { PRIMITIVE_SYSTEM_DOMAIN } from "../act/coverage-map";
import { bossCanSunnyCannot } from "../act/coverage";
import type { ActionContract } from "../act/types";
import { DOMAIN_CONTRACTS } from "./registry";
import type { CapabilityState, DomainContract } from "./types";

export type CapabilityAnswerState =
  | "READ" | "EXECUTABLE_AFTER_APPROVAL" | "CONFIGURED_NOT_VERIFIED" | "PREPARE_ONLY"
  | "BLOCKED_PERMISSION" | "BLOCKED_TECHNICAL" | "SYSTEM_AUTOMATIC" | "NOT_REGISTERED";

export const CAPABILITY_STATE_HE: Readonly<Record<CapabilityAnswerState, string>> = {
  READ: "אני יכולה לקרוא את זה",
  EXECUTABLE_AFTER_APPROVAL: "אני יכולה לבצע את זה דרך Claude — אחרי שתאשר את התצוגה המדויקת",
  CONFIGURED_NOT_VERIFIED: "הפעולה קיימת ומותרת כאן, אבל עוד לא ביצעתי אותה אף פעם בהצלחה — אחרי אישורך אבצע ואאמת בקריאה טרייה",
  PREPARE_ONLY: "אני יכולה רק להכין / להסביר — את הביצוע עצמו אתה עושה",
  BLOCKED_PERMISSION: "חסום בגלל הרשאה (גבול אבטחה, פעולה של אדם אחר, מתג כבוי או הרשאה שלא ניתנה לחיבור)",
  BLOCKED_TECHNICAL: "חסום טכנית — חסרה יכולת / חיזוק / החלטה לפני שאפשר",
  SYSTEM_AUTOMATIC: "Redbloods עושה את זה לבד — זו לא פעולה של אף אחד",
  NOT_REGISTERED: "לא מצאתי את זה ברישום — זה לא מוכיח שזה לא קיים; צריך לנסח אחרת או לבדוק ברשימת הפעולות",
};

const COVERAGE_BY_ID = new Map(COVERAGE_MATRIX.map((r) => [r.id, r]));
const isBoss = (c: ActionContract) => c.availabilityDetail !== "SYSTEM_AUTOMATIC" && c.availabilityDetail !== "OTHER_USER_PORTAL_ONLY" && c.availabilityDetail !== "SUNNY_NATIVE";

/** The code-level state of one action contract (before the connector's live state). */
export function baseStateOf(c: ActionContract): { state: CapabilityAnswerState; whyEn: string } {
  const row = COVERAGE_BY_ID.get(c.id);
  switch (c.availabilityDetail) {
    case "EXECUTABLE": return { state: "EXECUTABLE_AFTER_APPROVAL", whyEn: row?.claude === "OWNER_DEFERRED_CLAUDE_FILE_TRANSFER" ? `executable; the NEW file reaches the Sunny Inbox outside Claude first (${row.claudeReason ?? "file channel"})` : "a registered typed action: plan → exact preview → the Boss's approval → execute → fresh read" };
    case "EXECUTABLE_VIA_DASHBOARD_APPROVAL": return { state: "PREPARE_ONLY", whyEn: "approved and executed from the Redbloods dashboard" };
    case "SUNNY_NATIVE": return { state: "READ", whyEn: c.reason };
    case "SYSTEM_AUTOMATIC": return { state: "SYSTEM_AUTOMATIC", whyEn: c.reason };
    case "OTHER_USER_PORTAL_ONLY": return { state: "BLOCKED_PERMISSION", whyEn: `another person's own action — ${c.reason}` };
    case "SECURITY_EXCLUDED": return HUMAN_BOUNDARIES[c.id]
      ? { state: "PREPARE_ONLY", whyEn: `only the Boss can do it himself — ${HUMAN_BOUNDARIES[c.id]}` }
      : { state: "BLOCKED_PERMISSION", whyEn: `security boundary — ${row?.ownerEquivalent ?? c.reason}` };
    default: return { state: "BLOCKED_TECHNICAL", whyEn: row?.requiredWork ?? c.reason };
  }
}

// ── per domain (the derived actions line) ───────────────────────────────────────────────────────────────
/** Registered primitives per Sunny system domain (PRIMITIVE_SYSTEM_DOMAIN is complete — G10). */
export function executableByDomain(): Readonly<Record<string, ReadonlyArray<{ id: string; he: string }>>> {
  const out: Record<string, Array<{ id: string; he: string }>> = {};
  for (const p of ALL_PRIMITIVES) {
    const d = PRIMITIVE_SYSTEM_DOMAIN[p.actionId];
    if (d) (out[d] ??= []).push({ id: p.actionId, he: p.meta.he });
  }
  return out;
}

/** The ONE execution statement of a domain — derived, so a limitation can never claim the opposite. */
export function domainActionsLineHe(domainId: string): string {
  const acts = executableByDomain()[domainId] ?? [];
  if (!acts.length) return "פעולות כתיבה: אין לסאני פעולה מוקלדת בתחום הזה (רק קריאה). פעולה מסוימת — action_registry מצב can_i.";
  const shown = acts.slice(0, 8).map((a) => a.he).join(" · ");
  return `פעולות כתיבה דרך Claude — ${acts.length} פעולות מוקלדות, כל אחת רק אחרי שאישרת את התצוגה המדויקת: ${shown}${acts.length > 8 ? ` ועוד ${acts.length - 8}` : ""}. פעולה שלא ברשימה — נבדקת ב-can_i לפני שעונים.`;
}

/** Served capability states of a domain: a domain with executable actions is never READ_ONLY. */
export function servedStatesOf(d: DomainContract): CapabilityState[] {
  const exec = (executableByDomain()[d.id] ?? []).length > 0;
  const s = d.states.filter((x) => !(exec && x === "READ_ONLY"));
  return exec && !s.includes("OWNER_APPROVAL_REQUIRED") ? [...s, "OWNER_APPROVAL_REQUIRED"] : s;
}

// ── counts (one line, each number named) ───────────────────────────────────────────────────────────────
export function actionCountsHe(): { countsHe: string; primitives: number; executableContracts: number; bossActions: number; sunnyExecutableViaClaude: number } {
  const g = bossCanSunnyCannot();
  const primitives = ALL_PRIMITIVES.length;
  const executableContracts = ACTION_CONTRACTS.filter((c) => c.availability === "SUNNY_EXECUTABLE").length;
  const rest = g.bossActions - g.sunnyExecutableViaClaude;
  const sec = g.byDetail.SECURITY_EXCLUDED ?? 0;
  return {
    countsHe: `${g.sunnyExecutableViaClaude} מתוך ${g.bossActions} הפעולות שאתה עושה ב-Redbloods אני מבצעת דרך Claude, כל אחת רק אחרי אישורך. ${primitives} מהן הן פעולות מוקלדות עם מבצע משלהן, והשאר פעולות עסקיות שמבוצעות דרכן. ${rest} לא: ${sec} גבול אבטחה / פעולה שרק אתה עושה בעצמך, ${rest - sec} מחכות ליכולת או להחלטה.`,
    primitives, executableContracts, bossActions: g.bossActions, sunnyExecutableViaClaude: g.sunnyExecutableViaClaude,
  };
}

// ── matching a question ("ליצור הופעה", "calendar event", "CREATE_SHOW") ──────────────────────────────
/** Each word of the request → the forms it is matched by (Hebrew verb → its action noun + the English word of the
 *  census rows, which carry only an English meaning). A word scores once, whichever form hits. */
const SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  ליצור: ["יצירת", "create"], לפתוח: ["פתיחת", "open", "create"], למחוק: ["מחיקת", "delete"], לשנות: ["שינוי", "change", "update"], לעדכן: ["עדכון", "update"],
  לשלוח: ["שליחת", "send", "notify"], לקבוע: ["קביעת", "schedule", "set"], לרשום: ["רישום", "record", "add"], לסמן: ["סימון", "mark"], להעלות: ["העלאת", "upload"],
  לבטל: ["ביטול", "cancel"], לסגור: ["סגירת", "close"], להזיז: ["שינוי", "move", "reschedule"], לשלם: ["תשלום", "pay", "payment"], לשייך: ["שיוך", "assign"],
  להוסיף: ["הוספת", "add"], לקשר: ["קישור", "link"], לאשר: ["אישור", "confirm", "approve"], להמיר: ["המרת", "convert"], לנתק: ["ניתוק", "disconnect"],
  לחבר: ["חיבור", "connect"], לצרף: ["צירוף", "attach"], לדרג: ["דירוג", "rate"], להסתיר: ["הסתרה", "hide"], לפצל: ["פיצול", "split"], לקרוא: ["קריאה", "read"], לראות: ["קריאה", "read"],
  יומן: ["יומן", "calendar"], הופעה: ["הופעה", "show"], לקוח: ["לקוח", "client"], משימה: ["משימה", "task"], הוצאה: ["הוצאה", "expense"], הכנסה: ["הכנסה", "income"],
  תשלום: ["תשלום", "payment", "paid"], פרויקט: ["פרויקט", "project"], סשן: ["סשן", "session"], הצעה: ["הצעה", "proposal"], ביט: ["ביט", "beat"], פגישה: ["פגישה", "meeting"],
  קובץ: ["קובץ", "file"], משכורת: ["משכורת", "salary"], דוח: ["דוח", "report"], גוגל: ["google"], מיקס: ["מיקס", "mix"], ריליס: ["ריליס", "release"],
};
const STOP = new Set(["את", "של", "על", "עם", "יכולה", "יכול", "אפשר", "האם", "לי", "זה", "גם", "אני", "אתה", "the", "a", "an", "to", "can", "you", "of", "for", "in", "with", "and", "or", "from", "on", "at", "by", "my", "me", "it", "do", "is"]);
const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}\s_]/gu, " ");
/** Only the four one-letter prepositions (ו / ה / ב / ל) are stripped — never מ / ש / כ (they start real words). */
const stripPrefix = (t: string) => (/^[֐-׿]/.test(t) && t.length > 3 && /^[והבל]/.test(t) ? t.slice(1) : t);
function wordsOf(q: string): string[][] {
  return norm(q).split(/\s+/).filter((t) => t.length >= 2 && !STOP.has(t)).map((t) => {
    const base = SYNONYMS[t] ?? SYNONYMS[stripPrefix(t)] ?? [];
    return [...new Set([t, stripPrefix(t), ...base])];
  });
}
const scoreOf = (words: readonly string[][], hay: string) => words.reduce((n, forms) => n + (forms.some((f) => hay.includes(f)) ? 1 : 0), 0);

export interface CanIItem {
  kind: "ACTION" | "READ";
  id: string;
  he: string;
  state: CapabilityAnswerState;
  baseState: CapabilityAnswerState;
  stateHe: string;
  whyEn: string;
  domain: string;
  effects: readonly string[];
  confirmation: string | null;
  /** Set by the connector only (applyCapabilityRuntime): the latest verified execution through Sunny. */
  verifiedAt?: string | null;
  verification?: "VERIFIED" | "NEVER_EXECUTED" | "NOT_CHECKED_HERE";
}

function actionItem(c: ActionContract): CanIItem {
  const b = baseStateOf(c);
  return { kind: "ACTION", id: c.id, he: c.meaningHe ?? c.meaningEn, state: b.state, baseState: b.state, stateHe: CAPABILITY_STATE_HE[b.state], whyEn: b.whyEn, domain: c.domain, effects: [...c.effects], confirmation: c.confirmation, verification: "NOT_CHECKED_HERE" };
}
function readItem(d: DomainContract): CanIItem {
  return { kind: "READ", id: `READ:${d.id}`, he: d.titleHe, state: "READ", baseState: "READ", stateHe: CAPABILITY_STATE_HE.READ, whyEn: `read support ${d.support.read} through ${d.readCapabilities.join(", ")}`, domain: d.id, effects: [], confirmation: null };
}

/** Answer ONE capability question: exact action id, or words. Read entries come from the domains Sunny reads. */
export function canI(input: { action?: string | null; q?: string | null }): { items: CanIItem[]; matched: boolean } {
  if (input.action) {
    const c = ACTION_CONTRACTS.find((x) => x.id === input.action);
    return c ? { items: [actionItem(c)], matched: true } : { items: [], matched: false };
  }
  const words = wordsOf(input.q ?? "");
  if (!words.length) return { items: [], matched: false };
  // at least half of the words must hit (a single stray word never makes a match)
  const need = Math.max(1, Math.ceil(words.length / 2));
  const acts = ACTION_CONTRACTS.filter(isBoss).map((c) => ({ c, s: scoreOf(words, norm(`${c.meaningHe ?? ""} ${c.meaningEn} ${c.id.replace(/[._]/g, " ")}`)) })).filter((x) => x.s >= need);
  const top = acts.length ? Math.max(...acts.map((x) => x.s)) : 0;
  const actionItems = acts.filter((x) => x.s === top).sort((a, b) => Number(baseStateOf(b.c).state === "EXECUTABLE_AFTER_APPROVAL") - Number(baseStateOf(a.c).state === "EXECUTABLE_AFTER_APPROVAL")).slice(0, 8).map((x) => actionItem(x.c));
  const reads = DOMAIN_CONTRACTS.filter((d) => d.support.read !== "MISSING" && d.support.read !== "INTENTIONALLY_UNAVAILABLE")
    .map((d) => ({ d, s: scoreOf(words, norm(`${d.titleHe} ${d.id.replace(/_/g, " ")} ${d.readCapabilities.join(" ").replace(/_/g, " ")}`)) })).filter((x) => x.s >= need)
    .sort((a, b) => b.s - a.s).slice(0, 2).map((x) => readItem(x.d));
  const items = [...actionItems, ...reads];
  return { items, matched: items.length > 0 };
}

// ── the connector's LIVE state (applied in the connector process, never stored) ────────────────────────────
export interface CapabilityRuntime {
  /** Which connector switches are on AND bound in this deployment (names only — never a value / secret). */
  switches: Readonly<{ act: boolean; answer: boolean; financeAnswers: boolean; knowledge: boolean; observe: boolean; ownerDecide: boolean }>;
  /** What THIS token was granted. */
  scopes: Readonly<{ act: boolean; answer: boolean; knowledge: boolean; observe: boolean }>;
  /** actionId → the latest step of it that applied (ISO) / null = none found; null map = history not readable here. */
  executions: Readonly<Record<string, string | null>> | null;
}

export function runtimeStateOf(it: CanIItem, rt: CapabilityRuntime): Pick<CanIItem, "state" | "stateHe" | "whyEn" | "verifiedAt" | "verification"> {
  if (it.kind !== "ACTION" || it.baseState !== "EXECUTABLE_AFTER_APPROVAL") return { state: it.state, stateHe: it.stateHe, whyEn: it.whyEn, verification: it.verification };
  if (!rt.switches.act) return { state: "BLOCKED_PERMISSION", stateHe: CAPABILITY_STATE_HE.BLOCKED_PERMISSION, whyEn: "the action switch of this connector is off — nothing can be executed from Claude right now", verification: "NOT_CHECKED_HERE" };
  if (!rt.scopes.act) return { state: "BLOCKED_PERMISSION", stateHe: CAPABILITY_STATE_HE.BLOCKED_PERMISSION, whyEn: "this Claude connection was not granted the action permission (partner:act) — the Boss reconnects and approves it", verification: "NOT_CHECKED_HERE" };
  if (!rt.executions) return { state: it.state, stateHe: it.stateHe, whyEn: `${it.whyEn} (execution history not readable now — verification unknown)`, verification: "NOT_CHECKED_HERE" };
  const at = rt.executions[it.id] ?? null;
  return at
    ? { state: "EXECUTABLE_AFTER_APPROVAL", stateHe: CAPABILITY_STATE_HE.EXECUTABLE_AFTER_APPROVAL, whyEn: `${it.whyEn}; last verified execution ${at.slice(0, 10)}`, verifiedAt: at, verification: "VERIFIED" }
    : { state: "CONFIGURED_NOT_VERIFIED", stateHe: CAPABILITY_STATE_HE.CONFIGURED_NOT_VERIFIED, whyEn: `${it.whyEn}; no successful execution through Sunny found`, verifiedAt: null, verification: "NEVER_EXECUTED" };
}

/** The executable action ids of a can_i payload (the connector looks up their history — nothing else). */
export function canIExecutableIds(payload: Record<string, unknown>): string[] {
  const items = Array.isArray(payload.items) ? (payload.items as Array<{ fields?: Partial<CanIItem> }>) : [];
  return items.map((i) => i.fields).filter((f): f is CanIItem => !!f && f.kind === "ACTION" && f.baseState === "EXECUTABLE_AFTER_APPROVAL").map((f) => f.id).slice(0, 8);
}

const SWITCH_HE: Readonly<Record<keyof CapabilityRuntime["switches"], string>> = { act: "ביצוע פעולות", answer: "מענה לשאלות של סאני", financeAnswers: "מענה לשאלות כספים", knowledge: "שמירת ידע ארגוני", observe: "מוח / מעקב (observe)", ownerDecide: "אישור בקשות מהצ'אט" };

/** PURE: a can_i payload + the connector's live state → the same payload with live states and a runtime summary. */
export function applyCapabilityRuntime(payload: Record<string, unknown>, rt: CapabilityRuntime): Record<string, unknown> {
  const items = Array.isArray(payload.items) ? (payload.items as Array<Record<string, unknown> & { fields?: CanIItem }>) : [];
  const next = items.map((i) => (i.fields && (i.fields.kind === "ACTION" || i.fields.kind === "READ") ? { ...i, fields: { ...i.fields, ...runtimeStateOf(i.fields, rt) } } : i));
  const runtime = {
    switchesHe: Object.entries(rt.switches).map(([k, on]) => `${SWITCH_HE[k as keyof CapabilityRuntime["switches"]]}: ${on ? "דלוק" : "כבוי"}`),
    scopesGranted: Object.entries(rt.scopes).filter(([, v]) => v).map(([k]) => `partner:${k}`),
    executionHistory: rt.executions ? "READ" : "NOT_READABLE",
    noteHe: "זה המצב החי של החיבור הזה (מתגים והרשאות בלבד — אף פעם לא ערך או סוד). 'אומת' = יש ביצוע מוצלח שלי בהיסטוריה.",
  };
  return { ...payload, items: next, runtime };
}
