/**
 * In-memory report config cache.
 *
 * Loaded from Monday.com on server startup (instrumentation.ts).
 * Updated immediately when the user saves times via the UI.
 * The cron reads from here — zero API calls per minute.
 *
 * SERVER ONLY — do not import from Client Components.
 */

export interface RuntimeConfig {
  morningTime: string;
  eveningTime: string;
}

// Module-level singleton — shared across all requests in the same process
let _config: RuntimeConfig = {
  morningTime: process.env.MORNING_REPORT_TIME ?? "07:00",
  eveningTime: process.env.EVENING_REPORT_TIME ?? "19:00",
};

let _schedulerStartedAt: string | null = null;
let _lastCronTick:       string | null = null;
let _lastSentMorning:    string | null = null;
let _lastSentEvening:    string | null = null;

export function getRuntimeConfig(): RuntimeConfig     { return { ..._config }; }
export function setRuntimeConfig(c: RuntimeConfig)    { _config = { ...c }; }

export function markSchedulerStarted()                { _schedulerStartedAt = new Date().toISOString(); }
export function markCronTick()                        { _lastCronTick = new Date().toISOString(); }
export function markSent(type: "morning" | "evening") {
  if (type === "morning") _lastSentMorning = new Date().toISOString();
  else                    _lastSentEvening = new Date().toISOString();
}

export function getSchedulerStatus() {
  return {
    schedulerStartedAt: _schedulerStartedAt,
    lastCronTick:       _lastCronTick,
    lastSentMorning:    _lastSentMorning,
    lastSentEvening:    _lastSentEvening,
    config:             { ..._config },
  };
}
