import "server-only";
import { supabase } from "./supabase";
import type { LabelMediaRecord, ArtistMediaSummary, MediaStatus, MediaRecordType } from "./types";
import { getRecoupTargetForArtist, round2 } from "./label-clips";

interface DbMedia {
  id: string; label_artist_id: string; record_type: string; reverses_id: string | null;
  gross_amount: number; source: string; report_period: string; received_date: string | null;
  status: string; notes: string; label_share: number; artist_share_gross: number;
  recoup_before: number; recouped: number; artist_payable: number; recoup_after: number;
  created_at: string; updated_at: string;
}

function mapMedia(db: DbMedia, reversalByOrig: Map<string, string>): LabelMediaRecord {
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
  };
}

// ── Read (service client SELECT only) ────────────────────────────────────────
export async function getArtistMedia(artistId: string, artistName: string): Promise<ArtistMediaSummary> {
  const { data, error } = await supabase
    .from("label_media_income")
    .select("*")
    .eq("label_artist_id", artistId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as DbMedia[];

  const reversalByOrig = new Map<string, string>();
  for (const r of rows) if (r.record_type === "reversal" && r.reverses_id) reversalByOrig.set(r.reverses_id, r.id);
  const records = rows.map((r) => mapMedia(r, reversalByOrig));

  let mediaGross = 0, labelShareReceived = 0, artistShareGross = 0, recoupedTotal = 0, artistPayableTotal = 0, labelShareExpected = 0, artistShareExpected = 0;
  for (const r of rows) {
    if (r.status === "התקבל") {
      const s = r.record_type === "reversal" ? -1 : 1;   // signed by record_type
      mediaGross         += s * Number(r.gross_amount);
      labelShareReceived += s * Number(r.label_share);
      artistShareGross   += s * Number(r.artist_share_gross);
      recoupedTotal      += s * Number(r.recouped);
      artistPayableTotal += s * Number(r.artist_payable);
    } else if (r.status === "צפוי") {
      labelShareExpected  += Number(r.label_share);         // expected income (never reversal)
      artistShareExpected += Number(r.artist_share_gross);  // feeds projected recoup (never reversal)
    }
  }

  const recoupTarget = await getRecoupTargetForArtist(artistName);
  const recouped = round2(recoupedTotal);
  return {
    records,
    totals: {
      mediaGross: round2(mediaGross), labelShareReceived: round2(labelShareReceived),
      artistShareGross: round2(artistShareGross), recoupedTotal: recouped,
      artistPayableTotal: round2(artistPayableTotal), labelShareExpected: round2(labelShareExpected),
      artistShareExpected: round2(artistShareExpected),
    },
    recoupTarget,
    recoupBalance: Math.max(0, round2(recoupTarget - recouped)),
    artistCredit: Math.max(0, round2(recouped - recoupTarget)),
  };
}

// ── Writes (RPC only — no direct insert/update/delete) ───────────────────────
export type MediaWriteResult = { ok: true; id: string } | { ok: false; code: string; message: string };

export interface MediaInput {
  grossAmount?: number; source?: string; reportPeriod?: string;
  receivedDate?: string | null; clearReceivedDate?: boolean; status?: string; notes?: string;
}

export async function createMedia(artistId: string, artistName: string, input: MediaInput): Promise<MediaWriteResult> {
  const recoupTarget = await getRecoupTargetForArtist(artistName);
  const { data, error } = await supabase.rpc("create_label_media_income", {
    p_artist_id: artistId, p_recoup_target: recoupTarget, p_gross: input.grossAmount,
    p_source: input.source ?? "Mobile1", p_report_period: input.reportPeriod ?? "",
    p_received_date: input.receivedDate ?? null, p_status: input.status ?? "התקבל", p_notes: input.notes ?? "",
  });
  if (error) return { ok: false, code: error.code ?? "", message: error.message };
  return { ok: true, id: data as string };
}

export async function updateMedia(
  recordId: string, artistId: string, artistName: string, expectedUpdatedAt: string, input: MediaInput,
): Promise<MediaWriteResult> {
  const recoupTarget = await getRecoupTargetForArtist(artistName);
  const { data, error } = await supabase.rpc("update_label_media_income", {
    p_record_id: recordId, p_artist_id: artistId, p_recoup_target: recoupTarget, p_expected_updated_at: expectedUpdatedAt,
    p_gross: input.grossAmount ?? null, p_source: input.source ?? null, p_report_period: input.reportPeriod ?? null,
    p_received_date: input.receivedDate ?? null, p_clear_received_date: input.clearReceivedDate ?? false,
    p_status: input.status ?? null, p_notes: input.notes ?? null,
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
