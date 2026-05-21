/**
 * AI usage tracking + budget guard.
 * Tracks OpenAI API calls in settings KV: 'ai_budget_YYYY_MM' → { calls, estimatedCostUSD }
 * Groq is free — we track it for info only (cost = 0).
 *
 * gpt-4o pricing (approximate): ~$0.005 per 1K output tokens
 * gpt-4o-mini: ~$0.0006 per 1K output tokens
 * We conservatively estimate $0.01 per OpenAI call.
 */
import "server-only";
import { supabase } from "@/lib/supabase";

const OPENAI_COST_PER_CALL_USD = 0.01; // conservative estimate
const BUDGET_LIMIT_USD         = 5.00;

function monthKey(): string {
  const now = new Date();
  return `ai_budget_${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, "0")}`;
}

interface BudgetData {
  calls:            number;
  estimatedCostUSD: number;
  groqCalls:        number;
}

export async function getMonthlyBudget(): Promise<BudgetData & { limit: number; pct: number }> {
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", monthKey())
    .maybeSingle();

  const val = (data?.value ?? {}) as Partial<BudgetData>;
  const calls            = val.calls            ?? 0;
  const estimatedCostUSD = val.estimatedCostUSD ?? 0;
  const groqCalls        = val.groqCalls        ?? 0;

  return {
    calls,
    estimatedCostUSD,
    groqCalls,
    limit: BUDGET_LIMIT_USD,
    pct:   estimatedCostUSD / BUDGET_LIMIT_USD,
  };
}

/**
 * Track one AI call.
 * provider: 'groq' = free (tracking only); 'openai' = costs money.
 */
export async function trackAIUsage(
  provider: "groq" | "openai",
  _tokens?: number
): Promise<void> {
  const key = monthKey();
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();

  const val = (data?.value ?? {}) as Partial<BudgetData>;
  const current: BudgetData = {
    calls:            val.calls            ?? 0,
    estimatedCostUSD: val.estimatedCostUSD ?? 0,
    groqCalls:        val.groqCalls        ?? 0,
  };

  if (provider === "openai") {
    current.calls++;
    current.estimatedCostUSD = Math.round((current.estimatedCostUSD + OPENAI_COST_PER_CALL_USD) * 10000) / 10000;
  } else {
    current.groqCalls++;
  }

  await supabase
    .from("settings")
    .upsert(
      { key, value: current as unknown as Record<string, unknown> },
      { onConflict: "key" }
    );
}

/**
 * Determine AI usage mode based on current spend.
 * 'full'      → < 70% of budget  → use Groq (primary) + OpenAI fallback normally
 * 'groq-only' → 70–90% of budget → skip OpenAI fallback, Groq only
 * 'disabled'  → > 90% of budget  → no AI generation at all, use static templates
 */
export async function shouldUseAI(): Promise<"full" | "groq-only" | "disabled"> {
  const budget = await getMonthlyBudget();
  if (budget.pct >= 0.9) return "disabled";
  if (budget.pct >= 0.7) return "groq-only";
  return "full";
}
