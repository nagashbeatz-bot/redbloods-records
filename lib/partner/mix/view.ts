/**
 * Sunny — the CONNECTED MIX PIPELINE VIEW (every engineer, Steven included) + one work + money. Pure, read-only.
 *
 * Mix work = the engineer work records. Each work is joined to its project (canonical id), the project's artist / client /
 * label classification and client deadline (operating model), release, Victor work, send-log entries, mix follow-up
 * tasks (project + title prefix), its version files grouped into rounds, the Owner comments per round (open / resolved,
 * latest round vs older rounds), comment attachments, riddim lines + pre-mix notes, final files (the app's own request /
 * satisfied rule), and its linked Finance expense (the app's own paid rule and fixed working ratio, never a second rule).
 * The ball holder is an evidence rule (feedback vs upload times — the comparison the app's notes reminder itself uses);
 * completion, approval, final files and payment stay four separate facts. No score, no ranking, no invented policy.
 */
import type { GatewaySources } from "../gateway/core";
import type { PartnerCompanyState } from "../eyes/types";
import type { ProjectDetailRaw, DetailEngineerWork, DetailMixVersion, DetailMixComment } from "../projects/detail-types";
import type { SettingsState } from "../settings/types";
import type { FinanceTxRow } from "../finance/types";
import { validateTx } from "../finance/core";
import { projectOperating } from "../sunny/operating";
import { computeFinalFilesFlags } from "../../steven-completed-pure";
import { isClosedStatus, hasNewerVersion, COMPLETED_STATUS } from "../../steven-mix-reminder-pure";

const ok = <T,>(a: { status: string; value?: T } | undefined): T | null => (a && a.status === "OK" ? (a as { value: T }).value : null);
const ilToday = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const days = (a: string | null | undefined, b: string) => (a ? Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a.slice(0, 10)}T12:00:00Z`)) / 86_400_000) : null);
const maxIso = (xs: Array<string | null | undefined>) => xs.filter((x): x is string => !!x).sort((a, b) => Date.parse(a) - Date.parse(b)).pop() ?? null;
export const STEVEN = "Steven";
/** The payment sync's hard-coded working ratio ($ agreed → ₪ recorded) — IMPLEMENTATION_BEHAVIOR, reported as such. */
export const APP_PAYMENT_RATIO = 3.25;
const MIX_STAGE = new Set(["מחכה למיקס", "במיקס"]);
const INTENDED_SCOPE = "מיקס / מאסטר";

export interface MixSignal { code: string; kind: "CANONICAL_FACT" | "DERIVED_SIGNAL" | "UNKNOWN"; he: string; work?: string; project?: string }
export interface MixQuestion { questionHe: string; why: string; kind: string; work?: string }

interface Ctx { st: PartnerCompanyState | null; det: ProjectDetailRaw | null; settings: SettingsState | null; txs: FinanceTxRow[] | null; today: string }
function ctxOf(src: GatewaySources): Ctx {
  const st = ok(src.state) as PartnerCompanyState | null;
  const fin = ok(src.finance);
  return { st, det: ok(src.projectDetail) as ProjectDetailRaw | null, settings: ok(src.settings) as SettingsState | null, txs: fin ? fin.raw.transactions : null, today: st?.todayIL ?? ilToday(src.now) };
}
const famRows = (c: Ctx, family: string) => c.settings?.families[family]?.rows ?? [];

/** Numeric round order: "Mix 10" after "Mix 9"; non-numeric labels after numbered ones, by name. */
export function roundNumber(label: string | null | undefined): number | null {
  const m = /(\d+)\s*$/.exec(label ?? "");
  return m ? Number(m[1]) : null;
}

/** Owner "Send notes" instants recorded for a work: the active reminder cycle + every cycle start embedded in a reminder claim key. */
function notesSentInstants(c: Ctx, workId: string): { active: string | null; history: string[] } {
  const rows = famRows(c, "STEVEN_MIX_REMINDER_STATE");
  const cycle = rows.find((r) => r.key === `steven_mix_reminder_cycle:${workId}`)?.value as { cycleStartAt?: string } | undefined;
  const hist = new Set<string>();
  for (const r of rows) {
    const m = /^steven_mix_reminder_send:([^:]+):(.+):(\d+)$/.exec(r.key);
    if (m && m[1] === workId) hist.add(m[2]);
  }
  if (cycle?.cycleStartAt) hist.add(cycle.cycleStartAt);
  return { active: cycle?.cycleStartAt ?? null, history: [...hist].sort() };
}

function roundsOf(versions: DetailMixVersion[], comments: DetailMixComment[], attachments: ProjectDetailRaw["commentAttachments"]) {
  const byRound = new Map<string, DetailMixVersion[]>();
  for (const v of versions) {
    const k = `${v.targetId ?? "-"}|${v.label ?? "(no label)"}`;
    byRound.set(k, [...(byRound.get(k) ?? []), v]);
  }
  const rounds = [...byRound.entries()].map(([k, files]) => {
    const ids = new Set(files.map((f) => f.id));
    const cs = comments.filter((x) => x.versionId && ids.has(x.versionId));
    const csIds = new Set(cs.map((x) => x.id));
    const att = (attachments?.rows ?? []).filter((a) => a.commentId && csIds.has(a.commentId));
    const uploadedAt = maxIso(files.map((f) => f.createdAt ?? f.uploadedAt));
    return {
      key: k, label: files[0].label, number: roundNumber(files[0].label), line: files[0].targetId, uploadedAt, files: files.length,
      roles: [...new Set(files.map((f) => (/\.(zip|rar|7z)$/i.test(f.fileName ?? "") ? "stems (archive)" : /acapella|vocal/i.test(f.fileName ?? "") ? "acapella" : /instrumental|\binst\b/i.test(f.fileName ?? "") ? "instrumental" : "mix")))],
      versionStatus: [...new Set(files.map((f) => f.status ?? "—"))],
      uploadedByRecorded: [...new Set(files.map((f) => f.uploadedBy ?? "—"))],
      comments: { total: cs.length, open: cs.filter((x) => x.status !== "resolved").length, resolved: cs.filter((x) => x.status === "resolved").length, latestAt: maxIso(cs.map((x) => x.createdAt)), general: cs.filter((x) => x.timestampSeconds === null).length },
      attachments: { total: att.length, images: att.filter((a) => /^image\//.test(a.mimeType ?? "")).length, audio: att.filter((a) => /^audio\//.test(a.mimeType ?? "")).length },
      commentItems: cs.map((x) => ({ at: x.createdAt, status: x.status ?? "open", timestampSeconds: x.timestampSeconds, role: x.role, text: x.text })),
    };
  });
  // newest upload first; the number only breaks ties (numeric, never lexical)
  return rounds.sort((a, b) => (Date.parse(b.uploadedAt ?? "") || 0) - (Date.parse(a.uploadedAt ?? "") || 0) || (b.number ?? -1) - (a.number ?? -1));
}

export function buildMixWork(src: GatewaySources, w: DetailEngineerWork) {
  const c = ctxOf(src);
  const idx = c.st?.domains.projects.data?.index ?? {};
  const p = w.projectId ? idx[w.projectId] ?? null : null;
  const op = w.projectId && p ? projectOperating(src, w.projectId) : null;
  const isSteven = w.engineerName === STEVEN;
  const versions = (c.det?.mixVersions?.rows ?? []).filter((v) => v.workId === w.id);
  const versionIds = new Set(versions.map((v) => v.id));
  const comments = (c.det?.mixComments?.rows ?? []).filter((x) => x.versionId && versionIds.has(x.versionId));
  const rounds = roundsOf(versions, comments, c.det?.commentAttachments ?? null);
  const latest = rounds[0] ?? null;
  const lines = (c.det?.mixTargets?.rows ?? []).filter((t) => t.workId === w.id);
  const lineIds = new Set(lines.map((t) => t.id));
  const preMix = (c.det?.mixTargetNotes?.rows ?? []).filter((n) => n.targetId && lineIds.has(n.targetId));
  const status = w.status ?? "לא נשלח";
  const closed = isClosedStatus(status);

  // ── handoff evidence ──
  const lastUpload = latest?.uploadedAt ?? null;
  const notes = isSteven ? notesSentInstants(c, w.id) : { active: null, history: [] };
  const lastComment = maxIso(comments.map((x) => x.createdAt));
  const lastPreMix = maxIso(preMix.map((n) => n.createdAt));
  const lastFeedback = maxIso([lastComment, lastPreMix, ...notes.history]);
  const mixReadyMarker = isSteven ? famRows(c, "PUSH_SENT_ONCE_MARKERS").some((r) => r.key === `steven_mix_ready_pushed_${w.id}`) : false;
  const sendLog = (c.det?.actions?.rows ?? []).filter((a) => a.projectId && a.projectId === w.projectId && (a.recipientRole === "sound_engineer" || (a.recipientName ?? "") === w.engineerName))
    .map((a) => ({ date: a.actionDate, status: a.status, contentType: a.contentType, recipient: a.recipientName, note: "send evidence only — the status is never updated after the send" }));
  const feedbackAfterUpload = !!lastFeedback && (!lastUpload || hasNewerVersion(lastUpload, lastFeedback));
  const uploadAfterFeedback = !!lastUpload && (!lastFeedback || hasNewerVersion(lastFeedback, lastUpload));
  const sent = status !== "לא נשלח" || mixReadyMarker || sendLog.length > 0 || !!w.sentDate;
  let state: "COMPLETED" | "CANCELLED" | "WAITING_ON_ENGINEER" | "WAITING_ON_OWNER" | "CONFLICTING_EVIDENCE" | "UNKNOWN";
  const conflicts: string[] = [];
  if (closed) state = status === COMPLETED_STATUS ? "COMPLETED" : "CANCELLED";
  else {
    if (status === "חזר" && feedbackAfterUpload) conflicts.push("status חזר (returned to the Owner) but Owner feedback is newer than the latest version");
    if (notes.active && lastUpload && hasNewerVersion(notes.active, lastUpload)) conflicts.push("an active notes-reminder cycle while a newer version is recorded");
    state = conflicts.length ? "CONFLICTING_EVIDENCE"
      : feedbackAfterUpload ? "WAITING_ON_ENGINEER"
      : uploadAfterFeedback ? "WAITING_ON_OWNER"
      : sent ? "WAITING_ON_ENGINEER" : "UNKNOWN";
  }
  const basis = closed ? `status ${status}` : conflicts.length ? conflicts.join("; ")
    : feedbackAfterUpload ? (lastUpload ? "Owner feedback after the latest version" : "Owner feedback, no version yet")
    : uploadAfterFeedback ? "a version after the latest Owner feedback (a review is not recorded)"
    : sent ? "sent to the engineer, nothing uploaded yet" : "no version, no feedback, no send evidence";

  // ── final files (the app's own rule) ──
  const finalRows = (c.det?.finalFiles?.rows ?? []);
  const requestRows = (c.det?.projectSettings?.rows ?? []).filter((r) => r.kind === "STEVEN_FINAL_FILES_REQUESTED_PROJECT" || r.kind === "STEVEN_FINAL_FILES_REQUESTED_WORK")
    .map((r) => ({ key: `${r.kind === "STEVEN_FINAL_FILES_REQUESTED_PROJECT" ? "steven_final_files_requested_project:" : "steven_final_files_requested:"}${r.projectId}`, value: r.value }));
  const flags = computeFinalFilesFlags([{ id: w.id, projectId: w.projectId }], { finalRows: finalRows.map((f) => ({ work_id: f.workId, project_id: f.projectId, created_at: f.createdAt })), requestRows });
  const ownFinals = finalRows.filter((f) => f.workId === w.id);
  const projectFinals = w.projectId ? finalRows.filter((f) => f.projectId === w.projectId) : ownFinals;

  // ── money (the app's paid rule; the payment sync's fixed ratio) ──
  const agreed = w.agreedPrice ?? 0, paid = w.amountPaid ?? 0, currency = w.currency ?? "$";
  const paidByWork = agreed > 0 && paid >= agreed && !!w.paymentDate;
  const tx = w.linkedTransactionId ? (c.txs ?? []).find((t) => t.id === w.linkedTransactionId) ?? null : null;
  const txv = tx ? validateTx(tx) : null;
  const moneyConflicts: string[] = [];
  if (w.linkedTransactionId && c.txs && !tx) moneyConflicts.push("the linked expense no longer exists");
  if (tx && tx.type === "expense" && tx.status === "התקבל") moneyConflicts.push("expense status התקבל is income-only — invalid for an engineer expense, never paid");
  if (paidByWork && c.txs && !tx) moneyConflicts.push("the work is paid but no expense is linked");
  if (paidByWork && txv && !txv.received) moneyConflicts.push(`the work is paid but its expense is ${tx!.status}`);
  if (!paidByWork && txv?.received) moneyConflicts.push("the expense is שולם but the work is not paid");
  const ratioExpected = txv && txv.currency !== currency && currency === "$" && txv.currency === "₪" ? Math.round(agreed * APP_PAYMENT_RATIO * 100) / 100 : null;
  if (ratioExpected !== null && txv && Math.abs(txv.amount - ratioExpected) > 0.01) moneyConflicts.push(`recorded ₪${txv.amount} ≠ the app's fixed-ratio amount ₪${ratioExpected}`);
  const scopeGeneral = !!tx && tx.expenseScope === "כללי";

  const release = w.projectId ? (c.st?.domains.releasesFull.data?.items ?? []).find((r) => r.projectId === w.projectId) ?? null : null;
  const victor = w.projectId ? (c.det?.victor?.rows ?? []).filter((v) => v.projectId === w.projectId).map((v) => ({ status: v.status ?? null, title: v.title ?? null })) : [];
  const tasks = w.projectId ? (c.det?.tasks?.rows ?? []).filter((t) => t.relatedId === w.projectId && /^מעקב מיקס/.test(t.title ?? "")).map((t) => ({ title: t.title, status: t.status, due: t.dueDate, relation: "TEXT_MATCH (project + title prefix)" })) : [];
  const deadlinePassed = !closed && !!w.internalDeadline && w.internalDeadline < c.today;
  const openComments = comments.filter((x) => x.status !== "resolved");
  const openOnLatest = latest ? latest.comments.open : 0;
  return {
    key: `mix-work:${w.id}`, id: w.id, title: (w.workTitle ?? "").trim() || p?.name || "(ללא שם)", engineer: w.engineerName ?? "—", isSteven,
    engineerIdentity: isSteven ? "Steven (login + portal; exact name)" : "free-text engineer name (TEXT_MATCH — no engineer record)",
    workType: w.workType ?? "מיקס", status, stevenUiStatus: isSteven ? (status === "אושר" ? "הושלם" : status === "בוטל" ? "בוטל" : status === "לא נשלח" && versions.length === 0 ? "לא התחיל" : "פעיל") : null,
    sentDate: w.sentDate ?? null, createdAt: w.createdAt, updatedAt: w.updatedAt,
    project: w.projectId ? { key: `project:${w.projectId}`, name: p?.name ?? null, status: p?.status ?? null, type: null as string | null, businessType: p?.businessType ?? null, exists: !!p, link: "CANONICAL (stored project id)" } : null,
    artistText: p?.artistText ?? null, labelWork: op?.label.labelWork ?? null,
    clientDeadline: op ? { date: op.clientDeadline.date, class: op.clientDeadline.class, meaning: "the CLIENT / project commitment — separate from the engineer's internal deadline" } : null,
    internalDeadline: w.internalDeadline ? { date: w.internalDeadline, passed: deadlinePassed, daysOver: deadlinePassed ? days(w.internalDeadline, c.today) : null, meaning: "the engineer's INTERNAL expectation — not a client commitment; passed = investigate, never blame", debt: deadlinePassed && (days(w.internalDeadline, c.today) ?? 0) > 30 ? "HISTORICAL (recorded old state, not an emergency)" : null } : null,
    handoff: { state, basis, lastUploadAt: lastUpload, lastOwnerCommentAt: lastComment, lastPreMixNoteAt: lastPreMix, notesSent: { activeCycleSince: notes.active, recorded: notes.history, note: "recorded only while a reminder cycle is active or reached a reminder" }, lastOwnerFeedbackAt: lastFeedback,
      daysSinceLastUpload: days(lastUpload, c.today), daysSinceLastFeedback: days(lastFeedback, c.today), sentEvidence: { mixReadyPush: isSteven ? (mixReadyMarker ? "SENT (marker)" : c.settings ? "NONE_RECORDED" : "UNKNOWN") : "n/a (Steven only)", sendLog },
      caveats: ["versions uploaded by the Owner are recorded as the engineer's", "a comment resolve records no who / when", "outside communication (WhatsApp / phone / email) is invisible"] },
    versions: { files: versions.length, rounds: rounds.length, latest: latest ? { label: latest.label, number: latest.number, uploadedAt: latest.uploadedAt, files: latest.files, roles: latest.roles, line: latest.line } : null,
      versionStatusNote: "the version status is never set (בבדיקה) — not an approval", byRound: rounds.map(({ commentItems: _ci, ...r }) => r) },
    comments: { total: comments.length, open: openComments.length, resolved: comments.length - openComments.length, openOnLatestRound: openOnLatest, openOnOlderRounds: openComments.length - openOnLatest,
      latestFeedbackAfterLatestVersion: feedbackAfterUpload, attachments: rounds.reduce((n, r) => n + r.attachments.total, 0), note: "a newer version does not resolve comments; resolved = marked done (no who / when)" },
    rounds, riddim: lines.length ? { lines: lines.map((t) => ({ kind: t.kind, name: t.displayName, removed: !!t.removedAt })), preMixNotes: preMix.length, openPreMixNotes: preMix.filter((n) => n.status !== "resolved").length } : null,
    finalFiles: { own: ownFinals.length, project: projectFinals.length, latestAt: maxIso(projectFinals.map((f) => f.createdAt)), types: [...new Set(projectFinals.map((f) => f.fileType ?? "—"))],
      requested: flags.finalFilesRequested.has(w.id), satisfiedAfterRequest: flags.finalFilesRequested.has(w.id) ? flags.hasCurrentFinalFiles.has(w.id) : null, note: "per project; no mix / master type recorded; not the client delivery" },
    completion: { completed: status === COMPLETED_STATUS, approvalRecord: "NOT_RECORDED (no approval concept — אושר is the completed status)", finalFilesEvidence: projectFinals.length > 0, paid: paidByWork, note: "completed, approved, final files and paid are four separate facts" },
    money: { agreed, currency, amountPaid: paid, balance: Math.max(0, agreed - paid), paymentDate: w.paymentDate ?? null, paid: paidByWork, priceRecorded: agreed > 0,
      payStatus: agreed <= 0 ? "NO_PRICE" : paidByWork ? "שולם" : paid > 0 ? "חלקי" : "לא שולם",
      expense: tx ? { status: tx.status, amount: txv?.amount ?? null, currency: txv?.currency ?? tx.currency, date: tx.date, category: tx.category, expenseScope: tx.expenseScope, validPaid: !!txv?.received, shape: txv && txv.currency !== currency ? `payment-sync shape (${currency} → ${txv.currency} at the app's fixed ${APP_PAYMENT_RATIO})` : "price-sync shape (work currency)" } : null,
      expenseLink: w.linkedTransactionId ? (tx ? "LINKED" : c.txs ? "DANGLING" : "UNKNOWN") : "NONE", conflicts: moneyConflicts, expenseScopeGeneral: scopeGeneral,
      note: "never add $ and ₪; the app records Steven's payment in ₪ by a hard-coded working ratio (not Owner policy)" },
    release: release ? { stage: release.stage, target: release.targetYmd, releasedAt: release.releasedAt ?? null, note: "context only — no mix-readiness policy exists" } : null,
    victor, tasks, notesOwnerInternal: w.notes, hasFilesLink: w.hasFilesLink,
  };
}
export type MixWork = ReturnType<typeof buildMixWork>;

export function buildMixView(src: GatewaySources) {
  const c = ctxOf(src);
  const worksRaw = c.det?.engineerWork?.rows ?? [];
  const works = worksRaw.map((w) => buildMixWork(src, w)).sort((a, b) => Number(!isClosedStatus(b.status)) - Number(!isClosedStatus(a.status)) || (a.internalDeadline?.date ?? "9999").localeCompare(b.internalDeadline?.date ?? "9999"));
  const open = works.filter((w) => !isClosedStatus(w.status));
  const idx = c.st?.domains.projects.data?.index ?? {};
  const workProjects = new Set(worksRaw.map((w) => w.projectId).filter(Boolean));
  const mixStageNoEngineer = Object.entries(idx).filter(([id, p]) => MIX_STAGE.has(p.status) && !workProjects.has(id)).map(([id, p]) => ({ key: `project:${id}`, name: p.name, status: p.status }));
  const victorDoneNoMix = (c.det?.victor?.rows ?? []).filter((v) => v.status === "הושלם" && v.projectId && !workProjects.has(v.projectId)).map((v) => ({ key: `project:${v.projectId}`, name: idx[v.projectId!]?.name ?? null, projectStatus: idx[v.projectId!]?.status ?? null }));
  const linkedTx = new Set(worksRaw.map((w) => w.linkedTransactionId).filter(Boolean));
  const orphanExpenses = (c.txs ?? []).filter((t) => t.type === "expense" && t.category === INTENDED_SCOPE && !linkedTx.has(t.id)).map((t) => ({ id: t.id, status: t.status, amount: validateTx(t)?.amount ?? null, currency: t.currency, date: t.date, project: t.projectId ? `project:${t.projectId}` : null }));
  const signals: MixSignal[] = [];
  const questions: MixQuestion[] = [];
  for (const w of works) {
    const S = (code: string, kind: MixSignal["kind"], he: string) => signals.push({ code, kind, he, work: w.key, project: w.project?.key });
    if (!isClosedStatus(w.status)) {
      if (w.handoff.state === "WAITING_ON_ENGINEER") S("WAITING_ON_ENGINEER", "DERIVED_SIGNAL", `${w.title} (${w.engineer}): ${w.handoff.basis}`);
      if (w.handoff.state === "WAITING_ON_OWNER") { S("WAITING_ON_OWNER", "DERIVED_SIGNAL", `${w.title} (${w.engineer}): ${w.handoff.basis}`); if ((w.handoff.daysSinceLastUpload ?? 0) > 7) questions.push({ kind: "OUTSIDE_COMMUNICATION", questionHe: `"${w.title}" — ${w.engineer} העלה לפני ${w.handoff.daysSinceLastUpload} ימים ואין פידבק במערכת מאז. נתת פידבק מחוץ למערכת?`, why: "in-app evidence only", work: w.key }); }
      if (w.handoff.state === "UNKNOWN") S("HANDOFF_UNKNOWN", "UNKNOWN", `${w.title}: ${w.handoff.basis}`);
      if (w.handoff.state === "CONFLICTING_EVIDENCE") { S("HANDOFF_CONFLICT", "DERIVED_SIGNAL", `${w.title}: ${w.handoff.basis}`); questions.push({ kind: "HANDOFF", questionHe: `"${w.title}" — אצל מי המיקס באמת עכשיו?`, why: "status / reminder and upload / feedback evidence disagree", work: w.key }); }
      if (w.internalDeadline?.passed) S("INTERNAL_DEADLINE_PASSED", "DERIVED_SIGNAL", `${w.title}: הדדליין הפנימי (${w.internalDeadline.date}) עבר${w.handoff.state === "WAITING_ON_OWNER" ? " — אבל הגרסה האחרונה מחכה לך" : ""} — ציפייה פנימית, לא התחייבות ללקוח; לבדוק, לא להאשים.`);
      if (w.comments.open) S("OPEN_COMMENTS", "CANONICAL_FACT", `${w.title}: ${w.comments.open} הערות פתוחות (${w.comments.openOnLatestRound} על הגרסה האחרונה, ${w.comments.openOnOlderRounds} על גרסאות קודמות)`);
      if (w.release) S("RELEASE_CONTEXT", "CANONICAL_FACT", `${w.title}: ריליס בשלב ${w.release.stage}${w.release.target ? `, יעד ${w.release.target}` : ""} — הקשר בלבד`);
    } else if (w.status === COMPLETED_STATUS) {
      if (w.comments.open) S("COMPLETED_OPEN_COMMENTS", "CANONICAL_FACT", `${w.title}: הושלם אבל ${w.comments.open} הערות עדיין פתוחות`);
      if (!w.finalFiles.project) S("COMPLETED_NO_FINAL_FILES", "CANONICAL_FACT", `${w.title}: הושלם ואין קבצים סופיים ${w.project ? "לפרויקט" : "לעבודה"}${w.versions.files ? "" : " (וגם אין גרסת מיקס)"}`);
      if (w.finalFiles.requested && w.finalFiles.satisfiedAfterRequest === false) S("FINAL_FILES_REQUEST_OPEN", "CANONICAL_FACT", `${w.title}: התבקשו קבצים סופיים ולא הועלה קובץ אחרי הבקשה`);
      if (w.money.priceRecorded && !w.money.paid) S("COMPLETED_UNPAID", "CANONICAL_FACT", `${w.title}: הושלם, ${w.money.currency}${w.money.agreed} — לא סומן כשולם`);
    }
    if (w.money.conflicts.length) S("PAYMENT_FINANCE_CONFLICT", "DERIVED_SIGNAL", `${w.title}: ${w.money.conflicts.join("; ")}`);
    if (w.money.expenseScopeGeneral) S("EXPENSE_SCOPE_GENERAL", "CANONICAL_FACT", `${w.title}: הוצאת המיקס נרשמה בהיקף 'כללי' (המיועד: מיקס / מאסטר)`);
  }
  for (const p of mixStageNoEngineer) signals.push({ code: "MIX_STAGE_NO_ENGINEER", kind: "CANONICAL_FACT", he: `${p.name}: בסטטוס ${p.status} ואין עבודת מיקס / איש סאונד`, project: p.key });
  for (const v of victorDoneNoMix) signals.push({ code: "PRODUCTION_DONE_NO_MIX", kind: "DERIVED_SIGNAL", he: `${v.name ?? "פרויקט"}: ההפקה אצל ויקטור הושלמה ואין עבודת מיקס — מעבר למיקס לא רשום`, project: v.key });
  for (const t of orphanExpenses) signals.push({ code: "ORPHAN_MIX_EXPENSE", kind: "CANONICAL_FACT", he: `הוצאת מיקס ${t.currency ?? ""}${t.amount ?? "?"} (${t.status ?? "—"}) לא מקושרת לשום עבודה`, project: t.project ?? undefined });
  const unpaidDone = works.filter((w) => w.status === COMPLETED_STATUS && w.money.priceRecorded && !w.money.paid);
  if (unpaidDone.length) questions.push({ kind: "PAYMENT", questionHe: `${unpaidDone.length} עבודות מיקס שהושלמו לא סומנו כשולמו (${unpaidDone.map((w) => `${w.title} ${w.money.currency}${w.money.agreed}`).join(", ")}) — שולמו מחוץ למערכת?`, why: "completed + priced + not paid; no expense recorded" });
  if (orphanExpenses.length) questions.push({ kind: "FINANCE", questionHe: `${orphanExpenses.length} הוצאות מיקס לא מקושרות לשום עבודה — לשייך או שהן שאריות?`, why: "never fuzzy-linked by Sunny" });
  const presence = famRows(c, "PORTAL_PRESENCE");
  const visit = presence.find((r) => r.key === "steven_visit_last")?.value as { at?: string } | undefined;
  const login = presence.find((r) => r.key === "steven_login_seen")?.value as { at?: string } | undefined;
  const digests = famRows(c, "STEVEN_DEADLINE_DIGEST_SENT").map((r) => r.key.split(":")[1]).filter(Boolean).sort();
  const byEngineer: Record<string, number> = {};
  for (const w of works) byEngineer[w.engineer] = (byEngineer[w.engineer] ?? 0) + 1;
  const paidByCurrency: Record<string, number> = {};
  const owedByCurrency: Record<string, number> = {};
  for (const w of works) {
    if (w.money.paid) paidByCurrency[w.money.currency] = (paidByCurrency[w.money.currency] ?? 0) + w.money.agreed;
    else if (w.money.priceRecorded && w.status !== "בוטל") owedByCurrency[w.money.currency] = (owedByCurrency[w.money.currency] ?? 0) + w.money.balance;
  }
  const steven = works.filter((w) => w.isSteven);
  return {
    counts: { works: works.length, byEngineer, open: open.length, notStarted: open.filter((w) => w.stevenUiStatus === "לא התחיל").length, completed: works.filter((w) => w.status === COMPLETED_STATUS).length, cancelled: works.filter((w) => w.status === "בוטל").length,
      waitingOnEngineer: open.filter((w) => w.handoff.state === "WAITING_ON_ENGINEER").length, waitingOnOwner: open.filter((w) => w.handoff.state === "WAITING_ON_OWNER").length, unknown: open.filter((w) => w.handoff.state === "UNKNOWN").length, conflicting: open.filter((w) => w.handoff.state === "CONFLICTING_EVIDENCE").length,
      internalDeadlinesPassed: open.filter((w) => w.internalDeadline?.passed).length, openComments: works.reduce((n, w) => n + w.comments.open, 0), completedWithOpenComments: works.filter((w) => w.status === COMPLETED_STATUS && w.comments.open).length,
      completedWithoutFinalFiles: works.filter((w) => w.status === COMPLETED_STATUS && !w.finalFiles.project).length, completedUnpaid: unpaidDone.length, mixStageWithoutEngineer: mixStageNoEngineer.length,
      note: "recorded counts — no capacity limit, no ranking, no performance score" },
    money: { paidByCurrency, owedByCurrency, orphanExpenses, rule: "paid = agreed > 0 AND paid ≥ agreed AND a payment date (the app's rule); currencies never added", ratio: `the payment sync records $ × ${APP_PAYMENT_RATIO} in ₪ (hard-coded working value, not Owner policy)`, paypal: "the ×1.05 PayPal gross is a note only; no fee policy is stored" },
    steven: { works: steven.length, open: steven.filter((w) => !isClosedStatus(w.status)).length, presence: { lastVisit: visit?.at ?? null, lastLoginSeen: login?.at ?? null, state: visit || login ? "RECORDED" : c.settings ? "NONE_RECORDED" : "UNKNOWN", meaning: "portal activity only — not work done, not a mix heard, not a comment handled" }, digestsSent: { count: digests.length, last: digests.at(-1) ?? null } },
    works, mixStageNoEngineer, victorDoneNoMix, signals, questions,
    unavailable: [...(c.det ? [] : ["PROJECT_DETAIL (engineer works, versions, comments, final files) was not read — unknown, not none"]), ...(c.settings ? [] : ["SETTINGS (notes-sent cycles, markers, presence)"]), ...(c.txs ? [] : ["FINANCE (expenses)"]), "storage itself is not listed — a missing file record ≠ a missing file"],
  };
}
export type MixView = ReturnType<typeof buildMixView>;
