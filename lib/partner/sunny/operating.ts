/**
 * Sunny — the OWNER OPERATING MODEL applied (pure, read-only). Deterministic reasoning over the sources the Gateway
 * already loads; every output carries its evidence and epistemic class. Nothing here scores, ranks, mutates or
 * guesses: where evidence is insufficient the output is UNKNOWN + a question for the Owner.
 */
import type { GatewaySources } from "../gateway/core";
import type { PartnerCompanyState } from "../eyes/types";
import type { OperationsRaw } from "../operations/types";
import { activeKnowledge, type OwnerKnowledgeRecord } from "../owner-knowledge/store";
import type { CompanyIntegrityRegister } from "../integrity/types";
import type { SettingsState } from "../settings/types";
import type { CalendarWindowResult } from "../calendar/types";
import { financeExceptionOf, validateTx } from "../finance/core";
import { buildProjectView } from "../projects/view";
import { isLabelProject } from "../../project-classification";
import { engineerHandoff } from "../mix/handoff";
import { availability, dayList } from "../calendar/availability";
import { isProjectOverdue, isStrictYmd } from "../../project-deadline";
import { sendEntryCurrent, evidenceFor } from "../work/send-log";
import { HISTORICAL_DEBT_CUTOFF, QUESTION_TYPE_TO_MISSING_CONCEPT, WORKFLOW_MODELS } from "../system/owner-model";
import type { LabelDetailRaw } from "../label/detail-types";
import { computeShowNotifyFingerprint, showNotifyStateOf, type ShowNotifyClaimValue } from "../../show-notify-pure";

const ok = <T,>(a: { status: string; value?: T } | undefined): T | null => (a && a.status === "OK" ? (a as { value: T }).value : null);
const ilToday = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
const norm = (t: string) => t.normalize("NFKC").trim().toLowerCase();
const tokens = (t: string | null | undefined) => (t ?? "").split(/[,،;]/).map((x) => norm(x)).filter(Boolean);
const CLOSED = new Set(["הושלם", "בוטל"]);
const PROGRESSED = new Set(["מחכה למיקס", "במיקס", "הושלם"]);

/** ON_HOLD (B5, Owner): a בהשהייה project is never overdue — its passed deadline is not a failure / debt. HIDDEN: a hidden project is never overdue (not assessed). UNPARSEABLE_DEADLINE: the stored text is not YYYY-MM-DD. */
export type ClientDeadlineClass = "NO_DEADLINE" | "UPCOMING" | "APPROACHING" | "AT_RISK" | "PASSED_NEW_FAILURE" | "HISTORICAL_OPERATIONAL_DEBT" | "CLOSED" | "ON_HOLD" | "HIDDEN" | "UNPARSEABLE_DEADLINE";
export interface BallEvidence { holder: string; basis: string; confidence: "RECORDED" | "IN_APP_TIMESTAMPS" | "OWNER_REPORTED" | "UNKNOWN"; outsideCommunicationPossible: boolean }
export interface OwnerQuestion { questionHe: string; why: string; kind: "PROJECT_STATE" | "OUTSIDE_COMMUNICATION" | "PAYMENT_EVIDENCE" | "DEADLINE_REALITY" | "MISSING_DETAIL" }

/** Label artists the Owner classified (integrity: LABEL_SONGS) + roster names — for label protection. */
function labelContext(st: PartnerCompanyState | null, integrity: CompanyIntegrityRegister | null) {
  const roster = (st?.domains.labelArtists.data?.items ?? []).map((a) => ({ key: `label-artist:${a.id}`, name: norm(a.name) }));
  const ownerLabel = new Set((integrity?.learned ?? []).filter((l) => l.status === "APPLIES" && l.decision.answerCode === "LABEL_SONGS").map((l) => l.entityKey));
  return { roster, ownerLabel };
}

export function projectOperating(src: GatewaySources, projectId: string) {
  const st = ok(src.state) as PartnerCompanyState | null;
  const ops = ok(src.operations) as OperationsRaw | null;
  const fin = ok(src.finance);
  const kn = activeKnowledge((ok(src.ownerKnowledge) as OwnerKnowledgeRecord[] | null) ?? [], st?.todayIL ?? ilToday(src.now));
  const integrity = ok(src.integrity) as CompanyIntegrityRegister | null;
  const cal = ok(src.calendar) as CalendarWindowResult | null;
  const today = st?.todayIL ?? ilToday(src.now);
  const v = buildProjectView(src, projectId);
  if (!v.found || !v.identity) return null;
  const id = v.identity;
  const closed = CLOSED.has(id.status ?? "");
  const artists = tokens(id.artistText);
  const { roster, ownerLabel } = labelContext(st, integrity);
  const rosterHits = roster.filter((r) => artists.includes(r.name));
  // B2 (Owner canon 2026-09-27): the stored project_business_type is the ONLY classifier. A release row, an Owner
  // LABEL_SONGS answer or a roster-name match are evidence (labelEvidence), never a second classifier.
  const labelWork = isLabelProject(id);
  const labelEvidence = { classifier: "STORED_BUSINESS_TYPE" as const, releaseRow: !!v.work.release, ownerLabelSongsAnswer: rosterHits.some((r) => ownerLabel.has(r.key)), rosterNameMatch: rosterHits.length > 0, ownerRuleMismatch: v.signals.some((s) => s.code === "MISMATCH_OWNER_RULE") };
  const labelArtistInvolved = rosterHits.length > 0;

  // ── ball holder (evidence, never certainty) ──
  const ball: BallEvidence[] = [];
  // Engineer works: THE mix handoff evidence rule (lib/partner/mix/handoff — the same answer as mix_view), never the
  // engineer status alone (a חזר status with newer Owner feedback is CONFLICTING evidence, not "the Owner holds it").
  for (const w of ops?.engineerWork?.rows.filter((x) => x.projectId === projectId && !["אושר", "בוטל"].includes(x.status ?? "")) ?? []) {
    const h = engineerHandoff(src, { id: w.id, projectId: w.projectId, engineerName: w.engineerName, status: w.status, sentDate: w.sentDate });
    const conf: BallEvidence["confidence"] = h.timestampEvidence ? "IN_APP_TIMESTAMPS" : h.state === "UNKNOWN" || h.state === "CONFLICTING_EVIDENCE" ? "UNKNOWN" : "RECORDED";
    if (!h.detailRead) { ball.push({ holder: "UNKNOWN", basis: `${w.engineerName}: engineer status ${w.status} — the mix evidence (versions / feedback) was not read, and a status alone is not the ball`, confidence: "UNKNOWN", outsideCommunicationPossible: true }); continue; }
    ball.push(h.state === "WAITING_ON_OWNER" ? { holder: "OWNER", basis: `${w.engineerName}: ${h.basis}`, confidence: conf, outsideCommunicationPossible: true }
      : h.state === "WAITING_ON_ENGINEER" ? { holder: `ENGINEER:${w.engineerName}`, basis: `${w.engineerName}: ${h.basis}`, confidence: conf, outsideCommunicationPossible: true }
      : { holder: "UNKNOWN", basis: `${w.engineerName}: ${h.basis}${h.detailRead ? "" : " (mix evidence not read)"}`, confidence: "UNKNOWN", outsideCommunicationPossible: true });
  }
  for (const w of st?.domains.victor.data?.active.filter((x) => x.projectId === projectId) ?? [])
    ball.push({ holder: w.ball.holder === "owner" ? "OWNER" : w.ball.holder === "victor" ? "VICTOR" : "UNKNOWN", basis: "Victor uploads vs the Owner's recorded responses (in-app timestamps)", confidence: "IN_APP_TIMESTAMPS", outsideCommunicationPossible: true });
  // B5: a pending send-log entry superseded by LATER in-app evidence (engineer → mix versions of this project's works;
  // external producer → Victor uploads / sent notes) is history — never a ball holder (lib/partner/work/send-log).
  const projEngIds = new Set((ops?.engineerWork?.rows ?? []).filter((x) => x.projectId === projectId).map((x) => x.id));
  const projVictor = st?.domains.victor.data?.active.filter((x) => x.projectId === projectId) ?? [];
  const sendEvidence = { mixVersionCreatedAt: (ops?.mixVersions?.rows ?? []).filter((x) => x.workId && projEngIds.has(x.workId)).map((x) => x.createdAt), victorUploads: projVictor.map((x) => x.lastUploadAt), victorNotesSentAt: projVictor.map((x) => x.lastNotesSentAt) };
  for (const a of ops?.projectActions?.rows.filter((x) => x.projectId === projectId && ["pending_feedback", "pending_version", "got_notes"].includes(x.status ?? "") && (x.status === "got_notes" || sendEntryCurrent(x, evidenceFor(x, sendEvidence)).state !== "SUPERSEDED")) ?? [])
    ball.push(a.status === "got_notes" ? { holder: "OWNER", basis: `send log: notes received (${a.contentType ?? "?"})`, confidence: "RECORDED", outsideCommunicationPossible: true }
      : a.status === "pending_feedback" && a.actionType === "received" ? { holder: "OWNER", basis: `send log: a version was received (${a.contentType ?? "?"}, ${a.actionDate ?? "?"}) — the Owner's feedback is due`, confidence: "RECORDED", outsideCommunicationPossible: true }
      : { holder: (a.recipientRole ?? "UNKNOWN").toUpperCase(), basis: `send log: ${a.status} (${a.contentType ?? "?"}, sent ${a.actionDate ?? "?"})`, confidence: "RECORDED", outsideCommunicationPossible: true });
  for (const k of kn.filter((x) => x.kind === "PROJECT_BLOCKER" && (x.subjectKey === `project:${projectId}` || x.identityKeys.includes(`project:${projectId}`))))
    ball.push({ holder: String((k.value as Record<string, unknown>).reason ?? "UNKNOWN"), basis: "the Owner said so (P2 blocker)", confidence: "OWNER_REPORTED", outsideCommunicationPossible: false });

  // ── internal deadlines (team expectations, distinct from the client commitment) ──
  const internal = [
    ...(ops?.engineerWork?.rows.filter((x) => x.projectId === projectId && x.internalDeadline && !["אושר", "בוטל"].includes(x.status ?? "")) ?? []).map((w) => ({ who: w.engineerName, date: w.internalDeadline!, passed: w.internalDeadline! < today })),
    ...(st?.domains.victor.data?.active.filter((x) => x.projectId === projectId && x.internalDeadline) ?? []).map((w) => ({ who: "Victor", date: w.internalDeadline!, passed: w.internalDeadline! < today })),
  ];

  // ── advance evidence (Owner pattern; never an amount, never a debt) ──
  const incomeRows = fin ? fin.raw.transactions.filter((t) => t.projectId === projectId && t.type === "income").map(validateTx).filter((t): t is NonNullable<ReturnType<typeof validateTx>> => !!t && !t.cancelled) : null;
  const received = incomeRows ? incomeRows.filter((t) => t.received).length : null;
  const expected = incomeRows ? incomeRows.filter((t) => !t.received).length : null;
  const progressed = PROGRESSED.has(id.status ?? "") || (v.work.engineers?.length ?? 0) > 0 || (v.work.sessions?.held ?? 0) > 0;
  // The Owner's finance exception on this project (canonical setting, reason + date) already explains its money —
  // never "was an advance received?" (the same rule the Finance Brain and the app use: lib/finance/project-summary).
  const financeException = fin ? financeExceptionOf(fin.raw.financeSettings.find((s) => s.projectId === projectId)?.value) : null;
  const advance = labelWork ? { state: "NOT_APPLICABLE_LABEL_WORK" as const, evidence: "label work (no client advance pattern)" }
    : financeException ? { state: "NOT_APPLICABLE_FINANCE_EXCEPTION" as const, evidence: `the Owner's finance exception${financeException.date ? ` (${financeException.date})` : ""}${financeException.reason ? `: ${financeException.reason}` : ""}` }
    : received === null ? { state: "UNKNOWN" as const, evidence: "finance not read" }
    : received > 0 ? { state: "ADVANCE_OR_PAYMENT_RECORDED" as const, evidence: `${received} received income row(s)` }
    : progressed ? { state: "ADVANCE_EVIDENCE_MISSING" as const, evidence: `project progressed (${id.status}${v.work.engineers?.length ? ", engineer work" : ""}${v.work.sessions?.held ? `, ${v.work.sessions.held} sessions held` : ""}) and no received income is recorded${expected ? ` (${expected} expected row(s))` : ""}` }
    : { state: "NOT_YET_EXPECTED" as const, evidence: "early stage, nothing received yet" };

  // ── client deadline class ──
  const risks: string[] = [];
  for (const i of internal.filter((x) => x.passed)) risks.push(`${i.who}'s internal deadline (${i.date}) has passed`);
  const external = ball.filter((b) => !["OWNER", "UNKNOWN"].includes(b.holder));
  if (external.length) risks.push(`work is still with ${[...new Set(external.map((b) => b.holder))].join(", ")}`);
  const openComments = (v.work.engineers ?? []).reduce((s, w) => s + w.openComments, 0);
  if (openComments) risks.push(`${openComments} open mix comment(s)`);
  if (advance.state === "ADVANCE_EVIDENCE_MISSING") risks.push("no advance / payment evidence");
  let deadlineClass: ClientDeadlineClass;
  const dl = id.deadline;
  if (closed) deadlineClass = "CLOSED";
  else if (!dl) deadlineClass = "NO_DEADLINE";
  else if (!isStrictYmd(dl)) deadlineClass = "UNPARSEABLE_DEADLINE";
  else if (id.status === "בהשהייה") deadlineClass = "ON_HOLD";
  else if (id.hidden === true) deadlineClass = "HIDDEN";
  // The ONE overdue rule (lib/project-deadline.ts) — same answer as every screen, report and push.
  else if (isProjectOverdue({ deadline: dl, status: id.status, isHidden: id.hidden }, today)) deadlineClass = dl <= HISTORICAL_DEBT_CUTOFF ? "HISTORICAL_OPERATIONAL_DEBT" : "PASSED_NEW_FAILURE";
  else deadlineClass = daysBetween(today, dl) <= 7 ? (risks.length ? "AT_RISK" : "APPROACHING") : "UPCOMING";

  // ── owner occupancy until the deadline (personal time counts; free ≠ work time) ──
  const calUsable = !!cal && (cal.status === "CALENDAR_DATA_AVAILABLE" || cal.status === "CALENDAR_PARTIAL");
  const winEnd = cal ? cal.window.end.slice(0, 10) : today;
  const occupancy = isStrictYmd(dl) && dl >= today && calUsable ? (() => {
    const to = dl < winEnd ? dl : winEnd;
    const av = availability(cal!.events, dayList(today, to), cal!.status);
    return { from: today, to, calendarStatus: cal!.status, occupiedMinutes: av.reduce((s, d) => s + (d.occupiedMinutes ?? 0), 0), personalOrOtherEvents: cal!.events.filter((e) => !e.allDay && e.start.slice(0, 10) >= today && e.start.slice(0, 10) <= to).length, note: "includes personal time; free calendar time is not automatically work time" };
  })() : isStrictYmd(dl) && dl >= today ? { calendarStatus: cal?.status ?? "NOT_LOADED", note: "calendar not readable — availability unknown" } : null;

  // ── questions (only what evidence cannot answer) ──
  const questions: OwnerQuestion[] = [];
  const holders = [...new Set(ball.map((b) => b.holder))];
  if (!closed && ball.length === 0) questions.push({ kind: "PROJECT_STATE", questionHe: `מה המצב של "${id.name}" ועל מי הוא מחכה עכשיו?`, why: "no send log, engineer, Victor or blocker evidence — Redbloods does not record who the project waits on" });
  if (!closed && ball.some((b) => b.holder === "OWNER" && b.confidence === "IN_APP_TIMESTAMPS")) questions.push({ kind: "OUTSIDE_COMMUNICATION", questionHe: `ב-"${id.name}" נראה שהכדור אצלך לפי המערכת — טופל משהו מחוץ ל-Redbloods (וואטסאפ/טלפון)?`, why: "in-app timestamps only; outside communication is common" });
  if (!closed && advance.state === "ADVANCE_EVIDENCE_MISSING") questions.push({ kind: "PAYMENT_EVIDENCE", questionHe: `"${id.name}" התקדם אבל לא רשומה מקדמה/תשלום — התקבלה מקדמה?`, why: "Owner pattern: most client projects start with an advance; nothing is recorded (no amount is assumed)" });
  if (deadlineClass === "HISTORICAL_OPERATIONAL_DEBT") questions.push({ kind: "DEADLINE_REALITY", questionHe: `"${id.name}" — הדדליין (${dl}) ישן. מה המצב האמיתי ומה הצעד הבא לשיקום?`, why: "historical operational debt — understand before acting (not an emergency)" });

  return {
    project: { key: `project:${projectId}`, name: id.name, status: id.status, businessType: id.businessType },
    clientDeadline: { date: dl, class: deadlineClass, daysTo: isStrictYmd(dl) ? daysBetween(today, dl) : null, risks, meaning: "a client commitment (Owner rule)", historicalCutoff: HISTORICAL_DEBT_CUTOFF },
    internalDeadlines: internal.map((i) => ({ ...i, meaning: "the team member's expected completion — not the client commitment" })),
    ballHolder: { holders, evidence: ball, certainty: ball.length === 0 ? "UNKNOWN" : ball.every((b) => b.confidence === "RECORDED" || b.confidence === "OWNER_REPORTED") ? "RECORDED" : "PARTLY_INFERRED" },
    advance,
    label: { labelWork, labelEvidence, labelArtistInvolved, protected: labelArtistInvolved, continuity: labelWork && (id.daysSinceUpdate ?? 0) >= 30 ? "ATTENTION_NO_RECENT_ACTIVITY" : labelWork ? "ACTIVE" : "NOT_LABEL" },
    occupancyUntilDeadline: occupancy,
    questions,
    epistemic: "DERIVED",
  };
}

/** "נכנסה הופעה ל<artist> ב-<date>" → what Redbloods knows, what is missing, downstream, notifications, actions. */
export function showWorkflow(src: GatewaySources, artistKey: string, date: string | null) {
  const st = ok(src.state) as PartnerCompanyState | null;
  const kn = activeKnowledge((ok(src.ownerKnowledge) as OwnerKnowledgeRecord[] | null) ?? [], st?.todayIL ?? ilToday(src.now));
  const settings = ok(src.settings) as SettingsState | null;
  const cal = ok(src.calendar) as CalendarWindowResult | null;
  const model = WORKFLOW_MODELS.find((w) => w.event === "NEW_SHOW")!;
  const id = artistKey.slice(artistKey.indexOf(":") + 1);
  const la = st?.domains.labelArtists.data?.items.find((a) => a.id === id);
  const cl = st?.domains.clients.data?.items.find((c) => c.id === id);
  const name = la?.name ?? cl?.name ?? null;
  if (!name) return { resolved: false as const, questions: [{ kind: "MISSING_DETAIL" as const, questionHe: "לא זיהיתי את האמן — למי נכנסה ההופעה?", why: "the artist key did not resolve" }] };
  const clientIds = new Set((st?.domains.clients.data?.items ?? []).filter((c) => norm(c.name) === norm(name)).map((c) => c.id));
  if (cl) clientIds.add(cl.id);
  const shows = (st?.domains.shows.data?.items ?? []).filter((s) => s.artistClientId && clientIds.has(s.artistClientId));
  const existing = date ? shows.find((s) => s.dateYmd === date) ?? null : null;
  const labelDj = kn.find((k) => k.kind === "ORGANIZATIONAL_ROLE" && (k.value as Record<string, unknown>).role === "LABEL_DJ");
  const djFreq = kn.find((k) => k.kind === "ENTITY_RELATIONSHIP" && (k.value as Record<string, unknown>).relation === "PARTICIPATES_IN_SHOWS");
  // THE app's own read rule (showNotifyStateOf with the show's CURRENT fingerprint — the same answer as the send button,
  // the notify writers, show_view and artist_view): SENT only for the current version; an older version is
  // SENT_PREVIOUS_VERSION. The version needs the show's time + place (LABEL_DETAIL); without them the state is UNKNOWN.
  const ld = ok(src.labelDetail) as LabelDetailRaw | null;
  const marker = (fam: string, showId: string) => {
    const sec = settings?.families[fam]; if (!settings || !sec) return "UNKNOWN";
    const row = sec.rows.find((r) => r.key.endsWith(`:${showId}`)); if (!row) return "NOT_SENT";
    const s = ld?.shows?.rows.find((x) => x.id === showId); if (!s) return "UNKNOWN";
    return showNotifyStateOf(((row as { value?: unknown }).value ?? null) as ShowNotifyClaimValue | null, computeShowNotifyFingerprint({ name: s.name ?? "", date: s.date, startTime: s.startTime, location: s.location })).state;
  };
  /** Propose asking the Owner to send when nothing current was sent: never sent, failed, or sent for an older version. */
  const proposeSend = (state: string) => ["NOT_SENT", "FAILED", "SENT_PREVIOUS_VERSION"].includes(state);
  const known: Array<{ item: string; value: unknown; source: string }> = [{ item: "artist", value: { key: artistKey, name, labelArtist: !!la }, source: "CANONICAL_DATA" }];
  const questions: OwnerQuestion[] = [];
  if (!date) questions.push({ kind: "MISSING_DETAIL", questionHe: `באיזה תאריך ההופעה של ${name}?`, why: "no date given" });
  if (existing) {
    known.push({ item: "already registered", value: { show: `show:${existing.id}`, status: existing.status, price: existing.price, paymentStatus: existing.paymentStatus, djAssigned: !!existing.djClientId, djConfirmation: existing.djConfirmationStatus }, source: "CANONICAL_DATA" });
    if (!existing.price) questions.push({ kind: "MISSING_DETAIL", questionHe: `מה המחיר של ההופעה של ${name} ב-${date}?`, why: "the show exists without a price" });
    if (!existing.djClientId) questions.push({ kind: "MISSING_DETAIL", questionHe: labelDj ? `האם DJ CLEANTONE מנגן בהופעה הזו, או די-ג׳יי אחר?` : "מי הדי-ג׳יי בהופעה?", why: "no DJ on the show; CLEANTONE plays most shows — a frequency, not a rule" });
  } else if (date) {
    questions.push({ kind: "MISSING_DETAIL", questionHe: `מה המחיר של ההופעה ב-${date}?`, why: "price + currency are needed for the finance rows" });
    questions.push({ kind: "MISSING_DETAIL", questionHe: "איפה ההופעה?", why: "venue / location is not known" });
    questions.push({ kind: "MISSING_DETAIL", questionHe: labelDj ? "DJ CLEANTONE מנגן בהופעה, או די-ג׳יי אחר?" : "מי הדי-ג׳יי?", why: labelDj ? "CLEANTONE is the label DJ and plays MOST shows (Owner) — confirm for this one, never assume" : "no DJ knowledge" });
    questions.push({ kind: "MISSING_DETAIL", questionHe: "ההופעה סגורה, או עדיין מחכים לתשובה?", why: "status decides whether the finance rows are created" });
  }
  if (labelDj) known.push({ item: "label DJ", value: { dj: labelDj.identityKeys.find((k) => k.startsWith("dj:")) ?? labelDj.subjectKey, playsMostShows: !!djFreq }, source: "OWNER_KNOWLEDGE" });
  known.push({ item: "DJ fee default", value: 500, source: "SYSTEM_CONTRACT" }, { item: "split", value: "net = price − DJ fee − counted rehearsal costs; artist half, label half", source: "SYSTEM_CONTRACT" });
  const calUsable = !!cal && (cal.status === "CALENDAR_DATA_AVAILABLE" || cal.status === "CALENDAR_PARTIAL");
  const calendarOnDate = date ? (calUsable && date >= cal!.window.start.slice(0, 10) && date <= cal!.window.end.slice(0, 10)
    ? { status: cal!.status, events: cal!.events.filter((e) => (e.allDay ? e.start <= date && date < e.end : e.start.slice(0, 10) === date)).map((e) => ({ title: e.title, allDay: e.allDay, start: e.start, holiday: e.holidayCalendar })) }
    : { status: cal?.status ?? "NOT_LOADED", events: null, note: "date outside the loaded window or calendar unreadable — conflicts unknown" }) : null;
  const notifications = existing ? [
    { push: "P_SHOW_TO_ARTIST", state: marker("SHOW_SENT_TO_ARTIST", existing.id), proposal: proposeSend(marker("SHOW_SENT_TO_ARTIST", existing.id)) ? "ask the Owner whether to send the artist notification (NOTIFY_SHOW_ARTIST — preview + his approval)" : null },
    { push: "P_SHOW_TO_DJ", state: existing.djClientId ? marker("SHOW_SENT_TO_DJ", existing.id) : "NOT_APPLICABLE_NO_DJ", proposal: existing.djClientId && proposeSend(marker("SHOW_SENT_TO_DJ", existing.id)) ? "ask the Owner whether to send the DJ notification (NOTIFY_SHOW_DJ — preview + his approval)" : null },
  ] : [{ push: "P_SHOW_TO_ARTIST", state: "NOT_APPLICABLE_YET", proposal: "after the show is registered and its details are complete, ask the Owner whether to notify the artist" }, { push: "P_SHOW_TO_DJ", state: "NOT_APPLICABLE_YET", proposal: "after a DJ is assigned, ask the Owner whether to notify the DJ" }];
  const rehearsals = existing ? (ok(src.operations) as OperationsRaw | null)?.calendarLinks?.rows.filter((l) => l.kind === "SESSION" && l.showId === existing.id).length ?? null : null;
  return { resolved: true as const, workflow: "NEW_SHOW", artist: name, date, existingShow: existing ? `show:${existing.id}` : null, known, questions, rehearsalsLinked: rehearsals, calendarOnDate, downstream: model.downstream, notifications, actions: model.actions, epistemic: "DERIVED" };
}

/** Company operating context for trade-offs: cashflow + label continuity + deadlines — facts and reasons, no score. */
export function companyOperating(src: GatewaySources) {
  const st = ok(src.state) as PartnerCompanyState | null;
  const fin = ok(src.finance);
  const today = st?.todayIL ?? ilToday(src.now);
  const open = (st?.domains.projects.data?.open ?? []).filter((p) => !CLOSED.has(p.status));
  const assessed = open.map((p) => projectOperating(src, p.id)).filter((x): x is NonNullable<ReturnType<typeof projectOperating>> => !!x);
  const collect = fin ? fin.state.receivables.filter((r) => r.collection.state !== "NOT_COLLECTIBLE").reduce<Record<string, number>>((m, r) => ({ ...m, [r.currency]: Math.round(((m[r.currency] ?? 0) + r.amount) * 100) / 100 }), {}) : null;
  const overdue = fin ? fin.state.receivables.filter((r) => r.collection.state !== "NOT_COLLECTIBLE" && r.dueDate && r.dueDate < today).length : null;
  const openProposals = (st?.domains.proposalsFull.data?.items ?? []).filter((p) => !["נסגר", "לא נסגר"].includes(p.status)).length;
  const releases = st?.domains.releasesFull.data?.items ?? [];
  return {
    cashflow: { collectibleByCurrency: collect, overdueReceivables: overdue, openProposals, clientProjectsMissingAdvanceEvidence: assessed.filter((a) => a.advance.state === "ADVANCE_EVIDENCE_MISSING").map((a) => a.project.name), rule: "top operational priority — within the canonical finance rules" },
    label: { labelProjectsOpen: assessed.filter((a) => a.label.labelWork).length, labelProjectsNoRecentActivity: assessed.filter((a) => a.label.continuity === "ATTENTION_NO_RECENT_ACTIVITY").map((a) => a.project.name), releasesPlanned: releases.filter((r) => r.stage !== "יצא").length, releaseTargetsPassed: releases.filter((r) => r.stage !== "יצא" && r.targetYmd && r.targetYmd < today).length, rule: "protected growth track — many releases wanted" },
    deadlines: { atRisk: assessed.filter((a) => a.clientDeadline.class === "AT_RISK").map((a) => a.project.name), approaching: assessed.filter((a) => a.clientDeadline.class === "APPROACHING").map((a) => a.project.name), newFailures: assessed.filter((a) => a.clientDeadline.class === "PASSED_NEW_FAILURE").map((a) => a.project.name), historicalDebt: assessed.filter((a) => a.clientDeadline.class === "HISTORICAL_OPERATIONAL_DEBT").length, noDeadline: assessed.filter((a) => a.clientDeadline.class === "NO_DEADLINE").length },
    tradeoffGuidance: "Money and label are connected (cashflow funds the label). When they compete: weigh cashflow, client commitments, label continuity, deadlines, release plans, calendar, team state, risk and impact — and explain; never drop one side blindly; no universal score.",
    epistemic: "DERIVED",
  };
}

/** Repeated question TYPES → Redbloods improvement signals (never an automatic change). */
export function repeatedQuestionSignals(src: GatewaySources) {
  const integrity = ok(src.integrity) as CompanyIntegrityRegister | null;
  const fin = ok(src.finance);
  const counts = new Map<string, { asked: number; answered: number }>();
  const bump = (t: string, k: "asked" | "answered") => { const c = counts.get(t) ?? { asked: 0, answered: 0 }; c[k]++; counts.set(t, c); };
  for (const q of integrity?.questions ?? []) bump(q.questionType, "asked");
  for (const l of integrity?.learned ?? []) bump(l.decision.questionType, "answered");
  for (const q of fin?.brief?.rehab.questions ?? []) bump(q.questionType, "asked");
  const deferred = integrity?.deferredQuestions ?? 0;
  return [...counts.entries()].filter(([, c]) => c.asked + c.answered >= 2).map(([type, c]) => ({
    questionType: type, timesAskedOrAnswered: c.asked + c.answered, openNow: c.asked, answered: c.answered,
    missingConcept: QUESTION_TYPE_TO_MISSING_CONCEPT[type] ?? "unmapped — review which Redbloods field would make this question unnecessary",
    suggestionHe: `אני שואל אותך שוב ושוב שאלות מסוג ${type}. ${QUESTION_TYPE_TO_MISSING_CONCEPT[type] ? "אם Redbloods הייתה רושמת את זה, יכולתי לעקוב אוטומטית." : ""}`.trim(),
    decision: "the Owner decides whether the product changes; Sunny never changes it", epistemic: "PATTERN_CANDIDATE" as const,
  })).concat(deferred ? [{ questionType: "DEFERRED_INTEGRITY_QUESTIONS", timesAskedOrAnswered: deferred, openNow: deferred, answered: 0, missingConcept: "more integrity questions are waiting than can be shown", suggestionHe: "", decision: "", epistemic: "PATTERN_CANDIDATE" as const }] : []);
}
