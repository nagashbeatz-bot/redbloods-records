/**
 * Artist payments + ledger entries — the ONE writer (net settlement model, Owner decision 2026-09-28).
 *
 *   Finance        = real money. A payment that REALLY went to an artist is a Finance expense (שכר אמן, שולם, RECORDS).
 *   Artist ledger  = the settlement with the artist: entitlements − the artist's expense share − payments = the balance.
 *   An entitlement (a show share) is NEVER a Finance expense — only the ledger holds it (lib/artist-entitlement-sync).
 *
 * `recordArtistPayment` writes BOTH sides of one real payment, every path uses it (the close dialog's "אמן ✓",
 * MARK_SHOW_FEE_PAID for the artist, "הוסף תשלום" in the balance tab, Sunny's ADD_LEDGER_ENTRY of a payment):
 *   1. the Finance row, found-or-created by an idempotency marker (transactions.linked_session_id = "artist_payment:<key>")
 *      — a retry with the same key never creates a second row;
 *   2. the ledger payment, linked by source_tx_id (UNIQUE) — a retry never creates a second ledger row.
 * No automatic DELETE: when step 2 fails the Finance row stays and the caller gets a PARTIAL result that says so
 * (retry completes it; Sunny's reconciliation reports a Finance artist payment without a ledger payment until then).
 * Limitation (no schema change approved): the marker has no DB unique index, so two SIMULTANEOUS first attempts
 * could both pass the lookup — the UI locks the button while saving and the duplicate guard below runs first.
 */
import { supabase } from "@/lib/supabase";
import { inferBusinessUnit, unitColumns } from "@/lib/business-unit";
import { ARTIST_PAYMENT_MARKER_PREFIX } from "@/lib/finance/ownership";

export const ARTIST_PAYMENT_CATEGORY = "שכר אמן";
export const LEDGER_PAYMENT_TYPE = "תשלומים";
const LEDGER_TYPES = ["הכנסות", "הכנסות צפויות", "תשלומים", "הוצאות", "הוצאות צפויות"] as const;
type LedgerType = (typeof LEDGER_TYPES)[number];
const PAYMENT_METHODS_OK = ["", "העברה בנקאית", "מזומן", "ביט", "פייבוקס", "צ'ק", "כרטיס אשראי", "PayPal", "Payoneer", "אשראי", "אחר"];

const ymd = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const round2 = (n: number) => Math.round(n * 100) / 100;

export type ArtistPaymentResult =
  | { kind: "ok"; transactionId: string; ledgerEntryId: string; reused: boolean }
  | { kind: "refused"; code: "BAD_ARGS" | "NOT_FOUND" | "DUPLICATE" | "NOT_ILS"; messageHe: string; existing?: { transactionId: string | null; ledgerEntryId: string | null; date: string | null; amount: number } }
  | { kind: "partial"; transactionId: string; messageHe: string };

export interface ArtistPaymentInput {
  artistId: string;
  amount: number;
  date: string;
  method?: string;
  description?: string;
  note?: string;
  /** the show this payment is for (ledger source_show_id; the Finance row notes it) */
  showId?: string | null;
  /** a retry with the same key never writes twice; default = artist + date + amount + show */
  idempotencyKey?: string | null;
  /** the Owner confirmed this is a SEPARATE payment although a similar one exists */
  allowDuplicate?: boolean;
  currency?: string;
}

/** The ONE path for a real payment to an artist: Finance (שולם, RECORDS) + the ledger payment, linked, idempotent. */
export async function recordArtistPayment(p: ArtistPaymentInput): Promise<ArtistPaymentResult> {
  const amount = round2(Number(p.amount));
  if (!Number.isFinite(amount) || amount <= 0) return { kind: "refused", code: "BAD_ARGS", messageHe: "הסכום חייב להיות גדול מ-0" };
  if (!ymd(p.date)) return { kind: "refused", code: "BAD_ARGS", messageHe: "תאריך לא תקין (YYYY-MM-DD)" };
  const method = p.method ?? "";
  if (!PAYMENT_METHODS_OK.includes(method)) return { kind: "refused", code: "BAD_ARGS", messageHe: "אמצעי תשלום לא מוכר" };
  // the ledger stores no currency (screens show ₪): a non-₪ payment is recorded in Finance by hand, never silently here
  if ((p.currency ?? "₪") !== "₪") return { kind: "refused", code: "NOT_ILS", messageHe: "יומן האמן בש\"ח בלבד — תשלום במטבע אחר נרשם בכספים ידנית" };
  const { data: artist, error: aErr } = await supabase.from("label_artists").select("id, name").eq("id", p.artistId).maybeSingle();
  if (aErr) throw new Error(aErr.message);
  if (!artist) return { kind: "refused", code: "NOT_FOUND", messageHe: "האמן לא נמצא" };
  const key = (p.idempotencyKey && String(p.idempotencyKey).trim()) || `${p.artistId}:${p.date}:${amount}:${p.showId ?? ""}`;
  const marker = `${ARTIST_PAYMENT_MARKER_PREFIX}${key}`.slice(0, 200);

  // 1. the Finance row — found by its marker (a retry), otherwise the duplicate guard, then created
  const { data: found, error: fErr } = await supabase.from("transactions").select("id, amount, payment_status").eq("linked_session_id", marker).limit(1);
  if (fErr) throw new Error(fErr.message);
  let txId: string | null = found && found.length ? String(found[0].id) : null;
  const reused = !!txId;
  if (!txId) {
    if (!p.allowDuplicate) {
      const dup = await similarArtistPayment(String(artist.name), p.artistId, amount, p.date, p.showId ?? null);
      if (dup) return { kind: "refused", code: "DUPLICATE", messageHe: `כבר רשום תשלום דומה לאמן (${amount} ₪${dup.date ? `, ${dup.date}` : ""}). אם זה באמת תשלום נפרד — אשר 'רשומה נפרדת'.`, existing: { ...dup, amount } };
    }
    const description = p.description?.trim() || `תשלום לאמן — ${artist.name}`;
    const notes = [p.note?.trim(), p.showId ? `artist_payment_show:${p.showId}` : null, "תשלום אמיתי לאמן (מודל נטו) — רשום גם במאזן האמן"].filter(Boolean).join(" · ");
    const { data: ins, error: iErr } = await supabase.from("transactions").insert({
      project_id: null, scope: "general", type: "expense", date: p.date, description, artist: artist.name, amount, currency: "₪",
      payment_status: "שולם", payment_method: method, receipt_ref: "", notes, category: ARTIST_PAYMENT_CATEGORY,
      linked_session_id: marker, expense_scope: p.showId ? "הופעה" : "כללי", show_id: null, show_money_role: null,
      ...unitColumns(inferBusinessUnit({ writer: "ARTIST_PAYMENT", type: "expense" })),
    }).select("id").single();
    if (iErr || !ins) throw new Error(iErr?.message ?? "the Finance payment was not created");
    txId = String(ins.id);
  }

  // 2. the ledger payment — linked by source_tx_id (UNIQUE: a retry finds it, never a second row)
  const { data: led, error: lErr } = await supabase.from("artist_balance_entries").select("id").eq("source_tx_id", txId).limit(1);
  if (lErr) return { kind: "partial", transactionId: txId, messageHe: `התשלום נרשם בכספים אבל לא אומת במאזן האמן (${lErr.message}) — נסה שוב; לא ייווצר כפל` };
  if (led && led.length) return { kind: "ok", transactionId: txId, ledgerEntryId: String(led[0].id), reused: true };
  const { data: le, error: leErr } = await supabase.from("artist_balance_entries").insert({
    artist_id: p.artistId, entry_type: LEDGER_PAYMENT_TYPE, amount, entry_date: p.date,
    description: p.description?.trim() || (p.showId ? "תשלום — הופעה" : "תשלום"), note: p.note?.trim() ?? "",
    source_tx_id: txId, source_show_id: p.showId ?? null,
  }).select("id").single();
  if (leErr || !le) {
    if (leErr?.code === "23505") {
      const { data: again } = await supabase.from("artist_balance_entries").select("id").eq("source_tx_id", txId).limit(1);
      if (again && again.length) return { kind: "ok", transactionId: txId, ledgerEntryId: String(again[0].id), reused: true };
    }
    return { kind: "partial", transactionId: txId, messageHe: `התשלום נרשם בכספים אבל לא במאזן האמן (${leErr?.message ?? "שגיאה"}) — נסה שוב (אותה פעולה משלימה את היומן, לא ייווצר כפל)` };
  }
  return { kind: "ok", transactionId: txId, ledgerEntryId: String(le.id), reused };
}

/** A similar REAL payment already recorded (Finance שכר אמן שולם for the artist, or a ledger payment), near the date. */
async function similarArtistPayment(artistName: string, artistId: string, amount: number, date: string, showId: string | null): Promise<{ transactionId: string | null; ledgerEntryId: string | null; date: string | null } | null> {
  const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86400000;
  const near = (d: string | null) => !!d && Math.abs(day(d) - day(date)) <= 3;
  const { data: tx, error } = await supabase.from("transactions").select("id, date, amount, payment_status, artist, category").eq("type", "expense").eq("category", ARTIST_PAYMENT_CATEGORY).eq("artist", artistName);
  if (error) throw new Error(error.message);
  const t = (tx ?? []).find((r) => r.payment_status === "שולם" && round2(Number(r.amount)) === amount && near(r.date as string | null));
  if (t) return { transactionId: String(t.id), ledgerEntryId: null, date: (t.date as string | null) ?? null };
  const { data: led, error: lErr } = await supabase.from("artist_balance_entries").select("id, entry_date, amount, source_show_id").eq("artist_id", artistId).eq("entry_type", LEDGER_PAYMENT_TYPE);
  if (lErr) throw new Error(lErr.message);
  const l = (led ?? []).find((r) => round2(Number(r.amount)) === amount && (near(r.entry_date as string) || (!!showId && r.source_show_id === showId)));
  return l ? { transactionId: null, ledgerEntryId: String(l.id), date: (l.entry_date as string) ?? null } : null;
}

// ── ledger entries (the balance tab + Sunny): a PAYMENT always goes through recordArtistPayment ──

export type LedgerWriteResult =
  | { kind: "ok"; entry: Record<string, unknown> }
  | { kind: "refused"; code: string; messageHe: string; status: number }
  | { kind: "partial"; transactionId: string; messageHe: string };

/** Create a ledger entry. A payment is a REAL payment: Finance + ledger (recordArtistPayment); nothing else touches Finance. */
export async function createLedgerEntryRecord(artistId: string, e: { entryType: string; amount: number; entryDate: string; description: string; note: string; idempotencyKey?: string | null; allowDuplicate?: boolean; method?: string }): Promise<LedgerWriteResult> {
  if (!(LEDGER_TYPES as readonly string[]).includes(e.entryType)) return { kind: "refused", code: "BAD_TYPE", messageHe: "סוג רשומה לא תקין", status: 400 };
  if (e.entryType === LEDGER_PAYMENT_TYPE) {
    const r = await recordArtistPayment({ artistId, amount: e.amount, date: e.entryDate, description: e.description, note: e.note, idempotencyKey: e.idempotencyKey, allowDuplicate: e.allowDuplicate, method: e.method });
    if (r.kind === "partial") return r;
    if (r.kind === "refused") return { kind: "refused", code: r.code, messageHe: r.messageHe, status: r.code === "NOT_FOUND" ? 404 : r.code === "DUPLICATE" ? 409 : 400 };
    const { data } = await supabase.from("artist_balance_entries").select("*").eq("id", r.ledgerEntryId).single();
    return { kind: "ok", entry: mapEntry(data as Record<string, unknown>) };
  }
  const { data, error } = await supabase.from("artist_balance_entries").insert({ artist_id: artistId, entry_type: e.entryType, amount: e.amount, entry_date: e.entryDate, description: e.description ?? "", note: e.note ?? "" }).select("*").single();
  if (error) throw new Error(error.message);
  return { kind: "ok", entry: mapEntry(data as Record<string, unknown>) };
}

/** The Finance row a ledger payment stands for (source_tx_id → an expense), if any. */
async function linkedPaymentTx(sourceTxId: string | null): Promise<{ id: string; payment_status: string } | null> {
  if (!sourceTxId) return null;
  const { data, error } = await supabase.from("transactions").select("id, type, payment_status").eq("id", sourceTxId).maybeSingle();
  if (error) throw new Error(error.message);
  return data && data.type === "expense" ? { id: String(data.id), payment_status: String(data.payment_status ?? "") } : null;
}

/** Update a ledger entry. A payment linked to its Finance row keeps both in step (amount / date); a payment's type is fixed. */
export async function updateLedgerEntryRecord(id: string, artistId: string, patch: { entryType: string; amount: number; entryDate: string; description: string; note: string }): Promise<LedgerWriteResult> {
  const { data: cur, error } = await supabase.from("artist_balance_entries").select("*").eq("id", id).eq("artist_id", artistId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!cur) return { kind: "refused", code: "NOT_FOUND", messageHe: "הרשומה לא נמצאה", status: 404 };
  if (!(LEDGER_TYPES as readonly string[]).includes(patch.entryType)) return { kind: "refused", code: "BAD_TYPE", messageHe: "סוג רשומה לא תקין", status: 400 };
  const wasPayment = cur.entry_type === LEDGER_PAYMENT_TYPE;
  if (wasPayment !== (patch.entryType === LEDGER_PAYMENT_TYPE)) return { kind: "refused", code: "PAYMENT_TYPE_FIXED", messageHe: "תשלום לאמן הוא כסף אמיתי: אי אפשר להפוך תשלום לסוג אחר או רשומה אחרת לתשלום — רושמים תשלום חדש / מבטלים את התשלום", status: 409 };
  const tx = wasPayment ? await linkedPaymentTx((cur.source_tx_id as string | null) ?? null) : null;
  if (tx) {
    const { error: tErr } = await supabase.from("transactions").update({ amount: patch.amount, date: patch.entryDate }).eq("id", tx.id);
    if (tErr) throw new Error(tErr.message);
  }
  const { data, error: uErr } = await supabase.from("artist_balance_entries").update({ entry_type: patch.entryType as LedgerType, amount: patch.amount, entry_date: patch.entryDate, description: patch.description ?? "", note: patch.note ?? "", updated_at: new Date().toISOString() })
    .eq("id", id).eq("artist_id", artistId).select("*");
  if (uErr) throw new Error(uErr.message);
  if (!data || !data.length) return { kind: "refused", code: "NOT_FOUND", messageHe: "הרשומה לא נמצאה", status: 404 };
  return { kind: "ok", entry: mapEntry(data[0] as Record<string, unknown>) };
}

/**
 * Delete a ledger entry (the Owner's explicit action). Cancelling a PAYMENT linked to its Finance row marks that row
 * "בוטל" with an audit note — a Finance transaction is never deleted here.
 */
export async function deleteLedgerEntryRecord(id: string, artistId: string): Promise<{ kind: "ok"; financeCancelled: string | null } | { kind: "not_found" }> {
  const { data: cur, error } = await supabase.from("artist_balance_entries").select("id, entry_type, source_tx_id").eq("id", id).eq("artist_id", artistId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!cur) return { kind: "not_found" };
  let financeCancelled: string | null = null;
  if (cur.entry_type === LEDGER_PAYMENT_TYPE) {
    const tx = await linkedPaymentTx((cur.source_tx_id as string | null) ?? null);
    if (tx && tx.payment_status !== "בוטל") {
      const { data: t } = await supabase.from("transactions").select("notes").eq("id", tx.id).maybeSingle();
      const note = `${String(t?.notes ?? "")}${t?.notes ? " | " : ""}התשלום בוטל במאזן האמן (${new Date().toISOString().slice(0, 10)}) — השורה נשמרת כהיסטוריה`;
      const { error: cErr } = await supabase.from("transactions").update({ payment_status: "בוטל", notes: note }).eq("id", tx.id);
      if (cErr) throw new Error(cErr.message);
      financeCancelled = tx.id;
    }
  }
  const { data: del, error: dErr } = await supabase.from("artist_balance_entries").delete().eq("id", id).eq("artist_id", artistId).select("id");
  if (dErr) throw new Error(dErr.message);
  return del && del.length ? { kind: "ok", financeCancelled } : { kind: "not_found" };
}

function mapEntry(db: Record<string, unknown>): Record<string, unknown> {
  return { id: db.id, artistId: db.artist_id, entryType: db.entry_type, amount: Number(db.amount) || 0, entryDate: db.entry_date, description: db.description ?? "", note: db.note ?? "", sourceTxId: db.source_tx_id ?? null, createdAt: db.created_at, updatedAt: db.updated_at };
}
