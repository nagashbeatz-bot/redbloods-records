/**
 * AI Router — selects the active provider and handles fallback.
 *
 * Resolution order:
 *   1. AI_PROVIDER env var  ("groq" | "openai") — explicit override
 *   2. GROQ_API_KEY present → Groq  (default)
 *   3. OPENAI_API_KEY present → OpenAI  (fallback)
 *
 * ─────────────────────────────────────────────────────────────────
 *  Agent Permissions Layer (enforced HERE, not in the models):
 * ─────────────────────────────────────────────────────────────────
 *  Both providers receive identical system prompts and project context.
 *  Neither provider has direct write access to Monday.com.
 *  All write operations are mediated by the UI Confirmation Layer:
 *
 *    READ / ANALYZE     → free, no confirmation needed
 *    PENDING_UPDATE     → 1 confirm per project (field update)
 *    PENDING_BULK_UPDATE→ 1 confirm for all projects (bulk)
 *    PENDING_COLUMN_ADD → 1 explicit confirm (structural change)
 *    Manual UI actions  → no extra confirm (user-initiated)
 *
 *  Switching providers does NOT change any of the above rules.
 * ─────────────────────────────────────────────────────────────────
 */
import type { ChatMessage, Project } from "@/lib/types";
import { chatWithGroq } from "@/lib/providers/groq";
import { chatWithOpenAI } from "@/lib/providers/openai";

export type AIProvider = "groq" | "openai";

function resolveProvider(): AIProvider {
  const explicit = process.env.AI_PROVIDER?.toLowerCase();
  if (explicit === "openai") return "openai";
  if (explicit === "groq") return "groq";
  // Auto-detect by key availability
  if (process.env.GROQ_API_KEY) return "groq";
  if (process.env.OPENAI_API_KEY) return "openai";
  // Default to groq (will throw at call time if key is missing)
  return "groq";
}

export async function chatWithAgent(
  messages: ChatMessage[],
  projects: Project[],
  calendarContext = ""
): Promise<{ content: string; provider: AIProvider }> {
  const primary = resolveProvider();

  // Try primary
  try {
    if (primary === "groq") return await chatWithGroq(messages, projects, calendarContext);
    return await chatWithOpenAI(messages, projects, calendarContext);
  } catch (primaryErr) {
    const primaryMsg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);

    // Attempt fallback only if the other key is available
    const fallback: AIProvider = primary === "groq" ? "openai" : "groq";
    const fallbackKeyPresent =
      fallback === "openai"
        ? !!process.env.OPENAI_API_KEY
        : !!process.env.GROQ_API_KEY;

    if (fallbackKeyPresent) {
      console.warn(
        `[ai-router] ${primary} failed ("${primaryMsg}"), falling back to ${fallback}`
      );
      try {
        if (fallback === "openai") return await chatWithOpenAI(messages, projects, calendarContext);
        return await chatWithGroq(messages, projects, calendarContext);
      } catch (fallbackErr) {
        const fallbackMsg =
          fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        throw new Error(
          `Both providers failed. ${primary}: ${primaryMsg} | ${fallback}: ${fallbackMsg}`
        );
      }
    }

    throw new Error(`${primary} failed: ${primaryMsg}`);
  }
}
