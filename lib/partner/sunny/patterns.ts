/**
 * Sunny — DERIVED operational patterns (One Brain stage 8, Owner-approved 2026-10-05). Pure, read-only, computed on every
 * read — never stored, never a fact, never a score, never a policy. A pattern is a HYPOTHESIS with its evidence:
 * "אני רואה דפוס אפשרי…", never "X תמיד מעכב".
 *
 * Levels (Owner-approved thresholds):
 *   OBSERVATION  1 occurrence
 *   WEAK         2 occurrences within 30 days                       → detail / internal only, never the executive brief
 *   REPEATED     3+ within 45 days, OR the same pattern on 2+ entities → may be raised with the Owner
 *   STRONG       REPEATED + no contradicting progress + a visible business consequence
 * An occurrence older than 60 days does not count; progress evidence lowers the level by one; the same event is never
 * counted twice from two sources (occurrences are de-duplicated by their source id).
 */
import type { GatewaySources } from "../gateway/core";
import type { OwnerInboxItem } from "../../owner-inbox";
import type { PartnerCompanyState } from "../eyes/types";
import { activeLinksOf, type InboxMemory } from "../../inbox-memory";
import { projectProgressEvents } from "./since";

const ok = <T,>(a: { status: string; value?: T } | undefined): T | null => (a && a.status === "OK" ? (a as { value: T }).value : null);
const DAY = 86_400_000;
export const PATTERN_WINDOWS = { weakDays: 30, repeatedDays: 45, maxAgeDays: 60 } as const;

export type PatternLevel = "OBSERVATION" | "WEAK" | "REPEATED" | "STRONG";
export interface Occurrence { sourceId: string; at: string; entity: string; he: string }
export interface DerivedPattern {
  code: string; level: PatternLevel; epistemic: "HYPOTHESIS"; hypothesisHe: string; entities: string[];
  occurrences: Occurrence[]; contradictingHe: string[]; consequenceHe: string | null;
  /** WEAK / OBSERVATION stay internal (detail); REPEATED / STRONG may be raised with the Owner */
  showToOwner: boolean;
}

/** The ONE level rule (pure). */
export function patternLevel(o: { occurrences: readonly Occurrence[]; nowMs: number; contradicting: number; consequence: boolean }): { level: PatternLevel; counted: Occurrence[] } | null {
  const seen = new Set<string>();
  const counted = o.occurrences.filter((x) => Number.isFinite(Date.parse(x.at)) && o.nowMs - Date.parse(x.at) <= PATTERN_WINDOWS.maxAgeDays * DAY && !seen.has(x.sourceId) && (seen.add(x.sourceId), true));
  if (!counted.length) return null;
  const within = (d: number) => counted.filter((x) => o.nowMs - Date.parse(x.at) <= d * DAY).length;
  const entities = new Set(counted.map((x) => x.entity)).size;
  const order: PatternLevel[] = ["OBSERVATION", "WEAK", "REPEATED", "STRONG"];
  let i = within(PATTERN_WINDOWS.repeatedDays) >= 3 || entities >= 2 ? 2 : within(PATTERN_WINDOWS.weakDays) >= 2 ? 1 : 0;
  if (i === 2 && o.contradicting === 0 && o.consequence) i = 3;
  if (o.contradicting > 0 && i > 0) i -= 1;
  return { level: order[i], counted };
}

const PUSH_RE = /(צריך לקדם|לקדם את|חייב להתקדם|חייבים להתקדם|תקוע|דחוף)/;
const ALMOST_RE = /(כמעט|עוד (\d+|שני|שתי|איזה)|נשאר(ו)? (רק )?|תיקונים|תיקון אחרון)/;

/** Every derived pattern the records support today (bounded; no ML, no store, no cron). */
export function derivePatterns(src: GatewaySources): DerivedPattern[] {
  const nowMs = src.now.getTime();
  const st = ok(src.state) as PartnerCompanyState | null;
  if (!st) return [];
  const inbox = (ok(src.ownerInbox) as OwnerInboxItem[] | null) ?? [];
  const mem = ok(src.inboxMemory) as InboxMemory | null;
  const out: DerivedPattern[] = [];
  const projectName = (key: string) => st.domains.projects.data?.index[key.slice("project:".length)]?.name ?? key;
  const progressBetween = (projectKey: string, fromIso: string, toIso: string) => projectKey.startsWith("project:")
    ? projectProgressEvents(src, projectKey.slice("project:".length)).filter((e) => Date.parse(e.at) > Date.parse(fromIso) && Date.parse(e.at) <= Date.parse(toIso)).length : 0;
  const push = (code: string, occ: Occurrence[], contradicting: string[], consequence: string | null, hypothesisHe: string) => {
    const lv = patternLevel({ occurrences: occ, nowMs, contradicting: contradicting.length, consequence: !!consequence });
    if (!lv) return;
    out.push({ code, level: lv.level, epistemic: "HYPOTHESIS", hypothesisHe, entities: [...new Set(lv.counted.map((x) => x.entity))], occurrences: lv.counted.slice(-6), contradictingHe: contradicting.slice(0, 3), consequenceHe: consequence, showToOwner: lv.level === "REPEATED" || lv.level === "STRONG" });
  };
  const linkedKeys = (itemId: string) => (mem ? [...new Set(activeLinksOf(mem.links, (l) => l.itemId === itemId).map((l) => l.entityKey))] : []);

  // C — "צריך לקדם X" again and again without progress between the notes (per exact linked entity)
  const byEntity = new Map<string, Occurrence[]>();
  for (const i of inbox) if (PUSH_RE.test(i.body)) for (const k of linkedKeys(i.id)) byEntity.set(k, [...(byEntity.get(k) ?? []), { sourceId: `inbox:${i.id}`, at: i.createdAt, entity: k, he: i.body.slice(0, 80) }]);
  for (const [k, occ] of byEntity) {
    if (occ.length < 2) continue;
    const sorted = [...occ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const contra = sorted.slice(1).flatMap((o, n) => (progressBetween(k, sorted[n].at, o.at) ? [`הייתה התקדמות רשומה בין העדכונים (${projectName(k)})`] : []));
    push("REPEATED_PUSH_NO_PROGRESS", sorted, contra, null, `"${projectName(k)}" עלה כ"צריך לקדם" ${sorted.length} פעמים — ייתכן שחסר לו צעד הבא / בעלים ברור (השערה)`);
  }

  // B — "כמעט סיימנו / עוד N תיקונים" that keeps coming back on the same entity without completion
  const almost = new Map<string, Occurrence[]>();
  for (const x of mem?.interpretations ?? []) if (!x.retractedAt && x.openGaps.length) almost.set(x.entityKey, [...(almost.get(x.entityKey) ?? []), { sourceId: `interp:${x.id}`, at: x.createdAt, entity: x.entityKey, he: x.openGaps.join(" · ").slice(0, 80) }]);
  for (const i of inbox) if (ALMOST_RE.test(i.body)) for (const k of linkedKeys(i.id)) almost.set(k, [...(almost.get(k) ?? []), { sourceId: `inbox:${i.id}`, at: i.createdAt, entity: k, he: i.body.slice(0, 80) }]);
  for (const [k, occ] of almost) {
    if (occ.length < 2) continue;
    const done = st.domains.projects.data?.index[k.slice(8)]?.status === "הושלם";
    push("ALMOST_DONE_REPEATS", occ, done ? ["הפרויקט סומן הושלם"] : [], null, `ב"${projectName(k)}" חוזר "כמעט סיימנו / נשארו תיקונים" — ייתכן שסבבי התיקונים לא נסגרים (השערה)`);
  }

  // A — sessions held while the project still says "לא התחיל" (activity without recorded status movement)
  const notStarted = (st.domains.projects.data?.open ?? []).filter((p) => p.status === "לא התחיל");
  const occA: Occurrence[] = [];
  for (const p of notStarted) for (const s of st.domains.sessions.data?.items ?? []) if (s.projectId === p.id && s.status === "התקיים" && s.dateYmd) occA.push({ sourceId: `session:${s.id}`, at: `${s.dateYmd}T12:00:00Z`, entity: `project:${p.id}`, he: `סשן ${s.dateYmd} ב"${p.name}" שעדיין "לא התחיל"` });
  push("ACTIVITY_WITHOUT_STATUS", occA, [], null, "סשנים מתקיימים בפרויקטים שעדיין רשומים 'לא התחיל' — הסטטוס כנראה לא מתעדכן, או שההתקדמות לא נרשמת (השערה)");

  // J — the Owner as the bottleneck: several works whose recorded ball is his (the app's own computeVictorBall)
  const victorOwner = (st.domains.victor.data?.active ?? []).filter((w) => w.ball.holder === "owner" && w.lastUploadAt);
  const recentNotes = (st.domains.victor.data?.active ?? []).filter((w) => w.lastNotesSentAt && nowMs - Date.parse(w.lastNotesSentAt) <= 7 * DAY).length;
  const passed = victorOwner.filter((w) => w.projectId && (st.domains.projects.data?.open ?? []).some((p) => p.id === w.projectId && p.deadline.daysTo !== null && p.deadline.daysTo < 0));
  push("OWNER_FEEDBACK_BOTTLENECK", victorOwner.map((w) => ({ sourceId: `victor-work:${w.id}`, at: w.lastUploadAt!, entity: `victor-work:${w.id}`, he: `${w.title} — ממתין לפידבק שלך` })),
    recentNotes ? [`שלחת הערות ל-${recentNotes} עבודות בשבוע האחרון`] : [], passed.length ? `${passed.length} מהעבודות שמחכות לך בפרויקטים שהדדליין שלהם עבר` : null,
    `${victorOwner.length} עבודות של ויקטור מחכות לפידבק שלך לפי הרשומות — ייתכן שהצוואר הוא אצלך ולא אצלו (השערה)`);

  // H — work moves but the project has no financial setup (price) recorded
  const occH: Occurrence[] = [];
  for (const p of (st.domains.projects.data?.open ?? []).filter((x) => x.active && !x.hasFinanceSetting && x.businessType !== "לייבל")) {
    const last = projectProgressEvents(src, p.id).filter((e) => nowMs - Date.parse(e.at) <= PATTERN_WINDOWS.repeatedDays * DAY).at(-1);
    if (last) occH.push({ sourceId: `project:${p.id}`, at: last.at, entity: `project:${p.id}`, he: `"${p.name}" מתקדם (${last.he}) ואין לו הגדרת מחיר` });
  }
  push("PROGRESS_WITHOUT_PRICE", occH, [], null, "עבודת לקוח מתקדמת בלי מחיר מוגדר — ייתכן שהתמחור נקבע מחוץ למערכת או נשכח (השערה)");

  const rank: Record<PatternLevel, number> = { STRONG: 0, REPEATED: 1, WEAK: 2, OBSERVATION: 3 };
  return out.sort((a, b) => rank[a.level] - rank[b.level] || a.code.localeCompare(b.code));
}
