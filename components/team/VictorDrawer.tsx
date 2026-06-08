"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import type { VictorMonthStats, VendorWork, VictorStatus } from "@/lib/types";
import { VICTOR_STATUSES } from "@/lib/types";
import { segmentVictorWork } from "@/lib/victor-segments";
import { useGlobalProjectDrawer } from "@/components/GlobalProjectDrawer";

// ── Helpers ───────────────────────────────────────────────────────────────────

function heMonth(ym: string): string {
  const HE = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
  const [y, m] = ym.split("-");
  return `${HE[parseInt(m, 10) - 1]} ${y}`;
}

function statusColor(s: VictorStatus | null): string {
  return s === "פעיל" ? "#A855F7" : s === "הושלם" ? "#10B981" : "#555";
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function Toast({ msg, onDone }: { msg: string; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 2000); return () => clearTimeout(t); }, [onDone]);
  return createPortal(
    <div style={{
      position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)",
      background: "#1E1E1E", border: "1px solid #333", borderRadius: 10,
      padding: "9px 20px", fontSize: 13, color: "#D0D0D0", zIndex: 99999,
      boxShadow: "0 4px 20px rgba(0,0,0,0.6)", pointerEvents: "none",
    }}>
      {msg}
    </div>,
    document.body
  );
}

// ── Mini badge dropdown ───────────────────────────────────────────────────────

interface BadgeDropdownProps<T extends string> {
  value: T | null;
  options: T[];
  colorFn: (v: T | null) => string;
  placeholder?: string;
  onChange: (v: T) => void;
}

function BadgeDropdown<T extends string>({ value, options, colorFn, placeholder = "—", onChange }: BadgeDropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const col = colorFn(value);

  useEffect(() => {
    function h(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        style={{
          fontSize: 10, fontWeight: 700, color: value ? col : "#444",
          background: value ? `${col}18` : "#1A1A1A",
          border: `1px solid ${value ? `${col}40` : "#2A2A2A"}`,
          borderRadius: 5, padding: "2px 7px", cursor: "pointer",
          fontFamily: "inherit", whiteSpace: "nowrap",
        }}
      >
        {value ?? placeholder} ▾
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", right: 0,
          background: "#1E1E1E", border: "1px solid #333", borderRadius: 10,
          zIndex: 200, minWidth: 170, boxShadow: "0 8px 30px rgba(0,0,0,0.6)",
          overflow: "hidden",
        }}>
          {options.map((o) => {
            const c = colorFn(o);
            return (
              <button
                key={o}
                onClick={(e) => { e.stopPropagation(); onChange(o); setOpen(false); }}
                style={{
                  width: "100%", textAlign: "right", padding: "7px 11px",
                  background: o === value ? "#252525" : "transparent",
                  border: "none", cursor: "pointer", fontSize: 12,
                  color: o === value ? c : "#888", fontFamily: "inherit",
                  display: "flex", alignItems: "center", gap: 7,
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: c, flexShrink: 0 }} />
                {o}
                {o === value && <span style={{ marginRight: "auto", color: "#444", fontSize: 10 }}>✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
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

function StatRow({ label, value, color = "#D0D0D0", active = false, onClick }: {
  label: string; value: string | number; color?: string;
  active?: boolean; onClick?: () => void;
}) {
  const clickable = !!onClick;
  return (
    <div
      onClick={onClick}
      style={{
        display: "flex", justifyContent: "space-between",
        padding: "7px 8px", borderBottom: "1px solid #1E1E1E",
        fontSize: 13, borderRadius: 6,
        background: active ? "rgba(168,85,247,0.08)" : "transparent",
        cursor: clickable ? "pointer" : "default",
        transition: "background 0.12s",
      }}
      onMouseEnter={e => { if (clickable && !active) e.currentTarget.style.background = "#1E1E1E"; }}
      onMouseLeave={e => { e.currentTarget.style.background = active ? "rgba(168,85,247,0.08)" : "transparent"; }}
    >
      <span style={{ color: "#666", display: "flex", alignItems: "center", gap: 6 }}>
        {clickable && <span style={{ fontSize: 9, color: "#555" }}>▶</span>}
        {label}
      </span>
      <span style={{ color, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

// ── Work row ─────────────────────────────────────────────────────────────────

interface WorkRowProps {
  work: VendorWork;
  onOpenProject: (id: string) => void;
  onPatch: (id: string, fields: Record<string, unknown>) => Promise<void>;
  onToast: (msg: string) => void;
}

function WorkRow({ work, onOpenProject, onPatch, onToast }: WorkRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy,     setBusy]     = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function h(e: MouseEvent) { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const patch = async (fields: Record<string, unknown>, toast: string) => {
    setBusy(true);
    try { await onPatch(work.id, fields); onToast(toast); }
    finally { setBusy(false); }
  };

  const copyLink = (e: React.MouseEvent) => {
    e.stopPropagation(); setMenuOpen(false);
    if (work.dropboxShareLink) {
      navigator.clipboard.writeText(work.dropboxShareLink).then(() => onToast("לינק הועתק ✓"));
    } else { onToast("אין לינק Dropbox"); }
  };

  return (
    <div style={{
      padding: "9px 10px", background: busy ? "#181818" : "#1A1A1A",
      border: "1px solid #252525", borderRadius: 10, marginBottom: 6,
      opacity: busy ? 0.7 : 1, transition: "opacity 0.15s",
    }}>
      {/* Line 1: project name (clickable) + 3-dot menu */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 4 }}>
        <div
          style={{ fontSize: 13, color: "#D0D0D0", fontWeight: 600, cursor: "pointer", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          onClick={() => onOpenProject(work.projectId)}
        >
          {work.projectName}{work.artist ? ` — ${work.artist}` : ""}
        </div>

        {/* 3-dot menu */}
        <div ref={menuRef} style={{ position: "relative", flexShrink: 0, marginRight: 6 }}>
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
            style={{ background: "none", border: "1px solid #2A2A2A", borderRadius: 6, color: "#555", cursor: "pointer", fontSize: 13, padding: "1px 6px", lineHeight: 1, fontFamily: "inherit" }}
          >⋯</button>
          {menuOpen && (
            <div style={{
              position: "absolute", top: "calc(100% + 4px)", left: 0,
              background: "#1E1E1E", border: "1px solid #333", borderRadius: 10,
              zIndex: 200, minWidth: 190, boxShadow: "0 8px 30px rgba(0,0,0,0.6)", overflow: "hidden",
            }}>
              {[
                { label: "פתח פרויקט ↗",      action: (e: React.MouseEvent) => { e.stopPropagation(); setMenuOpen(false); onOpenProject(work.projectId); } },
                { label: "העתק לינק Dropbox",  action: copyLink },
                { label: "פתח ב-Dropbox ↗",    action: (e: React.MouseEvent) => { e.stopPropagation(); setMenuOpen(false); if (work.dropboxShareLink) window.open(work.dropboxShareLink, "_blank"); else onToast("אין לינק Dropbox"); } },
                { sep: true },
                { label: "✓ סמן הושלם",        action: (e: React.MouseEvent) => { e.stopPropagation(); setMenuOpen(false); void patch({ status: "הושלם" }, "הושלם ✓"); }, color: "#10B981" },
                { label: "✕ בטל עבודה",        action: (e: React.MouseEvent) => { e.stopPropagation(); setMenuOpen(false); void patch({ status: "בוטל" }, "בוטל"); }, color: "#555" },
              ].map((item, i) =>
                "sep" in item ? (
                  <div key={i} style={{ height: 1, background: "#252525", margin: "2px 0" }} />
                ) : (
                  <button
                    key={i}
                    onClick={item.action}
                    style={{ width: "100%", textAlign: "right", padding: "7px 11px", background: "transparent", border: "none", cursor: "pointer", fontSize: 12, color: item.color ?? "#888", fontFamily: "inherit" }}
                  >{item.label}</button>
                )
              )}
            </div>
          )}
        </div>
      </div>

      {/* Line 2: dates + days */}
      {(work.sentDate || work.isStuck) && (
        <div style={{ fontSize: 11, color: "#555", marginBottom: 6 }}>
          {work.sentDate && `נשלח: ${work.sentDate.split("-").reverse().join(".")}`}
          {work.daysSinceSent !== null && ` · ${work.daysSinceSent} ימים`}
          {work.isStuck && <span style={{ color: "#EF4444", marginRight: 8 }}>⚠ תקוע</span>}
          {work.internalDeadline && <span style={{ marginRight: 8 }}>· דד׳: {work.internalDeadline.split("-").reverse().join(".")}</span>}
        </div>
      )}

      {/* Status badge (clickable dropdown) */}
      <div style={{ display: "flex", gap: 5 }}>
        <BadgeDropdown<VictorStatus>
          value={work.status}
          options={VICTOR_STATUSES}
          colorFn={statusColor}
          onChange={(v) => void patch({ status: v }, `סטטוס → ${v} ✓`)}
        />
        {work.dropboxShareLink && (
          <a href={work.dropboxShareLink} target="_blank" rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{ fontSize: 10, color: "#3B82F6", background: "#3B82F618", border: "1px solid #3B82F630", borderRadius: 5, padding: "2px 7px", textDecoration: "none" }}>
            ↗ Dropbox
          </a>
        )}
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

  const ALLOWED_STATUSES = ["בעבודה", "בהשהייה"];

  const filtered = projects.filter((p) => {
    if (!ALLOWED_STATUSES.includes(p.status)) return false;
    if (existingIds.has(p.id)) return false;
    const q = search.trim();
    return !q || p.name.includes(q) || (p.artist ?? "").includes(q);
  });

  const todayStr = new Date().toISOString().split("T")[0];

  const addProject = async (project: RawProject) => {
    if (existingIds.has(project.id)) return;
    setAdding(project.id);
    try {
      const res  = await fetch("/api/vendor/victor/work", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, status: "פעיל", workState: "נשלח לויקטור", sentDate: todayStr }),
      });
      const body = await res.json() as { ok: boolean; work: { id: string } };
      if (!body.ok) { onToast("שגיאה ביצירת רשומה"); return; }

      if (createDb) {
        try {
          const dbRes  = await fetch("/api/dropbox/vendor-folder", {
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
        } catch { onToast(`${project.name} נוסף (ללא Dropbox)`); onAdded(); return; }
      }

      onToast(`${project.name} נשלח לויקטור ✓`);
      onAdded();
    } catch { onToast("שגיאת רשת"); }
    finally  { setAdding(null); }
  };

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 99998, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
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
        <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid #1E1E1E", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#F0F0F0" }}>שלח פרויקט לויקטור</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#555", fontSize: 18, cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ padding: "12px 20px", borderBottom: "1px solid #1E1E1E" }}>
          <input autoFocus placeholder="חפש לפי שם פרויקט או אמן..." value={search} onChange={(e) => setSearch(e.target.value)}
            style={{ width: "100%", background: "#1A1A1A", border: "1px solid #2A2A2A", borderRadius: 8, color: "#D0D0D0", fontSize: 13, padding: "8px 12px", fontFamily: "inherit", boxSizing: "border-box" }} />
        </div>
        <div style={{ padding: "8px 20px", borderBottom: "1px solid #1E1E1E", display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" id="createDb" checked={createDb} onChange={(e) => setCreateDb(e.target.checked)} style={{ accentColor: "#A855F7", width: 14, height: 14 }} />
          <label htmlFor="createDb" style={{ fontSize: 12, color: "#666", cursor: "pointer" }}>צור תיקיית Dropbox (01_From_Redbloods / 02_From_Victor / 03_Approved)</label>
        </div>
        <div style={{ overflowY: "auto", flex: 1, padding: "8px 20px 16px" }}>
          {loadingList ? (
            <div style={{ color: "#444", fontSize: 13, padding: "20px 0" }}>טוען...</div>
          ) : filtered.length === 0 ? (
            <div style={{ color: "#444", fontSize: 13, padding: "20px 0" }}>אין פרויקטים זמינים לשליחה לויקטור</div>
          ) : filtered.map((p) => {
            const isAdding = adding === p.id;
            return (
              <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 10px", background: "#1A1A1A", border: "1px solid #252525", borderRadius: 10, marginBottom: 6 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: "#D0D0D0", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}{p.artist ? ` — ${p.artist}` : ""}</div>
                  <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>{p.status}</div>
                </div>
                <div style={{ flexShrink: 0, marginRight: 8 }}>
                  <button onClick={() => addProject(p)} disabled={isAdding}
                    style={{ fontSize: 12, fontWeight: 700, cursor: isAdding ? "wait" : "pointer", background: "rgba(168,85,247,0.15)", border: "1px solid rgba(168,85,247,0.35)", borderRadius: 7, color: "#A855F7", padding: "4px 12px", fontFamily: "inherit", opacity: isAdding ? 0.6 : 1 }}>
                    {isAdding ? "שולח..." : "שלח לויקטור"}
                  </button>
                </div>
              </div>
            );
          })}
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
  const [activeTab, setActiveTab] = useState<"פרויקטים" | "מדדים" | "הגדרות">("פרויקטים");
  const { openProject } = useGlobalProjectDrawer();

  const [showAddModal, setShowAddModal] = useState(false);
  const [toast, setToast] = useState("");
  const [drillFilter, setDrillFilter]   = useState<string | null>(null);

  // Settings
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
    } finally { setLoading(false); }
  }, [month]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  useEffect(() => {
    fetch("/api/vendor/victor/settings")
      .then((r) => r.json())
      .then((d: { ok: boolean; settings: { stuckAfterDays: number; salaryPayDay: number } }) => {
        if (d.ok) { setStuckDays(String(d.settings.stuckAfterDays)); setPayDay(String(d.settings.salaryPayDay)); }
      })
      .catch(() => {});
  }, []);

  // Optimistic patch: update local state immediately, fire API in background
  const handlePatch = useCallback((id: string, fields: Record<string, unknown>) => {
    // Update UI immediately — no loading state, no re-fetch
    setWork((prev) => prev.map((w) => w.id === id ? { ...w, ...fields } as VendorWork : w));
    // Fire-and-forget — user never waits
    fetch(`/api/vendor/victor/work/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    }).then(() => onStatsRefresh()).catch(() => {});
    return Promise.resolve();
  }, [onStatsRefresh]);

  const saveSettings = async () => {
    setSaving(true); setSaveMsg("");
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
    } finally { setSaving(false); }
  };

  const markPayment = async (status: string) => {
    await fetch(`/api/vendor/victor/settings?payment=${month}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setPayStatus(status); onStatsRefresh();
  };

  // Group work by primary status
  const active    = work.filter((w) => w.status === "פעיל");
  const completed = work.filter((w) => w.status === "הושלם");
  const cancelled = work.filter((w) => w.status === "בוטל");

  const existingIds = new Set(work.map((w) => w.projectId));

  return createPortal(
    <>
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
            width: "min(540px, 100vw)", height: "100dvh",
            background: "#141414", borderLeft: "1px solid #252525",
            display: "flex", flexDirection: "column", overflowY: "auto",
            direction: "rtl",
          }}
        >
          {/* Header */}
          <div style={{ padding: "18px 20px 14px", borderBottom: "1px solid #252525", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, background: "#141414", zIndex: 10 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#F0F0F0" }}>Victor — כרטיס מלא</div>
              <div style={{ fontSize: 11, color: "#555" }}>{heMonth(month)}</div>
            </div>
            <button onClick={onClose} style={{ background: "none", border: "none", color: "#555", fontSize: 20, cursor: "pointer", lineHeight: 1 }}>✕</button>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", borderBottom: "1px solid #252525", padding: "0 20px" }}>
            {(["פרויקטים", "מדדים", "הגדרות"] as const).map((tab) => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: activeTab === tab ? 700 : 400, color: activeTab === tab ? "#A855F7" : "#555", padding: "10px 14px", borderBottom: activeTab === tab ? "2px solid #A855F7" : "2px solid transparent", marginBottom: -1 }}
              >{tab}</button>
            ))}
          </div>

          {/* Content */}
          <div style={{ padding: "16px 20px 40px", flex: 1 }}>
            {loading ? <div style={{ color: "#444", fontSize: 13, padding: 20 }}>טוען...</div> : (

              // ── פרויקטים ────────────────────────────────────────────────────
              activeTab === "פרויקטים" ? (
                <>
                  <button onClick={() => setShowAddModal(true)}
                    style={{ width: "100%", padding: "9px 0", borderRadius: 10, border: "1px dashed rgba(168,85,247,0.35)", background: "rgba(168,85,247,0.07)", color: "#A855F7", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", marginBottom: 16 }}>
                    + שלח פרויקט לויקטור
                  </button>

                  {work.length === 0 ? (
                    <div style={{ color: "#444", fontSize: 13 }}>אין פרויקטים מקושרים לויקטור עדיין</div>
                  ) : (
                    <>
                      {active.length > 0 && (
                        <>
                          <SectionTitle>פעיל ({active.length})</SectionTitle>
                          {active.map((w) => <WorkRow key={w.id} work={w} onOpenProject={openProject} onPatch={handlePatch} onToast={showToast} />)}
                        </>
                      )}
                      {completed.length > 0 && (
                        <>
                          <SectionTitle>הושלם ({completed.length})</SectionTitle>
                          {completed.map((w) => <WorkRow key={w.id} work={w} onOpenProject={openProject} onPatch={handlePatch} onToast={showToast} />)}
                        </>
                      )}
                      {cancelled.length > 0 && (
                        <>
                          <SectionTitle>בוטל ({cancelled.length})</SectionTitle>
                          {cancelled.map((w) => <WorkRow key={w.id} work={w} onOpenProject={openProject} onPatch={handlePatch} onToast={showToast} />)}
                        </>
                      )}
                    </>
                  )}
                </>
              ) :

              // ── מדדים ───────────────────────────────────────────────────────
              activeTab === "מדדים" && stats ? (
                <>
                  <div style={{ fontSize: 13, color: "#888", marginBottom: 12 }}>ביטמייקר / מפיק · שכר: {stats.salaryCurrency}{stats.monthlySalary} / חודש</div>

                  {(() => {
                    const seg = segmentVictorWork(work, month);
                    const drillMap: Record<string, VendorWork[]> = {
                      "פעילים החודש":        seg.pureActive,
                      "הושלמו החודש":        seg.completed,
                      "בוטלו החודש":         seg.cancelled,
                      "נשלחו החודש":         seg.sentThisMonth,
                      "דורשים בדיקה":        seg.needsReview,
                      "דורשים תיקון":        seg.needsFix,
                      "תקועים (פתוחים)":     seg.stuck,
                      "אושרו":               seg.approved,
                      "נכנסו לפרויקט בפועל": seg.entered,
                    };
                    const toggle = (label: string) =>
                      setDrillFilter(prev => prev === label ? null : label);
                    const drillItems = drillFilter ? (drillMap[drillFilter] ?? []) : [];

                    return (
                      <>
                        <StatRow label="פעילים החודש"        value={stats.active}         color="#A855F7"  active={drillFilter === "פעילים החודש"}        onClick={() => toggle("פעילים החודש")} />
                        <StatRow label="הושלמו החודש"        value={stats.completed}       color="#10B981"  active={drillFilter === "הושלמו החודש"}        onClick={() => toggle("הושלמו החודש")} />
                        <StatRow label="בוטלו החודש"         value={stats.cancelled}       color="#555"     active={drillFilter === "בוטלו החודש"}         onClick={() => toggle("בוטלו החודש")} />
                        <StatRow label="נשלחו החודש"         value={stats.sent}            color="#3B82F6"  active={drillFilter === "נשלחו החודש"}         onClick={() => toggle("נשלחו החודש")} />
                        <StatRow label="דורשים בדיקה"        value={stats.needsReview}     color={stats.needsReview > 0 ? "#F59E0B" : "#555"} active={drillFilter === "דורשים בדיקה"}  onClick={() => toggle("דורשים בדיקה")} />
                        <StatRow label="דורשים תיקון"        value={stats.needsFix}        color={stats.needsFix > 0 ? "#EF4444" : "#555"}    active={drillFilter === "דורשים תיקון"}  onClick={() => toggle("דורשים תיקון")} />
                        <StatRow label="תקועים (פתוחים)"     value={stats.stuck}           color={stats.stuck > 0 ? "#EF4444" : "#555"}       active={drillFilter === "תקועים (פתוחים)"}  onClick={() => toggle("תקועים (פתוחים)")} />
                        <StatRow label="אושרו"               value={stats.approved}        color="#10B981"  active={drillFilter === "אושרו"}               onClick={() => toggle("אושרו")} />
                        <StatRow label="נכנסו לפרויקט בפועל" value={stats.enteredProject}  color="#2DD4BF"  active={drillFilter === "נכנסו לפרויקט בפועל"} onClick={() => toggle("נכנסו לפרויקט בפועל")} />

                        {drillFilter && (
                          <div style={{ marginTop: 14, marginBottom: 4 }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                              <span style={{ fontSize: 12, fontWeight: 700, color: "#A855F7" }}>
                                מציג: {drillFilter} ({drillItems.length})
                              </span>
                              <button
                                onClick={() => setDrillFilter(null)}
                                style={{ fontSize: 11, color: "#555", background: "none", border: "1px solid #333", borderRadius: 6, padding: "2px 8px", cursor: "pointer", fontFamily: "inherit" }}
                              >
                                הצג הכל ✕
                              </button>
                            </div>
                            {drillItems.length === 0 ? (
                              <div style={{ color: "#555", fontSize: 13, padding: "10px 0", textAlign: "center" }}>
                                אין עבודות במדד הזה
                              </div>
                            ) : (
                              drillItems.map(w => (
                                <WorkRow key={w.id} work={w} onOpenProject={openProject} onPatch={handlePatch} onToast={showToast} />
                              ))
                            )}
                          </div>
                        )}
                      </>
                    );
                  })()}

                  <SectionTitle>קצב מול יעד — פעיל + הושלם</SectionTitle>
                  <div style={{ background: "#1A1A1A", border: "1px solid #252525", borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ marginBottom: 8 }}>
                      {(() => {
                        const color = stats.paceValue > stats.expectedByNow ? "#10B981"
                          : stats.paceValue >= stats.expectedByNow * 0.9 ? "#10B981"
                          : stats.paceValue >= stats.expectedByNow * 0.6 ? "#F59E0B"
                          : "#EF4444";
                        const label = stats.paceValue > stats.expectedByNow
                          ? `מעל הקצב — ${stats.paceValue} בפועל מתוך ${stats.expectedByNow} צפוי עד היום`
                          : stats.paceValue >= stats.expectedByNow
                          ? `בקצב טוב — ${stats.paceValue} בפועל מתוך ${stats.expectedByNow} צפוי עד היום`
                          : `מתחת לקצב — ${stats.paceValue} בפועל מתוך ${stats.expectedByNow} צפוי עד היום`;
                        return <span style={{ fontSize: 13, fontWeight: 700, color }}>{label}</span>;
                      })()}
                    </div>
                    <div style={{ height: 6, background: "#252525", borderRadius: 4, overflow: "hidden" }}>
                      <div style={{ height: "100%", borderRadius: 4,
                        background: stats.paceValue >= stats.expectedByNow ? "#10B981" : stats.paceValue >= stats.expectedByNow * 0.6 ? "#F59E0B" : "#EF4444",
                        width: `${Math.min(100, stats.expectedByNow > 0 ? (stats.paceValue / stats.expectedByNow) * 100 : 100)}%` }} />
                    </div>
                    <div style={{ marginTop: 8, fontSize: 11, color: "#444" }}>
                      יעד חודשי: {stats.goal} פרויקטים · הקצב מחושב לפי פעילים + הושלמו בחודש הנוכחי
                    </div>
                  </div>

                  <SectionTitle>תשלום {heMonth(month)}</SectionTitle>
                  <div style={{ display: "flex", gap: 8 }}>
                    {["שולם", "צפוי", "לא שולם"].map((s) => (
                      <button key={s} onClick={() => markPayment(s)}
                        style={{ flex: 1, padding: "8px 0", borderRadius: 8, fontFamily: "inherit", fontSize: 12, fontWeight: 600, cursor: "pointer",
                          background: payStatus === s ? `${s === "שולם" ? "#10B981" : s === "לא שולם" ? "#EF4444" : "#F59E0B"}22` : "#1A1A1A",
                          border: `1px solid ${payStatus === s ? (s === "שולם" ? "#10B981" : s === "לא שולם" ? "#EF4444" : "#F59E0B") : "#2A2A2A"}`,
                          color: payStatus === s ? (s === "שולם" ? "#10B981" : s === "לא שולם" ? "#EF4444" : "#F59E0B") : "#555" }}>
                        {s}
                      </button>
                    ))}
                  </div>
                </>
              ) :

              // ── הגדרות ──────────────────────────────────────────────────────
              activeTab === "הגדרות" ? (
                <>
                  <SectionTitle>יעד ומדדים</SectionTitle>
                  {[
                    { label: "יעד חודשי", val: goal, set: setGoal, type: "number" },
                    { label: "ימים עד תקוע", val: stuckDays, set: setStuckDays, type: "number" },
                  ].map(({ label, val, set, type }) => (
                    <div key={label} style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 11, color: "#555", marginBottom: 4 }}>{label}</div>
                      <input type={type} value={val} onChange={(e) => set(e.target.value)}
                        style={{ width: "100%", background: "#1A1A1A", border: "1px solid #2A2A2A", borderRadius: 8, color: "#D0D0D0", fontSize: 13, padding: "7px 10px", fontFamily: "inherit" }} />
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

                  <button onClick={saveSettings} disabled={saving}
                    style={{ width: "100%", padding: "10px 0", borderRadius: 10, fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: saving ? "wait" : "pointer", background: "rgba(168,85,247,0.15)", border: "1px solid rgba(168,85,247,0.3)", color: "#A855F7", marginTop: 8, opacity: saving ? 0.7 : 1 }}>
                    {saving ? "שומר..." : "שמור הגדרות"}
                  </button>
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
