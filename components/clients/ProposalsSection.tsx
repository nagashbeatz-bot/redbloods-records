"use client";

import { useState, useEffect } from "react";
import DatePickerInput from "@/components/ui/DatePickerInput";
import type { Client } from "@/lib/clients-store";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NewProject {
  id: string; name: string; artist: string; status: string;
  deadline: string | null; project_type: string;
  isOverdue: boolean; isDueSoon: boolean;
}

export interface Proposal {
  id: string;
  client_id: string;
  title: string;
  amount: number;
  currency: string;
  status: ProposalStatus;
  sent_date: string | null;
  followup_date: string | null;
  notes: string;
  linked_project_id: string | null;
  created_at: string;
}

export type ProposalStatus =
  | "הצעה נשלחה"
  | "ממתין לתשובה"
  | "צריך פולואפ"
  | "נסגר"
  | "לא נסגר"
  | "לחזור בעתיד";

const STATUSES: ProposalStatus[] = [
  "הצעה נשלחה", "ממתין לתשובה", "צריך פולואפ",
  "נסגר", "לא נסגר", "לחזור בעתיד",
];

const STATUS_COLOR: Record<ProposalStatus, { bg: string; color: string }> = {
  "הצעה נשלחה":   { bg: "rgba(59,130,246,0.12)",  color: "#60A5FA" },
  "ממתין לתשובה": { bg: "rgba(245,158,11,0.12)",  color: "#FBBF24" },
  "צריך פולואפ":  { bg: "rgba(239,68,68,0.12)",   color: "#F87171" },
  "נסגר":         { bg: "rgba(16,185,129,0.12)",  color: "#34D399" },
  "לא נסגר":      { bg: "rgba(107,114,128,0.12)", color: "#6B7280" },
  "לחזור בעתיד": { bg: "rgba(168,85,247,0.12)",  color: "#C084FC" },
};

// ─── Proposal types (for creation flow) ──────────────────────────────────────

interface ProposalType {
  id: string;
  icon: string;
  label: string;
  autoTitle: string;
}

const PROPOSAL_TYPES: ProposalType[] = [
  { id: "הפקה מלאה",     icon: "🎵", label: "הפקה\nמלאה",     autoTitle: "הפקה מלאה"    },
  { id: "קליפ",           icon: "🎬", label: "קליפ",           autoTitle: "קליפ"          },
  { id: "הקלטות בלבד",   icon: "🎤", label: "הקלטות\nבלבד",   autoTitle: "הקלטות בלבד"  },
  { id: "מיקס / מאסטר",  icon: "🎚️", label: "מיקס /\nמאסטר",  autoTitle: "מיקס / מאסטר" },
  { id: "ביט / עיבוד",   icon: "⚡", label: "ביט /\nעיבוד",   autoTitle: "ביט / עיבוד"  },
  { id: "אחר",            icon: "···", label: "אחר",            autoTitle: ""             },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayPlus3(): string {
  const d = new Date();
  d.setDate(d.getDate() + 3);
  return d.toISOString().split("T")[0];
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${parseInt(day, 10)}.${parseInt(m, 10)}.${y}`;
}

function fmtMoney(n: number, cur: string) {
  return `${n.toLocaleString("he-IL", { maximumFractionDigits: 0 })}${cur}`;
}

function typeIcon(title: string): string {
  const t = PROPOSAL_TYPES.find((pt) => pt.autoTitle === title || pt.id === title);
  return t ? t.icon : "📄";
}

const inp: React.CSSProperties = {
  width: "100%", padding: "8px 10px", borderRadius: 8,
  border: "1px solid #2A2A2A", background: "#111", color: "#E0E0E0",
  fontSize: 12, fontFamily: "inherit", outline: "none", boxSizing: "border-box",
  colorScheme: "dark" as React.CSSProperties["colorScheme"],
};

// ─── Project Name Modal ───────────────────────────────────────────────────────

function ProjectNameModal({ proposalTitle, onConfirm, onCancel }: {
  proposalTitle: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}) {
  const isGeneric = PROPOSAL_TYPES.some((t) => t.autoTitle === proposalTitle && t.id !== "אחר");
  const [name, setName] = useState(isGeneric ? "" : proposalTitle);
  const [error, setError] = useState<string | null>(null);

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 100010, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onCancel}
    >
      <div
        style={{ background: "#141414", border: "1px solid #2A2A2A", borderRadius: 16, padding: "24px 22px", width: 340, maxWidth: "90vw" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 15, fontWeight: 700, color: "#E0E0E0", marginBottom: 6 }}>שם הפרויקט</div>
        <div style={{ fontSize: 12, color: "#666", marginBottom: 14, lineHeight: 1.5 }}>
          לפני יצירת הפרויקט, הזן את השם שיופיע במערכת.
        </div>
        <input
          autoFocus
          value={name}
          onChange={(e) => { setName(e.target.value); setError(null); }}
          placeholder="למשל: הסיפור שלי, קסם..."
          style={inp}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) onConfirm(name.trim());
          }}
        />
        {error && <div style={{ fontSize: 11, color: "#EF4444", marginTop: 6 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button onClick={onCancel}
            style={{ flex: 1, padding: "9px 0", borderRadius: 9, border: "1px solid #2A2A2A", background: "transparent", color: "#666", cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>
            ביטול
          </button>
          <button
            onClick={() => {
              if (!name.trim()) { setError("חובה להזין שם פרויקט"); return; }
              onConfirm(name.trim());
            }}
            style={{ flex: 1, padding: "9px 0", borderRadius: 9, border: "none", background: "#7C3AED", color: "#FFF", cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "inherit" }}>
            צור פרויקט ✓
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── New Proposal Form (2-step) ───────────────────────────────────────────────

function NewProposalForm({ client, onSaved, onClose }: {
  client: Client;
  onSaved: (p: Proposal) => void;
  onClose: () => void;
}) {
  const [selectedType, setSelectedType] = useState<ProposalType | null>(null);
  const [title,        setTitle]        = useState("");
  const [amount,       setAmount]       = useState("");
  const [currency,     setCurrency]     = useState("₪");
  const [status,       setStatus]       = useState<ProposalStatus>("ממתין לתשובה");
  const [followupDate, setFollowupDate] = useState(todayPlus3());
  const [notes,        setNotes]        = useState("");
  const [saving,       setSaving]       = useState(false);
  const [error,        setError]        = useState<string | null>(null);

  function selectType(t: ProposalType) {
    setSelectedType(t);
    if (t.id !== "אחר") setTitle(t.autoTitle);
    else setTitle("");
  }

  async function handleSubmit() {
    const finalTitle = title.trim();
    if (!finalTitle) { setError("חובה להזין כותרת"); return; }
    setSaving(true); setError(null);
    try {
      const res = await fetch("/api/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: client.id, title: finalTitle, amount: Number(amount) || 0,
          currency, status,
          sentDate: new Date().toISOString().split("T")[0],
          followupDate: followupDate || null, notes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "שגיאה");
      onSaved(data.proposal);
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה");
    } finally { setSaving(false); }
  }

  // ── Step 1: type tiles ────────────────────────────────────────────────────
  if (!selectedType) {
    return (
      <div style={{ background: "#111", border: "1px solid #2A2A2A", borderRadius: 14, padding: "16px 14px", marginBottom: 4 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#555", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 12 }}>
          הצעה חדשה — בחר סוג
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 12 }}>
          {PROPOSAL_TYPES.map((t) => (
            <button
              key={t.id}
              onClick={() => selectType(t)}
              style={{
                padding: "14px 6px", borderRadius: 12,
                border: "1px solid #2A2A2A",
                background: "rgba(255,255,255,0.02)",
                color: "#C0C0C0", cursor: "pointer", fontFamily: "inherit",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
                transition: "all 0.12s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.border = "1px solid rgba(124,58,237,0.5)";
                (e.currentTarget as HTMLButtonElement).style.background = "rgba(124,58,237,0.08)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.border = "1px solid #2A2A2A";
                (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.02)";
              }}
            >
              <span style={{ fontSize: 22, lineHeight: 1 }}>{t.icon}</span>
              <span style={{ fontSize: 10, fontWeight: 600, whiteSpace: "pre-line", textAlign: "center", lineHeight: 1.3, color: "#AAA" }}>
                {t.label}
              </span>
            </button>
          ))}
        </div>
        <button onClick={onClose}
          style={{ background: "none", border: "none", color: "#444", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
          ביטול
        </button>
      </div>
    );
  }

  // ── Step 2: quick form ────────────────────────────────────────────────────
  return (
    <div style={{ background: "#111", border: "1px solid #2A2A2A", borderRadius: 14, padding: "16px 14px", marginBottom: 4, display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <button onClick={() => setSelectedType(null)}
            style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 13, padding: "2px 4px", fontFamily: "inherit" }}>
            ←
          </button>
          <span style={{ fontSize: 18 }}>{selectedType.icon}</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#AAA" }}>{selectedType.id}</span>
        </div>
        <div style={{ fontSize: 10, color: "#444", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>הצעה חדשה</div>
      </div>

      {/* שם — only editable if "אחר" */}
      {selectedType.id === "אחר" && (
        <div>
          <div style={{ fontSize: 10, color: "#555", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>שם ההצעה *</div>
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="הכנס שם להצעה..." style={inp} disabled={saving} />
        </div>
      )}

      {/* סכום + מטבע + סטטוס */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 70px 1fr", gap: 8 }}>
        <div>
          <div style={{ fontSize: 10, color: "#555", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>סכום</div>
          <input autoFocus={selectedType.id !== "אחר"} type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)}
            placeholder="0" style={inp} disabled={saving} />
        </div>
        <div>
          <div style={{ fontSize: 10, color: "#555", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>מטבע</div>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)} style={inp} disabled={saving}>
            {["₪", "$", "€"].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "#555", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>סטטוס</div>
          <select value={status} onChange={(e) => setStatus(e.target.value as ProposalStatus)} style={inp} disabled={saving}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* תאריך מעקב */}
      <div>
        <div style={{ fontSize: 10, color: "#555", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>תאריך מעקב <span style={{ color: "#333", fontWeight: 400 }}>(אופציונלי)</span></div>
        <DatePickerInput value={followupDate} onChange={setFollowupDate} placeholder="בחר תאריך..." style={inp} />
      </div>

      {/* הערות */}
      <div>
        <div style={{ fontSize: 10, color: "#555", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>הערות <span style={{ color: "#333", fontWeight: 400 }}>(אופציונלי)</span></div>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
          placeholder="פרטים נוספים..." rows={2}
          style={{ ...inp, resize: "none", lineHeight: 1.5 }} disabled={saving} />
      </div>

      {error && <div style={{ fontSize: 11, color: "#EF4444" }}>{error}</div>}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" onClick={onClose} disabled={saving}
          style={{ padding: "8px 14px", borderRadius: 9, border: "1px solid #2A2A2A", background: "none", color: "#555", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
          ביטול
        </button>
        <button onClick={handleSubmit} disabled={saving || (selectedType.id === "אחר" && !title.trim())}
          style={{ padding: "8px 18px", borderRadius: 9, border: "none", background: saving ? "#3B2270" : "#7C3AED", color: "#FFF", fontSize: 12, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
          {saving ? "שומר..." : "שמור הצעה ✓"}
        </button>
      </div>
    </div>
  );
}

// ─── Proposal Card ────────────────────────────────────────────────────────────

function ProposalCard({ proposal, onUpdate, onDelete, onConverted, openProject, onConvertRequest }: {
  proposal: Proposal;
  onUpdate: (p: Proposal) => void;
  onDelete: (id: string) => void;
  onConverted: (proposalId: string, projectId: string, project: NewProject) => void;
  openProject: (id: string) => void;
  onConvertRequest: (proposalId: string, proposalTitle: string) => void;
}) {
  const [editing,  setEditing]  = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [draft,    setDraft]    = useState<Proposal>({ ...proposal, followup_date: proposal.followup_date ?? todayPlus3() });
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const sc          = STATUS_COLOR[proposal.status] ?? STATUS_COLOR["ממתין לתשובה"];
  const isConverted = !!proposal.linked_project_id;
  const icon        = typeIcon(proposal.title);
  const isOverdue   = !!proposal.followup_date && new Date(proposal.followup_date) < new Date();

  async function saveEdit() {
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/proposals/${proposal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draft.title, amount: draft.amount, currency: draft.currency,
          status: draft.status, sentDate: draft.sent_date,
          followupDate: draft.followup_date, notes: draft.notes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "שגיאה");
      onUpdate(data.proposal);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה");
    } finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!deleting) { setDeleting(true); return; }
    try {
      await fetch(`/api/proposals/${proposal.id}`, { method: "DELETE" });
      onDelete(proposal.id);
    } catch { /* ignore */ }
  }

  // ── Edit mode ─────────────────────────────────────────────────────────────
  if (editing) {
    return (
      <div style={{ background: "#161616", border: "1px solid #2A2A2A", borderRadius: 14, padding: "14px 14px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 10, color: "#555", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 2 }}>עריכת הצעה</div>
        <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          placeholder="כותרת" style={inp} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 70px", gap: 6 }}>
          <input type="number" min="0" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: Number(e.target.value) || 0 })}
            placeholder="סכום" style={inp} />
          <select value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value })} style={inp}>
            {["₪", "$", "€"].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as ProposalStatus })} style={inp}>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <DatePickerInput value={draft.sent_date ?? ""} onChange={(v) => setDraft({ ...draft, sent_date: v || null })} placeholder="תאריך שליחה" style={inp} />
          <DatePickerInput value={draft.followup_date ?? ""} onChange={(v) => setDraft({ ...draft, followup_date: v || null })} placeholder="מעקב הבא" style={inp} />
        </div>
        <textarea value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          placeholder="הערות..." rows={2} style={{ ...inp, resize: "none" }} />
        {error && <div style={{ fontSize: 11, color: "#EF4444" }}>{error}</div>}
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
          <button onClick={() => { setEditing(false); setDraft({ ...proposal, followup_date: proposal.followup_date ?? todayPlus3() } as Proposal); }} disabled={saving}
            style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #2A2A2A", background: "none", color: "#555", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
            ביטול
          </button>
          <button onClick={saveEdit} disabled={saving}
            style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: "#7C3AED", color: "#FFF", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
            {saving ? "שומר..." : "שמור"}
          </button>
        </div>
      </div>
    );
  }

  // ── Card view ─────────────────────────────────────────────────────────────
  return (
    <div style={{
      background: "#141414",
      border: `1px solid ${isConverted ? "rgba(16,185,129,0.2)" : "#222"}`,
      borderRadius: 14, padding: "14px 14px 12px",
      opacity: isConverted ? 0.7 : 1,
    }}>
      {/* Row 1: icon + title + status badge */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 22, lineHeight: 1, flexShrink: 0, marginTop: 1 }}>{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#DCDCDC", lineHeight: 1.2, marginBottom: 4 }}>
            {proposal.title}
          </div>
          <span style={{
            display: "inline-block", fontSize: 10, padding: "2px 8px", borderRadius: 20,
            background: sc.bg, color: sc.color, border: `1px solid ${sc.color}30`,
          }}>
            {proposal.status}
          </span>
        </div>
        {/* Amount */}
        {proposal.amount > 0 && (
          <div style={{ flexShrink: 0, textAlign: "left" }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#E0E0E0", letterSpacing: "-0.02em" }}>
              {fmtMoney(proposal.amount, proposal.currency)}
            </div>
          </div>
        )}
      </div>

      {/* Row 2: dates */}
      <div style={{ display: "flex", gap: 14, fontSize: 11, color: "#555", marginBottom: proposal.notes ? 6 : 10 }}>
        {proposal.sent_date && (
          <span>נוצר: <span style={{ color: "#666" }}>{fmtDate(proposal.created_at?.slice(0,10) ?? proposal.sent_date)}</span></span>
        )}
        {proposal.followup_date && (
          <span>מעקב: <span style={{ color: isOverdue ? "#F87171" : "#FBBF24" }}>
            {fmtDate(proposal.followup_date)}
          </span></span>
        )}
      </div>

      {/* Notes */}
      {proposal.notes && (
        <div style={{ fontSize: 11, color: "#444", marginBottom: 10, lineHeight: 1.4 }}>{proposal.notes}</div>
      )}

      {error && <div style={{ fontSize: 11, color: "#EF4444", marginBottom: 8 }}>{error}</div>}

      {/* Actions */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {isConverted ? (
          <button onClick={() => openProject(proposal.linked_project_id!)}
            style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid rgba(16,185,129,0.3)", background: "rgba(16,185,129,0.07)", color: "#34D399", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
            ⇒ פתח פרויקט
          </button>
        ) : (
          <>
            <button onClick={() => onConvertRequest(proposal.id, proposal.title)}
              style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid rgba(124,58,237,0.35)", background: "rgba(124,58,237,0.08)", color: "#C084FC", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
              ⇒ הפוך לפרויקט
            </button>
            <button onClick={() => setEditing(true)}
              style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid #252525", background: "none", color: "#666", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
              ✎ עריכה
            </button>
            <button onClick={handleDelete}
              style={{ padding: "5px 12px", borderRadius: 8, border: deleting ? "1px solid rgba(239,68,68,0.4)" : "1px solid #252525", background: deleting ? "rgba(239,68,68,0.07)" : "none", color: deleting ? "#F87171" : "#444", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}
              onBlur={() => setTimeout(() => setDeleting(false), 200)}>
              {deleting ? "לחץ שוב למחיקה" : "✕"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── ProposalsSection (main export) ──────────────────────────────────────────

export default function ProposalsSection({ client, proposals, onUpdate, onAdd, onDelete, onConverted, openProject, openAddSignal }: {
  client: Client;
  proposals: Proposal[];
  onUpdate: (p: Proposal) => void;
  onAdd: (p: Proposal) => void;
  onDelete: (id: string) => void;
  onConverted: (proposalId: string, projectId: string, project: NewProject) => void;
  openProject: (id: string) => void;
  openAddSignal?: number;   // increments → open the add form (remote trigger)
}) {
  const [showForm, setShowForm] = useState(false);
  // Open the existing add form when the parent's signal changes (e.g. header "הצעה חדשה").
  useEffect(() => { if (openAddSignal) setShowForm(true); }, [openAddSignal]);
  const [converting, setConverting] = useState(false);
  const [convertTarget, setConvertTarget] = useState<{ proposalId: string; proposalTitle: string } | null>(null);

  const open   = proposals.filter((p) => !["נסגר", "לא נסגר"].includes(p.status));
  const closed = proposals.filter((p) =>  ["נסגר", "לא נסגר"].includes(p.status));

  function handleConvertRequest(proposalId: string, proposalTitle: string) {
    setConvertTarget({ proposalId, proposalTitle });
  }

  async function handleConvertConfirm(projectName: string) {
    if (!convertTarget) return;
    setConverting(true);
    try {
      const res = await fetch(`/api/proposals/${convertTarget.proposalId}/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "שגיאה");
      onConverted(convertTarget.proposalId, data.projectId, data.project);
    } catch {
      /* errors surface via proposal card state */
    } finally {
      setConverting(false);
      setConvertTarget(null);
    }
  }

  return (
    <div style={{ background: "#1A1A1A", border: "1px solid #222", borderRadius: 14, padding: "14px 16px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: showForm || proposals.length > 0 ? 12 : 0 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#444", textTransform: "uppercase", letterSpacing: "0.07em" }}>
          הצעות מחיר {proposals.length > 0 && `(${proposals.length})`}
        </div>
        {!showForm && (
          <button onClick={() => setShowForm(true)}
            style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 10, border: "1px solid rgba(124,58,237,0.35)", background: "rgba(124,58,237,0.08)", color: "#C084FC", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
            + הצעה חדשה
          </button>
        )}
      </div>

      {/* New proposal form */}
      {showForm && (
        <NewProposalForm
          client={client}
          onSaved={(p) => { onAdd(p); setShowForm(false); }}
          onClose={() => setShowForm(false)}
        />
      )}

      {/* Open proposals */}
      {open.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: closed.length > 0 ? 10 : 0 }}>
          {open.map((p) => (
            <ProposalCard key={p.id} proposal={p}
              onUpdate={onUpdate} onDelete={onDelete} onConverted={onConverted}
              openProject={openProject} onConvertRequest={handleConvertRequest} />
          ))}
        </div>
      )}

      {/* Closed proposals (collapsed) */}
      {closed.length > 0 && (
        <details style={{ marginTop: open.length > 0 ? 4 : 0 }}>
          <summary style={{ fontSize: 11, color: "#333", cursor: "pointer", userSelect: "none", padding: "4px 0" }}>
            הצעות סגורות ({closed.length})
          </summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
            {closed.map((p) => (
              <ProposalCard key={p.id} proposal={p}
                onUpdate={onUpdate} onDelete={onDelete} onConverted={onConverted}
                openProject={openProject} onConvertRequest={handleConvertRequest} />
            ))}
          </div>
        </details>
      )}

      {/* Empty */}
      {proposals.length === 0 && !showForm && (
        <div style={{ fontSize: 12, color: "#333", padding: "8px 0" }}>אין הצעות מחיר עדיין</div>
      )}

      {/* Project name modal */}
      {convertTarget && !converting && (
        <ProjectNameModal
          proposalTitle={convertTarget.proposalTitle}
          onConfirm={handleConvertConfirm}
          onCancel={() => setConvertTarget(null)}
        />
      )}
      {converting && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100010, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ color: "#C084FC", fontSize: 14, fontFamily: "inherit" }}>יוצר פרויקט...</div>
        </div>
      )}
    </div>
  );
}
