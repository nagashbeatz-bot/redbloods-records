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

type ClientOption = { id: string; name: string; type: string };
type ProjectOption = { id: string; name: string; artist: string };

const PLACEHOLDER_EXAMPLE = "לדוגמה: פרנציפ - קליפ";

function NewProductionModal({ onClose, onCreate, projects }: {
  onClose:  () => void;
  onCreate: (p: Production) => void;
  projects: ProjectOption[];
}) {
  const [title,            setTitle]            = useState("");
  const [type,             setType]             = useState("קליפ");
  const [mode,             setMode]             = useState<"project" | "manual">("project");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedClient,   setSelectedClient]   = useState<ClientOption | null>(null);
  const [clients,          setClients]          = useState<ClientOption[]>([]);
  const [clientsLoading,   setClientsLoading]   = useState(true);
  const [saving,           setSaving]           = useState(false);
  const [err,              setErr]              = useState("");

  const INPUT_S: React.CSSProperties = {
    background: "#0D0D0D", border: "1px solid #3A3A3A", borderRadius: 8,
    color: "#E8E8E8", fontSize: 13, padding: "8px 12px", outline: "none",
    fontFamily: "inherit", width: "100%", boxSizing: "border-box",
  };

  useEffect(() => {
    fetch("/api/clients")
      .then(r => r.json())
      .then(d => setClients((d.clients ?? []).map((c: ClientOption) => ({ id: c.id, name: c.name, type: c.type }))))
      .catch(() => setClients([]))
      .finally(() => setClientsLoading(false));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const selectedProject = projects.find(p => p.id === selectedProjectId) ?? null;
  const titlePlaceholder = selectedProject
    ? `לדוגמה: ${selectedProject.name} - קליפ`
    : PLACEHOLDER_EXAMPLE;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || trimmed === PLACEHOLDER_EXAMPLE) {
      setErr("יש להזין שם הפקה");
      return;
    }
    setSaving(true);
    setErr("");
    try {
      let body: Record<string, unknown> = { title: trimmed, production_type: type };

      if (mode === "project") {
        const proj = selectedProject;
        const matchedClient = proj
          ? clients.find(c => c.name === proj.artist) ?? null
          : null;
        body = {
          ...body,
          project_id:  proj?.id   ?? null,
          artist_name: proj?.artist ?? "",
          client_id:   matchedClient?.id   ?? null,
          client_name: matchedClient?.name ?? "",
        };
      } else {
        body = {
          ...body,
          project_id:  null,
          client_id:   selectedClient?.id   ?? null,
          client_name: selectedClient?.name ?? "",
          artist_name: selectedClient?.name ?? "",
        };
      }

      const res = await fetch("/api/red-films/productions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "יצירה נכשלה");
      onCreate(data.production);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "שגיאה");
    } finally {
      setSaving(false);
    }
  }

  const TAB_S = (active: boolean): React.CSSProperties => ({
    flex: 1, padding: "7px 0", borderRadius: 8, fontSize: 12, fontWeight: 600,
    cursor: "pointer", fontFamily: "inherit", border: "1px solid",
    background:  active ? "#252525" : "none",
    color:       active ? "#E8E8E8" : "#555",
    borderColor: active ? "#444"    : "#2A2A2A",
    transition: "all 0.15s",
  });

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9500, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#1A1A1A", border: "1px solid #2A2A2A", borderRadius: 16, padding: "24px", width: "min(400px, 92vw)" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 800, color: "#F0F0F0", margin: 0 }}>🎬 הפקה חדשה</h2>
          <button onClick={onClose} style={{ color: "#555", background: "none", border: "none", fontSize: 18, cursor: "pointer" }}>✕</button>
        </div>

        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* מקור הפקה — mode tabs */}
          <div>
            <label style={{ fontSize: 11, color: "#666", display: "block", marginBottom: 8 }}>מקור הפקה</label>
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" style={TAB_S(mode === "project")} onClick={() => setMode("project")}>
                מתוך פרויקט קיים
              </button>
              <button type="button" style={TAB_S(mode === "manual")} onClick={() => setMode("manual")}>
                ידני / ללא פרויקט
              </button>
            </div>
          </div>

          {/* בחירת פרויקט / לקוח לפי מצב */}
          {mode === "project" ? (
            <div>
              <label style={{ fontSize: 11, color: "#666", display: "block", marginBottom: 5 }}>פרויקט</label>
              {projects.length === 0 ? (
                <div style={{ fontSize: 12, color: "#666", fontStyle: "italic", padding: "8px 0" }}>
                  לא נמצאו פרויקטים פעילים.
                </div>
              ) : (
                <select
                  style={{ ...INPUT_S, cursor: "pointer" }}
                  value={selectedProjectId}
                  onChange={e => setSelectedProjectId(e.target.value)}
                >
                  <option value="">— בחר פרויקט —</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.name}{p.artist ? ` — ${p.artist}` : ""}</option>
                  ))}
                </select>
              )}
              {selectedProject && (
                <div style={{ fontSize: 11, color: "#555", marginTop: 6 }}>
                  אמן: <span style={{ color: "#A78BFA" }}>{selectedProject.artist || "—"}</span>
                  {clients.find(c => c.name === selectedProject.artist) && (
                    <span style={{ color: "#4ADE80", marginRight: 8 }}>✓ לקוח קיים במערכת</span>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div>
              <label style={{ fontSize: 11, color: "#666", display: "block", marginBottom: 5 }}>אמן / לקוח</label>
              {clientsLoading ? (
                <div style={{ fontSize: 12, color: "#555", padding: "8px 0" }}>טוען לקוחות...</div>
              ) : clients.length === 0 ? (
                <div style={{ fontSize: 12, color: "#666", fontStyle: "italic", padding: "8px 0" }}>
                  לא נמצאו לקוחות. יש להוסיף לקוח בעמוד לקוחות.
                </div>
              ) : (
                <select
                  style={{ ...INPUT_S, cursor: "pointer" }}
                  value={selectedClient?.id ?? ""}
                  onChange={e => {
                    const found = clients.find(c => c.id === e.target.value) ?? null;
                    setSelectedClient(found);
                  }}
                >
                  <option value="">— ללא לקוח —</option>
                  {clients.map(c => (
                    <option key={c.id} value={c.id}>{c.name} ({c.type})</option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* שם הפקה */}
          <div>
            <label style={{ fontSize: 11, color: "#666", display: "block", marginBottom: 5 }}>שם ההפקה *</label>
            <input
              style={INPUT_S}
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={titlePlaceholder}
              autoFocus
            />
          </div>

          {/* סוג הפקה */}
          <div>
            <label style={{ fontSize: 11, color: "#666", display: "block", marginBottom: 5 }}>סוג הפקה</label>
            <select style={{ ...INPUT_S, cursor: "pointer" }} value={type} onChange={e => setType(e.target.value)}>
              {PRODUCTION_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>

          {err && <div style={{ fontSize: 12, color: "#F87171" }}>{err}</div>}

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 2 }}>
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
  const [filter,      setFilter]      = useState<"פעילות" | "מבוטלות" | "הכל">("פעילות");

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

  // ── Summary counts (active only) ────────────────────────────────────────────
  const active     = productions.filter(p => p.status !== "בוטל");
  const total      = active.length;
  const inPlanning = active.filter(p => p.status === "בתכנון").length;
  const shootSet   = active.filter(p => p.status === "יום צילום נקבע").length;
  const inEdit     = active.filter(p => ["בעריכה", "נשלחה גרסה", "תיקונים"].includes(p.status)).length;
  const published  = active.filter(p => p.status === "פורסם").length;

  const visible = filter === "פעילות"
    ? productions.filter(p => p.status !== "בוטל")
    : filter === "מבוטלות"
    ? productions.filter(p => p.status === "בוטל")
    : productions;

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

      {/* ── Filter tabs ── */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {(["פעילות", "מבוטלות", "הכל"] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: "5px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600,
              cursor: "pointer", fontFamily: "inherit", border: "1px solid",
              background: filter === f ? "#252525" : "none",
              color:      filter === f ? "#E8E8E8"  : "#555",
              borderColor: filter === f ? "#444"    : "#2A2A2A",
              transition: "all 0.15s",
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {/* ── Productions table ── */}
      {loading ? (
        <div style={{ color: "#555", fontSize: 13, padding: "40px 0", textAlign: "center" }}>טוען הפקות...</div>
      ) : visible.length === 0 ? (
        <div style={{ background: "#1A1A1A", border: "1px dashed #2A2A2A", borderRadius: 14, padding: "48px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>{filter === "מבוטלות" ? "🗑️" : "🎬"}</div>
          <div style={{ fontSize: 15, color: "#888", fontWeight: 600, marginBottom: 6 }}>
            {filter === "מבוטלות" ? "אין הפקות מבוטלות" : "אין הפקות עדיין"}
          </div>
          {filter !== "מבוטלות" && (
            <>
              <div style={{ fontSize: 13, color: "#555", marginBottom: 20 }}>לחץ "+ הפקה חדשה" כדי להתחיל</div>
              <button
                onClick={() => setCreatingNew(true)}
                style={{ padding: "9px 20px", borderRadius: 10, background: "#3B82F6", border: "none", color: "#FFF", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
              >
                + הפקה חדשה
              </button>
            </>
          )}
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
          {visible.map((p, idx) => (
            <div
              key={p.id}
              onClick={() => router.push(`/red-films/${p.id}`)}
              style={{
                display: "grid",
                gridTemplateColumns: "2fr 1fr 1.2fr 1fr 1fr 1fr 1fr 0.8fr 0.8fr 60px",
                gap: 0, padding: "12px 16px",
                borderBottom: idx < visible.length - 1 ? "1px solid #1E1E1E" : "none",
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
          projects={projects}
        />
      )}

    </div>
  );
}
