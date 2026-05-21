/**
 * OpenAI provider — PRIMARY AI provider.
 *
 * Default model:  gpt-4o-mini  (cheap, fast, Hebrew-capable)
 * Deep model:     gpt-4o       (for complex analysis — use sparingly)
 *
 * Override via env:
 *   OPENAI_MODEL       → default model (default: gpt-4o-mini)
 *   OPENAI_MODEL_DEEP  → deep analysis model (default: gpt-4o)
 */
import OpenAI from "openai";
import type { ChatMessage, Project } from "@/lib/types";
import { SYSTEM_PROMPT, buildProjectContext } from "@/lib/agent-core";

export type ModelTier = "default" | "deep";

function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  return new OpenAI({ apiKey });
}

export function resolveModel(tier: ModelTier = "default"): string {
  if (tier === "deep") return process.env.OPENAI_MODEL_DEEP ?? "gpt-4o";
  return process.env.OPENAI_MODEL ?? "gpt-4o-mini";
}

export async function chatWithOpenAI(
  messages: ChatMessage[],
  projects: Project[],
  calendarContext = "",
  tier: ModelTier = "default"
): Promise<{ content: string; provider: "openai"; model: string; inputTokens: number; outputTokens: number }> {
  const client = getClient();
  const model  = resolveModel(tier);

  const projectContext = buildProjectContext(projects);
  const fullContext    = calendarContext ? `${projectContext}${calendarContext}` : projectContext;

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: `${SYSTEM_PROMPT}\n\n${fullContext}` },
      ...messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    ],
    temperature: 0.4,
    max_tokens:  700,
  });

  const content      = response.choices[0]?.message?.content ?? "שגיאה בתגובת הסוכן.";
  const inputTokens  = response.usage?.prompt_tokens     ?? 0;
  const outputTokens = response.usage?.completion_tokens ?? 0;

  return { content, provider: "openai", model, inputTokens, outputTokens };
}

/**
 * Lightweight OpenAI call for structured JSON output (reports, recommendations).
 * Always uses gpt-4o-mini unless overridden via env.
 */
export async function openAIJSON<T>(
  prompt: string,
  opts?: { model?: string; maxTokens?: number; temperature?: number }
): Promise<{ data: T; model: string; inputTokens: number; outputTokens: number }> {
  const client = getClient();
  const model  = opts?.model ?? resolveModel("default");

  const response = await client.chat.completions.create({
    model,
    messages:        [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    max_tokens:      opts?.maxTokens  ?? 250,
    temperature:     opts?.temperature ?? 0.6,
  });

  const raw          = response.choices[0]?.message?.content ?? "{}";
  const inputTokens  = response.usage?.prompt_tokens     ?? 0;
  const outputTokens = response.usage?.completion_tokens ?? 0;

  return { data: JSON.parse(raw) as T, model, inputTokens, outputTokens };
}
