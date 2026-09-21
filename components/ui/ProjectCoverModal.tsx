"use client";

// "עיצוב תמונת נושא" — the owner's editor for a project's cover. Deliberately small:
// big preview · theme gallery · one upload · save / cancel / reset. No crop, filters,
// history or AI. Writes go to /api/projects/[id]/cover (owner-only); the image is
// resized in the browser to ≤1200px JPEG first, so the same file serves the hero and
// every thumbnail.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ProjectCover from "@/components/ui/ProjectCover";
import {
  COVER_CHANGED_EVENT, COVER_THEMES, DEFAULT_COVER_THEME,
  type CoverThemeId, type ProjectCoverConfig,
} from "@/lib/project-cover";

interface Props {
  projectId: string;
  name: string;
  cover?: ProjectCoverConfig | null;
  onClose: () => void;
  /** Called after a successful save/reset — the caller refreshes its project list. */
  onSaved: () => void | Promise<void>;
}

type Draft =
  | { kind: "theme"; theme: CoverThemeId }
  | { kind: "keep" }                                   // existing custom image, untouched
  | { kind: "upload"; blob: Blob; url: string };       // new image, not yet saved

const MAX_EDGE = 1200;
const SERVER_MAX = 3 * 1024 * 1024;
const RAW_MAX = 30 * 1024 * 1024;

async function resizeToJpeg(file: File): Promise<Blob> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("decode"));
      i.src = objectUrl;
    });
    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");
    ctx.fillStyle = "#0c0c0e"; // PNG transparency → dark, never black-on-black surprises
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    for (const q of [0.86, 0.72, 0.58]) {
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", q));
      if (blob && blob.size <= SERVER_MAX) return blob;
    }
    throw new Error("too large");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

const RED = "#DC2626";
const TXT = "#F4F4F4";
const SUB = "rgba(255,255,255,0.62)";
const LINE = "rgba(255,255,255,0.09)";

export default function ProjectCoverModal({ projectId, name, cover, onClose, onSaved }: Props) {
  const initial: Draft = cover?.customImage ? { kind: "keep" } : { kind: "theme", theme: cover?.theme ?? DEFAULT_COVER_THEME };
  const [draft, setDraft] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Revoke the preview URL of a replaced/discarded upload.
  const uploadUrl = draft.kind === "upload" ? draft.url : null;
  useEffect(() => () => { if (uploadUrl) URL.revokeObjectURL(uploadUrl); }, [uploadUrl]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const changed =
    draft.kind === "upload" ||
    (draft.kind === "theme" && (!!cover?.customImage || draft.theme !== (cover?.theme ?? DEFAULT_COVER_THEME)));

  // What the preview draws for the current draft.
  const previewCover: ProjectCoverConfig | null =
    draft.kind === "keep" ? (cover ?? null)
    : draft.kind === "upload" ? { theme: cover?.theme ?? DEFAULT_COVER_THEME, customImage: true, updatedAt: "draft" }
    : { theme: draft.theme, customImage: false, updatedAt: null };
  const previewSrc = draft.kind === "upload" ? draft.url : draft.kind === "theme" ? null : undefined;

  async function pickFile(file: File | undefined) {
    if (!file) return;
    setErr(null);
    if (!file.type.startsWith("image/")) { setErr("צריך לבחור קובץ תמונה"); return; }
    if (file.size > RAW_MAX) { setErr("הקובץ גדול מדי"); return; }
    setReading(true);
    try {
      const blob = await resizeToJpeg(file);
      setDraft({ kind: "upload", blob, url: URL.createObjectURL(blob) });
    } catch {
      setErr("לא ניתן לקרוא את התמונה. נסה קובץ JPG / PNG / WebP אחר.");
    } finally {
      setReading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function finish() {
    window.dispatchEvent(new CustomEvent(COVER_CHANGED_EVENT, { detail: projectId }));
    await onSaved();
    onClose();
  }

  async function request(init: RequestInit): Promise<void> {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/cover`, init);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(typeof d?.error === "string" ? d.error : "הפעולה נכשלה");
    }
  }

  async function save() {
    if (!changed || busy) return;
    setBusy(true); setErr(null);
    try {
      if (draft.kind === "upload") {
        const fd = new FormData();
        fd.append("file", new File([draft.blob], "cover.jpg", { type: "image/jpeg" }));
        await request({ method: "PUT", body: fd });
      } else if (draft.kind === "theme") {
        await request({ method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ theme: draft.theme }) });
      }
      await finish();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "השמירה נכשלה");
      setBusy(false);
    }
  }

  async function reset() {
    if (!confirmReset) { setConfirmReset(true); return; }
    setBusy(true); setErr(null);
    try {
      await request({ method: "DELETE" });
      await finish();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "האיפוס נכשל");
      setBusy(false);
    }
  }

  const btn = (primary: boolean, disabled: boolean): React.CSSProperties => ({
    fontFamily: "inherit", fontSize: 13.5, fontWeight: 800, borderRadius: 11, padding: "10px 22px",
    cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1,
    color: primary ? "#fff" : SUB, background: primary ? RED : "rgba(255,255,255,0.05)",
    border: primary ? "none" : `1px solid ${LINE}`,
  });

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 199999, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
      <div onClick={() => { if (!busy) onClose(); }} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.72)", backdropFilter: "blur(4px)" }} />
      <div
        dir="rtl" role="dialog" aria-modal="true" aria-label="עיצוב תמונת נושא"
        style={{
          position: "relative", width: 560, maxWidth: "100%", maxHeight: "94vh", overflowY: "auto", boxSizing: "border-box",
          borderRadius: 22, padding: "22px 24px 20px", color: TXT, fontFamily: "inherit",
          background: "linear-gradient(160deg, #14141B 0%, #0D0D12 100%)",
          border: "1px solid rgba(220,38,38,0.28)", boxShadow: "0 32px 80px rgba(0,0,0,0.85)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{ fontSize: 18, fontWeight: 900 }}>עיצוב תמונת נושא</div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="סגור"
            style={{ width: 32, height: 32, borderRadius: "50%", border: `1px solid ${LINE}`, background: "rgba(255,255,255,0.05)", color: SUB, cursor: "pointer", fontSize: 16, lineHeight: 1 }}>×</button>
        </div>

        {/* Preview */}
        <div style={{ display: "flex", justifyContent: "center", padding: "6px 0 20px" }}>
          <ProjectCover projectId={projectId} name={name} cover={previewCover} imageSrc={previewSrc} size={236} mobileSize={188} />
        </div>

        {/* Themes */}
        <div style={{ fontSize: 12.5, fontWeight: 800, color: SUB, marginBottom: 10, letterSpacing: "0.04em" }}>בחר סגנון</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(78px, 1fr))", gap: 10, marginBottom: 20 }}>
          {COVER_THEMES.map((t) => {
            const active = draft.kind === "theme" && draft.theme === t.id;
            return (
              <button key={t.id} type="button" onClick={() => { setErr(null); setDraft({ kind: "theme", theme: t.id }); }}
                aria-pressed={active}
                style={{
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "8px 4px 7px", cursor: "pointer",
                  fontFamily: "inherit", borderRadius: 14,
                  background: active ? "rgba(220,38,38,0.12)" : "rgba(255,255,255,0.03)",
                  border: `1.5px solid ${active ? RED : LINE}`,
                }}>
                <ProjectCover projectId={projectId} name={name} cover={{ theme: t.id, customImage: false, updatedAt: null }} imageSrc={null} size={58} />
                <span style={{ fontSize: 11.5, fontWeight: 700, color: active ? "#fff" : SUB }}>{t.label}</span>
              </button>
            );
          })}
        </div>

        {/* Upload */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "14px 0", borderTop: `1px solid ${LINE}` }}>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void pickFile(e.target.files?.[0])} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy || reading}
            style={{ ...btn(false, busy || reading), display: "inline-flex", alignItems: "center", gap: 8, color: TXT }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" /></svg>
            {reading ? "מעבד תמונה…" : "העלה תמונה"}
          </button>
          <div style={{ flex: 1, minWidth: 150, fontSize: 12, color: SUB, lineHeight: 1.5 }}>
            {draft.kind === "upload" ? "תמונה חדשה נבחרה — לחץ שמור כדי להחיל אותה."
              : draft.kind === "keep" ? "פעילה כרגע תמונה מותאמת אישית."
              : "התמונה משמשת כרקע, ושם הפרויקט נשאר מעליה."}
          </div>
          {draft.kind === "upload" && (
            <button type="button" onClick={() => setDraft(cover?.customImage ? { kind: "keep" } : { kind: "theme", theme: cover?.theme ?? DEFAULT_COVER_THEME })}
              style={{ background: "none", border: "none", color: SUB, fontSize: 12, textDecoration: "underline", cursor: "pointer", fontFamily: "inherit" }}>הסר</button>
          )}
        </div>

        {err && <div role="alert" style={{ fontSize: 12.5, fontWeight: 700, color: "#F87171", marginBottom: 10 }}>{err}</div>}

        {/* Actions */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", paddingTop: 6 }}>
          <button type="button" onClick={() => void save()} disabled={!changed || busy || reading} style={btn(true, !changed || busy || reading)}>
            {busy ? "שומר…" : "שמור"}
          </button>
          <button type="button" onClick={onClose} disabled={busy} style={btn(false, busy)}>ביטול</button>
          {cover && (
            <button type="button" onClick={() => void reset()} disabled={busy}
              style={{ marginInlineStart: "auto", background: "none", border: "none", cursor: busy ? "not-allowed" : "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, color: confirmReset ? "#F87171" : SUB, textDecoration: confirmReset ? "none" : "underline" }}>
              {confirmReset ? "בטוח? לחץ שוב לאיפוס" : "חזור לברירת מחדל"}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
