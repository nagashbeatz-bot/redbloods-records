/**
 * Sunny LABEL_DETAIL source — the typed shape (pure). Filled by detail-reader.ts.
 * What the company read did not already carry about label artists: the full artist record, every ledger entry with
 * its text and source links, full balance-cycle snapshots, full media-income rows (shares + recoupment + reversals),
 * beat file metadata and assignments, and the full show record (fees, advance, linked finance rows, booker, place).
 * Every other artist-related domain (projects, releases, Victor, Steven / mix, sessions, clips, Red Films, social,
 * tasks, meetings, settings, calendar) comes from the sources that already read it — read once, never copied.
 */
import type { Maybe } from "../operations/types";

export interface DetailLabelArtist { id: string; name: string; status: string | null; hasImage: boolean; notes: string | null; createdAt: string | null; updatedAt: string | null }
export interface DetailLedgerEntry { id: string; artistId: string; entryType: string | null; amount: number | null; entryDate: string | null; description: string | null; note: string | null; sourceTxId: string | null; sourceShowId: string | null; createdAt: string | null; updatedAt: string | null }
export interface DetailBalanceCycle { id: string; artistId: string; cycleIndex: number | null; startDate: string | null; endDate: string | null; income: number | null; expectedIncome: number | null; payments: number | null; expenses: number | null; expectedExpenses: number | null; endingBalance: number | null; closedAt: string | null }
export interface DetailMediaIncome { id: string; artistId: string; recordType: string | null; reversesId: string | null; grossAmount: number | null; source: string | null; reportPeriod: string | null; receivedDate: string | null; status: string | null; notes: string | null; labelShare: number | null; artistShareGross: number | null; recoupBefore: number | null; recouped: number | null; artistPayable: number | null; recoupAfter: number | null; createdAt: string | null; updatedAt: string | null }
export interface DetailBeat { id: string; name: string; genre: string | null; musicalKey: string | null; status: string | null; fileName: string | null; path: string | null; durationSeconds: number | null; createdAt: string | null; assignedTo: Array<{ artistSlug: string; at: string | null }> }
export interface DetailShow {
  id: string; name: string | null; artistText: string | null; date: string | null; startTime: string | null; location: string | null; contactPerson: string | null; hasPhone: boolean;
  status: string | null; paymentStatus: string | null; price: number | null; djFee: number | null; artistFee: number | null; advancePayment: number | null; notes: string | null;
  artistClientId: string | null; bookerClientId: string | null; bookerName: string | null; djClientId: string | null; djName: string | null; djConfirmationStatus: string | null; djConfirmedAt: string | null;
  hasCalendarEvent: boolean; incomeTxId: string | null; djExpenseTxId: string | null; artistExpenseTxId: string | null; createdAt: string | null; updatedAt: string | null;
}

export interface LabelDetailRaw {
  artists: Maybe<DetailLabelArtist>;
  ledger: Maybe<DetailLedgerEntry>;
  cycles: Maybe<DetailBalanceCycle>;
  mediaIncome: Maybe<DetailMediaIncome>;
  beats: Maybe<DetailBeat>;
  shows: Maybe<DetailShow>;
}

/** Every table the label detail source reads — the coverage test compares it with the artist contract. */
export const LABEL_DETAIL_SOURCES = ["label_artists", "artist_balance_entries", "artist_balance_cycles", "label_media_income", "beats", "beat_artist_assignments", "shows"] as const;
