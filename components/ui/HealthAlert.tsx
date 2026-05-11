"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useProjects } from "@/components/ProjectsProvider";
import { checkHealth, ProjectIssue } from "@/lib/health";
import { PROJECT_TYPES, NO_AFFILIATION, UpdatableField } from "@/lib/types";

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
          <Link
            href={`/projects/${issue.id}`}
            style={{ fontSize: 11, color: "#3B82F6", textDecoration: "none",
              padding: "3px 10px", borderRadius: 6, border: "1px solid rgba(59,130,246,0.3)",
              background: "rgba(59,130,246,0.08)" }}
          >
            עבור לפרויקט ←
          </Link>
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
            <Link
              href={`/projects/${issue.id}`}
              style={{ fontSize: 11, color: "#888", textDecoration: "none",
                padding: "3px 10px", borderRadius: 6, border: "1px solid #2A2A2A" }}
            >
              הגדר ידנית
            </Link>
          </>
        )}

        {issue.type === "missing_artist" && (
          <Link
            href={`/projects/${issue.id}`}
            style={{ fontSize: 11, color: "#3B82F6", textDecoration: "none",
              padding: "3px 10px", borderRadius: 6, border: "1px solid rgba(59,130,246,0.3)",
              background: "rgba(59,130,246,0.08)" }}
          >
            עבור לפרויקט ←
          </Link>
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
  const allIssues = useMemo(() => checkHealth(projects), [projects]);

  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [snoozed, setSnoozed] = useState<Set<string>>(new Set());

  const issues = useMemo(
    () => allIssues.filter((i) => !snoozed.has(`${i.id}-${i.type}`)),
    [allIssues, snoozed]
  );

  const snooze = (issue: ProjectIssue) =>
    setSnoozed((prev) => new Set([...prev, `${issue.id}-${issue.type}`]));

  // Collapse automatically when all issues resolved/snoozed
  const highCount = issues.filter((i) => i.priority === "high").length;
  const medCount = issues.filter((i) => i.priority === "medium").length;

  if (dismissed || issues.length === 0) return null;

  const borderColor = highCount > 0 ? "#EF444440" : "#F59E0B40";
  const accentColor = highCount > 0 ? "#EF4444" : "#F59E0B";

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
