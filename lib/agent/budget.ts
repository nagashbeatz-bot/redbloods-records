/**
 * AI usage tracking + budget guard.
 *
 * Stores two keys per month in the settings KV table:
 *   ai_budget_YYYY_MM → { calls, estimatedCostUSD, inputTokens, outputTokens, groqCalls }
 *   ai_log_YYYY_MM    → { entries: AILogEntry[] }  (capped at 200 per month)
 *
 * OpenAI pricing (approximate, verified May 2025):
 *   gpt-4o-mini  → $0.00015 / 1K input,  $0.00060 / 1K output
 *   gpt-4o       → $0.00250 / 1K input,  $0.01000 / 1K output
 *
 * Groq is free-tier for now — tracked for info, cost = 0.
 */
import "server-only";
import { supabase } from "@/lib/supabase";

// ── Cost table ────────────────────────────────────────────────────────────────

const MODEL_COSTS: Record<string, { inputPer1K: number; outputPer1K: number }> = {
  "gpt-4o-mini":            { inputPer1K: 0.00015,  outputPer1K: 0.00060  },
  "gpt-4o":                 { inputPer1K: 0.00250,  outputPer1K: 0.01000  },
  "gpt-4o-mini-2024-07-18": { inputPer1K: 0.00015,  outputPer1K: 0.00060  },
  "gpt-4o-2024-11-20":      { inputPer1K: 0.00250,  outputPer1K: 0.01000  },
  // Groq models are free-tier (no cost)
  "llama-3.3-70b-versatile":{ inputPer1K: 0,         outputPer1K: 0        },
  "llama-3.1-8b-instant":   { inputPer1K: 0,         outputPer1K: 0        },
};

export const BUDGET_LIMIT_USD = 5.00;

export type AISource = "scheduled" | "manual" | "chat" | "report";

export interface AILogEntry {
  ts:           string;   // ISO timestamp
  action:       string;   // e.g. "chat", "morning_report", "weekly_report", "agent_check"
  model:        string;
  inputTokens:  number;
  outputTokens: number;
  costUSD:      number;
  source:       AISource;
  relatedId?:   string;   // project/client/vendor id if relevant
}

interface BudgetData {
  calls:            number;
  estimatedCostUSD: number;
  inputTokens:      number;
  outputTokens:     number;
  groqCalls:        number;
}

interface LogData {
  entries: AILogEntry[];
}

// ── Keys ──────────────────────────────────────────────────────────────────────

function monthKey(suffix: "budget" | "log"): string {
  const now = new Date();
  const m   = String(now.getMonth() + 1).padStart(2, "0");
  return `ai_${suffix}_${now.getFullYear()}_${m}`;
}

// ── Cost calculation ──────────────────────────────────────────────────────────

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const rates = MODEL_COSTS[model] ?? { inputPer1K: 0.01 / 1000 * 1000, outputPer1K: 0 }; // conservative unknown model
  const cost  = (inputTokens / 1000) * rates.inputPer1K + (outputTokens / 1000) * rates.outputPer1K;
  return Math.round(cost * 1_000_000) / 1_000_000; // 6 decimal places
}

// ── Read current month budget ─────────────────────────────────────────────────

export async function getMonthlyBudget(): Promise<BudgetData & { limit: number; pct: number }> {
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", monthKey("budget"))
    .maybeSingle();

  const val               = (data?.value ?? {}) as Partial<BudgetData>;
  const calls             = val.calls             ?? 0;
  const estimatedCostUSD  = val.estimatedCostUSD  ?? 0;
  const inputTokens       = val.inputTokens       ?? 0;
  const outputTokens      = val.outputTokens      ?? 0;
  const groqCalls         = val.groqCalls         ?? 0;

  return {
    calls, estimatedCostUSD, inputTokens, outputTokens, groqCalls,
    limit: BUDGET_LIMIT_USD,
    pct:   estimatedCostUSD / BUDGET_LIMIT_USD,
  };
}

// ── Read monthly log ──────────────────────────────────────────────────────────

export async function getMonthlyLog(): Promise<AILogEntry[]> {
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", monthKey("log"))
    .maybeSingle();

  return ((data?.value as LogData | null)?.entries ?? []);
}

// ── Track one AI call ─────────────────────────────────────────────────────────

export interface TrackParams {
  provider:     "openai" | "groq";
  model:        string;
  action:       string;
  source:       AISource;
  inputTokens:  number;
  outputTokens: number;
  relatedId?:   string;
}

export async function trackAIUsage(params: TrackParams): Promise<void> {
  const { provider, model, action, source, inputTokens, outputTokens, relatedId } = params;
  const costUSD = estimateCost(model, inputTokens, outputTokens);

  const budKey = monthKey("budget");
  const logKey = monthKey("log");

  // Fetch both in parallel
  const [budRow, logRow] = await Promise.all([
    supabase.from("settings").select("value").eq("key", budKey).maybeSingle(),
    supabase.from("settings").select("value").eq("key", logKey).maybeSingle(),
  ]);

  // Update budget summary
  const bval    = ((budRow.data?.value ?? {}) as Partial<BudgetData>);
  const updated: BudgetData = {
    calls:            (bval.calls            ?? 0) + (provider === "openai" ? 1 : 0),
    estimatedCostUSD: Math.round(((bval.estimatedCostUSD ?? 0) + costUSD) * 1_000_000) / 1_000_000,
    inputTokens:      (bval.inputTokens      ?? 0) + inputTokens,
    outputTokens:     (bval.outputTokens     ?? 0) + outputTokens,
    groqCalls:        (bval.groqCalls        ?? 0) + (provider === "groq" ? 1 : 0),
  };

  // Append log entry (cap at 200 entries)
  const entry: AILogEntry = {
    ts:  new Date().toISOString(),
    action,
    model,
    inputTokens,
    outputTokens,
    costUSD,
    source,
    ...(relatedId ? { relatedId } : {}),
  };
  const existingEntries = ((logRow.data?.value as LogData | null)?.entries ?? []);
  const entries = [...existingEntries, entry].slice(-200);

  // Upsert both
  await Promise.all([
    supabase.from("settings").upsert(
      { key: budKey, value: updated as unknown as Record<string, unknown> },
      { onConflict: "key" }
    ),
    supabase.from("settings").upsert(
      { key: logKey, value: { entries } as unknown as Record<string, unknown> },
      { onConflict: "key" }
    ),
  ]);
}

// ── Backwards-compat shim (used by old ai-router.ts call signature) ───────────

export async function trackAIUsageLegacy(provider: "groq" | "openai"): Promise<void> {
  await trackAIUsage({
    provider,
    model:        provider === "groq" ? (process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile") : (process.env.OPENAI_MODEL ?? "gpt-4o-mini"),
    action:       "chat",
    source:       "chat",
    inputTokens:  400,  // conservative estimate when tokens not available
    outputTokens: 200,
  });
}

// ── Budget mode ───────────────────────────────────────────────────────────────

/**
 * 'full'     → < 70% spent  → OpenAI primary normally
 * 'economy'  → 70–90% spent → force gpt-4o-mini only (no gpt-4o)
 * 'disabled' → > 90% spent  → no AI generation, use static templates only
 */
export async function shouldUseAI(): Promise<"full" | "economy" | "disabled"> {
  const budget = await getMonthlyBudget();
  if (budget.pct >= 0.9) return "disabled";
  if (budget.pct >= 0.7) return "economy";
  return "full";
}
