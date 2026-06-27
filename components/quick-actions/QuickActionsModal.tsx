"use client";

import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { useProjects } from "@/components/ProjectsProvider";
import { ACTIONS, type ActionDef } from "@/lib/action-types";
import ScheduleModal from "@/components/project/ScheduleModal";

// ─── Categories shown in the central "quick actions" grid ──────────────────────
// Only "session" is wired up; the rest are placeholders for the next phase.
interface Category {
  id:     string;
  icon:   string;
  title:  string;
  desc:   string;
  active: boolean;
}

const CATEGORIES: Category[] = [
  { id: "session",        icon: "📅", title: "קבע סשן / פגישה",          desc: "תיאום מועד ביומן ושיוך לפרויקט", active: true  },
  { id: "money-in",       icon: "₪",  title: "כסף נכנס",                 desc: "רישום תשלום, צפוי או גבייה",      active: true  },
  { id: "task",           icon: "📝", title: "משימה / תזכורת",           desc: "משימה כללית עם תאריך",            active: true  },
  { id: "money-out",      icon: "💸", title: "כסף יצא",                  desc: "רישום הוצאה",                    active: false },
  { id: "project-update", icon: "✏️", title: "עדכון פרויקט",             desc: "שינוי סטטוס או פרטים",            active: false },
  { id: "followup",       icon: "📞", title: "פולואפ ללקוח",            desc: "תזכורת ליצירת קשר",              active: false },
  { id: "vendor-task",    icon: "🛠", title: "משימה לספק / איש צוות",    desc: "הקצאת משימה",                    active: false },
  { id: "mix-note",       icon: "🎚", title: "הערת מיקס",               desc: "הערה לסשן מיקס",                 active: false },
  { id: "clip",           icon: "🎬", title: "קליפ / צילום",            desc: "תיאום צילום",                    active: false },
];

interface Props {
  /** Optional project to pre-select (e.g. when opened from within a project). */
  initialProjectId?: string | null;
  onClose: () => void;
}

type Phase = "grid" | "picker" | "schedule" | "money-in" | "task";

// Money-in modes → existing payment_status values (no new statuses).
type MoneyMode = "received" | "expected" | "collect";
const MONEY_MODES: { id: MoneyMode; label: string; status: string; dateLabel: string }[] = [
  { id: "received", label: "קיבלתי עכשיו", status: "התקבל",   dateLabel: "תאריך קבלה" },
  { id: "expected", label: "צפוי להיכנס", status: "צפוי",     dateLabel: "תאריך צפוי" },
  { id: "collect",  label: "צריך לגבות",  status: "לא שולם",  dateLabel: "תאריך גבייה" },
];
type MoneyAssoc = "project" | "general";
const INCOME_CATEGORIES = ["מקדמה", "תשלום חלקי", "תשלום סופי", "תשלום מלא", "תוספת / חריגה", "אחר"];
const MONEY_PAYMENT_METHODS = ["ביט", "העברה בנקאית", "מזומן", "PayPal", "Payoneer", "אשראי", "אחר"];

export default function QuickActionsModal({ initialProjectId, onClose }: Props) {
  const { projects } = useProjects();
  const [phase, setPhase] = useState<Phase>("grid");

  // Placeholder feedback — id of the inactive card the user just tapped.
  const [placeholderId, setPlaceholderId] = useState<string | null>(null);

  // ── Money-in state ──────────────────────────────────────────────────────────
  const todayIsrael = useMemo(
    () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date()),
    [],
  );
  const [moneyMode,  setMoneyMode]  = useState<MoneyMode>("received");
  const [moneyAssoc, setMoneyAssoc] = useState<MoneyAssoc>("project");
  const [amount,     setAmount]     = useState("");
  const [moneyDate,  setMoneyDate]  = useState(todayIsrael);
  const [method,     setMethod]     = useState("");
  const [category,   setCategory]   = useState("");
  const [reason,     setReason]     = useState("");
  const [showsHint,  setShowsHint]  = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [saveError,  setSaveError]  = useState("");
  const [saved,      setSaved]      = useState(false);

  // ── Task / reminder state ───────────────────────────────────────────────────
  const [taskTitle,    setTaskTitle]    = useState("");
  const [taskDate,     setTaskDate]     = useState(todayIsrael);
  const [taskTime,     setTaskTime]     = useState("");
  const [taskNote,     setTaskNote]     = useState("");
  const [taskToGoogle, setTaskToGoogle] = useState(true);
  const [taskSaving,   setTaskSaving]   = useState(false);
  const [taskError,    setTaskError]    = useState("");
  const [taskWarning,  setTaskWarning]  = useState("");
  const [taskSaved,    setTaskSaved]    = useState(false);

  // ── Session-picker state ────────────────────────────────────────────────────
  const [clients, setClients]       = useState<{ name: string }[]>([]);
  const [clientName, setClientName] = useState<string>("");
  const [projectId, setProjectId]   = useState<string>(initialProjectId ?? "");
  const [sessionTitle, setSessionTitle] = useState<string>(""); // manual name for an independent (project-less) session
  const [action, setAction]         = useState<ActionDef>(ACTIONS[0]);

  // Active (non-hidden) projects only, sorted by name for the dropdown.
  const visibleProjects = useMemo(
    () => projects.filter((p) => !p.isHidden).sort((a, b) => a.name.localeCompare(b.name, "he")),
    [projects],
  );

  // Data rule: projects have no client_id — the link is projects.artist === clients.name.
  const filteredProjects = useMemo(
    () => (clientName ? visibleProjects.filter((p) => p.artist === clientName) : visibleProjects),
    [visibleProjects, clientName],
  );

  const selectedProject = useMemo(
    () => visibleProjects.find((p) => p.id === projectId) ?? null,
    [visibleProjects, projectId],
  );

  // Load client names once (read-only; never creates clients).
  useEffect(() => {
    fetch("/api/clients")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.clients)) {
          setClients((d.clients as { name: string }[]).filter((c) => c.name));
        }
      })
      .catch(() => {});
  }, []);

  // If the chosen client no longer contains the selected project, clear it.
  useEffect(() => {
    if (projectId && !filteredProjects.some((p) => p.id === projectId)) {
      setProjectId("");
    }
  }, [filteredProjects, projectId]);

  function handleCardClick(cat: Category) {
    if (!cat.active) { setPlaceholderId(cat.id); return; }
    setPlaceholderId(null);
    if (cat.id === "session")  setPhase("picker");
    if (cat.id === "money-in") setPhase("money-in");
    if (cat.id === "task")     setPhase("task");
  }

  // ── Task: validation + save ──────────────────────────────────────────────────
  const canSaveTask = !!taskTitle.trim() && !!taskDate && !taskSaving;

  function resetTaskForm() {
    setTaskTitle(""); setTaskDate(todayIsrael); setTaskTime(""); setTaskNote("");
    setTaskToGoogle(true); setTaskError(""); setTaskWarning(""); setTaskSaved(false);
  }

  async function saveTask() {
    if (!canSaveTask) return;
    setTaskSaving(true);
    setTaskError("");
    setTaskWarning("");
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title:        taskTitle.trim(),
          related_type: "general",
          related_id:   null,
          status:       "פתוח",
          due_date:     taskDate || null,
          start_time:   taskTime ? `${taskTime}:00` : null,
          notes:        taskNote.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "שגיאה בשמירה");
      const task = data.task as { id: string; title: string };

      // Optional Google Tasks link — reuses the existing Google Tasks flow
      // (NOT the session calendar-event flow). Failure must not lose the task.
      if (taskToGoogle && taskDate) {
        try {
          const gtRes = await fetch("/api/calendar/create-task", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: task.title, due: taskDate, notes: taskNote.trim() || undefined }),
          });
          const gtData = await gtRes.json().catch(() => ({}));
          if (gtRes.ok && gtData.task?.id) {
            await fetch(`/api/tasks/${task.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ calendar_event_id: gtData.task.id }),
            });
          } else {
            setTaskWarning("המשימה נשמרה, אבל לא נוספה ל-Google");
          }
        } catch {
          setTaskWarning("המשימה נשמרה, אבל לא נוספה ל-Google");
        }
      }
      setTaskSaved(true);
    } catch (err) {
      setTaskError(err instanceof Error ? err.message : "שגיאה");
    } finally {
      setTaskSaving(false);
    }
  }

  // ── Money-in: derived validation + save ──────────────────────────────────────
  const moneyStatus  = MONEY_MODES.find((m) => m.id === moneyMode)!.status;
  const amountValid  = !!amount && Number(amount) > 0;
  // project assoc needs a project; general assoc needs a client.
  const assocValid   = moneyAssoc === "general" ? !!clientName : !!selectedProject;
  const canSaveMoney = amountValid && assocValid && !saving;

  function resetMoneyForm(full: boolean) {
    setAmount(""); setReason(""); setCategory(""); setMethod("");
    setMoneyDate(todayIsrael); setSaveError(""); setSaved(false);
    if (full) { setMoneyMode("received"); setMoneyAssoc("project"); setShowsHint(false); }
  }

  async function saveMoney() {
    if (!canSaveMoney) return;
    setSaving(true);
    setSaveError("");
    const isProject  = moneyAssoc === "project";
    const artistName = isProject ? (selectedProject?.artist ?? clientName) : clientName;
    const fallbackDesc =
      moneyMode === "received" ? "תשלום שהתקבל" :
      moneyMode === "expected" ? "תשלום צפוי"   : "גבייה פתוחה";
    // "קיבלתי עכשיו" must always be dated today, even if a stale state lingered.
    const finalDate = moneyMode === "received" ? todayIsrael : (moneyDate || null);
    try {
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope:         isProject ? "project" : "general",
          projectId:     isProject ? selectedProject!.id : null,
          type:          "income",
          date:          finalDate,
          amount:        Number(amount) || 0,
          currency:      "₪",
          paymentStatus: moneyStatus,
          paymentMethod: method,
          category,
          description:   reason.trim() || category || fallbackDesc,
          artist:        artistName,
        }),
      });
      if (!res.ok) throw new Error("שגיאה בשמירה");
      // Same refresh signal QuickTxModal uses.
      document.dispatchEvent(new CustomEvent("rb-finance-updated"));
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "שגיאה");
    } finally {
      setSaving(false);
    }
  }

  // ── Schedule hand-off: reuse ScheduleModal. With a project → as before.
  // Without a project (independent session) → projectName carries the manual
  // title and projectId is empty; ScheduleModal handles both.
  if (phase === "schedule" && (selectedProject || sessionTitle.trim())) {
    return (
      <ScheduleModal
        action={action}
        projectId={selectedProject?.id ?? ""}
        projectName={selectedProject?.name ?? sessionTitle.trim()}
        artist={selectedProject?.artist ?? clientName}
        onClose={onClose}
        onSessionCreated={onClose}
      />
    );
  }

  const modal = (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 100000,
        background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: "#141414", border: "1px solid #262626", borderRadius: 22,
          padding: "26px 24px 22px", width: "100%", maxWidth: 560,
          maxHeight: "90vh", overflowY: "auto",
          direction: "rtl", fontFamily: "inherit",
          boxShadow: "0 24px 64px rgba(0,0,0,0.9)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <div>
            {phase === "picker" || phase === "money-in" || phase === "task" ? (
              <button
                onClick={() => { resetMoneyForm(true); resetTaskForm(); setPhase("grid"); }}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  background: "none", border: "none", padding: 0, marginBottom: 6,
                  color: "#A855F7", fontSize: 11, fontWeight: 700,
                  letterSpacing: "0.07em", textTransform: "uppercase",
                  cursor: "pointer", fontFamily: "inherit",
                }}
              >
                ← חזרה לפעולות מהירות
              </button>
            ) : (
              <div style={{ fontSize: 11, fontWeight: 700, color: "#A855F7", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 6 }}>
                ⚡ פעולות מהירות
              </div>
            )}
            <div style={{ fontSize: 20, fontWeight: 800, color: "#F5F5F5", lineHeight: 1.2 }}>
              {phase === "picker" ? "קבע סשן / פגישה" : phase === "money-in" ? "כסף נכנס" : phase === "task" ? "משימה / תזכורת" : "מה תרצה לעשות?"}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="סגור"
            style={{ background: "none", border: "none", color: "#666", fontSize: 22, cursor: "pointer", fontFamily: "inherit", lineHeight: 1 }}
          >
            ✕
          </button>
        </div>

        {/* ── Grid of categories ── */}
        {phase === "grid" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10 }}>
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => handleCardClick(cat)}
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6,
                    padding: "14px 14px", borderRadius: 14, textAlign: "right",
                    cursor: "pointer", fontFamily: "inherit", transition: "all 0.14s",
                    border: cat.active ? "1.5px solid rgba(168,85,247,0.5)" : "1px solid #242424",
                    background: cat.active ? "rgba(168,85,247,0.10)" : "#191919",
                    opacity: cat.active ? 1 : 0.85,
                  }}
                >
                  <span style={{ fontSize: 22, lineHeight: 1 }}>{cat.icon}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: cat.active ? "#C084FC" : "#D0D0D0" }}>
                    {cat.title}
                  </span>
                  <span style={{ fontSize: 11, color: "#666", lineHeight: 1.4 }}>{cat.desc}</span>
                  {cat.active && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#A855F7", marginTop: 2 }}>פעיל ←</span>
                  )}
                </button>
              ))}
            </div>

            {placeholderId && (
              <div style={{ marginTop: 14, fontSize: 12, color: "#888", textAlign: "center" }}>
                בקרוב — הפעולה הזו תתחבר בשלב הבא
              </div>
            )}
          </>
        )}

        {/* ── Session / meeting picker ── */}
        {phase === "picker" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Client (optional) */}
            <Field label="לקוח (לא חובה)">
              <select
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                style={selectStyle}
              >
                <option value="">כל הלקוחות</option>
                {clients.map((c) => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
              </select>
            </Field>

            {/* Project (optional — leave empty for an independent session) */}
            <Field label="פרויקט (אופציונלי)">
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                style={selectStyle}
              >
                <option value="">בחר פרויקט / סשן עצמאי…</option>
                {filteredProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.artist ? ` — ${p.artist}` : ""}
                  </option>
                ))}
              </select>
              {filteredProjects.length === 0 && (
                <div style={{ fontSize: 11, color: "#F59E0B", marginTop: 6 }}>
                  {clientName ? "אין פרויקטים ללקוח זה." : "אין פרויקטים זמינים."}
                </div>
              )}
            </Field>

            {/* Independent session — manual name shown in-app + in Google Calendar */}
            {!selectedProject && (
              <Field label="שם הסשן / שם שיופיע ביומן *">
                <input
                  value={sessionTitle}
                  onChange={(e) => setSessionTitle(e.target.value)}
                  placeholder="למשל: כתיבה עם שליו"
                  style={selectStyle}
                />
              </Field>
            )}

            {/* Session type */}
            <Field label="סוג סשן / פגישה">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {ACTIONS.map((a) => {
                  const active = a.id === action.id;
                  return (
                    <button
                      key={a.id}
                      onClick={() => setAction(a)}
                      style={{
                        padding: "8px 14px", borderRadius: 100, cursor: "pointer", fontFamily: "inherit",
                        fontSize: 13, fontWeight: active ? 700 : 400,
                        border: `1.5px solid ${active ? "rgba(168,85,247,0.55)" : "#252525"}`,
                        background: active ? "rgba(168,85,247,0.14)" : "#1C1C1C",
                        color: active ? "#C084FC" : "#B0B0B0",
                      }}
                    >
                      {a.label}
                    </button>
                  );
                })}
              </div>
            </Field>

            <div style={{ fontSize: 11, color: "#555", lineHeight: 1.5 }}>
              בשלב הבא נבחר תאריך, שעה ומשך, והסשן יישמר ביומן (ויקושר לפרויקט אם נבחר).
            </div>

            {/* Actions */}
            <div style={{ display: "flex", gap: 10, marginTop: 2 }}>
              {(() => {
                const canProceed = !!selectedProject || sessionTitle.trim().length > 0;
                return (
              <button
                onClick={() => canProceed && setPhase("schedule")}
                disabled={!canProceed}
                style={{
                  padding: "10px 20px", borderRadius: 100, fontFamily: "inherit",
                  fontSize: 13, fontWeight: 600,
                  border: "1.5px solid rgba(168,85,247,0.4)",
                  background: "rgba(168,85,247,0.14)", color: "#C084FC",
                  cursor: canProceed ? "pointer" : "not-allowed",
                  opacity: canProceed ? 1 : 0.4,
                }}
              >
                המשך לקביעת מועד ←
              </button>
                );
              })()}
              <button
                onClick={() => setPhase("grid")}
                style={{
                  padding: "10px 20px", borderRadius: 100, fontFamily: "inherit",
                  fontSize: 13, border: "1.5px solid #383838", background: "#1E1E1E", color: "#999",
                  cursor: "pointer",
                }}
              >
                חזור
              </button>
            </div>
          </div>
        )}

        {/* ── Money-in ── */}
        {phase === "money-in" && (
          saved ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "center", padding: "10px 0" }}>
              <div style={{ fontSize: 40, lineHeight: 1 }}>✅</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#10B981" }}>הכנסה נשמרה בהצלחה</div>
              <div style={{ fontSize: 12, color: "#888", textAlign: "center", lineHeight: 1.6 }}>
                {MONEY_MODES.find((m) => m.id === moneyMode)!.label} · {moneyAssoc === "project" ? (selectedProject?.name ?? "פרויקט") : `כללי · ${clientName}`}
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                <button
                  onClick={() => resetMoneyForm(false)}
                  style={{
                    padding: "10px 20px", borderRadius: 100, fontFamily: "inherit", fontSize: 13, fontWeight: 600,
                    border: "1.5px solid rgba(16,185,129,0.4)", background: "rgba(16,185,129,0.12)", color: "#10B981", cursor: "pointer",
                  }}
                >
                  הוסף עוד
                </button>
                <button
                  onClick={onClose}
                  style={{
                    padding: "10px 20px", borderRadius: 100, fontFamily: "inherit", fontSize: 13,
                    border: "1.5px solid #383838", background: "#1E1E1E", color: "#999", cursor: "pointer",
                  }}
                >
                  סגור
                </button>
              </div>
            </div>
          ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Money mode */}
            <Field label="מצב הכסף">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {MONEY_MODES.map((m) => {
                  const active = m.id === moneyMode;
                  return (
                    <button
                      key={m.id}
                      onClick={() => {
                        setMoneyMode(m.id);
                        // "קיבלתי עכשיו" is money received now → default the date to today
                        // (still editable, so a past date can be entered manually).
                        if (m.id === "received") setMoneyDate(todayIsrael);
                      }}
                      style={pillStyle(active)}
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>
            </Field>

            {/* Association */}
            <Field label="שיוך">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <button onClick={() => { setMoneyAssoc("project"); setShowsHint(false); }} style={pillStyle(moneyAssoc === "project")}>
                  פרויקט
                </button>
                <button onClick={() => { setMoneyAssoc("general"); setShowsHint(false); }} style={pillStyle(moneyAssoc === "general")}>
                  כללי / לקוח
                </button>
                <button
                  onClick={() => setShowsHint(true)}
                  style={{ ...pillStyle(false), opacity: 0.6, cursor: "help" }}
                >
                  הופעה
                </button>
              </div>
              {showsHint && (
                <div style={{ fontSize: 11, color: "#F59E0B", marginTop: 8, lineHeight: 1.5 }}>
                  הכנסות מהופעות יתעדכנו דרך מודול הופעות כדי למנוע כפילות בכספים.
                </div>
              )}
            </Field>

            {/* Client */}
            <Field label={moneyAssoc === "general" ? "לקוח" : "לקוח (לא חובה — לסינון)"}>
              <select value={clientName} onChange={(e) => setClientName(e.target.value)} style={selectStyle}>
                <option value="">{moneyAssoc === "general" ? "בחר לקוח…" : "כל הלקוחות"}</option>
                {clients.map((c) => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
              </select>
            </Field>

            {/* Project (only when assoc=project) */}
            {moneyAssoc === "project" && (
              <Field label="פרויקט">
                <select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={selectStyle}>
                  <option value="">בחר פרויקט…</option>
                  {filteredProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}{p.artist ? ` — ${p.artist}` : ""}
                    </option>
                  ))}
                </select>
                {filteredProjects.length === 0 && (
                  <div style={{ fontSize: 11, color: "#F59E0B", marginTop: 6 }}>
                    {clientName ? "אין פרויקטים ללקוח זה." : "אין פרויקטים זמינים."}
                  </div>
                )}
              </Field>
            )}

            {/* Amount + date */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="סכום (₪)">
                <input
                  type="number" min="0" value={amount} placeholder="0"
                  onChange={(e) => setAmount(e.target.value)}
                  style={selectStyle}
                />
              </Field>
              <Field label={MONEY_MODES.find((m) => m.id === moneyMode)!.dateLabel}>
                {/* "קיבלתי עכשיו" is locked to today — disabled, no picker, no manual edit. */}
                <input
                  type="date"
                  value={moneyMode === "received" ? todayIsrael : moneyDate}
                  onChange={(e) => { if (moneyMode !== "received") setMoneyDate(e.target.value); }}
                  disabled={moneyMode === "received"}
                  readOnly={moneyMode === "received"}
                  style={{
                    ...selectStyle, colorScheme: "dark",
                    ...(moneyMode === "received"
                      ? { opacity: 0.75, cursor: "not-allowed", background: "#0C0C0C", borderColor: "#262626" }
                      : {}),
                  }}
                />
                {moneyMode === "received" && (
                  <div style={{ fontSize: 10, color: "#666", marginTop: 4 }}>🔒 נקבע להיום</div>
                )}
              </Field>
            </div>

            {/* Method + category */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="אמצעי תשלום">
                <select value={method} onChange={(e) => setMethod(e.target.value)} style={selectStyle}>
                  <option value="">בחר…</option>
                  {MONEY_PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </Field>
              <Field label="קטגוריה">
                <select value={category} onChange={(e) => setCategory(e.target.value)} style={selectStyle}>
                  <option value="">בחר…</option>
                  {INCOME_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
            </div>

            {/* Reason / note */}
            <Field label={moneyMode === "collect" ? "סיבת גבייה / הערה" : "הערה"}>
              <input
                type="text" value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={moneyMode === "collect" ? "למשל: לחזור אליו בתאריך, גבייה פתוחה…" : "הערה (אופציונלי)"}
                style={selectStyle}
              />
            </Field>

            {saveError && <div style={{ fontSize: 12, color: "#EF4444", textAlign: "center" }}>{saveError}</div>}

            {/* Actions */}
            <div style={{ display: "flex", gap: 10, marginTop: 2 }}>
              <button
                onClick={saveMoney}
                disabled={!canSaveMoney}
                style={{
                  padding: "10px 20px", borderRadius: 100, fontFamily: "inherit", fontSize: 13, fontWeight: 600,
                  border: "1.5px solid rgba(16,185,129,0.4)", background: "rgba(16,185,129,0.14)", color: "#10B981",
                  cursor: canSaveMoney ? "pointer" : "not-allowed", opacity: canSaveMoney ? 1 : 0.4,
                }}
              >
                {saving ? "שומר…" : "שמור הכנסה"}
              </button>
              <button
                onClick={() => { resetMoneyForm(true); setPhase("grid"); }}
                style={{
                  padding: "10px 20px", borderRadius: 100, fontFamily: "inherit",
                  fontSize: 13, border: "1.5px solid #383838", background: "#1E1E1E", color: "#999", cursor: "pointer",
                }}
              >
                חזור
              </button>
            </div>
          </div>
          )
        )}

        {/* ── Task / reminder ── */}
        {phase === "task" && (
          taskSaved ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 14, alignItems: "center", padding: "10px 0" }}>
              <div style={{ fontSize: 40, lineHeight: 1 }}>✅</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#10B981" }}>המשימה נשמרה בהצלחה</div>
              {taskWarning && (
                <div style={{ fontSize: 12, color: "#F59E0B", textAlign: "center", lineHeight: 1.5 }}>
                  ⚠ {taskWarning}
                </div>
              )}
              <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                <button
                  onClick={resetTaskForm}
                  style={{
                    padding: "10px 20px", borderRadius: 100, fontFamily: "inherit", fontSize: 13, fontWeight: 600,
                    border: "1.5px solid rgba(16,185,129,0.4)", background: "rgba(16,185,129,0.12)", color: "#10B981", cursor: "pointer",
                  }}
                >
                  הוסף עוד
                </button>
                <button
                  onClick={onClose}
                  style={{
                    padding: "10px 20px", borderRadius: 100, fontFamily: "inherit", fontSize: 13,
                    border: "1.5px solid #383838", background: "#1E1E1E", color: "#999", cursor: "pointer",
                  }}
                >
                  סגור
                </button>
              </div>
            </div>
          ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Title */}
            <Field label="מה צריך לעשות?">
              <input
                type="text" value={taskTitle} autoFocus
                onChange={(e) => setTaskTitle(e.target.value)}
                placeholder="כותרת המשימה"
                style={selectStyle}
              />
            </Field>

            {/* Date + time */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="תאריך">
                <input
                  type="date" value={taskDate}
                  onChange={(e) => setTaskDate(e.target.value)}
                  style={{ ...selectStyle, colorScheme: "dark" }}
                />
              </Field>
              <Field label="שעה (אופציונלי)">
                <input
                  type="time" value={taskTime}
                  onChange={(e) => setTaskTime(e.target.value)}
                  style={{ ...selectStyle, colorScheme: "dark" }}
                />
              </Field>
            </div>

            {/* Note */}
            <Field label="הערה (אופציונלי)">
              <input
                type="text" value={taskNote}
                onChange={(e) => setTaskNote(e.target.value)}
                placeholder="הערה (אופציונלי)"
                style={selectStyle}
              />
            </Field>

            {/* Google Tasks checkbox — gated on having a date */}
            <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: taskDate ? "pointer" : "not-allowed", opacity: taskDate ? 1 : 0.5 }}>
              <input
                type="checkbox"
                checked={taskToGoogle && !!taskDate}
                disabled={!taskDate}
                onChange={(e) => setTaskToGoogle(e.target.checked)}
                style={{ width: 16, height: 16, accentColor: "#A855F7", cursor: "inherit", marginTop: 1 }}
              />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: taskToGoogle && taskDate ? "#C084FC" : "#B0B0B0" }}>
                  הוסף ליומן Google
                </div>
                <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>תופיע כמשימה ב-Google</div>
              </div>
            </label>

            {taskError && <div style={{ fontSize: 12, color: "#EF4444", textAlign: "center" }}>{taskError}</div>}

            {/* Actions */}
            <div style={{ display: "flex", gap: 10, marginTop: 2 }}>
              <button
                onClick={saveTask}
                disabled={!canSaveTask}
                style={{
                  padding: "10px 20px", borderRadius: 100, fontFamily: "inherit", fontSize: 13, fontWeight: 600,
                  border: "1.5px solid rgba(16,185,129,0.4)", background: "rgba(16,185,129,0.14)", color: "#10B981",
                  cursor: canSaveTask ? "pointer" : "not-allowed", opacity: canSaveTask ? 1 : 0.4,
                }}
              >
                {taskSaving ? "שומר…" : "שמור משימה"}
              </button>
              <button
                onClick={() => { resetTaskForm(); setPhase("grid"); }}
                style={{
                  padding: "10px 20px", borderRadius: 100, fontFamily: "inherit",
                  fontSize: 13, border: "1.5px solid #383838", background: "#1E1E1E", color: "#999", cursor: "pointer",
                }}
              >
                חזור
              </button>
            </div>
          </div>
          )
        )}
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modal, document.body) : null;
}

// ─── Tiny helpers ───────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "#777", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  width: "100%", padding: "10px 12px", borderRadius: 10,
  border: "1px solid #303030", background: "#111", color: "#E8E8E8",
  fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box",
};

function pillStyle(active: boolean): React.CSSProperties {
  return {
    padding: "8px 14px", borderRadius: 100, cursor: "pointer", fontFamily: "inherit",
    fontSize: 13, fontWeight: active ? 700 : 400,
    border: `1.5px solid ${active ? "rgba(168,85,247,0.55)" : "#252525"}`,
    background: active ? "rgba(168,85,247,0.14)" : "#1C1C1C",
    color: active ? "#C084FC" : "#B0B0B0",
  };
}
