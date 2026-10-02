/**
 * Sunny COO — PROJECT MOMENTUM + LABEL ARTIST CARE (pure, interaction time only).
 *
 * Momentum answers, from records only: what was the last meaningful progress, what is the next step, is it scheduled,
 * who holds it, is the project waiting on something, and does an upcoming deadline / release make the wait risky.
 * There is NO age threshold: nothing is "stuck" because N days passed (no approved policy exists). The only warnings:
 *   NO_NEXT_STEP — an active project with no upcoming session, no open work anywhere, no dated task and no recorded
 *                  release next action (a fact about the records — the plan may live outside Redbloods);
 *   OWNER_BALL   — the records put the ball with the Owner (computeVictorBall, engineerHandoff, the send log);
 *   *_RISK       — a deadline / release inside the horizon while the next step is not scheduled.
 *
 * Label artists are read from the canonical roster (label_artists) only; DJ / team identities never enter. A project
 * is the artist's by the release row (CANONICAL, artist id) or by the exact name in the project's artist credit
 * (TEXT_MATCH, said so).
 */
import type { CooCtx } from "./context";
import { daysBetween, INTERNAL_COO_HEURISTICS, isYmd, ymdOf, heDate } from "./model";
import { releaseReadiness } from "./readiness";
import { brainState } from "../brain/model";
import type { Readiness } from "./model";

const INACTIVE = new Set(["הושלם", "בוטל", "בהשהייה"]);
const ENGINEER_DONE = new Set(["אושר", "בוטל"]);
const DEAD_RECORD = new Set(["WITHDRAWN", "INVALIDATED", "SUPERSEDED", "REJECTED", "RETIRED", "STALE", "ACTED_ON"]);
const low = (s: string | null | undefined) => (s ?? "").normalize("NFKC").trim().toLowerCase();
const tokens = (t: string | null | undefined) => (t ?? "").split(/[,،;&+]|\sו?עם\s|\sfeat\.?\s|\sx\s/i).map((x) => x.trim()).filter(Boolean);

export type MomentumState = "OWNER_BALL" | "SCHEDULED" | "WAITING_EXTERNAL" | "NO_NEXT_STEP" | "NOT_ACTIVE" | "UNKNOWN";
export const MOMENTUM_HE: Record<MomentumState, string> = {
  OWNER_BALL: "מחכה לך", SCHEDULED: "יש צעד הבא מתוכנן", WAITING_EXTERNAL: "בעבודה אצל מישהו אחר", NO_NEXT_STEP: "אין צעד הבא רשום", NOT_ACTIVE: "לא פעיל", UNKNOWN: "לא ידוע",
};

export interface ProgressPoint { date: string; he: string; source: string }
export interface NextStep { he: string; date: string | null; who: string; source: string }
export interface ProjectMomentum {
  key: string; name: string; status: string | null; labelWork: boolean;
  state: MomentumState; stateHe: string;
  lastProgress: ProgressPoint | null;
  nextSteps: NextStep[];
  scheduledNext: NextStep | null;
  waitingOn: string[];
  deadline: string | null; deadlineDaysTo: number | null;
  release: { stage: string; target: string | null; daysTo: number | null } | null;
  risks: string[];
  warning: boolean;
  he: string;
}

export function projectMomentum(c: CooCtx, projectId: string, horizon: number = INTERNAL_COO_HEURISTICS.horizonDays): ProjectMomentum {
  const v = c.project(projectId);
  const key = `project:${projectId}`;
  const name = v.identity?.name ?? c.projectName(projectId) ?? "פרויקט";
  const status = v.identity?.status ?? null;
  const labelWork = c.isLabel(projectId);
  const base = { key, name, status, labelWork, deadline: v.identity?.deadline ?? null, deadlineDaysTo: isYmd(v.identity?.deadline) ? daysBetween(c.today, v.identity!.deadline!) : null,
    release: v.work.release ? { stage: v.work.release.stage, target: v.work.release.targetDate, daysTo: isYmd(v.work.release.targetDate) ? daysBetween(c.today, v.work.release.targetDate!) : null } : null };
  if (!v.identity) return { ...base, state: "UNKNOWN", stateHe: MOMENTUM_HE.UNKNOWN, lastProgress: null, nextSteps: [], scheduledNext: null, waitingOn: [], risks: [], warning: false, he: `${name}: הפרויקט לא נקרא.` };
  if (INACTIVE.has(status ?? "")) return { ...base, state: "NOT_ACTIVE", stateHe: `${MOMENTUM_HE.NOT_ACTIVE} (${status})`, lastProgress: null, nextSteps: [], scheduledNext: null, waitingOn: [], risks: [], warning: false, he: `${name}: ${status}.` };

  // ── last meaningful progress (recorded events only; an auto-marked session is not the Owner's confirmation) ──
  const pts: ProgressPoint[] = [];
  for (const s of c.det?.sessions?.rows ?? []) if (s.projectId === projectId && s.status === "התקיים" && isYmd(s.date) && s.date <= c.today) pts.push({ date: s.date, he: `${s.type ?? "סשן"} התקיים${s.statusSource === "AUTO_MARK" ? " (סומן אוטומטית כשהזמן עבר — לא אישור שלך)" : ""}`, source: "SESSIONS" });
  const works = (c.ops?.engineerWork?.rows ?? []).filter((w) => w.projectId === projectId);
  const workIds = new Set(works.map((w) => w.id));
  for (const m of c.ops?.mixVersions?.rows ?? []) { const d = ymdOf(m.createdAt); if (m.workId && workIds.has(m.workId) && d && d <= c.today) pts.push({ date: d, he: "הועלתה גרסת מיקס / מאסטר", source: "MIX" }); }
  for (const f of c.ops?.finalFiles?.rows ?? []) { const d = ymdOf(f.createdAt); if (f.workId && workIds.has(f.workId) && d && d <= c.today) pts.push({ date: d, he: "הועלו קבצים סופיים", source: "MIX" }); }
  const vw = (c.st?.domains.victor.data?.active ?? []).filter((w) => w.projectId === projectId);
  for (const w of vw) {
    const u = ymdOf(w.lastUploadAt); if (u && u <= c.today) pts.push({ date: u, he: `ויקטור העלה גרסה (${w.title})`, source: "TEAM_VICTOR" });
    const n = ymdOf(w.lastNotesSentAt); if (n && n <= c.today) pts.push({ date: n, he: `נשלחו הערות לויקטור (${w.title})`, source: "TEAM_VICTOR" });
  }
  for (const a of c.ops?.projectActions?.rows ?? []) { const d = ymdOf(a.actionDate); if (a.projectId === projectId && d && d <= c.today) pts.push({ date: d, he: `נרשמה שליחה / קבלה (${a.contentType ?? a.actionType ?? "פריט"})`, source: "SEND_LOG" }); }
  const rel = c.st?.domains.releasesFull.data?.items.find((r) => r.projectId === projectId) ?? null;
  { const d = ymdOf(rel?.stageEnteredAt); if (d && d <= c.today) pts.push({ date: d, he: `הריליס עבר לשלב ${rel!.stage}`, source: "RELEASES" }); }
  pts.sort((a, b) => b.date.localeCompare(a.date));
  const lastProgress = pts[0] ?? null;

  // ── next steps ──
  const next: NextStep[] = [];
  for (const s of c.st?.domains.sessions.data?.items ?? []) if (s.projectId === projectId && s.status === "מתוכנן" && s.dateYmd >= c.today) next.push({ he: `${s.sessionType ?? "סשן"} ב-${heDate(s.dateYmd)}`, date: s.dateYmd, who: "OWNER", source: "SESSIONS" });
  for (const w of works.filter((x) => !ENGINEER_DONE.has(x.status ?? ""))) next.push({ he: `${w.workType ?? "מיקס"} אצל ${w.engineerName} (${w.status ?? "?"})${w.internalDeadline ? `, דדליין פנימי ${heDate(w.internalDeadline)}` : ""}`, date: isYmd(w.internalDeadline) && w.internalDeadline >= c.today ? w.internalDeadline : null, who: w.status === "חזר" ? "OWNER" : w.engineerName, source: "MIX" });
  for (const w of vw) next.push({ he: `הפקה אצל ויקטור: ${w.title} (${w.ball.holder === "owner" ? "מחכה לפידבק שלך" : w.ball.holder === "victor" ? "אצל ויקטור" : "לא ברור אצל מי"})${w.internalDeadline ? `, דדליין פנימי ${heDate(w.internalDeadline)}` : ""}`, date: isYmd(w.internalDeadline) && w.internalDeadline >= c.today ? w.internalDeadline : null, who: w.ball.holder === "owner" ? "OWNER" : w.ball.holder === "victor" ? "VICTOR" : "UNKNOWN", source: "TEAM_VICTOR" });
  for (const t of c.st?.domains.tasksFull.data?.items ?? []) if (t.relatedType === "project" && t.relatedId === projectId && t.status === "פתוח") next.push({ he: `משימה: ${t.title}${t.dueYmd ? ` (עד ${heDate(t.dueYmd)})` : ""}`, date: isYmd(t.dueYmd) && t.dueYmd >= c.today ? t.dueYmd : null, who: "OWNER", source: "TASKS" });
  const relDet = c.det?.releases?.rows.find((r) => r.projectId === projectId) ?? null;
  if (relDet?.nextAction) next.push({ he: `ריליס — הצעד הבא הרשום: ${relDet.nextAction}${relDet.responsible ? ` (אחראי: ${relDet.responsible})` : ""}`, date: null, who: relDet.responsible ?? "UNKNOWN", source: "RELEASES" });
  const scheduledNext = next.filter((n) => n.date).sort((a, b) => a.date!.localeCompare(b.date!))[0] ?? null;

  const op = c.operating(projectId);
  const holders = op?.ballHolder.holders ?? [];
  const ownerBall = holders.includes("OWNER") || v.signals.some((s) => s.code === "OWNER_FEEDBACK_DUE" || s.code === "ENGINEER_RETURNED_WORK" || s.code === "VICTOR_WAITING_OWNER");
  const external = holders.filter((h) => h !== "OWNER" && h !== "UNKNOWN");
  const openWork = works.some((w) => !ENGINEER_DONE.has(w.status ?? "")) || vw.length > 0;
  const state: MomentumState = ownerBall ? "OWNER_BALL" : scheduledNext ? "SCHEDULED" : external.length || openWork ? "WAITING_EXTERNAL" : next.length ? "SCHEDULED" : "NO_NEXT_STEP";
  const risks: string[] = [];
  const near = (d: number | null) => d !== null && d >= 0 && d <= horizon;
  if (near(base.release?.daysTo ?? null) && (state === "NO_NEXT_STEP" || !scheduledNext)) risks.push(`הריליס מתוכנן ל-${heDate(base.release!.target)} ואני לא רואה צעד הבא מתוכנן בתאריך.`);
  if (near(base.deadlineDaysTo) && state === "NO_NEXT_STEP") risks.push(`הדדליין ללקוח ב-${heDate(base.deadline)} ואני לא רואה עבודה פתוחה או מתוכננת.`);
  if (near(base.deadlineDaysTo) && state === "WAITING_EXTERNAL" && !scheduledNext) risks.push(`הדדליין ב-${heDate(base.deadline)} והעבודה עוד אצל ${external.join(", ") || "גורם חיצוני"}.`);
  const warning = state === "OWNER_BALL" || state === "NO_NEXT_STEP" || risks.length > 0;
  const lp = lastProgress ? `התקדמות אחרונה רשומה: ${lastProgress.he} (${heDate(lastProgress.date)})` : "אני לא רואה התקדמות רשומה";
  const nx = state === "OWNER_BALL" ? "יש בו משהו שמחכה לך" : scheduledNext ? `הצעד הבא: ${scheduledNext.he}` : next.length ? `צעד הבא בלי תאריך: ${next[0].he}` : "אני לא רואה צעד הבא רשום או סשן המשך";
  return { ...base, state, stateHe: MOMENTUM_HE[state], lastProgress, nextSteps: next, scheduledNext, waitingOn: holders, risks, warning, he: `${name}: ${lp}; ${nx}.${risks.length ? ` ${risks[0]}` : ""}` };
}

// ───────────────────────────── label artist care ─────────────────────────────

export interface ArtistCare {
  key: string; name: string;
  projects: Array<ProjectMomentum & { link: "CANONICAL_RELATION" | "TEXT_MATCH"; collaboration: boolean }>;
  moving: string[]; needsStep: string[]; waitingOnOwner: string[];
  nextSession: { date: string; he: string } | null;
  upcomingSessions: number;
  nextRelease: (Readiness & { inHorizon: boolean }) | null;
  attention: boolean;
  facts: string[];
  brain: { observations: number; lastObservedAt: string | null; liveInsights: Array<{ titleHe: string; recordType: string; epistemic: "HYPOTHESIS" }> } | null;
  he: string;
}

export function artistCare(c: CooCtx, artistId: string, horizon: number = INTERNAL_COO_HEURISTICS.horizonDays): ArtistCare | null {
  const a = c.roster.find((x) => x.id === artistId);
  if (!a) return null;
  const idx = c.st?.domains.projects.data?.index ?? {};
  const rels = (c.st?.domains.releasesFull.data?.items ?? []).filter((r) => r.labelArtistId === artistId);
  const links = new Map<string, { link: "CANONICAL_RELATION" | "TEXT_MATCH"; collaboration: boolean }>();
  for (const r of rels) links.set(r.projectId, { link: "CANONICAL_RELATION", collaboration: false });
  for (const [id, p] of Object.entries(idx)) {
    if (links.has(id)) continue;
    const t = tokens(p.artistText);
    if (t.some((x) => low(x) === low(a.name))) links.set(id, { link: "TEXT_MATCH", collaboration: t.length > 1 });
  }
  const projects = [...links.entries()].map(([id, l]) => ({ ...projectMomentum(c, id, horizon), ...l })).filter((p) => p.state !== "NOT_ACTIVE" && p.state !== "UNKNOWN");
  const moving = projects.filter((p) => p.state === "SCHEDULED" || p.state === "WAITING_EXTERNAL").map((p) => p.name);
  const needsStep = projects.filter((p) => p.state === "NO_NEXT_STEP").map((p) => p.name);
  const waitingOnOwner = projects.filter((p) => p.state === "OWNER_BALL").map((p) => p.name);
  const projIds = new Set(projects.map((p) => p.key.slice(8)));
  const sess = (c.st?.domains.sessions.data?.items ?? []).filter((s) => s.projectId && projIds.has(s.projectId) && s.status === "מתוכנן" && s.dateYmd >= c.today).sort((x, y) => x.dateYmd.localeCompare(y.dateYmd));
  const inH = sess.filter((s) => daysBetween(c.today, s.dateYmd) <= horizon);
  const nextSession = sess[0] ? { date: sess[0].dateYmd, he: `${sess[0].sessionType ?? "סשן"} ב-${heDate(sess[0].dateYmd)} (${idx[sess[0].projectId!]?.name ?? "פרויקט"})` } : null;
  const nextRel = rels.filter((r) => !["יצא", "בהשהייה"].includes(r.stage) && isYmd(r.targetYmd) && r.targetYmd >= c.today).sort((x, y) => x.targetYmd!.localeCompare(y.targetYmd!))[0] ?? null;
  const rr = nextRel ? releaseReadiness(c, nextRel.projectId) : null;
  const nextRelease = rr ? { ...rr, inHorizon: (rr.daysTo ?? 999) <= horizon } : null;
  const facts = [
    `${projects.length} פרויקטים פעילים${projects.some((p) => p.link === "TEXT_MATCH") ? " (חלקם לפי שם האמן בקרדיט — TEXT_MATCH)" : ""}`,
    `${inH.length} סשנים מתוכננים ב-${horizon} הימים הקרובים`,
    nextRelease ? `ריליס הבא: ${nextRelease.titleHe} ב-${heDate(nextRelease.date)} — ${nextRelease.stateHe}` : rels.length ? "אין ריליס עתידי עם תאריך רשום" : "אין שורת ריליס רשומה — תוכנית הריליס לא ידועה (לא 'אין ריליס')",
  ];
  const attention = waitingOnOwner.length > 0 || needsStep.length > 0 || (!!nextRelease && nextRelease.inHorizon && nextRelease.state !== "READY");
  let brain: ArtistCare["brain"] = null;
  if (c.brain) {
    const st = brainState(c.brain, c.today, c.src.now.toISOString());
    const obs = c.brain.observations.filter((o) => o.entityKey === a.key || (o.resourceId && c.brain!.authorizations.some((z) => z.entityKeys.includes(a.key) && z.resourceIds.includes(o.resourceId!))));
    const live = c.brain.records.filter((r) => r.entityKeys.includes(a.key) && !DEAD_RECORD.has(st.recordStatus(r.id) ?? "OPEN"));
    brain = { observations: obs.length, lastObservedAt: obs.map((o) => o.observedAt).sort().at(-1) ?? null, liveInsights: live.slice(0, 3).map((r) => ({ titleHe: r.titleHe, recordType: r.recordType, epistemic: "HYPOTHESIS" as const })) };
  }
  const parts = [`${a.name}: ${projects.length} פרויקטים פעילים`];
  if (moving.length) parts.push(`בתנועה: ${moving.slice(0, 3).join(", ")}`);
  if (waitingOnOwner.length) parts.push(`מחכה לך: ${waitingOnOwner.slice(0, 3).join(", ")}`);
  if (needsStep.length) parts.push(`בלי צעד הבא רשום: ${needsStep.slice(0, 3).join(", ")}`);
  parts.push(nextSession ? `סשן הבא: ${nextSession.he}` : "אני לא רואה סשן מתוכנן");
  if (nextRelease) parts.push(`ריליס: ${nextRelease.titleHe} ${heDate(nextRelease.date)} (${nextRelease.stateHe})`);
  return { key: a.key, name: a.name, projects, moving, needsStep, waitingOnOwner, nextSession, upcomingSessions: inH.length, nextRelease, attention, facts, brain, he: parts.join(" · ") };
}

export function rosterCare(c: CooCtx, horizon?: number): ArtistCare[] {
  return c.roster.map((a) => artistCare(c, a.id, horizon)).filter((x): x is ArtistCare => !!x).sort((x, y) => x.name.localeCompare(y.name));
}

/** Every active project's momentum (label work first only as a display grouping — not a ranking). */
export function portfolioMomentum(c: CooCtx, horizon?: number): ProjectMomentum[] {
  return (c.st?.domains.projects.data?.open ?? []).filter((p) => !INACTIVE.has(p.status)).map((p) => projectMomentum(c, p.id, horizon))
    .filter((m) => m.state !== "NOT_ACTIVE").sort((a, b) => Number(b.labelWork) - Number(a.labelWork) || (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999") || a.name.localeCompare(b.name));
}
