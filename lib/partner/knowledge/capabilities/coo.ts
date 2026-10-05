/**
 * Sunny COO V1 (2026-10-02) — operational readiness, project momentum, label-artist care, schedule health, money
 * readiness and the executive priorities. Owner-only, read-only, interaction time only: no write, no task, no alert,
 * no push, no calendar change, no background job. Composes the existing Deep Brain views (lib/partner/coo/*); adds no
 * business rule (money = projectMoney; overdue = project-deadline; ball = projectOperating / computeVictorBall).
 */
import type { KnowledgeCapability, KnowledgeItem } from "../types";
import { item, partner, record, result, sfact } from "./common";
import { buildCooView, prioritiesHe } from "../../coo/priorities";
import { MOTION_HEURISTICS, MOTION_LEVEL_HE, motionSummary, type MotionItem } from "../../coo/motion";
import { buildFinancialForward, FINANCIAL_FORWARD_WINDOWS } from "../../coo/financial-forward";
import { cooCtx } from "../../coo/context";
import { readinessOf } from "../../coo/readiness";
import { artistCare, projectMomentum } from "../../coo/momentum";
import { moneyReadiness } from "../../coo/money";
import { derivePatterns, PATTERN_WINDOWS } from "../../sunny/patterns";
import { projectProgressEvents } from "../../sunny/since";
import { LEARNING_HEURISTICS } from "../../sunny/learning";
import { INTERNAL_COO_HEURISTICS, type Readiness } from "../../coo/model";

const COVERAGE = [
  partner("מאושר = רשומה מפורשת. 'לא רואה' = אין רשומה שמוכיחה — זה לא אומר שזה חסר במציאות. תובנה = השערה שלי. המלצה = הצעה, לא מבצעת כלום."),
  partner("אין ספי זמן כמדיניות: שום דבר לא 'תקוע' רק כי עברו X ימים. 3–5 פריטים זו מגבלת הצגה, לא כלל עסקי. אין דירוג שנשמר."),
  partner("כסף לפי החישוב הקנוני של הפרויקט (התקבל = שולם / התקבל; צפוי ≠ התקבל; שילם ≥ מחיר מוסכם → אין חוב; יותר → זיכוי). אין יתרת מזומנים ב-Redbloods — 'יש כסף' לא נטען."),
  partner("לא משנה כלום: לא יומן, לא משימות, לא התראות, לא פוש. ניתוח בזמן שיחה בלבד."),
];
const OWNER_FIN = { externalRead: true, ownerOnly: true, sensitivity: "FINANCIAL" } as const;

const readinessItem = (r: Readiness, i: number): KnowledgeItem => item({
  id: `${r.key}:${i}`, entity: r.entity && /^(project|show|session|release|label-artist|client):/.test(r.entity) ? r.entity : null, label: record(`${r.titleHe}`), epistemic: "DERIVED", source: "PARTNER_KNOWLEDGE",
  fields: { kind: r.kind, date: r.date, time: r.time, daysTo: r.daysTo, state: r.state, stateHe: partner(r.stateHe), confirmed: r.confirmed.map(partner), notSeen: r.notSeen.map(partner), open: r.open.map(partner), blocked: r.blocked.map(partner),
    ownerAttention: r.ownerAttention.map(partner), insights: r.insights.map((x) => ({ he: partner(x), epistemic: "HYPOTHESIS" })), facts: r.facts.map((x) => ({ he: partner(x), epistemic: "DERIVED" })), recommendation: r.recommendationHe ? partner(r.recommendationHe) : null, narrative: partner(r.narrativeHe),
    checks: r.checks.map((c) => ({ dimension: c.dimension, label: partner(c.labelHe), state: c.state, required: c.required, he: partner(c.he), evidence: c.evidence.map((e) => ({ source: e.source, ref: e.ref, basis: e.he })) })), project: r.project, sources: r.sources },
});

/** One motion item as a knowledge item (the move names only registered actions; every one runs only after his approval). */
const motionItem = (i: MotionItem, k: number): KnowledgeItem => item({
  id: `${k + 1}:${i.key}`, entity: i.entity && /^(project|show|session|release|label-artist|client):/.test(i.entity) ? i.entity : null, label: partner(i.he), epistemic: i.epistemic, source: "PARTNER_KNOWLEDGE",
  fields: { key: i.key, rank: k + 1, level: i.level, levelHe: partner(MOTION_LEVEL_HE[i.level]), codes: i.codes, sections: i.sections, title: record(i.titleHe), reasons: i.reasonsHe.map(partner),
    move: i.move ? { he: partner(i.move.he), actionIds: i.move.actionIds, canAct: i.move.canAct, approval: i.move.approval } : null, entities: i.entities, daysTo: i.daysTo,
    labelWork: i.labelWork, labelProtected: i.labelProtected, heuristic: i.heuristic, learning: i.learning ?? null, evidence: i.evidence.map((e) => ({ ...e, he: e.epistemic === "OWNER_REPORTED" ? record(e.he) : partner(e.he) })) },
});
export const coo: KnowledgeCapability = {
  id: "coo", domain: "COMPANY", titleHe: "סאני COO — מוכנות, תנועה, לו״ז, כסף",
  descriptionForModel: "Sunny as COO (Owner-only, read-only, interaction time). Modes: priorities (DEFAULT = BUSINESS_MOTION today, ≤5 moves), motion (the full BUSINESS_MOTION: greeting ≤3 moves, week / capacity opportunity, close loops, curated Owner bottleneck, label, commercial gap), forward (money ahead: obligations, settlements, payables, 7/14/30; no bank → coverage UNKNOWN), readiness (next 14 days events: confirmed / not seen / open / blocked), momentum (last progress, next step, who holds it), artists (label roster; DJ / team never), schedule (this week), money (param entity = project), entity, patterns, learning. RULES: short, grounded, actionable; ✓ confirmed / ? 'אני לא רואה …' (never 'אין …') / → recommendation; inference is inference; no invented threshold, quota, cash balance or song↔clip link; never move / create / schedule / send / approve anything.",
  examplesHe: ["מה הכי חשוב לי לסגור עכשיו?", "אנחנו מוכנים לצילום ביום ראשון?", "מה קורה עם אמני הלייבל?", "הלו״ז שלי השבוע נראה טוב?", "יש משהו שאני מפספס?", "הפרויקט של אבי מתקדם?", "מה לעשות השבוע?", "מה תקוע?", "מה הכי כדאי לסגור היום?"],
  modes: {
    priorities: { descriptionForModel: "= BUSINESS_MOTION today (the ONE ranking): ≤5 MUST / SHOULD moves + more count, each with level, reasons, a concrete move and the registered actionIds (each runs only after his approval). Answer like: 'שלושה דברים שהייתי סוגרת עכשיו: 1. … 2. … 3. …' — concise first, details only when asked. After an outcome is discussed you may ask 'רוצה שנשמור מזה לקח עסקי?' (BUSINESS_LEARNING only via partner_propose_knowledge + his approval)." },
    forward: { descriptionForModel: "FINANCIAL_FORWARD — the money picture ahead (an input to motion): obligations with strength / timing / preparedness / readiness level, 7 / 14 / 30-day windows per currency, settlements (direction in words: 'לטובת שליו' / 'לטובת הלייבל'; a cycle end is a REVIEW, never a payment), vendor payables (no due date = ask when), possible duplicates (counted once), inflow (expected ≠ received; a proposal is never cash). Coverage is ALWAYS UNKNOWN (no bank balance): say 'לפי התזרים הרשום במערכת…', never 'יש כיסוי' / 'יש מספיק כסף' / 'העסק יציב'. Never sum ₪ and $. Never infer one unit covers another." },
    motion: { descriptionForModel: "BUSINESS_MOTION in full (the SAME object partner_brief carries): greeting (≤3 moves), today, atRisk, closeLoops (done-but-not-recorded / one move to the mix / a mix version only he opens / his own 'almost done' note — never a status change), ownerBottleneck (Victor waits curated: extracted ones + ONE line for the rest), label (protected Shalev / Avi — promoted one level only; no cadence), revenue (commercial gap; conflicting goals are never a driver), week (capacity = an OPPORTUNITY only — never work hours, never scheduling; unreadable calendar = UNKNOWN), inbox line, watch. Use for 'מה לעשות השבוע' / 'מה תקוע' / 'מה הכי כדאי לסגור היום' / 'מה עם האמנים' and every greeting." },
    readiness: { descriptionForModel: "Readiness board (or one entity / production). Speak per event: '✓ … / ? אני לא רואה … / → הייתי סוגרת …'. A data source that was not read = לא ידוע, never 'not ready'." },
    momentum: { descriptionForModel: "Active projects' momentum (param entity = one project)" },
    artists: { descriptionForModel: "Label artist care (param artist = one roster artist)" },
    schedule: { descriptionForModel: "This week's schedule health (analysis only)" },
    money: { descriptionForModel: "Money readiness of one project (param entity)" },
    entity: { descriptionForModel: "Enrichment for partner_entity (project / label-artist / show / session / release)" },
    patterns: { descriptionForModel: "Derived operational PATTERNS (HYPOTHESES, never facts / policy): repeated 'צריך לקדם' without progress, 'almost done' that repeats, sessions on a 'לא התחיל' project, the Owner as the feedback bottleneck, progress without a price. Levels OBSERVATION / WEAK (internal only) / REPEATED / STRONG (may be raised) — say 'אני רואה דפוס אפשרי…', never 'X תמיד…'." },
    learning: { descriptionForModel: "Closed-loop outcome learning: each action Sunny executed (after the Boss's approval) vs the LATER recorded evidence on the same record — CORRELATED / LIKELY_HELPFUL / INSUFFICIENT_EVIDENCE / DID_NOT_RESOLVE / CONTRADICTED (never causal by default) + lessons and Owner-preference signals as HYPOTHESES. A lesson becomes a rule ONLY if the Boss confirms it (partner_propose_knowledge BUSINESS_LEARNING). The connector adds the action history; without it nothing is assessed." },
  }, defaultMode: "priorities",
  params: {
    entity: { kind: "entityKey", types: ["project", "show", "session", "release", "label-artist"], descriptionForModel: "readiness / momentum / money / entity: one entity" },
    artist: { kind: "entityKey", types: ["label-artist"], descriptionForModel: "artists: one roster artist" },
    production: { kind: "text", maxLength: 40, descriptionForModel: "readiness: one Red Films production id (uuid)" },
  },
  entityScope: { types: ["project", "label-artist", "show", "session", "release"], param: "entity", mode: "entity", limit: 6 },
  paging: { defaultLimit: 25, maxLimit: 50 }, recordTextLimit: 1200, access: OWNER_FIN,
  needs: ["STATE", "FINANCE", "OPERATIONS", "PROJECT_DETAIL"],
  optionalNeeds: ["LABEL_DETAIL", "SETTINGS", "CALENDAR", "BRAIN", "OWNER_KNOWLEDGE", "INTEGRITY", "MEMORY", "OWNER_INBOX", "ACTIONS"],
  read(src, q) {
    if (!src.state || src.state.status !== "OK") return result([], { completeness: "UNKNOWN", coverage: COVERAGE, missing: [{ fact: "company state", whyNeeded: "without the records nothing can be checked — unknown, never 'all fine'" }] });
    const c = cooCtx(src);
    const partial = !c.ops || !c.det || !c.financeReadable;
    const base = { coverage: COVERAGE, completeness: (partial ? "PARTIAL" : "COMPLETE") as "PARTIAL" | "COMPLETE" };
    const heur = sfact("HEURISTICS", "היוריסטיקות פנימיות (לא מדיניות שלך)", { ...INTERNAL_COO_HEURISTICS, note: "engineering windows only — never Owner policy, never 'stuck'" }, "DERIVED", "PARTNER_KNOWLEDGE");
    const entity = q.params.entity ?? null;

    if (q.mode === "readiness" || (q.mode === "entity" && entity && !entity.startsWith("label-artist:"))) {
      const list = q.params.production ? readinessOf(c, `video-production:${q.params.production}`) : entity ? readinessOf(c, entity) : buildCooView(src).readiness.events;
      const items = list.map(readinessItem);
      if (q.mode === "entity" && entity?.startsWith("project:")) {
        const m = projectMomentum(c, entity.slice(8));
        items.push(item({ id: `momentum:${entity}`, entity, label: partner(m.stateHe), epistemic: "DERIVED", source: "PARTNER_KNOWLEDGE", fields: { section: "momentum", he: partner(m.he), lastProgress: m.lastProgress, nextSteps: m.nextSteps.map((n) => ({ ...n, he: partner(n.he) })), scheduledNext: m.scheduledNext, waitingOn: m.waitingOn, risks: m.risks.map(partner) } }));
      }
      return result(items, { ...base, summary: [sfact("EVENTS", "אירועים שנבדקו", list.length, "DERIVED", "PARTNER_KNOWLEDGE"), sfact("BY_STATE", "לפי מצב", list.reduce<Record<string, number>>((m, r) => ({ ...m, [r.stateHe]: (m[r.stateHe] ?? 0) + 1 }), {}), "DERIVED", "PARTNER_KNOWLEDGE"), heur] });
    }
    if (q.mode === "patterns") {
      const pats = derivePatterns(src);
      return result(pats.map((p) => item({ id: p.code + ":" + p.entities.join(","), label: partner(p.hypothesisHe), epistemic: "HYPOTHESIS", source: "PARTNER_KNOWLEDGE", fields: { ...p } })), { ...base,
        summary: [sfact("PATTERN_LEVELS", "דפוסים לפי רמה (נגזר, לא נשמר)", { byLevel: pats.reduce<Record<string, number>>((m, p) => ((m[p.level] = (m[p.level] ?? 0) + 1), m), {}), showToOwner: pats.filter((p) => p.showToOwner).length, windows: PATTERN_WINDOWS, rule: "WEAK / OBSERVATION never in the executive answer; a pattern is a hypothesis with its evidence" }, "DERIVED", "PARTNER_KNOWLEDGE")] });
    }
    if (q.mode === "learning") {
      // the capability supplies the LATER evidence per record (the ONE since rule); the connector adds the Action Layer
      // history and runs assessOutcomes — without that history nothing is assessed (never "nothing worked")
      const progress: Record<string, unknown[]> = {};
      for (const p of c.st?.domains.projects.data?.open ?? []) progress[`project:${p.id}`] = projectProgressEvents(src, p.id);
      for (const w of c.st?.domains.victor.data?.active ?? []) progress[`victor-work:${w.id}`] = [...(w.uploads ?? [])].filter(Boolean).map((at) => ({ at, kind: "VICTOR_UPLOAD", meaning: "PROGRESS", he: "ויקטור העלה גרסה", entity: `victor-work:${w.id}`, source: "TEAM_VICTOR" }));
      return result([], { ...base, summary: [sfact("PROGRESS_BY_ENTITY", "ראיות מאוחרות לכל רשומה (לבדיקת תוצאות)", { progress, heuristics: LEARNING_HEURISTICS }, "DERIVED", "PARTNER_KNOWLEDGE"),
        sfact("LEARNING_STATUS", "מצב הלמידה", { status: "NEEDS_ACTION_HISTORY", noteHe: "בדיקת התוצאות דורשת את היסטוריית הפעולות (מתווספת בחיבור); בלעדיה — לא נבדק, לא 'כלום לא עבד'" }, "DERIVED", "PARTNER_KNOWLEDGE")] });
    }
    if (q.mode === "momentum") {
      const list = entity?.startsWith("project:") ? [projectMomentum(c, entity.slice(8))] : buildCooView(src).momentum;
      return result(list.map((m) => item({ id: m.key, entity: m.key, label: record(m.name), epistemic: "DERIVED", source: "PROJECTS", fields: { state: m.state, stateHe: partner(m.stateHe), labelWork: m.labelWork, he: partner(m.he), lastProgress: m.lastProgress ? { ...m.lastProgress, he: partner(m.lastProgress.he) } : null, scheduledNext: m.scheduledNext, nextSteps: m.nextSteps.map((n) => ({ ...n, he: partner(n.he) })), waitingOn: m.waitingOn, deadline: m.deadline, release: m.release, risks: m.risks.map(partner), warning: m.warning } })),
        { ...base, summary: [sfact("BY_STATE", "תנועה לפי מצב", list.reduce<Record<string, number>>((x, m) => ({ ...x, [m.stateHe]: (x[m.stateHe] ?? 0) + 1 }), {}), "DERIVED", "PROJECTS"), sfact("RULE", "אין סף זמן", "nothing is 'stuck' because of age; warnings = no next step recorded / the Owner's ball / a near date without a scheduled step", "DERIVED", "PARTNER_KNOWLEDGE")] });
    }
    if (q.mode === "artists" || (q.mode === "entity" && entity?.startsWith("label-artist:"))) {
      const id = (q.params.artist ?? entity ?? "").replace(/^label-artist:/, "");
      const list = id ? [artistCare(c, id)].filter((x): x is NonNullable<typeof x> => !!x) : buildCooView(src).artists;
      return result(list.map((a) => item({ id: a.key, entity: a.key, label: record(a.name), epistemic: "DERIVED", source: "LABEL_ARTISTS", fields: { he: partner(a.he), attention: a.attention, facts: a.facts.map(partner), moving: a.moving, needsStep: a.needsStep, waitingOnOwner: a.waitingOnOwner, nextSession: a.nextSession, upcomingSessions: a.upcomingSessions,
        nextRelease: a.nextRelease ? { title: a.nextRelease.titleHe, date: a.nextRelease.date, state: a.nextRelease.state, stateHe: partner(a.nextRelease.stateHe), open: a.nextRelease.open.map(partner), notSeen: a.nextRelease.notSeen.map(partner), blocked: a.nextRelease.blocked.map(partner) } : null,
        projects: a.projects.map((p) => ({ key: p.key, name: p.name, link: p.link, collaboration: p.collaboration, state: p.state, he: partner(p.he) })),
        brain: a.brain ? { ...a.brain, liveInsights: a.brain.liveInsights.map((x) => ({ ...x, titleHe: record(x.titleHe) })), note: "Brain observations / insights are context; insights are Sunny's HYPOTHESIS, never fact; operational truth comes from Redbloods records" } : null } })),
        { ...base, summary: [sfact("ROSTER", "אמני הלייבל (טבלת אמני הלייבל; DJ / צוות לא נכללים)", c.roster.map((a) => a.name), "FACT", "LABEL_ARTISTS"), sfact("RULE", "אין מכסת סשנים", "no weekly-session quota exists — facts only", "DERIVED", "PARTNER_KNOWLEDGE")] });
    }
    if (q.mode === "schedule") {
      const v = buildCooView(src);
      const s = v.schedule;
      return result([
        ...s.findings.map((f, i) => item({ id: `finding:${i}`, label: partner(f.he), epistemic: "DERIVED", source: "CALENDAR", fields: { code: f.code, kind: f.kind, date: f.date, heuristic: f.heuristic, evidence: f.evidence } })),
        ...s.days.map((d) => item({ id: `day:${d.date}`, label: partner(d.date), epistemic: "FACT", source: "CALENDAR", fields: { date: d.date, busyMinutes: d.busyMinutes, items: d.items.map((x) => ({ ...x, title: record(x.title) })) } })),
      ], { ...base, summary: [sfact("SUMMARY", "תמונת השבוע", s.he, "DERIVED", "CALENDAR"), sfact("BALANCE", "פילוח (ספירה)", s.balance, "DERIVED", "CALENDAR"), sfact("CALENDAR", "סטטוס יומן", s.calendarStatus, "FACT", "CALENDAR"), sfact("DUE", "פולואפים / משימות שמגיעים השבוע", { followups: s.dueFollowups, tasks: s.dueTasks }, "FACT", "TASKS"), heur], coverage: [...COVERAGE, ...s.unchecked.map(partner)] });
    }
    if (q.mode === "money") {
      if (!entity?.startsWith("project:")) return result([], { ...base, missing: [{ fact: "project", whyNeeded: "money readiness is per project (param entity = project:<id>)" }] });
      const pid = entity.slice(8);
      const m = moneyReadiness(c.project(pid), { labelWork: c.isLabel(pid), financeReadable: c.financeReadable });
      return result(m.checks.map((x) => item({ id: x.id, entity, label: partner(x.labelHe), epistemic: "DERIVED", source: "FINANCE", fields: { state: x.state, he: partner(x.he), evidence: x.evidence } })), { ...base, summary: [sfact("VERDICT", "מצב הכסף (החישוב הקנוני)", m.verdict, "DERIVED", "FINANCE"), sfact("FACTS", "עובדות", m.facts, "DERIVED", "FINANCE"), sfact("RISK", "סיכון כספי שיכול לעכב", m.risk, "DERIVED", "FINANCE")] });
    }
    if (q.mode === "forward") {
      // FINANCIAL_FORWARD — the money picture ahead (an input to BUSINESS_MOTION; never a second ranking)
      const ff = buildFinancialForward(src, c);
      return result(ff.obligations.map((o, k) => item({ id: `${k + 1}:${o.key}`, entity: o.entity && /^(project|show|session|release|label-artist|client):/.test(o.entity) ? o.entity : null, label: partner(o.he), epistemic: o.dynamic ? "DERIVED" : "FACT", source: "FINANCE",
        fields: { key: o.key, kind: o.kind, level: o.level, preparedness: o.preparedness, strength: o.strength, timing: o.timing, amount: o.amount, currency: o.currency, currencyNote: o.currencyNote, date: o.date, daysTo: o.daysTo, dynamic: o.dynamic, direction: o.direction, directionHe: partner(o.directionHe),
          changeDrivers: o.changeDriversHe.map(partner), question: o.questionHe ? partner(o.questionHe) : null, confidence: o.confidence, provenance: o.provenance, businessUnit: o.businessUnit, countsIn: o.countsIn, overdue: o.overdue } })),
        { ...base, coverage: [...COVERAGE, partner(ff.coverageHe), partner("צפוי ≠ התקבל; הצעה ≠ כסף; ₪ ו-$ נפרדים בלי המרה; התחשבנות = סקירה במועד הסגירה, לא תשלום"), ...ff.unchecked.map(partner)],
          summary: [sfact("ANSWER", "כסף קדימה — תמונה קצרה", ff.lineHe, "DERIVED", "FINANCE"), sfact("COVERAGE", "כיסוי (אין יתרת בנק)", ff.coverage, "DERIVED", "FINANCE"),
            sfact("WINDOWS", "חלונות 7 / 14 / 30 (לפי מטבע)", ff.windows, "DERIVED", "FINANCE"), sfact("SURPRISES", "מה עלול להפתיע", ff.surprises.map((o) => o.he), "DERIVED", "FINANCE"),
            sfact("DUPLICATES", "רשומות כפולות אפשריות (נספרות פעם אחת)", ff.duplicates.map((d) => d.he), "HYPOTHESIS", "FINANCE"), sfact("ACTUAL_MONTH", "בפועל החודש (לפי מטבע)", ff.actualMonth, "FACT", "FINANCE"),
            sfact("INFLOW", "נכנס צפוי (צפוי ≠ התקבל)", ff.inflow, "DERIVED", "FINANCE"), sfact("UNITS", "לפי יחידה (בלי הסקה בין יחידות)", ff.unitsHe, "DERIVED", "FINANCE"), sfact("WINDOW_RULE", "כלל המוכנות (לא תזכורת)", FINANCIAL_FORWARD_WINDOWS, "DERIVED", "PARTNER_KNOWLEDGE")] });
    }
    // priorities (default) = BUSINESS_MOTION today (the ONE ranking); motion = every section of the same object
    const v = buildCooView(src);
    const m = v.motion;
    const list = q.mode === "motion" ? m.all.filter((i) => i.level !== "INFO") : m.todayItems;
    return result(list.map((i, k) => motionItem(i, k)), {
      ...base, coverage: [...COVERAGE, ...v.unchecked.map(partner)],
      summary: [
        sfact("ANSWER", "תשובה קצרה", q.mode === "motion" ? m.answerHe : prioritiesHe(v), "DERIVED", "PARTNER_KNOWLEDGE"),
        sfact("MORE", "עוד מהלכים (לפירוט לפי בקשה)", m.more, "DERIVED", "PARTNER_KNOWLEDGE"),
        sfact("MOTION", "BUSINESS_MOTION — מהלכים, שבוע, לולאות, צוואר בקבוק, כסף (נגזר, לא נשמר)", motionSummary(m), "DERIVED", "PARTNER_KNOWLEDGE"),
        sfact("CHECKED", "נבדקו", { events: v.readiness.events.length, activeProjects: v.momentum.length, artists: v.artists.length, scheduleDays: v.schedule.days.length }, "DERIVED", "PARTNER_KNOWLEDGE"),
        sfact("LIMIT", "מגבלת הצגה (לא כלל עסקי)", { today: MOTION_HEURISTICS.todayMax, greeting: MOTION_HEURISTICS.greetingMoves }, "DERIVED", "PARTNER_KNOWLEDGE"), heur,
        sfact("MOTION_HEURISTICS", "חלונות פנימיים של המהלכים (לא מדיניות שלך)", MOTION_HEURISTICS, "DERIVED", "PARTNER_KNOWLEDGE"),
      ] });
  },
};
