// Dashboard V2 = Sunny's executive surface (Owner decision 2026-10-05, direction B, Phase B). PURE, client-safe.
//
// It only PARSES what GET /api/partner/executive serves (BUSINESS_MOTION, FINANCIAL_FORWARD, needs_me — the SAME
// answers the chat gets) and joins it to the dashboard's own records BY CANONICAL ENTITY KEY ONLY. No ranking, no
// score, no rule, no re-ordering: every list keeps the order Sunny served. A missing / failed part is null (the page says
// "לא נקרא"), never an empty list.
//
// The join (Owner guard 2026-10-05): a timeline / release row is enriched ONLY when it carries a canonical key that a
// motion item names exactly (project:<id> from the record's own FK, show:<id>). Never by a display name, a fuzzy match,
// a transliteration or a calendar text match — no shared key = no enrichment.

export type ExecLevel = "MUST" | "SHOULD" | "WATCH" | "INFO";
export interface ExecMove { he: string; actionIds: string[] }
export interface ExecItem {
  key: string; entity: string | null; entities: string[]; level: ExecLevel; codes: string[];
  titleHe: string; reasonsHe: string[]; move: ExecMove | null; epistemic: string;
}
export interface ExecMotion {
  today: string;
  greeting: ExecItem[];
  todayItems: ExecItem[];
  more: number;
  closeLoops: ExecItem[];
  label: ExecItem[];
  atRisk: ExecItem[];
  watch: ExecItem[];
  weekLineHe: string | null;
  inboxLineHe: string | null;
  bottleneckLineHe: string | null;
  revenueLineHe: string | null;
  learning: { status: string; noteHe: string } | null;
  unchecked: string[];
  money: { lineHe: string | null; decided: string[]; coverageHe: string | null } | null;
}
export interface ExecForward {
  /** false = FINANCIAL_FORWARD could not read the finance (its UNKNOWN answer: no windows) — said, never zeros */
  read: boolean;
  answerHe: string | null;
  coverageHe: string | null;
  actualMonth: Record<string, { in: number; out: number; net: number }>;
  week: { hardOutflow: Record<string, number>; dynamicExposure: Record<string, number>; expectedInflow: Record<string, number>; undatedHard: Record<string, number>; conditional: Record<string, number> } | null;
  surprises: string[];
}
export interface Executive {
  asOf: string | null;
  history: { status: string; reasonHe?: string };
  motion: ExecMotion | null;
  forward: ExecForward | null;
  /** the needs_me answer exactly as served (parsed by the dashboard's parseBoard — the same as before) */
  needsMe: Record<string, unknown> | null;
}

type Rec = Record<string, unknown>;
const obj = (v: unknown): Rec | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const LEVELS = new Set(["MUST", "SHOULD", "WATCH", "INFO"]);
const fact = (p: Rec | null, code: string): unknown => ((p?.summary ?? []) as Array<{ code?: string; value?: unknown }>).find((x) => x?.code === code)?.value;
const totals = (v: unknown): Record<string, number> => Object.fromEntries(Object.entries(obj(v) ?? {}).filter(([, n]) => typeof n === "number")) as Record<string, number>;

function item(raw: unknown): ExecItem | null {
  const r = obj(raw);
  if (!r || typeof r.key !== "string") return null;
  const mv = obj(r.move);
  return {
    key: r.key, entity: str(r.entity), entities: strs(r.entities), level: (LEVELS.has(String(r.level)) ? r.level : "INFO") as ExecLevel, codes: strs(r.codes),
    titleHe: str(r.titleHe) ?? "", reasonsHe: strs(r.reasonsHe), move: mv && str(mv.he) ? { he: String(mv.he), actionIds: strs(mv.actionIds) } : null, epistemic: str(r.epistemic) ?? "DERIVED",
  };
}
const items = (v: unknown): ExecItem[] => (Array.isArray(v) ? v.map(item).filter((x): x is ExecItem => !!x) : []);

/** Parses the executive read; any part that is not OK is null (never an empty answer). */
export function parseExecutive(body: unknown): Executive | null {
  const b = obj(body);
  if (!b || typeof b.schema !== "string") return null;
  const mp = obj(b.motion), fp = obj(b.forward), np = obj(b.needsMe);
  const m = mp?.status === "OK" ? obj(fact(mp, "MOTION")) : null;
  const week = obj(m?.week), inbox = obj(m?.inbox), ob = obj(m?.ownerBottleneck), rev = obj(m?.revenue), fin = obj(m?.financial), learn = obj(m?.learning);
  const motion: ExecMotion | null = m ? {
    today: str(m.today) ?? "",
    greeting: items(m.greeting), todayItems: items(m.todayItems), more: typeof m.more === "number" ? m.more : 0,
    closeLoops: items(m.closeLoops), label: items(m.label), atRisk: items(m.atRisk), watch: items(m.watch),
    weekLineHe: str(week?.lineHe), inboxLineHe: str(inbox?.lineHe), bottleneckLineHe: str(ob?.lineHe), revenueLineHe: str(rev?.lineHe),
    learning: learn ? { status: str(learn.status) ?? "NOT_READ", noteHe: str(learn.noteHe) ?? "" } : null,
    unchecked: strs(m.unchecked),
    money: fin ? { lineHe: str(fin.lineHe), decided: strs(fin.decided), coverageHe: str(fin.coverageHe) } : null,
  } : null;
  const windows = fp?.status === "OK" ? (fact(fp, "WINDOWS") as unknown[] | undefined) : undefined;
  const w7 = Array.isArray(windows) ? obj(windows[0]) : null;
  const forward: ExecForward | null = fp?.status === "OK" ? {
    read: Array.isArray(windows) && windows.length > 0,
    answerHe: str(fact(fp, "ANSWER")), coverageHe: null,
    actualMonth: Object.fromEntries(Object.entries(obj(fact(fp, "ACTUAL_MONTH")) ?? {}).map(([c, v]) => { const o = obj(v) ?? {}; return [c, { in: Number(o.in) || 0, out: Number(o.out) || 0, net: Number(o.net) || 0 }]; })),
    week: w7 ? { hardOutflow: totals(w7.hardOutflow), dynamicExposure: totals(w7.dynamicExposure), expectedInflow: totals(w7.expectedInflow), undatedHard: totals(w7.undatedHard), conditional: totals(w7.conditional) } : null,
    surprises: strs(fact(fp, "SURPRISES")),
  } : null;
  if (forward) forward.coverageHe = ((fp?.coverage ?? []) as Array<{ text?: string }>).map((c) => c?.text ?? "").find((t) => t.startsWith("לפי התזרים הרשום")) ?? null;
  const h = obj(b.history);
  return { asOf: str(b.asOf), history: { status: str(h?.status) ?? "NOT_READ", ...(str(h?.reasonHe) ? { reasonHe: String(h!.reasonHe) } : {}) }, motion, forward, needsMe: np?.status === "OK" ? np : null };
}

/** The motion items Sunny SERVES, in her order — the only source of an enrichment. */
export function servedItems(m: ExecMotion): ExecItem[] {
  const seen = new Set<string>();
  return [...m.todayItems, ...m.atRisk, ...m.closeLoops, ...m.label, ...m.watch].filter((i) => (seen.has(i.key) ? false : (seen.add(i.key), true)));
}

/** Exact canonical-key index (entity + entities). The first served item for a key wins — no ranking of our own. */
export function indexByEntity(m: ExecMotion | null): Map<string, ExecItem> {
  const idx = new Map<string, ExecItem>();
  if (!m) return idx;
  for (const i of servedItems(m)) for (const k of [i.entity, ...i.entities]) if (k && isCanonicalKey(k) && !idx.has(k)) idx.set(k, i);
  return idx;
}

/** A canonical entity key (type:id) — never a name. */
export const isCanonicalKey = (k: string | null | undefined): k is string => !!k && /^[a-z][a-z-]*:[0-9a-f-]{8,}$/i.test(k);

/** Enrichment for a row that carries a canonical key; null when there is no key or no exact match. */
export function enrichmentFor(idx: Map<string, ExecItem>, key: string | null | undefined): ExecItem | null {
  return isCanonicalKey(key) ? idx.get(key) ?? null : null;
}

/** Where a motion item opens (existing pages / the project drawer only). */
export function openOfEntity(entity: string | null): { kind: "project"; id: string } | { kind: "href"; href: string } | { kind: "none" } {
  if (!entity) return { kind: "none" };
  const [type, id] = [entity.slice(0, entity.indexOf(":")), entity.slice(entity.indexOf(":") + 1)];
  if (type === "project" && id) return { kind: "project", id };
  if (type === "label-artist") return { kind: "href", href: "/label" };
  if (type === "show") return { kind: "href", href: "/shows" };
  if (type === "video-production" || type === "rf-production") return { kind: "href", href: "/red-films" };
  return { kind: "none" };
}

export const LEVEL_HE: Record<ExecLevel, string> = { MUST: "חייב עכשיו", SHOULD: "כדאי השבוע", WATCH: "לשים עין", INFO: "הקשר" };

/** Money per currency, never summed across currencies ("$750 + ₪2,213"). */
export function totalsHe(t: Record<string, number>): string {
  const parts = Object.entries(t).filter(([, v]) => v).map(([c, v]) => `${c === "$" ? "$" : c === "₪" ? "₪" : `${c} `}${Math.round(Math.abs(v)).toLocaleString("en-US")}`);
  return parts.length ? parts.join(" + ") : "0";
}
