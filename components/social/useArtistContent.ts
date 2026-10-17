"use client";

/**
 * Stage 1 (2026-10-17): one label artist's own content — the SAME /api/social/content routes and shared writer as the
 * campaign page (useSocialContent). An item created here belongs to the artist (label_artist_id), with no campaign.
 */
import { useCallback, useEffect, useState } from "react";
import type { SocialContentItem } from "@/lib/types";

export function useArtistContent(labelArtistId: string) {
  const [items, setItems] = useState<SocialContentItem[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(async () => {
    setState("loading");
    try {
      const res = await fetch(`/api/social/content?labelArtistId=${encodeURIComponent(labelArtistId)}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "failed");
      setItems(data.items ?? []);
      setState("ready");
    } catch { setState("error"); }
  }, [labelArtistId]);

  useEffect(() => { load(); }, [load]);

  async function addItem(input: Partial<SocialContentItem>) {
    const res = await fetch("/api/social/content", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, label_artist_id: labelArtistId }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "failed");
    setItems((prev) => [...prev, data.item]);
    return data.item as SocialContentItem;
  }
  async function updateItem(id: string, patch: Partial<SocialContentItem>) {
    const res = await fetch(`/api/social/content/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "failed");
    setItems((prev) => prev.map((i) => (i.id === id ? data.item : i)));
    return data.item as SocialContentItem;
  }
  async function deleteItem(id: string) {
    const res = await fetch(`/api/social/content/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("failed");
    setItems((prev) => prev.filter((i) => i.id !== id));
  }
  return { items, state, addItem, updateItem, deleteItem, reload: load };
}
