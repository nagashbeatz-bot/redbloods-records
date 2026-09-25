/**
 * Sunny — the CONNECTED LABEL ARTIST VIEW + ARTIST PORTFOLIO + next-step reasoning. Pure, read-only.
 *
 * One label artist across the company, with honest relationship quality:
 *   releases (artist id)                          CANONICAL — the only canonical artist ↔ project link
 *   projects naming the artist                    TEXT_MATCH (single / collaboration) + label classification
 *   ledger / cycles / media income (artist id)    CANONICAL — three separate money records, never merged
 *   portal / beats (fixed name → slug table)      CANONICAL (app constant) / DERIVED
 *   client record, shows (via client), Red Films, social (name)   TEXT_MATCH
 *   CLEANTONE DJ shows (app's fixed client id)    CANONICAL
 * Project work (Victor, engineers, sessions, release, delivery) reuses the connected project view and the Owner
 * operating model — no second rule. No score, no cadence target, no activity threshold: evidence + dates only.
 */
import type { GatewaySources } from "../gateway/core";
import type { PartnerCompanyState } from "../eyes/types";
import type { OperationsRaw } from "../operations/types";
import type { ProjectDetailRaw } from "../projects/detail-types";
import type { LabelDetailRaw, DetailShow } from "./detail-types";
import type { SettingsState } from "../settings/types";
import type { OwnerKnowledgeRecord } from "../owner-knowledge/store";
import type { CalendarWindowResult } from "../calendar/types";
import type { CompanyIntegrityRegister } from "../integrity/types";
import { projectMoney } from "../projects/money";
import { buildProjectView } from "../projects/view";
import { projectOperating } from "../sunny/operating";
import { buildCalendarLinkIndex, eventsForEntity, linkCalendarEvent } from "../calendar/links";
import { PORTAL_ARTISTS } from "../../red-artists/portal-registry";

const ok = <T,>(a: { status: string; value?: T } | undefined): T | null => (a && a.status === "OK" ? (a as { value: T }).value : null);
const ilToday = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const low = (x: string | null | undefined) => (x ?? "").normalize("NFKC").trim().toLowerCase();
const tokens = (x: string | null | undefined) => (x ?? "").split(/[,،;]/).map((t) => t.trim()).filter(Boolean);
const r2 = (n: number) => Math.round(n * 100) / 100;
const CLOSED_PROJECT = new Set(["הושלם", "בוטל"]);
const INACTIVE_STAGES = new Set(["יצא", "בהשהייה"]);
const SHOW_ACTIVE = new Set(["נסגר", "אושרה", "בוצע"]);
const LOGIN_ROLE: Record<string, string> = { "shalev-tasama": "shalev", "avi-molla": "avi", "dj-cleantone": "cleantone" };

export interface ArtistSignal { code: string; kind: "CANONICAL_FACT" | "DERIVED_SIGNAL" | "UNKNOWN"; he: string; entity?: string }
export interface ArtistQuestion { questionHe: string; why: string; kind: string }

interface Ctx { st: PartnerCompanyState | null; ops: OperationsRaw | null; det: ProjectDetailRaw | null; ld: LabelDetailRaw | null; settings: SettingsState | null; kn: OwnerKnowledgeRecord[]; cal: CalendarWindowResult | null; integrity: CompanyIntegrityRegister | null; today: string; cleantoneClientId: string | null }
function ctxOf(src: GatewaySources): Ctx {
  const st = ok(src.state) as PartnerCompanyState | null;
  return { st, ops: ok(src.operations) as OperationsRaw | null, det: ok(src.projectDetail) as ProjectDetailRaw | null, ld: ok(src.labelDetail) as LabelDetailRaw | null, settings: ok(src.settings) as SettingsState | null,
    kn: (ok(src.ownerKnowledge) as OwnerKnowledgeRecord[] | null) ?? [], cal: ok(src.calendar) as CalendarWindowResult | null, integrity: ok(src.integrity) as CompanyIntegrityRegister | null, today: st?.todayIL ?? ilToday(src.now), cleantoneClientId: src.identities?.cleantone?.clientId ?? null };
}
const settingRows = (c: Ctx, family: string) => c.settings?.families[family]?.rows ?? null;

/** The balance-cycle window rule of the app (anchor + 2-month windows, end exclusive; current = max(today's index, closed count)). */
function addMonths(ymd: string, m: number) { const [y, mo, d] = ymd.split("-").map(Number); const t = new Date(Date.UTC(y, mo - 1 + m, d)); return t.toISOString().slice(0, 10); }
export function cycleWindow(anchor: string, today: string, closedCount: number) {
  let idx = 0;
  while (addMonths(anchor, 2 * (idx + 1)) <= today && idx < 600) idx++;
  const index = Math.max(today < anchor ? 0 : idx, closedCount);
  return { index, start: addMonths(anchor, 2 * index), endExclusive: addMonths(anchor, 2 * (index + 1)) };
}

export function buildArtistView(src: GatewaySources, artistId: string) {
  const c = ctxOf(src);
  const eyes = c.st?.domains.labelArtists.data?.items.find((a) => a.id === artistId) ?? null;
  const rec = c.ld?.artists?.rows.find((a) => a.id === artistId) ?? null;
  const name = eyes?.name ?? rec?.name ?? null;
  if (!name) return null;
  const key = `label-artist:${artistId}`;
  const slug = PORTAL_ARTISTS[name]?.slug ?? null;
  const fin = ok(src.finance);
  const unavailable: string[] = [];
  if (!c.ld) unavailable.push("LABEL_DETAIL (ledger text, cycles, media income, beats, shows in full) was not read — those sections are unknown, not empty");
  if (!c.det) unavailable.push("PROJECT_DETAIL (sessions, tasks, meetings, release notes) was not read");
  if (!c.settings) unavailable.push("SETTINGS (availability, presence, cycle anchor, sent markers) was not read");
  if (!fin) unavailable.push("FINANCE was not read — project money unknown");

  // ── identity / roles ──
  const clientRecords = (c.st?.domains.clients.data?.items ?? []).filter((x) => low(x.name) === low(name));
  const isCleantone = !!src.identities?.cleantone && low(src.identities.cleantone.labelArtistName) === low(name);
  const ownerLabel = (c.integrity?.learned ?? []).filter((l) => l.status === "APPLIES" && l.entityKey === key).map((l) => ({ question: l.decision.questionType, answer: l.decision.answerCode, basis: "OWNER_CONFIRMED" }));
  const identity = { key, name, status: rec?.status ?? eyes?.status ?? null, hasImage: rec?.hasImage ?? null, notes: rec?.notes ?? null, createdAt: rec?.createdAt ?? eyes?.createdAt ?? null, updatedAt: rec?.updatedAt ?? eyes?.updatedAt ?? null,
    portal: slug ? { slug, loginRole: LOGIN_ROLE[slug] ?? "NONE (portal page, no login)", link: "CANONICAL (app name → slug table)" } : { slug: null, loginRole: "NONE", link: "no portal (name not in the app's slug table)" },
    clientRecords: clientRecords.map((x) => ({ key: `client:${x.id}`, type: x.type, status: x.status, link: "TEXT_MATCH (same name — a separate record of the same person; never merged; client money stays client money)" })),
    labelDj: isCleantone ? { clientId: src.identities!.cleantone!.clientId, link: "CANONICAL (app identity)" } : null, ownerLabelClassification: ownerLabel };
  const labelWorkByOwner = ownerLabel.some((o) => o.answer === "LABEL_SONGS");

  // ── projects: releases (canonical) + by name (text) ──
  const idx = c.st?.domains.projects.data?.index ?? {};
  const releases = (c.st?.domains.releasesFull.data?.items ?? []).filter((r) => r.labelArtistId === artistId);
  const relDetail = new Map((c.det?.releases?.rows ?? []).map((r) => [r.projectId, r]));
  const projMap = new Map<string, { basis: "RELEASE" | "NAME_EXACT" | "NAME_COLLABORATION"; quality: "CANONICAL_RELATION" | "TEXT_MATCH" }>();
  for (const r of releases) projMap.set(r.projectId, { basis: "RELEASE", quality: "CANONICAL_RELATION" });
  for (const [id, p] of Object.entries(idx)) {
    if (projMap.has(id)) continue;
    const t = tokens(p.artistText);
    if (t.some((x) => low(x) === low(name))) projMap.set(id, { basis: t.length > 1 ? "NAME_COLLABORATION" : "NAME_EXACT", quality: "TEXT_MATCH" });
  }
  const projects = [...projMap.entries()].map(([pid, l]) => {
    const p = idx[pid];
    const v = buildProjectView(src, pid);
    const a = projectOperating(src, pid);
    const labelWork = p?.businessType === "לייבל" || l.basis === "RELEASE" || labelWorkByOwner;
    return { key: `project:${pid}`, id: pid, name: p?.name ?? v.identity?.name ?? "(לא נמצא)", status: p?.status ?? v.identity?.status ?? null, businessType: p?.businessType ?? null, basis: l.basis, quality: l.quality,
      labelWork, labelBasis: p?.businessType === "לייבל" ? "STORED_BUSINESS_TYPE" : l.basis === "RELEASE" ? "RELEASE_ROW" : labelWorkByOwner ? "OWNER_CONFIRMED (Company Integrity)" : "CLIENT_WORK_OR_UNCLASSIFIED",
      open: !CLOSED_PROJECT.has(p?.status ?? ""), deadline: a?.clientDeadline.date ?? null, deadlineClass: a?.clientDeadline.class ?? null, internalDeadlines: a?.internalDeadlines ?? [], ballHolders: a?.ballHolder.holders ?? [], ballEvidence: a?.ballHolder.evidence ?? [],
      victor: v.work.victor, engineers: v.work.engineers, sessions: v.work.sessions, delivery: v.work.delivery, redFilms: v.work.redFilms, social: v.work.social, clipPlanning: v.work.clipPlanning, waiting: v.work.projectActions, tasksOpen: v.work.tasksOpen };
  }).sort((a, b) => Number(b.open) - Number(a.open) || a.name.localeCompare(b.name));

  // ── releases ──
  const releaseRows = releases.map((r) => {
    const d = relDetail.get(r.projectId);
    const active = !INACTIVE_STAGES.has(r.stage);
    return { key: `release:${r.projectId}`, project: `project:${r.projectId}`, projectName: idx[r.projectId]?.name ?? null, stage: r.stage, active, targetDate: r.targetYmd, releasedAt: r.releasedAt, stageSince: r.stageEnteredAt,
      nextAction: d?.nextAction ?? null, blocker: d?.blocker ?? null, responsible: d?.responsible ?? null, targetPassed: active && !!r.targetYmd && r.targetYmd < c.today, link: "CANONICAL (artist id)" };
  }).sort((a, b) => (a.targetDate ?? "9999").localeCompare(b.targetDate ?? "9999"));
  const nextRelease = releaseRows.filter((r) => r.active && r.targetDate && r.targetDate >= c.today)[0] ?? null;
  const releasedDates = releaseRows.map((r) => r.releasedAt).filter((x): x is string => !!x).sort();

  // ── beats ──
  const beats = slug ? (c.ld?.beats?.rows ?? []).filter((b) => b.assignedTo.some((a) => a.artistSlug === slug)).map((b) => ({ name: b.name, genre: b.genre, key: b.musicalKey, status: b.status, assignedAt: b.assignedTo.find((a) => a.artistSlug === slug)?.at ?? null, durationSeconds: b.durationSeconds, path: b.path, link: "DERIVED (portal slug)" })) : [];

  // ── shows ──
  const clientIds = new Set(clientRecords.map((x) => x.id));
  const showRows = (c.ld?.shows?.rows ?? []);
  const mapShow = (s: DetailShow, role: "ARTIST" | "DJ") => {
    const rehearsals = (c.det?.sessions?.rows ?? []).filter((x) => x.showId === s.id);
    const net = Math.max(0, (s.price ?? 0) - (s.djFee ?? 0));
    const notify = (fam: string) => { const rows = settingRows(c, fam); return rows === null ? "UNKNOWN" : rows.some((r) => r.key.endsWith(`:${s.id}`)) ? "SENT" : "NOT_SENT"; };
    return { key: `show:${s.id}`, role, name: s.name, date: s.date, time: s.startTime, location: s.location, status: s.status, paymentStatus: s.paymentStatus, price: s.price, djFee: s.djFee, artistFee: s.artistFee, advancePayment: s.advancePayment,
      splitNote: `net before rehearsals = ${r2(net)} (price − DJ fee); artist fee = half of net after counted rehearsal costs (stored artist fee ${s.artistFee ?? "—"})`, currency: "NOT_STORED (screens show ₪)",
      dj: s.djClientId ? { client: `client:${s.djClientId}`, name: s.djName, isLabelDj: s.djClientId === c.cleantoneClientId, confirmation: s.djConfirmationStatus ?? "NONE" } : null,
      booker: s.bookerClientId ? `client:${s.bookerClientId}` : s.bookerName, rehearsals: rehearsals.map((x) => ({ date: x.date, status: x.status })), hasCalendarEvent: s.hasCalendarEvent,
      sentToArtist: notify("SHOW_SENT_TO_ARTIST"), sentToDj: s.djClientId ? notify("SHOW_SENT_TO_DJ") : "NO_DJ", upcoming: !!s.date && s.date >= c.today, notes: s.notes,
      link: role === "DJ" ? "CANONICAL (label DJ id)" : "TEXT_MATCH (show artist → client record of the same name)" };
  };
  const shows = [...showRows.filter((s) => s.artistClientId && clientIds.has(s.artistClientId)).map((s) => mapShow(s, "ARTIST")), ...(isCleantone ? showRows.filter((s) => s.djClientId && s.djClientId === c.cleantoneClientId).map((s) => mapShow(s, "DJ")) : [])]
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

  // ── money: ledger / cycles / media / label-work projects — separate, never merged ──
  const ledger = (c.ld?.ledger?.rows ?? []).filter((e) => e.artistId === artistId).sort((a, b) => (b.entryDate ?? "").localeCompare(a.entryDate ?? ""));
  const sum = (t: string, rows = ledger) => r2(rows.filter((e) => e.entryType === t).reduce((s, e) => s + (e.amount ?? 0), 0));
  const totals = (rows = ledger) => ({ income: sum("הכנסות", rows), expectedIncome: sum("הכנסות צפויות", rows), payments: sum("תשלומים", rows), expenses: sum("הוצאות", rows), expectedExpenses: sum("הוצאות צפויות", rows), balance: r2(sum("הכנסות", rows) - sum("תשלומים", rows) - sum("הוצאות", rows)) });
  const cycles = (c.ld?.cycles?.rows ?? []).filter((y) => y.artistId === artistId).sort((a, b) => (a.cycleIndex ?? 0) - (b.cycleIndex ?? 0));
  const anchorRow = settingRows(c, "ARTIST_BALANCE_CYCLE_ANCHOR")?.find((r) => r.key === `balance_cycle_anchor:${artistId}`) ?? null;
  const anchor = anchorRow && typeof (anchorRow.value as Record<string, unknown>)?.anchorDate === "string" ? String((anchorRow.value as Record<string, unknown>).anchorDate) : null;
  const win = anchor ? cycleWindow(anchor, c.today, cycles.length) : null;
  const media = (c.ld?.mediaIncome?.rows ?? []).filter((m) => m.artistId === artistId).sort((a, b) => (b.receivedDate ?? b.createdAt ?? "").localeCompare(a.receivedDate ?? a.createdAt ?? ""));
  const signed = (m: (typeof media)[number], f: "grossAmount" | "labelShare" | "artistShareGross" | "artistPayable") => (m.recordType === "reversal" ? -1 : 1) * (m[f] ?? 0);
  const received = media.filter((m) => m.status === "התקבל");
  const lastRecoupAfter = received.filter((m) => m.recordType === "income").sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))[0]?.recoupAfter ?? null;
  const labelWorkMoney: Record<string, { received: number; openExpected: number; agreed: number | null }[]> = {};
  if (fin) for (const p of projects.filter((x) => x.labelWork)) {
    const m = projectMoney(fin.raw, { id: p.id, status: p.status ?? "" });
    (labelWorkMoney[m.price.currency] ??= []).push({ received: m.song?.received ?? 0, openExpected: m.song?.openExpected ?? 0, agreed: m.price.agreed });
  }
  const money = {
    currencyRule: "the artist ledger, cycles, media income and shows store NO currency (screens show ₪); project finance rows carry their own currency — nothing is added across these",
    ledger: ledger.length || c.ld ? { entries: ledger.length, allTime: totals(), formula: "balance = income − payments − expenses (expected rows shown, not counted)", fromShows: ledger.filter((e) => e.sourceShowId || e.sourceTxId).length, rows: ledger.slice(0, 40).map((e) => ({ type: e.entryType, amount: e.amount, date: e.entryDate, description: e.description, note: e.note, source: e.sourceShowId ? `show:${e.sourceShowId}` : e.sourceTxId ? "show artist-fee finance row" : "manual" })) } : null,
    cycles: { anchor, anchorSource: anchorRow ? "settings" : c.settings ? "NOT_SET" : "UNKNOWN", closed: cycles.map((y) => ({ index: y.cycleIndex, start: y.startDate, endExclusive: y.endDate, income: y.income, payments: y.payments, expenses: y.expenses, endingBalance: y.endingBalance, closedAt: y.closedAt })),
      current: win ? { ...win, totals: totals(ledger.filter((e) => !!e.entryDate && e.entryDate >= win.start && e.entryDate < win.endExclusive)), rule: "app rule: 2-month windows from the anchor; early close advances the cycle" } : null },
    mediaIncome: { records: media.length, receivedGross: r2(received.reduce((s, m) => s + signed(m, "grossAmount"), 0)), receivedArtistShare: r2(received.reduce((s, m) => s + signed(m, "artistShareGross"), 0)), receivedLabelShare: r2(received.reduce((s, m) => s + signed(m, "labelShare"), 0)), artistPayable: r2(received.reduce((s, m) => s + signed(m, "artistPayable"), 0)), expected: media.filter((m) => m.status === "צפוי").length, lastRecoupAfter,
      rows: media.map((m) => ({ type: m.recordType, status: m.status, gross: m.grossAmount, source: m.source, period: m.reportPeriod, received: m.receivedDate, labelShare: m.labelShare, artistShare: m.artistShareGross, recoupBefore: m.recoupBefore, recouped: m.recouped, payable: m.artistPayable, recoupAfter: m.recoupAfter, notes: m.notes })),
      note: "stored split + recoup snapshots written by the server at record time; media income never touches the ledger" },
    recoup: "the label page derives recoup (artist half of active clip budgets vs paid show artist fees + received media artist share) — not stored, not reconciled with the ledger; Sunny shows the inputs, never a second formula result",
    labelWorkProjects: fin ? labelWorkMoney : null,
    clientWork: "the same person's client-work projects are NOT artist money (client_view)",
  };

  // ── sessions / calendar / tasks / meetings ──
  const projIds = new Set(projects.map((p) => p.id));
  const sessions = (c.det?.sessions?.rows ?? []).filter((s) => (s.projectId && projIds.has(s.projectId)) || (s.showId && shows.some((x) => x.key === `show:${s.showId}`)))
    .map((s) => ({ date: s.date, start: s.startTime, status: s.status, type: s.type, project: s.projectId ? `project:${s.projectId}` : null, show: s.showId ? `show:${s.showId}` : null, hasCalendarEvent: s.hasCalendarEvent, link: s.projectId ? "via project" : "via show (rehearsal)" }))
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const calUsable = !!c.cal && (c.cal.status === "CALENDAR_DATA_AVAILABLE" || c.cal.status === "CALENDAR_PARTIAL");
  const calendar = calUsable ? (() => {
    const li = buildCalendarLinkIndex(c.ops, c.st);
    const linked = c.cal!.events.map((e) => linkCalendarEvent(e, li));
    const keys = new Set([key, ...projects.map((p) => p.key), ...shows.map((s) => s.key), ...clientRecords.map((x) => `client:${x.id}`)]);
    const rel = linked.filter((l) => l.edges.some((e) => keys.has(e.to)));
    const own = eventsForEntity(linked, key);
    return { status: c.cal!.status, window: c.cal!.window, events: rel.map((l) => ({ title: l.event.title, start: l.event.start, allDay: l.event.allDay, quality: l.quality, via: l.edges.filter((e) => keys.has(e.to)).map((e) => e.to) })), ambiguous: own.ambiguous.map((l) => ({ title: l.event.title, start: l.event.start })) };
  })() : { status: c.cal?.status ?? "NOT_LOADED", note: "calendar not readable — the artist's schedule is UNKNOWN (never 'nothing scheduled')" };
  const tasks = (c.det?.tasks?.rows ?? []).filter((t) => (t.relatedType === "project" && t.relatedId && projIds.has(t.relatedId)) || (t.relatedType === "client" && t.relatedId && clientIds.has(t.relatedId)) || (t.showId && shows.some((s) => s.key === `show:${t.showId}`)))
    .map((t) => ({ title: t.title, status: t.status, due: t.dueDate, link: t.relatedType === "project" ? "via project" : t.relatedType === "client" ? "via the artist's client record" : "via show" }));
  const meetings = (c.det?.meetings?.rows ?? []).filter((m) => (m.clientId && clientIds.has(m.clientId)) || (m.projectId && projIds.has(m.projectId))).map((m) => ({ date: m.date, status: m.status, notes: m.notes, link: m.clientId && clientIds.has(m.clientId) ? "via the artist's client record" : "via project" }));

  // ── clips / Red Films / social (name or project) ──
  const redFilms = (c.ops?.redFilms?.rows ?? []).filter((r) => (r.projectId && projIds.has(r.projectId)) || tokens(r.artistName).some((t) => low(t) === low(name)))
    .map((r) => ({ title: r.title, type: r.productionType, status: r.status, shootDate: r.shootDate, publishDate: r.publishDate, editStatus: r.editStatus, budget: r.generalBudget, project: r.projectId ? `project:${r.projectId}` : null, link: r.projectId && projIds.has(r.projectId) ? "via project" : "TEXT_MATCH (artist name)" }));
  const campaigns = (c.ops?.campaigns?.rows ?? []).filter((k) => (k.projectId && projIds.has(k.projectId)) || tokens(k.artistName).some((t) => low(t) === low(name)));
  const social = campaigns.map((k) => ({ title: k.title, status: k.status, releaseDate: k.releaseDate, items: (c.ops?.contentItems?.rows ?? []).filter((i) => i.campaignId === k.id).map((i) => ({ type: i.contentType, platform: i.platform, status: i.status, due: i.dueDate, publish: i.publishDate })), link: k.projectId && projIds.has(k.projectId) ? "via project" : "TEXT_MATCH (artist name)" }));

  // ── availability / presence / pushes (settings) ──
  const availKey = slug === "shalev-tasama" ? "shalev_weekly_availability" : slug ? `weekly_availability_${slug}` : null;
  const availRow = availKey ? settingRows(c, "ARTIST_WEEKLY_AVAILABILITY")?.find((r) => r.key === availKey) ?? null : null;
  const av = availRow?.value as { days?: Array<{ day?: string; date?: string; available?: boolean; from?: string }>; sentBy?: string; sentAt?: string } | undefined;
  const availability = !c.settings ? { state: "UNKNOWN" } : !availRow ? { state: "NONE_RECORDED" } : { state: "RECORDED", sentBy: av?.sentBy ?? null, sentAt: av?.sentAt ?? null, days: (av?.days ?? []).map((d) => ({ day: d.day, date: d.date, available: d.available, from: d.from })), meaning: "the artist's stated free days (week opens Thu 08:00 Israel); not a booking" };
  const presKey = slug === "shalev-tasama" ? "shalev_entry_last" : slug === "avi-molla" ? "avi_entry_last" : slug === "dj-cleantone" ? "cleantone_entry_last" : null;
  const presRow = presKey ? settingRows(c, "PORTAL_PRESENCE")?.find((r) => r.key === presKey) ?? null : null;
  const presence = !presKey ? { state: "NO_LOGIN_OR_NO_PORTAL" } : !c.settings ? { state: "UNKNOWN" } : { state: presRow ? "RECORDED" : "NONE_RECORDED", lastPortalEntry: (presRow?.value as { at?: string } | undefined)?.at ?? null, meaning: "portal activity evidence only — not work done" };
  const reminderRows = slug ? (settingRows(c, "AVAILABILITY_REMINDER_SENT") ?? []).filter((r) => r.key.includes(`:${slug}:`)).length : 0;

  // ── owner knowledge ──
  const knowledge = c.kn.filter((k) => k.subjectKey === key || k.identityKeys.includes(key) || clientRecords.some((x) => k.identityKeys.includes(`client:${x.id}`))).map((k) => ({ kind: k.kind, meaning: k.meaningHe, epistemic: k.epistemic }));

  // ── signals / next steps / questions (evidence only) ──
  const signals: ArtistSignal[] = [];
  const questions: ArtistQuestion[] = [];
  const nextSteps: Array<{ step: string; evidence: string; entity?: string }> = [];
  for (const p of projects.filter((x) => x.open)) {
    signals.push({ code: "ACTIVE_WORK", kind: "CANONICAL_FACT", he: `${p.name} (${p.status}; ${p.basis}${p.labelWork ? "; לייבל" : ""})`, entity: p.key });
    if (p.victor?.length) { signals.push({ code: "WAITING_PRODUCTION", kind: "DERIVED_SIGNAL", he: `${p.name}: אצל ויקטור (${p.victor.map((v) => v.ball).join(", ")})`, entity: p.key }); nextSteps.push({ step: `${p.name}: הפקה אצל ויקטור`, evidence: p.victor.map((v) => `${v.workState ?? "?"} · כדור: ${v.ball}`).join("; "), entity: p.key }); }
    const eng = (p.engineers ?? []).filter((e) => !["אושר", "בוטל"].includes(e.status ?? ""));
    if (eng.length) { signals.push({ code: "WAITING_MIX", kind: "DERIVED_SIGNAL", he: `${p.name}: אצל ${eng.map((e) => e.engineer).join(", ")} (${eng.reduce((s, e) => s + e.openComments, 0)} הערות פתוחות)`, entity: p.key }); nextSteps.push({ step: `${p.name}: מיקס`, evidence: eng.map((e) => `${e.engineer} ${e.status} · ${e.versions} גרסאות · ${e.openComments} הערות פתוחות`).join("; "), entity: p.key }); }
    for (const i of p.internalDeadlines.filter((x) => x.passed)) signals.push({ code: "INTERNAL_DEADLINE_PASSED", kind: "DERIVED_SIGNAL", he: `${p.name}: הדדליין הפנימי של ${i.who} (${i.date}) עבר — ציפייה פנימית, לא התחייבות ללקוח.`, entity: p.key });
    if (p.labelWork && !releaseRows.some((r) => r.project === p.key)) signals.push({ code: "LABEL_PROJECT_WITHOUT_RELEASE", kind: "DERIVED_SIGNAL", he: `${p.name}: עבודת לייבל בלי שורת ריליס.`, entity: p.key });
    if (!p.victor?.length && !eng.length && !p.ballEvidence.length) questions.push({ kind: "PROJECT_STATE", questionHe: `"${p.name}" — מה המצב ועל מי הוא מחכה?`, why: "no Victor / engineer / send-log / blocker evidence recorded" });
  }
  for (const r of releaseRows) {
    if (r.active && r.targetDate) signals.push({ code: "RELEASE_PLANNED", kind: "CANONICAL_FACT", he: `ריליס "${r.projectName}" — ${r.stage}, יעד ${r.targetDate}`, entity: r.key });
    if (r.targetPassed) signals.push({ code: "RELEASE_TARGET_PASSED", kind: "DERIVED_SIGNAL", he: `יעד הריליס "${r.projectName}" (${r.targetDate}) עבר — יעד, לא התחייבות ללקוח.`, entity: r.key });
    if (r.blocker) signals.push({ code: "RELEASE_BLOCKER", kind: "CANONICAL_FACT", he: `חסם: ${r.blocker}`, entity: r.key });
    if (r.stage === "מוכן ליציאה") signals.push({ code: "READY_FOR_RELEASE", kind: "CANONICAL_FACT", he: `"${r.projectName}" מסומן מוכן ליציאה.`, entity: r.key });
    if (r.stage === "יצא") signals.push({ code: "RELEASED", kind: "CANONICAL_FACT", he: `"${r.projectName}" יצא${r.releasedAt ? ` (${r.releasedAt.slice(0, 10)})` : ""}.`, entity: r.key });
    if (r.active) nextSteps.push({ step: `ריליס "${r.projectName}": ${r.stage}`, evidence: [r.nextAction && `הצעד הבא: ${r.nextAction}`, r.blocker && `חסם: ${r.blocker}`, r.responsible && `אחראי: ${r.responsible}`, r.targetDate && `יעד: ${r.targetDate}`].filter(Boolean).join(" · ") || "אין צעד הבא / חסם / אחראי רשומים", entity: r.key });
    if (r.active && !r.nextAction && !r.blocker) questions.push({ kind: "RELEASE", questionHe: `ריליס "${r.projectName}" (${r.stage}) — מה הצעד הבא ומה חסר?`, why: "no next action / blocker recorded; Redbloods has no readiness checklist" });
  }
  if (!isCleantone && releaseRows.length === 0) signals.push({ code: "NO_RELEASE_RECORDED", kind: "CANONICAL_FACT", he: "אין שורת ריליס רשומה לאמן." });
  const futureSessions = sessions.filter((s) => s.date && s.date >= c.today && s.status !== "בוטל");
  for (const s of futureSessions) signals.push({ code: "UPCOMING_SESSION", kind: "CANONICAL_FACT", he: `${s.type ?? "סשן"} ב-${s.date}${s.start ? ` ${s.start}` : ""}`, entity: s.project ?? s.show ?? undefined });
  for (const s of shows) {
    if (s.upcoming && s.status !== "בוטל") { signals.push({ code: "UPCOMING_SHOW", kind: "CANONICAL_FACT", he: `הופעה ${s.name ?? ""} ב-${s.date} (${s.status})`, entity: s.key }); nextSteps.push({ step: `הופעה ${s.date}`, evidence: `DJ: ${s.dj ? `${s.dj.name ?? "?"} (${s.dj.confirmation})` : "לא רשום"} · חזרות: ${s.rehearsals.length} · נשלח לאמן: ${s.sentToArtist}`, entity: s.key }); }
    if (s.role === "ARTIST" && !s.dj && s.status !== "בוטל" && SHOW_ACTIVE.has(s.status ?? "") && s.upcoming) { signals.push({ code: "SHOW_WITHOUT_DJ", kind: "CANONICAL_FACT", he: `להופעה ב-${s.date} אין DJ רשום — CLEANTONE מנגן ברוב ההופעות, לא בכולן: לאשר.`, entity: s.key }); questions.push({ kind: "SHOW_DJ", questionHe: `מי ה-DJ בהופעה ב-${s.date}?`, why: "no DJ recorded; never auto-assigned" }); }
    if (s.status === "בוצע" && s.paymentStatus !== "שולם" && s.paymentStatus !== "בוטל") signals.push({ code: "SHOW_DONE_UNPAID", kind: "CANONICAL_FACT", he: `הופעה ${s.date} בוצעה, תשלום לקוח: ${s.paymentStatus}`, entity: s.key });
  }
  const moving = projects.some((p) => p.open && ((p.victor?.length ?? 0) > 0 || (p.engineers ?? []).some((e) => !["אושר", "בוטל"].includes(e.status ?? "")) || (p.sessions?.upcoming ?? 0) > 0));
  if (!moving && futureSessions.length === 0 && !releaseRows.some((r) => r.active && r.targetDate && r.targetDate >= c.today)) {
    signals.push({ code: "NO_UPCOMING_RECORDED_WORK", kind: "DERIVED_SIGNAL", he: "אין עבודה בתנועה, סשן עתידי או ריליס מתוכנן שרשומים ב-Redbloods — עובדה על הנתונים, לא שיפוט של האמן." });
    if (!isCleantone) questions.push({ kind: "ARTIST_PLAN", questionHe: `מה התוכנית הבאה עם ${name}? (לא רשום שיר בתנועה, סשן או ריליס מתוכנן)`, why: "no recorded next work — the Owner's plan may live outside Redbloods" });
  }
  if (ledger.length) signals.push({ code: "LEDGER_BALANCE", kind: "DERIVED_SIGNAL", he: `מאזן האמן: ${money.ledger?.allTime.balance} (בלי מטבע שמור)` });
  if (ledger.length && c.settings && !anchor) signals.push({ code: "CYCLE_NOT_SET", kind: "CANONICAL_FACT", he: "יש תנועות במאזן אבל לא הוגדר עוגן למחזורים." });
  if (availability.state === "RECORDED") signals.push({ code: "AVAILABILITY_THIS_WEEK", kind: "CANONICAL_FACT", he: `זמינות נשלחה ${(availability as { sentAt?: string | null }).sentAt ?? ""}` });
  if (clientRecords.length) signals.push({ code: "IDENTITY_DUAL_ROLE", kind: "CANONICAL_FACT", he: `${name} קיים גם כרשומת לקוח — תפקידים נפרדים; כסף לקוח לא נספר ככסף אמן.` });

  const history = [
    { at: identity.createdAt, event: "joined the roster", kind: "RECORDED" },
    ...releaseRows.flatMap((r) => [{ at: r.stageSince, event: `release "${r.projectName}" entered ${r.stage}`, kind: "RECORDED" }, ...(r.releasedAt ? [{ at: r.releasedAt, event: `release "${r.projectName}" released`, kind: "RECORDED" }] : [])]),
    ...ledger.slice(0, 20).map((e) => ({ at: e.entryDate, event: `ledger ${e.entryType} ${e.amount}${e.description ? ` — ${e.description}` : ""}`, kind: "RECORDED" })),
    ...cycles.map((y) => ({ at: y.closedAt, event: `cycle ${y.cycleIndex} closed (ending ${y.endingBalance})`, kind: "RECORDED" })),
    ...media.map((m) => ({ at: m.receivedDate ?? m.createdAt, event: `media ${m.recordType} ${m.grossAmount} (${m.status})`, kind: "RECORDED" })),
    ...shows.map((s) => ({ at: s.date, event: `show (${s.status})`, kind: "RECORDED" })),
    ...sessions.slice(0, 20).map((s) => ({ at: s.date, event: `${s.type ?? "session"} (${s.status})`, kind: "RECORDED" })),
  ].filter((h) => h.at).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const lastRecorded = history.map((h) => String(h.at).slice(0, 10)).filter((d) => d <= c.today).sort().pop() ?? null;

  return { key, found: true as const, identity, projects, releases: releaseRows, nextRelease, cadence: { releasedDates, planned: releaseRows.filter((r) => r.active && r.targetDate).map((r) => r.targetDate), note: "evidence only — Redbloods has no cadence target" },
    beats, shows, money, sessions, calendar, tasks, meetings, redFilms, social, availability, presence, notifications: { availabilityRemindersClaimed: reminderRows, pushes: "see system_awareness artist_model pushes; Sunny never sends" },
    portal: { slug, loginRole: identity.portal.loginRole, storedOutsideDb: "sketches, ratings, next-work, press kit, performance files, profile image live in the artist's storage folder — not readable by Sunny" },
    ownerKnowledge: knowledge, signals, nextSteps, questions, history, lastRecordedActivity: lastRecorded, unavailable };
}
export type ArtistView = NonNullable<ReturnType<typeof buildArtistView>>;

/** The roster side by side — facts, never a ranking. */
export function artistPortfolio(src: GatewaySources) {
  const c = ctxOf(src);
  const ids = new Set([...(c.st?.domains.labelArtists.data?.items ?? []).map((a) => a.id), ...(c.ld?.artists?.rows ?? []).map((a) => a.id)]);
  return [...ids].map((id) => buildArtistView(src, id)).filter((v): v is ArtistView => !!v).map((v) => ({
    key: v.key, name: v.identity.name, status: v.identity.status, portal: v.identity.portal.slug, loginRole: v.identity.portal.loginRole,
    openProjects: v.projects.filter((p) => p.open).length, labelWorkOpen: v.projects.filter((p) => p.open && p.labelWork).length, atVictor: v.projects.filter((p) => p.victor?.length).length,
    atEngineer: v.projects.filter((p) => (p.engineers ?? []).some((e) => !["אושר", "בוטל"].includes(e.status ?? ""))).length, activeReleases: v.releases.filter((r) => r.active).length,
    nextRelease: v.nextRelease ? { name: v.nextRelease.projectName, stage: v.nextRelease.stage, target: v.nextRelease.targetDate } : null, released: v.cadence.releasedDates.length,
    upcomingSessions: v.sessions.filter((s) => s.date && s.date >= c.today && s.status !== "בוטל").length, upcomingShows: v.shows.filter((s) => s.upcoming && s.status !== "בוטל").length,
    ledgerBalance: v.money.ledger?.allTime.balance ?? null, closedCycles: v.money.cycles.closed.length, mediaRecords: v.money.mediaIncome.records, lastPortalEntry: (v.presence as { lastPortalEntry?: string | null }).lastPortalEntry ?? null,
    lastRecordedActivity: v.lastRecordedActivity, signals: [...new Set(v.signals.map((s) => s.code))], openQuestions: v.questions.length,
  })).sort((a, b) => a.name.localeCompare(b.name));
}
