"use client";

import { useState } from "react";
import DatePickerInput from "@/components/ui/DatePickerInput";
import type { Client } from "@/lib/clients-store";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Minimal project shape returned by the convert endpoint */
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
  "הצעה נשלחה",
  "ממתין לתשובה",
  "צריך פולואפ",
  "נסגר",
  "לא נסגר",
  "לחזור בעתיד",
];

const STATUS_COLOR: Record<ProposalStatus, { bg: string; color: string }> = {
  "הצעה נשלחה":    { bg: "rgba(59,130,246,0.12)",  color: "#60A5FA" },
  "ממתין לתשובה":  { bg: "rgba(245,158,11,0.12)",  color: "#FBBF24" },
  "צריך פולואפ":   { bg: "rgba(239,68,68,0.12)",   color: "#F87171" },
  "נסגר":          { bg: "rgba(16,185,129,0.12)",  color: "#34D399" },
  "לא נסגר":       { bg: "rgba(107,114,128,0.12)", color: "#6B7280" },
  "לחזור בעתיד":  { bg: "rgba(168,85,247,0.12)",  color: "#C084FC" },
};

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

const inp: React.CSSProperties = {
  width: "100%", padding: "7px 10px", borderRadius: 8,
  border: "1px solid #2A2A2A", background: "#111", color: "#E0E0E0",
  fontSize: 12, fontFamily: "inherit", outline: "none", boxSizing: "border-box",
  colorScheme: "dark" as React.CSSProperties["colorScheme"],
};

// ─── New proposal form ────────────────────────────────────────────────────────

function NewProposalForm({ client, onSaved, onClose }: {
  client: Client;
  onSaved: (p: Proposal) => void;
  onClose: () => void;
}) {
  const [title,        setTitle]        = useState("");
  const [amount,       setAmount]       = useState("");
  const [currency,     setCurrency]     = useState("₪");
  const [status,       setStatus]       = useState<ProposalStatus>("ממתין לתשובה");
  const [sentDate,     setSentDate]     = useState(new Date().toISOString().split("T")[0]);
  const [followupDate, setFollowupDate] = useState(todayPlus3());
  const [notes,        setNotes]        = useState("");
  const [saving,       setSaving]       = useState(false);
  const [error,        setError]        = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setError("חובה להזין כותרת"); return; }
    setSaving(true); setError(null);
    try {
      const res = await fetch("/api/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: client.id, title, amount: Number(amount) || 0,
          currency, status, sentDate, followupDate: followupDate || null, notes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "שגיאה");
      onSaved(data.proposal);
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה");
    } finally { setSaving(false); }
  }

  return (
    <form onSubmit={handleSubmit} style={{ background: "#111", border: "1px solid #2A2A2A", borderRadius: 12, padding: "14px 14px 12px", display: "flex", flexDirection: "column", gap: 10, marginBottom: 4 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#555", textTransform: "uppercase", letterSpacing: "0.07em" }}>
        הצעת מחיר חדשה
      </div>

      {/* כותרת */}
      <div>
        <div style={{ fontSize: 10, color: "#555", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>כותרת *</div>
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder="לדוגמה: הפקת שיר + מיקס" style={inp} disabled={saving} />
      </div>

      {/* סכום + מטבע */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 80px", gap: 8 }}>
        <div>
          <div style={{ fontSize: 10, color: "#555", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>סכום</div>
          <input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)}
            placeholder="0" style={inp} disabled={saving} />
        </div>
        <div>
          <div style={{ fontSize: 10, color: "#555", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>מטבע</div>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)} style={inp} disabled={saving}>
            {["₪", "$", "€"].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {/* סטטוס */}
      <div>
        <div style={{ fontSize: 10, color: "#555", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>סטטוס</div>
        <select value={status} onChange={(e) => setStatus(e.target.value as ProposalStatus)} style={inp} disabled={saving}>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* תאריכים */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div>
          <div style={{ fontSize: 10, color: "#555", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>תאריך שליחה</div>
          <DatePickerInput value={sentDate} onChange={setSentDate} style={inp} />
        </div>
        <div>
          <div style={{ fontSize: 10, color: "#555", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>מעקב הבא</div>
          <DatePickerInput value={followupDate} onChange={setFollowupDate} placeholder="אופציונלי" style={inp} />
        </div>
      </div>

      {/* הערות */}
      <div>
        <div style={{ fontSize: 10, color: "#555", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>הערות</div>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
          placeholder="פרטים נוספים..." rows={2}
          style={{ ...inp, resize: "none", lineHeight: 1.5 }} disabled={saving} />
      </div>

      {error && <div style={{ fontSize: 11, color: "#EF4444" }}>{error}</div>}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" onClick={onClose} disabled={saving}
          style={{ padding: "7px 14px", borderRadius: 9, border: "1px solid #2A2A2A", background: "none", color: "#555", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
          ביטול
        </button>
        <button type="submit" disabled={saving || !title.trim()}
          style={{ padding: "7px 16px", borderRadius: 9, border: "none", background: saving ? "#1E3A5F" : "#2563EB", color: saving ? "#4A7FC0" : "#FFF", fontSize: 12, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
          {saving ? "שומר..." : "שמור הצעה"}
        </button>
      </div>
    </form>
  );
}

// ─── Proposal row ─────────────────────────────────────────────────────────────

function ProposalRow({ proposal, onUpdate, onDelete, onConverted, openProject }: {
  proposal: Proposal;
  onUpdate: (p: Proposal) => void;
  onDelete: (id: string) => void;
  onConverted: (proposalId: string, projectId: string, project: NewProject) => void;
  openProject: (id: string) => void;
}) {
  const [editing,    setEditing]    = useState(false);
  const [converting, setConverting] = useState(false);
  const [deleting,   setDeleting]   = useState(false);
  const [draft,      setDraft]      = useState<Proposal>({ ...proposal, followup_date: proposal.followup_date ?? todayPlus3() });
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  const sc = STATUS_COLOR[proposal.status] ?? STATUS_COLOR["ממתין לתשובה"];
  const isConverted = !!proposal.linked_project_id;

  async function saveEdit() {
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/proposals/${proposal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draft.title, amount: draft.amount, currency: draft.currency,
          status: draft.status, sentDate: draft.sent_date, followupDate: draft.followup_date, notes: draft.notes,
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

  async function handleConvert() {
    if (!converting) { setConverting(true); return; }
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/proposals/${proposal.id}/convert`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "שגיאה");
      onConverted(proposal.id, data.projectId, data.project);
      setConverting(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה");
      setConverting(false);
    } finally { setSaving(false); }
  }

  if (editing) {
    return (
      <div style={{ background: "#161616", border: "1px solid #2A2A2A", borderRadius: 10, padding: "12px 12px 10px", display: "flex", flexDirection: "column", gap: 8 }}>
        <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          placeholder="כותרת" style={inp} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 80px", gap: 6 }}>
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
            style={{ padding: "5px 12px", borderRadius: 7, border: "1px solid #2A2A2A", background: "none", color: "#555", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
            ביטול
          </button>
          <button onClick={saveEdit} disabled={saving}
            style={{ padding: "5px 12px", borderRadius: 7, border: "none", background: "#2563EB", color: "#FFF", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
            {saving ? "שומר..." : "שמור"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: "#1A1A1A", border: "1px solid #252525", borderRadius: 10, padding: "10px 12px" }}>
      {/* Row 1: title + status */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: "#D8D8D8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {proposal.title}
        </span>
        <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 20, background: sc.bg, color: sc.color, border: `1px solid ${sc.color}30`, whiteSpace: "nowrap", flexShrink: 0 }}>
          {proposal.status}
        </span>
      </div>

      {/* Row 2: amount + dates */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11, color: "#555", marginBottom: 6 }}>
        {proposal.amount > 0 && (
          <span style={{ color: "#888", fontWeight: 600 }}>{fmtMoney(proposal.amount, proposal.currency)}</span>
        )}
        {proposal.sent_date && <span>נשלחה: {fmtDate(proposal.sent_date)}</span>}
        {proposal.followup_date && (
          <span style={{ color: new Date(proposal.followup_date) < new Date() ? "#F87171" : "#FBBF24" }}>
            מעקב: {fmtDate(proposal.followup_date)}
          </span>
        )}
      </div>

      {/* Notes */}
      {proposal.notes && (
        <div style={{ fontSize: 11, color: "#444", marginBottom: 8, lineHeight: 1.4 }}>{proposal.notes}</div>
      )}

      {error && <div style={{ fontSize: 11, color: "#EF4444", marginBottom: 6 }}>{error}</div>}

      {/* Actions */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {isConverted ? (
          <button onClick={() => openProject(proposal.linked_project_id!)}
            style={{ padding: "4px 10px", borderRadius: 7, border: "1px solid rgba(16,185,129,0.3)", background: "rgba(16,185,129,0.08)", color: "#34D399", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
            ♫ פתח פרויקט
          </button>
        ) : (
          <>
            <button onClick={() => setEditing(true)}
              style={{ padding: "4px 10px", borderRadius: 7, border: "1px solid #2A2A2A", background: "none", color: "#666", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
              ✎ ערוך
            </button>
            <button onClick={handleConvert} disabled={saving}
              style={{ padding: "4px 10px", borderRadius: 7, border: converting ? "1px solid rgba(245,158,11,0.5)" : "1px solid #2A2A2A", background: converting ? "rgba(245,158,11,0.1)" : "none", color: converting ? "#FBBF24" : "#666", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
              {saving ? "מעבד..." : converting ? "לחץ שוב לאישור ←" : "⚡ הפוך לפרויקט"}
            </button>
            <button onClick={handleDelete}
              style={{ padding: "4px 10px", borderRadius: 7, border: deleting ? "1px solid rgba(239,68,68,0.4)" : "1px solid #2A2A2A", background: deleting ? "rgba(239,68,68,0.08)" : "none", color: deleting ? "#F87171" : "#444", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}
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

export default function ProposalsSection({ client, proposals, onUpdate, onAdd, onDelete, onConverted, openProject }: {
  client: Client;
  proposals: Proposal[];
  onUpdate: (p: Proposal) => void;
  onAdd: (p: Proposal) => void;
  onDelete: (id: string) => void;
  onConverted: (proposalId: string, projectId: string, project: NewProject) => void;
  openProject: (id: string) => void;
}) {
  const [showForm, setShowForm] = useState(false);

  const open   = proposals.filter((p) => !["נסגר", "לא נסגר"].includes(p.status));
  const closed = proposals.filter((p) =>  ["נסגר", "לא נסגר"].includes(p.status));

  return (
    <div style={{ background: "#1A1A1A", border: "1px solid #222", borderRadius: 14, padding: "14px 16px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: showForm || proposals.length > 0 ? 12 : 0 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#444", textTransform: "uppercase", letterSpacing: "0.07em" }}>
          הצעות מחיר {proposals.length > 0 && `(${proposals.length})`}
        </div>
        <button onClick={() => setShowForm((v) => !v)}
          style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 10, border: showForm ? "1.5px solid rgba(59,130,246,0.5)" : "1px solid rgba(59,130,246,0.3)", background: showForm ? "rgba(59,130,246,0.2)" : "rgba(59,130,246,0.1)", color: "#60A5FA", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
          + הצעה חדשה
        </button>
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
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: closed.length > 0 ? 10 : 0 }}>
          {open.map((p) => (
            <ProposalRow key={p.id} proposal={p}
              onUpdate={onUpdate} onDelete={onDelete} onConverted={onConverted} openProject={openProject} />
          ))}
        </div>
      )}

      {/* Closed proposals (collapsed) */}
      {closed.length > 0 && (
        <details style={{ marginTop: open.length > 0 ? 4 : 0 }}>
          <summary style={{ fontSize: 11, color: "#333", cursor: "pointer", userSelect: "none", padding: "4px 0" }}>
            הצעות סגורות ({closed.length})
          </summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
            {closed.map((p) => (
              <ProposalRow key={p.id} proposal={p}
                onUpdate={onUpdate} onDelete={onDelete} onConverted={onConverted} openProject={openProject} />
            ))}
          </div>
        </details>
      )}

      {/* Empty */}
      {proposals.length === 0 && !showForm && (
        <div style={{ fontSize: 12, color: "#333", padding: "8px 0" }}>אין הצעות מחיר עדיין</div>
      )}
    </div>
  );
}
