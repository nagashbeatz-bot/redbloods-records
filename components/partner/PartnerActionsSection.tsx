"use client";

/**
 * Redbloods Partner — Owner-only, READ-ONLY Suggested Action surface on the
 * dashboard (Phase F.1I). Fetches GET /api/partner/actions, parses the payload
 * strictly (fail closed) and renders only what the server surfaced as SHOW.
 * No decision / execution calls exist here; loading, errors and "nothing to
 * show" all render nothing, so the rest of the dashboard is never affected.
 */
import { useEffect, useState } from "react";
import { useRole } from "@/lib/use-role";
import { parseActionSurfaceResponse, type PartnerActionCardDto } from "@/lib/partner/actions/surface-dto";
import { PartnerActionsView } from "./PartnerActionCard";

export default function PartnerActionsSection({ isMobile }: { isMobile: boolean }) {
  const role = useRole();
  const [items, setItems] = useState<PartnerActionCardDto[]>([]);

  useEffect(() => {
    if (role !== "owner") return;
    const ac = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/partner/actions", { cache: "no-store", signal: ac.signal });
        if (!res.ok) { setItems([]); return; }
        const parsed = parseActionSurfaceResponse(await res.json());
        if (!parsed.ok) { console.warn("[partner-actions] malformed surface payload — not rendered"); setItems([]); return; }
        setItems(parsed.items);
      } catch (e) {
        if ((e as { name?: string }).name !== "AbortError") setItems([]);
      }
    })();
    return () => ac.abort();
  }, [role]);

  // UI gate only — the route itself enforces requireOwner().
  if (role !== "owner") return null;
  return <PartnerActionsView items={items} isMobile={isMobile} />;
}
