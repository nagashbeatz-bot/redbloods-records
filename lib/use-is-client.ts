"use client";

import { useSyncExternalStore } from "react";

const subscribeNoop = () => () => {};

/**
 * false during SSR and the hydration pass, true on the client right after.
 * Gate `createPortal(…, document.body)` on it: the portal target only exists in
 * the browser, and rendering a portal during hydration would mismatch the server
 * HTML. useSyncExternalStore (not useEffect+setState) so the flip is part of the
 * same commit — no extra effect-driven render and no flash.
 */
export function useIsClient(): boolean {
  return useSyncExternalStore(subscribeNoop, () => true, () => false);
}
