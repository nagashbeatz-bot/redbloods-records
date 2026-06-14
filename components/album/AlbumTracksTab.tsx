"use client";

import type { Project } from "@/lib/types";

interface Props {
  project: Project;
  accentColor: string;
}

interface TrackStatus {
  label: string;
  color: string;
  bg: string;
  border: string;
}

function getTrackStatus(name: string): TrackStatus {
  const n = name.toLowerCase();
  if (n.includes("master") || name.includes("מאסטר"))
    return {
      label: "הושלם",
      color: "#22c55e",
      bg: "rgba(34,197,94,0.12)",
      border: "rgba(34,197,94,0.3)",
    };
  if (n.includes("mix") || name.includes("מיקס"))
    return {
      label: "במיקס",
      color: "#3B82F6",
      bg: "rgba(59,130,246,0.12)",
      border: "rgba(59,130,246,0.3)",
    };
  if (n.includes("stem") || n.includes("stems"))
    return {
      label: "סטמס",
      color: "#6B7280",
      bg: "rgba(107,114,128,0.12)",
      border: "rgba(107,114,128,0.3)",
    };
  return {
    label: "קובץ",
    color: "#6B7280",
    bg: "rgba(107,114,128,0.12)",
    border: "rgba(107,114,128,0.3)",
  };
}

interface MixMaster {
  done: boolean;
}

function getMix(name: string): MixMaster {
  const n = name.toLowerCase();
  return { done: n.includes("mix") || name.includes("מיקס") };
}

function getMaster(name: string): MixMaster {
  const n = name.toLowerCase();
  return { done: n.includes("master") || name.includes("מאסטר") };
}

function getCompletion(name: string): { pct: string; color: string; bg: string } {
  const n = name.toLowerCase();
  if (n.includes("master") || name.includes("מאסטר"))
    return { pct: "100%", color: "#22c55e", bg: "rgba(34,197,94,0.12)" };
  if (n.includes("mix") || name.includes("מיקס"))
    return { pct: "70%", color: "#3B82F6", bg: "rgba(59,130,246,0.12)" };
  if (n.includes("stem") || n.includes("stems"))
    return { pct: "30%", color: "#6B7280", bg: "rgba(107,114,128,0.12)" };
  return { pct: "0%", color: "#444", bg: "rgba(68,68,68,0.12)" };
}

const GRID = "32px 1fr 36px 56px 100px 80px 80px 64px 36px";

export default function AlbumTracksTab({ project }: Props) {
  return (
    <div
      style={{
        padding: "16px 20px",
        overflowY: "auto",
        height: "100%",
        boxSizing: "border-box",
        direction: "rtl",
      }}
    >
      {project.files.length === 0 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            gap: 12,
          }}
        >
          <div style={{ fontSize: 36, opacity: 0.15 }}>🎵</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#444" }}>
            לא הוגדרו שירים
          </div>
          <div style={{ fontSize: 12, color: "#333" }}>
            קבצים שיועלו לפרויקט יופיעו כאן
          </div>
        </div>
      ) : (
        <div>
          {/* Table header */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: GRID,
              gap: 8,
              padding: "8px 12px",
              background: "#141414",
              borderRadius: "8px 8px 0 0",
              borderBottom: "1px solid #252525",
            }}
          >
            {["#", "שם השיר", "▶", "משך", "סטטוס", "מיקס", "מאסטר", "השלמה", ""].map(
              (h, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: "#444",
                    textAlign: "right",
                    overflow: "hidden",
                  }}
                >
                  {h}
                </div>
              )
            )}
          </div>

          {/* Rows */}
          {project.files.map((f, i) => {
            const status = getTrackStatus(f.name);
            const mix = getMix(f.name);
            const master = getMaster(f.name);
            const completion = getCompletion(f.name);
            const rowBg = i % 2 === 0 ? "#1A1A1A" : "#171717";

            return (
              <div
                key={i}
                style={{
                  display: "grid",
                  gridTemplateColumns: GRID,
                  gap: 8,
                  padding: "10px 12px",
                  background: rowBg,
                  borderBottom: "1px solid #1A1A1A",
                  alignItems: "center",
                  transition: "background 0.12s",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLDivElement).style.background =
                    "#1E1E1E";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.background = rowBg;
                }}
              >
                {/* # */}
                <div style={{ fontSize: 11, color: "#444" }}>{i + 1}</div>

                {/* שם השיר */}
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#D0D0D0",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {f.name}
                </div>

                {/* ▶ */}
                <button
                  disabled
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    border: "1px solid #252525",
                    background: "transparent",
                    color: "#444",
                    cursor: "not-allowed",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 9,
                    fontFamily: "inherit",
                    flexShrink: 0,
                  }}
                >
                  ▶
                </button>

                {/* משך */}
                <div style={{ fontSize: 11, color: "#444" }}>—</div>

                {/* סטטוס */}
                <div>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "2px 8px",
                      borderRadius: 5,
                      background: status.bg,
                      color: status.color,
                      border: `1px solid ${status.border}`,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {status.label}
                  </span>
                </div>

                {/* מיקס */}
                <div>
                  {mix.done ? (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "2px 8px",
                        borderRadius: 5,
                        background: "rgba(34,197,94,0.12)",
                        color: "#22c55e",
                        border: "1px solid rgba(34,197,94,0.3)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      הושלם
                    </span>
                  ) : (
                    <span style={{ fontSize: 11, color: "#444" }}>—</span>
                  )}
                </div>

                {/* מאסטר */}
                <div>
                  {master.done ? (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "2px 8px",
                        borderRadius: 5,
                        background: "rgba(34,197,94,0.12)",
                        color: "#22c55e",
                        border: "1px solid rgba(34,197,94,0.3)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      הושלם
                    </span>
                  ) : (
                    <span style={{ fontSize: 11, color: "#444" }}>—</span>
                  )}
                </div>

                {/* השלמה */}
                <div>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: completion.color,
                      background: completion.bg,
                      padding: "2px 8px",
                      borderRadius: 5,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {completion.pct}
                  </span>
                </div>

                {/* link */}
                <div>
                  <a
                    href={f.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 28,
                      height: 28,
                      borderRadius: 7,
                      border: "1px solid #252525",
                      background: "transparent",
                      color: "#555",
                      textDecoration: "none",
                      fontSize: 13,
                      fontWeight: 700,
                    }}
                    title="פתח קובץ"
                  >
                    ···
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
