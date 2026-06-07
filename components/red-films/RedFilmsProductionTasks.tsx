"use client";

import { useState, useEffect, useCallback, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import DatePickerInput from "@/components/ui/DatePickerInput";

// ── Types ─────────────────────────────────────────────────────────────────────

type TaskStatus = "פתוח" | "בוצע" | "בוטל";

interface Task {
  id:                string;
  title:             string;
  notes:             string | null;
  status:            TaskStatus;
  related_type:      string;
  related_id:        string | null;
  due_date:          string | null;
  start_time:        string | null;
  end_time:          string | null;
  calendar_event_id: string | null;
  created_at:        string;
  updated_at:        string;
}

interface Props {
  productionId:    string;
  productionTitle: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_NEXT: Record<TaskStatus, TaskStatus> = {
  "פתוח": "בוצע", "בוצע": "בוטל", "בוטל": "פתוח",
};
const STATUS_COLOR: Record<TaskStatus, { bg: string; color: string; border: string }> = {
  "פתוח": { bg: "rgba(59,130,246,0.12)",  color: "#60A5FA", border: "rgba(59,130,246,0.3)"  },
  "בוצע": { bg: "rgba(16,185,129,0.12)",  color: "#34D399", border: "rgba(16,185,129,0.3)"  },
  "בוטל": { bg: "rgba(107,114,128,0.12)", color: "#6B7280", border: "rgba(107,114,128,0.3)" },
};

// ── Style helpers ─────────────────────────────────────────────────────────────

const INP: CSSProperties = {
  width: "100%", padding: "7px 10px", borderRadius: 8,
  border: "1px solid #2A2A2A", background: "#111", color: "#E0E0E0",
  fontSize: 12, fontFamily: "inherit", outline: "none", boxSizing: "border-box",
};

const LBL: CSSProperties = {
  fontSize: 10, color: "#555", fontWeight: 700, marginBottom: 4,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string) {
  const [y, m, day] = d.split("-");
  return `${parseInt(day, 10)}.${parseInt(m, 10)}.${y}`;
}

function fmtTime(t: string) { return t.slice(0, 5); }

function addMinutes(t: string, mins: number) {
  const [h, m] = t.split(":").map(Number);
  const total = h * 60 + m + mins;
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

// ── Edit Modal ────────────────────────────────────────────────────────────────

function EditModal({ task, productionTitle, onClose, onSaved, onDeleted }: {
  task:            Task;
  productionTitle: string;
  onClose:         () => void;
  onSaved:         (t: Task) => void;
  onDeleted:       (id: string) => void;
}) {
  const [title,      setTitle]      = useState(task.title);
  const [notes,      setNotes]      = useState(task.notes ?? "");
  const [status,     setStatus]     = useState<TaskStatus>(task.status);
  const [dueDate,    setDueDate]    = useState(task.due_date ?? "");
  const [startTime,  setStartTime]  = useState(task.start_time ? fmtTime(task.start_time) : "");
  const [saving,     setSaving]     = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [deleting,   setDeleting]   = useState(false);
  const [err,        setErr]        = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleSave() {
    if (!title.trim()) { setErr("כותרת חובה"); return; }
    setSaving(true); setErr("");
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(), notes: notes.trim() || null,
          status, due_date: dueDate || null,
          start_time: startTime ? `${startTime}:00` : null,
          end_time: startTime ? `${addMinutes(startTime, 60)}:00` : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "שגיאה");
      onSaved(data.task);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "שגיאה");
    } finally { setSaving(false); }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await fetch(`/api/tasks/${task.id}`, { method: "DELETE" });
      onDeleted(task.id);
    } catch { setDeleting(false); }
  }

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9500, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#1A1A1A", border: "1px solid #2A2A2A", borderRadius: 16, padding: "24px 22px", width: "min(460px, 92vw)", display: "flex", flexDirection: "column", gap: 14 }} dir="rtl">
        <div style={{ fontSize: 13, fontWeight: 700, color: "#888" }}>עריכת משימה</div>
        <div style={{ fontSize: 11, color: "#3A3A3A" }}>🎬 {productionTitle}</div>

        <div>
          <div style={LBL}>שם המשימה *</div>
          <input style={INP} value={title} onChange={e => setTitle(e.target.value)} disabled={saving} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <div>
            <div style={LBL}>סטטוס</div>
            <select style={{ ...INP, cursor: "pointer" }} value={status} onChange={e => setStatus(e.target.value as TaskStatus)} disabled={saving}>
              {(["פתוח", "בוצע", "בוטל"] as TaskStatus[]).map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <div style={LBL}>תאריך יעד</div>
            <DatePickerInput value={dueDate} onChange={v => setDueDate(v)} placeholder="אופציונלי" style={{ ...INP, justifyContent: "space-between" }} />
          </div>
          <div>
            <div style={LBL}>שעה</div>
            <input style={INP} value={startTime} onChange={e => setStartTime(e.target.value)} placeholder="HH:MM" disabled={saving} />
          </div>
        </div>

        <div>
          <div style={LBL}>הערות</div>
          <textarea style={{ ...INP, resize: "none", minHeight: 56, lineHeight: 1.5 }} value={notes} onChange={e => setNotes(e.target.value)} disabled={saving} />
        </div>

        {task.calendar_event_id && (
          <div style={{ fontSize: 11, color: "#60A5FA" }}>📅 מקושר ל-Google Tasks</div>
        )}

        {err && <div style={{ fontSize: 11, color: "#F87171" }}>{err}</div>}

        {confirmDel ? (
          <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 10, padding: "10px 12px", display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, color: "#FCA5A5" }}>למחוק את המשימה?</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setConfirmDel(false)} style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid #333", background: "none", color: "#666", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>ביטול</button>
              <button onClick={handleDelete} disabled={deleting} style={{ padding: "5px 12px", borderRadius: 8, border: "none", background: "#EF4444", color: "#FFF", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>{deleting ? "מוחק..." : "מחק"}</button>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <button onClick={() => setConfirmDel(true)} style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid #2A2A2A", background: "none", color: "#555", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>🗑 מחק</button>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={onClose} disabled={saving} style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid #2A2A2A", background: "none", color: "#666", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>ביטול</button>
              <button onClick={handleSave} disabled={saving || !title.trim()} style={{ padding: "7px 16px", borderRadius: 8, border: "none", background: "#3B82F6", color: "#FFF", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", opacity: saving || !title.trim() ? 0.6 : 1 }}>{saving ? "שומר..." : "שמור"}</button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

// ── Add Task Form ─────────────────────────────────────────────────────────────

function AddTaskForm({ productionId, productionTitle, onSaved, onClose }: {
  productionId:    string;
  productionTitle: string;
  onSaved:         (t: Task) => void;
  onClose:         () => void;
}) {
  const [title,         setTitle]         = useState("");
  const [notes,         setNotes]         = useState("");
  const [dueDate,       setDueDate]       = useState("");
  const [startTime,     setStartTime]     = useState("");
  const [addToCalendar, setAddToCalendar] = useState(false);
  const [saving,        setSaving]        = useState(false);
  const [err,           setErr]           = useState("");

  const canCalendar = !!dueDate;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setErr("כותרת חובה"); return; }
    setSaving(true); setErr("");
    try {
      const endTime = startTime ? `${addMinutes(startTime, 60)}:00` : null;

      const res = await fetch("/api/tasks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(), notes: notes.trim() || null,
          status: "פתוח",
          related_type: "red_film_production", related_id: productionId,
          due_date: dueDate || null,
          start_time: startTime ? `${startTime}:00` : null,
          end_time: endTime,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "שגיאה");
      let task: Task = data.task;

      if (addToCalendar && canCalendar) {
        try {
          const desc = `משימה מתוך Redbloods OS\n\nקשור ל: Red Films - ${productionTitle}${notes.trim() ? `\n\nהערות:\n${notes.trim()}` : ""}`;
          const gtRes = await fetch("/api/calendar/create-task", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: task.title, due: dueDate, notes: desc }),
          });
          const gtData = await gtRes.json();
          if (gtRes.ok && gtData.task?.id) {
            const patchRes = await fetch(`/api/tasks/${task.id}`, {
              method: "PATCH", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ calendar_event_id: gtData.task.id }),
            });
            const patchData = await patchRes.json();
            if (patchRes.ok) task = patchData.task;
          }
        } catch { /* calendar failed — task still saved */ }
      }

      onSaved(task);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "שגיאה");
    } finally { setSaving(false); }
  }

  return (
    <form onSubmit={handleSubmit} dir="rtl" style={{ background: "#141414", border: "1px solid #2A2A2A", borderRadius: 12, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#555", textTransform: "uppercase", letterSpacing: "0.07em" }}>משימה חדשה</div>
      <input autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="שם המשימה *" style={INP} disabled={saving} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div>
          <div style={LBL}>תאריך יעד</div>
          <DatePickerInput value={dueDate} onChange={v => { setDueDate(v); if (!v) setAddToCalendar(false); }} placeholder="אופציונלי" style={{ ...INP, justifyContent: "space-between" }} />
        </div>
        <div>
          <div style={LBL}>שעה</div>
          <input style={INP} value={startTime} onChange={e => setStartTime(e.target.value)} placeholder="HH:MM" disabled={saving} />
        </div>
      </div>

      <div>
        <div style={LBL}>הערות</div>
        <textarea style={{ ...INP, resize: "none", minHeight: 48, lineHeight: 1.5 }} value={notes} onChange={e => setNotes(e.target.value)} disabled={saving} placeholder="הערות אופציונליות..." />
      </div>

      {canCalendar && (
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={addToCalendar} onChange={e => setAddToCalendar(e.target.checked)} disabled={saving} style={{ width: 14, height: 14, accentColor: "#2563EB", cursor: "pointer" }} />
          <span style={{ fontSize: 12, color: addToCalendar ? "#60A5FA" : "#555" }}>📋 הוסף כמשימה ב-Google</span>
        </label>
      )}

      {err && <div style={{ fontSize: 11, color: "#F87171" }}>{err}</div>}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" onClick={onClose} disabled={saving} style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid #2A2A2A", background: "none", color: "#555", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>ביטול</button>
        <button type="submit" disabled={saving || !title.trim()} style={{ padding: "6px 16px", borderRadius: 8, border: "none", background: "#2563EB", color: "#FFF", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", opacity: saving || !title.trim() ? 0.6 : 1 }}>{saving ? "מוסיף..." : "הוסף משימה"}</button>
      </div>
    </form>
  );
}

// ── Task Row ──────────────────────────────────────────────────────────────────

function ProdTaskRow({ task, today, onEdit, onChange }: {
  task:     Task;
  today:    string;
  onEdit:   (t: Task) => void;
  onChange: (t: Task) => void;
}) {
  const [cycling,     setCycling]     = useState(false);
  const [localStatus, setLocalStatus] = useState<TaskStatus>(task.status);
  const sc       = STATUS_COLOR[localStatus];
  const isOverdue = task.due_date && task.due_date < today && localStatus === "פתוח";

  async function cycleStatus(e: React.MouseEvent) {
    e.stopPropagation();
    if (cycling) return;
    setCycling(true);
    const next = STATUS_NEXT[localStatus];
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (res.ok) {
        setLocalStatus(next);
        const data = await res.json();
        onChange(data.task);
      }
    } catch { /* ignore */ }
    finally { setCycling(false); }
  }

  return (
    <div onClick={() => onEdit({ ...task, status: localStatus })} style={{
      background: "#141414", border: `1px solid ${isOverdue ? "rgba(239,68,68,0.2)" : "#222"}`,
      borderRadius: 9, padding: "9px 12px", cursor: "pointer",
      opacity: localStatus === "בוטל" ? 0.5 : 1, transition: "opacity 150ms",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <button onClick={cycleStatus} disabled={cycling} title={`שנה ל-${STATUS_NEXT[localStatus]}`} style={{
          flexShrink: 0, padding: "2px 8px", borderRadius: 20,
          background: sc.bg, color: sc.color, border: `1px solid ${sc.border}`,
          fontSize: 10, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
          opacity: cycling ? 0.6 : 1,
        }}>
          {localStatus}
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: localStatus === "בוטל" ? "#555" : localStatus === "בוצע" ? "#888" : "#D8D8D8", textDecoration: localStatus === "בוצע" ? "line-through" : "none" }}>
            {task.title}
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 4, fontSize: 11, flexWrap: "wrap", alignItems: "center" }}>
            {task.due_date && (
              <span style={{ color: isOverdue ? "#F87171" : task.due_date === today ? "#FBBF24" : "#555" }}>
                {isOverdue && "⚠ "}{task.due_date === today && "📌 "}
                {fmtDate(task.due_date)}
                {task.start_time && ` · ${fmtTime(task.start_time)}`}
              </span>
            )}
            {task.calendar_event_id && <span style={{ color: "#3A3A3A", fontSize: 11 }} title="ב-Google Tasks">📅</span>}
            {task.notes && <span style={{ color: "#3A3A3A", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.notes}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RedFilmsProductionTasks({ productionId, productionTitle }: Props) {
  const today = new Date().toISOString().split("T")[0];

  const [tasks,    setTasks]    = useState<Task[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editTask, setEditTask] = useState<Task | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch(`/api/tasks?related_type=red_film_production&related_id=${productionId}`);
      const data = await res.json();
      setTasks(data.tasks ?? []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [productionId]);

  useEffect(() => { load(); }, [load]);

  function handleSaved(task: Task) {
    setTasks(prev => [task, ...prev]);
    setShowForm(false);
  }

  function handleUpdated(task: Task) {
    setTasks(prev => prev.map(t => t.id === task.id ? task : t));
    setEditTask(null);
  }

  function handleDeleted(id: string) {
    setTasks(prev => prev.filter(t => t.id !== id));
    setEditTask(null);
  }

  const open   = tasks.filter(t => t.status === "פתוח").length;
  const done   = tasks.filter(t => t.status === "בוצע").length;
  const cancelled = tasks.filter(t => t.status === "בוטל").length;

  return (
    <div dir="rtl">
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, color: "#888", margin: 0 }}>משימות הפקה</h2>
          {tasks.length > 0 && (
            <div style={{ display: "flex", gap: 8, fontSize: 11 }}>
              {open > 0 && <span style={{ color: "#60A5FA" }}>פתוחות {open}</span>}
              {done > 0 && <span style={{ color: "#34D399" }}>בוצעו {done}</span>}
              {cancelled > 0 && <span style={{ color: "#555" }}>בוטלו {cancelled}</span>}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <a href="/tasks" target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 11, color: "#555", background: "none", border: "1px solid #2A2A2A", borderRadius: 6, cursor: "pointer", fontFamily: "inherit", padding: "4px 10px", textDecoration: "none" }}>
            פתח עמוד משימות ↗
          </a>
          <button onClick={() => setShowForm(v => !v)}
            style={{ fontSize: 11, color: showForm ? "#FFF" : "#60A5FA", background: showForm ? "#2563EB" : "none", border: `1px solid ${showForm ? "#2563EB" : "rgba(96,165,250,0.3)"}`, borderRadius: 6, cursor: "pointer", fontFamily: "inherit", padding: "4px 10px" }}>
            {showForm ? "✕ ביטול" : "+ משימה"}
          </button>
        </div>
      </div>

      {/* Add form */}
      {showForm && (
        <AddTaskForm
          productionId={productionId}
          productionTitle={productionTitle}
          onSaved={handleSaved}
          onClose={() => setShowForm(false)}
        />
      )}

      {/* Task list */}
      {loading ? (
        <div style={{ fontSize: 12, color: "#444", padding: "10px 0" }}>טוען משימות...</div>
      ) : tasks.length === 0 && !showForm ? (
        <div style={{ fontSize: 13, color: "#3A3A3A", fontStyle: "italic", padding: "8px 0" }}>
          אין משימות עדיין — לחץ + משימה כדי להוסיף
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: showForm ? 6 : 0 }}>
          {tasks.map(task => (
            <ProdTaskRow
              key={task.id}
              task={task}
              today={today}
              onEdit={setEditTask}
              onChange={handleUpdated}
            />
          ))}
        </div>
      )}

      {/* Edit modal */}
      {editTask && typeof window !== "undefined" && (
        <EditModal
          task={editTask}
          productionTitle={productionTitle}
          onClose={() => setEditTask(null)}
          onSaved={handleUpdated}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  );
}
