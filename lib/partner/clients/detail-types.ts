/**
 * Sunny CLIENT_DETAIL source — the typed shape (pure, no runtime imports). Filled by detail-reader.ts.
 * What the company read did not already carry about clients: stored contact details and notes, and the free-text
 * side of income / expense rows that have NO project (their only link to a client is the artist text).
 * Meetings, tasks, proposal notes and project-linked transaction text come from PROJECT_DETAIL (read once).
 */
import type { Maybe } from "../operations/types";

export interface DetailClient { id: string; name: string; type: string | null; status: string | null; phone: string | null; email: string | null; notes: string | null; createdAt: string | null }
/** A transaction with no project_id — money state comes from the Finance Brain (joined by id); this is its text. */
export interface DetailUnlinkedTransactionText { id: string; type: string | null; date: string | null; description: string | null; notes: string | null; artistText: string | null; paymentMethod: string | null; hasReceipt: boolean; createdAt: string | null }

export interface ClientDetailRaw {
  clients: Maybe<DetailClient>;
  unlinkedTransactionsText: Maybe<DetailUnlinkedTransactionText>;
}

/** Every table the client detail source reads — the coverage test compares it with the client contract. */
export const CLIENT_DETAIL_SOURCES = ["clients", "transactions:project_id IS NULL"] as const;
