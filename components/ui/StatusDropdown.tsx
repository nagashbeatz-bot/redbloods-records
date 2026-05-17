"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import type { ProjectStatus } from "@/lib/types";
import { ALL_STATUSES } from "@/lib/types";
import { getStatusColor } from "@/lib/utils";
import { useProjects } from "@/components/ProjectsProvider";
import { useGlobalProjectDrawer } from "@/components/GlobalProjectDrawer";
import StatusBadge from "./Badge";

const EXCEPTION_PRESETS = [
  "לקוח VIP",
  "סוכם שישלם אחרי מיקס",
  "תשלום בדרך",
  "אישור אישי",
  "אחר",
];

const MIX_STATUSES: ProjectStatus[] = ["מחכה למיקס", "במיקס"];

interface StatusDropdownProps {
  projectId: string;
  status: ProjectStatus;
  small?: boolean;
}

export default function StatusDropdown({ projectId, status, small }: StatusDropdownProps) {
  const { updateProjectField } = useProjects();
  const { openProject }        = useGlobalProjectDrawer();
  const [open, setOpen]             = useState(false);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [dropPos, setDropPos]       = useState<{ top?: number; bottom?: number; left: number; minWidth: number }>({ left: 0, minWidth: 160 });
  // Warning modal state
  const [paymentWarning, setPaymentWarning] = useState<{ next: ProjectStatus; balance: number; currency: string } | null>(null);
  // Exception step: "warn" = first screen, "exception" = reason input screen
  const [warnStep,        setWarnStep]        = useState<"warn" | "exception">("warn");
  const [exceptionReason, setExceptionReason] = useState("");
  // Completion delivery prompt
  const [showDeliveryPrompt, setShowDeliveryPrompt] = useState(false);
  const triggerRef                  = useRef<HTMLButtonElement>(null);
  const errorTimer                  = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current && triggerRef.current.contains(target)) return;
      const portal = document.getElementById("status-dropdown-portal");
      if (portal && portal.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    return () => { if (errorTimer.current) clearTimeout(errorTimer.current); };
  }, []);

  const handleTrigger = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (saving) return;

    if (triggerRef.current) {
      const rect      = triggerRef.current.getBoundingClientRect();
      const dropWidth = 168;
      const DROP_H    = 300; // conservative max height (6 statuses × ~38px + padding)
      const left      = Math.max(rect.right - dropWidth, 8);
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      if (spaceBelow >= DROP_H) {
        setDropPos({ top: rect.bottom + 4, left, minWidth: dropWidth });
      } else {
        setDropPos({ bottom: window.innerHeight - rect.top + 4, left, minWidth: dropWidth });
      }
    }
    setOpen((v) => !v);
  };

  const doUpdate = useCallback(async (next: ProjectStatus) => {
    setSaving(true);
    setError(null);
    if (errorTimer.current) clearTimeout(errorTimer.current);
    try {
      await updateProjectField(projectId, "status", next);
      // After marking complete, offer to create delivery folder
      if (next === "הושלם") {
        setShowDeliveryPrompt(true);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "שגיאה";
      setError(msg);
      errorTimer.current = setTimeout(() => setError(null), 3000);
    } finally {
      setSaving(false);
    }
  }, [projectId, updateProjectField]);

  const handleSelect = async (e: React.MouseEvent, next: ProjectStatus) => {
    e.stopPropagation();
    e.preventDefault();
    setOpen(false);
    if (next === status || saving) return;

    // Pre-mix payment check (only "במיקס" and "מחכה למיקס")
    if (MIX_STATUSES.includes(next)) {
      try {
        const res = await fetch(`/api/transactions?projectId=${projectId}`);
        if (res.ok) {
          const data = await res.json();
          const agreed = data.agreedPrice ?? 0;
          // Count both "שולם" and "התקבל" as received
          const paid = (data.transactions ?? [])
            .filter((t: { type: string; payment_status: string }) =>
              t.type === "income" && (t.payment_status === "שולם" || t.payment_status === "התקבל")
            )
            .reduce((s: number, t: { amount: number }) => s + t.amount, 0);
          if (agreed > 0 && paid < agreed) {
            setWarnStep("warn");
            setExceptionReason("");
            setPaymentWarning({ next, balance: agreed - paid, currency: data.currency ?? "₪" });
            return;
          }
        }
      } catch {
        // Non-fatal — proceed with update even if check fails
      }
    }

    await doUpdate(next);
  };

  const dropdown = (
    <div
      id="status-dropdown-portal"
      style={{
        position:  "fixed",
        top:       dropPos.top,
        bottom:    dropPos.bottom,
        left:      dropPos.left,
        zIndex:    99999,
        background: "#1A1A1A",
        border:    "1px solid #333",
        borderRadius: 12,
        padding:   6,
        minWidth:  dropPos.minWidth,
        boxShadow: "0 8px 32px rgba(0,0,0,0.75)",
      }}
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
    >
      {ALL_STATUSES.map((s) => (
        <button
          key={s}
          onClick={(e) => handleSelect(e, s)}
          style={{
            display:    "block",
            width:      "100%",
            textAlign:  "right",
            padding:    "7px 10px",
            borderRadius: 8,
            border:     "none",
            cursor:     "pointer",
            fontSize:   13,
            fontFamily: "inherit",
            background: s === status ? `${getStatusColor(s)}18` : "transparent",
            color:      s === status ? getStatusColor(s) : "#C0C0C0",
            fontWeight: s === status ? 600 : 400,
          }}
          onMouseEnter={(e) => {
            if (s !== status) (e.currentTarget as HTMLButtonElement).style.background = "#252525";
          }}
          onMouseLeave={(e) => {
            if (s !== status) (e.currentTarget as HTMLButtonElement).style.background = "transparent";
          }}
        >
          {s}
        </button>
      ))}
    </div>
  );

  return (
    <div
      style={{ position: "relative", display: "inline-flex", flexDirection: "column", alignItems: "flex-end" }}
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
    >
      {/* Trigger */}
      <button
        ref={triggerRef}
        onClick={handleTrigger}
        title="שנה סטטוס"
        disabled={saving}
        style={{
          background: "none",
          border:     "none",
          padding:    0,
          cursor:     saving ? "wait" : "pointer",
          display:    "inline-flex",
          alignItems: "center",
          opacity:    saving ? 0.6 : 1,
        }}
      >
        <StatusBadge status={status} small={small} />
      </button>

      {/* Error tooltip */}
      {error && (
        <div
          style={{
            position:  "absolute",
            top:       "calc(100% + 4px)",
            right:     0,
            zIndex:    120,
            background: "#2A1010",
            border:    "1px solid #5A1A1A",
            borderRadius: 8,
            padding:   "4px 10px",
            fontSize:  12,
            color:     "#FF6B6B",
            whiteSpace: "nowrap",
            pointerEvents: "none",
          }}
        >
          {error}
        </div>
      )}

      {/* Portal dropdown — escapes parent overflow:hidden */}
      {open && typeof document !== "undefined" &&
        createPortal(dropdown, document.body)}

      {/* Completion delivery prompt */}
      {showDeliveryPrompt && typeof document !== "undefined" && createPortal(
        <div
          onClick={() => setShowDeliveryPrompt(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 99999,
            background: "rgba(0,0,0,0.65)", backdropFilter: "blur(3px)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#161616", border: "1px solid #2A2A2A",
              borderRadius: 16, padding: "24px 24px 20px",
              width: 340, direction: "rtl",
              boxShadow: "0 20px 60px rgba(0,0,0,0.9)",
            }}
          >
            <div style={{ fontSize: 26, marginBottom: 8, textAlign: "center" }}>✅</div>
            <p style={{ color: "#10B981", fontWeight: 700, fontSize: 15, margin: "0 0 6px", textAlign: "center" }}>
              הפרויקט הושלם!
            </p>
            <p style={{ color: "#555", fontSize: 12, margin: "0 0 20px", textAlign: "center", lineHeight: 1.6 }}>
              רוצה ליצור תיקיית מסירה ב-Dropbox וללינק קבוע ללקוח?
            </p>
            <button
              onClick={() => {
                setShowDeliveryPrompt(false);
                openProject(projectId);
              }}
              style={{
                display: "block", width: "100%", padding: "10px 0",
                borderRadius: 10, border: "1px solid rgba(168,85,247,0.4)",
                background: "rgba(168,85,247,0.1)", color: "#C084FC",
                cursor: "pointer", fontSize: 13, fontWeight: 700,
                fontFamily: "inherit", marginBottom: 8, textAlign: "center",
              }}
            >
              📁 צור תיקיית מסירה
            </button>
            <button
              onClick={() => setShowDeliveryPrompt(false)}
              style={{
                display: "block", width: "100%", padding: "8px 0",
                borderRadius: 10, border: "1px solid #2A2A2A",
                background: "transparent", color: "#555",
                cursor: "pointer", fontSize: 12, fontFamily: "inherit",
                textAlign: "center",
              }}
            >
              דלג כרגע
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* Payment warning portal */}
      {paymentWarning && typeof document !== "undefined" && createPortal(
        <div
          onClick={() => setPaymentWarning(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 99999,
            background: "rgba(0,0,0,0.65)", backdropFilter: "blur(3px)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#161616", border: "1px solid #3A2A10",
              borderRadius: 16, padding: "24px 24px 20px",
              width: 360, direction: "rtl",
              boxShadow: "0 20px 60px rgba(0,0,0,0.9)",
            }}
          >
            {warnStep === "warn" ? (
              /* ── Step 1: Warning ── */
              <>
                <div style={{ fontSize: 26, marginBottom: 8, textAlign: "center" }}>⚠️</div>
                <p style={{ color: "#F59E0B", fontWeight: 700, fontSize: 15, margin: "0 0 6px", textAlign: "center" }}>
                  יתרה פתוחה לפני מיקס
                </p>
                <p style={{ color: "#777", fontSize: 12, margin: "0 0 6px", lineHeight: 1.65, textAlign: "center" }}>
                  לפרויקט זה יש יתרה לא משולמת של{" "}
                  <strong style={{ color: "#EF4444" }}>
                    {paymentWarning.balance.toLocaleString()}{paymentWarning.currency}
                  </strong>.
                </p>
                <p style={{ color: "#555", fontSize: 11, margin: "0 0 20px", textAlign: "center", lineHeight: 1.5 }}>
                  בדרך כלל לא מעבירים פרויקט למיקס לפני סגירת תשלום.
                  <br />מה תרצה לעשות?
                </p>

                {/* Primary: add payment */}
                <button
                  onClick={() => {
                    setPaymentWarning(null);
                    openProject(projectId);
                  }}
                  style={{
                    display: "block", width: "100%", padding: "10px 0",
                    borderRadius: 10, border: "1px solid rgba(16,185,129,0.4)",
                    background: "rgba(16,185,129,0.1)", color: "#10B981",
                    cursor: "pointer", fontSize: 13, fontWeight: 700,
                    fontFamily: "inherit", marginBottom: 8, textAlign: "center",
                  }}
                >
                  + הוסף תשלום
                </button>

                {/* Secondary: mark exception */}
                <button
                  onClick={() => setWarnStep("exception")}
                  style={{
                    display: "block", width: "100%", padding: "9px 0",
                    borderRadius: 10, border: "1px solid rgba(245,158,11,0.3)",
                    background: "rgba(245,158,11,0.07)", color: "#F59E0B",
                    cursor: "pointer", fontSize: 12, fontWeight: 600,
                    fontFamily: "inherit", marginBottom: 8, textAlign: "center",
                  }}
                >
                  סמן כחריג ואשר מעבר למיקס
                </button>

                {/* Cancel */}
                <button
                  onClick={() => setPaymentWarning(null)}
                  style={{
                    display: "block", width: "100%", padding: "8px 0",
                    borderRadius: 10, border: "1px solid #2A2A2A",
                    background: "transparent", color: "#555",
                    cursor: "pointer", fontSize: 12, fontFamily: "inherit",
                    textAlign: "center",
                  }}
                >
                  ביטול
                </button>
              </>
            ) : (
              /* ── Step 2: Exception reason ── */
              <>
                <p style={{ color: "#F59E0B", fontWeight: 700, fontSize: 14, margin: "0 0 6px" }}>
                  סיבת החריג
                </p>
                <p style={{ color: "#555", fontSize: 11, margin: "0 0 14px", lineHeight: 1.5 }}>
                  בחר סיבה או הקלד ידנית (אופציונלי)
                </p>

                {/* Preset chips */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                  {EXCEPTION_PRESETS.map((p) => (
                    <button
                      key={p}
                      onClick={() => setExceptionReason(p)}
                      style={{
                        padding: "4px 10px", borderRadius: 7, cursor: "pointer",
                        fontFamily: "inherit", fontSize: 11, fontWeight: 500,
                        border: exceptionReason === p
                          ? "1px solid rgba(245,158,11,0.5)"
                          : "1px solid #2A2A2A",
                        background: exceptionReason === p
                          ? "rgba(245,158,11,0.12)"
                          : "transparent",
                        color: exceptionReason === p ? "#F59E0B" : "#777",
                      }}
                    >
                      {p}
                    </button>
                  ))}
                </div>

                {/* Free text */}
                <input
                  type="text"
                  value={exceptionReason}
                  onChange={(e) => setExceptionReason(e.target.value)}
                  placeholder="סיבה מותאמת אישית..."
                  style={{
                    width: "100%", boxSizing: "border-box",
                    background: "#111", border: "1px solid #2A2A2A",
                    borderRadius: 8, color: "#E0E0E0", fontSize: 12,
                    padding: "8px 10px", outline: "none",
                    fontFamily: "inherit", marginBottom: 14,
                  }}
                />

                {/* Confirm */}
                <button
                  onClick={async () => {
                    const next   = paymentWarning.next;
                    const today  = new Date().toISOString().split("T")[0];
                    const reason = exceptionReason.trim();
                    setPaymentWarning(null);
                    // Save exception to finance settings
                    try {
                      await fetch(`/api/transactions?projectId=${projectId}&type=settings`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          financeException:     true,
                          financeExceptionReason: reason,
                          financeExceptionDate:   today,
                        }),
                      });
                    } catch { /* non-fatal */ }
                    await doUpdate(next);
                  }}
                  style={{
                    display: "block", width: "100%", padding: "10px 0",
                    borderRadius: 10, border: "1px solid rgba(245,158,11,0.4)",
                    background: "rgba(245,158,11,0.1)", color: "#F59E0B",
                    cursor: "pointer", fontSize: 13, fontWeight: 700,
                    fontFamily: "inherit", marginBottom: 8, textAlign: "center",
                  }}
                >
                  אשר ועבור למיקס →
                </button>

                {/* Back */}
                <button
                  onClick={() => setWarnStep("warn")}
                  style={{
                    display: "block", width: "100%", padding: "8px 0",
                    borderRadius: 10, border: "1px solid #2A2A2A",
                    background: "transparent", color: "#555",
                    cursor: "pointer", fontSize: 12, fontFamily: "inherit",
                    textAlign: "center",
                  }}
                >
                  חזור
                </button>
              </>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
