/**
 * In-memory report config cache — shared across ALL Next.js module instances
 * via globalThis. This is the only way to share state between instrumentation.ts
 * (cron) and API routes in Next.js, which run in separate module scopes.
 *
 * SERVER ONLY — do not import from Client Components.
 */

export interface RuntimeConfig {
  morningTime: string;
  eveningTime: string;
}

// Use globalThis so instrumentation.ts (cron) and API routes share the same object
type GlobalState = {
  __rr_config:              RuntimeConfig;
  __rr_schedulerStartedAt:  string | null;
  __rr_lastCronTick:        string | null;
  __rr_lastSentMorning:     string | null;
  __rr_lastSentEvening:     string | null;
};

const g = globalThis as typeof globalThis & Partial<GlobalState>;

// Initialize once — subsequent imports reuse the existing values
if (!g.__rr_config) {
  g.__rr_config = {
    morningTime: process.env.MORNING_REPORT_TIME ?? "07:00",
    eveningTime: process.env.EVENING_REPORT_TIME ?? "19:00",
  };
}
if (g.__rr_schedulerStartedAt === undefined)  g.__rr_schedulerStartedAt = null;
if (g.__rr_lastCronTick       === undefined)  g.__rr_lastCronTick       = null;
if (g.__rr_lastSentMorning    === undefined)  g.__rr_lastSentMorning    = null;
if (g.__rr_lastSentEvening    === undefined)  g.__rr_lastSentEvening    = null;

export function getRuntimeConfig(): RuntimeConfig     { return { ...g.__rr_config! }; }
export function setRuntimeConfig(c: RuntimeConfig)    { g.__rr_config = { ...c }; }

export function markSchedulerStarted()                { g.__rr_schedulerStartedAt = new Date().toISOString(); }
export function markCronTick()                        { g.__rr_lastCronTick = new Date().toISOString(); }
export function markSent(type: "morning" | "evening") {
  if (type === "morning") g.__rr_lastSentMorning = new Date().toISOString();
  else                    g.__rr_lastSentEvening = new Date().toISOString();
}

export function getSchedulerStatus() {
  return {
    schedulerStartedAt: g.__rr_schedulerStartedAt ?? null,
    lastCronTick:       g.__rr_lastCronTick       ?? null,
    lastSentMorning:    g.__rr_lastSentMorning     ?? null,
    lastSentEvening:    g.__rr_lastSentEvening     ?? null,
    config:             { ...g.__rr_config! },
  };
}
