/**
 * Shared label writers — used by BOTH the label routes and Sunny's typed primitives. Two Owner push buttons moved here
 * verbatim from their routes (the push contracts P_CYCLE_REMIND / P_SKETCH_NOTIFY_MANUAL point at this module now):
 *   • sendCycleReminder — the balance-cycle reminder to the Owner and / or the artist's push role;
 *   • notifySketchToArtist — the manual "new / updated sketch" push to the artist (Avi / Shalev only) + the Owner.
 * Plus narrow readers used by the typed primitives (one ledger entry, one media record, the portal slug).
 * Known, reported (not changed here): neither push has a production-only guard; the cycle reminder's artist link always
 * opens /red-artists?tab=balance.
 */
import { supabase } from "@/lib/supabase";
import { getLabelArtist } from "@/lib/label-artists-store";
import { listArtistBalanceEntries } from "@/lib/artist-balance-store";
import { getBalanceCycleState, cycleClosingLine } from "@/lib/artist-balance-cycles-store";
import { sendPushToRoles } from "@/lib/push";
import { classifyPushResult } from "@/lib/shalev-weekly-pure";
import { AVI_NAME, SHALEV_NAME } from "@/lib/red-artists/portal-registry";
import type { Sketch } from "@/lib/red-artists/sketches-store";

/** The LABEL artists with a push role (kept in lockstep by name with the portal page constants). DJ CLEANTONE is team
 *  (the label's DJ), not a label artist (Owner decision 2026-09-27): he never receives an artist cycle reminder. */
export function artistPushRole(artistName: string): string | null {
  if (artistName === "שליו טסמה") return "shalev";
  if (artistName === "אבי מולה") return "avi";
  return null;
}

export type CycleReminderResult = { kind: "not_found" } | { kind: "no_recipient" } | { kind: "no_cycle" } | { kind: "ok"; ownerSent: boolean; artistSent: boolean; artistSkipped?: string };

export async function sendCycleReminder(id: string, toOwner: boolean, toArtist: boolean): Promise<CycleReminderResult> {
  const artist = await getLabelArtist(id);
  if (!artist) return { kind: "not_found" };
  if (!toOwner && !toArtist) return { kind: "no_recipient" };
  const entries = await listArtistBalanceEntries(id);
  const state = await getBalanceCycleState(id, entries);
  if (!state.anchorDate || !state.current) return { kind: "no_cycle" };
  const c = state.current;
  const closingLine = cycleClosingLine(c.daysUntilClose);
  const dateRange = `${c.startDate.split("-").reverse().join(".")} - ${c.endDate.split("-").reverse().join(".")}`;
  const firstName = artist.name.split(" ")[0];
  let ownerSent = false, artistSent = false, artistSkipped: string | undefined;
  if (toOwner) {
    const results = await sendPushToRoles(["owner"], { title: `המחזור הכספי של ${firstName} ${closingLine}`, body: dateRange, url: `/label/artists/${id}?tab=balance`, tag: `financial-cycle-reminder-owner-${id}-${c.index}` });
    ownerSent = results.some((r) => r.status === "fulfilled");
  }
  if (toArtist) {
    const role = artistPushRole(artist.name);
    if (!role) artistSkipped = "לא נמצא ערוץ התראות עבור אמן זה";
    else {
      const results = await sendPushToRoles([role], { title: `המחזור הכספי שלך מול Redbloods ${closingLine}`, body: dateRange, url: "/red-artists?tab=balance", tag: `financial-cycle-reminder-artist-${id}-${c.index}` });
      artistSent = results.some((r) => r.status === "fulfilled");
    }
  }
  return { kind: "ok", ownerSent, artistSent, artistSkipped };
}

interface NotifyTarget { role: string; keyPrefix: string; artistUrl: (artistId: string) => string; body: (sketch: Sketch) => string }
/** Explicit per-artist map — never derived from a generic role. Avi's keys are unchanged from the original. */
export const SKETCH_NOTIFY_TARGETS: Record<string, NotifyTarget> = {
  [AVI_NAME]: { role: "avi", keyPrefix: "avi", artistUrl: (artistId) => `/label/artists/${artistId}?tab=music`, body: (s) => `הועלתה סקיצה חדשה ל"${s.title}" - סקיצה ${s.latestVersion} 🎵` },
  [SHALEV_NAME]: { role: "shalev", keyPrefix: "shalev", artistUrl: () => "/red-artists?tab=music", body: (s) => `הסקיצה בפרויקט „${s.title}” עודכנה 🎵` },
};

/** The manual sketch push (the artist's role + the Owner; the number always derived from the manifest). */
export async function notifySketchToArtist(artistId: string, artistName: string, sketch: Sketch): Promise<{ kind: "not_enabled" } | { kind: "ok"; artistSent: boolean; ownerSent: boolean }> {
  const target = SKETCH_NOTIFY_TARGETS[artistName];
  if (!target) return { kind: "not_enabled" };
  const shared = { title: "Redbloods Records", body: target.body(sketch), tag: `sketch-${target.keyPrefix}-notify-${sketch.id}-${sketch.latestVersion}`, eventId: `sketch_${target.keyPrefix}_notify:${sketch.id}:${sketch.latestVersion}`, entityType: "sketch", entityId: sketch.id };
  const artistRes = await sendPushToRoles([target.role], { ...shared, url: target.artistUrl(artistId) });
  const ownerRes = await sendPushToRoles(["owner"], { ...shared, url: `/label/artists/${artistId}?tab=music` });
  return { kind: "ok", artistSent: classifyPushResult(artistRes) === "sent", ownerSent: classifyPushResult(ownerRes) === "sent" };
}

/** One ledger entry of one artist (the typed primitives' reader). */
export async function readLedgerEntry(entryId: string): Promise<{ artistId: string; entryType: string; amount: number; entryDate: string; description: string; note: string; sourceShowId: string | null; sourceTxId: string | null } | null> {
  const { data, error } = await supabase.from("artist_balance_entries").select("*").eq("id", entryId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return { artistId: String(data.artist_id), entryType: String(data.entry_type), amount: Number(data.amount) || 0, entryDate: String(data.entry_date ?? ""), description: String(data.description ?? ""), note: String(data.note ?? ""), sourceShowId: (data.source_show_id as string | null) ?? null, sourceTxId: (data.source_tx_id as string | null) ?? null };
}

/** One media-income record (the typed primitives' reader; updated_at is the RPC's concurrency token). */
export async function readMediaRecord(recordId: string): Promise<{ artistId: string; grossAmount: number; source: string; reportPeriod: string; receivedDate: string | null; status: string; notes: string; updatedAt: string; incomeKind: string; allocationModel: boolean; financeTransactionId: string | null } | null> {
  const { data, error } = await supabase.from("label_media_income").select("*").eq("id", recordId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  // the owner column is label_artist_id (fixed 2026-09-29: it read a non-existent artist_id, so every Sunny media
  // update / cancel was refused by the RPC as "not this artist's record")
  return { artistId: String(data.label_artist_id), grossAmount: Number(data.gross_amount) || 0, source: String(data.source ?? ""), reportPeriod: String(data.report_period ?? ""), receivedDate: (data.received_date as string | null) ?? null, status: String(data.status ?? ""), notes: String(data.notes ?? ""), updatedAt: String(data.updated_at ?? ""), incomeKind: String(data.income_kind ?? "DISTRIBUTION"), allocationModel: data.allocation_model === true, financeTransactionId: (data.finance_transaction_id as string | null) ?? null };
}

/** POST /api/beats/[id]/assignments semantics: read BEFORE the write so the artist is notified exactly once, and only
 *  on a brand-new, persisted assignment. */
export async function assignBeatWithNotify(beatId: string, slug: string): Promise<{ artistSlugs: string[]; notification: unknown }> {
  const { getBeat, isBeatAssignedTo, assignBeatToArtist, listBeatAssignments } = await import("@/lib/beats-store");
  const beat = await getBeat(beatId);
  if (!beat) throw new Error("beat not found");
  const alreadyAssigned = await isBeatAssignedTo(beatId, slug);
  await assignBeatToArtist(beatId, slug);
  const artistSlugs = await listBeatAssignments(beatId);
  let notification: unknown = null;
  if (!alreadyAssigned && artistSlugs.includes(slug)) {
    const { notifyBeatAssigned } = await import("@/lib/beat-notify");
    notification = await notifyBeatAssigned(beat, slug);
  }
  return { artistSlugs, notification };
}
