import type { Project } from "./types";

export type IssuePriority = "high" | "medium";

export type IssueType =
  | "missing_deadline"   // active project, no deadline
  | "overdue_active"     // active project past deadline
  | "missing_type"       // no projectType
  | "missing_parent"     // no parentProject (empty, not "ללא שיוך")
  | "missing_artist"     // no artist
  // ── Finance ────────────────────────────────────────────
  | "unpaid_in_mix"      // project in mix stages with open balance
  | "payment_overdue"    // expected payment whose date has passed
  | "open_balance"       // active project with unpaid balance
  | "negative_profit";   // expenses exceed received income

export interface ProjectIssue {
  id: string;
  name: string;
  artist: string;
  type: IssueType;
  priority: IssuePriority;
  label: string;
}

// ── Finance summary (computed per-project from transactions) ──────────────────
export interface FinanceSummary {
  projectId:      string;
  agreedPrice:    number;
  currency:       string;
  totalPaid:      number;   // income where status = שולם / התקבל
  totalExpected:  number;   // income where status = צפוי / חלקי
  totalExpenses:  number;   // all expense transactions
  overduePayment: boolean;  // any "צפוי" income with date < today
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

// ── Finance health checks ─────────────────────────────────────────────────────
const MIX_STATUSES    = new Set(["מחכה למיקס", "במיקס"]);
const PAID_STATUSES   = new Set(["שולם", "התקבל"]);
const EXPECT_STATUSES = new Set(["צפוי", "חלקי"]);

export function checkFinanceHealth(
  projects: Project[],
  summaries: FinanceSummary[],
): ProjectIssue[] {
  const issues: ProjectIssue[] = [];
  const map = new Map(summaries.map((s) => [s.projectId, s]));

  for (const p of projects) {
    // Skip completed / paused projects
    if (p.status === "הושלם" || p.status === "בהשהייה") continue;

    const fin = map.get(p.id);
    if (!fin || fin.agreedPrice <= 0) continue; // no agreed price → nothing to check

    const balance = fin.agreedPrice - fin.totalPaid;
    const profit  = fin.totalPaid - fin.totalExpenses;
    const inMix   = MIX_STATUSES.has(p.status);
    const active  = ACTIVE_STATUSES.has(p.status);

    // ─── HIGH ────────────────────────────────────────────
    // Project in mix / waiting for mix — but still has open balance
    if (inMix && balance > 0) {
      issues.push({
        id: p.id, name: p.name, artist: p.artist,
        type: "unpaid_in_mix",
        priority: "high",
        label: `"${p.name}" — ${p.status} ועדיין לא שולם (יתרה: ${balance.toLocaleString()}${fin.currency})`,
      });
    }

    // Expected payment whose date has already passed (and project is NOT in mix)
    if (!inMix && fin.overduePayment) {
      issues.push({
        id: p.id, name: p.name, artist: p.artist,
        type: "payment_overdue",
        priority: "high",
        label: `"${p.name}" — יש תשלום צפוי שתאריכו עבר`,
      });
    }

    // ─── MEDIUM ──────────────────────────────────────────
    // Active project (not in mix) with open balance — no overdue (that's already high)
    if (!inMix && active && balance > 0 && !fin.overduePayment) {
      issues.push({
        id: p.id, name: p.name, artist: p.artist,
        type: "open_balance",
        priority: "medium",
        label: `"${p.name}" — יתרה פתוחה של ${balance.toLocaleString()}${fin.currency}`,
      });
    }

    // Expenses exceed received income → negative profit
    if (fin.totalExpenses > 0 && profit < 0) {
      issues.push({
        id: p.id, name: p.name, artist: p.artist,
        type: "negative_profit",
        priority: "medium",
        label: `"${p.name}" — הוצאות (${fin.totalExpenses.toLocaleString()}${fin.currency}) עולות על הכנסות שהתקבלו`,
      });
    }
  }

  issues.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority === "high" ? -1 : 1;
    return a.name.localeCompare(b.name, "he");
  });

  return issues;
}

/** Returns a compact health summary string for the AI agent context */
export function buildHealthSummary(
  projects: Project[],
  financeSummaries?: FinanceSummary[],
): string {
  const projectIssues = checkHealth(projects);
  const financeIssues = financeSummaries ? checkFinanceHealth(projects, financeSummaries) : [];
  const issues = [...projectIssues, ...financeIssues];

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
