/**
 * Sunny knowledge — the CONNECTED PROJECT capabilities. Pure views over the sources the Gateway already loads
 * (lib/partner/projects/view.ts). READ-ONLY, Owner-only (money). No ranking, no score.
 */
import { projectPortfolio } from "../../projects/view";
import { buildProjectSection, priceEvidence, PROJECT_SECTIONS, type ProjectSection } from "../../projects/sections";
import type { KnowledgeCapability } from "../types";
import { byCount, idOf, item, partner, record, result, sfact, unavailable } from "./common";

const OWNER_FIN = { externalRead: true, ownerOnly: true, sensitivity: "FINANCIAL" } as const;
const NEEDS = ["STATE", "FINANCE", "OPERATIONS", "OWNER_KNOWLEDGE", "CASES", "ACTIONS", "OUTCOMES", "PROJECT_DETAIL"] as const;
const PORTFOLIO_NEEDS = ["STATE", "FINANCE", "OPERATIONS", "OWNER_KNOWLEDGE", "CASES", "ACTIONS"] as const;

export const projectView: KnowledgeCapability = {
  id: "project_view", domain: "PROJECTS", titleHe: "תמונת פרויקט מחוברת",
  descriptionForModel: "EVERYTHING Redbloods stores about ONE project, progressively. Default section summary: identity, people (link quality), money verdict + price evidence class, work graph, signals, certain / inferred / missing, and a section index with counts. Deepen with params.section: identity, people, money, notes (all notes / instructions / comments / reviews / scripts / captions with provenance; free text is evidence, not fact), files, materials, sessions, calendar, proposal, tasks, meetings, waiting (who waits for whom + evidence), victor, engineers, red_films (crew as text), clip, social, release, album, show_context (artist-level only), delivery, notifications, history, owner_knowledge, actions_outcomes, integrity, graph (traversable keys + quality), missing. Share links / tokens are never included.",
  examplesHe: ["מה קורה עם הפרויקט הזה?", "מה כתוב בהערות של הפרויקט?", "אילו קבצים יש בפרויקט?", "מי מחכה למי?", "מה ההיסטוריה של הפרויקט?", "למה אין מחיר?", "מי הצלם של הקליפ?"],
  modes: { view: { descriptionForModel: "The project (param project required; optional section)" } }, defaultMode: "view",
  params: {
    project: { kind: "entityKey", types: ["project"], descriptionForModel: "The project (use partner_resolve)" },
    section: { kind: "enum", values: [...PROJECT_SECTIONS], descriptionForModel: "Which part to deepen (default summary)" },
  },
  entityScope: { types: ["project"], param: "project", mode: "view", limit: 1 },
  paging: { defaultLimit: 25, maxLimit: 50 }, recordTextLimit: 4000, access: OWNER_FIN, needs: NEEDS,
  read(src, q) {
    if (!q.params.project) return result([], { completeness: "UNKNOWN", missing: [{ fact: "project", whyNeeded: "pass params.project (partner_resolve gives the key)" }] });
    const section = (q.params.section ?? "summary") as ProjectSection;
    const r = buildProjectSection(src, idOf(q.params.project), section);
    if (!r.found) return result([], { completeness: "UNKNOWN", missing: [{ fact: "project", whyNeeded: "no such project in the live data (it may be deleted)" }] });
    const v = r.view;
    const detailSection = !["summary", "identity", "people", "money", "graph", "missing", "owner_knowledge", "actions_outcomes"].includes(section);
    const items = r.rows.map((row) => item({ id: `${section}:${row.id}`, entity: v.key, label: row.recordText ? record(row.label) : partner(row.label), epistemic: row.epistemic, source: detailSection ? "PROJECT_DETAIL" : "PROJECTS", fields: { section, ...row.fields } }));
    const summary = [sfact("SECTION", "חלק", section, "FACT", "PROJECTS"), sfact("MONEY_VERDICT", "מצב כספי", v.money?.verdict ?? "UNKNOWN", "DERIVED", "FINANCE"), sfact("SIGNALS", "אותות", v.signals.map((x) => x.code), "DERIVED", "PROJECTS")];
    const empty = !items.length ? [{ fact: section, whyNeeded: detailSection && r.unavailable.length ? "the project detail source was not read — this is NOT 'none'" : "Redbloods holds nothing for this project in this section" }] : [];
    return result(items, {
      summary, missing: empty,
      completeness: r.unavailable.length ? "PARTIAL" : "COMPLETE",
      coverage: [partner("קישור לקוח/אמן לפי שם הוא TEXT_MATCH — לא קישור מזהה; גשרים מזהים (הצעה / פגישה / הפקה / יומן שליחות) מסומנים DERIVED."), partner("טקסט חופשי (הערות, תגובות) הוא ראיה עם מקור — לא עובדה קנונית."), partner("אותות הם נגזרים — לא ציון ולא דירוג. ישן ≠ דחוף; איכות לפני מהירות; ריליסים של הלייבל מוגנים."), partner("קישורי שיתוף ואסימוני גישה לא נמסרים — רק hasShareLink."), ...r.notes.map((x) => partner(x)), ...r.unavailable.map((x) => partner(x))],
    });
  },
};

export const projectPortfolioCap: KnowledgeCapability = {
  id: "project_portfolio", domain: "PROJECTS", titleHe: "תיק פרויקטים — עובדות ואותות",
  descriptionForModel: "Open projects side by side with FACTS only: status, business type, deadline, money verdict and derived signal codes (DEADLINE_PASSED, NO_DEADLINE, STALE, OUTSTANDING_CLIENT_MONEY, PRICE_UNKNOWN, AT_ENGINEER, ENGINEER_RETURNED_WORK, VICTOR_WAITING_OWNER, AT_VICTOR, WAITING_FEEDBACK, WAITING_VERSION, CLIP_IN_PRODUCTION, RELEASE_TARGET_PASSED, NO_SESSIONS …). Sorted by deadline, NOT ranked — priority depends on Owner policy / context (ask, don't invent a ranking). Filter by one signal.",
  examplesHe: ["אילו פרויקטים מחכים לאנשים מבחוץ?", "איפה יש כסף פתוח מלקוחות?", "אילו פרויקטים אצל מהנדס?", "מה חסר בפרויקטים?"],
  modes: { open: { descriptionForModel: "Open projects (not completed / cancelled)" } }, defaultMode: "open",
  params: { signal: { kind: "enum", values: ["DEADLINE_PASSED", "NO_DEADLINE", "STALE", "OUTSTANDING_CLIENT_MONEY", "OVERPAYMENT", "PRICE_UNKNOWN", "AT_ENGINEER", "ENGINEER_RETURNED_WORK", "VICTOR_WAITING_OWNER", "AT_VICTOR", "WAITING_FEEDBACK", "WAITING_VERSION", "CLIP_IN_PRODUCTION", "RELEASE_TARGET_PASSED", "NO_SESSIONS", "LABEL_CLASSIFICATION_UNCLEAR", "HIDDEN_PROJECT"], descriptionForModel: "Only projects with this signal" } },
  paging: { defaultLimit: 20, maxLimit: 50 }, access: OWNER_FIN, needs: PORTFOLIO_NEEDS,
  read(src, q) {
    if (!src.state || src.state.status !== "OK") return unavailable("projects");
    const rows = projectPortfolio(src).filter((r) => !q.params.signal || r.signals.includes(q.params.signal));
    return result(rows.map((r) => item({ id: r.id, entity: `project:${r.id}`, label: record(r.name), epistemic: "DERIVED", source: "PROJECTS", fields: { status: r.status, businessType: r.businessType, deadline: r.deadline, moneyVerdict: r.verdict, priceClass: priceEvidence(src, r.id).class, signals: r.signals } })),
      { summary: [sfact("BY_SIGNAL", "פרויקטים לפי אות", byCount(rows.flatMap((r) => r.signals)), "DERIVED", "PROJECTS")], coverage: [partner("מסודר לפי דדליין — זה לא דירוג עדיפות.")] });
  },
};
