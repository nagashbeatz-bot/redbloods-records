"use client";

import { useEffect, useState } from "react";
import type { Project } from "@/lib/types";

interface Task {
  id: string;
  title: string;
  notes: string | null;
  status: "פתוח" | "בוצע" | "בוטל";
  related_type: string;
  related_id: string | null;
  due_date: string | null;
  created_at: string;
}

interface Props {
  project: Project;
  accentColor: string;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const parts = dateStr.split("-");
  if (parts.length < 3) return dateStr;
  return `${parts[2]}.${parts[1]}`;
}

function statusStyle(status: Task["status"]): React.CSSProperties {
  if (status === "בוצע") return { background: "rgba(34,197,94,0.12)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.3)" };
  if (status === "בוטל") return { background: "rgba(239,68,68,0.10)", color: "#EF4444", border: "1px solid rgba(239,68,68,0.3)" };
  return { background: "rgba(59,130,246,0.12)", color: "#3B82F6", border: "1px solid rgba(59,130,246,0.3)" };
}

export default function AlbumTasksTab({ project, accentColor }: Props) {
  const [tasks,   setTasks]   = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/tasks?related_type=project&related_id=${project.id}`)
      .then((r) => r.json())
      .then((data: { tasks?: Task[] } | Task[]) => {
        const list = Array.isArray(data) ? data : (data as { tasks?: Task[] }).tasks ?? [];
        setTasks(list);
      })
      .catch(() => setTasks([]))
      .finally(() => setLoading(false));
  }, [project.id]);

  if (loading) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#444", fontSize: 13 }}>
        טוען משימות...
      </div>
    );
  }

  const open   = tasks.filter((t) => t.status === "פתוח");
  const done   = tasks.filter((t) => t.status === "בוצע");
  const cancelled = tasks.filter((t) => t.status === "בוטל");

  const Section = ({ title, items, emptyMsg }: { title: string; items: Task[]; emptyMsg: string }) => (
    <div
      style={{
        background: "#1A1A1A",
        border: "1px solid #252525",
        borderRadius: 14,
        overflow: "hidden",
        marginBottom: 16,
      }}
    >
      <div
        style={{
          padding: "14px 18px",
          borderBottom: "1px solid #1E1E1E",
          fontSize: 11,
          fontWeight: 700,
          color: "#888",
        }}
      >
        {title} ({items.length})
      </div>
      {items.length === 0 ? (
        <div style={{ padding: "16px 18px", color: "#333", fontSize: 12 }}>{emptyMsg}</div>
      ) : (
        items.map((task) => (
          <div
            key={task.id}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
              padding: "12px 18px",
              borderBottom: "1px solid #141414",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: task.status === "בוצע" ? "#555" : "#D0D0D0",
                  textDecoration: task.status === "בוטל" ? "line-through" : "none",
                  marginBottom: task.notes ? 4 : 0,
                }}
              >
                {task.title}
              </div>
              {task.notes && (
                <div style={{ fontSize: 11, color: "#555", lineHeight: 1.5 }}>{task.notes}</div>
              )}
            </div>
            {task.due_date && (
              <span style={{ fontSize: 11, color: "#555", flexShrink: 0, marginTop: 2 }}>
                📅 {formatDate(task.due_date)}
              </span>
            )}
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: "2px 8px",
                borderRadius: 6,
                flexShrink: 0,
                ...statusStyle(task.status),
              }}
            >
              {task.status}
            </span>
          </div>
        ))
      )}
    </div>
  );

  if (tasks.length === 0) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
        }}
      >
        <div style={{ fontSize: 36, opacity: 0.15 }}>✅</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#444" }}>אין משימות לפרויקט הזה</div>
        <div style={{ fontSize: 12, color: "#333" }}>
          ניתן ליצור משימות מקושרות לפרויקט זה דרך מודול המשימות
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        height: "100%",
        overflowY: "auto",
        padding: "24px 28px",
        boxSizing: "border-box",
        direction: "rtl",
      }}
    >
      {open.length > 0      && <Section title="📋 פתוחות"  items={open}       emptyMsg="אין משימות פתוחות" />}
      {done.length > 0      && <Section title="✅ הושלמו"  items={done}       emptyMsg="אין משימות שהושלמו" />}
      {cancelled.length > 0 && <Section title="🚫 בוטלו"   items={cancelled}  emptyMsg="אין משימות שבוטלו" />}
    </div>
  );
}
