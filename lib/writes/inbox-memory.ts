/**
 * Owner Inbox MEMORY — the ONE writer (Phase 1, Owner decision + approved SQL 2026-10-01). Every write to
 * sunny_inbox_links / sunny_inbox_interpretations goes through here (Sunny's four typed primitives); nothing else calls
 * the four RPCs (a source test pins it). It writes ONLY Sunny's memory about the Owner's updates — never a business
 * record: no status, task, deadline, finance, proposal, release, alert or push.
 *
 * Option A (Owner-approved): the DB enforces structure, the key contract, existence, "the surface is in the text",
 * candidate membership, the head chain and idempotency. THIS writer enforces what the DB does not claim:
 *   - the resolver: a link names exactly the entity partner_resolve's index gives for that surface (lib/inbox-memory
 *     resolveSurface / linkVerdict) — a RESOLVER_UNIQUE link only for a unique result; OWNER_ANSWER only with EXACTLY the
 *     server-computed candidate list (the Boss chooses; no free entity);
 *   - the basis of an interpretation: computed HERE from the live project view (never sent by Sunny).
 * Each call uses a fresh request key (the Action Layer runs a step at most once); a retry of the same call replays.
 */
import { randomUUID } from "node:crypto";
import { LINK_KEY_RE, LIMITS, PROJECT_KEY_RE, BALL_WITH, CONFIDENCE, SUPERSEDE_KINDS, activeLinksOf, headOf, parseListText, type InboxMemory, type LinkMethod, type ProjectBasis } from "../inbox-memory";
import { linkVerdict, resolveSurface, type ResolverProject } from "../partner/knowledge/inbox-resolver";
import type { MentionEntry } from "../partner/knowledge/inbox-mentions";
import type { InboxMemoryStore, MemoryWrite } from "../inbox-memory-store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export type MemoryWriteResult = { status: "OK"; id: string; replayed: boolean } | { status: "REFUSED"; code: string; messageHe: string } | { status: "FAILED"; messageHe: string };

export interface InboxMemoryDeps {
  store: InboxMemoryStore;
  readItem(id: string): Promise<{ body: string; status: string; createdAt?: string | null } | null>;
  readMemory(): Promise<InboxMemory>;
  /** partner_resolve's name index + the projects (for the artist → open projects rule), from the live company state. */
  resolverContext(): Promise<{ index: readonly MentionEntry[]; projects: readonly ResolverProject[] }>;
  /** The live canonical basis of a project (lib/partner/projects/memory projectBasisOf); null = not readable / not found. */
  projectBasis(projectId: string): Promise<ProjectBasis | null>;
}

const refused = (code: string, messageHe: string): MemoryWriteResult => ({ status: "REFUSED", code, messageHe });
function fromWrite(r: MemoryWrite<{ id: string; replayed: boolean }>): MemoryWriteResult {
  if (r.status === "OK") return { status: "OK", id: r.value.id, replayed: r.value.replayed };
  if (r.status === "REFUSED") return refused(r.code, `בסיס הנתונים דחה: ${r.detail}`);
  return { status: "FAILED", messageHe: `השמירה נכשלה — שום דבר לא נשמר (${r.detail})` };
}
const reasonOf = (v: unknown) => (typeof v === "string" && v.trim().length >= 1 && v.trim().length <= LIMITS.reason ? v.trim() : null);

/** The resolver check a link must pass (shared by the primitive's plan and the write — ONE rule). */
export async function checkLink(deps: InboxMemoryDeps, a: { itemId: string; entityKey: string; method: LinkMethod; surface: string; candidates: string[] | null }) {
  const item = await deps.readItem(a.itemId);
  if (!item) return { ok: false as const, code: "ITEM_NOT_FOUND", messageHe: "לא מצאתי את העדכון" };
  if (!LINK_KEY_RE.test(a.entityKey)) return { ok: false as const, code: "BAD_ENTITY_KEY", messageHe: "מפתח ישות לא לפי החוזה (project / client / label-artist / dj / show / session / release / vendor)" };
  const ctx = await deps.resolverContext();
  // the note's day (Israel): a project completed AFTER it is still a candidate (the ONE eligibility, inbox-resolver)
  const noteYmd = item.createdAt ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(item.createdAt)) : null;
  const r = resolveSurface(item.body, a.surface, ctx.index, ctx.projects, noteYmd);
  return { ...linkVerdict(r, a.entityKey, a.method, a.candidates), resolution: r };
}

export async function linkInboxEntity(deps: InboxMemoryDeps, a: { itemId: string; entityKey: string; method: LinkMethod; surface: string; candidates: string[] | null }): Promise<MemoryWriteResult> {
  if (!UUID.test(a.itemId)) return refused("BAD_ITEM", "מזהה עדכון לא תקין");
  const v = await checkLink(deps, a);
  if (!v.ok) return refused(v.code, v.messageHe);
  const mem = await deps.readMemory();
  if (activeLinksOf(mem.links, (l) => l.itemId === a.itemId && l.entityKey === a.entityKey).length) return refused("ALREADY_LINKED", "העדכון כבר מקושר לישות הזו");
  return fromWrite(await deps.store.linkEntity({ itemId: a.itemId, entityKey: a.entityKey, method: v.method, surface: a.surface.trim(), candidates: v.candidates, requestKey: randomUUID() }));
}

export interface InterpretationInput {
  itemId: string; projectKey: string; whatHappened: unknown; completed: unknown; openGaps: unknown; blockers: unknown;
  ballWith: unknown; inferredNextStep: unknown; confidence: unknown; supersedeKind: unknown; supersedeReason: unknown;
  /** the head the preview showed (null = none) — the DB refuses HEAD_CHANGED when it moved */
  expectedHeadId: string | null;
}
export type CheckedInterpretation = {
  whatHappened: string; completed: string[]; openGaps: string[]; blockers: string[]; ballWith: string; inferredNextStep: string | null; confidence: string;
  supersedeKind: string | null; supersedeReason: string | null;
};
/** Field validation (the DB limits, stated once for the preview and the write). */
export function checkInterpretation(a: Omit<InterpretationInput, "itemId" | "projectKey" | "expectedHeadId">, hasHead: boolean): { ok: true; value: CheckedInterpretation } | { ok: false; code: string; messageHe: string } {
  const what = typeof a.whatHappened === "string" ? a.whatHappened.trim() : "";
  if (!what || what.length > LIMITS.whatHappened) return { ok: false, code: "BAD_TEXT", messageHe: `whatHappened חסר או ארוך מ-${LIMITS.whatHappened} תווים` };
  const lists = [parseListText(a.completed, "completed"), parseListText(a.openGaps, "openGaps"), parseListText(a.blockers, "blockers")];
  const bad = lists.find((l) => !l.ok);
  if (bad && !bad.ok) return { ok: false, code: "BAD_LIST", messageHe: bad.messageHe };
  const [completed, openGaps, blockers] = lists.map((l) => (l.ok ? l.items : []));
  const ball = a.ballWith === undefined || a.ballWith === null || a.ballWith === "" ? "UNKNOWN" : a.ballWith;
  if (!(BALL_WITH as readonly unknown[]).includes(ball)) return { ok: false, code: "BAD_ENUM", messageHe: "ballWith לא מוכר" };
  if (!(CONFIDENCE as readonly unknown[]).includes(a.confidence)) return { ok: false, code: "BAD_ENUM", messageHe: "confidence חייב להיות LOW / MEDIUM / HIGH" };
  const next = typeof a.inferredNextStep === "string" && a.inferredNextStep.trim() ? a.inferredNextStep.trim() : null;
  if (a.inferredNextStep !== undefined && a.inferredNextStep !== null && a.inferredNextStep !== "" && typeof a.inferredNextStep !== "string") return { ok: false, code: "BAD_TEXT", messageHe: "inferredNextStep חייב להיות טקסט" };
  if (next && next.length > LIMITS.nextStep) return { ok: false, code: "BAD_TEXT", messageHe: `inferredNextStep עד ${LIMITS.nextStep} תווים` };
  const kind = a.supersedeKind === undefined || a.supersedeKind === null || a.supersedeKind === "" ? null : a.supersedeKind;
  const reason = a.supersedeReason === undefined || a.supersedeReason === null || a.supersedeReason === "" ? null : reasonOf(a.supersedeReason);
  if (a.supersedeReason !== undefined && a.supersedeReason !== null && a.supersedeReason !== "" && reason === null) return { ok: false, code: "BAD_REASON", messageHe: `supersedeReason עד ${LIMITS.reason} תווים` };
  if (hasHead) {
    if (!(SUPERSEDE_KINDS as readonly unknown[]).includes(kind)) return { ok: false, code: "SUPERSEDE_KIND_REQUIRED", messageHe: "כבר יש הבנה נוכחית לפרויקט — צריך supersedeKind: NEW_UPDATE (עדכון חדש) או CORRECTION (תיקון)" };
    if (kind === "CORRECTION" && !reason) return { ok: false, code: "REASON_REQUIRED", messageHe: "תיקון (CORRECTION) מחייב supersedeReason" };
  } else if (kind !== null || reason !== null) return { ok: false, code: "NOTHING_TO_SUPERSEDE", messageHe: "אין עדיין הבנה לפרויקט הזה — בלי supersedeKind / supersedeReason" };
  return { ok: true, value: { whatHappened: what, completed, openGaps, blockers, ballWith: String(ball), inferredNextStep: next, confidence: String(a.confidence), supersedeKind: kind === null ? null : String(kind), supersedeReason: reason } };
}

export async function recordInboxInterpretation(deps: InboxMemoryDeps, a: InterpretationInput): Promise<MemoryWriteResult> {
  if (!UUID.test(a.itemId)) return refused("BAD_ITEM", "מזהה עדכון לא תקין");
  if (!PROJECT_KEY_RE.test(a.projectKey)) return refused("NOT_A_PROJECT", "הבנה נשמרת רק לפרויקט (project:…) ב-Phase 1");
  const mem = await deps.readMemory();
  const link = activeLinksOf(mem.links, (l) => l.itemId === a.itemId && l.entityKey === a.projectKey)[0];
  if (!link) return refused("NO_LINK", "העדכון לא מקושר לפרויקט הזה — קודם LINK_INBOX_ENTITY");
  const head = headOf(mem.interpretations, a.projectKey);
  if ((head?.id ?? null) !== a.expectedHeadId) return refused("HEAD_CHANGED", "ההבנה הנוכחית של הפרויקט השתנתה מאז ה-preview");
  const c = checkInterpretation(a, !!head);
  if (!c.ok) return refused(c.code, c.messageHe);
  // the basis is computed HERE from the live records (Sunny never sends it); unreadable → nothing is written
  const basis = await deps.projectBasis(a.projectKey.slice("project:".length));
  if (!basis) return refused("BASIS_UNAVAILABLE", "מצב הפרויקט ברשומות לא נקרא — לא שומר הבנה בלי בסיס קנוני");
  return fromWrite(await deps.store.recordInterpretation({
    linkId: link.id, requestKey: randomUUID(), ...c.value,
    basisStatus: basis.status, basisBall: basis.ball, basisEventAt: basis.lastEventAt,
    supersedesId: head?.id ?? null, supersedeKind: head ? c.value.supersedeKind : null, supersedeReason: head ? c.value.supersedeReason : null,
  }));
}

export async function retractInboxLink(deps: InboxMemoryDeps, a: { linkId: string; reason: unknown }): Promise<MemoryWriteResult> {
  const reason = reasonOf(a.reason);
  if (!UUID.test(a.linkId)) return refused("BAD_LINK", "מזהה קישור לא תקין");
  if (!reason) return refused("REASON_REQUIRED", `צריך סיבה (1–${LIMITS.reason} תווים)`);
  return fromWrite(await deps.store.retractLink(a.linkId, reason));
}
export async function retractInboxInterpretation(deps: InboxMemoryDeps, a: { interpretationId: string; reason: unknown }): Promise<MemoryWriteResult> {
  const reason = reasonOf(a.reason);
  if (!UUID.test(a.interpretationId)) return refused("BAD_INTERPRETATION", "מזהה הבנה לא תקין");
  if (!reason) return refused("REASON_REQUIRED", `צריך סיבה (1–${LIMITS.reason} תווים)`);
  return fromWrite(await deps.store.retractInterpretation(a.interpretationId, reason));
}
