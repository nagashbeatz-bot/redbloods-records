"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import DatePickerInput from "@/components/ui/DatePickerInput";
import { useGlobalProjectDrawer } from "@/components/GlobalProjectDrawer";

// ── Types ─────────────────────────────────────────────────────────────────────

type TaskStatus      = "פתוח" | "בוצע" | "בוטל";
type TaskRelatedType = "general" | "client" | "project" | "red_film_production";

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
  "פתוח": "בוצע",
  "בוצע": "בוטל",
  "בוטל": "פתוח",
};

const STATUS_COLOR: Record<TaskStatus, { bg: string; color: string; border: string }> = {
  "פתוח": { bg: "rgba(59,130,246,0.12)",  color: "#60A5FA", border: "rgba(59,130,246,0.3)"  },
  "בוצע": { bg: "rgba(16,185,129,0.12)",  color: "#34D399", border: "rgba(16,185,129,0.3)"  },
  "בוטל": { bg: "rgba(107,114,128,0.12)", color: "#6B7280", border: "rgba(107,114,128,0.3)" },
};

const RELATED_LABELS: Record<TaskRelatedType, string> = {
  general:             "כללי",
  client:              "לקוח",
  project:             "פרויקט",
  red_film_production: "Red Films",
};

const QUICK_TIMES = ["09:00", "10:00", "12:00", "14:00", "16:00", "18:00", "20:00"];

type DurationKey = "15" | "30" | "60" | "90" | "120" | "custom";

const DURATION_MINS: Record<Exclude<DurationKey, "custom">, number> = {
  "15": 15, "30": 30, "60": 60, "90": 90, "120": 120,
};

const DURATION_OPTIONS: { key: DurationKey; label: string }[] = [
  { key: "15",     label: "15 דק׳"    },
  { key: "30",     label: "30 דק׳"    },
  { key: "60",     label: "שעה"       },
  { key: "90",     label: "שעה וחצי" },
  { key: "120",    label: "שעתיים"    },
  { key: "custom", label: "מותאם"     },
];

type FilterTab = "הכל" | "פתוחות" | "להיום" | "באיחור" | "הושלמו" | "בוטל";
const FILTER_TABS: FilterTab[] = ["הכל", "פתוחות", "להיום", "באיחור", "הושלמו", "בוטל"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string): string {
  const [y, m, day] = d.split("-");
  return `${parseInt(day, 10)}.${parseInt(m, 10)}.${y}`;
}

function fmtTime(t: string): string { return t.slice(0, 5); }

function validateTime(val: string): string | null {
  if (!val) return null;
  if (!/^\d{2}:\d{2}$/.test(val)) return "פורמט שעה לא תקין — השתמש ב-HH:MM";
  const [h, m] = val.split(":").map(Number);
  if (h > 23 || m > 59) return "שעה לא תקינה";
  return null;
}

function addMinutes(time: string, mins: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + mins;
  const nh = Math.floor(total / 60) % 24;
  const nm = total % 60;
  return `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`;
}

function buildCalendarDescription(notes: string | null, relType: TaskRelatedType, relatedName: string | null): string {
  const lines = ["משימה מתוך Redbloods OS", ""];
  if (relType === "client" && relatedName)  lines.push(`קשור ל: לקוח - ${relatedName}`);
  else if (relType === "project" && relatedName) lines.push(`קשור ל: פרויקט - ${relatedName}`);
  else lines.push("קשור ל: כללי");
  if (notes?.trim()) lines.push("", "הערות:", notes.trim());
  return lines.join("\n");
}

function timeToMins(t: string): number {
  const [h, m] = t.slice(0, 5).split(":").map(Number);
  return h * 60 + m;
}

function computeEnd(start: string, dur: DurationKey, customEnd: string): string {
  if (!start || validateTime(start)) return "";
  if (dur === "custom") return customEnd;
  return addMinutes(start, DURATION_MINS[dur]);
}

function inferDuration(start: string | null, end: string | null): DurationKey {
  if (!start || !end) return "30";
  const diff = timeToMins(end) - timeToMins(start);
  if (diff === 15)  return "15";
  if (diff === 30)  return "30";
  if (diff === 60)  return "60";
  if (diff === 90)  return "90";
  if (diff === 120) return "120";
  return "custom";
}

function roundToNext15(): string {
  const now  = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const r    = Math.ceil(mins / 15) * 15;
  return `${String(Math.floor(r / 60) % 24).padStart(2, "0")}:${String(r % 60).padStart(2, "0")}`;
}

function renderNotes(text: string): React.ReactNode[] {
  return text.split(/(https?:\/\/[^\s]+)/g).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        style={{ color: "#60A5FA", textDecoration: "underline", wordBreak: "break-all" }}>
        {part}
      </a>
    ) : <span key={i}>{part}</span>
  );
}

// ── Shared input styles ───────────────────────────────────────────────────────

const inp: React.CSSProperties = {
  width: "100%", padding: "7px 10px", borderRadius: 8,
  border: "1px solid #2A2A2A", background: "#111", color: "#E0E0E0",
  fontSize: 12, fontFamily: "inherit", outline: "none", boxSizing: "border-box",
  colorScheme: "dark" as React.CSSProperties["colorScheme"],
};

const modalInp: React.CSSProperties = {
  width: "100%", padding: "9px 12px", borderRadius: 10,
  border: "1px solid #303030", background: "#111", color: "#E8E8E8",
  fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box",
  colorScheme: "dark" as React.CSSProperties["colorScheme"],
};

const lbl: React.CSSProperties = {
  fontSize: 10, color: "#777", fontWeight: 700,
  letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8,
};

const MODAL_PRIMARY: React.CSSProperties = {
  padding: "10px 20px", borderRadius: 100,
  border: "1.5px solid rgba(168,85,247,0.4)",
  background: "rgba(168,85,247,0.14)", color: "#C084FC",
  fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
};

const MODAL_SECONDARY: React.CSSProperties = {
  padding: "10px 20px", borderRadius: 100,
  border: "1.5px solid #383838", background: "#1E1E1E",
  color: "#999", fontSize: 13, cursor: "pointer", fontFamily: "inherit",
};

// ── QuickTimePill ─────────────────────────────────────────────────────────────

function QuickTimePill({ label: t, active, disabled, onClick }: {
  label: string; active: boolean; disabled?: boolean; onClick: () => void;
}) {
  const [hov, setHov] = useState(false);
  const on = active || hov;
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        padding: "5px 10px", borderRadius: 8, cursor: disabled ? "not-allowed" : "pointer",
        border: `1.5px solid ${on ? "rgba(168,85,247,0.55)" : "#252525"}`,
        background: active ? "rgba(168,85,247,0.18)" : hov ? "rgba(168,85,247,0.10)" : "#1C1C1C",
        color: on ? "#C084FC" : "#666",
        fontSize: 11, fontFamily: "inherit", transition: "all 0.13s", fontWeight: active ? 700 : 400,
      }}>
      {t}
    </button>
  );
}

// ── TimeInput ─────────────────────────────────────────────────────────────────

function TimeInput({ value, onChange, disabled }: {
  value: string; onChange: (v: string, err: string | null) => void; disabled?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);

  function handleBlur() {
    const err = validateTime(value);
    setError(err);
    onChange(value, err);
  }

  function pick(t: string) {
    const v = t === "עכשיו" ? roundToNext15() : t;
    setError(null);
    onChange(v, null);
  }

  return (
    <div>
      <input type="text" value={value}
        onChange={(e) => { setError(null); onChange(e.target.value, null); }}
        onBlur={handleBlur} placeholder="14:00" maxLength={5} disabled={disabled}
        style={{ ...inp, borderColor: error ? "#EF4444" : "#2A2A2A" }} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
        {(["עכשיו", ...QUICK_TIMES] as string[]).map((t) => (
          <QuickTimePill key={t} label={t} active={false} disabled={disabled} onClick={() => pick(t)} />
        ))}
      </div>
      {error && <div style={{ fontSize: 10, color: "#EF4444", marginTop: 4 }}>{error}</div>}
    </div>
  );
}

// ── DurationPicker ────────────────────────────────────────────────────────────

function DurationPicker({ startTime, duration, customEnd, onDuration, onCustomEnd, disabled, compact }: {
  startTime: string; duration: DurationKey; customEnd: string;
  onDuration: (d: DurationKey) => void; onCustomEnd: (v: string, err: string | null) => void;
  disabled?: boolean; compact?: boolean;
}) {
  const [endErr, setEndErr] = useState<string | null>(null);
  const [hov, setHov] = useState<DurationKey | null>(null);

  function handleCustomEndBlur() {
    const err = validateTime(customEnd);
    if (!err && startTime && customEnd && timeToMins(customEnd) <= timeToMins(startTime)) {
      const e = "שעת הסיום חייבת להיות אחרי שעת ההתחלה";
      setEndErr(e); onCustomEnd(customEnd, e); return;
    }
    setEndErr(err); onCustomEnd(customEnd, err);
  }

  const computed = duration !== "custom" && startTime && !validateTime(startTime)
    ? computeEnd(startTime, duration, "") : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: compact ? 6 : 8 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
        {DURATION_OPTIONS.map(({ key, label: l }) => {
          const active = duration === key;
          const isHov = hov === key;
          const on = active || isHov;
          return (
            <button key={key} type="button" onClick={() => onDuration(key)} disabled={disabled}
              onMouseEnter={() => setHov(key)} onMouseLeave={() => setHov(null)}
              style={{
                padding: compact ? "4px 9px" : "5px 11px", borderRadius: 8,
                cursor: disabled ? "not-allowed" : "pointer",
                border: `1.5px solid ${on ? "rgba(168,85,247,0.55)" : "#252525"}`,
                background: active ? "rgba(168,85,247,0.18)" : isHov ? "rgba(168,85,247,0.10)" : "#1C1C1C",
                color: on ? "#C084FC" : "#666",
                fontSize: compact ? 11 : 12, fontFamily: "inherit", transition: "all 0.13s",
                fontWeight: active ? 700 : 400,
              }}>
              {l}
            </button>
          );
        })}
      </div>
      {computed && (
        <div style={{ fontSize: 11, color: "#555", paddingRight: 2 }}>
          סיום: <span style={{ color: "#888", fontVariantNumeric: "tabular-nums" }}>{computed}</span>
        </div>
      )}
      {duration === "custom" && (
        <div>
          <div style={{ ...lbl, marginBottom: 4 }}>שעת סיום</div>
          <input type="text" value={customEnd}
            onChange={(e) => { setEndErr(null); onCustomEnd(e.target.value, null); }}
            onBlur={handleCustomEndBlur} placeholder="13:30" maxLength={5} disabled={disabled}
            style={{ ...(compact ? inp : modalInp), borderColor: endErr ? "#EF4444" : undefined, width: "50%" }} />
          {endErr && <div style={{ fontSize: 10, color: "#EF4444", marginTop: 3 }}>{endErr}</div>}
        </div>
      )}
    </div>
  );
}

// ── TaskDetailModal ───────────────────────────────────────────────────────────

function TaskDetailModal({ task, clients, projects, onClose, onUpdated, onDeleted }: {
  task: Task; clients: NamedItem[]; projects: NamedItem[];
  onClose: () => void; onUpdated: (t: Task) => void; onDeleted: (id: string) => void;
}) {
  const { openProject } = useGlobalProjectDrawer();
  const router = useRouter();

  const [title,     setTitle]     = useState(task.title);
  const [status,    setStatus]    = useState<TaskStatus>(task.status);
  const [relType,   setRelType]   = useState<TaskRelatedType>(task.related_type);
  const [relId,     setRelId]     = useState(task.related_id ?? "");
  const [dueDate,   setDueDate]   = useState(task.due_date ?? "");
  const [startTime, setStartTime] = useState(task.start_time ? fmtTime(task.start_time) : "");
  const [duration,  setDuration]  = useState<DurationKey>(() =>
    inferDuration(task.start_time ? fmtTime(task.start_time) : null, task.end_time ? fmtTime(task.end_time) : null)
  );
  const [customEnd, setCustomEnd] = useState(
    task.end_time && inferDuration(task.start_time ? fmtTime(task.start_time) : null, task.end_time ? fmtTime(task.end_time) : null) === "custom"
      ? fmtTime(task.end_time) : ""
  );
  const [notes,       setNotes]       = useState(task.notes ?? "");
  const [timeErr,     setTimeErr]     = useState<string | null>(null);
  const [endErr,      setEndErr]      = useState<string | null>(null);
  const [saving,      setSaving]      = useState(false);
  const [deleting,    setDeleting]    = useState(false);
  const [confirmDel,  setConfirmDel]  = useState(false);
  const [delCalendar, setDelCalendar] = useState(true);
  const [error,       setError]       = useState<string | null>(null);

  const effectiveEnd = startTime && !timeErr ? computeEnd(startTime, duration, customEnd) : "";

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleDelete() {
    setDeleting(true); setError(null);
    try {
      if (delCalendar && task.calendar_event_id) {
        const calRes = await fetch(`/api/calendar/events/${task.calendar_event_id}`, { method: "DELETE" });
        if (!calRes.ok) { const d = await calRes.json(); throw new Error(`שגיאה במחיקה מגוגל: ${d.error ?? "שגיאה"}`); }
      }
      const res = await fetch(`/api/tasks/${task.id}`, { method: "DELETE" });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "שגיאה"); }
      onDeleted(task.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאת מחיקה");
      setConfirmDel(false);
    } finally { setDeleting(false); }
  }

  async function handleSave() {
    if (!title.trim()) { setError("כותרת חובה"); return; }
    if ((relType === "client" || relType === "project") && !relId) { setError(`חובה לבחור ${RELATED_LABELS[relType]}`); return; }
    if (timeErr) { setError("שעה לא תקינה"); return; }
    if (endErr)  { setError("שעת סיום לא תקינה"); return; }

    const calEnd = effectiveEnd || (startTime ? addMinutes(startTime, 30) : null);
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(), notes: notes.trim() || null, status,
          related_type: relType, related_id: relType !== "general" ? (relId || null) : null,
          due_date: dueDate || null, start_time: startTime || null, end_time: calEnd || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "שגיאה בשמירה");
      onUpdated(data.task);
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה בשמירה");
    } finally { setSaving(false); }
  }

  const relatedName =
    relType === "client"  ? clients.find((c) => c.id === relId)?.name :
    relType === "project" ? projects.find((p) => p.id === relId)?.name : null;

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
    }}>
      <div onClick={(e) => e.stopPropagation()} dir="rtl" style={{
        background: "#141414", border: "1px solid #262626", borderRadius: 22,
        padding: "28px 28px 24px", width: "100%", maxWidth: 460,
        maxHeight: "90dvh", overflowY: "auto",
        boxShadow: "0 24px 64px rgba(0,0,0,0.9)",
        display: "flex", flexDirection: "column", gap: 18, fontFamily: "inherit",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#A855F7", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 6 }}>
              ✓ פרטי משימה
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#F5F5F5", lineHeight: 1.2 }}>{task.title}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#555", fontSize: 18, cursor: "pointer", padding: "2px 4px" }}>✕</button>
        </div>

        {/* כותרת */}
        <div>
          <div style={lbl}>כותרת</div>
          <input value={title} onChange={(e) => setTitle(e.target.value)} style={modalInp} disabled={saving} />
        </div>

        {/* סטטוס */}
        <div>
          <div style={lbl}>סטטוס</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(["פתוח", "בוצע", "בוטל"] as TaskStatus[]).map((s) => {
              const sc = STATUS_COLOR[s];
              const active = status === s;
              return (
                <button key={s} type="button" onClick={() => setStatus(s)} disabled={saving}
                  style={{
                    padding: "8px 18px", borderRadius: 100,
                    background: active ? sc.bg : "#1C1C1C",
                    border: `1.5px solid ${active ? sc.border : "#2A2A2A"}`,
                    color: active ? sc.color : "#666",
                    fontSize: 13, fontWeight: active ? 700 : 400,
                    cursor: "pointer", fontFamily: "inherit", transition: "all 0.13s",
                  }}>
                  {s}
                </button>
              );
            })}
          </div>
        </div>

        {/* קשור ל */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <div style={lbl}>קשור ל</div>
            <select value={relType} onChange={(e) => { setRelType(e.target.value as TaskRelatedType); setRelId(""); }} style={modalInp} disabled={saving}>
              <option value="general">כללי</option>
              <option value="client">לקוח</option>
              <option value="project">פרויקט</option>
            </select>
          </div>
          {relType === "client" && (
            <div>
              <div style={lbl}>לקוח</div>
              <select value={relId} onChange={(e) => setRelId(e.target.value)} style={modalInp} disabled={saving}>
                <option value="">— בחר לקוח —</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
          {relType === "project" && (
            <div>
              <div style={lbl}>פרויקט</div>
              <select value={relId} onChange={(e) => setRelId(e.target.value)} style={modalInp} disabled={saving}>
                <option value="">— בחר פרויקט —</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}
          {relType === "general" && (
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <div style={{ fontSize: 12, color: "#444", paddingBottom: 2 }}>ללא שיוך ספציפי</div>
            </div>
          )}
        </div>

        {relId && relatedName && (
          <button type="button"
            onClick={(e) => { e.stopPropagation(); if (!relId) return; if (relType === "project") openProject(relId); else if (relType === "client") router.push(`/clients?open=${relId}`); }}
            style={{
              alignSelf: "flex-start", background: "rgba(168,85,247,0.07)",
              border: "1px solid rgba(168,85,247,0.2)", borderRadius: 8,
              padding: "6px 12px", fontFamily: "inherit", fontSize: 12,
              color: relType === "client" ? "#C084FC" : "#60A5FA", cursor: "pointer",
            }}>
            {relType === "client" ? "👤" : "♫"} פתח את {relatedName} ↗
          </button>
        )}

        {/* תאריך + שעה */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <div style={lbl}>תאריך</div>
            <DatePickerInput value={dueDate} onChange={setDueDate} placeholder="אופציונלי" style={modalInp} />
          </div>
          <div>
            <div style={lbl}>שעה</div>
            <TimeInput value={startTime} onChange={(v, e) => { setStartTime(v); setTimeErr(e); }} disabled={saving} />
          </div>
        </div>

        {startTime && !timeErr && (
          <div>
            <div style={lbl}>משך</div>
            <DurationPicker
              startTime={startTime} duration={duration} customEnd={customEnd}
              onDuration={(d) => { setDuration(d); if (d !== "custom") setEndErr(null); }}
              onCustomEnd={(v, e) => { setCustomEnd(v); setEndErr(e); }}
              disabled={saving}
            />
          </div>
        )}

        {/* הערות */}
        <div>
          <div style={lbl}>הערות / לינקים / מקום</div>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="הערות, קישורים, כתובת..." rows={3}
            style={{ ...modalInp, resize: "vertical", lineHeight: 1.6 }} disabled={saving} />
          {notes.trim() && (
            <div style={{ fontSize: 12, color: "#666", marginTop: 8, lineHeight: 1.7, whiteSpace: "pre-wrap", background: "#111", borderRadius: 8, padding: "8px 12px", border: "1px solid #252525" }}>
              {renderNotes(notes)}
            </div>
          )}
        </div>

        {task.calendar_event_id && (
          <div style={{ fontSize: 12, color: "#60A5FA", display: "flex", alignItems: "center", gap: 8, background: "rgba(59,130,246,0.07)", border: "1px solid rgba(59,130,246,0.2)", borderRadius: 10, padding: "8px 12px" }}>
            📋 <span>מקושר ל-Google Tasks</span>
          </div>
        )}

        {error && (
          <div style={{ fontSize: 12, color: "#EF4444", lineHeight: 1.4, background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 10, padding: "8px 12px" }}>
            {error}
          </div>
        )}

        {confirmDel && (
          <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
            <span style={{ fontSize: 12, color: "#FCA5A5" }}>מחיקה זו בלתי הפיכה. להמשיך?</span>
            {task.calendar_event_id && (
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={delCalendar} onChange={(e) => setDelCalendar(e.target.checked)} disabled={deleting} style={{ width: 14, height: 14, accentColor: "#EF4444", cursor: "pointer" }} />
                <span style={{ fontSize: 12, color: delCalendar ? "#FCA5A5" : "#666" }}>📋 מחק גם מ-Google Tasks</span>
              </label>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setConfirmDel(false)} disabled={deleting} style={{ ...MODAL_SECONDARY, padding: "6px 14px", fontSize: 12 }}>ביטול</button>
              <button type="button" onClick={handleDelete} disabled={deleting}
                style={{ padding: "6px 14px", borderRadius: 100, fontSize: 12, fontWeight: 600, border: "1.5px solid rgba(239,68,68,0.5)", background: "rgba(239,68,68,0.15)", color: "#F87171", cursor: deleting ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: deleting ? 0.5 : 1 }}>
                {deleting ? "מוחק..." : "מחק"}
              </button>
            </div>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 10, justifyContent: "space-between", alignItems: "center", paddingTop: 4 }}>
          <button type="button" onClick={() => { setConfirmDel(true); setError(null); }} disabled={saving || deleting || confirmDel}
            style={{ padding: "8px 14px", borderRadius: 100, fontSize: 12, border: "1.5px solid #2A2A2A", background: "none", color: "#555", cursor: "pointer", fontFamily: "inherit" }}>
            🗑 מחק
          </button>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" onClick={onClose} disabled={saving || deleting} style={{ ...MODAL_SECONDARY, opacity: (saving || deleting) ? 0.5 : 1 }}>ביטול</button>
            <button type="button" onClick={handleSave} disabled={saving || deleting || !title.trim()} style={{ ...MODAL_PRIMARY, opacity: (saving || deleting || !title.trim()) ? 0.5 : 1 }}>
              {saving ? "שומר..." : "שמור שינויים"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Quick-create form ─────────────────────────────────────────────────────────

interface FormState {
  title: string; notes: string; related_type: TaskRelatedType;
  related_id: string; due_date: string; start_time: string;
  duration: DurationKey; custom_end: string; addToCalendar: boolean;
}

const EMPTY_FORM: FormState = {
  title: "", notes: "", related_type: "general", related_id: "",
  due_date: "", start_time: "", duration: "30", custom_end: "", addToCalendar: false,
};

function TaskForm({ clients, projects, onSaved, onClose }: {
  clients: NamedItem[]; projects: NamedItem[];
  onSaved: (t: Task) => void; onClose: () => void;
}) {
  const [form,        setForm]        = useState<FormState>({ ...EMPTY_FORM });
  const [saving,      setSaving]      = useState(false);
  const [calStatus,   setCalStatus]   = useState<null | "creating">(null);
  const [error,       setError]       = useState<string | null>(null);
  const [timeError,   setTimeError]   = useState<string | null>(null);
  const [endErr,      setEndErr]      = useState<string | null>(null);
  const [pendingTask, setPendingTask] = useState<Task | null>(null);

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => {
      const next = { ...f, [k]: v };
      if (k === "related_type") next.related_id = "";
      if (k === "due_date" && !v) next.addToCalendar = false;
      return next;
    });
    if (k === "start_time") setTimeError(null);
  }

  const effectiveEnd = form.start_time && !timeError
    ? computeEnd(form.start_time, form.duration, form.custom_end) : "";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { setError("כותרת חובה"); return; }
    if ((form.related_type === "client" || form.related_type === "project") && !form.related_id) {
      setError(`חובה לבחור ${RELATED_LABELS[form.related_type]}`); return;
    }
    if (timeError) { setError("שעה לא תקינה"); return; }
    if (endErr)    { setError("שעת סיום לא תקינה"); return; }

    setSaving(true); setError(null);
    try {
      const taskRes = await fetch("/api/tasks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim(), notes: form.notes.trim() || null,
          related_type: form.related_type, related_id: form.related_id || null,
          due_date: form.due_date || null, start_time: form.start_time || null, end_time: effectiveEnd || null,
        }),
      });
      const taskData = await taskRes.json();
      if (!taskRes.ok) throw new Error(taskData.error ?? "שגיאה ביצירת משימה");
      let task: Task = taskData.task;

      if (form.addToCalendar && form.due_date) {
        setCalStatus("creating");
        try {
          const relatedName =
            form.related_type === "client"  ? clients.find((c) => c.id === form.related_id)?.name ?? null :
            form.related_type === "project" ? projects.find((p) => p.id === form.related_id)?.name ?? null : null;
          const gtRes = await fetch("/api/calendar/create-task", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: task.title, due: form.due_date, notes: buildCalendarDescription(form.notes.trim() || null, form.related_type, relatedName) }),
          });
          const gtData = await gtRes.json();
          if (gtRes.ok && gtData.task?.id) {
            const patchRes = await fetch(`/api/tasks/${task.id}`, {
              method: "PATCH", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ calendar_event_id: gtData.task.id }),
            });
            const patchData = await patchRes.json();
            if (patchRes.ok) task = patchData.task;
          } else {
            setSaving(false); setCalStatus(null); setPendingTask(task);
            setError("המשימה נוצרה, אבל לא נוספה ל-Google Tasks"); return;
          }
        } catch {
          setSaving(false); setCalStatus(null); setPendingTask(task);
          setError("המשימה נוצרה, אבל לא נוספה ל-Google Tasks"); return;
        }
      }
      onSaved(task);
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה");
    } finally { setSaving(false); setCalStatus(null); }
  }

  return (
    <div style={{ background: "#141414", border: "1px solid #2A2A2A", borderRadius: 16, padding: "20px 22px", marginBottom: 16, boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}>
      <form onSubmit={handleSubmit} dir="rtl" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#A855F7", textTransform: "uppercase", letterSpacing: "0.07em" }}>
          + משימה חדשה
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12 }}>
          <div>
            <div style={lbl}>כותרת *</div>
            <input autoFocus value={form.title} onChange={(e) => set("title", e.target.value)}
              placeholder="כותרת המשימה" style={{ ...inp, fontSize: 13, padding: "9px 12px" }} disabled={saving} />
          </div>
          <div>
            <div style={lbl}>קשור ל</div>
            <select value={form.related_type} onChange={(e) => set("related_type", e.target.value as TaskRelatedType)} style={inp} disabled={saving}>
              <option value="general">כללי</option>
              <option value="client">לקוח</option>
              <option value="project">פרויקט</option>
            </select>
          </div>
          <div>
            {form.related_type === "client" && <>
              <div style={lbl}>לקוח *</div>
              <select value={form.related_id} onChange={(e) => set("related_id", e.target.value)} style={inp} disabled={saving}>
                <option value="">— בחר —</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </>}
            {form.related_type === "project" && <>
              <div style={lbl}>פרויקט *</div>
              <select value={form.related_id} onChange={(e) => set("related_id", e.target.value)} style={inp} disabled={saving}>
                <option value="">— בחר —</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </>}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 2fr", gap: 12 }}>
          <div>
            <div style={lbl}>תאריך</div>
            <DatePickerInput value={form.due_date} onChange={(v) => set("due_date", v)} placeholder="אופציונלי" style={inp} />
          </div>
          <div>
            <div style={lbl}>שעה</div>
            <TimeInput value={form.start_time} onChange={(v, e) => { set("start_time", v); setTimeError(e); }} disabled={saving} />
          </div>
          <div>
            <div style={lbl}>הערות</div>
            <input value={form.notes} onChange={(e) => set("notes", e.target.value)}
              placeholder="הערות אופציונליות..." style={inp} disabled={saving} />
          </div>
        </div>

        {form.start_time && !timeError && (
          <div>
            <div style={lbl}>משך</div>
            <DurationPicker startTime={form.start_time} duration={form.duration} customEnd={form.custom_end}
              onDuration={(d) => { set("duration", d); if (d !== "custom") setEndErr(null); }}
              onCustomEnd={(v, e) => { set("custom_end", v); setEndErr(e); }}
              disabled={saving} compact />
          </div>
        )}

        {form.due_date && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={form.addToCalendar} onChange={(e) => set("addToCalendar", e.target.checked)}
              disabled={saving} style={{ width: 14, height: 14, accentColor: "#2563EB", cursor: "pointer" }} />
            <span style={{ fontSize: 12, color: form.addToCalendar ? "#60A5FA" : "#666" }}>📋 הוסף כמשימה ב-Google Tasks</span>
          </label>
        )}

        {error && <div style={{ fontSize: 11, color: pendingTask ? "#FBBF24" : "#EF4444" }}>{error}</div>}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose} disabled={saving}
            style={{ padding: "8px 18px", borderRadius: 100, border: "1.5px solid #383838", background: "#1E1E1E", color: "#777", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
            ביטול
          </button>
          {pendingTask ? (
            <button type="button" onClick={() => { onSaved(pendingTask); setPendingTask(null); }}
              style={{ padding: "8px 20px", borderRadius: 100, border: "1px solid rgba(245,158,11,0.4)", background: "rgba(245,158,11,0.1)", color: "#FBBF24", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
              הוסף לרשימה ✓
            </button>
          ) : (
            <button type="submit" disabled={saving || !form.title.trim()}
              style={{
                padding: "8px 22px", borderRadius: 100, fontSize: 13, fontWeight: 700,
                border: "1.5px solid rgba(59,130,246,0.5)", background: "rgba(59,130,246,0.15)",
                color: saving ? "#4A7FC0" : "#60A5FA",
                cursor: (saving || !form.title.trim()) ? "not-allowed" : "pointer",
                fontFamily: "inherit", opacity: !form.title.trim() ? 0.5 : 1,
              }}>
              {saving ? (calStatus === "creating" ? "מוסיף לגוגל..." : "שומר...") : "הוסף משימה"}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

// ── TaskRow (table row) ───────────────────────────────────────────────────────

function TaskRow({ task, relatedName, today, onOpenDetail }: {
  task: Task; relatedName: string | null; today: string; onOpenDetail: (t: Task) => void;
}) {
  const { openProject } = useGlobalProjectDrawer();
  const router = useRouter();
  const [cycling,     setCycling]     = useState(false);
  const [localStatus, setLocalStatus] = useState<TaskStatus>(task.status);

  const sc        = STATUS_COLOR[localStatus];
  const isOverdue = task.due_date && task.due_date < today && localStatus === "פתוח";
  const isToday   = task.due_date === today && localStatus === "פתוח";

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
      if (res.ok) setLocalStatus(next);
    } catch { /* ignore */ }
    finally { setCycling(false); }
  }

  function handleRelatedClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (!task.related_id) return;
    if (task.related_type === "project") openProject(task.related_id);
    else if (task.related_type === "client") router.push(`/clients?open=${task.related_id}`);
    else if (task.related_type === "red_film_production") router.push(`/red-films/${task.related_id}`);
  }

  const relIcon =
    task.related_type === "client"             ? "👤" :
    task.related_type === "red_film_production" ? "🎬" : "♫";

  const relColor =
    task.related_type === "client"             ? "#C084FC" :
    task.related_type === "red_film_production" ? "#EC4899" : "#60A5FA";

  return (
    <div
      onClick={() => onOpenDetail({ ...task, status: localStatus })}
      className="grid border-b transition-all"
      style={{
        gridTemplateColumns: "40px 1fr 180px 130px 80px 32px",
        borderColor: isOverdue ? "rgba(239,68,68,0.12)" : "#1E1E1E",
        background: isOverdue ? "rgba(239,68,68,0.02)" : "transparent",
        cursor: "pointer",
        opacity: localStatus === "בוטל" ? 0.45 : 1,
        minHeight: 48,
        alignItems: "center",
      }}
    >
      {/* Status toggle */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", paddingRight: 4 }}>
        <button
          onClick={cycleStatus}
          disabled={cycling}
          title={`שנה סטטוס → ${STATUS_NEXT[localStatus]}`}
          style={{
            width: 26, height: 26, borderRadius: "50%",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: sc.bg, border: `1.5px solid ${sc.border}`,
            color: sc.color, cursor: cycling ? "not-allowed" : "pointer",
            fontSize: 12, fontFamily: "inherit", transition: "all 150ms",
            opacity: cycling ? 0.5 : 1, flexShrink: 0,
          }}
        >
          {localStatus === "בוצע" ? "✓" : localStatus === "בוטל" ? "✕" : "○"}
        </button>
      </div>

      {/* Title + notes */}
      <div style={{ padding: "10px 12px 10px 0", minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 600, lineHeight: 1.3,
          textDecoration: localStatus === "בוצע" ? "line-through" : "none",
          color: localStatus === "בוטל" ? "#444" : localStatus === "בוצע" ? "#666" : "#E0E0E0",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {task.title}
        </div>
        {task.notes && (
          <div style={{ fontSize: 11, color: "#444", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {task.notes}
          </div>
        )}
      </div>

      {/* Related */}
      <div style={{ padding: "0 8px", minWidth: 0 }}>
        {relatedName && task.related_id ? (
          <button onClick={handleRelatedClick} style={{
            background: "none", border: "none", padding: 0, fontFamily: "inherit",
            fontSize: 12, color: relColor, cursor: "pointer",
            textDecoration: "underline", textDecorationStyle: "dotted",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            maxWidth: "100%", display: "block",
          }}>
            {relIcon} {task.related_type === "red_film_production" ? `Red Films / ${relatedName}` : relatedName}
          </button>
        ) : (
          <span style={{ fontSize: 11, color: "#333" }}>—</span>
        )}
      </div>

      {/* Due date */}
      <div style={{ padding: "0 8px", fontSize: 12, color: isOverdue ? "#F87171" : isToday ? "#FBBF24" : "#666", whiteSpace: "nowrap" }}>
        {task.due_date ? (
          <>
            {isOverdue && <span style={{ marginLeft: 3 }}>⚠</span>}
            {isToday && <span style={{ marginLeft: 3 }}>📌</span>}
            {fmtDate(task.due_date)}
            {task.start_time && (
              <span style={{ color: "#555", marginRight: 4 }}>
                {" "}{fmtTime(task.start_time)}
              </span>
            )}
          </>
        ) : (
          <span style={{ color: "#333" }}>—</span>
        )}
      </div>

      {/* Status badge */}
      <div style={{ padding: "0 8px" }}>
        <span style={{
          padding: "3px 10px", borderRadius: 20,
          background: sc.bg, color: sc.color, border: `1px solid ${sc.border}`,
          fontSize: 10, fontWeight: 700, letterSpacing: "0.03em", whiteSpace: "nowrap",
        }}>
          {localStatus}
        </span>
      </div>

      {/* Google Tasks icon */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        {task.calendar_event_id && (
          <span title="מקושר ל-Google Tasks" style={{ fontSize: 14, opacity: 0.4 }}>📋</span>
        )}
      </div>
    </div>
  );
}

// ── StatCard ──────────────────────────────────────────────────────────────────

function StatCard({ label, value, color, rgb, onClick, active }: {
  label: string; value: number; color: string; rgb: string;
  onClick: () => void; active: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, minWidth: 0, textAlign: "right", direction: "rtl",
        padding: "14px 16px", borderRadius: 12,
        border: active ? `1.5px solid rgba(${rgb},0.45)` : "1px solid #222",
        background: active ? `rgba(${rgb},0.08)` : "#161616",
        cursor: "pointer", fontFamily: "inherit",
        transition: "all 150ms",
      }}
    >
      <div style={{ fontSize: 22, fontWeight: 800, color: active ? color : "#888", letterSpacing: "-0.02em", lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: active ? color : "#555", marginTop: 4, fontWeight: active ? 600 : 400 }}>
        {label}
      </div>
    </button>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TasksPage() {
  const today = new Date().toISOString().split("T")[0];

  const [tasks,       setTasks]       = useState<Task[]>([]);
  const [clients,     setClients]     = useState<NamedItem[]>([]);
  const [projects,    setProjects]    = useState<NamedItem[]>([]);
  const [productions, setProductions] = useState<NamedItem[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [showForm,    setShowForm]    = useState(false);
  const [filter,      setFilter]      = useState<FilterTab>("פתוחות");
  const [detailTask,  setDetailTask]  = useState<Task | null>(null);
  const [syncing,     setSyncing]     = useState(false);
  const [syncMsg,     setSyncMsg]     = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tRes, cRes, pRes, rfRes] = await Promise.all([
        fetch("/api/tasks"),
        fetch("/api/clients"),
        fetch("/api/projects"),
        fetch("/api/red-films/productions"),
      ]);
      const [tData, cData, pData, rfData] = await Promise.all([
        tRes.json(), cRes.json(), pRes.json(), rfRes.json(),
      ]);
      setTasks(tData.tasks ?? []);
      setClients((cData.clients ?? []).map((c: { id: string; name: string }) => ({ id: c.id, name: c.name })));
      const projArr: { id: string; name: string }[] = Array.isArray(pData) ? pData : (pData.projects ?? []);
      setProjects(projArr.map((p) => ({ id: p.id, name: p.name })));
      setProductions((rfData.productions ?? []).map((p: { id: string; title: string }) => ({ id: p.id, name: p.title })));
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  // Silent sync on mount
  useEffect(() => {
    load().then(() => {
      fetch("/api/calendar/tasks/sync", { method: "POST" })
        .then((r) => r.json())
        .then((d) => { if (d.synced > 0) load(); })
        .catch(() => { /* google not connected — silent */ });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleManualSync() {
    if (syncing) return;
    setSyncing(true); setSyncMsg(null);
    try {
      const res  = await fetch("/api/calendar/tasks/sync", { method: "POST" });
      const data = await res.json();
      if (data.skipped === "not_connected") setSyncMsg("גוגל לא מחובר");
      else if (data.synced > 0) { setSyncMsg(`עודכנו ${data.synced} משימות`); await load(); }
      else setSyncMsg("הכל מעודכן");
    } catch { setSyncMsg("שגיאת סנכרון"); }
    finally { setSyncing(false); setTimeout(() => setSyncMsg(null), 3000); }
  }

  const clientMap     = new Map(clients.map((c) => [c.id, c.name]));
  const projectMap    = new Map(projects.map((p) => [p.id, p.name]));
  const productionMap = new Map(productions.map((p) => [p.id, p.name]));

  function getRelatedName(task: Task): string | null {
    if (!task.related_id) return null;
    if (task.related_type === "client")              return clientMap.get(task.related_id) ?? null;
    if (task.related_type === "project")             return projectMap.get(task.related_id) ?? null;
    if (task.related_type === "red_film_production") return productionMap.get(task.related_id) ?? null;
    return null;
  }

  const openTasks    = tasks.filter((t) => t.status === "פתוח");
  const todayTasks   = tasks.filter((t) => t.due_date === today && t.status === "פתוח");
  const overdueTasks = tasks.filter((t) => t.due_date && t.due_date < today && t.status === "פתוח");
  const doneTasks    = tasks.filter((t) => t.status === "בוצע");
  const cancelTasks  = tasks.filter((t) => t.status === "בוטל");

  const counts: Record<FilterTab, number> = {
    "הכל":    tasks.length,
    "פתוחות": openTasks.length,
    "להיום":  todayTasks.length,
    "באיחור": overdueTasks.length,
    "הושלמו": doneTasks.length,
    "בוטל":   cancelTasks.length,
  };

  function getFiltered(): Task[] {
    switch (filter) {
      case "פתוחות": return openTasks;
      case "להיום":  return todayTasks;
      case "באיחור": return overdueTasks;
      case "הושלמו": return doneTasks;
      case "בוטל":   return cancelTasks;
      default:       return tasks;
    }
  }

  const sorted = [...getFiltered()].sort((a, b) => {
    const aOver = a.due_date && a.due_date < today && a.status === "פתוח" ? 0 : 1;
    const bOver = b.due_date && b.due_date < today && b.status === "פתוח" ? 0 : 1;
    if (aOver !== bOver) return aOver - bOver;
    if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
    if (a.due_date) return -1;
    if (b.due_date) return 1;
    return b.created_at.localeCompare(a.created_at);
  });

  function handleSaved(task: Task) {
    setTasks((prev) => [task, ...prev]);
    setShowForm(false);
    setFilter("פתוחות");
  }

  function handleUpdated(updated: Task) {
    setTasks((prev) => prev.map((t) => t.id === updated.id ? updated : t));
    setDetailTask(null);
  }

  function handleDeleted(id: string) {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    setDetailTask(null);
  }

  const filterAccent: Record<FilterTab, { color: string; rgb: string }> = {
    "הכל":    { color: "#60A5FA", rgb: "59,130,246"  },
    "פתוחות": { color: "#60A5FA", rgb: "59,130,246"  },
    "להיום":  { color: "#FBBF24", rgb: "251,191,36"  },
    "באיחור": { color: "#F87171", rgb: "239,68,68"   },
    "הושלמו": { color: "#34D399", rgb: "16,185,129"  },
    "בוטל":   { color: "#6B7280", rgb: "107,114,128" },
  };

  return (
    <div dir="rtl" style={{ fontFamily: "inherit", minHeight: "80vh" }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20, gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: "#F0F0F0", margin: 0, letterSpacing: "-0.02em" }}>
            משימות
          </h1>
          <div style={{ fontSize: 12, color: "#444", marginTop: 3 }}>
            {counts["פתוחות"]} פתוחות
            {overdueTasks.length > 0 && <span style={{ color: "#F87171", marginRight: 8 }}>· {overdueTasks.length} באיחור</span>}
            {todayTasks.length > 0   && <span style={{ color: "#FBBF24", marginRight: 8 }}>· {todayTasks.length} להיום</span>}
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexShrink: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            <button onClick={handleManualSync} disabled={syncing}
              style={{
                padding: "8px 14px", borderRadius: 10,
                border: "1px solid #2A2A2A", background: "#161616",
                color: syncing ? "#444" : "#555", fontSize: 12,
                cursor: syncing ? "not-allowed" : "pointer", fontFamily: "inherit",
                display: "flex", alignItems: "center", gap: 6, transition: "all 150ms",
              }}>
              <span style={{ fontSize: 13 }}>{syncing ? "⟳" : "↻"}</span>
              {syncing ? "מסנכרן..." : "סנכרן גוגל"}
            </button>
            {syncMsg && (
              <div style={{ fontSize: 11, color: syncMsg.includes("עודכנו") ? "#34D399" : "#555" }}>
                {syncMsg}
              </div>
            )}
          </div>

          <button
            onClick={() => setShowForm((v) => !v)}
            style={{
              padding: "8px 18px", borderRadius: 10,
              border: showForm ? "1.5px solid rgba(59,130,246,0.6)" : "1.5px solid rgba(59,130,246,0.3)",
              background: showForm ? "rgba(59,130,246,0.2)" : "rgba(59,130,246,0.1)",
              color: "#60A5FA", fontSize: 13, fontWeight: 700,
              cursor: "pointer", fontFamily: "inherit", transition: "all 150ms",
            }}>
            {showForm ? "✕ סגור" : "+ משימה חדשה"}
          </button>
        </div>
      </div>

      {/* ── Stat cards ── */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        <StatCard label="פתוחות"  value={counts["פתוחות"]} color="#60A5FA" rgb="59,130,246"  onClick={() => setFilter("פתוחות")} active={filter === "פתוחות"} />
        <StatCard label="להיום"   value={counts["להיום"]}  color="#FBBF24" rgb="251,191,36"  onClick={() => setFilter("להיום")}  active={filter === "להיום"}  />
        <StatCard label="באיחור"  value={counts["באיחור"]} color="#F87171" rgb="239,68,68"   onClick={() => setFilter("באיחור")} active={filter === "באיחור"} />
        <StatCard label="הושלמו"  value={counts["הושלמו"]} color="#34D399" rgb="16,185,129"  onClick={() => setFilter("הושלמו")} active={filter === "הושלמו"} />
      </div>

      {/* ── Quick create form ── */}
      {showForm && (
        <TaskForm clients={clients} projects={projects} onSaved={handleSaved} onClose={() => setShowForm(false)} />
      )}

      {/* ── Filter tabs ── */}
      <div style={{ display: "flex", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
        {FILTER_TABS.map((tab) => {
          const active = filter === tab;
          const accent = filterAccent[tab];
          return (
            <button key={tab} onClick={() => setFilter(tab)}
              style={{
                padding: "5px 14px", borderRadius: 20,
                border: active ? `1.5px solid rgba(${accent.rgb},0.5)` : "1px solid #252525",
                background: active ? `rgba(${accent.rgb},0.1)` : "#1A1A1A",
                color: active ? accent.color : "#555",
                fontSize: 12, fontWeight: active ? 700 : 400,
                cursor: "pointer", fontFamily: "inherit", transition: "all 120ms",
              }}>
              {tab}
              {counts[tab] > 0 && <span style={{ marginRight: 5, fontSize: 10, opacity: 0.65 }}>({counts[tab]})</span>}
            </button>
          );
        })}
      </div>

      {/* ── Table ── */}
      <div style={{ background: "#111", border: "1px solid #1E1E1E", borderRadius: 14, overflow: "hidden", marginTop: 8 }}>

        {/* Table header */}
        <div
          className="grid"
          dir="rtl"
          style={{
            gridTemplateColumns: "40px 1fr 180px 130px 80px 32px",
            borderBottom: "1px solid #1E1E1E",
            background: "#141414",
            padding: "0",
          }}
        >
          {[
            { w: "40px",  label: "" },
            { w: "1fr",   label: "משימה" },
            { w: "180px", label: "שיוך" },
            { w: "130px", label: "תאריך יעד" },
            { w: "80px",  label: "סטטוס" },
            { w: "32px",  label: "" },
          ].map(({ label: hLabel }, i) => (
            <div key={i} style={{
              padding: hLabel ? "9px 8px" : "9px 4px",
              fontSize: 10, fontWeight: 700, color: "#3A3A3A",
              letterSpacing: "0.07em", textTransform: "uppercase",
              paddingRight: i === 1 ? 12 : undefined,
            }}>
              {hLabel}
            </div>
          ))}
        </div>

        {/* Rows */}
        {loading ? (
          <div style={{ padding: "48px 0", textAlign: "center", color: "#333", fontSize: 13 }}>
            טוען משימות...
          </div>
        ) : sorted.length === 0 ? (
          <div style={{ padding: "64px 0", textAlign: "center", color: "#2A2A2A", fontSize: 14 }}>
            {filter === "פתוחות" ? "אין משימות פתוחות 🎉"
             : filter === "באיחור" ? "אין משימות באיחור 🎉"
             : `אין משימות ב"${filter}"`}
          </div>
        ) : (
          sorted.map((task) => (
            <TaskRow
              key={task.id + task.updated_at}
              task={task}
              relatedName={getRelatedName(task)}
              today={today}
              onOpenDetail={setDetailTask}
            />
          ))
        )}
      </div>

      {/* ── Detail modal ── */}
      {detailTask && (
        <TaskDetailModal
          task={detailTask}
          clients={clients}
          projects={projects}
          onClose={() => setDetailTask(null)}
          onUpdated={handleUpdated}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  );
}
