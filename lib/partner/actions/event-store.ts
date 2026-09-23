import "server-only";

/**
 * Redbloods Partner — Action Event store binding (Phase F.1H). The ONLY file
 * that binds the append-only core (event-persistence.ts) to the existing
 * server-side service-role client. No route, UI, cron or agent imports it.
 * Exposes reads, Owner-decision append and the approved execution RPC only.
 */
import { supabase } from "@/lib/supabase";
import { createActionEventStore, type ActionEventTableClient } from "./event-persistence";

// Narrowing view, not a widening: the core only uses select/eq/order/range, insert→select→single and one rpc.
export const actionEventStore = createActionEventStore(supabase as unknown as ActionEventTableClient);
