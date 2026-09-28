/**
 * Finance synced-row OWNERSHIP rule (pure — no database). A transaction created and kept in step by another Redbloods
 * writer (a show's money sync, a mix work's payment, a clip row, a Red Films budget line, a social promotion, Victor's
 * monthly salary) is OWNED by that writer: editing its money / identity directly in Finance would be silently undone
 * or would break the owner's numbers. ONE rule, shared by the Finance route (PATCH / DELETE /api/transactions/[id]),
 * the Finance screen (badge + disabled controls) and Sunny's finance primitives (integrity fix A5, 2026-09-27).
 *
 *   • an owned row is NEVER deleted from Finance (delete it through its owner);
 *   • amount / currency / type / project / scope / links / description never change on an owned row;
 *   • allowed on an owned row, only when the value really changes:
 *       DJ_FEE / ARTIST_FEE / REHEARSAL / VICTOR_SALARY / MIX_WORK / PROMOTION / RF_BUDGET → status, date, payment method, notes
 *       CLIP_ROW → the same + amount / currency / description / category: since B3 (2026-09-27) a promoted clip planning
 *         row is KEPT as provenance and never re-writes its expense — the Finance expense is the canonical actual cost
 *         (a plan ≠ expense difference is the CLIP_PLAN_VS_EXPENSE signal), so only delete / type / project / links stay locked
 *       SHOW_PAYMENT → notes, payment method, date (amount / status corrections go through the show payments flow)
 *       SHOW_BALANCE_EXPECTED / SHOW (legacy show link) → notes only (the show sync recomputes them)
 *       RF_PAYMENT (DB-1, 2026-09-27: the ONE Finance expense of a Red Films payment, red_films_budget_payments.
 *         linked_transaction_id) → notes only: amount / date / method follow the payment (edit it in Red Films); deleting
 *         the payment deletes it.
 */

export type FinanceOwnerCode =
  | "SHOW_PAYMENT" | "SHOW_BALANCE_EXPECTED" | "DJ_FEE" | "ARTIST_FEE" | "REHEARSAL" | "SHOW"
  | "MIX_WORK" | "CLIP_ROW" | "RF_BUDGET" | "RF_PAYMENT" | "PROMOTION" | "VICTOR_SALARY" | "ARTIST_PAYMENT";
export const FINANCE_OWNER_CODES: readonly FinanceOwnerCode[] = ["SHOW_PAYMENT", "SHOW_BALANCE_EXPECTED", "DJ_FEE", "ARTIST_FEE", "REHEARSAL", "SHOW", "MIX_WORK", "CLIP_ROW", "RF_BUDGET", "RF_PAYMENT", "PROMOTION", "VICTOR_SALARY", "ARTIST_PAYMENT"];
/** The linked_session_id marker of a real artist payment written by lib/writes/artist-payments (net model 2026-09-28). */
export const ARTIST_PAYMENT_MARKER_PREFIX = "artist_payment:";

/** Who owns it (Hebrew) and where it is changed instead. */
export const FINANCE_OWNER_HE: Readonly<Record<FinanceOwnerCode, { labelHe: string; whereHe: string }>> = {
  SHOW_PAYMENT: { labelHe: "תשלום הופעה", whereHe: "בכרטיס ההופעה → תשלומים" },
  SHOW_BALANCE_EXPECTED: { labelHe: "יתרה צפויה של הופעה", whereHe: "בכרטיס ההופעה (היתרה מחושבת מהמחיר והתשלומים)" },
  DJ_FEE: { labelHe: "שכר DJ של הופעה", whereHe: "בכרטיס ההופעה" },
  ARTIST_FEE: { labelHe: "חלק האמן בהופעה", whereHe: "בכרטיס ההופעה" },
  REHEARSAL: { labelHe: "חזרה להופעה", whereHe: "בכרטיס ההופעה / הסשן של החזרה" },
  SHOW: { labelHe: "רשומת הופעה", whereHe: "בכרטיס ההופעה" },
  MIX_WORK: { labelHe: "תשלום עבודת מיקס / מאסטר", whereHe: "בעבודת המיקס (מסך המהנדס)" },
  CLIP_ROW: { labelHe: "שורת תכנון קליפ", whereHe: "בתכנון הקליפ של הפרויקט" },
  RF_BUDGET: { labelHe: "שורת תקציב Red Films", whereHe: "בהפקת Red Films → תקציב" },
  RF_PAYMENT: { labelHe: "תשלום Red Films", whereHe: "בהפקת Red Films → תקציב → התשלום (סכום / תאריך / אמצעי תשלום; מחיקת התשלום מוחקת גם את ההוצאה)" },
  PROMOTION: { labelHe: "הוצאת קידום (סושיאל)", whereHe: "בקמפיין הסושיאל → קידום ותקציב" },
  VICTOR_SALARY: { labelHe: "שכר חודשי של ויקטור", whereHe: "בכרטיס ויקטור → שכר" },
  ARTIST_PAYMENT: { labelHe: "תשלום לאמן (התחשבנות)", whereHe: "בעמוד האמן → מאזן → התשלום (סכום / תאריך מתעדכנים גם כאן; ביטול התשלום מסמן את השורה כאן 'בוטל')" },
};

/** Transaction PATCH fields (the route's camelCase body keys) → the DB column they write. */
export const TX_PATCH_FIELDS = {
  date: "date", description: "description", artist: "artist", amount: "amount", currency: "currency", paymentStatus: "payment_status",
  paymentMethod: "payment_method", receiptRef: "receipt_ref", notes: "notes", category: "category", type: "type", scope: "scope",
  project_id: "project_id", linkedSessionId: "linked_session_id", expenseScope: "expense_scope",
} as const;
export type TxPatchField = keyof typeof TX_PATCH_FIELDS;

const FEE_LIKE: readonly TxPatchField[] = ["paymentStatus", "date", "paymentMethod", "notes"];
export const OWNED_ALLOWED_FIELDS: Readonly<Record<FinanceOwnerCode, readonly TxPatchField[]>> = {
  DJ_FEE: FEE_LIKE, ARTIST_FEE: FEE_LIKE, REHEARSAL: FEE_LIKE, VICTOR_SALARY: FEE_LIKE, MIX_WORK: FEE_LIKE,
  CLIP_ROW: [...FEE_LIKE, "amount", "currency", "description", "category"], PROMOTION: FEE_LIKE, RF_BUDGET: FEE_LIKE,
  SHOW_PAYMENT: ["notes", "paymentMethod", "date"],
  SHOW_BALANCE_EXPECTED: ["notes"], SHOW: ["notes"], RF_PAYMENT: ["notes"],
  // a real artist payment (net model): its money follows the ledger payment — only notes / method here
  ARTIST_PAYMENT: ["notes", "paymentMethod"],
};
const FIELD_HE: Readonly<Record<TxPatchField, string>> = {
  date: "תאריך", description: "תיאור", artist: "צד / אמן", amount: "סכום", currency: "מטבע", paymentStatus: "סטטוס", paymentMethod: "אמצעי תשלום",
  receiptRef: "אסמכתא", notes: "הערות", category: "קטגוריה", type: "סוג (הכנסה / הוצאה)", scope: "שיוך (פרויקט / כללי)", project_id: "פרויקט",
  linkedSessionId: "קישור", expenseScope: "היקף הוצאה",
};

/** The current row, in the same shape as a PATCH body (for "did it really change?"). */
export interface TxCurrent { date: string | null; description: string; artist: string; amount: number; currency: string; paymentStatus: string; paymentMethod: string; receiptRef: string; notes: string; category: string; type: string; scope: string; project_id: string | null; linkedSessionId: string; expenseScope: string }
const norm = (f: TxPatchField, v: unknown): string => {
  if (v === undefined || v === null) return "";
  if (f === "amount") return String(Number(v) || 0);
  return String(v);
};
/** The PATCH keys whose value really differs from the current row (a screen re-sending unchanged values is not a change). */
export function changedTxFields(current: TxCurrent, patch: Readonly<Record<string, unknown>>): TxPatchField[] {
  const out: TxPatchField[] = [];
  for (const f of Object.keys(TX_PATCH_FIELDS) as TxPatchField[]) {
    if (patch[f] === undefined) continue;
    if (norm(f, patch[f]) !== norm(f, current[f])) out.push(f);
  }
  return out;
}

export type TxEditVerdict = { ok: true } | { ok: false; code: "OWNED_ROW_DELETE" | "OWNED_ROW_FIELD"; owner: FinanceOwnerCode; forbidden: TxPatchField[]; messageHe: string };
/** THE rule. `op` = "delete" or the list of fields that really change. A free-standing row (owner null) is always ok. */
export function transactionEditVerdict(owner: FinanceOwnerCode | null, op: "delete" | readonly TxPatchField[]): TxEditVerdict {
  if (!owner) return { ok: true };
  const o = FINANCE_OWNER_HE[owner];
  if (op === "delete") return { ok: false, code: "OWNED_ROW_DELETE", owner, forbidden: [], messageHe: `הרשומה הזאת שייכת ל${o.labelHe} — לא מוחקים אותה מהכספים (הסנכרון יחזיר אותה או ישבור את החישוב). מוחקים / משנים ${o.whereHe}` };
  const allowed = OWNED_ALLOWED_FIELDS[owner];
  const forbidden = op.filter((f) => !allowed.includes(f));
  if (!forbidden.length) return { ok: true };
  return { ok: false, code: "OWNED_ROW_FIELD", owner, forbidden, messageHe: `הרשומה הזאת שייכת ל${o.labelHe} — אי אפשר לשנות כאן ${forbidden.map((f) => FIELD_HE[f]).join(", ")}. משנים ${o.whereHe}. כאן מותר לשנות רק: ${allowed.map((f) => FIELD_HE[f]).join(", ")}` };
}

/** Link facts for one transaction (read in batch by the Finance route). */
export interface TxOwnerLinks {
  showId?: string | null; showMoneyRole?: string | null; linkedSessionId?: string | null;
  legacyShowRole?: "SHOW_PAYMENT" | "DJ_FEE" | "ARTIST_FEE" | null;
  mixWork?: boolean; clipRow?: boolean; rfBudget?: boolean; rfPayment?: boolean; promotion?: boolean;
}
/** Owner from links (pure). Order: show money role → legacy show link → Victor salary → mix → clip → Red Films payment → Red Films line → promotion. */
export function ownerFromLinks(l: TxOwnerLinks): FinanceOwnerCode | null {
  if (l.showId) {
    const r = l.showMoneyRole;
    if (r === "SHOW_PAYMENT" || r === "SHOW_BALANCE_EXPECTED" || r === "DJ_FEE" || r === "ARTIST_FEE" || r === "REHEARSAL") return r;
    return l.legacyShowRole ?? "SHOW";
  }
  if (l.legacyShowRole) return l.legacyShowRole;
  if (typeof l.linkedSessionId === "string" && l.linkedSessionId.startsWith("victor_salary_")) return "VICTOR_SALARY";
  if (typeof l.linkedSessionId === "string" && l.linkedSessionId.startsWith(ARTIST_PAYMENT_MARKER_PREFIX)) return "ARTIST_PAYMENT";
  if (l.mixWork) return "MIX_WORK";
  if (l.clipRow) return "CLIP_ROW";
  if (l.rfPayment) return "RF_PAYMENT";
  if (l.rfBudget) return "RF_BUDGET";
  if (l.promotion) return "PROMOTION";
  return null;
}
/** The controls a screen may enable for an owned row. */
export function ownerUi(owner: FinanceOwnerCode | null): { owner: FinanceOwnerCode; labelHe: string; whereHe: string; allowed: readonly TxPatchField[]; canDelete: false } | null {
  return owner ? { owner, ...FINANCE_OWNER_HE[owner], allowed: OWNED_ALLOWED_FIELDS[owner], canDelete: false } : null;
}
