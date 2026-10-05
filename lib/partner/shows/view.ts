/**
 * Sunny — the CONNECTED SHOW VIEW + SHOW PORTFOLIO. Pure, read-only.
 *
 * One show across the company: artist (client id — canonical; label roster by the artist TEXT — the same text the
 * ledger sync uses), booker, DJ (client id; CLEANTONE = the app's fixed id), money (the app's own pure split and
 * rehearsal-counted rules — reused, never re-implemented), the three linked finance rows + rehearsal rows (Finance
 * Brain row validation), artist ledger rows (by show / by artist-fee row), rehearsals, calendar (stored event id),
 * tasks, sent markers (the app's own fingerprint), portal visibility. Evidence only — no readiness score.
 */
import type { GatewaySources } from "../gateway/core";
import { resolveQuestions } from "../sunny/known-context";
import type { PartnerCompanyState } from "../eyes/types";
import type { OperationsRaw } from "../operations/types";
import type { ProjectDetailRaw } from "../projects/detail-types";
import type { LabelDetailRaw, DetailShow } from "../label/detail-types";
import type { SettingsState } from "../settings/types";
import { activeKnowledge, type OwnerKnowledgeRecord } from "../owner-knowledge/store";
import type { CalendarWindowResult } from "../calendar/types";
import { validateTx } from "../finance/core";
import { buildCalendarLinkIndex, linkCalendarEvent } from "../calendar/links";
import { availability, dayList } from "../calendar/availability";
import { computeShowSplit, feeRowPaidConflicts, rehearsalCountedAmount, showMoneyOf } from "../../shows-types";
import { showAgreementSplit } from "../../label-agreements";
import { pastUnclosedOf } from "./past-unclosed";
import { computeShowNotifyFingerprint, showNotifyStateOf, type ShowNotifyClaimValue } from "../../show-notify-pure";

const ok = <T,>(a: { status: string; value?: T } | undefined): T | null => (a && a.status === "OK" ? (a as { value: T }).value : null);
const ilToday = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const low = (x: string | null | undefined) => (x ?? "").normalize("NFKC").trim().toLowerCase();
const tokens = (x: string | null | undefined) => (x ?? "").split(/[,،;]/).map((t) => t.trim()).filter(Boolean);
const r2 = (n: number) => Math.round(n * 100) / 100;
const PIPELINE = new Set(["ליד חדש", "ממתין לתשובה", "צריך פולואפ"]);
const CONFIRMED = new Set(["נסגר", "אושרה", "בוצע"]);
const UPCOMING = new Set(["אושרה", "נסגר"]);
const PORTAL_VISIBLE = new Set(["אושרה", "נסגר", "בוצע"]);
const SHALEV = "שליו טסמה";

export interface ShowSignal { code: string; kind: "CANONICAL_FACT" | "DERIVED_SIGNAL" | "UNKNOWN"; he: string }
export interface ShowQuestion { questionHe: string; why: string; kind: string; entity?: string }

interface Ctx { st: PartnerCompanyState | null; ops: OperationsRaw | null; det: ProjectDetailRaw | null; ld: LabelDetailRaw | null; settings: SettingsState | null; kn: OwnerKnowledgeRecord[]; cal: CalendarWindowResult | null; today: string; cleantone: string | null }
function ctxOf(src: GatewaySources): Ctx {
  const st = ok(src.state) as PartnerCompanyState | null;
  return { st, ops: ok(src.operations) as OperationsRaw | null, det: ok(src.projectDetail) as ProjectDetailRaw | null, ld: ok(src.labelDetail) as LabelDetailRaw | null, settings: ok(src.settings) as SettingsState | null,
    kn: activeKnowledge((ok(src.ownerKnowledge) as OwnerKnowledgeRecord[] | null) ?? [], st?.todayIL ?? ilToday(src.now)), cal: ok(src.calendar) as CalendarWindowResult | null, today: st?.todayIL ?? ilToday(src.now), cleantone: src.identities?.cleantone?.clientId ?? null };
}
const marker = (c: Ctx, family: string, showId: string, currentFp: string) => {
  const rows = c.settings?.families[family]?.rows;
  if (!rows) return { state: "UNKNOWN" as const };
  const row = rows.find((r) => r.key.endsWith(`:${showId}`));
  if (!row) return { state: "NOT_SENT" as const };
  // THE app's own read rule (showNotifyStateOf — the same answer as the send button / the notify writers): SENT only for
  // the show's CURRENT version; a row sent for an older version is SENT_PREVIOUS_VERSION (outdated), never a silent SENT.
  const v = (row.value ?? {}) as ShowNotifyClaimValue;
  const r = showNotifyStateOf(v, currentFp);
  return { state: r.state, sentAt: r.sentAt, outdated: r.state === "SENT_PREVIOUS_VERSION", note: "outdated = name / date / time / place changed since it was sent (the writer would send again)" };
};

export function buildShowView(src: GatewaySources, showId: string) {
  const c = ctxOf(src);
  const s = c.ld?.shows?.rows.find((x) => x.id === showId) ?? null;
  if (!s) return null;
  const fin = ok(src.finance);
  const key = `show:${s.id}`;
  const unavailable: string[] = [];
  if (!fin) unavailable.push("FINANCE was not read — finance rows unknown");
  if (!c.det) unavailable.push("PROJECT_DETAIL (rehearsals, tasks) was not read — unknown, not none");
  if (!c.settings) unavailable.push("SETTINGS (artist / DJ sent markers) was not read — notification state UNKNOWN");
  const clients = c.st?.domains.clients.data?.items ?? [];
  const clientName = (id: string | null) => (id ? clients.find((x) => x.id === id)?.name ?? null : null);
  const roster = c.ld?.artists?.rows ?? c.st?.domains.labelArtists.data?.items.map((a) => ({ id: a.id, name: a.name })) ?? [];

  // ── identities ──
  const artistTokens = tokens(s.artistText);
  const rosterMatch = artistTokens.length === 1 ? roster.find((a) => low(a.name) === low(artistTokens[0])) ?? null : null;
  const artist = {
    text: s.artistText, collaboration: artistTokens.length > 1,
    client: s.artistClientId ? { key: `client:${s.artistClientId}`, name: clientName(s.artistClientId), link: "CANONICAL (stored client id)" } : null,
    labelArtist: rosterMatch ? { key: `label-artist:${rosterMatch.id}`, name: rosterMatch.name, link: "TEXT_MATCH (the show's artist text = a roster name — the same rule the ledger sync uses)" } : null,
    note: artistTokens.length > 1 ? "collaboration — no ledger sync for any artist" : !rosterMatch ? "artist text is not a roster name — no ledger sync" : "label-artist membership is never inferred from a show; the roster decides",
  };
  const booker = s.bookerClientId ? { key: `client:${s.bookerClientId}`, name: clientName(s.bookerClientId), link: "CANONICAL" } : s.bookerName ? { key: null, name: s.bookerName, link: "TEXT only" } : null;
  const isCleantone = !!s.djClientId && s.djClientId === c.cleantone;
  const dj = s.djClientId ? { key: `client:${s.djClientId}`, clientName: clientName(s.djClientId), displayName: s.djName, isLabelDj: isCleantone, confirmation: isCleantone ? (s.djConfirmationStatus ?? "NONE (before the confirmation system or show done / cancelled when assigned)") : "NOT_APPLICABLE (only CLEANTONE has confirmation)", confirmedAt: s.djConfirmedAt,
    nameMismatch: !!s.djName && !!clientName(s.djClientId) && low(s.djName) !== low(clientName(s.djClientId)) && !isCleantone ? "the DJ display name differs from the DJ client record" : null } : null;

  // ── rehearsals + money (the app's own pure rules) ──
  const txById = new Map((fin?.raw.transactions ?? []).map((t) => [t.id, t]));
  const rehearsalRows = (c.det?.sessions?.rows ?? []).filter((x) => x.showId === s.id);
  const rehearsals = rehearsalRows.map((x) => {
    const tx = (fin?.raw.transactions ?? []).find((t) => t.linkedSessionId === x.id) ?? null;
    const pay = tx?.status ?? null;
    return { date: x.date, start: x.startTime, status: x.status, type: x.type, cost: x.cost, paymentStatus: pay, counted: rehearsalCountedAmount(x.status, pay, x.cost), hasCalendarEvent: x.hasCalendarEvent, financeRow: !!tx,
      note: x.status === "התקיים" ? "legacy auto-marked 'התקיים' (before D6; the page-load auto-mark is retired since 2026-09-27 — nothing writes it any more) — counts only if paid; the Owner should confirm בוצע / בוטל" : x.status === "מתוכנן" && x.cost ? "planned — does not count toward the split until marked בוצע (D6)" : null };
  }).sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  const counted = r2(rehearsals.reduce((t, x) => t + x.counted, 0));
  const split = computeShowSplit({ show_price: s.price ?? 0, dj_fee: s.djFee ?? 0 }, counted);
  // Owner decision 2026-09-27 (lib/label-agreements — the ONE rule): the 50 / 50 of the NET applies ONLY to שליו / אבי
  const agreement = showAgreementSplit({ artist: s.artistText, show_price: s.price ?? 0, dj_fee: s.djFee ?? 0 }, counted);
  const rowOf = (id: string | null, role: string) => {
    if (!id) return { role, exists: false };
    const t = txById.get(id);
    if (!t) return { role, exists: false, note: "linked id stored but the row was not found" };
    const v = validateTx(t);
    return { role, exists: true, status: t.status, amount: v?.amount ?? null, currency: v?.currency ?? t.currency, date: t.date, received: v?.received ?? null, cancelled: v?.cancelled ?? null };
  };
  const currency = s.currency || "₪";
  const linked = (fin?.raw.transactions ?? []).filter((t) => t.showId === s.id && t.type === "income");
  const sm = showMoneyOf({ show_price: s.price ?? 0, currency }, linked.map((t) => ({ id: t.id, role: t.showMoneyRole ?? null, status: t.status, amount: Number(t.amount) || 0, currency: t.currency, date: t.date })));
  const finance = { income: rowOf(s.incomeTxId, "INCOME (client) — legacy link"), djFee: rowOf(s.djExpenseTxId, "DJ_FEE"), artistFee: rowOf(s.artistExpenseTxId, "ARTIST_FEE"),
    payments: sm.payments.map((p) => ({ amount: p.amount, currency: p.currency, date: p.date ?? null, status: p.status })),
    expectedBalance: sm.expected ? { amount: sm.expected.amount, status: sm.expected.status } : null,
    rehearsalRows: rehearsals.filter((x) => x.financeRow).length, note: "D5: rows are linked by transactions.show_id; actual money = SHOW_PAYMENT rows (שולם / התקבל)" };
  // Owner decision 2026-09-27: the deal type is NOT a payment status. An unpaid collaboration is a normal show whose
  // money layer does not apply: no price, no receivable, no payment status, no split, no automatic rows (a real
  // exceptional expense is recorded explicitly in Finance). It still counts as a show everywhere.
  const unpaidCollab = s.dealType === "UNPAID_COLLAB";
  const money = unpaidCollab ? {
    dealType: "UNPAID_COLLAB" as const, dealTypeHe: "שת״פ ללא תשלום", moneyApplies: false,
    currency, agreed: null, received: sm.received, remaining: null, credit: null,
    price: null, receivedMirror: null, clientPayment: null, clientPaymentRule: "not relevant — an unpaid collaboration has no payment status (the stored column is ignored, never 'שת״פ')",
    djFee: null, rehearsalsCounted: counted,
    split: { agreement: "NOT_APPLICABLE" as const, reasonHe: "שת״פ ללא תשלום — אין הכנסה ואין חלוקה", gross: 0, djFee: 0, rehearsalCosts: counted, net: 0, artistFee: null, labelProfit: null,
      rule: "an unpaid collaboration creates no expected income, receivable, DJ / artist / rehearsal row, artist ledger entry or 50 / 50 split" },
    storedArtistFeeColumn: s.artistFee, storedArtistFeeNote: "legacy column, never used by the app",
    finance,
  } : {
    dealType: "PAID" as const, dealTypeHe: "בתשלום", moneyApplies: true,
    currency, agreed: sm.agreed, received: sm.received, remaining: sm.remaining, credit: sm.credit,
    ...(sm.otherCurrencyPayments.length ? { otherCurrencyPayments: sm.otherCurrencyPayments.map((p) => `${p.currency ?? "?"}${p.amount}`), otherCurrencyNote: "never added to this show's money (no FX) — for the Owner" } : {}),
    price: s.price, receivedMirror: s.advancePayment, clientPayment: s.paymentStatus, clientPaymentRule: "derived from Finance: שולם when received ≥ agreed, מקדמה when partly received",
    djFee: s.djFee, rehearsalsCounted: counted,
    split: agreement.status === "DEFINED"
      ? { agreement: "DEFINED", artist: agreement.artist.name, gross: split.grossAmount, djFee: split.djFee, rehearsalCosts: split.rehearsalCosts, directExpenses: agreement.directExpenses, net: split.netAfterDj, artistFee: split.artistFee, labelProfit: split.labelProfit,
          rule: "Owner agreement (שליו טסמה / אבי מולה): revenue − direct show expenses = net; artist 50 % / label 50 % of the NET, never of the gross. Recorded direct expenses = the DJ fee + counted rehearsals (בוצע); any other direct show cost is not recorded on the show" }
      : { agreement: "NOT_DEFINED", reasonHe: agreement.reasonHe, gross: split.grossAmount, djFee: split.djFee, rehearsalCosts: split.rehearsalCosts, net: split.netAfterDj, artistFee: null, labelProfit: null,
          rule: "no artist agreement covers this show (only שליו / אבי have one) — no artist / label split is computed; the app creates no artist fee row" },
    storedArtistFeeColumn: s.artistFee, storedArtistFeeNote: "legacy column, never used by the app",
    finance,
  };

  // ── ledger ──
  const ledger = (c.ld?.ledger?.rows ?? []).filter((e) => e.sourceShowId === s.id || (!!s.artistExpenseTxId && e.sourceTxId === s.artistExpenseTxId))
    .map((e) => ({ artist: `label-artist:${e.artistId}`, type: e.entryType, amount: e.amount, date: e.entryDate, via: e.sourceShowId === s.id ? "close-show (show link)" : "booking sync (artist-fee row)" }));

  // ── PAST_SHOW_NOT_CLOSED (Owner decision 2026-10-03): ONE derived rule (lib/partner/shows/past-unclosed) — the past, still
  //    unclosed show together with its open client money / DJ fee, so every reader sees ONE event, not three facts ──
  const djRowFact = finance.djFee as { exists: boolean; status?: string | null; amount?: number | null };
  const entRow = ledger.find((l) => l.type === "הכנסות") ?? ledger.find((l) => l.type === "הכנסות צפויות") ?? null;
  const pastUnclosed = pastUnclosedOf({
    name: s.name, date: s.date, status: s.status, dealType: s.dealType, currency, today: c.today, price: s.price,
    paymentStatus: s.paymentStatus, advancePayment: s.advancePayment, financeRead: !!fin, clientRemaining: sm.remaining,
    hasDj: !!s.djClientId || !!s.djName, djRow: fin ? { exists: djRowFact.exists, status: djRowFact.status ?? null, amount: djRowFact.amount ?? null } : null, djFee: s.djFee,
    entitlement: entRow ? { type: String(entRow.type), amount: Number(entRow.amount) || 0 } : null,
  });

  // ── calendar ──
  const calUsable = !!c.cal && (c.cal.status === "CALENDAR_DATA_AVAILABLE" || c.cal.status === "CALENDAR_PARTIAL");
  const inWindow = calUsable && !!s.date && s.date >= c.cal!.window.start.slice(0, 10) && s.date <= c.cal!.window.end.slice(0, 10);
  const calendar = !s.date ? { state: "NO_DATE" } : !calUsable ? { state: "UNKNOWN", status: c.cal?.status ?? "NOT_LOADED", note: "calendar unreadable — never 'no event'" } : !inWindow ? { state: "OUTSIDE_LOADED_WINDOW", hasStoredEvent: s.hasCalendarEvent } : (() => {
    const idx = buildCalendarLinkIndex(c.ops, c.st);
    const sameDay = c.cal!.events.filter((e) => (e.allDay ? e.start <= s.date! && s.date! < e.end : e.start.slice(0, 10) === s.date)).map((e) => linkCalendarEvent(e, idx));
    const own = sameDay.filter((l) => l.edges.some((e) => e.to === key));
    const av = availability(c.cal!.events, dayList(s.date!, s.date!), c.cal!.status)[0];
    return { state: "READ", hasStoredEvent: s.hasCalendarEvent, showEventFound: own.length > 0, sameDay: sameDay.map((l) => ({ title: l.event.title, start: l.event.start, allDay: l.event.allDay, quality: l.quality, isThisShow: own.includes(l) })), ownerOccupiedMinutes: av?.occupiedMinutes ?? null, note: "other events that day are Owner availability context — never show facts" };
  })();

  // ── tasks / markers / portal ──
  const tasks = (c.det?.tasks?.rows ?? []).filter((t) => t.showId === s.id).map((t) => ({ title: t.title, status: t.status, due: t.dueDate, kind: (t.notes ?? "").includes("[quote_followup]") ? "QUOTE_FOLLOW_UP" : /דיג/.test(t.title ?? "") ? "CLOSE_A_DJ" : "OTHER" }));
  const fp = computeShowNotifyFingerprint({ name: s.name ?? "", date: s.date, startTime: s.startTime, location: s.location });
  const eligibleForPush = UPCOMING.has(s.status ?? "") && !!s.date && s.date >= c.today;
  const notifications = {
    artist: artistTokens.some((t) => low(t) === low(SHALEV)) ? { ...marker(c, "SHOW_SENT_TO_ARTIST", s.id, fp), eligibleNow: eligibleForPush } : { state: "NOT_APPLICABLE (the artist push exists only for Shalev)" },
    dj: isCleantone ? { ...marker(c, "SHOW_SENT_TO_DJ", s.id, fp), eligibleNow: eligibleForPush } : { state: "NOT_APPLICABLE (the DJ push exists only for CLEANTONE)" },
    sunnySends: false,
  };
  const portal = { artistSees: PORTAL_VISIBLE.has(s.status ?? "") ? "yes (no money)" : "no", djSees: isCleantone && s.status !== "בוטל" ? "yes (DJ fee + the CLIENT's payment status; can confirm)" : "no" };

  // ── signals / missing / questions (evidence only) ──
  const signals: ShowSignal[] = [];
  const questions: ShowQuestion[] = [];
  const upcoming = UPCOMING.has(s.status ?? "") && !!s.date && s.date >= c.today;
  if (upcoming) signals.push({ code: "UPCOMING", kind: "CANONICAL_FACT", he: `הופעה ב-${s.date}${s.startTime ? ` ${s.startTime}` : ""}` });
  if (PIPELINE.has(s.status ?? "")) signals.push({ code: "PIPELINE", kind: "CANONICAL_FACT", he: `בשלב ${s.status}` });
  if (artist.collaboration) signals.push({ code: "COLLABORATION", kind: "CANONICAL_FACT", he: "כמה אמנים — אין סנכרון מאזן" });
  // an unpaid collaboration does not need a DJ by default: no NO_DJ / "who is the DJ?" just because none is recorded
  // (an explicitly assigned DJ keeps every DJ signal — confirmation, notification)
  if (!unpaidCollab && !s.djClientId && s.djName && s.status !== "בוטל") signals.push({ code: "DJ_NAME_ONLY", kind: "CANONICAL_FACT", he: `DJ רשום בשם בלבד (${s.djName}) — לא מקושר לרשומת לקוח` });
  if (!unpaidCollab && !s.djClientId && !s.djName && s.status !== "בוטל") { signals.push({ code: "NO_DJ", kind: "CANONICAL_FACT", he: "אין DJ רשום — CLEANTONE מנגן ברוב ההופעות, לא בכולן." }); if (!PIPELINE.has(s.status ?? "")) questions.push({ kind: "DJ", questionHe: "מי ה-DJ בהופעה?", why: "no DJ recorded; never auto-assigned" }); }
  if (!unpaidCollab && !s.djClientId && !s.djName && (s.djFee ?? 0) > 0 && s.status !== "בוטל") signals.push({ code: "DJ_FEE_WITHOUT_DJ", kind: "CANONICAL_FACT", he: `שכר DJ ${s.djFee} בלי DJ${finance.djFee.exists ? " (ונוצרה שורת הוצאה)" : ""}` });
  if (isCleantone && s.djConfirmationStatus === "ממתין לאישור" && s.status !== "בוטל") { signals.push({ code: "DJ_AWAITING_CONFIRMATION", kind: "CANONICAL_FACT", he: "CLEANTONE עוד לא אישר" }); if (upcoming) questions.push({ kind: "DJ_CONFIRM", questionHe: "CLEANTONE עוד לא אישר — לשלוח לו / לבדוק איתו?", why: "confirmation pending (Sunny never sends)" }); }
  if (isCleantone && s.djConfirmationStatus === "אושר") signals.push({ code: "DJ_CONFIRMED", kind: "CANONICAL_FACT", he: `CLEANTONE אישר${s.djConfirmedAt ? ` (${s.djConfirmedAt.slice(0, 10)})` : ""}` });
  if (isCleantone && s.djConfirmationStatus === "אושר" && s.djConfirmedAt && s.updatedAt && s.updatedAt > s.djConfirmedAt) signals.push({ code: "DJ_CONFIRMED_BEFORE_CHANGE", kind: "DERIVED_SIGNAL", he: "ההופעה שונתה אחרי אישור ה-DJ (שינוי תאריך לא מאפס אישור)" });
  const na = notifications.artist as { state: string; outdated?: boolean; eligibleNow?: boolean };
  if (na.state === "NOT_SENT" && na.eligibleNow) signals.push({ code: "ARTIST_NOT_NOTIFIED", kind: "CANONICAL_FACT", he: "האמן עוד לא קיבל הודעה על ההופעה" });
  if (na.state === "SENT_PREVIOUS_VERSION" && upcoming) signals.push({ code: "ARTIST_NOTIFIED_OUTDATED", kind: "DERIVED_SIGNAL", he: "האמן קיבל הודעה, אבל פרטי ההופעה השתנו מאז" });
  const nd = notifications.dj as { state: string; eligibleNow?: boolean };
  if (nd.state === "NOT_SENT" && nd.eligibleNow) signals.push({ code: "DJ_NOT_NOTIFIED", kind: "CANONICAL_FACT", he: "ה-DJ עוד לא קיבל הודעה על ההופעה" });
  if (rehearsals.length) signals.push({ code: "REHEARSALS_RECORDED", kind: "CANONICAL_FACT", he: `${rehearsals.length} חזרות רשומות` });
  if (CONFIRMED.has(s.status ?? "") && !s.hasCalendarEvent) signals.push({ code: "NO_CALENDAR_EVENT", kind: "CANONICAL_FACT", he: "אין אירוע ביומן להופעה" });
  // money signals never apply to an unpaid collaboration (no new signal either — being a collaboration is not a problem)
  if (!unpaidCollab && CONFIRMED.has(s.status ?? "") && !(s.price ?? 0)) { signals.push({ code: "PRICE_MISSING", kind: "CANONICAL_FACT", he: "אין מחיר להופעה (0) — אין שורת הכנסה" }); questions.push({ kind: "PRICE", questionHe: "מה המחיר של ההופעה?", why: "confirmed / done with price 0" }); }
  if (!unpaidCollab && upcoming && s.paymentStatus !== "שולם") signals.push({ code: "UPCOMING_UNPAID", kind: "CANONICAL_FACT", he: `תשלום לקוח: ${s.paymentStatus}${s.advancePayment ? ` (מקדמה ${s.advancePayment})` : ""}` });
  if (!unpaidCollab && s.status === "בוצע" && s.paymentStatus !== "שולם" && (s.price ?? 0) > 0) signals.push({ code: "DONE_UNPAID", kind: "CANONICAL_FACT", he: `ההופעה בוצעה, תשלום לקוח: ${s.paymentStatus}` });
  if (UPCOMING.has(s.status ?? "") && !!s.date && s.date < c.today) { signals.push({ code: "DATE_PASSED_NOT_CLOSED", kind: "DERIVED_SIGNAL", he: pastUnclosed ? pastUnclosed.shortHe : "התאריך עבר וההופעה לא נסגרה" });
    // money raises the urgency of the SAME event (never a separate fact): open client money and / or an open DJ fee
    if (pastUnclosed?.moneyOpen) signals.push({ code: "PAST_SHOW_OPEN_MONEY", kind: "DERIVED_SIGNAL", he: pastUnclosed.moneyLineHe });
    questions.push({ kind: "CLOSE", questionHe: unpaidCollab ? "ההופעה התקיימה? (עברה ועדיין לא נסגרה במערכת) — עבר הזמן ≠ בוצע; שת״פ ללא תשלום: אם התקיימה — לסמן בוצע (אין כסף לתעד); אם לא — לעדכן סטטוס מתאים" : "ההופעה התקיימה? (עברה ועדיין לא נסגרה במערכת) — עבר הזמן ≠ בוצע; אם התקיימה: לסגור כבוצע ולתעד תשלום לקוח ו-DJ; אם לא: לעדכן סטטוס מתאים", why: "date passed, status still confirmed — the time passing does not prove the show took place" }); }
  if (!unpaidCollab && s.status === "בוצע" && rosterMatch && !artist.collaboration && agreement.status === "DEFINED" && split.artistFee > 0 && !ledger.some((l) => l.type === "הכנסות")) signals.push({ code: "DONE_WITHOUT_LEDGER", kind: "DERIVED_SIGNAL", he: "בוצעה אבל אין הכנסה במאזן האמן (נסגרה בלי דיאלוג הסגירה?)" });
  if (s.status === "בוטל" && ledger.some((l) => l.type === "הכנסות" || l.type === "תשלומים")) signals.push({ code: "LEDGER_KEPT_AFTER_CANCEL", kind: "DERIVED_SIGNAL", he: "הופעה מבוטלת שעדיין יש לה הכנסה / תשלום במאזן האמן" });
  if (!unpaidCollab && s.status === "בוצע" && finance.artistFee.exists && (finance.artistFee as { status?: string | null }).status === "צפוי") signals.push({ code: "ARTIST_ROW_UNPAID_AFTER_DONE", kind: "CANONICAL_FACT", he: "שורת שכר האמן עדיין צפוי — לא נרשם תשלום לאמן בכספים" });
  const openTasks = tasks.filter((t) => t.status === "פתוח");
  // A1: a PAID fee row is never re-priced by the sync — when it no longer matches the show (amount / currency / cancelled),
  // the app's own rule (feeRowPaidConflicts) reports it; Sunny surfaces it as a conflict, never resolves it
  if (!unpaidCollab && agreement.status === "NOT_DEFINED") signals.push({ code: "SHOW_SPLIT_NOT_DEFINED", kind: "UNKNOWN", he: `חלוקת אמן / לייבל לא מוגדרת להופעה הזאת: ${agreement.reasonHe}` });
  for (const [label, row, amount] of [["DJ", finance.djFee, split.djFee], ["אמן", finance.artistFee, split.artistFee]] as const) {
    if (!row.exists || unpaidCollab) continue;
    if (label === "אמן" && agreement.status === "NOT_DEFINED") continue; // no agreement → the sync leaves the row untouched (reported above)
    const r = row as { status?: string | null; amount?: number | null; currency?: string | null };
    const why = feeRowPaidConflicts({ status: r.status, amount: Number(r.amount) || 0, currency: r.currency }, { amount, currency, cancelled: s.status === "בוטל" });
    if (why.length) signals.push({ code: "PAID_FEE_ROW_MISMATCH", kind: "DERIVED_SIGNAL", he: `שורת שכר ${label} שולמה ולא תואמת את ההופעה: ${why.join(" · ")} — לא נדרסת; החלטה שלך` });
  }
  if (openTasks.length) signals.push({ code: "OPEN_SHOW_TASKS", kind: "CANONICAL_FACT", he: `${openTasks.length} משימות פתוחות: ${openTasks.map((t) => t.title).join(" · ")}` });
  if (upcoming && !s.location) questions.push({ kind: "PLACE", questionHe: "איפה ההופעה?", why: "no place recorded" });
  if (upcoming && !s.startTime) questions.push({ kind: "TIME", questionHe: "באיזו שעה ההופעה?", why: "no time recorded (calendar assumes 20:00)" });

  const history = [
    { at: s.createdAt, event: "show created", kind: "RECORDED" }, { at: s.updatedAt, event: "last change (what changed is not recorded)", kind: "RECORDED" },
    ...(s.djConfirmedAt ? [{ at: s.djConfirmedAt, event: "DJ confirmed", kind: "RECORDED" }] : []),
    ...rehearsals.map((x) => ({ at: x.date, event: `rehearsal (${x.status})`, kind: "RECORDED" })),
    ...ledger.map((l) => ({ at: l.date, event: `ledger ${l.type} ${l.amount} (${l.via})`, kind: "RECORDED" })),
    ...[notifications.artist, notifications.dj].flatMap((n, i) => ((n as { sentAt?: string | null }).sentAt ? [{ at: (n as unknown as { sentAt: string }).sentAt, event: i === 0 ? "sent to the artist" : "sent to the DJ", kind: "RECORDED" }] : [])),
  ].filter((h) => h.at).sort((a, b) => String(a.at).localeCompare(String(b.at)));

  return { key, found: true as const, identity: { name: s.name, date: s.date, time: s.startTime, location: s.location, status: s.status, dealType: money.dealType, contact: s.contactPerson, hasPhone: s.hasPhone, notes: s.notes },
    artist, booker, dj, money, ledger, rehearsals, calendar, tasks, notifications, portal, performanceFiles: "per-artist audio files in the artist's storage folder — Sunny cannot list them (CAPABILITY_GAP), never 'no files'",
    pastUnclosed, signals, ...showQuestionsOf(questions, `show:${s.id}`, c), history, unavailable };
}
export type ShowView = NonNullable<ReturnType<typeof buildShowView>>;

export function showPortfolio(src: GatewaySources) {
  const c = ctxOf(src);
  return (c.ld?.shows?.rows ?? []).map((s: DetailShow) => buildShowView(src, s.id)!).filter(Boolean).map((v) => ({
    key: v.key, name: v.identity.name, date: v.identity.date, status: v.identity.status, dealType: v.money.dealType, artist: v.artist.text, dj: v.dj?.displayName ?? null, djConfirmation: v.dj?.confirmation ?? null,
    price: v.money.price, clientPayment: v.money.clientPayment, artistFee: v.money.split.artistFee, labelProfit: v.money.split.labelProfit, rehearsals: v.rehearsals.length,
    artistNotified: (v.notifications.artist as { state: string }).state, djNotified: (v.notifications.dj as { state: string }).state, ledgerRows: v.ledger.length, signals: [...new Set(v.signals.map((x) => x.code))], openQuestions: v.questions.length,
    pastUnclosed: v.pastUnclosed ? { ageDays: v.pastUnclosed.ageDays, urgency: v.pastUnclosed.urgency, clientOpen: v.pastUnclosed.client.open ? v.pastUnclosed.client.amount : null, djOpen: v.pastUnclosed.dj.open ? v.pastUnclosed.dj.amount : null, entitlementStillExpected: v.pastUnclosed.entitlementExpected?.amount ?? null, summaryHe: v.pastUnclosed.sunnyHe } : null,
  })).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}

/** Question memory (2026-10-05): every show question belongs to THIS show; the Owner's exact-show answer is used (one resolver). */
function showQuestionsOf(questions: ShowQuestion[], key: string, c: { kn: import("../owner-knowledge/store").OwnerKnowledgeRecord[]; today: string }) {
  const r = resolveQuestions(questions.map((q) => ({ ...q, entity: q.entity ?? key })), c.kn, c.today);
  return { questions: r.asked, known: r.known };
}
