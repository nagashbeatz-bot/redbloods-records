/**
 * Project action definitions — shared between client and server.
 * No Node.js / googleapis imports here.
 */

export interface DurationOption {
  minutes: number;
  label: string;   // "שעתיים", "30 דקות" etc.
}

export interface ActionDef {
  id: string;
  label: string;           // menu label
  modalTitle: string;      // modal heading
  calPrefix: string;       // Google Calendar event prefix
  durations: DurationOption[];
  defaultMinutes: number;
  /** If true, require 30-min buffer before/after adjacent events */
  requiresBuffer: boolean;
}

export const ACTIONS: ActionDef[] = [
  {
    id: "session",
    label: "קבע סשן",
    modalTitle: "קביעת סשן ביומן",
    calPrefix: "סשן",
    durations: [
      { minutes: 60,  label: "שעה" },
      { minutes: 90,  label: "שעה וחצי" },
      { minutes: 120, label: "שעתיים" },
      { minutes: 180, label: "3 שעות" },
    ],
    defaultMinutes: 120,
    requiresBuffer: true,
  },
  {
    id: "channel-clean",
    label: "ניקוי ערוצים למיקס",
    modalTitle: "קביעת ניקוי ערוצים למיקס",
    calPrefix: "ניקוי ערוצים למיקס",
    durations: [
      { minutes: 30, label: "30 דקות" },
      { minutes: 60, label: "שעה" },
    ],
    defaultMinutes: 60,
    requiresBuffer: false,
  },
  {
    id: "rehearsal",
    label: "קבע חזרה",
    modalTitle: "קביעת חזרה ביומן",
    calPrefix: "חזרה",
    durations: [
      { minutes: 60,  label: "שעה" },
      { minutes: 90,  label: "שעה וחצי" },
      { minutes: 120, label: "שעתיים" },
      { minutes: 180, label: "3 שעות" },
    ],
    defaultMinutes: 120,
    requiresBuffer: true,
  },
];

export function buildEventTitle(
  action: ActionDef,
  artist: string,
  projectName: string
): string {
  return `${action.calPrefix} - ${artist} - ${projectName}`;
}

export interface FreeSlot {
  start: string; // ISO
  end: string;   // ISO
  label: string; // e.g. "היום  19:00 – 21:00"
}
