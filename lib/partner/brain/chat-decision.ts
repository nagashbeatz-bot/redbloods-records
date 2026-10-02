/**
 * Sunny Brain — the Owner decides a pending T2 request FROM THE CHAT (pure; no DB, no clock of its own).
 *
 * Proof of the Owner is NOT here: the database proves it itself (owner_approval_decide_mcp checks the hash of the LIVE
 * connector token this request carried against partner_mcp_check_access + owner_approval_principals; the service role
 * alone cannot decide). This module adds the conversation-side safety in front of it:
 *
 *   1. PRESENTATION — Sunny must first present ONE exact pending request (present_request). The connector remembers, per
 *      token, the ONE request it presented last (id + payload hash + what was shown), with a one-time presentation token
 *      and a short expiry. Presenting another request replaces it, so an old "מאשר" can never land on a request shown
 *      earlier. A decision must name that request and that token; it is consumed by the first decision attempt sent to
 *      the DB. In memory only: a restart forgets every presentation (fail closed → present again).
 *   2. WORDS — APPROVED needs an approval of the presented request AS-IS (ownerApprovalVerdict: an approval word, no
 *      negation / hold, no change); REJECTED needs an explicit rejection ("לא מאשר", "דוחה"…). A reply that changes the
 *      terms ("מאשר רק את שליו") is NEITHER: nothing is decided (narrowing happens in /sunny-approvals, or Sunny withdraws
 *      the request and files a narrower one that the Owner approves as-is).
 *
 * Honest limit (unchanged, SG_MCP_APPROVAL_TEXT_RELAYED): the words are relayed by the model; the server classifies them,
 * it cannot prove a human typed them. What the DB proves is that the request came through the Owner's own live
 * connector token — never the service role on its own, never an email in a payload.
 */
import { randomBytes } from "node:crypto";
import type { BrainRead, BrainRpcClient } from "@/lib/brain-store";
import { ownerDecideFromChat } from "@/lib/writes/brain";
import { brainState } from "@/lib/partner/brain/model";
import { UUID_RE } from "@/lib/partner/brain/vocab";
import { classifyApprovalText } from "@/lib/partner/act/approval-text";
import { mentionsStanding } from "@/lib/partner/act/standing";
import { MAX_CONFIRMATION_CHARS, ownerApprovalVerdict } from "@/lib/partner/owner-approval";

export const PRESENTATION_TTL_MS = 20 * 60_000;
export const PRESENTATION_TOKEN_RE = /^[0-9a-f]{48}$/;
export type ChatDecision = "APPROVED" | "REJECTED";

export interface Presentation { requestId: string; payloadHash: string; readBack: string[]; token: string; expiresAtMs: number }
export type TakeResult =
  | { ok: true; presentation: Presentation }
  | { ok: false; code: "PRESENTATION_REQUIRED" | "PRESENTATION_EXPIRED" | "NOT_THE_PRESENTED_REQUEST"; messageHe: string };

/** ONE open presentation per connector token (the newest). */
export class PresentationRegistry {
  private byToken = new Map<string, Presentation>();
  constructor(private readonly ttlMs = PRESENTATION_TTL_MS, private readonly maxEntries = 200) {}

  present(tokenId: string, p: { requestId: string; payloadHash: string; readBack: string[] }, nowMs: number): Presentation {
    this.sweep(nowMs);
    const pres: Presentation = { ...p, readBack: p.readBack.slice(0, 200), token: randomBytes(24).toString("hex"), expiresAtMs: nowMs + this.ttlMs };
    this.byToken.delete(tokenId);
    this.byToken.set(tokenId, pres);
    while (this.byToken.size > this.maxEntries) this.byToken.delete(this.byToken.keys().next().value as string);
    return pres;
  }

  /** Looks the presentation up WITHOUT consuming it (the words are judged first). */
  peek(tokenId: string, requestId: string, presentationToken: string, nowMs: number): TakeResult {
    const p = this.byToken.get(tokenId);
    if (!p || !PRESENTATION_TOKEN_RE.test(presentationToken)) return { ok: false, code: "PRESENTATION_REQUIRED", messageHe: "לא הצגתי לבוס את הבקשה הזאת בשיחה הזאת — אציג אותה (present_request) ואשאל שוב. לא הוחלט כלום." };
    if (p.expiresAtMs <= nowMs) { this.byToken.delete(tokenId); return { ok: false, code: "PRESENTATION_EXPIRED", messageHe: "עבר יותר מדי זמן מאז שהצגתי את הבקשה — אציג אותה שוב ואשאל שוב. לא הוחלט כלום." }; }
    if (p.requestId !== requestId || p.token !== presentationToken) return { ok: false, code: "NOT_THE_PRESENTED_REQUEST", messageHe: "זו לא הבקשה האחרונה שהצגתי לבוס — אשאל על איזו בקשה מדובר ואציג אותה. לא הוחלט כלום." };
    return { ok: true, presentation: p };
  }

  /** Consumed by the first decision attempt that reaches the DB (whatever the DB answers). */
  consume(tokenId: string, presentationToken: string): void {
    const p = this.byToken.get(tokenId);
    if (p && p.token === presentationToken) this.byToken.delete(tokenId);
  }

  private sweep(nowMs: number) { for (const [k, p] of this.byToken) if (p.expiresAtMs <= nowMs) this.byToken.delete(k); }
}

const REJECT_WORDS = new Set(["דוחה", "דוחים", "דחה", "דחי", "תדחה", "תדחי", "נדחה", "דחייה", "reject", "rejected", "decline", "declined", "deny", "denied"]);
const APPROVAL_STEMS = new Set(["מאשר", "מאשרת", "מאשרים", "מאושר", "אשר", "אשרי", "approve", "approved", "confirm"]);
const HOLD = new Set(["רגע", "חכה", "חכי", "תמתין", "תמתיני", "עדיין", "אחר", "אחרי", "wait", "later", "maybe", "אולי", "בינתיים"]);
const CHANGE = new Set(["אבל", "במקום", "רק", "חוץ", "בלי", "תשנה", "תשני", "שנה", "תחליף", "תחליפי", "תוסיף", "תוסיפי", "תוריד", "תורידי", "תעדכן", "תעדכני", "but", "instead", "except", "only", "without", "change"]);
const words = (s: string) => s.normalize("NFKC").toLowerCase().replace(/["'״׳`.,;:!?()[\]{}\-–—/\\|*_~<>=+%#@]+/g, " ").split(/\s+/).filter(Boolean);
const variants = (w: string) => (/^[ושהבל][֐-׿]{2,}$/.test(w) ? [w, w.slice(1)] : [w]);
const hit = (set: ReadonlySet<string>, w: string) => variants(w).some((x) => set.has(x));

export type WordsVerdict = { ok: true } | { ok: false; code: "APPROVAL_MISSING" | "NOT_A_DECISION" | "TERMS_CHANGED" | "DECISION_MISMATCH"; messageHe: string };

/** An explicit rejection: a reject word, or "לא" directly before an approval word ("לא מאשר"). No change / hold words. */
export function isExplicitRejection(text: string): boolean {
  const ws = words(text);
  if (ws.some((w) => hit(CHANGE, w) || hit(HOLD, w))) return false;
  if (ws.some((w) => hit(REJECT_WORDS, w))) return true;
  return ws.some((w, i) => (w === "לא" || w === "no" || w === "not" || w === "don't" || w === "dont") && i + 1 < ws.length && hit(APPROVAL_STEMS, ws[i + 1]));
}

/** Do the Owner's words decide the presented request the way the model says (decision)? */
export function chatDecisionWords(decision: ChatDecision, text: unknown, readBack: readonly string[]): WordsVerdict {
  const t = typeof text === "string" ? text.trim() : "";
  if (!t || t.length > MAX_CONFIRMATION_CHARS) return { ok: false, code: "APPROVAL_MISSING", messageHe: "צריך את המילים של הבוס כלשונן (confirmationText). לא הוחלט כלום." };
  if (mentionsStanding(t)) return { ok: false, code: "NOT_A_DECISION", messageHe: "הרשאה קבועה לא חלה כאן — צריך החלטה של הבוס על הבקשה הזאת. לא הוחלט כלום." };
  const rejection = isExplicitRejection(t);
  if (decision === "REJECTED") {
    if (rejection) return { ok: true };
    const v = classifyApprovalText(t, [...readBack]);
    if (v.ok) return { ok: false, code: "DECISION_MISMATCH", messageHe: "הבוס אישר, לא דחה — לא הוחלט כלום. אם הוא מאשר, זו החלטת אישור." };
    return { ok: false, code: v.code === "APPROVAL_WITH_CHANGES" ? "TERMS_CHANGED" : "NOT_A_DECISION", messageHe: "לא זוהתה דחייה מפורשת (\"לא מאשר\" / \"דוחה\"). לא הוחלט כלום — אשאל." };
  }
  if (rejection) return { ok: false, code: "DECISION_MISMATCH", messageHe: "הבוס דחה, לא אישר — לא הוחלט כלום." };
  const v = ownerApprovalVerdict(t, readBack);
  if (v.ok) return { ok: true };
  return v.code === "APPROVAL_WITH_CHANGES"
    ? { ok: false, code: "TERMS_CHANGED", messageHe: "הבוס שינה את התנאים — זה לא אישור של הבקשה כפי שהוצגה, ולא הוחלט כלום. אישור חלקי לא נעשה מהצ'אט: אפשר לצמצם ולאשר במסך \"אישורים לסאני\", או שאבטל את הבקשה ואגיש בקשה חדשה בדיוק בתנאים שהוא רוצה — ואז הוא יאשר אותה כאן." }
    : { ok: false, code: v.code === "APPROVAL_MISSING" ? "APPROVAL_MISSING" : "NOT_A_DECISION", messageHe: "לא זוהה אישור מפורש של הבוס. לא הוחלט כלום." };
}

/** Every value the Owner was shown for a request — repeating any of them is never "a change". */
export function readBackOf(r: { summaryHe: string; riskHe: string; payload: Record<string, unknown> }): string[] {
  const out: string[] = [r.summaryHe, r.riskHe];
  const walk = (v: unknown, depth: number) => {
    if (depth > 4 || out.length > 200) return;
    if (typeof v === "string" || typeof v === "number") out.push(String(v));
    else if (Array.isArray(v)) v.forEach((x) => walk(x, depth + 1));
    else if (v && typeof v === "object") Object.values(v as Record<string, unknown>).forEach((x) => walk(x, depth + 1));
  };
  walk(r.payload, 0);
  return out;
}

const ilToday = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

export interface ChatDecisionDeps { read(): Promise<BrainRead>; rpc: BrainRpcClient; registry: PresentationRegistry; now: Date }

/**
 * present_request / decide_request. The caller (lib/partner/brain/server.ts) has already re-checked that the token's user
 * is the Owner; the DB proves it again from actor.tokenHash on the decision. Nothing is decided unless: the request was
 * presented on THIS token, it is the presented request, the token matches, the words decide it the same way, and the DB
 * accepts the exact payload hash that was presented.
 */
export async function runChatDecision(op: "present_request" | "decide_request", input: Record<string, unknown>, actor: { tokenId?: string; tokenHash?: string }, deps: ChatDecisionDeps): Promise<Record<string, unknown>> {
  if (!actor.tokenId || !actor.tokenHash || !/^[0-9a-f]{64}$/.test(actor.tokenHash)) return { status: "OWNER_TOKEN_REQUIRED", messageHe: "אין הוכחה שהבוס עצמו מחובר — לא הוחלט כלום." };
  const requestId = input.requestId;
  if (!(typeof requestId === "string" && UUID_RE.test(requestId))) return { status: "INVALID", errors: ["requestId: uuid"], messageHe: "הבקשה לא תקינה — לא הוחלט כלום." };
  const nowMs = deps.now.getTime();

  if (op === "present_request") {
    const snap = await deps.read();
    if (snap.status !== "OK" || !snap.value.approvals) return { status: snap.status === "OK" ? "NOT_INSTALLED" : snap.status, messageHe: "לא הצלחתי לקרוא את תור האישורים — לא הוצג כלום." };
    const todayIL = ilToday(deps.now);
    const st = brainState(snap.value, todayIL, deps.now.toISOString());
    const r = snap.value.approvals.requests.find((x) => x.id === requestId);
    if (!r) return { status: "REQUEST_NOT_FOUND", messageHe: "הבקשה לא נמצאה." };
    const state = st.approvalState(r);
    if (state !== "PENDING") return { status: "NOT_PENDING", state, messageHe: state === "EXPIRED" ? "פג תוקף הבקשה — אין מה לאשר." : "כבר הוחלט על הבקשה — אין מה לאשר." };
    const otherPending = snap.value.approvals.requests.filter((x) => x.id !== r.id && st.approvalState(x) === "PENDING").slice(0, 10).map((x) => ({ requestId: x.id, kind: x.kind, summaryHe: x.summaryHe }));
    const vf = typeof r.payload.validFrom === "string" ? r.payload.validFrom : null;
    const backdated = r.kind === "TRACKING_AUTHORIZATION" && vf !== null && vf < todayIL;
    const pres = deps.registry.present(actor.tokenId, { requestId: r.id, payloadHash: r.payloadHash, readBack: readBackOf(r) }, nowMs);
    return {
      status: "OK",
      request: { requestId: r.id, kind: r.kind, summaryHe: r.summaryHe, riskHe: r.riskHe, terms: r.payload, payloadHash: r.payloadHash, expiresAt: r.expiresAt },
      presentationToken: pres.token, presentationExpiresAt: new Date(pres.expiresAtMs).toISOString(),
      chatApprovable: !backdated,
      ...(backdated ? { chatApprovableNoteHe: `תאריך ההתחלה בבקשה (${vf}) כבר עבר. מהצ'אט אפשר רק לאשר בדיוק כפי שהוגש, ולכן אישור כאן ייכשל: אפשר לדחות כאן, לאשר במסך "אישורים לסאני" (שם מתחילים מהיום), או שאגיש בקשה חדשה מהיום.` } : {}),
      otherPending,
      messageHe: otherPending.length ? "יש עוד בקשות שמחכות — הצג את זו בלבד, ושאל במפורש על זו." : "הצג לבוס את הבקשה ושאל \"לאשר?\".",
    };
  }

  const decision = input.decision;
  if (decision !== "APPROVED" && decision !== "REJECTED") return { status: "INVALID", errors: ["decision: APPROVED | REJECTED"], messageHe: "הבקשה לא תקינה — לא הוחלט כלום." };
  if (input.reasonHe !== undefined && !(typeof input.reasonHe === "string" && input.reasonHe.trim().length >= 1 && input.reasonHe.length <= 300)) return { status: "INVALID", errors: ["reasonHe: 1–300 characters"], messageHe: "הבקשה לא תקינה — לא הוחלט כלום." };
  const token = typeof input.presentationToken === "string" ? input.presentationToken : "";
  const seen = deps.registry.peek(actor.tokenId, requestId, token, nowMs);
  if (!seen.ok) return { status: seen.code, messageHe: seen.messageHe };
  const words = chatDecisionWords(decision, input.confirmationText, seen.presentation.readBack);
  if (!words.ok) return { status: words.code, messageHe: words.messageHe };
  deps.registry.consume(actor.tokenId, token);
  const r = await ownerDecideFromChat(deps.rpc, { tokenHash: actor.tokenHash, requestId, decision, seenHash: seen.presentation.payloadHash, reasonHe: input.reasonHe });
  return r as unknown as Record<string, unknown>;
}
