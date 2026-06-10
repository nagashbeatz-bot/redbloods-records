"use client";

import type { Project } from "@/lib/types";

interface Props {
  project: Project;
  isArtistMode: boolean;
  accentColor: string;
}

export default function AlbumOverviewTab({ project, isArtistMode, accentColor }: Props) {
  return (
    <div style={{ height: "100%", overflowY: "auto", padding: 24 }}>

      {/* Mock data notice */}
      <div style={{
        marginBottom: 20,
        padding: "7px 12px",
        borderRadius: 8,
        background: "rgba(245,158,11,0.07)",
        border: "1px solid rgba(245,158,11,0.18)",
        color: "#B07A2A",
        fontSize: 11,
      }}>
        ⚠ נתונים לדוגמה — שלב 2 יחבר לבסיס הנתונים ויציג נתוני שירים אמיתיים
      </div>

      {/* Stats grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 10, marginBottom: 24 }}>
        <StatCard value={3} label="שירים באלבום" color="#E0E0E0" />
        <StatCard value={1} label="הושלמו" color="#22c55e" />
        <StatCard value={1} label="בתהליך" color="#F59E0B" />
        <StatCard value={1} label="ממתינים" color="#666" />
      </div>

      {/* Project info */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 24 }}>
        <InfoCard label="אמן" value={project.artist} />
        <InfoCard label="סוג פרויקט" value={project.projectType || "—"} />
        <InfoCard label="סטטוס" value={project.status} />
        <InfoCard label="עודכן לאחרונה" value="10.06" />
        {project.deadline && (
          <InfoCard
            label="דדליין"
            value={new Date(project.deadline).toLocaleDateString("he-IL")}
          />
        )}
      </div>

      {/* Internal project notes (hidden in artist mode) */}
      {!isArtistMode && project.notes && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#555", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
            הערות פנימיות לפרויקט
            <span style={{ fontSize: 9, color: "#444", padding: "1px 6px", borderRadius: 4, border: "1px solid #2A2A2A", background: "rgba(255,255,255,0.02)" }}>
              מוסתר מהאמן
            </span>
          </div>
          <div style={{
            padding: "10px 14px",
            borderRadius: 10,
            background: "rgba(255,255,255,0.02)",
            border: "1px solid #222",
            color: "#888",
            fontSize: 12,
            lineHeight: 1.7,
          }}>
            {project.notes}
          </div>
        </div>
      )}

      {/* Phase 2 teaser */}
      <div style={{
        padding: "14px 16px",
        borderRadius: 12,
        background: `${accentColor}07`,
        border: `1px dashed ${accentColor}2A`,
        color: "#444",
        fontSize: 12,
        textAlign: "center",
        lineHeight: 1.6,
      }}>
        💡 בשלב 2 תוצג כאן סקירה מלאה עם מעקב התקדמות, שירים שמחכים לפעולה, ויתרת תשלום
      </div>
    </div>
  );
}

function StatCard({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div style={{
      padding: "14px 16px",
      borderRadius: 12,
      background: "rgba(255,255,255,0.025)",
      border: "1px solid #2A2A2A",
      textAlign: "center",
    }}>
      <div style={{ fontSize: 26, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10, color: "#555", marginTop: 4 }}>{label}</div>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      padding: "9px 13px",
      borderRadius: 10,
      background: "rgba(255,255,255,0.02)",
      border: "1px solid #222",
    }}>
      <div style={{ fontSize: 10, color: "#555", marginBottom: 2, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 13, color: "#CCC" }}>{value}</div>
    </div>
  );
}
