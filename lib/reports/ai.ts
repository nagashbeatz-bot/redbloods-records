/**
 * Recommendations for the daily reports — deterministic rules over the report data (no model call).
 * SERVER ONLY.
 */
import "server-only";
import type { ReportData, ReportType } from "./types";

export async function getRecommendations(
  data: ReportData,
  reportType: ReportType
): Promise<string[]> {
  // Deterministic, rule-based recommendations only (no model call).
  return genericRecommendations(data, reportType);
}

function genericRecommendations(data: ReportData, type: ReportType): string[] {
  const recs: string[] = [];

  // Overdue active projects (not on hold) — most urgent
  const overdueActive = data.overdueProjects.filter(p => p.status !== "בהשהייה");
  if (overdueActive.length > 0) {
    const p = overdueActive[0];
    const artist = p.artist ? ` עם ${p.artist}` : "";
    const days   = p.daysUntil !== null ? ` (${Math.abs(p.daysUntil)} ימים אחורה)` : "";
    recs.push(`לבדוק את "${p.name}"${artist}${days} — לעדכן סטטוס או דדליין`);
  }

  // Sessions needing update
  if ((data.sessionsNeedingUpdate ?? []).length > 0) {
    const s = data.sessionsNeedingUpdate[0];
    const artist = s.artist ? ` — ${s.artist}` : "";
    recs.push(`לעדכן סטטוס סשן "${s.projectName}"${artist} — עבר ולא עודכן`);
  }

  // Due today
  if (data.dueTodayProjects.length > 0 && recs.length < 3) {
    const p = data.dueTodayProjects[0];
    recs.push(`"${p.name}" — דדליין היום, לבדוק מה הסטטוס ולסמן הושלם או לדחות`);
  }

  // Pending expenses (requires payment)
  if ((data.txExpensesPendingToday ?? []).length > 0 && recs.length < 3) {
    const t = (data.txExpensesPendingToday ?? [])[0];
    const proj = t.projectName !== "כללי" ? ` — ${t.projectName}` : "";
    recs.push(`לבדוק הוצאה "${t.description || t.projectName}"${proj} (${t.amount.toLocaleString("he-IL")}${t.currency}) — לתשלום, לוודא סטטוס`);
  }

  // Sessions tomorrow
  if ((data.tomorrowSessions ?? []).length > 0 && recs.length < 3) {
    const s = data.tomorrowSessions[0];
    const time   = s.startTime ? ` ב-${s.startTime.slice(0, 5)}` : "";
    const artist = s.artist ? ` עם ${s.artist}` : "";
    recs.push(`סשן מחר: "${s.projectName}"${artist}${time} — לוודא שהכל מוכן`);
  }

  // Overdue on-hold
  const overdueOnHold = data.overdueProjects.filter(p => p.status === "בהשהייה");
  if (overdueOnHold.length > 0 && recs.length < 3) {
    const p = overdueOnHold[0];
    recs.push(`"${p.name}" בהשהייה ועבר דדליין — להחליט: מחזירים לעבודה או סוגרים?`);
  }

  // Due soon
  if (data.dueSoonProjects.length > 0 && recs.length < 3) {
    const p = data.dueSoonProjects[0];
    const artist = p.artist ? ` (${p.artist})` : "";
    recs.push(`"${p.name}"${artist} — דדליין בעוד ${p.daysUntil} ימים, לבדוק שהתהליך מתקדם`);
  }

  // Fallbacks if still under 3
  const defaults =
    type === "morning"
      ? ["לבדוק פרויקטים שמחכים למיקס ולעדכן סטטוס", "להוסיף דדליין לפרויקטים ללא תאריך", "לתאם סשן חדש לאמן פעיל"]
      : ["לעדכן סטטוסים בהתאם למה שהתרחש היום", "לוודא שהכנסות שהתקבלו מסומנות כ-התקבל", "לסקור פרויקטים פתוחים ולעדכן דדליין אם צריך"];

  for (const d of defaults) {
    if (recs.length >= 3) break;
    recs.push(d);
  }

  return recs.slice(0, 3);
}
