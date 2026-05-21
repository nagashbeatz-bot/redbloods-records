import { NextRequest, NextResponse } from "next/server";
import { chatWithAgent } from "@/lib/ai-router";

export async function POST(req: NextRequest) {
  try {
    const { messages, projects, currentPage } = await req.json();
    if (!messages || !projects) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    let extraContext = "";

    // ── Google Calendar context ───────────────────────────────────────────────
    try {
      const { isConnected, fetchTodayAndWeek, buildCalendarContext } = await import(
        "@/lib/google-calendar"
      );
      if (await isConnected()) {
        const stubs = (projects as Array<{ id: string; name: string; artist: string }>).map(
          (p) => ({ id: p.id, name: p.name, artist: p.artist })
        );
        const { today, week } = await fetchTodayAndWeek(stubs);
        extraContext += buildCalendarContext(today, week);
      }
    } catch { /* Calendar unavailable */ }

    // ── Agent alerts context (top 10 open, last 7 days) ───────────────────────
    try {
      const { getAlerts } = await import("@/lib/agent/alerts-store");
      const alerts = await getAlerts({ status: "new", limit: 10, sinceHours: 7 * 24 });
      if (alerts.length > 0) {
        const SEV_HE: Record<string, string> = {
          urgent: "דחוף", important: "חשוב", warning: "שים לב", info: "מידע",
        };
        extraContext += `\n\n== התראות פתוחות מהסוכן (${alerts.length}) ==\n` +
          alerts
            .map((a) => `• [${SEV_HE[a.severity] ?? a.severity}] ${a.title}: ${a.message}`)
            .join("\n") +
          "\n(אלה הדברים שהסוכן זיהה כדורשים טיפול)";
      }
    } catch { /* Alerts unavailable */ }

    // ── Page context ──────────────────────────────────────────────────────────
    if (currentPage) {
      const PAGE_LABELS: Record<string, string> = {
        "/dashboard":       "דשבורד ראשי",
        "/projects":        "עמוד פרויקטים",
        "/insights":        "עמוד תובנות והתראות",
        "/finance":         "עמוד כספים",
        "/clients":         "עמוד לקוחות ואמנים",
        "/team":            "עמוד צוות (ויקטור)",
        "/setup/calendar":  "הגדרות יומן",
        "/setup/dropbox":   "הגדרות Dropbox",
        "/setup/reports":   "הגדרות דוחות",
      };
      const pageLabel = PAGE_LABELS[currentPage] ??
        Object.entries(PAGE_LABELS).find(([k]) => currentPage.startsWith(k))?.[1] ??
        currentPage;
      extraContext += `\n\n== הקשר נוכחי ==\nהמשתמש נמצא כעת ב: ${pageLabel}`;
    }

    const result = await chatWithAgent(messages, projects, extraContext, {
      action: "chat",
      source: "chat",
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
