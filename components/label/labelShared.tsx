"use client";

// Shared tokens, atoms, and modals for the label management screens (/label and
// /label/artists/[id]). The artist roster is the ONLY source of artists — nothing
// here derives artists from projects.artist.

import { useState, useEffect } from "react";
import type { LabelArtist, LabelRelease, ProjectReleaseDetails, ReleaseStage, LabelArtistStatus } from "@/lib/types";
import { RELEASE_STAGES, LABEL_ARTIST_STATUSES, RESPONSIBLE_SUGGESTIONS } from "@/lib/types";

// ── tokens ────────────────────────────────────────────────────────────────────
export const BRAND = "#DC2626";
export const CARD  = "#181818";
export const CARD2 = "#1E1E1E";
export const BORDER  = "rgba(255,255,255,0.07)";
export const BORDER2 = "rgba(255,255,255,0.04)";
export const TEXT = "#F2F2F2";
export const SUB  = "#A0A0A0";
export const MUTED = "#606060";
export const DIM  = "#404040";
export const GREEN = "#34D399";

export const STAGE_COLOR: Record<ReleaseStage, string> = {
  "רעיון": "#9CA3AF", "הפקה": "#60A5FA", "הקלטה": "#38BDF8", "עריכות": "#22D3EE",
  "מיקס": "#818CF8", "מאסטר": "#A855F7", "עטיפה": "#EC4899", "הפצה": "#F472B6",
  "תוכן": "#F59E0B", "מוכן ליציאה": "#34D399", "יצא": "#10B981", "בהשהייה": "#6B7280",
};
export const ARTIST_STATUS_COLOR: Record<LabelArtistStatus, string> = {
  "פעיל": GREEN, "בהשהייה": "#F59E0B", "לא פעיל": MUTED,
};

// ── date helpers ────────────────────────────────────────────────────────────
export function todayYmd(): string { return new Date().toISOString().slice(0, 10); }
export function fmtDate(ymd: string | null): string {
  if (!ymd) return "—";
  const [y, m, d] = ymd.split("-");
  if (!y || !m || !d) return ymd;
  return `${d}.${m}.${y}`;
}
export function daysBetween(fromIsoOrYmd: string, toYmd: string): number {
  const a = new Date(fromIsoOrYmd.length <= 10 ? fromIsoOrYmd + "T00:00:00" : fromIsoOrYmd);
  const b = new Date(toYmd + "T00:00:00");
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}
export function daysUntil(ymd: string | null): number | null {
  return ymd == null ? null : daysBetween(todayYmd(), ymd);
}
export function daysInStage(stageEnteredAt: string): number {
  return Math.max(0, daysBetween(stageEnteredAt.slice(0, 10), todayYmd()));
}
export const ACTIVE_STAGES_SET = new Set<ReleaseStage>(RELEASE_STAGES.filter((s) => s !== "יצא" && s !== "בהשהייה"));

// ── atoms ─────────────────────────────────────────────────────────────────────
export function StatCard({ label, value, sub, subColor, icon }: {
  label: string; value: React.ReactNode; sub?: string; subColor?: string; icon?: string;
}) {
  return (
    <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 18, padding: "20px 22px", display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: SUB, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
        {icon && <span style={{ fontSize: 15, color: MUTED, flexShrink: 0 }}>{icon}</span>}
      </div>
      <div style={{ fontSize: 34, fontWeight: 900, color: TEXT, letterSpacing: "-0.02em", lineHeight: 1.05 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, fontWeight: 700, color: subColor ?? MUTED }}>{sub}</div>}
    </div>
  );
}

export function StageBadge({ stage, small }: { stage: ReleaseStage; small?: boolean }) {
  const c = STAGE_COLOR[stage] ?? SUB;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: small ? 11 : 12.5, fontWeight: 800, color: c, background: `${c}1A`, border: `1px solid ${c}3A`, borderRadius: 100, padding: small ? "2px 9px" : "3px 11px", whiteSpace: "nowrap" }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: c }} />{stage}
    </span>
  );
}

export function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <span style={{ width: 4, height: 18, borderRadius: 2, background: BRAND }} />
        <h2 style={{ fontSize: 17, fontWeight: 900, color: TEXT, margin: 0 }}>{title}</h2>
      </div>
      {action}
    </div>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 20, padding: 20, ...style }}>{children}</div>;
}

// Shalev has an existing profile image in his portal (Dropbox, no DB). Reuse it
// as his avatar here when label_artists.image_url is empty — display-only, no upload.
const SHALEV_AVATAR_SRC = `/api/dropbox/stream?path=${encodeURIComponent("/app/red-artists/shalev-tasama/profile-image/avatar.jpg")}`;

/** Effective avatar src: the artist's image_url, else Shalev's portal image, else null. */
export function resolveArtistImage(artist: { name: string; imageUrl: string | null }): string | null {
  if (artist.imageUrl && artist.imageUrl.trim()) return artist.imageUrl.trim();
  if (artist.name.trim() === "שליו טסמה") return SHALEV_AVATAR_SRC;
  return null;
}

export function ArtistAvatar({ artist, size = 52, glow = false }: { artist: { name: string; imageUrl: string | null }; size?: number; glow?: boolean }) {
  const src = resolveArtistImage(artist);
  const [failed, setFailed] = useState(false);
  const ring: React.CSSProperties = glow
    ? { boxShadow: "0 0 0 2px rgba(220,38,38,0.5), 0 0 18px rgba(220,38,38,0.28)", border: "1px solid rgba(220,38,38,0.35)" }
    : { border: `1px solid ${BORDER}` };
  const common: React.CSSProperties = { width: size, height: size, borderRadius: "50%", flexShrink: 0, ...ring };

  if (src && !failed) {
    return <img src={src} alt={artist.name} onError={() => setFailed(true)} style={{ ...common, objectFit: "cover" }} />;
  }
  return (
    <div style={{ ...common, background: "linear-gradient(150deg,#3A1616,#1A1111)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.4, fontWeight: 900, color: "#E7A6A6", letterSpacing: "-0.02em" }}>
      {artist.name.trim().charAt(0) || "?"}
    </div>
  );
}

// ── modal building blocks ─────────────────────────────────────────────────────
export const fieldStyle: React.CSSProperties = { width: "100%", background: "#101010", border: `1px solid ${BORDER}`, borderRadius: 10, padding: "10px 12px", color: TEXT, fontSize: 14, fontFamily: "inherit", colorScheme: "dark" };
export const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: SUB, marginBottom: 6, display: "block" };

export function PrimaryBtn({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button onClick={onClick} disabled={disabled} style={{ flex: 1, padding: "11px 0", borderRadius: 11, border: "none", color: "#fff", fontSize: 14, fontWeight: 800, cursor: disabled ? "default" : "pointer", fontFamily: "inherit", background: disabled ? "#4A2020" : BRAND }}>{children}</button>;
}
export function GhostBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return <button onClick={onClick} style={{ flex: 1, padding: "11px 0", borderRadius: 11, background: "rgba(255,255,255,0.05)", border: `1px solid ${BORDER}`, color: SUB, fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>{children}</button>;
}

export function ModalShell({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 100040, background: "rgba(0,0,0,0.74)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} dir="rtl" style={{ width: "min(540px, 94vw)", maxHeight: "90vh", overflowY: "auto", background: "linear-gradient(160deg,#161616 0%,#0F0F0F 100%)", border: `1px solid ${BORDER}`, borderRadius: 20, padding: "22px 24px", boxShadow: "0 28px 80px rgba(0,0,0,0.85)", fontFamily: "'Heebo', Arial, sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <div style={{ fontSize: 17, fontWeight: 900, color: TEXT }}>{title}</div>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: "50%", background: "rgba(255,255,255,0.06)", border: `1px solid ${BORDER}`, color: SUB, fontSize: 15, cursor: "pointer", fontFamily: "inherit" }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function PillRow<T extends string>({ options, value, onChange, colorFor }: { options: readonly T[]; value: T; onChange: (v: T) => void; colorFor?: (v: T) => string }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {options.map((s) => {
        const active = s === value;
        const c = colorFor ? colorFor(s) : BRAND;
        return (
          <button key={s} type="button" onClick={() => onChange(s)} style={{ fontSize: 12.5, fontWeight: 700, borderRadius: 100, padding: "6px 12px", cursor: "pointer", fontFamily: "inherit", color: active ? "#fff" : c, background: active ? c : `${c}14`, border: `1px solid ${active ? c : `${c}33`}` }}>{s}</button>
        );
      })}
    </div>
  );
}

export function ResponsiblePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const known = (RESPONSIBLE_SUGGESTIONS as readonly string[]).filter((s) => s !== "אחר");
  const [custom, setCustom] = useState(!known.includes(value) && value !== "");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {known.map((s) => {
          const active = !custom && value === s;
          return <button key={s} type="button" onClick={() => { setCustom(false); onChange(s); }} style={{ fontSize: 12.5, fontWeight: 700, borderRadius: 100, padding: "6px 13px", cursor: "pointer", fontFamily: "inherit", color: active ? "#fff" : SUB, background: active ? BRAND : "rgba(255,255,255,0.04)", border: `1px solid ${active ? BRAND : BORDER}` }}>{s}</button>;
        })}
        <button type="button" onClick={() => { setCustom(true); onChange(""); }} style={{ fontSize: 12.5, fontWeight: 700, borderRadius: 100, padding: "6px 13px", cursor: "pointer", fontFamily: "inherit", color: custom ? "#fff" : SUB, background: custom ? BRAND : "rgba(255,255,255,0.04)", border: `1px solid ${custom ? BRAND : BORDER}` }}>אחר</button>
      </div>
      {custom && <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="שם האחראי" style={fieldStyle} />}
    </div>
  );
}

export interface ReleaseFormState {
  releaseStage: ReleaseStage; releaseTargetDate: string; nextAction: string; blocker: string; responsible: string;
}
export function ReleaseFields({ form, setForm }: { form: ReleaseFormState; setForm: (f: ReleaseFormState) => void }) {
  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>שלב ריליס</label>
        <PillRow options={RELEASE_STAGES} value={form.releaseStage} onChange={(releaseStage) => setForm({ ...form, releaseStage })} colorFor={(s) => STAGE_COLOR[s as ReleaseStage]} />
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>תאריך יציאה מתוכנן</label>
        <input type="date" value={form.releaseTargetDate} onChange={(e) => setForm({ ...form, releaseTargetDate: e.target.value })} style={fieldStyle} />
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>הפעולה הבאה</label>
        <input value={form.nextAction} onChange={(e) => setForm({ ...form, nextAction: e.target.value })} placeholder="לדוגמה: לאשר מיקס / לסגור תאריך" style={fieldStyle} />
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>חסם נוכחי</label>
        <input value={form.blocker} onChange={(e) => setForm({ ...form, blocker: e.target.value })} placeholder="מה עוצר את הריליס כרגע? (אופציונלי)" style={fieldStyle} />
      </div>
      <div style={{ marginBottom: 4 }}>
        <label style={labelStyle}>אחראי</label>
        <ResponsiblePicker value={form.responsible} onChange={(responsible) => setForm({ ...form, responsible })} />
      </div>
    </>
  );
}

// ── Add label artist (explicit) ───────────────────────────────────────────────
export function AddArtistModal({ onClose, onSaved }: { onClose: () => void; onSaved: (a: LabelArtist) => void }) {
  const [name, setName] = useState("");
  const [status, setStatus] = useState<LabelArtistStatus>("פעיל");
  const [imageUrl, setImageUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) { setErr("שם האמן חסר"); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/label/artists", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), status, imageUrl: imageUrl.trim() }) });
      const d = await res.json().catch(() => null);
      if (!res.ok) { setErr(d?.error || "השמירה נכשלה"); setBusy(false); return; }
      onSaved(d.artist); onClose();
    } catch { setErr("שגיאת רשת"); setBusy(false); }
  }

  return (
    <ModalShell title="אמן לייבל חדש" onClose={onClose}>
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>שם האמן</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="לדוגמה: שליו טסמה" style={fieldStyle} autoFocus />
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>סטטוס</label>
        <PillRow options={LABEL_ARTIST_STATUSES} value={status} onChange={setStatus} colorFor={(s) => ARTIST_STATUS_COLOR[s as LabelArtistStatus]} />
      </div>
      <div style={{ marginBottom: 4 }}>
        <label style={labelStyle}>קישור לתמונה (אופציונלי)</label>
        <input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…  (ניתן להוסיף/לערוך גם בהמשך)" style={fieldStyle} />
      </div>
      {err && <div style={{ color: "#F87171", fontSize: 12.5, fontWeight: 700, margin: "8px 0 2px" }}>{err}</div>}
      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <GhostBtn onClick={onClose}>ביטול</GhostBtn>
        <PrimaryBtn onClick={submit} disabled={busy}>{busy ? "מוסיף…" : "הוסף אמן"}</PrimaryBtn>
      </div>
    </ModalShell>
  );
}

// ── Create a new label song release (artist chosen from the roster) ────────────
export function CreateReleaseModal({ artists, lockedArtistId, onClose, onSaved, onNeedArtist }: {
  artists: LabelArtist[]; lockedArtistId?: string; onClose: () => void; onSaved: () => void; onNeedArtist?: () => void;
}) {
  const [artistId, setArtistId] = useState<string>(lockedArtistId ?? (artists[0]?.id ?? ""));
  const [name, setName] = useState("");
  const [form, setForm] = useState<ReleaseFormState>({ releaseStage: "רעיון", releaseTargetDate: "", nextAction: "", blocker: "", responsible: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const lockedArtist = lockedArtistId ? artists.find((a) => a.id === lockedArtistId) : null;

  async function submit() {
    if (!artistId) { setErr("יש לבחור אמן לייבל"); return; }
    if (!name.trim()) { setErr("שם הריליס חסר"); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/label/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ labelArtistId: artistId, name: name.trim(), releaseStage: form.releaseStage, releaseTargetDate: form.releaseTargetDate || null, nextAction: form.nextAction, blocker: form.blocker, responsible: form.responsible }) });
      const d = await res.json().catch(() => null);
      if (!res.ok) { setErr(d?.error || "השמירה נכשלה"); setBusy(false); return; }
      onSaved(); onClose();
    } catch { setErr("שגיאת רשת"); setBusy(false); }
  }

  return (
    <ModalShell title="ריליס חדש" onClose={onClose}>
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>אמן</label>
        {lockedArtist ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, background: CARD2, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "9px 12px" }}>
            <ArtistAvatar artist={lockedArtist} size={30} />
            <span style={{ fontSize: 14, fontWeight: 700, color: TEXT }}>{lockedArtist.name}</span>
          </div>
        ) : artists.length === 0 ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: CARD2, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "10px 12px" }}>
            <span style={{ fontSize: 13, color: SUB }}>אין עדיין אמני לייבל.</span>
            <button type="button" onClick={() => { onClose(); onNeedArtist?.(); }} style={{ fontSize: 12.5, fontWeight: 800, color: "#fff", background: BRAND, border: "none", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontFamily: "inherit" }}>הוסף אמן</button>
          </div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {artists.map((a) => {
              const active = a.id === artistId;
              return <button key={a.id} type="button" onClick={() => setArtistId(a.id)} style={{ fontSize: 12.5, fontWeight: 700, borderRadius: 100, padding: "6px 13px", cursor: "pointer", fontFamily: "inherit", color: active ? "#fff" : SUB, background: active ? BRAND : "rgba(255,255,255,0.04)", border: `1px solid ${active ? BRAND : BORDER}` }}>{a.name}</button>;
            })}
          </div>
        )}
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>שם השיר / הריליס</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="שם הסינגל" style={fieldStyle} autoFocus />
      </div>
      <ReleaseFields form={form} setForm={setForm} />
      {err && <div style={{ color: "#F87171", fontSize: 12.5, fontWeight: 700, margin: "6px 0 2px" }}>{err}</div>}
      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <GhostBtn onClick={onClose}>ביטול</GhostBtn>
        <PrimaryBtn onClick={submit} disabled={busy || (artists.length === 0 && !lockedArtist)}>{busy ? "יוצר…" : "צור ריליס"}</PrimaryBtn>
      </div>
    </ModalShell>
  );
}

// ── Edit an existing release (optimistic lock; 409 → conflict, no retry) ───────
export function EditReleaseModal({ item, onClose, onSaved }: { item: LabelRelease; onClose: () => void; onSaved: () => void }) {
  const rel = item.release as ProjectReleaseDetails;
  const [form, setForm] = useState<ReleaseFormState>({ releaseStage: rel.releaseStage, releaseTargetDate: rel.releaseTargetDate ?? "", nextAction: rel.nextAction, blocker: rel.blocker, responsible: rel.responsible });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  async function submit() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/label/releases/${item.projectId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedUpdatedAt: rel.updatedAt, releaseStage: form.releaseStage, releaseTargetDate: form.releaseTargetDate || null, nextAction: form.nextAction, blocker: form.blocker, responsible: form.responsible }) });
      if (res.status === 409) {
        const d = await res.json().catch(() => null);
        setConflict(true); setErr(d?.error || "פרטי הריליס עודכנו במקום אחר. יש לרענן ולנסות שוב.");
        setBusy(false); onSaved(); return;
      }
      const d = await res.json().catch(() => null);
      if (!res.ok) { setErr(d?.error || "השמירה נכשלה"); setBusy(false); return; }
      onSaved(); onClose();
    } catch { setErr("שגיאת רשת"); setBusy(false); }
  }

  return (
    <ModalShell title={`עריכת ריליס — ${item.name}`} onClose={onClose}>
      <ReleaseFields form={form} setForm={setForm} />
      {err && <div style={{ color: conflict ? "#F59E0B" : "#F87171", fontSize: 12.5, fontWeight: 700, margin: "6px 0 2px" }}>{err}</div>}
      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <GhostBtn onClick={onClose}>{conflict ? "סגור" : "ביטול"}</GhostBtn>
        {!conflict && <PrimaryBtn onClick={submit} disabled={busy}>{busy ? "שומר…" : "שמור"}</PrimaryBtn>}
      </div>
    </ModalShell>
  );
}
