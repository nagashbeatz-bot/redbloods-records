/**
 * Groq provider — uses the OpenAI-compatible Groq API.
 * No extra dependencies needed: reuses the `openai` SDK with a custom baseURL.
 *
 * Supported models (fast, Hebrew-capable):
 *   • llama-3.3-70b-versatile  (default — best balance)
 *   • llama-3.1-8b-instant     (fastest, lighter tasks)
 *   • mixtral-8x7b-32768       (large context window)
 */
import OpenAI from "openai";
import type { ChatMessage, Project } from "@/lib/types";
import { SYSTEM_PROMPT, buildProjectContext } from "@/lib/agent-core";

function getClient(): OpenAI {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is not set");
  return new OpenAI({
    apiKey,
    baseURL: "https://api.groq.com/openai/v1",
  });
}

export async function chatWithGroq(
  messages: ChatMessage[],
  projects: Project[],
  calendarContext = ""
): Promise<{ content: string; provider: "groq" }> {
  const client = getClient();
  const projectContext = buildProjectContext(projects);
  const fullContext = calendarContext
    ? `${projectContext}${calendarContext}`
    : projectContext;

  const response = await client.chat.completions.create({
    model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
    messages: [
      { role: "system", content: `${SYSTEM_PROMPT}\n\n${fullContext}` },
      ...messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ],
    temperature: 0.4,
    max_tokens: 700,
  });

  const content = response.choices[0]?.message?.content ?? "שגיאה בתגובת הסוכן.";
  return { content, provider: "groq" };
}
