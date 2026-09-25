/**
 * Sunny WHOLE-SYSTEM INTEGRATION V1 — the company view (pure, read-only).
 *
 * ONE organizational brain over the whole company. It COMPOSES the existing Deep Brain views (projects, clients, label,
 * shows, Victor, mix, video, operating model, Finance Brain, calendar, integrity, outcomes). It adds no business rule:
 *   - attention = every domain signal, classified by the company contract's ATTENTION_MAP (nature + factual dimensions +
 *     whose move), deduplicated by concept + entity, grouped in a FIXED presentation order — never a score / rank;
 *   - money = Finance Brain primitives (per currency, never added, never converted);
 *   - release candidates = the app's own "add release" rule;
 *   - decisions = every open Owner question, deduplicated, and every known historical decision re-evaluated against the
 *     live state (still observed / no longer observed) — never answered by Sunny;
 *   - a failed source is named (PARTIAL), never an empty company.
 */
import type { GatewaySources } from "../gateway/core";
import { ok } from "../gateway/core";
import type { PartnerCompanyState } from "../eyes/types";
import type { OperationsRaw } from "../operations/types";
import type { ProjectDetailRaw } from "../projects/detail-types";
import type { CompanyIntegrityRegister } from "../integrity/types";
import { buildProjectView } from "../projects/view";
import { buildClientView } from "../clients/view";
import { buildArtistView } from "../label/view";
import { buildShowView } from "../shows/view";
import { buildVictorView } from "../victor/view";
import { buildMixView } from "../mix/view";
import { buildVideoView } from "../redfilms/view";
import { companyOperating, repeatedQuestionSignals } from "../sunny/operating";
import { buildCalendarLinkIndex, linkCalendarEvent } from "../calendar/links";
import { buildReleaseCandidates } from "../../release-candidates";
import { KNOWLEDGE_GAPS } from "../system/gaps";
import { SECURITY_GAPS } from "../system/people";
import { ATTENTION_DIMENSIONS, ATTENTION_MAP, EXECUTABLE_TODAY, FUTURE_PRIMITIVES, GAP_ROOTS, STILL_PENDING, gapRootOf, type AttentionDimension, type AttentionNature, type AttentionSide, type GapRoot } from "../system/company";

const CLOSED = new Set(["הושלם", "בוטל"]);
const DAY = 86_400_000;
const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const round2 = (n: number) => Math.round(n * 100) / 100;

export type CompanyDomain = "PROJECTS" | "CLIENTS" | "LABEL" | "SHOWS" | "VICTOR" | "MIX" | "VIDEO" | "FINANCE" | "AGENT_ALERTS" | "CALENDAR";
export interface CompanyObservation {
  code: string;
  concept: string;
  nature: AttentionNature;
  dims: AttentionDimension[];
  side: AttentionSide;
  /** The fixed presentation group (the first dimension in ATTENTION_DIMENSIONS order) — an order, not a priority. */
  group: AttentionDimension | "CONTEXT";
  domain: CompanyDomain;
  he: string;
  entity: string | null;
  project: string | null;
  epistemic: "FACT" | "DERIVED" | "UNKNOWN" | "OBSERVATION";
  alsoSeenIn: CompanyDomain[];
}
export interface CompanyDecision {
  id: string;
  questionHe: string;
  why: string;
  kind: string;
  domain: CompanyDomain | "INTEGRITY" | "SYSTEM";
  origin: "LIVE_QUESTION" | "KNOWN_DECISION";
  /** KNOWN decisions re-evaluated against live state. */
  liveState?: "STILL_OBSERVED" | "NO_LONGER_OBSERVED" | "POLICY_OPEN" | "UNKNOWN_SOURCE_FAILED";
  evidenceHe?: string;
  answerable: "OWNER_ONLY";
}

/** Codes that name the SAME company concept in two domains (dedupe; the first domain keeps it, the other is 'alsoSeenIn'). */
const CONCEPT_ALIAS: Readonly<Record<string, string>> = {
  VICTOR_WAITING_OWNER: "WAITING_ON_OWNER", AT_VICTOR: "WAITING_ON_VICTOR", AT_ENGINEER: "WAITING_ON_ENGINEER", ENGINEER_RETURNED_WORK: "WAITING_ON_OWNER",
  DONE_UNPAID: "SHOW_DONE_UNPAID", NO_DJ: "SHOW_WITHOUT_DJ", UPCOMING: "UPCOMING_SHOW", COLLABORATION: "IDENTITY_COLLABORATION",
};

/** Company-level agent alert types → meaning. Owner policy: alerts are never canonical action truth → always CONTEXT (an observation of a parallel engine), never attention. */
const ALERT_MEANING: Readonly<Record<string, { nature: AttentionNature; dims: AttentionDimension[]; side: AttentionSide }>> = {
  goal_behind: { nature: "CONTEXT", dims: ["MONEY_RELEVANT"], side: "OWNER" },
  week_understaffed: { nature: "CONTEXT", dims: ["SCHEDULED_EVENT"], side: "OWNER" },
  upcoming_holiday: { nature: "CONTEXT", dims: ["SCHEDULED_EVENT"], side: "NONE" },
  income: { nature: "CONTEXT", dims: ["MONEY_RELEVANT"], side: "NONE" },
  inactivity: { nature: "CONTEXT", dims: [], side: "UNKNOWN" },
  victor_below_pace: { nature: "CONTEXT", dims: ["EXTERNAL_PARTY_WAITING"], side: "EXTERNAL" },
};

interface Sources { st: PartnerCompanyState | null; ops: OperationsRaw | null; det: ProjectDetailRaw | null; today: string }
function ctx(src: GatewaySources): Sources {
  const st = ok(src.state) as PartnerCompanyState | null;
  const today = st?.todayIL ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(src.now);
  return { st, ops: ok(src.operations) as OperationsRaw | null, det: ok(src.projectDetail) as ProjectDetailRaw | null, today };
}

/** Run one composed view; a thrown / missing source becomes a named PARTIAL, never an empty result. */
function safe<T>(name: string, partial: string[], f: () => T): T | null {
  try { return f(); } catch { partial.push(`${name} — could not be composed now (unknown, not none)`); return null; }
}

export function buildCompanyView(src: GatewaySources) {
  const c = ctx(src);
  const partial: string[] = [];
  const sourceState: Record<string, "OK" | "FAILED" | "NOT_LOADED"> = {};
  for (const [k, v] of Object.entries({ state: src.state, finance: src.finance, operations: src.operations, projectDetail: src.projectDetail, clientDetail: src.clientDetail, labelDetail: src.labelDetail, settings: src.settings, calendar: src.calendar, integrity: src.integrity, ownerKnowledge: src.ownerKnowledge, actions: src.actions, outcomes: src.outcomes })) {
    sourceState[k] = !v ? "NOT_LOADED" : v.status === "OK" ? "OK" : "FAILED";
    if (v && v.status !== "OK") partial.push(`${k} could not be read — its part of the company is UNKNOWN, not empty`);
  }
  const fin = ok(src.finance);
  const idx = c.st?.domains.projects.data?.index ?? {};
  const openProjects = (c.st?.domains.projects.data?.open ?? []).filter((p) => !CLOSED.has(p.status));

  // ── compose the domain views ──
  const projects = safe("projects", partial, () => openProjects.map((p) => ({ id: p.id, v: buildProjectView(src, p.id) })));
  const clients = safe("clients", partial, () => (c.st?.domains.clients.data?.items ?? []).map((cl) => buildClientView(src, cl.id)).filter((v): v is NonNullable<typeof v> => !!v));
  const artistIds = [...new Set([...(c.st?.domains.labelArtists.data?.items ?? []).map((a) => a.id)])];
  const artists = safe("label artists", partial, () => artistIds.map((id) => buildArtistView(src, id)).filter((v): v is NonNullable<typeof v> => !!v));
  const showIds = (ok(src.labelDetail) as { shows?: { rows?: Array<{ id: string }> } } | null)?.shows?.rows?.map((s) => s.id) ?? [];
  const shows = safe("shows", partial, () => showIds.map((id) => buildShowView(src, id)).filter((v): v is NonNullable<typeof v> => !!v));
  const victor = safe("Victor", partial, () => buildVictorView(src));
  const mix = safe("mix", partial, () => buildMixView(src));
  const video = safe("video", partial, () => buildVideoView(src));
  const operating = safe("operating model", partial, () => companyOperating(src));

  // ── attention: every domain signal → the company meaning ──
  const all: CompanyObservation[] = [];
  const unmapped = new Set<string>();
  const push = (domain: CompanyDomain, code: string, he: string, entity: string | null, project: string | null, kind: string) => {
    const m = ATTENTION_MAP[code];
    if (!m) { unmapped.add(code); return; }
    const group = m.nature === "CONTEXT" || m.nature === "INVESTMENT" ? "CONTEXT" : (ATTENTION_DIMENSIONS.find((d) => m.dims.includes(d)) ?? "CONTEXT");
    all.push({ code, concept: CONCEPT_ALIAS[code] ?? code, nature: m.nature, dims: [...m.dims], side: m.side, group, domain, he, entity, project, epistemic: kind === "UNKNOWN" ? "UNKNOWN" : kind === "CANONICAL_FACT" ? "FACT" : "DERIVED", alsoSeenIn: [] });
  };
  for (const p of projects ?? []) for (const s of p.v.signals) if (s.kind !== "OWNER_POLICY") push("PROJECTS", s.code, `${p.v.identity?.name ?? "פרויקט"}: ${s.he}`, `project:${p.id}`, `project:${p.id}`, s.kind);
  for (const cl of clients ?? []) for (const s of cl.signals) push("CLIENTS", s.code, `${cl.identity.name}: ${s.he}`, s.entity ?? cl.key, s.entity?.startsWith("project:") ? s.entity : null, s.kind);
  for (const a of artists ?? []) for (const s of a.signals) push("LABEL", s.code, `${a.identity.name}: ${s.he}`, s.entity ?? a.key, s.entity?.startsWith("project:") ? s.entity : null, s.kind);
  for (const sh of shows ?? []) for (const s of sh.signals) push("SHOWS", s.code, `${sh.identity.name ?? "הופעה"} ${sh.identity.date ?? ""}: ${s.he}`, sh.key, null, s.kind);
  const vWork = new Map((victor?.works ?? []).map((w) => [w.key, w.project?.key ?? null]));
  for (const s of victor?.signals ?? []) push("VICTOR", s.code, s.he, s.work ?? null, s.work ? vWork.get(s.work) ?? null : null, s.kind);
  for (const s of mix?.signals ?? []) push("MIX", s.code, s.he, s.work ?? s.project ?? null, s.project ?? null, s.kind);
  for (const s of video?.signals ?? []) push("VIDEO", s.code, s.he, s.production ?? s.project ?? null, s.project ?? null, s.kind);
  // company-level agent alerts (no project) — the in-app alert engine's own observations
  const companyAlerts = (c.det?.agentAlerts?.rows ?? []).filter((a) => !a.projectId && a.status !== "resolved" && a.status !== "dismissed");
  for (const a of companyAlerts) {
    const m = ALERT_MEANING[a.type ?? ""] ?? { nature: "CONTEXT" as const, dims: [], side: "UNKNOWN" as const };
    all.push({ code: `ALERT_${(a.type ?? "unknown").toUpperCase()}`, concept: `ALERT_${a.type}`, nature: m.nature, dims: [...m.dims], side: m.side, group: m.nature === "CONTEXT" ? "CONTEXT" : (ATTENTION_DIMENSIONS.find((d) => m.dims.includes(d)) ?? "CONTEXT"), domain: "AGENT_ALERTS", he: `התראת מערכת (${a.status ?? "?"}): ${a.title ?? a.type ?? ""}`, entity: a.entityKey ?? null, project: null, epistemic: "OBSERVATION", alsoSeenIn: [] });
  }

  // dedupe: the same concept on the same entity / project is ONE observation (other domains recorded as alsoSeenIn)
  const seen = new Map<string, CompanyObservation>();
  for (const o of all) {
    const k = `${o.concept}|${o.project ?? o.entity ?? o.he}`;
    const prev = seen.get(k);
    if (prev) { if (prev.domain !== o.domain && !prev.alsoSeenIn.includes(o.domain)) prev.alsoSeenIn.push(o.domain); continue; }
    seen.set(k, o);
  }
  const observations = [...seen.values()];
  const groupOrder = (g: CompanyObservation["group"]) => (g === "CONTEXT" ? 99 : ATTENTION_DIMENSIONS.indexOf(g));
  const attention = observations.filter((o) => o.nature === "NEEDS_ATTENTION" || o.nature === "PROBLEM" || o.nature === "CONFLICT")
    .sort((a, b) => groupOrder(a.group) - groupOrder(b.group) || a.domain.localeCompare(b.domain) || a.he.localeCompare(b.he));
  const context = observations.filter((o) => o.nature === "CONTEXT" || o.nature === "INVESTMENT");
  const systemGapSignals = observations.filter((o) => o.nature === "SYSTEM_GAP");
  const byGroup = attention.reduce<Record<string, number>>((m, o) => ({ ...m, [o.group]: (m[o.group] ?? 0) + 1 }), {});

  // ── cashflow (Finance Brain primitives; per currency; never converted) ──
  const cashflow = fin ? (() => {
    const s = fin.state;
    const recv: Record<string, Record<string, number>> = {};
    for (const r of s.receivables) { if (r.collection.state === "NOT_COLLECTIBLE" || r.collection.state === "SETTLED") continue; recv[r.collection.state] ??= {}; recv[r.collection.state][r.currency] = round2((recv[r.collection.state][r.currency] ?? 0) + r.amount); }
    const expected: Record<string, Record<string, number>> = {};
    for (const e of s.expected) { expected[e.class] ??= {}; expected[e.class][e.currency] = round2((expected[e.class][e.currency] ?? 0) + e.amount); }
    return {
      month: s.month.key, daysRemaining: s.month.daysRemaining,
      realized: { ils: s.realized.ils, byCurrency: s.realized.byCurrency, targetPosition: s.realized.targetPosition, distanceToFloor: s.realized.distanceToFloor, distanceToPreferred: s.realized.distanceToPreferred, floorIls: s.policy.floorIls, preferredIls: s.policy.preferredIls, historicalPartial: s.realized.historicalPartial, rule: "realized = received (שולם / התקבל income) − paid expenses (שולם only); ₪ target; other currencies shown apart, never converted" },
      collectible: recv, expected, potential: { proposals: s.proposalPipeline.amounts, openProposals: s.proposalPipeline.openCount, meaning: "POTENTIAL — never counted as expected or realized" },
      openExpenses: s.openExpenses.totalsByCurrency, openExpenseCount: s.openExpenses.items.length,
      vendors: { victorSalaryConflicts: (victor?.money.months ?? []).filter((m) => m.conflicts.length).map((m) => m.month), mixOwedByCurrency: mix?.money.owedByCurrency ?? null, mixOrphanExpenses: mix?.money.orphanExpenses.length ?? null },
      video: video ? { redFilmsLedgerPaid: video.money.redFilms.paidRedFilmsLedger, clipExpensesUnpaid: video.money.actualClipExpenses.unpaid, clipIncome: video.money.clipIncome, note: "Red Films ledger is NOT in Finance — shown apart, never added" } : null,
      showsUnpaidAfterDone: (shows ?? []).filter((s) => s.identity.status === "בוצע" && s.money.clientPayment !== "שולם" && (s.money.price ?? 0) > 0).length,
      advanceEvidenceMissing: operating?.cashflow.clientProjectsMissingAdvanceEvidence ?? [],
      reliableFrom: s.policy.policyStartYmd, financeSignals: s.signals.map((x) => ({ code: x.code, count: x.count, amounts: x.amounts, review: x.review })),
      tension: "cashflow is the top operational priority, not absolute; label spend is INVESTMENT (protected growth track) — the trade-off is the Owner's",
    };
  })() : null;
  if (!fin) partial.push("FINANCE — money position unknown (not zero)");

  // ── label review (per artist facts + the app's own release-candidate rule) ──
  const releases = c.st?.domains.releasesFull.data?.items ?? [];
  const meta = c.ops?.projectsMeta?.rows ?? [];
  const candidates = meta.length ? buildReleaseCandidates(
    meta.map((p) => ({ id: p.id, name: p.name, artist: p.artistText ?? "", projectType: p.projectType ?? "", businessType: p.businessType ?? "" })),
    (c.st?.domains.labelArtists.data?.items ?? []).map((a) => ({ id: a.id, name: a.name })),
    new Set(releases.map((r) => r.projectId)),
    (c.st?.domains.clients.data?.items ?? []).filter((x) => x.status === "אמן לייבל").map((x) => x.name),
  ).filter((x) => x.block === null) : null;
  const metaById = new Map(meta.map((p) => [p.id, p]));
  const label = {
    artists: (artists ?? []).map((a) => ({ key: a.key, name: a.identity.name, status: a.identity.status, openProjects: a.projects.filter((p) => p.open).length, activeReleases: a.releases.filter((r) => r.active).length, nextRelease: a.nextRelease ? { name: a.nextRelease.projectName, stage: a.nextRelease.stage, target: a.nextRelease.targetDate } : null, released: a.cadence.releasedDates.length, lastReleased: a.cadence.releasedDates.slice().sort().pop() ?? null, upcomingShows: a.shows.filter((s) => s.upcoming && s.status !== "בוטל").length, lastRecordedActivity: a.lastRecordedActivity, signals: [...new Set(a.signals.map((s) => s.code))] })).sort((x, y) => x.name.localeCompare(y.name)),
    releaseCandidates: candidates ? candidates.map((x) => ({ project: `project:${x.project.id}`, name: x.project.name, type: x.project.projectType, projectStatus: metaById.get(x.project.id)?.status ?? null, owners: x.owners.map((o) => o.name), ownerChoiceNeeded: x.owners.length > 1 })) : null,
    rule: "release candidate = the app's own rule (label artist credited, releasable type, no release row; project status not considered). No cadence / readiness policy exists — facts only.",
  };
  const releaseView = {
    upcoming: releases.filter((r) => !r.releasedAt && r.targetYmd && r.targetYmd >= c.today).map((r) => ({ project: `project:${r.projectId}`, name: idx[r.projectId]?.name ?? null, stage: r.stage, target: r.targetYmd })).sort((a, b) => (a.target ?? "").localeCompare(b.target ?? "")),
    targetPassed: releases.filter((r) => !r.releasedAt && r.targetYmd && r.targetYmd < c.today).map((r) => ({ project: `project:${r.projectId}`, name: idx[r.projectId]?.name ?? null, stage: r.stage, target: r.targetYmd })),
    noTarget: releases.filter((r) => !r.releasedAt && !r.targetYmd).length,
    releasedLast90: releases.filter((r) => r.releasedAt && r.releasedAt.slice(0, 10) >= addDays(c.today, -90)).length,
  };

  // ── delivery ──
  const deliveries = c.det?.deliveries?.rows ?? [];
  const delivery = {
    completedProjectsWithOpenDelivery: (projects ?? []).filter((p) => p.v.signals.some((s) => s.code === "COMPLETED_DELIVERY_OPEN")).length,
    deliveryRecords: deliveries.length, delivered: deliveries.filter((d) => d.deliveredAt).length,
    mixCompletedWithoutFinalFiles: mix?.counts.completedWithoutFinalFiles ?? null, finalFilesRequestsOpen: (mix?.signals ?? []).filter((s) => s.code === "FINAL_FILES_REQUEST_OPEN").length,
    note: "a delivery record ≠ final files ≠ published; outside delivery (WhatsApp / drive) is invisible",
  };

  // ── team / external parties ──
  const team = {
    victor: victor ? { open: victor.counts.open, waitingOnVictor: victor.counts.waitingOnVictor, waitingOnOwner: victor.counts.waitingOnOwner, unknown: victor.counts.unknown, conflicting: victor.counts.conflicting, lastPortalVisit: victor.presence.lastPortalVisit } : null,
    mix: mix ? { open: mix.counts.open, byEngineer: mix.counts.byEngineer, waitingOnEngineer: mix.counts.waitingOnEngineer, waitingOnOwner: mix.counts.waitingOnOwner, unknown: mix.counts.unknown, stevenLastVisit: mix.steven.presence.lastVisit } : null,
    djAwaitingConfirmation: (shows ?? []).filter((s) => s.signals.some((x) => x.code === "DJ_AWAITING_CONFIRMATION")).map((s) => ({ show: s.key, date: s.identity.date })),
    externalWaiting: attention.filter((o) => o.side === "EXTERNAL").length + context.filter((o) => o.side === "EXTERNAL").length,
    note: "who holds the next move is evidence-based; outside communication is invisible — never blame; no workload score, no capacity limit",
  };

  // ── calendar (live; personal events are schedule context only) ──
  const cal = ok(src.calendar);
  const linkIdx = buildCalendarLinkIndex(c.ops, c.st);
  const linked = cal && cal.status !== "CALENDAR_RANGE_TOO_LARGE" && cal.status !== "CALENDAR_NOT_CONNECTED" && cal.status !== "CALENDAR_NEEDS_REAUTH" && cal.status !== "CALENDAR_PROVIDER_ERROR" ? cal.events.filter((e) => e.status !== "cancelled").map((e) => linkCalendarEvent(e, linkIdx)) : null;
  const inDays = (e: { start: string }, from: number, to: number) => { const d = e.start.slice(0, 10); return d >= addDays(c.today, from) && d <= addDays(c.today, to); };
  const calRow = (l: NonNullable<typeof linked>[number]) => ({ start: l.event.start, end: l.event.end, allDay: l.event.allDay, title: l.category === "PERSONAL_OR_OTHER" ? null : l.event.title, category: l.category, quality: l.quality, links: l.edges.map((e) => e.to), businessFact: l.category.startsWith("REDBLOODS_") ? "CANONICAL" : l.category === "LIKELY_WORK" ? "INFERRED" : "NOT_A_BUSINESS_FACT" });
  const calendar = {
    status: cal?.status ?? (src.calendar ? "UNREADABLE" : "NOT_LOADED"),
    today: linked ? linked.filter((l) => inDays(l.event, 0, 0)).map(calRow) : null,
    next7: linked ? linked.filter((l) => inDays(l.event, 1, 7)).map(calRow) : null,
    counts: linked ? linked.filter((l) => inDays(l.event, 0, 7)).reduce<Record<string, number>>((m, l) => ({ ...m, [l.category]: (m[l.category] ?? 0) + 1 }), {}) : null,
    rule: "an unreadable calendar is UNKNOWN, never empty; personal events are schedule context — their titles are not served here and never become business facts",
  };
  if (!linked) partial.push("CALENDAR — today's schedule unknown (not empty)");

  // ── decisions (live questions + re-evaluated known decisions; deduplicated; never answered by Sunny) ──
  const decisions: CompanyDecision[] = [];
  const normQ = (t: string) => t.replace(/["'״׳]/g, "").replace(/\s+/g, " ").trim();
  const qSeen = new Set<string>();
  const addQ = (d: Omit<CompanyDecision, "answerable">) => { const k = `${d.kind}|${normQ(d.questionHe)}`; if (qSeen.has(k)) return; qSeen.add(k); decisions.push({ ...d, answerable: "OWNER_ONLY" }); };
  const integ = ok(src.integrity) as CompanyIntegrityRegister | null;
  for (const q of integ?.questions ?? []) addQ({ id: `integrity:${q.questionId}`, questionHe: q.textHe, why: q.whyHe, kind: q.questionType, domain: "INTEGRITY", origin: "LIVE_QUESTION" });
  for (const q of fin?.brief?.rehab.questions ?? []) addQ({ id: `finance:${q.questionType}`, questionHe: q.textHe, why: q.whyHe, kind: q.questionType, domain: "FINANCE", origin: "LIVE_QUESTION" });
  for (const [dom, qs] of [["VICTOR", victor?.questions ?? []], ["MIX", mix?.questions ?? []], ["VIDEO", video?.questions ?? []]] as const) qs.forEach((q, i) => addQ({ id: `${dom.toLowerCase()}:${i}`, questionHe: q.questionHe, why: q.why, kind: q.kind, domain: dom, origin: "LIVE_QUESTION" }));
  for (const a of artists ?? []) a.questions.forEach((q, i) => addQ({ id: `${a.key}:q${i}`, questionHe: `${a.identity.name}: ${q.questionHe}`, why: q.why, kind: q.kind, domain: "LABEL", origin: "LIVE_QUESTION" }));
  for (const s of (shows ?? []).filter((x) => x.identity.date && x.identity.date >= addDays(c.today, -30))) s.questions.forEach((q, i) => addQ({ id: `${s.key}:q${i}`, questionHe: `הופעה ${s.identity.date}: ${q.questionHe}`, why: q.why, kind: q.kind, domain: "SHOWS", origin: "LIVE_QUESTION" }));
  for (const cl of clients ?? []) cl.questions.forEach((q, i) => addQ({ id: `${cl.key}:q${i}`, questionHe: `${cl.identity.name}: ${q.questionHe}`, why: q.why, kind: q.kind, domain: "CLIENTS", origin: "LIVE_QUESTION" }));
  const kn = (ok(src.ownerKnowledge) ?? []) as Array<{ subjectKey: string; operation?: string }>;
  const decided = (subject: string) => kn.some((k) => k.subjectKey === subject && k.operation !== "WITHDRAW");
  const known: Array<{ id: string; questionHe: string; why: string; kind: string; domain: CompanyDecision["domain"]; state: () => { s: NonNullable<CompanyDecision["liveState"]>; e: string } }> = [
    { id: "known:victor-june-500", questionHe: "משכורת ויקטור יוני: הסכום $500 מול $550 הגלובלי — מה נכון?", why: "salary sources disagree; kept for later by the Owner", kind: "PAYMENT", domain: "VICTOR", state: () => victor ? ((victor.money.months.find((m) => m.month.startsWith("2026-06"))?.conflicts.length ?? 0) > 0 ? { s: "STILL_OBSERVED", e: victor.money.months.find((m) => m.month.startsWith("2026-06"))!.conflicts.join("; ") } : { s: "NO_LONGER_OBSERVED", e: "no June salary conflict in the live read" }) : { s: "UNKNOWN_SOURCE_FAILED", e: "Victor view unavailable" } },
    { id: "known:mix-orphan-expenses", questionHe: "הוצאות מיקס שלא מקושרות לשום עבודה — לשייך או שאריות?", why: "never fuzzy-linked by Sunny", kind: "FINANCE", domain: "MIX", state: () => mix ? (mix.money.orphanExpenses.length ? { s: "STILL_OBSERVED", e: `${mix.money.orphanExpenses.length} orphan mix expenses` } : { s: "NO_LONGER_OBSERVED", e: "no orphan mix expense now" }) : { s: "UNKNOWN_SOURCE_FAILED", e: "mix view unavailable" } },
    { id: "known:redfilms-ledger-vs-finance", questionHe: "תשלומי Red Films בפנקס הנפרד — צריכים להופיע גם בכספים?", why: "two money records; never summed", kind: "FINANCE", domain: "VIDEO", state: () => video ? (video.money.redFilms.paidRedFilmsLedger > 0 ? { s: "STILL_OBSERVED", e: `Red Films ledger ${video.money.redFilms.paidRedFilmsLedger} (currency not recorded), not in Finance` } : { s: "NO_LONGER_OBSERVED", e: "no active Red Films ledger payment" }) : { s: "UNKNOWN_SOURCE_FAILED", e: "video view unavailable" } },
    { id: "known:recoup-basis", questionHe: "החזר השקעה בקליפ לאמן מחושב לפי התקציב המתוכנן (50/50) — זה הבסיס הנכון?", why: "an existing accounting rule never confirmed by the Owner", kind: "OWNER_POLICY", domain: "LABEL", state: () => ({ s: "POLICY_OPEN", e: "policy question — not decidable from data" }) },
    { id: "known:artist-accounting-canonical", questionHe: "חשבון אמן: מאזן / מחזורים / הכנסות מדיה / החזר קליפ הם תצוגות נפרדות — מה הקנוני?", why: "several unreconciled artist-money views", kind: "OWNER_POLICY", domain: "LABEL", state: () => ({ s: "POLICY_OPEN", e: "policy question" }) },
    { id: "known:release-cadence", questionHe: "יש קצב ריליסים רצוי לכל אמן לייבל? (היום אין מדיניות — רק עובדות)", why: "cadence / readiness are never invented", kind: "OWNER_POLICY", domain: "LABEL", state: () => ({ s: "POLICY_OPEN", e: "no cadence policy recorded" }) },
    { id: "known:working-hours", questionHe: "בוחר הסשנים מניח שעות עבודה א׳–ה׳ 10:00–23:00, והמודל שלך אומר שאין שעות קבועות — להשאיר?", why: "implementation assumption vs Owner policy", kind: "OWNER_POLICY", domain: "SYSTEM", state: () => ({ s: "POLICY_OPEN", e: "implementation constant vs Owner rule" }) },
    { id: "known:legacy-ai-brain", questionHe: "הסוכן הישן 'מאי AI' (כבוי) והתראות הסוכן רצים במקביל לסאני — להשאיר, לאחד או לכבות?", why: "two brains with different rules can disagree", kind: "OWNER_POLICY", domain: "SYSTEM", state: () => ({ s: "POLICY_OPEN", e: `${companyAlerts.length} open company-level alerts from the parallel engine` }) },
    { id: "known:two-morning-briefs", questionHe: "יש כבר מיילי בוקר / ערב אוטומטיים — סיכום הבוקר של סאני צריך להחליף אותם או לחיות לצידם?", why: "two morning briefs may disagree", kind: "OWNER_POLICY", domain: "SYSTEM", state: () => ({ s: "POLICY_OPEN", e: "the report emails still exist" }) },
  ];
  for (const k of known) {
    if (decided(k.id)) continue;
    const st = safe(k.id, partial, k.state) ?? { s: "UNKNOWN_SOURCE_FAILED" as const, e: "evaluation failed" };
    if (st.s === "NO_LONGER_OBSERVED") { decisions.push({ id: k.id, questionHe: k.questionHe, why: k.why, kind: k.kind, domain: k.domain, origin: "KNOWN_DECISION", liveState: st.s, evidenceHe: st.e, answerable: "OWNER_ONLY" }); continue; }
    addQ({ id: k.id, questionHe: k.questionHe, why: k.why, kind: k.kind, domain: k.domain, origin: "KNOWN_DECISION", liveState: st.s, evidenceHe: st.e });
  }

  // ── conflicts ──
  const conflicts = {
    data: attention.filter((o) => o.nature === "CONFLICT"),
    registered: KNOWLEDGE_GAPS.filter((g) => g.class === "CONFLICTING_SOURCES" || g.status === "CONFLICT_REQUIRES_OWNER_DECISION").map((g) => ({ id: g.id, domain: g.domain, description: g.description })),
    implementationVsPolicy: [{ id: "WORKING_HOURS", he: "שעות עבודה קבועות בבוחר הסשנים מול 'אין שעות קבועות' במודל הבעלים" }, { id: "PARALLEL_ATTENTION_ENGINES", he: "התראות סוכן, בריאות דשבורד ותדריך COO (P0–P3) מול תשומת הלב של סאני (בלי ציון)" }],
    rule: "two disagreeing sources are shown side by side — never merged, never silently resolved",
  };

  // ── gaps (root-cause deduplicated) ──
  const roots = KNOWLEDGE_GAPS.reduce<Record<string, string[]>>((m, g) => { const r = gapRootOf(g); (m[r] ??= []).push(g.id); return m; }, {});
  const gaps = {
    byRoot: (Object.keys(GAP_ROOTS) as GapRoot[]).map((r) => ({ root: r, problemHe: GAP_ROOTS[r].problemHe, productFix: GAP_ROOTS[r].productFix, gaps: roots[r]?.length ?? 0, sample: (roots[r] ?? []).slice(0, 6) })).filter((x) => x.gaps > 0),
    total: KNOWLEDGE_GAPS.length, pendingDeepDomains: [...STILL_PENDING], liveSystemGapSignals: systemGapSignals.length,
  };

  // ── change awareness (recorded timestamps only — WHAT changed is mostly not recorded) ──
  const since = addDays(c.today, -7);
  const changes = {
    windowFrom: since,
    projectsUpdated: meta.filter((p) => (p.updatedAt ?? "").slice(0, 10) >= since).map((p) => ({ project: `project:${p.id}`, name: p.name, status: p.status, updatedAt: p.updatedAt })).slice(0, 40),
    projectsCreated: (c.det?.projects?.rows ?? []).filter((p) => (p.createdAt ?? "").slice(0, 10) >= since).length,
    financeRowsDated: fin ? fin.raw.transactions.filter((t) => (t.date ?? "") >= since && (t.date ?? "") <= c.today).length : null,
    releasesReleased: releases.filter((r) => r.releasedAt && r.releasedAt.slice(0, 10) >= since).map((r) => ({ project: `project:${r.projectId}`, name: idx[r.projectId]?.name ?? null })),
    ownerKnowledgeRecorded: (ok(src.ownerKnowledge) ?? []).filter((k) => ((k as { learnedAt?: string }).learnedAt ?? "").slice(0, 10) >= since).length,
    rule: "only 'when' is recorded (updated-at); 'what changed' has no history in most tables — never invented; notifications are deleted weekly and are not history",
  };

  // ── outcomes + action map ──
  const outcomes = (ok(src.outcomes) ?? []).map((o) => ({ state: o.state, actionType: o.actionType, executedAt: o.executedAt, headlineHe: o.headlineHe }));
  const pendingActions = (ok(src.actions) ?? []).map((a) => ({ actionType: a.actionType, state: a.state, headlineHe: a.headlineHe }));
  const actionMap = { executableToday: [...EXECUTABLE_TODAY], pending: pendingActions, futurePrimitives: FUTURE_PRIMITIVES.map((p) => ({ id: p.id, risk: p.risk })), rule: "Sunny proposes; the Owner approves; nothing executes from a conversation without the dashboard approval flow" };
  const security = { open: SECURITY_GAPS.filter((g) => g.status !== "REMEDIATED").map((g) => ({ id: g.id, severity: g.severity, kind: g.kind })), remediated: SECURITY_GAPS.filter((g) => g.status === "REMEDIATED").length, rule: "report only — fixing is a separate approved mission" };

  // ── system friction (patterns only when ≥2) ──
  const codeCounts = attention.reduce<Record<string, number>>((m, o) => ({ ...m, [o.code]: (m[o.code] ?? 0) + 1 }), {});
  const friction = {
    repeatedQuestions: safe("repeated questions", partial, () => repeatedQuestionSignals(src)) ?? [],
    recurringSignals: Object.entries(codeCounts).filter(([, n]) => n >= 2).map(([code, n]) => ({ code, occurrences: n, epistemic: "PATTERN_CANDIDATE" as const })).sort((a, b) => b.occurrences - a.occurrences || a.code.localeCompare(b.code)),
  };

  // ── the default answer: 3–5 observations, one per group in the fixed order (an order of presentation, not priority) ──
  const headline: CompanyObservation[] = [];
  for (const g of ATTENTION_DIMENSIONS) { const o = attention.find((x) => x.group === g && !headline.includes(x)); if (o) headline.push(o); if (headline.length >= 5) break; }
  if (headline.length < 3) for (const o of attention) { if (headline.length >= 3) break; if (!headline.includes(o)) headline.push(o); }

  const executive = {
    today: c.today,
    money: cashflow ? { ilsNet: cashflow.realized.ils.net, position: cashflow.realized.targetPosition, distanceToFloor: cashflow.realized.distanceToFloor, otherCurrencies: Object.keys(cashflow.realized.byCurrency).filter((k) => k !== "₪" && k !== "ILS") } : null,
    openProjects: openProjects.length, clientProjectsOpen: openProjects.filter((p) => p.businessType === "לקוח").length, labelProjectsOpen: openProjects.filter((p) => p.businessType !== "לקוח").length,
    openProposals: c.st?.domains.proposalsFull.data?.items.filter((p) => !["נסגר", "לא נסגר"].includes(p.status)).length ?? null,
    upcomingShows14: (shows ?? []).filter((s) => s.identity.date && s.identity.date >= c.today && s.identity.date <= addDays(c.today, 14) && s.identity.status !== "בוטל").length,
    releasesUpcoming: releaseView.upcoming.length, releaseTargetsPassed: releaseView.targetPassed.length,
    attentionByGroup: byGroup, ownerSide: attention.filter((o) => o.side === "OWNER").length, externalSide: attention.filter((o) => o.side === "EXTERNAL").length,
    decisionsOpen: decisions.filter((d) => d.liveState !== "NO_LONGER_OBSERVED").length,
    headline,
  };

  const morningBrief = {
    date: c.today, calendarStatus: calendar.status, today: calendar.today, attention: headline.slice(0, 3),
    decision: decisions.find((d) => d.liveState !== "NO_LONGER_OBSERVED" && d.origin === "LIVE_QUESTION") ?? decisions.find((d) => d.liveState !== "NO_LONGER_OBSERVED") ?? null,
    money: executive.money,
    note: "on request only — no push, no schedule; personal events are context, never tasks",
  };

  return {
    today: c.today, executive, attention, context, observationsTotal: observations.length, unmappedSignalCodes: [...unmapped].sort(),
    cashflow, label, releases: releaseView, shows: (shows ?? []).filter((s) => s.identity.date && s.identity.date >= c.today && s.identity.status !== "בוטל").sort((a, b) => (a.identity.date ?? "").localeCompare(b.identity.date ?? "")).map((s) => ({ key: s.key, name: s.identity.name, date: s.identity.date, status: s.identity.status, dj: s.dj?.displayName ?? null, djConfirmation: s.dj?.confirmation ?? null, clientPayment: s.money.clientPayment, signals: [...new Set(s.signals.map((x) => x.code))] })),
    production: victor ? { counts: victor.counts } : null, mix: mix ? { counts: mix.counts, money: { owedByCurrency: mix.money.owedByCurrency, orphanExpenses: mix.money.orphanExpenses.length } } : null, video: video ? { counts: video.counts, money: video.money } : null,
    clientWork: { projects: (projects ?? []).filter((p) => p.v.identity?.businessType === "לקוח").map((p) => ({ project: `project:${p.id}`, name: p.v.identity?.name, status: p.v.identity?.status, deadline: p.v.identity?.deadline, verdict: p.v.money?.verdict ?? null, signals: p.v.signals.map((s) => s.code) })).sort((a, b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999")), deadlines: operating?.deadlines ?? null },
    sales: { openProposals: (clients ?? []).flatMap((cl) => cl.proposals.filter((p) => p.open).map((p) => ({ client: cl.identity.name, key: p.key, title: (p as { title?: string | null }).title ?? null, amount: (p as { amount?: number | null }).amount ?? null, currency: (p as { currency?: string | null }).currency ?? null }))), followUpsDue: attention.filter((o) => o.code === "FOLLOW_UP_DUE" || o.code === "OPEN_PROPOSAL_NO_FOLLOW_UP").length, potentialNote: "proposal amounts are POTENTIAL money" },
    team, calendar, delivery, decisions, conflicts, gaps, changes, outcomes, actionMap, security, friction, morningBrief, companyAlerts: companyAlerts.map((a) => ({ type: a.type, severity: a.severity, status: a.status, title: a.title, createdAt: a.createdAt })),
    sourceState, partial,
  };
}
export type CompanyView = ReturnType<typeof buildCompanyView>;
