/**
 * Sunny — the CONNECTED LABEL ARTIST VIEW + ARTIST PORTFOLIO + next-step reasoning. Pure, read-only.
 *
 * One label artist across the company, with honest relationship quality:
 *   releases (artist id)                          CANONICAL — the only canonical artist ↔ project link
 *   projects naming the artist                    TEXT_MATCH (single / collaboration) + label classification
 *   ledger / cycles / media income (artist id)    CANONICAL — three separate money records, never merged
 *   portal / beats (fixed name → slug table)      CANONICAL (app constant) / DERIVED
 *   client record, shows (via client), Red Films, social (name)   TEXT_MATCH
 *   show DJ = the label DJ? (app's fixed client id) CANONICAL — DJ CLEANTONE is TEAM, never a label artist (2026-09-27)
 * Project work (Victor, engineers, sessions, release, delivery) reuses the connected project view and the Owner
 * operating model — no second rule. No score, no cadence target, no activity threshold: evidence + dates only.
 */
import type { GatewaySources } from "../gateway/core";
import { resolveQuestions } from "../sunny/known-context";
import type { PartnerCompanyState } from "../eyes/types";
import type { OperationsRaw } from "../operations/types";
import type { ProjectDetailRaw } from "../projects/detail-types";
import type { LabelDetailRaw, DetailShow } from "./detail-types";
import type { SettingsState } from "../settings/types";
import { activeKnowledge, type OwnerKnowledgeRecord } from "../owner-knowledge/store";
import type { CalendarWindowResult } from "../calendar/types";
import type { CompanyIntegrityRegister } from "../integrity/types";
import { projectMoney } from "../projects/money";
import { buildProjectView } from "../projects/view";
import { projectOperating } from "../sunny/operating";
import { buildCalendarLinkIndex, eventsForEntity, linkCalendarEvent } from "../calendar/links";
import { resolvePortalIdentity } from "../../red-artists/portal-registry";
import { isLabelProject } from "../../project-classification";
import { presenceFactsOf } from "../../push-presence-pure";
import { computeShowNotifyFingerprint, showNotifyStateOf, type ShowNotifyClaimValue } from "../../show-notify-pure";
import { clipMoneyByCurrency, clipRecoupContribution } from "../../clip-rf-money-pure";
import { agreementArtistOf, AGREEMENT_COST_RULES, AGREEMENT_SHOW_RULE, AGREEMENT_MEDIA_RULE, AGREEMENT_CYCLE_ACCOUNTING_HE, AGREEMENT_RULES_VERSION, mediaAgreementSplit } from "../../label-agreements";
import { expenseShareOf, EXPENSE_SHARE_EXCEPTIONS, RECORDS_EXPENSE_SHARE_VERSION, incomeKindOfSource, mediaLabelShareByRule, type ExpenseShare } from "../../records-expense-share";
import { isExpenseFullyPaidStatus } from "../../finance/classify";
import { computeOpenCycle, cycleBounds, currentCycleIndex, openingOfSnapshot, settlementResultOf, SETTLEMENT_RESULT_HE, type ComputedCycle } from "../../artist-balance-cycles-pure";

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
export interface ArtistQuestion { questionHe: string; why: string; kind: string; entity?: string }

interface Ctx { st: PartnerCompanyState | null; ops: OperationsRaw | null; det: ProjectDetailRaw | null; ld: LabelDetailRaw | null; settings: SettingsState | null; kn: OwnerKnowledgeRecord[]; cal: CalendarWindowResult | null; integrity: CompanyIntegrityRegister | null; today: string; cleantoneClientId: string | null }
function ctxOf(src: GatewaySources): Ctx {
  const st = ok(src.state) as PartnerCompanyState | null;
  return { st, ops: ok(src.operations) as OperationsRaw | null, det: ok(src.projectDetail) as ProjectDetailRaw | null, ld: ok(src.labelDetail) as LabelDetailRaw | null, settings: ok(src.settings) as SettingsState | null,
    kn: activeKnowledge((ok(src.ownerKnowledge) as OwnerKnowledgeRecord[] | null) ?? [], st?.todayIL ?? ilToday(src.now)), cal: ok(src.calendar) as CalendarWindowResult | null, integrity: ok(src.integrity) as CompanyIntegrityRegister | null, today: st?.todayIL ?? ilToday(src.now), cleantoneClientId: src.identities?.cleantone?.clientId ?? null };
}
const settingRows = (c: Ctx, family: string) => c.settings?.families[family]?.rows ?? null;

/** The balance-cycle window rule of the app (anchor + 2-month windows, end exclusive; current = max(today's index, closed count)) —
 *  the app's own pure module (lib/artist-balance-cycles-pure.ts), never a second rule. */
export function cycleWindow(anchor: string, today: string, closedCount: number) {
  const index = currentCycleIndex(anchor, today, closedCount);
  const { start, end } = cycleBounds(anchor, index);
  return { index, start, endExclusive: end };
}

export function buildArtistView(src: GatewaySources, artistId: string) {
  const c = ctxOf(src);
  const eyes = c.st?.domains.labelArtists.data?.items.find((a) => a.id === artistId) ?? null;
  const rec = c.ld?.artists?.rows.find((a) => a.id === artistId) ?? null;
  const name = eyes?.name ?? rec?.name ?? null;
  if (!name) return null;
  const key = `label-artist:${artistId}`;
  // B4: portal by stable id first (a renamed artist keeps his portal); exact-name fallback is AMBIGUOUS identity.
  const portalIdentity = resolvePortalIdentity({ id: artistId, name }, { strict: false });
  const slug = portalIdentity?.slug ?? null;
  const fin = ok(src.finance);
  const unavailable: string[] = [];
  if (!c.ld) unavailable.push("LABEL_DETAIL (ledger text, cycles, media income, beats, shows in full) was not read — those sections are unknown, not empty");
  if (!c.det) unavailable.push("PROJECT_DETAIL (sessions, tasks, meetings, release notes) was not read");
  if (!c.settings) unavailable.push("SETTINGS (availability, presence, cycle anchor, sent markers) was not read");
  if (!fin) unavailable.push("FINANCE was not read — project money unknown");

  // ── identity / roles ──
  const clientRecords = (c.st?.domains.clients.data?.items ?? []).filter((x) => low(x.name) === low(name));
  const ownerLabel = (c.integrity?.learned ?? []).filter((l) => l.status === "APPLIES" && l.entityKey === key).map((l) => ({ question: l.decision.questionType, answer: l.decision.answerCode, basis: "OWNER_CONFIRMED" }));
  const identity = { key, name, status: rec?.status ?? eyes?.status ?? null, hasImage: rec?.hasImage ?? null, notes: rec?.notes ?? null, createdAt: rec?.createdAt ?? eyes?.createdAt ?? null, updatedAt: rec?.updatedAt ?? eyes?.updatedAt ?? null,
    portal: slug ? { slug, loginRole: LOGIN_ROLE[slug] ?? "NONE (portal page, no login)", link: portalIdentity?.basis === "ID" ? "CANONICAL (label_artists.id → slug table)" : "AMBIGUOUS (exact name → slug table; no id registered in code)" } : { slug: null, loginRole: "NONE", link: "no portal (name not in the app's slug table)" },
    clientRecords: clientRecords.map((x) => ({ key: `client:${x.id}`, type: x.type, status: x.status, link: "TEXT_MATCH (same name — a separate record of the same person; never merged; client money stays client money)" })),
    ownerLabelClassification: ownerLabel };
  const labelWorkByOwner = ownerLabel.some((o) => o.answer === "LABEL_SONGS");

  // ── projects: releases (canonical) + by name (text) ──
  const idx = c.st?.domains.projects.data?.index ?? {};
  const releases = (c.st?.domains.releasesFull.data?.items ?? []).filter((r) => r.labelArtistId === artistId);
  const relDetail = new Map((c.det?.releases?.rows ?? []).map((r) => [r.projectId, r]));
  // P0-E (2026-10-05): the release detail (next action / blocker / responsible) may not have been read — then nothing is
  // asserted about it (source missing ≠ fact missing)
  const relRead = !!c.det?.releases;
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
    // B2: the stored type is the ONLY classifier; a release row / an Owner LABEL_SONGS answer / the Owner-rule
    // mismatch are evidence shown next to it (labelEvidence), never a second classifier.
    const labelWork = isLabelProject(p);
    return { key: `project:${pid}`, id: pid, name: p?.name ?? v.identity?.name ?? "(לא נמצא)", status: p?.status ?? v.identity?.status ?? null, businessType: p?.businessType ?? null, basis: l.basis, quality: l.quality,
      labelWork, labelBasis: isLabelProject(p) ? "STORED_BUSINESS_TYPE" : p?.businessType === "לקוח" ? "STORED_CLIENT" : "UNCLASSIFIED",
      labelEvidence: { releaseRow: l.basis === "RELEASE", ownerLabelSongsAnswer: labelWorkByOwner, ownerRuleMismatch: v.signals.some((s) => s.code === "MISMATCH_OWNER_RULE"), note: "evidence only — the stored project_business_type is the classifier" },
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
  // B5: "released" is the CURRENT stage (יצא); released_at is only the (first-)release DATE. A released row without a
  // date is still counted (UNKNOWN_DATE); a row that left יצא keeps its released_at as history, not as "released".
  const releasedRows = releaseRows.filter((r) => r.stage === "יצא");
  const releasedDates = releasedRows.map((r) => r.releasedAt).filter((x): x is string => !!x).sort();
  const releasedUnknownDate = releasedRows.filter((r) => !r.releasedAt).length;

  // ── beats ──
  const beats = slug ? (c.ld?.beats?.rows ?? []).filter((b) => b.assignedTo.some((a) => a.artistSlug === slug)).map((b) => ({ name: b.name, genre: b.genre, key: b.musicalKey, status: b.status, assignedAt: b.assignedTo.find((a) => a.artistSlug === slug)?.at ?? null, durationSeconds: b.durationSeconds, path: b.path, link: "DERIVED (portal slug)" })) : [];

  // ── shows ──
  const clientIds = new Set(clientRecords.map((x) => x.id));
  const showRows = (c.ld?.shows?.rows ?? []);
  const mapShow = (s: DetailShow, role: "ARTIST") => {
    const rehearsals = (c.det?.sessions?.rows ?? []).filter((x) => x.showId === s.id);
    const net = Math.max(0, (s.price ?? 0) - (s.djFee ?? 0));
    // THE app's own read rule (showNotifyStateOf — the same answer as the send button, the notify writers and show_view):
    // SENT only for the show's CURRENT version (name / date / time / place); an older version is SENT_PREVIOUS_VERSION
    const fp = computeShowNotifyFingerprint({ name: s.name ?? "", date: s.date, startTime: s.startTime, location: s.location });
    const notify = (fam: string) => { const rows = settingRows(c, fam); if (rows === null) return "UNKNOWN"; const row = rows.find((r) => r.key.endsWith(`:${s.id}`)); if (!row) return "NOT_SENT"; return showNotifyStateOf(((row as { value?: unknown }).value ?? null) as ShowNotifyClaimValue | null, fp).state; };
    // deal type (NOT a payment status): an unpaid collaboration has no payment status / price — never money, still a show
    const unpaidCollab = s.dealType === "UNPAID_COLLAB";
    return { key: `show:${s.id}`, role, name: s.name, date: s.date, time: s.startTime, location: s.location, status: s.status, dealType: unpaidCollab ? "UNPAID_COLLAB" as const : "PAID" as const, paymentStatus: unpaidCollab ? null : s.paymentStatus, price: unpaidCollab ? null : s.price, djFee: s.djFee, artistFee: s.artistFee, advancePayment: s.advancePayment,
      splitNote: agreementArtistOf({ id: artistId, name }) ? `agreement artist: net before rehearsals = ${r2(net)} (price − DJ fee); artist share = half of the net after counted rehearsal costs (stored artist fee ${s.artistFee ?? "—"})` : `no show agreement for this artist — the split is NOT_DEFINED (never assumed 50/50); stored artist fee ${s.artistFee ?? "—"}`, currency: "NOT_STORED (screens show ₪)",
      dj: s.djClientId ? { client: `client:${s.djClientId}`, name: s.djName, isLabelDj: s.djClientId === c.cleantoneClientId, confirmation: s.djConfirmationStatus ?? "NONE" } : s.djName ? { client: null, name: s.djName, isLabelDj: false, confirmation: "NOT_APPLICABLE (a DJ recorded by name only)" } : null,
      booker: s.bookerClientId ? `client:${s.bookerClientId}` : s.bookerName, rehearsals: rehearsals.map((x) => ({ date: x.date, status: x.status })), hasCalendarEvent: s.hasCalendarEvent,
      sentToArtist: notify("SHOW_SENT_TO_ARTIST"), sentToDj: s.djClientId ? notify("SHOW_SENT_TO_DJ") : "NO_DJ", upcoming: !!s.date && s.date >= c.today, notes: s.notes,
      link: "TEXT_MATCH (show artist → client record of the same name)" };
  };
  const shows = showRows.filter((s) => s.artistClientId && clientIds.has(s.artistClientId)).map((s) => mapShow(s, "ARTIST"))
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

  // ── money: ledger / cycles / media / label-work projects — separate, never merged ──
  const ledger = (c.ld?.ledger?.rows ?? []).filter((e) => e.artistId === artistId).sort((a, b) => (b.entryDate ?? "").localeCompare(a.entryDate ?? ""));
  const sum = (t: string, rows = ledger) => r2(rows.filter((e) => e.entryType === t).reduce((s, e) => s + (e.amount ?? 0), 0));
  const totals = (rows = ledger) => ({ income: sum("הכנסות", rows), expectedIncome: sum("הכנסות צפויות", rows), payments: sum("תשלומים", rows), expenses: sum("הוצאות", rows), expectedExpenses: sum("הוצאות צפויות", rows), balance: r2(sum("הכנסות", rows) - sum("תשלומים", rows) - sum("הוצאות", rows)) });
  const cycles = (c.ld?.cycles?.rows ?? []).filter((y) => y.artistId === artistId).sort((a, b) => (a.cycleIndex ?? 0) - (b.cycleIndex ?? 0));
  const anchorRow = settingRows(c, "ARTIST_BALANCE_CYCLE_ANCHOR")?.find((r) => r.key === `balance_cycle_anchor:${artistId}`) ?? null;
  const anchor = anchorRow && typeof (anchorRow.value as Record<string, unknown>)?.anchorDate === "string" ? String((anchorRow.value as Record<string, unknown>).anchorDate) : null;
  const win = anchor ? cycleWindow(anchor, c.today, cycles.length) : null;
  const bootstrapRow = settingRows(c, "ARTIST_BALANCE_FIRST_CYCLE")?.find((r) => r.key === `balance_cycle_first_cycle_bootstrap:${artistId}`) ?? null;
  const bootstrap = bootstrapRow && typeof (bootstrapRow.value as Record<string, unknown>)?.effectiveStart === "string" ? String((bootstrapRow.value as Record<string, unknown>).effectiveStart) : null;
  // The open cycle's settlement picture — the SAME computation as the artist's balance page (Owner decision 2026-09-28:
  // a close is a settlement picture, never a reset; the unpaid balance carries forward as the next opening balance).
  const openCycle: ComputedCycle | null = anchor ? computeOpenCycle({
    anchor, bootstrap, today: c.today,
    closed: cycles.map((y) => ({ cycleIndex: y.cycleIndex ?? 0, startDate: y.startDate ?? "", endDate: y.endDate ?? "", income: y.income ?? 0, payments: y.payments ?? 0, expenses: y.expenses ?? 0, endingBalance: y.endingBalance ?? 0, closedAt: y.closedAt ?? "" })),
    entries: ledger.map((e) => ({ id: e.id, entryType: e.entryType, amount: e.amount, entryDate: e.entryDate, createdAt: e.createdAt })),
  }) : null;
  const settlementOf = (oc: ComputedCycle) => ({
    start: oc.startDate, endExclusive: oc.endDate, calcStart: oc.calcStartDate, daysUntilClose: oc.daysUntilClose,
    openingBalance: oc.openingBalance,
    activity: { income: oc.totals.income, expenses: oc.totals.expenses, payments: oc.totals.payments, expectedIncome: oc.totals.expectedIncome, expectedExpenses: oc.totals.expectedExpenses, net: oc.totals.currentBalance },
    closingBalance: oc.closingBalance, result: oc.result, resultHe: SETTLEMENT_RESULT_HE[oc.result],
    lateEntries: oc.lateEntryIds.length, reconciliationDifference: oc.reconciliationDifference,
    formula: "closing = opening + artist income − artist expense share − payments to the artist (expected rows not counted); opening = the previous closed cycle's closing balance (first cycle: realized history before it)",
  });
  // media (2026-09-29): LEGACY records (allocation_model false, e.g. Mobile1) are read as before (the owner's rows);
  // ALLOCATION-model incomes appear for their owner AND every allocated artist — each artist counts only its allocation
  const allMedia = c.ld?.mediaIncome?.rows ?? [];
  const allAllocs = c.ld?.mediaAllocations?.rows ?? [];
  const myAllocIncomes = new Set(allAllocs.filter((a) => a.artistId === artistId).map((a) => a.mediaIncomeId));
  const media = allMedia.filter((m) => m.artistId === artistId && !m.allocationModel).sort((a, b) => (b.receivedDate ?? b.createdAt ?? "").localeCompare(a.receivedDate ?? a.createdAt ?? ""));
  const modelMedia = allMedia.filter((m) => m.allocationModel && m.recordType === "income" && (m.artistId === artistId || myAllocIncomes.has(m.id)));
  const reversedIds = new Set(allMedia.filter((m) => m.recordType === "reversal" && m.reversesId).map((m) => String(m.reversesId)));
  const entitlementOf = (allocId: string) => (c.ld?.ledger?.rows ?? []).filter((e) => e.sourceMediaAllocationId === allocId);
  /** what the ledger entitlement of an allocation must be now: 0 once the allocation / income stopped counting */
  const expectedEntitlement = (m: (typeof modelMedia)[number], a: (typeof allAllocs)[number]) => (a.status !== "active" || m.status === "בוטל" || reversedIds.has(m.id) ? 0 : Number(a.amount ?? 0));
  const modelRows = modelMedia.map((m) => {
    const allocs = allAllocs.filter((a) => a.mediaIncomeId === m.id);
    return {
      id: m.id, kind: m.incomeKind ?? "DISTRIBUTION", status: m.status, reversed: reversedIds.has(m.id), gross: m.grossAmount, recordsShare: m.labelShare, owner: m.artistId === artistId,
      source: m.source, period: m.reportPeriod, received: m.receivedDate, financeTransaction: m.financeTransactionId ? "LINKED (one Finance income, full amount)" : "MISSING",
      allocations: allocs.map((a) => { const ent = entitlementOf(a.id); return { artistId: a.artistId, pct: a.pct, amount: a.amount, status: a.status, entitlement: ent.length ? { amount: ent[0].amount, type: ent[0].entryType, rows: ent.length } : "MISSING", expectedEntitlement: expectedEntitlement(m, a) }; }),
      thisArtist: r2(allocs.filter((a) => a.artistId === artistId && a.status === "active").reduce((s, a) => s + Number(a.amount ?? 0), 0)),
    };
  });
  const counting = modelRows.filter((m) => !m.reversed && m.status !== "בוטל");
  const signed = (m: (typeof media)[number], f: "grossAmount" | "labelShare" | "artistShareGross" | "artistPayable") => (m.recordType === "reversal" ? -1 : 1) * (m[f] ?? 0);
  const received = media.filter((m) => m.status === "התקבל");
  const lastRecoupAfter = received.filter((m) => m.recordType === "income").sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))[0]?.recoupAfter ?? null;
  const labelWorkMoney: Record<string, { received: number; openExpected: number; agreed: number | null }[]> = {};
  if (fin) for (const p of projects.filter((x) => x.labelWork)) {
    const m = projectMoney(fin.raw, { id: p.id, status: p.status ?? "" });
    (labelWorkMoney[m.price.currency] ??= []).push({ received: m.song?.received ?? 0, openExpected: m.song?.openExpected ?? 0, agreed: m.price.agreed });
  }
  // ── clips: A / B / C per currency (information) — the recoup contribution is NOT_DEFINED (B3, Owner canon 2026-09-27) ──
  const artistProjIds = new Set(projects.map((p) => p.id));
  const clipProds = (c.ops?.redFilms?.rows ?? []).filter((r) => r.productionType === "קליפ" && r.status !== "בוטל" && ((r.projectId && artistProjIds.has(r.projectId)) || tokens(r.artistName).some((t) => low(t) === low(name))));
  const clipProjIds = new Set(clipProds.map((r) => r.projectId).filter((x): x is string => !!x));
  const clipSettings = (fin?.raw.financeSettings ?? []).filter((s) => clipProjIds.has(s.projectId)).map((s) => s.value as Record<string, unknown> | null);
  // ── the Records / artist expense split (Owner decision 2026-09-28, lib/records-expense-share — the ONE rule) ──
  // Finance cash (the full amount Records paid) ≠ the Records share ≠ THIS artist's share (an artist expense in the ledger).
  const agreementArtist = agreementArtistOf({ id: artistId });
  const artistTextOf = new Map((fin?.raw.projects ?? []).map((p) => [p.id, p.artist]));
  const artistProjSet = new Set(projects.map((p) => p.id));
  type ShareSum = { cashOut: number; recordsShare: number; artistShare: number };
  const shareOfTx = (t: NonNullable<typeof fin>["raw"]["transactions"][number]): ExpenseShare => expenseShareOf({ id: t.id, type: t.type, amount: t.amount, currency: t.currency, paymentStatus: t.status, businessUnit: t.businessUnit ?? null, category: t.category, expenseScope: t.expenseScope, showId: t.showId ?? null, showMoneyRole: t.showMoneyRole ?? null, projectId: t.projectId }, t.projectId ? { artistText: artistTextOf.get(t.projectId) ?? null } : null);
  // the artist's paid Records expenses: on the artist's projects, or an Owner exception naming the artist
  const paidExpenses = fin ? fin.raw.transactions.filter((t) => t.type === "expense" && isExpenseFullyPaidStatus(t.status) && ((t.projectId && (artistProjSet.has(t.projectId) || clipProjIds.has(t.projectId))) || ((e) => !!e && "artistId" in e && e.artistId === artistId)(EXPENSE_SHARE_EXCEPTIONS[t.id]))) : [];
  const sumShares = (rows: typeof paidExpenses) => {
    const defined: Record<string, ShareSum> = {}; const notDefined: Record<string, { cashOut: number; reasons: string[] }> = {};
    const lines: Array<{ transactionId: string; date: string | null; scope: string | null; cashOut: number; currency: string; status: string; recordsShare: number | null; artistShare: number | null; basisHe: string }> = [];
    for (const t of rows) {
      const s = shareOfTx(t); const cur = t.currency || "₪"; const amt = r2(Number(t.amount) || 0);
      if (s.status === "NOT_APPLICABLE") continue;
      if (s.status === "DEFINED") {
        const mine = s.artists.find((a) => a.artistId === artistId)?.amount ?? 0;
        const d = (defined[cur] ??= { cashOut: 0, recordsShare: 0, artistShare: 0 }); d.cashOut = r2(d.cashOut + amt); d.recordsShare = r2(d.recordsShare + s.recordsAmount); d.artistShare = r2(d.artistShare + mine);
        lines.push({ transactionId: t.id, date: t.date, scope: t.expenseScope, cashOut: amt, currency: cur, status: `${s.basis}:${s.kind}`, recordsShare: s.recordsAmount, artistShare: mine, basisHe: s.basisHe });
      } else {
        const n = (notDefined[cur] ??= { cashOut: 0, reasons: [] }); n.cashOut = r2(n.cashOut + amt); if (!n.reasons.includes(s.reasonHe)) n.reasons.push(s.reasonHe);
        lines.push({ transactionId: t.id, date: t.date, scope: t.expenseScope, cashOut: amt, currency: cur, status: s.status, recordsShare: null, artistShare: null, basisHe: s.reasonHe });
      }
    }
    return { defined, notDefined, lines: lines.slice(0, 40), linesTotal: lines.length };
  };
  const clipTotals = sumShares(paidExpenses.filter((t) => t.expenseScope === "קליפ"));
  const otherTotals = sumShares(paidExpenses.filter((t) => t.expenseScope !== "קליפ"));
  const fundedIls = clipTotals.defined["₪"]?.artistShare ?? 0;
  // what the ledger records as this artist's expense shares (linked rows), next to the rule — the reconciliation is the
  // Finance Brain signal ARTIST_EXPENSE_SHARE_MISMATCH
  const ledgerExpenseShares = ledger.filter((e) => e.entryType === "הוצאות").reduce((s, e) => r2(s + (Number(e.amount) || 0)), 0);
  // the ACCOUNTING = the bi-monthly cycle (Owner model 2026-09-27): the ledger's income (shows, media share), expenses (e.g.
  // the clip share the Owner recorded) and payments meet in the cycle balance. Ledger rows are matched to "clip" / "media"
  // only by their description (TEXT_MATCH) — as information, never as a link between a media income and a specific clip.
  const ledgerClipExpenses = ledger.filter((e) => e.entryType === "הוצאות" && /קליפ|clip/i.test(`${e.description ?? ""} ${e.note ?? ""}`)).map((e) => ({ amount: e.amount, date: e.entryDate, description: e.description, link: "TEXT_MATCH (description names a clip)" }));
  const ledgerMediaIncome = ledger.filter((e) => (e.entryType === "הכנסות" || e.entryType === "הכנסות צפויות") && /מדיה|media/i.test(`${e.description ?? ""} ${e.note ?? ""}`)).map((e) => ({ type: e.entryType, amount: e.amount, date: e.entryDate, description: e.description, link: "TEXT_MATCH (description names media)" }));
  const agreement = {
    version: AGREEMENT_RULES_VERSION,
    covered: !!agreementArtist,
    scopeRule: "Owner decision 2026-09-27: these rules apply ONLY to שליו טסמה and אבי מולה — never inferred for any other artist",
    expenseRuleVersion: RECORDS_EXPENSE_SHARE_VERSION,
    rules: {
      expenses: "Owner decision 2026-09-28: EVERY real Records expense of a Records artist (clip, promotion, photo, distribution, PR, vendor, other) — one Records artist: 50 % Records / 50 % the artist; Shalev + Avi together: 50 % Records / 25 % each; NagashBeatz credited: 100 % Records (no automatic artist charge); a Records artist next to an EXTERNAL host / client / guest (e.g. בלאגן): NO automatic split — needs a specific agreement / Owner decision. Explicit Owner exceptions win (ACUM 400 = 100 % Shalev; Principe YouTube 3 × 100 = 100 % Records). Finance keeps the FULL amount; the artist's part is an expense row in the artist ledger.",
      notArtistExpenses: "show money (DJ / rehearsals — inside the show's net split), payments to an artist (שכר אמן), mix / master (100 % label, a Studio capability)",
      production: AGREEMENT_COST_RULES.PRODUCTION.basisHe, mixMaster: AGREEMENT_COST_RULES.MIX_MASTER.basisHe, show: AGREEMENT_SHOW_RULE.basisHe,
    },
    clips: { byCurrency: clipTotals.defined, notDefined: clipTotals.notDefined, lines: clipTotals.lines, basis: "ACTUAL PAID Finance clip expenses (שולם) of the artist's projects, each transaction once — cashOut = what Records paid, recordsShare = Records' economic part, artistShare = THIS artist's part" },
    otherExpenses: { byCurrency: otherTotals.defined, notDefined: otherTotals.notDefined, lines: otherTotals.lines, basis: "the other paid Records expenses of the artist's projects (+ Owner exceptions naming the artist) — the same rule" },
    ledgerExpenseSharesRecordedIls: ledgerExpenseShares,
    dimensions: "cashOut (what Redbloods paid — Finance truth) ≠ labelShare (the label's economic share) ≠ artistShare ≠ artistShareFundedByLabel (Redbloods paid the artist's share; an artist expense in the cycle accounting — it is NOT label investment)",
    media: agreementArtist ? { rule: AGREEMENT_MEDIA_RULE.basisHe, meaning: "media income is INCOME split 50 / 50 — a separate component of the cycle, never the repayment of a specific clip",
      receivedSplit: mediaAgreementSplit({ id: artistId }, r2(received.reduce((s, m) => s + (m.recordType === "reversal" ? -1 : 1) * (m.grossAmount ?? 0), 0))),
      // Owner decision 2026-09-28: the split follows the income KIND (distribution 50 / 50; YouTube / ACUM / NagashBeatz 100 %
      // Records) — the stored RPC split is 50 / 50 for every source (history); byRule is the canonical reading
      byRule: received.map((m) => ({ source: m.source, kind: incomeKindOfSource(m.source), gross: m.grossAmount, storedLabelShare: m.labelShare, labelShareByRule: mediaLabelShareByRule(m.source, name, Number(m.grossAmount) || 0) })),
      historicalWithheld: r2(received.reduce((s, m) => s + (m.recordType === "reversal" ? -1 : 1) * (m.recouped ?? 0), 0)),
      historicalWithheldMeaning: "a value stored on media records written before 2026-09-27 by a RETIRED rule — history only; not an active policy, not a clip repayment, never evidence that media offsets a clip" } : "NOT_DEFINED — no agreement recorded for this artist",
    accounting: agreementArtist ? {
      model: "BI_MONTHLY_CYCLE",
      modelHe: AGREEMENT_CYCLE_ACCOUNTING_HE,
      currentCycle: openCycle ? { ...settlementOf(openCycle), note: "the cycle closes on endExclusive (the app's own cycle computation, as on the artist's page)" } : null,
      components: {
        artistExpensesRecorded: { clipExpenses: ledgerClipExpenses, note: "the amounts the Owner recorded in the ledger ARE the accounting record (a small difference from the derived share is not a conflict)" },
        derivedArtistClipShareIls: fundedIls,
        mediaShareRecordedAsIncome: ledgerMediaIncome,
        showsShare: "the artist's show share enters the ledger as income (booking / close-show sync) — see shows",
      },
      rule: "Sunny never claims that a media income (or any income) repaid a specific clip — no such link is recorded. Clip expense, media share and show share are separate components that meet only in the cycle balance. Media-income records stored before 2026-09-27 carry a 'recouped' snapshot from a retired rule: history, not a clip repayment",
    } : null,
  };
  const clipRecoup = {
    clipContribution: clipRecoupContribution(agreementArtist ? AGREEMENT_CYCLE_ACCOUNTING_HE : null),
    clipMoneyByCurrency: clipMoneyByCurrency({
      // A = the clip PROJECT's agreedPrice (one clip model 2026-10-01: a clip is its own project with ONE price)
      clientClipPrices: clipSettings.map((v) => ({ amount: Number(v?.agreedPrice) || 0, currency: typeof v?.currency === "string" ? v.currency : null })),
      plannedBudgets: clipProds.map((r) => ({ amount: r.generalBudget, currency: r.currency ?? null })),
      actualCostsPaid: fin ? fin.raw.transactions.filter((t) => t.type === "expense" && t.expenseScope === "קליפ" && t.projectId && clipProjIds.has(t.projectId) && isExpenseFullyPaidStatus(t.status)).map((t) => ({ amount: Number(t.amount) || 0, currency: t.currency })) : [],
      rfLedgerPaid: (c.ops?.budgetPayments?.rows ?? []).filter((x) => !x.hasTransaction && clipProds.some((r) => r.id === x.productionId)).map((x) => ({ amount: x.amount, currency: x.currency ?? null })),
    }),
    financeRead: !!fin,
    rule: "A the clip project's agreedPrice ≠ B planned budget ≠ C actual cost (Finance, paid) ≠ D recoupable. D does not exist (Owner model 2026-09-27): for שליו / אבי the artist's 50 % of C (ACTUAL PAID) is an artist expense in the bi-monthly cycle, never repaid by a specific income; any other artist has no agreement — never from the budget or the price. Red Films payments are real money: a LINKED payment is its Finance expense (already in C); rfLedgerPaid shows only the UNLINKED ones (DB-1) — never counted twice. Clips ↔ artist = TEXT_MATCH (artist name) or via the artist's projects",
  };
  const money = {
    currencyRule: "the artist ledger, cycles and media income store NO currency (screens show ₪); shows carry one currency each and project / show finance rows carry their own currency — nothing is added across these",
    ledger: ledger.length || c.ld ? { entries: ledger.length, allTime: totals(), formula: "balance = income − payments − expenses (expected rows shown, not counted)", fromShows: ledger.filter((e) => e.sourceShowId || e.sourceTxId).length, rows: ledger.slice(0, 40).map((e) => ({ type: e.entryType, amount: e.amount, date: e.entryDate, description: e.description, note: e.note, source: e.sourceShowId ? `show:${e.sourceShowId}` : e.sourceTxId ? "show artist-fee finance row" : "manual" })) } : null,
    cycles: { anchor, anchorSource: anchorRow ? "settings" : c.settings ? "NOT_SET" : "UNKNOWN", firstCycleBootstrap: bootstrap,
      closed: cycles.map((y) => { const snap = { endingBalance: y.endingBalance ?? 0, income: y.income ?? 0, payments: y.payments ?? 0, expenses: y.expenses ?? 0 }; const res = settlementResultOf(snap.endingBalance);
        return { index: y.cycleIndex, start: y.startDate, endExclusive: y.endDate, openingBalance: openingOfSnapshot(snap), income: y.income, payments: y.payments, expenses: y.expenses, closingBalance: y.endingBalance, result: res, resultHe: SETTLEMENT_RESULT_HE[res], closedAt: y.closedAt, snapshot: "IMMUTABLE" }; }),
      current: win && openCycle ? { index: win.index, ...settlementOf(openCycle), rule: "app rule: 2-month windows from the anchor; early close advances the cycle; a close is a settlement picture (no payment, no offset, no reset) — an unpaid balance carries forward" } : null },
    mediaIncome: { records: media.length, receivedGross: r2(received.reduce((s, m) => s + signed(m, "grossAmount"), 0)), receivedArtistShare: r2(received.reduce((s, m) => s + signed(m, "artistShareGross"), 0)), receivedLabelShare: r2(received.reduce((s, m) => s + signed(m, "labelShare"), 0)), artistPayable: r2(received.reduce((s, m) => s + signed(m, "artistPayable"), 0)), expected: media.filter((m) => m.status === "צפוי").length, lastRecoupAfter,
      rows: media.map((m) => ({ type: m.recordType, status: m.status, gross: m.grossAmount, source: m.source, period: m.reportPeriod, received: m.receivedDate, labelShare: m.labelShare, artistShare: m.artistShareGross, recoupBefore: m.recoupBefore, recouped: m.recouped, payable: m.artistPayable, recoupAfter: m.recoupAfter, notes: m.notes, model: "LEGACY" })),
      // ALLOCATION model (Owner decision 2026-09-28, DB 2026-09-29): ONE income → ONE Finance income (full amount, Records)
      // + allocations by the rule; each allocation = one ledger entitlement. The totals above are the LEGACY records only.
      allocationModel: allAllocs.length || modelMedia.length || c.ld?.mediaAllocations ? {
        records: modelRows.length, rows: modelRows,
        thisArtistReceived: r2(counting.filter((m) => m.status === "התקבל").reduce((s, m) => s + m.thisArtist, 0)),
        thisArtistExpected: r2(counting.filter((m) => m.status === "צפוי").reduce((s, m) => s + m.thisArtist, 0)),
        recordsShareReceivedOwned: r2(counting.filter((m) => m.owner && m.status === "התקבל").reduce((s, m) => s + Number(m.recordsShare ?? 0), 0)),
        rule: "distribution: one Records artist 50 %, Shalev + Avi 25 % each, NagashBeatz credited 0 allocations; YouTube / ACUM 100 % Records. The artist's share IS its ledger entitlement (never counted a second time); the gross is in Finance once. Cancel: entitlements kept at 0 with the reason, the Finance income the media created → בוטל; the Owner's own linked Finance row is never changed by media.",
      } : c.ld ? "NONE_RECORDED" : "NOT_READ",
      note: "media income = a 50 / 50 INCOME split (artist / label). Since 2026-09-27 nothing is withheld (no recoup target). Snapshots stored before carry 'recouped' / 'payable' values from a retired rule — history, NEVER the repayment of a specific clip. The media record itself never touches the ledger (the Owner records the artist's media share there as income)" },
    recoup: clipRecoup,
    agreement,
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
  // The ONE shared presence model (2026-09-27): last-seen = the artist's last ping / heartbeat of his own portal; the
  // visit push claim is shown separately; the old *_entry_last row is the pre-2026-09-27 push guard, not a last-seen.
  const presPortal = slug === "shalev-tasama" ? "shalev" as const : slug === "avi-molla" ? "avi" as const : slug === "dj-cleantone" ? "cleantone" as const : null;
  const presRows = settingRows(c, "PORTAL_PRESENCE");
  const pres = presPortal ? presenceFactsOf(presRows, presPortal) : null;
  const legacyEntry = presPortal ? (presRows?.find((r) => r.key === `${presPortal}_entry_last`)?.value as { at?: string } | undefined)?.at ?? null : null;
  const presence = !presPortal || !pres ? { state: "NO_LOGIN_OR_NO_PORTAL" } : !c.settings ? { state: "UNKNOWN" } : { state: pres.lastSeenAt ? "RECORDED" : "NONE_RECORDED", lastPortalEntry: pres.lastSeenAt, lastSeenAt: pres.lastSeenAt, visitPush: pres.visitPush, legacyLastPushedEntryAt: legacyEntry, meaning: "portal activity evidence only — not work done. lastSeenAt = the last ping / heartbeat of his own portal; visitPush = the Owner presence push of the latest visit (sent only after delivery); legacyLastPushedEntryAt = the pre-2026-09-27 push guard, not a last-seen" };
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
    if (!p.victor?.length && !eng.length && !p.ballEvidence.length) questions.push({ kind: "PROJECT_STATE", entity: p.key, questionHe: `"${p.name}" — מה המצב ועל מי הוא מחכה?`, why: "no Victor / engineer / send-log / blocker evidence recorded" });
  }
  for (const r of releaseRows) {
    if (r.active && r.targetDate) signals.push({ code: "RELEASE_PLANNED", kind: "CANONICAL_FACT", he: `ריליס "${r.projectName}" — ${r.stage}, יעד ${r.targetDate}`, entity: r.key });
    if (r.targetPassed) signals.push({ code: "RELEASE_TARGET_PASSED", kind: "DERIVED_SIGNAL", he: `יעד הריליס "${r.projectName}" (${r.targetDate}) עבר — יעד, לא התחייבות ללקוח.`, entity: r.key });
    if (r.blocker) signals.push({ code: "RELEASE_BLOCKER", kind: "CANONICAL_FACT", he: `חסם: ${r.blocker}`, entity: r.key });
    if (r.stage === "מוכן ליציאה") signals.push({ code: "READY_FOR_RELEASE", kind: "CANONICAL_FACT", he: `"${r.projectName}" מסומן מוכן ליציאה.`, entity: r.key });
    if (r.stage === "יצא") signals.push({ code: "RELEASED", kind: "CANONICAL_FACT", he: `"${r.projectName}" יצא${r.releasedAt ? ` (${r.releasedAt.slice(0, 10)})` : " (UNKNOWN_DATE — אין תאריך יציאה רשום)"}.`, entity: r.key });
    if (r.active) nextSteps.push({ step: `ריליס "${r.projectName}": ${r.stage}`, evidence: [r.nextAction && `הצעד הבא: ${r.nextAction}`, r.blocker && `חסם: ${r.blocker}`, r.responsible && `אחראי: ${r.responsible}`, r.targetDate && `יעד: ${r.targetDate}`].filter(Boolean).join(" · ") || "אין צעד הבא / חסם / אחראי רשומים", entity: r.key });
    if (r.active && relRead && !r.nextAction && !r.blocker) questions.push({ kind: "RELEASE", entity: r.key, questionHe: `ריליס "${r.projectName}" (${r.stage}) — מה הצעד הבא ומה חסר?`, why: "no next action / blocker recorded; Redbloods has no readiness checklist" });
  }
  if (releaseRows.length === 0) signals.push({ code: "NO_RELEASE_RECORDED", kind: "CANONICAL_FACT", he: "אין שורת ריליס רשומה לאמן." });
  const futureSessions = sessions.filter((s) => s.date && s.date >= c.today && s.status !== "בוטל");
  for (const s of futureSessions) signals.push({ code: "UPCOMING_SESSION", kind: "CANONICAL_FACT", he: `${s.type ?? "סשן"} ב-${s.date}${s.start ? ` ${s.start}` : ""}`, entity: s.project ?? s.show ?? undefined });
  for (const s of shows) {
    if (s.upcoming && s.status !== "בוטל") { signals.push({ code: "UPCOMING_SHOW", kind: "CANONICAL_FACT", he: `הופעה ${s.name ?? ""} ב-${s.date} (${s.status})`, entity: s.key }); nextSteps.push({ step: `הופעה ${s.date}`, evidence: `DJ: ${s.dj ? `${s.dj.name ?? "?"} (${s.dj.confirmation})` : "לא רשום"} · חזרות: ${s.rehearsals.length} · נשלח לאמן: ${s.sentToArtist}`, entity: s.key }); }
    if (s.role === "ARTIST" && !s.dj && s.dealType !== "UNPAID_COLLAB" && s.status !== "בוטל" && SHOW_ACTIVE.has(s.status ?? "") && s.upcoming) { signals.push({ code: "SHOW_WITHOUT_DJ", kind: "CANONICAL_FACT", he: `להופעה ב-${s.date} אין DJ רשום — CLEANTONE מנגן ברוב ההופעות, לא בכולן: לאשר.`, entity: s.key }); questions.push({ kind: "SHOW_DJ", entity: s.key, questionHe: `מי ה-DJ בהופעה ב-${s.date}?`, why: "no DJ recorded; never auto-assigned" }); }
    if (s.dealType !== "UNPAID_COLLAB" && s.status === "בוצע" && s.paymentStatus !== "שולם" && s.paymentStatus !== "בוטל") signals.push({ code: "SHOW_DONE_UNPAID", kind: "CANONICAL_FACT", he: `הופעה ${s.date} בוצעה, תשלום לקוח: ${s.paymentStatus}`, entity: s.key });
  }
  const moving = projects.some((p) => p.open && ((p.victor?.length ?? 0) > 0 || (p.engineers ?? []).some((e) => !["אושר", "בוטל"].includes(e.status ?? "")) || (p.sessions?.upcoming ?? 0) > 0));
  if (!moving && futureSessions.length === 0 && !releaseRows.some((r) => r.active && r.targetDate && r.targetDate >= c.today)) {
    signals.push({ code: "NO_UPCOMING_RECORDED_WORK", kind: "DERIVED_SIGNAL", he: "אין עבודה בתנועה, סשן עתידי או ריליס מתוכנן שרשומים ב-Redbloods — עובדה על הנתונים, לא שיפוט של האמן." });
    questions.push({ kind: "ARTIST_PLAN", entity: `label-artist:${artistId}`, questionHe: `מה התוכנית הבאה עם ${name}? (לא רשום שיר בתנועה, סשן או ריליס מתוכנן)`, why: "no recorded next work — the Owner's plan may live outside Redbloods" });
  }
  // media allocation model — reconciliation (facts on the records; never fixed automatically)
  for (const m of modelRows) {
    if (m.owner && m.financeTransaction === "MISSING") signals.push({ code: "MEDIA_FINANCE_LINK_MISSING", kind: "CANONICAL_FACT", he: `הכנסת מדיה ${m.source ?? ""} ${m.period ?? ""} (${m.gross}) במודל החלוקה בלי תנועת כספים מקושרת.`, entity: `media-income:${m.id}` });
    for (const a of m.allocations.filter((x) => x.artistId === artistId)) {
      const ent = a.entitlement;
      if (typeof ent === "string") signals.push({ code: "MEDIA_ENTITLEMENT_MISMATCH", kind: "CANONICAL_FACT", he: `להקצאת מדיה (${a.pct}% = ${a.amount}) אין זכאות ביומן האמן.`, entity: `media-income:${m.id}` });
      else if (Number(ent.amount ?? 0) !== a.expectedEntitlement || ent.rows > 1) signals.push({ code: "MEDIA_ENTITLEMENT_MISMATCH", kind: "CANONICAL_FACT", he: `זכאות המדיה ביומן (${ent.amount}${ent.rows > 1 ? `, ${ent.rows} שורות` : ""}) לא תואמת את ההקצאה (צפוי ${a.expectedEntitlement}).`, entity: `media-income:${m.id}` });
    }
  }
  if (ledger.length) signals.push({ code: "LEDGER_BALANCE", kind: "DERIVED_SIGNAL", he: `מאזן האמן: ${money.ledger?.allTime.balance} (בלי מטבע שמור)` });
  if (ledger.length && c.settings && !anchor) signals.push({ code: "CYCLE_NOT_SET", kind: "CANONICAL_FACT", he: "יש תנועות במאזן אבל לא הוגדר עוגן למחזורים." });
  if (availability.state === "RECORDED") signals.push({ code: "AVAILABILITY_THIS_WEEK", kind: "CANONICAL_FACT", he: `זמינות נשלחה ${(availability as { sentAt?: string | null }).sentAt ?? ""}` });
  if (clientRecords.length) signals.push({ code: "IDENTITY_DUAL_ROLE", kind: "CANONICAL_FACT", he: `${name} קיים גם כרשומת לקוח — תפקידים נפרדים; כסף לקוח לא נספר ככסף אמן.` });

  const history = [
    { at: identity.createdAt, event: "joined the roster", kind: "RECORDED" },
    ...releaseRows.flatMap((r) => [{ at: r.stageSince, event: `release "${r.projectName}" entered ${r.stage}`, kind: "RECORDED" }, ...(r.releasedAt ? [{ at: r.releasedAt, event: `release "${r.projectName}" first released`, kind: "RECORDED" }] : [])]),
    ...ledger.slice(0, 20).map((e) => ({ at: e.entryDate, event: `ledger ${e.entryType} ${e.amount}${e.description ? ` — ${e.description}` : ""}`, kind: "RECORDED" })),
    ...cycles.map((y) => ({ at: y.closedAt, event: `cycle ${y.cycleIndex} closed (ending ${y.endingBalance})`, kind: "RECORDED" })),
    ...media.map((m) => ({ at: m.receivedDate ?? m.createdAt, event: `media ${m.recordType} ${m.grossAmount} (${m.status})`, kind: "RECORDED" })),
    ...shows.map((s) => ({ at: s.date, event: `show (${s.status})`, kind: "RECORDED" })),
    ...sessions.slice(0, 20).map((s) => ({ at: s.date, event: `${s.type ?? "session"} (${s.status})`, kind: "RECORDED" })),
  ].filter((h) => h.at).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const lastRecorded = history.map((h) => String(h.at).slice(0, 10)).filter((d) => d <= c.today).sort().pop() ?? null;

  return { key, found: true as const, identity, projects, releases: releaseRows, nextRelease, cadence: { releasedDates, releasedCount: releasedRows.length, releasedUnknownDate, planned: releaseRows.filter((r) => r.active && r.targetDate).map((r) => r.targetDate), note: "evidence only — Redbloods has no cadence target" },
    beats, shows, money, sessions, calendar, tasks, meetings, redFilms, social, availability, presence, notifications: { availabilityRemindersClaimed: reminderRows, pushes: "see system_awareness artist_model pushes; Sunny never sends" },
    portal: { slug, loginRole: identity.portal.loginRole, storedOutsideDb: "sketches, ratings, next-work, press kit, performance files, profile image live in the artist's storage folder — not readable by Sunny" },
    ownerKnowledge: knowledge, signals, nextSteps, ...(() => { const r = resolveQuestions(questions.map((q) => ({ ...q, entity: q.entity ?? `label-artist:${artistId}` })), c.kn, c.today); return { questions: r.asked, known: r.known }; })(), history, lastRecordedActivity: lastRecorded, unavailable };
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
