"use client";

import { useState, useEffect, useCallback, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import DatePickerInput from "@/components/ui/DatePickerInput";
import RedFilmsStatusBadge, {
  PRODUCTION_STATUSES,
  PRODUCTION_TYPES,
  COLLECTION_STATUSES,
  EDIT_STATUSES,
  CLIENT_SOURCES,
} from "./RedFilmsStatusBadge";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Production {
  id: string;
  title: string;
  production_type: string;
  status: string;
  project_id: string | null;
  client_id: string | null;
  artist_name: string;
  client_name: string;
  client_source: string;
  photographer_name: string;
  director_name: string;
  editor_name: string;
  shoot_date: string | null;
  locations: string;
  concept_summary: string;
  concept_vibe: string;
  ref_links: string;
  script_start: string;
  script_middle: string;
  script_end: string;
  director_notes: string;
  photographer_notes: string;
  general_budget: number;
  client_price: number;
  advance_required: number;
  advance_received: number;
  collection_status: string;
  files_raw_link: string;
  files_edit_folder: string;
  version_1_link: string;
  version_2_link: string;
  final_version_link: string;
  fix_notes: string;
  edit_status: string;
  publish_date: string | null;
  published_where: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

interface Props {
  production: Production;
  projectName?: string; // resolved from project_id
  onClose: () => void;
  onUpdated: (p: Production) => void;
}

// ── Style constants ───────────────────────────────────────────────────────────

const INPUT_S: CSSProperties = {
  background: "#0D0D0D", border: "1px solid #3A3A3A", borderRadius: 6,
  color: "#E8E8E8", fontSize: 12, padding: "4px 8px", outline: "none",
  fontFamily: "inherit", height: 28, boxSizing: "border-box", width: "100%",
};

const TEXTAREA_S: CSSProperties = {
  ...INPUT_S,
  height: "auto", minHeight: 60, padding: "6px 8px",
  resize: "vertical", lineHeight: 1.5,
};

const SELECT_S: CSSProperties = {
  ...INPUT_S,
  cursor: "pointer",
};

// ── Small helpers ─────────────────────────────────────────────────────────────

function SCard({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{
      background: "#1C1C1C", border: "1px solid #252525",
      borderRadius: 14, padding: "14px 16px", marginBottom: 10,
      ...style,
    }}>
      {children}
    </div>
  );
}

function SRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 10, color: "#555", marginBottom: 4, fontWeight: 600 }}>{label}</div>
      {children}
    </div>
  );
}

function SDivider() {
  return <div style={{ height: 1, background: "#252525", margin: "10px 0" }} />;
}

function CollapsibleCard({
  label, badge, open, onToggle, children,
}: {
  label: string; badge?: string | number; open: boolean;
  onToggle: () => void; children: ReactNode;
}) {
  return (
    <div style={{ background: "#1C1C1C", border: "1px solid #252525", borderRadius: 14, marginBottom: 10, overflow: "hidden" }}>
      <button
        onClick={onToggle}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 16px", background: "none", border: "none", cursor: "pointer",
          textAlign: "right", fontFamily: "inherit",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#888" }}>{label}</span>
          {badge !== undefined && badge !== "" && (
            <span style={{ fontSize: 10, color: "#555", background: "rgba(255,255,255,0.04)", border: "1px solid #2A2A2A", borderRadius: 5, padding: "1px 6px" }}>{badge}</span>
          )}
        </div>
        <span style={{ fontSize: 13, color: "#444", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s", lineHeight: 1 }}>▾</span>
      </button>
      {open && (
        <div style={{ padding: "0 16px 14px" }}>
          <div style={{ height: 1, background: "#252525", marginBottom: 14 }} />
          {children}
        </div>
      )}
    </div>
  );
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}.${m}.${y}`;
}

function fmtNum(n: number) {
  return n ? n.toLocaleString("he-IL") : "—";
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RedFilmProductionDrawer({ production: initialProd, projectName, onClose, onUpdated }: Props) {
  const [prod, setProd] = useState<Production>(initialProd);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  // Which section is in edit mode
  const [editing, setEditing] = useState<string | null>(null);

  // Draft state per section
  const [draftSummary,  setDraftSummary]  = useState({ ...initialProd });
  const [draftConcept,  setDraftConcept]  = useState({ ...initialProd });
  const [draftBudget,   setDraftBudget]   = useState({ ...initialProd });
  const [draftFiles,    setDraftFiles]    = useState({ ...initialProd });
  const [draftNotes,    setDraftNotes]    = useState(initialProd.notes);

  // Open sections
  const [openSections, setOpenSections] = useState(new Set(["summary"]));
  function toggleSection(id: string) {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Sync if production prop changes externally
  useEffect(() => {
    setProd(initialProd);
    setDraftSummary({ ...initialProd });
    setDraftConcept({ ...initialProd });
    setDraftBudget({ ...initialProd });
    setDraftFiles({ ...initialProd });
    setDraftNotes(initialProd.notes);
  }, [initialProd.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Patch helper ─────────────────────────────────────────────────────────────
  const patch = useCallback(async (fields: Partial<Production>) => {
    setSaving(true);
    setSaveErr(null);
    try {
      const res = await fetch(`/api/red-films/productions/${prod.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "שמירה נכשלה");
      const updated: Production = data.production;
      setProd(updated);
      onUpdated(updated);
      return updated;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "שגיאה";
      setSaveErr(msg);
      setTimeout(() => setSaveErr(null), 4000);
      return null;
    } finally {
      setSaving(false);
    }
  }, [prod.id, onUpdated]);

  // ── Section save handlers ────────────────────────────────────────────────────
  async function saveSummary() {
    const result = await patch({
      title:             draftSummary.title,
      production_type:   draftSummary.production_type,
      status:            draftSummary.status,
      artist_name:       draftSummary.artist_name,
      client_name:       draftSummary.client_name,
      client_source:     draftSummary.client_source,
      photographer_name: draftSummary.photographer_name,
      director_name:     draftSummary.director_name,
      editor_name:       draftSummary.editor_name,
      shoot_date:        draftSummary.shoot_date || null,
      locations:         draftSummary.locations,
    });
    if (result) setEditing(null);
  }

  async function saveConcept() {
    const result = await patch({
      concept_summary:    draftConcept.concept_summary,
      concept_vibe:       draftConcept.concept_vibe,
      ref_links:          draftConcept.ref_links,
      script_start:       draftConcept.script_start,
      script_middle:      draftConcept.script_middle,
      script_end:         draftConcept.script_end,
      director_notes:     draftConcept.director_notes,
      photographer_notes: draftConcept.photographer_notes,
    });
    if (result) setEditing(null);
  }

  async function saveBudget() {
    const result = await patch({
      general_budget:    Number(draftBudget.general_budget)   || 0,
      client_price:      Number(draftBudget.client_price)     || 0,
      advance_required:  Number(draftBudget.advance_required) || 0,
      advance_received:  Number(draftBudget.advance_received) || 0,
      collection_status: draftBudget.collection_status,
    });
    if (result) setEditing(null);
  }

  async function saveFiles() {
    const result = await patch({
      files_raw_link:     draftFiles.files_raw_link,
      files_edit_folder:  draftFiles.files_edit_folder,
      version_1_link:     draftFiles.version_1_link,
      version_2_link:     draftFiles.version_2_link,
      final_version_link: draftFiles.final_version_link,
      fix_notes:          draftFiles.fix_notes,
      edit_status:        draftFiles.edit_status,
      publish_date:       draftFiles.publish_date || null,
      published_where:    draftFiles.published_where,
    });
    if (result) setEditing(null);
  }

  async function saveNotes() {
    const result = await patch({ notes: draftNotes });
    if (result) setEditing(null);
  }

  // ── Edit/cancel helpers ──────────────────────────────────────────────────────
  function startEdit(section: string) {
    setDraftSummary({ ...prod });
    setDraftConcept({ ...prod });
    setDraftBudget({ ...prod });
    setDraftFiles({ ...prod });
    setDraftNotes(prod.notes);
    setEditing(section);
  }
  function cancelEdit() {
    setEditing(null);
  }

  // ── Close on Escape ──────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // ── Section action bar ───────────────────────────────────────────────────────
  function SectionActions({ section, onSave }: { section: string; onSave: () => void }) {
    if (editing !== section) {
      return (
        <button
          onClick={() => startEdit(section)}
          style={{ fontSize: 11, color: "#555", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: "2px 0" }}
        >
          ✏ ערוך
        </button>
      );
    }
    return (
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={onSave}
          disabled={saving}
          style={{ fontSize: 11, color: "#3B82F6", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: 700 }}
        >
          {saving ? "שומר..." : "✓ שמור"}
        </button>
        <button
          onClick={cancelEdit}
          disabled={saving}
          style={{ fontSize: 11, color: "#555", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}
        >
          ביטול
        </button>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return createPortal(
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 9000, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(3px)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute", top: 0, left: 0, bottom: 0,
          width: "min(480px, 100vw)",
          background: "#141414",
          borderRight: "1px solid #2A2A2A",
          display: "flex", flexDirection: "column",
          overflowY: "auto",
        }}
      >
        {/* ── Header ── */}
        <div style={{
          padding: "14px 16px 12px",
          borderBottom: "1px solid #222",
          background: "#141414",
          position: "sticky", top: 0, zIndex: 10,
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <button
            onClick={onClose}
            style={{ fontSize: 18, color: "#555", background: "none", border: "none", cursor: "pointer", lineHeight: 1, padding: 0, flexShrink: 0 }}
          >
            ✕
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#F0F0F0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {prod.title || "הפקה ללא שם"}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
              <RedFilmsStatusBadge status={prod.status} small />
              {prod.production_type && (
                <span style={{ fontSize: 10, color: "#555" }}>{prod.production_type}</span>
              )}
              {prod.shoot_date && (
                <span style={{ fontSize: 10, color: "#555" }}>📅 {fmtDate(prod.shoot_date)}</span>
              )}
            </div>
          </div>
          <div style={{ fontSize: 10, color: "#333", flexShrink: 0, textAlign: "left" }}>
            🎬 Red Films
          </div>
        </div>

        {/* ── Error banner ── */}
        {saveErr && (
          <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#F87171", fontSize: 12, padding: "8px 16px" }}>
            {saveErr}
          </div>
        )}

        {/* ── Content ── */}
        <div style={{ flex: 1, padding: "12px 12px 40px", overflowY: "auto" }}>

          {/* ── 1. סיכום ── */}
          <CollapsibleCard
            label="סיכום הפקה"
            open={openSections.has("summary")}
            onToggle={() => toggleSection("summary")}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontSize: 10, color: "#444" }}>
                עודכן {new Date(prod.updated_at).toLocaleDateString("he-IL")}
              </span>
              <SectionActions section="summary" onSave={saveSummary} />
            </div>

            {editing === "summary" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <SRow label="שם ההפקה">
                  <input style={INPUT_S} value={draftSummary.title}
                    onChange={e => setDraftSummary(d => ({ ...d, title: e.target.value }))} />
                </SRow>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <SRow label="סוג הפקה">
                    <select style={SELECT_S} value={draftSummary.production_type}
                      onChange={e => setDraftSummary(d => ({ ...d, production_type: e.target.value }))}>
                      {PRODUCTION_TYPES.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </SRow>
                  <SRow label="סטטוס">
                    <select style={SELECT_S} value={draftSummary.status}
                      onChange={e => setDraftSummary(d => ({ ...d, status: e.target.value }))}>
                      {PRODUCTION_STATUSES.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </SRow>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <SRow label="אמן">
                    <input style={INPUT_S} value={draftSummary.artist_name}
                      onChange={e => setDraftSummary(d => ({ ...d, artist_name: e.target.value }))} />
                  </SRow>
                  <SRow label="לקוח">
                    <input style={INPUT_S} value={draftSummary.client_name}
                      onChange={e => setDraftSummary(d => ({ ...d, client_name: e.target.value }))} />
                  </SRow>
                </div>
                <SRow label="סוג לקוח">
                  <select style={SELECT_S} value={draftSummary.client_source}
                    onChange={e => setDraftSummary(d => ({ ...d, client_source: e.target.value }))}>
                    {CLIENT_SOURCES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </SRow>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <SRow label="צלם">
                    <input style={INPUT_S} value={draftSummary.photographer_name}
                      onChange={e => setDraftSummary(d => ({ ...d, photographer_name: e.target.value }))} />
                  </SRow>
                  <SRow label="במאי / מפיק">
                    <input style={INPUT_S} value={draftSummary.director_name}
                      onChange={e => setDraftSummary(d => ({ ...d, director_name: e.target.value }))} />
                  </SRow>
                </div>
                <SRow label="עורך">
                  <input style={INPUT_S} value={draftSummary.editor_name}
                    onChange={e => setDraftSummary(d => ({ ...d, editor_name: e.target.value }))} />
                </SRow>
                <SRow label="תאריך צילום">
                  <DatePickerInput
                    value={draftSummary.shoot_date ?? ""}
                    onChange={v => setDraftSummary(d => ({ ...d, shoot_date: v || null }))}
                    style={{ ...INPUT_S, justifyContent: "space-between" }}
                  />
                </SRow>
                <SRow label="לוקיישנים">
                  <input style={INPUT_S} value={draftSummary.locations}
                    onChange={e => setDraftSummary(d => ({ ...d, locations: e.target.value }))}
                    placeholder="טיילת, רדיו בר, חוף..." />
                </SRow>
              </div>
            ) : (
              /* View mode */
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {[
                    ["סוג", prod.production_type],
                    ["אמן", prod.artist_name || "—"],
                    ["לקוח", prod.client_name || "—"],
                    ["מקור", prod.client_source],
                    ["צלם", prod.photographer_name || "—"],
                    ["במאי", prod.director_name || "—"],
                    ["עורך", prod.editor_name || "—"],
                    ["תאריך צילום", fmtDate(prod.shoot_date)],
                  ].map(([lbl, val]) => (
                    <div key={lbl}>
                      <div style={{ fontSize: 10, color: "#555" }}>{lbl}</div>
                      <div style={{ fontSize: 12, color: "#CCC", marginTop: 2 }}>{val}</div>
                    </div>
                  ))}
                </div>
                {prod.locations && (
                  <>
                    <SDivider />
                    <div>
                      <div style={{ fontSize: 10, color: "#555" }}>לוקיישנים</div>
                      <div style={{ fontSize: 12, color: "#CCC", marginTop: 2 }}>{prod.locations}</div>
                    </div>
                  </>
                )}
                {projectName && (
                  <>
                    <SDivider />
                    <div>
                      <div style={{ fontSize: 10, color: "#555" }}>פרויקט מקושר</div>
                      <div style={{ fontSize: 12, color: "#60A5FA", marginTop: 2 }}>♫ {projectName}</div>
                    </div>
                  </>
                )}
              </div>
            )}
          </CollapsibleCard>

          {/* ── 2. קונספט ── */}
          <CollapsibleCard
            label="קונספט ותסריט"
            open={openSections.has("concept")}
            onToggle={() => toggleSection("concept")}
          >
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
              <SectionActions section="concept" onSave={saveConcept} />
            </div>

            {editing === "concept" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <SRow label="תקציר / קונספט">
                  <textarea style={TEXTAREA_S} value={draftConcept.concept_summary}
                    onChange={e => setDraftConcept(d => ({ ...d, concept_summary: e.target.value }))}
                    placeholder="תאר את הקונספט הכללי של ההפקה..." />
                </SRow>
                <SRow label="וייב / סגנון">
                  <input style={INPUT_S} value={draftConcept.concept_vibe}
                    onChange={e => setDraftConcept(d => ({ ...d, concept_vibe: e.target.value }))}
                    placeholder="מועדון, קיץ, רומנטי, מתח..." />
                </SRow>
                <SRow label="רפרנסים / קישורים">
                  <textarea style={{ ...TEXTAREA_S, minHeight: 44 }} value={draftConcept.ref_links}
                    onChange={e => setDraftConcept(d => ({ ...d, ref_links: e.target.value }))}
                    placeholder="קישורים לרפרנסים ויזואליים..." />
                </SRow>
                <SDivider />
                <SRow label="התחלה">
                  <textarea style={{ ...TEXTAREA_S, minHeight: 50 }} value={draftConcept.script_start}
                    onChange={e => setDraftConcept(d => ({ ...d, script_start: e.target.value }))} />
                </SRow>
                <SRow label="אמצע">
                  <textarea style={{ ...TEXTAREA_S, minHeight: 50 }} value={draftConcept.script_middle}
                    onChange={e => setDraftConcept(d => ({ ...d, script_middle: e.target.value }))} />
                </SRow>
                <SRow label="סוף">
                  <textarea style={{ ...TEXTAREA_S, minHeight: 50 }} value={draftConcept.script_end}
                    onChange={e => setDraftConcept(d => ({ ...d, script_end: e.target.value }))} />
                </SRow>
                <SDivider />
                <SRow label="הערות בימוי">
                  <textarea style={{ ...TEXTAREA_S, minHeight: 44 }} value={draftConcept.director_notes}
                    onChange={e => setDraftConcept(d => ({ ...d, director_notes: e.target.value }))} />
                </SRow>
                <SRow label="הערות לצלם">
                  <textarea style={{ ...TEXTAREA_S, minHeight: 44 }} value={draftConcept.photographer_notes}
                    onChange={e => setDraftConcept(d => ({ ...d, photographer_notes: e.target.value }))} />
                </SRow>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {prod.concept_summary ? (
                  <div>
                    <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>תקציר</div>
                    <div style={{ fontSize: 12, color: "#CCC", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{prod.concept_summary}</div>
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: "#444", fontStyle: "italic" }}>אין קונספט עדיין — לחץ ערוך</div>
                )}
                {prod.concept_vibe && (
                  <div>
                    <div style={{ fontSize: 10, color: "#555", marginBottom: 3 }}>וייב</div>
                    <div style={{ fontSize: 12, color: "#A78BFA" }}>{prod.concept_vibe}</div>
                  </div>
                )}
                {(prod.script_start || prod.script_middle || prod.script_end) && (
                  <>
                    <SDivider />
                    {[["התחלה", prod.script_start], ["אמצע", prod.script_middle], ["סוף", prod.script_end]].map(([lbl, val]) =>
                      val ? (
                        <div key={lbl}>
                          <div style={{ fontSize: 10, color: "#555", marginBottom: 3 }}>{lbl}</div>
                          <div style={{ fontSize: 12, color: "#CCC", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{val}</div>
                        </div>
                      ) : null
                    )}
                  </>
                )}
                {(prod.director_notes || prod.photographer_notes) && (
                  <>
                    <SDivider />
                    {prod.director_notes && (
                      <div>
                        <div style={{ fontSize: 10, color: "#555", marginBottom: 3 }}>הערות בימוי</div>
                        <div style={{ fontSize: 12, color: "#CCC", whiteSpace: "pre-wrap" }}>{prod.director_notes}</div>
                      </div>
                    )}
                    {prod.photographer_notes && (
                      <div>
                        <div style={{ fontSize: 10, color: "#555", marginBottom: 3 }}>הערות לצלם</div>
                        <div style={{ fontSize: 12, color: "#CCC", whiteSpace: "pre-wrap" }}>{prod.photographer_notes}</div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </CollapsibleCard>

          {/* ── 3. תקציב ── */}
          <CollapsibleCard
            label="תקציב"
            open={openSections.has("budget")}
            onToggle={() => toggleSection("budget")}
          >
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
              <SectionActions section="budget" onSave={saveBudget} />
            </div>

            {editing === "budget" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <SRow label="תקציב כללי ₪">
                    <input type="number" style={INPUT_S} value={draftBudget.general_budget}
                      onChange={e => setDraftBudget(d => ({ ...d, general_budget: +e.target.value }))} />
                  </SRow>
                  <SRow label="מחיר ללקוח ₪">
                    <input type="number" style={INPUT_S} value={draftBudget.client_price}
                      onChange={e => setDraftBudget(d => ({ ...d, client_price: +e.target.value }))} />
                  </SRow>
                  <SRow label="מקדמה נדרשת ₪">
                    <input type="number" style={INPUT_S} value={draftBudget.advance_required}
                      onChange={e => setDraftBudget(d => ({ ...d, advance_required: +e.target.value }))} />
                  </SRow>
                  <SRow label="מקדמה התקבלה ₪">
                    <input type="number" style={INPUT_S} value={draftBudget.advance_received}
                      onChange={e => setDraftBudget(d => ({ ...d, advance_received: +e.target.value }))} />
                  </SRow>
                </div>
                <SRow label="סטטוס גבייה">
                  <select style={SELECT_S} value={draftBudget.collection_status}
                    onChange={e => setDraftBudget(d => ({ ...d, collection_status: e.target.value }))}>
                    {COLLECTION_STATUSES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </SRow>
              </div>
            ) : (
              /* Finance summary strip */
              <div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 10 }}>
                  {[
                    ["תקציב", `₪${fmtNum(prod.general_budget)}`],
                    ["מחיר ללקוח", prod.client_price ? `₪${fmtNum(prod.client_price)}` : "—"],
                    ["מקדמה", prod.advance_received ? `₪${fmtNum(prod.advance_received)}` : "—"],
                  ].map(([lbl, val]) => (
                    <div key={lbl} style={{ background: "#181818", border: "1px solid #222", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
                      <div style={{ fontSize: 10, color: "#555" }}>{lbl}</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#E8E8E8", marginTop: 3 }}>{val}</div>
                    </div>
                  ))}
                </div>
                {prod.collection_status !== "לא רלוונטי" && (
                  <div style={{ fontSize: 11, color: "#888" }}>
                    גבייה: <span style={{ color: "#CCC" }}>{prod.collection_status}</span>
                  </div>
                )}
                <div style={{ marginTop: 8, fontSize: 11, color: "#444", fontStyle: "italic" }}>
                  פריטי תקציב מפורטים יתווספו בשלב הבא
                </div>
              </div>
            )}
          </CollapsibleCard>

          {/* ── 4. קבצים ועריכה ── */}
          <CollapsibleCard
            label="קבצים ועריכה"
            open={openSections.has("files")}
            onToggle={() => toggleSection("files")}
          >
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
              <SectionActions section="files" onSave={saveFiles} />
            </div>

            {editing === "files" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[
                  ["files_raw_link",     "קישור חומרי גלם"],
                  ["files_edit_folder",  "תיקיית עריכה"],
                  ["version_1_link",     "גרסה 1"],
                  ["version_2_link",     "גרסה 2"],
                  ["final_version_link", "גרסה מאושרת"],
                ].map(([field, label]) => (
                  <SRow key={field} label={label}>
                    <input style={INPUT_S}
                      value={String((draftFiles as unknown as Record<string, unknown>)[field] ?? "")}
                      onChange={e => setDraftFiles(d => ({ ...d, [field]: e.target.value }))}
                      placeholder="https://..." />
                  </SRow>
                ))}
                <SDivider />
                <SRow label="סטטוס עריכה">
                  <select style={SELECT_S} value={draftFiles.edit_status}
                    onChange={e => setDraftFiles(d => ({ ...d, edit_status: e.target.value }))}>
                    {EDIT_STATUSES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </SRow>
                <SRow label="הערות תיקונים">
                  <textarea style={{ ...TEXTAREA_S, minHeight: 50 }} value={draftFiles.fix_notes}
                    onChange={e => setDraftFiles(d => ({ ...d, fix_notes: e.target.value }))} />
                </SRow>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <SRow label="תאריך פרסום מתוכנן">
                    <DatePickerInput
                      value={draftFiles.publish_date ?? ""}
                      onChange={v => setDraftFiles(d => ({ ...d, publish_date: v || null }))}
                      style={{ ...INPUT_S, justifyContent: "space-between" }}
                    />
                  </SRow>
                  <SRow label="פורסם איפה">
                    <input style={INPUT_S} value={draftFiles.published_where}
                      onChange={e => setDraftFiles(d => ({ ...d, published_where: e.target.value }))}
                      placeholder="YouTube, Instagram..." />
                  </SRow>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[
                  ["חומרי גלם",     prod.files_raw_link],
                  ["תיקיית עריכה", prod.files_edit_folder],
                  ["גרסה 1",        prod.version_1_link],
                  ["גרסה 2",        prod.version_2_link],
                  ["גרסה מאושרת",  prod.final_version_link],
                ].map(([lbl, val]) =>
                  val ? (
                    <div key={lbl}>
                      <div style={{ fontSize: 10, color: "#555" }}>{lbl}</div>
                      <a href={val} target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: 12, color: "#60A5FA", overflow: "hidden", textOverflow: "ellipsis", display: "block", whiteSpace: "nowrap" }}>
                        {val}
                      </a>
                    </div>
                  ) : null
                )}
                {!prod.files_raw_link && !prod.version_1_link && !prod.final_version_link && (
                  <div style={{ fontSize: 12, color: "#444", fontStyle: "italic" }}>אין קבצים עדיין</div>
                )}
                <SDivider />
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontSize: 10, color: "#555" }}>סטטוס עריכה</div>
                    <div style={{ fontSize: 12, color: "#CCC", marginTop: 2 }}>{prod.edit_status}</div>
                  </div>
                  {prod.publish_date && (
                    <div style={{ textAlign: "left" }}>
                      <div style={{ fontSize: 10, color: "#555" }}>פרסום מתוכנן</div>
                      <div style={{ fontSize: 12, color: "#CCC", marginTop: 2 }}>{fmtDate(prod.publish_date)}</div>
                    </div>
                  )}
                </div>
                {prod.published_where && (
                  <div style={{ fontSize: 12, color: "#888" }}>
                    פורסם: <span style={{ color: "#CCC" }}>{prod.published_where}</span>
                  </div>
                )}
              </div>
            )}
          </CollapsibleCard>

          {/* ── 5. הערות ── */}
          <CollapsibleCard
            label="הערות"
            open={openSections.has("notes")}
            onToggle={() => toggleSection("notes")}
          >
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
              <SectionActions section="notes" onSave={saveNotes} />
            </div>
            {editing === "notes" ? (
              <textarea
                style={{ ...TEXTAREA_S, minHeight: 80 }}
                value={draftNotes}
                onChange={e => setDraftNotes(e.target.value)}
                placeholder="הערות כלליות, מה חסר, תזכורות..."
              />
            ) : (
              <div style={{ fontSize: 12, color: prod.notes ? "#CCC" : "#444", lineHeight: 1.6, fontStyle: prod.notes ? "normal" : "italic", whiteSpace: "pre-wrap" }}>
                {prod.notes || "אין הערות"}
              </div>
            )}
          </CollapsibleCard>

        </div>
      </div>
    </div>,
    document.body
  );
}
