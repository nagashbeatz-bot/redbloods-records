/**
 * AI recommendations for daily reports.
 * Uses Groq first (fast, free-tier), falls back to OpenAI, then to static fallbacks.
 * SERVER ONLY.
 */
import "server-only";
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

  const forTomorrow = reportType === "evening";
  const prompt = `אתה מנהל תפעול של סטודיו מוזיקה "Redbloods Records".

מצב נוכחי:
${contextLines.join("\n")}

תן בדיוק 3 המלצות פעולה ${forTomorrow ? "למחר" : "להיום"}.
כל המלצה: משפט אחד, בעברית, קצר, מעשי, ישיר.
אל תחזור על מה שכתבת כבר בדוח. התמקד בצעד הבא הכי חשוב.
החזר JSON בלבד: {"recommendations": ["...", "...", "..."]}`;

  // Try Groq first
  if (process.env.GROQ_API_KEY) {
    try {
      const OpenAI = (await import("openai")).default;
      const client = new OpenAI({
        apiKey:  process.env.GROQ_API_KEY,
        baseURL: "https://api.groq.com/openai/v1",
      });
      const res = await client.chat.completions.create({
        model:           process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
        messages:        [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_tokens:      220,
        temperature:     0.65,
      });
      const parsed = JSON.parse(res.choices[0].message.content ?? "{}");
      if (
        Array.isArray(parsed.recommendations) &&
        parsed.recommendations.length >= 3
      ) {
        return parsed.recommendations.slice(0, 3);
      }
    } catch {
      /* fall through to OpenAI */
    }
  }

  // Try OpenAI fallback
  if (process.env.OPENAI_API_KEY) {
    try {
      const OpenAI = (await import("openai")).default;
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const res = await client.chat.completions.create({
        model:           process.env.OPENAI_MODEL ?? "gpt-4o-mini",
        messages:        [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_tokens:      220,
        temperature:     0.65,
      });
      const parsed = JSON.parse(res.choices[0].message.content ?? "{}");
      if (
        Array.isArray(parsed.recommendations) &&
        parsed.recommendations.length >= 3
      ) {
        return parsed.recommendations.slice(0, 3);
      }
    } catch {
      /* fall through to generic */
    }
  }

  return genericRecommendations(data, reportType);
}

function genericRecommendations(data: ReportData, type: ReportType): string[] {
  const recs: string[] = [];

  if (data.overdueProjects.length) {
    recs.push(`עדכן סטטוס או דדליין עבור "${data.overdueProjects[0].name}"`);
  }
  if (data.dueTodayProjects.length) {
    recs.push(`סיים את "${data.dueTodayProjects[0].name}" עד סוף היום`);
  }
  if (data.missingInfoProjects.length) {
    recs.push(`השלם פרטים חסרים ב-${data.missingInfoProjects.length} פרויקטים`);
  }
  if (data.calendarEvents.length) {
    recs.push(`היערך ל${data.calendarEvents[0].type}: ${data.calendarEvents[0].title}`);
  }
  if (data.dueSoonProjects.length && recs.length < 3) {
    recs.push(
      `${data.dueSoonProjects[0].name} מגיע לדדליין תוך ${data.dueSoonProjects[0].daysUntil} ימים — בדוק מצב`
    );
  }

  const defaults =
    type === "morning"
      ? [
          "בדוק פרויקטים שמחכים למיקס ועדכן סטטוס",
          "עדכן דדליין לפרויקטים ללא תאריך",
          "תאם סשן חדש לאמן פעיל",
        ]
      : [
          "עדכן סטטוסים בהתאם למה שהתרחש היום",
          "תעד הערות חשובות מהסשנים של היום",
          "תכנן את הסדר הגבוה ליום המחר",
        ];

  for (const d of defaults) {
    if (recs.length >= 3) break;
    recs.push(d);
  }

  return recs.slice(0, 3);
}
