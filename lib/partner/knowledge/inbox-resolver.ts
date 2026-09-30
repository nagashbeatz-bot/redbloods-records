/**
 * Owner Inbox MEMORY — the server resolver for a link (Option A, Owner-approved 2026-10-01): which entity a literal part
 * of the Owner's text names. Enforced in lib/writes/inbox-memory.ts; the DB never claims it. Pure. Names come ONLY from
 * partner_resolve's own index through the mention matcher (whole words, one Hebrew prefix letter, generic / short names
 * AMBIGUOUS) — never a guess.
 */
import { normalizeName } from "../gateway/resolve";
import { findMentions, type MentionEntry } from "./inbox-mentions";
import { NOT_OVERDUE_STATUSES } from "../../project-deadline";
import { LIMITS, type LinkMethod } from "../../inbox-memory";

export interface ResolverProject { key: string; name: string; status: string | null; artistText: string | null; hidden: boolean | null }
export type SurfaceResolution =
  | { status: "OK"; mentionName: string;
      /** keys a RESOLVER_UNIQUE link may name (one identity; several roles of the same identity) */
      direct: string[];
      /** the open projects of that identity (artist credit) — exactly one → also RESOLVER_UNIQUE; 2..8 → an Owner question */
      projects: string[];
      /** AMBIGUOUS name → these are the only candidates the Owner may choose from */
      ambiguous: string[] }
  | { status: "NOT_IN_TEXT" | "NO_ENTITY" | "SEVERAL_NAMES" | "TOO_MANY_CANDIDATES"; messageHe: string };
const INACTIVE = new Set<string>(NOT_OVERDUE_STATUSES);
/** The OPEN, visible projects whose artist credit is exactly this (normalized) name — the ONE rule (resolver + understand). */
export function openCreditedProjects(normName: string, projects: readonly ResolverProject[]): string[] {
  return projects.filter((p) => p.status !== null && !INACTIVE.has(p.status) && p.hidden !== true && credits(p.artistText).includes(normName)).map((p) => p.key);
}
const credits = (artistText: string | null) => (artistText ?? "").split(/[,،;]/).map((x) => normalizeName(x)).filter(Boolean);

/**
 * Which entity does `surface` (a literal part of the Owner's text) name? Only partner_resolve's own index (through the
 * mention matcher: whole words, one Hebrew prefix letter, generic / short names AMBIGUOUS). One TEXT_MATCH identity →
 * its keys, plus its OPEN, visible projects by artist credit. Never a guess.
 */
export function resolveSurface(body: string, surfaceRaw: string, index: readonly MentionEntry[], projects: readonly ResolverProject[]): SurfaceResolution {
  const surface = surfaceRaw.trim();
  if (surface.length < LIMITS.surface[0] || surface.length > LIMITS.surface[1] || !body.includes(surface)) return { status: "NOT_IN_TEXT", messageHe: "ה-surface חייב להיות חלק מילולי מהטקסט שכתבת (2–80 תווים)" };
  const ms = findMentions(surface, index);
  if (!ms.length) return { status: "NO_ENTITY", messageHe: `"${surface}" לא מזוהה כשם של ישות ב-Redbloods` };
  if (new Set(ms.map((m) => normalizeName(m.name))).size > 1) return { status: "SEVERAL_NAMES", messageHe: `"${surface}" מכיל כמה שמות — צריך surface עם שם אחד` };
  const m = ms[0];
  const nm = normalizeName(m.name);
  const openCredited = () => openCreditedProjects(nm, projects);
  if (m.quality === "AMBIGUOUS") {
    // a short / generic / several-entity name is never linked by itself: the Owner chooses among the entities it names
    // AND the open projects credited to that name ("אצל טל" → the client טל or the song of טל) — a list of 2–8, else no question
    const all = [...new Set([...m.keys, ...openCredited()])].sort();
    if (all.length < LIMITS.candidates[0] || all.length > LIMITS.candidates[1]) return { status: "TOO_MANY_CANDIDATES", messageHe: `"${m.name}" לא חד-משמעי ואין רשימה קצרה (2–8) לשאול עליה — צריך לשאול את הבוס במילים ולקשר לפי שם מלא` };
    return { status: "OK", mentionName: m.name, direct: [], projects: [], ambiguous: all };
  }
  const direct = [...m.keys].sort();
  const own = direct.some((k) => k.startsWith("project:")) ? [] : openCredited().sort();
  if (own.length > LIMITS.candidates[1]) return { status: "OK", mentionName: m.name, direct, projects: [], ambiguous: [] };
  return { status: "OK", mentionName: m.name, direct, projects: own, ambiguous: [] };
}
export type LinkVerdict = { ok: true; method: LinkMethod; candidates: string[] | null } | { ok: false; code: string; messageHe: string };
/** May this entity be linked for this surface — and how? (the ONE server rule the writer applies) */
export function linkVerdict(r: SurfaceResolution, entityKey: string, method: LinkMethod, candidates: readonly string[] | null): LinkVerdict {
  if (r.status !== "OK") return { ok: false, code: r.status, messageHe: r.messageHe };
  const uniqueKeys = [...r.direct, ...(r.projects.length === 1 ? r.projects : [])];
  const question = r.ambiguous.length ? r.ambiguous : r.projects.length >= 2 ? r.projects : [];
  if (method === "RESOLVER_UNIQUE") {
    if (candidates && candidates.length) return { ok: false, code: "CANDIDATES_NOT_ALLOWED", messageHe: "קישור חד-משמעי לא נושא רשימת מועמדים" };
    return uniqueKeys.includes(entityKey) ? { ok: true, method, candidates: null } : { ok: false, code: question.includes(entityKey) ? "AMBIGUOUS_ASK_OWNER" : "NOT_RESOLVED", messageHe: question.includes(entityKey) ? `"${r.mentionName}" לא חד-משמעי — צריך לשאול את הבוס (OWNER_ANSWER)` : `"${r.mentionName}" לא מוביל לישות הזו` };
  }
  const given = [...new Set(candidates ?? [])].sort();
  if (!question.length) return { ok: false, code: "NO_QUESTION", messageHe: `"${r.mentionName}" חד-משמעי — אין שאלה לבוס` };
  if (given.join("|") !== question.join("|")) return { ok: false, code: "CANDIDATES_MISMATCH", messageHe: "רשימת המועמדים חייבת להיות בדיוק הרשימה שהשרת מחשב לשם הזה" };
  return question.includes(entityKey) ? { ok: true, method, candidates: question } : { ok: false, code: "NOT_A_CANDIDATE", messageHe: "הבחירה חייבת להיות אחת מהמועמדים" };
}
