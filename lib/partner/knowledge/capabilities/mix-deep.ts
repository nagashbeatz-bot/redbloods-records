/**
 * Sunny knowledge — STEVEN + MIX PIPELINE DEEP BRAIN (Owner-only, read-only). Pure views over sources the Gateway
 * already loads (lib/partner/mix/view.ts). Progressive: company mix overview / Steven → work list (filter) → one work →
 * one section.
 */
import type { KnowledgeCapability, KnowledgeItem } from "../types";
import { buildMixView, type MixWork } from "../../mix/view";
import { byCount, item, partner, record, result, sfact, unavailable } from "./common";

const OWNER_FIN = { externalRead: true, ownerOnly: true, sensitivity: "FINANCIAL" } as const;
const NEEDS = ["STATE", "FINANCE", "OPERATIONS", "OWNER_KNOWLEDGE", "PROJECT_DETAIL", "SETTINGS", "CASES", "ACTIONS", "OUTCOMES"] as const;
const COVERAGE = [
  partner("אצל מי הכדור = ראיות: הערות / הערות-נשלחו אחרי הגרסה האחרונה → אצל איש הסאונד; גרסה אחרי הפידבק האחרון → אצלך. סתירה מוצגת, לא מוכרעת. גם העלאה שלך נרשמת כהעלאה של איש הסאונד."),
  partner("הושלם ≠ אושר ≠ יש קבצים סופיים ≠ שולם — ארבע עובדות נפרדות. אין במערכת רשומת אישור מיקס."),
  partner("גרסה אחרונה = ההעלאה החדשה ביותר, לא המספר הגבוה (Mix 10 אחרי Mix 9)."),
  partner("דדליין של איש סאונד = ציפייה פנימית, לא התחייבות ללקוח. עבר = לבדוק, לא להאשים."),
  partner("כסף: $ ו-₪ לא מחוברים. תשלום לסטיבן נרשם בכספים בשקלים ביחס קבוע שקבוע בקוד (לא מדיניות). התקבל על הוצאה = לא תקין."),
  partner("אין ציון, דירוג או תקרת עומס. האחסון עצמו לא נקרא — 'אין רישום' ≠ 'אין קובץ'."),
];
export const WORK_SECTIONS = ["summary", "project", "versions", "comments", "handoff", "deadlines", "final_files", "money", "timeline", "downstream"] as const;

function timeline(w: MixWork) {
  const ev: Array<{ at: string; event: string; detail: string }> = [];
  if (w.createdAt) ev.push({ at: w.createdAt, event: "WORK_CREATED", detail: `${w.engineer} · ${w.workType}` });
  for (const s of w.handoff.sentEvidence.sendLog) if (s.date) ev.push({ at: s.date, event: "SENT (send log)", detail: s.contentType ?? "" });
  for (const r of w.rounds) {
    if (r.uploadedAt) ev.push({ at: r.uploadedAt, event: "VERSION_UPLOADED", detail: `${r.label ?? "?"} · ${r.files} files` });
    for (const x of r.commentItems) if (x.at) ev.push({ at: x.at, event: "OWNER_COMMENT", detail: `${r.label ?? "?"} · ${x.status}` });
  }
  for (const n of w.handoff.notesSent.recorded) ev.push({ at: n, event: "NOTES_SENT", detail: "Owner pressed 'Send notes'" });
  if (w.finalFiles.latestAt) ev.push({ at: w.finalFiles.latestAt, event: "FINAL_FILE_UPLOADED (latest)", detail: `${w.finalFiles.project} final files` });
  if (w.money.paymentDate) ev.push({ at: w.money.paymentDate, event: "PAID (payment date)", detail: `${w.money.currency}${w.money.agreed}` });
  return ev.sort((a, b) => a.at.localeCompare(b.at));
}

function workRows(w: MixWork, s: string): Array<{ id: string; label: string; recordText?: boolean; epistemic: KnowledgeItem["epistemic"]; fields: Record<string, unknown> }> {
  switch (s) {
    case "project": return [{ id: "project", label: w.project?.name ?? "ללא פרויקט", recordText: true, epistemic: w.project ? "FACT" : "UNKNOWN", fields: { project: w.project, artistText: w.artistText, labelWork: w.labelWork, clientDeadline: w.clientDeadline, victor: w.victor, tasks: w.tasks } }];
    case "versions": return w.versions.byRound.map((r, i) => ({ id: `round:${i}`, label: `${r.label ?? "?"}${i === 0 ? " (latest)" : ""}`, epistemic: "FACT" as const, fields: { ...r } }));
    case "comments": return w.rounds.flatMap((r, i) => r.commentItems.map((x, j) => ({ id: `c:${i}:${j}`, label: x.text ?? "", recordText: true, epistemic: "FACT" as const, fields: { round: r.label, latestRound: i === 0, status: x.status, at: x.at, timestampSeconds: x.timestampSeconds, role: x.role } })));
    case "handoff": return [{ id: "handoff", label: w.handoff.state, epistemic: w.handoff.state === "UNKNOWN" ? "UNKNOWN" : "DERIVED", fields: { ...w.handoff } }];
    case "deadlines": return [{ id: "deadlines", label: "דדליינים", epistemic: "FACT", fields: { internal: w.internalDeadline, client: w.clientDeadline } }];
    case "final_files": return [{ id: "final_files", label: `${w.finalFiles.project} קבצים סופיים`, epistemic: "FACT", fields: { ...w.finalFiles, completion: w.completion } }];
    case "money": return [{ id: "money", label: w.money.payStatus, epistemic: w.money.conflicts.length ? "DERIVED" : "FACT", fields: { ...w.money } }];
    case "timeline": return timeline(w).map((e, i) => ({ id: `t:${i}`, label: e.event, epistemic: "FACT" as const, fields: { ...e } }));
    case "downstream": return [{ id: "downstream", label: "המשך (קבצים סופיים / מסירה / ריליס)", epistemic: "FACT", fields: { finalFiles: w.finalFiles, release: w.release, completion: w.completion, note: "final files are not the client delivery; no release-readiness policy exists" } }];
    default: return [{ id: "summary", label: w.title, recordText: true, epistemic: "DERIVED", fields: { engineer: w.engineer, isSteven: w.isSteven, workType: w.workType, status: w.status, stevenUiStatus: w.stevenUiStatus, project: w.project?.name ?? null, labelWork: w.labelWork, handoff: w.handoff.state, latestVersion: w.versions.latest, openComments: w.comments.open, openOnLatestRound: w.comments.openOnLatestRound, internalDeadline: w.internalDeadline?.date ?? null, deadlinePassed: w.internalDeadline?.passed ?? false, finalFiles: w.finalFiles.project, payStatus: w.money.payStatus, completion: w.completion, sections: WORK_SECTIONS } }];
  }
}

export const mixView: KnowledgeCapability = {
  id: "mix_view", domain: "TEAM", titleHe: "מיקס ומאסטר — תמונה מחוברת (סטיבן וכל אנשי הסאונד)",
  descriptionForModel: "EVERYTHING Redbloods records about mix / master work (Steven and any other engineer — the engineer is a free-text name; exactly 'Steven' = his portal). Modes: overview (company counts, handoff states, open comments, completed-with-open-comments / without final files / unpaid, mix-stage projects with no engineer, production done without mix, orphan mix expenses, signals, Owner questions), steven (Steven-specific: his works, portal presence, digests; what is Steven-only vs generic), work (param work = work id; sections summary / project / versions (rounds, latest by upload time) / comments (per round, open vs resolved, latest vs older) / handoff (evidence + caveats) / deadlines (internal vs client) / final_files (the app's request rule) / money (agreed vs paid vs linked expense, conflicts) / timeline / downstream), money (per work + orphan expenses, per currency).",
  examplesHe: ["מה קורה אצל סטיבן?", "מה קורה עם המיקס של X?", "מה מחכה לי מסטיבן?", "איזה הערות עדיין פתוחות?", "האם סטיבן קיבל תשלום?", "כמה חייבים לו?", "איזה מיקסים הושלמו בלי קבצים סופיים?"],
  modes: { overview: { descriptionForModel: "Company mix overview" }, steven: { descriptionForModel: "Steven-specific summary" }, work: { descriptionForModel: "One work (param work; optional section)" }, money: { descriptionForModel: "Engineer money vs Finance" } }, defaultMode: "overview",
  params: { work: { kind: "text", maxLength: 60, descriptionForModel: "work: an engineer work id (from mix_portfolio)" }, section: { kind: "enum", values: [...WORK_SECTIONS], descriptionForModel: "work: which part (default summary)" } },
  paging: { defaultLimit: 25, maxLimit: 50 }, recordTextLimit: 2000, access: OWNER_FIN, needs: NEEDS,
  read(src, q) {
    if (!src.state || src.state.status !== "OK") return unavailable("company state");
    const v = buildMixView(src);
    const base = { coverage: [...COVERAGE, ...v.unavailable.map((u) => partner(u))], completeness: (v.unavailable.length > 1 ? "PARTIAL" : "COMPLETE") as "PARTIAL" | "COMPLETE" };
    if (q.mode === "work") {
      const w = v.works.find((x) => x.id === q.params.work || x.key === q.params.work);
      if (!w) return result([], { completeness: "UNKNOWN", missing: [{ fact: "work", whyNeeded: "pass params.work (an engineer work id from mix_portfolio)" }] });
      const s = q.params.section ?? "summary";
      return result(workRows(w, s).map((r) => item({ id: `${s}:${r.id}`, entity: w.project?.key ?? null, label: r.recordText ? record(r.label) : partner(r.label), epistemic: r.epistemic, source: "TEAM_STEVEN", fields: { section: s, work: w.key, ...r.fields } })),
        { ...base, summary: [sfact("WORK", "עבודה", { key: w.key, title: w.title, engineer: w.engineer, status: w.status, handoff: w.handoff.state }, "FACT", "TEAM_STEVEN")] });
    }
    if (q.mode === "money") {
      return result([...v.works.filter((w) => w.money.priceRecorded || w.money.expenseLink !== "NONE").map((w) => item({ id: w.id, entity: w.project?.key ?? null, label: record(w.title), epistemic: w.money.conflicts.length ? "DERIVED" : "FACT", source: "FINANCE", fields: { engineer: w.engineer, status: w.status, ...w.money } })),
        ...v.money.orphanExpenses.map((t) => item({ id: `orphan:${t.id}`, entity: t.project, label: partner("הוצאת מיקס בלי עבודה מקושרת"), epistemic: "FACT", source: "FINANCE", fields: { ...t, relation: "NONE (never fuzzy-linked)" } }))],
        { ...base, summary: [sfact("PAID_BY_CURRENCY", "שולם (לפי מטבע העבודה)", v.money.paidByCurrency, "FACT", "FINANCE"), sfact("OWED_BY_CURRENCY", "יתרה פתוחה (לפי מטבע)", v.money.owedByCurrency, "DERIVED", "FINANCE"), sfact("RULES", "כללים", { rule: v.money.rule, ratio: v.money.ratio, paypal: v.money.paypal }, "FACT", "FINANCE")] });
    }
    if (q.mode === "steven") {
      const sw = v.works.filter((w) => w.isSteven);
      return result(sw.map((w) => item({ id: w.id, entity: w.project?.key ?? null, label: record(w.title), epistemic: "DERIVED", source: "TEAM_STEVEN", fields: { uiStatus: w.stevenUiStatus, status: w.status, handoff: w.handoff.state, latestVersion: w.versions.latest?.label ?? null, openComments: w.comments.open, internalDeadline: w.internalDeadline?.date ?? null, deadlinePassed: w.internalDeadline?.passed ?? false, payStatus: w.money.payStatus } })),
        { ...base, summary: [sfact("STEVEN", "סטיבן", v.steven, "FACT", "TEAM_STEVEN"), sfact("BY_HANDOFF", "לפי מצב העברה", byCount(sw.filter((w) => !["COMPLETED", "CANCELLED"].includes(w.handoff.state)).map((w) => w.handoff.state)), "DERIVED", "TEAM_STEVEN"),
          sfact("SCOPE", "ייחודי לסטיבן מול כללי", "portal, completion flow, reminders, digest, presence and upload pushes are Steven-only; work / versions / comments / final files / price sync are generic; the payment push, the ₪ payment sync and the notes / send pushes apply Steven assumptions to any engineer (see system_awareness mix_model)", "FACT", "SYSTEM_CONTRACTS")] });
    }
    return result([...v.signals.map((x, i) => item({ id: `${x.code}:${i}`, entity: x.project ?? null, label: record(x.he), epistemic: x.kind === "UNKNOWN" ? "UNKNOWN" : x.kind === "CANONICAL_FACT" ? "FACT" : "DERIVED", source: "TEAM_STEVEN", fields: { code: x.code, work: x.work ?? null } })),
      ...v.questions.map((x, i) => item({ id: `q:${i}`, label: partner(x.questionHe), epistemic: "UNKNOWN", source: "TEAM_STEVEN", fields: { kind: x.kind, why: x.why, work: x.work ?? null } }))],
      { ...base, summary: [sfact("COUNTS", "ספירות רשומות", v.counts, "DERIVED", "TEAM_STEVEN"), sfact("STEVEN", "סטיבן", v.steven, "FACT", "TEAM_STEVEN"), sfact("SIGNALS", "אותות", byCount(v.signals.map((x) => x.code)), "DERIVED", "TEAM_STEVEN")] });
  },
};

export const MIX_FILTERS = ["open", "all", "steven", "other_engineer", "waiting_engineer", "waiting_owner", "unknown", "conflicting", "deadline_passed", "open_comments", "completed", "completed_open_comments", "completed_no_final_files", "unpaid", "release", "label", "client"] as const;
export const mixPortfolio: KnowledgeCapability = {
  id: "mix_portfolio", domain: "TEAM", titleHe: "עבודות מיקס — רשימה",
  descriptionForModel: "Every engineer work side by side with FACTS (never a ranking / score): engineer, title, status (+ Steven display status), project, label / client, handoff state, latest version (by upload time), open comments (latest round vs older), internal deadline (+ passed), final files, pay status. Param filter: open / all / steven / other_engineer / waiting_engineer / waiting_owner / unknown / conflicting / deadline_passed / open_comments / completed / completed_open_comments / completed_no_final_files / unpaid / release / label / client. Also lists mix-stage projects with no engineer (filter open / all).",
  examplesHe: ["איזה פרויקטים כרגע במיקס?", "מה מחכה לסטיבן?", "מה מחכה לי?", "איזה מיקסים לא שולמו?", "איזה בלי איש סאונד?"],
  modes: { list: { descriptionForModel: "Works (optional filter)" } }, defaultMode: "list",
  params: { filter: { kind: "enum", values: [...MIX_FILTERS], descriptionForModel: "which works" } },
  paging: { defaultLimit: 25, maxLimit: 50 }, access: OWNER_FIN, needs: NEEDS,
  read(src, q) {
    if (!src.state || src.state.status !== "OK") return unavailable("company state");
    const v = buildMixView(src);
    const f = q.params.filter ?? "open";
    const open = (w: MixWork) => !["COMPLETED", "CANCELLED"].includes(w.handoff.state);
    const pick = (w: MixWork): boolean => ({
      open: open(w), all: true, steven: w.isSteven, other_engineer: !w.isSteven, waiting_engineer: w.handoff.state === "WAITING_ON_ENGINEER", waiting_owner: w.handoff.state === "WAITING_ON_OWNER",
      unknown: w.handoff.state === "UNKNOWN", conflicting: w.handoff.state === "CONFLICTING_EVIDENCE", deadline_passed: !!w.internalDeadline?.passed, open_comments: w.comments.open > 0,
      completed: w.completion.completed, completed_open_comments: w.completion.completed && w.comments.open > 0, completed_no_final_files: w.completion.completed && !w.finalFiles.project,
      unpaid: w.money.priceRecorded && !w.money.paid && w.status !== "בוטל", release: !!w.release, label: w.labelWork === true, client: w.labelWork === false,
    } as Record<string, boolean>)[f] ?? false;
    const rows = v.works.filter(pick);
    const noEngineer = f === "open" || f === "all" ? v.mixStageNoEngineer : [];
    return result([...rows.map((w) => item({ id: w.id, entity: w.project?.key ?? null, label: record(w.title), epistemic: "DERIVED", source: "TEAM_STEVEN", fields: { key: w.key, engineer: w.engineer, status: w.status, uiStatus: w.stevenUiStatus, project: w.project?.name ?? null, labelWork: w.labelWork, handoff: w.handoff.state, latestVersion: w.versions.latest?.label ?? null, latestUploadAt: w.versions.latest?.uploadedAt ?? null, openComments: w.comments.open, openOnLatestRound: w.comments.openOnLatestRound, internalDeadline: w.internalDeadline?.date ?? null, deadlinePassed: w.internalDeadline?.passed ?? false, finalFiles: w.finalFiles.project, payStatus: w.money.payStatus } })),
      ...noEngineer.map((p) => item({ id: `noengineer:${p.key}`, entity: p.key, label: record(p.name ?? "פרויקט"), epistemic: "FACT", source: "PROJECTS", fields: { projectStatus: p.status, engineerWork: "NONE" } }))],
      { summary: [sfact("COUNTS", "ספירות רשומות", v.counts, "DERIVED", "TEAM_STEVEN"), sfact("BY_HANDOFF", "לפי מצב העברה", byCount(rows.map((w) => w.handoff.state)), "DERIVED", "TEAM_STEVEN")], coverage: [...COVERAGE, partner("מסודר: פתוחות קודם, אחר כך לפי דדליין פנימי — לא דירוג.")], completeness: v.unavailable.length > 1 ? "PARTIAL" : "COMPLETE" });
  },
};
