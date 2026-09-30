// Sunny Owner Inbox — text updates ("עדכון לסאני", Dashboard V2; NOT the file channel lib/writes/inbox.ts) — pure rules. Owner decision + approved SQL 2026-09-30.
//
// The Owner writes a short free-text update from the dashboard; it is stored AS EVIDENCE (epistemic OWNER_REPORTED,
// never a fact and never canonical state). Sunny reads it through the owner_inbox capability and may turn it into
// typed knowledge or an action ONLY through the existing preview + Owner approval flows (partner_propose_knowledge,
// partner_plan_action). NEW → PROCESSED is a separate, explicit step with a typed outcome.
//
// DB (sunny_owner_inbox): RLS on, no policies, service_role = SELECT only; writes ONLY through the two SECURITY DEFINER
// RPCs sunny_owner_inbox_submit / sunny_owner_inbox_mark_processed. The text itself is never updated or deleted.

import { SECRET_PATTERNS } from "./partner/act/persist";

export const OWNER_INBOX_TABLE = "sunny_owner_inbox";
export const OWNER_INBOX_COLUMNS = "id,created_at,body,author,epistemic,source,request_key,status,processed_at,processed_via,outcome,outcome_ref";
export const INBOX_MAX_CHARS = 1000;
export const INBOX_REF_MAX_CHARS = 120;
export const INBOX_STATUSES = ["NEW", "PROCESSED"] as const;
export const INBOX_VIA = ["DASHBOARD", "SUNNY"] as const;
export const INBOX_OUTCOMES = ["LEARNED_KNOWLEDGE", "ACTION_PLANNED", "NO_ACTION_NEEDED", "DISMISSED"] as const;
export type InboxStatus = (typeof INBOX_STATUSES)[number];
export type InboxVia = (typeof INBOX_VIA)[number];
export type InboxOutcome = (typeof INBOX_OUTCOMES)[number];

export const INBOX_OUTCOME_HE: Record<InboxOutcome, string> = {
  LEARNED_KNOWLEDGE: "נלמד כידע (דרך אישור)", ACTION_PLANNED: "הפך לפעולה (דרך אישור)", NO_ACTION_NEEDED: "לא נדרש כלום", DISMISSED: "נדחה",
};

export interface OwnerInboxItem {
  id: string;
  createdAt: string;
  body: string;
  author: "OWNER";
  epistemic: "OWNER_REPORTED";
  source: string;
  status: InboxStatus;
  processedAt: string | null;
  processedVia: InboxVia | null;
  outcome: InboxOutcome | null;
  outcomeRef: string | null;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export type BodyCheck = { ok: true; body: string } | { ok: false; code: "EMPTY" | "TOO_LONG" | "CONTROL_CHARACTER" | "SECRET_LIKE"; messageHe: string };

/** The same bounds the DB enforces (1–1000 after trim), plus: no control characters and nothing credential-shaped. */
export function checkInboxBody(raw: unknown): BodyCheck {
  const body = typeof raw === "string" ? raw.trim() : "";
  if (!body) return { ok: false, code: "EMPTY", messageHe: "אין מה לשלוח — התיבה ריקה." };
  if (body.length > INBOX_MAX_CHARS) return { ok: false, code: "TOO_LONG", messageHe: `עד ${INBOX_MAX_CHARS} תווים.` };
  if (CONTROL_RE.test(body)) return { ok: false, code: "CONTROL_CHARACTER", messageHe: "הטקסט מכיל תווים לא תקינים." };
  if (SECRET_PATTERNS.some((p) => p.re.test(body))) {
    return { ok: false, code: "SECRET_LIKE", messageHe: "נראה שיש כאן סיסמה / מפתח / טוקן — סודות לא נשמרים אצל סאני. הסר אותם ושלח שוב." };
  }
  return { ok: true, body };
}

export function isInboxOutcome(v: unknown): v is InboxOutcome { return typeof v === "string" && (INBOX_OUTCOMES as readonly string[]).includes(v); }
export function isInboxVia(v: unknown): v is InboxVia { return typeof v === "string" && (INBOX_VIA as readonly string[]).includes(v); }

/** A DB row → the item; null = a row that breaks the table's own contract (never served half-read). */
export function mapInboxRow(r: unknown): OwnerInboxItem | null {
  if (!r || typeof r !== "object") return null;
  const x = r as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" ? v : null);
  const id = s(x.id), createdAt = s(x.created_at), body = s(x.body), status = s(x.status);
  if (!id || !createdAt || body === null || (status !== "NEW" && status !== "PROCESSED")) return null;
  if (x.author !== "OWNER" || x.epistemic !== "OWNER_REPORTED") return null;
  const via = s(x.processed_via), outcome = s(x.outcome);
  return {
    id, createdAt, body, author: "OWNER", epistemic: "OWNER_REPORTED", source: s(x.source) ?? "DASHBOARD_V2", status,
    processedAt: s(x.processed_at), processedVia: isInboxVia(via) ? via : null, outcome: isInboxOutcome(outcome) ? outcome : null, outcomeRef: s(x.outcome_ref),
  };
}
