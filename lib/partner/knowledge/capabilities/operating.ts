/**
 * Sunny knowledge — the OWNER OPERATING MODEL (Owner-confirmed rules + event workflows) and its deterministic
 * application (lib/partner/sunny/operating.ts). Owner-only, read-only. Nothing is scored, ranked or executed.
 *
 *   rules              the Owner-confirmed operating rules (system contract, OWNER_CONFIRMED provenance)
 *   workflows          event → workflow models (what must be known, where Redbloods keeps it, downstream, pushes, actions)
 *   project            one project through the model: client deadline class, internal deadlines, ball holder + evidence,
 *                      advance evidence, label protection, occupancy until the deadline, questions for the Owner
 *   show               "נכנסה הופעה ל<artist> ב-<date>": what is known, what to ask, downstream, notification proposals
 *   company            trade-off context: cashflow + label continuity + deadlines — facts and reasons, no score
 *   repeated_questions question types Sunny keeps asking → the missing Redbloods concept (improvement signal)
 */
import type { KnowledgeCapability, KnowledgeItem } from "../types";
import { OWNER_MODEL_VERSION, OWNER_OPERATING_RULES, WORKFLOW_MODELS, type OwnerRuleArea } from "../../system/owner-model";
import { companyOperating, projectOperating, repeatedQuestionSignals, showWorkflow } from "../../sunny/operating";
import { idOf, item, partner, record, result, sfact, unavailable } from "./common";

const AREAS: readonly OwnerRuleArea[] = ["DEADLINES", "PROJECT_FLOW", "UNKNOWN_HANDLING", "COMMUNICATION", "LEARNING", "CASHFLOW", "PAYMENTS", "LABEL", "PRIORITIES", "TIME", "PERSONAL_CONTEXT", "LANGUAGE", "WORKFLOWS", "SYSTEM_IMPROVEMENT"];
const COVERAGE = [
  partner("כללי העבודה אושרו על ידי הבעלים (OWNER_CONFIRMED). היישום שלהם כאן נגזר (DERIVED) — לא ציון ולא דירוג."),
  partner("אין תגובה באפליקציה ≠ אין תקשורת (וואטסאפ / טלפון / פנים אל פנים). דדליין שעבר ≠ כישלון של הבעלים."),
  partner("אין סכום מקדמה, אחוז, אבן דרך או חוב שמומצאים — רק ראיות שנרשמו."),
];

export const operatingModel: KnowledgeCapability = {
  id: "operating_model", domain: "COMPANY", titleHe: "איך הבעלים מנהל את Redbloods",
  descriptionForModel: "The Owner-CONFIRMED operating model and its deterministic application. Modes: rules (area filter), workflows (event filter: what must be known + where Redbloods keeps it / what to ask, downstream effects, existing manual pushes, action executability), project (client deadline class NO_DEADLINE/UPCOMING/APPROACHING/AT_RISK/PASSED_NEW_FAILURE/HISTORICAL_OPERATIONAL_DEBT, internal deadlines, ball-holder evidence, advance evidence, label protection, occupancy, questions), show (artist + date → known / to ask / downstream / notification proposals), company (cashflow + label + deadlines trade-off context, no score), repeated_questions (improvement signals). Old overdue = operational debt, not an emergency. Never invent payment terms.",
  examplesHe: ["נכנסה הופעה לשליו ב-15.10", "הדדליין של הפרויקט הזה בסיכון?", "על מי הפרויקט מחכה?", "התקבלה מקדמה?", "כסף או לייבל — מה קודם?", "איך אתה אמור להתנהג כשדדליין עובר?", "מה אתה שואל אותי שוב ושוב?"],
  modes: {
    rules: { descriptionForModel: "Owner-confirmed rules (optional area)" }, workflows: { descriptionForModel: "Event workflow models (optional event)" },
    project: { descriptionForModel: "One project through the operating model (param project)" }, show: { descriptionForModel: "A new / reported show (params artist + date)" },
    company: { descriptionForModel: "Cashflow / label / deadline trade-off context" }, repeated_questions: { descriptionForModel: "Repeated question types → missing Redbloods concept" },
  },
  defaultMode: "rules",
  params: {
    area: { kind: "enum", values: AREAS, descriptionForModel: "rules: only this area" },
    event: { kind: "enum", values: WORKFLOW_MODELS.map((w) => w.event), descriptionForModel: "workflows: only this event" },
    project: { kind: "entityKey", types: ["project"], descriptionForModel: "project: the project (partner_resolve)" },
    artist: { kind: "entityKey", types: ["label-artist", "client"], descriptionForModel: "show: the artist (partner_resolve)" },
    date: { kind: "ymd", descriptionForModel: "show: the show date (YYYY-MM-DD)" },
  },
  entityScope: { types: ["project"], param: "project", mode: "project", limit: 1 },
  paging: { defaultLimit: 25, maxLimit: 50 }, recordTextLimit: 2000,
  access: { externalRead: true, ownerOnly: true, sensitivity: "FINANCIAL" },
  needs: ["STATE", "FINANCE", "OPERATIONS", "OWNER_KNOWLEDGE", "INTEGRITY", "CASES", "ACTIONS", "OUTCOMES", "PROJECT_DETAIL"], optionalNeeds: ["CALENDAR", "SETTINGS"],
  read(src, q) {
    const version = sfact("OWNER_MODEL_VERSION", "גרסת מודל העבודה", OWNER_MODEL_VERSION, "OWNER_DECISION", "PARTNER_KNOWLEDGE");
    if (q.mode === "rules") {
      const rules = OWNER_OPERATING_RULES.filter((r) => !q.params.area || r.area === q.params.area);
      return result(rules.map((r) => item({ id: r.id, label: partner(r.rule), epistemic: "OWNER_DECISION", source: "PARTNER_KNOWLEDGE", fields: { area: r.area, provenance: r.provenance, confirmedAt: r.confirmedAt, sunnyBehavior: r.sunnyBehavior, doesNotMean: r.doesNotMean } })), { summary: [version], coverage: COVERAGE });
    }
    if (q.mode === "workflows") {
      const ws = WORKFLOW_MODELS.filter((w) => !q.params.event || w.event === q.params.event);
      return result(ws.map((w) => item({ id: w.event, label: partner(w.titleHe), epistemic: "FACT", source: "PARTNER_KNOWLEDGE", fields: { required: w.required, askOwner: w.required.filter((r) => r.knownFrom === "ASK_OWNER").map((r) => r.item), downstream: w.downstream, notifications: w.notifications, actions: w.actions, source: w.source } })),
        { summary: [version], coverage: [partner("אירוע מתחיל תהליך: לבדוק מה ידוע, לשאול רק מה שחסר, לזהות השלכות. סאני לא יוצר רשומות ולא שולח התראות."), ...COVERAGE] });
    }
    if (!src.state || src.state.status !== "OK") return unavailable("company state");
    if (q.mode === "project") {
      if (!q.params.project) return result([], { completeness: "UNKNOWN", missing: [{ fact: "project", whyNeeded: "pass params.project (partner_resolve)" }] });
      const a = projectOperating(src, idOf(q.params.project));
      if (!a) return result([], { completeness: "UNKNOWN", missing: [{ fact: "project", whyNeeded: "no such project in the live data" }] });
      const items: KnowledgeItem[] = [
        item({ id: "client_deadline", entity: a.project.key, label: partner("דדליין הלקוח"), epistemic: "DERIVED", source: "PROJECTS", fields: a.clientDeadline }),
        item({ id: "internal_deadlines", entity: a.project.key, label: partner("דדליינים פנימיים"), epistemic: "FACT", source: "OPERATIONS", fields: { rows: a.internalDeadlines } }),
        item({ id: "ball_holder", entity: a.project.key, label: partner("אצל מי הכדור"), epistemic: a.ballHolder.certainty === "RECORDED" ? "FACT" : a.ballHolder.certainty === "UNKNOWN" ? "UNKNOWN" : "DERIVED", source: "OPERATIONS", fields: a.ballHolder }),
        item({ id: "advance", entity: a.project.key, label: partner("ראיית מקדמה"), epistemic: a.advance.state === "UNKNOWN" ? "UNKNOWN" : "DERIVED", source: "FINANCE", fields: a.advance }),
        item({ id: "label", entity: a.project.key, label: partner("לייבל"), epistemic: "DERIVED", source: "PROJECTS", fields: a.label }),
        ...(a.occupancyUntilDeadline ? [item({ id: "occupancy", entity: a.project.key, label: partner("עומס ביומן עד הדדליין"), epistemic: "DERIVED", source: "CALENDAR", fields: a.occupancyUntilDeadline })] : []),
        ...a.questions.map((x, n) => item({ id: `question:${n}`, entity: a.project.key, label: partner(x.questionHe), epistemic: "UNKNOWN", source: "PROJECTS", fields: { kind: x.kind, why: x.why } })),
      ];
      return result(items, { summary: [version, sfact("PROJECT", "פרויקט", a.project, "FACT", "PROJECTS")], completeness: src.finance?.status === "OK" && src.operations?.status === "OK" ? "COMPLETE" : "PARTIAL", coverage: COVERAGE });
    }
    if (q.mode === "show") {
      if (!q.params.artist) return result([], { completeness: "UNKNOWN", missing: [{ fact: "artist", whyNeeded: "pass params.artist (partner_resolve); if the name is ambiguous ask the Owner — never guess" }] });
      const w = showWorkflow(src, q.params.artist, q.params.date ?? null);
      if (!w.resolved) return result(w.questions.map((x, n) => item({ id: `question:${n}`, label: partner(x.questionHe), epistemic: "UNKNOWN", source: "PARTNER_KNOWLEDGE", fields: { why: x.why } })), { completeness: "UNKNOWN" });
      const items: KnowledgeItem[] = [
        ...w.known.map((k) => item({ id: `known:${k.item}`, label: partner(k.item), epistemic: k.source === "OWNER_KNOWLEDGE" ? "OWNER_REPORTED" : "FACT", source: k.source === "OWNER_KNOWLEDGE" ? "OWNER_KNOWLEDGE" : k.source === "CANONICAL_DATA" ? "SHOWS" : "PARTNER_KNOWLEDGE", fields: { value: k.value, knownFrom: k.source } })),
        ...w.questions.map((x, n) => item({ id: `ask:${n}`, label: partner(x.questionHe), epistemic: "UNKNOWN", source: "PARTNER_KNOWLEDGE", fields: { why: x.why } })),
        ...(w.calendarOnDate ? [item({ id: "calendar", label: partner("היומן בתאריך"), epistemic: "FACT", source: "CALENDAR", fields: w.calendarOnDate })] : []),
        ...w.notifications.map((x) => item({ id: `notify:${x.push}`, label: partner(x.push), epistemic: "DERIVED", source: "SETTINGS", fields: { ...x, sunnySends: false } })),
        item({ id: "downstream", label: partner("מה קורה אחר כך במערכת"), epistemic: "FACT", source: "PARTNER_KNOWLEDGE", fields: { downstream: w.downstream, actions: w.actions, rehearsalsLinked: w.rehearsalsLinked } }),
      ];
      return result(items, { summary: [version, sfact("WORKFLOW", "תהליך", { workflow: w.workflow, artist: w.artist, date: w.date, existingShow: w.existingShow }, "DERIVED", "SHOWS")], coverage: [partner("סאני לא יוצר הופעה ולא שולח התראה — הוא שואל את הבעלים אם לשלוח (NOTIFY_ARTIST_DJ: NOT_YET_EXECUTABLE)."), partner("CLEANTONE מנגן ברוב ההופעות — תדירות, לא כלל: לאשר לכל הופעה.")] });
    }
    if (q.mode === "company") {
      const c = companyOperating(src);
      return result([
        item({ id: "cashflow", label: partner("תזרים"), epistemic: "DERIVED", source: "FINANCE", fields: c.cashflow }),
        item({ id: "label", label: partner("לייבל"), epistemic: "DERIVED", source: "PROJECTS", fields: c.label }),
        item({ id: "deadlines", label: partner("דדליינים"), epistemic: "DERIVED", source: "PROJECTS", fields: c.deadlines }),
      ], { summary: [version, sfact("TRADEOFF", "איזון", c.tradeoffGuidance, "OWNER_DECISION", "PARTNER_KNOWLEDGE")], completeness: src.finance?.status === "OK" ? "COMPLETE" : "PARTIAL", coverage: COVERAGE });
    }
    const sig = repeatedQuestionSignals(src);
    return result(sig.map((s) => item({ id: s.questionType, label: s.suggestionHe ? record(s.suggestionHe) : partner(s.questionType), epistemic: "PATTERN_CANDIDATE", source: "INTEGRITY", fields: s })),
      { summary: [version], coverage: [partner("שאלה שחוזרת היא אות לשיפור המוצר — הבעלים מחליט; סאני לא משנה את המערכת.")], completeness: src.integrity?.status === "OK" ? "COMPLETE" : "PARTIAL" });
  },
};
