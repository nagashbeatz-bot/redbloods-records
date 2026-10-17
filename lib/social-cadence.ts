/**
 * Social stage 2 (Owner approval 2026-10-17) — content series + weekly targets: the ONE computation every screen, writer and
 * Sunny use. Pure (no DB, no IO, no clock of its own).
 *
 * Week = Sunday–Saturday, Israel time (Owner decision 1).
 * Targets are append-only chains (DB: social_cadence_targets + its guard trigger). A row's EFFECTIVE window is
 *   [valid_from, min(valid_until, the successor's valid_from − 1)] — empty when a same-day replacement superseded it.
 * `targetProblem` mirrors the DB guard so the writer refuses early with a clear message (the trigger stays the authority).
 *
 * Two metrics are NEVER mixed (Owner point 3):
 *   ITEMS        unique content items (by id) — the OVERALL target, a SERIES target, a content-type-only BREAKDOWN;
 *   PUBLICATIONS item × platform it was published on — a PLATFORM BREAKDOWN target (each item once per row).
 * A series item counts once in the artist's OVERALL and once in its SERIES progress; nothing is ever summed across rows.
 * "Published" = the Redbloods record (socialPhaseOf PUBLISHED + a publish date in the week) — Owner decision 4. External
 * (browser-checked) evidence is computed elsewhere and shown apart, never counted.
 */
import { isSocialItemOverdue, socialPhaseOf } from "@/lib/types";

export type TargetScope = "OVERALL" | "BREAKDOWN" | "SERIES";
export type TargetAction = "SET" | "END";
export type TargetSource = "OWNER_STATEMENT" | "OWNER_APPROVED_RECOMMENDATION";
export interface CadenceTargetRow {
  id: string; scope: TargetScope; label_artist_id: string | null; series_id: string | null; platform: string | null; content_type: string | null;
  action: TargetAction; per_week: number | null; valid_from: string; valid_until: string | null; supersedes_id: string | null;
  source: TargetSource; recommendation_id: string | null; note_he: string | null; created_at: string;
}
export type SeriesStatus = "ACTIVE" | "PAUSED" | "ENDED";
export interface SeriesRow { id: string; name: string; owner_scope: "ARTIST" | "LABEL"; label_artist_id: string | null; platforms: string[]; status: SeriesStatus; notes: string; created_at: string; updated_at: string }
export interface CadenceItem { id: string; title: string; label_artist_id: string | null; series_id: string | null; status: string | null; content_type: string | null; platform: string | null; due_date: string | null; publish_date: string | null }

export const SERIES_STATUSES: readonly SeriesStatus[] = ["ACTIVE", "PAUSED", "ENDED"];
export const SERIES_STATUS_HE: Record<SeriesStatus, string> = { ACTIVE: "פעילה", PAUSED: "מושהית", ENDED: "הסתיימה" };
export const SCOPE_HE: Record<TargetScope, string> = { OVERALL: "יעד כולל", BREAKDOWN: "יעד פירוט", SERIES: "יעד סדרה" };
export const SOURCE_HE: Record<TargetSource, string> = { OWNER_STATEMENT: "נקבע על ידך", OWNER_APPROVED_RECOMMENDATION: "המלצה של סאני שאישרת" };

// ── dates (Israel) ──
export const ilYmd = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
export const addDays = (ymd: string, n: number) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
/** The Sunday that starts the week of `ymd` (Sunday–Saturday). */
export const weekStartOf = (ymd: string) => addDays(ymd, -new Date(`${ymd}T12:00:00Z`).getUTCDay());
const INF = "9999-12-31";

// ── target chains ──
export const slotOf = (t: Pick<CadenceTargetRow, "scope" | "label_artist_id" | "series_id" | "platform" | "content_type">) =>
  [t.scope, t.label_artist_id ?? "", t.series_id ?? "", t.platform ?? "", t.content_type ?? ""].join("|");
/** Effective window per row (to = INF when open; empty = a same-day replacement superseded it before it ever applied). */
export function effectiveWindows(rows: readonly CadenceTargetRow[]): Map<string, { from: string; to: string; empty: boolean }> {
  const succ = new Map(rows.filter((r) => r.supersedes_id).map((r) => [r.supersedes_id!, r]));
  const out = new Map<string, { from: string; to: string; empty: boolean }>();
  for (const r of rows) {
    const s = succ.get(r.id);
    const to = [r.valid_until ?? INF, s ? addDays(s.valid_from, -1) : INF].sort()[0];
    out.set(r.id, { from: r.valid_from, to, empty: to < r.valid_from });
  }
  return out;
}
/** The SET rows in effect on `ymd` (at most one per slot by construction). */
export function targetsInEffect(rows: readonly CadenceTargetRow[], ymd: string): CadenceTargetRow[] {
  const w = effectiveWindows(rows);
  return rows.filter((r) => { const x = w.get(r.id)!; return r.action === "SET" && !x.empty && x.from <= ymd && ymd <= x.to; });
}
/** One slot's full chain, oldest first (history is never lost). */
export function chainOf(rows: readonly CadenceTargetRow[], id: string): CadenceTargetRow[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const succ = new Map(rows.filter((r) => r.supersedes_id).map((r) => [r.supersedes_id!, r]));
  let root = byId.get(id); while (root?.supersedes_id && byId.get(root.supersedes_id)) root = byId.get(root.supersedes_id);
  const out: CadenceTargetRow[] = []; for (let x = root; x; x = succ.get(x.id)) out.push(x);
  return out;
}
/** The chain's last row (the one nothing supersedes). */
export const headOf = (rows: readonly CadenceTargetRow[], id: string) => chainOf(rows, id).at(-1) ?? null;

export type TargetProblem = "TARGET_BACKDATED" | "TARGET_SLOT_MISMATCH" | "TARGET_ALREADY_ENDED" | "TARGET_BEFORE_PREVIOUS" | "TARGET_HAS_SUCCESSOR" | "TARGET_OVERLAP" | "BREAKDOWN_OVERLAP";
export const TARGET_PROBLEM_HE: Record<TargetProblem | "SERIES_ARTIST_MISMATCH" | "SERIES_OWNER_LOCKED", string> = {
  TARGET_BACKDATED: "יעד מתחיל מהיום או אחר כך — היסטוריה לא משתנה",
  TARGET_SLOT_MISMATCH: "החלפה חייבת להיות של אותו יעד (אותה רמה, אמן, סדרה, פלטפורמה וסוג תוכן)",
  TARGET_ALREADY_ENDED: "היעד הזה הסתיים — פותחים יעד חדש",
  TARGET_BEFORE_PREVIOUS: "החלפה לא יכולה להתחיל לפני היעד שהיא מחליפה",
  TARGET_HAS_SUCCESSOR: "היעד הזה כבר הוחלף — מחליפים את הגרסה האחרונה שלו",
  TARGET_OVERLAP: "כבר יש יעד פעיל באותה תקופה — כדי לשנות, מחליפים את היעד הקיים",
  BREAKDOWN_OVERLAP: "יעד הפירוט חופף לפירוט קיים — אותם פריטים היו נספרים פעמיים",
  SERIES_ARTIST_MISMATCH: "פריט בסדרה של אמן חייב להיות של אותו אמן",
  SERIES_OWNER_LOCKED: "לסדרה כבר יש תוכן — הבעלים שלה לא משתנים",
};
/** The DB guard, in code (same rules, same order) — so the writer and Sunny refuse BEFORE writing. */
export function targetProblem(n: Omit<CadenceTargetRow, "id" | "created_at">, existing: readonly CadenceTargetRow[], todayIL: string): TargetProblem | null {
  if (n.valid_from < todayIL) return "TARGET_BACKDATED";
  if (n.supersedes_id) {
    const old = existing.find((r) => r.id === n.supersedes_id);
    if (!old || slotOf(old) !== slotOf(n)) return "TARGET_SLOT_MISMATCH";
    if (old.action === "END") return "TARGET_ALREADY_ENDED";
    if (n.valid_from < old.valid_from) return "TARGET_BEFORE_PREVIOUS";
    if (existing.some((r) => r.supersedes_id === old.id)) return "TARGET_HAS_SUCCESSOR";
  }
  if (n.action !== "SET") return null;
  const w = effectiveWindows(existing);
  const newTo = n.valid_until ?? INF;
  const live = (r: CadenceTargetRow) => { const x = w.get(r.id)!; return r.action === "SET" && r.id !== n.supersedes_id && !x.empty && x.from <= newTo && x.to >= n.valid_from; };
  if (existing.some((r) => live(r) && slotOf(r) === slotOf(n))) return "TARGET_OVERLAP";
  if (n.scope === "BREAKDOWN" && existing.some((r) => live(r) && r.scope === "BREAKDOWN" && r.label_artist_id === n.label_artist_id
    && (r.platform === null || n.platform === null || r.platform === n.platform) && (r.content_type === null || n.content_type === null || r.content_type === n.content_type)
    && (r.platform !== n.platform || r.content_type !== n.content_type))) return "BREAKDOWN_OVERLAP";
  return null;
}

// ── measurement ──
/** The platforms an item lists (one value or the comma-joined list the screens write); empty = no platform. */
export const platformsOf = (p: string | null | undefined): string[] => [...new Set(String(p ?? "").split(",").map((x) => x.trim()).filter(Boolean))];
const inWeek = (ymd: string | null, ws: string) => !!ymd && /^\d{4}-\d{2}-\d{2}$/.test(ymd) && ymd >= ws && ymd <= addDays(ws, 6);

export interface Progress { metric: "ITEMS" | "PUBLICATIONS"; required: number; published: number; plannedRemaining: number; gap: number; onTrack: boolean }
export interface TargetProgress { target: CadenceTargetRow; progress: Progress }
export interface SeriesProgress { series: SeriesRow; target: CadenceTargetRow | null; publishedItems: number; plannedItems: number; progress: Progress | null }
export interface WeekSummary {
  weekStart: string; weekEnd: string; referenceDate: string; isCurrent: boolean;
  /** unique content items (by id) — never mixed with publications */
  items: { planned: number; published: number; plannedRemaining: number; plannedNotPublished: number };
  /** item × platform publications of the published items — never mixed with items */
  publications: { total: number; byPlatform: Record<string, number>; publishedWithoutPlatform: number };
  overall: TargetProgress | null;
  breakdown: TargetProgress[];
  series: SeriesProgress[];
  signals: Array<{ code: "BELOW_TARGET" | "PLANNED_NOT_PUBLISHED" | "SERIES_GAP" | "NO_TARGET"; scope: TargetScope | null; refId: string | null; textHe: string }>;
}

const progress = (metric: Progress["metric"], required: number, published: number, plannedRemaining: number, isCurrent: boolean): Progress =>
  ({ metric, required, published, plannedRemaining, gap: Math.max(0, required - published), onTrack: published >= required || (isCurrent && published + plannedRemaining >= required) });

/**
 * One week for one artist. Items = the artist's own items (canonical label_artist_id) + for each series target the series'
 * items. The target in effect is read on the reference date: today for the current week, the week's Saturday for a past week.
 */
export function weekSummary(i: { artistId: string; weekStart: string; todayIL: string; items: readonly CadenceItem[]; targets: readonly CadenceTargetRow[]; series: readonly SeriesRow[] }): WeekSummary {
  const ws = i.weekStart, we = addDays(ws, 6);
  const isCurrent = i.todayIL >= ws && i.todayIL <= we;
  const ref = isCurrent ? i.todayIL : we;
  const open = (x: CadenceItem) => { const ph = socialPhaseOf(x.status); return ph !== "PUBLISHED" && ph !== "CANCELLED"; };
  const pub = (x: CadenceItem) => socialPhaseOf(x.status) === "PUBLISHED" && inWeek(x.publish_date, ws);
  const plannedIn = (x: CadenceItem) => socialPhaseOf(x.status) !== "CANCELLED" && inWeek(x.publish_date, ws);
  const remaining = (x: CadenceItem) => open(x) && inWeek(x.publish_date, ws) && x.publish_date! >= i.todayIL;
  const mine = i.items.filter((x) => x.label_artist_id === i.artistId);
  const published = mine.filter(pub);
  const byPlatform: Record<string, number> = {};
  for (const x of published) for (const p of platformsOf(x.platform)) byPlatform[p] = (byPlatform[p] ?? 0) + 1;
  const items = { planned: mine.filter(plannedIn).length, published: published.length, plannedRemaining: mine.filter(remaining).length,
    plannedNotPublished: mine.filter((x) => open(x) && inWeek(x.publish_date, ws) && x.publish_date! < i.todayIL).length };
  const publications = { total: Object.values(byPlatform).reduce((a, b) => a + b, 0), byPlatform, publishedWithoutPlatform: published.filter((x) => !platformsOf(x.platform).length).length };

  const eff = targetsInEffect(i.targets, ref);
  const ov = eff.find((t) => t.scope === "OVERALL" && t.label_artist_id === i.artistId) ?? null;
  const overall = ov ? { target: ov, progress: progress("ITEMS", ov.per_week!, items.published, items.plannedRemaining, isCurrent) } : null;
  const breakdown = eff.filter((t) => t.scope === "BREAKDOWN" && t.label_artist_id === i.artistId).map((t): TargetProgress => {
    const match = (x: CadenceItem) => (t.platform === null || platformsOf(x.platform).includes(t.platform)) && (t.content_type === null || x.content_type === t.content_type);
    // a platform row measures PUBLICATIONS on that platform (each item once in the row); a type-only row measures ITEMS
    const metric = t.platform ? "PUBLICATIONS" : "ITEMS";
    return { target: t, progress: progress(metric, t.per_week!, published.filter(match).length, mine.filter((x) => remaining(x) && match(x)).length, isCurrent) };
  });
  // the artist's OWN series only — a label series is measured at label level (labelSeriesWeek), never inside one artist
  const series = i.series.filter((s) => s.owner_scope === "ARTIST" && s.label_artist_id === i.artistId).map((s) => seriesProgressOf(s, i.items, eff, ws, i.todayIL, isCurrent));
  const signals: WeekSummary["signals"] = [];
  const below = (p: Progress) => !p.onTrack;
  if (!overall) signals.push({ code: "NO_TARGET", scope: null, refId: null, textHe: "עוד לא הוגדר יעד שבועי — לא מנחשים מספר" });
  else if (below(overall.progress)) signals.push({ code: "BELOW_TARGET", scope: "OVERALL", refId: ov!.id, textHe: `יעד כולל: פורסמו ${overall.progress.published} מתוך ${overall.progress.required} פריטי תוכן${isCurrent ? ` (עוד ${overall.progress.plannedRemaining} מתוכננים השבוע)` : ""}` });
  for (const b of breakdown) if (below(b.progress)) signals.push({ code: "BELOW_TARGET", scope: "BREAKDOWN", refId: b.target.id, textHe: `${b.target.platform ?? b.target.content_type}: ${b.progress.published} מתוך ${b.progress.required} ${b.progress.metric === "PUBLICATIONS" ? "פרסומים" : "פריטי תוכן"}` });
  for (const s of series) if (s.progress && below(s.progress)) signals.push({ code: "SERIES_GAP", scope: "SERIES", refId: s.series.id, textHe: `${s.series.name}: ${s.progress.published} מתוך ${s.progress.required} השבוע` });
  if (items.plannedNotPublished > 0) signals.push({ code: "PLANNED_NOT_PUBLISHED", scope: null, refId: null, textHe: `${items.plannedNotPublished} פריטים תוכננו לתאריך שעבר ועוד לא סומנו כפורסמו — פורסם?` });
  return { weekStart: ws, weekEnd: we, referenceDate: ref, isCurrent, items, publications, overall, breakdown, series, signals };
}

function seriesProgressOf(s: SeriesRow, items: readonly CadenceItem[], eff: readonly CadenceTargetRow[], ws: string, todayIL: string, isCurrent: boolean): SeriesProgress {
  const its = items.filter((x) => x.series_id === s.id);
  const pubN = its.filter((x) => socialPhaseOf(x.status) === "PUBLISHED" && inWeek(x.publish_date, ws)).length;
  const planN = its.filter((x) => socialPhaseOf(x.status) !== "CANCELLED" && inWeek(x.publish_date, ws)).length;
  const rem = its.filter((x) => { const ph = socialPhaseOf(x.status); return ph !== "PUBLISHED" && ph !== "CANCELLED" && inWeek(x.publish_date, ws) && x.publish_date! >= todayIL; }).length;
  const t = eff.find((x) => x.scope === "SERIES" && x.series_id === s.id) ?? null;
  return { series: s, target: t, publishedItems: pubN, plannedItems: planN, progress: t ? progress("ITEMS", t.per_week!, pubN, rem, isCurrent) : null };
}

/** Label series (owner LABEL) for one week — label level, items of any artist or none. */
export function labelSeriesWeek(i: { weekStart: string; todayIL: string; items: readonly CadenceItem[]; targets: readonly CadenceTargetRow[]; series: readonly SeriesRow[] }): SeriesProgress[] {
  const we = addDays(i.weekStart, 6), isCurrent = i.todayIL >= i.weekStart && i.todayIL <= we;
  const eff = targetsInEffect(i.targets, isCurrent ? i.todayIL : we);
  return i.series.filter((s) => s.owner_scope === "LABEL").map((s) => seriesProgressOf(s, i.items, eff, i.weekStart, i.todayIL, isCurrent));
}

/** The current week + the 4 weeks before it (Owner request: four weeks back). */
export function cadenceHistory(i: Omit<Parameters<typeof weekSummary>[0], "weekStart">, weeks = 4): WeekSummary[] {
  const cur = weekStartOf(i.todayIL);
  return Array.from({ length: weeks + 1 }, (_, k) => weekSummary({ ...i, weekStart: addDays(cur, -7 * k) }));
}

/** Overdue (the app's rule) among the artist's own items — never week-bound. */
export const overdueCount = (items: readonly CadenceItem[], artistId: string, todayIL: string) => items.filter((x) => x.label_artist_id === artistId && isSocialItemOverdue({ status: x.status, due_date: x.due_date }, todayIL)).length;
