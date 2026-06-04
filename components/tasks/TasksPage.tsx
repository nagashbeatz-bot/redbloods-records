"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import DatePickerInput from "@/components/ui/DatePickerInput";
import { useGlobalProjectDrawer } from "@/components/GlobalProjectDrawer";

// ── Types ─────────────────────────────────────────────────────────────────────

type TaskStatus      = "פתוח" | "בוצע" | "בוטל";
type TaskRelatedType = "general" | "client" | "project";

interface Task {
  id:                string;
  title:             string;
  notes:             string | null;
  status:            TaskStatus;
  related_type:      TaskRelatedType;
  related_id:        string | null;
  due_date:          string | null;
  start_time:        string | null;
  end_time:          string | null;
  calendar_event_id: string | null;
  created_at:        string;
  updated_at:        string;
}

interface NamedItem { id: string; name: string }

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_NEXT: Record<TaskStatus, TaskStatus> = {
  "פתוח":  "בוצע",
  "בוצע":  "בוטל",
  "בוטל":  "פתוח",
};

const STATUS_COLOR: Record<TaskStatus, { bg: string; color: string; border: string }> = {
  "פתוח":  { bg: "rgba(59,130,246,0.12)",  color: "#60A5FA", border: "rgba(59,130,246,0.3)"  },
  "בוצע":  { bg: "rgba(16,185,129,0.12)",  color: "#34D399", border: "rgba(16,185,129,0.3)"  },
  "בוטל":  { bg: "rgba(107,114,128,0.12)", color: "#6B7280", border: "rgba(107,114,128,0.3)" },
};

const RELATED_LABELS: Record<TaskRelatedType, string> = {
  general: "כללי",
  client:  "לקוח",
  project: "פרויקט",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string): string {
  const [y, m, day] = d.split("-");
  return `${parseInt(day, 10)}.${parseInt(m, 10)}.${y}`;
}

function fmtTime(t: string): string {
  return t.slice(0, 5); // "HH:MM"
}

/** Validate HH:MM format (00:00–23:59). Returns error message or null. */
function validateTime(val: string): string | null {
  if (!val) return null;
  if (!/^\d{2}:\d{2}$/.test(val)) return "פורמט שעה לא תקין — השתמש ב-HH:MM";
  const [h, m] = val.split(":").map(Number);
  if (h > 23 || m > 59) return "שעה לא תקינה";
  return null;
}

/**
 * Build a UTC ISO string from a date+time in the user's local timezone.
 * Uses browser local time — correct for Israel including DST (winter UTC+2, summer UTC+3).
 * Matches the approach used by ScheduleModal (Date.toISOString()).
 */
function buildIso(date: string, time: string): string {
  return new Date(`${date}T${time}:00`).toISOString();
}

/** Add minutes to a HH:MM string, returns new HH:MM. */
function addMinutes(time: string, mins: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + mins;
  const nh = Math.floor(total / 60) % 24;
  const nm = total % 60;
  return `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`;
}

const inp: React.CSSProperties = {
  width: "100%", padding: "7px 10px", borderRadius: 8,
  border: "1px solid #2A2A2A", background: "#111", color: "#E0E0E0",
  fontSize: 12, fontFamily: "inherit", outline: "none", boxSizing: "border-box",
  colorScheme: "dark" as React.CSSProperties["colorScheme"],
};

// ── Quick-create form ─────────────────────────────────────────────────────────

interface FormState {
  title:          string;
  notes:          string;
  related_type:   TaskRelatedType;
  related_id:     string;
  due_date:       string;
  start_time:     string;
  addToCalendar:  boolean;
}

const EMPTY_FORM: FormState = {
  title: "", notes: "", related_type: "general",
  related_id: "", due_date: "", start_time: "", addToCalendar: false,
};

type CalStatus = null | "checking" | "creating";

function TaskForm({ clients, projects, onSaved, onClose }: {
  clients:  NamedItem[];
  projects: NamedItem[];
  onSaved:  (t: Task) => void;
  onClose:  () => void;
}) {
  const [form,        setForm]        = useState<FormState>({ ...EMPTY_FORM });
  const [saving,      setSaving]      = useState(false);
  const [calStatus,   setCalStatus]   = useState<CalStatus>(null);
  const [error,       setError]       = useState<string | null>(null);
  const [timeError,   setTimeError]   = useState<string | null>(null);
  // task created but calendar event failed — waiting for user to acknowledge
  const [pendingTask, setPendingTask] = useState<Task | null>(null);

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => {
      const next = { ...f, [k]: v };
      if (k === "related_type") next.related_id = "";
      // uncheck calendar if date/time cleared
      if ((k === "due_date" || k === "start_time") && !v) next.addToCalendar = false;
      return next;
    });
    if (k === "start_time") setTimeError(null);
  }

  const canAddToCalendar = !!(form.due_date && form.start_time && !timeError);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { setError("כותרת חובה"); return; }
    if ((form.related_type === "client" || form.related_type === "project") && !form.related_id) {
      setError(`חובה לבחור ${RELATED_LABELS[form.related_type]}`);
      return;
    }
    const tErr = validateTime(form.start_time);
    if (tErr) { setTimeError(tErr); return; }

    setSaving(true); setError(null);
    try {
      // ── 1. If "הוסף ליומן": check slot BEFORE creating task ──────────────
      if (form.addToCalendar && canAddToCalendar) {
        const startIso = buildIso(form.due_date, form.start_time);
        const endTime  = addMinutes(form.start_time, 30);
        const endIso   = buildIso(form.due_date, endTime);

        setCalStatus("checking");
        const slotRes = await fetch("/api/calendar/check-slot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ start: startIso, end: endIso, requiresBuffer: false }),
        });
        const slotData = await slotRes.json();

        if (slotData.error === "not_connected") {
          setError("היומן לא מחובר. הסר את הסימון 'הוסף ליומן' או התחבר ליומן תחילה.");
          setSaving(false); setCalStatus(null); return;
        }
        if (slotData.hardConflict || (slotData.conflictNames?.length ?? 0) > 0) {
          const name = slotData.conflictNames?.[0] ?? "אירוע קיים";
          setError(`יש לך כבר משהו בזמן הזה: "${name}". לבחור שעה אחרת?`);
          setSaving(false); setCalStatus(null); return;
        }
      }

      // ── 2. Create task ────────────────────────────────────────────────────
      const taskRes = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title:        form.title.trim(),
          notes:        form.notes.trim() || null,
          related_type: form.related_type,
          related_id:   form.related_id   || null,
          due_date:     form.due_date     || null,
          start_time:   form.start_time   || null,
        }),
      });
      const taskData = await taskRes.json();
      if (!taskRes.ok) throw new Error(taskData.error ?? "שגיאה ביצירת משימה");
      let task: Task = taskData.task;

      // ── 3. If "הוסף ליומן": create event + patch task ────────────────────
      if (form.addToCalendar && canAddToCalendar) {
        setCalStatus("creating");
        try {
          const startIso = buildIso(form.due_date, form.start_time);
          const endIso   = buildIso(form.due_date, addMinutes(form.start_time, 30));

          const evRes = await fetch("/api/calendar/create-event", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ summary: task.title, start: startIso, end: endIso }),
          });
          const evData = await evRes.json();

          if (evRes.ok && evData.event?.id) {
            const patchRes = await fetch(`/api/tasks/${task.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ calendar_event_id: evData.event.id }),
            });
            const patchData = await patchRes.json();
            if (patchRes.ok) task = patchData.task;
          } else {
            // create-event returned an error — task saved, calendar not
            setSaving(false); setCalStatus(null);
            setPendingTask(task);
            setError("המשימה נוצרה, אבל לא נוספה ליומן");
            return;
          }
        } catch {
          // Network/unexpected error — task saved, calendar not
          setSaving(false); setCalStatus(null);
          setPendingTask(task);
          setError("המשימה נוצרה, אבל לא נוספה ליומן");
          return;
        }
      }

      onSaved(task);
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה");
    } finally {
      setSaving(false); setCalStatus(null);
    }
  }

  const calLabel = calStatus === "checking" ? "בודק זמינות..."
                 : calStatus === "creating"  ? "יוצר אירוע..."
                 : "שומר...";

  return (
    <form
      onSubmit={handleSubmit}
      style={{ background: "#111", border: "1px solid #2A2A2A", borderRadius: 14, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10, marginBottom: 4 }}
      dir="rtl"
    >
      <div style={{ fontSize: 11, fontWeight: 700, color: "#555", textTransform: "uppercase", letterSpacing: "0.07em" }}>
        משימה חדשה
      </div>

      {/* כותרת */}
      <input
        autoFocus
        value={form.title}
        onChange={(e) => set("title", e.target.value)}
        placeholder="כותרת המשימה *"
        style={inp}
        disabled={saving}
      />

      {/* שיוך */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div>
          <div style={{ fontSize: 10, color: "#555", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>קשור ל</div>
          <select value={form.related_type} onChange={(e) => set("related_type", e.target.value as TaskRelatedType)} style={inp} disabled={saving}>
            <option value="general">כללי</option>
            <option value="client">לקוח</option>
            <option value="project">פרויקט</option>
          </select>
        </div>

        {form.related_type === "client" && (
          <div>
            <div style={{ fontSize: 10, color: "#555", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>לקוח *</div>
            <select value={form.related_id} onChange={(e) => set("related_id", e.target.value)} style={inp} disabled={saving}>
              <option value="">— בחר לקוח —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}

        {form.related_type === "project" && (
          <div>
            <div style={{ fontSize: 10, color: "#555", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>פרויקט *</div>
            <select value={form.related_id} onChange={(e) => set("related_id", e.target.value)} style={inp} disabled={saving}>
              <option value="">— בחר פרויקט —</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        )}

        {form.related_type === "general" && (
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <div style={{ fontSize: 11, color: "#333", padding: "7px 0" }}>ללא שיוך ספציפי</div>
          </div>
        )}
      </div>

      {/* תאריך + שעה */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div>
          <div style={{ fontSize: 10, color: "#555", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>תאריך</div>
          <DatePickerInput value={form.due_date} onChange={(v) => set("due_date", v)} placeholder="אופציונלי" style={inp} />
        </div>
        <div>
          <div style={{ fontSize: 10, color: "#555", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>שעה</div>
          <input
            type="text"
            value={form.start_time}
            onChange={(e) => set("start_time", e.target.value)}
            onBlur={() => { const err = validateTime(form.start_time); setTimeError(err); }}
            placeholder="14:00"
            maxLength={5}
            style={{ ...inp, borderColor: timeError ? "#EF4444" : "#2A2A2A" }}
            disabled={saving}
          />
          {timeError && <div style={{ fontSize: 10, color: "#EF4444", marginTop: 3 }}>{timeError}</div>}
        </div>
      </div>

      {/* הוסף ליומן */}
      <div>
        {canAddToCalendar ? (
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={form.addToCalendar}
              onChange={(e) => set("addToCalendar", e.target.checked)}
              disabled={saving}
              style={{ width: 14, height: 14, accentColor: "#2563EB", cursor: "pointer" }}
            />
            <span style={{ fontSize: 12, color: form.addToCalendar ? "#60A5FA" : "#666" }}>
              📅 הוסף ליומן Google
            </span>
          </label>
        ) : (form.due_date || form.start_time) ? (
          <div style={{ fontSize: 11, color: "#333" }}>
            כדי להוסיף ליומן — צריך לבחור גם תאריך וגם שעה
          </div>
        ) : null}
      </div>

      {/* הערות */}
      <div>
        <div style={{ fontSize: 10, color: "#555", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>הערות</div>
        <textarea
          value={form.notes}
          onChange={(e) => set("notes", e.target.value)}
          placeholder="הערות אופציונליות..."
          rows={2}
          style={{ ...inp, resize: "none", lineHeight: 1.5 }}
          disabled={saving}
        />
      </div>

      {error && (
        <div style={{ fontSize: 11, lineHeight: 1.4, color: pendingTask ? "#FBBF24" : "#EF4444" }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" onClick={onClose} disabled={saving}
          style={{ padding: "7px 14px", borderRadius: 9, border: "1px solid #2A2A2A", background: "none", color: "#555", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
          ביטול
        </button>

        {/* If calendar failed but task saved — show acknowledge button */}
        {pendingTask ? (
          <button
            type="button"
            onClick={() => { onSaved(pendingTask); setPendingTask(null); }}
            style={{ padding: "7px 16px", borderRadius: 9, border: "1px solid rgba(245,158,11,0.4)", background: "rgba(245,158,11,0.1)", color: "#FBBF24", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
          >
            הוסף לרשימה ✓
          </button>
        ) : (
          <button type="submit" disabled={saving || !form.title.trim()}
            style={{ padding: "7px 16px", borderRadius: 9, border: "none", background: saving ? "#1E3A5F" : "#2563EB", color: saving ? "#4A7FC0" : "#FFF", fontSize: 12, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
            {saving ? calLabel : "הוסף משימה"}
          </button>
        )}
      </div>
    </form>
  );
}

// ── Task row ──────────────────────────────────────────────────────────────────

function TaskRow({ task, relatedName, today }: {
  task:        Task;
  relatedName: string | null;
  today:       string;
}) {
  const { openProject }  = useGlobalProjectDrawer();
  const router           = useRouter();
  const [cycling, setCycling] = useState(false);
  const [localStatus, setLocalStatus] = useState<TaskStatus>(task.status);

  const sc       = STATUS_COLOR[localStatus];
  const isOverdue = task.due_date && task.due_date < today && localStatus === "פתוח";

  async function cycleStatus() {
    if (cycling) return;
    setCycling(true);
    const next = STATUS_NEXT[localStatus];
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (res.ok) setLocalStatus(next);
    } catch { /* ignore */ }
    finally { setCycling(false); }
  }

  function handleRelatedClick() {
    if (!task.related_id) return;
    if (task.related_type === "project") {
      openProject(task.related_id);
    } else if (task.related_type === "client") {
      router.push(`/clients?open=${task.related_id}`);
    }
  }

  return (
    <div
      style={{
        background: "#1A1A1A",
        border: `1px solid ${isOverdue ? "rgba(239,68,68,0.2)" : "#252525"}`,
        borderRadius: 10, padding: "10px 12px", direction: "rtl",
        opacity: localStatus === "בוטל" ? 0.5 : 1,
        transition: "opacity 150ms",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        {/* Status cycle button */}
        <button
          onClick={cycleStatus}
          disabled={cycling}
          title={`לחץ לשינוי סטטוס → ${STATUS_NEXT[localStatus]}`}
          style={{
            flexShrink: 0, marginTop: 1,
            padding: "2px 8px", borderRadius: 20,
            background: sc.bg, color: sc.color,
            border: `1px solid ${sc.border}`,
            fontSize: 10, fontWeight: 600,
            cursor: cycling ? "not-allowed" : "pointer",
            fontFamily: "inherit", whiteSpace: "nowrap",
            transition: "opacity 150ms",
            opacity: cycling ? 0.6 : 1,
          }}
        >
          {localStatus}
        </button>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13, fontWeight: 500, lineHeight: 1.3,
            textDecoration: localStatus === "בוצע" ? "line-through" : "none",
            color: localStatus === "בוטל" ? "#555" : localStatus === "בוצע" ? "#888" : "#D8D8D8",
          }}>
            {task.title}
          </div>

          {/* Meta row */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px", marginTop: 4, fontSize: 11, alignItems: "center" }}>
            {/* Related — clickable */}
            {relatedName && task.related_id && (
              <button
                onClick={handleRelatedClick}
                style={{
                  background: "none", border: "none", padding: 0,
                  fontFamily: "inherit", fontSize: 11,
                  color: task.related_type === "client" ? "#C084FC" : "#60A5FA",
                  cursor: "pointer", textDecoration: "underline", textDecorationStyle: "dotted",
                }}
              >
                {task.related_type === "client" ? "👤" : "♫"} {relatedName}
              </button>
            )}

            {/* Due date */}
            {task.due_date && (
              <span style={{ color: isOverdue ? "#F87171" : task.due_date === today ? "#FBBF24" : "#555" }}>
                {isOverdue && "⚠ "}
                {task.due_date === today && "📌 "}
                {fmtDate(task.due_date)}
                {task.start_time && ` · ${fmtTime(task.start_time)}`}
              </span>
            )}

            {/* Calendar indicator */}
            {task.calendar_event_id && (
              <span title="מקושר ליומן Google" style={{ color: "#4A4A4A", fontSize: 11 }}>📅</span>
            )}
          </div>

          {/* Notes */}
          {task.notes && (
            <div style={{ fontSize: 11, color: "#444", marginTop: 5, lineHeight: 1.4 }}>{task.notes}</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Filter tabs ───────────────────────────────────────────────────────────────

type FilterTab = "הכל" | "פתוח" | "בוצע" | "בוטל";
const FILTER_TABS: FilterTab[] = ["הכל", "פתוח", "בוצע", "בוטל"];

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TasksPage() {
  const today = new Date().toISOString().split("T")[0];

  const [tasks,    setTasks]    = useState<Task[]>([]);
  const [clients,  setClients]  = useState<NamedItem[]>([]);
  const [projects, setProjects] = useState<NamedItem[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [filter,   setFilter]   = useState<FilterTab>("פתוח");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tRes, cRes, pRes] = await Promise.all([
        fetch("/api/tasks"),
        fetch("/api/clients"),
        fetch("/api/projects"),
      ]);
      const [tData, cData, pData] = await Promise.all([
        tRes.json(), cRes.json(), pRes.json(),
      ]);
      setTasks(tData.tasks ?? []);
      setClients((cData.clients ?? []).map((c: { id: string; name: string }) => ({ id: c.id, name: c.name })));
      const projArr: { id: string; name: string }[] = Array.isArray(pData) ? pData : (pData.projects ?? []);
      setProjects(projArr.map((p) => ({ id: p.id, name: p.name })));
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const clientMap  = new Map(clients.map((c) => [c.id, c.name]));
  const projectMap = new Map(projects.map((p) => [p.id, p.name]));

  function getRelatedName(task: Task): string | null {
    if (!task.related_id) return null;
    if (task.related_type === "client")  return clientMap.get(task.related_id)  ?? null;
    if (task.related_type === "project") return projectMap.get(task.related_id) ?? null;
    return null;
  }

  const filtered = tasks.filter((t) => filter === "הכל" || t.status === filter);

  const counts: Record<FilterTab, number> = {
    "הכל":  tasks.length,
    "פתוח": tasks.filter((t) => t.status === "פתוח").length,
    "בוצע": tasks.filter((t) => t.status === "בוצע").length,
    "בוטל": tasks.filter((t) => t.status === "בוטל").length,
  };

  function handleSaved(task: Task) {
    setTasks((prev) => [task, ...prev]);
    setShowForm(false);
    setFilter("פתוח");
  }

  const sorted = [...filtered].sort((a, b) => {
    const aOver = a.due_date && a.due_date < today && a.status === "פתוח" ? 0 : 1;
    const bOver = b.due_date && b.due_date < today && b.status === "פתוח" ? 0 : 1;
    if (aOver !== bOver) return aOver - bOver;
    if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
    if (a.due_date) return -1;
    if (b.due_date) return 1;
    return b.created_at.localeCompare(a.created_at);
  });

  const overdueCount = tasks.filter(
    (t) => t.due_date && t.due_date < today && t.status === "פתוח"
  ).length;

  return (
    <div className="px-3 py-3 md:px-6 md:py-8 max-w-3xl mx-auto" dir="rtl" style={{ minHeight: "100dvh" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#E0E0E0", margin: 0 }}>משימות</h1>
          <div style={{ fontSize: 12, color: "#555", marginTop: 2 }}>
            {counts["פתוח"]} פתוחות
            {overdueCount > 0 && (
              <span style={{ color: "#F87171", marginRight: 8 }}>· {overdueCount} באיחור</span>
            )}
          </div>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "8px 14px", borderRadius: 10,
            border: showForm ? "1.5px solid rgba(59,130,246,0.5)" : "1px solid rgba(59,130,246,0.3)",
            background: showForm ? "rgba(59,130,246,0.2)" : "rgba(59,130,246,0.1)",
            color: "#60A5FA", fontSize: 12, fontWeight: 600,
            cursor: "pointer", fontFamily: "inherit",
          }}
        >
          {showForm ? "✕ סגור" : "+ משימה חדשה"}
        </button>
      </div>

      {/* Quick create form */}
      {showForm && (
        <div style={{ marginBottom: 16 }}>
          <TaskForm clients={clients} projects={projects} onSaved={handleSaved} onClose={() => setShowForm(false)} />
        </div>
      )}

      {/* Filter tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {FILTER_TABS.map((tab) => {
          const active = filter === tab;
          return (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              style={{
                padding: "5px 12px", borderRadius: 20,
                border: active ? "1px solid rgba(59,130,246,0.5)" : "1px solid #252525",
                background: active ? "rgba(59,130,246,0.15)" : "#1A1A1A",
                color: active ? "#60A5FA" : "#555",
                fontSize: 12, fontWeight: active ? 600 : 400,
                cursor: "pointer", fontFamily: "inherit", transition: "all 120ms",
              }}
            >
              {tab}
              {counts[tab] > 0 && <span style={{ marginRight: 5, fontSize: 10, opacity: 0.7 }}>({counts[tab]})</span>}
            </button>
          );
        })}
      </div>

      {/* Task list */}
      {loading ? (
        <div style={{ color: "#444", fontSize: 13, textAlign: "center", padding: "32px 0" }}>טוען...</div>
      ) : sorted.length === 0 ? (
        <div style={{ color: "#333", fontSize: 13, textAlign: "center", padding: "48px 0" }}>
          {filter === "פתוח" ? "אין משימות פתוחות" : `אין משימות בסטטוס "${filter}"`}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {sorted.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              relatedName={getRelatedName(task)}
              today={today}
            />
          ))}
        </div>
      )}
    </div>
  );
}
