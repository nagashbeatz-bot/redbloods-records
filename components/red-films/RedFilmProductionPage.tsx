"use client";

import { useState, useEffect, useCallback, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useProjects } from "@/components/ProjectsProvider";
import { usePlayerSafe, getLatestAudioFile, getFreshPlayUrl } from "@/components/PlayerProvider";
import RedFilmsReferencesBoard from "./RedFilmsReferencesBoard";
import RedFilmsDocuments from "./RedFilmsDocuments";
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
    <div style={{
      background: "#1A1A1A", border: "1px solid #252525",
      borderRadius: 14, padding: "18px 20px", ...style,
    }}>
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
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
      <h2 style={{ fontSize: 13, fontWeight: 700, color: "#888", margin: 0 }}>{title}</h2>
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
        style={{ fontSize: 11, color: "#FFF", background: "#3B82F6", border: "none", borderRadius: 6, cursor: "pointer", fontFamily: "inherit", padding: "4px 14px", fontWeight: 700, opacity: saving ? 0.7 : 1 }}>
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
  const { layout, save: saveLayout, reset: resetLayout } = useProductionLayout();

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
                  <div style={{ fontSize: 13, color: "#60A5FA", marginTop: 3 }}>♫ {projectName}</div>
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
                      <div key={lbl} style={{ background: "#141414", border: "1px solid #1E1E1E", borderRadius: 8, padding: "10px 12px" }}>
                        <div style={{ fontSize: 10, color: "#555", marginBottom: 6, fontWeight: 700 }}>{lbl}</div>
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
              {prod.ref_links && (<><SDivider /><div><div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>רפרנסים</div><div style={{ fontSize: 12, color: "#60A5FA", whiteSpace: "pre-wrap" }}>{prod.ref_links}</div></div></>)}
            </div>
          )}
        </SCard>
      );

      case "documents": return <RedFilmsDocuments key="documents" productionId={id} />;

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
                  <div key={lbl} style={{ background: "#141414", border: "1px solid #222", borderRadius: 8, padding: "10px 12px", textAlign: "center" }}>
                    <div style={{ fontSize: 11, color: "#555" }}>{lbl}</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: "#E8E8E8", marginTop: 4 }}>{val}</div>
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
                  <div key={lbl} style={{ background: "#141414", border: "1px solid #222", borderRadius: 8, padding: "8px 12px" }}>
                    <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>{lbl}</div>
                    <a href={val} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 11, color: "#60A5FA", wordBreak: "break-all" }}>
                      {val.length > 40 ? val.slice(0,40)+"..." : val}
                    </a>
                  </div>
                ) : null)}
              </div>
              {[["🎬 גרסה 1",prod.version_1_link],["🎬 גרסה 2",prod.version_2_link]].map(([lbl,val]) =>
                val ? (
                  <div key={lbl} style={{ marginBottom: 6 }}>
                    <span style={{ fontSize: 11, color: "#555" }}>{lbl}: </span>
                    <a href={val} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "#60A5FA" }}>
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
  return (
    <div style={{ minHeight: "100%", background: "#111" }}>

      {/* ── Sticky header ── */}
      <div style={{
        position: "sticky", top: 0, zIndex: 100,
        background: "#141414", borderBottom: "1px solid #222",
        padding: "12px 24px",
        display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
      }}>
        {/* Back */}
        <button onClick={() => router.push("/red-films")}
          style={{ display: "flex", alignItems: "center", gap: 6, color: "#555", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 13, flexShrink: 0 }}>
          ← Red Films
        </button>

        {/* Title */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h1 style={{ fontSize: 18, fontWeight: 800, color: "#F0F0F0", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {prod.title}
            </h1>
            <RedFilmsStatusBadge status={prod.status} small />
            {prod.production_type && (
              <span style={{ fontSize: 11, color: "#555", background: "#1A1A1A", border: "1px solid #2A2A2A", borderRadius: 6, padding: "2px 8px" }}>
                {prod.production_type}
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 16, marginTop: 4, fontSize: 12, color: "#555", flexWrap: "wrap" }}>
            {prod.photographer_name && <span>📷 {prod.photographer_name}</span>}
            {prod.shoot_date && <span>📅 {fmtDate(prod.shoot_date)}</span>}
            {prod.locations && <span>📍 {prod.locations}</span>}
            {projectName && <span style={{ color: "#60A5FA" }}>♫ {projectName}</span>}
          </div>
        </div>

        {/* Red Films logo */}
        <div style={{
          flexShrink: 0, fontSize: 11, fontWeight: 700,
          background: "linear-gradient(135deg, #EC4899, #3B82F6)",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
        }}>
          🎬 Red Films
        </div>

        {/* Project audio + link — shown only when production is linked to a project */}
        {prod.project_id && (() => {
          const linkedProject = projects.find(p => p.id === prod.project_id);
          if (!linkedProject) return null;
          const latestAudio = getLatestAudioFile(linkedProject.files ?? []);
          const isThisPlaying = player?.track?.projectId === prod.project_id && player?.playing;
          const isThisLoaded  = player?.track?.projectId === prod.project_id;

          async function handlePlay() {
            if (!player || !latestAudio) return;
            if (isThisLoaded) {
              isThisPlaying ? player.pause() : player.resume();
            } else {
              const url = await getFreshPlayUrl(latestAudio);
              player.play({ projectId: linkedProject!.id, projectName: linkedProject!.name, artist: linkedProject!.artist, fileName: latestAudio.name, url });
            }
          }

          return (
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
              {latestAudio && (
                <button
                  onClick={handlePlay}
                  title={isThisPlaying ? "השהה" : `נגן — ${latestAudio.name}`}
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "5px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700,
                    cursor: "pointer", fontFamily: "inherit", border: "1px solid",
                    background:   isThisLoaded ? "rgba(59,130,246,0.15)" : "none",
                    color:        isThisLoaded ? "#60A5FA"               : "#888",
                    borderColor:  isThisLoaded ? "rgba(59,130,246,0.4)"  : "#333",
                  }}
                >
                  {isThisPlaying ? "⏸" : "▶"} {isThisPlaying ? "מנגן" : "נגן שיר"}
                </button>
              )}
              <button
                onClick={() => router.push(`/projects`)}
                title={`פתח פרויקט: ${linkedProject.name}`}
                style={{
                  padding: "5px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                  cursor: "pointer", fontFamily: "inherit", border: "1px solid #333",
                  background: "none", color: "#60A5FA",
                }}
              >
                ♫ {linkedProject.name}
              </button>
            </div>
          );
        })()}

        {/* Layout settings button */}
        <button
          onClick={() => setShowLayoutModal(true)}
          title="התאמת תצוגה"
          style={{
            flexShrink: 0, display: "flex", alignItems: "center", gap: 4,
            padding: "5px 10px", borderRadius: 8, fontSize: 12,
            border: "1px solid #2A2A2A", color: "#555", background: "none",
            cursor: "pointer", fontFamily: "inherit",
          }}
        >
          ⚙️
        </button>

        {/* Dropbox folder button */}
        {prod.dropbox_folder_url ? (
          <a
            href={prod.dropbox_folder_url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              flexShrink: 0, display: "flex", alignItems: "center", gap: 5,
              padding: "5px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600,
              border: "1px solid #333", color: "#888", textDecoration: "none",
              background: "none", fontFamily: "inherit",
            }}
          >
            📁 פתח תיקייה
          </a>
        ) : (
          <button
            onClick={createDropboxFolder}
            disabled={creatingFolder}
            style={{
              flexShrink: 0, display: "flex", alignItems: "center", gap: 5,
              padding: "5px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600,
              border: "1px solid #333", color: "#555", background: "none",
              cursor: creatingFolder ? "default" : "pointer", fontFamily: "inherit",
              opacity: creatingFolder ? 0.6 : 1,
            }}
          >
            {creatingFolder ? "יוצר..." : "📁 צור תיקיית Dropbox"}
          </button>
        )}

        {/* Trash button */}
        {prod.status !== "בוטל" && (
          <button
            onClick={() => setTrashConfirm(true)}
            style={{
              flexShrink: 0, display: "flex", alignItems: "center", gap: 5,
              padding: "6px 14px", borderRadius: 8,
              background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.35)",
              color: "#F87171", fontSize: 12, fontWeight: 700,
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            🗑️ העבר לסל
          </button>
        )}
      </div>

      {/* ── Error banner ── */}
      {saveErr && (
        <div style={{ background: "rgba(239,68,68,0.1)", borderBottom: "1px solid rgba(239,68,68,0.3)", color: "#F87171", fontSize: 13, padding: "10px 24px" }}>
          {saveErr}
        </div>
      )}

      {/* ── Body — 2-column grid ── */}
      <div style={{ padding: "24px 28px", width: "100%", boxSizing: "border-box" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
          {/* Management column: summary, tasks, budget, budgetItems, files, notes */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {layout.order
              .filter(sId => !layout.hidden.includes(sId) && !CREATIVE_SECTIONS.has(sId))
              .map(sId => renderSection(sId))}
          </div>
          {/* Creative column: concept, documents, references */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {layout.order
              .filter(sId => !layout.hidden.includes(sId) && CREATIVE_SECTIONS.has(sId))
              .map(sId => renderSection(sId))}
          </div>
        </div>
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
