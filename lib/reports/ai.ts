/**
 * AI recommendations for daily reports.
 * Uses Groq first (fast, free-tier), falls back to OpenAI, then to static fallbacks.
 * SERVER ONLY.
 */
import "server-only";
import { MAI_AI_ENABLED } from "@/lib/feature-flags";
import type { ReportData, ReportType } from "./types";

export async function getRecommendations(
  data: ReportData,
  reportType: ReportType
): Promise<string[]> {
  const contextLines: string[] = [
    `פרויקטים פעילים: ${data.activeProjects.length}`,
    `פרויקטים שעברו דדליין: ${data.overdueProjects.length}`,
  ];

  if (data.overdueProjects.length) {
    contextLines.push(
      `שמות שעברו דדליין: ${data.overdueProjects
        .slice(0, 3)
        .map((p) => `${p.name} (${p.artist || "לא ידוע"})`)
        .join(", ")}`
    );
  }
  if (data.dueTodayProjects.length) {
    contextLines.push(
      `דדליין היום: ${data.dueTodayProjects.map((p) => p.name).join(", ")}`
    );
  }
  if (data.dueSoonProjects.length) {
    contextLines.push(
      `דדליין קרוב: ${data.dueSoonProjects
        .slice(0, 3)
        .map((p) => `${p.name} (${p.daysUntil} ימים)`)
        .join(", ")}`
    );
  }
  if (data.missingInfoProjects.length) {
    contextLines.push(`פרויקטים חסרי מידע: ${data.missingInfoProjects.length}`);
  }
  if (data.calendarEvents.length) {
    contextLines.push(
      `אירועים היום: ${data.calendarEvents
        .map((e) => `${e.type} "${e.title}"`)
        .join(", ")}`
    );
  }

  // Evening-specific context (uses new field names from ReportData v2)
  if (reportType === "evening") {
    if ((data.sessionsDone ?? []).length > 0) {
      contextLines.push(
        `סשנים שהתקיימו היום: ${(data.sessionsDone ?? [])
          .map((s) => `${s.projectName}${s.artist ? ` (${s.artist})` : ""}`)
          .join(", ")}`
      );
    }
    if ((data.sessionsNeedingUpdate ?? []).length > 0) {
      contextLines.push(
        `סשנים שעברו ודורשים עדכון: ${(data.sessionsNeedingUpdate ?? [])
          .map((s) => s.projectName).join(", ")}`
      );
    }
    if ((data.tomorrowSessions ?? []).length > 0) {
      contextLines.push(
        `סשנים מחר: ${(data.tomorrowSessions ?? [])
          .map((s) => `${s.projectName}${s.startTime ? ` ב-${s.startTime.slice(0, 5)}` : ""}`)
          .join(", ")}`
      );
    }
    const totalIn      = (data.txReceivedToday         ?? []).reduce((s: number, t: { amount: number }) => s + t.amount, 0);
    const totalPending = (data.txPendingAddedToday      ?? []).reduce((s: number, t: { amount: number }) => s + t.amount, 0);
    const totalExpPaid = (data.txExpensesPaidToday      ?? []).reduce((s: number, t: { amount: number }) => s + t.amount, 0);
    const totalExpPend = (data.txExpensesPendingToday   ?? []).reduce((s: number, t: { amount: number }) => s + t.amount, 0);
    if (totalIn + totalPending + totalExpPaid + totalExpPend > 0) {
      contextLines.push(`תנועות כספיות שנרשמו היום: התקבל ${totalIn}₪, הכנסות צפויות ${totalPending}₪, הוצאות ששולמו ${totalExpPaid}₪, הוצאות לתשלום ${totalExpPend}₪`);
    }
    if ((data.completedTodayProjects ?? []).length > 0) {
      contextLines.push(
        `פרויקטים שהסתיימו היום: ${(data.completedTodayProjects ?? []).map((p) => p.name).join(", ")}`
      );
    }
    if ((data.activityItems ?? []).length > 0) {
      contextLines.push(`פעולות שבוצעו היום: ${(data.activityItems ?? []).length} פעולות`);
    }
  }

  const forTomorrow = reportType === "evening";
  const prompt = `אתה מנהל תפעול של סטודיו מוזיקה "Redbloods Records".

מצב נוכחי:
${contextLines.join("\n")}

תן בדיוק 3 המלצות פעולה ${forTomorrow ? "למחר" : "להיום"}.
כל המלצה: משפט אחד, בעברית, קצר, מעשי, ישיר.
אל תחזור על מה שכתבת כבר בדוח. התמקד בצעד הבא הכי חשוב.
החזר JSON בלבד: {"recommendations": ["...", "...", "..."]}`;

  // Try OpenAI (primary) — skipped entirely while the agent/AI is disabled.
  if (MAI_AI_ENABLED && process.env.OPENAI_API_KEY) {
    try {
      const { openAIJSON, resolveModel } = await import("@/lib/providers/openai");
      const model = resolveModel("default");
      const { data, inputTokens, outputTokens } = await openAIJSON<{ recommendations: string[] }>(
        prompt, { model, maxTokens: 250, temperature: 0.65 }
      );
      // Track usage (fire-and-forget)
      void (async () => {
        try {
          const { trackAIUsage } = await import("@/lib/agent/budget");
          await trackAIUsage({ provider: "openai", model, action: `${reportType}_report_recommendations`, source: "report", inputTokens, outputTokens });
        } catch { /* ignore */ }
      })();
      if (Array.isArray(data.recommendations) && data.recommendations.length >= 3) {
        return data.recommendations.slice(0, 3);
      }
    } catch {
      /* fall through to Groq */
    }
  }

  // Groq fallback (optional) — skipped entirely while the agent/AI is disabled.
  if (MAI_AI_ENABLED && process.env.GROQ_API_KEY) {
    try {
      const OpenAI = (await import("openai")).default;
      const client = new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: "https://api.groq.com/openai/v1" });
      const model  = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";
      const res    = await client.chat.completions.create({
        model, messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" }, max_tokens: 220, temperature: 0.65,
      });
      const parsed = JSON.parse(res.choices[0].message.content ?? "{}");
      if (Array.isArray(parsed.recommendations) && parsed.recommendations.length >= 3) {
        return parsed.recommendations.slice(0, 3);
      }
    } catch {
      /* fall through to static */
    }
  }

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
