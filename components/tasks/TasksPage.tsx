"use client";

import { useState, useEffect, useCallback } from "react";
import DatePickerInput from "@/components/ui/DatePickerInput";

// ── Types (client-safe, no server-only import) ────────────────────────────────

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

const inp: React.CSSProperties = {
  width: "100%", padding: "7px 10px", borderRadius: 8,
  border: "1px solid #2A2A2A", background: "#111", color: "#E0E0E0",
  fontSize: 12, fontFamily: "inherit", outline: "none", boxSizing: "border-box",
  colorScheme: "dark" as React.CSSProperties["colorScheme"],
};

// ── Quick-create form ─────────────────────────────────────────────────────────

interface FormState {
  title:        string;
  notes:        string;
  related_type: TaskRelatedType;
  related_id:   string;
  due_date:     string;
  start_time:   string;
}

const EMPTY_FORM: FormState = {
  title: "", notes: "", related_type: "general",
  related_id: "", due_date: "", start_time: "",
};

function TaskForm({ clients, projects, onSaved, onClose }: {
  clients:  NamedItem[];
  projects: NamedItem[];
  onSaved:  (t: Task) => void;
  onClose:  () => void;
}) {
  const [form,   setForm]   = useState<FormState>({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => {
      const next = { ...f, [k]: v };
      // clear related_id when switching type
      if (k === "related_type") next.related_id = "";
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { setError("כותרת חובה"); return; }
    if ((form.related_type === "client" || form.related_type === "project") && !form.related_id) {
      setError(`חובה לבחור ${RELATED_LABELS[form.related_type]}`);
      return;
    }
    setSaving(true); setError(null);
    try {
      const res = await fetch("/api/tasks", {
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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "שגיאה");
      onSaved(data.task);
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה");
    } finally { setSaving(false); }
  }

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
            type="time"
            value={form.start_time}
            onChange={(e) => set("start_time", e.target.value)}
            style={inp}
            disabled={saving}
          />
        </div>
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

      {error && <div style={{ fontSize: 11, color: "#EF4444" }}>{error}</div>}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" onClick={onClose} disabled={saving}
          style={{ padding: "7px 14px", borderRadius: 9, border: "1px solid #2A2A2A", background: "none", color: "#555", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
          ביטול
        </button>
        <button type="submit" disabled={saving || !form.title.trim()}
          style={{ padding: "7px 16px", borderRadius: 9, border: "none", background: saving ? "#1E3A5F" : "#2563EB", color: saving ? "#4A7FC0" : "#FFF", fontSize: 12, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
          {saving ? "שומר..." : "הוסף משימה"}
        </button>
      </div>
    </form>
  );
}

// ── Task row ──────────────────────────────────────────────────────────────────

function TaskRow({ task, relatedName, today, onStatusChange }: {
  task:          Task;
  relatedName:   string | null;
  today:         string;
  onStatusChange: (id: string, status: TaskStatus) => void;
}) {
  const [cycling, setCycling] = useState(false);
  const sc = STATUS_COLOR[task.status];
  const isOverdue = task.due_date && task.due_date < today && task.status === "פתוח";

  async function cycleStatus() {
    if (cycling) return;
    setCycling(true);
    const next = STATUS_NEXT[task.status];
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (res.ok) onStatusChange(task.id, next);
    } catch { /* ignore */ }
    finally { setCycling(false); }
  }

  return (
    <div
      style={{
        background: "#1A1A1A", border: `1px solid ${isOverdue ? "rgba(239,68,68,0.2)" : "#252525"}`,
        borderRadius: 10, padding: "10px 12px", direction: "rtl",
        opacity: task.status === "בוטל" ? 0.5 : 1,
        transition: "opacity 150ms",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        {/* Status cycle button */}
        <button
          onClick={cycleStatus}
          disabled={cycling}
          title={`לחץ לשינוי סטטוס → ${STATUS_NEXT[task.status]}`}
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
          {task.status}
        </button>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13, fontWeight: 500, lineHeight: 1.3,
            textDecoration: task.status === "בוצע" ? "line-through" : "none",
            color: task.status === "בוטל" ? "#555" : task.status === "בוצע" ? "#888" : "#D8D8D8",
          }}>
            {task.title}
          </div>

          {/* Meta row */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px", marginTop: 4, fontSize: 11 }}>
            {/* Related */}
            {relatedName && (
              <span style={{ color: task.related_type === "client" ? "#C084FC" : "#60A5FA" }}>
                {task.related_type === "client" ? "👤" : "♫"} {relatedName}
              </span>
            )}
            {/* Due date */}
            {task.due_date && (
              <span style={{ color: isOverdue ? "#F87171" : task.due_date === today ? "#FBBF24" : "#555" }}>
                {isOverdue ? "⚠ " : task.due_date === today ? "📌 " : ""}
                {fmtDate(task.due_date)}
                {task.start_time && ` · ${fmtTime(task.start_time)}`}
              </span>
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

  const [tasks,     setTasks]     = useState<Task[]>([]);
  const [clients,   setClients]   = useState<NamedItem[]>([]);
  const [projects,  setProjects]  = useState<NamedItem[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [showForm,  setShowForm]  = useState(false);
  const [filter,    setFilter]    = useState<FilterTab>("פתוח");

  // Load tasks + clients + projects
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
      // /api/projects returns a direct array (not {projects:[...]})
      const projArr: { id: string; name: string }[] = Array.isArray(pData) ? pData : (pData.projects ?? []);
      setProjects(projArr.map((p) => ({ id: p.id, name: p.name })));
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Build lookup maps
  const clientMap  = new Map(clients.map((c) => [c.id, c.name]));
  const projectMap = new Map(projects.map((p) => [p.id, p.name]));

  function getRelatedName(task: Task): string | null {
    if (!task.related_id) return null;
    if (task.related_type === "client")  return clientMap.get(task.related_id)  ?? null;
    if (task.related_type === "project") return projectMap.get(task.related_id) ?? null;
    return null;
  }

  // Filter tasks
  const filtered = tasks.filter((t) => filter === "הכל" || t.status === filter);

  // Counts per tab
  const counts: Record<FilterTab, number> = {
    "הכל":  tasks.length,
    "פתוח": tasks.filter((t) => t.status === "פתוח").length,
    "בוצע": tasks.filter((t) => t.status === "בוצע").length,
    "בוטל": tasks.filter((t) => t.status === "בוטל").length,
  };

  function handleStatusChange(id: string, status: TaskStatus) {
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, status } : t));
  }

  function handleSaved(task: Task) {
    setTasks((prev) => [task, ...prev]);
    setShowForm(false);
    // Switch to "פתוח" tab so the new task is visible
    setFilter("פתוח");
  }

  // Sort: overdue first, then by due_date asc, then created_at desc
  const sorted = [...filtered].sort((a, b) => {
    const aOver = a.due_date && a.due_date < today && a.status === "פתוח" ? 0 : 1;
    const bOver = b.due_date && b.due_date < today && b.status === "פתוח" ? 0 : 1;
    if (aOver !== bOver) return aOver - bOver;
    if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
    if (a.due_date) return -1;
    if (b.due_date) return 1;
    return b.created_at.localeCompare(a.created_at);
  });

  return (
    <div
      className="px-3 py-3 md:px-6 md:py-8 max-w-3xl mx-auto"
      dir="rtl"
      style={{ minHeight: "100dvh" }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#E0E0E0", margin: 0 }}>משימות</h1>
          <div style={{ fontSize: 12, color: "#555", marginTop: 2 }}>
            {counts["פתוח"]} פתוחות
            {tasks.filter((t) => t.due_date && t.due_date < today && t.status === "פתוח").length > 0 && (
              <span style={{ color: "#F87171", marginRight: 8 }}>
                · {tasks.filter((t) => t.due_date && t.due_date < today && t.status === "פתוח").length} באיחור
              </span>
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
          <TaskForm
            clients={clients}
            projects={projects}
            onSaved={handleSaved}
            onClose={() => setShowForm(false)}
          />
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
                cursor: "pointer", fontFamily: "inherit",
                transition: "all 120ms",
              }}
            >
              {tab}
              {counts[tab] > 0 && (
                <span style={{ marginRight: 5, fontSize: 10, opacity: 0.7 }}>({counts[tab]})</span>
              )}
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
              onStatusChange={handleStatusChange}
            />
          ))}
        </div>
      )}
    </div>
  );
}
