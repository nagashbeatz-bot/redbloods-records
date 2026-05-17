"use client";

import { useState } from "react";

interface Props {
  shareUrl: string | undefined;
  dropboxPath?: string;
  projectId?: string;
  size?: "sm" | "md";
  onShareUrlUpdate?: (url: string) => void;
}

export default function CopyLinkButton({ shareUrl, dropboxPath, projectId, size = "sm", onShareUrlUpdate }: Props) {
  const [copied,   setCopied]   = useState(false);
  const [creating, setCreating] = useState(false);
  const [error,    setError]    = useState("");
  const [localUrl, setLocalUrl] = useState(shareUrl ?? "");

  const currentUrl = localUrl || shareUrl || "";

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!currentUrl) return;
    await navigator.clipboard.writeText(currentUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCreate = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!dropboxPath || !projectId) return;
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/dropbox/share-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dropboxPath, projectId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה");
      setLocalUrl(data.shareUrl);
      onShareUrlUpdate?.(data.shareUrl);
      await navigator.clipboard.writeText(data.shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה");
      setTimeout(() => setError(""), 4000);
    } finally {
      setCreating(false);
    }
  };

  if (size === "sm") {
    // No URL yet — show "create" button
    if (!currentUrl) {
      if (!dropboxPath || !projectId) return null;
      return (
        <button
          onClick={creating ? undefined : handleCreate}
          title={error || (creating ? "יוצר לינק..." : "צור לינק שיתוף")}
          style={{
            width: 26, height: 26, borderRadius: "50%", border: "none",
            background: error ? "rgba(239,68,68,0.12)" : "rgba(255,255,255,0.04)",
            color: error ? "#EF4444" : "#555",
            cursor: creating ? "wait" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0, fontSize: 12, transition: "all 0.15s",
          }}
          onMouseEnter={(e) => { if (!creating && !error) { const b = e.currentTarget as HTMLButtonElement; b.style.background = "rgba(16,185,129,0.12)"; b.style.color = "#10B981"; }}}
          onMouseLeave={(e) => { if (!creating && !error) { const b = e.currentTarget as HTMLButtonElement; b.style.background = "rgba(255,255,255,0.04)"; b.style.color = "#555"; }}}
        >
          {creating ? "…" : error ? "!" : "🔗"}
        </button>
      );
    }

    return (
      <button
        onClick={handleCopy}
        title={copied ? "הועתק!" : "העתק לינק שיתוף"}
        style={{
          width: 26, height: 26, borderRadius: "50%", border: "none",
          background: copied ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.04)",
          color: copied ? "#10B981" : "#555",
          cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0, fontSize: copied ? 11 : 12, transition: "all 0.15s",
        }}
        onMouseEnter={(e) => { if (!copied) { const b = e.currentTarget as HTMLButtonElement; b.style.background = "rgba(16,185,129,0.12)"; b.style.color = "#10B981"; }}}
        onMouseLeave={(e) => { if (!copied) { const b = e.currentTarget as HTMLButtonElement; b.style.background = "rgba(255,255,255,0.04)"; b.style.color = "#555"; }}}
      >
        {copied ? "✓" : "🔗"}
      </button>
    );
  }

  // md size
  if (!currentUrl) {
    if (!dropboxPath || !projectId) return null;
    return (
      <button
        onClick={creating ? undefined : handleCreate}
        style={{
          display: "flex", alignItems: "center", gap: 5,
          padding: "5px 12px", borderRadius: 8,
          border: `1px solid ${error ? "rgba(239,68,68,0.35)" : "#2A2A2A"}`,
          background: error ? "rgba(239,68,68,0.08)" : "transparent",
          color: error ? "#EF4444" : "#666",
          cursor: creating ? "wait" : "pointer", fontSize: 11, fontFamily: "inherit",
          transition: "all 0.15s", whiteSpace: "nowrap",
        }}
      >
        {creating ? "יוצר לינק…" : error ? "שגיאה — נסה שוב" : "🔗 צור לינק"}
      </button>
    );
  }

  return (
    <button
      onClick={handleCopy}
      style={{
        display: "flex", alignItems: "center", gap: 5,
        padding: "5px 12px", borderRadius: 8,
        border: `1px solid ${copied ? "rgba(16,185,129,0.35)" : "#2A2A2A"}`,
        background: copied ? "rgba(16,185,129,0.08)" : "transparent",
        color: copied ? "#10B981" : "#666",
        cursor: "pointer", fontSize: 11, fontFamily: "inherit",
        transition: "all 0.15s", whiteSpace: "nowrap",
      }}
    >
      {copied ? "✓ הועתק!" : "🔗 העתק לינק"}
    </button>
  );
}
