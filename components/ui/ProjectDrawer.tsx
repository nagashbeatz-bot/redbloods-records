"use client";

import { useEffect, useState, type ReactNode, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useProjects } from "@/components/ProjectsProvider";
import { usePlayerSafe, getLatestAudioFile, getFreshPlayUrl } from "@/components/PlayerProvider";
import { PROJECT_TYPES } from "@/lib/types";
import { deadlineLabel, daysUntilDeadline } from "@/lib/utils";
import { checkHealth, checkFinanceHealth, type FinanceSummary } from "@/lib/health";
import StatusDropdown from "@/components/ui/StatusDropdown";
import InlineCellEdit from "@/components/ui/InlineCellEdit";
import ArtistCellEdit from "@/components/ui/ArtistCellEdit";
import NotesCellEdit from "@/components/ui/NotesCellEdit";
import UploadButton from "@/components/ui/UploadButton";
import CopyLinkButton from "@/components/ui/CopyLinkButton";
import ActionMenu from "@/components/project/ActionMenu";
import DatePickerInput from "@/components/ui/DatePickerInput";
import AlbumCenterModal from "@/components/album/AlbumCenterModal";

// ── Types ─────────────────────────────────────────────────────────────────────
type SessionStatus  = "מתוכנן" | "התקיים" | "בוטל" | "נדחה" | "לא הגיע";
type SessionType    = "סשן" | "ניקוי מיקס" | "חזרה" | "צילום קליפ";
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
  expense_scope: string;
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
  expenseScope: string;
}

type ClipItemStatus = "תכנון בלבד" | "הועבר לכספים" | "שולם" | "בוטל";

interface ClipItem {
  id: string;
  project_id: string;
  category: string;
  description: string;
  amount: number;
  currency: string;
  status: ClipItemStatus;
  linked_transaction_id: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

interface ClipItemDraft {
  category: string;
  description: string;
  amount: string;
  currency: string;
  notes: string;
}

function emptyClipItemDraft(): ClipItemDraft {
  return { category: "", description: "", amount: "", currency: "₪", notes: "" };
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
  photographer?: string;
  location?: string;
}

interface Draft {
  date: string;
  startTime: string;
  endTime: string;
  status: SessionStatus;
  sessionType: SessionType;
  notes: string;
}

interface FilmingDayDraft {
  date: string;
  startTime: string;
  endTime: string;
  photographer: string;
  location: string;
  cost: string;
  currency: string;
  status: SessionStatus;
  addToCalendar: boolean;
  createExpense: boolean;
}

function emptyFilmingDraft(): FilmingDayDraft {
  return {
    date: "", startTime: "", endTime: "",
    photographer: "", location: "",
    cost: "", currency: "₪",
    status: "מתוכנן",
    addToCalendar: true,
    createExpense: true,
  };
}

// ── Constants ─────────────────────────────────────────────────────────────────
const STATUS_OPTIONS:   SessionStatus[]   = ["מתוכנן", "התקיים", "בוטל", "נדחה", "לא הגיע"];
const TYPE_OPTIONS:     SessionType[]     = ["סשן", "ניקוי מיקס", "חזרה", "צילום קליפ"];
// Cycling types for session row badge — excludes "צילום קליפ" (those live in ClipSection)
const CYCLE_TYPES:      SessionType[]     = ["סשן", "ניקוי מיקס", "חזרה"];
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
const EXPENSE_SCOPES    = ["כללי", "קליפ", "מיקס / מאסטר", "שיווק", "סשן", "נסיעות", "ציוד", "אחר"];
const PROJECT_TABS = ["סקירה", "כספים", "סשנים", "קליפ", "קבצים", "פעולות"];

const CLIP_EXPENSE_CATS = [
  "צילום קליפ", "עריכת קליפ", "ציוד צילום", "תאורה", "לוקיישן",
  "דוגמניות / משתתפים", "איפור / סטיילינג", "הסעות", "אוכל / הפקה", "אביזרים", "אחר",
];

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
  return { type: "income", date: "", description: "", artist: "", amount: "", currency: "₪", paymentStatus: "צפוי", paymentMethod: "", notes: "", category: "", linkedSessionId: "", expenseScope: "כללי" };
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

// ── ProjectNextActionBlock ────────────────────────────────────────────────────
// Mai Operational Layer — read-only, pure, no mutations, no fetch.
// Uses checkHealth + checkFinanceHealth from lib/health.ts.

interface TxLike { type: string; payment_status: string; amount: number; date: string | null; }

function ProjectNextActionBlock({ project, transactions, agreedPrice, currency }: {
  project: { id: string; name: string; artist: string; status: string; deadline: string | null; isOverdue: boolean; parentProject: string; projectType?: string };
  transactions: TxLike[];
  agreedPrice: number;
  currency: string;
}) {
  const today = new Date().toISOString().split("T")[0];

  const PAID_S    = new Set(["שולם", "התקבל"]);
  const EXPECT_S  = new Set(["צפוי", "חלקי"]);

  const totalPaid     = transactions.filter((t) => t.type === "income" && PAID_S.has(t.payment_status)).reduce((s, t) => s + t.amount, 0);
  const totalExpected = transactions.filter((t) => t.type === "income" && EXPECT_S.has(t.payment_status)).reduce((s, t) => s + t.amount, 0);
  const totalExpenses = transactions.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const overduePayment = transactions.some((t) => t.type === "income" && EXPECT_S.has(t.payment_status) && t.date && t.date < today);

  const summary: FinanceSummary = {
    projectId:    project.id,
    agreedPrice,
    currency,
    totalPaid,
    totalExpected,
    totalExpenses,
    overduePayment,
  };

  // Cast project to compatible shape (checkHealth uses subset of Project fields)
  const projectForCheck = {
    id:            project.id,
    name:          project.name,
    artist:        project.artist,
    status:        project.status,
    deadline:      project.deadline,
    isOverdue:     project.isOverdue,
    parentProject: project.parentProject,
    projectType:   project.projectType ?? "",
    // unused fields — health checks only read the above
    files: [] as string[],
    notes: "",
    updatedAt: "",
    startDate:  null,
    endDate:    null,
    isDueSoon:  false,
    isHidden:   false,
  } as unknown as Parameters<typeof checkHealth>[0][0];

  const healthIssues  = checkHealth([projectForCheck]);
  const financeIssues = checkFinanceHealth([projectForCheck], [summary]);
  const allIssues     = [...healthIssues, ...financeIssues].slice(0, 2); // top 2

  if (allIssues.length === 0) return null;

  const SEV_COLOR: Record<string, string> = { high: "#EF4444", medium: "#F59E0B" };
  const SEV_BG: Record<string, string>    = { high: "rgba(239,68,68,0.06)", medium: "rgba(245,158,11,0.06)" };
  const SEV_BORDER: Record<string, string> = { high: "rgba(239,68,68,0.2)", medium: "rgba(245,158,11,0.18)" };

  return (
    <div style={{
      background: SEV_BG[allIssues[0].priority],
      border: `1px solid ${SEV_BORDER[allIssues[0].priority]}`,
      borderRadius: 10, padding: "10px 12px", marginBottom: 10,
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#555", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>
        הפעולה הבאה
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {allIssues.map((issue) => (
          <div key={issue.type} style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
            <span style={{ fontSize: 11, color: SEV_COLOR[issue.priority], flexShrink: 0, marginTop: 1 }}>
              {issue.priority === "high" ? "●" : "◦"}
            </span>
            <span style={{ fontSize: 12, color: "#CCC", lineHeight: 1.5 }}>
              {issue.label.replace(`"${project.name}" — `, "")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
export default function ProjectDrawer({ projectId, artists, onClose }: Props) {
  const { projects, updateProjectField, refresh } = useProjects();
  const player = usePlayerSafe();

  // ── Mobile detection ───────────────────────────────────────────────────────
  const [isMobile, setIsMobile] = useState(false);
  const [albumCenterOpen, setAlbumCenterOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("סקירה");
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // ── Clip items (planning) state ───────────────────────────────────────────
  const [clipItems,        setClipItems]        = useState<ClipItem[]>([]);
  const [clipItemsLoaded,  setClipItemsLoaded]  = useState(false);
  const [addingClipItem,   setAddingClipItem]   = useState(false);
  const [clipItemDraft,    setClipItemDraft]    = useState<ClipItemDraft>(emptyClipItemDraft());
  const [clipItemSaving,   setClipItemSaving]   = useState(false);
  const [promotingId,      setPromotingId]      = useState<string | null>(null);
  const [promotingDate,    setPromotingDate]    = useState<string>("");

  // ── Filming day state ─────────────────────────────────────────────────────
  const [addingFilmingDay, setAddingFilmingDay] = useState(false);
  const [filmingDraft,     setFilmingDraft]     = useState<FilmingDayDraft>(emptyFilmingDraft());
  const [filmingSaving,    setFilmingSaving]    = useState(false);

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
    new Set(["summary", "finance", "sessions", "clip", "files", "actions"])
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

  // ── Fetch clip items ───────────────────────────────────────────────────────
  useEffect(() => {
    setClipItemsLoaded(false);
    setClipItems([]);
    fetch(`/api/clip-items?projectId=${projectId}`)
      .then((r) => r.json())
      .then((d) => { setClipItems(d.clipItems ?? []); setClipItemsLoaded(true); })
      .catch(() => setClipItemsLoaded(true));
  }, [projectId]);

  // ── Auto-open sections after data loads ───────────────────────────────────
  useEffect(() => {
    if (!finLoaded) return;
    const hasFinancialContent = financeException || transactions.length > 0;
    if (hasFinancialContent) setOpenSections((prev) => new Set([...prev, "finance"]));
  }, [finLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!clipItemsLoaded) return;
    const hasClipContent =
      project?.projectType === "קליפ" ||
      clipItems.length > 0 ||
      filmingSessions.length > 0;
    if (hasClipContent) setOpenSections((prev) => new Set([...prev, "clip"]));
  }, [clipItemsLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // ── Project Actions state ──────────────────────────────────────────────────
  interface ProjectAction {
    id: string;
    project_id: string;
    action_type: string;
    content_type: string | null;
    version_label: string | null;
    recipient_role: string | null;
    recipient_name: string | null;
    recipient_phone: string | null;
    dropbox_url: string | null;
    status: string;
    action_date: string;
    followup_date: string | null;
    linked_task_id: string | null;
    notes: string | null;
    created_at: string;
  }
  interface ActionDraft {
    actionType: string;
    contentType: string;
    versionLabel: string;
    recipientRole: string;
    recipientName: string;
    recipientClientId: string;
    recipientPhone: string;
    dropboxUrl: string;
    status: string;
    actionDate: string;
    followupDate: string;
    notes: string;
    createFollowupTask: boolean;
  }
  interface ActionClient { id: string; name: string; phone: string; }
  function emptyActionDraft(): ActionDraft {
    return {
      actionType: "sent", contentType: "", versionLabel: "",
      recipientRole: "client", recipientName: "", recipientClientId: "", recipientPhone: "",
      dropboxUrl: "", status: "pending_feedback",
      actionDate: new Date().toISOString().slice(0, 10),
      followupDate: "", notes: "",
      createFollowupTask: false,
    };
  }

  const [projectActions,   setProjectActions]   = useState<ProjectAction[]>([]);
  const [actionsLoading,   setActionsLoading]   = useState(false);
  const [showActionForm,   setShowActionForm]    = useState(false);
  const [actionDraft,      setActionDraft]       = useState<ActionDraft>(emptyActionDraft());
  const [actionSaving,     setActionSaving]      = useState(false);
  const [actionError,      setActionError]       = useState<string | null>(null);
  const [actionTaskWarn,   setActionTaskWarn]    = useState<string | null>(null);
  const [actionClients,    setActionClients]     = useState<ActionClient[]>([]);
  const [actionClientsLoaded, setActionClientsLoaded] = useState(false);
  const [expandedActions,  setExpandedActions]  = useState<Set<string>>(new Set());
  const [closingActionId,  setClosingActionId]  = useState<string | null>(null);
  const [cancelConfirm,    setCancelConfirm]    = useState<{ id: string; summary: string } | null>(null);
  const [recipientPicker,  setRecipientPicker]  = useState<{
    preset: Partial<ActionDraft>;
    title: string;
    options: { label: string; icon: string; name: string; phone: string }[];
    mode: "picking" | "custom";
    customName: string;
    customPhone: string;
  } | null>(null);
  const [victorFlow, setVictorFlow] = useState<{
    step: "content" | "details" | "saving" | "done";
    contentType: string;
    dropboxUrl: string;
    followupDate: string;
    existingWorkId: string | null;
    saveError: string | null;
  } | null>(null);

  // Load clients once when the modal first opens
  useEffect(() => {
    if (!showActionForm || actionClientsLoaded) return;
    fetch("/api/clients")
      .then((r) => r.json())
      .then((d) => {
        if (d.clients) setActionClients(d.clients as ActionClient[]);
        setActionClientsLoaded(true);
      })
      .catch(() => { setActionClientsLoaded(true); });
  }, [showActionForm]); // eslint-disable-line react-hooks/exhaustive-deps


  // Open the modal with optional preset overrides
  const openActionModal = (preset: Partial<ActionDraft> = {}) => {
    const base = emptyActionDraft();
    // Pre-fill Dropbox URL from delivery folder if available
    if (delivery?.deliveryLink) base.dropboxUrl = delivery.deliveryLink;
    // Pre-fill artist as default recipient
    if (project) {
      base.recipientName      = project.artist;
      base.recipientClientId  = artistClient?.id  ?? "";
      base.recipientPhone     = artistClient?.phone ?? "";
    }
    setActionDraft({ ...base, ...preset });
    setActionError(null);
    setShowActionForm(true);
  };

  const handleQuickAction = (label: string, preset: Partial<ActionDraft>) => {
    if (label === "שלח לאיש סאונד") {
      setRecipientPicker({
        preset,
        title: "בחר איש סאונד",
        options: [
          { label: "Bill",   icon: "🎧", name: "Bill",   phone: "" },
          { label: "Steven", icon: "🎛️", name: "Steven", phone: "" },
        ],
        mode: "picking", customName: "", customPhone: "",
      });
    } else if (label === "שלח למפיק חיצוני") {
      setRecipientPicker({
        preset,
        title: "בחר מפיק חיצוני",
        options: [
          { label: "Victor", icon: "🎵", name: "Victor", phone: "" },
        ],
        mode: "picking", customName: "", customPhone: "",
      });
    } else {
      openActionModal(preset);
    }
  };

  const handleVictorSelect = async () => {
    if (!project) return;
    setRecipientPicker(null);
    const res = await fetch(`/api/vendor/victor/work?projectId=${project.id}`);
    const data = await res.json() as { ok: boolean; work: { id: string } | null };
    setVictorFlow({
      step: "content",
      contentType: "",
      dropboxUrl: "",
      followupDate: "",
      existingWorkId: data.ok && data.work ? data.work.id : null,
      saveError: null,
    });
  };

  const handleVictorSave = async () => {
    if (!victorFlow || !project) return;
    setVictorFlow((prev) => prev ? { ...prev, step: "saving", saveError: null } : null);

    try {
      // 1. Create or update vendor_project_work
      const existingId = victorFlow.existingWorkId;
      if (existingId) {
        const patchRes = await fetch(`/api/vendor/victor/work/${existingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workState: "נשלח לויקטור",
            status: "פעיל",
            sentDate: new Date().toISOString().split("T")[0],
            dropboxShareLink: victorFlow.dropboxUrl || null,
            internalDeadline: victorFlow.followupDate || null,
          }),
        });
        if (!patchRes.ok) throw new Error("שגיאה בעדכון עבודת Victor");
      } else {
        const postRes = await fetch("/api/vendor/victor/work", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: project.id,
            status: "פעיל",
            workState: "נשלח לויקטור",
            sentDate: new Date().toISOString().split("T")[0],
            dropboxShareLink: victorFlow.dropboxUrl || null,
          }),
        });
        const postData = await postRes.json() as { ok: boolean; work?: { id: string } };
        if (!postData.ok) throw new Error("שגיאה ביצירת עבודת Victor");
      }

      // 2. Record in project_actions
      const actionRes = await fetch("/api/project-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          actionType: "sent",
          contentType: victorFlow.contentType || "other",
          recipientRole: "external_producer",
          recipientName: "Victor",
          dropboxUrl: victorFlow.dropboxUrl || null,
          followupDate: victorFlow.followupDate || null,
          status: "pending_version",
          notes: `נשלח לויקטור${victorFlow.contentType ? ` — ${victorFlow.contentType}` : ""}`,
        }),
      });
      const actionData = await actionRes.json() as { ok: boolean; action?: ProjectAction };

      if (actionData.ok && actionData.action) {
        setProjectActions((prev) => [actionData.action!, ...prev]);
      }

      setVictorFlow((prev) => prev ? {
        ...prev,
        step: "done",
        saveError: actionData.ok ? null : "עבודת Victor עודכנה, אבל יומן הפעולות לא נשמר",
      } : null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "שגיאה לא צפויה";
      setVictorFlow((prev) => prev ? { ...prev, step: "details", saveError: msg } : null);
    }
  };

  const ACTION_TYPE_LABELS: Record<string, string> = {
    sent:     "📤 שלחתי",
    received: "📥 קיבלתי",
    notes:    "📝 הערות",
    approved: "✅ אושר",
    followup: "📞 מעקב",
    other:    "⚙️ אחר",
  };
  const CONTENT_TYPE_LABELS: Record<string, string> = {
    mix: "מיקס", master: "מאסטר", production: "הפקה", stems: "סטמס",
    clip: "קליפ", files: "קבצים", references: "רפרנסים", other: "אחר",
  };
  const RECIPIENT_ROLE_LABELS: Record<string, string> = {
    artist: "אמן", client: "לקוח", sound_engineer: "איש סאונד",
    external_producer: "מפיק חיצוני", video_editor: "עורך וידאו",
    photographer: "צלם", other: "אחר",
  };
  const ACTION_STATUS_LABELS: Record<string, string> = {
    sent:             "📤 נשלח",
    pending_feedback: "💬 ממתין לפידבק",
    got_notes:        "📝 התקבלו הערות",
    pending_version:  "⏳ ממתין לגרסה",
    approved:         "✅ אושר",
    closed:           "🔒 סגור",
    cancelled:        "✕ בוטל",
  };
  const ACTION_STATUS_COLOR: Record<string, string> = {
    sent:             "#3B82F6",
    pending_feedback: "#F59E0B",
    got_notes:        "#8B5CF6",
    pending_version:  "#F59E0B",
    approved:         "#10B981",
    closed:           "#6B7280",
    cancelled:        "#EF4444",
  };
  const NEXT_ACTION_LABEL: Record<string, string> = {
    sent:             "לעקוב אחר קבלה",
    pending_feedback: "לחכות לפידבק",
    got_notes:        "להכין גרסה חדשה",
    pending_version:  "לחכות לגרסה",
    approved:         "הפרויקט אושר ✓",
    closed:           "—",
    cancelled:        "—",
  };
  function actionSummary(a: ProjectAction): string {
    const ct   = a.content_type  ? (CONTENT_TYPE_LABELS[a.content_type]    ?? a.content_type)   : "";
    const vl   = a.version_label ? ` ${a.version_label}` : "";
    const name = a.recipient_name ?? (a.recipient_role ? (RECIPIENT_ROLE_LABELS[a.recipient_role] ?? a.recipient_role) : "");
    switch (a.action_type) {
      case "sent":     return `נשלח${ct ? ` ${ct}${vl}` : ""}${name ? ` ל${name}` : ""}`;
      case "received": return `התקבל${ct ? ` ${ct}${vl}` : ""}${name ? ` מ${name}` : ""}`;
      case "notes":    return `התקבלו הערות${name ? ` מ${name}` : ""}`;
      case "approved": return "אושר הפרויקט";
      case "followup": return `מעקב${name ? ` עם ${name}` : ""}`;
      default:         return ACTION_TYPE_LABELS[a.action_type] ?? a.action_type;
    }
  }
  function followupTitle(a: ProjectAction): string {
    const name = a.recipient_name ?? (a.recipient_role ? (RECIPIENT_ROLE_LABELS[a.recipient_role] ?? a.recipient_role) : "") ?? "";
    const ct = a.content_type ? (CONTENT_TYPE_LABELS[a.content_type] ?? "") : "";
    const vl = a.version_label ? ` ${a.version_label}` : "";
    switch (a.status) {
      case "pending_feedback": return `ממתין לפידבק${name ? ` מ${name}` : ""}${ct ? ` על ${ct}${vl}` : ""}`;
      case "got_notes":        return `התקבלו הערות${name ? ` מ${name}` : ""}${ct ? ` על ${ct}${vl}` : ""}`;
      case "pending_version":  return `ממתין לגרסה מתוקנת${name ? ` מ${name}` : ""}`;
      default:                 return `נשלח${name ? ` ל${name}` : ""} - ממתין לעדכון`;
    }
  }
  function priorityChip(status: string): { label: string; color: string } {
    if (["pending_feedback", "got_notes"].includes(status)) return { label: "חשוב",   color: "#EF4444" };
    if (status === "pending_version")                        return { label: "בביצוע", color: "#3B82F6" };
    return { label: "מידע", color: "#6B7280" };
  }

  const fetchProjectActions = () => {
    setActionsLoading(true);
    fetch(`/api/project-actions?projectId=${projectId}`)
      .then((r) => r.json())
      .then((d) => { if (d.actions) setProjectActions(d.actions as ProjectAction[]); })
      .catch(() => {})
      .finally(() => setActionsLoading(false));
  };

  const handleSaveAction = async () => {
    if (!actionDraft.actionType || !project) return;
    setActionSaving(true);
    setActionError(null);
    try {
      // 1. Create the project_action record
      const res = await fetch("/api/project-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, ...actionDraft }),
      });
      const d = await res.json();
      if (d.error) { setActionError(d.error); return; }
      const savedAction = d.action as ProjectAction;

      // 2. Optionally create follow-up task
      let taskFailed = false;
      if (actionDraft.createFollowupTask && actionDraft.followupDate) {
        try {
          const contentLabel = actionDraft.contentType ? CONTENT_TYPE_LABELS[actionDraft.contentType] ?? actionDraft.contentType : "";
          const versionPart  = actionDraft.versionLabel ? ` ${actionDraft.versionLabel}` : "";
          const taskTitle    = `מעקב: ${project.name}${contentLabel ? ` · ${contentLabel}${versionPart}` : ""}`;
          const taskNoteLines = [
            `פרויקט: ${project.name}`,
            actionDraft.recipientName ? `נמען: ${actionDraft.recipientName}` : "",
            contentLabel ? `תוכן: ${contentLabel}${versionPart}` : "",
            actionDraft.dropboxUrl ? `לינק: ${actionDraft.dropboxUrl}` : "",
            actionDraft.notes ? `הערות: ${actionDraft.notes}` : "",
          ].filter(Boolean).join("\n");

          const taskRes = await fetch("/api/tasks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title:        taskTitle,
              notes:        taskNoteLines,
              related_type: "project",
              related_id:   project.id,
              due_date:     actionDraft.followupDate,
            }),
          });
          const taskData = await taskRes.json();
          if (taskData.task?.id) {
            // 3. Link task back to the action
            await fetch(`/api/project-actions/${savedAction.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ linkedTaskId: taskData.task.id }),
            });
            savedAction.linked_task_id = taskData.task.id;
          }
        } catch {
          taskFailed = true;
        }
      }

      setProjectActions((prev) => [savedAction, ...prev]);
      setShowActionForm(false);
      setActionDraft(emptyActionDraft());
      if (taskFailed) {
        setActionTaskWarn("הפעולה נשמרה, אבל יצירת המשימה נכשלה");
        setTimeout(() => setActionTaskWarn(null), 6000);
      }
    } catch { setActionError("שגיאת רשת"); }
    finally { setActionSaving(false); }
  };

  // Build WhatsApp URL from draft fields + project name
  const buildWhatsAppUrl = (phone: string): string => {
    const cleaned = phone.replace(/\D/g, "");
    const intl    = cleaned.startsWith("0") ? "972" + cleaned.slice(1) : cleaned;
    const contentLabel = actionDraft.contentType ? CONTENT_TYPE_LABELS[actionDraft.contentType] ?? actionDraft.contentType : "";
    const versionPart  = actionDraft.versionLabel ? ` ${actionDraft.versionLabel}` : "";
    const lines = [
      `היי${actionDraft.recipientName ? ` ${actionDraft.recipientName}` : ""},`,
      `שלחתי לך${contentLabel ? ` ${contentLabel}${versionPart}` : ""} לפרויקט "${project?.name ?? ""}".`,
      actionDraft.dropboxUrl ? `לינק: ${actionDraft.dropboxUrl}` : "",
    ].filter(Boolean).join("\n");
    return `https://wa.me/${intl}?text=${encodeURIComponent(lines)}`;
  };

  const buildWhatsAppForAction = (a: ProjectAction): string => {
    const phone   = a.recipient_phone ?? "";
    const cleaned = phone.replace(/\D/g, "");
    const intl    = cleaned.startsWith("0") ? "972" + cleaned.slice(1) : cleaned;
    const ct      = a.content_type  ? (CONTENT_TYPE_LABELS[a.content_type]  ?? a.content_type)  : "";
    const vl      = a.version_label ? ` ${a.version_label}` : "";
    const msg     = [`היי${a.recipient_name ? ` ${a.recipient_name}` : ""},`, `מעקב לגבי${ct ? ` ${ct}${vl}` : ""} בפרויקט "${project?.name ?? ""}".`].join("\n");
    return `https://wa.me/${intl}?text=${encodeURIComponent(msg)}`;
  };

  const whatsAppLinkHref = (phone: string, label: string, url: string): string => {
    const cleaned = phone.replace(/\D/g, "");
    const intl    = cleaned.startsWith("0") ? "972" + cleaned.slice(1) : cleaned;
    const msg     = `היי,\nהנה ה-${label} לפרויקט "${project?.name ?? ""}":\n${url}`;
    return `https://wa.me/${intl}?text=${encodeURIComponent(msg)}`;
  };

  const closePendingAction = async (id: string) => {
    setClosingActionId(id);
    try {
      await fetch(`/api/project-actions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "closed" }),
      });
      setProjectActions((prev) => prev.map((a) => (a.id === id ? { ...a, status: "closed" } : a)));
    } finally {
      setClosingActionId(null);
    }
  };
  const cancelAction = async (id: string) => {
    await fetch(`/api/project-actions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "cancelled" }),
    });
    setProjectActions((prev) => prev.map((a) => (a.id === id ? { ...a, status: "cancelled" } : a)));
    setCancelConfirm(null);
  };

  const postponeFollowup = async (id: string, currentDate: string) => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() + 7);
    const newDate = d.toISOString().slice(0, 10);
    await fetch(`/api/project-actions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ followupDate: newDate }),
    });
    setProjectActions((prev) => prev.map((a) => (a.id === id ? { ...a, followup_date: newDate } : a)));
  };

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
    setProjectActions([]);
    fetchProjectActions();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // ── ESC to close ───────────────────────────────────────────────────────────
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  const project = projects.find((p) => p.id === projectId);

  // Find the client whose name matches project.artist
  const artistClient = actionClients.find((c) => project && c.name === project.artist);

  // If project not in context yet (e.g. just created via proposal convert),
  // trigger a refresh and show a loading skeleton instead of crashing.
  useEffect(() => {
    if (!project && projectId) {
      refresh();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  if (typeof document === "undefined") return null;
  if (!project) {
    // Show a slim loading overlay while the context refreshes
    return createPortal(
      <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center" }}
        onClick={onClose}>
        <div style={{ background: "#141414", border: "1px solid #262626", borderRadius: 16, padding: "32px 48px", color: "#555", fontSize: 13 }}>
          טוען פרויקט...
        </div>
      </div>,
      document.body
    );
  }

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

  // ── Clip item CRUD ────────────────────────────────────────────────────────
  async function handleAddClipItem() {
    setClipItemSaving(true);
    try {
      const res = await fetch("/api/clip-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId:   projectId,
          category:    clipItemDraft.category,
          description: clipItemDraft.description,
          amount:      Number(clipItemDraft.amount) || 0,
          currency:    clipItemDraft.currency,
          notes:       clipItemDraft.notes,
        }),
      });
      const data = await res.json();
      if (data.clipItem) {
        setClipItems((prev) => [...prev, data.clipItem]);
        setClipItemDraft(emptyClipItemDraft());
        setAddingClipItem(false);
      }
    } finally {
      setClipItemSaving(false);
    }
  }

  async function handleDeleteClipItem(id: string) {
    setClipItems((prev) => prev.filter((i) => i.id !== id));
    await fetch(`/api/clip-items/${id}`, { method: "DELETE" });
  }

  async function handlePromoteClipItem(id: string, date: string) {
    if (!date) return;
    setPromotingId(id);
    try {
      const res = await fetch(`/api/clip-items/${id}/promote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date }),
      });
      const data = await res.json();
      if (data.error === "already_promoted") return;
      if (data.deleted) {
        setClipItems((prev) => prev.filter((i) => i.id !== id));
      }
      if (data.transaction) {
        setTransactions((prev) => [data.transaction, ...prev]);
      }
      setPromotingId(null);
      setPromotingDate("");
    } finally {
      setPromotingId(null);
    }
  }

  async function handleAddFilmingDay() {
    setFilmingSaving(true);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          date:          filmingDraft.date     || null,
          startTime:     filmingDraft.startTime || null,
          endTime:       filmingDraft.endTime   || null,
          status:        filmingDraft.status,
          sessionType:   "צילום קליפ",
          notes:         filmingDraft.location,
          photographer:  filmingDraft.photographer,
          location:      filmingDraft.location,
          addToCalendar: filmingDraft.addToCalendar,
        }),
      });
      const data = await res.json();
      if (!data.session) return;
      setSessions((prev) => [...prev, data.session]);
      if (data.calendarError) {
        alert(`יום הצילום נשמר ✓\n\nלא נוסף ל-Google Calendar:\n${data.calendarError}\n\nניתן למחוק וליצור מחדש לאחר בדיקת חיבור היומן.`);
      }

      // Create linked expense if requested
      if (filmingDraft.createExpense && Number(filmingDraft.cost) > 0) {
        const desc = filmingDraft.photographer
          ? `${filmingDraft.photographer} — צילום קליפ`
          : "צילום קליפ";
        const txRes = await fetch("/api/transactions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            type:            "expense",
            date:            filmingDraft.date || null,
            description:     desc,
            amount:          Number(filmingDraft.cost),
            currency:        filmingDraft.currency,
            paymentStatus:   "לא שולם",
            category:        "צילום קליפ",
            expenseScope:    "קליפ",
            linkedSessionId: data.session.id,
          }),
        });
        const txData = await txRes.json();
        if (txData.transaction) {
          setTransactions((prev) => [txData.transaction, ...prev]);
        }
      }

      setFilmingDraft(emptyFilmingDraft());
      setAddingFilmingDay(false);
    } finally {
      setFilmingSaving(false);
    }
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
    if (txDraft.type === "expense" && !txDraft.date) {
      alert("תאריך חובה להוצאה");
      return;
    }
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
          expenseScope:    txDraft.type === "expense" ? (txDraft.expenseScope || "כללי") : "כללי",
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
    if (editTxDraft.type === "expense" && !editTxDraft.date) {
      alert("תאריך חובה להוצאה");
      return;
    }
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
          expenseScope:    editTxDraft.type === "expense" ? (editTxDraft.expenseScope || "כללי") : "כללי",
        }),
      });
      const data = await res.json();
      if (data.transaction) {
        setTransactions((prev) => prev.map((t) => t.id === editingTxId ? data.transaction : t));
        // Auto-sync clip item status if transaction marked as paid
        const PAID = new Set(["שולם", "התקבל"]);
        if (PAID.has(data.transaction.payment_status)) {
          setClipItems((prev) => prev.map((ci) =>
            ci.linked_transaction_id === editingTxId ? { ...ci, status: "שולם" as ClipItemStatus } : ci
          ));
        }
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
      expenseScope:    tx.expense_scope ?? "כללי",
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
    // Auto-sync clip item if marked as paid
    const PAID_SET = new Set<PaymentStatus>(["שולם", "התקבל"]);
    if (PAID_SET.has(newStatus)) {
      setClipItems((prev) => prev.map((ci) =>
        ci.linked_transaction_id === tx.id ? { ...ci, status: "שולם" as ClipItemStatus } : ci
      ));
    }
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

  // ── Filming days ─────────────────────────────────────────────────────────
  const filmingSessions = sessions.filter((s) => s.session_type === "צילום קליפ");

  // ── Finance computed ──────────────────────────────────────────────────────
  const incomeList       = transactions.filter((t) => t.type === "income");
  const expenseList      = transactions.filter((t) => t.type === "expense");
  const clipExpenseList  = expenseList.filter((t) => t.expense_scope === "קליפ");
  const nonClipExpenses  = expenseList.filter((t) => t.expense_scope !== "קליפ");
  const totalPaid        = incomeList.filter((t) => PAID_STATUSES.has(t.payment_status)).reduce((s, t) => s + t.amount, 0);
  const totalExp         = expenseList.reduce((s, t) => s + t.amount, 0);
  const totalClipExp     = clipExpenseList.reduce((s, t) => s + t.amount, 0);
  const balance          = agreedPrice - totalPaid;
  const profit           = totalPaid - totalExp;

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

  // ── Accent color ──────────────────────────────────────────────────────────
  const accentColor = project.projectType === "EP" ? "#A855F7"
    : project.projectType === "אלבום" ? "#EC4899"
    : project.projectType === "קליפ" ? "#8B5CF6"
    : "#3B82F6";

  // ── Actions tab computed values ────────────────────────────────────────────
  const QUICK_ACTIONS: { label: string; icon: string; color: string; preset: Partial<ActionDraft> }[] = [
    { label: "שלח לאמן",          icon: "🎤", color: accentColor,
      preset: { actionType: "sent", recipientRole: "artist", recipientName: project.artist, recipientClientId: artistClient?.id ?? "", recipientPhone: artistClient?.phone ?? "", status: "pending_feedback" } },
    { label: "שלח לאיש סאונד",   icon: "🎚️", color: "#3B82F6",
      preset: { actionType: "sent", recipientRole: "sound_engineer", status: "pending_version" } },
    { label: "שלח למפיק חיצוני", icon: "🎛️", color: "#6B7280",
      preset: { actionType: "sent", recipientRole: "external_producer", status: "pending_version" } },
    { label: "התקבלה גרסה",       icon: "📥", color: "#F59E0B",
      preset: { actionType: "received", status: "pending_feedback" } },
    { label: "התקבלו הערות",      icon: "💬", color: "#8B5CF6",
      preset: { actionType: "notes", recipientRole: "artist", recipientName: project.artist, recipientClientId: artistClient?.id ?? "", recipientPhone: artistClient?.phone ?? "", status: "got_notes" } },
    { label: "סמן אושר",          icon: "✅", color: "#10B981",
      preset: { actionType: "approved", recipientRole: "artist", recipientName: project.artist, status: "approved", notes: `אושר על ידי ${project.artist}` } },
  ];

  const openFollowups = projectActions.filter(
    (a) => a.followup_date && !["approved", "closed", "cancelled"].includes(a.status)
  );
  const latestAction = projectActions[0] ?? null;
  const nearestFollowup = [...openFollowups]
    .filter((a) => a.followup_date)
    .sort((a, b) => (a.followup_date ?? "").localeCompare(b.followup_date ?? ""))[0] ?? null;

  type FileLinkItem = { url: string; label: string; contentTypeKey: string | null; versionLabel: string | null; date: string; phone: string | null };
  const filesAndLinks: FileLinkItem[] = (() => {
    const items: FileLinkItem[] = [];
    if (delivery?.deliveryLink) {
      items.push({ url: delivery.deliveryLink, label: "תיקיית מסירה", contentTypeKey: null, versionLabel: null, date: "", phone: artistClient?.phone ?? null });
    }
    const seen = new Set<string>();
    for (const a of projectActions) {
      if (a.dropbox_url && !seen.has(a.dropbox_url)) {
        seen.add(a.dropbox_url);
        const ct  = a.content_type  ? (CONTENT_TYPE_LABELS[a.content_type]  ?? a.content_type)  : "";
        const vl  = a.version_label ?? "";
        const lbl = [ct, vl].filter(Boolean).join(" ") || a.dropbox_url.split("/").pop() || a.dropbox_url;
        items.push({ url: a.dropbox_url, label: lbl, contentTypeKey: a.content_type, versionLabel: a.version_label, date: a.action_date, phone: a.recipient_phone });
      }
    }
    return items;
  })();

  const projectProgress = (() => {
    if (project.status === "הושלם") return 100;
    let score = 0;
    if (project.startDate) score += 15;
    if (projectActions.length > 0) score += 20;
    if (filesAndLinks.length > 0) score += 20;
    if (projectActions.some((a) => a.status === "approved")) score += 25;
    if (openFollowups.length === 0 && projectActions.length > 0) score += 20;
    return Math.min(90, score);
  })();

  // ── Render ────────────────────────────────────────────────────────────────
  return createPortal(
    <div dir="rtl" style={{ position: "fixed", inset: 0, zIndex: 99999, visibility: albumCenterOpen ? "hidden" : "visible" }}>
      {/* Backdrop — hidden on mobile (full screen has no backdrop) */}
      {!isMobile && (
        <div
          onClick={onClose}
          style={{
            position: "absolute", inset: 0,
            background: "rgba(0,0,0,0.55)",
            backdropFilter: "blur(2px)",
          }}
        />
      )}

      {/* Panel — side drawer on desktop, full-screen slide-up on mobile */}
      <div style={isMobile ? {
        position: "absolute", inset: 0,
        background: "#0E0E0E",
        display: "flex", flexDirection: "column", zIndex: 100000,
        overflow: "hidden",
      } : {
        position: "absolute", inset: "20px",
        background: "#0E0E0E",
        borderRadius: 18,
        display: "flex", flexDirection: "column", zIndex: 100000,
        overflow: "hidden",
        border: `1px solid ${accentColor}22`,
        boxShadow: `0 0 0 1px #1A1A1A, 0 32px 80px rgba(0,0,0,0.85)`,
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

        {/* ── Header ────────────────────────────────────────────────────────── */}
        <div style={{ padding: "20px 28px 0", borderBottom: "1px solid #1E1E1E", flexShrink: 0, background: "#111" }}>

          {/* Top row: project info + controls */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>

            {/* Right: icon + name + badges */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, flex: 1 }}>
              <span style={{ fontSize: 22, flexShrink: 0 }}>
                {project.projectType === "קליפ" ? "🎬" : (project.projectType === "EP" || project.projectType === "אלבום") ? "🎵" : "🎤"}
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 17, fontWeight: 700, color: "#F2F2F2", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {project.name}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3, flexWrap: "wrap" }}>
                  {project.projectType && (
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 6, background: `${accentColor}18`, color: accentColor, border: `1px solid ${accentColor}44` }}>
                      {project.projectType}
                    </span>
                  )}
                  {project.artist && <span style={{ fontSize: 12, color: "#555" }}>🎤 {project.artist}</span>}
                  {(() => {
                    const sc: Record<string, string> = { "בעבודה": "#3B82F6", "הושלם": "#10B981", "בהשהייה": "#6B7280", "ממתין": "#F59E0B", "בוטל": "#EF4444" };
                    const c = sc[project.status] ?? "#555";
                    return <span style={{ fontSize: 10, fontWeight: 700, color: c, background: `${c}18`, border: `1px solid ${c}30`, borderRadius: 5, padding: "2px 8px" }}>{project.status}</span>;
                  })()}
                  {project.deadline && (
                    <span style={{ fontSize: 10, fontWeight: 600, color: deadlineColor, background: `${deadlineColor}12`, border: `1px solid ${deadlineColor}28`, borderRadius: 5, padding: "2px 8px" }}>
                      {deadlineLabel(project.deadline)}
                    </span>
                  )}
                  {finLoaded && balance > 0 && (
                    <span style={{ fontSize: 10, fontWeight: 600, color: "#EF4444", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 5, padding: "2px 8px" }}>
                      יתרה: {balance.toLocaleString()}{finCurrency}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Left: full-page link + close */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              <Link
                href={`/projects/${project.id}`}
                style={{ fontSize: 11, color: "#555", textDecoration: "none", padding: "6px 12px", borderRadius: 8, border: "1px solid #2A2A2A", background: "rgba(255,255,255,0.03)", whiteSpace: "nowrap" }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLAnchorElement).style.color = "#AAA")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLAnchorElement).style.color = "#555")}
              >פתח עמוד מלא ↗</Link>
              <button
                onClick={onClose}
                title="סגור (ESC)"
                style={{ width: 38, height: 38, borderRadius: 10, border: "1px solid #2A2A2A", background: "rgba(255,255,255,0.04)", color: "#777", cursor: "pointer", fontSize: 17, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit", flexShrink: 0 }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#CCC")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#777")}
              >✕</button>
            </div>
          </div>

          {/* Quick actions strip */}
          <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
            <button
              onClick={() => { setActiveTab("סשנים"); setAddingSession(true); setAddDraft(emptyDraft()); }}
              style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid rgba(59,130,246,0.25)", background: "rgba(59,130,246,0.06)", color: "#60A5FA", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "rgba(59,130,246,0.13)")}
              onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "rgba(59,130,246,0.06)")}
            >+ סשן</button>
            <button
              onClick={() => { setActiveTab("כספים"); setAddingTx("income"); setTxDraft({ ...emptyTxDraft(), type: "income" }); }}
              style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid rgba(16,185,129,0.25)", background: "rgba(16,185,129,0.06)", color: "#34D399", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "rgba(16,185,129,0.13)")}
              onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "rgba(16,185,129,0.06)")}
            >+ תשלום</button>
            <button
              onClick={() => { setActiveTab("כספים"); setAddingTx("expense"); setTxDraft({ ...emptyTxDraft(), type: "expense" }); }}
              style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid rgba(245,158,11,0.25)", background: "rgba(245,158,11,0.06)", color: "#F59E0B", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "rgba(245,158,11,0.13)")}
              onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "rgba(245,158,11,0.06)")}
            >+ הוצאה</button>
            <UploadButton projectId={project.id} projectName={project.name} artist={project.artist} existingFiles={project.files} size="sm" />
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 2, overflowX: "auto", scrollbarWidth: "none" } as React.CSSProperties}>
            {PROJECT_TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  padding: "10px 18px",
                  borderRadius: "10px 10px 0 0",
                  border: "none",
                  background: activeTab === tab ? "#141414" : "transparent",
                  color: activeTab === tab ? accentColor : "#4A4A4A",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: activeTab === tab ? 700 : 400,
                  fontFamily: "inherit",
                  borderBottom: activeTab === tab ? `2px solid ${accentColor}` : "2px solid transparent",
                  transition: "all 0.15s",
                  whiteSpace: "nowrap",
                }}
              >{tab}</button>
            ))}
          </div>
        </div>

        {/* ── Tab content ──────────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: "auto", padding: 20, background: "#141414" } as React.CSSProperties}>

          <div style={{ display: activeTab === "סקירה" ? "block" : "none" }}>
          {/* ── Mai: הפעולה הבאה (pure, no fetch) ──────────────────────── */}
          <ProjectNextActionBlock
            project={project}
            transactions={transactions}
            agreedPrice={agreedPrice}
            currency={finCurrency}
          />

          {/* ── מרכז תפעולי — גריד 3 שורות ─────────────────────────────── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 4 }}>

            {/* שורה 1 — 3 עמודות: מצב הפרויקט | מעקב עבודה | פעולות מהירות */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, alignItems: "start" }}>

              {/* מצב הפרויקט */}
              <div style={{ background: "#141414", border: "1px solid #252525", borderRadius: 12, padding: "16px" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#666", letterSpacing: 1, marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  מצב הפרויקט <span style={{ fontSize: 14 }}>🎚️</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {([
                    { label: "מעקבים פתוחים", value: String(openFollowups.length), icon: "💬", color: openFollowups.length > 0 ? "#F59E0B" : "#555" },
                    { label: "קבצים משותפים",  value: String(filesAndLinks.length),  icon: "📁", color: filesAndLinks.length > 0 ? "#3B82F6" : "#555" },
                    { label: "פעילות אחרונה",  value: latestAction ? fmtDate(latestAction.action_date) : "—", icon: "🕐", color: "#888" },
                  ] as { label: string; value: string; icon: string; color: string }[]).map(({ label, value, icon, color }) => (
                    <div key={label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", background: "#0D0D0D", borderRadius: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 13, opacity: 0.6 }}>{icon}</span>
                        <span style={{ fontSize: 10, color: "#555" }}>{label}</span>
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 700, color }}>{value}</span>
                    </div>
                  ))}
                  {/* Progress bar */}
                  <div style={{ padding: "8px 10px", background: "#0D0D0D", borderRadius: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ fontSize: 10, color: "#555" }}>התקדמות פרויקט</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: accentColor }}>{projectProgress}%</span>
                    </div>
                    <div style={{ height: 4, background: "#252525", borderRadius: 2, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${projectProgress}%`, background: accentColor, borderRadius: 2 }} />
                    </div>
                  </div>
                </div>
              </div>

              {/* מעקב עבודה */}
              <div style={{ background: "#141414", border: "1px solid #252525", borderRadius: 12, padding: "16px" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#666", letterSpacing: 1, marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  מעקב עבודה <span style={{ fontSize: 14 }}>📊</span>
                </div>
                {latestAction ? (
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    {([
                      { label: "סטטוס נוכחי",  value: ACTION_STATUS_LABELS[latestAction.status] ?? latestAction.status, color: ACTION_STATUS_COLOR[latestAction.status] ?? "#D0D0D0", bold: true },
                      { label: "גרסה אחרונה",  value: [latestAction.content_type ? (CONTENT_TYPE_LABELS[latestAction.content_type] ?? latestAction.content_type) : "", latestAction.version_label ?? ""].filter(Boolean).join(" ") || "—", color: "#D0D0D0", bold: false },
                      { label: "נשלח אל",       value: latestAction.recipient_name || (latestAction.recipient_role ? (RECIPIENT_ROLE_LABELS[latestAction.recipient_role] ?? latestAction.recipient_role) : "") || "—", color: accentColor, bold: false },
                      { label: "נשלח בתאריך",  value: fmtDate(latestAction.action_date), color: "#D0D0D0", bold: false },
                      { label: "פולואפ הבא",   value: nearestFollowup ? fmtDate(nearestFollowup.followup_date!) : "—", color: nearestFollowup ? "#F59E0B" : "#555", bold: false },
                      { label: "הפעולה הבאה",  value: NEXT_ACTION_LABEL[latestAction.status] ?? "—", color: "#C0C0C0", bold: false },
                    ] as { label: string; value: string; color: string; bold: boolean }[]).map(({ label, value, color, bold }, i) => (
                      <div key={label} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "8px 0", borderBottom: i < 5 ? "1px solid #1A1A1A" : "none" }}>
                        <span style={{ fontSize: 10, color: "#555", flexShrink: 0 }}>{label}</span>
                        <span style={{ fontSize: 12, fontWeight: bold ? 700 : 600, color, maxWidth: "58%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left" }}>{value}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ textAlign: "center", padding: "24px 0" }}>
                    <div style={{ fontSize: 11, color: "#444", marginBottom: 12 }}>אין עדיין פעולות רשומות</div>
                    <button onClick={() => openActionModal({ actionType: "sent", status: "pending_feedback" })}
                      style={{ padding: "7px 14px", borderRadius: 8, border: `1px solid ${accentColor}44`, background: `${accentColor}0D`, color: accentColor, cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: "inherit" }}>
                      + תעד שליחה ראשונה
                    </button>
                  </div>
                )}
              </div>

              {/* פעולות מהירות */}
              <div style={{ background: "#141414", border: "1px solid #252525", borderRadius: 12, padding: "16px" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#666", letterSpacing: 1, marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
                  פעולות מהירות <span style={{ fontSize: 14 }}>⚡</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {QUICK_ACTIONS.map((qa) => (
                    <button key={qa.label} onClick={() => handleQuickAction(qa.label, qa.preset)}
                      style={{ padding: "14px 8px", borderRadius: 10, border: `1px solid ${qa.color}33`, background: `${qa.color}0F`, color: qa.color, cursor: "pointer", fontSize: 11, fontWeight: 700, fontFamily: "inherit", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 7 }}>
                      <span style={{ fontSize: 22 }}>{qa.icon}</span>
                      <span style={{ textAlign: "center", lineHeight: 1.3 }}>{qa.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* שורה 2 — 2 עמודות: מעקבים פתוחים | קישורים וקבצים */}
            {(openFollowups.length > 0 || filesAndLinks.length > 0) && (
              <div style={{ display: "grid", gridTemplateColumns: openFollowups.length > 0 && filesAndLinks.length > 0 ? "1fr 1fr" : "1fr", gap: 12, alignItems: "start" }}>

                {openFollowups.length > 0 && (
                  <div style={{ background: "#141414", border: "1px solid #252525", borderRadius: 12, padding: "16px" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#666", letterSpacing: 1, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
                      מעקבים פתוחים 💬
                      <span style={{ fontSize: 11, background: "#252525", color: "#888", borderRadius: 10, padding: "1px 7px" }}>{openFollowups.length}</span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {openFollowups.map((a) => {
                        const chip = priorityChip(a.status);
                        const recipientDisplay = a.recipient_name || (a.recipient_role ? (RECIPIENT_ROLE_LABELS[a.recipient_role] ?? a.recipient_role) : "");
                        return (
                          <div key={a.id} style={{ background: "#0D0D0D", borderRadius: 10, padding: "10px 12px", border: "1px solid #1E1E1E" }}>
                            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                                  <span style={{ fontSize: 10, color: chip.color, background: `${chip.color}22`, borderRadius: 4, padding: "2px 6px", fontWeight: 700, flexShrink: 0 }}>{chip.label}</span>
                                  <span style={{ fontSize: 11, fontWeight: 700, color: "#D0D0D0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{followupTitle(a)}</span>
                                </div>
                                <div style={{ fontSize: 10, color: "#555" }}>
                                  נשלח: {fmtDate(a.action_date)}{recipientDisplay ? ` • אל: ${recipientDisplay}` : ""}{a.followup_date ? ` • פולואפ: ${fmtDate(a.followup_date)}` : ""}
                                </div>
                              </div>
                              <div style={{ display: "flex", flexDirection: "column", gap: 5, flexShrink: 0 }}>
                                {a.recipient_phone && (
                                  <a href={buildWhatsAppForAction(a)} target="_blank" rel="noopener noreferrer"
                                    style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid rgba(37,211,102,0.3)", background: "rgba(37,211,102,0.08)", color: "#25D366", fontSize: 10, fontWeight: 600, textDecoration: "none", textAlign: "center" }}>
                                    💬 WhatsApp
                                  </a>
                                )}
                                <div style={{ display: "flex", gap: 4 }}>
                                  <button onClick={() => closePendingAction(a.id)} disabled={closingActionId === a.id}
                                    style={{ flex: 1, padding: "4px 7px", borderRadius: 6, border: "1px solid rgba(16,185,129,0.3)", background: "rgba(16,185,129,0.08)", color: "#10B981", cursor: "pointer", fontSize: 10, fontWeight: 600, fontFamily: "inherit", opacity: closingActionId === a.id ? 0.6 : 1, whiteSpace: "nowrap" }}>
                                    סגור ✓
                                  </button>
                                  {a.followup_date && (
                                    <button onClick={() => postponeFollowup(a.id, a.followup_date!)}
                                      style={{ flex: 1, padding: "4px 7px", borderRadius: 6, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.08)", color: "#EF4444", cursor: "pointer", fontSize: 10, fontWeight: 600, fontFamily: "inherit", whiteSpace: "nowrap" }}>
                                      דחה ✗
                                    </button>
                                  )}
                                  <button onClick={() => setCancelConfirm({ id: a.id, summary: followupTitle(a) })}
                                    style={{ padding: "4px 7px", borderRadius: 6, border: "1px solid #2A2A2A", background: "transparent", color: "#444", cursor: "pointer", fontSize: 11, fontFamily: "inherit", lineHeight: 1 }}
                                    title="העבר לסל"
                                    onMouseEnter={(e) => { e.currentTarget.style.color = "#EF4444"; e.currentTarget.style.borderColor = "rgba(239,68,68,0.3)"; }}
                                    onMouseLeave={(e) => { e.currentTarget.style.color = "#444"; e.currentTarget.style.borderColor = "#2A2A2A"; }}>
                                    🗑️
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {filesAndLinks.length > 0 && (
                  <div style={{ background: "#141414", border: "1px solid #252525", borderRadius: 12, padding: "16px" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#666", letterSpacing: 1, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
                      קישורים וקבצים 📁
                      <span style={{ fontSize: 11, background: "#252525", color: "#888", borderRadius: 10, padding: "1px 7px" }}>{filesAndLinks.length}</span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {filesAndLinks.map((item, idx) => (
                        <div key={idx} style={{ background: "#0D0D0D", borderRadius: 10, padding: "10px 12px", border: "1px solid #1E1E1E" }}>
                          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
                            <span style={{ fontSize: 20, flexShrink: 0, color: "#0061FF" }}>📁</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: "#C0C0C0", marginBottom: 2 }}>{item.label}</div>
                              <div style={{ fontSize: 10, color: "#3B82F6", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.url}</div>
                            </div>
                            {item.date && <div style={{ fontSize: 9, color: "#555", flexShrink: 0 }}>{fmtDate(item.date)}</div>}
                          </div>
                          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                            <a href={item.url} target="_blank" rel="noopener noreferrer"
                              style={{ padding: "5px 9px", borderRadius: 6, border: "1px solid #2A2A2A", color: "#888", fontSize: 10, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 3 }}>
                              ↗ פתח קישור
                            </a>
                            <button onClick={() => navigator.clipboard.writeText(item.url)}
                              style={{ padding: "5px 9px", borderRadius: 6, border: "1px solid #2A2A2A", background: "transparent", color: "#888", cursor: "pointer", fontSize: 10, fontFamily: "inherit" }}>
                              📋 העתק קישור
                            </button>
                            {artistClient?.phone && (
                              <a href={whatsAppLinkHref(artistClient.phone, item.label, item.url)} target="_blank" rel="noopener noreferrer"
                                style={{ padding: "5px 9px", borderRadius: 6, border: "1px solid rgba(37,211,102,0.3)", background: "rgba(37,211,102,0.08)", color: "#25D366", fontSize: 10, textDecoration: "none" }}>
                                💬 שלח ב-WhatsApp
                              </a>
                            )}
                            <button onClick={() => openActionModal({ actionType: "sent", dropboxUrl: item.url, contentType: item.contentTypeKey ?? "", versionLabel: item.versionLabel ?? "" })}
                              style={{ padding: "5px 9px", borderRadius: 6, border: `1px solid ${accentColor}33`, background: `${accentColor}0A`, color: accentColor, cursor: "pointer", fontSize: 10, fontFamily: "inherit" }}>
                              ✓ תעד שליחה
                            </button>
                            <button onClick={() => openActionModal({ actionType: "followup", dropboxUrl: item.url, status: "pending_feedback" })}
                              style={{ padding: "5px 9px", borderRadius: 6, border: "1px solid #2A2A2A", background: "transparent", color: "#888", cursor: "pointer", fontSize: 10, fontFamily: "inherit" }}>
                              📅 צור פולואפ
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* שורה 3 — היסטוריית פעילות, רוחב מלא */}
            {projectActions.length > 0 && (
              <div style={{ background: "#141414", border: "1px solid #252525", borderRadius: 12, padding: "16px" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#666", letterSpacing: 1, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
                  היסטוריית פעילות 🕐
                  {projectActions.length > 4 && (
                    <button onClick={() => setActiveTab("פעולות")}
                      style={{ fontSize: 10, color: "#555", background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit", padding: 0 }}>
                      הכל ←
                    </button>
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {projectActions.slice(0, 4).map((a, idx) => {
                    const actionIcon: Record<string, string> = { sent: "✈️", received: "🎧", notes: "💬", approved: "✓", followup: "📅", other: "⚙️" };
                    const typeLabel: Record<string, string> = { sent: "שליחה", received: "קבלה", notes: "הערות", approved: "אישור", followup: "מעקב", other: "אחר" };
                    const actionColor = ACTION_STATUS_COLOR[a.status] ?? "#555";
                    const icon = actionIcon[a.action_type] ?? "•";
                    const type = typeLabel[a.action_type] ?? "";
                    const subText = [
                      a.recipient_name ? `נשלח אל: ${a.recipient_name}` : (a.recipient_role ? RECIPIENT_ROLE_LABELS[a.recipient_role] ?? "" : ""),
                      a.content_type ? (CONTENT_TYPE_LABELS[a.content_type] ?? "") : "",
                      a.version_label ?? "",
                    ].filter(Boolean).join(" · ");
                    return (
                      <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 0", borderBottom: idx < Math.min(projectActions.length, 4) - 1 ? "1px solid #1A1A1A" : "none" }}>
                        {/* תאריך + שעה */}
                        <div style={{ flexShrink: 0, textAlign: "left", minWidth: 72 }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: "#888" }}>{fmtDate(a.action_date)}</div>
                          {a.created_at && <div style={{ fontSize: 10, color: "#555" }}>{new Date(a.created_at).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}</div>}
                        </div>
                        {/* עיגול אייקון */}
                        <div style={{ flexShrink: 0, width: 36, height: 36, borderRadius: "50%", background: `${actionColor}1A`, border: `1.5px solid ${actionColor}44`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>
                          {icon}
                        </div>
                        {/* כותרת + תת-כותרת */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: a.status === "cancelled" ? "#555" : "#D0D0D0", textDecoration: a.status === "cancelled" ? "line-through" : "none" }}>{actionSummary(a)}</span>
                            {a.status === "cancelled" && <span style={{ fontSize: 9, color: "#EF4444", background: "rgba(239,68,68,0.1)", borderRadius: 3, padding: "1px 5px", fontWeight: 700, flexShrink: 0 }}>בוטל</span>}
                          </div>
                          {subText && <div style={{ fontSize: 10, color: "#555" }}>{subText}</div>}
                        </div>
                        {/* סוג פעולה + סל */}
                        <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 6 }}>
                          {type && (
                            <div style={{ textAlign: "center" }}>
                              <div style={{ fontSize: 9, color: "#444", background: "#1A1A1A", borderRadius: 4, padding: "1px 6px", marginBottom: 2 }}>מערכת</div>
                              <div style={{ fontSize: 9, color: "#555" }}>{type}</div>
                            </div>
                          )}
                          {a.status !== "cancelled" && (
                            <button onClick={(e) => { e.stopPropagation(); setCancelConfirm({ id: a.id, summary: actionSummary(a) }); }}
                              style={{ padding: "3px 5px", borderRadius: 5, border: "1px solid #2A2A2A", background: "transparent", color: "#444", cursor: "pointer", fontSize: 11, lineHeight: 1 }}
                              title="העבר לסל"
                              onMouseEnter={(ev) => { ev.currentTarget.style.color = "#EF4444"; ev.currentTarget.style.borderColor = "rgba(239,68,68,0.3)"; }}
                              onMouseLeave={(ev) => { ev.currentTarget.style.color = "#444"; ev.currentTarget.style.borderColor = "#2A2A2A"; }}>
                              🗑️
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

          </div>

          {/* ── פרטים ועריכה ──────────────────────────────────────────────── */}
          <CollapsibleCard label="פרטים ועריכה" open={openSections.has("summary")} onToggle={() => toggleSection("summary")}>
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
          </div>

          <div style={{ display: activeTab === "כספים" ? "block" : "none" }}>
          {/* ── כספים ───────────────────────────────────────────────────── */}
          <CollapsibleCard
            label="כספים"
            badge={transactions.length > 0 ? String(transactions.length) : undefined}
            open={openSections.has("finance")}
            onToggle={() => toggleSection("finance")}
          >

            {/* ── Finance summary strip ─────────────────────────────────── */}
            {finLoaded && (
              <div style={{
                display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
                gap: 1, marginBottom: 14,
                background: "#111", borderRadius: 10, overflow: "hidden",
                border: "1px solid #1E1E1E",
              }}>
                {[
                  { label: "מחיר מוסכם", value: agreedPrice > 0 ? `${agreedPrice.toLocaleString()}${finCurrency}` : "—", color: agreedPrice > 0 ? "#CCC" : "#444" },
                  { label: "התקבל", value: `${totalPaid.toLocaleString()}${finCurrency}`, color: "#10B981" },
                  { label: balance > 0 ? "יתרה לגבייה" : balance < 0 ? "ביתר" : "מאוזן", value: balance !== 0 ? `${Math.abs(balance).toLocaleString()}${finCurrency}` : "✓", color: balance > 0 ? "#EF4444" : balance < 0 ? "#A855F7" : "#10B981" },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ padding: "10px 12px", textAlign: "center" }}>
                    <div style={{ fontSize: 9, color: "#444", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>{label}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color }}>{value}</div>
                  </div>
                ))}
              </div>
            )}

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
              { label: "שולם עד עכשיו",    value: totalPaid,    color: "#10B981", prefix: "",  sub: null },
              { label: "יתרה לתשלום",       value: balance,      color: balance > 0 ? "#EF4444" : "#10B981", prefix: "", sub: null },
              { label: "הוצאות סה״כ",       value: totalExp,     color: "#F59E0B", prefix: "−", sub: totalClipExp > 0 ? `מתוכן קליפ: ${totalClipExp.toLocaleString()}₪` : null },
              { label: "רווח משוער",        value: profit,       color: profit >= 0 ? "#10B981" : "#EF4444", prefix: "", sub: null },
            ].map(({ label, value, color, prefix, sub }) => (
              <div key={label} style={{ padding: "6px 0", borderBottom: "1px solid #1E1E1E" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
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
                {sub && <div style={{ fontSize: 10, color: "#A855F7", marginTop: 2, paddingRight: 2 }}>🎬 {sub}</div>}
              </div>
            ))}

            {/* Action buttons */}
            <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
              <button
                onClick={() => { setAddingTx("income"); setTxDraft({ ...emptyTxDraft(), type: "income" }); }}
                style={{ flex: 1, padding: "5px 0", borderRadius: 7, border: "1px solid rgba(16,185,129,0.2)", background: "none", color: "#10B981", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "rgba(16,185,129,0.08)")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "none")}
              >+ הכנסה</button>
              <button
                onClick={() => { setAddingTx("expense"); setTxDraft({ ...emptyTxDraft(), type: "expense" }); }}
                style={{ flex: 1, padding: "5px 0", borderRadius: 7, border: "1px solid rgba(245,158,11,0.2)", background: "none", color: "#F59E0B", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "rgba(245,158,11,0.08)")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "none")}
              >+ הוצאה</button>
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
                              <button onClick={() => startEditTx(tx)} style={{ background: "none", border: "none", cursor: "pointer", color: "#888", fontSize: 12, padding: "1px 4px" }} onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#CCC")} onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#888")}>✏</button>
                              <button onClick={() => handleDeleteTx(tx.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#888", fontSize: 14, padding: "1px 4px" }} onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#EF4444")} onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#888")}>×</button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Expenses — non-clip only; clip expenses shown in קליפ / צילום section */}
                {nonClipExpenses.length > 0 && (
                  <div>
                    <div style={{ fontSize: 10, color: "#F59E0B", fontWeight: 700, marginBottom: 6, letterSpacing: "0.05em" }}>הוצאות</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      {nonClipExpenses.map((tx) => (
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
                              <button onClick={() => startEditTx(tx)} style={{ background: "none", border: "none", cursor: "pointer", color: "#888", fontSize: 12, padding: "1px 4px" }} onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#CCC")} onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#888")}>✏</button>
                              <button onClick={() => handleDeleteTx(tx.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#888", fontSize: 14, padding: "1px 4px" }} onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#EF4444")} onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#888")}>×</button>
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

          </div>

          <div style={{ display: activeTab === "סשנים" ? "block" : "none" }}>
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
                {sessions.filter((s) => s.session_type !== "צילום קליפ").map((s) => (
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
                                const next = CYCLE_TYPES[(CYCLE_TYPES.indexOf(cur as "סשן"|"ניקוי מיקס"|"חזרה") + 1) % CYCLE_TYPES.length];
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

          </div>

          <div style={{ display: activeTab === "סקירה" ? "block" : "none" }}>
          {/* ── מרכז אלבום ──────────────────────────────────────────────── */}
          {(project.projectType === "EP" || project.projectType === "אלבום") && (
            <div style={{
              margin: "0 0 4px",
              padding: "14px 16px",
              borderRadius: 12,
              background: project.projectType === "EP" ? "rgba(168,85,247,0.06)" : "rgba(236,72,153,0.06)",
              border: `1px solid ${project.projectType === "EP" ? "rgba(168,85,247,0.25)" : "rgba(236,72,153,0.25)"}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#E0E0E0", marginBottom: 3 }}>
                  🎵 מרכז אלבום
                </div>
                <div style={{ fontSize: 11, color: "#666" }}>
                  נהל שירים, רפרנסים, קבצים וסיכומי שיחה
                </div>
              </div>
              <button
                onClick={() => setAlbumCenterOpen(true)}
                style={{
                  padding: "7px 13px",
                  borderRadius: 9,
                  border: `1px solid ${project.projectType === "EP" ? "rgba(168,85,247,0.4)" : "rgba(236,72,153,0.4)"}`,
                  background: project.projectType === "EP" ? "rgba(168,85,247,0.12)" : "rgba(236,72,153,0.12)",
                  color: project.projectType === "EP" ? "#C084FC" : "#F472B6",
                  cursor: "pointer",
                  fontSize: 11,
                  fontWeight: 700,
                  fontFamily: "inherit",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                פתח מרכז אלבום
              </button>
            </div>
          )}

          </div>

          <div style={{ display: activeTab === "פעולות" ? "flex" : "none", flexDirection: "column", gap: 14, paddingBottom: 16 }}>

          {/* ── 1. פעולות מהירות ──────────────────────────────────────────── */}
          <div style={{ background: "#141414", border: "1px solid #252525", borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#666", letterSpacing: 1, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
              פעולות מהירות <span style={{ fontSize: 13 }}>⚡</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 7 }}>
              {QUICK_ACTIONS.map((qa) => (
                <button key={qa.label} onClick={() => handleQuickAction(qa.label, qa.preset)}
                  style={{ padding: "12px 8px", borderRadius: 9, border: `1px solid ${qa.color}33`, background: `${qa.color}0F`, color: qa.color, cursor: "pointer", fontSize: 10, fontWeight: 700, fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 5, whiteSpace: "nowrap" }}>
                  <span style={{ fontSize: 13 }}>{qa.icon}</span>
                  <span>{qa.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* ── 2. מעקב עבודה ─────────────────────────────────────────────── */}
          <div style={{ background: "#141414", border: "1px solid #252525", borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#666", letterSpacing: 1, marginBottom: 10 }}>מעקב עבודה 📊</div>
          {!latestAction ? (
            <div style={{ textAlign: "center", padding: "16px 0" }}>
              <div style={{ fontSize: 12, color: "#444", marginBottom: 10 }}>עדיין לא נרשמה שליחה בפרויקט הזה</div>
              <button onClick={() => openActionModal({ actionType: "sent", status: "pending_feedback" })}
                style={{ padding: "8px 18px", borderRadius: 8, border: `1px solid ${accentColor}44`, background: `${accentColor}0D`, color: accentColor, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "inherit" }}>
                + תעד שליחה ראשונה
              </button>
            </div>
          ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8 }}>
                <div style={{ background: "#0D0D0D", borderRadius: 8, padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontSize: 9, color: "#555", marginBottom: 3 }}>סטטוס נוכחי</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: ACTION_STATUS_COLOR[latestAction.status] ?? "#D0D0D0" }}>
                      {ACTION_STATUS_LABELS[latestAction.status] ?? latestAction.status}
                    </div>
                  </div>
                  <span style={{ fontSize: 16, opacity: 0.25 }}>🕐</span>
                </div>
                <div style={{ background: "#0D0D0D", borderRadius: 8, padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontSize: 9, color: "#555", marginBottom: 3 }}>גרסה אחרונה</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#D0D0D0" }}>
                      {[latestAction.content_type ? (CONTENT_TYPE_LABELS[latestAction.content_type] ?? latestAction.content_type) : "", latestAction.version_label ?? ""].filter(Boolean).join(" ") || "—"}
                    </div>
                  </div>
                  <span style={{ fontSize: 16, opacity: 0.25 }}>🎚️</span>
                </div>
                <div style={{ background: "#0D0D0D", borderRadius: 8, padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontSize: 9, color: "#555", marginBottom: 3 }}>נשלח אל</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#D0D0D0" }}>
                      {latestAction.recipient_name || (latestAction.recipient_role ? (RECIPIENT_ROLE_LABELS[latestAction.recipient_role] ?? latestAction.recipient_role) : "") || "—"}
                    </div>
                  </div>
                  <span style={{ fontSize: 16, opacity: 0.25 }}>👤</span>
                </div>
                <div style={{ background: "#0D0D0D", borderRadius: 8, padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontSize: 9, color: "#555", marginBottom: 3 }}>נשלח בתאריך</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#D0D0D0" }}>{fmtDate(latestAction.action_date)}</div>
                  </div>
                  <span style={{ fontSize: 16, opacity: 0.25 }}>📅</span>
                </div>
                <div style={{ background: "#0D0D0D", borderRadius: 8, padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontSize: 9, color: "#555", marginBottom: 3 }}>פולואפ הבא</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: nearestFollowup ? "#F59E0B" : "#555" }}>
                      {nearestFollowup ? fmtDate(nearestFollowup.followup_date!) : "—"}
                    </div>
                  </div>
                  <span style={{ fontSize: 16, opacity: 0.25 }}>↩</span>
                </div>
                <div style={{ background: "#0D0D0D", borderRadius: 8, padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontSize: 9, color: "#555", marginBottom: 3 }}>הפעולה הבאה</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#C0C0C0" }}>
                      {NEXT_ACTION_LABEL[latestAction.status] ?? "—"}
                    </div>
                  </div>
                  <span style={{ fontSize: 16, opacity: 0.25 }}>⏱</span>
                </div>
              </div>
          )}
          </div>

          {/* ── 3. מעקבים פתוחים ──────────────────────────────────────────── */}
          {openFollowups.length > 0 && (
            <div style={{ background: "#141414", border: "1px solid #252525", borderRadius: 12, padding: "14px 16px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#666", letterSpacing: 1, marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                מעקבים פתוחים
                <span style={{ fontSize: 11, background: "#252525", color: "#888", borderRadius: 10, padding: "1px 7px" }}>{openFollowups.length}</span>
                <span style={{ fontSize: 11, background: "#252525", color: "#555", borderRadius: 10, padding: "1px 7px" }}>{projectActions.length}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {openFollowups.map((a) => {
                  const chip = priorityChip(a.status);
                  const recipientDisplay = a.recipient_name || (a.recipient_role ? (RECIPIENT_ROLE_LABELS[a.recipient_role] ?? a.recipient_role) : "");
                  return (
                    <div key={a.id} style={{ background: "#0D0D0D", borderRadius: 9, padding: "10px 12px", border: "1px solid #1E1E1E" }}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                        {/* RIGHT: chip + title (RTL — appears on right side) */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                            <span style={{ fontSize: 10, color: chip.color, background: `${chip.color}22`, borderRadius: 4, padding: "2px 7px", fontWeight: 700, flexShrink: 0 }}>
                              {chip.label}
                            </span>
                            <span style={{ fontSize: 11, fontWeight: 700, color: "#D0D0D0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{followupTitle(a)}</span>
                          </div>
                          <div style={{ fontSize: 10, color: "#555" }}>
                            נשלח בתאריך: {fmtDate(a.action_date)}{recipientDisplay ? ` • נשלח אל: ${recipientDisplay}` : ""}{a.followup_date ? ` • פולואפ: ${fmtDate(a.followup_date)}` : ""}
                          </div>
                        </div>
                        {/* LEFT: action buttons */}
                        <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
                          {a.recipient_phone && (
                            <a href={buildWhatsAppForAction(a)} target="_blank" rel="noopener noreferrer"
                              style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid rgba(37,211,102,0.3)", background: "rgba(37,211,102,0.08)", color: "#25D366", fontSize: 10, fontWeight: 600, textDecoration: "none", display: "flex", alignItems: "center", gap: 3, whiteSpace: "nowrap" }}>
                              💬
                            </a>
                          )}
                          <button onClick={() => closePendingAction(a.id)} disabled={closingActionId === a.id}
                            style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid rgba(16,185,129,0.3)", background: "rgba(16,185,129,0.08)", color: "#10B981", cursor: "pointer", fontSize: 10, fontWeight: 600, fontFamily: "inherit", whiteSpace: "nowrap", opacity: closingActionId === a.id ? 0.6 : 1 }}>
                            סגור ✓
                          </button>
                          {a.followup_date && (
                            <button onClick={() => postponeFollowup(a.id, a.followup_date!)}
                              style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.08)", color: "#EF4444", cursor: "pointer", fontSize: 10, fontWeight: 600, fontFamily: "inherit", whiteSpace: "nowrap" }}>
                              דחה ✗
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── 4. קישורים וקבצים ─────────────────────────────────────────── */}
          <div style={{ background: "#141414", border: "1px solid #252525", borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#666", letterSpacing: 1, marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
              קישורים וקבצים
              {filesAndLinks.length > 0 && <span style={{ fontSize: 11, background: "#252525", color: "#888", borderRadius: 10, padding: "1px 7px" }}>{filesAndLinks.length}</span>}
            </div>

            {(!delivery || delivery.deliveryStatus === "not_created") && !deliveryLoading && (
              <button onClick={handleCreateDelivery} disabled={deliveryCreating}
                style={{ width: "100%", padding: "9px 0", borderRadius: 9, border: "1px solid rgba(168,85,247,0.3)", background: "rgba(168,85,247,0.07)", color: "#C084FC", cursor: deliveryCreating ? "wait" : "pointer", fontSize: 12, fontWeight: 600, fontFamily: "inherit", opacity: deliveryCreating ? 0.6 : 1, marginBottom: filesAndLinks.length > 0 ? 10 : 0 }}>
                {deliveryCreating ? "יוצר..." : "+ צור תיקיית מסירה"}
              </button>
            )}

            {filesAndLinks.length === 0 && (delivery && delivery.deliveryStatus !== "not_created") && (
              <div style={{ fontSize: 11, color: "#444", textAlign: "center", padding: "8px 0" }}>אין קישורים עדיין</div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {filesAndLinks.map((item, idx) => (
                <div key={idx} style={{ background: "#0D0D0D", borderRadius: 9, padding: "10px 12px", border: "1px solid #1E1E1E" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 7 }}>
                    <span style={{ fontSize: 16, flexShrink: 0, lineHeight: 1.2, color: "#0061FF" }}>📁</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#C0C0C0", marginBottom: 2 }}>{item.label}</div>
                      <div style={{ fontSize: 10, color: "#3B82F6", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.url}</div>
                    </div>
                    {item.date && <div style={{ fontSize: 9, color: "#555", flexShrink: 0, paddingTop: 2 }}>{fmtDate(item.date)}</div>}
                  </div>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    <a href={item.url} target="_blank" rel="noopener noreferrer"
                      style={{ padding: "4px 9px", borderRadius: 6, border: "1px solid #2A2A2A", background: "transparent", color: "#888", fontSize: 10, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 3 }}>
                      ↗ פתח קישור
                    </a>
                    <button onClick={() => navigator.clipboard.writeText(item.url)}
                      style={{ padding: "4px 9px", borderRadius: 6, border: "1px solid #2A2A2A", background: "transparent", color: "#888", cursor: "pointer", fontSize: 10, fontFamily: "inherit" }}>
                      📋 העתק קישור
                    </button>
                    {artistClient?.phone && (
                      <a href={whatsAppLinkHref(artistClient.phone, item.label, item.url)} target="_blank" rel="noopener noreferrer"
                        style={{ padding: "4px 9px", borderRadius: 6, border: "1px solid rgba(37,211,102,0.3)", background: "rgba(37,211,102,0.08)", color: "#25D366", fontSize: 10, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 3 }}>
                        💬 WhatsApp
                      </a>
                    )}
                    <button onClick={() => openActionModal({ actionType: "sent", dropboxUrl: item.url, contentType: item.contentTypeKey ?? "", versionLabel: item.versionLabel ?? "" })}
                      style={{ padding: "4px 9px", borderRadius: 6, border: `1px solid ${accentColor}33`, background: `${accentColor}0A`, color: accentColor, cursor: "pointer", fontSize: 10, fontFamily: "inherit" }}>
                      ✓ תעד שליחה
                    </button>
                    <button onClick={() => openActionModal({ actionType: "followup", dropboxUrl: item.url, status: "pending_feedback" })}
                      style={{ padding: "4px 9px", borderRadius: 6, border: "1px solid #2A2A2A", background: "transparent", color: "#888", cursor: "pointer", fontSize: 10, fontFamily: "inherit" }}>
                      📅 צור פולואפ
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── 5. היסטוריית פעולות ───────────────────────────────────────── */}
          <div style={{ background: "#141414", border: "1px solid #252525", borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#666", letterSpacing: 1, marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
              היסטוריית פעולות 🕐
              {projectActions.length > 0 && <span style={{ fontSize: 11, background: "#252525", color: "#888", borderRadius: 10, padding: "1px 7px" }}>{projectActions.length}</span>}
            </div>

            <button onClick={() => openActionModal()}
              style={{ width: "100%", padding: "8px 0", borderRadius: 9, border: `1px solid ${accentColor}44`, background: `${accentColor}0D`, color: accentColor, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "inherit", marginBottom: 10 }}>
              + תעד פעולה
            </button>

            {actionTaskWarn && (
              <div style={{ fontSize: 11, color: "#F59E0B", background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)", borderRadius: 7, padding: "6px 10px", marginBottom: 8 }}>
                ⚠ {actionTaskWarn}
              </div>
            )}

            {actionsLoading && <div style={{ fontSize: 11, color: "#444", textAlign: "center", padding: "10px 0" }}>טוען...</div>}
            {!actionsLoading && projectActions.length === 0 && (
              <div style={{ fontSize: 11, color: "#444", textAlign: "center", padding: "10px 0" }}>אין פעולות עדיין</div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {projectActions.map((a) => {
                const expanded = expandedActions.has(a.id);
                const toggleExpand = () => setExpandedActions((prev) => { const s = new Set(prev); s.has(a.id) ? s.delete(a.id) : s.add(a.id); return s; });
                return (
                  <div key={a.id}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 0", cursor: "pointer" }} onClick={toggleExpand}>
                      {/* dot — colored status indicator */}
                      <div style={{ flexShrink: 0, width: 9, height: 9, borderRadius: "50%", background: ACTION_STATUS_COLOR[a.status] ?? "#333", marginTop: 3, border: "2px solid #141414" }} />
                      {/* center — title + sub */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: a.status === "cancelled" ? "#555" : "#C0C0C0", lineHeight: 1.4, textDecoration: a.status === "cancelled" ? "line-through" : "none" }}>{actionSummary(a)}</span>
                          {a.status === "cancelled" && <span style={{ fontSize: 9, color: "#EF4444", background: "rgba(239,68,68,0.1)", borderRadius: 3, padding: "1px 5px", fontWeight: 700, flexShrink: 0 }}>בוטל</span>}
                        </div>
                        {!expanded && (a.recipient_name || a.recipient_role) && (
                          <div style={{ fontSize: 10, color: "#555" }}>
                            {a.recipient_name || (a.recipient_role ? RECIPIENT_ROLE_LABELS[a.recipient_role] ?? a.recipient_role : "")}
                          </div>
                        )}
                      </div>
                      {/* right — trash + date + chevron */}
                      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 6 }}>
                        {a.status !== "cancelled" && (
                          <button onClick={(e) => { e.stopPropagation(); setCancelConfirm({ id: a.id, summary: actionSummary(a) }); }}
                            style={{ padding: "2px 5px", borderRadius: 5, border: "1px solid #2A2A2A", background: "transparent", color: "#3A3A3A", cursor: "pointer", fontSize: 11, lineHeight: 1 }}
                            title="העבר לסל"
                            onMouseEnter={(ev) => { ev.currentTarget.style.color = "#EF4444"; ev.currentTarget.style.borderColor = "rgba(239,68,68,0.3)"; }}
                            onMouseLeave={(ev) => { ev.currentTarget.style.color = "#3A3A3A"; ev.currentTarget.style.borderColor = "#2A2A2A"; }}>
                            🗑️
                          </button>
                        )}
                        <div style={{ textAlign: "left", minWidth: 60 }}>
                          <div style={{ fontSize: 9, color: "#666" }}>{fmtDate(a.action_date)}</div>
                          {a.created_at && (
                            <div style={{ fontSize: 9, color: "#444" }}>
                              {new Date(a.created_at).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}
                            </div>
                          )}
                        </div>
                        <span style={{ fontSize: 10, color: "#444", paddingTop: 1 }}>{expanded ? "∧" : "∨"}</span>
                      </div>
                    </div>

                    {expanded && (
                      <div style={{ marginBottom: 6, marginRight: 17, padding: "8px 10px", background: "#0D0D0D", borderRadius: 7, border: "1px solid #1E1E1E", display: "flex", flexDirection: "column", gap: 4 }}>
                        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
                          <span style={{ fontSize: 10, color: ACTION_STATUS_COLOR[a.status] ?? "#888", background: `${ACTION_STATUS_COLOR[a.status] ?? "#888"}18`, borderRadius: 4, padding: "1px 6px" }}>
                            {ACTION_STATUS_LABELS[a.status] ?? a.status}
                          </span>
                          {a.content_type && (
                            <span style={{ fontSize: 10, color: "#888", background: "#252525", borderRadius: 4, padding: "1px 6px" }}>
                              {CONTENT_TYPE_LABELS[a.content_type] ?? a.content_type}{a.version_label ? ` · ${a.version_label}` : ""}
                            </span>
                          )}
                          {a.linked_task_id && (
                            <span style={{ fontSize: 10, color: "#A855F7", background: "rgba(168,85,247,0.08)", borderRadius: 4, padding: "1px 6px" }}>✓ משימה</span>
                          )}
                        </div>
                        {a.recipient_name && (
                          <div style={{ fontSize: 10, color: "#666" }}>
                            → {a.recipient_name}
                            {a.recipient_role ? ` (${RECIPIENT_ROLE_LABELS[a.recipient_role] ?? a.recipient_role})` : ""}
                            {a.recipient_phone && <span style={{ color: "#444", marginRight: 6 }}> · {a.recipient_phone}</span>}
                          </div>
                        )}
                        {a.followup_date && <div style={{ fontSize: 10, color: "#F59E0B" }}>מעקב: {fmtDate(a.followup_date)}</div>}
                        {a.notes && <div style={{ fontSize: 10, color: "#888", whiteSpace: "pre-wrap" }}>{a.notes}</div>}
                        {a.dropbox_url && (
                          <a href={a.dropbox_url} target="_blank" rel="noopener noreferrer"
                            style={{ fontSize: 10, color: "#3B82F6" }}>↗ {a.dropbox_url}</a>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── ActionMenu + HideButton ────────────────────────────────────── */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", paddingTop: 2 }}>
            <ActionMenu projectId={project.id} projectName={project.name} artist={project.artist} onSessionCreated={fetchSessions} />
            <HideButton project={project} onDone={() => { refresh(); onClose(); }} />
          </div>

          {/* ─────── BOTTOM OF TAB — replaces old CollapsibleCards ─────────
              The old "פעולות" CollapsibleCard (delivery folder + ActionMenu)
              was here. Delivery creation moved to "קישורים וקבצים" above.
              ActionMenu/HideButton moved to bottom strip above.             */}

          </div>

          <div style={{ display: activeTab === "קבצים" ? "block" : "none" }}>
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

          </div>

          <div style={{ display: activeTab === "קליפ" ? "block" : "none" }}>
          {/* ── קליפ / צילום ────────────────────────────────────────────── */}
          <ClipSection
            transactions={transactions}
            clipItems={clipItems}
            clipItemsLoaded={clipItemsLoaded}
            filmingSessions={filmingSessions}
            open={openSections.has("clip")}
            onToggle={() => toggleSection("clip")}
            onAddClipExpense={() => {
              toggleSection("finance");
              setAddingTx("expense");
              setTxDraft({ ...emptyTxDraft(), type: "expense", expenseScope: "קליפ" });
            }}
            addingClipItem={addingClipItem}
            clipItemDraft={clipItemDraft}
            setClipItemDraft={setClipItemDraft}
            clipItemSaving={clipItemSaving}
            promotingId={promotingId}
            promotingDate={promotingDate}
            setPromotingDate={setPromotingDate}
            onCancelPromote={() => { setPromotingId(null); setPromotingDate(""); }}
            onStartPromote={(id) => { setPromotingId(id); setPromotingDate(new Date().toISOString().split("T")[0]); }}
            onAddClipItem={() => { setClipItemDraft(emptyClipItemDraft()); setAddingClipItem(true); }}
            onSaveClipItem={handleAddClipItem}
            onCancelClipItem={() => { setAddingClipItem(false); setClipItemDraft(emptyClipItemDraft()); }}
            onDeleteClipItem={handleDeleteClipItem}
            onPromoteClipItem={handlePromoteClipItem}
            onAddFilmingDay={() => { setFilmingDraft(emptyFilmingDraft()); setAddingFilmingDay(true); }}
            onDeleteFilmingDay={(id) => {
              setSessions((prev) => prev.filter((s) => s.id !== id));
              fetch(`/api/sessions/${id}`, { method: "DELETE" });
            }}
            addingFilmingDay={addingFilmingDay}
            filmingDraft={filmingDraft}
            setFilmingDraft={setFilmingDraft}
            filmingSaving={filmingSaving}
            onSaveFilmingDay={handleAddFilmingDay}
            onCancelFilmingDay={() => { setAddingFilmingDay(false); setFilmingDraft(emptyFilmingDraft()); }}
            onEditTx={startEditTx}
            onDeleteTx={handleDeleteTx}
          />

          </div>

          <div style={{ display: activeTab === "סקירה" ? "block" : "none" }}>
          {/* ── Sound Engineer section ───────────────────────────────────── */}
          <SoundEngineerSection project={project} />

          {/* ── Victor section ──────────────────────────────────────────── */}
          <VictorSection project={project} />
          </div>

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

      {/* ── Album Center Modal ──────────────────────────────────────────────── */}
      {albumCenterOpen && project && (
        <AlbumCenterModal project={project} onClose={() => setAlbumCenterOpen(false)} />
      )}

      {/* ── תעד פעולה — Modal ────────────────────────────────────────────── */}
      {showActionForm && (
        <div dir="rtl"
          style={{ position: "fixed", inset: 0, zIndex: 999990, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={(e) => { if (e.target === e.currentTarget) { setShowActionForm(false); setActionError(null); } }}>
          <div style={{ background: "#141414", border: "1px solid #2A2A2A", borderRadius: 16, padding: "20px 22px", width: "100%", maxWidth: 460, maxHeight: "90vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12, boxShadow: "0 24px 80px rgba(0,0,0,0.8)" }}>

            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#D0D0D0" }}>תעד פעולה</span>
              <button onClick={() => { setShowActionForm(false); setActionError(null); }}
                style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 0 }}>✕</button>
            </div>

            {/* ── Preset quick-action chips ─────────────────────────────── */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {([
                { label: "📤 שלח לאמן",       preset: { actionType: "sent",     recipientRole: "artist",        recipientName: project?.artist ?? "", recipientClientId: artistClient?.id ?? "", recipientPhone: artistClient?.phone ?? "", status: "pending_feedback" } },
                { label: "📤 שלח ללקוח",     preset: { actionType: "sent",     recipientRole: "client",        recipientName: project?.artist ?? "", recipientClientId: artistClient?.id ?? "", recipientPhone: artistClient?.phone ?? "", status: "pending_feedback" } },
                { label: "📤 שלח לאיש סאונד", preset: { actionType: "sent",    recipientRole: "sound_engineer", recipientName: "", recipientPhone: "", status: "pending_version" } },
                { label: "📝 קיבלתי הערות",  preset: { actionType: "notes",    recipientRole: "client",        recipientName: project?.artist ?? "", recipientClientId: artistClient?.id ?? "", recipientPhone: artistClient?.phone ?? "", status: "got_notes" } },
                { label: "✅ אושר",           preset: { actionType: "approved", recipientRole: "client",        recipientName: project?.artist ?? "", status: "approved",           notes: `אושר על ידי ${project?.artist ?? ""}` } },
                { label: "📞 מעקב",          preset: { actionType: "followup", recipientRole: "client",        recipientName: project?.artist ?? "", recipientClientId: artistClient?.id ?? "", recipientPhone: artistClient?.phone ?? "", status: "pending_feedback" } },
              ] as { label: string; preset: Partial<ActionDraft> }[]).map(({ label, preset }) => (
                <button key={label} onClick={() => {
                  const base = emptyActionDraft();
                  if (delivery?.deliveryLink) base.dropboxUrl = delivery.deliveryLink;
                  setActionDraft({ ...base, ...preset });
                }}
                  style={{ padding: "5px 10px", borderRadius: 7, border: `1px solid ${accentColor}33`, background: `${accentColor}0A`, color: "#C0C0C0", cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: "inherit", whiteSpace: "nowrap" }}>
                  {label}
                </button>
              ))}
            </div>
            <div style={{ height: 1, background: "#252525" }} />

            {/* action_type */}
            <div>
              <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>סוג פעולה</div>
              <select value={actionDraft.actionType} onChange={(e) => setActionDraft((d) => ({ ...d, actionType: e.target.value }))}
                style={{ ...INPUT_S, width: "100%" }}>
                {Object.entries(ACTION_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>

            {/* client picker */}
            <div>
              <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>איש קשר מהמערכת</div>
              <select
                value={actionDraft.recipientClientId}
                onChange={(e) => {
                  const c = actionClients.find((cl) => cl.id === e.target.value);
                  if (c) setActionDraft((d) => ({ ...d, recipientClientId: c.id, recipientName: c.name, recipientPhone: c.phone || d.recipientPhone }));
                  else   setActionDraft((d) => ({ ...d, recipientClientId: "" }));
                }}
                style={{ ...INPUT_S, width: "100%" }}>
                <option value="">— בחר מהמערכת (אופציונלי) —</option>
                {actionClients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ""}</option>
                ))}
              </select>
            </div>

            {/* recipient name + role */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>תפקיד נמען</div>
                <select value={actionDraft.recipientRole} onChange={(e) => setActionDraft((d) => ({ ...d, recipientRole: e.target.value }))}
                  style={{ ...INPUT_S, width: "100%" }}>
                  {Object.entries(RECIPIENT_ROLE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>שם נמען</div>
                <input value={actionDraft.recipientName} onChange={(e) => setActionDraft((d) => ({ ...d, recipientName: e.target.value }))}
                  placeholder="שם..." style={{ ...INPUT_S, width: "100%" }} />
              </div>
            </div>

            {/* phone + WhatsApp */}
            <div>
              <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>טלפון נמען</div>
              <div style={{ display: "flex", gap: 8 }}>
                <input value={actionDraft.recipientPhone} onChange={(e) => setActionDraft((d) => ({ ...d, recipientPhone: e.target.value }))}
                  placeholder="05X-XXXXXXX" style={{ ...INPUT_S, flex: 1 }} />
                {actionDraft.recipientPhone.trim() && (
                  <a href={buildWhatsAppUrl(actionDraft.recipientPhone)} target="_blank" rel="noopener noreferrer"
                    style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "0 12px", height: 28, borderRadius: 6, fontSize: 11, fontWeight: 600, textDecoration: "none", border: "1px solid rgba(37,211,102,0.35)", background: "rgba(37,211,102,0.08)", color: "#25D366", whiteSpace: "nowrap", flexShrink: 0 }}>
                    💬 WhatsApp
                  </a>
                )}
              </div>
              {!actionDraft.recipientPhone.trim() && actionDraft.recipientName && (
                <div style={{ fontSize: 10, color: "#555", marginTop: 4 }}>אין טלפון במערכת — ניתן להזין ידנית</div>
              )}
              {actionDraft.recipientPhone.trim() && (
                <div style={{ fontSize: 10, color: "#444", marginTop: 4 }}>פתיחת WhatsApp לא שומרת את הפעולה — לחץ "תעד" בנפרד</div>
              )}
            </div>

            {/* content + version */}
            {(actionDraft.actionType === "sent" || actionDraft.actionType === "received") && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div>
                  <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>סוג תוכן</div>
                  <select value={actionDraft.contentType} onChange={(e) => setActionDraft((d) => ({ ...d, contentType: e.target.value }))}
                    style={{ ...INPUT_S, width: "100%" }}>
                    <option value="">—</option>
                    {Object.entries(CONTENT_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>גרסה</div>
                  <input value={actionDraft.versionLabel} onChange={(e) => setActionDraft((d) => ({ ...d, versionLabel: e.target.value }))}
                    placeholder="v1, final..." style={{ ...INPUT_S, width: "100%" }} />
                </div>
              </div>
            )}

            {/* dropbox url */}
            {actionDraft.actionType === "sent" && (
              <div>
                <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>
                  לינק דרופבוקס
                  {delivery?.deliveryLink && actionDraft.dropboxUrl === delivery.deliveryLink && (
                    <span style={{ color: "#10B981", marginRight: 6 }}>· מולא מתיקיית מסירה</span>
                  )}
                </div>
                <input value={actionDraft.dropboxUrl} onChange={(e) => setActionDraft((d) => ({ ...d, dropboxUrl: e.target.value }))}
                  placeholder={delivery?.deliveryLink ? "נמצא לינק מסירה (ניתן לשנות)" : "https://..."}
                  style={{ ...INPUT_S, width: "100%" }} />
                {delivery?.deliveryLink && !actionDraft.dropboxUrl && (
                  <button onClick={() => setActionDraft((d) => ({ ...d, dropboxUrl: delivery.deliveryLink! }))}
                    style={{ marginTop: 4, fontSize: 10, color: "#10B981", background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: "inherit" }}>
                    ← השתמש בלינק המסירה הקיים
                  </button>
                )}
              </div>
            )}

            {/* dates + status */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <div>
                <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>תאריך פעולה</div>
                <input type="date" value={actionDraft.actionDate} onChange={(e) => setActionDraft((d) => ({ ...d, actionDate: e.target.value }))}
                  style={{ ...INPUT_S, width: "100%" }} />
              </div>
              <div>
                <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>תאריך מעקב</div>
                <input type="date" value={actionDraft.followupDate} onChange={(e) => setActionDraft((d) => ({ ...d, followupDate: e.target.value }))}
                  style={{ ...INPUT_S, width: "100%" }} />
              </div>
              <div>
                <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>סטטוס</div>
                <select value={actionDraft.status} onChange={(e) => setActionDraft((d) => ({ ...d, status: e.target.value }))}
                  style={{ ...INPUT_S, width: "100%" }}>
                  {Object.entries(ACTION_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
            </div>

            {/* follow-up task checkbox — only shown when followup date is set */}
            {actionDraft.followupDate && (
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none" }}>
                <input type="checkbox" checked={actionDraft.createFollowupTask}
                  onChange={(e) => setActionDraft((d) => ({ ...d, createFollowupTask: e.target.checked }))}
                  style={{ width: 14, height: 14, accentColor: accentColor }} />
                <span style={{ fontSize: 12, color: "#A0A0A0" }}>צור משימת פולואפ בתאריך המעקב</span>
              </label>
            )}

            {/* notes */}
            <div>
              <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>הערות</div>
              <textarea value={actionDraft.notes} onChange={(e) => setActionDraft((d) => ({ ...d, notes: e.target.value }))}
                rows={2} placeholder="הערות..."
                style={{ ...INPUT_S, width: "100%", height: "auto", resize: "none", padding: "6px 8px", boxSizing: "border-box" }} />
            </div>

            {actionError && <div style={{ fontSize: 11, color: "#EF4444" }}>{actionError}</div>}

            {/* Buttons */}
            <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
              <button onClick={handleSaveAction} disabled={actionSaving}
                style={{ flex: 1, padding: "9px 0", borderRadius: 9, border: `1px solid ${accentColor}55`, background: `${accentColor}18`, color: accentColor, cursor: actionSaving ? "wait" : "pointer", fontSize: 13, fontWeight: 700, fontFamily: "inherit", opacity: actionSaving ? 0.6 : 1 }}>
                {actionSaving ? "שומר..." : "תעד פעולה"}
              </button>
              <button onClick={() => { setShowActionForm(false); setActionError(null); }}
                style={{ flex: 1, padding: "9px 0", borderRadius: 9, border: "1px solid #2A2A2A", background: "transparent", color: "#666", cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}

      </div>

      {/* ── Recipient Picker Overlay ─────────────────────────────────────────── */}
      {recipientPicker && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100002, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setRecipientPicker(null)}>
          <div style={{ background: "#141414", border: "1px solid #2A2A2A", borderRadius: 20, padding: "28px 24px", width: 380, maxWidth: "90vw" }}
            onClick={(e) => e.stopPropagation()}>

            {/* כותרת */}
            <div style={{ fontSize: 15, fontWeight: 700, color: "#E0E0E0", textAlign: "center", marginBottom: 6 }}>{recipientPicker.title}</div>
            <div style={{ fontSize: 11, color: "#555", textAlign: "center", marginBottom: 20 }}>בחר נמען להמשיך</div>

            {recipientPicker.mode === "picking" && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                  {recipientPicker.options.map((opt) => (
                    <button key={opt.label}
                      onClick={() => {
                        if (opt.name === "Victor") {
                          void handleVictorSelect();
                        } else {
                          openActionModal({ ...recipientPicker.preset, recipientName: opt.name, recipientPhone: opt.phone });
                          setRecipientPicker(null);
                        }
                      }}
                      style={{ padding: "18px 10px", borderRadius: 14, border: "1px solid #303030", background: "#1A1A1A", color: "#D0D0D0", cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "inherit", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, transition: "border-color 0.15s" }}
                      onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#505050")}
                      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#303030")}>
                      <span style={{ fontSize: 28 }}>{opt.icon}</span>
                      <span>{opt.label}</span>
                    </button>
                  ))}
                  {/* שם ידני */}
                  <button
                    onClick={() => setRecipientPicker((p) => p ? { ...p, mode: "custom" } : null)}
                    style={{ padding: "18px 10px", borderRadius: 14, border: "1px dashed #303030", background: "transparent", color: "#666", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "inherit", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 28 }}>✏️</span>
                    <span>שם ידני</span>
                  </button>
                </div>
                <button onClick={() => setRecipientPicker(null)}
                  style={{ width: "100%", padding: "9px 0", borderRadius: 9, border: "1px solid #252525", background: "transparent", color: "#555", cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>
                  ביטול
                </button>
              </>
            )}

            {recipientPicker.mode === "custom" && (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>שם</div>
                    <input
                      autoFocus
                      value={recipientPicker.customName}
                      onChange={(e) => setRecipientPicker((p) => p ? { ...p, customName: e.target.value } : null)}
                      placeholder="שם מלא..."
                      style={{ width: "100%", padding: "9px 12px", background: "#0D0D0D", border: "1px solid #303030", borderRadius: 9, color: "#D0D0D0", fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>טלפון (אופציונלי)</div>
                    <input
                      value={recipientPicker.customPhone}
                      onChange={(e) => setRecipientPicker((p) => p ? { ...p, customPhone: e.target.value } : null)}
                      placeholder="05X-XXXXXXX"
                      style={{ width: "100%", padding: "9px 12px", background: "#0D0D0D", border: "1px solid #303030", borderRadius: 9, color: "#D0D0D0", fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }}
                    />
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => {
                      if (!recipientPicker.customName.trim()) return;
                      openActionModal({ ...recipientPicker.preset, recipientName: recipientPicker.customName.trim(), recipientPhone: recipientPicker.customPhone.trim() });
                      setRecipientPicker(null);
                    }}
                    disabled={!recipientPicker.customName.trim()}
                    style={{ flex: 1, padding: "10px 0", borderRadius: 9, border: "1px solid #3B82F644", background: "#3B82F618", color: "#3B82F6", cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "inherit", opacity: recipientPicker.customName.trim() ? 1 : 0.4 }}>
                    המשך →
                  </button>
                  <button onClick={() => setRecipientPicker((p) => p ? { ...p, mode: "picking" } : null)}
                    style={{ padding: "10px 14px", borderRadius: 9, border: "1px solid #252525", background: "transparent", color: "#555", cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>
                    ← חזור
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Cancel Confirm Modal ─────────────────────────────────────────────── */}
      {cancelConfirm && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100004, background: "rgba(0,0,0,0.78)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setCancelConfirm(null)}>
          <div style={{ background: "#141414", border: "1px solid #2A2A2A", borderRadius: 16, padding: "24px 22px", width: 340, maxWidth: "90vw" }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 22, textAlign: "center", marginBottom: 10 }}>🗑️</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#E0E0E0", textAlign: "center", marginBottom: 6 }}>העבר לסל?</div>
            <div style={{ fontSize: 11, color: "#666", textAlign: "center", marginBottom: 4, lineHeight: 1.5 }}>
              הפעולה תסומן כ&quot;בוטלה&quot; ותיעלם ממעקבים פתוחים.
            </div>
            <div style={{ fontSize: 11, color: "#888", textAlign: "center", marginBottom: 20, padding: "6px 10px", background: "#1A1A1A", borderRadius: 7, fontStyle: "italic" }}>
              {cancelConfirm.summary}
            </div>
            <div style={{ fontSize: 10, color: "#444", textAlign: "center", marginBottom: 18 }}>
              לא נמחקת מהמסד — ניתן לשחזר בעתיד
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setCancelConfirm(null)}
                style={{ flex: 1, padding: "10px 0", borderRadius: 9, border: "1px solid #303030", background: "transparent", color: "#888", cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>
                ביטול
              </button>
              <button onClick={() => void cancelAction(cancelConfirm.id)}
                style={{ flex: 1, padding: "10px 0", borderRadius: 9, border: "1px solid rgba(239,68,68,0.35)", background: "rgba(239,68,68,0.1)", color: "#EF4444", cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "inherit" }}>
                העבר לסל 🗑️
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Victor Flow Overlay ──────────────────────────────────────────────── */}
      {victorFlow && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100003, background: "rgba(0,0,0,0.82)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => victorFlow.step !== "saving" && setVictorFlow(null)}>
          <div style={{ background: "#141414", border: "1px solid #2A2A2A", borderRadius: 20, padding: "28px 24px", width: 400, maxWidth: "90vw" }}
            onClick={(e) => e.stopPropagation()}>

            {/* כותרת */}
            <div style={{ fontSize: 15, fontWeight: 700, color: "#E0E0E0", textAlign: "center", marginBottom: 4 }}>🎵 שליחה ל-Victor</div>
            <div style={{ fontSize: 11, color: "#555", textAlign: "center", marginBottom: 24 }}>{project.name} · {project.artist}</div>

            {/* שלב 1: בחירת תוכן */}
            {victorFlow.step === "content" && (
              <>
                <div style={{ fontSize: 11, color: "#888", marginBottom: 10 }}>מה שולחים?</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 20 }}>
                  {([
                    { label: "Stems",   ct: "stems" },
                    { label: "הפקה",   ct: "production" },
                    { label: "מיקס",   ct: "mix" },
                    { label: "מאסטר",  ct: "master" },
                    { label: "קבצים",  ct: "files" },
                    { label: "אחר",    ct: "other" },
                  ] as { label: string; ct: string }[]).map(({ label, ct }) => (
                    <button key={ct}
                      onClick={() => setVictorFlow((prev) => prev ? { ...prev, contentType: ct } : null)}
                      style={{ padding: "12px 8px", borderRadius: 10, border: `1px solid ${victorFlow.contentType === ct ? "#A855F7" : "#2A2A2A"}`, background: victorFlow.contentType === ct ? "#A855F718" : "#1A1A1A", color: victorFlow.contentType === ct ? "#A855F7" : "#888", cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit", textAlign: "center" }}>
                      {label}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => victorFlow.contentType && setVictorFlow((prev) => prev ? { ...prev, step: "details" } : null)}
                  disabled={!victorFlow.contentType}
                  style={{ width: "100%", padding: "12px 0", borderRadius: 10, border: "1px solid #A855F744", background: "#A855F718", color: "#A855F7", cursor: victorFlow.contentType ? "pointer" : "not-allowed", fontSize: 13, fontWeight: 700, fontFamily: "inherit", opacity: victorFlow.contentType ? 1 : 0.4 }}>
                  המשך →
                </button>
              </>
            )}

            {/* שלב 2: פרטים */}
            {victorFlow.step === "details" && (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
                  <div>
                    <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>קישור Dropbox (אופציונלי)</div>
                    <input
                      autoFocus
                      value={victorFlow.dropboxUrl}
                      onChange={(e) => setVictorFlow((prev) => prev ? { ...prev, dropboxUrl: e.target.value } : null)}
                      placeholder="https://dropbox.com/..."
                      style={{ width: "100%", padding: "9px 12px", background: "#0D0D0D", border: "1px solid #303030", borderRadius: 9, color: "#D0D0D0", fontSize: 12, fontFamily: "inherit", outline: "none", boxSizing: "border-box", direction: "ltr" }}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>תאריך פולואפ (אופציונלי)</div>
                    <input
                      type="date"
                      value={victorFlow.followupDate}
                      onChange={(e) => setVictorFlow((prev) => prev ? { ...prev, followupDate: e.target.value } : null)}
                      style={{ width: "100%", padding: "9px 12px", background: "#0D0D0D", border: "1px solid #303030", borderRadius: 9, color: "#D0D0D0", fontSize: 12, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }}
                    />
                  </div>
                </div>
                {victorFlow.saveError && (
                  <div style={{ padding: "8px 12px", background: "#EF444418", border: "1px solid #EF444444", borderRadius: 8, color: "#EF4444", fontSize: 11, marginBottom: 12 }}>
                    {victorFlow.saveError}
                  </div>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => setVictorFlow((prev) => prev ? { ...prev, step: "content" } : null)}
                    style={{ flexShrink: 0, padding: "10px 16px", borderRadius: 9, border: "1px solid #303030", background: "transparent", color: "#666", cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>
                    ← חזור
                  </button>
                  <button
                    onClick={() => void handleVictorSave()}
                    style={{ flex: 1, padding: "10px 0", borderRadius: 9, border: "1px solid #A855F744", background: "#A855F718", color: "#A855F7", cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "inherit" }}>
                    שמור ושלח ל-Victor ✓
                  </button>
                </div>
              </>
            )}

            {/* שלב 3: שמירה */}
            {victorFlow.step === "saving" && (
              <div style={{ textAlign: "center", padding: "20px 0", color: "#666" }}>
                <div style={{ fontSize: 22, marginBottom: 8 }}>⏳</div>
                <div style={{ fontSize: 13 }}>שומר...</div>
              </div>
            )}

            {/* שלב 4: הצלחה */}
            {victorFlow.step === "done" && (
              <>
                <div style={{ textAlign: "center", padding: "16px 0 20px" }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>✅</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#E0E0E0", marginBottom: 4 }}>נשלח ל-Victor</div>
                  {victorFlow.saveError && (
                    <div style={{ fontSize: 11, color: "#F59E0B", marginTop: 8 }}>{victorFlow.saveError}</div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setVictorFlow(null)}
                    style={{ flex: 1, padding: "10px 0", borderRadius: 9, border: "1px solid #303030", background: "transparent", color: "#666", cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>
                    סגור
                  </button>
                  <a href="/team" target="_blank" rel="noreferrer"
                    style={{ flex: 1, padding: "10px 0", borderRadius: 9, border: "1px solid #A855F744", background: "#A855F718", color: "#A855F7", cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit", textAlign: "center", textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    פתח עמוד Victor ←
                  </a>
                </div>
              </>
            )}

          </div>
        </div>
      )}

    </div>,
    document.body
  );
}

// ── Clip / Video section ──────────────────────────────────────────────────────

function ClipSection({
  transactions, clipItems, clipItemsLoaded, filmingSessions,
  open, onToggle, onAddClipExpense,
  addingClipItem, clipItemDraft, setClipItemDraft, clipItemSaving,
  promotingId, promotingDate, setPromotingDate, onCancelPromote, onStartPromote,
  onAddClipItem, onSaveClipItem, onCancelClipItem, onDeleteClipItem, onPromoteClipItem,
  onAddFilmingDay, onDeleteFilmingDay, addingFilmingDay, filmingDraft, setFilmingDraft,
  filmingSaving, onSaveFilmingDay, onCancelFilmingDay,
  onEditTx, onDeleteTx,
}: {
  transactions: Transaction[];
  clipItems: ClipItem[];
  clipItemsLoaded: boolean;
  filmingSessions: Session[];
  open: boolean;
  onToggle: () => void;
  onAddClipExpense: () => void;
  addingClipItem: boolean;
  clipItemDraft: ClipItemDraft;
  setClipItemDraft: (d: ClipItemDraft) => void;
  clipItemSaving: boolean;
  promotingId: string | null;
  promotingDate: string;
  setPromotingDate: (d: string) => void;
  onCancelPromote: () => void;
  onStartPromote: (id: string) => void;
  onAddClipItem: () => void;
  onSaveClipItem: () => void;
  onCancelClipItem: () => void;
  onDeleteClipItem: (id: string) => void;
  onPromoteClipItem: (id: string, date: string) => void;
  onAddFilmingDay: () => void;
  onDeleteFilmingDay: (id: string) => void;
  addingFilmingDay: boolean;
  filmingDraft: FilmingDayDraft;
  setFilmingDraft: (d: FilmingDayDraft) => void;
  filmingSaving: boolean;
  onSaveFilmingDay: () => void;
  onCancelFilmingDay: () => void;
  onEditTx: (tx: Transaction) => void;
  onDeleteTx: (id: string) => void;
}) {
  const clipExp = transactions.filter((t) => t.type === "expense" && t.expense_scope === "קליפ");
  const PAID = new Set<string>(["שולם", "התקבל"]);
  const paid    = clipExp.filter((t) => PAID.has(t.payment_status)).reduce((s, t) => s + t.amount, 0);
  const pending = clipExp.filter((t) => !PAID.has(t.payment_status)).reduce((s, t) => s + t.amount, 0);

  // Clip item (planning) computed values
  const activeItems   = clipItems.filter((i) => i.status !== "בוטל" && i.status !== "הועבר לכספים");
  const totalPlanned  = activeItems.reduce((s, i) => s + i.amount, 0);
  const totalSynced   = activeItems.filter((i) => i.linked_transaction_id).reduce((s, i) => s + i.amount, 0);
  const totalUnsynced = activeItems.filter((i) => i.status === "תכנון בלבד").reduce((s, i) => s + i.amount, 0);

  const badgeParts: string[] = [];
  if (activeItems.length > 0)      badgeParts.push(`${activeItems.length} תכנון`);
  if (filmingSessions.length > 0)  badgeParts.push(`${filmingSessions.length} ימי צילום`);
  if (clipExp.length > 0)          badgeParts.push(`${clipExp.length} הוצאות`);
  const badge = badgeParts.length > 0 ? badgeParts.join(" · ") : undefined;

  const ITEM_STATUS_COLOR: Record<ClipItemStatus, string> = {
    "תכנון בלבד":    "#3B82F6",
    "הועבר לכספים":  "#F59E0B",
    "שולם":           "#10B981",
    "בוטל":           "#6B7280",
  };

  const today = new Date().toISOString().split("T")[0];

  return (
    <CollapsibleCard label="קליפ / צילום" badge={badge} open={open} onToggle={onToggle}>

      {/* ── 1. Planning items (clip_items) ── */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 10, color: "#3B82F6", fontWeight: 700, letterSpacing: "0.05em", marginBottom: 6 }}>
          תכנון תקציב קליפ
        </div>

        {/* Summary strip */}
        {activeItems.length > 0 && (
          <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
            {[
              { label: "מתוכנן",         value: totalPlanned,  color: "#3B82F6" },
              { label: "הועבר לכספים",   value: totalSynced,   color: "#F59E0B" },
              { label: "שולם",           value: paid,          color: "#10B981" },
              { label: "לא מסונכרן",     value: totalUnsynced, color: "#6B7280" },
            ].map(({ label, value, color }) => value > 0 ? (
              <div key={label} style={{ background: "#1A1A1A", borderRadius: 7, padding: "5px 9px", border: "1px solid #252525" }}>
                <div style={{ fontSize: 9, color: "#555", marginBottom: 1 }}>{label}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color }}>{value.toLocaleString()}₪</div>
              </div>
            ) : null)}
          </div>
        )}

        {/* Item list */}
        {!clipItemsLoaded ? (
          <div style={{ fontSize: 11, color: "#444", marginBottom: 6 }}>טוען...</div>
        ) : activeItems.length === 0 && !addingClipItem ? (
          <div style={{ fontSize: 11, color: "#555", marginBottom: 6 }}>אין פריטי תכנון עדיין</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 6 }}>
            {activeItems.map((item) => {
              const sc = ITEM_STATUS_COLOR[item.status];
              const isPromoting = promotingId === item.id;
              return (
                <div key={item.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", background: "#1A1A1A", borderRadius: 7, border: "1px solid #252525" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: "#CCC" }}>{item.description || item.category || "פריט קליפ"}</div>
                    {item.category && item.description && <div style={{ fontSize: 10, color: "#555" }}>{item.category}</div>}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: sc }}>{item.amount.toLocaleString()}{item.currency}</span>
                    <span style={{ fontSize: 9, fontWeight: 700, color: sc, background: `${sc}18`, border: `1px solid ${sc}35`, borderRadius: 4, padding: "1px 5px" }}>{item.status}</span>
                    {item.status === "תכנון בלבד" && (
                      promotingId === item.id ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <input
                            type="date"
                            value={promotingDate}
                            onChange={(e) => setPromotingDate(e.target.value)}
                            className="rb-session-input"
                            style={{ width: 110, padding: "2px 5px", fontSize: 10 }}
                            autoFocus
                          />
                          <button
                            onClick={() => onPromoteClipItem(item.id, promotingDate)}
                            disabled={!promotingDate}
                            style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 5, border: "1px solid rgba(245,158,11,0.5)", background: promotingDate ? "rgba(245,158,11,0.2)" : "rgba(245,158,11,0.05)", color: promotingDate ? "#F59E0B" : "#666", cursor: promotingDate ? "pointer" : "not-allowed", fontFamily: "inherit" }}
                          >✓</button>
                          <button
                            onClick={onCancelPromote}
                            style={{ fontSize: 11, background: "none", border: "none", color: "#555", cursor: "pointer", padding: "0 2px" }}
                          >✕</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => onStartPromote(item.id)}
                          title="העבר לכספים — יש לבחור תאריך"
                          style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 5, border: "1px solid rgba(245,158,11,0.4)", background: "rgba(245,158,11,0.1)", color: "#F59E0B", cursor: "pointer", fontFamily: "inherit" }}
                        >→ כספים</button>
                      )
                    )}
                    <button
                      onClick={() => onDeleteClipItem(item.id)}
                      style={{ background: "none", border: "none", color: "#555", fontSize: 14, cursor: "pointer", padding: "0 2px" }}
                      onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#EF4444")}
                      onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#555")}
                    >✕</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Add clip item form or button */}
        {addingClipItem ? (
          <ClipItemForm
            draft={clipItemDraft}
            setDraft={setClipItemDraft}
            saving={clipItemSaving}
            onSave={onSaveClipItem}
            onCancel={onCancelClipItem}
          />
        ) : (
          <button
            onClick={onAddClipItem}
            style={{ width: "100%", padding: "7px 0", borderRadius: 9, border: "1px solid rgba(59,130,246,0.3)", background: "rgba(59,130,246,0.07)", color: "#3B82F6", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "rgba(59,130,246,0.14)")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "rgba(59,130,246,0.07)")}
          >
            + הוסף פריט לתכנון
          </button>
        )}
      </div>

      {/* ── Divider ── */}
      <div style={{ height: 1, background: "#1E1E1E", margin: "10px 0" }} />

      {/* ── 2. Filming days ── */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 10, color: "#A855F7", fontWeight: 700, letterSpacing: "0.05em", marginBottom: 6 }}>
          ימי צילום
        </div>
        {filmingSessions.length === 0 && !addingFilmingDay ? (
          <div style={{ fontSize: 11, color: "#555", marginBottom: 6 }}>אין ימי צילום מתוכננים</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 6 }}>
            {filmingSessions.map((s) => {
              const isPast = s.date && s.date < today;
              const statusColor = s.status === "התקיים" ? "#10B981"
                : s.status === "בוטל" || s.status === "נדחה" ? "#6B7280"
                : isPast ? "#F59E0B" : "#3B82F6";
              return (
                <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", background: "#1A1A1A", borderRadius: 7, border: "1px solid #252525" }}>
                  <div>
                    <div style={{ fontSize: 12, color: "#CCC", fontWeight: 600 }}>
                      {s.date ? s.date.split("-").reverse().join("/") : "—"}
                      {s.start_time && <span style={{ color: "#888", fontWeight: 400, marginRight: 6 }}>{s.start_time}{s.end_time ? `–${s.end_time}` : ""}</span>}
                    </div>
                    {(s.photographer || s.location) && (
                      <div style={{ fontSize: 10, color: "#666", marginTop: 1 }}>
                        {s.photographer && <span>📷 {s.photographer}</span>}
                        {s.photographer && s.location && <span style={{ color: "#444" }}> · </span>}
                        {s.location && <span>📍 {s.location}</span>}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: statusColor, background: `${statusColor}18`, border: `1px solid ${statusColor}35`, borderRadius: 5, padding: "1px 6px" }}>
                      {s.status}
                    </span>
                    <button
                      onClick={() => onDeleteFilmingDay(s.id)}
                      title="מחק יום צילום"
                      style={{ background: "none", border: "none", color: "#555", fontSize: 14, cursor: "pointer", padding: "0 2px", lineHeight: 1 }}
                      onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#EF4444")}
                      onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#555")}
                    >✕</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {addingFilmingDay ? (
          <FilmingDayForm
            draft={filmingDraft}
            setDraft={setFilmingDraft}
            saving={filmingSaving}
            onSave={onSaveFilmingDay}
            onCancel={onCancelFilmingDay}
          />
        ) : (
          <button
            onClick={onAddFilmingDay}
            style={{
              width: "100%", padding: "7px 0", borderRadius: 9,
              border: "1px solid rgba(168,85,247,0.3)", background: "rgba(168,85,247,0.07)",
              color: "#A855F7", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "rgba(168,85,247,0.14)")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "rgba(168,85,247,0.07)")}
          >
            🎬 + קבע יום צילום
          </button>
        )}
      </div>

      {/* ── Divider ── */}
      <div style={{ height: 1, background: "#1E1E1E", margin: "10px 0" }} />

      {/* ── Clip expenses ── */}
      <div style={{ fontSize: 10, color: "#F59E0B", fontWeight: 700, letterSpacing: "0.05em", marginBottom: 6 }}>
        הוצאות קליפ
      </div>
      {clipExp.length === 0 ? (
        <div style={{ fontSize: 11, color: "#555", marginBottom: 8 }}>אין עדיין הוצאות קליפ</div>
      ) : (
        <>
          {/* Summary row */}
          <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
            {[
              { label: "שולם", value: paid, color: "#10B981" },
              { label: "צפוי / לא שולם", value: pending, color: "#F59E0B" },
              { label: "סה״כ", value: paid + pending, color: "#F0F0F0" },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ flex: 1, minWidth: 80, background: "#1A1A1A", borderRadius: 8, padding: "8px 10px", border: "1px solid #252525" }}>
                <div style={{ fontSize: 10, color: "#666", marginBottom: 3 }}>{label}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color }}>{value.toLocaleString()}₪</div>
              </div>
            ))}
          </div>
          {/* Expense list */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
            {clipExp.map((t) => {
              const isPaid = PAID.has(t.payment_status);
              return (
                <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", background: "#1A1A1A", borderRadius: 7, border: "1px solid #252525" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: "#CCC" }}>{t.description || t.category || "הוצאת קליפ"}</div>
                    {t.category && t.description && <div style={{ fontSize: 10, color: "#555" }}>{t.category}</div>}
                  </div>
                  <div style={{ textAlign: "left", flexShrink: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: isPaid ? "#10B981" : "#F59E0B" }}>{t.amount.toLocaleString()}{t.currency}</div>
                    <div style={{ fontSize: 10, color: "#555" }}>{t.payment_status}</div>
                  </div>
                  <button onClick={() => onEditTx(t)} style={{ background: "none", border: "none", cursor: "pointer", color: "#888", fontSize: 12, padding: "1px 4px" }} onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#CCC")} onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#888")}>✏</button>
                  <button onClick={() => onDeleteTx(t.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#888", fontSize: 14, padding: "1px 4px" }} onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#EF4444")} onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#888")}>×</button>
                </div>
              );
            })}
          </div>
        </>
      )}
      <button
        onClick={onAddClipExpense}
        style={{
          width: "100%", padding: "7px 0", borderRadius: 9,
          border: "1px solid rgba(245,158,11,0.3)", background: "rgba(245,158,11,0.07)",
          color: "#F59E0B", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
        }}
        onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "rgba(245,158,11,0.14)")}
        onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "rgba(245,158,11,0.07)")}
      >
        ₪ + הוסף הוצאה לקליפ
      </button>
    </CollapsibleCard>
  );
}

// ── Clip item planning form ────────────────────────────────────────────────────

function ClipItemForm({
  draft, setDraft, saving, onSave, onCancel,
}: {
  draft: ClipItemDraft;
  setDraft: (d: ClipItemDraft) => void;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rb-form-card" style={{ marginBottom: 6 }}>
      {/* Category */}
      <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}
        className="rb-session-input" style={{ width: "100%", boxSizing: "border-box" }}>
        <option value="">קטגוריה</option>
        {CLIP_EXPENSE_CATS.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      {/* Description */}
      <input type="text" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        placeholder="ספק / תיאור (יאיר, סטודיו X...)" className="rb-session-input" style={{ width: "100%", boxSizing: "border-box" }} />
      {/* Amount + currency */}
      <div style={{ display: "flex", gap: 6 }}>
        <input type="number" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
          placeholder="סכום" min={0} className="rb-session-input" style={{ flex: 1 }} />
        <select value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value })}
          className="rb-session-input" style={{ width: 50 }}>
          {["₪", "$", "€"].map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      {/* Notes */}
      <input type="text" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
        placeholder="הערות (אופציונלי)" className="rb-session-input" style={{ width: "100%", boxSizing: "border-box" }} />
      {/* Buttons */}
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={onSave} disabled={saving}
          style={{ flex: 1, padding: "7px 0", borderRadius: 8, border: "none", background: saving ? "#1A1A1A" : "#3B82F6", color: saving ? "#555" : "#fff", fontSize: 12, fontWeight: 700, cursor: saving ? "default" : "pointer", fontFamily: "inherit" }}>
          {saving ? "שומר..." : "הוסף לתכנון"}
        </button>
        <button onClick={onCancel}
          style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid #2A2A2A", background: "transparent", color: "#888", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
          ביטול
        </button>
      </div>
    </div>
  );
}

// ── Filming day form ───────────────────────────────────────────────────────────

function FilmingDayForm({
  draft, setDraft, saving, onSave, onCancel,
}: {
  draft: FilmingDayDraft;
  setDraft: (d: FilmingDayDraft) => void;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const hasCost = Number(draft.cost) > 0;

  // ── Calendar conflict check ──────────────────────────────────────────────
  const [conflictCheck, setConflictCheck] = useState<{ conflict: boolean; names: string[] } | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!draft.date || !draft.startTime) { setConflictCheck(null); return; }
    const tid = setTimeout(async () => {
      setChecking(true);
      try {
        // Compute Israel UTC offset for the chosen date (handles DST: +3 summer / +2 winter)
        const ilDate = new Date(`${draft.date}T12:00:00Z`);
        const ilHour = Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Jerusalem", hour: "numeric", hour12: false }).format(ilDate));
        const offsetH = ilHour - 12;
        const offsetStr = `${offsetH >= 0 ? "+" : "-"}${String(Math.abs(offsetH)).padStart(2, "0")}:00`;
        const startISO = `${draft.date}T${draft.startTime}:00${offsetStr}`;
        // End: use endTime if set, else +1h
        let endISO: string;
        if (draft.endTime) {
          endISO = `${draft.date}T${draft.endTime}:00${offsetStr}`;
        } else {
          const [hh, mm] = draft.startTime.split(":").map(Number);
          const eMin = hh * 60 + mm + 60;
          endISO = `${draft.date}T${String(Math.floor(eMin / 60) % 24).padStart(2, "0")}:${String(eMin % 60).padStart(2, "0")}:00${offsetStr}`;
        }
        const res = await fetch("/api/calendar/check-slot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ start: startISO, end: endISO, requiresBuffer: false }),
        });
        const data = await res.json();
        if (data.error) { setConflictCheck(null); return; }
        setConflictCheck({ conflict: data.hardConflict, names: data.conflictNames ?? [] });
      } catch { setConflictCheck(null); }
      finally { setChecking(false); }
    }, 600);
    return () => clearTimeout(tid);
  }, [draft.date, draft.startTime, draft.endTime]);

  return (
    <div className="rb-form-card" style={{ marginBottom: 6 }}>
      {/* Date */}
      <DatePickerInput value={draft.date} onChange={(v) => setDraft({ ...draft, date: v })}
        className="rb-session-input" style={{ width: "100%", boxSizing: "border-box" }} />

      {/* Start + End time */}
      <div style={{ display: "flex", gap: 6 }}>
        <select value={draft.startTime} onChange={(e) => setDraft({ ...draft, startTime: e.target.value })}
          className="rb-session-input" style={{ flex: 1 }}>
          <option value="">שעת התחלה</option>
          {TIME_SLOTS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={draft.endTime} onChange={(e) => setDraft({ ...draft, endTime: e.target.value })}
          className="rb-session-input" style={{ flex: 1 }}>
          <option value="">שעת סיום</option>
          {TIME_SLOTS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {/* Calendar conflict warning */}
      {checking && (
        <div style={{ fontSize: 10, color: "#555", padding: "4px 2px" }}>בודק זמינות ביומן...</div>
      )}
      {!checking && conflictCheck?.conflict && (
        <div style={{
          padding: "8px 10px", borderRadius: 8, fontSize: 11,
          background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#EF4444",
        }}>
          ⚠ התנגשות ביומן{conflictCheck.names.length > 0 ? `: "${conflictCheck.names.join('", "')}"` : ""}
          <div style={{ fontSize: 10, color: "#F87171", marginTop: 2 }}>ניתן לשמור בכל זאת — רק הערה</div>
        </div>
      )}
      {!checking && conflictCheck && !conflictCheck.conflict && draft.date && draft.startTime && (
        <div style={{ fontSize: 10, color: "#10B981", padding: "2px 2px" }}>✓ הזמן פנוי ביומן</div>
      )}

      {/* Photographer */}
      <input type="text" value={draft.photographer} onChange={(e) => setDraft({ ...draft, photographer: e.target.value })}
        placeholder="צלם (יאיר / שלומי / ...)" className="rb-session-input" style={{ width: "100%", boxSizing: "border-box" }} />

      {/* Location */}
      <input type="text" value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })}
        placeholder="לוקיישן / הערות" className="rb-session-input" style={{ width: "100%", boxSizing: "border-box" }} />

      {/* Cost + currency + status */}
      <div style={{ display: "flex", gap: 6 }}>
        <input type="number" value={draft.cost} onChange={(e) => setDraft({ ...draft, cost: e.target.value })}
          placeholder="עלות צילום" min={0} className="rb-session-input" style={{ flex: 1 }} />
        <select value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value })}
          className="rb-session-input" style={{ width: 50 }}>
          {["₪", "$", "€"].map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as SessionStatus })}
          className="rb-session-input" style={{ flex: 1 }}>
          {(["מתוכנן", "התקיים", "בוטל", "נדחה"] as SessionStatus[]).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {/* Checkboxes */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#AAA", cursor: "pointer" }}>
          <input type="checkbox" checked={draft.addToCalendar} onChange={(e) => setDraft({ ...draft, addToCalendar: e.target.checked })}
            style={{ accentColor: "#3B82F6" }} />
          הוסף ליומן Google
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: hasCost ? "#AAA" : "#555", cursor: hasCost ? "pointer" : "not-allowed" }}>
          <input type="checkbox" checked={draft.createExpense && hasCost} disabled={!hasCost}
            onChange={(e) => setDraft({ ...draft, createExpense: e.target.checked })}
            style={{ accentColor: "#F59E0B" }} />
          צור הוצאה מקושרת{hasCost ? "" : " (הכנס עלות)"}
        </label>
      </div>

      {/* Buttons */}
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={onSave} disabled={saving}
          style={{ flex: 1, padding: "7px 0", borderRadius: 8, border: "none", background: saving ? "#1A1A1A" : "#3B82F6", color: saving ? "#555" : "#fff", fontSize: 12, fontWeight: 700, cursor: saving ? "default" : "pointer", fontFamily: "inherit" }}>
          {saving ? "שומר..." : "שמור יום צילום"}
        </button>
        <button onClick={onCancel}
          style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid #2A2A2A", background: "transparent", color: "#888", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
          ביטול
        </button>
      </div>
    </div>
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
        <DatePickerInput value={draft.date} onChange={(v) => setDraft({ ...draft, date: v })}
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
            {(draft.expenseScope === "קליפ" ? CLIP_EXPENSE_CATS : EXPENSE_CATS).map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}
      </div>

      {/* Payment method */}
      <select value={draft.paymentMethod} onChange={(e) => setDraft({ ...draft, paymentMethod: e.target.value })}
        className="rb-session-input" style={{ width: "100%", boxSizing: "border-box" }}>
        <option value="">אמצעי תשלום (אופציונלי)</option>
        {PMT_METHOD_OPTS.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>

      {/* Expense scope — only for expenses */}
      {!isIncome && (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11, color: "#666", flexShrink: 0 }}>שייך ל:</span>
          <select
            value={draft.expenseScope}
            onChange={(e) => setDraft({ ...draft, expenseScope: e.target.value, category: "" })}
            className="rb-session-input"
            style={{ flex: 1 }}
          >
            {EXPENSE_SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      )}

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
      <DatePickerInput
        value={draft.date}
        onChange={(v) => setDraft({ ...draft, date: v })}
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

import type { VendorWork, VictorStatus, SoundEngineerWork } from "@/lib/types";
import { VICTOR_STATUSES, SOUND_ENGINEER_STATUSES, SOUND_ENGINEER_WORK_TYPES } from "@/lib/types";
import { useRef, useCallback, type ChangeEvent } from "react";

function vsColor(s: VictorStatus): string {
  return s === "פעיל" ? "#A855F7" : s === "הושלם" ? "#10B981" : "#555";
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
            <span style={{ fontSize: 10, color: vsColor(work.status), background: `${vsColor(work.status)}18`, border: `1px solid ${vsColor(work.status)}33`, borderRadius: 5, padding: "1px 7px" }}>
              {work.status}
            </span>
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
              {/* Status */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>סטטוס</div>
                <select value={work.status} onChange={(e) => patch({ status: e.target.value as VictorStatus })}
                  style={{ width: "100%", background: "#0D0D0D", border: "1px solid #3A3A3A", borderRadius: 6, color: vsColor(work.status), fontSize: 12, padding: "5px 8px", fontFamily: "inherit" }}>
                  {VICTOR_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
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

// ── Sound Engineer Section (self-contained, lazy-loaded) ─────────────────────

type SoundEngineerDraft = {
  engineerName: string;
  workType: string;
  status: string;
  agreedPrice: string;
  currency: string;
  amountPaid: string;
  sentDate: string;
  internalDeadline: string;
  filesLink: string;
  notes: string;
};

function seStatusColor(s: string): string {
  if (s === "אושר")    return "#10B981";
  if (s === "חזר")     return "#3B82F6";
  if (s === "בתהליך")  return "#F59E0B";
  if (s === "נשלח")    return "#A855F7";
  if (s === "בוטל")    return "#6B7280";
  return "#555";
}

const ENGINEER_SUGGESTIONS = ["Bill", "Steven"];
const CURRENCIES = ["$", "₪", "€"];

function SoundEngineerSection({ project }: { project: { id: string; name: string; artist: string } }) {
  const [open, setOpen]         = useState(false);
  const [work, setWork]         = useState<SoundEngineerWork | null | undefined>(undefined);
  const [loading, setLoading]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const [syncing, setSyncing]   = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [copied, setCopied]     = useState(false);
  const [editingPrice,   setEditingPrice]   = useState(false);
  const [editingPaid,    setEditingPaid]    = useState(false);
  const [priceDraft,     setPriceDraft]     = useState("");
  const [paidDraft,      setPaidDraft]      = useState("");
  const [confirmRemove,  setConfirmRemove]  = useState(false);
  const [removing,       setRemoving]       = useState(false);

  const [draft, setDraft] = useState<SoundEngineerDraft>({
    engineerName: "", workType: "מיקס", status: "לא נשלח",
    agreedPrice: "", currency: "$", amountPaid: "0",
    sentDate: "", internalDeadline: "", filesLink: "", notes: "",
  });

  const load = useCallback(async () => {
    if (work !== undefined) return;
    setLoading(true);
    try {
      const res  = await fetch(`/api/sound-engineer?projectId=${project.id}`);
      const data = await res.json() as { ok: boolean; work: SoundEngineerWork | null };
      const fetched = data.ok ? data.work : null;
      setWork(fetched);
      // Auto-open if a record exists
      if (fetched) setOpen(true);
    } catch {
      setWork(null);
    } finally {
      setLoading(false);
    }
  }, [project.id, work]);

  // Load on mount (not only when opened) so the header badge and auto-open work
  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!draft.engineerName.trim()) { setError("שם איש הסאונד חסר"); return; }
    setCreating(true); setError(null);
    try {
      const res = await fetch("/api/sound-engineer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId:        project.id,
          engineerName:     draft.engineerName.trim(),
          workType:         draft.workType,
          status:           draft.status,
          agreedPrice:      Number(draft.agreedPrice)  || 0,
          currency:         draft.currency,
          amountPaid:       Number(draft.amountPaid)   || 0,
          sentDate:         draft.sentDate             || null,
          internalDeadline: draft.internalDeadline     || null,
          filesLink:        draft.filesLink.trim()     || null,
          notes:            draft.notes,
        }),
      });
      const data = await res.json() as { ok: boolean; work: SoundEngineerWork; error?: string };
      if (!data.ok) throw new Error(data.error ?? "יצירה נכשלה");
      setWork(data.work);
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
      const res = await fetch(`/api/sound-engineer/${work.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      const data = await res.json() as { ok: boolean; work: SoundEngineerWork };
      if (data.ok) setWork(data.work);
    } finally {
      setSaving(false);
    }
  };

  const handleSync = async () => {
    if (!work) return;
    setSyncing(true); setError(null);
    try {
      const res = await fetch(`/api/sound-engineer/${work.id}`, { method: "POST" });
      const data = await res.json() as { ok: boolean; txId: string | null; error?: string };
      if (!data.ok) throw new Error(data.error ?? "סנכרון נכשל");
      if (data.txId) setWork((prev) => prev ? { ...prev, linkedTransactionId: data.txId } : prev);
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה");
    } finally {
      setSyncing(false);
    }
  };

  const handleRemove = async () => {
    if (!work) return;
    setRemoving(true); setError(null);
    try {
      const res = await fetch(`/api/sound-engineer/${work.id}`, { method: "DELETE" });
      const data = await res.json() as { ok: boolean; error?: string };
      if (!data.ok) throw new Error(data.error ?? "הסרה נכשלה");
      setWork(null);
      setConfirmRemove(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה");
    } finally {
      setRemoving(false);
    }
  };

  const copyLink = async () => {
    if (!work?.filesLink) return;
    await navigator.clipboard.writeText(work.filesLink);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  const balance       = work ? Math.max(0, work.agreedPrice - work.amountPaid) : 0;
  const hasTransaction = !!(work?.linkedTransactionId);

  return (
    <div style={{ background: "#1C1C1C", border: "1px solid #252525", borderRadius: 14, marginBottom: 10, overflow: "hidden" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", background: "none", border: "none", cursor: "pointer", textAlign: "right", fontFamily: "inherit" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#60A5FA" }}>🎚 איש סאונד חיצוני</span>
          {work && (
            <>
              <span style={{ fontSize: 10, color: "#888" }}>{work.engineerName}</span>
              <span style={{ fontSize: 10, color: seStatusColor(work.status), background: `${seStatusColor(work.status)}18`, border: `1px solid ${seStatusColor(work.status)}33`, borderRadius: 5, padding: "1px 7px" }}>
                {work.status}
              </span>
              {work.agreedPrice > 0 && balance > 0 && (
                <span style={{ fontSize: 10, color: "#F59E0B", background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.25)", borderRadius: 5, padding: "1px 7px" }}>
                  יתרה {work.currency}{balance}
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
            /* ── CREATE FORM ─────────────────────────────────────────────── */
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 12, color: "#555", marginBottom: 2 }}>הגדר איש סאונד חיצוני לפרויקט זה.</div>

              <div>
                <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>שם איש הסאונד</div>
                <input list="se-names-create" value={draft.engineerName}
                  onChange={(e) => setDraft({ ...draft, engineerName: e.target.value })}
                  placeholder="Bill / Steven / אחר..." className="rb-session-input"
                  style={{ width: "100%", boxSizing: "border-box" }} />
                <datalist id="se-names-create">{ENGINEER_SUGGESTIONS.map((n) => <option key={n} value={n} />)}</datalist>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>סוג עבודה</div>
                  <select value={draft.workType} onChange={(e) => setDraft({ ...draft, workType: e.target.value })} className="rb-session-input" style={{ width: "100%" }}>
                    {SOUND_ENGINEER_WORK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>סטטוס</div>
                  <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })} className="rb-session-input" style={{ width: "100%" }}>
                    {SOUND_ENGINEER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 2 }}>
                  <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>מחיר שסוכם</div>
                  <input type="number" min="0" value={draft.agreedPrice} onChange={(e) => setDraft({ ...draft, agreedPrice: e.target.value })} placeholder="0" className="rb-session-input" style={{ width: "100%", boxSizing: "border-box" }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>מטבע</div>
                  <select value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value })} className="rb-session-input" style={{ width: "100%" }}>
                    {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>תאריך שליחה</div>
                  <input type="date" value={draft.sentDate} onChange={(e) => setDraft({ ...draft, sentDate: e.target.value })} className="rb-session-input" style={{ width: "100%" }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>דדליין פנימי</div>
                  <input type="date" value={draft.internalDeadline} onChange={(e) => setDraft({ ...draft, internalDeadline: e.target.value })} className="rb-session-input" style={{ width: "100%" }} />
                </div>
              </div>

              <div>
                <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>לינק קבצים (Dropbox / Drive)</div>
                <input type="url" value={draft.filesLink} onChange={(e) => setDraft({ ...draft, filesLink: e.target.value })} placeholder="https://..." className="rb-session-input" style={{ width: "100%", boxSizing: "border-box" }} />
              </div>

              <div>
                <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>הערות</div>
                <textarea value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} rows={2}
                  style={{ width: "100%", background: "#0D0D0D", border: "1px solid #3A3A3A", borderRadius: 6, color: "#D0D0D0", fontSize: 12, padding: "6px 8px", fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }} />
              </div>

              {error && <div style={{ fontSize: 11, color: "#EF4444" }}>{error}</div>}

              <button onClick={handleCreate} disabled={creating || !draft.engineerName.trim()}
                style={{ padding: "9px 0", borderRadius: 10, fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: (creating || !draft.engineerName.trim()) ? "default" : "pointer", background: "rgba(96,165,250,0.15)", border: "1px solid rgba(96,165,250,0.35)", color: "#60A5FA", opacity: (creating || !draft.engineerName.trim()) ? 0.55 : 1 }}>
                {creating ? "יוצר..." : "🎚 הגדר איש סאונד"}
              </button>
            </div>

          ) : work ? (
            /* ── RECORD EXISTS ───────────────────────────────────────────── */
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 2 }}>
                  <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>איש סאונד</div>
                  <input list="se-names-edit" defaultValue={work.engineerName}
                    onBlur={(e) => { if (e.target.value !== work.engineerName) patch({ engineerName: e.target.value }); }}
                    className="rb-session-input" style={{ width: "100%", boxSizing: "border-box" }} />
                  <datalist id="se-names-edit">{ENGINEER_SUGGESTIONS.map((n) => <option key={n} value={n} />)}</datalist>
                </div>
                <div style={{ flex: 2 }}>
                  <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>סוג עבודה</div>
                  <select value={work.workType} onChange={(e) => patch({ workType: e.target.value })} className="rb-session-input" style={{ width: "100%" }}>
                    {SOUND_ENGINEER_WORK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>סטטוס</div>
                <select value={work.status} onChange={(e) => patch({ status: e.target.value })}
                  style={{ width: "100%", background: "#0D0D0D", border: "1px solid #3A3A3A", borderRadius: 6, color: seStatusColor(work.status), fontSize: 12, padding: "5px 8px", fontFamily: "inherit" }}>
                  {SOUND_ENGINEER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              {/* Finance */}
              <div style={{ background: "#141414", borderRadius: 10, padding: "10px 12px", display: "flex", gap: 12 }}>
                <div style={{ flex: 1, textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>מחיר שסוכם</div>
                  {editingPrice ? (
                    <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
                      <input autoFocus type="number" min="0" value={priceDraft}
                        onChange={(e) => setPriceDraft(e.target.value)}
                        onBlur={() => { const n = Number(priceDraft); if (!isNaN(n)) patch({ agreedPrice: n }); setEditingPrice(false); }}
                        onKeyDown={(e) => { if (e.key === "Enter") { const n = Number(priceDraft); if (!isNaN(n)) patch({ agreedPrice: n }); setEditingPrice(false); } if (e.key === "Escape") setEditingPrice(false); }}
                        style={{ width: 60, background: "#0D0D0D", border: "1px solid #3B82F6", borderRadius: 5, color: "#E0E0E0", fontSize: 12, padding: "2px 5px", fontFamily: "inherit", textAlign: "center" }}
                      />
                      <select value={work.currency} onChange={(e) => patch({ currency: e.target.value })}
                        style={{ background: "#0D0D0D", border: "1px solid #3A3A3A", borderRadius: 5, color: "#888", fontSize: 11, fontFamily: "inherit" }}>
                        {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
                      </select>
                    </div>
                  ) : (
                    <button onClick={() => { setPriceDraft(String(work.agreedPrice)); setEditingPrice(true); }}
                      style={{ fontSize: 14, fontWeight: 700, color: work.agreedPrice > 0 ? "#E0E0E0" : "#555", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: 0 }}>
                      {work.agreedPrice > 0 ? `${work.currency}${work.agreedPrice}` : "—"}
                    </button>
                  )}
                </div>

                <div style={{ flex: 1, textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>שולם</div>
                  {editingPaid ? (
                    <input autoFocus type="number" min="0" value={paidDraft}
                      onChange={(e) => setPaidDraft(e.target.value)}
                      onBlur={() => { const n = Number(paidDraft); if (!isNaN(n)) patch({ amountPaid: n }); setEditingPaid(false); }}
                      onKeyDown={(e) => { if (e.key === "Enter") { const n = Number(paidDraft); if (!isNaN(n)) patch({ amountPaid: n }); setEditingPaid(false); } if (e.key === "Escape") setEditingPaid(false); }}
                      style={{ width: 70, background: "#0D0D0D", border: "1px solid #3B82F6", borderRadius: 5, color: "#E0E0E0", fontSize: 12, padding: "2px 5px", fontFamily: "inherit", textAlign: "center" }}
                    />
                  ) : (
                    <button onClick={() => { setPaidDraft(String(work.amountPaid)); setEditingPaid(true); }}
                      style={{ fontSize: 14, fontWeight: 700, color: work.amountPaid > 0 ? "#10B981" : "#555", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: 0 }}>
                      {work.amountPaid > 0 ? `${work.currency}${work.amountPaid}` : "₀"}
                    </button>
                  )}
                </div>

                <div style={{ flex: 1, textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>יתרה</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: balance > 0 ? "#F59E0B" : "#10B981" }}>
                    {balance > 0 ? `${work.currency}${balance}` : "✓ סגור"}
                  </div>
                </div>
              </div>

              {/* Transaction sync */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", background: hasTransaction ? "rgba(16,185,129,0.06)" : "rgba(245,158,11,0.06)", border: `1px solid ${hasTransaction ? "rgba(16,185,129,0.2)" : "rgba(245,158,11,0.25)"}`, borderRadius: 8 }}>
                <span style={{ fontSize: 11, color: hasTransaction ? "#10B981" : "#F59E0B" }}>
                  {hasTransaction ? "✓ רשומה כהוצאה בכספים" : "⚠ לא נרשם כהוצאה"}
                </span>
                <button onClick={handleSync} disabled={syncing || work.agreedPrice <= 0}
                  style={{ fontSize: 11, color: "#888", background: "none", border: "none", cursor: work.agreedPrice <= 0 ? "default" : "pointer", fontFamily: "inherit", opacity: work.agreedPrice <= 0 ? 0.4 : 1 }}>
                  {syncing ? "מסנכרן..." : hasTransaction ? "↻ עדכן" : "סנכרן ←"}
                </button>
              </div>

              {/* Dates */}
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>תאריך שליחה</div>
                  <input type="date" key={`sd-${work.id}`} defaultValue={work.sentDate ?? ""}
                    onBlur={(e) => patch({ sentDate: e.target.value || null })} className="rb-session-input" style={{ width: "100%" }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>דדליין פנימי</div>
                  <input type="date" key={`dl-${work.id}`} defaultValue={work.internalDeadline ?? ""}
                    onBlur={(e) => patch({ internalDeadline: e.target.value || null })} className="rb-session-input" style={{ width: "100%" }} />
                </div>
              </div>

              {/* Files link */}
              <div>
                <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>לינק קבצים</div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input type="url" key={`fl-${work.id}`} defaultValue={work.filesLink ?? ""}
                    onBlur={(e) => { if (e.target.value !== (work.filesLink ?? "")) patch({ filesLink: e.target.value || null }); }}
                    placeholder="https://..." className="rb-session-input" style={{ flex: 1, boxSizing: "border-box" }} />
                  {work.filesLink && (
                    <>
                      <button onClick={copyLink} style={{ padding: "0 10px", borderRadius: 7, fontFamily: "inherit", fontSize: 11, cursor: "pointer", background: "#1A1A1A", border: "1px solid #2A2A2A", color: copied ? "#10B981" : "#888" }}>
                        {copied ? "✓" : "📋"}
                      </button>
                      <a href={work.filesLink} target="_blank" rel="noopener noreferrer"
                        style={{ padding: "0 10px", display: "flex", alignItems: "center", borderRadius: 7, fontSize: 11, textDecoration: "none", background: "#1A1A1A", border: "1px solid #2A2A2A", color: "#3B82F6" }}>
                        ↗
                      </a>
                    </>
                  )}
                </div>
              </div>

              {/* Notes */}
              <div>
                <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>הערות</div>
                <textarea key={`notes-${work.id}`} defaultValue={work.notes}
                  onBlur={(e) => { if (e.target.value !== work.notes) patch({ notes: e.target.value }); }}
                  rows={2}
                  style={{ width: "100%", background: "#0D0D0D", border: "1px solid #3A3A3A", borderRadius: 6, color: "#D0D0D0", fontSize: 12, padding: "6px 8px", fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }} />
              </div>

              {saving && <div style={{ fontSize: 11, color: "#555" }}>שומר...</div>}
              {error  && <div style={{ fontSize: 11, color: "#EF4444" }}>{error}</div>}

              {/* Remove button */}
              {!confirmRemove ? (
                <button
                  onClick={() => setConfirmRemove(true)}
                  style={{ marginTop: 4, padding: "6px 12px", borderRadius: 8, fontFamily: "inherit", fontSize: 11, cursor: "pointer", background: "transparent", border: "1px solid #2A2A2A", color: "#555" }}
                >
                  🗑 הסר איש סאונד
                </button>
              ) : (
                <div style={{ marginTop: 4, padding: "10px 12px", background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 10 }}>
                  <div style={{ fontSize: 11, color: "#F87171", marginBottom: 8 }}>האם להסיר את איש הסאונד? הפעולה בלתי הפיכה.</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={handleRemove}
                      disabled={removing}
                      style={{ flex: 1, padding: "6px 0", borderRadius: 8, fontFamily: "inherit", fontSize: 11, fontWeight: 700, cursor: removing ? "wait" : "pointer", background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.35)", color: "#F87171", opacity: removing ? 0.6 : 1 }}
                    >
                      {removing ? "מסיר..." : "כן, הסר"}
                    </button>
                    <button
                      onClick={() => setConfirmRemove(false)}
                      disabled={removing}
                      style={{ flex: 1, padding: "6px 0", borderRadius: 8, fontFamily: "inherit", fontSize: 11, cursor: "pointer", background: "transparent", border: "1px solid #2A2A2A", color: "#555" }}
                    >
                      ביטול
                    </button>
                  </div>
                </div>
              )}
            </div>

          ) : null}
        </div>
      )}
    </div>
  );
}
