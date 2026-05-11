"use client";

import { useState, useEffect } from "react";
import { useProjects } from "@/components/ProjectsProvider";

export default function DailyHeader() {
  const { projects } = useProjects();
  const [time, setTime] = useState("");
  const [dateLabel, setDateLabel] = useState("");

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setTime(
        now.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })
      );
      setDateLabel(
        now.toLocaleDateString("he-IL", {
          weekday: "long",
          day: "numeric",
          month: "long",
        })
      );
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  const overdue = projects.filter(
    (p) => p.isOverdue && p.status !== "הושלם"
  ).length;

  const active = projects.filter(
    (p) => p.status === "בעבודה" || p.status === "במיקס" || p.status === "מחכה למיקס"
  ).length;

  const hour = new Date().getHours();
  const greeting =
    hour < 5 ? "לילה טוב" : hour < 12 ? "בוקר טוב" : hour < 17 ? "צהריים טובים" : "ערב טוב";

  function handleOrderDay() {
    window.dispatchEvent(
      new CustomEvent("rb:quicksend", { detail: "סדר לי את היום לפי עדיפויות ודדליינים. תציג רשימת משימות ממוקדת." })
    );
  }

  return (
    <div className="flex items-start justify-between">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-2xl font-bold" style={{ color: "#F0F0F0" }}>
            {greeting} ✦
          </h1>
        </div>
        <p className="text-sm" style={{ color: "#555" }}>
          {dateLabel}
          {dateLabel && " · "}
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{time}</span>
        </p>

        {/* Status line */}
        <div className="flex items-center gap-3 mt-2.5 flex-wrap">
          {overdue > 0 && (
            <span
              className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border"
              style={{
                color: "#EF4444",
                background: "rgba(239,68,68,0.08)",
                borderColor: "rgba(239,68,68,0.25)",
              }}
            >
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#EF4444", display: "inline-block" }} />
              {overdue} {overdue === 1 ? "פרויקט עבר" : "פרויקטים עברו"} דדליין
            </span>
          )}
          {active > 0 && (
            <span
              className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border"
              style={{
                color: "#3B82F6",
                background: "rgba(59,130,246,0.08)",
                borderColor: "rgba(59,130,246,0.2)",
              }}
            >
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#3B82F6", display: "inline-block" }} />
              {active} {active === 1 ? "פרויקט" : "פרויקטים"} בעבודה פעילה
            </span>
          )}
          {overdue === 0 && active === 0 && (
            <span className="text-sm" style={{ color: "#555" }}>הכל תחת שליטה 🎵</span>
          )}
        </div>
      </div>

      {/* Quick action button */}
      <button
        onClick={handleOrderDay}
        className="flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium transition-all mt-1"
        style={{
          background: "rgba(59,130,246,0.08)",
          borderColor: "rgba(59,130,246,0.25)",
          color: "#3B82F6",
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = "rgba(59,130,246,0.15)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = "rgba(59,130,246,0.08)";
        }}
      >
        <span>✦</span>
        סדר לי את היום
      </button>
    </div>
  );
}
