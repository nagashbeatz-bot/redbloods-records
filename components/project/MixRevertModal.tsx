"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import type { ProjectStatus } from "@/lib/types";

interface TaskRow {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
  calendar_event_id: string | null;
}

interface Props {
  projectId: string;
  projectName: string;
  nextStatus: ProjectStatus;
  onConfirm: () => Promise<void>;   // called after all deletions — runs doUpdate
  onCancel: () => void;
}

// Tasks with these statuses are pre-checked for deletion
const AUTO_CHECK_STATUSES = ["פתוח", "בוטל"];

function isMixTask(title: string, projectName: string): boolean {
  return title.startsWith(`מעקב מיקס — ${projectName}`);
}

export default function MixRevertModal({
  projectId,
  projectName,
  nextStatus,
  onConfirm,
  onCancel,
}: Props) {
  const [step, setStep]           = useState<"choice" | "list" | "deleting">("choice");
  const [tasks, setTasks]         = useState<TaskRow[]>([]);
  const [checked, setChecked]     = useState<Set<string>>(new Set());
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [saving, setSaving]       = useState(false);
  const [errors, setErrors]       = useState<string[]>([]);

  // ── Fetch tasks when user chooses "בחר משימות" ───────────────────────────────
  async function loadTasks() {
    setLoadingTasks(true);
    try {
      const res  = await fetch(
        `/api/tasks?related_type=project&related_id=${projectId}`
      );
      const data = await res.json() as { tasks: TaskRow[] };
      const rows = data.tasks ?? [];
      setTasks(rows);
      // Pre-check mix tasks that are not "בוצע"
      const preChecked = new Set(
        rows
          .filter(
            (t) =>
              isMixTask(t.title, projectName) &&
              AUTO_CHECK_STATUSES.includes(t.status)
          )
          .map((t) => t.id)
      );
      setChecked(preChecked);
      setStep("list");
    } catch {
      setErrors(["שגיאה בטעינת משימות הפרויקט"]);
    } finally {
      setLoadingTasks(false);
    }
  }

  // ── Delete selected tasks (calendar first, then DB) ──────────────────────────
  async function handleDelete() {
    setSaving(true);
    setErrors([]);
    const failed: string[] = [];

    for (const taskId of Array.from(checked)) {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) continue;

      // 1. Delete Google Task if linked
      if (task.calendar_event_id) {
        const calRes = await fetch(
          `/api/calendar/tasks/${task.calendar_event_id}`,
          { method: "DELETE" }
        );
        if (!calRes.ok) {
          const calData = await calRes.json().catch(() => ({})) as { error?: string };
          failed.push(
            `"${task.title}" — לא הצלחנו למחוק מהיומן (${calData.error ?? "שגיאה"}). המשימה לא נמחקה.`
          );
          continue; // do NOT delete from DB
        }
      }

      // 2. Delete task from DB
      const taskRes = await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
      if (!taskRes.ok) {
        failed.push(`"${task.title}" — מחיקה נכשלה`);
      }
    }

    setSaving(false);

    if (failed.length > 0) {
      setErrors(failed);
      return; // don't change status if any deletion failed
    }

    // 3. All deletions succeeded — update project status
    await onConfirm();
  }

  // ── Styles ────────────────────────────────────────────────────────────────────
  const overlay: React.CSSProperties = {
    position: "fixed", inset: 0, zIndex: 99999,
    background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)",
    display: "flex", alignItems: "center", justifyContent: "center",
  };
  const card: React.CSSProperties = {
    background: "#141414", border: "1px solid #262626",
    borderRadius: 22, padding: "24px 24px 20px",
    width: 420, maxHeight: "85vh", overflowY: "auto",
    direction: "rtl", boxShadow: "0 24px 64px rgba(0,0,0,0.9)",
  };
  const btnPrimary: React.CSSProperties = {
    display: "block", width: "100%", padding: "11px 0",
    borderRadius: 12, border: "1px solid rgba(168,85,247,0.4)",
    background: "rgba(168,85,247,0.12)", color: "#C084FC",
    cursor: "pointer", fontSize: 13, fontWeight: 700,
    fontFamily: "inherit", textAlign: "center", marginBottom: 8,
  };
  const btnSecondary: React.CSSProperties = {
    display: "block", width: "100%", padding: "10px 0",
    borderRadius: 12, border: "1px solid #2A2A2A",
    background: "transparent", color: "#888",
    cursor: "pointer", fontSize: 13, fontFamily: "inherit",
    textAlign: "center", marginBottom: 8,
  };
  const btnDanger: React.CSSProperties = {
    display: "block", width: "100%", padding: "11px 0",
    borderRadius: 12, border: "1px solid rgba(239,68,68,0.4)",
    background: "rgba(239,68,68,0.1)", color: "#F87171",
    cursor: saving ? "wait" : "pointer", fontSize: 13, fontWeight: 700,
    fontFamily: "inherit", textAlign: "center", marginBottom: 8,
    opacity: saving ? 0.6 : 1,
  };

  // ── Render ─────────────────────────────────────────────────────────────────────
  const modal = (
    <div onClick={onCancel} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={card}>

        {/* Header */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: "#F59E0B", fontWeight: 700, letterSpacing: 1, marginBottom: 6 }}>
            ↩ חזרה משלב מיקס
          </div>
          <div style={{ fontSize: 17, fontWeight: 800, color: "#F0F0F0" }}>
            {projectName}
          </div>
          <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>
            הפרויקט עובר מ-"במיקס" ל-"{nextStatus}".
            <br />מה לעשות עם משימות ודד-ליינים שנוצרו למיקס?
          </div>
        </div>

        {/* ── Step: choice ─────────────────────────────────────── */}
        {step === "choice" && (
          <>
            <button style={btnPrimary} onClick={onConfirm}>
              השאר הכול ורק שנה סטטוס
            </button>
            <button
              style={btnSecondary}
              disabled={loadingTasks}
              onClick={loadTasks}
            >
              {loadingTasks ? "טוען..." : "בחר משימות למחיקה →"}
            </button>
            <button style={{ ...btnSecondary, color: "#555", marginBottom: 0 }} onClick={onCancel}>
              ביטול
            </button>
          </>
        )}

        {/* ── Step: list ───────────────────────────────────────── */}
        {step === "list" && (
          <>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 12 }}>
              {tasks.length === 0
                ? "אין משימות פרויקט."
                : `${tasks.length} משימות נמצאו. בחר אילו למחוק:`}
            </div>

            {tasks.length > 0 && (
              <div style={{
                border: "1px solid #252525", borderRadius: 10,
                overflow: "hidden", marginBottom: 16,
              }}>
                {tasks.map((task, idx) => {
                  const isChecked = checked.has(task.id);
                  const isMix = isMixTask(task.title, projectName);
                  const isDone = task.status === "בוצע";
                  return (
                    <label
                      key={task.id}
                      style={{
                        display: "flex", alignItems: "flex-start", gap: 10,
                        padding: "10px 12px", cursor: "pointer",
                        borderBottom: idx < tasks.length - 1 ? "1px solid #1E1E1E" : "none",
                        background: isChecked ? "rgba(239,68,68,0.04)" : "transparent",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {
                          setChecked((prev) => {
                            const next = new Set(prev);
                            next.has(task.id) ? next.delete(task.id) : next.add(task.id);
                            return next;
                          });
                        }}
                        style={{ marginTop: 2, width: 14, height: 14, accentColor: "#EF4444", cursor: "pointer", flexShrink: 0 }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 12, fontWeight: 600,
                          color: isDone ? "#555" : "#C0C0C0",
                          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                        }}>
                          {task.title}
                          {isDone && <span style={{ color: "#4B5563", fontWeight: 400, marginRight: 6 }}>(בוצע)</span>}
                        </div>
                        <div style={{ display: "flex", gap: 8, marginTop: 3, flexWrap: "wrap" }}>
                          {task.due_date && (
                            <span style={{ fontSize: 10, color: "#555" }}>
                              {task.due_date.split("-").reverse().join("/")}
                            </span>
                          )}
                          {task.calendar_event_id && (
                            <span style={{ fontSize: 10, color: "#60A5FA" }}>📋 יומן</span>
                          )}
                          {isMix && (
                            <span style={{ fontSize: 10, color: "#A855F7" }}>⚡ מיקס</span>
                          )}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}

            {/* Errors */}
            {errors.length > 0 && (
              <div style={{
                fontSize: 11, color: "#F87171",
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.2)",
                borderRadius: 8, padding: "8px 10px",
                marginBottom: 14, lineHeight: 1.7,
              }}>
                {errors.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}

            <button
              style={btnDanger}
              disabled={saving || checked.size === 0}
              onClick={handleDelete}
            >
              {saving
                ? "מוחק..."
                : checked.size === 0
                ? "לא נבחרו משימות"
                : `מחק ${checked.size} משימה${checked.size > 1 ? "ות" : ""} ושנה סטטוס`}
            </button>
            <button style={btnPrimary} disabled={saving} onClick={onConfirm}>
              שנה סטטוס בלבד
            </button>
            <button
              style={{ ...btnSecondary, marginBottom: 0 }}
              disabled={saving}
              onClick={onCancel}
            >
              ביטול
            </button>
          </>
        )}

      </div>
    </div>
  );

  return typeof document !== "undefined"
    ? createPortal(modal, document.body)
    : null;
}
