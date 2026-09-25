/**
 * Sunny — the CONNECTED VIDEO VIEW: Red Films productions + the project clip deal. Pure, read-only.
 *
 * Two systems, never merged:
 *   - RED FILMS: productions (status, edit status, crew names, shoot date, links, budget, budget lines + Red Films' own
 *     payments ledger, documents, references, tasks, client price / collection);
 *   - the PROJECT clip deal: clip price + clip income, clip planning rows, clip shoot sessions (+ calendar), clip-scoped
 *     Finance expenses.
 * They are joined only on the stored project id. Money stays in layers:
 *   planned → Red Films paid (own ledger) → actual Finance expense → paid expense.
 * A plan is never counted as spent; currencies are never added; Red Films money has no currency column. The clip deal
 * uses the app's own summarizeClipFinance; expenses use the Finance Brain's validateTx.
 * No score, no readiness verdict, no invented policy (a release never requires a video).
 */
import type { GatewaySources } from "../gateway/core";
import type { PartnerCompanyState } from "../eyes/types";
import type { OperationsRaw, OpsRedFilmsProduction } from "../operations/types";
import type { ProjectDetailRaw } from "../projects/detail-types";
import type { FinanceRaw, FinanceTxRow } from "../finance/types";
import { validateTx } from "../finance/core";
import { projectOperating } from "../sunny/operating";
import { summarizeClipFinance, CLIP_SCOPE } from "../../clip-finance";

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
  const managedId = p.projectId ? ((c.fin?.financeSettings ?? []).find((s) => s.projectId === p.projectId)?.value as Record<string, unknown> | undefined)?.clipProductionId ?? null : null;
  const active = p.status !== "בוטל";
  const shootPassed = !!p.shootDate && p.shootDate < c.today;
  const shot = SHOT_OR_LATER.has(p.status ?? "");
  const linePaid = (id: string | null) => round2(pays.filter((x) => x.budgetItemId === id).reduce((s, x) => s + (x.amount ?? 0), 0));
  const plannedLines = round2(lines.filter((l) => l.status !== "בוטל").reduce((s, l) => s + (l.planned ?? 0), 0));
  const paidLedger = round2(pays.reduce((s, x) => s + (x.amount ?? 0), 0));
  const manualActual = round2(lines.reduce((s, l) => s + (l.actual ?? 0), 0));
  const links = d?.links ?? null;
  return {
    key: `video-production:${p.id}`, id: p.id, title: p.title, type: p.productionType, typeReadable: !!p.productionType && /^[֐-׿A-Za-z0-9 /.\-]+$/.test(p.productionType),
    status: p.status, editStatus: p.editStatus, active,
    project: p.projectId ? { key: `project:${p.projectId}`, name: proj?.name ?? null, status: proj?.status ?? null, businessType: proj?.businessType ?? null, exists: !!proj, link: "CANONICAL (stored project id)" } : null,
    managedBySendClip: !!p.projectId && managedId === p.id, artistText: p.artistName, client: { id: p.clientId, nameSnapshot: d?.clientNameSnapshot ?? null, link: p.clientId ? "TEXT_MATCH (artist name → client, stored as an id)" : null }, clientSource: p.clientSource,
    crew: { photographer: d?.photographer ?? null, director: d?.director ?? null, editor: d?.editor ?? null, identity: "free-text names (no person record)", crewTableRows: crewRows.length },
    shoot: { productionShootDate: p.shootDate, datePassed: shootPassed, statusSaysShot: shot, meaning: "a passed date never proves a shoot — only the status (צולם …) or a shoot session התקיים", locations: d?.locations ?? null,
      sessions: sessions.map((s) => ({ date: s.date, start: s.startTime, end: s.endTime, status: s.status, photographer: s.photographer, location: s.location, calendar: s.hasCalendarEvent ? "LINKED (event id stored — live details via the calendar capability)" : "NO_EVENT_STORED", expenseLinked: (c.fin?.transactions ?? []).some((t) => t.linkedSessionId === s.id) })) },
    concept: { summary: d?.conceptSummary ?? null, vibe: d?.conceptVibe ?? null, script: d?.script ?? null, directorNotes: d?.directorNotes ?? null, photographerNotes: d?.photographerNotes ?? null, hasReferenceLinksText: links?.references ?? false },
    editing: { editStatus: p.editStatus, fixNotes: d?.fixNotes ?? null, links: links ? { raw: links.rawFiles, editFolder: links.editFolder, version1: links.version1, version2: links.version2, final: links.finalVersion } : null, note: "the only version / final evidence is a pasted link + the edit status; no version records, no review history" },
    publication: { publishDate: p.publishDate, publishedWhere: d?.publishedWhere ?? null },
    files: { folder: d?.dropboxFolderPath ? "RECORDED" : "NONE", documents: docs.map((x) => ({ fileName: x.fileName, type: x.fileType, mime: x.mimeType, uploadedAt: x.createdAt, publicLink: x.hasPublicLink })), referenceImages: refImages.length, referenceLinks: refLinks.map((x) => ({ provider: x.provider, title: x.title })), storageListing: "NOT_AVAILABLE (capability gap) — records only; 'no link' ≠ 'no footage'" },
    tasks: tasks.map((t) => ({ title: t.title, status: t.status, due: t.dueDate, relation: "CANONICAL (production task)" })),
    money: { currency: "NOT_RECORDED (Red Films money has no currency column; the UI assumes ₪)", budget: p.generalBudget, budgetMirrorsClipPrice: !!p.projectId && managedId === p.id, plannedLines, paidRedFilmsLedger: paidLedger, manualActualOnLines: manualActual,
      lines: lines.map((l) => ({ title: l.title, category: l.category, status: l.status, planned: l.planned, manualActual: l.actual, paidFromPayments: linePaid(l.id), vendor: l.vendorName, inFinance: !!l.linkedTransactionId })),
      clientPrice: p.clientPrice, advanceRequired: p.advanceRequired, advanceReceived: p.advanceReceived, collectionStatus: p.collectionStatus,
      layers: "budget / lines = PLANNED; payments = Red Films' own ledger (not Finance); no Finance expense is linked to a line",
      recoup: p.productionType === CLIP_SCOPE && active ? "counts toward the label recoup (the app's rule: an active clip production's budget, artist matched by name, split 50/50)" : "not in the recoup" },
    createdAt: d?.createdAt ?? null, updatedAt: d?.updatedAt ?? null,
  };
}
export type VideoProduction = ReturnType<typeof buildProduction>;

/** The PROJECT side: clip deal, clip rows, shoot sessions, clip expenses — for one project. */
export function buildProjectVideo(src: GatewaySources, projectId: string) {
  const c = ctxOf(src);
  const idx = c.st?.domains.projects.data?.index ?? {};
  const proj = idx[projectId] ?? null;
  const op = proj ? projectOperating(src, projectId) : null;
  const setting = ((c.fin?.financeSettings ?? []).find((s) => s.projectId === projectId)?.value ?? {}) as Record<string, unknown>;
  const price = Number(setting.clipAgreedPrice ?? 0) || 0;
  const txs = clipTx(c, projectId);
  const deal = summarizeClipFinance(txs.map((t) => ({ type: t.type, amount: Number(t.amount) || 0, payment_status: t.status, expense_scope: t.expenseScope })), price);
  const rows = (c.det?.clipItems?.rows ?? []).filter((r) => r.projectId === projectId);
  const txIds = new Set((c.fin?.transactions ?? []).map((t) => t.id));
  const planned: Record<string, number> = {};
  for (const r of rows.filter((x) => x.status !== "בוטל" && !x.linkedTransactionId)) addByCurrency(planned, r.currency ?? "₪", r.amount ?? 0);
  const sessions = (c.det?.sessions?.rows ?? []).filter((s) => s.projectId === projectId && s.type === SHOOT_SESSION_TYPE);
  const productions = (c.ops?.redFilms?.rows ?? []).filter((p) => p.projectId === projectId).map((p) => ({ key: `video-production:${p.id}`, id: p.id, status: p.status, type: p.productionType }));
  const release = (c.st?.domains.releasesFull.data?.items ?? []).find((r) => r.projectId === projectId) ?? null;
  const social = (c.det?.contentItems?.rows ?? []).filter((x) => x.projectId === projectId).map((x) => ({ title: x.title, status: x.status, platform: x.platform, publishDate: x.publishDate, posted: !!x.postedUrl, relation: "same project (not linked to a production)" }));
  return {
    key: `project-video:${projectId}`, project: { key: `project:${projectId}`, name: proj?.name ?? null, status: proj?.status ?? null, businessType: proj?.businessType ?? null, exists: !!proj },
    labelWork: op?.label.labelWork ?? null, clientDeadline: op ? { date: op.clientDeadline.date, class: op.clientDeadline.class, meaning: "the client / project commitment — not a video deadline" } : null,
    clipDeal: { price, ...deal, note: "clip deal = the artist pays for the clip (INCOME, expense scope קליפ) — revenue, never a video expense; excluded from the song balance" },
    planning: { rows: rows.map((r) => { const tx = r.linkedTransactionId ? (c.fin?.transactions ?? []).find((t) => t.id === r.linkedTransactionId) ?? null : null; const txAmt = tx ? validateTx(tx)?.amount ?? null : null;
      return { category: r.category, description: r.description, amount: r.amount, currency: r.currency, status: r.status, transferred: !!r.linkedTransactionId, transactionExists: r.linkedTransactionId ? (c.fin ? txIds.has(r.linkedTransactionId) : null) : null,
        expenseDiffers: tx ? (txAmt !== r.amount || (tx.currency ?? "₪") !== (r.currency ?? "₪") ? { planned: r.amount, plannedCurrency: r.currency, expense: txAmt, expenseCurrency: tx.currency } : null) : null }; }), plannedByCurrency: planned, note: "PLANNED — never money spent; a transferred row is a Finance expense (today the row is deleted on transfer)" },
    expenses: expenseLayer(txs),
    shoots: sessions.map((s) => ({ date: s.date, start: s.startTime, end: s.endTime, status: s.status, photographer: s.photographer, location: s.location, datePassed: !!s.date && s.date < c.today, happened: s.status === "התקיים",
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
    if (p.shoot.sessions.some((s) => s.status === "התקיים") && !p.shoot.statusSaysShot) S("SHOOT_SESSION_HAPPENED_STATUS_STALE", "DERIVED_SIGNAL", `${p.title}: יום צילום בפרויקט סומן 'התקיים' אבל ההפקה עדיין "${p.status}"`);
    if (p.project && ["הושלם", "בוטל"].includes(p.project.status ?? "")) S("PRODUCTION_STATUS_VS_PROJECT", "DERIVED_SIGNAL", `${p.title}: הפרויקט ${p.project.status} וההפקה פעילה (${p.status})`);
    if (p.project?.businessType === "לקוח" && p.clientSource === "פנימי - לייבל") S("CLIENT_SOURCE_MISLABELLED", "DERIVED_SIGNAL", `${p.title}: מסומנת 'פנימי - לייבל' אבל הפרויקט של לקוח`);
    if (p.money.plannedLines > 0 || (p.money.budget ?? 0) > 0) S("PLANNED_NOT_SPENT", "CANONICAL_FACT", `${p.title}: תקציב ${p.money.budget ?? 0}, שורות מתוכננות ${p.money.plannedLines} — תכנון, לא הוצאה (מטבע לא רשום)`);
    if (p.money.paidRedFilmsLedger > 0) S("RF_LEDGER_NOT_IN_FINANCE", "CANONICAL_FACT", `${p.title}: שולמו ${p.money.paidRedFilmsLedger} בפנקס של Red Films — לא עבר לכספים`);
    if (p.money.manualActualOnLines !== p.money.paidRedFilmsLedger && p.money.lines.length) S("LINE_ACTUAL_VS_PAYMENTS", "DERIVED_SIGNAL", `${p.title}: 'בפועל' ידני ${p.money.manualActualOnLines} ≠ תשלומים ${p.money.paidRedFilmsLedger}`);
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
    if (pv.clipDeal.price > 0 && pv.clipDeal.remaining > 0) S("CLIP_DEAL_OPEN", "CANONICAL_FACT", `${name}: עסקת קליפ ₪${pv.clipDeal.price}, התקבל ${pv.clipDeal.paid}, נותר ${pv.clipDeal.remaining}`);
    for (const r of pv.planning.rows.filter((x) => x.expenseDiffers)) S("CLIP_PLAN_VS_EXPENSE", "DERIVED_SIGNAL", `${name}: תכנון ${r.currency ?? ""}${r.amount ?? ""} מול הוצאה בפועל ${r.expenseDiffers!.expenseCurrency ?? ""}${r.expenseDiffers!.expense ?? ""} — ההוצאה בכספים היא הקנונית`);
    if (pv.social.some((x) => x.posted) && activeProds.some((x) => x.status !== "פורסם")) S("PUBLISHED_CONTENT_VS_PRODUCTION", "DERIVED_SIGNAL", `${name}: יש תוכן שפורסם בפרויקט אבל ההפקה עדיין "${activeProds.find((x) => x.status !== "פורסם")!.status}" — שני מקורות, לא מתקן`);
    if (pv.release) S("RELEASE_CONTEXT", "CANONICAL_FACT", `${name}: ריליס בשלב ${pv.release.stage}${pv.release.target ? `, יעד ${pv.release.target}` : ""} — הקשר בלבד, ריליס לא מחייב קליפ`);
  }
  const active = prods.filter((p) => p.active);
  if (active.some((p) => p.shoot.datePassed && !p.shoot.statusSaysShot)) questions.push({ kind: "STATUS", questionHe: `${active.filter((p) => p.shoot.datePassed && !p.shoot.statusSaysShot).map((p) => p.title).join(", ")} — תאריך הצילום עבר והסטטוס 'רעיון'. הקליפ צולם? איפה הוא עומד?`, why: "the status is manual; outside progress is invisible" });
  if (projects.some((pv) => pv.planning.rows.some((r) => r.transferred && r.transactionExists === false))) questions.push({ kind: "FINANCE", questionHe: "שורת תכנון קליפ מסומנת 'הועבר לכספים' אבל ההוצאה לא קיימת בכספים — נמחקה בכוונה?", why: "a transferred plan without its expense" });
  if (active.some((p) => p.money.paidRedFilmsLedger > 0)) questions.push({ kind: "FINANCE", questionHe: "תשלומי Red Films (פנקס נפרד) לא עוברים לכספים — שולמו מכסף החברה? צריכים להופיע גם בכספים?", why: "two money records; never summed by Sunny" });
  const totals = { plannedBudget: round2(active.reduce((s, p) => s + (p.money.budget ?? 0), 0)), plannedLines: round2(active.reduce((s, p) => s + p.money.plannedLines, 0)), paidRedFilmsLedger: round2(active.reduce((s, p) => s + p.money.paidRedFilmsLedger, 0)), currency: "NOT_RECORDED (₪ assumed)" };
  const expenses: Record<string, Record<string, number>> = { total: {}, paid: {}, unpaid: {} };
  for (const pv of projects) for (const k of ["total", "paid", "unpaid"] as const) for (const [cur, amt] of Object.entries(pv.expenses[k])) addByCurrency(expenses[k], cur, amt);
  const clipPlanned: Record<string, number> = {};
  for (const pv of projects) for (const [cur, amt] of Object.entries(pv.planning.plannedByCurrency)) addByCurrency(clipPlanned, cur, amt);
  return {
    counts: { productions: prods.length, active: active.length, cancelled: prods.length - active.length, byStatus: prods.reduce<Record<string, number>>((m, p) => { m[p.status ?? "—"] = (m[p.status ?? "—"] ?? 0) + 1; return m; }, {}),
      withoutProject: prods.filter((p) => !p.project).length, managedBySendClip: prods.filter((p) => p.managedBySendClip).length, videoProjects: projects.length, clipDeals: projects.filter((p) => p.clipDeal.price > 0).length,
      shootSessions: projects.reduce((n, p) => n + p.shoots.length, 0), upcomingShoots: projects.reduce((n, p) => n + p.shoots.filter((s) => !s.datePassed && s.status !== "בוטל").length, 0), note: "recorded counts — no score, no readiness verdict" },
    money: { redFilms: totals, clipPlanningByCurrency: clipPlanned, actualClipExpenses: expenses, clipIncome: projects.reduce((m, p) => ({ price: m.price + p.clipDeal.price, received: m.received + p.clipDeal.paid, expected: m.expected + p.clipDeal.expected }), { price: 0, received: 0, expected: 0 }),
      rule: "planned ≠ spent; Red Films payments are a separate ledger (not Finance); actual = Finance expenses with scope קליפ; paid only when שולם; currencies never added; clip income is revenue" },
    productions: prods, projects, signals, questions,
    unavailable: [...(c.ops ? [] : ["OPERATIONS (productions) — unknown, not none"]), ...(c.det ? [] : ["PROJECT_DETAIL (production detail, budget lines, documents, sessions, clip rows)"]), ...(c.fin ? [] : ["FINANCE (clip deal, expenses)"]), "storage itself is not listed — 'no link' ≠ 'no footage'", "calendar event details are read live by the calendar capability"],
  };
}
export type VideoView = ReturnType<typeof buildVideoView>;
