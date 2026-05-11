/**
 * OpenAI provider — fallback when Groq is unavailable or AI_PROVIDER=openai.
 */
import OpenAI from "openai";
import type { ChatMessage, Project } from "@/lib/types";
import { SYSTEM_PROMPT, buildProjectContext } from "@/lib/agent-core";

function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  return new OpenAI({ apiKey });
}

export async function chatWithOpenAI(
  messages: ChatMessage[],
  projects: Project[],
  calendarContext = ""
): Promise<{ content: string; provider: "openai" }> {
  const client = getClient();
  const projectContext = buildProjectContext(projects);
  const fullContext = calendarContext
    ? `${projectContext}${calendarContext}`
    : projectContext;

  const response = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o",
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
  return { content, provider: "openai" };
}
