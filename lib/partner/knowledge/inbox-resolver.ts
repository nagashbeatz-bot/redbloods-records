/**
 * Owner Inbox MEMORY — the server resolver for a link (Option A, Owner-approved 2026-10-01): which entity a literal part
 * of the Owner's text names. Enforced in lib/writes/inbox-memory.ts; the DB never claims it. Pure. Names come ONLY from
 * partner_resolve's own index through the mention matcher (whole words, one Hebrew prefix letter, generic / short names
 * AMBIGUOUS) — never a guess.
 *
 * ONE candidate universe (Owner-approved fix 2026-10-05): the resolver, understand / evidence and the writer share
 * eligibleProject — a project completed AFTER the note was written is still a candidate for that note (the action that
 * handled the note must never make it unlinkable). A refusal SHOWS the server's exact list (Sunny never guesses it).
 */
import { normalizeName } from "../gateway/resolve";
import { findMentions, findPartialMentions, type MentionEntry } from "./inbox-mentions";
import { LIMITS, type LinkMethod } from "../../inbox-memory";

export interface ResolverProject { key: string; name: string; status: string | null; artistText: string | null; hidden: boolean | null;
  /** the completion stamp (projects.end_date — set only on a real transition into הושלם); null = none recorded */
  endDate?: string | null }
export type SurfaceResolution =
  | { status: "OK"; mentionName: string;
      /** keys a RESOLVER_UNIQUE link may name (one identity; several roles of the same identity) */
      direct: string[];
      /** the eligible projects of that identity (artist credit) — exactly one → also RESOLVER_UNIQUE; 2..8 → an Owner question */
      projects: string[];
      /** AMBIGUOUS name → these are the only candidates the Owner may choose from */
      ambiguous: string[];
      /** key → display name for every key above (so a refusal can show the server's list) */
      names?: Record<string, string> }
  | { status: "NOT_IN_TEXT" | "NO_ENTITY" | "SEVERAL_NAMES" | "TOO_MANY_CANDIDATES"; messageHe: string };

/**
 * The ONE candidate-project eligibility (resolver, understand / evidence and the writer): visible, not cancelled, and
 * either not completed, or completed AFTER the note's day (projects.end_date is stamped only on a real transition into
 * הושלם). Completed before the note, or completed with no recorded stamp → out (no invented timeline). noteYmd null =
 * today's view (a completed project is out).
 */
export function eligibleProject(p: Pick<ResolverProject, "status" | "hidden" | "endDate">, noteYmd: string | null): boolean {
  if (p.hidden === true || p.status === null || p.status === "בוטל") return false;
  if (p.status !== "הושלם") return true;
  return !!noteYmd && !!p.endDate && p.endDate.slice(0, 10) > noteYmd;
}
/** The eligible projects whose artist credit is exactly this (normalized) name — the ONE rule (resolver + understand). */
export function openCreditedProjects(normName: string, projects: readonly ResolverProject[], noteYmd: string | null = null): string[] {
  return projects.filter((p) => eligibleProject(p, noteYmd) && credits(p.artistText).includes(normName)).map((p) => p.key);
}
const credits = (artistText: string | null) => (artistText ?? "").split(/[,،;]/).map((x) => normalizeName(x)).filter(Boolean);

/**
 * Which entity does `surface` (a literal part of the Owner's text) name? Only partner_resolve's own index (through the
 * mention matcher: whole words, one Hebrew prefix letter, generic / short names AMBIGUOUS). One TEXT_MATCH identity →
 * its keys, plus its eligible projects by artist credit. Never a guess. noteYmd = the day the note was written (Israel).
 */
export function resolveSurface(body: string, surfaceRaw: string, index: readonly MentionEntry[], projects: readonly ResolverProject[], noteYmd: string | null = null): SurfaceResolution {
  const named = (keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, projects.find((p) => p.key === k)?.name ?? index.find((e) => e.key === k)?.name ?? k]));
  const surface = surfaceRaw.trim();
  if (surface.length < LIMITS.surface[0] || surface.length > LIMITS.surface[1] || !body.includes(surface)) return { status: "NOT_IN_TEXT", messageHe: "ה-surface חייב להיות חלק מילולי מהטקסט שכתבת (2–80 תווים)" };
  const ms = findMentions(surface, index);
  if (!ms.length) {
    // a first name only ("שליו") is never linked by itself: the Boss chooses among the records it can be + their eligible projects
    const ps = findPartialMentions(surface, index);
    if (ps.length !== 1) return ps.length ? { status: "SEVERAL_NAMES", messageHe: `"${surface}" מכיל כמה שמות — צריך surface עם שם אחד` } : { status: "NO_ENTITY", messageHe: `"${surface}" לא מזוהה כשם של ישות ב-Redbloods` };
    const pm = ps[0];
    const personNames = index.filter((e) => pm.keys.includes(e.key) && e.type !== "project").map((e) => e.norm);
    const all = [...new Set([...pm.keys, ...personNames.flatMap((n) => openCreditedProjects(n, projects, noteYmd))])].sort();
    if (all.length < LIMITS.candidates[0] || all.length > LIMITS.candidates[1]) return { status: "TOO_MANY_CANDIDATES", messageHe: `"${pm.name}" הוא שם חלקי ואין רשימה קצרה (2–8) לשאול עליה — לשאול את הבוס את השם המלא / הפרויקט (לא לסגור את הפתק כ'נדחה')` };
    return { status: "OK", mentionName: pm.name, direct: [], projects: [], ambiguous: all, names: named(all) };
  }
  if (new Set(ms.map((m) => normalizeName(m.name))).size > 1) return { status: "SEVERAL_NAMES", messageHe: `"${surface}" מכיל כמה שמות — צריך surface עם שם אחד` };
  const m = ms[0];
  const nm = normalizeName(m.name);
  const openCredited = () => openCreditedProjects(nm, projects, noteYmd);
  if (m.quality === "AMBIGUOUS") {
    // a short / generic / several-entity name is never linked by itself: the Owner chooses among the entities it names
    // AND the eligible projects credited to that name ("אצל טל" → the client טל or the song of טל) — a list of 2–8, else no question
    const all = [...new Set([...m.keys, ...openCredited()])].sort();
    if (all.length < LIMITS.candidates[0] || all.length > LIMITS.candidates[1]) return { status: "TOO_MANY_CANDIDATES", messageHe: `"${m.name}" לא חד-משמעי ואין רשימה קצרה (2–8) לשאול עליה — לשאול את הבוס במילים ולקשר לפי שם מלא (לא לסגור את הפתק כ'נדחה')` };
    return { status: "OK", mentionName: m.name, direct: [], projects: [], ambiguous: all, names: named(all) };
  }
  const direct = [...m.keys].sort();
  const own = direct.some((k) => k.startsWith("project:")) ? [] : openCredited().sort();
  if (own.length > LIMITS.candidates[1]) return { status: "OK", mentionName: m.name, direct, projects: [], ambiguous: [], names: named(direct) };
  return { status: "OK", mentionName: m.name, direct, projects: own, ambiguous: [], names: named([...direct, ...own]) };
}
export type LinkVerdict = { ok: true; method: LinkMethod; candidates: string[] | null } | { ok: false; code: string; messageHe: string };
/** May this entity be linked for this surface — and how? (the ONE server rule the writer applies) */
export function linkVerdict(r: SurfaceResolution, entityKey: string, method: LinkMethod, candidates: readonly string[] | null): LinkVerdict {
  if (r.status !== "OK") return { ok: false, code: r.status, messageHe: r.messageHe };
  const uniqueKeys = [...r.direct, ...(r.projects.length === 1 ? r.projects : [])];
  const question = r.ambiguous.length ? r.ambiguous : r.projects.length >= 2 ? r.projects : [];
  // the server's list, SHOWN — Sunny asks the Boss with it and passes it back exactly (never guessed)
  const listHe = question.length ? ` — המועמדים של השרת (להציג לבוס, ולהעביר בדיוק כ-candidates): ${question.map((k) => `${k} (${r.names?.[k] ?? k})`).join(" · ")}` : "";
  if (method === "RESOLVER_UNIQUE") {
    if (candidates && candidates.length) return { ok: false, code: "CANDIDATES_NOT_ALLOWED", messageHe: "קישור חד-משמעי לא נושא רשימת מועמדים" };
    return uniqueKeys.includes(entityKey) ? { ok: true, method, candidates: null } : { ok: false, code: question.includes(entityKey) ? "AMBIGUOUS_ASK_OWNER" : "NOT_RESOLVED", messageHe: question.includes(entityKey) ? `"${r.mentionName}" לא חד-משמעי — צריך לשאול את הבוס (OWNER_ANSWER)${listHe}` : `"${r.mentionName}" לא מוביל לישות הזו${listHe}` };
  }
  const given = [...new Set(candidates ?? [])].sort();
  if (!question.length) return { ok: false, code: "NO_QUESTION", messageHe: `"${r.mentionName}" חד-משמעי — אין שאלה לבוס` };
  if (given.join("|") !== question.join("|")) return { ok: false, code: "CANDIDATES_MISMATCH", messageHe: `רשימת המועמדים חייבת להיות בדיוק הרשימה שהשרת מחשב לשם הזה${listHe}` };
  return question.includes(entityKey) ? { ok: true, method, candidates: question } : { ok: false, code: "NOT_A_CANDIDATE", messageHe: `הבחירה חייבת להיות אחת מהמועמדים — ישות שלא קשורה לשם שבפתק לא מתקשרת${listHe}` };
}
