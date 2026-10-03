/**
 * "The DJ was paid" push — the PURE rules (no "server-only" / Supabase / push imports, so plain tsx tests drive them).
 * The server side lives in lib/dj-payment-notify.ts.
 *
 * Owner decision 2026-10-03: when a show's DJ_FEE row becomes שולם (a REAL transition — never an already-paid row, never a
 * refresh / page load / GET), DJ CLEANTONE gets "התשלום הועבר 💸"; only AFTER that push was actually delivered the Owner gets
 * "עדכון תשלום נשלח ל-CLEANTONE ✓". A push failure never touches the money.
 */

/** The delivery-claim key per payment: one DJ_FEE transaction = one payment = at most one push (settings table, no schema change). */
export const DJ_PAYMENT_CLAIM_PREFIX = "dj_payment_paid:";
export const djPaymentClaimKey = (txId: string) => `${DJ_PAYMENT_CLAIM_PREFIX}${txId}`;
/** The claim version: a payment is announced once (a "sent" claim never re-sends; a "failed" one may retry on the next real transition). */
export const DJ_PAYMENT_CLAIM_VERSION = "paid";

/** A REAL transition: not paid → שולם. A save of an already-שולם row (double click, retry, re-open of the close) is NOT one. */
export function isDjFeeRealPaidTransition(before: string | null | undefined, after: string | null | undefined): boolean {
  return after === "שולם" && before !== "שולם";
}

/** "500₪" / "1,500$" — the amount with ITS own canonical currency (never assumed ₪). */
export function fmtDjPaymentAmount(amount: number, currency: string | null | undefined): string {
  const cur = (currency ?? "").trim() || "₪";
  const n = Number(amount);
  const txt = Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return `${txt}${cur}`;
}

const cleanName = (name: string | null | undefined) => (name ?? "").trim();

/** The DJ's push. A missing show name is never invented — a safe wording without a name is used. */
export function buildDjPaymentPush(f: { showName: string | null | undefined; amount: number; currency: string | null | undefined }): { title: string; body: string } {
  const name = cleanName(f.showName);
  const amt = fmtDjPaymentAmount(f.amount, f.currency);
  return {
    title: "התשלום הועבר 💸",
    body: name ? `שכר הדיג׳יי עבור ${name} בסך ${amt} שולם.` : `שכר הדיג׳יי בסך ${amt} שולם.`,
  };
}

/** The Owner's confirmation — sent ONLY after the DJ's push was delivered. */
export function buildDjPaymentOwnerAck(f: { showName: string | null | undefined; amount: number; currency: string | null | undefined }): { title: string; body: string } {
  const name = cleanName(f.showName);
  const amt = fmtDjPaymentAmount(f.amount, f.currency);
  return {
    title: "עדכון תשלום נשלח ל-CLEANTONE ✓",
    body: name ? `CLEANTONE עודכן שהתשלום עבור ${name} בסך ${amt} שולם.` : `CLEANTONE עודכן שהתשלום בסך ${amt} שולם.`,
  };
}

export type DjPaymentSkipReason = "not_dj_fee_row" | "not_paid" | "no_dj" | "dj_without_push" | "no_fee";

/** Who may be notified: only the DJ linked to the show (the only DJ with a push audience is CLEANTONE), with a real fee. */
export function djPaymentEligibility(input: {
  tx: { role: string | null | undefined; status: string | null | undefined; amount: number };
  show: { djClientId: string | null | undefined; djFee: number | null | undefined };
  cleantoneId: string;
}): { ok: true } | { ok: false; reason: DjPaymentSkipReason } {
  if (input.tx.role !== "DJ_FEE") return { ok: false, reason: "not_dj_fee_row" };
  if (input.tx.status !== "שולם") return { ok: false, reason: "not_paid" };
  if (!input.show.djClientId) return { ok: false, reason: "no_dj" };
  if (input.show.djClientId !== input.cleantoneId) return { ok: false, reason: "dj_without_push" };
  if (!(Number(input.show.djFee) > 0) || !(Number(input.tx.amount) > 0)) return { ok: false, reason: "no_fee" };
  return { ok: true };
}
