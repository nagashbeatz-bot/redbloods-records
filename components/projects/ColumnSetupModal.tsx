"use client";

import { useState } from "react";

interface ColumnSetupModalProps {
  onClose: () => void;
}

const NEW_COLUMNS = [
  {
    key: "projectType",
    title: "סוג פרויקט",
    type: "text",
    typeLabel: "טקסט",
    description: 'ערכים: שיר / EP / אלבום / קליפ / אחר',
  },
  {
    key: "parentProject",
    title: "שייך ל",
    type: "text",
    typeLabel: "טקסט",
    description: 'לקישור שירים לפרויקט ראשי (EP, אלבום, Riddim…)',
  },
];

type StepStatus = "idle" | "loading" | "done" | "error";

interface ColState {
  status: StepStatus;
  error?: string;
}

export default function ColumnSetupModal({ onClose }: ColumnSetupModalProps) {
  const [confirmed, setConfirmed] = useState(false);
  const [colState, setColState] = useState<Record<string, ColState>>({
    projectType: { status: "idle" },
    parentProject: { status: "idle" },
  });
  const [allDone, setAllDone] = useState(false);

  const addColumn = async (key: string, title: string, type: string) => {
    setColState((prev) => ({ ...prev, [key]: { status: "loading" } }));
    try {
      const res = await fetch("/api/monday/column", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, columnType: type }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה");
      setColState((prev) => ({ ...prev, [key]: { status: "done" } }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "שגיאה";
      setColState((prev) => ({ ...prev, [key]: { status: "error", error: msg } }));
    }
  };

  const handleConfirmAndAdd = async () => {
    setConfirmed(true);
    for (const col of NEW_COLUMNS) {
      await addColumn(col.key, col.title, col.type);
    }
    setAllDone(true);
  };

  const anyLoading = Object.values(colState).some((s) => s.status === "loading");
  const anyError = Object.values(colState).some((s) => s.status === "error");

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "rgba(0,0,0,0.75)",
      }}
      onClick={confirmed ? undefined : onClose}
    >
      <div
        style={{
          background: "#1A1A1A",
          border: "1px solid #333",
          borderRadius: 20,
          padding: "28px 28px 24px",
          maxWidth: 440,
          width: "100%",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#F0F0F0", marginBottom: 6 }}>
            הוספת עמודות לבורד
          </div>
          <div style={{ fontSize: 13, color: "#666", lineHeight: 1.6 }}>
            הפעולה הבאה תוסיף שתי עמודות חדשות לבורד "שירים" במאנדיי.
            שינוי זה <span style={{ color: "#F59E0B" }}>אינו הפיך</span> — ניתן למחוק עמודות ידנית מתוך מאנדיי לאחר מכן.
          </div>
        </div>

        {/* Columns list */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
          {NEW_COLUMNS.map((col) => {
            const state = colState[col.key];
            return (
              <div
                key={col.key}
                style={{
                  background: "#141414",
                  border: `1px solid ${state.status === "done" ? "#10B98130" : state.status === "error" ? "#EF444430" : "#252525"}`,
                  borderRadius: 12,
                  padding: "12px 14px",
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#E8E8E8", marginBottom: 2 }}>
                    {col.title}
                  </div>
                  <div style={{ fontSize: 12, color: "#555" }}>{col.description}</div>
                  {state.status === "error" && (
                    <div style={{ fontSize: 11, color: "#EF4444", marginTop: 4 }}>{state.error}</div>
                  )}
                </div>
                <div style={{ flexShrink: 0, fontSize: 16, marginTop: 2 }}>
                  {state.status === "idle" && (
                    <span style={{ color: "#333" }}>○</span>
                  )}
                  {state.status === "loading" && (
                    <span style={{ color: "#F59E0B" }} className="animate-pulse">◌</span>
                  )}
                  {state.status === "done" && (
                    <span style={{ color: "#10B981" }}>✓</span>
                  )}
                  {state.status === "error" && (
                    <span style={{ color: "#EF4444" }}>✕</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Actions */}
        {!allDone ? (
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={handleConfirmAndAdd}
              disabled={confirmed || anyLoading}
              style={{
                flex: 1,
                padding: "10px 0",
                borderRadius: 12,
                border: "none",
                background: confirmed ? "#252525" : "#F59E0B",
                color: confirmed ? "#555" : "#000",
                fontSize: 13,
                fontWeight: 700,
                cursor: confirmed ? "not-allowed" : "pointer",
                fontFamily: "inherit",
              }}
            >
              {anyLoading ? "מוסיף עמודות..." : confirmed ? "מבצע..." : "✓ אשר והוסף עמודות"}
            </button>
            {!confirmed && (
              <button
                onClick={onClose}
                style={{
                  flex: 1,
                  padding: "10px 0",
                  borderRadius: 12,
                  border: "1px solid #333",
                  background: "transparent",
                  color: "#666",
                  fontSize: 13,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                ביטול
              </button>
            )}
          </div>
        ) : (
          <div>
            {anyError ? (
              <div style={{ fontSize: 13, color: "#F97316", marginBottom: 14, textAlign: "center" }}>
                חלק מהעמודות לא נוספו — בדוק את הרשאות ה-API
              </div>
            ) : (
              <div style={{ fontSize: 13, color: "#10B981", marginBottom: 14, textAlign: "center" }}>
                ✓ העמודות נוספו בהצלחה לבורד
              </div>
            )}
            <div style={{ fontSize: 12, color: "#555", marginBottom: 14, textAlign: "center" }}>
              רענן את העמוד כדי לראות את השינויים
            </div>
            <button
              onClick={onClose}
              style={{
                width: "100%",
                padding: "10px 0",
                borderRadius: 12,
                border: "1px solid #333",
                background: "#252525",
                color: "#C0C0C0",
                fontSize: 13,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              סגור
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
