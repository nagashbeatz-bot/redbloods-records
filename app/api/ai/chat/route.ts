import { NextRequest, NextResponse } from "next/server";
import { chatWithAgent } from "@/lib/ai-router";
import { buildAgentContext } from "@/lib/agent/context-builder";
import { requireOwner } from "@/lib/require-auth";
import { MAI_AI_ENABLED } from "@/lib/feature-flags";

export async function POST(req: NextRequest) {
  // Kill-switch — before auth, DB, or any LLM call. No side effects.
  if (!MAI_AI_ENABLED) return NextResponse.json({ disabled: true }, { status: 503 });
  const unauth = await requireOwner(); if (unauth) return unauth;
  try {
    const { messages, projects, currentPage, selectedProjectId, selectedClientId } =
      await req.json();

    if (!messages || !projects) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    // ── Build full page-aware context (server-side, all DB access here) ───────
    const extraContext = await buildAgentContext({
      currentPage,
      selectedProjectId: selectedProjectId ?? undefined,
      selectedClientId:  selectedClientId  ?? undefined,
    });

    // ── Google Calendar context (existing) ────────────────────────────────────
    let calendarContext = extraContext;
    try {
      const { isConnected, fetchTodayAndWeek, buildCalendarContext } = await import(
        "@/lib/google-calendar"
      );
      if (await isConnected()) {
        const stubs = (projects as Array<{ id: string; name: string; artist: string }>).map(
          (p) => ({ id: p.id, name: p.name, artist: p.artist })
        );
        const { today, week } = await fetchTodayAndWeek(stubs);
        calendarContext += buildCalendarContext(today, week);
      }
    } catch { /* Calendar unavailable */ }

    const result = await chatWithAgent(messages, projects, calendarContext, {
      action: "chat",
      source: "chat",
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
