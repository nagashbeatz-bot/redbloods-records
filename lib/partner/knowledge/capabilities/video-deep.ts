/**
 * Sunny knowledge — RED FILMS + CLIP / VIDEO DEEP BRAIN (Owner-only, read-only). Pure views over sources the Gateway
 * already loads (lib/partner/redfilms/view.ts). Progressive: video overview → productions / video projects (filter) → one
 * production or one project → one section.
 */
import type { KnowledgeCapability, KnowledgeItem } from "../types";
import { buildVideoView, type VideoProduction, type ProjectVideo } from "../../redfilms/view";
import { byCount, item, partner, record, result, sfact, unavailable } from "./common";

const OWNER_FIN = { externalRead: true, ownerOnly: true, sensitivity: "FINANCIAL" } as const;
const NEEDS = ["STATE", "FINANCE", "OPERATIONS", "OWNER_KNOWLEDGE", "PROJECT_DETAIL", "SETTINGS", "CASES", "ACTIONS", "OUTCOMES"] as const;
const COVERAGE = [
  partner("שתי מערכות: הפקת Red Films (סטטוס, צוות, תקציב, תשלומים בפנקס נפרד, מסמכים) ועסקת הקליפ בפרויקט (מחיר קליפ = הכנסה מהאמן, שורות תכנון, ימי צילום, הוצאות קליפ בכספים). מחוברות רק דרך הפרויקט."),
  partner("תכנון ≠ הוצאה. תשלומי Red Films ≠ כספים. הוצאה בפועל = הוצאה בכספים עם היקף קליפ; שולם רק כש'שולם'. לעולם לא מחברים מטבעות; לכסף של Red Films אין מטבע רשום."),
  partner("תאריך צילום שעבר ≠ צולם. יומן: רק מזהה אירוע שמור; פרטים חיים דרך יכולת היומן."),
  partner("אין רשומות גרסאות וידאו / מסירה — רק קישורים וסטטוס עריכה. אין קישור ≠ אין חומר. ריליס לא מחייב קליפ."),
  partner("אין ציון ואין קביעת מוכנות — רק מה שרשום ומה שחסר."),
];
export const PRODUCTION_SECTIONS = ["summary", "project", "crew", "shoot", "concept", "editing", "files", "money", "tasks"] as const;

function productionRows(p: VideoProduction, s: string): Array<{ id: string; label: string; recordText?: boolean; epistemic: KnowledgeItem["epistemic"]; fields: Record<string, unknown> }> {
  switch (s) {
    case "project": return [{ id: "project", label: p.project?.name ?? "ללא פרויקט", recordText: true, epistemic: p.project ? "FACT" : "UNKNOWN", fields: { project: p.project, artistText: p.artistText, client: p.client, clientSource: p.clientSource, managedBySendClip: p.managedBySendClip } }];
    case "crew": return [{ id: "crew", label: "צוות", epistemic: "FACT", fields: { ...p.crew } }];
    case "shoot": return [{ id: "shoot", label: p.shoot.productionShootDate ?? "אין תאריך צילום", epistemic: "FACT", fields: { ...p.shoot } }];
    case "concept": return [{ id: "concept", label: p.concept.summary ?? "אין קונספט", recordText: true, epistemic: "FACT", fields: { ...p.concept } }];
    case "editing": return [{ id: "editing", label: p.editStatus ?? "—", epistemic: "FACT", fields: { ...p.editing, publication: p.publication } }];
    case "files": return [{ id: "files", label: `${p.files.documents.length} מסמכים`, epistemic: "FACT", fields: { ...p.files } }];
    case "money": return [{ id: "money", label: "כסף (תכנון / פנקס Red Films)", epistemic: "FACT", fields: { ...p.money } }];
    case "tasks": return p.tasks.map((t, i) => ({ id: `task:${i}`, label: t.title ?? "", recordText: true, epistemic: "FACT" as const, fields: { ...t } }));
    default: return [{ id: "summary", label: p.title, recordText: true, epistemic: "DERIVED", fields: { type: p.type, status: p.status, editStatus: p.editStatus, active: p.active, project: p.project?.name ?? null, shootDate: p.shoot.productionShootDate, shootDatePassed: p.shoot.datePassed, statusSaysShot: p.shoot.statusSaysShot, crew: p.crew, budget: p.money.budget, plannedLines: p.money.plannedLines, paidRedFilmsLedger: p.money.paidRedFilmsLedger, documents: p.files.documents.length, finalLink: p.editing.links?.final ?? false, sections: PRODUCTION_SECTIONS } }];
  }
}

export const videoView: KnowledgeCapability = {
  id: "video_view", domain: "SALES", titleHe: "וידאו / קליפים / Red Films — תמונה מחוברת",
  descriptionForModel: "EVERYTHING Redbloods records about video: Red Films productions and the project clip deal. Modes: overview (counts, money layers: planned / Red Films ledger / actual Finance clip expenses per currency / clip income, signals, Owner questions), production (param ref = production id; sections summary / project / crew / shoot / concept / editing / files / money / tasks), project (param ref = project id: clip deal, clip planning rows, clip expenses, shoot days + calendar link, productions, release / social context), money (per production + per project).",
  examplesHe: ["איזה קליפים כרגע בתהליך?", "מה קורה עם הקליפ של X?", "כמה תכננו להוציא ומה יצא בפועל?", "מי הצלם?", "מתי יום הצילום?", "האם הקליפ נמסר / פורסם?", "מה אני צריך לעשות עם הקליפים?"],
  modes: { overview: { descriptionForModel: "Company video overview" }, production: { descriptionForModel: "One production (param ref; optional section)" }, project: { descriptionForModel: "One project's video side (param ref = project id)" }, money: { descriptionForModel: "Video money layers" } }, defaultMode: "overview",
  params: { ref: { kind: "text", maxLength: 80, descriptionForModel: "production: a production id; project: a project id" }, section: { kind: "enum", values: [...PRODUCTION_SECTIONS], descriptionForModel: "production: which part (default summary)" } },
  paging: { defaultLimit: 25, maxLimit: 50 }, recordTextLimit: 2000, access: OWNER_FIN, needs: NEEDS,
  read(src, q) {
    if (!src.state || src.state.status !== "OK") return unavailable("company state");
    const v = buildVideoView(src);
    const base = { coverage: [...COVERAGE, ...v.unavailable.map((u) => partner(u))], completeness: (v.unavailable.length > 2 ? "PARTIAL" : "COMPLETE") as "PARTIAL" | "COMPLETE" };
    const ref = (q.params.ref ?? "").replace(/^(video-production|project|project-video):/, "");
    if (q.mode === "production") {
      const p = v.productions.find((x) => x.id === ref);
      if (!p) return result([], { completeness: "UNKNOWN", missing: [{ fact: "production", whyNeeded: "pass params.ref (a production id from video_portfolio)" }] });
      const s = q.params.section ?? "summary";
      return result(productionRows(p, s).map((r) => item({ id: `${s}:${r.id}`, entity: p.project?.key ?? null, label: r.recordText ? record(r.label) : partner(r.label), epistemic: r.epistemic, source: "PROJECTS", fields: { section: s, production: p.key, ...r.fields } })),
        { ...base, summary: [sfact("PRODUCTION", "הפקה", { key: p.key, title: p.title, status: p.status, active: p.active }, "FACT", "PROJECTS")] });
    }
    if (q.mode === "project") {
      const pv: ProjectVideo | undefined = v.projects.find((x) => x.project.key === `project:${ref}`);
      if (!pv) return result([], { completeness: "UNKNOWN", missing: [{ fact: "project", whyNeeded: "pass params.ref (a project id with video data — see video_portfolio projects)" }] });
      const rows: Array<[string, string, unknown]> = [["deal", "עסקת קליפ", pv.clipDeal], ["planning", "תכנון", pv.planning], ["expenses", "הוצאות קליפ בפועל", pv.expenses], ["shoots", "ימי צילום", pv.shoots], ["productions", "הפקות", pv.productions], ["release", "ריליס", pv.release], ["social", "תוכן", pv.social], ["deadline", "דדליין לקוח", pv.clientDeadline]];
      return result(rows.map(([id, he, val]) => item({ id, entity: pv.project.key, label: partner(he), epistemic: "FACT", source: "PROJECTS", fields: { value: val } })),
        { ...base, summary: [sfact("PROJECT", "פרויקט", { ...pv.project, labelWork: pv.labelWork }, "FACT", "PROJECTS")] });
    }
    if (q.mode === "money") {
      return result([...v.productions.map((p) => item({ id: p.id, entity: p.project?.key ?? null, label: record(p.title), epistemic: "FACT", source: "PROJECTS", fields: { status: p.status, ...p.money } })),
        ...v.projects.map((pv) => item({ id: pv.key, entity: pv.project.key, label: record(pv.project.name ?? "פרויקט"), epistemic: "FACT", source: "FINANCE", fields: { clipDeal: pv.clipDeal, planning: pv.planning.plannedByCurrency, expenses: pv.expenses } }))],
        { ...base, summary: [sfact("MONEY", "שכבות כסף", v.money, "DERIVED", "FINANCE")] });
    }
    return result([...v.signals.map((x, i) => item({ id: `${x.code}:${i}`, entity: x.project ?? null, label: record(x.he), epistemic: x.kind === "UNKNOWN" ? "UNKNOWN" : x.kind === "CANONICAL_FACT" ? "FACT" : "DERIVED", source: "PROJECTS", fields: { code: x.code, production: x.production ?? null } })),
      ...v.questions.map((x, i) => item({ id: `q:${i}`, label: partner(x.questionHe), epistemic: "UNKNOWN", source: "PROJECTS", fields: { kind: x.kind, why: x.why } }))],
      { ...base, summary: [sfact("COUNTS", "ספירות רשומות", v.counts, "DERIVED", "PROJECTS"), sfact("MONEY", "שכבות כסף", v.money, "DERIVED", "FINANCE"), sfact("SIGNALS", "אותות", byCount(v.signals.map((x) => x.code)), "DERIVED", "PROJECTS")] });
  },
};

export const VIDEO_FILTERS = ["active", "all", "cancelled", "shoot_passed_not_shot", "no_shoot_date", "no_project", "with_documents", "with_payments", "projects", "projects_no_production", "upcoming_shoots"] as const;
export const videoPortfolio: KnowledgeCapability = {
  id: "video_portfolio", domain: "SALES", titleHe: "הפקות וידאו — רשימה",
  descriptionForModel: "Every Red Films production (or every project with video data) side by side with FACTS, never a ranking: status, edit status, project, shoot date (+ passed, + whether the status says shot), crew names, budget / planned / Red Films paid, documents, final link. Param filter: active / all / cancelled / shoot_passed_not_shot / no_shoot_date / no_project / with_documents / with_payments / projects (every project with video data) / projects_no_production / upcoming_shoots.",
  examplesHe: ["איזה קליפים בתהליך?", "איזה צילומים מתקרבים?", "איזה פרויקטים צריכים קליפ?", "איזה הפקות בלי פרויקט?"],
  modes: { list: { descriptionForModel: "Productions or projects (filter)" } }, defaultMode: "list",
  params: { filter: { kind: "enum", values: [...VIDEO_FILTERS], descriptionForModel: "which rows" } },
  paging: { defaultLimit: 25, maxLimit: 50 }, access: OWNER_FIN, needs: NEEDS,
  read(src, q) {
    if (!src.state || src.state.status !== "OK") return unavailable("company state");
    const v = buildVideoView(src);
    const f = q.params.filter ?? "active";
    const summary = [sfact("COUNTS", "ספירות רשומות", v.counts, "DERIVED", "PROJECTS")];
    const coverage = [...COVERAGE, partner("מסודר: פעילות קודם, אחר כך לפי תאריך צילום — לא דירוג.")];
    if (f === "projects" || f === "projects_no_production" || f === "upcoming_shoots") {
      const rows = v.projects.filter((pv) => f === "projects" ? true : f === "projects_no_production" ? !pv.productions.some((x) => x.status !== "בוטל") : pv.shoots.some((s) => !s.datePassed && s.status !== "בוטל"));
      return result(rows.map((pv) => item({ id: pv.key, entity: pv.project.key, label: record(pv.project.name ?? "פרויקט"), epistemic: "FACT", source: "PROJECTS", fields: { projectStatus: pv.project.status, clipDealPrice: pv.clipDeal.price, clipDealStatus: pv.clipDeal.status, planningRows: pv.planning.rows.length, expenses: pv.expenses.total, shoots: pv.shoots.map((s) => ({ date: s.date, status: s.status, calendar: s.calendar })), productions: pv.productions.length, release: pv.release } })), { summary, coverage, completeness: "COMPLETE" });
    }
    const pick = (p: VideoProduction): boolean => ({ active: p.active, all: true, cancelled: !p.active, shoot_passed_not_shot: p.active && p.shoot.datePassed && !p.shoot.statusSaysShot, no_shoot_date: p.active && !p.shoot.productionShootDate, no_project: !p.project, with_documents: p.files.documents.length > 0, with_payments: p.money.paidRedFilmsLedger > 0 } as Record<string, boolean>)[f] ?? false;
    const rows = v.productions.filter(pick);
    return result(rows.map((p) => item({ id: p.id, entity: p.project?.key ?? null, label: record(p.title), epistemic: "DERIVED", source: "PROJECTS", fields: { key: p.key, type: p.type, status: p.status, editStatus: p.editStatus, project: p.project?.name ?? null, shootDate: p.shoot.productionShootDate, shootDatePassed: p.shoot.datePassed, statusSaysShot: p.shoot.statusSaysShot, crew: p.crew, budget: p.money.budget, plannedLines: p.money.plannedLines, paidRedFilmsLedger: p.money.paidRedFilmsLedger, documents: p.files.documents.length, finalLink: p.editing.links?.final ?? false } })),
      { summary: [...summary, sfact("BY_STATUS", "לפי סטטוס", byCount(rows.map((p) => p.status ?? "—")), "DERIVED", "PROJECTS")], coverage, completeness: "COMPLETE" });
  },
};
