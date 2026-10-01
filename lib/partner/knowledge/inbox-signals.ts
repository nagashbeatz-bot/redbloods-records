/**
 * Owner Inbox — the SIGNALS of one update (Owner decision 2026-10-01: a name is only one signal). Pure, deterministic,
 * no model: a small FIXED lexicon of work words, the team names, relative time (by the Israel time the update was
 * written) and numbers. The business resolver (inbox-evidence.ts) weighs candidates with these.
 */
import { normalizeName } from "../gateway/resolve";

export type WorkKind = "MIX" | "SESSION" | "VIDEO" | "WRITING";
/** Fixed lexicon (normalized forms). One Hebrew prefix letter is allowed on a word ("למיקס" → מיקס). */
export const WORK_LEXICON: Readonly<Record<WorkKind, readonly string[]>> = {
  MIX: ["מיקס", "מיקסים", "מאסטר", "מאסטרינג", "תיקון", "תיקונים", "גרסה", "גרסאות", "mix", "master"],
  SESSION: ["סשן", "סשנים", "הקלטה", "הקלטות", "הקלטנו", "הקליט", "הקליטה", "אולפן"],
  VIDEO: ["קליפ", "צילום", "צילומים", "צילמנו"],
  WRITING: ["ורס", "פזמון", "כתיבה", "מילים", "בריף"],
};
/** Team members the Owner names (display names) → the engineer / vendor identity the records use. */
export const TEAM_NAMES: Readonly<Record<string, "STEVEN" | "VICTOR">> = { "סטיבן": "STEVEN", steven: "STEVEN", "ויקטור": "VICTOR", victor: "VICTOR" };
const PREFIX = new Set(["ו", "ה", "ב", "ל", "מ", "ש", "כ"]);
const forms = (w: string) => [w, ...(w.length >= 4 && PREFIX.has(w[0]) && /^[א-ת]/.test(w) ? [w.slice(1)] : [])];

export interface UpdateSignals {
  work: WorkKind[];
  team: Array<"STEVEN" | "VICTOR">;
  /** the Israel dates the text refers to (empty = no time word) */
  days: string[];
  timeWords: string[];
  numbers: number[];
  /** past-tense / happened wording ("היה", "היום עם … היה") — the Owner reports something already happened */
  reportsHappened: boolean;
}

const ilParts = (iso: string) => {
  const d = new Date(iso);
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", hour12: false }).format(d));
  return { ymd, hour };
};
export const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** Night rule: an update written before 05:00 (Israel) may still mean the previous day ("היום" at 02:21 = the evening before). */
export const NIGHT_HOUR = 5;

export function extractSignals(text: string, writtenAt: string): UpdateSignals {
  const words = normalizeName(text).split(" ").filter(Boolean);
  const has = (list: readonly string[]) => words.some((w) => forms(w).some((f) => list.includes(f)));
  const work = (Object.keys(WORK_LEXICON) as WorkKind[]).filter((k) => has(WORK_LEXICON[k]));
  const team = [...new Set(words.flatMap((w) => forms(w)).map((f) => TEAM_NAMES[f]).filter(Boolean))];
  const { ymd, hour } = ilParts(writtenAt);
  const night = hour < NIGHT_HOUR;
  const timeWords: string[] = [];
  const days = new Set<string>();
  const add = (offset: number) => { days.add(addDays(ymd, offset)); if (night) days.add(addDays(ymd, offset - 1)); };
  if (has(["היום", "הערב", "עכשיו"])) { timeWords.push("היום"); add(0); }
  if (has(["אתמול"])) { timeWords.push("אתמול"); add(-1); }
  if (has(["שלשום"])) { timeWords.push("שלשום"); add(-2); }
  if (has(["מחר"])) { timeWords.push("מחר"); add(1); }
  const numbers = [...text.matchAll(/\d+/g)].map((m) => Number(m[0])).filter((n) => Number.isFinite(n) && n < 1000);
  if (has(["שני", "שתי", "שניים", "שתיים"]) && !numbers.includes(2)) numbers.push(2);
  const reportsHappened = has(["היה", "הייתה", "היו", "סיימנו", "עשינו", "הקלטנו", "צילמנו"]);
  return { work, team, days: [...days].sort(), timeWords, numbers, reportsHappened };
}
