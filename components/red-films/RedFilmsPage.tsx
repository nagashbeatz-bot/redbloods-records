"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useProjects } from "@/components/ProjectsProvider";
import RedFilmsStatusBadge, { PRODUCTION_TYPES, PRODUCTION_STATUSES } from "./RedFilmsStatusBadge";
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

const PLACEHOLDER_EXAMPLE = "לדוגמה: פרנציפ";

function NewProductionModal({ onClose, onCreate, projects }: {
  onClose:  () => void;
  onCreate: (p: Production) => void;
  projects: ProjectOption[];
}) {
  const [title,            setTitle]            = useState("");
  const [type,             setType]             = useState("קליפ");
  const [mode,             setMode]             = useState<"project" | "manual">("project");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  // Tracks the last value that was auto-filled — used to detect manual edits
  const autoFilledRef = useRef("");
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
    ? `לדוגמה: ${selectedProject.name}`
    : PLACEHOLDER_EXAMPLE;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || trimmed.startsWith("לדוגמה")) {
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
                  onChange={e => {
                    const newId = e.target.value;
                    setSelectedProjectId(newId);
                    const proj = projects.find(p => p.id === newId);
                    if (proj) {
                      const suggested = proj.name;
                      if (title === "" || title === autoFilledRef.current) {
                        setTitle(suggested);
                        autoFilledRef.current = suggested;
                      }
                    }
                  }}
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

// ── KPI card ──────────────────────────────────────────────────────────────────

function KpiCard({ icon, label, value, color }: { icon: string; label: string; value: number; color: string }) {
  return (
    <div
      style={{
        position: "relative", overflow: "hidden", minWidth: 0,
        background: "linear-gradient(155deg, rgba(30,30,38,0.9), rgba(17,17,21,0.92))",
        border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16,
        padding: "16px 18px",
        boxShadow: `0 10px 30px rgba(0,0,0,0.35), 0 0 0 1px ${color}12 inset`,
      }}
    >
      {/* colored glow blob */}
      <div aria-hidden style={{
        position: "absolute", top: -34, insetInlineEnd: -22, width: 96, height: 96,
        borderRadius: "50%", background: color, opacity: 0.16, filter: "blur(30px)", pointerEvents: "none",
      }} />
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ fontSize: 30, fontWeight: 800, color, lineHeight: 1, letterSpacing: "-0.02em" }}>{value}</div>
        <div style={{
          width: 38, height: 38, borderRadius: 11, flexShrink: 0,
          background: `${color}1A`, border: `1px solid ${color}33`,
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18,
        }}>{icon}</div>
      </div>
      <div style={{ position: "relative", fontSize: 12, color: "#7B7B84", marginTop: 11, fontWeight: 600 }}>{label}</div>
    </div>
  );
}

// ── Thumbnail placeholder (no image field on Production) ─────────────────────────

const TYPE_ACCENT: Record<string, string> = {
  "קליפ": "#EC4899", "יום צילום": "#60A5FA", "תוכן סושיאל": "#C084FC",
  "צילום הופעה": "#F472B6", "צילום סטודיו": "#22D3EE", "מאחורי הקלעים": "#FB923C",
  "פרסומת": "#FBBF24", "ויזואלייזר": "#A78BFA", "צילום לייב": "#34D399",
};
function accentFor(type: string) { return TYPE_ACCENT[type] ?? "#8B5CF6"; }

const menuItemS: React.CSSProperties = {
  display: "block", width: "100%", textAlign: "right",
  padding: "8px 12px", borderRadius: 8, background: "none", border: "none",
  color: "#C6C6CE", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
  fontFamily: "inherit", transition: "background 0.12s",
};

function Thumb({ p, size = 34 }: { p: Production; size?: number }) {
  const accent = accentFor(p.production_type);
  const ch = p.title.trim().charAt(0) || "🎬";
  return (
    <div style={{
      width: size, height: size, borderRadius: 9, flexShrink: 0,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.44, fontWeight: 800, color: "#fff",
      background: `linear-gradient(140deg, ${accent}, ${accent}55)`,
      boxShadow: `0 3px 12px ${accent}40`,
    }}>{ch}</div>
  );
}

// ── Confirm Dialog ────────────────────────────────────────────────────────────

function ConfirmDialog({ title, body, confirmLabel, danger = false, onConfirm, onCancel }: {
  title: string; body: string; confirmLabel: string; danger?: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  return createPortal(
    <div onClick={onCancel} style={{ position: "fixed", inset: 0, zIndex: 9600, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#1A1A1A", border: "1px solid #2A2A2A", borderRadius: 14, padding: 24, width: "min(380px, 90vw)" }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#F0F0F0", marginBottom: 10 }}>{title}</div>
        <div style={{ fontSize: 13, color: "#888", marginBottom: 22, lineHeight: 1.6 }}>{body}</div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{ padding: "8px 16px", borderRadius: 8, background: "none", border: "1px solid #333", color: "#888", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>ביטול</button>
          <button onClick={onConfirm} style={{ padding: "8px 20px", borderRadius: 8, background: danger ? "#EF4444" : "#3B82F6", border: "none", color: "#FFF", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>{confirmLabel}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Main component ────────────────────────────────────────────────────────────

type BulkAction = "trash" | "restore" | "status" | "permanent-delete";

export default function RedFilmsPage() {
  const router = useRouter();
  const { projects } = useProjects();
  const [productions, setProductions] = useState<Production[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [creatingNew, setCreatingNew] = useState(false);
  const [filter,      setFilter]      = useState<"פעילות" | "מבוטלות" | "הכל">("פעילות");
  const [isMobile,    setIsMobile]    = useState(false);
  const [openMenuId,  setOpenMenuId]  = useState<string | null>(null);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Close the per-row (⋯) menu on any outside click.
  useEffect(() => {
    if (!openMenuId) return;
    const close = () => setOpenMenuId(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [openMenuId]);

  // ── Bulk selection ──────────────────────────────────────────────────────────
  const [selectedIds,   setSelectedIds]   = useState<Set<string>>(new Set());
  const [bulkAction,    setBulkAction]    = useState<BulkAction | null>(null);
  const [bulkStatus,    setBulkStatus]    = useState<string>("");  // for "status" action
  const [bulkWorking,   setBulkWorking]   = useState(false);
  const [bulkError,     setBulkError]     = useState<string | null>(null);

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

  // Clear selection when filter changes
  useEffect(() => { setSelectedIds(new Set()); }, [filter]);

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

  // ── Selection helpers ───────────────────────────────────────────────────────
  const visibleIds   = visible.map(p => p.id);
  const allSelected  = visibleIds.length > 0 && visibleIds.every(id => selectedIds.has(id));
  const someSelected = visibleIds.some(id => selectedIds.has(id)) && !allSelected;
  const selectedCount = selectedIds.size;

  function toggleOne(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visibleIds));
    }
  }

  // ── Bulk API call ───────────────────────────────────────────────────────────
  async function patchProduction(id: string, body: Record<string, unknown>) {
    await fetch(`/api/red-films/productions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function executeBulk(newStatus: string) {
    setBulkWorking(true);
    setBulkError(null);
    try {
      await Promise.all(Array.from(selectedIds).map(id => patchProduction(id, { status: newStatus })));
      await load();
      setSelectedIds(new Set());
    } finally {
      setBulkWorking(false);
      setBulkAction(null);
      setBulkStatus("");
    }
  }

  async function executePermanentDelete() {
    setBulkWorking(true);
    setBulkError(null);
    try {
      const res = await fetch("/api/red-films/productions/bulk-permanent-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "שגיאה במחיקה");
      await load();
      setSelectedIds(new Set());
    } catch (e) {
      setBulkError(e instanceof Error ? e.message : "שגיאה במחיקה");
    } finally {
      setBulkWorking(false);
      setBulkAction(null);
    }
  }

  // ── Action Bar ─────────────────────────────────────────────────────────────
  const inTrashView = filter === "מבוטלות";

  const COL = "28px 2fr 1fr 1.2fr 1fr 1fr 1fr 1fr 0.8fr 0.8fr 84px";

  return (
    <div style={{ position: "relative", padding: isMobile ? "16px 12px calc(80px + env(safe-area-inset-bottom))" : "22px 16px 100px", maxWidth: isMobile ? "100%" : 1120, margin: "0 auto" }}>

      {/* ── Ambient header glow ── */}
      <div aria-hidden style={{
        position: "absolute", top: -10, insetInlineStart: 0, right: 0, height: 280, zIndex: 0,
        background: "radial-gradient(120% 100% at 72% 0%, rgba(236,72,153,0.12), rgba(139,92,246,0.06) 42%, transparent 74%)",
        pointerEvents: "none",
      }} />

      <div style={{ position: "relative", zIndex: 1 }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 22, gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            width: isMobile ? 46 : 52, height: isMobile ? 46 : 52, borderRadius: 15, flexShrink: 0,
            background: "linear-gradient(140deg, #EC4899, #8B5CF6)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: isMobile ? 23 : 26, boxShadow: "0 8px 26px rgba(236,72,153,0.4)",
          }}>🎬</div>
          <div>
            <h1 style={{
              fontSize: isMobile ? 24 : 28, fontWeight: 900, margin: 0, letterSpacing: "-0.02em", lineHeight: 1.1,
              background: "linear-gradient(90deg, #FFFFFF, #FBCFE8)",
              WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent",
            }}>Red Films</h1>
            <p style={{ fontSize: 13, color: "#6E6E76", margin: "4px 0 0", fontWeight: 500 }}>
              מחלקת הצילום והקליפים של Redbloods Records
            </p>
          </div>
        </div>
        <button
          onClick={() => setCreatingNew(true)}
          style={{
            padding: "11px 20px", borderRadius: 12,
            background: "linear-gradient(135deg, #EF4444, #EC4899 55%, #8B5CF6)",
            border: "none", color: "#FFF", fontSize: 13.5, fontWeight: 800,
            cursor: "pointer", fontFamily: "inherit", flexShrink: 0,
            boxShadow: "0 8px 24px rgba(236,72,153,0.38)",
            transition: "transform 0.12s, box-shadow 0.15s",
          }}
          onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "0 10px 30px rgba(236,72,153,0.5)"; }}
          onMouseLeave={e => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "0 8px 24px rgba(236,72,153,0.38)"; }}
        >
          + הפקה חדשה
        </button>
      </div>

      {/* ── KPI cards ── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: isMobile ? "repeat(2, minmax(0,1fr))" : "repeat(5, minmax(0,1fr))",
        gap: isMobile ? 10 : 12, marginBottom: 24,
      }}>
        <KpiCard icon="🎬" label="סה״כ הפקות"    value={total}      color="#9CA3AF" />
        <KpiCard icon="📋" label="בתכנון"         value={inPlanning} color="#60A5FA" />
        <KpiCard icon="🎥" label="יום צילום נקבע" value={shootSet}   color="#F472B6" />
        <KpiCard icon="✂️" label="בעריכה / גרסה"  value={inEdit}     color="#FB923C" />
        <KpiCard icon="🚀" label="פורסם"          value={published}  color="#4ADE80" />
      </div>

      {/* ── Filter chips ── */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {(["פעילות", "מבוטלות", "הכל"] as const).map(f => {
          const on = filter === f;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: "7px 18px", borderRadius: 999, fontSize: 12.5, fontWeight: 700,
                cursor: "pointer", fontFamily: "inherit", border: "1px solid",
                background:  on ? "rgba(236,72,153,0.13)" : "rgba(255,255,255,0.03)",
                color:       on ? "#F9A8D4" : "#78787F",
                borderColor: on ? "rgba(236,72,153,0.5)" : "rgba(255,255,255,0.07)",
                boxShadow:   on ? "0 0 16px rgba(236,72,153,0.18)" : "none",
                transition: "all 0.15s",
              }}
            >
              {f}
            </button>
          );
        })}
      </div>

      {/* ── Productions table ── */}
      {loading ? (
        <div style={{ color: "#555", fontSize: 13, padding: "40px 0", textAlign: "center" }}>טוען הפקות...</div>
      ) : visible.length === 0 ? (
        <div style={{ background: "linear-gradient(180deg, rgba(24,24,29,0.6), rgba(17,17,20,0.6))", border: "1px dashed rgba(255,255,255,0.1)", borderRadius: 18, padding: "48px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 34, marginBottom: 12 }}>{filter === "מבוטלות" ? "🗑️" : "🎬"}</div>
          <div style={{ fontSize: 15, color: "#9A9AA2", fontWeight: 700, marginBottom: 6 }}>
            {filter === "מבוטלות" ? "אין הפקות מבוטלות" : "אין הפקות עדיין"}
          </div>
          {filter !== "מבוטלות" && (
            <>
              <div style={{ fontSize: 13, color: "#6E6E76", marginBottom: 20 }}>לחץ "+ הפקה חדשה" כדי להתחיל</div>
              <button
                onClick={() => setCreatingNew(true)}
                style={{ padding: "10px 22px", borderRadius: 11, background: "linear-gradient(135deg, #EF4444, #EC4899 55%, #8B5CF6)", border: "none", color: "#FFF", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", boxShadow: "0 8px 22px rgba(236,72,153,0.35)" }}
              >
                + הפקה חדשה
              </button>
            </>
          )}
        </div>
      ) : isMobile ? (
        /* ── Mobile card list ── */
        <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
          {visible.map(p => (
            <div
              key={p.id}
              onClick={() => router.push(`/red-films/${p.id}`)}
              style={{
                background: "linear-gradient(165deg, rgba(26,26,31,0.9), rgba(17,17,20,0.92))",
                border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16,
                padding: "14px 15px", cursor: "pointer",
                boxShadow: "0 8px 26px rgba(0,0,0,0.32)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 10 }}>
                <Thumb p={p} size={42} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: "#EDEDF2", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.title}
                  </div>
                  {(p.artist_name || p.client_name) && (
                    <div style={{ fontSize: 12, color: "#8A8A92", marginTop: 2 }}>
                      {p.artist_name || p.client_name}
                    </div>
                  )}
                </div>
                <RedFilmsStatusBadge status={p.status} small />
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 11, color: "#6E6E76", alignItems: "center" }}>
                {p.production_type && <span style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 999, padding: "3px 10px", color: "#8A8A92", fontWeight: 600 }}>{p.production_type}</span>}
                {p.shoot_date && <span>📅 {fmtDate(p.shoot_date)}</span>}
                {p.photographer_name && <span>📷 {p.photographer_name}</span>}
                {p.general_budget ? <span style={{ color: "#4ADE80", fontWeight: 700 }}>₪{p.general_budget.toLocaleString("he-IL")}</span> : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{
          background: "linear-gradient(180deg, rgba(24,24,29,0.72), rgba(17,17,20,0.72))",
          border: "1px solid rgba(255,255,255,0.06)", borderRadius: 18, overflow: "hidden",
          boxShadow: "0 14px 44px rgba(0,0,0,0.38)",
        }}>

          {/* Table header */}
          <div style={{
            display: "grid", gridTemplateColumns: COL,
            gap: 0, padding: "12px 18px",
            background: "rgba(255,255,255,0.02)", borderBottom: "1px solid rgba(255,255,255,0.06)",
            fontSize: 10.5, color: "#5C5C64", fontWeight: 800, letterSpacing: "0.02em", alignItems: "center",
          }}>
            {/* Select-all checkbox */}
            <div onClick={e => e.stopPropagation()}>
              <input
                type="checkbox"
                checked={allSelected}
                ref={el => { if (el) el.indeterminate = someSelected; }}
                onChange={toggleAll}
                style={{ cursor: "pointer", accentColor: "#EC4899", width: 14, height: 14 }}
              />
            </div>
            {["שם הפקה", "סוג", "אמן / לקוח", "פרויקט", "צלם", "תאריך", "סטטוס", "תקציב", "מחיר ל״ק", ""].map((h, i) => (
              <div key={i} style={{ paddingRight: i > 0 ? 8 : 0 }}>{h}</div>
            ))}
          </div>

          {/* Rows */}
          {visible.map((p, idx) => {
            const isSelected = selectedIds.has(p.id);
            const rowBg = isSelected ? "rgba(236,72,153,0.08)" : "transparent";
            return (
              <div
                key={p.id}
                onClick={() => router.push(`/red-films/${p.id}`)}
                style={{
                  display: "grid", gridTemplateColumns: COL,
                  gap: 0, padding: "13px 18px",
                  borderBottom: idx < visible.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                  cursor: "pointer", transition: "background 0.15s",
                  fontSize: 12, color: "#C6C6CE", alignItems: "center",
                  background: rowBg,
                }}
                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = "rgba(255,255,255,0.028)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = rowBg; }}
              >
                {/* Checkbox */}
                <div onClick={e => { e.stopPropagation(); toggleOne(p.id); }}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleOne(p.id)}
                    style={{ cursor: "pointer", accentColor: "#EC4899", width: 14, height: 14 }}
                  />
                </div>
                {/* Name + thumbnail */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, paddingLeft: 4 }}>
                  <Thumb p={p} />
                  <span style={{ fontWeight: 700, color: "#EDEDF2", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.title}
                  </span>
                </div>
                <div style={{ color: "#8A8A92" }}>{p.production_type}</div>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.artist_name || p.client_name || <span style={{ color: "#4A4A50" }}>—</span>}
                </div>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.project_id
                    ? <span style={{ color: "#60A5FA" }}>{projectName(p.project_id) ?? "…"}</span>
                    : <span style={{ color: "#4A4A50" }}>—</span>}
                </div>
                <div style={{ color: "#8A8A92" }}>{p.photographer_name || "—"}</div>
                <div style={{ color: "#8A8A92" }}>{fmtDate(p.shoot_date)}</div>
                <div><RedFilmsStatusBadge status={p.status} small /></div>
                <div style={{ color: "#8A8A92" }}>{p.general_budget ? fmtNum(p.general_budget) : "—"}</div>
                <div style={{ color: "#8A8A92" }}>{p.client_price ? fmtNum(p.client_price) : "—"}</div>
                {/* Open + ⋯ menu */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, position: "relative" }} onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => router.push(`/red-films/${p.id}`)}
                    style={{
                      padding: "5px 12px", borderRadius: 9,
                      background: "rgba(236,72,153,0.1)", border: "1px solid rgba(236,72,153,0.32)",
                      color: "#F9A8D4", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = "rgba(236,72,153,0.2)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "rgba(236,72,153,0.1)"; }}
                  >
                    פתח
                  </button>
                  <button
                    aria-label="פעולות"
                    onClick={() => setOpenMenuId(openMenuId === p.id ? null : p.id)}
                    style={{
                      width: 26, height: 26, borderRadius: 8, flexShrink: 0,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: openMenuId === p.id ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.03)",
                      border: "1px solid rgba(255,255,255,0.08)", color: "#9A9AA2",
                      fontSize: 15, cursor: "pointer", fontFamily: "inherit", lineHeight: 1,
                    }}
                  >
                    ⋯
                  </button>
                  {openMenuId === p.id && (
                    <div style={{
                      position: "absolute", top: "calc(100% + 6px)", insetInlineStart: 0, zIndex: 50,
                      minWidth: 168, background: "#1B1B20", border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 12, padding: 6, boxShadow: "0 16px 44px rgba(0,0,0,0.6)",
                    }}>
                      <button
                        onClick={() => { setOpenMenuId(null); router.push(`/red-films/${p.id}`); }}
                        style={menuItemS}
                        onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "none"; }}
                      >🎬 פתח הפקה</button>
                      <button
                        onClick={() => { setOpenMenuId(null); window.open(`/red-films/${p.id}`, "_blank", "noopener"); }}
                        style={menuItemS}
                        onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "none"; }}
                      >↗ פתח בכרטיסייה חדשה</button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Action Bar (floating, like Monday) ── */}
      {selectedCount > 0 && typeof window !== "undefined" && createPortal(
        <div style={{
          position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)",
          background: "#1A1A1A", border: "1px solid #333", borderRadius: 14,
          padding: "10px 18px", display: "flex", alignItems: "center", gap: 14,
          boxShadow: "0 8px 40px rgba(0,0,0,0.7)", zIndex: 9000,
          fontSize: 13, color: "#E8E8E8", minWidth: 320,
        }}>
          <span style={{ color: "#60A5FA", fontWeight: 700 }}>{selectedCount} הפקות נבחרו</span>
          <div style={{ width: 1, height: 20, background: "#333" }} />

          {inTrashView ? (
            /* סל מיחזור — שחזור + מחיקה לצמיתות */
            <>
              <button
                onClick={() => setBulkAction("restore")}
                disabled={bulkWorking}
                style={{ padding: "6px 14px", borderRadius: 8, background: "#1D4ED8", border: "none", color: "#FFF", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
              >
                ♻️ שחזר
              </button>
              <button
                onClick={() => setBulkAction("permanent-delete")}
                disabled={bulkWorking}
                style={{ padding: "6px 14px", borderRadius: 8, background: "rgba(239,68,68,0.18)", border: "1px solid rgba(239,68,68,0.4)", color: "#F87171", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
              >
                🗑️ מחק לצמיתות
              </button>
            </>
          ) : (
            /* פעילות — העבר לסל + שנה סטטוס */
            <>
              <button
                onClick={() => setBulkAction("trash")}
                disabled={bulkWorking}
                style={{ padding: "6px 14px", borderRadius: 8, background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", color: "#F87171", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
              >
                🗑️ העבר לסל
              </button>
              <div style={{ position: "relative" }}>
                <select
                  value={bulkStatus}
                  onChange={e => { setBulkStatus(e.target.value); if (e.target.value) setBulkAction("status"); }}
                  style={{ padding: "6px 28px 6px 10px", borderRadius: 8, background: "#252525", border: "1px solid #444", color: bulkStatus ? "#E8E8E8" : "#666", fontSize: 12, cursor: "pointer", fontFamily: "inherit", appearance: "none" }}
                >
                  <option value="">שנה סטטוס...</option>
                  {PRODUCTION_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <span style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", fontSize: 10, color: "#666" }}>▼</span>
              </div>
            </>
          )}

          <button
            onClick={() => { setSelectedIds(new Set()); setBulkStatus(""); }}
            style={{ marginRight: "auto", padding: "4px 10px", borderRadius: 7, background: "none", border: "1px solid #333", color: "#555", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}
          >
            ✕ בטל בחירה
          </button>
        </div>,
        document.body
      )}

      {/* ── Confirm: trash ── */}
      {bulkAction === "trash" && (
        <ConfirmDialog
          title={`להעביר ${selectedCount} הפקות לסל מיחזור?`}
          body="הפקות אלו יוסתרו מהרשימה הראשית, אך לא יימחקו לצמיתות. משימות עתידיות קשורות יבוטלו."
          confirmLabel={bulkWorking ? "מעביר..." : "כן, העבר לסל"}
          danger
          onConfirm={() => executeBulk("בוטל")}
          onCancel={() => setBulkAction(null)}
        />
      )}

      {/* ── Confirm: restore ── */}
      {bulkAction === "restore" && (
        <ConfirmDialog
          title={`לשחזר ${selectedCount} הפקות?`}
          body="ההפקות יחזרו לרשימה הפעילה עם סטטוס 'רעיון'. משימות שבוטלו לא ישוחזרו אוטומטית."
          confirmLabel={bulkWorking ? "משחזר..." : "כן, שחזר"}
          onConfirm={() => executeBulk("רעיון")}
          onCancel={() => setBulkAction(null)}
        />
      )}

      {/* ── Confirm: change status ── */}
      {bulkAction === "status" && bulkStatus && (
        <ConfirmDialog
          title={`לשנות סטטוס ל-"${bulkStatus}" עבור ${selectedCount} הפקות?`}
          body={bulkStatus === "בוטל" ? "משימות עתידיות קשורות יבוטלו." : ""}
          confirmLabel={bulkWorking ? "מעדכן..." : `שנה ל-${bulkStatus}`}
          danger={bulkStatus === "בוטל"}
          onConfirm={() => executeBulk(bulkStatus)}
          onCancel={() => { setBulkAction(null); setBulkStatus(""); }}
        />
      )}

      {/* ── Confirm: permanent delete ── */}
      {bulkAction === "permanent-delete" && (
        <ConfirmDialog
          title="מחיקה לצמיתות"
          body={`אתה עומד למחוק לצמיתות ${selectedCount} הפקות.\nפעולה זו אינה ניתנת לשחזור.\n\nייימחקו גם: תמונות רפרנס (כולל Dropbox), פריטי תקציב, ומשימות קשורות.`}
          confirmLabel={bulkWorking ? "מוחק..." : "מחק לצמיתות"}
          danger
          onConfirm={executePermanentDelete}
          onCancel={() => setBulkAction(null)}
        />
      )}

      {/* ── Error banner ── */}
      {bulkError && typeof window !== "undefined" && createPortal(
        <div style={{
          position: "fixed", bottom: 90, left: "50%", transform: "translateX(-50%)",
          background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.35)",
          borderRadius: 10, padding: "10px 18px", zIndex: 9100,
          fontSize: 13, color: "#F87171", display: "flex", gap: 12, alignItems: "center",
        }}>
          <span>{bulkError}</span>
          <button onClick={() => setBulkError(null)} style={{ background: "none", border: "none", color: "#F87171", cursor: "pointer", fontSize: 16 }}>✕</button>
        </div>,
        document.body
      )}

      {/* ── New production modal ── */}
      {creatingNew && (
        <NewProductionModal
          onClose={() => setCreatingNew(false)}
          onCreate={handleCreated}
          projects={projects}
        />
      )}

      </div>{/* /header-glow layer */}
    </div>
  );
}
