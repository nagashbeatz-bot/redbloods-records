"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import type { SoundEngineerWorkType } from "@/lib/types";

const ENGINEER_OPTIONS = ["Bill", "Steven", "אחר", "עדיין לא נבחר"] as const;
type EngineerOption = (typeof ENGINEER_OPTIONS)[number];

const WORK_TYPES: SoundEngineerWorkType[] = ["מיקס", "מאסטר", "מיקס + מאסטר"];


interface Props {
  projectId: string;
  projectName: string;
  onStatusUpdate: () => Promise<void>;
  onClose: () => void;
}

export default function MixSetupModal({
  projectId,
  projectName,
  onStatusUpdate,
  onClose,
}: Props) {
  const [channelsCleaned, setChannelsCleaned] = useState<boolean | null>(null);
  const [engineer, setEngineer] = useState<EngineerOption>("עדיין לא נבחר");
  const [customEngineer, setCustomEngineer] = useState("");
  const [workType, setWorkType] = useState<SoundEngineerWorkType>("מיקס");
  const [mixDeadline, setMixDeadline] = useState("");
  const [createFollowUp, setCreateFollowUp] = useState(false);
  const [syncCalendar, setSyncCalendar] = useState(false);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [engineerExists, setEngineerExists] = useState(false);

  // Check for existing sound engineer on mount
  useEffect(() => {
    fetch(`/api/sound-engineer?projectId=${projectId}`)
      .then((r) => r.json())
      .then((d) => { if (d.work) setEngineerExists(true); })
      .catch(() => {});
  }, [projectId]);

  const effectiveEngineer =
    engineer === "אחר" ? customEngineer.trim() : engineer;
  async function handleConfirm() {
    setSaving(true);
    setError(null);

    try {
      // 1. Update project status to "במיקס"
      await onStatusUpdate();

      // 2. Sound engineer — only if selected and no existing record
      if (engineer !== "עדיין לא נבחר" && !engineerExists && effectiveEngineer) {
        await fetch("/api/sound-engineer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            engineerName: effectiveEngineer,
            workType,
            internalDeadline: mixDeadline || null,
            notes: notes.trim() || undefined,
          }),
        });
      }

      // 3. Follow-up task (date only — no time)
      let createdTaskId: string | null = null;
      if (createFollowUp && mixDeadline) {
        const taskRes = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: `מעקב מיקס ראשון — ${projectName}`,
            related_type: "project",
            related_id: projectId,
            due_date: mixDeadline,
            start_time: null,
            end_time: null,
            notes: notes.trim() || null,
          }),
        });
        const taskData = await taskRes.json();
        if (!taskRes.ok) throw new Error(taskData.error ?? "שגיאה ביצירת משימה");
        createdTaskId = taskData.task?.id ?? null;
      }

      // 4. Google Task sync (runs whenever syncCalendar + mixDeadline, with or without follow-up task)
      if (syncCalendar && mixDeadline) {
        const gtRes = await fetch("/api/calendar/create-task", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: `מעקב מיקס ראשון — ${projectName}`,
            due: mixDeadline,
            notes: `פרויקט: ${projectName}${notes.trim() ? `\n${notes.trim()}` : ""}`,
          }),
        });
        const gtData = await gtRes.json();
        if (!gtRes.ok) {
          if (gtData.needsReauth) throw new Error("נדרש חיבור מחדש לגוגל (הרשאת Tasks חסרה). עבור להגדרות → נתק → חבר מחדש.");
          throw new Error(gtData.error ?? "שגיאה ביצירת משימה ביומן");
        }

        // Link Google Task id to our task record
        if (gtData.task?.id && createdTaskId) {
          await fetch(`/api/tasks/${createdTaskId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ calendar_event_id: gtData.task.id }),
          });
        }
      }

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה");
    } finally {
      setSaving(false);
    }
  }

  // ── Style helpers ─────────────────────────────────────────────────────────────

  function pill(active: boolean, color: string): React.CSSProperties {
    return {
      padding: "5px 12px",
      borderRadius: 100,
      cursor: "pointer",
      fontFamily: "inherit",
      fontSize: 12,
      fontWeight: active ? 600 : 400,
      border: active ? `1.5px solid ${color}` : "1.5px solid #2A2A2A",
      background: active ? `${color}18` : "#1C1C1C",
      color: active ? color : "#666",
    };
  }

  const inp: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    background: "#111",
    border: "1px solid #2A2A2A",
    borderRadius: 10,
    color: "#E0E0E0",
    colorScheme: "dark",
    fontSize: 13,
    padding: "9px 12px",
    outline: "none",
    fontFamily: "inherit",
  };

  const fieldLabel: React.CSSProperties = {
    fontSize: 11,
    color: "#555",
    marginBottom: 6,
    display: "block",
  };

  const sec: React.CSSProperties = { marginBottom: 18 };

  // ── Modal JSX ─────────────────────────────────────────────────────────────────

  const modal = (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        background: "rgba(0,0,0,0.75)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#141414",
          border: "1px solid #262626",
          borderRadius: 22,
          padding: "24px 24px 20px",
          width: 420,
          maxHeight: "90vh",
          overflowY: "auto",
          direction: "rtl",
          boxShadow: "0 24px 64px rgba(0,0,0,0.9)",
        }}
      >
        {/* ── Header ── */}
        <div style={{ marginBottom: 22 }}>
          <div
            style={{
              fontSize: 11,
              color: "#A855F7",
              fontWeight: 700,
              letterSpacing: 1,
              textTransform: "uppercase",
              marginBottom: 6,
            }}
          >
            🎛 הגדרת מיקס
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#F0F0F0" }}>
            {projectName}
          </div>
          <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>
            הפרויקט עובר למיקס — מה להגדיר?
          </div>
        </div>

        {/* ── 1. Channels cleaned ── */}
        <div style={sec}>
          <span style={fieldLabel}>ניקוי ערוצים הושלם?</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => setChannelsCleaned(true)}
              style={pill(channelsCleaned === true, "#10B981")}
            >
              ✓ כן
            </button>
            <button
              onClick={() => setChannelsCleaned(false)}
              style={pill(channelsCleaned === false, "#EF4444")}
            >
              ✗ לא
            </button>
          </div>
        </div>

        {/* ── 2. Sound engineer ── */}
        <div style={sec}>
          <span style={fieldLabel}>איש סאונד</span>
          {engineerExists && (
            <div
              style={{
                fontSize: 11,
                color: "#F59E0B",
                background: "rgba(245,158,11,0.08)",
                border: "1px solid rgba(245,158,11,0.2)",
                borderRadius: 8,
                padding: "8px 10px",
                marginBottom: 8,
                lineHeight: 1.6,
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 2 }}>כבר קיים איש סאונד לפרויקט הזה.</div>
              <div style={{ color: "#888" }}>לעריכה: פתח את הפרויקט ← גלול ל-<strong style={{ color: "#60A5FA" }}>🎚 איש סאונד חיצוני</strong></div>
            </div>
          )}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              marginBottom: engineer === "אחר" ? 8 : 0,
            }}
          >
            {ENGINEER_OPTIONS.map((e) => (
              <button
                key={e}
                onClick={() => setEngineer(e)}
                style={pill(engineer === e, "#A855F7")}
              >
                {e}
              </button>
            ))}
          </div>
          {engineer === "אחר" && (
            <input
              type="text"
              value={customEngineer}
              onChange={(ev) => setCustomEngineer(ev.target.value)}
              placeholder="שם איש הסאונד..."
              style={{ ...inp, marginTop: 8 }}
            />
          )}
        </div>

        {/* ── 3. Work type ── */}
        <div style={sec}>
          <span style={fieldLabel}>סוג עבודה</span>
          <div style={{ display: "flex", gap: 8 }}>
            {WORK_TYPES.map((w) => (
              <button
                key={w}
                onClick={() => setWorkType(w)}
                style={pill(workType === w, "#A855F7")}
              >
                {w}
              </button>
            ))}
          </div>
        </div>

        {/* ── 4. Mix deadline ── */}
        <div style={sec}>
          <span style={fieldLabel}>דדליין מיקס ראשון</span>
          <input
            type="date"
            value={mixDeadline}
            onChange={(e) => setMixDeadline(e.target.value)}
            style={inp}
          />
        </div>

        {/* ── 5. Follow-up task checkbox ── */}
        <div style={sec}>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={createFollowUp}
              onChange={(e) => setCreateFollowUp(e.target.checked)}
              style={{
                width: 16,
                height: 16,
                accentColor: "#A855F7",
                cursor: "pointer",
              }}
            />
            <span style={{ fontSize: 13, color: "#C0C0C0" }}>
              צור משימת מעקב מיקס ראשון
            </span>
          </label>
          {createFollowUp && !mixDeadline && (
            <div
              style={{ fontSize: 11, color: "#666", marginTop: 4, paddingRight: 26 }}
            >
              הדדליין שנבחר ישמש תאריך המשימה
            </div>
          )}
        </div>

        {/* ── 6. Calendar sync (whenever mixDeadline is set) ── */}
        {!!mixDeadline && (
          <div style={sec}>
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={syncCalendar}
                onChange={(e) => setSyncCalendar(e.target.checked)}
                style={{ width: 16, height: 16, accentColor: "#A855F7", cursor: "pointer" }}
              />
              <span style={{ fontSize: 13, color: "#C0C0C0" }}>📋 הוסף כמשימה ביומן Google</span>
            </label>
          </div>
        )}

        {/* ── 7. Notes ── */}
        <div style={sec}>
          <span style={fieldLabel}>הערות / קישור לקבצים</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="הערות חופשיות, קישורים..."
            rows={3}
            style={{ ...inp, resize: "vertical" }}
          />
        </div>

        {/* ── Error ── */}
        {error && (
          <div
            style={{
              fontSize: 12,
              color: "#FF6B6B",
              background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.2)",
              borderRadius: 8,
              padding: "6px 10px",
              marginBottom: 14,
            }}
          >
            {error}
          </div>
        )}

        {/* ── Actions ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button
            onClick={handleConfirm}
            disabled={saving}
            style={{
              padding: "11px 0",
              borderRadius: 12,
              border: "1px solid rgba(168,85,247,0.4)",
              background: "rgba(168,85,247,0.12)",
              color: "#C084FC",
              cursor: saving ? "wait" : "pointer",
              fontSize: 13,
              fontWeight: 700,
              fontFamily: "inherit",
              opacity: saving ? 0.6 : 1,
              textAlign: "center",
            }}
          >
            {saving ? "מעדכן..." : "✓ אשר ועבור למיקס"}
          </button>
          <button
            onClick={onClose}
            disabled={saving}
            style={{
              padding: "9px 0",
              borderRadius: 12,
              border: "1px solid #2A2A2A",
              background: "transparent",
              color: "#555",
              cursor: saving ? "default" : "pointer",
              fontSize: 12,
              fontFamily: "inherit",
              textAlign: "center",
            }}
          >
            ביטול
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined"
    ? createPortal(modal, document.body)
    : null;
}
