"use client";

import { useState, useEffect, useCallback, useRef, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useProjects } from "@/components/ProjectsProvider";
import { usePlayerSafe, getLatestAudioFile, getFreshPlayUrl } from "@/components/PlayerProvider";
import RedFilmsReferencesBoard from "./RedFilmsReferencesBoard";
import RedFilmsDocuments from "./RedFilmsDocuments";
import RedFilmsYouTubeRefs from "./RedFilmsYouTubeRefs";
import RedFilmsBudgetItems from "./RedFilmsBudgetItems";
import RedFilmsProductionTasks from "./RedFilmsProductionTasks";
import RedFilmsLayoutModal from "./RedFilmsLayoutModal";
import DatePickerInput from "@/components/ui/DatePickerInput";
import RedFilmsStatusBadge, {
  PRODUCTION_STATUSES,
  PRODUCTION_TYPES,
  COLLECTION_STATUSES,
  EDIT_STATUSES,
  CLIENT_SOURCES,
} from "./RedFilmsStatusBadge";
import { useProductionLayout, CREATIVE_SECTIONS } from "@/lib/production-layout";
import type { Production } from "./RedFilmProductionDrawer";

// ── Style constants ───────────────────────────────────────────────────────────

const INPUT_S: CSSProperties = {
  background: "#0D0D0D", border: "1px solid #3A3A3A", borderRadius: 6,
  color: "#E8E8E8", fontSize: 13, padding: "6px 10px", outline: "none",
  fontFamily: "inherit", height: 32, boxSizing: "border-box", width: "100%",
};

const TEXTAREA_S: CSSProperties = {
  ...INPUT_S, height: "auto", minHeight: 72,
  padding: "8px 10px", resize: "vertical", lineHeight: 1.6,
};

const SELECT_S: CSSProperties = { ...INPUT_S, cursor: "pointer" };

// ── Red Films design tokens (matched to the main Red Films page) ───────────────
const RED = "#DC2626";
const RED_LIGHT = "#F87171";

// Panel/card recipe — dark red gradient, faint red border + glow (same language
// as the main Red Films list page).
const CARD_STYLE: CSSProperties = {
  position: "relative",
  background: "linear-gradient(180deg, rgba(24,16,17,0.72), rgba(15,12,13,0.82))",
  border: `1px solid ${RED}1F`,
  borderRadius: 18,
  boxShadow: "0 14px 44px rgba(0,0,0,0.42), 0 0 14px rgba(220,38,38,0.04)",
  padding: "18px 20px",
  overflow: "hidden",
};
// Inner sub-tile inside a card (budget numbers, script blocks, file links).
const INNER_TILE: CSSProperties = {
  background: "rgba(220,38,38,0.045)",
  border: `1px solid ${RED}1A`,
  borderRadius: 12,
  padding: "11px 13px",
};

const ICON_PROPS = {
  width: 22, height: 22, viewBox: "0 0 24 24", fill: "none",
  stroke: "currentColor", strokeWidth: 1.7,
  strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
};
const KPI_ICON: Record<string, ReactNode> = {
  budget:   <svg {...ICON_PROPS}><rect x="2.5" y="6" width="19" height="12" rx="2" /><circle cx="12" cy="12" r="2.6" /><path d="M6 9v6M18 9v6" /></svg>,
  price:    <svg {...ICON_PROPS}><path d="M20.5 13.5l-7 7L3 10V3.5h6.5z" /><circle cx="7.5" cy="7.5" r="1.1" /></svg>,
  advance:  <svg {...ICON_PROPS}><rect x="2.5" y="6" width="19" height="13" rx="2.5" /><path d="M2.5 10h19" /><path d="M16.5 14.5h2" /></svg>,
  type:     <svg {...ICON_PROPS}><rect x="2.5" y="7" width="19" height="13" rx="2" /><path d="M2.5 11h19M8 7l-2 4M13.5 7l-2 4" /></svg>,
  status:   <svg {...ICON_PROPS}><circle cx="12" cy="12" r="9" /><path d="M8.3 12.4l2.5 2.5 4.7-5.2" /></svg>,
  calendar: <svg {...ICON_PROPS}><rect x="3" y="4.5" width="18" height="16" rx="2.5" /><path d="M3 9.5h18M8 3v3.5M16 3v3.5" /></svg>,
};

// A single KPI tile — red icon box + value/label, matching the reference row.
function KpiCard({ icon, label, value, valueColor }: {
  icon: ReactNode; label: string; value: ReactNode; valueColor?: string;
}) {
  return (
    <div style={{
      position: "relative",
      background: "linear-gradient(160deg, rgba(28,16,17,0.9), rgba(14,11,12,0.96))",
      border: `1px solid ${RED}24`, borderRadius: 16, padding: "15px 16px",
      boxShadow: "0 10px 30px rgba(0,0,0,0.42), 0 0 14px rgba(220,38,38,0.05)",
      overflow: "hidden", minWidth: 0,
    }}>
      <div style={{ position: "absolute", top: -30, insetInlineStart: -24, width: 92, height: 92, borderRadius: "50%", background: RED, opacity: 0.09, filter: "blur(32px)", pointerEvents: "none" }} />
      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{
          width: 42, height: 42, borderRadius: 12, flexShrink: 0, color: RED_LIGHT,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "radial-gradient(circle at 50% 38%, rgba(220,38,38,0.20), rgba(220,38,38,0.04))",
          border: `1px solid ${RED}54`,
          boxShadow: "0 0 12px rgba(220,38,38,0.2), inset 0 0 8px rgba(220,38,38,0.12)",
        }}>{icon}</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 19, fontWeight: 800, color: valueColor ?? "#F4F4F6", letterSpacing: "-0.01em", lineHeight: 1.15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
          <div style={{ fontSize: 12, color: "#96969C", marginTop: 3, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</div>
        </div>
      </div>
    </div>
  );
}

// Cover/preview placeholder — no cover field on Production, so a branded red
// gradient block with a clapper glyph (honest empty visual, on-brand).
function HeroCover({ mobile }: { mobile: boolean }) {
  return (
    <div style={{
      position: "relative", flexShrink: 0,
      width: mobile ? "100%" : 230, height: mobile ? 150 : 138,
      borderRadius: 14, overflow: "hidden",
      background: "linear-gradient(140deg, #DC2626, #7F1D1D)",
      border: `1px solid ${RED}5A`,
      boxShadow: "0 0 22px rgba(220,38,38,0.28), inset 0 0 30px rgba(0,0,0,0.35)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(120% 100% at 30% 0%, rgba(255,255,255,0.14), transparent 55%)", pointerEvents: "none" }} />
      <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.92 }}>
        <rect x="2.5" y="7" width="19" height="13" rx="2" /><path d="M2.5 11h19M8 7l-2 4M13.5 7l-2 4M19 7l-2 4" />
      </svg>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string | null) {
  if (!d) return null;
  const [y, m, day] = d.split("-");
  return `${parseInt(day, 10)}.${parseInt(m, 10)}.${y}`;
}

function fmtNum(n: number) {
  return n ? `₪${n.toLocaleString("he-IL")}` : "—";
}

// ── Small UI helpers ──────────────────────────────────────────────────────────

function SCard({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ ...CARD_STYLE, ...style }}>
      {children}
    </div>
  );
}

function SLabel({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 11, color: "#555", marginBottom: 5, fontWeight: 600 }}>{children}</div>;
}

function SRow({ label, children, half }: { label: string; children: ReactNode; half?: boolean }) {
  return (
    <div style={{ gridColumn: half ? "span 1" : "span 2" }}>
      <SLabel>{label}</SLabel>
      {children}
    </div>
  );
}

function SDivider() {
  return <div style={{ height: 1, background: "#252525", margin: "14px 0" }} />;
}

function SectionHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 10 }}>
      <h2 style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 14, fontWeight: 700, color: "#EDEDF2", margin: 0 }}>
        <span style={{ width: 3, height: 15, borderRadius: 2, background: `linear-gradient(180deg, ${RED}, #7F1D1D)`, boxShadow: "0 0 8px rgba(220,38,38,0.4)", flexShrink: 0 }} />
        {title}
      </h2>
      {children}
    </div>
  );
}

function EditActions({ section, editing, saving, onEdit, onSave, onCancel }: {
  section: string; editing: string | null; saving: boolean;
  onEdit: () => void; onSave: () => void; onCancel: () => void;
}) {
  if (editing !== section) {
    return (
      <button onClick={onEdit}
        style={{ fontSize: 11, color: "#555", background: "none", border: "1px solid #333", borderRadius: 6, cursor: "pointer", fontFamily: "inherit", padding: "4px 10px" }}>
        ✏ ערוך
      </button>
    );
  }
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <button onClick={onSave} disabled={saving}
        style={{ fontSize: 11, color: "#FFF", background: "linear-gradient(135deg, #EF4444, #B91C1C)", border: "1px solid rgba(248,113,113,0.4)", borderRadius: 6, cursor: "pointer", fontFamily: "inherit", padding: "4px 14px", fontWeight: 700, opacity: saving ? 0.7 : 1 }}>
        {saving ? "שומר..." : "✓ שמור"}
      </button>
      <button onClick={onCancel} disabled={saving}
        style={{ fontSize: 11, color: "#888", background: "none", border: "1px solid #333", borderRadius: 6, cursor: "pointer", fontFamily: "inherit", padding: "4px 10px" }}>
        ביטול
      </button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RedFilmProductionPage({ id }: { id: string }) {
  const router = useRouter();
  const { projects } = useProjects();

  const [prod,    setProd]    = useState<Production | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [trashConfirm, setTrashConfirm] = useState(false);
  const [trashing,     setTrashing]     = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [showLayoutModal, setShowLayoutModal] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const { layout, save: saveLayout, reset: resetLayout } = useProductionLayout();

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const player = usePlayerSafe();

  // Drafts
  const [draftSummary, setDraftSummary] = useState<Production | null>(null);
  const [draftConcept, setDraftConcept] = useState<Production | null>(null);
  const [draftBudget,  setDraftBudget]  = useState<Production | null>(null);
  const [draftFiles,   setDraftFiles]   = useState<Production | null>(null);
  const [draftNotes,   setDraftNotes]   = useState("");

  // Load production
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch(`/api/red-films/productions/${id}`);
      if (res.status === 404) { setNotFound(true); return; }
      const data = await res.json().catch(() => ({}));
      const p: Production = data.production;
      setProd(p);
      setDraftSummary(p);
      setDraftConcept(p);
      setDraftBudget(p);
      setDraftFiles(p);
      setDraftNotes(p.notes);
    } catch { setNotFound(true); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Patch helper
  const patch = useCallback(async (fields: Partial<Production>) => {
    if (!prod) return null;
    setSaving(true); setSaveErr(null);
    try {
      const res  = await fetch(`/api/red-films/productions/${prod.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "שמירה נכשלה");
      const updated: Production = data.production;
      setProd(updated);
      setDraftSummary(updated);
      setDraftConcept(updated);
      setDraftBudget(updated);
      setDraftFiles(updated);
      setDraftNotes(updated.notes);
      return updated;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "שגיאה";
      setSaveErr(msg);
      setTimeout(() => setSaveErr(null), 4000);
      return null;
    } finally { setSaving(false); }
  }, [prod]);

  function startEdit(section: string) {
    if (!prod) return;
    setDraftSummary({ ...prod });
    setDraftConcept({ ...prod });
    setDraftBudget({ ...prod });
    setDraftFiles({ ...prod });
    setDraftNotes(prod.notes);
    setEditing(section);
  }
  function cancelEdit() { setEditing(null); }

  async function saveSummary() {
    if (!draftSummary) return;
    const r = await patch({
      title: draftSummary.title, production_type: draftSummary.production_type,
      status: draftSummary.status, artist_name: draftSummary.artist_name,
      client_name: draftSummary.client_name, client_source: draftSummary.client_source,
      photographer_name: draftSummary.photographer_name, director_name: draftSummary.director_name,
      editor_name: draftSummary.editor_name,
      shoot_date: draftSummary.shoot_date || null, locations: draftSummary.locations,
    });
    if (r) setEditing(null);
  }
  async function saveConcept() {
    if (!draftConcept) return;
    const r = await patch({
      concept_summary: draftConcept.concept_summary, concept_vibe: draftConcept.concept_vibe,
      ref_links: draftConcept.ref_links, script_start: draftConcept.script_start,
      script_middle: draftConcept.script_middle, script_end: draftConcept.script_end,
      director_notes: draftConcept.director_notes, photographer_notes: draftConcept.photographer_notes,
    });
    if (r) setEditing(null);
  }
  async function saveBudget() {
    if (!draftBudget) return;
    const r = await patch({
      general_budget: Number(draftBudget.general_budget) || 0,
      client_price: Number(draftBudget.client_price) || 0,
      advance_required: Number(draftBudget.advance_required) || 0,
      advance_received: Number(draftBudget.advance_received) || 0,
      collection_status: draftBudget.collection_status,
    });
    if (r) setEditing(null);
  }
  async function saveFiles() {
    if (!draftFiles) return;
    const r = await patch({
      files_raw_link: draftFiles.files_raw_link, files_edit_folder: draftFiles.files_edit_folder,
      version_1_link: draftFiles.version_1_link, version_2_link: draftFiles.version_2_link,
      final_version_link: draftFiles.final_version_link, fix_notes: draftFiles.fix_notes,
      edit_status: draftFiles.edit_status,
      publish_date: draftFiles.publish_date || null, published_where: draftFiles.published_where,
    });
    if (r) setEditing(null);
  }
  async function saveNotes() {
    const r = await patch({ notes: draftNotes });
    if (r) setEditing(null);
  }

  async function moveToTrash() {
    setTrashing(true);
    const r = await patch({ status: "בוטל" });
    setTrashing(false);
    if (r) router.push("/red-films");
  }

  async function createDropboxFolder() {
    if (!prod) return;
    setCreatingFolder(true);
    try {
      const res  = await fetch(`/api/red-films/productions/${prod.id}/dropbox-folder`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "שגיאה");
      setProd(p => p ? { ...p, dropbox_folder_url: data.folderUrl, dropbox_folder_path: data.folderPath } : p);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "שגיאה";
      setSaveErr(msg);
      setTimeout(() => setSaveErr(null), 4000);
    } finally { setCreatingFolder(false); }
  }

  const projectName = prod?.project_id
    ? (projects.find(p => p.id === prod.project_id)?.name ?? null)
    : null;

  // ── Loading / error states ────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ padding: "60px 24px", textAlign: "center", color: "#555" }}>
        טוען הפקה...
      </div>
    );
  }
  if (notFound || !prod) {
    return (
      <div style={{ padding: "60px 24px", textAlign: "center" }}>
        <div style={{ fontSize: 15, color: "#888", marginBottom: 16 }}>הפקה לא נמצאה</div>
        <button onClick={() => router.push("/red-films")}
          style={{ padding: "8px 20px", borderRadius: 8, background: "#252525", border: "1px solid #333", color: "#888", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
          ← חזור ל-Red Films
        </button>
      </div>
    );
  }

  // ── Section renderer ─────────────────────────────────────────────────────
  function renderSection(sId: string) {
    if (!prod) return null;
    switch (sId) {

      case "summary": return (
        <SCard key="summary">
          <SectionHeader title="סיכום הפקה">
            <EditActions section="summary" editing={editing} saving={saving}
              onEdit={() => startEdit("summary")} onSave={saveSummary} onCancel={cancelEdit} />
          </SectionHeader>
          {editing === "summary" && draftSummary ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
              <SRow label="שם ההפקה">
                <input style={INPUT_S} value={draftSummary.title}
                  onChange={e => setDraftSummary(d => d ? { ...d, title: e.target.value } : d)} />
              </SRow>
              <SRow label="סטטוס" half>
                <select style={SELECT_S} value={draftSummary.status}
                  onChange={e => setDraftSummary(d => d ? { ...d, status: e.target.value } : d)}>
                  {PRODUCTION_STATUSES.map(s => <option key={s}>{s}</option>)}
                </select>
              </SRow>
              <SRow label="סוג הפקה" half>
                <select style={SELECT_S} value={draftSummary.production_type}
                  onChange={e => setDraftSummary(d => d ? { ...d, production_type: e.target.value } : d)}>
                  {PRODUCTION_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </SRow>
              <SRow label="אמן" half>
                <input style={INPUT_S} value={draftSummary.artist_name}
                  onChange={e => setDraftSummary(d => d ? { ...d, artist_name: e.target.value } : d)} />
              </SRow>
              <SRow label="לקוח" half>
                <input style={INPUT_S} value={draftSummary.client_name}
                  onChange={e => setDraftSummary(d => d ? { ...d, client_name: e.target.value } : d)} />
              </SRow>
              <SRow label="סוג לקוח" half>
                <select style={SELECT_S} value={draftSummary.client_source}
                  onChange={e => setDraftSummary(d => d ? { ...d, client_source: e.target.value } : d)}>
                  {CLIENT_SOURCES.map(s => <option key={s}>{s}</option>)}
                </select>
              </SRow>
              <SRow label="צלם" half>
                <input style={INPUT_S} value={draftSummary.photographer_name}
                  onChange={e => setDraftSummary(d => d ? { ...d, photographer_name: e.target.value } : d)} />
              </SRow>
              <SRow label="במאי / מפיק" half>
                <input style={INPUT_S} value={draftSummary.director_name}
                  onChange={e => setDraftSummary(d => d ? { ...d, director_name: e.target.value } : d)} />
              </SRow>
              <SRow label="עורך" half>
                <input style={INPUT_S} value={draftSummary.editor_name}
                  onChange={e => setDraftSummary(d => d ? { ...d, editor_name: e.target.value } : d)} />
              </SRow>
              <SRow label="תאריך צילום" half>
                <DatePickerInput value={draftSummary.shoot_date ?? ""}
                  onChange={v => setDraftSummary(d => d ? { ...d, shoot_date: v || null } : d)}
                  style={{ ...INPUT_S, justifyContent: "space-between" }} />
              </SRow>
              <SRow label="לוקיישנים">
                <input style={INPUT_S} value={draftSummary.locations}
                  onChange={e => setDraftSummary(d => d ? { ...d, locations: e.target.value } : d)}
                  placeholder="טיילת, בר, חוף..." />
              </SRow>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
              {[
                ["אמן",          prod.artist_name       || "—"],
                ["לקוח",         prod.client_name       || "—"],
                ["מקור",         prod.client_source],
                ["צלם",          prod.photographer_name || "—"],
                ["במאי / מפיק",  prod.director_name     || "—"],
                ["עורך",         prod.editor_name       || "—"],
                ["תאריך צילום",  fmtDate(prod.shoot_date) ?? "—"],
                ["לוקיישנים",    prod.locations         || "—"],
              ].map(([lbl, val]) => (
                <div key={lbl}>
                  <div style={{ fontSize: 10, color: "#555" }}>{lbl}</div>
                  <div style={{ fontSize: 13, color: "#CCC", marginTop: 3 }}>{val}</div>
                </div>
              ))}
              {projectName && (
                <div style={{ gridColumn: "span 4" }}>
                  <SDivider />
                  <div style={{ fontSize: 10, color: "#555" }}>פרויקט מקושר</div>
                  <div style={{ fontSize: 13, color: "#FCA5A5", marginTop: 3 }}>♫ {projectName}</div>
                </div>
              )}
            </div>
          )}
        </SCard>
      );

      case "tasks": return (
        <SCard key="tasks">
          <RedFilmsProductionTasks productionId={id} productionTitle={prod.title} />
        </SCard>
      );

      case "concept": return (
        <SCard key="concept">
          <SectionHeader title="קונספט ותסריט">
            <EditActions section="concept" editing={editing} saving={saving}
              onEdit={() => startEdit("concept")} onSave={saveConcept} onCancel={cancelEdit} />
          </SectionHeader>
          {editing === "concept" && draftConcept ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div style={{ gridColumn: "span 2" }}>
                <SLabel>תקציר / קונספט</SLabel>
                <textarea style={{ ...TEXTAREA_S, minHeight: 80 }} value={draftConcept.concept_summary}
                  onChange={e => setDraftConcept(d => d ? { ...d, concept_summary: e.target.value } : d)}
                  placeholder="תאר את הקונספט הכללי..." />
              </div>
              <div>
                <SLabel>וייב / סגנון</SLabel>
                <input style={INPUT_S} value={draftConcept.concept_vibe}
                  onChange={e => setDraftConcept(d => d ? { ...d, concept_vibe: e.target.value } : d)}
                  placeholder="מועדון, קיץ, רומנטי..." />
              </div>
              <div>
                <SLabel>רפרנסים</SLabel>
                <textarea style={{ ...TEXTAREA_S, minHeight: 48 }} value={draftConcept.ref_links}
                  onChange={e => setDraftConcept(d => d ? { ...d, ref_links: e.target.value } : d)}
                  placeholder="קישורים לרפרנסים..." />
              </div>
              <SDivider />
              <div style={{ gridColumn: "span 2", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                {[["script_start","התחלה"],["script_middle","אמצע"],["script_end","סוף"]].map(([field, label]) => (
                  <div key={field}>
                    <SLabel>{label}</SLabel>
                    <textarea style={{ ...TEXTAREA_S, minHeight: 60 }}
                      value={String((draftConcept as unknown as Record<string,unknown>)[field] ?? "")}
                      onChange={e => setDraftConcept(d => d ? { ...d, [field]: e.target.value } : d)} />
                  </div>
                ))}
              </div>
              <div>
                <SLabel>הערות בימוי</SLabel>
                <textarea style={{ ...TEXTAREA_S, minHeight: 48 }} value={draftConcept.director_notes}
                  onChange={e => setDraftConcept(d => d ? { ...d, director_notes: e.target.value } : d)} />
              </div>
              <div>
                <SLabel>הערות לצלם</SLabel>
                <textarea style={{ ...TEXTAREA_S, minHeight: 48 }} value={draftConcept.photographer_notes}
                  onChange={e => setDraftConcept(d => d ? { ...d, photographer_notes: e.target.value } : d)} />
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {prod.concept_summary ? (
                <div>
                  <div style={{ fontSize: 10, color: "#555", marginBottom: 6 }}>תקציר</div>
                  <div style={{ fontSize: 13, color: "#CCC", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{prod.concept_summary}</div>
                </div>
              ) : (
                <div style={{ fontSize: 13, color: "#3A3A3A", fontStyle: "italic" }}>אין קונספט עדיין — לחץ ערוך</div>
              )}
              {prod.concept_vibe && (
                <div>
                  <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>וייב</div>
                  <div style={{ fontSize: 13, color: "#A78BFA", fontWeight: 600 }}>{prod.concept_vibe}</div>
                </div>
              )}
              {(prod.script_start || prod.script_middle || prod.script_end) && (
                <>
                  <SDivider />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    {[["התחלה",prod.script_start],["אמצע",prod.script_middle],["סוף",prod.script_end]].map(([lbl,val]) => (
                      <div key={lbl} style={{ ...INNER_TILE }}>
                        <div style={{ fontSize: 10, color: "#8A8A92", marginBottom: 6, fontWeight: 700 }}>{lbl}</div>
                        <div style={{ fontSize: 12, color: val ? "#CCC" : "#333", lineHeight: 1.6, whiteSpace: "pre-wrap", fontStyle: val ? "normal" : "italic" }}>{val || "לא הוזן"}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {(prod.director_notes || prod.photographer_notes) && (
                <>
                  <SDivider />
                  {prod.director_notes && <div><div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>הערות בימוי</div><div style={{ fontSize: 12, color: "#CCC", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{prod.director_notes}</div></div>}
                  {prod.photographer_notes && <div><div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>הערות לצלם</div><div style={{ fontSize: 12, color: "#CCC", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{prod.photographer_notes}</div></div>}
                </>
              )}
              {prod.ref_links && (<><SDivider /><div><div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>רפרנסים</div><div style={{ fontSize: 12, color: "#FCA5A5", whiteSpace: "pre-wrap" }}>{prod.ref_links}</div></div></>)}
            </div>
          )}
        </SCard>
      );

      case "documents": return <RedFilmsDocuments key="documents" productionId={id} />;

      case "youtubeRefs": return <RedFilmsYouTubeRefs key="youtubeRefs" productionId={id} />;

      case "references": return <RedFilmsReferencesBoard key="references" productionId={id} />;

      case "budget": return (
        <SCard key="budget">
          <SectionHeader title="תקציב">
            <EditActions section="budget" editing={editing} saving={saving}
              onEdit={() => startEdit("budget")} onSave={saveBudget} onCancel={cancelEdit} />
          </SectionHeader>
          {editing === "budget" && draftBudget ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
              {([
                ["general_budget","תקציב כללי ₪"],
                ["client_price","מחיר ללקוח ₪"],
                ["advance_required","מקדמה נדרשת ₪"],
                ["advance_received","מקדמה התקבלה ₪"],
              ] as const).map(([field, label]) => (
                <div key={field}>
                  <SLabel>{label}</SLabel>
                  <input type="number" style={INPUT_S}
                    value={(draftBudget as unknown as Record<string,number>)[field] ?? 0}
                    onChange={e => setDraftBudget(d => d ? { ...d, [field]: +e.target.value } : d)} />
                </div>
              ))}
              <div style={{ gridColumn: "span 4" }}>
                <SLabel>סטטוס גבייה</SLabel>
                <select style={{ ...SELECT_S, maxWidth: 240 }} value={draftBudget.collection_status}
                  onChange={e => setDraftBudget(d => d ? { ...d, collection_status: e.target.value } : d)}>
                  {COLLECTION_STATUSES.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
            </div>
          ) : (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 12 }}>
                {[
                  ["תקציב",fmtNum(prod.general_budget)],
                  ["מחיר ל״ק",prod.client_price ? fmtNum(prod.client_price) : "—"],
                  ["מקדמה נדרשת",prod.advance_required ? fmtNum(prod.advance_required) : "—"],
                  ["מקדמה התקבלה",prod.advance_received ? fmtNum(prod.advance_received) : "—"],
                ].map(([lbl,val]) => (
                  <div key={lbl} style={{ ...INNER_TILE, textAlign: "center" }}>
                    <div style={{ fontSize: 11, color: "#8A8A92" }}>{lbl}</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: "#F4F4F6", marginTop: 4 }}>{val}</div>
                  </div>
                ))}
              </div>
              {prod.collection_status !== "לא רלוונטי" && (
                <div style={{ fontSize: 12, color: "#888" }}>סטטוס גבייה: <span style={{ color: "#CCC" }}>{prod.collection_status}</span></div>
              )}
            </div>
          )}
        </SCard>
      );

      case "budgetItems": return (
        <SCard key="budgetItems">
          <SectionHeader title="תקציב מפורט" />
          <RedFilmsBudgetItems productionId={id} generalBudget={prod.general_budget}
            onBudgetUpdate={newBudget => setProd(p => p ? { ...p, general_budget: newBudget } : p)} />
        </SCard>
      );

      case "files": return (
        <SCard key="files">
          <SectionHeader title="קבצים ועריכה">
            <EditActions section="files" editing={editing} saving={saving}
              onEdit={() => startEdit("files")} onSave={saveFiles} onCancel={cancelEdit} />
          </SectionHeader>
          {editing === "files" && draftFiles ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {([
                ["files_raw_link","קישור חומרי גלם"],
                ["files_edit_folder","תיקיית עריכה"],
                ["version_1_link","גרסה 1"],
                ["version_2_link","גרסה 2"],
                ["final_version_link","גרסה מאושרת"],
              ] as const).map(([field, label]) => (
                <div key={field}>
                  <SLabel>{label}</SLabel>
                  <input style={INPUT_S}
                    value={String((draftFiles as unknown as Record<string,unknown>)[field] ?? "")}
                    onChange={e => setDraftFiles(d => d ? { ...d, [field]: e.target.value } : d)}
                    placeholder="https://..." />
                </div>
              ))}
              <SDivider />
              <div>
                <SLabel>סטטוס עריכה</SLabel>
                <select style={SELECT_S} value={draftFiles.edit_status}
                  onChange={e => setDraftFiles(d => d ? { ...d, edit_status: e.target.value } : d)}>
                  {EDIT_STATUSES.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <SLabel>תאריך פרסום</SLabel>
                <DatePickerInput value={draftFiles.publish_date ?? ""}
                  onChange={v => setDraftFiles(d => d ? { ...d, publish_date: v || null } : d)}
                  style={{ ...INPUT_S, justifyContent: "space-between" }} />
              </div>
              <div style={{ gridColumn: "span 2" }}>
                <SLabel>פורסם איפה</SLabel>
                <input style={INPUT_S} value={draftFiles.published_where}
                  onChange={e => setDraftFiles(d => d ? { ...d, published_where: e.target.value } : d)}
                  placeholder="YouTube, Instagram..." />
              </div>
              <div style={{ gridColumn: "span 2" }}>
                <SLabel>הערות תיקונים</SLabel>
                <textarea style={{ ...TEXTAREA_S, minHeight: 56 }} value={draftFiles.fix_notes}
                  onChange={e => setDraftFiles(d => d ? { ...d, fix_notes: e.target.value } : d)} />
              </div>
            </div>
          ) : (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 12 }}>
                {[
                  ["📁 חומרי גלם",prod.files_raw_link],
                  ["📂 תיקיית עריכה",prod.files_edit_folder],
                  ["✅ גרסה מאושרת",prod.final_version_link],
                ].map(([lbl,val]) => val ? (
                  <div key={lbl} style={{ ...INNER_TILE, padding: "9px 12px" }}>
                    <div style={{ fontSize: 10, color: "#8A8A92", marginBottom: 4 }}>{lbl}</div>
                    <a href={val} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 11, color: "#FCA5A5", wordBreak: "break-all" }}>
                      {val.length > 40 ? val.slice(0,40)+"..." : val}
                    </a>
                  </div>
                ) : null)}
              </div>
              {[["🎬 גרסה 1",prod.version_1_link],["🎬 גרסה 2",prod.version_2_link]].map(([lbl,val]) =>
                val ? (
                  <div key={lbl} style={{ marginBottom: 6 }}>
                    <span style={{ fontSize: 11, color: "#555" }}>{lbl}: </span>
                    <a href={val} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "#FCA5A5" }}>
                      {val.length > 50 ? val.slice(0,50)+"..." : val}
                    </a>
                  </div>
                ) : null
              )}
              {!prod.files_raw_link && !prod.version_1_link && !prod.final_version_link && (
                <div style={{ fontSize: 13, color: "#444", fontStyle: "italic", marginBottom: 10 }}>אין קבצים עדיין</div>
              )}
              <SDivider />
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                <div><div style={{ fontSize: 10, color: "#555" }}>סטטוס עריכה</div><div style={{ fontSize: 13, color: "#CCC", marginTop: 3 }}>{prod.edit_status}</div></div>
                {prod.publish_date && <div><div style={{ fontSize: 10, color: "#555" }}>פרסום מתוכנן</div><div style={{ fontSize: 13, color: "#CCC", marginTop: 3 }}>{fmtDate(prod.publish_date)}</div></div>}
                {prod.published_where && <div><div style={{ fontSize: 10, color: "#555" }}>פורסם ב</div><div style={{ fontSize: 13, color: "#CCC", marginTop: 3 }}>{prod.published_where}</div></div>}
              </div>
            </div>
          )}
        </SCard>
      );

      case "notes": return (
        <SCard key="notes">
          <SectionHeader title="הערות">
            <EditActions section="notes" editing={editing} saving={saving}
              onEdit={() => startEdit("notes")} onSave={saveNotes} onCancel={cancelEdit} />
          </SectionHeader>
          {editing === "notes" ? (
            <textarea style={{ ...TEXTAREA_S, minHeight: 100 }}
              value={draftNotes} onChange={e => setDraftNotes(e.target.value)}
              placeholder="מה חסר, תזכורות, הערות כלליות..." />
          ) : (
            <div style={{ fontSize: 13, color: prod.notes ? "#CCC" : "#3A3A3A", lineHeight: 1.7, whiteSpace: "pre-wrap", fontStyle: prod.notes ? "normal" : "italic" }}>
              {prod.notes || "אין הערות"}
            </div>
          )}
        </SCard>
      );

      default: return null;
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  // Linked project + latest audio — shared by the hero play button (desktop & mobile).
  const linkedProject = prod.project_id ? (projects.find(p => p.id === prod.project_id) ?? null) : null;
  const latestAudio   = linkedProject ? getLatestAudioFile(linkedProject.files ?? []) : null;
  const isThisPlaying = !!prod.project_id && player?.track?.projectId === prod.project_id && !!player?.playing;
  const isThisLoaded  = !!prod.project_id && player?.track?.projectId === prod.project_id;
  async function handlePlay() {
    if (!player || !latestAudio || !linkedProject) return;
    if (isThisLoaded) { isThisPlaying ? player.pause() : player.resume(); }
    else { const url = await getFreshPlayUrl(latestAudio); player.play({ projectId: linkedProject.id, projectName: linkedProject.name, artist: linkedProject.artist, fileName: latestAudio.name, url }); }
  }
  const createdDate = fmtDate(prod.created_at ? prod.created_at.slice(0, 10) : null);
  const updatedDate = fmtDate(prod.updated_at ? prod.updated_at.slice(0, 10) : null);

  const ghostBtn: CSSProperties = {
    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
    padding: "9px 14px", borderRadius: 10, fontSize: 12.5, fontWeight: 700,
    cursor: "pointer", fontFamily: "inherit", border: `1px solid ${RED}33`,
    background: "rgba(220,38,38,0.06)", color: "#FCA5A5", textDecoration: "none", whiteSpace: "nowrap",
  };
  const mobileAction = (active: boolean): CSSProperties => ({
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    gap: 4, padding: "10px 6px", minHeight: 54, borderRadius: 11,
    border: `1px solid ${active ? "rgba(220,38,38,0.5)" : RED + "26"}`,
    background: active ? "rgba(220,38,38,0.14)" : "rgba(220,38,38,0.05)",
    color: active ? "#FCA5A5" : "#96969C", fontSize: 10, fontWeight: 600,
    cursor: "pointer", fontFamily: "inherit", textDecoration: "none",
  });
  const heroChip: CSSProperties = {
    fontSize: 11, fontWeight: 600, color: "#8C8C93", background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.09)", borderRadius: 20, padding: "3px 10px",
  };

  return (
    <div style={{ minHeight: "100%", background: "#0C0C0D", position: "relative" }}>
      {/* Ambient top red glow */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 260, background: "radial-gradient(120% 100% at 78% 0%, rgba(220,38,38,0.10), rgba(153,27,27,0.03) 45%, transparent 72%)", pointerEvents: "none", zIndex: 0 }} />

      <div style={{ position: "relative", zIndex: 1, padding: isMobile ? "14px 12px" : "20px 28px", boxSizing: "border-box", width: "100%" }}>

        {/* ── Top bar: back + breadcrumb ── */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 14 }}>
          <button onClick={() => router.push("/red-films")}
            style={{ display: "flex", alignItems: "center", gap: 6, color: "#8C8C93", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 9, cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: 600, padding: "7px 13px", minHeight: 38 }}>
            ← חזרה לרשימה
          </button>
          {!isMobile && (
            <div style={{ fontSize: 12.5, color: "#6E6E76", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
              פרויקטים <span style={{ color: "#4A4A50" }}>/</span> <span style={{ color: RED_LIGHT }}>Red Films</span> <span style={{ color: "#4A4A50" }}>/</span> <span style={{ color: "#C6C6CE" }}>{prod.title}</span>
            </div>
          )}
        </div>

        {/* ── Error banner ── */}
        {saveErr && (
          <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 12, color: "#F87171", fontSize: 13, padding: "10px 16px", marginBottom: 14 }}>
            {saveErr}
          </div>
        )}

        {/* ── Hero ── */}
        <div style={{ ...CARD_STYLE, padding: isMobile ? 16 : "20px 22px", marginBottom: 16 }}>
          <div style={{ position: "absolute", top: -40, insetInlineStart: -30, width: 180, height: 180, borderRadius: "50%", background: RED, opacity: 0.06, filter: "blur(50px)", pointerEvents: "none" }} />
          <div style={{ position: "relative", display: "flex", flexDirection: isMobile ? "column" : "row", gap: isMobile ? 14 : 20, alignItems: isMobile ? "stretch" : "center" }}>
            <HeroCover mobile={isMobile} />

            {/* Info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              {prod.production_type && (
                <span style={{ display: "inline-block", fontSize: 11, fontWeight: 700, color: "#FCA5A5", background: "rgba(220,38,38,0.12)", border: `1px solid ${RED}54`, borderRadius: 7, padding: "3px 10px", marginBottom: 8 }}>
                  {prod.production_type}
                </span>
              )}
              <h1 style={{ fontSize: isMobile ? 23 : 30, fontWeight: 900, color: "#F5F5F7", margin: 0, letterSpacing: "-0.02em", lineHeight: 1.1, textShadow: "0 0 16px rgba(220,38,38,0.14)" }}>
                {prod.title}
              </h1>
              {(prod.client_name || prod.artist_name) && (
                <div style={{ fontSize: 14, color: "#C6C6CE", marginTop: 7, fontWeight: 500 }}>
                  👤 {[prod.client_name, prod.artist_name].filter(Boolean).join(" · ")}
                </div>
              )}
              <div style={{ display: "flex", gap: 14, marginTop: 9, fontSize: 12, color: "#78787F", flexWrap: "wrap" }}>
                {createdDate && <span>תאריך יצירה: <span style={{ color: "#96969C" }}>{createdDate}</span></span>}
                {updatedDate && <span>עודכן לאחרונה: <span style={{ color: "#96969C" }}>{updatedDate}</span></span>}
                {prod.shoot_date && <span>📅 צילום: <span style={{ color: "#96969C" }}>{fmtDate(prod.shoot_date)}</span></span>}
                {prod.locations && <span>📍 {prod.locations}</span>}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
                <RedFilmsStatusBadge status={prod.status} />
                {prod.edit_status && prod.edit_status !== "לא התחיל" && <span style={heroChip}>עריכה: {prod.edit_status}</span>}
                {prod.collection_status && prod.collection_status !== "לא רלוונטי" && <span style={heroChip}>גבייה: {prod.collection_status}</span>}
                {projectName && (
                  <button onClick={() => router.push("/projects")} style={{ fontSize: 11, fontWeight: 700, color: "#FCA5A5", background: "rgba(220,38,38,0.1)", border: `1px solid ${RED}42`, borderRadius: 20, padding: "3px 11px", cursor: "pointer", fontFamily: "inherit" }}>♫ {projectName}</button>
                )}
              </div>
            </div>

            {/* Actions (desktop) */}
            {!isMobile && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, flexShrink: 0, alignItems: "stretch", minWidth: 150 }}>
                {latestAudio && (
                  <button onClick={handlePlay} title={isThisPlaying ? "השהה" : `נגן — ${latestAudio.name}`}
                    style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "10px 18px", borderRadius: 11, fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", border: "1px solid rgba(248,113,113,0.4)", background: "linear-gradient(135deg, #EF4444, #B91C1C)", color: "#fff", boxShadow: "0 0 16px rgba(220,38,38,0.3), 0 6px 18px rgba(220,38,38,0.2)", whiteSpace: "nowrap" }}>
                    {isThisPlaying ? "⏸ מנגן" : "▶ נגן שיר"}
                  </button>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  {prod.dropbox_folder_url ? (
                    <a href={prod.dropbox_folder_url} target="_blank" rel="noopener noreferrer" style={{ ...ghostBtn, flex: 1 }}>📁 תיקייה</a>
                  ) : (
                    <button onClick={createDropboxFolder} disabled={creatingFolder} style={{ ...ghostBtn, flex: 1, opacity: creatingFolder ? 0.6 : 1 }}>{creatingFolder ? "יוצר…" : "📁 צור תיקייה"}</button>
                  )}
                  <button onClick={() => setShowLayoutModal(true)} title="התאמת תצוגה" style={{ ...ghostBtn, padding: "9px 12px" }}>⚙️</button>
                  {prod.status !== "בוטל" && (
                    <button onClick={() => setTrashConfirm(true)} title="העבר לסל" style={{ ...ghostBtn, border: "1px solid rgba(239,68,68,0.4)", background: "rgba(239,68,68,0.1)", color: "#F87171", padding: "9px 12px" }}>🗑️</button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Actions (mobile grid) */}
          {isMobile && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginTop: 14 }}>
              {latestAudio && (
                <button onClick={handlePlay} style={mobileAction(isThisLoaded)}>
                  <span style={{ fontSize: 18 }}>{isThisPlaying ? "⏸" : "▶"}</span>{isThisPlaying ? "מנגן" : "נגן"}
                </button>
              )}
              {prod.dropbox_folder_url ? (
                <a href={prod.dropbox_folder_url} target="_blank" rel="noopener noreferrer" style={mobileAction(false)}><span style={{ fontSize: 18 }}>📁</span>תיקייה</a>
              ) : (
                <button onClick={createDropboxFolder} disabled={creatingFolder} style={mobileAction(false)}><span style={{ fontSize: 18 }}>📁</span>{creatingFolder ? "יוצר…" : "צור"}</button>
              )}
              <button onClick={() => setShowLayoutModal(true)} style={mobileAction(false)}><span style={{ fontSize: 18 }}>⚙️</span>תצוגה</button>
              {prod.status !== "בוטל" && (
                <button onClick={() => setTrashConfirm(true)} style={{ ...mobileAction(false), background: "rgba(239,68,68,0.1)", borderColor: "rgba(239,68,68,0.3)", color: "#F87171" }}><span style={{ fontSize: 18 }}>🗑️</span>סל</button>
              )}
            </div>
          )}
        </div>

        {/* ── KPI strip (real fields) ── */}
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, minmax(0,1fr))" : "repeat(5, minmax(0,1fr))", gap: isMobile ? 10 : 14, marginBottom: 4 }}>
          <KpiCard icon={KPI_ICON.type}    label="סוג הפקה"     value={prod.production_type || "—"} />
          <KpiCard icon={KPI_ICON.status}  label="סטטוס"        value={prod.status} valueColor="#FCA5A5" />
          <KpiCard icon={KPI_ICON.budget}  label="תקציב כללי"   value={fmtNum(prod.general_budget)} />
          <KpiCard icon={KPI_ICON.price}   label="מחיר ללקוח"   value={fmtNum(prod.client_price)} />
          <KpiCard icon={KPI_ICON.advance} label="מקדמה התקבלה" value={fmtNum(prod.advance_received)} valueColor={prod.advance_received ? "#4ADE80" : undefined} />
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ padding: isMobile ? "12px 12px" : "24px 28px", width: "100%", boxSizing: "border-box" }}>
        {isMobile ? (
          /* Mobile: single column, order from layout */
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {layout.order
              .filter(sId => !layout.hidden.includes(sId))
              .map(sId => renderSection(sId))}
          </div>
        ) : (
          /* Desktop: 2-column grid */
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
            {/* Management column */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {layout.order
                .filter(sId => !layout.hidden.includes(sId) && !CREATIVE_SECTIONS.has(sId))
                .map(sId => renderSection(sId))}
            </div>
            {/* Creative column */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {layout.order
                .filter(sId => !layout.hidden.includes(sId) && CREATIVE_SECTIONS.has(sId))
                .map(sId => renderSection(sId))}
            </div>
          </div>
        )}
      </div>

      {/* Layout modal */}
      {showLayoutModal && typeof window !== "undefined" && (
        <RedFilmsLayoutModal
          layout={layout}
          onSave={saveLayout}
          onReset={resetLayout}
          onClose={() => setShowLayoutModal(false)}
        />
      )}

      {/* ── Trash confirmation modal ── */}
      {trashConfirm && typeof window !== "undefined" && createPortal(
        <div
          onClick={() => { if (!trashing) setTrashConfirm(false); }}
          style={{ position: "fixed", inset: 0, zIndex: 9500, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: "#1A1A1A", border: "1px solid #2A2A2A", borderRadius: 16, padding: "28px 24px", width: "min(400px, 90vw)" }}
          >
            <h2 style={{ fontSize: 16, fontWeight: 800, color: "#F0F0F0", margin: "0 0 12px" }}>
              העברת הפקה לסל מיחזור
            </h2>
            <p style={{ fontSize: 13, color: "#888", lineHeight: 1.7, margin: "0 0 24px" }}>
              אתה בטוח שברצונך להעביר את ההפקה הזו לסל המיחזור?<br />
              ההפקה תוסתר מהרשימה הראשית, אך לא תימחק לצמיתות.
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                onClick={() => setTrashConfirm(false)}
                disabled={trashing}
                style={{ padding: "8px 18px", borderRadius: 8, background: "none", border: "1px solid #333", color: "#888", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}
              >
                ביטול
              </button>
              <button
                onClick={moveToTrash}
                disabled={trashing}
                style={{ padding: "8px 20px", borderRadius: 8, background: "#EF4444", border: "none", color: "#FFF", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", opacity: trashing ? 0.7 : 1 }}
              >
                {trashing ? "מעביר..." : "כן, העבר לסל"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
