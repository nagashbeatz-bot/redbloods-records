"use client";

// ── ניהול הלייבל (/label) — owner-only label management dashboard ─────────────
// Snapshot of all label artists, their releases, pipeline health, and what needs
// attention today. Reads /api/label/releases (label projects + release details).
// Money (investments/income) is intentionally NOT wired in Phase 1 — the finance
// attribution model was deferred — so that area shows an honest "not connected"
// state instead of invented numbers.

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import type {
  LabelRelease, ProjectReleaseDetails, ReleaseStage,
} from "@/lib/types";
import { RELEASE_STAGES, ACTIVE_RELEASE_STAGES, RESPONSIBLE_SUGGESTIONS } from "@/lib/types";

// ── tokens ────────────────────────────────────────────────────────────────────
const BRAND = "#DC2626";
const CARD  = "#181818";
const CARD2 = "#1E1E1E";
const BORDER  = "rgba(255,255,255,0.07)";
const BORDER2 = "rgba(255,255,255,0.04)";
const TEXT = "#F2F2F2";
const SUB  = "#A0A0A0";
const MUTED = "#606060";
const DIM  = "#404040";
const GREEN = "#34D399";

const STAGE_COLOR: Record<ReleaseStage, string> = {
  "רעיון": "#9CA3AF", "הפקה": "#60A5FA", "הקלטה": "#38BDF8", "עריכות": "#22D3EE",
  "מיקס": "#818CF8", "מאסטר": "#A855F7", "עטיפה": "#EC4899", "הפצה": "#F472B6",
  "תוכן": "#F59E0B", "מוכן ליציאה": "#34D399", "יצא": "#10B981", "בהשהייה": "#6B7280",
};

// ── date helpers ────────────────────────────────────────────────────────────
function todayYmd(): string { return new Date().toISOString().slice(0, 10); }
function fmtDate(ymd: string | null): string {
  if (!ymd) return "—";
  const [y, m, d] = ymd.split("-");
  if (!y || !m || !d) return ymd;
  return `${d}.${m}.${y}`;
}
function daysBetween(fromIsoOrYmd: string, toYmd: string): number {
  const a = new Date(fromIsoOrYmd.length <= 10 ? fromIsoOrYmd + "T00:00:00" : fromIsoOrYmd);
  const b = new Date(toYmd + "T00:00:00");
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}
function daysUntil(ymd: string | null): number | null {
  if (!ymd) return null;
  return daysBetween(todayYmd(), ymd);
}

// projects.artist is a free-text multi-artist string (comma / Arabic comma / semicolon).
function parseArtistNames(raw: string): string[] {
  return (raw || "").split(/[,،;]/).map((s) => s.trim()).filter(Boolean);
}

// ── small UI atoms ────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, subColor, icon }: {
  label: string; value: React.ReactNode; sub?: string; subColor?: string; icon?: string;
}) {
  return (
    <div style={{
      background: CARD, border: `1px solid ${BORDER}`, borderRadius: 16,
      padding: "16px 18px", display: "flex", flexDirection: "column", gap: 6, minWidth: 0,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: SUB, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
        {icon && <span style={{ fontSize: 13, color: MUTED, flexShrink: 0 }}>{icon}</span>}
      </div>
      <div style={{ fontSize: 26, fontWeight: 900, color: TEXT, letterSpacing: "-0.02em", lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, fontWeight: 700, color: subColor ?? MUTED }}>{sub}</div>}
    </div>
  );
}

function StageBadge({ stage, small }: { stage: ReleaseStage; small?: boolean }) {
  const c = STAGE_COLOR[stage] ?? SUB;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      fontSize: small ? 10.5 : 12, fontWeight: 800, color: c,
      background: `${c}1A`, border: `1px solid ${c}3A`, borderRadius: 100,
      padding: small ? "2px 8px" : "3px 10px", whiteSpace: "nowrap",
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: c }} />
      {stage}
    </span>
  );
}

function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 4, height: 16, borderRadius: 2, background: BRAND }} />
        <h2 style={{ fontSize: 15, fontWeight: 900, color: TEXT, margin: 0 }}>{title}</h2>
      </div>
      {action}
    </div>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 18, padding: 18, ...style }}>
      {children}
    </div>
  );
}

// ── modals ──────────────────────────────────────────────────────────────────
const fieldStyle: React.CSSProperties = {
  width: "100%", background: "#101010", border: `1px solid ${BORDER}`, borderRadius: 10,
  padding: "10px 12px", color: TEXT, fontSize: 14, fontFamily: "inherit", colorScheme: "dark",
};
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: SUB, marginBottom: 6, display: "block" };

function StagePicker({ value, onChange }: { value: ReleaseStage; onChange: (s: ReleaseStage) => void }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {RELEASE_STAGES.map((s) => {
        const active = s === value;
        const c = STAGE_COLOR[s];
        return (
          <button key={s} type="button" onClick={() => onChange(s)} style={{
            fontSize: 12, fontWeight: 700, borderRadius: 100, padding: "5px 11px", cursor: "pointer",
            fontFamily: "inherit",
            color: active ? "#fff" : c,
            background: active ? c : `${c}14`,
            border: `1px solid ${active ? c : `${c}33`}`,
          }}>{s}</button>
        );
      })}
    </div>
  );
}

function ResponsiblePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const known = (RESPONSIBLE_SUGGESTIONS as readonly string[]).filter((s) => s !== "אחר");
  const isKnown = known.includes(value);
  const [custom, setCustom] = useState(!isKnown && value !== "");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {known.map((s) => {
          const active = !custom && value === s;
          return (
            <button key={s} type="button" onClick={() => { setCustom(false); onChange(s); }} style={{
              fontSize: 12.5, fontWeight: 700, borderRadius: 100, padding: "6px 13px", cursor: "pointer", fontFamily: "inherit",
              color: active ? "#fff" : SUB,
              background: active ? BRAND : "rgba(255,255,255,0.04)",
              border: `1px solid ${active ? BRAND : BORDER}`,
            }}>{s}</button>
          );
        })}
        <button type="button" onClick={() => { setCustom(true); onChange(""); }} style={{
          fontSize: 12.5, fontWeight: 700, borderRadius: 100, padding: "6px 13px", cursor: "pointer", fontFamily: "inherit",
          color: custom ? "#fff" : SUB, background: custom ? BRAND : "rgba(255,255,255,0.04)",
          border: `1px solid ${custom ? BRAND : BORDER}`,
        }}>אחר</button>
      </div>
      {custom && (
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="שם האחראי" style={fieldStyle} />
      )}
    </div>
  );
}

function ModalShell({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 100040, background: "rgba(0,0,0,0.74)",
      backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }}>
      <div onClick={(e) => e.stopPropagation()} dir="rtl" style={{
        width: "min(520px, 94vw)", maxHeight: "90vh", overflowY: "auto",
        background: "linear-gradient(160deg,#161616 0%,#0F0F0F 100%)", border: `1px solid ${BORDER}`,
        borderRadius: 20, padding: "22px 24px", boxShadow: "0 28px 80px rgba(0,0,0,0.85)",
        fontFamily: "'Heebo', Arial, sans-serif",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <div style={{ fontSize: 17, fontWeight: 900, color: TEXT }}>{title}</div>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: "50%", background: "rgba(255,255,255,0.06)", border: `1px solid ${BORDER}`, color: SUB, fontSize: 15, cursor: "pointer", fontFamily: "inherit" }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

interface ReleaseFormState {
  releaseStage: ReleaseStage;
  releaseTargetDate: string;
  nextAction: string;
  blocker: string;
  responsible: string;
}

function ReleaseFields({ form, setForm }: { form: ReleaseFormState; setForm: (f: ReleaseFormState) => void }) {
  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>שלב ריליס</label>
        <StagePicker value={form.releaseStage} onChange={(releaseStage) => setForm({ ...form, releaseStage })} />
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

function PrimaryBtn({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      flex: 1, padding: "11px 0", borderRadius: 11, border: "none", color: "#fff", fontSize: 14, fontWeight: 800,
      cursor: disabled ? "default" : "pointer", fontFamily: "inherit", background: disabled ? "#4A2020" : BRAND,
    }}>{children}</button>
  );
}
function GhostBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, padding: "11px 0", borderRadius: 11, background: "rgba(255,255,255,0.05)", border: `1px solid ${BORDER}`,
      color: SUB, fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
    }}>{children}</button>
  );
}

// Create a brand-new label song release (POST /api/label/projects → RPC).
function CreateReleaseModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [artist, setArtist] = useState("");
  const [form, setForm] = useState<ReleaseFormState>({ releaseStage: "רעיון", releaseTargetDate: "", nextAction: "", blocker: "", responsible: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) { setErr("שם הריליס חסר"); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/label/projects", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(), artist: artist.trim(),
          releaseStage: form.releaseStage,
          releaseTargetDate: form.releaseTargetDate || null,
          nextAction: form.nextAction, blocker: form.blocker, responsible: form.responsible,
        }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) { setErr(d?.error || "השמירה נכשלה"); setBusy(false); return; }
      onSaved(); onClose();
    } catch { setErr("שגיאת רשת"); setBusy(false); }
  }

  return (
    <ModalShell title="ריליס חדש" onClose={onClose}>
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>שם השיר / הריליס</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="שם הסינגל" style={fieldStyle} autoFocus />
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>אמן</label>
        <input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="לדוגמה: שליו טסמה" style={fieldStyle} />
      </div>
      <ReleaseFields form={form} setForm={setForm} />
      {err && <div style={{ color: "#F87171", fontSize: 12.5, fontWeight: 700, margin: "6px 0 2px" }}>{err}</div>}
      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <GhostBtn onClick={onClose}>ביטול</GhostBtn>
        <PrimaryBtn onClick={submit} disabled={busy}>{busy ? "יוצר…" : "צור ריליס"}</PrimaryBtn>
      </div>
    </ModalShell>
  );
}

// Edit an existing release (PATCH with optimistic lock; 409 → conflict).
function EditReleaseModal({ item, onClose, onSaved }: { item: LabelRelease; onClose: () => void; onSaved: () => void }) {
  const rel = item.release!;
  const [form, setForm] = useState<ReleaseFormState>({
    releaseStage: rel.releaseStage,
    releaseTargetDate: rel.releaseTargetDate ?? "",
    nextAction: rel.nextAction,
    blocker: rel.blocker,
    responsible: rel.responsible,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  async function submit() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/label/releases/${item.projectId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedUpdatedAt: rel.updatedAt,
          releaseStage: form.releaseStage,
          releaseTargetDate: form.releaseTargetDate || null,
          nextAction: form.nextAction, blocker: form.blocker, responsible: form.responsible,
        }),
      });
      if (res.status === 409) {
        const d = await res.json().catch(() => null);
        setConflict(true); setErr(d?.error || "פרטי הריליס עודכנו במקום אחר. יש לרענן ולנסות שוב.");
        setBusy(false); onSaved(); // refresh underlying data
        return;
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

// Mark an existing client song project as a label release.
interface SlimProject { id: string; name: string; artist: string; projectType: string; businessType: string; }
function MarkExistingModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [projects, setProjects] = useState<SlimProject[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((rows: SlimProject[]) => {
        const list = Array.isArray(rows) ? rows.filter((p) => p.businessType !== "לייבל" && p.projectType === "שיר") : [];
        setProjects(list);
      })
      .catch(() => setProjects([]));
  }, []);

  async function convert(p: SlimProject) {
    setBusyId(p.id); setErr(null);
    try {
      const r1 = await fetch(`/api/label/projects/${p.id}/business-type`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessType: "לייבל" }),
      });
      if (!r1.ok) { const d = await r1.json().catch(() => null); setErr(d?.error || "הסימון נכשל"); setBusyId(null); return; }
      // Create default release details so it's ready to manage.
      await fetch("/api/label/releases", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: p.id, releaseStage: "רעיון" }),
      });
      onSaved(); onClose();
    } catch { setErr("שגיאת רשת"); setBusyId(null); }
  }

  return (
    <ModalShell title="סמן פרויקט קיים כלייבל" onClose={onClose}>
      <div style={{ fontSize: 12.5, color: SUB, lineHeight: 1.6, marginBottom: 14 }}>
        רק פרויקטים מסוג <b style={{ color: TEXT }}>שיר</b> שאינם מסומנים כלייבל. סימון יהפוך אותם לריליס לייבל ויוסיף להם פרטי ריליס ריקים.
      </div>
      {err && <div style={{ color: "#F87171", fontSize: 12.5, fontWeight: 700, marginBottom: 10 }}>{err}</div>}
      {projects === null ? (
        <div style={{ color: MUTED, fontSize: 13, padding: "20px 0", textAlign: "center" }}>טוען…</div>
      ) : projects.length === 0 ? (
        <div style={{ color: MUTED, fontSize: 13, padding: "20px 0", textAlign: "center" }}>אין פרויקטי שיר זמינים לסימון.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: "50vh", overflowY: "auto" }}>
          {projects.map((p) => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, background: CARD2, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "10px 12px" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                <div style={{ fontSize: 11.5, color: MUTED }}>{p.artist || "—"}</div>
              </div>
              <button onClick={() => convert(p)} disabled={busyId === p.id} style={{
                fontSize: 12.5, fontWeight: 800, borderRadius: 9, padding: "7px 14px", border: "none",
                background: busyId === p.id ? "#4A2020" : BRAND, color: "#fff", cursor: busyId === p.id ? "default" : "pointer", fontFamily: "inherit", flexShrink: 0,
              }}>{busyId === p.id ? "…" : "הפוך ללייבל"}</button>
            </div>
          ))}
        </div>
      )}
    </ModalShell>
  );
}

// ── main page ─────────────────────────────────────────────────────────────────
export default function LabelPage() {
  const [data, setData] = useState<LabelRelease[] | null>(null);
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [createOpen, setCreateOpen] = useState(false);
  const [markOpen, setMarkOpen] = useState(false);
  const [editItem, setEditItem] = useState<LabelRelease | null>(null);

  const reload = useCallback(() => {
    fetch("/api/label/releases")
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((rows: LabelRelease[]) => { setData(Array.isArray(rows) ? rows : []); setState("ready"); })
      .catch(() => setState("error"));
  }, []);
  useEffect(() => { reload(); }, [reload]);

  // ── derivations ──────────────────────────────────────────────────────────
  const derived = useMemo(() => {
    const rows = data ?? [];
    const withRel = rows.filter((r): r is LabelRelease & { release: ProjectReleaseDetails } => !!r.release);
    const active = withRel.filter((r) => (ACTIVE_RELEASE_STAGES as string[]).includes(r.release.releaseStage));

    // artists (from free-text multi-artist strings)
    const artistMap = new Map<string, LabelRelease[]>();
    for (const r of rows) {
      const names = parseArtistNames(r.artist);
      const keys = names.length ? names : ["ללא אמן"];
      for (const n of keys) {
        if (!artistMap.has(n)) artistMap.set(n, []);
        artistMap.get(n)!.push(r);
      }
    }

    const today = todayYmd();
    const upcoming = active
      .filter((r) => r.release.releaseTargetDate)
      .sort((a, b) => (a.release.releaseTargetDate! < b.release.releaseTargetDate! ? -1 : 1));

    // next release overall = soonest dated active release; else oldest-in-stage active
    const nextRelease: (LabelRelease & { release: ProjectReleaseDetails }) | null =
      upcoming[0]
      ?? [...active].sort((a, b) => (a.release.stageEnteredAt < b.release.stageEnteredAt ? -1 : 1))[0]
      ?? null;

    const released = withRel
      .filter((r) => r.release.releasedAt)
      .sort((a, b) => (a.release.releasedAt! > b.release.releasedAt! ? -1 : 1));
    const daysSinceLast = released[0]
      ? Math.max(0, daysBetween(released[0].release.releasedAt!.slice(0, 10), today))
      : null;

    const upcomingSoon = upcoming.filter((r) => {
      const d = daysUntil(r.release.releaseTargetDate);
      return d !== null && d >= 0;
    });

    // priority today = active releases that have a next action or a blocker,
    // or whose target date has passed. Purely from the manual release fields.
    const priority = active
      .filter((r) => r.release.nextAction.trim() || r.release.blocker.trim() || (daysUntil(r.release.releaseTargetDate) ?? 99) < 0)
      .sort((a, b) => {
        const ab = a.release.blocker.trim() ? 0 : 1, bb = b.release.blocker.trim() ? 0 : 1;
        if (ab !== bb) return ab - bb;
        return (a.release.stageEnteredAt < b.release.stageEnteredAt ? -1 : 1);
      });

    return {
      rows, withRel, active, artists: [...artistMap.entries()],
      upcoming, nextRelease, daysSinceLast, upcomingSoon, priority,
    };
  }, [data]);

  const busy = state === "loading";

  return (
    <div dir="rtl" style={{ fontFamily: "'Heebo', Arial, sans-serif", color: TEXT, padding: "24px 22px 60px", maxWidth: 1400, margin: "0 auto" }}>
      <style>{`
        .rb-label-kpis { display:grid; grid-template-columns:repeat(5,1fr); gap:12px; }
        .rb-label-artists { display:grid; grid-template-columns:repeat(auto-fill,minmax(250px,1fr)); gap:12px; }
        .rb-label-money { display:grid; grid-template-columns:1fr 1fr 1.2fr; gap:12px; }
        .rb-label-bottom { display:grid; grid-template-columns:1fr 1.2fr; gap:14px; }
        @media (max-width: 1000px) {
          .rb-label-kpis { grid-template-columns:repeat(2,1fr); }
          .rb-label-money { grid-template-columns:1fr; }
          .rb-label-bottom { grid-template-columns:1fr; }
        }
        @media (max-width: 560px) {
          .rb-label-artists { grid-template-columns:1fr; }
        }
      `}</style>

      {/* Hero */}
      <div style={{ textAlign: "center", marginBottom: 22 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 6 }}>
          <h1 style={{ fontSize: 27, fontWeight: 900, color: TEXT, margin: 0, letterSpacing: "-0.02em" }}>ניהול הלייבל</h1>
          <span style={{ fontSize: 22, filter: "drop-shadow(0 0 10px rgba(220,38,38,0.6))" }}>🎯</span>
        </div>
        <div style={{ fontSize: 13.5, color: SUB }}>תמונת מצב כוללת של אמני הלייבל, הריליסים והפעולות שדורשות טיפול</div>
      </div>

      {state === "error" && (
        <Card><div style={{ color: "#F87171", textAlign: "center", padding: "10px 0", fontSize: 14 }}>שגיאה בטעינת נתוני הלייבל.</div></Card>
      )}

      {/* KPI row */}
      <div className="rb-label-kpis" style={{ marginBottom: 22 }}>
        <StatCard label="אמני לייבל" value={busy ? "…" : derived.artists.length} sub="פעילים במערכת" icon="🎤" />
        <StatCard label="ריליסים בצינור" value={busy ? "…" : derived.active.length} sub={`${derived.upcomingSoon.length} עם תאריך קרוב`} icon="💿" />
        <StatCard label="ריליסים קרובים" value={busy ? "…" : derived.upcomingSoon.length} sub="עם תאריך יציאה" icon="🗓" />
        <StatCard label="ימים מהריליס האחרון" value={busy ? "…" : (derived.daysSinceLast ?? "—")} sub={derived.daysSinceLast == null ? "טרם יצא ריליס" : "מאז היציאה האחרונה"} icon="⏱" />
        <StatCard label="מאזן חודשי (נטו)" value="—" sub="טרם חובר למקור אמת" subColor={DIM} icon="₪" />
      </div>

      {/* Artists */}
      <div style={{ marginBottom: 24 }}>
        <SectionHeader title="אמני הלייבל" action={
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setMarkOpen(true)} style={{ fontSize: 12.5, fontWeight: 700, color: SUB, background: "rgba(255,255,255,0.04)", border: `1px solid ${BORDER}`, borderRadius: 9, padding: "7px 13px", cursor: "pointer", fontFamily: "inherit" }}>סמן פרויקט כלייבל</button>
            <button onClick={() => setCreateOpen(true)} style={{ fontSize: 12.5, fontWeight: 800, color: "#fff", background: BRAND, border: "none", borderRadius: 9, padding: "7px 15px", cursor: "pointer", fontFamily: "inherit" }}>+ ריליס חדש</button>
          </div>
        } />
        {busy ? (
          <Card><div style={{ color: MUTED, textAlign: "center", padding: "18px 0" }}>טוען…</div></Card>
        ) : derived.artists.length === 0 ? (
          <Card><div style={{ color: MUTED, textAlign: "center", padding: "22px 0", fontSize: 14, lineHeight: 1.7 }}>
            אין עדיין אמני לייבל.<br />צור ריליס חדש או סמן פרויקט שיר קיים כלייבל כדי להתחיל.
          </div></Card>
        ) : (
          <div className="rb-label-artists">
            {derived.artists.map(([artist, items]) => {
              const rels = items.filter((i): i is LabelRelease & { release: ProjectReleaseDetails } => !!i.release);
              const activeRels = rels.filter((r) => (ACTIVE_RELEASE_STAGES as string[]).includes(r.release.releaseStage));
              const next = activeRels
                .filter((r) => r.release.releaseTargetDate)
                .sort((a, b) => (a.release.releaseTargetDate! < b.release.releaseTargetDate! ? -1 : 1))[0]
                ?? activeRels[0] ?? null;
              const isActive = activeRels.length > 0;
              return (
                <div key={artist} style={{ background: CARD, border: `1px solid ${next ? "rgba(220,38,38,0.22)" : BORDER}`, borderRadius: 18, padding: 16, display: "flex", flexDirection: "column", gap: 12, boxShadow: next ? "0 0 0 1px rgba(220,38,38,0.06)" : "none" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                    <div style={{ width: 44, height: 44, borderRadius: "50%", flexShrink: 0, background: "linear-gradient(135deg,#2A2A2A,#161616)", border: `1px solid ${BORDER}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 800, color: SUB }}>
                      {artist.trim().charAt(0) || "?"}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 800, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{artist}</div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: isActive ? GREEN : MUTED }}>{isActive ? "● פעיל" : "רדום"}</div>
                    </div>
                  </div>

                  <div style={{ background: CARD2, borderRadius: 12, padding: "11px 13px", border: `1px solid ${BORDER2}` }}>
                    <div style={{ fontSize: 10, fontWeight: 800, color: DIM, letterSpacing: "0.06em", marginBottom: 6 }}>הריליס הבא</div>
                    {next ? (
                      <>
                        <div style={{ fontSize: 13.5, fontWeight: 800, color: TEXT, marginBottom: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{next.name}</div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                          <StageBadge stage={next.release.releaseStage} small />
                          <span style={{ fontSize: 11.5, fontWeight: 700, color: SUB }}>{fmtDate(next.release.releaseTargetDate)}</span>
                        </div>
                      </>
                    ) : (
                      <div style={{ fontSize: 12.5, color: MUTED }}>אין ריליס פעיל</div>
                    )}
                  </div>

                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 12, color: SUB }}>בצינור: <b style={{ color: TEXT }}>{activeRels.length}</b></span>
                    <Link href={`/label/artists/${encodeURIComponent(artist)}`} style={{ fontSize: 12, fontWeight: 800, color: BRAND, textDecoration: "none" }}>פתח עמוד אמן ←</Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Investments & income — honest "not connected" (Phase 1 excludes finance attribution) */}
      <div style={{ marginBottom: 24 }}>
        <SectionHeader title="השקעות והכנסות" />
        <Card style={{ padding: "26px 22px" }}>
          <div className="rb-label-money">
            {[
              { t: "השקעות החודש", c: "#F87171" },
              { t: "הכנסות החודש", c: GREEN },
              { t: "מאזן נטו", c: SUB },
            ].map((b) => (
              <div key={b.t} style={{ background: CARD2, border: `1px solid ${BORDER2}`, borderRadius: 14, padding: "18px 16px" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: b.c }}>{b.t}</div>
                <div style={{ fontSize: 24, fontWeight: 900, color: DIM, marginTop: 8 }}>—</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 16, fontSize: 12.5, color: MUTED, lineHeight: 1.7, textAlign: "center" }}>
            אזור ההשקעות מול ההכנסות יחובר לאחר שיוגדר שיוך אמין של הוצאות לאמן ולריליס.<br />
            המבנה מוכן — הנתונים לא מומצאים עד שיהיה מקור אמת.
          </div>
        </Card>
      </div>

      {/* Bottom: priority today + upcoming releases */}
      <div className="rb-label-bottom">
        {/* Priority today */}
        <div>
          <SectionHeader title="עדיפות הלייבל היום" />
          <Card style={{ padding: 14 }}>
            {busy ? (
              <div style={{ color: MUTED, textAlign: "center", padding: "16px 0" }}>טוען…</div>
            ) : derived.priority.length === 0 ? (
              <div style={{ color: MUTED, textAlign: "center", padding: "20px 0", fontSize: 13.5, lineHeight: 1.7 }}>
                אין פעולות פתוחות שהוגדרו.<br />הגדר "פעולה הבאה" בריליס כדי שיופיע כאן.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {derived.priority.map((r) => {
                  const overdue = (daysUntil(r.release.releaseTargetDate) ?? 99) < 0;
                  return (
                    <button key={r.projectId} onClick={() => setEditItem(r)} style={{
                      textAlign: "right", background: CARD2, border: `1px solid ${r.release.blocker.trim() ? "rgba(248,113,113,0.3)" : BORDER}`, borderRadius: 12,
                      padding: "11px 13px", cursor: "pointer", fontFamily: "inherit", display: "flex", flexDirection: "column", gap: 6,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <StageBadge stage={r.release.releaseStage} small />
                        <span style={{ fontSize: 13, fontWeight: 800, color: TEXT, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
                        <span style={{ fontSize: 11, color: MUTED }}>{r.artist}</span>
                      </div>
                      {r.release.nextAction.trim() && (
                        <div style={{ fontSize: 13, color: "#E5E5E5", fontWeight: 600 }}>▸ {r.release.nextAction}</div>
                      )}
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        {r.release.blocker.trim() && (
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#F87171" }}>⛔ {r.release.blocker}</span>
                        )}
                        {overdue && <span style={{ fontSize: 11, fontWeight: 700, color: "#F59E0B" }}>איחור בתאריך היעד</span>}
                        {r.release.responsible.trim() && <span style={{ fontSize: 11, color: MUTED }}>אחראי: {r.release.responsible}</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {/* Upcoming releases */}
        <div>
          <SectionHeader title="ריליסים קרובים" />
          <Card style={{ padding: 0, overflow: "hidden" }}>
            {busy ? (
              <div style={{ color: MUTED, textAlign: "center", padding: "20px 0" }}>טוען…</div>
            ) : derived.upcoming.length === 0 ? (
              <div style={{ color: MUTED, textAlign: "center", padding: "24px 0", fontSize: 13.5, lineHeight: 1.7 }}>
                אין ריליסים עם תאריך יציאה.<br />הגדר תאריך יעד בריליס כדי שיופיע כאן.
              </div>
            ) : (
              <div>
                <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 0.9fr", gap: 8, padding: "11px 16px", borderBottom: `1px solid ${BORDER2}` }}>
                  {["שם / אמן", "שלב", "תאריך יעד", "בעוד"].map((h) => (
                    <span key={h} style={{ fontSize: 10, fontWeight: 800, color: DIM, letterSpacing: "0.05em" }}>{h}</span>
                  ))}
                </div>
                {derived.upcoming.map((r, i) => {
                  const d = daysUntil(r.release.releaseTargetDate);
                  return (
                    <button key={r.projectId} onClick={() => setEditItem(r)} style={{
                      width: "100%", textAlign: "right", display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 0.9fr", gap: 8,
                      alignItems: "center", padding: "12px 16px", background: i % 2 ? "rgba(255,255,255,0.012)" : "transparent",
                      border: "none", borderBottom: i === derived.upcoming.length - 1 ? "none" : `1px solid ${BORDER2}`, cursor: "pointer", fontFamily: "inherit",
                    }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
                        <div style={{ fontSize: 11, color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.artist}</div>
                      </div>
                      <div><StageBadge stage={r.release.releaseStage} small /></div>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: SUB }}>{fmtDate(r.release.releaseTargetDate)}</span>
                      <span style={{ fontSize: 12, fontWeight: 800, color: d != null && d < 0 ? "#F59E0B" : d != null && d <= 7 ? GREEN : SUB }}>
                        {d == null ? "—" : d < 0 ? `${Math.abs(d)} ימים באיחור` : d === 0 ? "היום" : `${d} ימים`}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      </div>

      {createOpen && <CreateReleaseModal onClose={() => setCreateOpen(false)} onSaved={reload} />}
      {markOpen && <MarkExistingModal onClose={() => setMarkOpen(false)} onSaved={reload} />}
      {editItem && editItem.release && <EditReleaseModal item={editItem} onClose={() => setEditItem(null)} onSaved={reload} />}
    </div>
  );
}
