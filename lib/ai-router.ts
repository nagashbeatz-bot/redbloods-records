/**
 * AI Router — OpenAI primary, Groq optional fallback.
 *
 * Primary:  OpenAI gpt-4o-mini  (cheap default)
 * Fallback: Groq llama-3.3-70b  (only if GROQ_API_KEY set AND OpenAI fails)
 *
 * Every call is tracked in the AI budget + detailed log.
 */
import type { ChatMessage, Project } from "@/lib/types";
import { chatWithOpenAI } from "@/lib/providers/openai";
import type { AISource } from "@/lib/agent/budget";

export type AIProvider = "openai" | "groq";

export async function chatWithAgent(
  messages: ChatMessage[],
  projects: Project[],
  calendarContext = "",
  opts?: { action?: string; source?: AISource; relatedId?: string }
): Promise<{ content: string; provider: AIProvider }> {
  const action = opts?.action  ?? "chat";
  const source = opts?.source  ?? "chat" as AISource;

  // ── Try OpenAI (primary) ──────────────────────────────────────────────────
  if (process.env.OPENAI_API_KEY) {
    try {
      const result = await chatWithOpenAI(messages, projects, calendarContext);
      // Track usage (fire-and-forget, non-fatal)
      void (async () => {
        try {
          const { trackAIUsage } = await import("@/lib/agent/budget");
          await trackAIUsage({
            provider:     "openai",
            model:        result.model,
            action,
            source,
            inputTokens:  result.inputTokens,
            outputTokens: result.outputTokens,
            ...(opts?.relatedId ? { relatedId: opts.relatedId } : {}),
          });
        } catch { /* ignore tracking errors */ }
      })();
      return { content: result.content, provider: "openai" };
    } catch (e) {
      console.error("[ai-router] OpenAI failed, trying Groq fallback:", e);
    }
  }

  // ── Groq fallback (optional) ──────────────────────────────────────────────
  if (process.env.GROQ_API_KEY) {
    try {
      const { chatWithGroq } = await import("@/lib/providers/groq");
      const result = await chatWithGroq(messages, projects, calendarContext);
      void (async () => {
        try {
          const { trackAIUsage } = await import("@/lib/agent/budget");
          await trackAIUsage({
            provider:     "groq",
            model:        process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
            action,
            source,
            inputTokens:  400, // Groq doesn't always return usage
            outputTokens: 200,
            ...(opts?.relatedId ? { relatedId: opts.relatedId } : {}),
          });
        } catch { /* ignore */ }
      })();
      return { content: result.content, provider: "groq" };
    } catch (e) {
      console.error("[ai-router] Groq fallback also failed:", e);
    }
  }

  throw new Error("No AI provider configured. Set OPENAI_API_KEY in environment variables.");
}
