/**
 * Smart notification sender.
 * - Only sends for severity 'important' or 'urgent'
 * - Groups same-type alerts and sends ONE push per group
 * - Checks/updates per-tag cooldown in settings KV
 * - Marks alerts as sent in agent_alerts table
 */
import "server-only";
import { sendPushToAll } from "@/lib/push";
import { supabase } from "@/lib/supabase";
import { markNotificationSent } from "./alerts-store";
import type { AgentAlert } from "@/lib/types";

// Cooldown in hours per notification tag (prevents repeat pushes for same issue)
const TAG_COOLDOWN_HOURS: Record<string, number> = {
  overdue_deadline:      12,
  deadline_approaching:  24,
  session_needs_update:  6,
  payment_overdue:       12,
  project_no_pricing:    48,
  victor_stuck:          12,
  victor_below_pace:     24,
  inactivity:            24,
  goal_behind:           24,
  completed_no_delivery: 48,
  stale_session:         48,
  default:               12,
};

async function getTagCooldown(tag: string): Promise<Date | null> {
  const key = `push_cooldown_${tag}`;
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (!data?.value) return null;
  const ts = (data.value as Record<string, unknown>).ts as string | undefined;
  return ts ? new Date(ts) : null;
}

async function setTagCooldown(tag: string): Promise<void> {
  const key = `push_cooldown_${tag}`;
  await supabase
    .from("settings")
    .upsert(
      { key, value: { ts: new Date().toISOString() } as unknown as Record<string, unknown> },
      { onConflict: "key" }
    );
}

/** Returns true if the tag is still in cooldown */
async function isTagCoolingDown(tag: string): Promise<boolean> {
  const last = await getTagCooldown(tag);
  if (!last) return false;
  const cooldownH = TAG_COOLDOWN_HOURS[tag] ?? TAG_COOLDOWN_HOURS.default;
  const cooldownMs = cooldownH * 3600 * 1000;
  return Date.now() - last.getTime() < cooldownMs;
}

/**
 * Send push notifications for new alerts.
 * Groups by type, sends one push per type group, respects cooldown.
 * Returns number of push notifications sent.
 */
export async function sendAlertsAsNotifications(
  newAlerts: AgentAlert[]
): Promise<number> {
  // Only send for important/urgent
  const actionable = newAlerts.filter(
    (a) => a.severity === "important" || a.severity === "urgent"
  );
  if (actionable.length === 0) return 0;

  // Group by type
  const groups = new Map<string, AgentAlert[]>();
  for (const alert of actionable) {
    const existing = groups.get(alert.type) ?? [];
    existing.push(alert);
    groups.set(alert.type, existing);
  }

  let sent = 0;
  for (const [tag, alerts] of groups) {
    // Check cooldown for this tag
    if (await isTagCoolingDown(tag)) continue;

    let notification: { title: string; body: string; url: string; tag: string };

    if (alerts.length === 1) {
      const a = alerts[0];
      notification = {
        title: a.title,
        body:  a.message.length > 120 ? a.message.slice(0, 117) + "..." : a.message,
        url:   urlForType(tag),
        tag,
      };
    } else {
      // Multiple alerts of same type: aggregate
      notification = {
        title: `${alerts[0].title.split(" — ")[0]} (${alerts.length})`,
        body:  `יש ${alerts.length} התראות מסוג זה. פתח לפרטים.`,
        url:   urlForType(tag),
        tag,
      };
    }

    try {
      await sendPushToAll(notification);
      await setTagCooldown(tag);
      // Mark all alerts in this group as sent
      for (const a of alerts) {
        await markNotificationSent(a.id);
      }
      sent++;
    } catch (err) {
      console.error(`[notifications] failed to send push for tag ${tag}:`, err);
    }
  }

  return sent;
}

function urlForType(type: string): string {
  const MAP: Record<string, string> = {
    overdue_deadline:      "/dashboard",
    deadline_approaching:  "/dashboard",
    session_needs_update:  "/setup/calendar",
    payment_overdue:       "/finance",
    project_no_pricing:    "/projects",
    victor_stuck:          "/team",
    victor_below_pace:     "/team",
    inactivity:            "/dashboard",
    goal_behind:           "/insights",
    completed_no_delivery: "/projects",
    stale_session:         "/projects",
  };
  return MAP[type] ?? "/dashboard";
}
