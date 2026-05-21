/**
 * AI Router — Groq primary.
 * Includes AI budget tracking (tracks usage in settings KV).
 */
import type { ChatMessage, Project } from "@/lib/types";
import { chatWithGroq } from "@/lib/providers/groq";

export type AIProvider = "groq";

export async function chatWithAgent(
  messages: ChatMessage[],
  projects: Project[],
  calendarContext = ""
): Promise<{ content: string; provider: AIProvider }> {
  const result = await chatWithGroq(messages, projects, calendarContext);
  // Track usage (fire-and-forget, non-fatal)
  try {
    const { trackAIUsage } = await import("@/lib/agent/budget");
    await trackAIUsage("groq");
  } catch { /* ignore */ }
  return result;
}
