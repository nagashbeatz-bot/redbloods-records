import "server-only";
import { supabase } from "./supabase";
import type { LabelMediaRecord, ArtistMediaSummary, MediaStatus, MediaRecordType, MediaAllocation } from "./types";
import { round2 } from "./label-clips";
import { MEDIA_RECOUP_TARGET } from "./label-agreements";
import { incomeKindOfSource, isRecordsIncomeKind, mediaAllocationsOf, mediaLabelShareByRule, type RecordsIncomeKind } from "./records-expense-share";

/**
 * Media income (Owner decision 2026-09-28; DB model applied 2026-09-29):
 *   ONE media income = ONE Finance transaction for the full amount (RECORDS) + 0..N artist ALLOCATIONS; each allocation =
 *   at most ONE artist-ledger entitlement. The allocations come from the rule (lib/records-expense-share
 *   mediaAllocationsOf) and are written by the RPCs only (create / update / cancel_label_media_income).
 *   A Finance transaction the income CREATED follows its lifecycle; the Owner's own linked transaction is never changed
 *   by media (a mismatch is refused — fix it in Finance first).
 *   LEGACY records (allocation_model = false, e.g. Mobile1 765.5) stay exactly as they were: no Finance link, no
 *   allocations, no backfill; their totals keep the pre-2026-09-29 reading (the rule over the stored 50 / 50).
 */
interface DbMedia {
  id: string; label_artist_id: string; record_type: string; reverses_id: string | null;
  gross_amount: number; source: string; report_period: string; received_date: string | null;
  status: string; notes: string; label_share: number; artist_share_gross: number;
  recoup_before: number; recouped: number; artist_payable: number; recoup_after: number;
  created_at: string; updated_at: string;
  income_kind: string | null; allocation_model: boolean | null; finance_transaction_id: string | null;
}
interface DbAlloc { id: string; media_income_id: string; artist_id: string; artist_pct: number; amount: number; status: string }

function mapMedia(db: DbMedia, reversalByOrig: Map<string, string>, allocs: DbAlloc[]): LabelMediaRecord {
  return {
    id: db.id,
    recordType: db.record_type as MediaRecordType,
    reversesId: db.reverses_id ?? null,
    grossAmount: Number(db.gross_amount),
    source: db.source, reportPeriod: db.report_period, receivedDate: db.received_date,
    status: db.status as MediaStatus, notes: db.notes,
    labelShare: Number(db.label_share), artistShareGross: Number(db.artist_share_gross),
    recoupBefore: Number(db.recoup_before), recouped: Number(db.recouped),
    artistPayable: Number(db.artist_payable), recoupAfter: Number(db.recoup_after),
    createdAt: db.created_at, updatedAt: db.updated_at,   // exact DB strings
    isReversed: reversalByOrig.has(db.id), reversalId: reversalByOrig.get(db.id) ?? null,
    primaryArtistId: db.label_artist_id,
    incomeKind: isRecordsIncomeKind(db.income_kind) ? db.income_kind : "DISTRIBUTION",
    allocationModel: db.allocation_model === true,
    financeTransactionId: db.finance_transaction_id ?? null,
    allocations: allocs.filter((a) => a.media_income_id === db.id).map((a): MediaAllocation => ({ id: a.id, artistId: a.artist_id, pct: Number(a.artist_pct), amount: Number(a.amount), status: a.status === "active" ? "active" : "inactive" })),
  };
}

// ── Read (service client SELECT only) ────────────────────────────────────────
/**
 * One artist's media: the records the artist OWNS (label_artist_id) plus the allocation-model incomes the artist is
 * allocated on. Summed across the roster nothing counts twice: an income's gross + Records share count on its OWNER only;
 * each artist counts only its own allocation.
 */
export async function getArtistMedia(artistId: string, artistName: string): Promise<ArtistMediaSummary> {
  const { data: mine, error: aErr } = await supabase.from("label_media_income_allocations").select("*").eq("artist_id", artistId);
  if (aErr) throw new Error(aErr.message);
  const allocatedIds = [...new Set(((mine ?? []) as DbAlloc[]).map((a) => a.media_income_id))];
  const { data: own, error } = await supabase.from("label_media_income").select("*").eq("label_artist_id", artistId).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  let rows = (own ?? []) as DbMedia[];
  const missing = allocatedIds.filter((id) => !rows.some((r) => r.id === id));
  if (missing.length) {
    const { data: extra, error: eErr } = await supabase.from("label_media_income").select("*").in("id", missing);
    if (eErr) throw new Error(eErr.message);
    rows = [...rows, ...((extra ?? []) as DbMedia[])].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  }
  const modelIds = rows.filter((r) => r.allocation_model && r.record_type === "income").map((r) => r.id);
  let allocs: DbAlloc[] = [];
  if (modelIds.length) {
    const { data: al, error: alErr } = await supabase.from("label_media_income_allocations").select("*").in("media_income_id", modelIds);
    if (alErr) throw new Error(alErr.message);
    allocs = (al ?? []) as DbAlloc[];
  }

  const reversalByOrig = new Map<string, string>();
  for (const r of rows) if (r.record_type === "reversal" && r.reverses_id) reversalByOrig.set(r.reverses_id, r.id);
  const records = rows.map((r) => mapMedia(r, reversalByOrig, allocs));

  // LEGACY records: the Records / artist split by the rule over the stored row (Owner decision 2026-09-28), as before
  const labelOf = (r: DbMedia) => mediaLabelShareByRule(r.source, artistName, Number(r.gross_amount)) ?? Number(r.label_share);
  const artistOf = (r: DbMedia) => { const l = mediaLabelShareByRule(r.source, artistName, Number(r.gross_amount)); return l === null ? Number(r.artist_share_gross) : round2(Number(r.gross_amount) - l); };
  let mediaGross = 0, labelShareReceived = 0, artistShareGross = 0, recoupedTotal = 0, artistPayableTotal = 0, labelShareExpected = 0, artistShareExpected = 0;
  for (const r of rows) {
    if (r.allocation_model) {
      // ALLOCATION model: a reversed income and its reversal cancel out → both skipped; a cancelled income counts nothing
      if (r.record_type === "reversal" || reversalByOrig.has(r.id) || r.status === "בוטל") continue;
      const owner = r.label_artist_id === artistId;
      const own = allocs.filter((a) => a.media_income_id === r.id && a.artist_id === artistId && a.status === "active").reduce((s, a) => s + Number(a.amount), 0);
      if (r.status === "התקבל") {
        if (owner) { mediaGross += Number(r.gross_amount); labelShareReceived += Number(r.label_share); }
        artistShareGross += own; artistPayableTotal += own;
      } else if (r.status === "צפוי") {
        if (owner) labelShareExpected += Number(r.label_share);
        artistShareExpected += own;
      }
      continue;
    }
    if (r.label_artist_id !== artistId) continue;
    if (r.status === "התקבל") {
      const s = r.record_type === "reversal" ? -1 : 1;   // signed by record_type
      mediaGross         += s * Number(r.gross_amount);
      labelShareReceived += s * labelOf(r);
      artistShareGross   += s * artistOf(r);
      recoupedTotal      += s * Number(r.recouped);
      artistPayableTotal += s * Number(r.artist_payable);
    } else if (r.status === "צפוי") {
      labelShareExpected  += labelOf(r);                    // expected income (never reversal)
      artistShareExpected += artistOf(r);
    }
  }

  // Owner model 2026-09-27: media is an INCOME split — no recoup target (stored snapshots stay history)
  return {
    records,
    totals: {
      mediaGross: round2(mediaGross), labelShareReceived: round2(labelShareReceived),
      artistShareGross: round2(artistShareGross), recoupedTotal: round2(recoupedTotal),
      artistPayableTotal: round2(artistPayableTotal), labelShareExpected: round2(labelShareExpected),
      artistShareExpected: round2(artistShareExpected),
    },
    recoupTarget: MEDIA_RECOUP_TARGET,
    recoupBalance: 0,
    artistCredit: 0,
  };
}

// ── Writes (RPC only — no direct insert/update/delete) ───────────────────────
export type MediaWriteResult = { ok: true; id: string } | { ok: false; code: string; message: string };

export interface MediaInput {
  grossAmount?: number; source?: string; reportPeriod?: string;
  receivedDate?: string | null; clearReceivedDate?: boolean; status?: string; notes?: string;
  /** the income kind; omitted on create = read from the source text (incomeKindOfSource) */
  incomeKind?: RecordsIncomeKind;
  /** the label artists credited on this income (ids); omitted on create = the owner artist alone */
  creditedArtistIds?: string[];
  /** one key per create request (a retry returns the same income — the DB key uq_lmi_request_key) */
  requestKey?: string;
  /** link the Owner's EXISTING Finance income instead of creating one (it must already match: income, ₪, same amount, RECORDS) */
  financeTransactionId?: string | null;
}

/** The allocations of a (new / re-priced) income: the rule over the credited artists' names — never a guessed split. */
async function allocationsFor(kind: RecordsIncomeKind, ownerId: string, creditedIds: readonly string[]): Promise<{ ok: true; allocations: Array<{ artist_id: string; artist_pct: number }> } | { ok: false; code: string; message: string }> {
  const ids = [...new Set([ownerId, ...creditedIds])];
  const { data, error } = await supabase.from("label_artists").select("id, name").in("id", ids);
  if (error) return { ok: false, code: "", message: error.message };
  const names = ids.map((id) => ((data ?? []) as Array<{ id: string; name: string }>).find((a) => a.id === id)?.name);
  if (names.some((n) => !n)) return { ok: false, code: "LM404", message: "אמן לא נמצא" };
  const plan = mediaAllocationsOf(kind, names as string[]);
  if (plan.status === "UNDEFINED") return { ok: false, code: "LM400", message: `אין חוק חלוקה להכנסה הזו — ${plan.reasonHe}` };
  return { ok: true, allocations: plan.allocations.map((a) => ({ artist_id: a.artistId, artist_pct: a.pct })) };
}

export async function createMedia(artistId: string, _artistName: string, input: MediaInput): Promise<MediaWriteResult> {
  const source = input.source ?? "Mobile1";
  const kind = input.incomeKind ?? incomeKindOfSource(source);
  const al = await allocationsFor(kind, artistId, input.creditedArtistIds ?? []);
  if (!al.ok) return al;
  const { data, error } = await supabase.rpc("create_label_media_income", {
    p_artist_id: artistId, p_recoup_target: MEDIA_RECOUP_TARGET, p_gross: input.grossAmount,
    p_source: source, p_report_period: input.reportPeriod ?? "",
    p_received_date: input.receivedDate ?? null, p_status: input.status ?? "התקבל", p_notes: input.notes ?? "",
    p_income_kind: kind, p_allocations: al.allocations,
    p_finance_transaction_id: input.financeTransactionId ?? null, p_request_key: input.requestKey ?? null,
  });
  if (error) return { ok: false, code: error.code ?? "", message: error.message };
  return { ok: true, id: data as string };
}

export async function updateMedia(
  recordId: string, artistId: string, _artistName: string, expectedUpdatedAt: string, input: MediaInput,
): Promise<MediaWriteResult> {
  // a new kind / new credits → the allocations are re-derived by the rule (the RPC refuses them on a LEGACY record)
  let pAllocations: Array<{ artist_id: string; artist_pct: number }> | null = null;
  if (input.incomeKind !== undefined || input.creditedArtistIds !== undefined) {
    const { data: cur, error: cErr } = await supabase.from("label_media_income").select("income_kind, source").eq("id", recordId).maybeSingle();
    if (cErr) return { ok: false, code: "", message: cErr.message };
    if (!cur) return { ok: false, code: "LM404", message: "הרשומה לא נמצאה" };
    const kind = input.incomeKind ?? (isRecordsIncomeKind(cur.income_kind) ? cur.income_kind : incomeKindOfSource(String(cur.source ?? "")));
    let credited = input.creditedArtistIds;
    if (credited === undefined) {
      const { data: al, error: aErr } = await supabase.from("label_media_income_allocations").select("artist_id").eq("media_income_id", recordId).eq("status", "active");
      if (aErr) return { ok: false, code: "", message: aErr.message };
      credited = ((al ?? []) as Array<{ artist_id: string }>).map((a) => a.artist_id);
    }
    const al = await allocationsFor(kind, artistId, credited);
    if (!al.ok) return al;
    pAllocations = al.allocations;
  }
  const { data, error } = await supabase.rpc("update_label_media_income", {
    p_record_id: recordId, p_artist_id: artistId, p_recoup_target: MEDIA_RECOUP_TARGET, p_expected_updated_at: expectedUpdatedAt,
    p_gross: input.grossAmount ?? null, p_source: input.source ?? null, p_report_period: input.reportPeriod ?? null,
    p_received_date: input.receivedDate ?? null, p_clear_received_date: input.clearReceivedDate ?? false,
    p_status: input.status ?? null, p_notes: input.notes ?? null,
    p_income_kind: input.incomeKind ?? null, p_allocations: pAllocations,
  });
  if (error) return { ok: false, code: error.code ?? "", message: error.message };
  return { ok: true, id: data as string };
}

export async function cancelMedia(recordId: string, artistId: string, expectedUpdatedAt: string): Promise<MediaWriteResult> {
  const { data, error } = await supabase.rpc("cancel_label_media_income", {
    p_record_id: recordId, p_artist_id: artistId, p_expected_updated_at: expectedUpdatedAt,
  });
  if (error) return { ok: false, code: error.code ?? "", message: error.message };
  return { ok: true, id: data as string };
}
