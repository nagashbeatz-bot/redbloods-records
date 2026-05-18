"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import type { VictorMonthStats, VendorWork, VictorStatus } from "@/lib/types";
import { VICTOR_STATUSES } from "@/lib/types";
import { useGlobalProjectDrawer } from "@/components/GlobalProjectDrawer";

// ── Helpers ───────────────────────────────────────────────────────────────────

function heMonth(ym: string): string {
  const HE = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
  const [y, m] = ym.split("-");
  return `${HE[parseInt(m, 10) - 1]} ${y}`;
}

function statusColor(s: VictorStatus): string {
  const map: Record<VictorStatus, string> = {
    "לא נשלח":            "#555",
    "נשלח לויקטור":       "#3B82F6",
    "בעבודה אצל ויקטור": "#A855F7",
    "מחכה לקבצים":        "#F59E0B",
    "הוחזר מויקטור":      "#2DD4BF",
    "דורש תיקונים":       "#F59E0B",
    "אושר":               "#10B981",
    "לא רלוונטי":         "#444",
  };
  return map[s] ?? "#888";
}

const STATUS_GROUPS: { label: string; statuses: VictorStatus[] }[] = [
  { label: "פעיל",    statuses: ["נשלח לויקטור", "בעבודה אצל ויקטור", "מחכה לקבצים"] },
  { label: "הוחזר",  statuses: ["הוחזר מויקטור", "דורש תיקונים"] },
  { label: "סגור",   statuses: ["אושר", "לא רלוונטי", "לא נשלח"] },
];

// ── Toast ─────────────────────────────────────────────────────────────────────

function Toast({ msg, onDone }: { msg: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2000);
    return () => clearTimeout(t);
  }, [onDone]);
  return createPortal(
    <div style={{
      position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)",
      background: "#1E1E1E", border: "1px solid #333", borderRadius: 10,
      padding: "9px 20px", fontSize: 13, color: "#D0D0D0", zIndex: 99999,
      boxShadow: "0 4px 20px rgba(0,0,0,0.6)", pointerEvents: "none",
      animation: "fadeInUp 0.2s ease",
    }}>
      {msg}
    </div>,
    document.body
  );
}

// ── Section divider ───────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, color: "#555", letterSpacing: "0.07em",
      textTransform: "uppercase", margin: "18px 0 10px",
      borderTop: "1px solid #252525", paddingTop: 14,
    }}>{children}</div>
  );
}

// ── Stat row ─────────────────────────────────────────────────────────────────

function StatRow({ label, value, color = "#D0D0D0" }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", padding: "5px 0",
      borderBottom: "1px solid #1E1E1E", fontSize: 13,
    }}>
      <span style={{ color: "#666" }}>{label}</span>
      <span style={{ color, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

// ── Work row ─────────────────────────────────────────────────────────────────

interface WorkRowProps {
  work: VendorWork;
  onOpenProject: (id: string) => void;
  onStatusChange: (id: string, status: VictorStatus) => void;
  onToast: (msg: string) => void;
  onRefresh: () => void;
}

function WorkRow({ work, onOpenProject, onStatusChange, onToast, onRefresh }: WorkRowProps) {
  const [statusOpen, setStatusOpen] = useState(false);
  const [menuOpen,   setMenuOpen]   = useState(false);
  const [busy, setBusy]             = useState(false);
  const statusRef = useRef<HTMLDivElement>(null);
  const menuRef   = useRef<HTMLDivElement>(null);
  const col = statusColor(work.status);

  // Close dropdowns on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (statusRef.current && !statusRef.current.contains(e.target as Node)) setStatusOpen(false);
      if (menuRef.current   && !menuRef.current.contains(e.target as Node))   setMenuOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const changeStatus = async (newStatus: VictorStatus) => {
    setStatusOpen(false);
    setBusy(true);
    try {
      await fetch(`/api/vendor/victor/work/${work.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      onStatusChange(work.id, newStatus);
      onToast(`סטטוס עודכן → ${newStatus} ✓`);
      onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const copyLink = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(false);
    if (work.dropboxShareLink) {
      navigator.clipboard.writeText(work.dropboxShareLink).then(() => onToast("לינק הועתק ✓"));
    } else {
      onToast("אין לינק Dropbox לפרויקט זה");
    }
  };

  const openDropbox = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(false);
    if (work.dropboxShareLink) {
      window.open(work.dropboxShareLink, "_blank");
    } else {
      onToast("אין לינק Dropbox לפרויקט זה");
    }
  };

  const quickStatus = async (e: React.MouseEvent, status: VictorStatus) => {
    e.stopPropagation();
    setMenuOpen(false);
    await changeStatus(status);
  };

  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "9px 10px", background: busy ? "#181818" : "#1A1A1A",
      border: "1px solid #252525", borderRadius: 10, marginBottom: 6,
      opacity: busy ? 0.7 : 1, transition: "opacity 0.15s",
    }}>
      {/* Left: project info */}
      <div
        style={{ flex: 1, cursor: "pointer", minWidth: 0 }}
        onClick={() => onOpenProject(work.projectId)}
      >
        <div style={{ fontSize: 13, color: "#D0D0D0", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {work.projectName}{work.artist ? ` — ${work.artist}` : ""}
        </div>
        {work.sentDate && (
          <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>
            נשלח: {work.sentDate.split("-").reverse().join(".")}
            {work.isStuck && <span style={{ color: "#EF4444", marginRight: 8 }}>⚠ תקוע</span>}
          </div>
        )}
      </div>

      {/* Right: status badge (clickable) + 3-dot menu */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, marginRight: 8 }}>

        {/* Status dropdown */}
        <div ref={statusRef} style={{ position: "relative" }}>
          <button
            onClick={(e) => { e.stopPropagation(); setStatusOpen((v) => !v); }}
            style={{
              fontSize: 11, fontWeight: 700, color: col,
              background: `${col}18`, border: `1px solid ${col}40`,
              borderRadius: 6, padding: "3px 8px", cursor: "pointer",
              fontFamily: "inherit", whiteSpace: "nowrap",
            }}
          >
            {work.status} ▾
          </button>
          {statusOpen && (
            <div style={{
              position: "absolute", top: "calc(100% + 4px)", left: 0,
              background: "#1E1E1E", border: "1px solid #333", borderRadius: 10,
              zIndex: 100, minWidth: 180, boxShadow: "0 8px 30px rgba(0,0,0,0.6)",
              overflow: "hidden",
            }}>
              {VICTOR_STATUSES.map((s) => {
                const c = statusColor(s);
                return (
                  <button
                    key={s}
                    onClick={(e) => { e.stopPropagation(); void changeStatus(s); }}
                    style={{
                      width: "100%", textAlign: "right", padding: "8px 12px",
                      background: s === work.status ? "#252525" : "transparent",
                      border: "none", cursor: "pointer", fontSize: 12,
                      color: s === work.status ? c : "#888", fontFamily: "inherit",
                      display: "flex", alignItems: "center", gap: 8,
                    }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: c, flexShrink: 0 }} />
                    {s}
                    {s === work.status && <span style={{ marginRight: "auto", color: "#444" }}>✓</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 3-dot menu */}
        <div ref={menuRef} style={{ position: "relative" }}>
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
            style={{
              background: "none", border: "1px solid #2A2A2A", borderRadius: 6,
              color: "#555", cursor: "pointer", fontSize: 14, padding: "2px 7px",
              lineHeight: 1, fontFamily: "inherit",
            }}
          >⋯</button>
          {menuOpen && (
            <div style={{
              position: "absolute", top: "calc(100% + 4px)", left: 0,
              background: "#1E1E1E", border: "1px solid #333", borderRadius: 10,
              zIndex: 100, minWidth: 190, boxShadow: "0 8px 30px rgba(0,0,0,0.6)",
              overflow: "hidden",
            }}>
              {[
                { label: "פתח פרויקט ↗",     action: (e: React.MouseEvent) => { e.stopPropagation(); setMenuOpen(false); onOpenProject(work.projectId); } },
                { label: "העתק לינק Dropbox", action: copyLink },
                { label: "פתח ב-Dropbox ↗",  action: openDropbox },
                { label: "——", action: null },
                { label: "✓ סמן אושר",        action: (e: React.MouseEvent) => quickStatus(e, "אושר"),          color: "#10B981" },
                { label: "⚠ דורש תיקונים",    action: (e: React.MouseEvent) => quickStatus(e, "דורש תיקונים"), color: "#F59E0B" },
                { label: "↩ הוחזר מויקטור",   action: (e: React.MouseEvent) => quickStatus(e, "הוחזר מויקטור"), color: "#2DD4BF" },
              ].map((item, i) =>
                item.action === null ? (
                  <div key={i} style={{ height: 1, background: "#252525", margin: "2px 0" }} />
                ) : (
                  <button
                    key={i}
                    onClick={item.action}
                    style={{
                      width: "100%", textAlign: "right", padding: "8px 12px",
                      background: "transparent", border: "none", cursor: "pointer",
                      fontSize: 12, color: item.color ?? "#888", fontFamily: "inherit",
                    }}
                  >
                    {item.label}
                  </button>
                )
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Add Project Modal ─────────────────────────────────────────────────────────

interface RawProject { id: string; name: string; artist: string; status: string }

interface AddProjectModalProps {
  existingIds: Set<string>;
  onClose: () => void;
  onAdded: () => void;
  onToast: (msg: string) => void;
}

function AddProjectModal({ existingIds, onClose, onAdded, onToast }: AddProjectModalProps) {
  const [projects,    setProjects]    = useState<RawProject[]>([]);
  const [search,      setSearch]      = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [adding,      setAdding]      = useState<string | null>(null);
  const [createDb,    setCreateDb]    = useState(true);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data: RawProject[]) => setProjects(data))
      .catch(() => {})
      .finally(() => setLoadingList(false));
  }, []);

  const filtered = projects.filter((p) => {
    const q = search.trim();
    if (!q) return true;
    return p.name.includes(q) || (p.artist ?? "").includes(q);
  });

  const todayStr = new Date().toISOString().split("T")[0];

  const addProject = async (project: RawProject) => {
    if (existingIds.has(project.id)) return;
    setAdding(project.id);
    try {
      // 1. Create work record
      const res  = await fetch("/api/vendor/victor/work", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          status:    "נשלח לויקטור",
          sentDate:  todayStr,
        }),
      });
      const body = await res.json() as { ok: boolean; work: { id: string } };
      if (!body.ok) { onToast("שגיאה ביצירת רשומה"); return; }

      // 2. Optionally create Dropbox folder
      if (createDb) {
        try {
          const dbRes = await fetch("/api/dropbox/vendor-folder", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ vendorName: "Victor", artistName: project.artist ?? "", projectName: project.name }),
          });
          const dbData = await dbRes.json() as { folderPath?: string; shareLink?: string };
          if (dbData.folderPath) {
            await fetch(`/api/vendor/victor/work/${body.work.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ dropboxFolder: dbData.folderPath, dropboxShareLink: dbData.shareLink ?? "" }),
            });
          }
        } catch {
          // Dropbox failed — work record still created
          onToast(`${project.name} נוסף לויקטור (ללא Dropbox)`);
          onAdded();
          return;
        }
      }

      onToast(`${project.name} נשלח לויקטור ✓`);
      onAdded();
    } catch {
      onToast("שגיאת רשת");
    } finally {
      setAdding(null);
    }
  };

  return createPortal(
    <div
      style={{ position: "fixed", inset: 0, zIndex: 99998, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}
    >
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.65)" }} />
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative", zIndex: 1, direction: "rtl",
          background: "#141414", border: "1px solid #252525", borderRadius: 16,
          width: "min(520px, 95vw)", maxHeight: "75vh", display: "flex", flexDirection: "column",
          boxShadow: "0 20px 60px rgba(0,0,0,0.8)",
        }}
      >
        {/* Header */}
        <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid #1E1E1E", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#F0F0F0" }}>הוסף פרויקט לויקטור</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#555", fontSize: 18, cursor: "pointer" }}>✕</button>
        </div>

        {/* Search */}
        <div style={{ padding: "12px 20px", borderBottom: "1px solid #1E1E1E" }}>
          <input
            autoFocus
            placeholder="חפש לפי שם פרויקט או אמן..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: "100%", background: "#1A1A1A", border: "1px solid #2A2A2A",
              borderRadius: 8, color: "#D0D0D0", fontSize: 13, padding: "8px 12px",
              fontFamily: "inherit", boxSizing: "border-box",
            }}
          />
        </div>

        {/* Dropbox checkbox */}
        <div style={{ padding: "8px 20px", borderBottom: "1px solid #1E1E1E", display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            id="createDb"
            checked={createDb}
            onChange={(e) => setCreateDb(e.target.checked)}
            style={{ accentColor: "#A855F7", width: 14, height: 14 }}
          />
          <label htmlFor="createDb" style={{ fontSize: 12, color: "#666", cursor: "pointer" }}>
            צור תיקיית Dropbox עכשיו (01_From_Redbloods / 02_From_Victor / 03_Approved)
          </label>
        </div>

        {/* Project list */}
        <div style={{ overflowY: "auto", flex: 1, padding: "8px 20px 16px" }}>
          {loadingList ? (
            <div style={{ color: "#444", fontSize: 13, padding: "20px 0" }}>טוען פרויקטים...</div>
          ) : filtered.length === 0 ? (
            <div style={{ color: "#444", fontSize: 13, padding: "20px 0" }}>לא נמצאו פרויקטים</div>
          ) : (
            filtered.map((p) => {
              const already  = existingIds.has(p.id);
              const isAdding = adding === p.id;
              return (
                <div
                  key={p.id}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "9px 10px", background: "#1A1A1A", border: "1px solid #252525",
                    borderRadius: 10, marginBottom: 6,
                    opacity: already ? 0.45 : 1,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: "#D0D0D0", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.name}{p.artist ? ` — ${p.artist}` : ""}
                    </div>
                    <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>{p.status}</div>
                  </div>
                  <div style={{ flexShrink: 0, marginRight: 8 }}>
                    {already ? (
                      <span style={{ fontSize: 11, color: "#555", background: "#1E1E1E", border: "1px solid #2A2A2A", borderRadius: 6, padding: "3px 8px" }}>
                        כבר אצל ויקטור
                      </span>
                    ) : (
                      <button
                        onClick={() => addProject(p)}
                        disabled={isAdding}
                        style={{
                          fontSize: 12, fontWeight: 700, cursor: isAdding ? "wait" : "pointer",
                          background: "rgba(168,85,247,0.15)", border: "1px solid rgba(168,85,247,0.35)",
                          borderRadius: 7, color: "#A855F7", padding: "4px 12px",
                          fontFamily: "inherit", opacity: isAdding ? 0.6 : 1,
                        }}
                      >
                        {isAdding ? "שולח..." : "שלח לויקטור"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Main drawer ───────────────────────────────────────────────────────────────

interface Props {
  month: string;
  onClose: () => void;
  onStatsRefresh: () => void;
}

export default function VictorDrawer({ month, onClose, onStatsRefresh }: Props) {
  const [stats,   setStats]   = useState<VictorMonthStats | null>(null);
  const [work,    setWork]    = useState<VendorWork[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"מדדים" | "פרויקטים" | "הגדרות">("פרויקטים");
  const { openProject } = useGlobalProjectDrawer();

  const [showAddModal, setShowAddModal] = useState(false);
  const [toast, setToast]   = useState("");

  // Settings edit state
  const [goal,        setGoal]        = useState("");
  const [salary,      setSalary]      = useState("");
  const [salCurrency, setSalCurrency] = useState("$");
  const [payDay,      setPayDay]      = useState("");
  const [stuckDays,   setStuckDays]   = useState("");
  const [payStatus,   setPayStatus]   = useState("צפוי");
  const [saving,      setSaving]      = useState(false);
  const [saveMsg,     setSaveMsg]     = useState("");

  const showToast = useCallback((msg: string) => setToast(msg), []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch(`/api/vendor/victor?month=${month}`);
      const data = await res.json() as { ok: boolean; stats: VictorMonthStats; work: VendorWork[] };
      if (data.ok) {
        setStats(data.stats);
        setWork(data.work);
        setGoal(String(data.stats.goal));
        setSalary(String(data.stats.monthlySalary));
        setSalCurrency(data.stats.salaryCurrency);
        setPayStatus(data.stats.paymentStatus);
      }
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  useEffect(() => {
    fetch("/api/vendor/victor/settings")
      .then((r) => r.json())
      .then((d: { ok: boolean; settings: { stuckAfterDays: number; salaryPayDay: number } }) => {
        if (d.ok) {
          setStuckDays(String(d.settings.stuckAfterDays));
          setPayDay(String(d.settings.salaryPayDay));
        }
      })
      .catch(() => {});
  }, []);

  const handleStatusChange = useCallback((id: string, newStatus: VictorStatus) => {
    setWork((prev) => prev.map((w) => w.id === id ? { ...w, status: newStatus } : w));
  }, []);

  const saveSettings = async () => {
    setSaving(true);
    setSaveMsg("");
    try {
      await fetch("/api/vendor/victor/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          monthlyGoal:    Number(goal),
          monthlySalary:  Number(salary),
          salaryCurrency: salCurrency,
          salaryPayDay:   Number(payDay),
          stuckAfterDays: Number(stuckDays),
        }),
      });
      setSaveMsg("נשמר ✓");
      onStatsRefresh();
    } finally {
      setSaving(false);
    }
  };

  const markPayment = async (status: string) => {
    await fetch(`/api/vendor/victor/settings?payment=${month}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setPayStatus(status);
    onStatsRefresh();
  };

  const grouped = STATUS_GROUPS.map((g) => ({
    ...g,
    items: work.filter((w) => g.statuses.includes(w.status)),
  }));

  const existingIds = new Set(work.map((w) => w.projectId));

  return createPortal(
    <>
      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateX(-50%) translateY(8px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>

      {toast && <Toast msg={toast} onDone={() => setToast("")} />}

      <div
        style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "flex-start", justifyContent: "flex-end" }}
        onClick={onClose}
      >
        <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)" }} />

        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "relative", zIndex: 1,
            width: "min(520px, 100vw)", height: "100dvh",
            background: "#141414", borderLeft: "1px solid #252525",
            display: "flex", flexDirection: "column", overflowY: "auto",
            direction: "rtl",
          }}
        >
          {/* Header */}
          <div style={{
            padding: "18px 20px 14px", borderBottom: "1px solid #252525",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            position: "sticky", top: 0, background: "#141414", zIndex: 10,
          }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#F0F0F0" }}>Victor — כרטיס מלא</div>
              <div style={{ fontSize: 11, color: "#555" }}>{heMonth(month)}</div>
            </div>
            <button onClick={onClose} style={{ background: "none", border: "none", color: "#555", fontSize: 20, cursor: "pointer", lineHeight: 1 }}>✕</button>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", borderBottom: "1px solid #252525", padding: "0 20px" }}>
            {(["פרויקטים", "מדדים", "הגדרות"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  fontFamily: "inherit", fontSize: 13, fontWeight: activeTab === tab ? 700 : 400,
                  color: activeTab === tab ? "#A855F7" : "#555",
                  padding: "10px 14px",
                  borderBottom: activeTab === tab ? "2px solid #A855F7" : "2px solid transparent",
                  marginBottom: -1,
                }}
              >{tab}</button>
            ))}
          </div>

          {/* Content */}
          <div style={{ padding: "16px 20px 40px", flex: 1 }}>
            {loading ? (
              <div style={{ color: "#444", fontSize: 13, padding: 20 }}>טוען...</div>
            ) : (

              // ── פרויקטים ──────────────────────────────────────────────────────
              activeTab === "פרויקטים" ? (
                <>
                  {/* Add project button */}
                  <button
                    onClick={() => setShowAddModal(true)}
                    style={{
                      width: "100%", padding: "9px 0", borderRadius: 10,
                      border: "1px dashed rgba(168,85,247,0.35)", background: "rgba(168,85,247,0.07)",
                      color: "#A855F7", fontSize: 13, fontWeight: 700,
                      cursor: "pointer", fontFamily: "inherit", marginBottom: 16,
                    }}
                  >
                    + שלח פרויקט לויקטור
                  </button>

                  {work.length === 0 ? (
                    <div style={{ color: "#444", fontSize: 13, padding: "8px 0" }}>
                      אין פרויקטים מקושרים לויקטור עדיין
                    </div>
                  ) : (
                    grouped.map((g) =>
                      g.items.length > 0 ? (
                        <div key={g.label}>
                          <SectionTitle>{g.label} ({g.items.length})</SectionTitle>
                          {g.items.map((w) => (
                            <WorkRow
                              key={w.id}
                              work={w}
                              onOpenProject={openProject}
                              onStatusChange={handleStatusChange}
                              onToast={showToast}
                              onRefresh={() => { void fetchData(); onStatsRefresh(); }}
                            />
                          ))}
                        </div>
                      ) : null
                    )
                  )}
                </>
              ) :

              // ── מדדים ─────────────────────────────────────────────────────────
              activeTab === "מדדים" && stats ? (
                <>
                  <div style={{ fontSize: 13, color: "#888", marginBottom: 12 }}>
                    ביטמייקר / מפיק · שכר: {stats.salaryCurrency}{stats.monthlySalary} / חודש
                  </div>

                  <StatRow label="יעד חודשי"          value={`${stats.goal} פרויקטים`} />
                  <StatRow label="נשלחו לויקטור"      value={stats.sent}       color="#3B82F6" />
                  <StatRow label="בעבודה / פעיל"      value={stats.inProgress} color="#A855F7" />
                  <StatRow label="חזרו מויקטור"       value={stats.returned}   color="#2DD4BF" />
                  <StatRow label="אושרו"              value={stats.approved}   color="#10B981" />
                  <StatRow label="דורשים תיקון"       value={stats.needsFix}   color="#F59E0B" />
                  <StatRow label="נכנסו לפרויקט"      value={stats.enteredProject} color="#2DD4BF" />
                  <StatRow label="תקועים"             value={stats.stuck}      color={stats.stuck > 0 ? "#EF4444" : "#555"} />
                  <StatRow label="אחוז הצלחה"         value={`${stats.successRate}%`} color={stats.successRate >= 70 ? "#10B981" : "#F59E0B"} />

                  <SectionTitle>קצב מול יעד</SectionTitle>
                  <div style={{ background: "#1A1A1A", border: "1px solid #252525", borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                      <span style={{ fontSize: 12, color: "#666" }}>אושרו</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: stats.approved >= stats.expectedByNow ? "#10B981" : "#EF4444" }}>
                        {stats.approved} / {stats.expectedByNow} צפוי עד עכשיו
                      </span>
                    </div>
                    <div style={{ height: 6, background: "#252525", borderRadius: 4, overflow: "hidden" }}>
                      <div style={{
                        height: "100%", borderRadius: 4,
                        background: stats.approved >= stats.expectedByNow ? "#10B981" : stats.approved >= stats.expectedByNow * 0.6 ? "#F59E0B" : "#EF4444",
                        width: `${Math.min(100, stats.expectedByNow > 0 ? (stats.approved / stats.expectedByNow) * 100 : 100)}%`,
                      }} />
                    </div>
                    {stats.approved < stats.expectedByNow && (
                      <div style={{ fontSize: 11, color: "#EF4444", marginTop: 6 }}>
                        ⚠ מתחת לקצב — יעד חודשי: {stats.goal}
                      </div>
                    )}
                  </div>

                  <SectionTitle>תשלום {heMonth(month)}</SectionTitle>
                  <div style={{ display: "flex", gap: 8 }}>
                    {["שולם", "צפוי", "לא שולם"].map((s) => (
                      <button
                        key={s}
                        onClick={() => markPayment(s)}
                        style={{
                          flex: 1, padding: "8px 0", borderRadius: 8, fontFamily: "inherit",
                          fontSize: 12, fontWeight: 600, cursor: "pointer",
                          background: payStatus === s ? `${s === "שולם" ? "#10B981" : s === "לא שולם" ? "#EF4444" : "#F59E0B"}22` : "#1A1A1A",
                          border: `1px solid ${payStatus === s ? (s === "שולם" ? "#10B981" : s === "לא שולם" ? "#EF4444" : "#F59E0B") : "#2A2A2A"}`,
                          color: payStatus === s ? (s === "שולם" ? "#10B981" : s === "לא שולם" ? "#EF4444" : "#F59E0B") : "#555",
                        }}
                      >{s}</button>
                    ))}
                  </div>
                </>
              ) :

              // ── הגדרות ─────────────────────────────────────────────────────────
              activeTab === "הגדרות" ? (
                <>
                  <SectionTitle>יעד ומדדים</SectionTitle>
                  {[
                    { label: "יעד חודשי (פרויקטים מאושרים)", val: goal,      set: setGoal,      type: "number" },
                    { label: "ימים עד תקוע",                 val: stuckDays, set: setStuckDays,  type: "number" },
                  ].map(({ label, val, set, type }) => (
                    <div key={label} style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 11, color: "#555", marginBottom: 4 }}>{label}</div>
                      <input
                        type={type}
                        value={val}
                        onChange={(e) => set(e.target.value)}
                        style={{ width: "100%", background: "#1A1A1A", border: "1px solid #2A2A2A", borderRadius: 8, color: "#D0D0D0", fontSize: 13, padding: "7px 10px", fontFamily: "inherit" }}
                      />
                    </div>
                  ))}

                  <SectionTitle>שכר ותשלום</SectionTitle>
                  <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, color: "#555", marginBottom: 4 }}>שכר חודשי</div>
                      <input type="number" value={salary} onChange={(e) => setSalary(e.target.value)}
                        style={{ width: "100%", background: "#1A1A1A", border: "1px solid #2A2A2A", borderRadius: 8, color: "#D0D0D0", fontSize: 13, padding: "7px 10px", fontFamily: "inherit" }} />
                    </div>
                    <div style={{ width: 70 }}>
                      <div style={{ fontSize: 11, color: "#555", marginBottom: 4 }}>מטבע</div>
                      <select value={salCurrency} onChange={(e) => setSalCurrency(e.target.value)}
                        style={{ width: "100%", background: "#1A1A1A", border: "1px solid #2A2A2A", borderRadius: 8, color: "#D0D0D0", fontSize: 13, padding: "7px 6px", fontFamily: "inherit" }}>
                        {["$", "₪", "€", "£"].map((c) => <option key={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>

                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 11, color: "#555", marginBottom: 4 }}>יום תשלום בחודש</div>
                    <input type="number" value={payDay} onChange={(e) => setPayDay(e.target.value)} min={1} max={28}
                      style={{ width: "100%", background: "#1A1A1A", border: "1px solid #2A2A2A", borderRadius: 8, color: "#D0D0D0", fontSize: 13, padding: "7px 10px", fontFamily: "inherit" }} />
                  </div>

                  <button
                    onClick={saveSettings}
                    disabled={saving}
                    style={{
                      width: "100%", padding: "10px 0", borderRadius: 10, fontFamily: "inherit",
                      fontSize: 13, fontWeight: 700, cursor: saving ? "wait" : "pointer",
                      background: "rgba(168,85,247,0.15)", border: "1px solid rgba(168,85,247,0.3)",
                      color: "#A855F7", marginTop: 8, opacity: saving ? 0.7 : 1,
                    }}
                  >{saving ? "שומר..." : "שמור הגדרות"}</button>

                  {saveMsg && <div style={{ fontSize: 12, color: "#10B981", textAlign: "center", marginTop: 8 }}>{saveMsg}</div>}
                </>
              ) : null
            )}
          </div>
        </div>
      </div>

      {showAddModal && (
        <AddProjectModal
          existingIds={existingIds}
          onClose={() => setShowAddModal(false)}
          onAdded={() => { setShowAddModal(false); void fetchData(); onStatsRefresh(); }}
          onToast={showToast}
        />
      )}
    </>,
    document.body
  );
}
