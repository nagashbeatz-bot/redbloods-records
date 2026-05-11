/**
 * Schedule validation rules — pure, no googleapis, safe for client & server.
 *
 * Working hours: Sunday–Thursday, 10:00–20:00 (Israel).
 * Slot granularity: every 30 minutes.
 * Buffer: 30 min gap before/after sessions & rehearsals.
 */

export const WORK_START_H  = 10;   // inclusive
export const WORK_END_H    = 20;   // exclusive upper bound (events must END by 20:00)
export const WORK_DAYS     = [0, 1, 2, 3, 4]; // Sun=0 … Thu=4
export const SLOT_STEP_MIN = 30;
export const BUFFER_MIN    = 30;

const DAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

export function dayName(date: Date): string {
  return DAY_NAMES[date.getDay()];
}

export function isWorkingDay(date: Date): boolean {
  return WORK_DAYS.includes(date.getDay());
}

/** True when an event of `durationMin` starting at h:m stays within working hours */
export function isInWorkingHours(h: number, m: number, durationMin: number): boolean {
  const startMin = h * 60 + m;
  const endMin   = startMin + durationMin;
  return startMin >= WORK_START_H * 60 && endMin <= WORK_END_H * 60;
}

/**
 * All valid :00/:30 start times for an event of `durationMin` within working hours.
 * Returns array of { h, m } pairs.
 */
export function validStartTimes(durationMin: number): { h: number; m: number }[] {
  const times: { h: number; m: number }[] = [];
  for (let totalMin = WORK_START_H * 60; totalMin + durationMin <= WORK_END_H * 60; totalMin += SLOT_STEP_MIN) {
    times.push({ h: Math.floor(totalMin / 60), m: totalMin % 60 });
  }
  return times;
}

/** Format h:m as "HH:MM" */
export function fmtHM(h: number, m: number): string {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Format a Date as "HH:MM" */
export function fmtTime(d: Date): string {
  return fmtHM(d.getHours(), d.getMinutes());
}

/** Short Hebrew day+date label, e.g. "יום ד׳ 15.1" */
export function fmtDayDate(d: Date): string {
  const now = new Date();
  const todayStr    = now.toDateString();
  const tomorrowStr = new Date(now.getTime() + 86_400_000).toDateString();
  if (d.toDateString() === todayStr)    return "היום";
  if (d.toDateString() === tomorrowStr) return "מחר";
  return `יום ${dayName(d)} ${d.getDate()}.${d.getMonth() + 1}`;
}

/** Full slot label like "היום  10:00 – 12:00" */
export function slotLabel(start: Date, end: Date): string {
  return `${fmtDayDate(start)}  ${fmtTime(start)} – ${fmtTime(end)}`;
}

/** Confirmation summary like "יום ד׳ 15.1, 17:00 – 20:00" */
export function confirmLabel(start: Date, end: Date): string {
  const day = fmtDayDate(start);
  return `${day}, ${fmtTime(start)} – ${fmtTime(end)}`;
}

// ─── Conflict / buffer checking (shared logic) ────────────────────────────────

export interface BusyPeriod {
  start: Date;
  end: Date;
}

export interface SlotCheckResult {
  outOfDays:      boolean;   // not Sun–Thu
  outOfHours:     boolean;   // end > 20:00
  hardConflict:   boolean;   // overlaps an existing event
  bufferWarning:  boolean;   // < 30 min gap (only for requiresBuffer actions)
}

export function checkSlot(
  start: Date,
  end: Date,
  requiresBuffer: boolean,
  busyPeriods: BusyPeriod[]
): SlotCheckResult {
  const outOfDays  = !isWorkingDay(start);
  const endH = end.getHours() + end.getMinutes() / 60;
  const outOfHours = endH > WORK_END_H;

  let hardConflict  = false;
  let bufferWarning = false;

  for (const b of busyPeriods) {
    // Hard conflict: our event overlaps a busy period
    if (b.start < end && b.end > start) {
      hardConflict = true;
    }

    if (requiresBuffer) {
      // Buffer before: busy period ends within 30 min before our start
      const gapBefore = start.getTime() - b.end.getTime();
      if (gapBefore >= 0 && gapBefore < BUFFER_MIN * 60_000) bufferWarning = true;

      // Buffer after: busy period starts within 30 min after our end
      const gapAfter = b.start.getTime() - end.getTime();
      if (gapAfter >= 0 && gapAfter < BUFFER_MIN * 60_000) bufferWarning = true;
    }
  }

  return { outOfDays, outOfHours, hardConflict, bufferWarning };
}
