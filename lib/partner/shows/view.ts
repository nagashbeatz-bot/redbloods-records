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
import type { PartnerCompanyState } from "../eyes/types";
import type { OperationsRaw } from "../operations/types";
import type { ProjectDetailRaw } from "../projects/detail-types";
import type { LabelDetailRaw, DetailShow } from "../label/detail-types";
import type { SettingsState } from "../settings/types";
import type { OwnerKnowledgeRecord } from "../owner-knowledge/store";
import type { CalendarWindowResult } from "../calendar/types";
import { validateTx } from "../finance/core";
import { buildCalendarLinkIndex, linkCalendarEvent } from "../calendar/links";
import { availability, dayList } from "../calendar/availability";
import { computeShowSplit, rehearsalCountedAmount } from "../../shows-types";
import { computeShowNotifyFingerprint } from "../../show-notify-pure";

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
export interface ShowQuestion { questionHe: string; why: string; kind: string }

interface Ctx { st: PartnerCompanyState | null; ops: OperationsRaw | null; det: ProjectDetailRaw | null; ld: LabelDetailRaw | null; settings: SettingsState | null; kn: OwnerKnowledgeRecord[]; cal: CalendarWindowResult | null; today: string; cleantone: string | null }
function ctxOf(src: GatewaySources): Ctx {
  const st = ok(src.state) as PartnerCompanyState | null;
  return { st, ops: ok(src.operations) as OperationsRaw | null, det: ok(src.projectDetail) as ProjectDetailRaw | null, ld: ok(src.labelDetail) as LabelDetailRaw | null, settings: ok(src.settings) as SettingsState | null,
    kn: (ok(src.ownerKnowledge) as OwnerKnowledgeRecord[] | null) ?? [], cal: ok(src.calendar) as CalendarWindowResult | null, today: st?.todayIL ?? ilToday(src.now), cleantone: src.identities?.cleantone?.clientId ?? null };
}
const marker = (c: Ctx, family: string, showId: string, currentFp: string) => {
  const rows = c.settings?.families[family]?.rows;
  if (!rows) return { state: "UNKNOWN" as const };
  const row = rows.find((r) => r.key.endsWith(`:${showId}`));
  if (!row) return { state: "NOT_SENT" as const };
  const v = (row.value ?? {}) as { status?: string; fingerprint?: string; sentAt?: string; claimedAt?: string };
  const status = v.status === "sent" ? "SENT" : v.status === "failed" ? "FAILED" : v.status === "processing" ? "PROCESSING" : "SENT";
  return { state: status as "SENT" | "FAILED" | "PROCESSING", sentAt: v.sentAt ?? null, outdated: !!v.fingerprint && v.fingerprint !== currentFp, note: "outdated = name / date / time / place changed since it was sent" };
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
      note: x.status === "התקיים" ? "auto-marked 'התקיים' — the app's rule never counts it" : null };
  }).sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  const counted = r2(rehearsals.reduce((t, x) => t + x.counted, 0));
  const split = computeShowSplit({ show_price: s.price ?? 0, dj_fee: s.djFee ?? 0 }, counted);
  const rowOf = (id: string | null, role: string) => {
    if (!id) return { role, exists: false };
    const t = txById.get(id);
    if (!t) return { role, exists: false, note: "linked id stored but the row was not found" };
    const v = validateTx(t);
    return { role, exists: true, status: t.status, amount: v?.amount ?? null, currency: v?.currency ?? t.currency, date: t.date, received: v?.received ?? null, cancelled: v?.cancelled ?? null };
  };
  const finance = { income: rowOf(s.incomeTxId, "INCOME (client)"), djFee: rowOf(s.djExpenseTxId, "DJ_FEE"), artistFee: rowOf(s.artistExpenseTxId, "ARTIST_FEE"),
    rehearsalRows: rehearsals.filter((x) => x.financeRow).length, note: "rows are created only for confirmed shows; written as ₪ by the app" };
  const money = {
    currency: "NOT_STORED on the show (the app writes its finance rows as ₪)",
    price: s.price, advance: s.advancePayment, remainingPerUi: s.price !== null && s.advancePayment !== null ? r2((s.price ?? 0) - (s.advancePayment ?? 0)) : null, clientPayment: s.paymentStatus,
    djFee: s.djFee, rehearsalsCounted: counted, split: { gross: split.grossAmount, djFee: split.djFee, rehearsalCosts: split.rehearsalCosts, net: split.netAfterDj, artistFee: split.artistFee, labelProfit: split.labelProfit, rule: "net = max(0, price − DJ fee − counted rehearsals); artist = net / 2; label = the rest (the app's own function)" },
    storedArtistFeeColumn: s.artistFee, storedArtistFeeNote: "legacy column, never used by the app",
    finance,
  };

  // ── ledger ──
  const ledger = (c.ld?.ledger?.rows ?? []).filter((e) => e.sourceShowId === s.id || (!!s.artistExpenseTxId && e.sourceTxId === s.artistExpenseTxId))
    .map((e) => ({ artist: `label-artist:${e.artistId}`, type: e.entryType, amount: e.amount, date: e.entryDate, via: e.sourceShowId === s.id ? "close-show (show link)" : "booking sync (artist-fee row)" }));

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
  if (!s.djClientId && s.status !== "בוטל") { signals.push({ code: "NO_DJ", kind: "CANONICAL_FACT", he: "אין DJ רשום — CLEANTONE מנגן ברוב ההופעות, לא בכולן." }); if (!PIPELINE.has(s.status ?? "")) questions.push({ kind: "DJ", questionHe: "מי ה-DJ בהופעה?", why: "no DJ recorded; never auto-assigned" }); }
  if (!s.djClientId && (s.djFee ?? 0) > 0 && s.status !== "בוטל") signals.push({ code: "DJ_FEE_WITHOUT_DJ", kind: "CANONICAL_FACT", he: `שכר DJ ${s.djFee} בלי DJ${finance.djFee.exists ? " (ונוצרה שורת הוצאה)" : ""}` });
  if (isCleantone && s.djConfirmationStatus === "ממתין לאישור") { signals.push({ code: "DJ_AWAITING_CONFIRMATION", kind: "CANONICAL_FACT", he: "CLEANTONE עוד לא אישר" }); if (upcoming) questions.push({ kind: "DJ_CONFIRM", questionHe: "CLEANTONE עוד לא אישר — לשלוח לו / לבדוק איתו?", why: "confirmation pending (Sunny never sends)" }); }
  if (isCleantone && s.djConfirmationStatus === "אושר") signals.push({ code: "DJ_CONFIRMED", kind: "CANONICAL_FACT", he: `CLEANTONE אישר${s.djConfirmedAt ? ` (${s.djConfirmedAt.slice(0, 10)})` : ""}` });
  if (isCleantone && s.djConfirmationStatus === "אושר" && s.djConfirmedAt && s.updatedAt && s.updatedAt > s.djConfirmedAt) signals.push({ code: "DJ_CONFIRMED_BEFORE_CHANGE", kind: "DERIVED_SIGNAL", he: "ההופעה שונתה אחרי אישור ה-DJ (שינוי תאריך לא מאפס אישור)" });
  const na = notifications.artist as { state: string; outdated?: boolean; eligibleNow?: boolean };
  if (na.state === "NOT_SENT" && na.eligibleNow) signals.push({ code: "ARTIST_NOT_NOTIFIED", kind: "CANONICAL_FACT", he: "האמן עוד לא קיבל הודעה על ההופעה" });
  if (na.state === "SENT" && na.outdated && upcoming) signals.push({ code: "ARTIST_NOTIFIED_OUTDATED", kind: "DERIVED_SIGNAL", he: "האמן קיבל הודעה, אבל פרטי ההופעה השתנו מאז" });
  const nd = notifications.dj as { state: string; eligibleNow?: boolean };
  if (nd.state === "NOT_SENT" && nd.eligibleNow) signals.push({ code: "DJ_NOT_NOTIFIED", kind: "CANONICAL_FACT", he: "ה-DJ עוד לא קיבל הודעה על ההופעה" });
  if (rehearsals.length) signals.push({ code: "REHEARSALS_RECORDED", kind: "CANONICAL_FACT", he: `${rehearsals.length} חזרות רשומות` });
  if (CONFIRMED.has(s.status ?? "") && !s.hasCalendarEvent) signals.push({ code: "NO_CALENDAR_EVENT", kind: "CANONICAL_FACT", he: "אין אירוע ביומן להופעה" });
  if (CONFIRMED.has(s.status ?? "") && !(s.price ?? 0)) { signals.push({ code: "PRICE_MISSING", kind: "CANONICAL_FACT", he: "אין מחיר להופעה (0) — אין שורת הכנסה" }); questions.push({ kind: "PRICE", questionHe: "מה המחיר של ההופעה?", why: "confirmed / done with price 0" }); }
  if (upcoming && s.paymentStatus !== "שולם") signals.push({ code: "UPCOMING_UNPAID", kind: "CANONICAL_FACT", he: `תשלום לקוח: ${s.paymentStatus}${s.advancePayment ? ` (מקדמה ${s.advancePayment})` : ""}` });
  if (s.status === "בוצע" && s.paymentStatus !== "שולם" && (s.price ?? 0) > 0) signals.push({ code: "DONE_UNPAID", kind: "CANONICAL_FACT", he: `ההופעה בוצעה, תשלום לקוח: ${s.paymentStatus}` });
  if (UPCOMING.has(s.status ?? "") && !!s.date && s.date < c.today) { signals.push({ code: "DATE_PASSED_NOT_CLOSED", kind: "DERIVED_SIGNAL", he: "התאריך עבר וההופעה לא נסגרה" }); questions.push({ kind: "CLOSE", questionHe: "ההופעה התקיימה? (עוד לא נסגרה במערכת)", why: "date passed, status still confirmed" }); }
  if (s.status === "בוצע" && rosterMatch && !artist.collaboration && split.artistFee > 0 && !ledger.some((l) => l.type === "הכנסות")) signals.push({ code: "DONE_WITHOUT_LEDGER", kind: "DERIVED_SIGNAL", he: "בוצעה אבל אין הכנסה במאזן האמן (נסגרה בלי דיאלוג הסגירה?)" });
  if (s.status === "בוטל" && ledger.some((l) => l.type === "הכנסות" || l.type === "תשלומים")) signals.push({ code: "LEDGER_KEPT_AFTER_CANCEL", kind: "DERIVED_SIGNAL", he: "הופעה מבוטלת שעדיין יש לה הכנסה / תשלום במאזן האמן" });
  if (s.status === "בוצע" && finance.artistFee.exists && (finance.artistFee as { status?: string | null }).status === "צפוי") signals.push({ code: "ARTIST_ROW_UNPAID_AFTER_DONE", kind: "CANONICAL_FACT", he: "שורת שכר האמן עדיין צפוי — לא נרשם תשלום לאמן בכספים" });
  const openTasks = tasks.filter((t) => t.status === "פתוח");
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

  return { key, found: true as const, identity: { name: s.name, date: s.date, time: s.startTime, location: s.location, status: s.status, contact: s.contactPerson, hasPhone: s.hasPhone, notes: s.notes },
    artist, booker, dj, money, ledger, rehearsals, calendar, tasks, notifications, portal, performanceFiles: "per-artist audio files in the artist's storage folder — Sunny cannot list them (CAPABILITY_GAP), never 'no files'",
    signals, questions, history, unavailable };
}
export type ShowView = NonNullable<ReturnType<typeof buildShowView>>;

export function showPortfolio(src: GatewaySources) {
  const c = ctxOf(src);
  return (c.ld?.shows?.rows ?? []).map((s: DetailShow) => buildShowView(src, s.id)!).filter(Boolean).map((v) => ({
    key: v.key, name: v.identity.name, date: v.identity.date, status: v.identity.status, artist: v.artist.text, dj: v.dj?.displayName ?? null, djConfirmation: v.dj?.confirmation ?? null,
    price: v.money.price, clientPayment: v.money.clientPayment, artistFee: v.money.split.artistFee, labelProfit: v.money.split.labelProfit, rehearsals: v.rehearsals.length,
    artistNotified: (v.notifications.artist as { state: string }).state, djNotified: (v.notifications.dj as { state: string }).state, ledgerRows: v.ledger.length, signals: [...new Set(v.signals.map((x) => x.code))], openQuestions: v.questions.length,
  })).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}
