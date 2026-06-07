"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useProjects } from "@/components/ProjectsProvider";
import RedFilmsStatusBadge, { PRODUCTION_TYPES } from "./RedFilmsStatusBadge";
import type { Production } from "./RedFilmProductionDrawer";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string | null) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${parseInt(day, 10)}.${parseInt(m, 10)}.${y.slice(2)}`;
}

function fmtNum(n: number) {
  return n ? `₪${n.toLocaleString("he-IL")}` : "—";
}

// ── New Production Modal ──────────────────────────────────────────────────────

function NewProductionModal({ onClose, onCreate }: {
  onClose: () => void;
  onCreate: (p: Production) => void;
}) {
  const [title,   setTitle]   = useState("");
  const [type,    setType]    = useState("קליפ");
  const [artist,  setArtist]  = useState("");
  const [saving,  setSaving]  = useState(false);
  const [err,     setErr]     = useState("");

  const INPUT_S: React.CSSProperties = {
    background: "#0D0D0D", border: "1px solid #3A3A3A", borderRadius: 8,
    color: "#E8E8E8", fontSize: 13, padding: "8px 12px", outline: "none",
    fontFamily: "inherit", width: "100%", boxSizing: "border-box",
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setErr("שם ההפקה חובה"); return; }
    setSaving(true);
    setErr("");
    try {
      const res = await fetch("/api/red-films/productions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), production_type: type, artist_name: artist.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "יצירה נכשלה");
      onCreate(data.production);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "שגיאה");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9500, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#1A1A1A", border: "1px solid #2A2A2A", borderRadius: 16, padding: "24px", width: "min(360px, 90vw)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 800, color: "#F0F0F0", margin: 0 }}>🎬 הפקה חדשה</h2>
          <button onClick={onClose} style={{ color: "#555", background: "none", border: "none", fontSize: 18, cursor: "pointer" }}>✕</button>
        </div>
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ fontSize: 11, color: "#666", display: "block", marginBottom: 5 }}>שם ההפקה *</label>
            <input
              style={INPUT_S}
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="פרנציפ - קליפ"
              autoFocus
            />
          </div>
          <div>
            <label style={{ fontSize: 11, color: "#666", display: "block", marginBottom: 5 }}>סוג הפקה</label>
            <select style={{ ...INPUT_S, cursor: "pointer" }} value={type} onChange={e => setType(e.target.value)}>
              {PRODUCTION_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, color: "#666", display: "block", marginBottom: 5 }}>אמן (אופציונלי)</label>
            <input style={INPUT_S} value={artist} onChange={e => setArtist(e.target.value)} placeholder="שם האמן..." />
          </div>
          {err && <div style={{ fontSize: 12, color: "#F87171" }}>{err}</div>}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
            <button type="button" onClick={onClose} style={{ padding: "8px 16px", borderRadius: 8, background: "none", border: "1px solid #333", color: "#888", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
              ביטול
            </button>
            <button type="submit" disabled={saving} style={{ padding: "8px 20px", borderRadius: 8, background: "#3B82F6", border: "none", color: "#FFF", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", opacity: saving ? 0.7 : 1 }}>
              {saving ? "יוצר..." : "צור הפקה"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

// ── Summary card ──────────────────────────────────────────────────────────────

function SummaryCard({ label, value, color = "#888" }: { label: string; value: number; color?: string }) {
  return (
    <div style={{ background: "#1A1A1A", border: "1px solid #252525", borderRadius: 12, padding: "14px 16px", minWidth: 0 }}>
      <div style={{ fontSize: 22, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 11, color: "#555", marginTop: 3 }}>{label}</div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RedFilmsPage() {
  const router = useRouter();
  const { projects } = useProjects();
  const [productions, setProductions] = useState<Production[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [creatingNew, setCreatingNew] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch("/api/red-films/productions");
      const data = await res.json().catch(() => ({}));
      setProductions(data.productions ?? []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // project name lookup
  const projectName = (id: string | null) =>
    id ? (projects.find(p => p.id === id)?.name ?? null) : null;

  function handleCreated(p: Production) {
    setCreatingNew(false);
    router.push(`/red-films/${p.id}`);
  }

  // ── Summary counts ──────────────────────────────────────────────────────────
  const total      = productions.length;
  const inPlanning = productions.filter(p => p.status === "בתכנון").length;
  const shootSet   = productions.filter(p => p.status === "יום צילום נקבע").length;
  const inEdit     = productions.filter(p => ["בעריכה", "נשלחה גרסה", "תיקונים"].includes(p.status)).length;
  const published  = productions.filter(p => p.status === "פורסם").length;

  return (
    <div style={{ padding: "20px 16px 100px", maxWidth: 1100, margin: "0 auto" }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20, gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "#F0F0F0", margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
            🎬 Red Films
          </h1>
          <p style={{ fontSize: 13, color: "#555", margin: "4px 0 0" }}>
            מחלקת הצילום והקליפים של Redbloods Records
          </p>
        </div>
        <button
          onClick={() => setCreatingNew(true)}
          style={{
            padding: "9px 18px", borderRadius: 10,
            background: "linear-gradient(135deg, #EC4899, #3B82F6)",
            border: "none", color: "#FFF", fontSize: 13, fontWeight: 700,
            cursor: "pointer", fontFamily: "inherit", flexShrink: 0,
          }}
        >
          + הפקה חדשה
        </button>
      </div>

      {/* ── Summary cards ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginBottom: 24 }}>
        <SummaryCard label="סה״כ הפקות"         value={total}      color="#9CA3AF" />
        <SummaryCard label="בתכנון"              value={inPlanning} color="#60A5FA" />
        <SummaryCard label="יום צילום נקבע"      value={shootSet}   color="#F472B6" />
        <SummaryCard label="בעריכה / גרסה"       value={inEdit}     color="#FB923C" />
        <SummaryCard label="פורסם"               value={published}  color="#4ADE80" />
      </div>

      {/* ── Productions table ── */}
      {loading ? (
        <div style={{ color: "#555", fontSize: 13, padding: "40px 0", textAlign: "center" }}>טוען הפקות...</div>
      ) : productions.length === 0 ? (
        <div style={{ background: "#1A1A1A", border: "1px dashed #2A2A2A", borderRadius: 14, padding: "48px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🎬</div>
          <div style={{ fontSize: 15, color: "#888", fontWeight: 600, marginBottom: 6 }}>אין הפקות עדיין</div>
          <div style={{ fontSize: 13, color: "#555", marginBottom: 20 }}>לחץ "+ הפקה חדשה" כדי להתחיל</div>
          <button
            onClick={() => setCreatingNew(true)}
            style={{ padding: "9px 20px", borderRadius: 10, background: "#3B82F6", border: "none", color: "#FFF", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
          >
            + הפקה חדשה
          </button>
        </div>
      ) : (
        <div style={{ background: "#1A1A1A", border: "1px solid #252525", borderRadius: 14, overflow: "hidden" }}>

          {/* Table header */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr 1.2fr 1fr 1fr 1fr 1fr 0.8fr 0.8fr 60px",
            gap: 0, padding: "10px 16px",
            background: "#161616", borderBottom: "1px solid #222",
            fontSize: 10, color: "#444", fontWeight: 700,
          }}>
            {["שם הפקה", "סוג", "אמן / לקוח", "פרויקט", "צלם", "תאריך", "סטטוס", "תקציב", "מחיר ל״ק", ""].map((h, i) => (
              <div key={i} style={{ paddingRight: i > 0 ? 8 : 0 }}>{h}</div>
            ))}
          </div>

          {/* Rows */}
          {productions.map((p, idx) => (
            <div
              key={p.id}
              onClick={() => router.push(`/red-films/${p.id}`)}
              style={{
                display: "grid",
                gridTemplateColumns: "2fr 1fr 1.2fr 1fr 1fr 1fr 1fr 0.8fr 0.8fr 60px",
                gap: 0, padding: "12px 16px",
                borderBottom: idx < productions.length - 1 ? "1px solid #1E1E1E" : "none",
                cursor: "pointer", transition: "background 0.15s",
                fontSize: 12, color: "#CCC", alignItems: "center",
              }}
              onMouseEnter={e => (e.currentTarget.style.background = "#1E1E1E")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
            >
              <div style={{ fontWeight: 600, color: "#E8E8E8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingLeft: 4 }}>
                {p.title}
              </div>
              <div style={{ color: "#888" }}>{p.production_type}</div>
              <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {p.artist_name || p.client_name || <span style={{ color: "#444" }}>—</span>}
              </div>
              <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {p.project_id
                  ? <span style={{ color: "#60A5FA" }}>{projectName(p.project_id) ?? "…"}</span>
                  : <span style={{ color: "#444" }}>—</span>}
              </div>
              <div style={{ color: "#888" }}>{p.photographer_name || "—"}</div>
              <div style={{ color: "#888" }}>{fmtDate(p.shoot_date)}</div>
              <div><RedFilmsStatusBadge status={p.status} small /></div>
              <div style={{ color: "#888" }}>{p.general_budget ? fmtNum(p.general_budget) : "—"}</div>
              <div style={{ color: "#888" }}>{p.client_price ? fmtNum(p.client_price) : "—"}</div>
              <div>
                <button
                  onClick={e => { e.stopPropagation(); router.push(`/red-films/${p.id}`); }}
                  style={{ padding: "4px 10px", borderRadius: 6, background: "#252525", border: "1px solid #333", color: "#888", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}
                >
                  פתח
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── New production modal ── */}
      {creatingNew && (
        <NewProductionModal
          onClose={() => setCreatingNew(false)}
          onCreate={handleCreated}
        />
      )}

    </div>
  );
}
