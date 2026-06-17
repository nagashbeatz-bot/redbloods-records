"use client";

import { useState, useEffect } from "react";
import { useProjects } from "@/components/ProjectsProvider";
import { useRadio } from "@/components/radio/RadioProvider";

export default function DailyHeader() {
  const { projects } = useProjects();
  const radio = useRadio();
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

  const isRadioPlaying = radio?.playing ?? false;
  function handleRadioToggle() {
    if (!radio) return;
    isRadioPlaying ? radio.stop() : radio.play();
  }

  return (
    <div style={{ direction: "rtl" }}>
      {/* ── Top row: greeting + radio (mobile) / greeting + "order day" (desktop) ── */}
      <div className="flex items-start justify-between gap-3">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <h1 className="text-2xl md:text-4xl font-black" style={{ color: "#F0F0F0", letterSpacing: "-0.01em" }}>
              {greeting} ✦
            </h1>
            {/* LISTEN button — mobile only, next to greeting */}
            <button
              className="md:hidden inline-flex items-center gap-1.5"
              onClick={handleRadioToggle}
              style={{
                fontSize: 11, fontWeight: 700, letterSpacing: "0.06em",
                padding: "4px 10px", borderRadius: 20,
                border: `1px solid ${isRadioPlaying ? "rgba(236,72,153,0.5)" : "#333"}`,
                background: isRadioPlaying ? "rgba(236,72,153,0.12)" : "#1A1A1A",
                color: isRadioPlaying ? "#EC4899" : "#666",
                cursor: "pointer", fontFamily: "inherit",
                transition: "all 0.2s",
              }}
            >
              {isRadioPlaying ? "◼ LIVE" : "▶ LISTEN"}
            </button>
          </div>
          <p className="text-sm md:text-base" style={{ color: "#707070" }}>
            {dateLabel}
            {dateLabel && " · "}
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{time}</span>
          </p>
        </div>

        {/* "Order day" — desktop only */}
        <button
          onClick={handleOrderDay}
          className="hidden md:flex flex-shrink-0 items-center gap-2 rounded-[10px] text-sm font-bold transition-all mt-1"
          style={{
            background: "#DC2626",
            color: "#fff",
            border: "none",
            padding: "8px 20px",
            cursor: "pointer",
            whiteSpace: "nowrap",
            boxShadow: "0 2px 14px rgba(220,38,38,0.4)",
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#B91C1C"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#DC2626"; }}
        >
          ⚡ פעולות מהירות ▾
        </button>
      </div>

      {/* ── Status pills ── */}
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        {overdue > 0 && (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border"
            style={{ color: "#EF4444", background: "rgba(239,68,68,0.08)", borderColor: "rgba(239,68,68,0.25)" }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#EF4444", display: "inline-block" }} />
            {overdue} {overdue === 1 ? "פרויקט עבר" : "פרויקטים עברו"} דדליין
          </span>
        )}
        {active > 0 && (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border"
            style={{ color: "#3B82F6", background: "rgba(59,130,246,0.08)", borderColor: "rgba(59,130,246,0.2)" }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#3B82F6", display: "inline-block" }} />
            {active} {active === 1 ? "פרויקט" : "פרויקטים"} בעבודה פעילה
          </span>
        )}
        {overdue === 0 && active === 0 && (
          <span className="text-sm" style={{ color: "#666" }}>הכל תחת שליטה 🎵</span>
        )}
      </div>

      {/* ── Mobile "order day" button — full width ── */}
      <button
        onClick={handleOrderDay}
        className="md:hidden w-full mt-3 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold"
        style={{
          background: "#DC2626",
          color: "#fff",
          border: "none",
          cursor: "pointer",
          fontFamily: "inherit",
          boxShadow: "0 2px 12px rgba(220,38,38,0.35)",
        }}
      >
        ⚡ פעולות מהירות ▾
      </button>
    </div>
  );
}
