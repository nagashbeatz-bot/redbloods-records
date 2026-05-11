import type { Project } from "./types";

export type IssuePriority = "high" | "medium";

export type IssueType =
  | "missing_deadline"   // active project, no deadline
  | "overdue_active"     // active project past deadline
  | "missing_type"       // no projectType
  | "missing_parent"     // no parentProject (empty, not "ללא שיוך")
  | "missing_artist";    // no artist

export interface ProjectIssue {
  id: string;
  name: string;
  artist: string;
  type: IssueType;
  priority: IssuePriority;
  label: string;
}

const ACTIVE_STATUSES = new Set(["בעבודה", "מחכה למיקס", "במיקס", "לא התחיל"]);

function isActive(p: Project): boolean {
  return ACTIVE_STATUSES.has(p.status);
}

function missingParent(p: Project): boolean {
  return !p.parentProject || p.parentProject.trim() === "";
}

export function checkHealth(projects: Project[]): ProjectIssue[] {
  const issues: ProjectIssue[] = [];

  for (const p of projects) {
    const active = isActive(p);

    // ─── HIGH ────────────────────────────────────────────────
    // Active project with no deadline
    if (active && !p.deadline) {
      issues.push({
        id: p.id,
        name: p.name,
        artist: p.artist,
        type: "missing_deadline",
        priority: "high",
        label: `"${p.name}" — פרויקט פעיל בלי דדליין`,
      });
    }

    // Active / in-mix project that's overdue
    if (
      p.isOverdue &&
      p.status !== "הושלם" &&
      p.status !== "בהשהייה" &&
      p.deadline
    ) {
      issues.push({
        id: p.id,
        name: p.name,
        artist: p.artist,
        type: "overdue_active",
        priority: "high",
        label: `"${p.name}" — ${p.status === "במיקס" ? "במיקס" : "פרויקט פעיל"} שעבר דדליין`,
      });
    }

    // ─── MEDIUM ──────────────────────────────────────────────
    // Missing artist (any status)
    if (!p.artist || p.artist.trim() === "") {
      issues.push({
        id: p.id,
        name: p.name,
        artist: "",
        type: "missing_artist",
        priority: "medium",
        label: `"${p.name}" — חסר שם אמן`,
      });
    }

    // Missing project type (any status except completed)
    if (!p.projectType && p.status !== "הושלם") {
      issues.push({
        id: p.id,
        name: p.name,
        artist: p.artist,
        type: "missing_type",
        priority: "medium",
        label: `"${p.name}" — חסר סוג פרויקט`,
      });
    }

    // Missing parentProject = empty string (not "ללא שיוך") and not completed
    if (missingParent(p) && p.status !== "הושלם") {
      issues.push({
        id: p.id,
        name: p.name,
        artist: p.artist,
        type: "missing_parent",
        priority: "medium",
        label: `"${p.name}" — חסר שיוך (שייך ל)`,
      });
    }
  }

  // Sort: high first, then alphabetical within priority
  issues.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority === "high" ? -1 : 1;
    return a.name.localeCompare(b.name, "he");
  });

  return issues;
}

/** Returns a compact health summary string for the AI agent context */
export function buildHealthSummary(projects: Project[]): string {
  const issues = checkHealth(projects);
  if (issues.length === 0) return "✓ כל הפרויקטים מלאים ומסודרים.";

  const high = issues.filter((i) => i.priority === "high");
  const medium = issues.filter((i) => i.priority === "medium");

  const lines: string[] = [];
  if (high.length > 0) {
    lines.push(`🔴 דחוף (${high.length}):`);
    for (const i of high) lines.push(`  • ${i.label}`);
  }
  if (medium.length > 0) {
    lines.push(`🟡 בינוני (${medium.length}):`);
    for (const i of medium) lines.push(`  • ${i.label}`);
  }
  return lines.join("\n");
}
