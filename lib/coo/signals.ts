/**
 * Signals — PURE. One signal = one verified fact that passed a rule. Every signal
 * carries its evidence (with source + asOf), the rules that fired, the coverage it
 * rests on and what is missing to make the conclusion complete.
 *
 * A signal is NOT a card: signals attach to Cases (cases.ts). Thresholds and tier
 * rules come only from config.ts (provisional). Nothing here writes anything.
 */
import type { CooConfig, TierRule, Cond } from "./config";
import type {
  CompanyState, Evidence, EntityRef, RuleFired, Signal, SignalType, Tier, Rich,
} from "./types";
import { diffDays, fullDate, ilYmd, shortDate } from "./dates";
import { projectLiveness } from "./liveness";
import { S, T, money, rich } from "./rich";

export const TIER_ORDER: Tier[] = ["P0", "P1", "P2", "P3"];
export const tierRank = (t: Tier) => TIER_ORDER.indexOf(t);
export const betterTier = (a: Tier, b: Tier): Tier => (tierRank(a) <= tierRank(b) ? a : b);
export const worseTier = (a: Tier, b: Tier): Tier => (tierRank(a) >= tierRank(b) ? a : b);

interface TierCtx { status?: string; daysOverdue?: number; daysTo?: number; count?: number; stuck?: number; blocker?: boolean; past?: boolean; live?: boolean }

function condMet(c: Cond, x: TierCtx): boolean {
  if (c.daysOverdueGte !== undefined) return x.daysOverdue !== undefined && x.daysOverdue >= c.daysOverdueGte;
  if (c.daysToLte !== undefined) return x.daysTo !== undefined && x.daysTo <= c.daysToLte;
  if (c.countGte !== undefined) return x.count !== undefined && x.count >= c.countGte;
  if (c.stuckGte !== undefined) return x.stuck !== undefined && x.stuck >= c.stuckGte;
  if (c.blockerPresent) return x.blocker === true;
  if (c.past) return x.past === true;
  if (c.live) return x.live === true;
  return false;
}
function condText(c: Cond, x: TierCtx): string {
  if (c.daysOverdueGte !== undefined) return `איחור של ${x.daysOverdue} ימים ≥ סף ${c.daysOverdueGte}`;
  if (c.daysToLte !== undefined) return `${x.daysTo} ימים לתאריך ≤ סף ${c.daysToLte}`;
  if (c.countGte !== undefined) return `כמות ${x.count} ≥ סף ${c.countGte}`;
  if (c.stuckGte !== undefined) return `${x.stuck} תקועות ≥ סף ${c.stuckGte}`;
  if (c.blockerPresent) return "יש blocker מוגדר";
  if (c.past) return "התאריך כבר עבר";
  if (c.live) return "יש סימני פעילות חיה בפרויקט";
  return "";
}

/** Tier for a signal from its config rule. Returns the tier and the human reasons. */
export function resolveTier(rule: TierRule, x: TierCtx): { tier: Tier; reasons: string[] } {
  let tier: Tier = rule.byStatus && x.status && rule.byStatus[x.status] ? rule.byStatus[x.status] : rule.base;
  const reasons = [rule.byStatus && x.status && rule.byStatus[x.status]
    ? `בסיס ${tier} לסטטוס "${x.status}" (config)` : `בסיס ${tier} (config)`];
  for (const e of rule.escalate ?? []) {
    if (condMet(e.when, x) && tierRank(e.to) < tierRank(tier)) {
      tier = e.to;
      reasons.push(`הועלה ל-${e.to}: ${condText(e.when, x)}`);
    }
  }
  for (const d of rule.demote ?? []) {
    if (condMet(d.when, x) && tierRank(tier) < 3) {
      const lowered = TIER_ORDER[Math.min(3, tierRank(tier) + d.by)];
      reasons.push(`הורד מ-${tier} ל-${lowered}: ${condText(d.when, x)} (config)`);
      tier = lowered;
    }
  }
  const cap = rule.capByStatus && x.status ? rule.capByStatus[x.status] : undefined;
  if (cap && tierRank(tier) < tierRank(cap)) { tier = cap; reasons.push(`מוגבל ל-${cap} לסטטוס "${x.status}" (config)`); }
  return { tier, reasons };
}

export interface SignalBuildCtx { state: CompanyState; cfg: CooConfig; today: string; asOf: string }

const ev = (
  c: SignalBuildCtx, id: string, label: string, value: Evidence["value"], display: string, kind: Evidence["kind"],
  source: Evidence["source"], extra: Partial<Evidence> = {},
): Evidence => ({ id, label, value, display: value === null ? "לא ידוע" : display, kind, source, asOf: c.asOf, ...extra });

const moneyEv = (c: SignalBuildCtx, id: string, label: string, amount: number | null, currency: string, source: Evidence["source"]): Evidence =>
  ev(c, id, label, amount, amount === null ? "לא ידוע" : money(amount, currency), "money", source, { currency });

function makeSignal(
  c: SignalBuildCtx,
  p: {
    type: SignalType; key: string; entity: EntityRef; role: Signal["role"]; title: Rich; short: Rich;
    evidence: Evidence[]; rules: RuleFired[]; coverageKeys: string[]; lowCoverage?: boolean; missing?: string[];
    tierCtx: TierCtx; sort: number; klass?: keyof CooConfig["sortClass"];
    /** Ambiguous evidence: the tier never goes above this, and we say why. */
    cap?: { tier: Tier; reason: string };
    hypotheses?: string[];
    detail?: Rich;
  },
): Signal {
  const rule = (c.cfg.tiers as Record<string, TierRule>)[p.type];
  const resolved = resolveTier(rule, p.tierCtx);
  let { tier } = resolved;
  const reasons = [...resolved.reasons];
  if (p.cap && tierRank(tier) < tierRank(p.cap.tier)) { tier = p.cap.tier; reasons.push(`מוגבל ל-${p.cap.tier}: ${p.cap.reason}`); }
  const cap = c.cfg.caseRules.lowCoverageCap;
  if (p.lowCoverage && tierRank(tier) < tierRank(cap)) { tier = cap; reasons.push(`כיסוי חלקי — מוגבל ל-${cap}`); }
  return {
    id: `${p.type}:${p.key}`, type: p.type, entity: p.entity, role: p.role, tier, tierReasons: reasons, title: p.title, short: p.short,
    evidence: p.evidence, rules: p.rules, coverageKeys: p.coverageKeys, lowCoverage: !!p.lowCoverage, missing: p.missing ?? [], sort: p.sort,
    sortClass: c.cfg.sortClass[p.klass ?? c.cfg.signalClass[p.type]],
    ...(p.hypotheses && p.hypotheses.length ? { hypotheses: p.hypotheses } : {}),
    ...(p.detail && p.detail.length ? { detail: p.detail } : {}),
  };
}

export const projectEntity = (state: CompanyState, id: string): EntityRef =>
  ({ type: "project", id, name: state.projects?.index[id]?.name ?? id });
const TEAM_STEVEN: EntityRef = { type: "team", id: "steven", name: "Steven" };
const TEAM_VICTOR: EntityRef = { type: "team", id: "victor", name: "Victor" };
const COMPANY_MONEY: EntityRef = { type: "company", id: "money", name: "כסף" };
const COMPANY_TASKS: EntityRef = { type: "company", id: "tasks", name: "משימות" };
const COMPANY_SHOWS: EntityRef = { type: "company", id: "shows", name: "הופעות" };
const COMPANY_ALERTS: EntityRef = { type: "company", id: "alerts", name: "התראות קיימות" };
const COMPANY_STALE: EntityRef = { type: "company", id: "stale_deadlines", name: "דדליינים ישנים" };
const COMPANY_STALE_INTERNAL: EntityRef = { type: "company", id: "stale_internal", name: "דדליינים פנימיים ישנים" };

const daysWord = (n: number) => (n === 1 ? "יום" : "ימים");

export function detectSignals(state: CompanyState, cfg: CooConfig): Signal[] {
  const c: SignalBuildCtx = { state, cfg, today: state.meta.todayIL, asOf: state.meta.asOf };
  const out: Signal[] = [];
  const idx = state.projects?.index ?? {};

  // ── 1. project deadlines ────────────────────────────────────────────────────
  // An overdue deadline 30+ days old is STALE metadata (one aggregated notice) unless a forward-looking
  // date corroborates it. Otherwise it is a normal overdue/due-soon signal, prioritised by live activity.
  const staleInternal: Array<{ who: "Steven" | "Victor"; id: string; title: string; ymd: string; od: number; note: string }> = [];
  const stale: Array<{ id: string; name: string; status: string; ymd: string; od: number; upd: number | null; liveText: string }> = [];
  for (const p of state.projects?.open ?? []) {
    if (!p.active || p.deadline.ymd === null || p.deadline.daysTo === null) continue;
    const d = p.deadline.daysTo;
    const overdue = d < 0;
    if (!overdue && d > cfg.dueSoonDays) continue;
    const lv = projectLiveness(state, p, cfg);
    if (overdue && -d >= cfg.staleDeadlineDays) {
      stale.push({ id: p.id, name: p.name, status: p.status, ymd: p.deadline.ymd, od: -d, upd: p.daysSinceUpdate, liveText: lv.signs.map((x) => x.text).join(", ") });
      continue;
    }
    const src = { table: "projects", id: p.id, field: "deadline" };
    const missing: string[] = [];
    if (p.daysSinceUpdate !== null && p.daysSinceUpdate >= cfg.staleProjectDays) {
      missing.push(`הפרויקט לא עודכן ${p.daysSinceUpdate} ימים — ייתכן שהדדליין לא עדכני.`);
    }
    out.push(makeSignal(c, {
      type: overdue ? "PROJECT_OVERDUE" : "PROJECT_DUE_SOON", key: p.id, entity: projectEntity(state, p.id), role: "primary",
      title: overdue ? rich(`הדדליין עבר לפני ${-d} ${daysWord(-d)} (${fullDate(p.deadline.ymd)})`)
        : d === 0 ? rich(`הדדליין היום (${fullDate(p.deadline.ymd)})`) : rich(`הדדליין בעוד ${d} ${daysWord(d)} (${fullDate(p.deadline.ymd)})`),
      short: overdue ? rich(`דדליין עבר לפני ${-d} ${daysWord(-d)}`) : d === 0 ? rich("דדליין היום") : rich(`דדליין בעוד ${d} ${daysWord(d)}`),
      evidence: [
        ev(c, `${p.id}:deadline`, "דדליין", p.deadline.ymd, fullDate(p.deadline.ymd), "date", src),
        ev(c, `${p.id}:days`, overdue ? "ימי איחור" : "ימים לדדליין", overdue ? -d : d, String(overdue ? -d : d), "days", src),
        ev(c, `${p.id}:status`, "סטטוס פרויקט", p.status, p.status, "status", { table: "projects", id: p.id, field: "status" }),
        ev(c, `${p.id}:updated`, "ימים מעדכון אחרון", p.daysSinceUpdate, String(p.daysSinceUpdate), "days", { table: "projects", id: p.id, field: "updated_at" }),
        ...lv.signs.map((x) => x.evidence),
      ],
      rules: [
        overdue
          ? { ruleId: "project.overdue", description: `פרויקט פעיל שהדדליין שלו עבר (פחות מ-${cfg.staleDeadlineDays} ימים). מ-14 ימים הדרגה יורדת בדרגה אחת; מ-${cfg.staleDeadlineDays} הוא נחשב מידע לעדכון`, threshold: `staleDeadlineDays = ${cfg.staleDeadlineDays}`, observed: `דדליין ${fullDate(p.deadline.ymd)}, היום ${fullDate(c.today)}` }
          : { ruleId: "project.due_soon", description: "פרויקט פעיל עם דדליין קרוב", threshold: `dueSoonDays = ${cfg.dueSoonDays}`, observed: `${d} ימים` },
        { ruleId: "project.live_activity", description: lv.live ? `פעילות חיה: ${lv.signs.map((x) => x.text).join(" · ")}` : "אין סימני פעילות חיה (עדכון אחרון, עבודת Steven, סשן, משימה, ריליס)", threshold: `updatedWithinDays = ${cfg.liveness.updatedWithinDays}`, observed: lv.live ? `${lv.signs.length} סימנים` : "0 סימנים" },
      ],
      coverageKeys: ["projects.deadline"], missing,
      tierCtx: overdue ? { daysOverdue: -d, live: lv.live, status: p.status } : { daysTo: d, status: p.status },
      sort: overdue ? 1000 + -d : 500 - d, klass: overdue && lv.live ? "liveOverdue" : undefined,
    }));
  }
  if (stale.length > 0) {
    stale.sort((x, y) => y.od - x.od || (x.name < y.name ? -1 : 1));
    const n = stale.length;
    out.push(makeSignal(c, {
      type: "STALE_PROJECT_DEADLINE", key: "all", entity: COMPANY_STALE, role: "notice",
      title: rich(n === 1 ? "פרויקט פעיל אחד מחזיק דדליין ישן שכדאי לעדכן" : `${n} פרויקטים פעילים מחזיקים דדליין ישן שכדאי לעדכן`),
      short: rich(n === 1 ? "דדליין ישן אחד" : `${n} דדליינים ישנים`),
      evidence: [
        ev(c, "stale:count", "פרויקטים פעילים עם דדליין ישן", n, String(n), "count", { table: "projects", field: "deadline" }),
        ...stale.map((x) => ev(c, `stale:p:${x.id}`, x.name, x.ymd, `דדליין ${fullDate(x.ymd)} · ${x.od} ימי איחור · ${x.status} · עודכן לפני ${x.upd ?? "?"} ימים${x.liveText ? ` · (${x.liveText})` : ""}`, "text", { table: "projects", id: x.id, field: "deadline" }, { untrusted: true })),
      ],
      rules: [{ ruleId: "project.stale_deadline", description: `פרויקט פעיל שהדדליין שלו עבר ${cfg.staleDeadlineDays}+ ימים. פעילות חיה (סשן, עדכון, עבודת Steven) אומרת שהפרויקט חי — לא שהדדליין הישן עדיין תקף`, threshold: `staleDeadlineDays = ${cfg.staleDeadlineDays}`, observed: `${n} פרויקטים` }],
      coverageKeys: ["projects.deadline"],
      missing: ["הדדליין עצמו ישן — לא נספר כדחיפות. עדכון התאריך (או סגירת הפרויקט) מנקה את הרשימה. עדכון אחרון של הפרויקט אינו ראיה שהדדליין עדכני: הוא זז גם בהעלאת קבצים."],
      tierCtx: {}, sort: n,
    }));
  }

  // ── 2. overdue tasks linked to a project (grouped per project) ───────────────
  if (state.tasks) {
    const byProject = new Map<string, typeof state.tasks.items>();
    for (const t of state.tasks.items) {
      if (!t.projectId || t.daysOverdue === null || t.daysOverdue <= 0) continue;
      if (t.derivedFrom) continue; // auto "מעקב ויקטור" task = the same business fact as the Victor internal deadline (H2)
      if (cfg.closedProjectStatuses.includes(idx[t.projectId]?.status ?? "")) continue;
      const list = byProject.get(t.projectId) ?? [];
      list.push(t); byProject.set(t.projectId, list);
    }
    for (const [pid, list] of byProject) {
      const oldest = Math.max(...list.map((t) => t.daysOverdue as number));
      out.push(makeSignal(c, {
        type: "TASK_OVERDUE", key: pid, entity: projectEntity(state, pid), role: "supporting",
        title: rich(`${list.length} ${list.length === 1 ? "משימה" : "משימות"} מקושרות באיחור (הישנה ${oldest} ${daysWord(oldest)})`),
        short: rich(`${list.length} ${list.length === 1 ? "משימה" : "משימות"} באיחור`),
        evidence: [
          ev(c, `${pid}:tasks_overdue`, "משימות מקושרות באיחור", list.length, String(list.length), "count", { table: "tasks", field: "related_id" }),
          ev(c, `${pid}:tasks_oldest`, "האיחור הגדול ביותר (ימים)", oldest, String(oldest), "days", { table: "tasks", field: "due_date" }),
          ...list.slice(0, 5).map((t) => ev(c, `task:${t.id}`, `משימה (יעד ${t.dueYmd ? shortDate(t.dueYmd) : "?"})`, t.title, t.title, "text", { table: "tasks", id: t.id, field: "title" }, { untrusted: true })),
        ],
        rules: [{ ruleId: "task.overdue_linked", description: "משימה פתוחה שתאריך היעד שלה עבר ומקושרת לפרויקט (related_type=project)", threshold: null, observed: `${list.length} משימות` }],
        coverageKeys: ["tasks.link"], tierCtx: { daysOverdue: oldest }, sort: oldest,
      }));
    }

    // ── 3. tasks backlog (one aggregate line, never one alert per task) ───────
    if (state.tasks.overdueCount > 0) {
      const t = state.tasks;
      out.push(makeSignal(c, {
        type: "TASKS_BACKLOG", key: "all", entity: COMPANY_TASKS, role: "notice",
        title: rich(`${t.overdueCount} משימות פתוחות באיחור מתוך ${t.openCount} פתוחות${t.autoVictor.overdue > 0 ? `, מתוכן ${t.autoVictor.overdue} משימות מעקב אוטומטיות של Victor` : ""}`),
        short: rich(`${t.overdueCount} משימות באיחור`),
        evidence: [
          ev(c, "tasks:overdue", "משימות פתוחות באיחור", t.overdueCount, String(t.overdueCount), "count", { table: "tasks", field: "due_date" }),
          ev(c, "tasks:open", "משימות פתוחות", t.openCount, String(t.openCount), "count", { table: "tasks", field: "status" }),
          ev(c, "tasks:age_1_7", "באיחור 1–7 ימים", t.ageBuckets.d1_7, String(t.ageBuckets.d1_7), "count", { table: "tasks", field: "due_date" }),
          ev(c, "tasks:age_8_30", "באיחור 8–30 ימים", t.ageBuckets.d8_30, String(t.ageBuckets.d8_30), "count", { table: "tasks", field: "due_date" }),
          ev(c, "tasks:age_31", "באיחור 31+ ימים", t.ageBuckets.d31plus, String(t.ageBuckets.d31plus), "count", { table: "tasks", field: "due_date" }),
          ev(c, "tasks:linked", "מהן מקושרות לפרויקט", t.linkedToProject, String(t.linkedToProject), "count", { table: "tasks", field: "related_id" }),
          ev(c, "tasks:auto_victor", "מתוכן: משימות מעקב אוטומטיות של Victor (אותו דדליין פנימי)", t.autoVictor.overdue, String(t.autoVictor.overdue), "count", { table: "vendor_project_work", field: "linked_task_id" }),
          ev(c, "tasks:age_median", "גיל משימה — חציון (ימים מאז יצירה)", t.age.median, String(t.age.median), "days", { table: "tasks", field: "created_at" }),
          ev(c, "tasks:age_oldest", "גיל משימה — הוותיקה (ימים מאז יצירה)", t.age.oldest, String(t.age.oldest), "days", { table: "tasks", field: "created_at" }),
          ev(c, "tasks:created_on_due", "נוצרו ביום היעד שלהן (סגנון תזכורת)", t.createdOnDueDate, String(t.createdOnDueDate), "count", { table: "tasks", field: "created_at / due_date" }),
        ],
        rules: [{ ruleId: "tasks.backlog", description: "אגרגט: משימות פתוחות שתאריך היעד שלהן עבר (שורה אחת, לא אזהרה לכל משימה)", threshold: null, observed: `${t.overdueCount} מתוך ${t.openCount}` }],
        coverageKeys: ["tasks.link"],
        missing: ["הרבה משימות באיחור לא אומרות בהכרח דחיפות — ייתכן שהן פשוט לא נסגרו. גיל משימה נמדד לפי created_at (מתי נוצרה), האיחור לפי due_date — שני מדדים נפרדים; updated_at לא משמש למדידת משך חיים."],
        tierCtx: { count: t.overdueCount - t.autoVictor.overdue }, sort: t.overdueCount,
      }));
    }
  }

  // ── 4. Steven ───────────────────────────────────────────────────────────────
  const st = state.team.steven;
  if (st) {
    for (const w of st.open) {
      const entity = w.projectId ? projectEntity(state, w.projectId) : TEAM_STEVEN;
      const isOwnerBall = cfg.stevenOwnerBallStatuses.includes(w.status);
      // When the status says the ball is with the owner, WAITING_OWNER (below) covers it — never present that as Steven's delay.
      if (!isOwnerBall && w.daysToInternal !== null && w.daysToInternal <= cfg.dueSoonDays) {
        const d = w.daysToInternal;
        const passed = d < 0;
        const od = -d;
        const uploadYmd = w.lastUploadAt ? ilYmd(new Date(w.lastUploadAt)) : null;
        const uploadAge = uploadYmd ? diffDays(uploadYmd, c.today) : null;
        const freshUpload = uploadAge !== null && uploadAge <= cfg.liveness.updatedWithinDays;
        const stevenTitle = w.title;
        let ctx: TierCtx = passed ? { daysOverdue: od, daysTo: d } : { daysTo: d };
        let cap: { tier: Tier; reason: string } | undefined;
        const notes: string[] = ["אין היסטוריית שינוי דדליין — אי אפשר לדעת אם הדדליין הפנימי הוזז."];
        let delivered = false;
        if (passed && od >= cfg.staleDeadlineDays) {
          if (!freshUpload) {
            staleInternal.push({ who: "Steven", id: w.id, title: stevenTitle, ymd: w.internalDeadline as string, od, note: `${w.uiStatus} (DB: ${w.status}) · ${uploadYmd ? `העלאה אחרונה ${fullDate(uploadYmd)}` : "אין העלאות"}` });
            continue;
          }
          ctx = {}; // a fresh upload proves the work is active, but the old date must not lift the priority
          notes.push(`הדדליין הפנימי ישן (${od} ימים) אבל יש העלאה טרייה — גיל הדדליין לא מעלה את הדרגה.`);
        } else if (passed) {
          const stillWithHim = cfg.stevenBallWithHimStatuses.includes(w.status);
          if (w.hasMixVersion && uploadYmd !== null && uploadYmd >= (w.internalDeadline as string)) {
            delivered = true;
            cap = { tier: "P2", reason: "הועלתה גרסה ביום הדדליין הפנימי או אחריו — ייתכן שהעבודה כבר נמסרה" };
            notes.push("אין שדה שמבדיל בין 'נמסר וממתין לבדיקה' ל'ממתין להערות' — לכן זה לא נספר כאיחור של Steven.");
          } else if (w.hasMixVersion && !stillWithHim) {
            cap = { tier: "P1", reason: `קיימת גרסת מיקס והסטטוס "${w.status}" לא מוכיח שהעבודה עדיין אצל Steven` };
            notes.push("קיימת גרסה שהועלתה לפני הדדליין, והסטטוס לא אומר אם הכדור אצל Steven או אצלך.");
          } else if (w.status === "לא נשלח" && !w.hasMixVersion) {
            cap = { tier: "P1", reason: "העבודה מסומנת 'לא נשלח' — ייתכן שהכדור אצלך" };
            notes.push("העבודה טרם נשלחה ל-Steven לפי הסטטוס.");
          }
        }
        out.push(makeSignal(c, {
          type: "STEVEN_WORK_DEADLINE", key: w.id, entity, role: "primary",
          title: rich(delivered ? `עבודת Steven "${stevenTitle}": הדדליין הפנימי עבר לפני ${od} ${daysWord(od)}, אך הועלתה גרסה ב-${fullDate(uploadYmd as string)} — ייתכן שנמסרה`
            : d < 0 ? `עבודת Steven "${stevenTitle}": הדדליין הפנימי עבר לפני ${od} ${daysWord(od)}` : d === 0 ? `עבודת Steven "${stevenTitle}": דדליין פנימי היום` : `עבודת Steven "${stevenTitle}": דדליין פנימי בעוד ${d} ${daysWord(d)}`),
          short: rich(delivered ? "דדליין פנימי של Steven עבר, אך הועלתה גרסה אחריו"
            : d < 0 ? `דדליין פנימי של Steven עבר (${od} ${daysWord(od)})` : `דדליין פנימי של Steven בעוד ${d} ${daysWord(d)}`),
          evidence: [
            ev(c, `${w.id}:sdeadline`, "דדליין פנימי (Steven)", w.internalDeadline, w.internalDeadline ? fullDate(w.internalDeadline) : "", "date", { table: "sound_engineer_work", id: w.id, field: "internal_deadline" }),
            ev(c, `${w.id}:sstatus`, "סטטוס העבודה", w.uiStatus, `${w.uiStatus} (DB: ${w.status})`, "status", { table: "sound_engineer_work", id: w.id, field: "status" }),
            ev(c, `${w.id}:ssent`, "נשלח", w.sentDate, w.sentDate ? fullDate(w.sentDate) : "", "date", { table: "sound_engineer_work", id: w.id, field: "sent_date" }),
            ev(c, `${w.id}:smix`, "יש גרסת מיקס", w.hasMixVersion, w.hasMixVersion ? "כן" : "לא", "flag", { table: "mix_versions", field: "sound_engineer_work_id" }),
            ev(c, `${w.id}:supload`, "העלאה אחרונה (מיקס / קבצים סופיים)", uploadYmd, uploadYmd ? fullDate(uploadYmd) : "", "date", { table: "mix_versions", field: "created_at" }),
          ],
          rules: [{ ruleId: "steven.work_deadline", description: "עבודה פתוחה של Steven עם דדליין פנימי קרוב או שעבר (בלי סטטוס שהכדור אצל הבעלים; עם בדיקת גרסה שהועלתה אחרי הדדליין)", threshold: `dueSoonDays = ${cfg.dueSoonDays}, staleDeadlineDays = ${cfg.staleDeadlineDays}`, observed: `${d} ימים` }],
          coverageKeys: ["steven.link"],
          missing: notes, cap,
          tierCtx: ctx, sort: d < 0 ? 300 + od : 200 - d, klass: delivered ? "dependency" : d < 0 ? "liveOverdue" : "deadlineNear",
        }));
      }
      if (cfg.stevenOwnerBallStatuses.includes(w.status)) {
        out.push(makeSignal(c, {
          type: "STEVEN_WAITING_OWNER", key: w.id, entity, role: "primary",
          title: rich(`עבודת Steven "${w.title}" חזרה וממתינה לבדיקתך`),
          short: rich("עבודה חזרה מ-Steven וממתינה לך"),
          evidence: [ev(c, `${w.id}:sstatus2`, "סטטוס העבודה", w.status, w.status, "status", { table: "sound_engineer_work", id: w.id, field: "status" })],
          rules: [{ ruleId: "steven.waiting_owner", description: "סטטוס שמשמעותו: הכדור אצל הבעלים", threshold: `stevenOwnerBallStatuses = ${cfg.stevenOwnerBallStatuses.join(", ")}`, observed: w.status }],
          coverageKeys: ["steven.link"],
          missing: ["משמעות הסטטוס 'חזר' (הכדור אצלך) היא הנחה שלא אומתה מול בעל המערכת. אין מידע כמה זמן העבודה ממתינה."],
          tierCtx: {}, sort: 100,
        }));
      }
    }
    if (st.open.length >= cfg.stevenOpenWatch) {
      out.push(makeSignal(c, {
        type: "STEVEN_WORKLOAD", key: "team", entity: TEAM_STEVEN, role: "supporting",
        title: rich(`ל-Steven ${st.open.length} עבודות פתוחות`), short: rich(`${st.open.length} עבודות פתוחות אצל Steven`),
        evidence: [
          ev(c, "steven:open", "עבודות פתוחות", st.open.length, String(st.open.length), "count", { table: "sound_engineer_work", field: "status" }),
          ev(c, "steven:linked", "מהן מקושרות לפרויקט", st.linkedOpen, String(st.linkedOpen), "count", { table: "sound_engineer_work", field: "project_id" }),
        ],
        rules: [{ ruleId: "steven.workload", description: "מספר עבודות פתוחות אצל Steven מעל סף המעקב", threshold: `stevenOpenWatch = ${cfg.stevenOpenWatch}`, observed: String(st.open.length) }],
        coverageKeys: ["steven.link"], missing: ["אין מודל קיבולת — לא ניתן לומר אם זה 'עומס'."],
        tierCtx: { count: st.open.length }, sort: st.open.length,
      }));
    }
    if (st.approvedUnpaid.works.length > 0) {
      const parts: Rich = [];
      Object.entries(st.approvedUnpaid.byCurrency).forEach(([cur, amt], i) => { if (i > 0) parts.push(T(" · ")); parts.push(S(money(amt, cur))); });
      out.push(makeSignal(c, {
        type: "STEVEN_UNPAID_APPROVED", key: "team", entity: TEAM_STEVEN, role: "primary",
        title: rich(`${st.approvedUnpaid.works.length} עבודות מאושרות של Steven שטרם שולמו במלואן: `, ...parts),
        short: rich(`${st.approvedUnpaid.works.length} עבודות מאושרות לא שולמו: `, ...parts),
        evidence: [
          ev(c, "steven:unpaid_count", "עבודות מאושרות שלא שולמו", st.approvedUnpaid.works.length, String(st.approvedUnpaid.works.length), "count", { table: "sound_engineer_work", field: "amount_paid" }),
          ...Object.entries(st.approvedUnpaid.byCurrency).map(([cur, amt]) => moneyEv(c, `steven:unpaid_${cur}`, `יתרה לתשלום (${cur})`, amt, cur, { table: "sound_engineer_work", field: "agreed_price − amount_paid" })),
          ...st.approvedUnpaid.works.slice(0, 5).map((w) => ev(c, `swork:${w.id}`, "עבודה", w.title, w.title, "text", { table: "sound_engineer_work", id: w.id, field: "work_title" }, { untrusted: true })),
        ],
        rules: [{ ruleId: "steven.unpaid_approved", description: "עבודה שאושרה, עם מחיר מוסכם, ושסכום ששולם קטן ממנו", threshold: null, observed: `${st.approvedUnpaid.works.length} עבודות` }],
        coverageKeys: ["steven.link"],
        missing: ["המחיר במטבע של העבודה (לרוב $) — לא מומר ל-₪ ולא מחובר לסכומי ה-₪."],
        tierCtx: {}, sort: st.approvedUnpaid.works.length,
      }));
    }
  }

  // ── 5. Victor ───────────────────────────────────────────────────────────────
  // WHO HOLDS THE BALL comes only from timestamps (victor-ball.ts): Victor's last upload vs the owner's last notes.
  // Ball with the owner ⇒ no "Victor late / overdue / waiting delivery" on the same deadline. Deliveries waiting for the owner are ONE
  // managerial notice (never 14 cards); per project they are only a supporting signal (see section 10b). No "stuck" verdict from a day count.
  const vi = state.team.victor;
  if (vi) {
    for (const w of vi.active) {
      if (!w.internalDeadline) continue;
      const d = diffDays(c.today, w.internalDeadline);
      if (d > cfg.dueSoonDays) continue;
      if (w.ball.holder === "owner") continue; // Victor already delivered; the owner's review is what is pending
      const od = -d;
      let ctx: TierCtx = d < 0 ? { daysOverdue: od, daysTo: d } : { daysTo: d };
      const notes: string[] = [];
      if (d < 0 && od >= cfg.staleDeadlineDays) {
        const fresh = w.daysSinceSent !== null && w.daysSinceSent <= cfg.liveness.updatedWithinDays;
        if (!fresh) {
          staleInternal.push({ who: "Victor", id: w.id, title: w.title, ymd: w.internalDeadline, od, note: `הכדור: ${w.ball.holder === "victor" ? "אצל Victor" : "לא ידוע"}${w.daysSinceSent !== null ? ` · נשלח לפני ${w.daysSinceSent} ימים` : ""}` });
          continue;
        }
        ctx = {};
        notes.push(`הדדליין הפנימי ישן (${od} ימים) אבל העבודה נשלחה לאחרונה — גיל הדדליין לא מעלה את הדרגה.`);
      }
      const unknownBall = w.ball.holder === "unknown";
      const cap = unknownBall ? { tier: "P2" as Tier, reason: `לא ידוע אצל מי הכדור (${w.ball.basis})` } : undefined;
      if (unknownBall) notes.push(`לא ניתן לקבוע אצל מי הכדור: ${w.ball.basis}.`);
      out.push(makeSignal(c, {
        type: "VICTOR_WORK_DEADLINE", key: w.id, entity: w.projectId ? projectEntity(state, w.projectId) : TEAM_VICTOR, role: "primary",
        title: rich(d < 0 ? `עבודת Victor "${w.title}": הדדליין הפנימי עבר לפני ${od} ${daysWord(od)}` : d === 0 ? `עבודת Victor "${w.title}": דדליין פנימי היום` : `עבודת Victor "${w.title}": דדליין פנימי בעוד ${d} ${daysWord(d)}`),
        short: rich(d < 0 ? `דדליין פנימי של Victor עבר (${od} ${daysWord(od)})` : `דדליין פנימי של Victor בעוד ${d} ${daysWord(d)}`),
        evidence: [
          ev(c, `${w.id}:vdeadline`, "דדליין פנימי (Victor)", w.internalDeadline, fullDate(w.internalDeadline), "date", { table: "vendor_project_work", id: w.id, field: "internal_deadline" }),
          ev(c, `${w.id}:vball`, "הפעולה האחרונה המתועדת", w.ball.holder, `${w.ball.holder === "victor" ? "הערות שלך ל-Victor" : "לא ידוע"} — ${w.ball.basis}`, "status", { table: "vendor_project_work", id: w.id, field: "files_sent[].uploadedAt / version_reviews[].sentAt" }),
          ev(c, `${w.id}:vtask`, "נעקב גם כמשימה (אותו דדליין)", w.linkedTaskId !== null, w.linkedTaskId ? "כן" : "לא", "flag", { table: "vendor_project_work", id: w.id, field: "linked_task_id" }),
        ],
        rules: [{ ruleId: "victor.work_deadline", description: "עבודה פעילה של Victor שהפעולה האחרונה המתועדת בה היא הערות שלך אליו (לפי חותמות העלאה/הערות), עם דדליין פנימי קרוב או שעבר. P1 רק בתוך 14 ימים מהדדליין; ישן מ-30 ימים נחשב מידע לעדכון", threshold: `dueSoonDays = ${cfg.dueSoonDays}, staleDeadlineDays = ${cfg.staleDeadlineDays}`, observed: `${d} ימים` }],
        coverageKeys: ["victor.link"], missing: notes, cap,
        tierCtx: ctx, sort: d < 0 ? 300 + od : 200 - d, klass: d < 0 ? "liveOverdue" : "deadlineNear",
      }));
    }
    // dependency: Victor HOLDS the ball on active work of a project whose deadline is reliable (not stale) and near or just passed
    const depByProject = new Map<string, typeof vi.active>();
    for (const w of vi.active) {
      if (!w.projectId || w.ball.holder !== "victor") continue;
      if (!out.some((x) => (x.type === "PROJECT_DUE_SOON" || x.type === "PROJECT_OVERDUE") && x.entity.id === w.projectId)) continue;
      depByProject.set(w.projectId, [...(depByProject.get(w.projectId) ?? []), w]);
    }
    for (const [pid, list] of depByProject) {
      out.push(makeSignal(c, {
        type: "VICTOR_DEPENDENCY", key: pid, entity: projectEntity(state, pid), role: "supporting",
        title: rich(`${list.length === 1 ? "עבודה פעילה" : `${list.length} עבודות פעילות`} אצל Victor (אחרי ההערות האחרונות שלך עדיין לא הועלתה גרסה) על פרויקט עם דדליין אמין`),
        short: rich(`${list.length === 1 ? "עבודה" : `${list.length} עבודות`} אצל Victor על הפרויקט (אחרי ההערות שלך אין העלאה)`),
        evidence: list.slice(0, 5).flatMap((w) => [
          ev(c, `vdep:${w.id}`, "עבודה אצל Victor", w.title, w.title, "text", { table: "vendor_project_work", id: w.id, field: "project_id" }, { untrusted: true }),
          ev(c, `vdep:${w.id}:ball`, "הפעולה האחרונה המתועדת", w.ball.holder, `הערות שלך ל-Victor — ${w.ball.basis}`, "status", { table: "vendor_project_work", id: w.id, field: "files_sent[].uploadedAt / version_reviews[].sentAt" }),
        ]),
        rules: [{ ruleId: "victor.dependency", description: "עבודה פעילה שהכדור בה אצל Victor (לפי חותמות), מקושרת (project_id) לפרויקט עם דדליין קרוב/שעבר שאינו ישן", threshold: `staleDeadlineDays = ${cfg.staleDeadlineDays}`, observed: `${list.length} עבודות` }],
        coverageKeys: ["victor.link"], missing: ["אין מידע אם העבודה של Victor היא זו שמעכבת את הפרויקט."],
        tierCtx: {}, sort: list.length,
      }));
    }
    // deliveries whose latest RECORDED action is Victor's upload, with no recorded owner follow-up after it: ONE managerial notice.
    // The fact is about the record; "still waiting for your review" is only a labelled hypothesis (8 of 14 have no owner notes at all).
    const q = vi.ownerQueue;
    if (q.count > 0) {
      out.push(makeSignal(c, {
        type: "VICTOR_DELIVERIES_WAITING_OWNER", key: "team", entity: TEAM_VICTOR, role: "notice",
        title: rich(`${q.count} ${q.count === 1 ? "מסירה" : "מסירות"} מ-Victor ללא follow-up מתועד אחריה${q.count === 1 ? "" : "ן"}`),
        detail: rich([q.oldCount > 0 ? `${q.oldCount} מהן לפני ${q.oldDays}+ ימים` : null, q.median !== null ? `חציון ${q.median} ימים` : null, q.oldest !== null ? `הוותיקה ${q.oldest} ימים` : null].filter(Boolean).join(" · ")),
        short: rich(`${q.count} מסירות של Victor ללא follow-up מתועד`),
        evidence: [
          ev(c, "vq:count", "עבודות שהפעולה האחרונה המתועדת בהן היא העלאה של Victor, ואין אחריה follow-up מתועד שלך", q.count, String(q.count), "count", { table: "vendor_project_work", field: "files_sent[].uploadedAt / version_reviews[].sentAt" }),
          ev(c, "vq:old", `מהן: העלאה אחרונה לפני ${q.oldDays}+ ימים`, q.oldCount, String(q.oldCount), "count", { table: "vendor_project_work", field: "files_sent[].uploadedAt" }),
          ev(c, "vq:median", "חציון ימים מההעלאה האחרונה", q.median, String(q.median), "days", { table: "vendor_project_work", field: "files_sent[].uploadedAt" }),
          ev(c, "vq:oldest", "הוותיקה (ימים מההעלאה האחרונה)", q.oldest, String(q.oldest), "days", { table: "vendor_project_work", field: "files_sent[].uploadedAt" }),
          ev(c, "vq:no_notes", "מתוכן: בלי אף הערה מתועדת שלך", q.noNotes, String(q.noNotes), "count", { table: "vendor_project_work", field: "version_reviews[].sentAt" }),
          ev(c, "vq:balls", "התפלגות כל העבודות הפעילות לפי הפעולה האחרונה המתועדת", `owner=${vi.ballCounts.owner};victor=${vi.ballCounts.victor};unknown=${vi.ballCounts.unknown}`, `העלאה של Victor ${vi.ballCounts.owner} · הערות שלך ${vi.ballCounts.victor} · לא ידוע ${vi.ballCounts.unknown}`, "text", { table: "vendor_project_work", field: "files_sent[].uploadedAt / version_reviews[].sentAt" }),
          ...q.items.map((w) => ev(c, `vq:w:${w.id}`, w.title, w.lastUploadAt, `העלאה אחרונה ${w.lastUploadAt ? fullDate(ilYmd(new Date(w.lastUploadAt))) : "?"} · לפני ${w.waitingOwnerDays ?? "?"} ימים · ${w.lastNotesSentAt ? "יש הערות מתועדות שלך לפניה" : "אין אף הערה מתועדת שלך"} · ${w.projectId ? "מקושר לפרויקט" : "ללא פרויקט"}`, "text", { table: "vendor_project_work", id: w.id, field: "files_sent[].uploadedAt" }, { untrusted: true })),
        ],
        rules: [{ ruleId: "victor.ball_owner", description: "הפעולה האחרונה המתועדת היא העלאה של Victor: היא מאוחרת מההערות האחרונות שנשלחו לו (או שלא נשלחו הערות אחריה) — השוואה לפי חותמת זמן מלאה", threshold: `tieSeconds = ${cfg.victorBall.tieSeconds}; ownerWaitingOldDays = ${cfg.victorBall.ownerWaitingOldDays}`, observed: `${q.count} מתוך ${vi.active.length} פעילות` }],
        coverageKeys: ["victor.link"],
        missing: [`זו עובדה על מה שמתועד במערכת בלבד (העלאות של Victor והערות שנשלחו דרך האפליקציה). ${q.noNotes > 0 ? `ב-${q.noNotes} מהעבודות אין אף הערה מתועדת שלך — ייתכן שטופלו או אושרו מחוץ ל-Redbloods. ` : ""}סטטוס האישור של הגרסה (version_reviews.status) אינו נרשם, ולכן אין ראיה שהבדיקה עדיין תלויה בך.`],
        hypotheses: ["ייתכן שחלק מהן עדיין ממתינות לבדיקה שלך."],
        tierCtx: {}, sort: q.count,
      }));
    }
    if (vi.active.length >= cfg.victorActiveWatch) {
      const a = vi.ageStats;
      out.push(makeSignal(c, {
        type: "VICTOR_WORKLOAD", key: "team", entity: TEAM_VICTOR, role: "notice",
        title: rich(`ל-Victor ${vi.active.length} עבודות פעילות · חציון ${a.median ?? "?"} ימים מאז שליחה · הוותיקה ${a.oldest ?? "?"} ימים · ${vi.linkedActive} מקושרות לפרויקט`),
        short: rich(`${vi.active.length} עבודות פעילות אצל Victor`),
        evidence: [
          ev(c, "victor:active", "עבודות פעילות", vi.active.length, String(vi.active.length), "count", { table: "vendor_project_work", field: "status" }),
          ...a.buckets.map((b, i) => ev(c, `victor:age:${i}`, `גיל ${b.label}`, b.count, String(b.count), "count", { table: "vendor_project_work", field: "sent_date" })),
          ev(c, "victor:age_median", "חציון (ימים מאז שליחה)", a.median, String(a.median), "days", { table: "vendor_project_work", field: "sent_date" }),
          ev(c, "victor:age_oldest", "העבודה הוותיקה ביותר (ימים)", a.oldest, String(a.oldest), "days", { table: "vendor_project_work", field: "sent_date" }),
          ev(c, "victor:linked", "מקושרות לפרויקט", vi.linkedActive, String(vi.linkedActive), "count", { table: "vendor_project_work", field: "project_id" }),
        ],
        rules: [{ ruleId: "victor.backlog", description: "מספר עבודות פעילות אצל Victor מעל סף המעקב — מידע ניהולי בלבד", threshold: `victorActiveWatch = ${cfg.victorActiveWatch}`, observed: `${vi.active.length} פעילות` }],
        coverageKeys: ["victor.link"],
        missing: ["אין ל-Victor דדליין פנימי ברוב העבודות — לכן זו תמונת עומס בלבד, לא אזהרה.", "רוב העבודות לא משויכות לפרויקט — הן מוצגות ברמת הצוות בלבד."],
        tierCtx: {}, sort: vi.active.length,
      }));
    }
  }

  // ── stale internal deadlines (Steven / Victor): one aggregated notice ───────
  if (staleInternal.length > 0) {
    staleInternal.sort((x, y) => y.od - x.od || (x.title < y.title ? -1 : 1));
    const n = staleInternal.length;
    out.push(makeSignal(c, {
      type: "STALE_INTERNAL_DEADLINE", key: "all", entity: COMPANY_STALE_INTERNAL, role: "notice",
      title: rich(n === 1 ? "עבודה אחת של Steven/Victor מחזיקה דדליין פנימי ישן שכדאי לעדכן" : `${n} עבודות של Steven/Victor מחזיקות דדליין פנימי ישן שכדאי לעדכן`),
      short: rich(n === 1 ? "דדליין פנימי ישן אחד" : `${n} דדליינים פנימיים ישנים`),
      evidence: [
        ev(c, "stale:count", "עבודות עם דדליין פנימי ישן", n, String(n), "count", { table: "sound_engineer_work / vendor_project_work", field: "internal_deadline" }),
        ...staleInternal.map((x) => ev(c, `stale:w:${x.id}`, `${x.title} (${x.who})`, x.ymd, `דדליין פנימי ${fullDate(x.ymd)} · ${x.od} ימים · ${x.note}`, "text",
          { table: x.who === "Steven" ? "sound_engineer_work" : "vendor_project_work", id: x.id, field: "internal_deadline" }, { untrusted: true })),
      ],
      rules: [{ ruleId: "internal.stale_deadline", description: `דדליין פנימי שעבר ${cfg.staleDeadlineDays}+ ימים בלי evidence טרי שהעבודה פעילה — לא נספר כדחיפות`, threshold: `staleDeadlineDays = ${cfg.staleDeadlineDays}`, observed: `${n} עבודות` }],
      coverageKeys: [],
      missing: ["הדדליין הפנימי ישן — לא נספר כדחיפות ולא כאיחור. עדכון התאריך (או סגירת העבודה) מנקה את הרשימה."],
      tierCtx: {}, sort: n,
    }));
  }

  // ── 6. proposals ────────────────────────────────────────────────────────────
  for (const p of state.proposals ?? []) {
    if (p.followupYmd === null || p.daysOverdue === null || p.daysOverdue < 0) continue;
    out.push(makeSignal(c, {
      type: "PROPOSAL_FOLLOWUP_DUE", key: p.id, entity: { type: "proposal", id: p.id, name: p.clientName || p.title || "הצעה" }, role: "primary",
      title: rich(p.daysOverdue === 0 ? "מעקב להצעת מחיר מגיע היום" : `מעקב להצעת מחיר באיחור של ${p.daysOverdue} ${daysWord(p.daysOverdue)}`),
      short: rich(p.daysOverdue === 0 ? "מעקב להצעה היום" : `מעקב להצעה באיחור ${p.daysOverdue} ${daysWord(p.daysOverdue)}`),
      evidence: [
        ev(c, `${p.id}:followup`, "תאריך מעקב", p.followupYmd, fullDate(p.followupYmd), "date", { table: "proposals", id: p.id, field: "followup_date" }),
        ev(c, `${p.id}:pstatus`, "סטטוס הצעה", p.status, p.status, "status", { table: "proposals", id: p.id, field: "status" }),
        moneyEv(c, `${p.id}:pamount`, "סכום ההצעה", p.amount, p.currency, { table: "proposals", id: p.id, field: "amount" }),
        ev(c, `${p.id}:pclient`, "לקוח", p.clientName, p.clientName, "text", { table: "clients", field: "name" }, { untrusted: true }),
      ],
      rules: [{ ruleId: "proposal.followup_due", description: "הצעה פתוחה שתאריך המעקב שלה הגיע", threshold: null, observed: `${p.daysOverdue} ימים` }],
      coverageKeys: [], tierCtx: { daysOverdue: p.daysOverdue }, sort: p.daysOverdue,
    }));
  }

  // ── 7. receivables (only projects that HAVE an agreed price) ────────────────
  const rec = state.receivables;
  if (rec) {
    for (const r of rec.rows) {
      if (r.balance <= 0) continue;
      const entity = projectEntity(state, r.projectId);
      const src = { table: "settings", id: `finance_${r.projectId}`, field: "agreedPrice" };
      out.push(makeSignal(c, {
        type: "PROJECT_PAYMENT_BALANCE", key: r.projectId, entity, role: "primary",
        title: rich("יתרה פתוחה מול המחיר המוסכם: ", S(money(r.balance, r.currency))),
        short: rich("יתרה פתוחה ", S(money(r.balance, r.currency))),
        evidence: [
          moneyEv(c, `${r.projectId}:agreed`, "מחיר מוסכם", r.agreedPrice, r.currency, src),
          moneyEv(c, `${r.projectId}:received`, "התקבל (עסקת השיר)", r.received, r.currency, { table: "transactions", field: "amount (income: שולם/התקבל)" }),
          moneyEv(c, `${r.projectId}:cancelled`, "בוטל", r.cancelled, r.currency, { table: "transactions", field: "amount (income: בוטל)" }),
          moneyEv(c, `${r.projectId}:balance`, "יתרה", r.balance, r.currency, src),
        ],
        rules: [{ ruleId: "receivable.balance", description: "יתרה = מחיר מוסכם − התקבל − בוטל, רק בתנועות באותו מטבע של המחיר", threshold: null, observed: money(r.balance, r.currency) }],
        coverageKeys: ["receivables"],
        missing: [`יתרה ידועה רק ל-${rec.withPrice} מתוך ${rec.considered} פרויקטים (אלו עם מחיר מוסכם). לשאר אין מידע.`],
        tierCtx: { status: r.projectStatus }, sort: r.balance,
      }));
      if (!r.hasDatedExpected) {
        out.push(makeSignal(c, {
          type: "BALANCE_NO_DUE_DATE", key: r.projectId, entity, role: "supporting",
          title: rich("אין הכנסה צפויה עם תאריך לכיסוי היתרה"), short: rich("אין תאריך לתשלום היתרה"),
          evidence: [moneyEv(c, `${r.projectId}:balance2`, "יתרה", r.balance, r.currency, src)],
          rules: [{ ruleId: "receivable.no_due_date", description: "יש יתרה פתוחה ואין הכנסה במצב 'צפוי' עם תאריך לפרויקט", threshold: null, observed: "0 הכנסות צפויות עם תאריך" }],
          coverageKeys: ["receivables"], tierCtx: {}, sort: 0,
        }));
      }
    }
  }

  // ── 8. expected income that is overdue ──────────────────────────────────────
  const fin = state.finance;
  if (fin) {
    for (const e of fin.expectedOverdue) {
      const row = rec?.rows.find((r) => r.projectId === e.projectId);
      if (e.projectId && rec?.exceptionIds.includes(e.projectId)) continue;
      if (row && !e.clip && row.balance <= 0) continue; // the project is already fully paid
      const show = state.shows?.upcoming.find((s) => s.incomeTxId === e.txId) ?? null;
      const entity: EntityRef = e.projectId && idx[e.projectId] ? projectEntity(state, e.projectId)
        : show ? { type: "show", id: show.id, name: show.name } : COMPANY_MONEY;
      out.push(makeSignal(c, {
        type: "EXPECTED_INCOME_OVERDUE", key: e.txId, entity, role: "primary",
        title: rich("הכנסה צפויה שתאריכה עבר לפני ", `${e.daysOverdue} ${daysWord(e.daysOverdue)}: `, S(money(e.amount, e.currency))),
        short: rich("הכנסה צפויה באיחור ", S(money(e.amount, e.currency))),
        evidence: [
          moneyEv(c, `${e.txId}:amount`, "סכום", e.amount, e.currency, { table: "transactions", id: e.txId, field: "amount" }),
          ev(c, `${e.txId}:date`, "תאריך צפוי", e.dateYmd, fullDate(e.dateYmd), "date", { table: "transactions", id: e.txId, field: "date" }),
          ev(c, `${e.txId}:days`, "ימי איחור", e.daysOverdue, String(e.daysOverdue), "days", { table: "transactions", id: e.txId, field: "date" }),
          ev(c, `${e.txId}:cat`, "קטגוריה", e.category || null, e.category, "text", { table: "transactions", id: e.txId, field: "category" }, { untrusted: true }),
        ],
        rules: [{ ruleId: "income.expected_overdue", description: "הכנסה במצב 'צפוי' שהתאריך שלה עבר", threshold: null, observed: `${e.daysOverdue} ימים` }],
        coverageKeys: ["finance.dated"],
        missing: ["התאריך בשורה הוא גם תאריך יעד וגם תאריך קבלה — לא ניתן לדעת אם התשלום כבר התקבל מחוץ למערכת."],
        tierCtx: { daysOverdue: e.daysOverdue }, sort: e.daysOverdue,
      }));
    }
  }

  // ── 9. shows ────────────────────────────────────────────────────────────────
  const sh = state.shows;
  if (sh) {
    for (const s of sh.upcoming) {
      if (s.paymentStatus === "שולם" || s.daysTo === null || s.daysTo > cfg.showUnpaidUpcomingDays) continue;
      out.push(makeSignal(c, {
        type: "SHOW_UNPAID_UPCOMING", key: s.id, entity: { type: "show", id: s.id, name: s.name }, role: "primary",
        title: rich(`הופעה בעוד ${s.daysTo} ${daysWord(s.daysTo)} — התשלום: ${s.paymentStatus}`), short: rich(`הופעה בעוד ${s.daysTo} ${daysWord(s.daysTo)}, לא שולם`),
        evidence: [
          ev(c, `${s.id}:sdate`, "תאריך הופעה", s.dateYmd, s.dateYmd ? fullDate(s.dateYmd) : "", "date", { table: "shows", id: s.id, field: "date" }),
          ev(c, `${s.id}:spay`, "סטטוס תשלום", s.paymentStatus, s.paymentStatus, "status", { table: "shows", id: s.id, field: "payment_status" }),
          moneyEv(c, `${s.id}:sprice`, "מחיר (מטבע לא מוגדר בהופעות — מוצג ₪)", s.price, "₪", { table: "shows", id: s.id, field: "show_price" }),
          moneyEv(c, `${s.id}:sadv`, "מקדמה", s.advance, "₪", { table: "shows", id: s.id, field: "advance_payment" }),
        ],
        rules: [{ ruleId: "show.unpaid_upcoming", description: "הופעה מאושרת קרובה שסטטוס התשלום שלה אינו 'שולם'", threshold: `showUnpaidUpcomingDays = ${cfg.showUnpaidUpcomingDays}`, observed: `${s.daysTo} ימים` }],
        coverageKeys: ["shows"], missing: ["אין שדה מטבע בהופעות."], tierCtx: { daysTo: s.daysTo }, sort: 100 - s.daysTo,
      }));
    }
    for (const s of sh.doneUnpaid) {
      const since = s.daysTo !== null ? -s.daysTo : null;
      out.push(makeSignal(c, {
        type: "SHOW_DONE_UNPAID", key: s.id, entity: { type: "show", id: s.id, name: s.name }, role: "primary",
        title: rich(`הופעה שבוצעה${since !== null ? ` לפני ${since} ${daysWord(since)}` : ""} ולא סומנה כשולמה (${s.paymentStatus})`),
        short: rich(`הופעה שבוצעה לא סומנה כשולמה`),
        evidence: [
          ev(c, `${s.id}:ddate`, "תאריך הופעה", s.dateYmd, s.dateYmd ? fullDate(s.dateYmd) : "", "date", { table: "shows", id: s.id, field: "date" }),
          ev(c, `${s.id}:dpay`, "סטטוס תשלום", s.paymentStatus, s.paymentStatus, "status", { table: "shows", id: s.id, field: "payment_status" }),
          moneyEv(c, `${s.id}:dprice`, "מחיר (מוצג ₪)", s.price, "₪", { table: "shows", id: s.id, field: "show_price" }),
          moneyEv(c, `${s.id}:dadv`, "מקדמה", s.advance, "₪", { table: "shows", id: s.id, field: "advance_payment" }),
        ],
        rules: [{ ruleId: "show.done_unpaid", description: "הופעה בסטטוס 'בוצע' עם מחיר, שסטטוס התשלום שלה אינו 'שולם'", threshold: null, observed: s.paymentStatus }],
        coverageKeys: ["shows"], missing: ["ייתכן שהתשלום התקבל ולא עודכן בהופעה. אין שדה מטבע."],
        tierCtx: { daysOverdue: since ?? 0 }, sort: since ?? 0,
      }));
    }
    if (sh.upcoming.length === 0) {
      out.push(makeSignal(c, {
        type: "NO_UPCOMING_SHOWS", key: "all", entity: COMPANY_SHOWS, role: "notice",
        title: rich("אין כרגע הופעות מאושרות קדימה במערכת"), short: rich("אין הופעות מאושרות קדימה"),
        evidence: [
          ev(c, "shows:upcoming", "הופעות מאושרות קדימה", 0, "0", "count", { table: "shows", field: "status/date" }),
          ev(c, "shows:last", "הופעה אחרונה שבוצעה", sh.lastPerformedYmd, sh.lastPerformedYmd ? fullDate(sh.lastPerformedYmd) : "", "date", { table: "shows", field: "date" }),
          ev(c, "shows:leads", "לידים במערכת", sh.leadsCount, String(sh.leadsCount), "count", { table: "shows", field: "status" }),
        ],
        rules: [{ ruleId: "shows.none_upcoming", description: "אין הופעה בסטטוס אושרה/נסגר בתאריך היום או אחריו", threshold: null, observed: "0" }],
        coverageKeys: ["shows"], missing: ["מבוסס רק על מה שנרשם במערכת — הזמנות/לידים מחוץ למערכת לא ידועים."],
        tierCtx: {}, sort: 0,
      }));
    }
  }

  // ── 10. release targets (only projects that HAVE a release row) ──────────────
  for (const r of state.releases?.rows ?? []) {
    const inWindow = r.daysTo !== null && r.daysTo <= cfg.releaseWindowDays;
    const hasBlocker = r.blocker.trim() !== "";
    if (!inWindow && !hasBlocker) continue;
    const past = r.daysTo !== null && r.daysTo < 0;
    const src = { table: "project_release_details", id: r.projectId, field: "release_target_date" };
    out.push(makeSignal(c, {
      type: "RELEASE_TARGET_APPROACHING", key: r.projectId, entity: projectEntity(state, r.projectId), role: "primary",
      title: rich(r.targetYmd === null ? `ריליס בשלב "${r.stage}" עם blocker`
        : past ? `תאריך היעד לריליס עבר לפני ${-(r.daysTo as number)} ${daysWord(-(r.daysTo as number))} והריליס עדיין בשלב "${r.stage}"`
        : `ריליס בעוד ${r.daysTo} ${daysWord(r.daysTo as number)} (${fullDate(r.targetYmd)}), שלב: ${r.stage}`),
      short: rich(r.targetYmd === null ? `ריליס עם blocker` : past ? `יעד ריליס עבר (${-(r.daysTo as number)} ${daysWord(-(r.daysTo as number))})` : `ריליס בעוד ${r.daysTo} ${daysWord(r.daysTo as number)}`),
      evidence: [
        ev(c, `${r.projectId}:rstage`, "שלב ריליס", r.stage, r.stage, "status", { table: "project_release_details", id: r.projectId, field: "release_stage" }),
        ev(c, `${r.projectId}:rtarget`, "תאריך יעד לריליס", r.targetYmd, r.targetYmd ? fullDate(r.targetYmd) : "", "date", src),
        ev(c, `${r.projectId}:rdays`, past ? "ימים מאז היעד" : "ימים ליעד", r.daysTo === null ? null : past ? -r.daysTo : r.daysTo, String(r.daysTo === null ? "" : past ? -r.daysTo : r.daysTo), "days", src),
        ev(c, `${r.projectId}:rinstage`, "ימים בשלב הנוכחי", r.daysInStage, String(r.daysInStage), "days", { table: "project_release_details", id: r.projectId, field: "stage_entered_at" }),
        ev(c, `${r.projectId}:rblocker`, "blocker", hasBlocker ? r.blocker : null, hasBlocker ? r.blocker : "לא הוגדר", "text", { table: "project_release_details", id: r.projectId, field: "blocker" }, { untrusted: true }),
        ev(c, `${r.projectId}:rnext`, "הפעולה הבאה", r.nextAction.trim() ? r.nextAction : null, r.nextAction.trim() ? r.nextAction : "לא הוגדרה", "text", { table: "project_release_details", id: r.projectId, field: "next_action" }, { untrusted: true }),
      ],
      rules: [{ ruleId: "release.target", description: "שורת release פעילה עם יעד בחלון הזמן או עם blocker", threshold: `releaseWindowDays = ${cfg.releaseWindowDays}`, observed: r.daysTo === null ? "ללא תאריך" : `${r.daysTo} ימים` }],
      coverageKeys: ["releases"],
      missing: ["מוכנות הריליס האמיתית לא ידועה: אין מידע על קליפ, הפצה או קבצים סופיים."],
      tierCtx: { daysTo: r.daysTo ?? undefined, past, blocker: hasBlocker }, sort: past ? 400 + -(r.daysTo as number) : 300 - (r.daysTo ?? 99),
    }));
  }

  // ── 10b. Victor deliveries waiting for the owner — PER PROJECT (supporting only) ─
  // Never creates a case on its own and never P0: it is attached only when the project ALREADY has a primary signal from another reason,
  // or has a release inside the window. With a release ≤ 14 days it reads as a real dependency (P1).
  if (state.team.victor) {
    const byProject = new Map<string, typeof state.team.victor.active>();
    for (const w of state.team.victor.ownerQueue.items) if (w.projectId) byProject.set(w.projectId, [...(byProject.get(w.projectId) ?? []), w]);
    for (const [pid, list] of byProject) {
      const rel = (state.releases?.rows ?? []).find((r) => r.projectId === pid);
      const relDays = rel && rel.daysTo !== null && rel.daysTo >= 0 && rel.daysTo <= cfg.releaseWindowDays ? rel.daysTo : null;
      const hasOtherPrimary = out.some((x) => x.entity.type === "project" && x.entity.id === pid && x.role === "primary");
      if (!hasOtherPrimary && relDays === null) continue;
      out.push(makeSignal(c, {
        type: "VICTOR_WAITING_OWNER", key: pid, entity: projectEntity(state, pid), role: "supporting",
        title: rich(`${list.length === 1 ? "מסירה של Victor" : `${list.length} מסירות של Victor`} ללא follow-up מתועד שלך`),
        short: rich(`Victor מסר לפני ${Math.max(...list.map((w) => w.waitingOwnerDays ?? 0))} ימים — אין follow-up מתועד שלך`),
        evidence: list.slice(0, 5).flatMap((w) => [
          ev(c, `vwo:${w.id}`, "מסירה של Victor", w.title, w.title, "text", { table: "vendor_project_work", id: w.id, field: "project_id" }, { untrusted: true }),
          ev(c, `vwo:${w.id}:ball`, "הפעולה האחרונה המתועדת", "victor_upload", `העלאה של Victor — ${w.ball.basis}`, "status", { table: "vendor_project_work", id: w.id, field: "files_sent[].uploadedAt / version_reviews[].sentAt" }),
          ev(c, `vwo:${w.id}:days`, "ימים מההעלאה האחרונה", w.waitingOwnerDays, String(w.waitingOwnerDays), "days", { table: "vendor_project_work", id: w.id, field: "files_sent[].uploadedAt" }),
        ]),
        rules: [{ ruleId: "victor.waiting_owner_project", description: "מסירה של Victor שהיא הפעולה האחרונה המתועדת (ללא follow-up מתועד שלך), על פרויקט שכבר יש בו Case מסיבה אחרת או שיש לו ריליס בחלון", threshold: "release ≤ 14 ימים → P1", observed: relDays === null ? "ללא ריליס בחלון" : `ריליס בעוד ${relDays} ימים` }],
        coverageKeys: ["victor.link"], missing: ["אישור/הערות שנעשו מחוץ לאפליקציה לא נראים — לא ידוע אם הבדיקה עדיין תלויה בך."],
        tierCtx: relDays === null ? {} : { daysTo: relDays }, sort: list.length, klass: "dependency",
      }));
    }
  }

  // ── 11. existing agent_alerts (secondary source, notices only) ───────────────
  for (const a of state.alerts?.shown ?? []) {
    out.push(makeSignal(c, {
      type: "EXTERNAL_ALERT", key: a.id, entity: COMPANY_ALERTS, role: "notice",
      title: rich(a.title), short: rich(a.title),
      evidence: [
        ev(c, `${a.id}:atype`, "סוג התראה", a.type, a.type, "text", { table: "agent_alerts", id: a.id, field: "type" }),
        ev(c, `${a.id}:aage`, "גיל (ימים)", a.ageDays, String(a.ageDays), "days", { table: "agent_alerts", id: a.id, field: "created_at" }),
        ev(c, `${a.id}:amsg`, "הודעה", a.message, a.message, "text", { table: "agent_alerts", id: a.id, field: "message" }, { untrusted: true }),
      ],
      rules: [{ ruleId: "external.alert", description: "התראה קיימת מסוג מאושר וטרייה. מקור משני: לא נבדקה מול הנתונים", threshold: `allowTypes = ${cfg.alerts.allowTypes.join(", ")}`, observed: `גיל ${a.ageDays} ימים` }],
      coverageKeys: ["alerts"], missing: ["מקור משני — ה-COO לא אימת אותה מול הנתונים ולא משנה אותה."], tierCtx: {}, sort: 0,
    }));
  }

  return out;
}
