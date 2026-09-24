/**
 * Sunny — business ACTION proposals (P3 code architecture). Pure. PREVIEW ONLY in Sunny V1.
 *
 * "תשנה את הדדליין של קרוב אלייך ל-15.10" is an ACTION request, not knowledge. Sunny resolves the project
 * deterministically, validates it against live state and describes the EXISTING validated Partner action it would
 * propose (UPDATE_PROJECT_DEADLINE). Nothing is persisted or executed here: in V1 the Owner approves / executes
 * business actions only in the Redbloods dashboard through the existing decide / execute primitives. Finance actions
 * (RECORD_PAID_EXPENSE) are refused through Sunny. No new mutation primitive exists or is invented here.
 *
 * Activation (later, separately approved): a persisted Sunny proposal would enter the existing action surface — the
 * tool / scope (partner:propose_action) exists only behind PARTNER_MCP_PROPOSE_ACTION_ENABLED, which is OFF.
 */
import type { GatewaySources } from "../gateway/core";
import { BUSINESS_ACTIONS } from "../system/registry";
import { resolveEntity } from "../owner-knowledge/propose";

export const SUPPORTED_ACTIONS = ["UPDATE_PROJECT_DEADLINE"] as const;
export const REFUSED_FINANCE_ACTIONS = ["RECORD_PAID_EXPENSE", "RECORD_RECEIVED_INCOME"] as const;

export type ActionProposalResult =
  | { status: "PREVIEW_ONLY"; actionType: "UPDATE_PROJECT_DEADLINE"; project: { key: string; label: string }; currentDeadline: string | null; proposedDeadline: string;
      summaryHe: string; approvalHe: string; persisted: false; executed: false }
  | { status: "FINANCE_ACTIONS_DISABLED"; messageHe: string }
  | { status: "UNSUPPORTED_ACTION"; supported: readonly string[]; known: { id: string; class: string; reason: string; design: unknown } | null; messageHe: string }
  | { status: "NEEDS_CLARIFICATION"; questionHe: string; candidates: Array<{ key: string; label: string; type: string }> }
  | { status: "INVALID"; errors: string[] }
  | { status: "CONFLICT_WITH_LIVE"; messageHe: string };

const CLOSED = new Set(["הושלם", "בוטל"]);
const valid = (t: unknown): t is string => typeof t === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t) && new Date(`${t}T12:00:00Z`).toISOString().slice(0, 10) === t;
const he = (y: string) => `${y.slice(8, 10)}.${y.slice(5, 7)}.${y.slice(0, 4)}`;

export function proposeActionPreviewCore(src: GatewaySources, input: { actionType: unknown; project: unknown; newDeadline: unknown }): ActionProposalResult {
  if ((REFUSED_FINANCE_ACTIONS as readonly unknown[]).includes(input.actionType)) return { status: "FINANCE_ACTIONS_DISABLED", messageHe: "פעולות כספים לא מבוצעות ולא מוצעות דרך סאני כרגע — רק בלוח הבקרה." };
  if (input.actionType !== "UPDATE_PROJECT_DEADLINE") {
    // Sunny knows its limits: an action that exists in Redbloods but has no Sunny primitive is described, never faked.
    const k = BUSINESS_ACTIONS.find((a) => a.id === input.actionType) ?? null;
    return { status: "UNSUPPORTED_ACTION", supported: SUPPORTED_ACTIONS, known: k ? { id: k.id, class: k.class, reason: k.reason, design: k.design ?? null } : null,
      messageHe: k ? "הבנתי מה אתה רוצה, אבל לסאני אין עדיין פעולה מאושרת לזה — אפשר לעשות את זה בלוח הבקרה. שום דבר לא נוצר." : "אני לא מכיר פעולה כזו במערכת. שום דבר לא השתנה." };
  }
  const st = src.state?.status === "OK" ? src.state.value : null;
  if (!st) return { status: "INVALID", errors: ["company state unavailable"] };
  const r = resolveEntity(src, input.project, ["project"], "project");
  if (!r.ok) return "clarify" in r ? { status: "NEEDS_CLARIFICATION", ...r.clarify } : { status: "INVALID", errors: [r.error] };
  if (!valid(input.newDeadline)) return { status: "INVALID", errors: ["newDeadline: YYYY-MM-DD"] };
  const id = r.key.slice("project:".length);
  const status = st.domains.projects.data?.index[id]?.status ?? null;
  if (status && CLOSED.has(status)) return { status: "CONFLICT_WITH_LIVE", messageHe: `הפרויקט מסומן "${status}" — אין מה לעדכן בו דדליין.` };
  if (input.newDeadline < st.todayIL) return { status: "INVALID", errors: ["newDeadline is in the past"] };
  const current = st.domains.projects.data?.open.find((p) => p.id === id)?.deadline.ymd ?? null;
  if (current === input.newDeadline) return { status: "CONFLICT_WITH_LIVE", messageHe: "זה כבר הדדליין הנוכחי." };
  return {
    status: "PREVIEW_ONLY", actionType: "UPDATE_PROJECT_DEADLINE", project: { key: r.key, label: r.label }, currentDeadline: current, proposedDeadline: input.newDeadline,
    summaryHe: `הצעה: לעדכן את הדדליין של ${r.label}${current ? ` מ־${he(current)}` : ""} ל־${he(input.newDeadline)}.`,
    approvalHe: "בשלב הזה סאני רק מתאר את ההצעה — האישור והביצוע נעשים בלוח הבקרה של Redbloods. שום דבר לא השתנה.",
    persisted: false, executed: false,
  };
}
