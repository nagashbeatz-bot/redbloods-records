import "server-only";

/**
 * Redbloods Partner — Owner Context persistence (Phase F.1E). The ONLY file
 * in lib/partner/investigation that touches Supabase: binds the append-only
 * core (context-persistence.ts) to the existing server-side service-role
 * client. No API route, UI, cron or AI layer imports this yet.
 *
 * Exposes append + read only. There is intentionally no update / delete /
 * upsert / replace function — a changed answer is a new row with
 * `supersedesId` (see context-persistence.ts).
 *
 * Persisted Owner Context changes nothing else: no Case, detector,
 * threshold, Charter item, Owner Rule, baseline, feedback row or Agent Alert
 * is touched here.
 */
import { supabase } from "@/lib/supabase";
import { createOwnerContextStore, type OwnerContextTableClient } from "./context-persistence";

// Narrowing view, not a widening: the core only ever uses select/eq/order/range/maybeSingle and insert→select→single
// (supabase-js's own builder chain). A direct structural check against supabase-js's generics trips TS2589.
const store = createOwnerContextStore(supabase as unknown as OwnerContextTableClient);

export const appendOwnerContext = store.appendOwnerContext;
export const listOwnerContexts = store.listOwnerContexts;
export const getContextsForQuestion = store.getContextsForQuestion;
export const getContextsForCase = store.getContextsForCase;
export const getContextsForSubject = store.getContextsForSubject;
export const getContextsForCaseType = store.getContextsForCaseType;
export const resolveCurrentOwnerContexts = store.resolveCurrentOwnerContexts;
export const getCurrentContextForQuestion = store.getCurrentContextForQuestion;

export {
  OwnerContextStoreError, buildOwnerContextDraft,
  type OwnerContextDraft, type OwnerContextFilter, type OwnerContextHistoryResult, type CurrentOwnerContextsResult,
  type CurrentContextForQuestionResult, type OwnerContextStoreErrorCode, type RejectedContextRow, type ContextGraphDiagnostic,
} from "./context-persistence";
export type { PersistedOwnerContext } from "./context-row";
