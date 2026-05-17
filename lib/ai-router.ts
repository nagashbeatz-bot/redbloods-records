/**
 * AI Router — Groq only.
 */
import type { ChatMessage, Project } from "@/lib/types";
import { chatWithGroq } from "@/lib/providers/groq";

export type AIProvider = "groq";

export async function chatWithAgent(
  messages: ChatMessage[],
  projects: Project[],
  calendarContext = ""
): Promise<{ content: string; provider: AIProvider }> {
  return chatWithGroq(messages, projects, calendarContext);
}
