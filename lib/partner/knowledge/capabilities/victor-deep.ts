/**
 * Sunny knowledge — VICTOR DEEP BRAIN (Owner-only, read-only). Pure views over sources the Gateway already loads
 * (lib/partner/victor/view.ts). Progressive: Victor overview → work list (filter) → one work → one section.
 */
import type { KnowledgeCapability, KnowledgeItem } from "../types";
import { buildVictorView, type VictorWork } from "../../victor/view";
import { byCount, item, partner, record, result, sfact, unavailable } from "./common";

const OWNER_FIN = { externalRead: true, ownerOnly: true, sensitivity: "FINANCIAL" } as const;
const NEEDS = ["STATE", "FINANCE", "OPERATIONS", "OWNER_KNOWLEDGE", "PROJECT_DETAIL", "SETTINGS", "CASES", "ACTIONS", "OUTCOMES"] as const;
const COVERAGE = [
  partner("אצל מי הכדור לפי הכלל של המערכת (העלאה אחרונה מול הערות אחרונות שנשלחו) + יומן השליחה — סתירה מוצגת, לא מוכרעת. גם העלאה שלך נספרת כהעלאה."),
  partner("דדליין של ויקטור = ציפייה פנימית, לא התחייבות ללקוח. עבר = לבדוק, לא להאשים."),
  partner("אין ציון עומס, אין תקרת עבודות, אין ציון ביצועים — רק ספירות רשומות."),
  partner("קבצים: רק רישומי הקבצים השמורים; האחסון עצמו לא נקרא — 'אין רישום' ≠ 'אין קובץ'."),
  partner("כסף: שורת כספים ששולמה היא ההוכחה הקנונית; overrides הם הצהרה שלך; לעולם לא מחברים $ ו-₪."),
];
export const WORK_SECTIONS = ["summary", "project", "handoff", "deadlines", "files", "feedback", "brief", "downstream"] as const;

function workRows(w: VictorWork, s: string): Array<{ id: string; label: string; recordText?: boolean; epistemic: KnowledgeItem["epistemic"]; fields: Record<string, unknown> }> {
  switch (s) {
    case "project": return [{ id: "project", label: w.project?.name ?? "ללא פרויקט", recordText: true, epistemic: w.project ? "FACT" : "UNKNOWN", fields: { project: w.project, artistText: w.artistText, labelWork: w.labelWork, clientDeadline: w.clientDeadline } }];
    case "handoff": return [{ id: "handoff", label: w.handoff.state, epistemic: w.handoff.state === "UNKNOWN" ? "UNKNOWN" : "DERIVED", fields: { ...w.handoff } }];
    case "deadlines": return [{ id: "deadlines", label: "דדליינים", epistemic: "FACT", fields: { internal: w.internalDeadline, client: w.clientDeadline } }];
    case "files": return [{ id: "files", label: `${w.files.entries} קבצים`, epistemic: "FACT", fields: { ...w.files } }];
    case "feedback": return w.feedback.reviews.map((r, i) => ({ id: `r:${i}`, label: `${r.version}${r.sentAt ? " — נשלח" : r.draft ? " — טיוטה" : ""}`, epistemic: "FACT" as const, fields: { ...r } }));
    case "brief": return [{ id: "brief", label: w.brief.text ?? "אין בריף", recordText: !!w.brief.text, epistemic: "FACT", fields: { references: w.brief.references, notes: w.notes } }];
    case "downstream": return [{ id: "downstream", label: "המשך (מיקס / ריליס)", epistemic: "FACT", fields: { engineers: w.engineers, release: w.release, completionPush: w.completionPush, note: "no production → mix handoff record exists; mix evidence = engineer work on the project" } }];
    default: return [{ id: "summary", label: w.title, recordText: true, epistemic: "DERIVED", fields: { status: w.status, workState: w.workState, sentDate: w.sentDate, daysSinceSent: w.daysSinceSent, project: w.project?.name ?? null, labelWork: w.labelWork, handoff: w.handoff.state, lastUpload: w.handoff.lastUploadAt, lastNotes: w.handoff.lastNotesSentAt, internalDeadline: w.internalDeadline?.date ?? null, deadlinePassed: w.internalDeadline?.passed ?? false, files: w.files.entries, versions: w.files.versions, sections: WORK_SECTIONS } }];
  }
}

export const victorView: KnowledgeCapability = {
  id: "victor_view", domain: "TEAM", titleHe: "ויקטור — תמונה מחוברת",
  descriptionForModel: "EVERYTHING Redbloods records about Victor (external producer). Modes: overview (counts: open / completed / without project / waiting on Victor / waiting on Owner / unknown / conflicting / internal deadlines passed / label vs client; presence; signals; Owner questions), work (param work = work id: sections summary, project (artist, label / client, CLIENT deadline), handoff (the app's ball rule + send log + caveats), deadlines (internal vs client), files (stored entries by version — storage itself not listable), feedback (drafts vs sent notes per version), brief, downstream (engineer / release)), money (salary months: the app's salary view vs canonical finance rows vs overrides vs legacy keys, with conflicts; paid only when the finance row is שולם; currencies never mixed; the monthly goal is KPI-only).",
  examplesHe: ["מה קורה אצל ויקטור?", "מה מחכה לי מויקטור?", "מה ויקטור צריך לעשות עכשיו?", "האם הגבתי לויקטור?", "מה מצב התשלום של ויקטור?", "איזה חודשים שולמו לויקטור?"],
  modes: { overview: { descriptionForModel: "Victor overall" }, work: { descriptionForModel: "One work (param work; optional section)" }, money: { descriptionForModel: "Salary months + reconciliation" } }, defaultMode: "overview",
  params: { work: { kind: "text", maxLength: 60, descriptionForModel: "work: a Victor work id (from victor_portfolio)" }, section: { kind: "enum", values: [...WORK_SECTIONS], descriptionForModel: "work: which part (default summary)" } },
  paging: { defaultLimit: 25, maxLimit: 50 }, recordTextLimit: 2000, access: OWNER_FIN, needs: NEEDS,
  read(src, q) {
    if (!src.state || src.state.status !== "OK") return unavailable("company state");
    const v = buildVictorView(src);
    const base = { coverage: [...COVERAGE, ...v.unavailable.map((u) => partner(u))], completeness: (v.unavailable.length ? "PARTIAL" : "COMPLETE") as "PARTIAL" | "COMPLETE" };
    if (q.mode === "money") {
      return result(v.money.months.map((m) => item({ id: m.month, label: partner(`משכורת ${m.month}`), epistemic: m.proof.startsWith("PAID_IN_FINANCE") ? "FACT" : m.proof === "NO_EVIDENCE" ? "UNKNOWN" : "OWNER_REPORTED", source: "FINANCE", fields: { ...m } })),
        { ...base, summary: [sfact("MODEL", "מודל", { model: v.money.model, settings: v.money.settings, goalNote: v.money.goalNote, paidRule: v.money.paidRule }, "FACT", "FINANCE"), sfact("PAID_IN_FINANCE", "שולם בכספים (לפי מטבע)", v.money.paidInFinanceByCurrency, "FACT", "FINANCE"), sfact("BY_PROOF", "לפי סוג הוכחה", byCount(v.money.months.map((m) => m.proof)), "DERIVED", "FINANCE")] });
    }
    if (q.mode === "work") {
      const w = v.works.find((x) => x.id === q.params.work || x.key === q.params.work);
      if (!w) return result([], { completeness: "UNKNOWN", missing: [{ fact: "work", whyNeeded: "pass params.work (a Victor work id from victor_portfolio)" }] });
      const s = q.params.section ?? "summary";
      return result(workRows(w, s).map((r) => item({ id: `${s}:${r.id}`, entity: w.project?.key ?? null, label: r.recordText ? record(r.label) : partner(r.label), epistemic: r.epistemic, source: "TEAM_VICTOR", fields: { section: s, work: w.key, ...r.fields } })),
        { ...base, summary: [sfact("WORK", "עבודה", { key: w.key, title: w.title, status: w.status, handoff: w.handoff.state }, "FACT", "TEAM_VICTOR")] });
    }
    return result([...v.signals.map((x, i) => item({ id: `${x.code}:${i}`, entity: null, label: record(x.he), epistemic: x.kind === "UNKNOWN" ? "UNKNOWN" : x.kind === "CANONICAL_FACT" ? "FACT" : "DERIVED", source: "TEAM_VICTOR", fields: { code: x.code, work: x.work ?? null } })),
      ...v.questions.map((x, i) => item({ id: `q:${i}`, label: partner(x.questionHe), epistemic: "UNKNOWN", source: "TEAM_VICTOR", fields: { kind: x.kind, why: x.why, work: x.work ?? null } }))],
      { ...base, summary: [sfact("IDENTITY", "זהות", v.identity, "FACT", "TEAM_VICTOR"), sfact("COUNTS", "ספירות רשומות", v.counts, "DERIVED", "TEAM_VICTOR"), sfact("PRESENCE", "כניסה לפורטל", v.presence, "FACT", "TEAM_VICTOR"), sfact("SIGNALS", "אותות", byCount(v.signals.map((x) => x.code)), "DERIVED", "TEAM_VICTOR")] });
  },
};

export const victorPortfolio: KnowledgeCapability = {
  id: "victor_portfolio", domain: "TEAM", titleHe: "עבודות ויקטור — רשימה",
  descriptionForModel: "Every Victor work side by side with FACTS (never a ranking / score): title, status, project, label / client, handoff state (app rule + send log), last upload, last notes sent, internal deadline (+ passed), files, versions. Param filter: open / waiting_victor / waiting_owner / unknown / conflicting / deadline_passed / completed / label / client / no_project.",
  examplesHe: ["מה מחכה לי מויקטור?", "מה ויקטור צריך לעשות?", "איזה עבודות של ויקטור עברו דדליין?", "איזה פרויקטים עברו לויקטור?"],
  modes: { list: { descriptionForModel: "Works (optional filter)" } }, defaultMode: "list",
  params: { filter: { kind: "enum", values: ["all", "open", "waiting_victor", "waiting_owner", "unknown", "conflicting", "deadline_passed", "completed", "label", "client", "no_project"], descriptionForModel: "which works" } },
  paging: { defaultLimit: 25, maxLimit: 50 }, access: OWNER_FIN, needs: NEEDS,
  read(src, q) {
    if (!src.state || src.state.status !== "OK") return unavailable("company state");
    const v = buildVictorView(src);
    const f = q.params.filter ?? "open";
    const pick = (w: VictorWork) => f === "all" ? true : f === "open" ? w.status === "פעיל" : f === "waiting_victor" ? w.handoff.state === "WAITING_ON_VICTOR" : f === "waiting_owner" ? w.handoff.state === "WAITING_ON_OWNER" : f === "unknown" ? w.handoff.state === "UNKNOWN" : f === "conflicting" ? w.handoff.state === "CONFLICTING_EVIDENCE"
      : f === "deadline_passed" ? !!w.internalDeadline?.passed : f === "completed" ? w.status === "הושלם" : f === "label" ? w.labelWork === true : f === "client" ? w.labelWork === false : !w.project;
    const rows = v.works.filter(pick);
    return result(rows.map((w) => item({ id: w.id, entity: w.project?.key ?? null, label: record(w.title), epistemic: "DERIVED", source: "TEAM_VICTOR", fields: { key: w.key, status: w.status, project: w.project?.name ?? null, labelWork: w.labelWork, handoff: w.handoff.state, lastUpload: w.handoff.lastUploadAt, lastNotes: w.handoff.lastNotesSentAt, internalDeadline: w.internalDeadline?.date ?? null, deadlinePassed: w.internalDeadline?.passed ?? false, files: w.files.entries, versions: w.files.versions, sentDate: w.sentDate } })),
      { summary: [sfact("COUNTS", "ספירות רשומות", v.counts, "DERIVED", "TEAM_VICTOR"), sfact("BY_HANDOFF", "לפי מצב העברה", byCount(rows.map((w) => w.handoff.state)), "DERIVED", "TEAM_VICTOR")], coverage: [...COVERAGE, partner("מסודר: פתוחות קודם, אחר כך לפי תאריך שליחה — לא דירוג.")], completeness: v.unavailable.length ? "PARTIAL" : "COMPLETE" });
  },
};
