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
import CopyLinkButton from "@/components/ui/CopyLinkButton";
import ActionMenu from "@/components/project/ActionMenu";

// ── Types ─────────────────────────────────────────────────────────────────────
type SessionStatus  = "מתוכנן" | "התקיים" | "בוטל" | "נדחה" | "לא הגיע";
type SessionType    = "סשן" | "ניקוי מיקס" | "חזרה";
type PaymentStatus  = "שולם" | "התקבל" | "צפוי" | "לא שולם" | "חלקי" | "בוטל" | "לבדיקה";

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
  linked_session_id: string;
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
  linkedSessionId: string;
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
// Quick-change options shown in the status dropdown (income)
const PMT_STATUS_OPTS:  PaymentStatus[]   = ["התקבל", "צפוי", "חלקי", "בוטל", "לבדיקה"];
// Statuses that count as "paid" in totalPaid calculation
const PAID_STATUSES = new Set<PaymentStatus>(["שולם", "התקבל"]);
// Payment method options
const PMT_METHOD_OPTS = ["ביט", "העברה בנקאית", "מזומן", "PayPal", "Payoneer", "אשראי", "אחר"];

// Half-hour time slots for the custom time picker (avoids ugly native scroll wheel)
const TIME_SLOTS: string[] = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2);
  const m = i % 2 === 0 ? "00" : "30";
  return `${String(h).padStart(2, "0")}:${m}`;
});
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
  "התקבל":   "#10B981",
  "צפוי":    "#3B82F6",
  "לא שולם": "#EF4444",
  "חלקי":    "#F59E0B",
  "בוטל":    "#6B7280",
  "לבדיקה":  "#A855F7",
};

function emptyTxDraft(): TxDraft {
  return { type: "income", date: "", description: "", artist: "", amount: "", currency: "₪", paymentStatus: "צפוי", paymentMethod: "", notes: "", category: "", linkedSessionId: "" };
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

function CollapsibleCard({
  label, badge, open, onToggle, children, style,
}: {
  label: string; badge?: string | number; open: boolean;
  onToggle: () => void; children: ReactNode; style?: CSSProperties;
}) {
  return (
    <div style={{ background: "#1C1C1C", border: "1px solid #252525", borderRadius: 14, marginBottom: 10, overflow: "hidden", ...style }}>
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
        <span style={{ fontSize: 13, color: "#444", display: "inline-block", transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s", lineHeight: 1 }}>▾</span>
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
  const [transactions,          setTransactions]          = useState<Transaction[]>([]);
  const [agreedPrice,           setAgreedPrice]           = useState(0);
  const [finCurrency,           setFinCurrency]           = useState("₪");
  const [finLoaded,             setFinLoaded]             = useState(false);
  const [financeException,      setFinanceException]      = useState(false);
  const [financeExceptionReason, setFinanceExceptionReason] = useState("");
  const [addingTx,       setAddingTx]       = useState<"income" | "expense" | null>(null);
  const [txDraft,        setTxDraft]        = useState<TxDraft>(emptyTxDraft());
  const [txSaving,       setTxSaving]       = useState(false);
  const [editingTxId,    setEditingTxId]    = useState<string | null>(null);
  const [editTxDraft,    setEditTxDraft]    = useState<TxDraft>(emptyTxDraft());
  const [editTxSaving,   setEditTxSaving]   = useState(false);
  const [editingPrice,   setEditingPrice]   = useState(false);
  const [priceDraft,     setPriceDraft]     = useState("");
  // Quick status-change dropdown
  const [statusDropId,   setStatusDropId]   = useState<string | null>(null);
  // Quick payment-method dropdown
  const [methodDropId,   setMethodDropId]   = useState<string | null>(null);
  // Past-date confirmation modal
  const [dateConfirm,    setDateConfirm]    = useState<{ tx: Transaction; newStatus: PaymentStatus } | null>(null);

  // ── Collapsible sections ──────────────────────────────────────────────────
  const [openSections, setOpenSections] = useState<Set<string>>(
    new Set(["summary", "finance", "files"])
  );
  function toggleSection(id: string) {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Close any open dropdown on outside click
  useEffect(() => {
    if (!statusDropId && !methodDropId) return;
    const close = () => { setStatusDropId(null); setMethodDropId(null); };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [statusDropId, methodDropId]);

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

  // ── Delivery handlers ──────────────────────────────────────────────────────
  const handleCreateDelivery = async () => {
    if (!project) return;
    setDeliveryCreating(true);
    setDeliveryError(null);
    try {
      const res = await fetch("/api/delivery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId:   project.id,
          artist:      project.artist,
          projectName: project.name,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "שגיאה ביצירת מסירה");
      setDelivery({ ...d, files: [] });
    } catch (err) {
      setDeliveryError(err instanceof Error ? err.message : "שגיאה");
      setTimeout(() => setDeliveryError(null), 5000);
    } finally {
      setDeliveryCreating(false);
    }
  };

  const handleDeliveryDeleteFolder = async () => {
    if (!project) return;
    setDeliveryDeleting(true);
    setDeliveryError(null);
    try {
      const res = await fetch(`/api/delivery?projectId=${project.id}`, { method: "DELETE" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "שגיאה במחיקה");
      setDelivery({ folderPath: "", deliveryLink: "", deliveryStatus: "not_created", deliveredAt: null, files: [] });
      setDeliveryConfirmDelete(false);
    } catch (err) {
      setDeliveryError(err instanceof Error ? err.message : "שגיאה");
      setTimeout(() => setDeliveryError(null), 5000);
    } finally {
      setDeliveryDeleting(false);
    }
  };

  const handleDeliveryMarkDelivered = async () => {
    if (!project || !delivery) return;
    const today = new Date().toISOString().split("T")[0];
    const res = await fetch("/api/delivery", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id, deliveryStatus: "delivered", deliveredAt: today }),
    });
    if (res.ok) {
      setDelivery({ ...delivery, deliveryStatus: "delivered", deliveredAt: today });
    }
  };

  const handleDeliveryUploadFiles = async (files: FileList | File[]) => {
    if (!project || !delivery) return;
    setDeliveryUploading(true);
    setDeliveryError(null);
    const arr = Array.from(files);
    try {
      const results: DeliveryFile[] = [];
      for (const file of arr) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("projectId", project.id);
        const res = await fetch("/api/delivery/upload", { method: "POST", body: fd });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || `שגיאה בהעלאת ${file.name}`);
        results.push(d.file as DeliveryFile);
      }
      // Refresh file list from server
      fetchDelivery();
    } catch (err) {
      setDeliveryError(err instanceof Error ? err.message : "שגיאה בהעלאה");
      setTimeout(() => setDeliveryError(null), 6000);
    } finally {
      setDeliveryUploading(false);
    }
  };

  const handleDeliveryDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDeliveryDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleDeliveryUploadFiles(e.dataTransfer.files);
    }
  };

  const handleDeliveryCopyLink = () => {
    if (!delivery?.deliveryLink) return;
    navigator.clipboard.writeText(delivery.deliveryLink).then(() => {
      setDeliveryCopied(true);
      setTimeout(() => setDeliveryCopied(false), 2000);
    }).catch(() => {});
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

  // ── Local auto-mark helper ─────────────────────────────────────────────────
  // Marks sessions that have passed as "התקיים" — optimistic update + background PATCH
  function localAutoMark(list: Session[]): Session[] {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const clientNow =
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
      `T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    const toMark = list.filter((s) => {
      if (s.status !== "מתוכנן") return false;
      if (!s.date || !s.end_time) return false;
      const sessionEnd = `${s.date}T${s.end_time}:00`;
      return sessionEnd < clientNow;
    });

    if (toMark.length === 0) return list;

    // Fire PATCH requests in the background (non-blocking)
    toMark.forEach((s) => {
      fetch(`/api/sessions/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "התקיים" }),
      }).catch(() => {});
    });

    // Return updated list immediately (optimistic)
    return list.map((s) =>
      toMark.some((m) => m.id === s.id) ? { ...s, status: "התקיים" as SessionStatus } : s
    );
  }

  // ── Fetch sessions ─────────────────────────────────────────────────────────
  const fetchSessions = (withSync = false) => {
    setSessionsLoaded(false);
    fetch(`/api/sessions?projectId=${projectId}`)
      .then((r) => r.json())
      .then((d) => {
        // Auto-mark passed sessions immediately (optimistic + background PATCH)
        const marked = localAutoMark(d.sessions ?? []);
        setSessions(marked);
        setSessionLimit(d.limit ?? 3);
        setSessionsLoaded(true);

        // Auto-fill startDate from earliest session if not yet set
        const proj = projects.find((p) => p.id === projectId);
        if (!proj?.startDate && marked.length > 0) {
          const earliest = marked
            .filter((s) => s.date)
            .map((s) => s.date!)
            .sort()[0];
          if (earliest) {
            fetch(`/api/projects/${projectId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ startDate: earliest }),
            }).then(() => refresh()).catch(() => {});
          }
        }

        // After loading, run calendar sync in background to remove deleted events
        if (withSync) {
          fetch(`/api/sessions/sync?projectId=${projectId}`)
            .then((r) => r.json())
            .then((s) => {
              if (s.deleted > 0) {
                // Some sessions were removed — reload the list
                fetch(`/api/sessions?projectId=${projectId}`)
                  .then((r) => r.json())
                  .then((d2) => setSessions(localAutoMark(d2.sessions ?? [])));
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
        setFinanceException(d.financeException ?? false);
        setFinanceExceptionReason(d.financeExceptionReason ?? "");
        setFinLoaded(true);
      })
      .catch(() => setFinLoaded(true));
  }, [projectId]);

  // ── Delivery state ─────────────────────────────────────────────────────────
  interface DeliveryFile { name: string; path: string; }
  interface DeliveryState {
    folderPath:     string;
    deliveryLink:   string;
    deliveryStatus: "not_created" | "ready" | "delivered";
    deliveredAt:    string | null;
    files:          DeliveryFile[];
  }
  const [delivery,         setDelivery]         = useState<DeliveryState | null>(null);
  const [deliveryLoading,  setDeliveryLoading]  = useState(false);
  const [deliveryCreating, setDeliveryCreating] = useState(false);
  const [deliveryDeleting, setDeliveryDeleting] = useState(false);
  const [deliveryConfirmDelete, setDeliveryConfirmDelete] = useState(false);
  const [deliveryError,    setDeliveryError]    = useState<string | null>(null);
  const [deliveryUploading,setDeliveryUploading]= useState(false);
  const [deliveryDragOver, setDeliveryDragOver] = useState(false);
  const [deliveryCopied,   setDeliveryCopied]   = useState(false);

  const fetchDelivery = () => {
    setDeliveryLoading(true);
    fetch(`/api/delivery?projectId=${projectId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.delivery) setDelivery(d.delivery as DeliveryState);
      })
      .catch(() => {})
      .finally(() => setDeliveryLoading(false));
  };

  useEffect(() => {
    setDelivery(null);
    fetchDelivery();
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
          type:            txDraft.type,
          date:            txDraft.date || null,
          description:     txDraft.description,
          artist:          txDraft.artist,
          amount:          Number(txDraft.amount) || 0,
          currency:        txDraft.currency,
          paymentStatus:   txDraft.paymentStatus,
          paymentMethod:   txDraft.paymentMethod,
          notes:           txDraft.notes,
          category:        txDraft.category,
          linkedSessionId: txDraft.linkedSessionId || "",
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
          type:            editTxDraft.type,
          date:            editTxDraft.date || null,
          description:     editTxDraft.description,
          amount:          Number(editTxDraft.amount) || 0,
          currency:        editTxDraft.currency,
          paymentStatus:   editTxDraft.paymentStatus,
          paymentMethod:   editTxDraft.paymentMethod,
          notes:           editTxDraft.notes,
          category:        editTxDraft.category,
          linkedSessionId: editTxDraft.linkedSessionId || "",
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
      type:            tx.type,
      date:            tx.date ?? "",
      description:     tx.description,
      artist:          tx.artist,
      amount:          String(tx.amount),
      currency:        tx.currency,
      paymentStatus:   tx.payment_status,
      paymentMethod:   tx.payment_method,
      notes:           tx.notes,
      category:        tx.category,
      linkedSessionId: tx.linked_session_id ?? "",
    });
  }

  // ── Quick status change (income only) ─────────────────────────────────────
  async function handleQuickStatusChange(tx: Transaction, newStatus: PaymentStatus, dateOverride?: string) {
    const patch: Record<string, unknown> = { paymentStatus: newStatus };
    if (dateOverride) patch.date = dateOverride;
    // Optimistic update
    setTransactions((prev) =>
      prev.map((t) =>
        t.id === tx.id
          ? { ...t, payment_status: newStatus, ...(dateOverride ? { date: dateOverride } : {}) }
          : t
      )
    );
    await fetch(`/api/transactions/${tx.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  async function handleQuickMethodChange(tx: Transaction, newMethod: string) {
    setMethodDropId(null);
    if (newMethod === tx.payment_method) return;
    setTransactions((prev) =>
      prev.map((t) => t.id === tx.id ? { ...t, payment_method: newMethod } : t)
    );
    await fetch(`/api/transactions/${tx.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentMethod: newMethod }),
    });
  }

  function onStatusBadgeClick(tx: Transaction, newStatus: PaymentStatus) {
    setStatusDropId(null);
    if (newStatus === tx.payment_status) return;
    const today = new Date().toISOString().split("T")[0];
    // Show past-date warning only when switching to a "received" status with a past date
    if (PAID_STATUSES.has(newStatus) && tx.date && tx.date < today) {
      setDateConfirm({ tx, newStatus });
      return;
    }
    handleQuickStatusChange(tx, newStatus);
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
  const totalPaid   = incomeList.filter((t) => PAID_STATUSES.has(t.payment_status)).reduce((s, t) => s + t.amount, 0);
  const totalExp    = expenseList.reduce((s, t) => s + t.amount, 0);
  const balance     = agreedPrice - totalPaid;
  const profit      = totalPaid - totalExp;

  // ── Files ─────────────────────────────────────────────────────────────────
  const allFiles = [...project.files].reverse(); // newest first

  // ── Next session ──────────────────────────────────────────────────────────
  const todayStr = new Date().toISOString().split("T")[0];
  const nextSession = sessions
    .filter((s) => s.status === "מתוכנן" && s.date && s.date >= todayStr)
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))[0] ?? null;

  // ── What's missing ────────────────────────────────────────────────────────
  const missingItems: string[] = [];
  if (!project.startDate) missingItems.push("אין תאריך התחלה");
  if (!project.deadline && project.status !== "הושלם") missingItems.push("אין דדליין");
  if (!project.notes) missingItems.push("אין הערות");
  if (project.files.length === 0) missingItems.push("אין קבצים");
  if (finLoaded && balance > 0) missingItems.push("יש יתרה פתוחה");
  if (sessionsLoaded && !nextSession && project.status !== "הושלם" && project.status !== "בהשהייה")
    missingItems.push("אין סשן עתידי");

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

          /* ── Form inputs ───────────────────────────────────────────────── */
          .rb-session-input {
            background: #111;
            border: 1px solid #2A2A2A;
            border-radius: 8px;
            color: #E0E0E0;
            font-size: 12px;
            padding: 0 10px;
            outline: none;
            font-family: inherit;
            height: 32px;
            box-sizing: border-box;
            color-scheme: dark;
            transition: border-color 0.15s, box-shadow 0.15s;
          }
          .rb-session-input:focus {
            border-color: #3B82F6;
            box-shadow: 0 0 0 2px rgba(59,130,246,0.12);
          }
          .rb-session-input::placeholder { color: #3A3A3A; }

          /* Custom chevron for selects (RTL: arrow on left = end of field) */
          select.rb-session-input {
            cursor: pointer;
            -webkit-appearance: none;
            appearance: none;
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23555' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
            background-repeat: no-repeat;
            background-position: left 8px center;
            padding-left: 24px;
            padding-right: 10px;
          }
          select.rb-session-input option {
            background: #1A1A1A;
            color: #E0E0E0;
          }

          /* Form card wrapper */
          .rb-form-card {
            background: #161616;
            border: 1px solid #222;
            border-radius: 11px;
            padding: 12px 14px;
            display: flex;
            flex-direction: column;
            gap: 9px;
          }

          /* Primary / secondary / danger buttons inside forms */
          .rb-btn-primary {
            flex: 1; padding: 7px 0; border-radius: 8px; border: none;
            background: #3B82F6; color: #fff; font-size: 12px; font-weight: 600;
            cursor: pointer; font-family: inherit; transition: opacity 0.15s;
          }
          .rb-btn-primary:hover:not(:disabled) { opacity: 0.88; }
          .rb-btn-primary:disabled { opacity: 0.45; cursor: wait; }
          .rb-btn-secondary {
            padding: 7px 16px; border-radius: 8px;
            border: 1px solid #2A2A2A; background: transparent;
            color: #666; font-size: 12px; font-weight: 500;
            cursor: pointer; font-family: inherit; transition: border-color 0.15s, color 0.15s;
          }
          .rb-btn-secondary:hover { border-color: #3A3A3A; color: #AAA; }
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

          {/* ── Quick actions ──────────────────────────────────────────────── */}
          <div style={{ display: "flex", gap: 7, marginBottom: 10 }}>
            <button
              onClick={() => { setOpenSections((s) => { const n = new Set(s); n.add("sessions"); return n; }); setAddingSession(true); setAddDraft(emptyDraft()); }}
              style={{ flex: 1, padding: "8px 0", borderRadius: 9, border: "1px solid rgba(59,130,246,0.3)", background: "rgba(59,130,246,0.07)", color: "#60A5FA", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "rgba(59,130,246,0.15)")}
              onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "rgba(59,130,246,0.07)")}
            >📅 קבע סשן</button>
            <button
              onClick={() => { setOpenSections((s) => { const n = new Set(s); n.add("finance"); return n; }); setAddingTx("income"); setTxDraft({ ...emptyTxDraft(), type: "income" }); }}
              style={{ flex: 1, padding: "8px 0", borderRadius: 9, border: "1px solid rgba(16,185,129,0.3)", background: "rgba(16,185,129,0.07)", color: "#34D399", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "rgba(16,185,129,0.15)")}
              onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "rgba(16,185,129,0.07)")}
            >₪ הוסף תשלום</button>
            <div style={{ flex: 1, display: "flex" }}>
              <UploadButton projectId={project.id} projectName={project.name} artist={project.artist} existingFiles={project.files} size="sm" />
            </div>
          </div>

          {/* ── תקציר פרויקט ──────────────────────────────────────────────── */}
          <CollapsibleCard label="תקציר פרויקט" open={openSections.has("summary")} onToggle={() => toggleSection("summary")}>
            <Row label="שם פרויקט">
              <InlineCellEdit value={project.name} onSave={(v) => updateProjectField(project.id, "name", v)} type="text">
                <span style={{ fontSize: 15, fontWeight: 700, color: "#E8E8E8" }}>{project.name}</span>
              </InlineCellEdit>
            </Row>
            <Divider />
            <Row label="אמן">
              <ArtistCellEdit value={project.artist} artists={artists} onSave={(v) => updateProjectField(project.id, "artist", v)} />
            </Row>
            <Divider />
            <Row label="סטטוס">
              <StatusDropdown projectId={project.id} status={project.status} small />
            </Row>
            <Divider />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Row label="תאריך התחלה">
                <InlineCellEdit value={project.startDate || ""} onSave={(v) => updateProjectField(project.id, "startDate", v)} type="date">
                  <span style={{ fontSize: 12, color: "#888" }}>
                    {project.startDate
                      ? new Date(project.startDate + "T00:00:00").toLocaleDateString("he-IL", { day: "numeric", month: "short", year: "2-digit" })
                      : <span style={{ color: "#444" }}>—</span>}
                  </span>
                </InlineCellEdit>
              </Row>
              <Row label="דדליין">
                <InlineCellEdit value={project.deadline || ""} onSave={(v) => updateProjectField(project.id, "deadline", v)} type="date">
                  <span style={{ fontSize: 12, color: deadlineColor }}>{deadlineLabel(project.deadline)}</span>
                </InlineCellEdit>
              </Row>
            </div>
            {project.status === "הושלם" && (
              <>
                <Divider />
                <Row label="תאריך סיום">
                  <span style={{ fontSize: 12, color: project.endDate ? "#6EE7B7" : "#444" }}>
                    {project.endDate
                      ? new Date(project.endDate + "T00:00:00").toLocaleDateString("he-IL", { day: "numeric", month: "long", year: "numeric" })
                      : "—"}
                  </span>
                </Row>
              </>
            )}
            <Divider />
            <Row label="משך פרויקט">
              {(() => {
                if (!project.startDate) return <span style={{ fontSize: 12, color: "#444" }}>—</span>;
                const start = new Date(project.startDate + "T00:00:00").getTime();
                const end   = project.endDate ? new Date(project.endDate + "T00:00:00").getTime() : Date.now();
                const diffDays = Math.max(0, Math.round((end - start) / 86400000));
                return <span style={{ fontSize: 12, color: "#888" }}>{diffDays} ימים{!project.endDate ? " עד עכשיו" : ""}</span>;
              })()}
            </Row>
            <Divider />
            <Row label="סוג">
              <InlineCellEdit value={project.projectType} onSave={(v) => updateProjectField(project.id, "projectType", v)} type="select" options={[{ value: "", label: "ללא" }, ...PROJECT_TYPES.map((t) => ({ value: t, label: t }))]}>
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
          </CollapsibleCard>

          {/* ── מה חסר ────────────────────────────────────────────────────── */}
          {missingItems.length > 0 && (
            <div style={{ background: "#181818", border: "1px solid #2A2A2A", borderRadius: 12, padding: "10px 14px", marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#555", marginBottom: 7, letterSpacing: "0.05em" }}>מה חסר בפרויקט</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {missingItems.map((item) => (
                  <div key={item} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span style={{ fontSize: 10, color: "#F59E0B" }}>⚠</span>
                    <span style={{ fontSize: 11, color: "#777" }}>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── סשנים ────────────────────────────────────────────────────── */}
          <CollapsibleCard
            label="סשנים"
            badge={`${done}/${sessionLimit}${nextSession && !openSections.has("sessions") ? ` · הבא: ${fmtDate(nextSession.date)}` : ""}`}
            open={openSections.has("sessions")}
            onToggle={() => toggleSection("sessions")}
          >
            {/* Header row */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#888" }}>מעקב סשנים</span>
              <button
                onClick={() => { setAddingSession(true); setAddDraft(emptyDraft()); }}
                style={{ fontSize: 11, color: "#3B82F6", background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.25)", borderRadius: 8, padding: "3px 10px", cursor: "pointer" }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "rgba(59,130,246,0.16)")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "rgba(59,130,246,0.08)")}
              >+ הוסף סשן</button>
            </div>

            {/* Next session highlight */}
            {nextSession ? (
              <div style={{ background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.18)", borderRadius: 10, padding: "10px 12px", marginBottom: 12 }}>
                <div style={{ fontSize: 10, color: "#3B82F6", fontWeight: 700, marginBottom: 4 }}>סשן הבא</div>
                <div style={{ fontSize: 13, color: "#CCC", fontWeight: 600 }}>
                  {fmtDate(nextSession.date)}
                  {nextSession.start_time && (
                    <span style={{ fontSize: 12, color: "#888", fontWeight: 400, marginRight: 8 }}>
                      {nextSession.start_time}{nextSession.end_time ? `–${nextSession.end_time}` : ""}
                    </span>
                  )}
                </div>
              </div>
            ) : sessionsLoaded && project.status !== "הושלם" && (
              <div style={{ fontSize: 11, color: "#444", marginBottom: 12 }}>אין סשן עתידי</div>
            )}

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
          </CollapsibleCard>

          {/* ── כספים ───────────────────────────────────────────────────── */}
          <CollapsibleCard
            label="כספים"
            badge={transactions.length > 0 ? String(transactions.length) : undefined}
            open={openSections.has("finance")}
            onToggle={() => toggleSection("finance")}
          >

            {/* Finance exception banner */}
            {financeException && (
              <div style={{
                display: "flex", alignItems: "flex-start", gap: 8,
                padding: "8px 10px", borderRadius: 8, marginBottom: 14,
                background: "rgba(245,158,11,0.07)",
                border: "1px solid rgba(245,158,11,0.25)",
              }}>
                <span style={{ fontSize: 13, flexShrink: 0 }}>⚠️</span>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#F59E0B" }}>
                    חריג כספי — עבר למיקס עם יתרה פתוחה
                  </div>
                  {financeExceptionReason && (
                    <div style={{ fontSize: 10, color: "#777", marginTop: 2 }}>
                      סיבה: {financeExceptionReason}
                    </div>
                  )}
                </div>
              </div>
            )}

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
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, color: "#666" }}>{label}</span>
                  {label === "יתרה לתשלום" && balance > 0 && (
                    <button
                      onClick={() => {
                        setAddingTx("income");
                        setTxDraft({
                          ...emptyTxDraft(),
                          type: "income",
                          amount: String(balance),
                          description: "סגירת יתרה",
                          paymentStatus: "שולם",
                          currency: finCurrency,
                        });
                      }}
                      style={{
                        padding: "2px 7px", borderRadius: 5,
                        border: "1px solid rgba(239,68,68,0.35)",
                        background: "rgba(239,68,68,0.08)",
                        color: "#EF4444", fontSize: 10, fontWeight: 600,
                        cursor: "pointer", fontFamily: "inherit", lineHeight: 1.4,
                      }}
                      onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "rgba(239,68,68,0.18)")}
                      onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "rgba(239,68,68,0.08)")}
                    >
                      קבל יתרה
                    </button>
                  )}
                </div>
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
                  balanceHint={balance > 0 ? balance : undefined}
                  balanceCurrency={finCurrency}
                  sessions={sessions}
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
                            <DrawerTxForm draft={editTxDraft} setDraft={setEditTxDraft} saving={editTxSaving} onSave={handleUpdateTx} onCancel={() => setEditingTxId(null)} sessions={sessions} />
                          ) : (
                            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", borderRadius: 7, background: "rgba(16,185,129,0.04)", border: "1px solid rgba(16,185,129,0.1)" }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                  <span style={{ fontSize: 10, color: "#666" }}>{tx.date ? tx.date.split("-").reverse().join(".") : "—"}</span>
                                  <span style={{ fontSize: 11, color: "#CCC", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 110 }}>{tx.description || "—"}</span>
                                  {/* Clickable status badge */}
                                  <div style={{ position: "relative" }}>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setMethodDropId(null); setStatusDropId(statusDropId === tx.id ? null : tx.id); }}
                                      style={{ fontSize: 9, fontWeight: 700, color: PMT_COLOR[tx.payment_status] ?? "#888", background: `${PMT_COLOR[tx.payment_status] ?? "#888"}18`, border: `1px solid ${PMT_COLOR[tx.payment_status] ?? "#888"}30`, borderRadius: 4, padding: "1px 5px", cursor: "pointer", fontFamily: "inherit" }}
                                    >
                                      {tx.payment_status} ▾
                                    </button>
                                    {statusDropId === tx.id && (
                                      <div
                                        style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 9999, background: "#1C1C1C", border: "1px solid #333", borderRadius: 8, padding: "4px", minWidth: 100, boxShadow: "0 6px 20px rgba(0,0,0,0.5)" }}
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        {PMT_STATUS_OPTS.map((s) => (
                                          <button
                                            key={s}
                                            onClick={() => onStatusBadgeClick(tx, s)}
                                            style={{ display: "block", width: "100%", textAlign: "right", padding: "5px 8px", borderRadius: 6, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: s === tx.payment_status ? 700 : 500, background: s === tx.payment_status ? `${PMT_COLOR[s] ?? "#888"}22` : "transparent", color: s === tx.payment_status ? (PMT_COLOR[s] ?? "#888") : "#CCC" }}
                                            onMouseEnter={(e) => { if (s !== tx.payment_status) (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.06)"; }}
                                            onMouseLeave={(e) => { if (s !== tx.payment_status) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
                                          >
                                            {s}
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                  {/* Clickable payment method chip */}
                                  <div style={{ position: "relative" }}>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setStatusDropId(null); setMethodDropId(methodDropId === tx.id ? null : tx.id); }}
                                      style={{ fontSize: 9, fontWeight: 600, color: tx.payment_method ? "#AAA" : "#555", background: "rgba(255,255,255,0.04)", border: "1px solid #2A2A2A", borderRadius: 4, padding: "1px 5px", cursor: "pointer", fontFamily: "inherit" }}
                                    >
                                      {tx.payment_method || "אמצעי ▾"} {tx.payment_method ? "▾" : ""}
                                    </button>
                                    {methodDropId === tx.id && (
                                      <div
                                        style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 9999, background: "#1C1C1C", border: "1px solid #333", borderRadius: 8, padding: "4px", minWidth: 110, boxShadow: "0 6px 20px rgba(0,0,0,0.5)" }}
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        {PMT_METHOD_OPTS.map((m) => (
                                          <button
                                            key={m}
                                            onClick={() => handleQuickMethodChange(tx, m)}
                                            style={{ display: "block", width: "100%", textAlign: "right", padding: "5px 8px", borderRadius: 6, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: m === tx.payment_method ? 700 : 500, background: m === tx.payment_method ? "rgba(255,255,255,0.08)" : "transparent", color: m === tx.payment_method ? "#E0E0E0" : "#AAA" }}
                                            onMouseEnter={(e) => { if (m !== tx.payment_method) (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.06)"; }}
                                            onMouseLeave={(e) => { if (m !== tx.payment_method) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
                                          >
                                            {m}
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                  {/* Receipt ref */}
                                  {tx.receipt_ref && (
                                    <span style={{ fontSize: 9, color: "#555", background: "rgba(255,255,255,0.03)", border: "1px solid #222", borderRadius: 4, padding: "1px 5px" }} title="אסמכתא">#{tx.receipt_ref}</span>
                                  )}
                                  {/* Linked session tag — "התקבל בסשן" or "צפוי בסשן" */}
                                  {tx.linked_session_id && (() => {
                                    const linked = sessions.find((s) => s.id === tx.linked_session_id);
                                    if (!linked) return null;
                                    const isPaid = PAID_STATUSES.has(tx.payment_status);
                                    const dateShort = linked.date ? linked.date.slice(5).split("-").reverse().join(".") : "—";
                                    const color  = isPaid ? "#A78BFA" : "#3B82F6";
                                    const bg     = isPaid ? "rgba(167,139,250,0.1)" : "rgba(59,130,246,0.1)";
                                    const border = isPaid ? "rgba(167,139,250,0.25)" : "rgba(59,130,246,0.25)";
                                    const icon   = isPaid ? "🎵" : "⏳";
                                    const label  = isPaid ? "התקבל" : "צפוי";
                                    return (
                                      <span
                                        title={`${label} בסשן ${linked.date ? fmtDate(linked.date) : ""}`}
                                        style={{ fontSize: 9, color, background: bg, border: `1px solid ${border}`, borderRadius: 4, padding: "1px 5px", display: "flex", alignItems: "center", gap: 3 }}
                                      >
                                        {icon} {dateShort}
                                      </span>
                                    );
                                  })()}
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
                            <DrawerTxForm draft={editTxDraft} setDraft={setEditTxDraft} saving={editTxSaving} onSave={handleUpdateTx} onCancel={() => setEditingTxId(null)} sessions={sessions} />
                          ) : (
                            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", borderRadius: 7, background: "rgba(245,158,11,0.04)", border: "1px solid rgba(245,158,11,0.1)" }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                  <span style={{ fontSize: 10, color: "#666" }}>{tx.date ? tx.date.split("-").reverse().join(".") : "—"}</span>
                                  {tx.category && <span style={{ fontSize: 9, color: "#888", background: "rgba(255,255,255,0.05)", borderRadius: 4, padding: "1px 5px" }}>{tx.category}</span>}
                                  <span style={{ fontSize: 11, color: "#CCC", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 100 }}>{tx.description || "—"}</span>
                                  {/* Clickable payment method chip (expenses) */}
                                  <div style={{ position: "relative" }}>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setStatusDropId(null); setMethodDropId(methodDropId === `exp-${tx.id}` ? null : `exp-${tx.id}`); }}
                                      style={{ fontSize: 9, fontWeight: 600, color: tx.payment_method ? "#AAA" : "#555", background: "rgba(255,255,255,0.04)", border: "1px solid #2A2A2A", borderRadius: 4, padding: "1px 5px", cursor: "pointer", fontFamily: "inherit" }}
                                    >
                                      {tx.payment_method || "אמצעי ▾"} {tx.payment_method ? "▾" : ""}
                                    </button>
                                    {methodDropId === `exp-${tx.id}` && (
                                      <div
                                        style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 9999, background: "#1C1C1C", border: "1px solid #333", borderRadius: 8, padding: "4px", minWidth: 110, boxShadow: "0 6px 20px rgba(0,0,0,0.5)" }}
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        {PMT_METHOD_OPTS.map((m) => (
                                          <button
                                            key={m}
                                            onClick={() => handleQuickMethodChange(tx, m)}
                                            style={{ display: "block", width: "100%", textAlign: "right", padding: "5px 8px", borderRadius: 6, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: m === tx.payment_method ? 700 : 500, background: m === tx.payment_method ? "rgba(255,255,255,0.08)" : "transparent", color: m === tx.payment_method ? "#E0E0E0" : "#AAA" }}
                                            onMouseEnter={(e) => { if (m !== tx.payment_method) (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.06)"; }}
                                            onMouseLeave={(e) => { if (m !== tx.payment_method) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
                                          >
                                            {m}
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                  {tx.receipt_ref && (
                                    <span style={{ fontSize: 9, color: "#555", background: "rgba(255,255,255,0.03)", border: "1px solid #222", borderRadius: 4, padding: "1px 5px" }} title="אסמכתא">#{tx.receipt_ref}</span>
                                  )}
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
          </CollapsibleCard>

          {/* ── קבצים ────────────────────────────────────────────────────── */}
          <CollapsibleCard
            label="קבצים"
            badge={project.files.length > 0 ? String(project.files.length) : undefined}
            open={openSections.has("files")}
            onToggle={() => toggleSection("files")}
          >
            {/* Upload button */}
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
              <UploadButton projectId={project.id} projectName={project.name} artist={project.artist} existingFiles={project.files} size="sm" />
            </div>

            {/* Delivery folder — prominent if exists */}
            {delivery && delivery.deliveryStatus !== "not_created" && (
              <div style={{ background: "rgba(168,85,247,0.06)", border: "1px solid rgba(168,85,247,0.2)", borderRadius: 10, padding: "10px 12px", marginBottom: 12 }}>
                <div style={{ fontSize: 10, color: "#C084FC", fontWeight: 700, marginBottom: 8 }}>תיקיית מסירה ללקוח</div>
                <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                  <button onClick={handleDeliveryCopyLink}
                    style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: "inherit", border: deliveryCopied ? "1px solid rgba(16,185,129,0.4)" : "1px solid rgba(168,85,247,0.3)", background: deliveryCopied ? "rgba(16,185,129,0.1)" : "rgba(168,85,247,0.08)", color: deliveryCopied ? "#10B981" : "#C084FC", transition: "all 0.15s" }}
                  >{deliveryCopied ? "✓ הועתק" : "📋 העתק לינק ללקוח"}</button>
                  {delivery.deliveryLink && (
                    <a href={delivery.deliveryLink} target="_blank" rel="noopener noreferrer"
                      style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 8, fontSize: 11, fontWeight: 600, textDecoration: "none", border: "1px solid #2A2A2A", background: "#1E1E1E", color: "#777" }}>
                      ↗ פתח בדרופבוקס
                    </a>
                  )}
                </div>
                {delivery.deliveryStatus === "delivered" && delivery.deliveredAt && (
                  <div style={{ fontSize: 10, color: "#10B981", marginTop: 6 }}>נמסר ב-{delivery.deliveredAt.split("-").reverse().join(".")}</div>
                )}
              </div>
            )}

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

                  {/* Copy share link */}
                  {latestAudio.dropboxPath && (
                    <CopyLinkButton
                      shareUrl={latestAudio.dropboxShareUrl}
                      dropboxPath={latestAudio.dropboxPath}
                      projectId={project.id}
                      size="sm"
                      onShareUrlUpdate={() => {
                        refresh();
                      }}
                    />
                  )}

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
                            <CopyLinkButton
                              shareUrl={f.dropboxShareUrl}
                              dropboxPath={f.dropboxPath}
                              projectId={project.id}
                              size="sm"
                            />
                          )}
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
            {project.files.length === 0 && <div style={{ fontSize: 11, color: "#444" }}>אין קבצים</div>}
          </CollapsibleCard>

          {/* ── פעולות ───────────────────────────────────────────────────── */}
          <CollapsibleCard label="פעולות" open={openSections.has("actions")} onToggle={() => toggleSection("actions")}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>

              {/* Create delivery folder */}
              {(!delivery || delivery.deliveryStatus === "not_created") && (
                deliveryLoading ? (
                  <div style={{ fontSize: 11, color: "#444" }}>טוען...</div>
                ) : (
                  <button onClick={handleCreateDelivery} disabled={deliveryCreating}
                    style={{ width: "100%", padding: "9px 0", borderRadius: 10, border: "1px solid rgba(168,85,247,0.3)", background: "rgba(168,85,247,0.08)", color: "#C084FC", cursor: deliveryCreating ? "wait" : "pointer", fontSize: 12, fontWeight: 600, fontFamily: "inherit", opacity: deliveryCreating ? 0.6 : 1 }}>
                    {deliveryCreating ? "יוצר תיקייה..." : "+ צור תיקיית מסירה ללקוח"}
                  </button>
                )
              )}

              {/* Delivery created — upload + mark delivered */}
              {delivery && delivery.deliveryStatus !== "not_created" && !deliveryConfirmDelete && (
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDeliveryDragOver(true); }}
                    onDragLeave={() => setDeliveryDragOver(false)}
                    onDrop={handleDeliveryDrop}
                    onClick={() => { const inp = document.createElement("input"); inp.type = "file"; inp.multiple = true; inp.onchange = () => { if (inp.files) handleDeliveryUploadFiles(inp.files); }; inp.click(); }}
                    style={{ border: `1.5px dashed ${deliveryDragOver ? "#A855F7" : "#2A2A2A"}`, borderRadius: 10, padding: "12px 10px", textAlign: "center", background: deliveryDragOver ? "rgba(168,85,247,0.06)" : "transparent", transition: "all 0.15s", cursor: "pointer" }}
                  >
                    {deliveryUploading ? <span style={{ fontSize: 12, color: "#A855F7" }}>מעלה...</span> : <span style={{ fontSize: 11, color: "#555" }}>☁ העלה קבצי מסירה</span>}
                  </div>
                  {delivery.files.length > 0 && delivery.files.map((f) => (
                    <div key={f.path} style={{ display: "flex", gap: 6, padding: "3px 0", borderBottom: "1px solid #1E1E1E" }}>
                      <span style={{ fontSize: 10, color: "#555" }}>♪</span>
                      <span style={{ flex: 1, fontSize: 11, color: "#C0C0C0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                    </div>
                  ))}
                  {delivery.deliveryStatus === "ready" && (
                    <button onClick={handleDeliveryMarkDelivered}
                      style={{ width: "100%", padding: "8px 0", borderRadius: 9, border: "1px solid rgba(16,185,129,0.3)", background: "rgba(16,185,129,0.07)", color: "#10B981", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "inherit" }}>
                      ✓ סמן כנמסר ללקוח
                    </button>
                  )}
                  <button onClick={() => setDeliveryConfirmDelete(true)}
                    style={{ width: "100%", padding: "7px 0", borderRadius: 8, border: "1px solid #2A2A2A", background: "transparent", color: "#555", cursor: "pointer", fontSize: 11, fontFamily: "inherit" }}>
                    🗑 מחק תיקיית מסירה
                  </button>
                </div>
              )}

              {/* Delete confirm */}
              {deliveryConfirmDelete && (
                <div>
                  <div style={{ fontSize: 12, color: "#EF4444", marginBottom: 8, lineHeight: 1.6 }}>
                    למחוק תיקיית מסירה מדרופבוקס?<br /><span style={{ color: "#666", fontSize: 11 }}>כל הקבצים ב-05_Delivery יימחקו לצמיתות.</span>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={handleDeliveryDeleteFolder} disabled={deliveryDeleting}
                      style={{ flex: 1, padding: "8px 0", borderRadius: 8, border: "1px solid rgba(239,68,68,0.35)", background: "rgba(239,68,68,0.1)", color: "#EF4444", cursor: deliveryDeleting ? "wait" : "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit", opacity: deliveryDeleting ? 0.6 : 1 }}>
                      {deliveryDeleting ? "מוחק..." : "מחק"}
                    </button>
                    <button onClick={() => setDeliveryConfirmDelete(false)}
                      style={{ flex: 1, padding: "8px 0", borderRadius: 8, border: "1px solid #2A2A2A", background: "transparent", color: "#666", cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>ביטול</button>
                  </div>
                </div>
              )}

              {deliveryError && <div style={{ fontSize: 11, color: "#EF4444", background: "#2A1010", border: "1px solid #5A1A1A", borderRadius: 6, padding: "4px 10px" }}>{deliveryError}</div>}

              <div style={{ height: 1, background: "#252525" }} />
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <ActionMenu projectId={project.id} projectName={project.name} artist={project.artist} onSessionCreated={fetchSessions} />
                <HideButton project={project} onDone={() => { refresh(); onClose(); }} />
              </div>
            </div>
          </CollapsibleCard>

          {/* ── Victor section ──────────────────────────────────────────── */}
          <VictorSection project={project} />

        </div>

      {/* ── Past-date confirmation modal ──────────────────────────────── */}
      {dateConfirm && (() => {
        const { tx, newStatus } = dateConfirm;
        const displayDate = tx.date ? tx.date.split("-").reverse().join(".") : "";
        const todayStr = new Date().toISOString().split("T")[0];
        return (
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 999999, display: "flex", alignItems: "center", justifyContent: "center" }}
            onClick={() => setDateConfirm(null)}>
            <div style={{ background: "#1C1C1C", border: "1px solid #333", borderRadius: 14, padding: "20px 22px", maxWidth: 320, width: "90%", boxShadow: "0 12px 40px rgba(0,0,0,0.6)" }}
              onClick={(e) => e.stopPropagation()}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#E0E0E0", marginBottom: 8 }}>⚠️ תאריך עבר</div>
              <div style={{ fontSize: 12, color: "#999", lineHeight: 1.6, marginBottom: 16 }}>
                התשלום מסומן כ<strong style={{ color: "#E0E0E0" }}>{newStatus}</strong> אבל תאריכו הוא{" "}
                <strong style={{ color: "#F59E0B" }}>{displayDate}</strong>.<br />
                האם זה באמת התאריך שהכסף התקבל?
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                <button
                  onClick={() => { handleQuickStatusChange(tx, newStatus); setDateConfirm(null); }}
                  style={{ padding: "8px 0", borderRadius: 8, border: "1px solid rgba(16,185,129,0.3)", background: "rgba(16,185,129,0.08)", color: "#10B981", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                >כן, אשר — שמור על {displayDate}</button>
                <button
                  onClick={() => { handleQuickStatusChange(tx, newStatus, todayStr); setDateConfirm(null); }}
                  style={{ padding: "8px 0", borderRadius: 8, border: "1px solid rgba(59,130,246,0.3)", background: "rgba(59,130,246,0.08)", color: "#3B82F6", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                >שנה לתאריך היום</button>
                <button
                  onClick={() => setDateConfirm(null)}
                  style={{ padding: "8px 0", borderRadius: 8, border: "1px solid #2A2A2A", background: "transparent", color: "#666", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
                >ביטול</button>
              </div>
            </div>
          </div>
        );
      })()}

      </div>
    </div>,
    document.body
  );
}

// ── Inline transaction form (add / edit) ─────────────────────────────────────
function DrawerTxForm({
  draft, setDraft, saving, onSave, onCancel, balanceHint, balanceCurrency, sessions,
}: {
  draft: TxDraft;
  setDraft: (d: TxDraft) => void;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
  balanceHint?: number;
  balanceCurrency?: string;
  sessions?: Session[];
}) {
  const isIncome   = draft.type === "income";
  const isCash     = draft.paymentMethod === "מזומן";
  const isReceived = draft.paymentStatus === "התקבל";
  const isExpected = draft.paymentStatus === "צפוי";

  const todayStr = new Date().toISOString().split("T")[0];

  // Sessions that already took place — for "התקבל" (any method)
  const completedSessions = (sessions ?? []).filter(
    (s) => s.status === "התקיים" && s.date
  ).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

  // Future planned sessions — for "צפוי" + מזומן only
  const futureSessions = (sessions ?? []).filter(
    (s) => s.status === "מתוכנן" && s.date && s.date >= todayStr
  ).sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  return (
    <div className="rb-form-card" style={{ marginBottom: 10 }}>
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
          className="rb-session-input" style={{ width: 120 }} />
        <input type="text" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          placeholder="תיאור" className="rb-session-input" style={{ flex: 1 }} />
      </div>

      {/* Amount + Currency + Status/Category */}
      <div style={{ display: "flex", gap: 6 }}>
        <div style={{ flex: 1, display: "flex", gap: 4, alignItems: "center" }}>
          <input type="number" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
            placeholder="סכום" min={0} className="rb-session-input" style={{ flex: 1 }} />
          {isIncome && balanceHint && balanceHint > 0 && (
            <button
              type="button"
              onClick={() => setDraft({ ...draft, amount: String(balanceHint), currency: balanceCurrency ?? draft.currency })}
              style={{
                padding: "3px 7px", borderRadius: 5, whiteSpace: "nowrap",
                border: "1px solid rgba(239,68,68,0.35)",
                background: "rgba(239,68,68,0.08)",
                color: "#EF4444", fontSize: 10, fontWeight: 600,
                cursor: "pointer", fontFamily: "inherit", lineHeight: 1.4,
              }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "rgba(239,68,68,0.18)")}
              onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "rgba(239,68,68,0.08)")}
            >
              יתרה {balanceHint.toLocaleString()}{balanceCurrency}
            </button>
          )}
        </div>
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

      {/* Payment method */}
      <select value={draft.paymentMethod} onChange={(e) => setDraft({ ...draft, paymentMethod: e.target.value })}
        className="rb-session-input" style={{ width: "100%", boxSizing: "border-box" }}>
        <option value="">אמצעי תשלום (אופציונלי)</option>
        {PMT_METHOD_OPTS.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>

      {/* Session link — shown when status = "התקבל" and there are completed sessions */}
      {isIncome && isReceived && completedSessions.length > 0 && (
        <div style={{
          borderRadius: 8,
          border: isCash ? "1px solid rgba(167,139,250,0.35)" : "1px solid #2A2A2A",
          background: isCash ? "rgba(167,139,250,0.07)" : "transparent",
          padding: isCash ? "8px 10px" : "0",
          display: "flex", flexDirection: "column", gap: 6,
        }}>
          {isCash && (
            <div style={{ fontSize: 10, color: "#A78BFA", fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
              🎵 מזומן — בדרך כלל מתקבל פיזית בסשן
            </div>
          )}
          <select
            value={draft.linkedSessionId}
            onChange={(e) => {
              const sid = e.target.value;
              const sess = completedSessions.find((s) => s.id === sid);
              setDraft({
                ...draft,
                linkedSessionId: sid,
                // auto-fill date from session (user can override)
                date: sid && sess?.date ? sess.date : draft.date,
              });
            }}
            className="rb-session-input"
            style={{ width: "100%", boxSizing: "border-box" }}
          >
            <option value="">🎵 התקבל בסשן — בחר סשן (אופציונלי)</option>
            {completedSessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.date ? fmtDate(s.date) : "—"}
                {s.start_time ? ` • ${s.start_time}` : ""}
                {s.end_time ? `–${s.end_time}` : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* No completed sessions message — only if status = "התקבל" and sessions exist but none completed */}
      {isIncome && isReceived && completedSessions.length === 0 && (sessions ?? []).length > 0 && (
        <div style={{ fontSize: 10, color: "#444", padding: "4px 2px" }}>
          אין סשנים שהתקיימו בפרויקט זה עדיין
        </div>
      )}

      {/* Future session link — shown when status = "צפוי" AND method = "מזומן" */}
      {isIncome && isExpected && isCash && futureSessions.length > 0 && (
        <div style={{
          borderRadius: 8,
          border: "1px solid rgba(59,130,246,0.35)",
          background: "rgba(59,130,246,0.07)",
          padding: "8px 10px",
          display: "flex", flexDirection: "column", gap: 6,
        }}>
          <div style={{ fontSize: 10, color: "#3B82F6", fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
            ⏳ מזומן — בחר סשן עתידי שבו צפוי להתקבל התשלום
          </div>
          <select
            value={draft.linkedSessionId}
            onChange={(e) => {
              const sid = e.target.value;
              const sess = futureSessions.find((s) => s.id === sid);
              setDraft({
                ...draft,
                linkedSessionId: sid,
                date: sid && sess?.date ? sess.date : draft.date,
              });
            }}
            className="rb-session-input"
            style={{ width: "100%", boxSizing: "border-box" }}
          >
            <option value="">⏳ צפוי להתקבל בסשן — בחר סשן (אופציונלי)</option>
            {futureSessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.date ? fmtDate(s.date) : "—"}
                {s.start_time ? ` • ${s.start_time}` : ""}
                {s.end_time ? `–${s.end_time}` : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Notes */}
      <input type="text" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
        placeholder="הערות (אופציונלי)" className="rb-session-input" style={{ width: "100%", boxSizing: "border-box" }}
        onKeyDown={(e) => { if (e.key === "Enter") onSave(); if (e.key === "Escape") onCancel(); }} />

      {/* Buttons */}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onSave} disabled={saving} className="rb-btn-primary">
          {saving ? "שומר..." : "שמור"}
        </button>
        <button onClick={onCancel} className="rb-btn-secondary">ביטול</button>
      </div>
    </div>
  );
}

// ── Hide / unhide button with toast ──────────────────────────────────────────
function HideButton({ project, onDone }: { project: { id: string; name: string; isHidden: boolean }; onDone: () => void }) {
  const [saving,  setSaving]  = useState(false);
  const [toast,   setToast]   = useState<{ msg: string; undo: () => void } | null>(null);
  const undoTimer = useState<ReturnType<typeof setTimeout> | null>(null);

  const toggle = async (hide: boolean) => {
    if (saving) return;
    setSaving(true);
    try {
      await fetch(`/api/projects/${project.id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ isHidden: hide }),
      });

      // Show toast with undo
      if (undoTimer[0]) clearTimeout(undoTimer[0]);
      const msg = hide ? "הפרויקט הוסתר מהתצוגה" : "הפרויקט הוחזר לתצוגה";
      const undoFn = async () => {
        setToast(null);
        await fetch(`/api/projects/${project.id}`, {
          method:  "PATCH",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ isHidden: !hide }),
        });
        document.dispatchEvent(new Event("rb-hidden-changed"));
        onDone();
      };
      setToast({ msg, undo: undoFn });
      undoTimer[0] = setTimeout(() => {
        setToast(null);
        document.dispatchEvent(new Event("rb-hidden-changed"));
        onDone();
      }, 4000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        onClick={() => toggle(!project.isHidden)}
        disabled={saving}
        style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          padding: "5px 10px", borderRadius: 8, cursor: saving ? "wait" : "pointer",
          fontFamily: "inherit", fontSize: 11, fontWeight: 600,
          border: project.isHidden
            ? "1px solid rgba(59,130,246,0.35)"
            : "1px solid #2A2A2A",
          background: project.isHidden
            ? "rgba(59,130,246,0.08)"
            : "transparent",
          color: project.isHidden ? "#60A5FA" : "#555",
          opacity: saving ? 0.5 : 1,
          transition: "all 0.15s",
        }}
      >
        {project.isHidden ? "👁 החזר לתצוגה" : "🚫 הסתר מהתצוגה"}
      </button>

      {/* Toast */}
      {toast && typeof document !== "undefined" && createPortal(
        <div style={{
          position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)",
          zIndex: 999999, display: "flex", alignItems: "center", gap: 12,
          background: "#1C1C1C", border: "1px solid #333",
          borderRadius: 12, padding: "10px 18px",
          boxShadow: "0 8px 32px rgba(0,0,0,0.7)",
          fontSize: 13, color: "#D0D0D0", fontFamily: "inherit",
          whiteSpace: "nowrap",
        }}>
          <span>{toast.msg}</span>
          <button
            onClick={toast.undo}
            style={{
              background: "none", border: "none",
              color: "#A855F7", fontWeight: 700, cursor: "pointer",
              fontSize: 12, fontFamily: "inherit", padding: 0,
            }}
          >
            בטל
          </button>
        </div>,
        document.body
      )}
    </>
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
    <div className="rb-form-card">
      {/* Date row */}
      <input
        type="date"
        value={draft.date}
        onChange={(e) => setDraft({ ...draft, date: e.target.value })}
        className="rb-session-input"
        style={{ width: "100%", boxSizing: "border-box" }}
      />

      {/* Time slots row (custom selects — no ugly browser scroll wheel) */}
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <select
          value={draft.startTime}
          onChange={(e) => setDraft({ ...draft, startTime: e.target.value })}
          className="rb-session-input"
          style={{ flex: 1 }}
        >
          <option value="">שעת התחלה</option>
          {TIME_SLOTS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <span style={{ color: "#444", fontSize: 13, flexShrink: 0 }}>—</span>
        <select
          value={draft.endTime}
          onChange={(e) => setDraft({ ...draft, endTime: e.target.value })}
          className="rb-session-input"
          style={{ flex: 1 }}
        >
          <option value="">שעת סיום</option>
          {TIME_SLOTS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {/* Type + Status row */}
      <div style={{ display: "flex", gap: 6 }}>
        <select
          value={draft.sessionType}
          onChange={(e) => setDraft({ ...draft, sessionType: e.target.value as SessionType })}
          className="rb-session-input"
          style={{ flex: 1 }}
        >
          {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select
          value={draft.status}
          onChange={(e) => setDraft({ ...draft, status: e.target.value as SessionStatus })}
          className="rb-session-input"
          style={{ flex: 1 }}
        >
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
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
        <button onClick={onSave} disabled={saving} className="rb-btn-primary">
          {saving ? "שומר..." : "שמור"}
        </button>
        <button onClick={onCancel} className="rb-btn-secondary">ביטול</button>
      </div>
    </div>
  );
}

// ── Victor Section (self-contained, lazy-loaded) ──────────────────────────────

import type { VendorWork, VictorStatus, VictorWorkState, VictorOutcome } from "@/lib/types";
import { VICTOR_STATUSES, VICTOR_WORK_STATES, VICTOR_OUTCOMES } from "@/lib/types";
import { useRef, useCallback } from "react";

function vsColor(s: VictorStatus): string {
  return s === "פעיל" ? "#A855F7" : s === "הושלם" ? "#10B981" : "#555";
}
function wsColor(s: VictorWorkState | null): string {
  if (!s) return "#444";
  const m: Record<VictorWorkState, string> = { "נשלח לויקטור": "#3B82F6", "חזר מויקטור": "#2DD4BF", "דורש בדיקה": "#F59E0B", "דורש תיקון": "#EF4444", "מחכה לקבצים": "#F59E0B", "לא רלוונטי": "#444" };
  return m[s] ?? "#444";
}
function ocColor(o: VictorOutcome | null): string {
  if (!o) return "#444";
  const m: Record<VictorOutcome, string> = { "אושר": "#10B981", "נכנס לפרויקט בפועל": "#2DD4BF", "חלקית": "#F59E0B", "לא נכנס לפרויקט": "#555", "נדחה": "#EF4444" };
  return m[o] ?? "#444";
}

function VictorSection({ project }: { project: { id: string; name: string; artist: string } }) {
  const [open, setOpen]           = useState(false);
  const [work, setWork]           = useState<VendorWork | null | undefined>(undefined);
  const [loading, setLoading]     = useState(false);
  const [creating, setCreating]   = useState(false);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [copied, setCopied]       = useState(false);
  const [uploading, setUploading] = useState(false);
  const uploadRef                 = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (work !== undefined) return;
    setLoading(true);
    try {
      const res  = await fetch(`/api/vendor/victor/work?projectId=${project.id}`);
      const data = await res.json() as { ok: boolean; work: VendorWork | null };
      setWork(data.ok ? data.work : null);
    } catch {
      setWork(null);
    } finally {
      setLoading(false);
    }
  }, [project.id, work]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const handleSend = async () => {
    setCreating(true);
    setError(null);
    try {
      const folderRes = await fetch("/api/dropbox/vendor-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorName: "Victor", artistName: project.artist || project.name, projectName: project.name }),
      });
      const folderData = await folderRes.json() as { ok: boolean; folderPath?: string; shareLink?: string };

      const workRes = await fetch("/api/vendor/victor/work", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId:        project.id,
          status:           "פעיל",
          workState:        "נשלח לויקטור",
          sentDate:         new Date().toISOString().split("T")[0],
          dropboxFolder:    folderData.ok ? folderData.folderPath : null,
          dropboxShareLink: folderData.ok ? folderData.shareLink  : null,
        }),
      });
      const workData = await workRes.json() as { ok: boolean; work: VendorWork };
      if (!workData.ok) throw new Error("יצירת רשומה נכשלה");
      setWork(workData.work);
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה");
    } finally {
      setCreating(false);
    }
  };

  const patch = async (fields: Record<string, unknown>) => {
    if (!work) return;
    setSaving(true);
    try {
      await fetch(`/api/vendor/victor/work/${work.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      setWork((prev) => prev ? { ...prev, ...fields } as VendorWork : prev);
    } finally {
      setSaving(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !work) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file",          file);
      fd.append("workId",        work.id);
      fd.append("dropboxFolder", work.dropboxFolder ?? "Victor");
      fd.append("subFolder",     "01_From_Redbloods");
      const res  = await fetch("/api/dropbox/vendor-upload", { method: "POST", body: fd });
      const data = await res.json() as { ok: boolean; file: VendorWork["filesSent"][0] };
      if (data.ok) setWork((prev) => prev ? { ...prev, filesSent: [...prev.filesSent, data.file] } : prev);
    } finally {
      setUploading(false);
      if (uploadRef.current) uploadRef.current.value = "";
    }
  };

  const copyLink = async () => {
    if (!work?.dropboxShareLink) return;
    await navigator.clipboard.writeText(work.dropboxShareLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ background: "#1C1C1C", border: "1px solid #252525", borderRadius: 14, marginBottom: 10, overflow: "hidden" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", background: "none", border: "none", cursor: "pointer", textAlign: "right", fontFamily: "inherit" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#A855F7" }}>🎛 שליחה לויקטור</span>
          {work && (
            <>
              <span style={{ fontSize: 10, color: vsColor(work.status), background: `${vsColor(work.status)}18`, border: `1px solid ${vsColor(work.status)}33`, borderRadius: 5, padding: "1px 7px" }}>
                {work.status}
              </span>
              {work.workState && (
                <span style={{ fontSize: 10, color: wsColor(work.workState), background: `${wsColor(work.workState)}12`, border: `1px solid ${wsColor(work.workState)}30`, borderRadius: 5, padding: "1px 7px" }}>
                  {work.workState}
                </span>
              )}
            </>
          )}
        </div>
        <span style={{ fontSize: 13, color: "#444", display: "inline-block", transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s", lineHeight: 1 }}>▾</span>
      </button>

      {open && (
        <div style={{ padding: "0 16px 14px" }}>
          <div style={{ height: 1, background: "#252525", marginBottom: 14 }} />

          {loading ? (
            <div style={{ fontSize: 12, color: "#555" }}>טוען...</div>
          ) : work === null ? (
            <>
              <div style={{ fontSize: 12, color: "#555", marginBottom: 12 }}>הפרויקט טרם נשלח לויקטור. לחץ ליצירת תיקיית Dropbox ורשומת מעקב.</div>
              {error && <div style={{ fontSize: 11, color: "#EF4444", marginBottom: 8 }}>{error}</div>}
              <button onClick={handleSend} disabled={creating}
                style={{ width: "100%", padding: "9px 0", borderRadius: 10, fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: creating ? "wait" : "pointer", background: "rgba(168,85,247,0.15)", border: "1px solid rgba(168,85,247,0.35)", color: "#A855F7", opacity: creating ? 0.7 : 1 }}>
                {creating ? "יוצר תיקייה..." : "📤 שלח לויקטור"}
              </button>
            </>
          ) : work ? (
            <>
              {/* Status row: סטטוס ראשי + מצב עבודה */}
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>סטטוס ראשי</div>
                  <select value={work.status} onChange={(e) => patch({ status: e.target.value as VictorStatus })}
                    style={{ width: "100%", background: "#0D0D0D", border: "1px solid #3A3A3A", borderRadius: 6, color: vsColor(work.status), fontSize: 12, padding: "5px 8px", fontFamily: "inherit" }}>
                    {VICTOR_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>מצב עבודה</div>
                  <select value={work.workState ?? ""} onChange={(e) => patch({ workState: (e.target.value as VictorWorkState) || null })}
                    style={{ width: "100%", background: "#0D0D0D", border: "1px solid #3A3A3A", borderRadius: 6, color: wsColor(work.workState), fontSize: 12, padding: "5px 8px", fontFamily: "inherit" }}>
                    <option value="">—</option>
                    {VICTOR_WORK_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              {/* Outcome */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>תוצאה</div>
                <select value={work.outcome ?? ""} onChange={(e) => patch({ outcome: (e.target.value as VictorOutcome) || null })}
                  style={{ width: "100%", background: "#0D0D0D", border: "1px solid #3A3A3A", borderRadius: 6, color: ocColor(work.outcome), fontSize: 12, padding: "5px 8px", fontFamily: "inherit" }}>
                  <option value="">—</option>
                  {VICTOR_OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>

              {/* Dates */}
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>תאריך שליחה</div>
                  <div style={{ fontSize: 12, color: "#888" }}>{work.sentDate ? work.sentDate.split("-").reverse().join(".") : "—"}</div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>דדליין פנימי</div>
                  <input type="date" value={work.internalDeadline ?? ""} onChange={(e) => patch({ internalDeadline: e.target.value || null })}
                    style={{ width: "100%", background: "#0D0D0D", border: "1px solid #3A3A3A", borderRadius: 6, color: "#D0D0D0", fontSize: 12, padding: "4px 6px", fontFamily: "inherit" }} />
                </div>
              </div>

              {/* Dropbox links */}
              {work.dropboxFolder && (
                <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
                  <button onClick={copyLink}
                    style={{ flex: 1, padding: "6px 8px", borderRadius: 8, fontFamily: "inherit", fontSize: 11, cursor: "pointer", background: "#1A1A1A", border: "1px solid #2A2A2A", color: copied ? "#10B981" : "#888" }}>
                    {copied ? "✓ הועתק" : "📋 העתק לינק"}
                  </button>
                  {work.dropboxShareLink && (
                    <a href={work.dropboxShareLink} target="_blank" rel="noopener noreferrer"
                      style={{ flex: 1, padding: "6px 8px", borderRadius: 8, fontSize: 11, textDecoration: "none", textAlign: "center", background: "#1A1A1A", border: "1px solid #2A2A2A", color: "#3B82F6" }}>
                      ↗ פתח בדרופבוקס
                    </a>
                  )}
                </div>
              )}

              {/* File upload */}
              <div style={{ marginBottom: 10 }}>
                <input ref={uploadRef} type="file" style={{ display: "none" }} onChange={handleFileUpload} />
                <button onClick={() => uploadRef.current?.click()} disabled={uploading || !work.dropboxFolder}
                  style={{ width: "100%", padding: "7px 0", borderRadius: 8, fontFamily: "inherit", fontSize: 12, cursor: (uploading || !work.dropboxFolder) ? "default" : "pointer", background: "#1A1A1A", border: "1px solid #2A2A2A", color: "#888", opacity: work.dropboxFolder ? 1 : 0.5 }}>
                  {uploading ? "מעלה..." : "⬆ העלה קובץ → 01_From_Redbloods"}
                </button>
                {work.filesSent.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    {work.filesSent.map((f, i) => <div key={i} style={{ fontSize: 11, color: "#555", padding: "2px 0" }}>📎 {f.name}</div>)}
                  </div>
                )}
              </div>

              {/* Notes */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>הערות לויקטור</div>
                <textarea value={work.notes}
                  onChange={(e) => setWork((prev) => prev ? { ...prev, notes: e.target.value } : prev)}
                  onBlur={() => patch({ notes: work.notes })}
                  rows={2}
                  style={{ width: "100%", background: "#0D0D0D", border: "1px solid #3A3A3A", borderRadius: 6, color: "#D0D0D0", fontSize: 12, padding: "6px 8px", fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }} />
              </div>

              {saving && <div style={{ fontSize: 11, color: "#555", marginTop: 8 }}>שומר...</div>}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

