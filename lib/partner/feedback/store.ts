import "server-only";

/**
 * Redbloods Partner — Structured Owner Feedback persistence (Phase F.1B).
 * The ONLY file in lib/partner/feedback that touches Supabase: it binds the
 * append-only core (persistence.ts) to the existing server-side
 * service-role client. No API route, no UI and no cron import this yet.
 *
 * Exposes append + read only. There is intentionally no update / delete /
 * upsert / replace function — feedback history is append-only; a change of
 * mind is a new row with `supersedesId` (see persistence.ts, revisions.ts).
 *
 * Persisted feedback changes nothing else: no Case, detector, threshold,
 * Charter, Owner Rule, baseline or Agent Alert is touched here.
 */
import { supabase } from "@/lib/supabase";
import { createPartnerFeedbackStore, type FeedbackTableClient } from "./persistence";

// Narrowing view, not a widening: the core only ever sees select/eq/order/range/maybeSingle and insert→select→single
// (supabase-js's own builder chain). A direct structural check against supabase-js's generics trips TS2589.
const store = createPartnerFeedbackStore(supabase as unknown as FeedbackTableClient);

export const appendPartnerFeedback = store.appendPartnerFeedback;
export const listPartnerFeedback = store.listPartnerFeedback;
export const getFeedbackForCase = store.getFeedbackForCase;
export const getFeedbackForSubject = store.getFeedbackForSubject;
export const getFeedbackForCaseType = store.getFeedbackForCaseType;
export const resolveCurrentFeedbackRevision = store.resolveCurrentFeedbackRevision;

export {
  PartnerFeedbackStoreError,
  type AppendPartnerFeedbackInput, type AppendPartnerFeedbackOptions, type AppendPartnerFeedbackResult,
  type CurrentFeedbackFilter, type CurrentFeedbackResult, type FeedbackHistoryResult,
  type PartnerFeedbackStoreErrorCode, type RejectedFeedbackRow, type RevisionGraphDiagnostic,
} from "./persistence";
