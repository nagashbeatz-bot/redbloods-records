"use client";

import { useState, useMemo, useEffect } from "react";
import { useProjects } from "@/components/ProjectsProvider";
import { useGlobalProjectDrawer } from "@/components/GlobalProjectDrawer";
import { checkHealth, checkFinanceHealth, ProjectIssue, FinanceSummary } from "@/lib/health";
import { PROJECT_TYPES, NO_AFFILIATION, UpdatableField } from "@/lib/types";

// ── Mobile summary: group issues into up to 3 category lines ─────────────────
function buildSummaryLines(issues: ProjectIssue[]): string[] {
  const counts: Record<string, number> = {};
  for (const i of issues) {
    const key =
      i.type === "overdue_active"    ? "overdue"   :
      i.type === "missing_deadline"  ? "deadline"  :
      (i.type === "unpaid_in_mix" || i.type === "payment_overdue" || i.type === "open_balance" || i.type === "negative_profit")
                                     ? "finance"   :
      i.type === "missing_type"      ? "type"      :
      i.type === "missing_artist"    ? "artist"    : "other";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const lines: string[] = [];
  if (counts.overdue)  lines.push(`${counts.overdue} פרויקט${counts.overdue > 1 ? "ים" : ""} עבר${counts.overdue > 1 ? "ו" : ""} דדליין`);
  if (counts.finance)  lines.push(`${counts.finance} בעי${counts.finance > 1 ? "ות" : "ה"} כספי${counts.finance > 1 ? "ות" : "ת"}`);
  if (counts.deadline) lines.push(`${counts.deadline} פרויקט${counts.deadline > 1 ? "ים" : ""} ללא תאריך יעד`);
  if (counts.type)     lines.push(`${counts.type} פרויקט${counts.type > 1 ? "ים" : ""} ללא סוג`);
  if (counts.artist)   lines.push(`${counts.artist} פרויקט${counts.artist > 1 ? "ים" : ""} ללא אמן`);
  if (counts.other)    lines.push(`${counts.other} בעי${counts.other > 1 ? "ות" : "ה"} נוספ${counts.other > 1 ? "ות" : "ת"}`);
  return lines.slice(0, 3);
}

const TYPE_COLORS: Record<string, string> = {
  "שיר": "#3B82F6", "EP": "#A855F7", "אלבום": "#EC4899",
  "קליפ": "#F59E0B", "רידים": "#10B981", "אחר": "#6B7280",
};

function tomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
}

interface IssueRowProps {
  issue: ProjectIssue;
  onFixed: (issue: ProjectIssue) => void;
  onSnooze: (issue: ProjectIssue) => void;
}

function IssueRow({ issue, onFixed, onSnooze }: IssueRowProps) {
  const { updateProjectField } = useProjects();
  const { openProject } = useGlobalProjectDrawer();
  const [saving, setSaving] = useState(false);
  const [dateVal, setDateVal] = useState("");

  const save = async (field: UpdatableField, value: string) => {
    setSaving(true);
    try {
      await updateProjectField(issue.id, field, value);
      onFixed(issue);
    } catch {
      // stay visible on error
    } finally {
      setSaving(false);
    }
  };

  const dotColor = issue.priority === "high" ? "#EF4444" : "#F59E0B";

  return (
    <div
      style={{
        borderBottom: "1px solid #222",
        padding: "10px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 7,
      }}
    >
      {/* Label row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 8, color: dotColor, flexShrink: 0 }}>⬤</span>
        <span style={{ fontSize: 12, color: "#D0D0D0", flex: 1 }}>{issue.label}</span>
        <button
          onClick={() => onSnooze(issue)}
          style={{ background: "none", border: "none", color: "#444", cursor: "pointer", fontSize: 14, padding: "0 2px" }}
          title="סנוז — הסר מהרשימה הנוכחית"
        >
          ×
        </button>
      </div>

      {/* Quick actions */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, paddingRight: 16 }}>
        {issue.type === "missing_deadline" && (
          <>
            <input
              type="date"
              value={dateVal}
              onChange={(e) => setDateVal(e.target.value)}
              style={{
                background: "#141414", border: "1px solid #333", borderRadius: 6,
                color: "#C0C0C0", fontSize: 11, padding: "3px 7px",
              }}
            />
            <ActionBtn
              label="קבע"
              disabled={!dateVal || saving}
              onClick={() => save("deadline", dateVal)}
              primary
            />
            <ActionBtn
              label="דחה למחר"
              disabled={saving}
              onClick={() => save("deadline", tomorrow())}
            />
          </>
        )}

        {issue.type === "overdue_active" && (
          <button
            onClick={() => openProject(issue.id)}
            style={{ fontSize: 11, color: "#3B82F6", cursor: "pointer", fontFamily: "inherit",
              padding: "3px 10px", borderRadius: 6, border: "1px solid rgba(59,130,246,0.3)",
              background: "rgba(59,130,246,0.08)" }}
          >
            פתח פרויקט ←
          </button>
        )}

        {issue.type === "missing_type" && (
          <>
            {PROJECT_TYPES.map((t) => (
              <button
                key={t}
                disabled={saving}
                onClick={() => save("projectType", t)}
                style={{
                  fontSize: 11, padding: "3px 9px", borderRadius: 6, cursor: "pointer",
                  background: `${TYPE_COLORS[t]}18`, border: `1px solid ${TYPE_COLORS[t]}40`,
                  color: TYPE_COLORS[t], fontFamily: "inherit",
                }}
              >
                {t}
              </button>
            ))}
          </>
        )}

        {issue.type === "missing_parent" && (
          <>
            <ActionBtn
              label="ללא שיוך"
              disabled={saving}
              onClick={() => save("parentProject", NO_AFFILIATION)}
            />
            <button
              onClick={() => openProject(issue.id)}
              style={{ fontSize: 11, color: "#888", cursor: "pointer", fontFamily: "inherit",
                padding: "3px 10px", borderRadius: 6, border: "1px solid #2A2A2A", background: "none" }}
            >
              הגדר ידנית
            </button>
          </>
        )}

        {issue.type === "missing_artist" && (
          <button
            onClick={() => openProject(issue.id)}
            style={{ fontSize: 11, color: "#3B82F6", cursor: "pointer", fontFamily: "inherit",
              padding: "3px 10px", borderRadius: 6, border: "1px solid rgba(59,130,246,0.3)",
              background: "rgba(59,130,246,0.08)" }}
          >
            פתח פרויקט ←
          </button>
        )}

        {/* ── Finance issue types — all open the project drawer ── */}
        {(issue.type === "unpaid_in_mix" ||
          issue.type === "payment_overdue" ||
          issue.type === "open_balance" ||
          issue.type === "negative_profit") && (
          <button
            onClick={() => openProject(issue.id)}
            style={{ fontSize: 11, color: "#3B82F6", cursor: "pointer", fontFamily: "inherit",
              padding: "3px 10px", borderRadius: 6, border: "1px solid rgba(59,130,246,0.3)",
              background: "rgba(59,130,246,0.08)" }}
          >
            פתח כספים ←
          </button>
        )}
      </div>
    </div>
  );
}

function ActionBtn({
  label, onClick, disabled, primary,
}: {
  label: string; onClick: () => void; disabled?: boolean; primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        fontSize: 11, padding: "3px 10px", borderRadius: 6,
        cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit",
        background: primary ? "rgba(59,130,246,0.15)" : "#1E1E1E",
        border: primary ? "1px solid rgba(59,130,246,0.35)" : "1px solid #2A2A2A",
        color: primary ? "#3B82F6" : "#888",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  );
}

export default function HealthAlert() {
  const { projects } = useProjects();
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // ── Finance summaries (loaded once, used for finance health checks) ──────
  const [financeSummaries, setFinanceSummaries] = useState<FinanceSummary[]>([]);

  useEffect(() => {
    const today = new Date().toISOString().split("T")[0];
    fetch("/api/transactions?all=1")
      .then((r) => r.json())
      .then((d) => {
        const transactions: Array<{
          project_id: string; type: string; amount: number;
          payment_status: string; date: string | null;
        }> = d.transactions ?? [];
        const settings: Array<{
          project_id: string; agreedPrice: number; currency: string;
        }> = d.settings ?? [];

        const map = new Map<string, FinanceSummary>();
        const ensure = (pid: string) => {
          if (!map.has(pid)) {
            map.set(pid, { projectId: pid, agreedPrice: 0, currency: "₪", totalPaid: 0, totalExpected: 0, totalExpenses: 0, overduePayment: false });
          }
          return map.get(pid)!;
        };

        for (const t of transactions) {
          const s = ensure(t.project_id);
          if (t.type === "income") {
            if (t.payment_status === "שולם" || t.payment_status === "התקבל") {
              s.totalPaid += t.amount;
            } else if (t.payment_status === "צפוי" || t.payment_status === "חלקי") {
              s.totalExpected += t.amount;
              if (t.date && t.date < today) s.overduePayment = true;
            }
          } else if (t.type === "expense") {
            s.totalExpenses += t.amount;
          }
        }
        for (const setting of settings) {
          const s = ensure(setting.project_id);
          s.agreedPrice = setting.agreedPrice ?? 0;
          s.currency    = setting.currency    ?? "₪";
        }
        setFinanceSummaries(Array.from(map.values()));
      })
      .catch(() => {});
  }, []);

  // ── Merge project + finance issues ───────────────────────────────────────
  const allIssues = useMemo(
    () => [
      ...checkHealth(projects),
      ...checkFinanceHealth(projects, financeSummaries),
    ],
    [projects, financeSummaries],
  );

  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [snoozed, setSnoozed] = useState<Set<string>>(new Set());

  const issues = useMemo(
    () => allIssues.filter((i) => !snoozed.has(`${i.id}-${i.type}`)),
    [allIssues, snoozed]
  );

  const snooze = (issue: ProjectIssue) =>
    setSnoozed((prev) => new Set([...prev, `${issue.id}-${issue.type}`]));

  const highCount = issues.filter((i) => i.priority === "high").length;
  const medCount  = issues.filter((i) => i.priority === "medium").length;

  if (dismissed || issues.length === 0) return null;

  const borderColor = highCount > 0 ? "#EF444440" : "#F59E0B40";
  const accentColor = highCount > 0 ? "#EF4444"   : "#F59E0B";

  // ── Mobile layout ─────────────────────────────────────────────────────────
  if (isMobile) {
    const summaryLines = buildSummaryLines(issues);
    return (
      <div style={{
        borderRadius: 16,
        border: `1px solid ${borderColor}`,
        background: "#161616",
        overflow: "hidden",
      }}>
        {/* Compact card header */}
        <div style={{ padding: "12px 14px 10px", display: "flex", alignItems: "flex-start", gap: 10 }}>
          <span style={{ fontSize: 14, color: accentColor, marginTop: 1 }}>⚠</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#D0D0D0", marginBottom: 5 }}>
              {issues.length === 1 ? "פריט אחד דורש טיפול" : `${issues.length} דברים דורשים טיפול`}
            </div>
            {/* 2-3 summary lines */}
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {summaryLines.map((line) => (
                <div key={line} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 4, height: 4, borderRadius: "50%", background: accentColor, flexShrink: 0, display: "inline-block" }} />
                  <span style={{ fontSize: 12, color: "#888" }}>{line}</span>
                </div>
              ))}
            </div>
          </div>
          {/* Dismiss × */}
          <button
            onClick={() => setDismissed(true)}
            style={{ background: "none", border: "none", color: "#444", cursor: "pointer", fontSize: 18, padding: "0 2px", lineHeight: 1, flexShrink: 0 }}
          >
            ×
          </button>
        </div>

        {/* "פתח טיפול" button */}
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{
            width: "100%", padding: "10px 14px",
            borderTop: "1px solid #222",
            borderRight: "none", borderBottom: "none", borderLeft: "none",
            background: expanded ? "#1A1A1A" : "transparent",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            color: accentColor, fontSize: 12, fontWeight: 700,
            cursor: "pointer", fontFamily: "inherit",
          }}
        >
          <span>{expanded ? "סגור טיפול" : "פתח טיפול"}</span>
          <span style={{ fontSize: 10 }}>{expanded ? "▲" : "▼"}</span>
        </button>

        {/* Expanded issues list */}
        {expanded && (
          <div style={{ maxHeight: 340, overflowY: "auto", WebkitOverflowScrolling: "touch" } as React.CSSProperties}>
            {issues.map((issue) => (
              <IssueRow
                key={`${issue.id}-${issue.type}`}
                issue={issue}
                onFixed={snooze}
                onSnooze={snooze}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Desktop layout (unchanged) ─────────────────────────────────────────────
  return (
    <div
      style={{
        borderRadius: 14,
        border: `1px solid ${borderColor}`,
        background: "#161616",
        marginBottom: 20,
        overflow: "hidden",
      }}
    >
      {/* Header — always visible */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 14px",
          borderBottom: expanded ? "1px solid #222" : "none",
          cursor: "pointer",
        }}
        onClick={() => setExpanded((v) => !v)}
      >
        <span style={{ fontSize: 13, color: accentColor }}>⚠</span>
        <span style={{ fontSize: 12, color: "#C0C0C0", flex: 1, fontWeight: 500 }}>
          {issues.length === 1
            ? issues[0].label
            : `${issues.length} בעיות שדורשות טיפול`}
        </span>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {highCount > 0 && (
            <span style={{ fontSize: 11, color: "#EF4444", fontWeight: 600 }}>
              🔴 {highCount}
            </span>
          )}
          {medCount > 0 && (
            <span style={{ fontSize: 11, color: "#F59E0B", fontWeight: 600 }}>
              🟡 {medCount}
            </span>
          )}
          <span style={{ fontSize: 11, color: "#555", marginRight: 4 }}>
            {expanded ? "▲" : "▼"}
          </span>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); setDismissed(true); }}
          style={{
            background: "none", border: "none", color: "#444",
            cursor: "pointer", fontSize: 15, padding: "0 2px", lineHeight: 1,
          }}
          title="סגור — יחזור בטעינה הבאה"
        >
          ×
        </button>
      </div>

      {/* Expanded issues list */}
      {expanded && (
        <div style={{ maxHeight: 320, overflowY: "auto" }}>
          {issues.map((issue) => (
            <IssueRow
              key={`${issue.id}-${issue.type}`}
              issue={issue}
              onFixed={snooze}
              onSnooze={snooze}
            />
          ))}
        </div>
      )}
    </div>
  );
}
