"use client";

import { useEffect, useState, type ReactNode, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useProjects } from "@/components/ProjectsProvider";
import { usePlayerSafe, getLatestAudioFile, getFreshPlayUrl } from "@/components/PlayerProvider";
import { PROJECT_TYPES } from "@/lib/types";
import { deadlineLabel, daysUntilDeadline } from "@/lib/utils";
import StatusDropdown from "@/components/ui/StatusDropdown";
import InlineCellEdit from "@/components/ui/InlineCellEdit";
import ArtistCellEdit from "@/components/ui/ArtistCellEdit";
import NotesCellEdit from "@/components/ui/NotesCellEdit";
import UploadButton from "@/components/ui/UploadButton";
import ActionMenu from "@/components/project/ActionMenu";

// ── Types ─────────────────────────────────────────────────────────────────────
type SessionStatus  = "מתוכנן" | "התקיים" | "בוטל" | "נדחה" | "לא הגיע";
type SessionType    = "סשן" | "ניקוי מיקס" | "חזרה";
type PaymentStatus  = "שולם" | "צפוי" | "לא שולם" | "חלקי" | "בוטל";

interface Transaction {
  id: string;
  project_id: string;
  type: "income" | "expense";
  date: string | null;
  description: string;
  artist: string;
  amount: number;
  currency: string;
  payment_status: PaymentStatus;
  payment_method: string;
  receipt_ref: string;
  notes: string;
  category: string;
}

interface TxDraft {
  type: "income" | "expense";
  date: string;
  description: string;
  artist: string;
  amount: string;
  currency: string;
  paymentStatus: PaymentStatus;
  paymentMethod: string;
  notes: string;
  category: string;
}

interface Session {
  id: string;
  project_id: string;
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  status: SessionStatus;
  session_type: SessionType;
  notes: string;
}

interface Draft {
  date: string;
  startTime: string;
  endTime: string;
  status: SessionStatus;
  sessionType: SessionType;
  notes: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const STATUS_OPTIONS:   SessionStatus[]   = ["מתוכנן", "התקיים", "בוטל", "נדחה", "לא הגיע"];
const TYPE_OPTIONS:     SessionType[]     = ["סשן", "ניקוי מיקס", "חזרה"];
const PMT_STATUS_OPTS:  PaymentStatus[]   = ["שולם", "צפוי", "לא שולם", "חלקי", "בוטל"];
const EXPENSE_CATS      = ["מיקס / מאסטר", "חדר חזרות", "צילום", "נסיעות", "אחר"];

const STATUS_COLOR: Record<SessionStatus, string> = {
  "מתוכנן":  "#3B82F6",
  "התקיים":  "#10B981",
  "בוטל":    "#6B7280",
  "נדחה":    "#F59E0B",
  "לא הגיע": "#EF4444",
};

const PMT_COLOR: Record<PaymentStatus, string> = {
  "שולם":    "#10B981",
  "צפוי":    "#3B82F6",
  "לא שולם": "#EF4444",
  "חלקי":    "#F59E0B",
  "בוטל":    "#6B7280",
};

function emptyTxDraft(): TxDraft {
  return { type: "income", date: "", description: "", artist: "", amount: "", currency: "₪", paymentStatus: "צפוי", paymentMethod: "", notes: "", category: "" };
}

const AUDIO_EXTS = [".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aiff", ".aif"];
function isAudio(name: string) {
  return AUDIO_EXTS.some((ext) => name.toLowerCase().endsWith(ext));
}

// ── Small helpers ─────────────────────────────────────────────────────────────
function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
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

function Divider() {
  return <div style={{ height: 1, background: "#252525", margin: "10px 0" }} />;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

function emptyDraft(): Draft {
  return { date: "", startTime: "", endTime: "", status: "מתוכנן", sessionType: "סשן", notes: "" };
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}.${m}.${y}`;
}

// ── Input style ───────────────────────────────────────────────────────────────
const INPUT_S: CSSProperties = {
  background: "#0D0D0D", border: "1px solid #3A3A3A", borderRadius: 6,
  color: "#E8E8E8", fontSize: 12, padding: "4px 8px", outline: "none",
  fontFamily: "inherit", height: 28, boxSizing: "border-box",
};

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  projectId: string;
  artists: string[];
  onClose: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
export default function ProjectDrawer({ projectId, artists, onClose }: Props) {
  const { projects, updateProjectField, refresh } = useProjects();
  const player = usePlayerSafe();

  // ── Finance state ──────────────────────────────────────────────────────────
  const [transactions,   setTransactions]   = useState<Transaction[]>([]);
  const [agreedPrice,    setAgreedPrice]    = useState(0);
  const [finCurrency,    setFinCurrency]    = useState("₪");
  const [finLoaded,      setFinLoaded]      = useState(false);
  const [addingTx,       setAddingTx]       = useState<"income" | "expense" | null>(null);
  const [txDraft,        setTxDraft]        = useState<TxDraft>(emptyTxDraft());
  const [txSaving,       setTxSaving]       = useState(false);
  const [editingTxId,    setEditingTxId]    = useState<string | null>(null);
  const [editTxDraft,    setEditTxDraft]    = useState<TxDraft>(emptyTxDraft());
  const [editTxSaving,   setEditTxSaving]   = useState(false);
  const [editingPrice,   setEditingPrice]   = useState(false);
  const [priceDraft,     setPriceDraft]     = useState("");

  // ── File delete state ─────────────────────────────────────────────────────
  const [confirmDeletePath, setConfirmDeletePath] = useState<string | null>(null);
  const [deletingFile,      setDeletingFile]      = useState(false);
  const [fileDeleteErr,     setFileDeleteErr]     = useState<string | null>(null);

  const handleDeleteFile = async (dropboxPath: string) => {
    if (!project) return;
    setDeletingFile(true);
    setFileDeleteErr(null);
    try {
      const res = await fetch("/api/dropbox/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dropboxPath, projectId: project.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "מחיקה נכשלה");
      setConfirmDeletePath(null);
      await refresh();
    } catch (err) {
      setFileDeleteErr(err instanceof Error ? err.message : "שגיאה במחיקה");
      setTimeout(() => setFileDeleteErr(null), 4000);
    } finally {
      setDeletingFile(false);
    }
  };

  // ── Session state ──────────────────────────────────────────────────────────
  const [sessions,       setSessions]       = useState<Session[]>([]);
  const [sessionLimit,   setSessionLimit]   = useState(3);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [addingSession,  setAddingSession]  = useState(false);
  const [addDraft,       setAddDraft]       = useState<Draft>(emptyDraft);
  const [addSaving,      setAddSaving]      = useState(false);
  const [editingId,      setEditingId]      = useState<string | null>(null);
  const [editDraft,      setEditDraft]      = useState<Draft>(emptyDraft);
  const [editSaving,     setEditSaving]     = useState(false);
  const [editingLimit,   setEditingLimit]   = useState(false);
  const [limitDraft,     setLimitDraft]     = useState("");

  // ── Fetch sessions ─────────────────────────────────────────────────────────
  const fetchSessions = (withSync = false) => {
    setSessionsLoaded(false);
    fetch(`/api/sessions?projectId=${projectId}`)
      .then((r) => r.json())
      .then((d) => {
        setSessions(d.sessions ?? []);
        setSessionLimit(d.limit ?? 3);
        setSessionsLoaded(true);

        // After loading, run calendar sync in background to remove deleted events
        if (withSync) {
          fetch(`/api/sessions/sync?projectId=${projectId}`)
            .then((r) => r.json())
            .then((s) => {
              if (s.deleted > 0) {
                // Some sessions were removed — reload the list
                fetch(`/api/sessions?projectId=${projectId}`)
                  .then((r) => r.json())
                  .then((d2) => setSessions(d2.sessions ?? []));
              }
            })
            .catch(() => {});
        }
      })
      .catch(() => setSessionsLoaded(true));
  };

  useEffect(() => {
    setSessions([]);
    fetchSessions(true); // run calendar sync on every drawer open
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // ── Fetch finance data ─────────────────────────────────────────────────────
  useEffect(() => {
    setFinLoaded(false);
    setTransactions([]);
    fetch(`/api/transactions?projectId=${projectId}`)
      .then((r) => r.json())
      .then((d) => {
        setTransactions(d.transactions ?? []);
        setAgreedPrice(d.agreedPrice ?? 0);
        setFinCurrency(d.currency ?? "₪");
        setFinLoaded(true);
      })
      .catch(() => setFinLoaded(true));
  }, [projectId]);

  // ── ESC to close ───────────────────────────────────────────────────────────
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  const project = projects.find((p) => p.id === projectId);
  if (!project || typeof document === "undefined") return null;

  // ── Player ─────────────────────────────────────────────────────────────────
  const latestAudio = getLatestAudioFile(project.files);
  const isPlaying   = player?.track?.projectId === project.id && player.playing;
  const isLoaded    = player?.track?.projectId === project.id;
  const canPlay     = !!latestAudio && !!player;

  // ── Deadline color ─────────────────────────────────────────────────────────
  const days        = daysUntilDeadline(project.deadline);
  const showDueSoon = days !== null && days >= 0 && days <= 7 && project.status !== "הושלם";
  const deadlineColor =
    project.isOverdue && project.status !== "הושלם" ? "#EF4444"
    : showDueSoon ? "#F97316"
    : "#888";

  // ── Session stats — only "סשן" type counts toward the limit ─────────────────
  const sessionOnly = sessions.filter((s) => (s.session_type ?? "סשן") === "סשן");
  const done      = sessionOnly.filter((s) => s.status === "התקיים").length;
  const planned   = sessionOnly.filter((s) => s.status === "מתוכנן").length;
  const remaining = Math.max(0, sessionLimit - done);
  const overLimit = done > sessionLimit;
  const progress  = sessionLimit > 0 ? Math.min(100, (done / sessionLimit) * 100) : 0;

  // ── Session CRUD ───────────────────────────────────────────────────────────
  async function handleAddSession() {
    setAddSaving(true);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          date:        addDraft.date        || null,
          startTime:   addDraft.startTime   || null,
          endTime:     addDraft.endTime     || null,
          status:      addDraft.status,
          sessionType: addDraft.sessionType,
          notes:       addDraft.notes,
        }),
      });
      const data = await res.json();
      if (data.session) {
        setSessions((prev) => [...prev, data.session]);
        setAddDraft(emptyDraft());
        setAddingSession(false);
      }
    } finally {
      setAddSaving(false);
    }
  }

  async function handleUpdateSession() {
    if (!editingId) return;
    setEditSaving(true);
    try {
      const res = await fetch(`/api/sessions/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date:        editDraft.date        || null,
          startTime:   editDraft.startTime   || null,
          endTime:     editDraft.endTime     || null,
          status:      editDraft.status,
          sessionType: editDraft.sessionType,
          notes:       editDraft.notes,
        }),
      });
      const data = await res.json();
      if (data.session) {
        setSessions((prev) => prev.map((s) => s.id === editingId ? data.session : s));
        setEditingId(null);
      }
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDeleteSession(id: string) {
    setSessions((prev) => prev.filter((s) => s.id !== id)); // optimistic
    await fetch(`/api/sessions/${id}`, { method: "DELETE" });
  }

  async function handleLimitSave(val: string) {
    const n = parseInt(val, 10);
    if (isNaN(n) || n < 0) { setEditingLimit(false); return; }
    setSessionLimit(n);
    setEditingLimit(false);
    await fetch(`/api/sessions?projectId=${projectId}&type=limit`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: n }),
    });
  }

  // ── Finance CRUD ───────────────────────────────────────────────────────────
  async function handleAddTx() {
    setTxSaving(true);
    try {
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          type:          txDraft.type,
          date:          txDraft.date || null,
          description:   txDraft.description,
          artist:        txDraft.artist,
          amount:        Number(txDraft.amount) || 0,
          currency:      txDraft.currency,
          paymentStatus: txDraft.paymentStatus,
          paymentMethod: txDraft.paymentMethod,
          notes:         txDraft.notes,
          category:      txDraft.category,
        }),
      });
      const data = await res.json();
      if (data.transaction) {
        setTransactions((prev) => [data.transaction, ...prev]);
        setAddingTx(null);
        setTxDraft(emptyTxDraft());
      }
    } finally {
      setTxSaving(false);
    }
  }

  async function handleUpdateTx() {
    if (!editingTxId) return;
    setEditTxSaving(true);
    try {
      const res = await fetch(`/api/transactions/${editingTxId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type:          editTxDraft.type,
          date:          editTxDraft.date || null,
          description:   editTxDraft.description,
          amount:        Number(editTxDraft.amount) || 0,
          currency:      editTxDraft.currency,
          paymentStatus: editTxDraft.paymentStatus,
          notes:         editTxDraft.notes,
          category:      editTxDraft.category,
        }),
      });
      const data = await res.json();
      if (data.transaction) {
        setTransactions((prev) => prev.map((t) => t.id === editingTxId ? data.transaction : t));
        setEditingTxId(null);
      }
    } finally {
      setEditTxSaving(false);
    }
  }

  async function handleDeleteTx(id: string) {
    setTransactions((prev) => prev.filter((t) => t.id !== id));
    await fetch(`/api/transactions/${id}`, { method: "DELETE" });
  }

  async function handleSaveAgreedPrice(val: string) {
    const n = parseFloat(val);
    if (isNaN(n) || n < 0) { setEditingPrice(false); return; }
    setAgreedPrice(n);
    setEditingPrice(false);
    await fetch(`/api/transactions?projectId=${projectId}&type=settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agreedPrice: n, currency: finCurrency }),
    });
  }

  function startEditTx(tx: Transaction) {
    setEditingTxId(tx.id);
    setEditTxDraft({
      type:          tx.type,
      date:          tx.date ?? "",
      description:   tx.description,
      artist:        tx.artist,
      amount:        String(tx.amount),
      currency:      tx.currency,
      paymentStatus: tx.payment_status,
      paymentMethod: tx.payment_method,
      notes:         tx.notes,
      category:      tx.category,
    });
  }

  function startEdit(s: Session) {
    setEditingId(s.id);
    setEditDraft({
      date:        s.date         ?? "",
      startTime:   s.start_time   ?? "",
      endTime:     s.end_time     ?? "",
      status:      s.status,
      sessionType: (s.session_type ?? "סשן") as SessionType,
      notes:       s.notes,
    });
  }

  // ── Finance computed ──────────────────────────────────────────────────────
  const incomeList  = transactions.filter((t) => t.type === "income");
  const expenseList = transactions.filter((t) => t.type === "expense");
  const totalPaid   = incomeList.filter((t) => t.payment_status === "שולם").reduce((s, t) => s + t.amount, 0);
  const totalExp    = expenseList.reduce((s, t) => s + t.amount, 0);
  const balance     = agreedPrice - totalPaid;
  const profit      = totalPaid - totalExp;

  // ── Files ─────────────────────────────────────────────────────────────────
  const allFiles = [...project.files].reverse(); // newest first

  // ── Render ────────────────────────────────────────────────────────────────
  return createPortal(
    <div dir="rtl" style={{ position: "fixed", inset: 0, zIndex: 99999 }}>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "absolute", inset: 0,
          background: "rgba(0,0,0,0.55)",
          backdropFilter: "blur(2px)",
        }}
      />

      {/* Panel */}
      <div style={{
        position: "absolute", top: 0, right: 0, bottom: 0, width: 460,
        background: "#141414", borderLeft: "1px solid #252525",
        display: "flex", flexDirection: "column", zIndex: 100000,
        animation: "rb-drawer-in 240ms cubic-bezier(.22,.68,0,1.2) forwards",
      }}>
        <style>{`
          @keyframes rb-drawer-in {
            from { transform: translateX(100%); opacity: 0.6; }
            to   { transform: translateX(0);    opacity: 1;   }
          }
          .rb-session-input { background:#0D0D0D; border:1px solid #3A3A3A; border-radius:6px; color:#E8E8E8; font-size:12px; padding:4px 8px; outline:none; font-family:inherit; height:28px; box-sizing:border-box; }
          .rb-session-input:focus { border-color:#3B82F6; }
        `}</style>

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 16px", height: 52, borderBottom: "1px solid #252525", flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={onClose}
              style={{ background: "none", border: "none", cursor: "pointer", color: "#555", fontSize: 20, lineHeight: 1, padding: "2px 4px" }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#CCC")}
              onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#555")}
            >×</button>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#777" }}>פרטי פרויקט</span>
          </div>
          <Link
            href={`/projects/${project.id}`}
            style={{ fontSize: 11, color: "#444", textDecoration: "none" }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLAnchorElement).style.color = "#888")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLAnchorElement).style.color = "#444")}
          >
            פתח עמוד מלא ↗
          </Link>
        </div>

        {/* ── Scrollable body ──────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>

          {/* Name + Artist */}
          <Card>
            <Row label="שם פרויקט">
              <InlineCellEdit value={project.name} onSave={(v) => updateProjectField(project.id, "name", v)} type="text">
                <span style={{ fontSize: 15, fontWeight: 700, color: "#E8E8E8" }}>{project.name}</span>
              </InlineCellEdit>
            </Row>
            <Divider />
            <Row label="אמן">
              <ArtistCellEdit value={project.artist} artists={artists} onSave={(v) => updateProjectField(project.id, "artist", v)} />
            </Row>
          </Card>

          {/* Status / Deadline / Type / Parent / Notes */}
          <Card>
            <Row label="סטטוס">
              <StatusDropdown projectId={project.id} status={project.status} small />
            </Row>
            <Divider />
            <Row label="דדליין">
              <InlineCellEdit value={project.deadline || ""} onSave={(v) => updateProjectField(project.id, "deadline", v)} type="date">
                <span style={{ fontSize: 12, color: deadlineColor }}>{deadlineLabel(project.deadline)}</span>
              </InlineCellEdit>
            </Row>
            <Divider />
            <Row label="סוג">
              <InlineCellEdit
                value={project.projectType}
                onSave={(v) => updateProjectField(project.id, "projectType", v)}
                type="select"
                options={[{ value: "", label: "ללא" }, ...PROJECT_TYPES.map((t) => ({ value: t, label: t }))]}
              >
                <span style={{ fontSize: 12, color: project.projectType ? "#E0E0E0" : "#444" }}>{project.projectType || "ללא"}</span>
              </InlineCellEdit>
            </Row>
            <Divider />
            <Row label="שייך ל">
              <InlineCellEdit value={project.parentProject || ""} onSave={(v) => updateProjectField(project.id, "parentProject", v || "ללא שיוך")} type="text" placeholder="ללא שיוך">
                <span style={{ fontSize: 12, color: project.parentProject ? "#888" : "#444" }}>{project.parentProject || "—"}</span>
              </InlineCellEdit>
            </Row>
            <Divider />
            <Row label="הערות">
              <NotesCellEdit value={project.notes || ""} onSave={(v) => updateProjectField(project.id, "notes", v)} />
            </Row>
          </Card>

          {/* ── מעקב סשנים ──────────────────────────────────────────────── */}
          <Card>
            {/* Header row */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#888" }}>מעקב סשנים</span>
              <button
                onClick={() => { setAddingSession(true); setAddDraft(emptyDraft()); }}
                style={{
                  fontSize: 11, color: "#3B82F6", background: "rgba(59,130,246,0.08)",
                  border: "1px solid rgba(59,130,246,0.25)", borderRadius: 8,
                  padding: "3px 10px", cursor: "pointer",
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "rgba(59,130,246,0.16)")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "rgba(59,130,246,0.08)")}
              >
                + הוסף סשן
              </button>
            </div>

            {/* Progress bar */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: overLimit ? "#EF4444" : "#E8E8E8" }}>
                  סשנים: {done}/{sessionLimit}
                </span>
                {overLimit && (
                  <span style={{ fontSize: 11, color: "#EF4444", fontWeight: 600 }}>⚠ חריגה!</span>
                )}
              </div>
              <div style={{ height: 6, background: "#252525", borderRadius: 3, overflow: "hidden" }}>
                <div style={{
                  height: "100%", borderRadius: 3,
                  width: `${progress}%`,
                  background: overLimit ? "#EF4444" : "#3B82F6",
                  transition: "width 0.3s ease",
                }} />
              </div>
            </div>

            {/* Stats row */}
            <div style={{
              display: "flex", gap: 16, fontSize: 11, color: "#666", marginBottom: 10,
            }}>
              <span>התקיימו: <strong style={{ color: "#10B981" }}>{done}</strong></span>
              <span>מתוכננים: <strong style={{ color: "#3B82F6" }}>{planned}</strong></span>
              <span>נותרו: <strong style={{ color: "#F0F0F0" }}>{remaining}</strong></span>
            </div>

            {/* Limit row */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "#555", marginBottom: 14 }}>
              <span>מגבלת סשנים:</span>
              {editingLimit ? (
                <input
                  autoFocus
                  type="number"
                  min={0}
                  value={limitDraft}
                  onChange={(e) => setLimitDraft(e.target.value)}
                  onBlur={() => handleLimitSave(limitDraft)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleLimitSave(limitDraft);
                    if (e.key === "Escape") setEditingLimit(false);
                  }}
                  style={{ ...INPUT_S, width: 52 }}
                />
              ) : (
                <button
                  onClick={() => { setLimitDraft(String(sessionLimit)); setEditingLimit(true); }}
                  style={{
                    background: "rgba(255,255,255,0.05)", border: "1px solid #2A2A2A",
                    borderRadius: 6, padding: "2px 10px", color: "#DDD", fontSize: 12,
                    cursor: "pointer", fontFamily: "inherit",
                  }}
                  title="לחץ לעריכה"
                >
                  {sessionLimit}
                </button>
              )}
            </div>

            {/* Session list */}
            {!sessionsLoaded ? (
              <div style={{ fontSize: 11, color: "#444" }}>טוען...</div>
            ) : sessions.length === 0 && !addingSession ? (
              <div style={{ fontSize: 11, color: "#444" }}>אין סשנים עדיין</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {sessions.map((s) => (
                  <div key={s.id}>
                    {editingId === s.id ? (
                      /* ── Inline edit form ── */
                      <SessionForm
                        draft={editDraft}
                        setDraft={setEditDraft}
                        saving={editSaving}
                        onSave={handleUpdateSession}
                        onCancel={() => setEditingId(null)}
                      />
                    ) : (
                      /* ── Session row ── */
                      <div style={{
                        display: "flex", alignItems: "flex-start", gap: 8,
                        padding: "6px 8px", borderRadius: 8,
                        background: "rgba(255,255,255,0.02)",
                        border: "1px solid #222",
                      }}>
                        {/* Color dot */}
                        <div style={{
                          width: 7, height: 7, borderRadius: "50%",
                          background: STATUS_COLOR[s.status], flexShrink: 0, marginTop: 4,
                        }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, color: "#CCC", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <span style={{ fontWeight: 600 }}>{s.date ? fmtDate(s.date) : "—"}</span>
                            {(s.start_time || s.end_time) && (
                              <span style={{ color: "#666", fontSize: 11 }}>
                                {s.start_time || ""}{ s.end_time ? `–${s.end_time}` : ""}
                              </span>
                            )}
                            <span style={{
                              fontSize: 10, fontWeight: 600,
                              color: STATUS_COLOR[s.status],
                              background: `${STATUS_COLOR[s.status]}18`,
                              border: `1px solid ${STATUS_COLOR[s.status]}35`,
                              borderRadius: 5, padding: "1px 6px",
                            }}>
                              {s.status}
                            </span>
                            {/* Clickable type badge — cycles through types */}
                            <button
                              onClick={async () => {
                                const cur = (s.session_type ?? "סשן") as SessionType;
                                const next = TYPE_OPTIONS[(TYPE_OPTIONS.indexOf(cur) + 1) % TYPE_OPTIONS.length];
                                setSessions((prev) => prev.map((x) => x.id === s.id ? { ...x, session_type: next } : x));
                                await fetch(`/api/sessions/${s.id}`, {
                                  method: "PATCH",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ sessionType: next }),
                                });
                              }}
                              title="לחץ לשינוי סוג"
                              style={{
                                fontSize: 10, fontWeight: 600, cursor: "pointer",
                                borderRadius: 5, padding: "1px 6px", border: "none",
                                ...((() => {
                                  const t = (s.session_type ?? "סשן") as SessionType;
                                  if (t === "חזרה")      return { color: "#F59E0B", background: "rgba(245,158,11,0.12)", outline: "1px solid rgba(245,158,11,0.3)" };
                                  if (t === "ניקוי מיקס") return { color: "#A855F7", background: "rgba(168,85,247,0.12)", outline: "1px solid rgba(168,85,247,0.3)" };
                                  return { color: "#3B82F6", background: "rgba(59,130,246,0.10)", outline: "1px solid rgba(59,130,246,0.25)" };
                                })()),
                              }}
                            >
                              {s.session_type ?? "סשן"}
                            </button>
                          </div>
                          {s.notes && (
                            <div style={{ fontSize: 11, color: "#555", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {s.notes}
                            </div>
                          )}
                        </div>
                        {/* Actions */}
                        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                          <button
                            onClick={() => startEdit(s)}
                            style={{ background: "none", border: "none", cursor: "pointer", color: "#444", fontSize: 12, padding: "2px 4px" }}
                            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#AAA")}
                            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#444")}
                            title="ערוך"
                          >✏</button>
                          <button
                            onClick={() => handleDeleteSession(s.id)}
                            style={{ background: "none", border: "none", cursor: "pointer", color: "#444", fontSize: 14, padding: "2px 4px" }}
                            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#EF4444")}
                            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#444")}
                            title="מחק"
                          >×</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {/* Add form */}
                {addingSession && (
                  <SessionForm
                    draft={addDraft}
                    setDraft={setAddDraft}
                    saving={addSaving}
                    onSave={handleAddSession}
                    onCancel={() => setAddingSession(false)}
                  />
                )}
              </div>
            )}
          </Card>

          {/* ── כספים ───────────────────────────────────────────────────── */}
          <Card>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#888" }}>כספים</span>
            </div>

            {/* Agreed price row */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: "#555" }}>מחיר מוסכם</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {editingPrice ? (
                  <input
                    autoFocus type="number" min={0}
                    value={priceDraft}
                    onChange={(e) => setPriceDraft(e.target.value)}
                    onBlur={() => handleSaveAgreedPrice(priceDraft)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveAgreedPrice(priceDraft);
                      if (e.key === "Escape") setEditingPrice(false);
                    }}
                    style={{ ...INPUT_S, width: 90, fontSize: 13, padding: "4px 8px", height: 28 }}
                  />
                ) : (
                  <button
                    onClick={() => { setPriceDraft(String(agreedPrice)); setEditingPrice(true); }}
                    title="לחץ לעריכה"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid #2A2A2A", borderRadius: 7, padding: "3px 10px", cursor: "pointer", fontSize: 14, fontWeight: 700, color: "#DDD", fontFamily: "inherit" }}
                  >
                    {agreedPrice > 0 ? `${agreedPrice.toLocaleString()}${finCurrency}` : "לא הוגדר"}
                  </button>
                )}
                <span style={{ fontSize: 10, color: "#444" }}>ערוך ✏</span>
              </div>
            </div>

            {/* Stats rows */}
            {[
              { label: "שולם עד עכשיו",    value: totalPaid,  color: "#10B981", prefix: "" },
              { label: "יתרה לתשלום",       value: balance,    color: balance > 0 ? "#EF4444" : "#10B981", prefix: "" },
              { label: "הוצאות",            value: totalExp,   color: "#F59E0B", prefix: "−" },
              { label: "רווח משוער",        value: profit,     color: profit >= 0 ? "#10B981" : "#EF4444", prefix: "" },
            ].map(({ label, value, color, prefix }) => (
              <div key={label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #1E1E1E" }}>
                <div style={{ fontSize: 11, color: "#666" }}>{label}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color }}>{prefix}{value.toLocaleString()}{finCurrency}</div>
              </div>
            ))}

            {/* Action buttons */}
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button
                onClick={() => { setAddingTx("income"); setTxDraft({ ...emptyTxDraft(), type: "income" }); }}
                style={{ flex: 1, padding: "7px 0", borderRadius: 9, border: "1px solid rgba(16,185,129,0.3)", background: "rgba(16,185,129,0.07)", color: "#10B981", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "rgba(16,185,129,0.14)")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "rgba(16,185,129,0.07)")}
              >+ הוסף תשלום</button>
              <button
                onClick={() => { setAddingTx("expense"); setTxDraft({ ...emptyTxDraft(), type: "expense" }); }}
                style={{ flex: 1, padding: "7px 0", borderRadius: 9, border: "1px solid rgba(245,158,11,0.3)", background: "rgba(245,158,11,0.07)", color: "#F59E0B", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "rgba(245,158,11,0.14)")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "rgba(245,158,11,0.07)")}
              >+ הוסף הוצאה</button>
            </div>

            {/* Inline TX form */}
            {addingTx && (
              <div style={{ marginTop: 12 }}>
                <DrawerTxForm
                  draft={txDraft}
                  setDraft={setTxDraft}
                  saving={txSaving}
                  onSave={handleAddTx}
                  onCancel={() => setAddingTx(null)}
                />
              </div>
            )}

            {/* Transaction lists */}
            {!finLoaded ? (
              <div style={{ fontSize: 11, color: "#444", marginTop: 12 }}>טוען...</div>
            ) : transactions.length === 0 && !addingTx ? (
              <div style={{ fontSize: 11, color: "#444", marginTop: 12, textAlign: "center", padding: "10px 0" }}>
                אין נתונים פיננסיים עדיין
              </div>
            ) : (
              <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                {/* Income */}
                {incomeList.length > 0 && (
                  <div>
                    <div style={{ fontSize: 10, color: "#10B981", fontWeight: 700, marginBottom: 6, letterSpacing: "0.05em" }}>תשלומים</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      {incomeList.map((tx) => (
                        <div key={tx.id}>
                          {editingTxId === tx.id ? (
                            <DrawerTxForm draft={editTxDraft} setDraft={setEditTxDraft} saving={editTxSaving} onSave={handleUpdateTx} onCancel={() => setEditingTxId(null)} />
                          ) : (
                            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", borderRadius: 7, background: "rgba(16,185,129,0.04)", border: "1px solid rgba(16,185,129,0.1)" }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                  <span style={{ fontSize: 10, color: "#666" }}>{tx.date ? tx.date.split("-").reverse().join(".") : "—"}</span>
                                  <span style={{ fontSize: 11, color: "#CCC", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 110 }}>{tx.description || "—"}</span>
                                  <span style={{ fontSize: 9, fontWeight: 700, color: PMT_COLOR[tx.payment_status], background: `${PMT_COLOR[tx.payment_status]}18`, border: `1px solid ${PMT_COLOR[tx.payment_status]}30`, borderRadius: 4, padding: "1px 5px" }}>{tx.payment_status}</span>
                                </div>
                              </div>
                              <span style={{ fontSize: 12, fontWeight: 700, color: "#10B981", flexShrink: 0 }}>+{tx.amount.toLocaleString()}{tx.currency}</span>
                              <button onClick={() => startEditTx(tx)} style={{ background: "none", border: "none", cursor: "pointer", color: "#444", fontSize: 11, padding: "1px 3px" }} onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#AAA")} onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#444")}>✏</button>
                              <button onClick={() => handleDeleteTx(tx.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#444", fontSize: 13, padding: "1px 3px" }} onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#EF4444")} onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#444")}>×</button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Expenses */}
                {expenseList.length > 0 && (
                  <div>
                    <div style={{ fontSize: 10, color: "#F59E0B", fontWeight: 700, marginBottom: 6, letterSpacing: "0.05em" }}>הוצאות</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      {expenseList.map((tx) => (
                        <div key={tx.id}>
                          {editingTxId === tx.id ? (
                            <DrawerTxForm draft={editTxDraft} setDraft={setEditTxDraft} saving={editTxSaving} onSave={handleUpdateTx} onCancel={() => setEditingTxId(null)} />
                          ) : (
                            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", borderRadius: 7, background: "rgba(245,158,11,0.04)", border: "1px solid rgba(245,158,11,0.1)" }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                  <span style={{ fontSize: 10, color: "#666" }}>{tx.date ? tx.date.split("-").reverse().join(".") : "—"}</span>
                                  {tx.category && <span style={{ fontSize: 9, color: "#888", background: "rgba(255,255,255,0.05)", borderRadius: 4, padding: "1px 5px" }}>{tx.category}</span>}
                                  <span style={{ fontSize: 11, color: "#CCC", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 100 }}>{tx.description || "—"}</span>
                                </div>
                              </div>
                              <span style={{ fontSize: 12, fontWeight: 700, color: "#F59E0B", flexShrink: 0 }}>−{tx.amount.toLocaleString()}{tx.currency}</span>
                              <button onClick={() => startEditTx(tx)} style={{ background: "none", border: "none", cursor: "pointer", color: "#444", fontSize: 11, padding: "1px 3px" }} onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#AAA")} onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#444")}>✏</button>
                              <button onClick={() => handleDeleteTx(tx.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#444", fontSize: 13, padding: "1px 3px" }} onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#EF4444")} onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#444")}>×</button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>

          {/* ── Files + Player ───────────────────────────────────────────── */}
          <Card>
            {/* Card header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#888" }}>קבצים</span>
              <UploadButton
                projectId={project.id}
                projectName={project.name}
                artist={project.artist}
                existingFiles={project.files}
                size="sm"
              />
            </div>

            {/* Latest audio version */}
            {latestAudio ? (
              <div style={{
                background: "#141414", border: "1px solid #2A2A2A",
                borderRadius: 10, padding: "10px 12px", marginBottom: 10,
              }}>
                <div style={{ fontSize: 10, color: "#555", marginBottom: 6 }}>גרסה אחרונה</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {/* Play/Pause */}
                  {player && (
                    <button
                      onClick={async () => {
                        if (isLoaded) {
                          isPlaying ? player.pause() : player.resume();
                        } else {
                          const url = await getFreshPlayUrl(latestAudio);
                          player.play({
                            projectId: project.id,
                            projectName: project.name,
                            artist: project.artist,
                            fileName: latestAudio.name,
                            url,
                          });
                        }
                      }}
                      title={isPlaying ? "השהה" : "נגן גרסה אחרונה"}
                      style={{
                        width: 32, height: 32, borderRadius: "50%", border: "none",
                        cursor: "pointer", flexShrink: 0,
                        background: isLoaded ? "#3B82F6" : "rgba(59,130,246,0.15)",
                        color: isLoaded ? "#fff" : "#3B82F6",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 11, transition: "all 0.15s",
                      }}
                      onMouseEnter={(e) => {
                        if (!isLoaded) (e.currentTarget as HTMLButtonElement).style.background = "rgba(59,130,246,0.25)";
                      }}
                      onMouseLeave={(e) => {
                        if (!isLoaded) (e.currentTarget as HTMLButtonElement).style.background = "rgba(59,130,246,0.15)";
                      }}
                    >
                      {isPlaying ? "⏸" : "▶"}
                    </button>
                  )}
                  {/* Filename */}
                  <span
                    title={latestAudio.name}
                    style={{
                      flex: 1, fontSize: 11, color: "#CCC",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}
                  >
                    {latestAudio.name}
                  </span>
                  {/* Download */}
                  <a
                    href={latestAudio.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="הורד / פתח קובץ מקורי"
                    style={{
                      width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                      background: "rgba(255,255,255,0.04)", color: "#555",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      textDecoration: "none", transition: "all 0.13s",
                    }}
                    onMouseEnter={(e) => {
                      const el = e.currentTarget as HTMLAnchorElement;
                      el.style.background = "rgba(255,255,255,0.1)";
                      el.style.color = "#AAA";
                    }}
                    onMouseLeave={(e) => {
                      const el = e.currentTarget as HTMLAnchorElement;
                      el.style.background = "rgba(255,255,255,0.04)";
                      el.style.color = "#555";
                    }}
                  >
                    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M6.5 1v7M3.5 5.5l3 3 3-3" />
                      <path d="M1.5 10.5h10" />
                    </svg>
                  </a>

                  {/* Delete (Dropbox files only) */}
                  {latestAudio.dropboxPath && (
                    confirmDeletePath === latestAudio.dropboxPath ? (
                      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                        <button
                          onClick={() => handleDeleteFile(latestAudio.dropboxPath!)}
                          disabled={deletingFile}
                          title="אשר מחיקה"
                          style={{
                            padding: "2px 7px", borderRadius: 5, border: "none",
                            background: "#EF4444", color: "#fff", fontSize: 11,
                            cursor: deletingFile ? "wait" : "pointer", fontFamily: "inherit",
                          }}
                        >{deletingFile ? "..." : "מחק"}</button>
                        <button
                          onClick={() => setConfirmDeletePath(null)}
                          disabled={deletingFile}
                          style={{
                            padding: "2px 7px", borderRadius: 5,
                            border: "1px solid #333", background: "transparent",
                            color: "#666", fontSize: 11, cursor: "pointer", fontFamily: "inherit",
                          }}
                        >ביטול</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDeletePath(latestAudio.dropboxPath!)}
                        title="מחק קובץ"
                        style={{
                          width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                          background: "none", border: "none", cursor: "pointer",
                          color: "#444", fontSize: 15,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          transition: "color 0.13s",
                        }}
                        onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#EF4444")}
                        onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#444")}
                      >🗑</button>
                    )
                  )}
                </div>
              </div>
            ) : (
              <div style={{
                padding: "12px", borderRadius: 10, border: "1px dashed #252525",
                fontSize: 12, color: "#444", textAlign: "center", marginBottom: 10,
              }}>
                אין גרסה להשמעה
              </div>
            )}

            {/* All files list — shown if more than one file */}
            {allFiles.length > 1 && (
              <div>
                <div style={{ fontSize: 10, color: "#444", marginBottom: 6 }}>כל הקבצים</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  {allFiles.map((f, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex", alignItems: "center", gap: 4,
                        padding: "3px 4px", borderRadius: 6,
                      }}
                    >
                      {confirmDeletePath === f.dropboxPath && f.dropboxPath ? (
                        /* ── Confirm row ── */
                        <div style={{ display: "flex", alignItems: "center", gap: 4, flex: 1 }}>
                          <span style={{ flex: 1, fontSize: 10, color: "#EF4444", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            מחק &quot;{f.name}&quot;?
                          </span>
                          <button
                            onClick={() => handleDeleteFile(f.dropboxPath!)}
                            disabled={deletingFile}
                            style={{
                              padding: "1px 7px", borderRadius: 4, border: "none",
                              background: "#EF4444", color: "#fff", fontSize: 10,
                              cursor: deletingFile ? "wait" : "pointer", fontFamily: "inherit", flexShrink: 0,
                            }}
                          >{deletingFile ? "..." : "מחק"}</button>
                          <button
                            onClick={() => setConfirmDeletePath(null)}
                            disabled={deletingFile}
                            style={{
                              padding: "1px 6px", borderRadius: 4,
                              border: "1px solid #333", background: "transparent",
                              color: "#666", fontSize: 10, cursor: "pointer", fontFamily: "inherit", flexShrink: 0,
                            }}
                          >ביטול</button>
                        </div>
                      ) : (
                        /* ── Normal row ── */
                        <>
                          <a
                            href={f.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              flex: 1, fontSize: 11, color: "#555", textDecoration: "none",
                              display: "flex", alignItems: "center", gap: 6,
                              overflow: "hidden",
                            }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.color = "#3B82F6"; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.color = "#555"; }}
                          >
                            <span style={{ flexShrink: 0, fontSize: 10 }}>↓</span>
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                          </a>
                          {f.dropboxPath && (
                            <button
                              onClick={() => setConfirmDeletePath(f.dropboxPath!)}
                              title="מחק קובץ"
                              style={{
                                background: "none", border: "none", cursor: "pointer",
                                color: "#383838", fontSize: 13, padding: "0 2px",
                                flexShrink: 0, lineHeight: 1, transition: "color 0.13s",
                              }}
                              onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#EF4444")}
                              onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#383838")}
                            >🗑</button>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Delete error */}
            {fileDeleteErr && (
              <div style={{
                marginTop: 6, padding: "4px 10px", borderRadius: 6, fontSize: 11,
                background: "#2A1010", border: "1px solid #5A1A1A", color: "#FF6B6B",
              }}>{fileDeleteErr}</div>
            )}

            {/* No files at all */}
            {project.files.length === 0 && (
              <div style={{ fontSize: 11, color: "#444" }}>אין קבצים</div>
            )}
          </Card>

          {/* ── Actions ──────────────────────────────────────────────────── */}
          <Card>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 10, color: "#555" }}>פעולות</span>
              <ActionMenu projectId={project.id} projectName={project.name} artist={project.artist} onSessionCreated={fetchSessions} />
            </div>
          </Card>

        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Inline transaction form (add / edit) ─────────────────────────────────────
function DrawerTxForm({
  draft, setDraft, saving, onSave, onCancel,
}: {
  draft: TxDraft;
  setDraft: (d: TxDraft) => void;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const isIncome = draft.type === "income";
  return (
    <div style={{
      background: "#181818", border: "1px solid #2A2A2A",
      borderRadius: 10, padding: "10px 12px",
      display: "flex", flexDirection: "column", gap: 7, marginBottom: 10,
    }}>
      {/* Type toggle */}
      <div style={{ display: "flex", gap: 6 }}>
        {(["income", "expense"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setDraft({ ...draft, type: t })}
            style={{
              padding: "3px 10px", borderRadius: 7, border: "none", cursor: "pointer",
              fontSize: 11, fontFamily: "inherit", fontWeight: 600,
              background: draft.type === t
                ? (t === "income" ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.15)")
                : "transparent",
              color: draft.type === t
                ? (t === "income" ? "#10B981" : "#EF4444")
                : "#555",
            }}
          >
            {t === "income" ? "הכנסה" : "הוצאה"}
          </button>
        ))}
      </div>

      {/* Date + Description */}
      <div style={{ display: "flex", gap: 6 }}>
        <input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })}
          className="rb-session-input" style={{ width: 120, colorScheme: "dark" }} />
        <input type="text" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          placeholder="תיאור" className="rb-session-input" style={{ flex: 1 }} />
      </div>

      {/* Amount + Currency + Status/Category */}
      <div style={{ display: "flex", gap: 6 }}>
        <input type="number" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
          placeholder="סכום" min={0} className="rb-session-input" style={{ flex: 1 }} />
        <select value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value })}
          className="rb-session-input" style={{ width: 50 }}>
          {["₪", "$", "€"].map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        {isIncome ? (
          <select value={draft.paymentStatus} onChange={(e) => setDraft({ ...draft, paymentStatus: e.target.value as PaymentStatus })}
            className="rb-session-input" style={{ flex: 1 }}>
            {PMT_STATUS_OPTS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        ) : (
          <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}
            className="rb-session-input" style={{ flex: 1 }}>
            <option value="">קטגוריה</option>
            {EXPENSE_CATS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>

      {/* Notes */}
      <input type="text" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
        placeholder="הערות (אופציונלי)" className="rb-session-input" style={{ width: "100%", boxSizing: "border-box" }}
        onKeyDown={(e) => { if (e.key === "Enter") onSave(); if (e.key === "Escape") onCancel(); }} />

      {/* Buttons */}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onSave} disabled={saving}
          style={{ flex: 1, padding: "5px 0", borderRadius: 7, border: "none", background: "#3B82F6", color: "#fff", fontSize: 12, cursor: saving ? "wait" : "pointer", fontFamily: "inherit" }}>
          {saving ? "שומר..." : "שמור"}
        </button>
        <button onClick={onCancel}
          style={{ padding: "5px 14px", borderRadius: 7, border: "1px solid #2A2A2A", background: "transparent", color: "#666", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
          ביטול
        </button>
      </div>
    </div>
  );
}

// ── Inline session form (add / edit) ──────────────────────────────────────────
function SessionForm({
  draft, setDraft, saving, onSave, onCancel,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={{
      background: "#181818", border: "1px solid #2A2A2A",
      borderRadius: 10, padding: "10px 12px",
      display: "flex", flexDirection: "column", gap: 8,
    }}>
      {/* Date + times row */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <input
          type="date"
          value={draft.date}
          onChange={(e) => setDraft({ ...draft, date: e.target.value })}
          className="rb-session-input"
          style={{ flex: "1 1 120px" }}
        />
        <input
          type="time"
          value={draft.startTime}
          onChange={(e) => setDraft({ ...draft, startTime: e.target.value })}
          className="rb-session-input"
          style={{ width: 90 }}
          placeholder="התחלה"
        />
        <span style={{ lineHeight: "28px", color: "#555", fontSize: 12 }}>–</span>
        <input
          type="time"
          value={draft.endTime}
          onChange={(e) => setDraft({ ...draft, endTime: e.target.value })}
          className="rb-session-input"
          style={{ width: 90 }}
          placeholder="סיום"
        />
      </div>

      {/* Type + Status row */}
      <div style={{ display: "flex", gap: 6 }}>
        <select
          value={draft.sessionType}
          onChange={(e) => setDraft({ ...draft, sessionType: e.target.value as SessionType })}
          className="rb-session-input"
          style={{ flex: 1 }}
        >
          {TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select
          value={draft.status}
          onChange={(e) => setDraft({ ...draft, status: e.target.value as SessionStatus })}
          className="rb-session-input"
          style={{ flex: 1 }}
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {/* Notes */}
      <input
        type="text"
        value={draft.notes}
        onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
        placeholder="הערות (אופציונלי)"
        className="rb-session-input"
        style={{ width: "100%", boxSizing: "border-box" }}
        onKeyDown={(e) => { if (e.key === "Enter") onSave(); if (e.key === "Escape") onCancel(); }}
      />

      {/* Buttons */}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={onSave}
          disabled={saving}
          style={{
            flex: 1, padding: "5px 0", borderRadius: 7, border: "none",
            background: "#3B82F6", color: "#fff", fontSize: 12,
            cursor: saving ? "wait" : "pointer", fontFamily: "inherit",
          }}
        >
          {saving ? "שומר..." : "שמור"}
        </button>
        <button
          onClick={onCancel}
          style={{
            padding: "5px 14px", borderRadius: 7,
            border: "1px solid #2A2A2A", background: "transparent",
            color: "#666", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
          }}
        >
          ביטול
        </button>
      </div>
    </div>
  );
}
