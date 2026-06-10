"use client";

import type { Project } from "@/lib/types";

interface Props {
  project: Project;
  isArtistMode: boolean;
  accentColor: string;
}

const MOCK_UPDATES = [
  { date: "10.06", text: "Mix 2 נשלח לאמן לאישור — ימים טובים" },
  { date: "06.06", text: "סשן הקלטות — אבשה, 3 גרסאות וואקל חדשות" },
  { date: "01.06", text: "פגישת kickoff אלבום — סוכמו 8 שירים לאלבום" },
];

export default function AlbumOverviewTab({ project, isArtistMode, accentColor }: Props) {
  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "28px 32px" }}>

      {/* Mock data notice */}
      <div style={{
        marginBottom: 28,
        padding: "9px 14px",
        borderRadius: 8,
        background: "rgba(245,158,11,0.06)",
        border: "1px solid rgba(245,158,11,0.15)",
        color: "#7A5A1A",
        fontSize: 11,
      }}>
        ⚠ נתונים לדוגמה — שלב 2 יחבר לבסיס הנתונים ויציג נתוני שירים אמיתיים
      </div>

      {/* ── Stats row ──────────────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 32 }}>
        <StatCard value={3}  label="שירים באלבום" color="#E0E0E0" sub="סה״כ"           />
        <StatCard value={1}  label="הושלמו"        color="#22c55e" sub="33% הושלם"      />
        <StatCard value={1}  label="בתהליך"        color="#F59E0B" sub="פעיל עכשיו"    />
        <StatCard value={1}  label="ממתינים"       color="#555"    sub="טרם התחיל"     />
      </div>

      {/* ── Two columns ────────────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>

        {/* Left: Album status */}
        <div>
          <SectionTitle>סטטוס אלבום</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <InfoRow label="אמן"            value={project.artist} />
            <InfoRow label="סוג"             value={project.projectType || "—"} />
            <InfoRow label="סטטוס פרויקט"   value={project.status} />
            <InfoRow label="עודכן לאחרונה"  value="10.06" />
            {project.deadline && (
              <InfoRow
                label="דדליין"
                value={new Date(project.deadline).toLocaleDateString("he-IL")}
                highlight
              />
            )}
          </div>
        </div>

        {/* Right: Next step */}
        <div>
          <SectionTitle>השלב הבא</SectionTitle>
          <div style={{
            padding: "16px 18px",
            borderRadius: 12,
            background: `${accentColor}0A`,
            border: `1px solid ${accentColor}2A`,
          }}>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 8, fontWeight: 600 }}>פעולה הבאה מומלצת</div>
            <div style={{ fontSize: 13, color: "#B0B0B0", lineHeight: 1.65 }}>
              לשלוח פידבק על Mix 2 של "ימים טובים" ולתאם סשן הקלטות נוסף ל"אבשה".
            </div>
            <div style={{
              marginTop: 10,
              fontSize: 10,
              color: "#3A3A3A",
              padding: "3px 8px",
              borderRadius: 5,
              border: "1px solid #252525",
              display: "inline-block",
            }}>
              נתונים לדוגמה
            </div>
          </div>

          {/* Internal notes — hidden in artist mode */}
          {!isArtistMode && project.notes && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#444", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                הערות פנימיות
                <span style={{ fontSize: 9, color: "#3A3A3A", padding: "1px 6px", borderRadius: 4, border: "1px solid #222" }}>
                  מוסתר מהאמן
                </span>
              </div>
              <div style={{
                padding: "10px 12px",
                borderRadius: 10,
                background: "rgba(255,255,255,0.02)",
                border: "1px solid #1E1E1E",
                color: "#666",
                fontSize: 12,
                lineHeight: 1.65,
              }}>
                {project.notes}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Recent updates ─────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 24 }}>
        <SectionTitle>עדכונים אחרונים</SectionTitle>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {MOCK_UPDATES.map((u, i) => (
            <div key={i} style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
              padding: "10px 14px",
              borderRadius: 10,
              background: "rgba(255,255,255,0.02)",
              border: "1px solid #1E1E1E",
            }}>
              <span style={{ fontSize: 11, color: "#444", flexShrink: 0, paddingTop: 1 }}>{u.date}</span>
              <span style={{ fontSize: 12, color: "#888", lineHeight: 1.5 }}>{u.text}</span>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 10, color: "#333", marginTop: 6, paddingRight: 4 }}>נתונים לדוגמה</div>
      </div>

      {/* Phase 2 teaser */}
      <div style={{
        padding: "14px 18px",
        borderRadius: 12,
        background: `${accentColor}06`,
        border: `1px dashed ${accentColor}25`,
        color: "#3A3A3A",
        fontSize: 12,
        textAlign: "center",
        lineHeight: 1.7,
      }}>
        💡 בשלב 2 תוצג כאן סקירה מלאה עם נתוני שירים אמיתיים, מעקב התקדמות ויתרת תשלום
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: "#444", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
      {children}
    </div>
  );
}

function StatCard({ value, label, color, sub }: { value: number; label: string; color: string; sub: string }) {
  return (
    <div style={{
      padding: "20px 18px",
      borderRadius: 14,
      background: "rgba(255,255,255,0.025)",
      border: "1px solid #222",
      textAlign: "center",
    }}>
      <div style={{ fontSize: 36, fontWeight: 700, color, lineHeight: 1, marginBottom: 6 }}>{value}</div>
      <div style={{ fontSize: 12, color: "#888", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 10, color: "#3A3A3A" }}>{sub}</div>
    </div>
  );
}

function InfoRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "7px 12px",
      borderRadius: 8,
      background: "rgba(255,255,255,0.02)",
      border: "1px solid #1E1E1E",
    }}>
      <span style={{ fontSize: 11, color: "#444" }}>{label}</span>
      <span style={{ fontSize: 12, color: highlight ? "#F59E0B" : "#AAA", fontWeight: highlight ? 600 : 400 }}>{value}</span>
    </div>
  );
}
