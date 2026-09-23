/**
 * Redbloods Partner — NOT_NOW deferral resolution (Phase F.1H). Pure.
 *
 * A structured choice is resolved ONCE, at decision time, into an exact
 * instant that is persisted as partner_action_events.defer_until (with the
 * choice in defer_choice). Surfacing only ever reads the stored instant, so a
 * later change to these rules never changes the meaning of a past deferral.
 *
 * Rules (policy v1, Asia/Jerusalem calendar):
 *   LATER_TODAY    now + 3 hours
 *   TOMORROW       next Israel day, 09:00 Israel time
 *   IN_3_DAYS      Israel day + 3, 09:00
 *   IN_1_WEEK      Israel day + 7, 09:00
 *   CUSTOM         the Owner-picked instant (>= now + 5 minutes)
 *   SYSTEM_DEFAULT Israel day + 3, 09:00 — only when the Owner gave no choice (recorded as such)
 * Every result must be > now and <= now + 365 days (the DB allows 366).
 */
import { ilYmd } from "../../coo/dates";
import type { DeferChoice } from "./events";

const TZ = "Asia/Jerusalem";
export const DEFER_POLICY_VERSION = "partner-defer-policy-v1";
const MORNING_HOUR = 9;
const MAX_DAYS = 365;
const MIN_CUSTOM_MS = 5 * 60 * 1000;

function ilOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant at which Israel wall-clock time is ymd hh:mm (DST-safe, two-pass). */
export function ilWallClockToInstant(ymd: string, hour: number, minute = 0): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  let t = guess - ilOffsetMs(new Date(guess));
  t = guess - ilOffsetMs(new Date(t));
  return new Date(t);
}

export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + days));
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, "0")}-${String(x.getUTCDate()).padStart(2, "0")}`;
}

export type DeferResolution = { ok: true; deferChoice: DeferChoice; deferUntil: string } | { ok: false; error: string };

export function resolveDeferUntil(choice: DeferChoice, now: Date, customUntil: string | null = null): DeferResolution {
  if (choice !== "CUSTOM" && customUntil !== null) return { ok: false, error: "a defer instant may only be supplied with CUSTOM" };
  const today = ilYmd(now);
  let until: Date;
  switch (choice) {
    case "LATER_TODAY": until = new Date(now.getTime() + 3 * 3600 * 1000); break;
    case "TOMORROW": until = ilWallClockToInstant(addDaysYmd(today, 1), MORNING_HOUR); break;
    case "IN_3_DAYS":
    case "SYSTEM_DEFAULT": until = ilWallClockToInstant(addDaysYmd(today, 3), MORNING_HOUR); break;
    case "IN_1_WEEK": until = ilWallClockToInstant(addDaysYmd(today, 7), MORNING_HOUR); break;
    case "CUSTOM": {
      if (typeof customUntil !== "string" || Number.isNaN(Date.parse(customUntil))) return { ok: false, error: "CUSTOM requires a valid instant" };
      until = new Date(Date.parse(customUntil));
      if (until.getTime() < now.getTime() + MIN_CUSTOM_MS) return { ok: false, error: "CUSTOM must be at least 5 minutes in the future" };
      break;
    }
    default: return { ok: false, error: `unknown defer choice ${JSON.stringify(choice)}` };
  }
  if (until.getTime() <= now.getTime()) return { ok: false, error: "defer target must be in the future" };
  if (until.getTime() > now.getTime() + MAX_DAYS * 86400 * 1000) return { ok: false, error: `defer target must be within ${MAX_DAYS} days` };
  return { ok: true, deferChoice: choice, deferUntil: until.toISOString() };
}
