/**
 * Sunny knowledge — the CONNECTED PROJECT capabilities. Pure views over the sources the Gateway already loads
 * (lib/partner/projects/view.ts). READ-ONLY, Owner-only (money). No ranking, no score.
 */
import { buildProjectView, projectPortfolio } from "../../projects/view";
import type { KnowledgeCapability } from "../types";
import { byCount, idOf, item, partner, record, result, sfact, unavailable } from "./common";

const OWNER_FIN = { externalRead: true, ownerOnly: true, sensitivity: "FINANCIAL" } as const;
const NEEDS = ["STATE", "FINANCE", "OPERATIONS", "OWNER_KNOWLEDGE", "CASES", "ACTIONS"] as const;

export const projectView: KnowledgeCapability = {
  id: "project_view", domain: "PROJECTS", titleHe: "תמונת פרויקט מחוברת",
  descriptionForModel: "ONE connected view of a project: identity (status, types, deadline, start/end, parent, hidden), people (client / label artist with link quality, Victor, engineers, Red Films), money explained with the canonical rules in the price's currency (verdict DEBT / NO_DEBT / OVERPAYMENT / FINANCE_EXCEPTION / PRICE_UNKNOWN / PROJECT_CANCELLED / INSUFFICIENT_EVIDENCE + reasons; other currencies listed separately, never converted), sessions, proposal, tasks, project actions (who waits for whom), meetings, Victor, engineer pipeline, Red Films / clip, social, release, album tracks, delivery, Owner knowledge, cases, pending actions, derived signals (never a score), what is certain vs inferred, and what is missing.",
  examplesHe: ["מה קורה עם הפרויקט הזה?", "של מי הפרויקט?", "נשאר חוב?", "מי מחכה למי?", "מה חסר בפרויקט?", "למה הוא תקוע?"],
  modes: { view: { descriptionForModel: "The connected view (param project required)" } }, defaultMode: "view",
  params: { project: { kind: "entityKey", types: ["project"], descriptionForModel: "The project (use partner_resolve)" } },
  entityScope: { types: ["project"], param: "project", mode: "view", limit: 1 },
  paging: { defaultLimit: 1, maxLimit: 1 }, access: OWNER_FIN, needs: NEEDS,
  read(src, q) {
    if (!q.params.project) return result([], { completeness: "UNKNOWN", missing: [{ fact: "project", whyNeeded: "pass params.project (partner_resolve gives the key)" }] });
    const v = buildProjectView(src, idOf(q.params.project));
    if (!v.found) return result([], { completeness: "UNKNOWN", missing: [{ fact: "project", whyNeeded: "no such project in the live data (it may be deleted)" }] });
    return result([item({ id: v.key, entity: v.key, label: record(v.identity!.name), epistemic: "FACT", source: "PROJECTS", fields: v as unknown as Record<string, unknown> })], {
      summary: [sfact("MONEY_VERDICT", "מצב כספי", v.money?.verdict ?? "UNKNOWN", "DERIVED", "FINANCE"), sfact("SIGNALS", "אותות", v.signals.map((s) => s.code), "DERIVED", "PROJECTS")],
      completeness: v.missing.some((m) => m.includes("לא נקרא —")) ? "PARTIAL" : "COMPLETE",
      coverage: [partner("קישור לקוח/אמן לפי שם הוא TEXT_MATCH — לא קישור מזהה."), partner("אותות הם נגזרים — לא ציון ולא דירוג. ישן ≠ דחוף; איכות לפני מהירות; ריליסים של הלייבל מוגנים.")],
    });
  },
};

export const projectPortfolioCap: KnowledgeCapability = {
  id: "project_portfolio", domain: "PROJECTS", titleHe: "תיק פרויקטים — עובדות ואותות",
  descriptionForModel: "Open projects side by side with FACTS only: status, business type, deadline, money verdict and derived signal codes (DEADLINE_PASSED, NO_DEADLINE, STALE, OUTSTANDING_CLIENT_MONEY, PRICE_UNKNOWN, AT_ENGINEER, ENGINEER_RETURNED_WORK, VICTOR_WAITING_OWNER, AT_VICTOR, WAITING_FEEDBACK, WAITING_VERSION, CLIP_IN_PRODUCTION, RELEASE_TARGET_PASSED, NO_SESSIONS …). Sorted by deadline, NOT ranked — priority depends on Owner policy / context (ask, don't invent a ranking). Filter by one signal.",
  examplesHe: ["אילו פרויקטים מחכים לאנשים מבחוץ?", "איפה יש כסף פתוח מלקוחות?", "אילו פרויקטים אצל מהנדס?", "מה חסר בפרויקטים?"],
  modes: { open: { descriptionForModel: "Open projects (not completed / cancelled)" } }, defaultMode: "open",
  params: { signal: { kind: "enum", values: ["DEADLINE_PASSED", "NO_DEADLINE", "STALE", "OUTSTANDING_CLIENT_MONEY", "OVERPAYMENT", "PRICE_UNKNOWN", "AT_ENGINEER", "ENGINEER_RETURNED_WORK", "VICTOR_WAITING_OWNER", "AT_VICTOR", "WAITING_FEEDBACK", "WAITING_VERSION", "CLIP_IN_PRODUCTION", "RELEASE_TARGET_PASSED", "NO_SESSIONS", "LABEL_CLASSIFICATION_UNCLEAR", "HIDDEN_PROJECT"], descriptionForModel: "Only projects with this signal" } },
  paging: { defaultLimit: 20, maxLimit: 50 }, access: OWNER_FIN, needs: NEEDS,
  read(src, q) {
    if (!src.state || src.state.status !== "OK") return unavailable("projects");
    const rows = projectPortfolio(src).filter((r) => !q.params.signal || r.signals.includes(q.params.signal));
    return result(rows.map((r) => item({ id: r.id, entity: `project:${r.id}`, label: record(r.name), epistemic: "DERIVED", source: "PROJECTS", fields: { status: r.status, businessType: r.businessType, deadline: r.deadline, moneyVerdict: r.verdict, signals: r.signals } })),
      { summary: [sfact("BY_SIGNAL", "פרויקטים לפי אות", byCount(rows.flatMap((r) => r.signals)), "DERIVED", "PROJECTS")], coverage: [partner("מסודר לפי דדליין — זה לא דירוג עדיפות.")] });
  },
};
