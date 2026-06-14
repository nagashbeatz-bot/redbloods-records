"use client";

import { useEffect, useState } from "react";
import type { Project } from "@/lib/types";
import { usePlayerSafe } from "@/components/PlayerProvider";
import UploadButton from "@/components/ui/UploadButton";

interface Transaction {
  id: string;
  project_id: string;
  type: "income" | "expense";
  amount: number;
  description: string;
  date: string;
  payment_status: string;
}

interface ProjectAction {
  id: string;
  project_id: string;
  action_type: string;
  content_type: string | null;
  version_label: string | null;
  recipient_name: string | null;
  action_date: string;
  status: string;
  notes: string | null;
  created_at: string;
}

interface TxData {
  transactions: Transaction[];
  settings: { agreedPrice: number; currency: string; financialNotes: string };
}

interface Props {
  project: Project;
  accentColor: string;
}

const AUDIO_EXTS = [".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aiff", ".aif"];
function isAudio(name: string): boolean {
  return AUDIO_EXTS.some((ext) => name.toLowerCase().endsWith(ext));
}

function formatDDMM(dateStr: string): string {
  if (!dateStr) return "";
  const parts = dateStr.split("-");
  if (parts.length < 3) return dateStr;
  return `${parts[2]}.${parts[1]}`;
}

function statusToPercent(status: string): number {
  const map: Record<string, number> = {
    הושלם: 100,
    מאסטרינג: 90,
    במיקס: 70,
    "מחכה למיקס": 50,
    בהקלטה: 30,
    בעבודה: 20,
  };
  return map[status] ?? 10;
}

function getFileLabel(name: string): { label: string; color: string } {
  const n = name.toLowerCase();
  if (n.includes("master") || name.includes("מאסטר"))
    return { label: "מאסטר", color: "#22c55e" };
  if (n.includes("mix") || name.includes("מיקס"))
    return { label: "מיקס", color: "#3B82F6" };
  if (n.includes("stem") || n.includes("stems"))
    return { label: "סטמס", color: "#6B7280" };
  return { label: "קובץ", color: "#6B7280" };
}

function actionSummary(action: ProjectAction): string {
  switch (action.action_type) {
    case "sent":
      return `נשלח${action.recipient_name ? " ל" + action.recipient_name : ""}${action.content_type ? " — " + action.content_type : ""}`;
    case "received_feedback":
      return `התקבל פידבק${action.recipient_name ? " מ" + action.recipient_name : ""}`;
    case "got_notes":
      return `התקבלו הערות${action.recipient_name ? " מ" + action.recipient_name : ""}`;
    default:
      return action.notes ?? "פעולה";
  }
}

function actionDotColor(action: ProjectAction): string {
  const s = action.status;
  if (s === "sent" || s === "pending_feedback") return "#3B82F6";
  if (s === "done" || s === "closed" || s === "approved") return "#22c55e";
  if (s === "got_notes") return "#F59E0B";
  return "#555";
}

function txStatusBadge(status: string): React.CSSProperties {
  if (status === "שולם" || status === "התקבל")
    return {
      background: "rgba(34,197,94,0.12)",
      color: "#22c55e",
      border: "1px solid rgba(34,197,94,0.3)",
    };
  if (status === "צפוי")
    return {
      background: "rgba(245,158,11,0.12)",
      color: "#F59E0B",
      border: "1px solid rgba(245,158,11,0.3)",
    };
  return {
    background: "rgba(100,100,100,0.12)",
    color: "#666",
    border: "1px solid #333",
  };
}

const card: React.CSSProperties = {
  background: "#1A1A1A",
  border: "1px solid #252525",
  borderRadius: 14,
  overflow: "hidden",
  marginBottom: 16,
};

const cardHeader: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "14px 18px",
  borderBottom: "1px solid #1E1E1E",
};

const cardTitle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 11,
  fontWeight: 700,
  color: "#888",
};

export default function AlbumOverviewTab({ project, accentColor }: Props) {
  const player = usePlayerSafe();
  const [txData, setTxData] = useState<TxData | null>(null);
  const [actions, setActions] = useState<ProjectAction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/transactions?projectId=${project.id}`).then((r) => r.json()),
      fetch(`/api/project-actions?projectId=${project.id}`).then((r) => r.json()),
    ])
      .then(([tx, acts]: [TxData, { actions: ProjectAction[] }]) => {
        setTxData(tx);
        setActions(acts.actions ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [project.id]);

  const agreedPrice = txData?.settings?.agreedPrice ?? 0;
  const currency = txData?.settings?.currency ?? "₪";
  const transactions = txData?.transactions ?? [];
  const received = transactions
    .filter(
      (t) =>
        t.type === "income" && ["שולם", "התקבל"].includes(t.payment_status)
    )
    .reduce((s, t) => s + t.amount, 0);
  const expenses = transactions
    .filter((t) => t.type === "expense")
    .reduce((s, t) => s + t.amount, 0);
  const balance = received - expenses;
  const fmt = (n: number) => `${currency}${n.toLocaleString("he-IL")}`;

  const pct = statusToPercent(project.status);
  const circumference = 2 * Math.PI * 48;

  const masterCount = project.files.filter((f) => {
    const n = f.name.toLowerCase();
    return n.includes("master") || f.name.includes("מאסטר");
  }).length;

  const pendingCount = transactions.filter(
    (t) => t.type === "income" && t.payment_status === "צפוי"
  ).length;

  const recentTx = [...transactions].reverse().slice(0, 4);

  function hasAsset(keywords: string[]): boolean {
    return project.files.some((f) => {
      const n = f.name.toLowerCase();
      return keywords.some((kw) => n.includes(kw));
    });
  }

  const assets: Array<{
    icon: string;
    name: string;
    status: "הועלה" | "חסר" | "ממתין";
  }> = [
    { icon: "🎨", name: "עטיפה",       status: hasAsset(["cover", "עטיפה"])         ? "הועלה" : "חסר" },
    { icon: "🔊", name: "מאסטרים",     status: hasAsset(["master", "מאסטר"])        ? "הועלה" : "חסר" },
    { icon: "🥁", name: "סטמס",        status: hasAsset(["stem"])                   ? "הועלה" : "חסר" },
    { icon: "📝", name: "ליריקס",      status: hasAsset(["lyric", "ליריקס"])        ? "הועלה" : "חסר" },
    { icon: "📤", name: "חומר הפצה",   status: hasAsset(["distrib", "הפצה"])        ? "הועלה" : "ממתין" },
  ];

  function assetBadgeStyle(status: "הועלה" | "חסר" | "ממתין"): React.CSSProperties {
    if (status === "הועלה")
      return { background: "rgba(34,197,94,0.10)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.25)" };
    if (status === "חסר")
      return { background: "rgba(239,68,68,0.10)", color: "#EF4444", border: "1px solid rgba(239,68,68,0.25)" };
    return { background: "rgba(245,158,11,0.10)", color: "#F59E0B", border: "1px solid rgba(245,158,11,0.25)" };
  }

  if (loading) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#444", fontSize: 13 }}>
        טוען...
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
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 320px",
          gap: 20,
          alignItems: "start",
        }}
      >
        {/* ── LEFT COLUMN ── */}
        <div>
          {/* 1. Song list */}
          <div style={card}>
            <div style={cardHeader}>
              <div style={cardTitle}>🎵 קבצים באלבום</div>
              <UploadButton
                projectId={project.id}
                projectName={project.name}
                artist={project.artist}
                existingFiles={project.files}
                size="sm"
              />
            </div>
            {project.files.length === 0 ? (
              <div style={{ padding: 40, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                <div style={{ fontSize: 30, opacity: 0.2 }}>🎵</div>
                <div style={{ color: "#444", fontSize: 13 }}>לא הועלו קבצים לאלבום זה עדיין</div>
                <div style={{ color: "#333", fontSize: 11 }}>השתמש בכפתור ← להעלאה</div>
              </div>
            ) : (
              project.files.map((f, i) => {
                const st = getFileLabel(f.name);
                const canPlay = isAudio(f.name) && !!f.url;
                const isPlaying =
                  player?.playing &&
                  player.track?.projectId === project.id &&
                  player.track?.fileName === f.name;

                return (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "10px 18px",
                      borderBottom: "1px solid #1A1A1A",
                    }}
                  >
                    <span style={{ fontSize: 11, color: "#3A3A3A", minWidth: 20 }}>{i + 1}</span>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "#D0D0D0",
                        flex: 1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {f.name}
                    </span>

                    {/* Play button */}
                    <button
                      onClick={() => {
                        if (!player || !canPlay) return;
                        if (isPlaying) {
                          player.pause();
                        } else {
                          player.play({
                            projectId: project.id,
                            projectName: project.name,
                            artist: project.artist,
                            fileName: f.name,
                            url: f.url,
                          });
                        }
                      }}
                      disabled={!canPlay}
                      title={canPlay ? (isPlaying ? "השהה" : "נגן") : "אין קובץ אודיו"}
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 7,
                        border: canPlay ? "1px solid #3B82F633" : "1px solid #2A2A2A",
                        background: isPlaying ? "#3B82F622" : "transparent",
                        color: canPlay ? (isPlaying ? "#3B82F6" : "#666") : "#3A3A3A",
                        cursor: canPlay ? "pointer" : "not-allowed",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 10,
                        fontFamily: "inherit",
                        flexShrink: 0,
                      }}
                    >
                      {isPlaying ? "⏸" : "▶"}
                    </button>

                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "2px 8px",
                        borderRadius: 5,
                        background: `${st.color}18`,
                        color: st.color,
                        border: `1px solid ${st.color}33`,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {st.label}
                    </span>

                    {(f.dropboxShareUrl || f.url) && (
                      <a
                        href={f.dropboxShareUrl || f.url}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          fontSize: 10,
                          color: "#3B82F6",
                          padding: "2px 8px",
                          borderRadius: 5,
                          border: "1px solid #3B82F622",
                          background: "transparent",
                          textDecoration: "none",
                          whiteSpace: "nowrap",
                        }}
                      >
                        פתח ↗
                      </a>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* 2. Finance summary */}
          <div style={card}>
            <div style={cardHeader}>
              <div style={cardTitle}>💰 כספים</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, padding: "14px 18px" }}>
              {[
                { label: "סוכם",   value: fmt(agreedPrice), color: "#E0E0E0" },
                { label: "התקבל",  value: fmt(received),    color: "#22c55e" },
                { label: "הוצאות", value: fmt(expenses),    color: "#EF4444" },
                { label: "יתרה",   value: fmt(balance),     color: balance >= 0 ? "#22c55e" : "#EF4444" },
              ].map((s) => (
                <div
                  key={s.label}
                  style={{
                    background: "#141414",
                    border: "1px solid #1E1E1E",
                    borderRadius: 10,
                    padding: "12px 14px",
                    textAlign: "center",
                  }}
                >
                  <div style={{ fontSize: 18, fontWeight: 700, color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: 10, color: "#555", marginTop: 3 }}>{s.label}</div>
                </div>
              ))}
            </div>

            <div style={{ padding: "0 18px 14px" }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#444", marginBottom: 8 }}>תשלומים אחרונים</div>
              {recentTx.length === 0 ? (
                <div style={{ color: "#333", fontSize: 12, padding: 12 }}>אין תשלומים עדיין</div>
              ) : (
                recentTx.map((t) => (
                  <div
                    key={t.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "8px 0",
                      borderBottom: "1px solid #1A1A1A",
                    }}
                  >
                    <span style={{ fontSize: 11, color: "#555", flexShrink: 0 }}>{formatDDMM(t.date)}</span>
                    <span style={{ fontSize: 12, color: "#888", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {t.description}
                    </span>
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        padding: "2px 7px",
                        borderRadius: 5,
                        flexShrink: 0,
                        ...txStatusBadge(t.payment_status),
                      }}
                    >
                      {t.payment_status}
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        color: t.type === "income" ? "#22c55e" : "#EF4444",
                        fontWeight: 600,
                        flexShrink: 0,
                      }}
                    >
                      {t.type === "income" ? "+" : "-"}{currency}{t.amount.toLocaleString("he-IL")}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 3. Recent actions */}
          <div style={{ ...card, marginBottom: 0 }}>
            <div style={cardHeader}>
              <div style={cardTitle}>⚡ פעולות אחרונות</div>
            </div>
            {actions.length === 0 ? (
              <div style={{ color: "#333", fontSize: 12, padding: "16px 18px" }}>
                אין פעולות מתועדות עדיין
              </div>
            ) : (
              actions.slice(0, 5).map((a) => (
                <div
                  key={a.id}
                  style={{
                    display: "flex",
                    gap: 12,
                    padding: "10px 18px",
                    borderBottom: "1px solid #1A1A1A",
                    alignItems: "center",
                  }}
                >
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: actionDotColor(a), flexShrink: 0 }} />
                  <div style={{ fontSize: 12, color: "#888", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {actionSummary(a)}
                  </div>
                  <div style={{ fontSize: 10, color: "#444", flexShrink: 0 }}>{formatDDMM(a.action_date)}</div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── RIGHT COLUMN ── */}
        <div>
          {/* 4. Progress donut */}
          <div
            style={{
              background: "#1A1A1A",
              border: "1px solid #252525",
              borderRadius: 14,
              overflow: "hidden",
              marginBottom: 16,
              padding: "20px 16px 16px",
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: "#888", marginBottom: 16, textAlign: "center" }}>
              התקדמות האלבום
            </div>

            <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
              <svg width="120" height="120" viewBox="0 0 120 120" style={{ overflow: "visible" }}>
                <circle cx="60" cy="60" r="48" fill="none" stroke="#1E1E1E" strokeWidth="8" />
                <circle
                  cx="60"
                  cy="60"
                  r="48"
                  fill="none"
                  stroke={accentColor}
                  strokeWidth="8"
                  strokeDasharray={`${(pct / 100) * circumference} ${circumference}`}
                  strokeDashoffset="0"
                  strokeLinecap="round"
                  style={{
                    transform: "rotate(-90deg)",
                    transformOrigin: "60px 60px",
                    transition: "stroke-dasharray 0.6s ease",
                  }}
                />
                <text x="60" y="56" fill="#F2F2F2" fontSize="20" fontWeight="700" textAnchor="middle" dominantBaseline="middle">
                  {pct}%
                </text>
                <text x="60" y="72" fill="#555" fontSize="10" textAnchor="middle">הושלם</text>
              </svg>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[
                { label: "קבצים הועלו",   value: String(project.files.length), color: "#22c55e", icon: "🎵" },
                { label: "תשלומים צפויים", value: String(pendingCount),        color: "#F59E0B", icon: "💰" },
                { label: "מאסטרים",        value: String(masterCount),         color: "#A855F7", icon: "🔊" },
                { label: "סטטוס",          value: project.status,              color: "#6B7280", icon: "📋" },
              ].map((s) => (
                <div
                  key={s.label}
                  style={{
                    background: "#141414",
                    border: "1px solid #1E1E1E",
                    borderRadius: 10,
                    padding: "10px 12px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div>
                    <div style={{ fontSize: s.label === "סטטוס" ? 12 : 20, fontWeight: 700, color: s.color, lineHeight: 1 }}>
                      {s.value}
                    </div>
                    <div style={{ fontSize: 9, color: "#555", marginTop: 3 }}>{s.label}</div>
                  </div>
                  <div style={{ fontSize: 18, opacity: 0.3 }}>{s.icon}</div>
                </div>
              ))}
            </div>
          </div>

          {/* 5. Asset checklist */}
          <div
            style={{
              background: "#1A1A1A",
              border: "1px solid #252525",
              borderRadius: 14,
              overflow: "hidden",
            }}
          >
            <div style={cardHeader}>
              <div style={cardTitle}>📁 נכסים</div>
              <span style={{ fontSize: 10, color: "#444" }}>לפי שם קובץ</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: "12px 14px" }}>
              {assets.map((a) => (
                <div
                  key={a.name}
                  style={{
                    background: "#141414",
                    border: "1px solid #1E1E1E",
                    borderRadius: 10,
                    padding: "10px 12px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 16 }}>{a.icon}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "#888" }}>{a.name}</span>
                  </div>
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      padding: "2px 7px",
                      borderRadius: 5,
                      alignSelf: "flex-start",
                      ...assetBadgeStyle(a.status),
                    }}
                  >
                    {a.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
