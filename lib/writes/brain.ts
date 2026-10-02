/**
 * Sunny Brain v1 + T2 — the ONE writer. Sunny (connector, service role) and the Owner's dashboard (Owner session) call
 * these functions; nothing else calls the Brain write methods of lib/brain-store.ts.
 *
 *   Sunny (service role, under a LIVE tracking authorization the DB re-checks on every write):
 *     registerContent · recordObservations · createRecord (INSIGHT / RECOMMENDATION) · transition (her own moves) · addLinks
 *   Sunny asks the Owner (no effect until he decides in Redbloods):
 *     requestTrackingAuthorization · requestOwnerObservations · cancelRequest (her own pending request)
 *   The Owner (his own Supabase session — the DB proves auth.uid() ∈ owner_approval_principals; service_role cannot):
 *     ownerDecide · ownerRevoke · ownerTransition
 *   The Owner from the chat (his LIVE connector token — the DB proves the Owner from its hash; service role alone cannot):
 *     ownerDecideFromChat (APPROVED as requested / REJECTED — never a narrowing)
 *
 * Fail closed: an RPC that does not exist yet (migration not applied) → NOT_INSTALLED, never success. A refusal keeps the
 * DB's code. Nothing here approves, grants or forges an Owner identity; there is no generic SQL / table / RPC argument.
 */
import { randomUUID } from "node:crypto";
import { createBrainOwnerStore, createBrainOwnerTokenStore, createBrainServiceStore, type BrainRpcClient, type BrainWrite } from "@/lib/brain-store";
import {
  buildTrackingPayload, checkContent, checkIntel, checkLinks, checkObservationBatch, checkTransition, ownerObservationsSummaryHe, trackingSummaryHe,
} from "@/lib/partner/brain/requests";
import { UUID_RE } from "@/lib/partner/brain/vocab";

export type BrainResult =
  | { status: "OK"; requestKey?: string; result: Record<string, unknown>; messageHe: string }
  | { status: "INVALID"; errors: string[]; messageHe: string }
  | { status: "REFUSED"; code: string; detail: string; messageHe: string }
  | { status: "NOT_INSTALLED"; messageHe: string }
  | { status: "FAILED"; messageHe: string };

const CODE_HE: Record<string, string> = {
  AUTHORIZATION_REQUIRED: "אין הרשאת מעקב — צריך לבקש מהבוס הרשאה (בקשה ב-Redbloods).",
  AUTHORIZATION_NOT_FOUND: "ההרשאה לא קיימת.", AUTHORIZATION_NOT_ACTIVE: "ההרשאה בוטלה או הוחלפה — אין רישום תחתיה.",
  AUTHORIZATION_OUT_OF_WINDOW: "ההרשאה לא בתוקף היום.", AUTHORIZATION_DAILY_CAP: "הגעתי לתקרת המדידות היומית של ההרשאה (יום ישראלי).",
  OUTSIDE_AUTHORIZATION: "מחוץ למה שההרשאה מכסה.", OUTSIDE_AUTHORIZATION_SUBJECT: "הנושא לא מכוסה בהרשאה.",
  OUTSIDE_AUTHORIZATION_FAMILY: "סוג המדידה לא מכוסה בהרשאה.", OUTSIDE_AUTHORIZATION_SOURCE: "מקור הקריאה לא מכוסה בהרשאה.",
  INSIGHTS_NOT_AUTHORIZED: "ההרשאה לא מתירה תובנות.", RECOMMENDATIONS_NOT_AUTHORIZED: "ההרשאה לא מתירה המלצות.", TYPE_NOT_AUTHORIZED: "ההרשאה לא מתירה את הסוג הזה.",
  NEEDS_OWNER_APPROVAL: "זה ערך / מקור שהבוס מסר — רק הוא משנה אותו.", INSIGHT_NEEDS_EVIDENCE: "תובנה בלי ראיה לא נרשמת.",
  RECOMMENDATION_NEEDS_GROUNDING: "המלצה צריכה בסיס (תובנה או ראיה).", LINK_TO_OWNER_MEMORY_RESERVED: "אין קישור שמסתיים בזיכרון של הבוס (v1).",
  ILLEGAL_TRANSITION: "המעבר הזה לא מותר.", USE_OWNER_REVOKE: "רק הבוס מבטל הרשאה — ב-Redbloods.", OWNER_SESSION_REQUIRED: "רק הבוס, מחובר בעצמו ל-Redbloods, יכול לעשות את זה.",
  SEEN_HASH_MISMATCH: "הבקשה השתנתה מאז שהוצגה — רענן ואשר שוב.", ALREADY_DECIDED: "כבר הוחלט על הבקשה.", REQUEST_EXPIRED: "פג תוקף הבקשה.",
  NOT_NARROWING: "אישור יכול רק לצמצם את הבקשה, לא להרחיב.", STALE_BASE: "ההרשאה שהבקשה מחליפה כבר השתנתה — צריך בקשה חדשה.",
  BACKDATED_AUTHORIZATION: "תאריך ההתחלה כבר עבר — אשר מהיום.", REQUEST_KEY_REUSED: "מפתח הבקשה כבר שימש לתוכן אחר.",
  OWNER_TOKEN_REQUIRED: "אין הוכחה שהבוס עצמו מחובר — לא הוחלט כלום.", OWNER_TOKEN_INVALID: "החיבור של Claude לא בתוקף (פג / בוטל) — צריך להתחבר מחדש. לא הוחלט כלום.",
  OWNER_TOKEN_SCOPE: "החיבור לא כולל את הרשאת המוח (partner:observe) — לא הוחלט כלום.", REQUEST_NOT_FOUND: "הבקשה לא נמצאה.",
  RESOURCE_NOT_ACTIVE: "המקור הוצא משימוש.", ENTITY_NOT_FOUND: "הישות לא נמצאה ב-Redbloods.", REASON_REQUIRED: "צריך סיבה.",
};
const heOf = (code: string) => CODE_HE[code] ?? "הכתיבה נדחתה.";
const NOT_INSTALLED_HE = "המוח של סאני עוד לא מותקן במסד הנתונים (המיגרציה לא הוחלה) — שום דבר לא נרשם.";

function fromWrite(w: BrainWrite, okHe: string, requestKey?: string): BrainResult {
  switch (w.status) {
    case "OK": return { status: "OK", ...(requestKey ? { requestKey } : {}), result: w.value, messageHe: okHe };
    case "REFUSED": return { status: "REFUSED", code: w.code, detail: w.detail, messageHe: heOf(w.code) };
    case "NOT_INSTALLED": return { status: "NOT_INSTALLED", messageHe: NOT_INSTALLED_HE };
    default: return { status: "FAILED", messageHe: "הכתיבה נכשלה — שום דבר לא דווח כבוצע. אבדוק את המצב לפני שאגיד משהו." };
  }
}
const invalid = (errors: string[]): BrainResult => ({ status: "INVALID", errors: errors.slice(0, 30), messageHe: "הבקשה לא תקינה — לא נשלח כלום." });
const isId = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
function keyOf(v: unknown): { ok: true; key: string } | { ok: false } {
  if (v === undefined || v === null) return { ok: true, key: randomUUID() };
  return isId(v) ? { ok: true, key: v } : { ok: false };
}

export interface SunnyBrainContext { client: BrainRpcClient; todayIL: string; nowIso: string; clientId: string | null; labelOf?: (entityKey: string) => string }

// ───────────────────────────── Sunny asks the Owner (T2 requests: no effect) ─────────────────────────────

export async function requestTrackingAuthorization(ctx: SunnyBrainContext, input: { authorization: unknown; expiresInDays?: unknown; requestKey?: unknown }): Promise<BrainResult> {
  const k = keyOf(input.requestKey); if (!k.ok) return invalid(["requestKey: uuid"]);
  const p = await buildTrackingPayload(input.authorization, ctx.todayIL);
  if (!p.ok) return invalid(p.errors);
  const days = input.expiresInDays === undefined ? 14 : input.expiresInDays;
  if (!(typeof days === "number" && Number.isInteger(days) && days >= 1 && days <= 60)) return invalid(["expiresInDays: 1–60 (how long the request waits for the Owner)"]);
  const { summaryHe, riskHe } = trackingSummaryHe(p.value, ctx.labelOf);
  const expiresAt = new Date(Date.parse(ctx.nowIso) + days * 86_400_000).toISOString();
  const w = await createBrainServiceStore(ctx.client).requestApproval({ kind: "TRACKING_AUTHORIZATION", payload: p.value, summaryHe, riskHe, requestedClient: ctx.clientId, expiresAt, requestKey: k.key });
  return fromWrite(w, "הבקשה נשלחה לבוס. היא תחכה לאישור שלו ב-Redbloods (מסך אישורים) — עד שהוא מאשר אין הרשאה.", k.key);
}

export async function requestOwnerObservations(ctx: SunnyBrainContext, input: { items: unknown; requestKey?: unknown }): Promise<BrainResult> {
  const k = keyOf(input.requestKey); if (!k.ok) return invalid(["requestKey: uuid"]);
  const b = checkObservationBatch(input.items, "OWNER", ctx.nowIso);
  if (!b.ok) return invalid(b.errors);
  const { summaryHe, riskHe } = ownerObservationsSummaryHe(b.value, ctx.labelOf);
  const expiresAt = new Date(Date.parse(ctx.nowIso) + 14 * 86_400_000).toISOString();
  const w = await createBrainServiceStore(ctx.client).requestApproval({ kind: "OWNER_OBSERVATIONS", payload: { items: b.value }, summaryHe, riskHe, requestedClient: ctx.clientId, expiresAt, requestKey: k.key });
  return fromWrite(w, "הערכים נשלחו לבוס לאישור ב-Redbloods — הם לא נרשמים עד שהוא מאשר.", k.key);
}

export async function cancelRequest(ctx: SunnyBrainContext, input: { requestId: unknown; reasonHe?: unknown }): Promise<BrainResult> {
  if (!isId(input.requestId)) return invalid(["requestId: uuid"]);
  if (input.reasonHe !== undefined && !(typeof input.reasonHe === "string" && input.reasonHe.trim().length >= 1 && input.reasonHe.length <= 300)) return invalid(["reasonHe: 1–300 characters"]);
  const w = await createBrainServiceStore(ctx.client).cancelApproval({ requestId: input.requestId, reasonHe: (input.reasonHe as string | undefined)?.trim() ?? null });
  return fromWrite(w, "הבקשה בוטלה (ביטול לא מעניק כלום).");
}

// ───────────────────────────── Sunny under a live authorization ─────────────────────────────

export async function registerContent(ctx: SunnyBrainContext, input: { authorizationId: unknown; content: unknown; requestKey?: unknown }): Promise<BrainResult> {
  const k = keyOf(input.requestKey); if (!k.ok) return invalid(["requestKey: uuid"]);
  if (!isId(input.authorizationId)) return invalid(["authorizationId: the tracking authorization (uuid)"]);
  const c = checkContent(input.content);
  if (!c.ok) return invalid(c.errors);
  const w = await createBrainServiceStore(ctx.client).registerContent({ ...c.value, authorizationId: input.authorizationId, requestKey: k.key });
  return fromWrite(w, "התוכן נרשם כמקור (תחת ההרשאה).", k.key);
}

export async function recordObservations(ctx: SunnyBrainContext, input: { authorizationId: unknown; items: unknown; batchId?: unknown; requestKey?: unknown }): Promise<BrainResult> {
  const k = keyOf(input.requestKey); if (!k.ok) return invalid(["requestKey: uuid"]);
  if (!isId(input.authorizationId)) return invalid(["authorizationId: the tracking authorization (uuid)"]);
  if (input.batchId !== undefined && !isId(input.batchId)) return invalid(["batchId: uuid"]);
  const b = checkObservationBatch(input.items, "SUNNY", ctx.nowIso);
  if (!b.ok) return invalid(b.errors);
  const w = await createBrainServiceStore(ctx.client).recordObservations({ batchId: (input.batchId as string | undefined) ?? k.key, items: b.value, authorizationId: input.authorizationId, requestKey: k.key });
  return fromWrite(w, `נרשמו ${b.value.length} מדידות (מדידה — לא מסקנה).`, k.key);
}

export async function createRecord(ctx: SunnyBrainContext, input: { authorizationId: unknown; record: unknown; requestKey?: unknown }): Promise<BrainResult> {
  const k = keyOf(input.requestKey); if (!k.ok) return invalid(["requestKey: uuid"]);
  if (!isId(input.authorizationId)) return invalid(["authorizationId: the tracking authorization (uuid)"]);
  const r = checkIntel(input.record);
  if (!r.ok) return invalid(r.errors);
  const v = r.value;
  const w = await createBrainServiceStore(ctx.client).createIntelRecord({
    recordType: v.recordType, entityKeys: v.entityKeys ?? [], resourceIds: v.resourceIds ?? [], topic: v.topic ?? null, area: v.area, titleHe: v.titleHe, body: v.body,
    confidence: v.confidence, reviewAt: v.reviewAt ?? null, supersedesId: v.supersedesId ?? null, supersedeReason: v.supersedeReason ?? null, links: v.links,
    authorizationId: input.authorizationId, requestKey: k.key,
  });
  return fromWrite(w, v.recordType === "INSIGHT" ? "התובנה נרשמה (השערה של סאני — לא עובדה, עד שהבוס מאשר)." : "ההמלצה נרשמה — היא לא מבצעת כלום; פעולה תמיד דורשת אישור נפרד.", k.key);
}

export async function transition(ctx: SunnyBrainContext, input: { authorizationId: unknown; transition: unknown; requestKey?: unknown }): Promise<BrainResult> {
  const k = keyOf(input.requestKey); if (!k.ok) return invalid(["requestKey: uuid"]);
  if (!isId(input.authorizationId)) return invalid(["authorizationId: the tracking authorization (uuid)"]);
  const t = checkTransition(input.transition, "SUNNY");
  if (!t.ok) return invalid(t.errors);
  const w = await createBrainServiceStore(ctx.client).transition({ ...t.value, authorizationId: input.authorizationId, requestKey: k.key });
  return fromWrite(w, "הסטטוס עודכן.", k.key);
}

export async function addLinks(ctx: SunnyBrainContext, input: { authorizationId: unknown; links: unknown; requestKey?: unknown }): Promise<BrainResult> {
  const k = keyOf(input.requestKey); if (!k.ok) return invalid(["requestKey: uuid"]);
  if (!isId(input.authorizationId)) return invalid(["authorizationId: the tracking authorization (uuid)"]);
  const l = checkLinks(input.links, false);
  if (!l.ok) return invalid(l.errors);
  if (!l.value.length) return invalid(["links: at least one"]);
  const w = await createBrainServiceStore(ctx.client).addLinks({ links: l.value, authorizationId: input.authorizationId, requestKey: k.key });
  return fromWrite(w, "הקישורים נרשמו.", k.key);
}

// ───────────────────────────── the Owner (his own session) ─────────────────────────────

/**
 * The Owner decides a T2 request. `sessionClient` MUST be the Owner's own Supabase session (cookies → his JWT); the DB
 * re-proves him. A pending authorization whose validFrom already passed is narrowed to start today (a narrowing — the
 * DB refuses anything wider); the Owner sees that in the dashboard before approving.
 */
export async function ownerDecide(sessionClient: BrainRpcClient, input: { requestId: unknown; decision: unknown; seenHash: unknown; reasonHe?: unknown; startToday?: { payload: Record<string, unknown>; todayIL: string } | null }): Promise<BrainResult> {
  if (!isId(input.requestId)) return invalid(["requestId: uuid"]);
  if (input.decision !== "APPROVED" && input.decision !== "REJECTED") return invalid(["decision: APPROVED | REJECTED"]);
  if (!(typeof input.seenHash === "string" && /^[0-9a-f]{64}$/.test(input.seenHash))) return invalid(["seenHash: the hash that was shown"]);
  const reason = typeof input.reasonHe === "string" && input.reasonHe.trim() ? input.reasonHe.trim().slice(0, 300) : null;
  let approved: Record<string, unknown> | null = null;
  const s = input.startToday;
  if (input.decision === "APPROVED" && s && typeof s.payload.validFrom === "string" && s.payload.validFrom < s.todayIL) {
    if (typeof s.payload.validUntil === "string" && s.payload.validUntil < s.todayIL) return { status: "REFUSED", code: "REQUEST_EXPIRED", detail: "validUntil passed", messageHe: "תקופת ההרשאה המבוקשת כבר עברה — אפשר רק לדחות." };
    approved = { ...s.payload, validFrom: s.todayIL };
  }
  const w = await createBrainOwnerStore(sessionClient).decide({ requestId: input.requestId, decision: input.decision, seenHash: input.seenHash, approved, reasonHe: reason });
  return fromWrite(w, input.decision === "APPROVED" ? "אושר." : "נדחה.");
}

/**
 * The Owner decides a T2 request FROM THE CHAT. `client` is the connector's service client — it has no power of its own
 * here: owner_approval_decide_mcp proves the Owner in the DB from `tokenHash` (his live connector token). The caller
 * (lib/partner/brain/server.ts) has already checked the presentation + the Owner's words; APPROVED = exactly as requested.
 */
export async function ownerDecideFromChat(client: BrainRpcClient, input: { tokenHash: unknown; requestId: unknown; decision: unknown; seenHash: unknown; reasonHe?: unknown }): Promise<BrainResult> {
  if (!(typeof input.tokenHash === "string" && /^[0-9a-f]{64}$/.test(input.tokenHash))) return { status: "REFUSED", code: "OWNER_TOKEN_REQUIRED", detail: "no token hash", messageHe: heOf("OWNER_TOKEN_REQUIRED") };
  if (!isId(input.requestId)) return invalid(["requestId: uuid"]);
  if (input.decision !== "APPROVED" && input.decision !== "REJECTED") return invalid(["decision: APPROVED | REJECTED"]);
  if (!(typeof input.seenHash === "string" && /^[0-9a-f]{64}$/.test(input.seenHash))) return invalid(["seenHash: the hash that was shown"]);
  const reason = typeof input.reasonHe === "string" && input.reasonHe.trim() ? input.reasonHe.trim().slice(0, 300) : null;
  const w = await createBrainOwnerTokenStore(client).decide({ tokenHash: input.tokenHash, requestId: input.requestId, decision: input.decision, seenHash: input.seenHash, reasonHe: reason });
  if (w.status === "NOT_INSTALLED") return { status: "NOT_INSTALLED", messageHe: "אישור מהצ'אט עוד לא מותקן במסד הנתונים — לא הוחלט כלום. אפשר לאשר במסך \"אישורים לסאני\"." };
  return fromWrite(w, input.decision === "APPROVED" ? "אושר — בדיוק כפי שהבקשה הוצגה." : "נדחה.");
}

export async function ownerRevoke(sessionClient: BrainRpcClient, input: { authorizationId: unknown; reasonHe: unknown }): Promise<BrainResult> {
  if (!isId(input.authorizationId)) return invalid(["authorizationId: uuid"]);
  if (!(typeof input.reasonHe === "string" && input.reasonHe.trim().length >= 1 && input.reasonHe.length <= 300)) return invalid(["reasonHe: required (1–300)"]);
  const w = await createBrainOwnerStore(sessionClient).revokeAuthorization({ authorizationId: input.authorizationId, reasonHe: input.reasonHe.trim() });
  return fromWrite(w, "ההרשאה בוטלה — סאני לא תרשום יותר תחתיה.");
}

export async function ownerTransition(sessionClient: BrainRpcClient, input: { transition: unknown }): Promise<BrainResult> {
  const t = checkTransition(input.transition, "OWNER");
  if (!t.ok) return invalid(t.errors);
  const w = await createBrainOwnerStore(sessionClient).transition(t.value);
  return fromWrite(w, "עודכן.");
}
