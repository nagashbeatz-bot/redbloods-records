/**
 * SUNNY UNIVERSAL ACTION LAYER — pre-write duplicate awareness for money CREATE actions (pure, deterministic).
 *
 * Owner decision 2026-09-27 (POLISH FIX #1): before a financial / business record is CREATED, Sunny looks for a similar
 * record that already exists and asks the Boss BEFORE the final plan ("בוס, כבר קיימת הוצאה דומה: 22.9 · 400₪ · אקו"ם.
 * זו אותה הוצאה או הוצאה נוספת?"). The Boss decides. Nothing is ever deleted, merged or updated automatically, and a
 * legitimate additional record is never blocked: "separate" (arg separateFromSimilar: true) records it.
 *
 * The search is focused and context-bound (the reader in lib/writes/duplicates.ts): the SAME entity (artist / project /
 * show / budget line / general), the SAME type and currency, the SAME amount. No global fuzzy scan, no AI engine. Here:
 *   LIKELY_SAME  same amount + similar description within ±45 days (or no description on either side, same day)
 *                → the plan is held until the Boss says whether it is the same record or an additional one.
 *   SIMILAR      same amount within ±7 days, description different / unknown → shown as "דומה" in the preview only.
 * A different amount, a far date or a different context is never a candidate.
 */
import { refuse, type Fields, type PlanRefusal } from "./core";

/** One existing record with the same context + amount (from the typed reader; no ids / paths are carried). */
export interface DupRow { date: string | null; amount: number; currency: string | null; text: string }
export type DupKind = "LEDGER_ENTRY" | "TRANSACTION" | "MEDIA_INCOME" | "RF_PAYMENT" | "SHOW_PAYMENT" | "CLIP_PAYMENT";
/** The focused, context-bound query (exact equality on context + amount; the reader never scans globally). */
export type DupQuery =
  | { kind: "LEDGER_ENTRY"; artistId: string; entryType: string; amount: number }
  | { kind: "TRANSACTION"; projectId: string | null; type: string; amount: number; currency: string }
  | { kind: "MEDIA_INCOME"; artistId: string; grossAmount: number }
  | { kind: "RF_PAYMENT"; budgetLineId: string; amount: number }
  | { kind: "CLIP_PAYMENT"; projectId: string; amount: number };
export interface DuplicateWriters { similarRecords(q: DupQuery): Promise<DupRow[]> }

export const LIKELY_SAME_DAYS = 45;
export const SIMILAR_DAYS = 7;
/** Words that describe the act of recording, not what the money is for. */
const STOP = new Set("רישום לרישום תשלום תשלומים הוצאה הוצאות הכנסה הכנסות עבור על של את עם חודש חודשי חודשית payment expense income for the of".split(" "));

/** "רישום לאקו"ם" → ["לאקום"] · quotes / geresh / punctuation removed, recording words dropped. */
export function normTokens(s: string): string[] {
  const t = s.normalize("NFKC").toLowerCase().replace(/["'״׳`]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return t.split(/\s+/).filter((w) => w.length >= 2 && !STOP.has(w) && !(/^[ולבהמש]/.test(w) && STOP.has(w.slice(1))));
}
/** a Hebrew word may carry a one-letter prefix (ל / ב / ה / ו / מ / ש): "לאקום" ~ "אקום" */
const variants = (w: string) => (/^[ולבהמש][֐-׿]{3,}$/.test(w) ? [w, w.slice(1)] : [w]);
/** Similar descriptions: a shared meaningful word (≥ 3 letters, prefix-tolerant) or one text contained in the other. */
export function textsSimilar(a: string, b: string): boolean {
  const ta = normTokens(a), tb = normTokens(b);
  if (!ta.length || !tb.length) return false;
  const ja = ta.join(" "), jb = tb.join(" ");
  if (ja === jb || (ja.length >= 3 && jb.includes(ja)) || (jb.length >= 3 && ja.includes(jb))) return true;
  // a shared WORD (letters, ≥ 3) — a shared number alone ("2026") never makes two descriptions similar
  const meaningful = (w: string) => w.length >= 3 && /\p{L}/u.test(w);
  const vb = new Set(tb.flatMap(variants).filter(meaningful));
  return ta.flatMap(variants).some((w) => meaningful(w) && vb.has(w));
}
const days = (a: string | null, b: string | null) => (a && b ? Math.round(Math.abs(Date.parse(`${a.slice(0, 10)}T00:00:00Z`) - Date.parse(`${b.slice(0, 10)}T00:00:00Z`)) / 86_400_000) : null);

export interface DupCandidate { level: "LIKELY_SAME" | "SIMILAR"; date: string | null; amount: number; currency: string | null; text: string; daysApart: number | null }
/** Classify the same-amount rows against the new record's date + description. */
export function dupCandidates(rows: readonly DupRow[], n: { date: string | null; text: string }): DupCandidate[] {
  const out: DupCandidate[] = [];
  for (const r of rows) {
    const d = days(r.date, n.date);
    const similar = textsSimilar(r.text, n.text);
    const noText = !normTokens(r.text).length && !normTokens(n.text).length;
    const level = (similar && (d === null || d <= LIKELY_SAME_DAYS)) || (noText && d === 0) ? "LIKELY_SAME" : d !== null && d <= SIMILAR_DAYS ? "SIMILAR" : null;
    if (level) out.push({ level, date: r.date ? r.date.slice(0, 10) : null, amount: r.amount, currency: r.currency, text: r.text.trim().slice(0, 80), daysApart: d });
  }
  return out.sort((a, b) => (a.level === b.level ? (a.daysApart ?? 999) - (b.daysApart ?? 999) : a.level === "LIKELY_SAME" ? -1 : 1)).slice(0, 3);
}
const fmtDate = (d: string | null) => (d ? `${Number(d.slice(8, 10))}.${Number(d.slice(5, 7))}.${d.slice(0, 4)}` : "בלי תאריך");
const fmtOne = (c: DupCandidate, cur: string) => `${fmtDate(c.date)} · ${c.currency ?? cur}${c.amount.toLocaleString("en-US")}${c.text ? ` · ${c.text}` : ""}`;

/** The deterministic summary stored in the live fields — part of the stale fingerprint (a new similar record → STALE). */
export function dupField(c: readonly DupCandidate[], currency: string): string {
  return c.map((x) => `${x.level === "LIKELY_SAME" ? "כמעט זהה" : "דומה"}: ${fmtOne(x, currency)}`).join(" | ");
}
/** Live context fields for a CREATE: the same-amount records near the new one. A read failure throws (never "none"). */
export async function dupContext(d: DuplicateWriters, q: DupQuery | null, n: { date: string | null; text: string; currency: string }): Promise<Fields> {
  if (!q) return { similarRecords: "" };
  return { similarRecords: dupField(dupCandidates(await d.similarRecords(q), n), n.currency) };
}
/** The Boss decides: a LIKELY_SAME candidate holds the plan until he says it is an ADDITIONAL record (separateFromSimilar). */
export function dupGate(a: Readonly<Record<string, unknown>>, cur: Fields, nounHe: string): PlanRefusal | null {
  const s = String(cur.similarRecords ?? "");
  if (!s.includes("כמעט זהה") || a.separateFromSimilar === true) return null;
  const first = s.split(" | ").find((x) => x.startsWith("כמעט זהה"))!.replace(/^כמעט זהה: /, "");
  return refuse("POSSIBLE_DUPLICATE", `בוס, כבר קיימת ${nounHe} דומה: ${first}. זו אותה ${nounHe} או ${nounHe} נוספת? (אם נוספת — אתכנן שוב עם separateFromSimilar: true; לא נמחק ולא ישתנה כלום)`);
}
/** Preview warnings: every candidate, and — when the Boss said "separate" — that it is recorded as an additional one. */
export function dupWarnings(cur: Fields, a?: Readonly<Record<string, unknown>>): string[] {
  const s = String(cur.similarRecords ?? "");
  if (!s) return [];
  return [...s.split(" | ").map((x) => `קיימת רשומה ${x}`), ...(a?.separateFromSimilar === true ? ["לפי ההחלטה שלך — נרשמת כרשומה נוספת, בנפרד מהקיימת"] : [])];
}
/** The optional argument that records the Boss's "it is an additional one" decision. */
export const SEPARATE_ARG = { name: "separateFromSimilar", kind: "boolean", required: false, noteHe: "true = הבוס אישר שזו רשומה נוספת ולא אותה רשומה שכבר קיימת" } as const;
