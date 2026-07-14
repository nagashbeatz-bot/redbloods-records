import "server-only";
import { supabase } from "@/lib/supabase";
import { sendPushToRoles } from "@/lib/push";

/**
 * Shalev's weekly availability — a single global record in the existing `settings`
 * key/value table (NO schema change; mirrors lib/maintenance.ts). Upsert-by-key
 * overwrites in place, so a new send replaces the previous one with no duplicates.
 * No auto-reset at week start — the last saved value persists until re-sent.
 */
const KEY = "shalev_weekly_availability";

export type AvailabilityDay = { day: string; date: string; available: boolean; from: string };
export type Sender = "owner" | "shalev";
export interface StoredAvailability {
  days: AvailabilityDay[];
  sentBy: Sender;
  sentAt: string; // ISO
}

function cleanDays(input: unknown): AvailabilityDay[] {
  if (!Array.isArray(input)) return [];
  return input.map((d) => {
    const o = (d ?? {}) as Partial<AvailabilityDay>;
    const available = o.available === true;
    return {
      day: typeof o.day === "string" ? o.day : "",
      date: typeof o.date === "string" ? o.date : "",
      available,
      from: available && typeof o.from === "string" ? o.from : "",
    };
  });
}

/** Read the last saved availability (global). Returns null when nothing was sent yet. */
export async function getAvailability(): Promise<StoredAvailability | null> {
  const { data } = await supabase.from("settings").select("value").eq("key", KEY).maybeSingle();
  const v = data?.value as Partial<StoredAvailability> | null;
  if (!v || !Array.isArray(v.days)) return null;
  return {
    days: cleanDays(v.days),
    sentBy: v.sentBy === "shalev" ? "shalev" : "owner",
    sentAt: typeof v.sentAt === "string" ? v.sentAt : new Date().toISOString(),
  };
}

/** Overwrite the availability in place (upsert-by-key → never duplicate rows). */
export async function saveAvailability(days: unknown, sentBy: Sender): Promise<StoredAvailability> {
  const stored: StoredAvailability = { days: cleanDays(days), sentBy, sentAt: new Date().toISOString() };
  await supabase.from("settings").upsert(
    { key: KEY, value: stored as unknown as Record<string, unknown> },
    { onConflict: "key" },
  );
  return stored;
}

// ── Role-aware push ───────────────────────────────────────────────────────────
/** production OR ALLOW_SERVER_PUSH — mirrors the other notify wrappers so a
 *  localhost test run never fires a real push. */
function pushAllowed(): boolean {
  return process.env.NODE_ENV === "production" || process.env.ALLOW_SERVER_PUSH === "true";
}

const DEEP_LINK = "/red-artists?tab=schedule";
const TAG = "rb-availability";

/**
 * Send the two role-specific notifications AFTER a successful save. Never throws —
 * a push failure is reported but must NOT undo the save (the caller keeps the row).
 */
export async function notifyAvailability(sentBy: Sender): Promise<{ sent: boolean; error?: string }> {
  if (!pushAllowed()) return { sent: false, error: "push-disabled-non-production" };
  try {
    if (sentBy === "shalev") {
      await sendPushToRoles(["shalev"], { title: "הזמינות נשלחה", body: "הזמינות שלך לשבוע הבא נשלחה ללייבל", url: DEEP_LINK, tag: TAG });
      await sendPushToRoles(["owner"],  { title: "שליו שלח זמינות", body: "שליו שלח את הזמינות שלו לשבוע הבא", url: DEEP_LINK, tag: TAG });
    } else {
      await sendPushToRoles(["owner"],  { title: "הזמינות נשלחה", body: "הזמינות לשבוע הבא נשמרה בהצלחה", url: DEEP_LINK, tag: TAG });
      await sendPushToRoles(["shalev"], { title: "הזמינות עודכנה", body: "הלייבל עדכן את הזמינות לשבוע הבא", url: DEEP_LINK, tag: TAG });
    }
    return { sent: true };
  } catch (e) {
    console.error("[availability] push failed:", e);
    return { sent: false, error: e instanceof Error ? e.message : "push-failed" };
  }
}
