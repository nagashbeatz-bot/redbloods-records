/**
 * TX_PATCH_UNVALIDATED (Final Hardening 2026-09-29, A8) — the ONE validation of an edit to a transaction's FINANCIAL
 * MEANING, used by the shared writer (lib/writes/finance updateTransactionRecord) for the Finance route and Sunny alike.
 * Pure. Only fields that REALLY change are checked (a screen re-sending stored values is never refused), against the
 * row's FINAL state (a type change validates the status the row will have):
 *   type          income / expense
 *   status        the vocabulary of the final type ('לבדיקה' stays retired — lib/finance/classify)
 *   scope         project / general; a project row needs a project
 *   expenseScope  a known scope; on an INCOME row only the reporting tags כללי / קליפ, and only on a project row (the tag
 *                 never moves money between deals — a project has ONE agreedPrice, one clip model 2026-10-01)
 *   currency      ₪ / $ / € (no conversion — the amount is kept as typed)
 *   amount        a finite number ≥ 0
 *   linkedSessionId  never to / from an OWNER marker (artist_payment: / media_income: / victor_salary_) — a free edit
 *                 can neither take a row away from its owner nor make a free row "owned"
 * No new permission system: the owned-row guard (lib/finance/ownership) still runs first.
 */
import { ACTIVE_INCOME_STATUSES, RECEIVED_STATUSES } from "./classify";
import { INCOME_SCOPES } from "../clip-rf-money-pure";

export const TX_TYPES: readonly string[] = ["income", "expense"];
export const TX_INCOME_STATUSES: readonly string[] = [...new Set<string>([...ACTIVE_INCOME_STATUSES, ...RECEIVED_STATUSES])];
export const TX_EXPENSE_STATUSES: readonly string[] = ["שולם", "צפוי", "לא שולם", "חלקי", "בוטל"];
export const TX_SCOPES: readonly string[] = ["project", "general"];
export const TX_EXPENSE_SCOPES: readonly string[] = ["כללי", "קליפ", "מיקס / מאסטר", "שיווק", "סשן", "נסיעות", "ציוד", "אחר", "הופעה"];
export const TX_CURRENCY_VALUES: readonly string[] = ["₪", "$", "€"];
export const OWNER_MARKER_PREFIXES: readonly string[] = ["artist_payment:", "media_income:", "victor_salary_"];

export interface TxPatchCurrent { type: string; paymentStatus: string; scope: string; projectId: string | null; expenseScope: string; currency: string; amount: number; linkedSessionId: string }
export interface TxPatchInput { type?: string; paymentStatus?: string; scope?: string; project_id?: string | null; expenseScope?: string; currency?: string; amount?: number | string; linkedSessionId?: string }

const isMarker = (v: string | null | undefined) => OWNER_MARKER_PREFIXES.some((p) => String(v ?? "").startsWith(p));

/** null = valid; otherwise the Hebrew reason (the writer answers 400 with it — nothing is written). */
export function validateTxPatch(cur: TxPatchCurrent, p: TxPatchInput): string | null {
  const changed = <K extends keyof TxPatchInput>(k: K, curV: unknown) => p[k] !== undefined && String(p[k] ?? "") !== String(curV ?? "");
  const finalType = p.type !== undefined ? String(p.type) : cur.type;
  const finalScope = p.scope !== undefined ? String(p.scope) : cur.scope;
  const finalProject = p.project_id !== undefined ? (p.project_id || null) : cur.projectId;
  const finalStatus = p.paymentStatus !== undefined ? String(p.paymentStatus) : cur.paymentStatus;
  const finalExpScope = p.expenseScope !== undefined ? String(p.expenseScope) : cur.expenseScope;
  if (changed("type", cur.type) && !TX_TYPES.includes(finalType)) return "סוג תנועה לא חוקי (הכנסה / הוצאה)";
  if (changed("type", cur.type) || changed("paymentStatus", cur.paymentStatus)) {
    const allowed = finalType === "income" ? TX_INCOME_STATUSES : TX_EXPENSE_STATUSES;
    if (!allowed.includes(finalStatus)) return `סטטוס "${finalStatus}" לא חוקי ל${finalType === "income" ? "הכנסה" : "הוצאה"} (${allowed.join(" / ")})`;
  }
  if (changed("scope", cur.scope) && !TX_SCOPES.includes(finalScope)) return "שיוך לא חוקי (פרויקט / כללי)";
  if ((changed("scope", cur.scope) || changed("project_id", cur.projectId)) && finalScope === "project" && !finalProject) return "תנועה של פרויקט חייבת פרויקט";
  if (changed("expenseScope", cur.expenseScope) || changed("type", cur.type) || changed("project_id", cur.projectId) || changed("scope", cur.scope)) {
    if (finalType === "expense" && changed("expenseScope", cur.expenseScope) && !TX_EXPENSE_SCOPES.includes(finalExpScope)) return `היקף הוצאה לא מוכר: "${finalExpScope}"`;
    if (finalType === "income" && finalExpScope !== "כללי") {
      // an income's reporting tag (כללי / קליפ — never a separate deal, one clip model 2026-10-01): only on a project row
      if (!INCOME_SCOPES.includes(finalExpScope)) return "שיוך הכנסה: כללי או קליפ בלבד";
      if (!(finalScope === "project" && finalProject)) return "שיוך קליפ להכנסה רק בהכנסה של פרויקט";
    }
  }
  if (changed("currency", cur.currency) && !TX_CURRENCY_VALUES.includes(String(p.currency))) return "מטבע לא נתמך (₪ / $ / €)";
  if (p.amount !== undefined && Number(p.amount) !== cur.amount) {
    const n = Number(p.amount);
    if (!Number.isFinite(n) || n < 0) return "סכום לא תקין";
  }
  if (changed("linkedSessionId", cur.linkedSessionId) && (isMarker(cur.linkedSessionId) || isMarker(p.linkedSessionId))) return "הקישור הזה מסמן בעלות של רשומה אחרת (תשלום אמן / מדיה / שכר) — לא משנים אותו בעריכה חופשית";
  return null;
}
