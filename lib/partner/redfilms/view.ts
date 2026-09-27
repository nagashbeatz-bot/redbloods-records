/**
 * Sunny — the CONNECTED VIDEO VIEW: Red Films productions + the project clip deal. Pure, read-only.
 *
 * Two systems, never merged:
 *   - RED FILMS: productions (status, edit status, crew names, shoot date, links, budget, budget lines + Red Films' own
 *     payments ledger, documents, references, tasks, client price / collection);
 *   - the PROJECT clip deal: clip price + clip income, clip planning rows, clip shoot sessions (+ calendar), clip-scoped
 *     Finance expenses.
 * They are joined only on the stored project id. Money stays in layers (B3 Owner canon 2026-09-27, never added together):
 *   A client clip price / clip income ≠ B planned (budget, lines, clip rows) ≠ C actual cost (Finance, scope קליפ, paid
 *   only when שולם) ≠ D recoupable (none — שליו / אבי: a cycle expense; others: no agreement). Red Films ledger payments
 *   are real company money: DB-1 (live 2026-09-27) links each payment to exactly ONE Finance expense — a LINKED payment
 *   is part of C (never counted again); only UNLINKED payments are outside Finance (RF_LEDGER_NOT_IN_FINANCE); a
 *   non-clip production's payment has no canonical Finance scope (SCOPE_REQUIRED). Line paid state = lib/clip-rf-money-pure budgetLinePaidState
 *   (payments; the stored line status is planning intent; actual_amount is a LEGACY manual mirror, never paid).
 * A plan is never counted as spent; currencies are never added (each Red Films money row carries its own currency since 2026-09-27; totals are per currency). The clip deal
 * uses the app's own summarizeClipFinance; expenses use the Finance Brain's validateTx.
 * No score, no readiness verdict, no invented policy (a release never requires a video).
 */
import type { GatewaySources } from "../gateway/core";
import type { PartnerCompanyState } from "../eyes/types";
import type { OperationsRaw, OpsRedFilmsProduction } from "../operations/types";
import type { ProjectDetailRaw } from "../projects/detail-types";
import type { FinanceRaw, FinanceTxRow } from "../finance/types";
import { validateTx } from "../finance/core";
import { heldIsLegacyPossiblyAutoMarked } from "../../session-duration";
import { projectOperating } from "../sunny/operating";
import { summarizeClipFinance, CLIP_SCOPE } from "../../clip-finance";
import { normalizeCurrency } from "../../finance/currency";
import { budgetLinePaidState, budgetLineStatusConflict, budgetEqualsOldClipPriceSync, BUDGET_EQUALS_CLIP_PRICE_HE, clipRecoupContribution, isClipItemPlanned, isClipItemPromoted, rfPaymentFinanceScope, rfPaymentLinkage, RF_LEDGER_LINKAGE, RF_LEDGER_LINKAGE_HE } from "../../clip-rf-money-pure";
import { agreementArtistOf, AGREEMENT_CYCLE_ACCOUNTING_HE } from "../../label-agreements";

const ok = <T,>(a: { status: string; value?: T } | undefined): T | null => (a && a.status === "OK" ? (a as { value: T }).value : null);
const ilToday = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const round2 = (n: number) => Math.round(n * 100) / 100;
export const SHOOT_SESSION_TYPE = "צילום קליפ";
/** Production statuses at or after the shoot (the status list order is the app's own). */
const SHOT_OR_LATER = new Set(["צולם", "חומרי גלם הועלו", "בעריכה", "נשלחה גרסה", "תיקונים", "מאושר", "פורסם"]);
const addByCurrency = (acc: Record<string, number>, cur: string, amt: number) => { acc[cur] = round2((acc[cur] ?? 0) + amt); };

export interface VideoSignal { code: string; kind: "CANONICAL_FACT" | "DERIVED_SIGNAL" | "UNKNOWN"; he: string; production?: string; project?: string }
export interface VideoQuestion { questionHe: string; why: string; kind: string; ref?: string }

interface Ctx { st: PartnerCompanyState | null; ops: OperationsRaw | null; det: ProjectDetailRaw | null; fin: FinanceRaw | null; today: string }
function ctxOf(src: GatewaySources): Ctx {
  const st = ok(src.state) as PartnerCompanyState | null;
  const f = ok(src.finance);
  return { st, ops: ok(src.operations) as OperationsRaw | null, det: ok(src.projectDetail) as ProjectDetailRaw | null, fin: f ? f.raw : null, today: st?.todayIL ?? ilToday(src.now) };
}
const clipTx = (c: Ctx, projectId: string | null) => (c.fin?.transactions ?? []).filter((t) => (t.expenseScope ?? "") === CLIP_SCOPE && (!projectId || t.projectId === projectId));

function expenseLayer(rows: FinanceTxRow[]) {
  const total: Record<string, number> = {}, paid: Record<string, number> = {}, unpaid: Record<string, number> = {};
  const invalid: Array<{ id: string; status: string | null }> = [];
  for (const t of rows.filter((x) => x.type === "expense")) {
    const v = validateTx(t);
    if (!v) { invalid.push({ id: t.id, status: t.status }); continue; }
    if (v.cancelled) continue;
    addByCurrency(total, v.currency, v.amount);
    addByCurrency(v.received ? paid : unpaid, v.currency, v.amount);
  }
  return { total, paid, unpaid, invalid, note: "ACTUAL expenses (Finance, expense scope קליפ) — canonical; paid only when שולם; התקבל on an expense is invalid" };
}

export function buildProduction(src: GatewaySources, p: OpsRedFilmsProduction) {
  const c = ctxOf(src);
  const d = (c.det?.productions?.rows ?? []).find((x) => x.id === p.id) ?? null;
  const idx = c.st?.domains.projects.data?.index ?? {};
  const proj = p.projectId ? idx[p.projectId] ?? null : null;
  const lines = (c.det?.budgetItems?.rows ?? []).filter((b) => b.productionId === p.id);
  const pays = (c.det?.budgetPayments?.rows ?? []).filter((b) => b.productionId === p.id);
  const docs = (c.det?.rfDocuments?.rows ?? []).filter((x) => x.productionId === p.id);
  const refImages = (c.det?.rfRefImages?.rows ?? []).filter((x) => x.productionId === p.id);
  const refLinks = (c.det?.rfRefLinks?.rows ?? []).filter((x) => x.productionId === p.id);
  const crewRows = (c.det?.rfCrew?.rows ?? []).filter((x) => x.productionId === p.id);
  const tasks = (c.det?.tasks?.rows ?? []).filter((t) => t.relatedType === "red_film_production" && t.relatedId === p.id);
  const sessions = p.projectId ? (c.det?.sessions?.rows ?? []).filter((s) => s.projectId === p.projectId && s.type === SHOOT_SESSION_TYPE) : [];
  const projSetting = p.projectId ? ((c.fin?.financeSettings ?? []).find((s) => s.projectId === p.projectId)?.value as Record<string, unknown> | undefined) ?? null : null;
  const managedId = projSetting?.clipProductionId ?? null;
  const active = p.status !== "בוטל";
  const shootPassed = !!p.shootDate && p.shootDate < c.today;
  const shot = SHOT_OR_LATER.has(p.status ?? "");
  // per currency — amounts in different currencies are never added (no FX)
  const byCur = <T,>(rows: readonly T[], cur: (r: T) => string | null | undefined, amt: (r: T) => number | null | undefined) => rows.reduce<Record<string, number>>((m, r) => { const c = normalizeCurrency(cur(r)); m[c] = round2((m[c] ?? 0) + (amt(r) ?? 0)); return m; }, {});
  /** A line's payments, PER CURRENCY (a payment carries its line currency; never a mixed scalar). */
  const linePaid = (id: string | null) => byCur(pays.filter((x) => x.budgetItemId === id), (x) => x.currency, (x) => x.amount);
  /** THE line paid rule (lib/clip-rf-money-pure) — the same answer as the Red Films screen. */
  const lineState = (l: (typeof lines)[number]) => { const lp = pays.filter((x) => x.budgetItemId === l.id).map((x) => ({ amount: x.amount, currency: x.currency })); const ln = { planned_amount: l.planned, currency: l.currency ?? "₪", status: l.status }; return { ...budgetLinePaidState(ln, lp), conflict: l.status === "בוטל" ? null : budgetLineStatusConflict(ln, lp) }; };
  const plannedLines = byCur(lines.filter((l) => l.status !== "בוטל"), (l) => l.currency, (l) => l.planned);
  const paidLedger = byCur(pays, (x) => x.currency, (x) => x.amount);
  // DB-1: a LINKED payment is its ONE Finance expense (part of the actual cost C) — only the UNLINKED ones are outside Finance
  const payLinkage = pays.map((x) => rfPaymentLinkage({ linkedTransactionId: x.linkedTransactionId ?? null }, { productionType: p.productionType, projectId: p.projectId }));
  const paidLinked = byCur(pays.filter((_x, i) => payLinkage[i] === "LINKED"), (x) => x.currency, (x) => x.amount);
  const paidOutsideFinance = byCur(pays.filter((_x, i) => payLinkage[i] !== "LINKED"), (x) => x.currency, (x) => x.amount);
  const linkedCount = payLinkage.filter((x) => x === "LINKED").length;
  const manualActual = byCur(lines, (l) => l.currency, (l) => l.actual);
  const clipPrice = Number(projSetting?.clipAgreedPrice ?? 0) || 0;
  const scope = rfPaymentFinanceScope(p.productionType);
  const links = d?.links ?? null;
  return {
    key: `video-production:${p.id}`, id: p.id, title: p.title, type: p.productionType, typeReadable: !!p.productionType && /^[֐-׿A-Za-z0-9 /.\-]+$/.test(p.productionType),
    status: p.status, editStatus: p.editStatus, active,
    project: p.projectId ? { key: `project:${p.projectId}`, name: proj?.name ?? null, status: proj?.status ?? null, businessType: proj?.businessType ?? null, exists: !!proj, link: "CANONICAL (stored project id)" } : null,
    managedBySendClip: !!p.projectId && managedId === p.id, artistText: p.artistName, client: { id: p.clientId, nameSnapshot: d?.clientNameSnapshot ?? null, link: p.clientId ? "TEXT_MATCH (artist name → client, stored as an id)" : null }, clientSource: p.clientSource,
    crew: { photographer: d?.photographer ?? null, director: d?.director ?? null, editor: d?.editor ?? null, identity: "free-text names (no person record)", crewTableRows: crewRows.length },
    shoot: { productionShootDate: p.shootDate, datePassed: shootPassed, statusSaysShot: shot, meaning: "a passed date never proves a shoot — only the status (צולם …) or a shoot session explicitly marked התקיים (after AUTO_MARK_RETIRED_AT; an older התקיים is legacy, possibly auto-marked by the retired page-load writer)", locations: d?.locations ?? null,
      sessions: sessions.map((s) => ({ date: s.date, start: s.startTime, end: s.endTime, status: s.status, photographer: s.photographer, location: s.location, calendar: s.hasCalendarEvent ? "LINKED (event id stored — live details via the calendar capability)" : "NO_EVENT_STORED", expenseLinked: (c.fin?.transactions ?? []).some((t) => t.linkedSessionId === s.id) })) },
    concept: { summary: d?.conceptSummary ?? null, vibe: d?.conceptVibe ?? null, script: d?.script ?? null, directorNotes: d?.directorNotes ?? null, photographerNotes: d?.photographerNotes ?? null, hasReferenceLinksText: links?.references ?? false },
    editing: { editStatus: p.editStatus, fixNotes: d?.fixNotes ?? null, links: links ? { raw: links.rawFiles, editFolder: links.editFolder, version1: links.version1, version2: links.version2, final: links.finalVersion } : null, note: "the only version / final evidence is a pasted link + the edit status; no version records, no review history" },
    publication: { publishDate: p.publishDate, publishedWhere: d?.publishedWhere ?? null },
    files: { folder: d?.dropboxFolderPath ? "RECORDED" : "NONE", documents: docs.map((x) => ({ fileName: x.fileName, type: x.fileType, mime: x.mimeType, uploadedAt: x.createdAt, publicLink: x.hasPublicLink })), referenceImages: refImages.length, referenceLinks: refLinks.map((x) => ({ provider: x.provider, title: x.title })), storageListing: "NOT_AVAILABLE (capability gap) — records only; 'no link' ≠ 'no footage'" },
    tasks: tasks.map((t) => ({ title: t.title, status: t.status, due: t.dueDate, relation: "CANONICAL (production task)" })),
    money: { currency: d?.currency ?? "₪", totalsNote: "planned / paid / actual are grouped PER CURRENCY — never added across currencies (no FX)", budget: p.generalBudget,
      budgetIsPlanning: "B — the production's own planning budget; never the client clip price (A), never an actual cost (C), never a recoup (D)",
      budgetEqualsOldClipPriceSync: budgetEqualsOldClipPriceSync({ managedBySendClip: !!p.projectId && managedId === p.id, budget: p.generalBudget, budgetCurrency: d?.currency ?? p.currency, clipAgreedPrice: clipPrice, clipCurrency: typeof projSetting?.currency === "string" ? projSetting.currency : null }) ? { epistemic: "DERIVED", he: BUDGET_EQUALS_CLIP_PRICE_HE } : null,
      plannedLines, paidRedFilmsLedger: paidLedger, paidLinkedInFinance: paidLinked, paidOutsideFinance, legacyManualActualOnLines: manualActual,
      payments: pays.map((x, i) => ({ key: x.id ? `rf-payment:${x.id}` : null, date: x.date, amount: x.amount, currency: x.currency ?? "₪", method: x.method, line: lines.find((l) => l.id === x.budgetItemId)?.title ?? null, financeLinkage: payLinkage[i] })),
      lines: lines.map((l) => { const s = lineState(l); return { title: l.title, category: l.category, storedStatus: l.status, storedStatusMeaning: "planning intent only", paidState: s.state, paid: s.paid, remaining: s.remaining, over: s.over, statusConflict: s.conflict ? s.conflict.code : null, currency: l.currency ?? "₪", planned: l.planned, legacyManualActual: l.actual, paidFromPayments: linePaid(l.id), vendor: l.vendorName, legacyFinanceLink: !!l.linkedTransactionId }; }),
      clientPrice: p.clientPrice, advanceRequired: p.advanceRequired, advanceReceived: p.advanceReceived, collectionStatus: p.collectionStatus,
      linkage: !pays.length ? { state: "NO_PAYMENTS", he: "אין תשלומים", linked: 0, unlinked: 0 } : linkedCount === pays.length ? { state: "ALL_LINKED", he: "כל התשלומים מקושרים להוצאה בכספים (כל תשלום = הוצאה אחת, שיוך קליפ) — נספרים בכספים בלבד", linked: linkedCount, unlinked: 0 } : { state: RF_LEDGER_LINKAGE, he: RF_LEDGER_LINKAGE_HE, linked: linkedCount, unlinked: pays.length - linkedCount },
      financeScope: scope.scope ? { scope: scope.scope } : { scope: null, state: scope.state, he: scope.he },
      layers: "budget / lines = PLANNED (B); payments = the Red Films ledger — real company money; DB-1 (live): each payment → exactly ONE linked Finance expense (scope קליפ, שולם), so a LINKED payment is already in the actual cost C (paidLinkedInFinance — never added again) and only paidOutsideFinance is not in Finance yet (RF_LEDGER_NOT_IN_FINANCE); actual cost (C) = Finance expenses with scope קליפ only. A line's legacyFinanceLink is the old per-line Finance link, not a payment link. actual_amount is a LEGACY manual mirror — never paid",
      recoup: clipRecoupContribution(agreementArtistOf({ name: p.artistName ?? null }) ? AGREEMENT_CYCLE_ACCOUNTING_HE : null) },
    createdAt: d?.createdAt ?? null, updatedAt: d?.updatedAt ?? null,
  };
}
export type VideoProduction = ReturnType<typeof buildProduction>;
/** Per-currency amounts: any non-zero, and a stable "₪1,200 · $300" text (never a cross-currency sum). */
const anyAmount = (m: Record<string, number>) => Object.values(m).some((x) => x > 0);
const fmtByCur = (m: Record<string, number>) => Object.entries(m).filter(([, a]) => a !== 0).sort(([a], [b]) => a.localeCompare(b)).map(([c, a]) => `${c}${a}`).join(" · ") || "0";

/** The PROJECT side: clip deal, clip rows, shoot sessions, clip expenses — for one project. */
export function buildProjectVideo(src: GatewaySources, projectId: string) {
  const c = ctxOf(src);
  const idx = c.st?.domains.projects.data?.index ?? {};
  const proj = idx[projectId] ?? null;
  const op = proj ? projectOperating(src, projectId) : null;
  const setting = ((c.fin?.financeSettings ?? []).find((s) => s.projectId === projectId)?.value ?? {}) as Record<string, unknown>;
  const price = Number(setting.clipAgreedPrice ?? 0) || 0;
  // The clip deal is in the project's finance currency (the same setting as the agreed price); clip rows in any other currency
  // are reported apart by summarizeClipFinance (otherCurrency), never summed with the deal — same rule as projects/money.ts.
  const dealCurrency = normalizeCurrency(typeof setting.currency === "string" ? setting.currency : null);
  const txs = clipTx(c, projectId);
  const deal = summarizeClipFinance(txs.map((t) => ({ type: t.type, amount: Number(t.amount) || 0, payment_status: t.status, expense_scope: t.expenseScope, currency: t.currency })), price, dealCurrency);
  const rows = (c.det?.clipItems?.rows ?? []).filter((r) => r.projectId === projectId);
  const txIds = new Set((c.fin?.transactions ?? []).map((t) => t.id));
  const planned: Record<string, number> = {};
  // B3: planned = UNLINKED rows only (lib/clip-rf-money-pure isClipItemPlanned); a promoted row is kept as provenance
  for (const r of rows.filter((x) => isClipItemPlanned(x))) addByCurrency(planned, r.currency ?? "₪", r.amount ?? 0);
  const sessions = (c.det?.sessions?.rows ?? []).filter((s) => s.projectId === projectId && s.type === SHOOT_SESSION_TYPE);
  const productions = (c.ops?.redFilms?.rows ?? []).filter((p) => p.projectId === projectId).map((p) => ({ key: `video-production:${p.id}`, id: p.id, status: p.status, type: p.productionType }));
  const release = (c.st?.domains.releasesFull.data?.items ?? []).find((r) => r.projectId === projectId) ?? null;
  const social = (c.det?.contentItems?.rows ?? []).filter((x) => x.projectId === projectId).map((x) => ({ title: x.title, status: x.status, platform: x.platform, publishDate: x.publishDate, posted: !!x.postedUrl, relation: "same project (not linked to a production)" }));
  return {
    key: `project-video:${projectId}`, project: { key: `project:${projectId}`, name: proj?.name ?? null, status: proj?.status ?? null, businessType: proj?.businessType ?? null, exists: !!proj },
    labelWork: op?.label.labelWork ?? null, clientDeadline: op ? { date: op.clientDeadline.date, class: op.clientDeadline.class, meaning: "the client / project commitment — not a video deadline" } : null,
    clipDeal: { price, ...deal, note: "clip deal = the artist pays for the clip (INCOME, expense scope קליפ) — revenue, never a video expense; excluded from the song balance" },
    planning: { rows: rows.map((r) => { const tx = r.linkedTransactionId ? (c.fin?.transactions ?? []).find((t) => t.id === r.linkedTransactionId) ?? null : null; const txAmt = tx ? validateTx(tx)?.amount ?? null : null;
      return { category: r.category, description: r.description, amount: r.amount, currency: r.currency, status: r.status, transferred: !!r.linkedTransactionId, promoted: isClipItemPromoted(r), transactionExists: r.linkedTransactionId ? (c.fin ? txIds.has(r.linkedTransactionId) : null) : null,
        expenseDiffers: tx ? (txAmt !== r.amount || (tx.currency ?? "₪") !== (r.currency ?? "₪") ? { planned: r.amount, plannedCurrency: r.currency, expense: txAmt, expenseCurrency: tx.currency } : null) : null }; }), plannedByCurrency: planned, note: "PLANNED (B) — never money spent. 'העבר לכספים' keeps the row, marks it הועבר לכספים and links it to its Finance expense (B3 provenance; rows promoted before B3 were deleted); a promoted row is never counted as planned" },
    expenses: expenseLayer(txs),
    shoots: sessions.map((s) => ({ date: s.date, start: s.startTime, end: s.endTime, status: s.status, photographer: s.photographer, location: s.location, datePassed: !!s.date && s.date < c.today, happened: s.status === "התקיים", happenedBasis: s.status === "התקיים" ? (heldIsLegacyPossiblyAutoMarked({ status: s.status, date: s.date, start_time: s.startTime, end_time: s.endTime }) ? "LEGACY — possibly auto-marked by the retired page-load writer (not proof the shoot happened)" : "EXPLICIT — recorded by the Owner (the auto-mark is retired)") : s.status === "מתוכנן" && !!s.date && s.date < c.today ? "PASSED_NOT_CONFIRMED — עבר — לא אושר (a passed date never proves a shoot)" : null,
      calendar: s.hasCalendarEvent ? "LINKED (event id stored — live details via the calendar capability)" : "NO_EVENT_STORED", expense: (c.fin?.transactions ?? []).filter((t) => t.linkedSessionId === s.id).map((t) => ({ amount: validateTx(t)?.amount ?? null, currency: t.currency, status: t.status })) })),
    productions, release: release ? { stage: release.stage, target: release.targetYmd, releasedAt: release.releasedAt ?? null, note: "context only — a release never requires a video" } : null, social,
  };
}
export type ProjectVideo = ReturnType<typeof buildProjectVideo>;

export function buildVideoView(src: GatewaySources) {
  const c = ctxOf(src);
  const prods = (c.ops?.redFilms?.rows ?? []).map((p) => buildProduction(src, p)).sort((a, b) => Number(b.active) - Number(a.active) || (a.shoot.productionShootDate ?? "9999").localeCompare(b.shoot.productionShootDate ?? "9999"));
  const videoProjectIds = new Set<string>([
    ...(c.ops?.redFilms?.rows ?? []).map((p) => p.projectId).filter((x): x is string => !!x),
    ...(c.det?.clipItems?.rows ?? []).map((r) => r.projectId).filter((x): x is string => !!x),
    ...(c.det?.sessions?.rows ?? []).filter((s) => s.type === SHOOT_SESSION_TYPE).map((s) => s.projectId).filter((x): x is string => !!x),
    ...clipTx(c, null).map((t) => t.projectId).filter((x): x is string => !!x),
    ...(c.fin?.financeSettings ?? []).filter((s) => Number((s.value as Record<string, unknown> | null)?.clipAgreedPrice ?? 0) > 0).map((s) => s.projectId),
  ]);
  const projects = [...videoProjectIds].map((id) => buildProjectVideo(src, id));
  const signals: VideoSignal[] = [];
  const questions: VideoQuestion[] = [];
  for (const p of prods) {
    const S = (code: string, kind: VideoSignal["kind"], he: string) => signals.push({ code, kind, he, production: p.key, project: p.project?.key });
    if (!p.project) S("PRODUCTION_WITHOUT_PROJECT", "CANONICAL_FACT", `${p.title}: הפקה בלי פרויקט`);
    if (!p.active) continue;
    if (p.shoot.datePassed && !p.shoot.statusSaysShot) S("SHOOT_DATE_PASSED_NOT_SHOT", "DERIVED_SIGNAL", `${p.title}: תאריך הצילום (${p.shoot.productionShootDate}) עבר והסטטוס עדיין "${p.status}" — לא ידוע אם צולם; לא לקבוע שצולם`);
    if (p.shoot.sessions.some((s) => s.status === "התקיים") && !p.shoot.statusSaysShot) S("SHOOT_SESSION_HAPPENED_STATUS_STALE", "DERIVED_SIGNAL", `${p.title}: יום צילום בפרויקט סומן 'התקיים' אבל ההפקה עדיין "${p.status}"${p.shoot.sessions.some((s) => s.status === "התקיים" && heldIsLegacyPossiblyAutoMarked({ status: s.status, date: s.date, start_time: s.start, end_time: s.end })) ? " (סימון 'התקיים' ישן — ייתכן שסומן אוטומטית לפני ביטול הסימון האוטומטי; לא הוכחה שצולם)" : ""}`);
    if (p.project && ["הושלם", "בוטל"].includes(p.project.status ?? "")) S("PRODUCTION_STATUS_VS_PROJECT", "DERIVED_SIGNAL", `${p.title}: הפרויקט ${p.project.status} וההפקה פעילה (${p.status})`);
    if (p.project?.businessType === "לקוח" && p.clientSource === "פנימי - לייבל") S("CLIENT_SOURCE_MISLABELLED", "DERIVED_SIGNAL", `${p.title}: מסומנת 'פנימי - לייבל' אבל הפרויקט של לקוח`);
    if (anyAmount(p.money.plannedLines) || (p.money.budget ?? 0) > 0) S("PLANNED_NOT_SPENT", "CANONICAL_FACT", `${p.title}: תקציב ${p.money.currency}${p.money.budget ?? 0}, שורות מתוכננות ${fmtByCur(p.money.plannedLines)} — תכנון, לא הוצאה`);
    if (anyAmount(p.money.paidOutsideFinance)) S("RF_LEDGER_NOT_IN_FINANCE", "CANONICAL_FACT", `${p.title}: ${fmtByCur(p.money.paidOutsideFinance)} שולמו בפנקס של Red Films ועדיין לא מקושרים לכספים (${p.money.linkage.unlinked} תשלומים) — כסף אמיתי של החברה${p.money.financeScope.scope ? (p.project ? "; קישור: LINK_RF_PAYMENT_TO_FINANCE / LINK_RF_PAYMENTS_FOR_PRODUCTION" : " — הפקת קליפ בלי פרויקט: צריך פרויקט לפני קישור (PROJECT_REQUIRED)") : " — אין שיוך קנוני בכספים להפקה שאינה קליפ (SCOPE_REQUIRED: נדרשת החלטה, לא 'כללי')"}`);
    if (fmtByCur(p.money.legacyManualActualOnLines) !== fmtByCur(p.money.paidRedFilmsLedger) && p.money.lines.length) S("LINE_ACTUAL_VS_PAYMENTS", "DERIVED_SIGNAL", `${p.title}: 'בפועל' ידני (שדה ישן) ${fmtByCur(p.money.legacyManualActualOnLines)} ≠ תשלומים ${fmtByCur(p.money.paidRedFilmsLedger)} — התשלומים הם הקובעים`);
    for (const l of p.money.lines.filter((x) => x.statusConflict)) S("BUDGET_LINE_STATUS_VS_PAYMENTS", "DERIVED_SIGNAL", `${p.title} · ${l.title || l.category || "שורה"}: ${l.statusConflict === "STATUS_PAID_WITHOUT_PAYMENTS" ? "מסומנת 'שולם' ואין עליה תשלום רשום" : `מסומנת 'מתוכנן' והתשלומים כבר מכסים את התכנון (${l.currency}${l.paid})`} — שני מקורות סותרים; התשלומים קובעים מה שולם`);
    if (p.money.budgetEqualsOldClipPriceSync) S("BUDGET_EQUALS_CLIP_PRICE_OLD_SYNC", "DERIVED_SIGNAL", `${p.title}: ${BUDGET_EQUALS_CLIP_PRICE_HE}`);
    const missing = [!p.shoot.locations && !p.shoot.sessions.some((s) => s.location) ? "לוקיישן" : null, !p.crew.photographer && !p.crew.director ? "צלם / במאי" : null, !p.files.documents.length ? "מסמכים" : null].filter(Boolean);
    if (missing.length) S("MISSING_RECORDED_PREP", "CANONICAL_FACT", `${p.title}: לא רשום במערכת — ${missing.join(", ")} (עובדה, לא קביעה שההפקה לא מוכנה)`);
  }
  for (const pv of projects) {
    const S = (code: string, kind: VideoSignal["kind"], he: string) => signals.push({ code, kind, he, project: pv.project.key });
    const name = pv.project.name ?? "פרויקט";
    const activeProds = pv.productions.filter((x) => x.status !== "בוטל");
    if (pv.productions.length > 1) S("DUPLICATE_PRODUCTIONS", "CANONICAL_FACT", `${name}: ${pv.productions.length} הפקות על אותו פרויקט (${activeProds.length} פעילות)`);
    if (!activeProds.length && (pv.clipDeal.price > 0 || pv.planning.rows.length || pv.shoots.length || Object.keys(pv.expenses.total).length)) S("PROJECT_VIDEO_NO_PRODUCTION", "CANONICAL_FACT", `${name}: יש מידע קליפ בפרויקט (עסקה / תכנון / יום צילום / הוצאה) ואין הפקה פעילה ב-Red Films`);
    for (const r of pv.planning.rows.filter((x) => x.transferred && x.transactionExists === false)) S("CLIP_ROW_PROMOTED_MISSING_TX", "CANONICAL_FACT", `${name}: שורת תכנון '${r.category ?? ""}' ${r.currency ?? ""}${r.amount ?? ""} מסומנת 'הועבר לכספים' — העסקה לא קיימת`);
    for (const [cur, amt] of Object.entries(pv.expenses.unpaid)) S("CLIP_EXPENSE_UNPAID", "CANONICAL_FACT", `${name}: הוצאות קליפ לא משולמות ${cur}${amt}`);
    for (const x of pv.expenses.invalid) S("CLIP_EXPENSE_RECEIVED_STATUS", "CANONICAL_FACT", `${name}: הוצאת קליפ בסטטוס '${x.status ?? "—"}' — לא תקין להוצאה, לא נחשבת ששולמה`);
    if (pv.clipDeal.price > 0 && pv.clipDeal.remaining > 0) S("CLIP_DEAL_OPEN", "CANONICAL_FACT", `${name}: עסקת קליפ ${pv.clipDeal.currency}${pv.clipDeal.price}, התקבל ${pv.clipDeal.currency}${pv.clipDeal.paid}, נותר ${pv.clipDeal.currency}${pv.clipDeal.remaining}`);
    for (const r of pv.planning.rows.filter((x) => x.expenseDiffers)) S("CLIP_PLAN_VS_EXPENSE", "DERIVED_SIGNAL", `${name}: תכנון ${r.currency ?? ""}${r.amount ?? ""} מול הוצאה בפועל ${r.expenseDiffers!.expenseCurrency ?? ""}${r.expenseDiffers!.expense ?? ""} — ההוצאה בכספים היא הקנונית`);
    if (pv.social.some((x) => x.posted) && activeProds.some((x) => x.status !== "פורסם")) S("PUBLISHED_CONTENT_VS_PRODUCTION", "DERIVED_SIGNAL", `${name}: יש תוכן שפורסם בפרויקט אבל ההפקה עדיין "${activeProds.find((x) => x.status !== "פורסם")!.status}" — שני מקורות, לא מתקן`);
    if (pv.release) S("RELEASE_CONTEXT", "CANONICAL_FACT", `${name}: ריליס בשלב ${pv.release.stage}${pv.release.target ? `, יעד ${pv.release.target}` : ""} — הקשר בלבד, ריליס לא מחייב קליפ`);
  }
  const active = prods.filter((p) => p.active);
  if (active.some((p) => p.shoot.datePassed && !p.shoot.statusSaysShot)) questions.push({ kind: "STATUS", questionHe: `${active.filter((p) => p.shoot.datePassed && !p.shoot.statusSaysShot).map((p) => p.title).join(", ")} — תאריך הצילום עבר והסטטוס 'רעיון'. הקליפ צולם? איפה הוא עומד?`, why: "the status is manual; outside progress is invisible" });
  if (projects.some((pv) => pv.planning.rows.some((r) => r.transferred && r.transactionExists === false))) questions.push({ kind: "FINANCE", questionHe: "שורת תכנון קליפ מסומנת 'הועבר לכספים' אבל ההוצאה לא קיימת בכספים — נמחקה בכוונה?", why: "a transferred plan without its expense" });
  if (active.some((p) => anyAmount(p.money.paidOutsideFinance) && p.money.financeScope.scope && p.project)) questions.push({ kind: "FINANCE", questionHe: "יש תשלומי Red Films של קליפ שעוד לא מקושרים לכספים — לקשר אותם עכשיו (כל תשלום = הוצאה אחת בכספים)?", why: "DB-1: each payment → ONE Finance expense; historical payments are linked by the Owner's typed action" });
  const sumCur = (pick: (p: VideoProduction) => Record<string, number>) => { const m: Record<string, number> = {}; for (const p of active) for (const [c, a] of Object.entries(pick(p))) m[c] = round2((m[c] ?? 0) + a); return m; };
  const totals = { plannedBudget: sumCur((p) => ({ [p.money.currency]: p.money.budget ?? 0 })), plannedLines: sumCur((p) => p.money.plannedLines), paidRedFilmsLedger: sumCur((p) => p.money.paidRedFilmsLedger), paidLinkedInFinance: sumCur((p) => p.money.paidLinkedInFinance), paidOutsideFinance: sumCur((p) => p.money.paidOutsideFinance), currency: "PER CURRENCY — never added across currencies; paidLinkedInFinance is already inside actualClipExpenses (never add the two)" };
  const expenses: Record<string, Record<string, number>> = { total: {}, paid: {}, unpaid: {} };
  for (const pv of projects) for (const k of ["total", "paid", "unpaid"] as const) for (const [cur, amt] of Object.entries(pv.expenses[k])) addByCurrency(expenses[k], cur, amt);
  const clipPlanned: Record<string, number> = {};
  for (const pv of projects) for (const [cur, amt] of Object.entries(pv.planning.plannedByCurrency)) addByCurrency(clipPlanned, cur, amt);
  return {
    counts: { productions: prods.length, active: active.length, cancelled: prods.length - active.length, byStatus: prods.reduce<Record<string, number>>((m, p) => { m[p.status ?? "—"] = (m[p.status ?? "—"] ?? 0) + 1; return m; }, {}),
      withoutProject: prods.filter((p) => !p.project).length, managedBySendClip: prods.filter((p) => p.managedBySendClip).length, videoProjects: projects.length, clipDeals: projects.filter((p) => p.clipDeal.price > 0).length,
      shootSessions: projects.reduce((n, p) => n + p.shoots.length, 0), upcomingShoots: projects.reduce((n, p) => n + p.shoots.filter((s) => !s.datePassed && s.status !== "בוטל").length, 0), note: "recorded counts — no score, no readiness verdict" },
    money: { redFilms: totals, clipPlanningByCurrency: clipPlanned, actualClipExpenses: expenses, clipIncome: clipIncomeByCurrency(projects),
      rule: "A client clip price / clip income (revenue) ≠ B planned (budget, lines, clip rows) ≠ C actual cost (Finance expenses with scope קליפ; paid only when שולם) ≠ D recoupable (NOT_DEFINED — none: for שליו / אבי the artist's 50 % of C is an artist expense in the bi-monthly cycle, never repaid by a specific income — media is separate 50 / 50 income; any other artist has no agreement). Red Films payments are real company money: DB-1 links each one to exactly ONE Finance expense — a linked payment is inside C (never added again), only paidOutsideFinance is not in Finance yet; a non-clip production's payment has no canonical Finance scope (SCOPE_REQUIRED). Layers are never added; currencies never added",
      clipRecoup: clipRecoupContribution(`${AGREEMENT_CYCLE_ACCOUNTING_HE} (שליו / אבי); לכל אמן אחר — אין הסכם.`) },
    productions: prods, projects, signals, questions,
    unavailable: [...(c.ops ? [] : ["OPERATIONS (productions) — unknown, not none"]), ...(c.det ? [] : ["PROJECT_DETAIL (production detail, budget lines, documents, sessions, clip rows)"]), ...(c.fin ? [] : ["FINANCE (clip deal, expenses)"]), "storage itself is not listed — 'no link' ≠ 'no footage'", "calendar event details are read live by the calendar capability"],
  };
}
export type VideoView = ReturnType<typeof buildVideoView>;

/**
 * Clip-deal income PER CURRENCY (deal price / received / expected in each deal's own currency, plus clip rows that were
 * recorded in a currency other than their deal's). Never a mixed scalar, no FX.
 */
export function clipIncomeByCurrency(projects: ReadonlyArray<{ clipDeal: { currency: string; price: number; paid: number; expected: number; otherCurrency: Record<string, { paid: number; expected: number; count: number }> } }>): Record<string, { price: number; received: number; expected: number }> {
  const out: Record<string, { price: number; received: number; expected: number }> = {};
  const at = (c: string) => (out[c] ??= { price: 0, received: 0, expected: 0 });
  for (const p of projects) {
    const b = at(p.clipDeal.currency);
    b.price = round2(b.price + p.clipDeal.price); b.received = round2(b.received + p.clipDeal.paid); b.expected = round2(b.expected + p.clipDeal.expected);
    for (const [c, o] of Object.entries(p.clipDeal.otherCurrency)) { const x = at(c); x.received = round2(x.received + o.paid); x.expected = round2(x.expected + o.expected); }
  }
  for (const [c, b] of Object.entries(out)) if (!b.price && !b.received && !b.expected) delete out[c];
  return out;
}
