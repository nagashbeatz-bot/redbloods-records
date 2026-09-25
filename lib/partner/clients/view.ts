/**
 * Sunny — the CONNECTED CLIENT VIEW + CLIENT PORTFOLIO + client workflow resolvers. Pure, read-only.
 *
 * Everything Redbloods records about one client, joined across domains with an honest relationship quality:
 *   proposals (client_id FK)            CANONICAL
 *   projects via a proposal link        CANONICAL (PROPOSAL_CHAIN — two FKs)
 *   projects naming the client          TEXT_MATCH (NAME_EXACT / NAME_COLLABORATION)
 *   meetings / client tasks             CANONICAL by stored id (no FK)
 *   shows (artist / booker / DJ), send-log recipient, Red Films   CANONICAL by stored id
 *   project-less money                  TEXT_MATCH (transactions.artist)
 *   label roster                        TEXT_MATCH by name — a second record of the same person, never merged
 * Money reuses the Finance Brain primitives (projectMoney / validateTx) and keeps REALIZED / EXPECTED / POTENTIAL
 * apart. Signals are derived facts, never a score; stale is not urgent; outside communication is invisible.
 */
import type { GatewaySources } from "../gateway/core";
import type { PartnerCompanyState } from "../eyes/types";
import type { OperationsRaw } from "../operations/types";
import type { ProjectDetailRaw } from "../projects/detail-types";
import type { ClientDetailRaw } from "./detail-types";
import type { OwnerKnowledgeRecord } from "../owner-knowledge/store";
import type { CalendarWindowResult } from "../calendar/types";
import type { CompanyIntegrityRegister } from "../integrity/types";
import { validateTx } from "../finance/core";
import { projectMoney } from "../projects/money";
import { buildCalendarLinkIndex, eventsForEntity, linkCalendarEvent } from "../calendar/links";
import { projectOperating } from "../sunny/operating";
import { CLIENT_VOCABULARIES } from "../system/clients";

const ok = <T,>(a: { status: string; value?: T } | undefined): T | null => (a && a.status === "OK" ? (a as { value: T }).value : null);
const ilToday = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const low = (x: string | null | undefined) => (x ?? "").normalize("NFKC").trim().toLowerCase();
const tokens = (x: string | null | undefined) => (x ?? "").split(/[,،;]/).map((t) => t.trim()).filter(Boolean);
const r2 = (n: number) => Math.round(n * 100) / 100;
const addTo = (m: Record<string, number>, cur: string, n: number) => { m[cur] = r2((m[cur] ?? 0) + n); };
const CLOSED_PROPOSAL = new Set(["נסגר", "לא נסגר"]);
const CLOSED_PROJECT = new Set(["הושלם", "בוטל"]);
const KNOWN_PROPOSAL = new Set<string>(CLIENT_VOCABULARIES.proposalStatuses);
const ACTIVITY_DAYS = 90;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

export type ProjectBasis = "PROPOSAL_CHAIN" | "NAME_EXACT" | "NAME_COLLABORATION";
export interface ClientSignal { code: string; kind: "CANONICAL_FACT" | "DERIVED_SIGNAL" | "UNKNOWN"; he: string; entity?: string }
export interface ClientQuestion { questionHe: string; why: string; kind: string }

interface Ctx { st: PartnerCompanyState | null; ops: OperationsRaw | null; det: ProjectDetailRaw | null; cdet: ClientDetailRaw | null; kn: OwnerKnowledgeRecord[]; cal: CalendarWindowResult | null; integrity: CompanyIntegrityRegister | null; today: string }
function ctxOf(src: GatewaySources): Ctx {
  const st = ok(src.state) as PartnerCompanyState | null;
  return { st, ops: ok(src.operations) as OperationsRaw | null, det: ok(src.projectDetail) as ProjectDetailRaw | null, cdet: ok(src.clientDetail) as ClientDetailRaw | null,
    kn: (ok(src.ownerKnowledge) as OwnerKnowledgeRecord[] | null) ?? [], cal: ok(src.calendar) as CalendarWindowResult | null, integrity: ok(src.integrity) as CompanyIntegrityRegister | null, today: st?.todayIL ?? ilToday(src.now) };
}

/** Every project related to a client, with the basis of the link. */
export function clientProjectLinks(src: GatewaySources, clientId: string) {
  const c = ctxOf(src);
  const client = c.st?.domains.clients.data?.items.find((x) => x.id === clientId);
  if (!client) return [];
  const idx = c.st?.domains.projects.data?.index ?? {};
  const out = new Map<string, { projectId: string; name: string; status: string; businessType: string; basis: ProjectBasis; quality: "CANONICAL_RELATION" | "TEXT_MATCH"; proposalId: string | null; otherArtists: string[] }>();
  for (const p of c.st?.domains.proposalsFull.data?.items ?? []) {
    if (p.clientId !== clientId || !p.linkedProjectId) continue;
    const pr = idx[p.linkedProjectId];
    out.set(p.linkedProjectId, { projectId: p.linkedProjectId, name: pr?.name ?? "(פרויקט שלא נמצא)", status: pr?.status ?? "UNKNOWN", businessType: pr?.businessType ?? "UNKNOWN", basis: "PROPOSAL_CHAIN", quality: "CANONICAL_RELATION", proposalId: p.id, otherArtists: tokens(pr?.artistText).filter((t) => low(t) !== low(client.name)) });
  }
  for (const [id, pr] of Object.entries(idx)) {
    if (out.has(id)) continue;
    const toks = tokens(pr.artistText);
    if (!toks.some((t) => low(t) === low(client.name))) continue;
    const others = toks.filter((t) => low(t) !== low(client.name));
    out.set(id, { projectId: id, name: pr.name, status: pr.status, businessType: pr.businessType, basis: others.length ? "NAME_COLLABORATION" : "NAME_EXACT", quality: "TEXT_MATCH", proposalId: null, otherArtists: others });
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function buildClientView(src: GatewaySources, clientId: string) {
  const c = ctxOf(src);
  const client = c.st?.domains.clients.data?.items.find((x) => x.id === clientId) ?? null;
  if (!client) return null;
  const key = `client:${clientId}`;
  const stored = c.cdet?.clients?.rows.find((x) => x.id === clientId) ?? null;
  const fin = ok(src.finance);
  const unavailable: string[] = [];
  if (!c.det) unavailable.push("PROJECT_DETAIL (meetings, tasks, notes) was not read — those sections are unknown, not empty");
  if (!c.cdet) unavailable.push("CLIENT_DETAIL (contact, client notes, project-less payment text) was not read");
  if (!fin) unavailable.push("FINANCE was not read — money is unknown");

  // ── roles: one person may be several records ──
  const roster = (c.st?.domains.labelArtists.data?.items ?? []).filter((a) => low(a.name) === low(client.name));
  const shows = c.st?.domains.shows.data?.items ?? [];
  const roles = {
    clientRecord: { type: client.type, status: client.status },
    labelArtistRecords: roster.map((a) => ({ key: `label-artist:${a.id}`, name: a.name, link: "TEXT_MATCH (same name — a second record of the same person; never merged)" })),
    showArtist: shows.filter((s) => s.artistClientId === clientId).length,
    showBooker: shows.filter((s) => s.bookerClientId === clientId).length,
    showDj: shows.filter((s) => s.djClientId === clientId).length,
    sendLogRecipient: (c.det?.actions?.rows ?? []).filter((a) => a.recipientClientId === clientId).length,
    redFilms: (c.ops?.redFilms?.rows ?? []).filter((r) => r.clientId === clientId).length,
    ownerLabelClassification: (c.integrity?.learned ?? []).filter((l) => l.status === "APPLIES" && roster.some((a) => l.entityKey === `label-artist:${a.id}`)).map((l) => ({ answer: l.decision.answerCode, question: l.decision.questionType, basis: "OWNER_CONFIRMED" })),
  };

  // ── proposals ──
  const notesById = new Map((c.det?.proposals?.rows ?? []).map((p) => [p.id, p.notes]));
  const followTasks = (c.det?.tasks?.rows ?? []).filter((t) => (t.notes ?? "").includes("[proposal_id:"));
  const projIdx = c.st?.domains.projects.data?.index ?? {};
  const settingOf = (pid: string) => fin?.raw.financeSettings.find((s) => s.projectId === pid) ?? null;
  const proposals = (c.st?.domains.proposalsFull.data?.items ?? []).filter((p) => p.clientId === clientId).map((p) => {
    const open = !CLOSED_PROPOSAL.has(p.status);
    const task = followTasks.find((t) => (t.notes ?? "").includes(`[proposal_id:${p.id}]`)) ?? null;
    const linked = p.linkedProjectId ? projIdx[p.linkedProjectId] ?? null : null;
    const price = p.linkedProjectId ? settingOf(p.linkedProjectId) : null;
    const agreed = price && typeof (price.value as Record<string, unknown>)?.agreedPrice === "number" ? (price.value as Record<string, number>).agreedPrice : null;
    return {
      key: `proposal:${p.id}`, id: p.id, title: p.title, amount: p.amount, currency: p.currency, status: p.status, statusKnown: KNOWN_PROPOSAL.has(p.status), open,
      sent: p.sentYmd, followUp: p.followupYmd, followUpState: !open ? "CLOSED" : !p.followupYmd ? "NO_FOLLOW_UP_DATE" : p.followupYmd < c.today ? "RECORDED_FOLLOW_UP_PASSED" : p.followupYmd === c.today ? "RECORDED_FOLLOW_UP_TODAY" : "UPCOMING",
      followUpTask: task ? { status: task.status, due: task.dueDate, link: "DERIVED_RELATION (text marker)" } : null,
      linkedProject: p.linkedProjectId ? { key: `project:${p.linkedProjectId}`, name: linked?.name ?? null, status: linked?.status ?? null, exists: !!linked } : null,
      agreedPriceOnProject: agreed, amountDiffersFromPrice: agreed !== null && p.amount > 0 && agreed !== p.amount,
      notes: notesById.get(p.id) ?? null, createdAt: p.createdAt, updatedAt: p.updatedAt,
      moneyClass: open ? "POTENTIAL" : "NOT_REVENUE",
    };
  });

  // ── projects + operating assessment ──
  const links = clientProjectLinks(src, clientId);
  const projects = links.map((l) => {
    const a = projectOperating(src, l.projectId);
    return { ...l, key: `project:${l.projectId}`, open: !CLOSED_PROJECT.has(l.status), deadline: a?.clientDeadline.date ?? null, deadlineClass: a?.clientDeadline.class ?? null, advance: a?.advance.state ?? null, ballHolders: a?.ballHolder.holders ?? [], labelWork: a?.label.labelWork ?? null };
  });

  // ── money: REALIZED / EXPECTED / POTENTIAL, per currency, never merged ──
  const realized: Record<string, number> = {}, expected: Record<string, number> = {}, potential: Record<string, number> = {}, collectible: Record<string, number> = {};
  const moneyRows: Array<Record<string, unknown>> = [];
  if (fin) {
    for (const p of projects) {
      const m = projectMoney(fin.raw, { id: p.projectId, status: p.status });
      if (m.song) { addTo(realized, m.price.currency, m.song.received); addTo(expected, m.price.currency, m.song.openExpected); if (m.song.collectible) addTo(collectible, m.price.currency, m.song.collectible); }
      for (const [cur, o] of Object.entries(m.otherCurrencyIncome)) { addTo(realized, cur, o.received); addTo(expected, cur, o.open); }
      if (m.clip) { addTo(realized, m.price.currency, m.clip.paid); addTo(expected, m.price.currency, m.clip.expected); }
      moneyRows.push({ project: p.key, name: p.name, link: p.basis, agreedPrice: m.price.agreed, currency: m.price.currency, received: m.song?.received ?? 0, openExpected: m.song?.openExpected ?? 0, collectible: m.song?.collectible ?? null, verdict: m.verdict, financeException: m.price.exception });
    }
    const textById = new Map((c.cdet?.unlinkedTransactionsText?.rows ?? []).map((t) => [t.id, t]));
    for (const row of fin.raw.transactions.filter((t) => !t.projectId && t.type === "income")) {
      const text = textById.get(row.id);
      if (!text || low(text.artistText) !== low(client.name)) continue;
      const t = validateTx(row);
      if (!t || t.cancelled) continue;
      if (t.received) addTo(realized, t.currency, t.amount); else addTo(expected, t.currency, t.amount);
      moneyRows.push({ transaction: row.id, projectLess: true, link: "ARTIST_TEXT (TEXT_MATCH)", amount: t.amount, currency: t.currency, received: t.received, date: row.date, category: row.category, description: text.description });
    }
  }
  for (const p of proposals.filter((x) => x.open && x.amount > 0)) addTo(potential, p.currency, p.amount);

  // ── meetings / calendar / sessions / tasks / delivery ──
  const meetings = (c.det?.meetings?.rows ?? []).filter((m) => m.clientId === clientId).map((m) => ({
    key: `meeting:${m.id}`, date: m.date, time: m.time, duration: m.duration, location: m.location, status: m.status, project: m.projectId ? `project:${m.projectId}` : null, hasCalendarEvent: m.hasCalendarEvent, notes: m.notes, nameSnapshot: m.clientName,
    state: m.date && m.date >= c.today ? "UPCOMING" : m.status === "נקבעה" ? "PAST_STATUS_NOT_UPDATED" : "PAST", outcome: "NOT_RECORDED (meetings have no outcome field)",
  })).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const calUsable = !!c.cal && (c.cal.status === "CALENDAR_DATA_AVAILABLE" || c.cal.status === "CALENDAR_PARTIAL");
  const calendar = calUsable ? (() => {
    const idx = buildCalendarLinkIndex(c.ops, c.st);
    const linked = c.cal!.events.map((e) => linkCalendarEvent(e, idx));
    const own = eventsForEntity(linked, key);
    const projKeys = new Set(projects.map((p) => p.key));
    const viaProjects = linked.filter((l) => l.edges.some((e) => projKeys.has(e.to)) && !own.canonical.includes(l) && !own.inferred.includes(l));
    const ev = (l: (typeof linked)[number], basis: string) => ({ title: l.event.title, start: l.event.start, allDay: l.event.allDay, quality: l.quality, basis });
    return { status: c.cal!.status, window: c.cal!.window, canonical: own.canonical.map((l) => ev(l, "stored event id (meeting)")), inferred: own.inferred.map((l) => ev(l, "title names the client (TEXT_MATCH)")), ambiguous: own.ambiguous.map((l) => ev(l, "ambiguous title")), viaProjects: viaProjects.map((l) => ev(l, `via a related project (${l.quality})`)) };
  })() : { status: c.cal?.status ?? "NOT_LOADED", note: "calendar not readable — client schedule context unknown (never 'nothing scheduled')" };
  const projIds = new Set(projects.map((p) => p.projectId));
  const sessions = (c.det?.sessions?.rows ?? []).filter((s) => s.projectId && projIds.has(s.projectId)).map((s) => ({ date: s.date, status: s.status, type: s.type, project: `project:${s.projectId}`, link: `via project (${projects.find((p) => p.projectId === s.projectId)?.basis})` })).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const tasks = (c.det?.tasks?.rows ?? []).filter((t) => (t.relatedType === "client" && t.relatedId === clientId) || (t.relatedType === "project" && t.relatedId && projIds.has(t.relatedId))).map((t) => ({
    title: t.title, status: t.status, due: t.dueDate, link: t.relatedType === "client" ? "CANONICAL (task related to the client)" : "via project", proposal: /\[proposal_id:([0-9a-f-]{36})\]/.exec(t.notes ?? "")?.[1] ?? null, notes: t.notes,
  }));
  const deliveries = (c.det?.deliveries?.rows ?? []).filter((d) => projIds.has(d.projectId)).map((d) => ({ project: `project:${d.projectId}`, status: d.status, deliveredAt: d.deliveredAt, hasLink: d.hasLink }));

  // ── notes (evidence) + history (recorded dates only) ──
  const notes = [
    ...(stored?.notes ? [{ source: "client notes", text: stored.notes, at: null }] : []),
    ...proposals.filter((p) => p.notes).map((p) => ({ source: `proposal "${p.title}"`, text: p.notes!, at: p.updatedAt })),
    ...meetings.filter((m) => m.notes).map((m) => ({ source: `meeting ${m.date}`, text: m.notes!, at: m.date })),
    ...tasks.filter((t) => t.notes && !/^\[proposal_id:[^\]]+\]\s*$/.test(t.notes)).map((t) => ({ source: `task "${t.title}"`, text: t.notes!, at: t.due })),
  ];
  const projCreated = new Map((c.det?.projects?.rows ?? []).map((p) => [p.id, p.createdAt]));
  const history = [
    { at: client.createdAt, event: "client record created", recorded: true },
    ...proposals.flatMap((p) => [{ at: p.createdAt, event: `proposal created: ${p.title}`, recorded: true }, ...(p.sent ? [{ at: p.sent, event: `proposal sent: ${p.title}`, recorded: true }] : []), ...(p.updatedAt && p.updatedAt !== p.createdAt ? [{ at: p.updatedAt, event: `proposal last changed (what changed is not recorded): ${p.title}`, recorded: true }] : [])]),
    ...projects.map((p) => ({ at: projCreated.get(p.projectId) ?? null, event: `project created: ${p.name} (${p.basis})`, recorded: true })),
    ...meetings.map((m) => ({ at: m.date, event: `meeting (${m.status})`, recorded: true })),
    ...moneyRows.filter((m) => m.transaction).map((m) => ({ at: (m.date as string) ?? null, event: `project-less income ${m.amount} ${m.currency} (${m.received ? "received" : "expected"})`, recorded: true })),
  ].filter((h) => h.at).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const lastActivity = history.map((h) => String(h.at).slice(0, 10)).filter((d) => d <= c.today).sort().pop() ?? null;

  // ── owner knowledge ──
  const knowledge = c.kn.filter((k) => k.subjectKey === key || k.identityKeys.includes(key) || roster.some((a) => k.subjectKey === `label-artist:${a.id}` || k.identityKeys.includes(`label-artist:${a.id}`))).map((k) => ({ kind: k.kind, meaning: k.meaningHe, epistemic: k.epistemic, subject: k.subjectKey }));

  // ── signals + questions ──
  const signals: ClientSignal[] = [];
  const questions: ClientQuestion[] = [];
  for (const p of proposals) {
    if (p.open) signals.push({ code: "OPEN_PROPOSAL", kind: "CANONICAL_FACT", he: `הצעה פתוחה: ${p.title} (${p.status})`, entity: p.key });
    if (!p.statusKnown) signals.push({ code: "UNKNOWN_PROPOSAL_STATUS", kind: "UNKNOWN", he: `סטטוס לא מוכר: ${p.status}`, entity: p.key });
    if (p.followUpState === "RECORDED_FOLLOW_UP_PASSED" || p.followUpState === "RECORDED_FOLLOW_UP_TODAY") {
      signals.push({ code: "FOLLOW_UP_DUE", kind: "DERIVED_SIGNAL", he: `תאריך הפולואפ הרשום (${p.followUp}) הגיע — לא רואה ב-Redbloods פעילות שנרשמה אחריו.`, entity: p.key });
      questions.push({ kind: "FOLLOW_UP", questionHe: `ההצעה "${p.title}" — היה קשר עם הלקוח מחוץ למערכת? מה המצב שלה?`, why: "recorded follow-up date passed; WhatsApp / phone contact is invisible to Redbloods" });
    }
    if (p.open && !p.followUp) signals.push({ code: "OPEN_PROPOSAL_NO_FOLLOW_UP", kind: "CANONICAL_FACT", he: `להצעה "${p.title}" אין תאריך פולואפ.`, entity: p.key });
    if (p.status === "לחזור בעתיד") signals.push({ code: "RETURN_LATER", kind: "CANONICAL_FACT", he: `"${p.title}" מסומנת 'לחזור בעתיד'.`, entity: p.key });
    if (p.linkedProject) signals.push({ code: "PROPOSAL_CONVERTED", kind: "CANONICAL_FACT", he: `"${p.title}" הפכה לפרויקט.`, entity: p.key });
    if (p.status === "נסגר" && !p.linkedProject) { signals.push({ code: "PROPOSAL_CLOSED_WITHOUT_PROJECT", kind: "CANONICAL_FACT", he: `"${p.title}" סומנה נסגר בלי פרויקט מקושר.`, entity: p.key }); questions.push({ kind: "CONVERSION", questionHe: `ההצעה "${p.title}" סגורה בלי פרויקט — לפתוח פרויקט, או שהעבודה רשומה במקום אחר?`, why: "closed status without conversion evidence" }); }
    if (p.amountDiffersFromPrice) signals.push({ code: "PROPOSAL_AMOUNT_DIFFERS_FROM_PRICE", kind: "CANONICAL_FACT", he: `סכום ההצעה (${p.amount}) שונה מהמחיר המוסכם בפרויקט (${p.agreedPriceOnProject}) — הסיבה לא רשומה.`, entity: p.key });
  }
  for (const m of meetings) {
    if (m.state === "UPCOMING") signals.push({ code: "MEETING_UPCOMING", kind: "CANONICAL_FACT", he: `פגישה ב-${m.date}${m.time ? ` ${m.time}` : ""}`, entity: m.key });
    if (m.state === "PAST_STATUS_NOT_UPDATED") signals.push({ code: "MEETING_STATUS_NOT_UPDATED", kind: "DERIVED_SIGNAL", he: `הפגישה מ-${m.date} עדיין 'נקבעה' — לא ידוע אם התקיימה.`, entity: m.key });
  }
  for (const p of projects) {
    if (p.open) signals.push({ code: "ACTIVE_CLIENT_PROJECT", kind: "CANONICAL_FACT", he: `פרויקט פתוח: ${p.name} (${p.status}; קישור ${p.basis})`, entity: p.key });
    if (p.open && (p.deadlineClass === "APPROACHING" || p.deadlineClass === "AT_RISK")) signals.push({ code: "CLIENT_DEADLINE_APPROACHING", kind: "DERIVED_SIGNAL", he: `${p.name}: ${p.deadlineClass} (${p.deadline})`, entity: p.key });
    if (p.open && p.deadlineClass === "HISTORICAL_OPERATIONAL_DEBT") signals.push({ code: "HISTORICAL_DEADLINE_DEBT", kind: "DERIVED_SIGNAL", he: `${p.name}: דדליין ישן (${p.deadline}) — חוב תפעולי היסטורי, לא חירום חדש.`, entity: p.key });
    if (p.open && p.advance === "ADVANCE_EVIDENCE_MISSING") { signals.push({ code: "PAYMENT_EVIDENCE_MISSING", kind: "DERIVED_SIGNAL", he: `${p.name}: העבודה התקדמה ואין תשלום שהתקבל רשום.`, entity: p.key }); questions.push({ kind: "PAYMENT_EVIDENCE", questionHe: `"${p.name}" התקדם ואין מקדמה רשומה — התקבלה מקדמה?`, why: "Owner pattern: advance at the start; nothing recorded (no amount assumed)" }); }
    if (p.basis === "NAME_COLLABORATION") signals.push({ code: "IDENTITY_COLLABORATION", kind: "DERIVED_SIGNAL", he: `${p.name}: שיתוף עם ${p.otherArtists.join(", ")} — הקישור לפי שם.`, entity: p.key });
  }
  if (Object.values(collectible).some((v) => v > 0)) signals.push({ code: "RECEIVABLE_EXISTS", kind: "DERIVED_SIGNAL", he: `יתרה לגבייה לפי מחיר מוסכם: ${Object.entries(collectible).map(([k, v]) => `${v} ${k}`).join(", ")}` });
  if (roster.length) signals.push({ code: "IDENTITY_DUAL_ROLE", kind: "CANONICAL_FACT", he: `${client.name} קיים גם כלקוח וגם כאמן לייבל — שתי רשומות של אותו אדם (לפי שם).` });
  if (projects.some((p) => p.open && p.labelWork === false) || proposals.some((p) => p.open)) signals.push({ code: "DEAL_TERMS_UNKNOWN", kind: "UNKNOWN", he: "תנאי העסקה (מקדמה / מתי יתרה) לא נרשמים ב-Redbloods." });
  if (!lastActivity || daysBetween(lastActivity, c.today) > ACTIVITY_DAYS) signals.push({ code: "NO_RECENT_RECORDED_ACTIVITY", kind: "DERIVED_SIGNAL", he: `אין פעילות רשומה ${lastActivity ? `מאז ${lastActivity}` : "בכלל"} — זה לא אומר שאין קשר, ולא דחוף.` });

  return {
    key, found: true as const,
    identity: { id: client.id, name: client.name, type: client.type, status: client.status, statusMeaning: "one field mixing lifecycle / tier / role (חדש is also the auto-create default)", createdAt: client.createdAt },
    contact: stored ? { phone: stored.phone, email: stored.email, hasPhone: !!stored.phone, hasEmail: !!stored.email } : null,
    roles, proposals, projects, money: fin ? { realized, expected, collectible, potential, rows: moneyRows, rule: "REALIZED = received rows; EXPECTED = open (not received, not cancelled) rows; POTENTIAL = open proposal amounts — never added together; per currency" } : null,
    meetings, calendar, sessions, tasks, deliveries, notes, history, lastRecordedActivity: lastActivity, ownerKnowledge: knowledge, signals, questions, unavailable,
  };
}

export type ClientView = NonNullable<ReturnType<typeof buildClientView>>;

/** Company-level customer picture: facts per client — no ranking, no likelihood. */
export function clientPortfolio(src: GatewaySources) {
  const c = ctxOf(src);
  const clients = c.st?.domains.clients.data?.items ?? [];
  const rows = clients.map((cl) => {
    const v = buildClientView(src, cl.id)!;
    return { key: v.key, name: cl.name, type: cl.type, status: cl.status, openProposals: v.proposals.filter((p) => p.open).length, proposals: v.proposals.length, projects: v.projects.length, openProjects: v.projects.filter((p) => p.open).length,
      canonicalProjects: v.projects.filter((p) => p.basis === "PROPOSAL_CHAIN").length, realized: v.money?.realized ?? null, expected: v.money?.expected ?? null, collectible: v.money?.collectible ?? null, potential: v.money?.potential ?? null,
      upcomingMeetings: v.meetings.filter((m) => m.state === "UPCOMING").length, lastRecordedActivity: v.lastRecordedActivity, repeat: v.projects.length + v.proposals.filter((p) => !p.linkedProject).length >= 2, signals: [...new Set(v.signals.map((s) => s.code))] };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const sum = (pick: (r: (typeof rows)[number]) => Record<string, number> | null) => rows.reduce<Record<string, number>>((m, r) => { for (const [k, v] of Object.entries(pick(r) ?? {})) addTo(m, k, v); return m; }, {});
  return { rows, totals: { clients: rows.length, withOpenWork: rows.filter((r) => r.openProjects > 0).length, withOpenProposals: rows.filter((r) => r.openProposals > 0).length, repeatClients: rows.filter((r) => r.repeat).length, realized: sum((r) => r.realized), expected: sum((r) => r.expected), collectible: sum((r) => r.collectible), potential: sum((r) => r.potential) } };
}

/** "יש לי לקוח חדש שרוצה 3 שירים" / "שלחתי לו הצעה" — what is known, what to ask, next step. Nothing is created. */
export function clientWorkflow(src: GatewaySources, event: "NEW_CLIENT_REQUEST" | "PROPOSAL_SENT", o: { client?: string | null; name?: string | null; request?: string | null }) {
  const c = ctxOf(src);
  const byKey = o.client ? c.st?.domains.clients.data?.items.find((x) => `client:${x.id}` === o.client) ?? null : null;
  const byName = !byKey && o.name ? (c.st?.domains.clients.data?.items ?? []).filter((x) => low(x.name) === low(o.name)) : [];
  const partial = !byKey && o.name && !byName.length ? (c.st?.domains.clients.data?.items ?? []).filter((x) => low(x.name).includes(low(o.name)) || low(o.name).includes(low(x.name))) : [];
  const roster = o.name ? (c.st?.domains.labelArtists.data?.items ?? []).filter((a) => low(a.name) === low(o.name)) : [];
  const client = byKey ?? (byName.length === 1 ? byName[0] : null);
  const known: Array<{ item: string; value: unknown; source: string }> = [];
  const ask: ClientQuestion[] = [];
  const identity = client ? "EXISTING_CLIENT" : partial.length ? "SIMILAR_NAMES_AMBIGUOUS" : o.name ? "NEW_NAME" : "NOT_GIVEN";
  if (!client && !o.name) ask.push({ kind: "IDENTITY", questionHe: "מה שם הלקוח?", why: "no client was named" });
  if (!client && partial.length) ask.push({ kind: "IDENTITY", questionHe: `התכוונת ל${partial.map((p) => p.name).join(" / ")}, או לקוח חדש?`, why: "similar existing names — never guessed" });
  if (roster.length) known.push({ item: "label roster", value: roster.map((a) => `label-artist:${a.id}`), source: "CANONICAL_DATA (same name — label vs client work is an Owner classification)" });
  let view: ClientView | null = null;
  if (client) {
    view = buildClientView(src, client.id);
    known.push({ item: "client", value: { key: `client:${client.id}`, name: client.name, type: client.type, status: client.status }, source: "CANONICAL_DATA" });
    known.push({ item: "open proposals", value: view?.proposals.filter((p) => p.open).map((p) => ({ key: p.key, title: p.title, status: p.status, followUp: p.followUp })) ?? [], source: "CANONICAL_DATA" });
    known.push({ item: "open projects", value: view?.projects.filter((p) => p.open).map((p) => ({ key: p.key, name: p.name, link: p.basis })) ?? [], source: "CANONICAL_DATA" });
  }
  const open = view?.proposals.filter((p) => p.open) ?? [];
  if (event === "NEW_CLIENT_REQUEST") {
    ask.push({ kind: "DEAL", questionHe: "מה המחיר (ובאיזה מטבע)?", why: "a proposal needs an amount; Sunny never invents a price" });
    ask.push({ kind: "DEAL", questionHe: "הצעה אחת לכל השירים, או הצעה לכל שיר?", why: "Redbloods has no package model — one proposal = one title + one amount" });
    ask.push({ kind: "DEAL", questionHe: "סוכמה מקדמה? כמה, ומתי היתרה?", why: "deal terms are not recorded in Redbloods (asked, never assumed)" });
    ask.push({ kind: "FOLLOW_UP", questionHe: "מתי לחזור אליו?", why: "the app would default the follow-up to 3 days" });
  } else if (client && open.length === 0) {
    ask.push({ kind: "PROPOSAL", questionHe: "לא רואה הצעה פתוחה ללקוח ב-Redbloods — מה נשלח (כותרת, מחיר, מטבע) ומתי לחזור אליו?", why: "no open proposal is recorded for this client" });
  } else if (client && open.some((p) => !p.followUp)) {
    ask.push({ kind: "FOLLOW_UP", questionHe: "מתי לעשות פולואפ?", why: "an open proposal has no follow-up date" });
  }
  return {
    event, identity, client: client ? `client:${client.id}` : null, known, ask,
    nextStep: event === "NEW_CLIENT_REQUEST"
      ? (client ? "CREATE_PROPOSAL for the existing client (Owner does it in the client drawer; Sunny proposes the exact fields — FUTURE_PRIMITIVE_REQUIRED)" : "CREATE_CLIENT, then CREATE_PROPOSAL (Owner, Clients page; FUTURE_PRIMITIVE_REQUIRED)")
      : (open.length ? "report the recorded proposal state; update status / follow-up if the Owner wants (UPDATE_PROPOSAL — FUTURE_PRIMITIVE_REQUIRED)" : "record the proposal (CREATE_PROPOSAL — Owner, client drawer)"),
    mutations: "none — Sunny proposes; the Owner approves; no client / proposal primitive is executable today",
  };
}
