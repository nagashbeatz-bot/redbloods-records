/**
 * Sunny — the CONNECTED VICTOR VIEW (+ one work) + money reconciliation. Pure, read-only.
 *
 * Victor work = the vendor work records (all of them — with or without a project). Each work is joined to its project
 * (canonical id), the project's artist / client / label classification (through the project + operating model), its
 * release and engineer work, its send-log entries, its deadline task. The ball holder uses the APP'S OWN rule
 * (computeVictorBall), then Sunny adds what the rule cannot see: the send log, completion, Owner knowledge and the
 * outside-communication caveat. Money reconciles the salary view (the app's own month resolution) against the
 * canonical finance rows, the overrides and the legacy keys — conflicts shown, never merged, currencies never mixed.
 * No workload score, no capacity limit, no performance judgement.
 */
import type { GatewaySources } from "../gateway/core";
import type { PartnerCompanyState } from "../eyes/types";
import type { OperationsRaw } from "../operations/types";
import type { ProjectDetailRaw, DetailVictorWork } from "../projects/detail-types";
import type { SettingsState } from "../settings/types";
import type { OwnerKnowledgeRecord } from "../owner-knowledge/store";
import { validateTx } from "../finance/core";
import { projectOperating } from "../sunny/operating";
import { computeVictorBall } from "../../coo/victor-ball";
import { COO_CONFIG } from "../../coo/config";

const ok = <T,>(a: { status: string; value?: T } | undefined): T | null => (a && a.status === "OK" ? (a as { value: T }).value : null);
const ilToday = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const days = (a: string | null | undefined, b: string) => (a ? Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a.slice(0, 10)}T12:00:00Z`)) / 86_400_000) : null);
const CLOSED_PROJECT = new Set(["הושלם", "בוטל"]);

export interface VictorSignal { code: string; kind: "CANONICAL_FACT" | "DERIVED_SIGNAL" | "UNKNOWN"; he: string; work?: string }
export interface VictorQuestion { questionHe: string; why: string; kind: string; work?: string }

interface Ctx { st: PartnerCompanyState | null; ops: OperationsRaw | null; det: ProjectDetailRaw | null; settings: SettingsState | null; kn: OwnerKnowledgeRecord[]; today: string }
function ctxOf(src: GatewaySources): Ctx {
  const st = ok(src.state) as PartnerCompanyState | null;
  return { st, ops: ok(src.operations) as OperationsRaw | null, det: ok(src.projectDetail) as ProjectDetailRaw | null, settings: ok(src.settings) as SettingsState | null, kn: (ok(src.ownerKnowledge) as OwnerKnowledgeRecord[] | null) ?? [], today: st?.todayIL ?? ilToday(src.now) };
}
const setting = (c: Ctx, family: string, key: string) => c.settings?.families[family]?.rows.find((r) => r.key === key)?.value ?? null;

export function buildWork(src: GatewaySources, w: DetailVictorWork) {
  const c = ctxOf(src);
  const idx = c.st?.domains.projects.data?.index ?? {};
  const p = w.projectId ? idx[w.projectId] ?? null : null;
  const op = w.projectId && p ? projectOperating(src, w.projectId) : null;
  const uploads = w.filesSent.map((f) => f.uploadedAt).filter((x): x is string => !!x);
  const ball = computeVictorBall({ uploads, filesWithoutTimestamp: w.filesSent.filter((f) => !f.uploadedAt).length, reviews: w.reviews.map((r) => ({ sentAt: r.sentAt, draft: r.draft })) as never }, COO_CONFIG as never);
  const sendLog = (c.det?.actions?.rows ?? []).filter((a) => a.projectId && a.projectId === w.projectId && (a.linkedWorkId === w.id || /ויקטור/.test(a.recipientName ?? "") || a.recipientRole === "external_producer"))
    .map((a) => ({ status: a.status, contentType: a.contentType, date: a.actionDate, followUp: a.followupDate, linkedToThisWork: a.linkedWorkId === w.id }));
  const open = w.status === "פעיל";
  const versions = [...new Set(w.filesSent.map((f) => f.versionLabel ?? "ללא גרסה"))];
  const latestUpload = uploads.sort().pop() ?? null;
  const lastNotes = w.reviews.map((r) => r.sentAt).filter((x): x is string => !!x).sort().pop() ?? null;
  const drafts = w.reviews.filter((r) => r.draft && r.notes);
  const holderRule = ball.ball.holder;
  const sendLogHolder = sendLog.find((s) => s.status === "pending_version") ? "VICTOR" : sendLog.find((s) => s.status === "got_notes") ? "OWNER" : null;
  const state = !open ? (w.status === "הושלם" ? "COMPLETED" : "CANCELLED")
    : holderRule === "unknown" ? "UNKNOWN"
    : sendLogHolder && sendLogHolder !== holderRule.toUpperCase() ? "CONFLICTING_EVIDENCE"
    : holderRule === "victor" ? "WAITING_ON_VICTOR" : "WAITING_ON_OWNER";
  const deadlinePassed = open && !!w.internalDeadline && w.internalDeadline < c.today;
  const engineers = (c.ops?.engineerWork?.rows ?? []).filter((e) => e.projectId && e.projectId === w.projectId).map((e) => ({ engineer: e.engineerName, status: e.status }));
  const release = w.projectId ? (c.st?.domains.releasesFull.data?.items ?? []).find((r) => r.projectId === w.projectId) ?? null : null;
  const task = w.linkedTaskId ? (c.det?.tasks?.rows ?? []).find((t) => t.id === w.linkedTaskId) ?? null : null;
  const completedMarker = setting(c, "PUSH_SENT_ONCE_MARKERS", `victor_work_completed_pushed_${w.id}`);
  return {
    key: `victor-work:${w.id}`, id: w.id, title: w.title ?? p?.name ?? "(ללא שם)", status: w.status, workState: w.workState, workStateNote: "display-only — never updated after the send", sentDate: w.sentDate, daysSinceSent: days(w.sentDate, c.today), returnedDate: w.returnedDate,
    project: w.projectId ? { key: `project:${w.projectId}`, name: p?.name ?? null, status: p?.status ?? null, businessType: p?.businessType ?? null, exists: !!p, link: "CANONICAL (stored project id)" } : null,
    artistText: p?.artistText ?? null, labelWork: op?.label.labelWork ?? null, clientDeadline: op ? { date: op.clientDeadline.date, class: op.clientDeadline.class, meaning: "the CLIENT / project commitment — separate from Victor's internal deadline" } : null,
    internalDeadline: w.internalDeadline ? { date: w.internalDeadline, passed: deadlinePassed, meaning: "Victor's INTERNAL expectation — not a client commitment; passed = investigate, not blame", task: task ? { title: task.title, status: task.status, due: task.dueDate } : null } : null,
    handoff: { state, appRule: ball.ball, lastUploadAt: ball.lastUploadAt, lastNotesSentAt: ball.lastNotesSentAt, daysSinceLastUpload: days(latestUpload, c.today), daysSinceLastNotes: days(lastNotes, c.today), sendLog, sendLogHolder,
      caveats: ["the Owner's own uploads count as 'uploads' in the app's rule", "outside communication (WhatsApp / phone / in person) is invisible"] },
    files: { entries: w.filesSent.length, versions, latestUpload, byVersion: versions.map((v) => ({ version: v, files: w.filesSent.filter((f) => (f.versionLabel ?? "ללא גרסה") === v).map((f) => ({ name: f.name, uploadedAt: f.uploadedAt, durationSeconds: f.durationSeconds, size: f.size, hasShareLink: f.hasShareLink, path: f.path })) })),
      briefFiles: w.briefFiles.length, receivedEntries: w.filesReceived.length, folder: w.dropboxFolder, hasFolderLink: w.hasFolderLink, storageListing: "NOT_AVAILABLE (capability gap) — stored entries only" },
    feedback: { reviews: w.reviews.map((r) => ({ version: r.version, sentAt: r.sentAt, draft: r.draft, sentNotes: r.sentNotes, draftNotes: r.draft ? r.notes : null, statusField: r.status, statusNote: "always 'waiting' — no UI sets it" })), draftsNotSent: drafts.length },
    brief: { text: w.briefText, references: w.references.length }, notes: w.notes, engineers, release: release ? { stage: release.stage, target: release.targetYmd, releasedAt: release.releasedAt } : null,
    completionPush: completedMarker ? "SENT (marker)" : c.settings ? "NONE_RECORDED" : "UNKNOWN", createdAt: w.createdAt ?? null, updatedAt: w.updatedAt ?? null,
    projectClosedButWorkOpen: open && !!p && CLOSED_PROJECT.has(p.status),
  };
}
export type VictorWork = ReturnType<typeof buildWork>;

/** Salary months: the app's own month resolution vs canonical finance rows vs settings overrides vs legacy keys. */
export function victorMoney(src: GatewaySources) {
  const c = ctxOf(src);
  const fin = ok(src.finance);
  const cfg = (setting(c, "VICTOR_SALARY_SETTINGS", "vendor_victor_settings") ?? null) as Record<string, unknown> | null;
  const amountOv = (setting(c, "VICTOR_SALARY_OVERRIDES", "vendor_victor_salary_overrides") ?? {}) as Record<string, number>;
  const statusOv = (setting(c, "VICTOR_SALARY_OVERRIDES", "vendor_victor_salary_status_overrides") ?? {}) as Record<string, string>;
  const legacyRows = c.settings?.families["VICTOR_LEGACY_MONTH_PAYMENT"]?.rows ?? [];
  const txRows = (fin?.raw.transactions ?? []).filter((t) => (t.linkedSessionId ?? "").startsWith("victor_salary_"));
  const months = new Set<string>([...(fin?.raw.victorSalary ?? []).map((m) => m.workMonth), ...Object.keys(amountOv), ...Object.keys(statusOv), ...txRows.map((t) => (t.linkedSessionId ?? "").slice("victor_salary_".length))]);
  const rows = [...months].filter((m) => /^\d{4}-\d{2}$/.test(m)).sort().map((m) => {
    const view = (fin?.raw.victorSalary ?? []).find((x) => x.workMonth === m) ?? null;
    const tx = txRows.filter((t) => t.linkedSessionId === `victor_salary_${m}`);
    const live = tx.map((t) => ({ t, v: validateTx(t) })).filter((x) => x.v && !x.v.cancelled);
    const legacy = legacyRows.find((r) => r.key === `vendor_victor_payment_${m.replace("-", "_")}`)?.value as { status?: string; paidDate?: string | null } | undefined;
    const financePaid = live.some((x) => x.t.status === "שולם");
    const salaryViewStatus = view?.status ?? null;
    const conflicts: string[] = [];
    if (statusOv[m] === "שולם" && !financePaid) conflicts.push("status override says paid, no paid finance row");
    if (financePaid && statusOv[m] && statusOv[m] !== "שולם") conflicts.push("finance row paid, override says otherwise");
    if (legacy?.status && statusOv[m] && legacy.status !== statusOv[m]) conflicts.push(`legacy key says ${legacy.status}, override says ${statusOv[m]}`);
    if (live.length > 1) conflicts.push("more than one live finance row for the month");
    if (live[0] && view && live[0].v!.amount !== view.amount) conflicts.push(`finance amount ${live[0].v!.amount} ≠ salary view ${view.amount}`);
    if (live[0] && view && live[0].v!.currency !== view.currency) conflicts.push(`currency ${live[0].v!.currency} ≠ ${view.currency}`);
    return { month: m, expected: view ? { amount: view.amount, currency: view.currency, due: view.dueDate } : null, salaryViewStatus,
      canonicalFinance: live.map((x) => ({ status: x.t.status, amount: x.v!.amount, currency: x.v!.currency, date: x.t.date, fullyPaid: x.t.status === "שולם" })),
      amountOverride: amountOv[m] ?? null, statusOverride: statusOv[m] ?? null, legacyKey: legacy ? { status: legacy.status ?? null, paidDate: legacy.paidDate ?? null } : null,
      proof: financePaid ? "PAID_IN_FINANCE (canonical)" : statusOv[m] === "שולם" ? "OWNER_STATEMENT_ONLY (override, no finance row)" : live.length ? "FINANCE_ROW_NOT_PAID" : "NO_EVIDENCE", conflicts };
  });
  const byCurrency: Record<string, number> = {};
  for (const r of rows) for (const f of r.canonicalFinance.filter((x) => x.fullyPaid)) byCurrency[f.currency] = Math.round(((byCurrency[f.currency] ?? 0) + f.amount) * 100) / 100;
  return {
    model: "monthly salary (retainer), due the 10th of the next month; amount = override, else the settings salary",
    settings: cfg ? { monthlySalary: cfg.monthlySalary ?? null, currency: cfg.salaryCurrency ?? null, monthlyGoal: cfg.monthlyGoal ?? null, paceMetric: cfg.paceMetric ?? null, stuckAfterDays: cfg.stuckAfterDays ?? null, salaryPayDay: cfg.salaryPayDay ?? null, payDayNote: "ignored by the app (due = the 10th)" } : null,
    goalNote: "the monthly goal counts works for KPIs / below-pace alerts — no code ties it to pay; whether '$550 for 12 projects' is still the arrangement is an Owner question",
    paidRule: "fully paid only when the finance row is שולם (התקבל / חלקי are not paid); currencies never added",
    months: rows, paidInFinanceByCurrency: byCurrency, unavailable: [...(fin ? [] : ["FINANCE"]), ...(c.settings ? [] : ["SETTINGS"])],
  };
}

export function buildVictorView(src: GatewaySources) {
  const c = ctxOf(src);
  const worksRaw = (c.det?.victor?.rows ?? []).filter((w) => !w.vendorName || w.vendorName === "victor");
  const works = worksRaw.map((w) => buildWork(src, w)).sort((a, b) => Number(b.status === "פעיל") - Number(a.status === "פעיל") || (b.sentDate ?? "").localeCompare(a.sentDate ?? ""));
  const presence = setting(c, "PORTAL_PRESENCE", "victor_visit_last") as { at?: string } | null;
  const money = victorMoney(src);
  const kn = c.kn.filter((k) => /^vendor:/.test(k.subjectKey) || k.identityKeys.some((x) => /vendor:VICTOR/i.test(x)) || k.kind === "VENDOR_COMMITMENT").map((k) => ({ kind: k.kind, meaning: k.meaningHe, subject: k.subjectKey }));
  const open = works.filter((w) => w.status === "פעיל");
  const signals: VictorSignal[] = [];
  const questions: VictorQuestion[] = [];
  for (const w of open) {
    if (w.handoff.state === "WAITING_ON_VICTOR") signals.push({ code: "WAITING_ON_VICTOR", kind: "DERIVED_SIGNAL", he: `${w.title}: נשלחו הערות אחרי ההעלאה האחרונה`, work: w.key });
    if (w.handoff.state === "WAITING_ON_OWNER") { signals.push({ code: "WAITING_ON_OWNER", kind: "DERIVED_SIGNAL", he: `${w.title}: ויקטור העלה אחרי ההערות האחרונות (לפי המערכת)`, work: w.key }); if ((w.handoff.daysSinceLastUpload ?? 0) > 7) questions.push({ kind: "OUTSIDE_COMMUNICATION", questionHe: `"${w.title}" — ויקטור העלה לפני ${w.handoff.daysSinceLastUpload} ימים ולא נשלחו הערות במערכת. טופל מחוץ למערכת?`, why: "in-app evidence only", work: w.key }); }
    if (w.handoff.state === "UNKNOWN") signals.push({ code: "HANDOFF_UNKNOWN", kind: "UNKNOWN", he: `${w.title}: ${w.handoff.appRule.basis}`, work: w.key });
    if (w.handoff.state === "CONFLICTING_EVIDENCE") { signals.push({ code: "HANDOFF_CONFLICT", kind: "DERIVED_SIGNAL", he: `${w.title}: יומן השליחה (${w.handoff.sendLogHolder}) לא תואם להעלאות / הערות (${w.handoff.appRule.holder})`, work: w.key }); questions.push({ kind: "HANDOFF", questionHe: `"${w.title}" — אצל מי זה באמת עכשיו?`, why: "send log and upload / notes evidence disagree", work: w.key }); }
    if (w.internalDeadline?.passed) signals.push({ code: "INTERNAL_DEADLINE_PASSED", kind: "DERIVED_SIGNAL", he: `${w.title}: הדדליין הפנימי (${w.internalDeadline.date}) עבר — ציפייה פנימית, לא התחייבות ללקוח; לבדוק את המצב, לא להאשים.`, work: w.key });
    if (!w.project) signals.push({ code: "NO_PROJECT_LINK", kind: "CANONICAL_FACT", he: `${w.title}: עבודה בלי פרויקט — אין הקשר אמן / לקוח`, work: w.key });
    if (w.files.entries === 0) signals.push({ code: "NO_FILE_ENTRIES", kind: "CANONICAL_FACT", he: `${w.title}: אין רישום קבצים (האחסון עצמו לא נקרא)`, work: w.key });
    if (w.feedback.draftsNotSent) signals.push({ code: "DRAFT_NOTES_NOT_SENT", kind: "CANONICAL_FACT", he: `${w.title}: ${w.feedback.draftsNotSent} טיוטות הערות שלא נשלחו`, work: w.key });
    if (w.projectClosedButWorkOpen) signals.push({ code: "OPEN_PROJECT_CLOSED", kind: "DERIVED_SIGNAL", he: `${w.title}: הפרויקט ${w.project?.status} אבל העבודה אצל ויקטור פתוחה`, work: w.key });
    if (w.labelWork) signals.push({ code: "LABEL_WORK", kind: "CANONICAL_FACT", he: `${w.title}: עבודת לייבל`, work: w.key });
    if (w.release) signals.push({ code: "RELEASE_CONTEXT", kind: "CANONICAL_FACT", he: `${w.title}: ריליס בשלב ${w.release.stage}${w.release.target ? `, יעד ${w.release.target}` : ""}`, work: w.key });
  }
  for (const w of works.filter((x) => x.status === "הושלם" && x.project && !x.engineers.length && !CLOSED_PROJECT.has(x.project.status ?? ""))) signals.push({ code: "COMPLETED_NO_MIX_EVIDENCE", kind: "DERIVED_SIGNAL", he: `${w.title}: הושלם אצל ויקטור, אין עבודת מיקס רשומה בפרויקט`, work: w.key });
  for (const m of money.months.filter((x) => x.conflicts.length)) questions.push({ kind: "PAYMENT", questionHe: `משכורת ויקטור ${m.month}: ${m.conflicts.join("; ")} — מה נכון?`, why: "salary sources disagree; Finance is the canonical money record" });
  return {
    identity: { key: "vendor:VICTOR", role: "external producer (login role victor)", portal: "his own page (works, versions, notes)", hardcoded: ["role by account email", "stuck days 5 in cron / agent", "salary due the 10th"] },
    counts: { works: works.length, open: open.length, completed: works.filter((w) => w.status === "הושלם").length, cancelled: works.filter((w) => w.status === "בוטל").length, withoutProject: works.filter((w) => !w.project).length,
      waitingOnVictor: open.filter((w) => w.handoff.state === "WAITING_ON_VICTOR").length, waitingOnOwner: open.filter((w) => w.handoff.state === "WAITING_ON_OWNER").length, unknown: open.filter((w) => w.handoff.state === "UNKNOWN").length, conflicting: open.filter((w) => w.handoff.state === "CONFLICTING_EVIDENCE").length,
      internalDeadlinesPassed: open.filter((w) => w.internalDeadline?.passed).length, labelWork: open.filter((w) => w.labelWork).length, clientWork: open.filter((w) => w.labelWork === false).length, note: "recorded counts — no capacity limit, no workload score" },
    works, money, presence: { lastPortalVisit: presence?.at ?? null, state: presence ? "RECORDED" : c.settings ? "NONE_RECORDED" : "UNKNOWN", meaning: "portal activity evidence only — not work done, not 'saw a message'" },
    ownerKnowledge: kn, signals, questions,
    unavailable: [...(c.det ? [] : ["PROJECT_DETAIL (Victor works) was not read — works unknown, not none"]), ...(c.settings ? [] : ["SETTINGS (salary settings, presence, markers)"]), ...money.unavailable.map((u) => `${u} (money)`)],
  };
}
export type VictorView = ReturnType<typeof buildVictorView>;
