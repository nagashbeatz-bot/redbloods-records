"use client";

import { useState, useEffect, useCallback } from "react";
import type { SocialCampaign, SocialContentItem } from "@/lib/types";

export function useSocialCampaigns() {
  const [campaigns, setCampaigns] = useState<SocialCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/social/campaigns");
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "שגיאה"); return; }
      setCampaigns(data.campaigns ?? []);
    } catch {
      setError("שגיאת רשת");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function createCampaign(input: Partial<SocialCampaign>) {
    const res = await fetch("/api/social/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "failed");
    await load();
    return data.campaign as SocialCampaign;
  }

  async function updateCampaign(id: string, patch: Partial<SocialCampaign>) {
    const res = await fetch(`/api/social/campaigns/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "failed");
    setCampaigns((prev) => prev.map((c) => (c.id === id ? data.campaign : c)));
    return data.campaign as SocialCampaign;
  }

  async function deleteCampaign(id: string) {
    const res = await fetch(`/api/social/campaigns/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("failed");
    setCampaigns((prev) => prev.filter((c) => c.id !== id));
  }

  return { campaigns, loading, error, createCampaign, updateCampaign, deleteCampaign, reload: load };
}

export function useSocialContent(campaignId: string) {
  const [items, setItems] = useState<SocialContentItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!campaignId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/social/content?campaignId=${campaignId}`);
      const data = await res.json();
      setItems(data.items ?? []);
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => { load(); }, [load]);

  async function addItem(input: Partial<SocialContentItem>) {
    const res = await fetch("/api/social/content", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, campaign_id: campaignId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "failed");
    setItems((prev) => [...prev, data.item]);
    return data.item as SocialContentItem;
  }

  async function updateItem(id: string, patch: Partial<SocialContentItem>) {
    const res = await fetch(`/api/social/content/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "failed");
    setItems((prev) => prev.map((i) => (i.id === id ? data.item : i)));
    return data.item as SocialContentItem;
  }

  async function deleteItem(id: string) {
    await fetch(`/api/social/content/${id}`, { method: "DELETE" });
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  return { items, loading, addItem, updateItem, deleteItem, reload: load };
}
