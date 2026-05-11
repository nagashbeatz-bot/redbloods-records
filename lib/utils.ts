import type { ProjectStatus } from "./types";

export function getStatusColor(status: ProjectStatus): string {
  switch (status) {
    case "בעבודה": return "#3B82F6";
    case "מחכה למיקס": return "#F59E0B";
    case "במיקס": return "#A855F7";
    case "הושלם": return "#10B981";
    case "בהשהייה": return "#6B7280";
    case "לא התחיל": return "#374151";
    default: return "#6B7280";
  }
}

export function getStatusBg(status: ProjectStatus): string {
  switch (status) {
    case "בעבודה": return "rgba(59,130,246,0.15)";
    case "מחכה למיקס": return "rgba(245,158,11,0.15)";
    case "במיקס": return "rgba(168,85,247,0.15)";
    case "הושלם": return "rgba(16,185,129,0.15)";
    case "בהשהייה": return "rgba(107,114,128,0.15)";
    case "לא התחיל": return "rgba(55,65,81,0.3)";
    default: return "rgba(107,114,128,0.15)";
  }
}

export function formatDeadline(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleDateString("he-IL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function daysUntilDeadline(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const deadline = new Date(dateStr);
  deadline.setHours(0, 0, 0, 0);
  return Math.floor((deadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export function isOverdue(dateStr: string | null): boolean {
  if (!dateStr) return false;
  const days = daysUntilDeadline(dateStr);
  return days !== null && days < 0;
}

export function isDueSoon(dateStr: string | null): boolean {
  if (!dateStr) return false;
  const days = daysUntilDeadline(dateStr);
  return days !== null && days >= 0 && days <= 7;
}

export function deadlineLabel(dateStr: string | null): string {
  if (!dateStr) return "—";
  const days = daysUntilDeadline(dateStr);
  if (days === null) return "—";
  if (days < 0) return `עבר דדליין לפני ${Math.abs(days)} ימים`;
  if (days === 0) return "היום";
  if (days === 1) return "מחר";
  if (days <= 7) return `עוד ${days} ימים`;
  if (days <= 30) return `עוד ${days} ימים`;
  return formatDeadline(dateStr);
}
