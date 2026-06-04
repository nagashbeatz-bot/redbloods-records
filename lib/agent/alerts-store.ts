/**
 * CRUD for agent_alerts table + cooldown logic.
 * Server-only — uses Supabase secret key.
 */
import "server-only";
import { supabase } from "@/lib/supabase";
import type { AgentAlert, AlertInput, AlertSeverity, AlertStatus } from "@/lib/types";

// Cooldown in hours per severity
const COOLDOWN_HOURS: Record<AlertSeverity, number> = {
  urgent:    6,
  important: 24,
  warning:   48,
  info:      72,
};

function mapRow(r: Record<string, unknown>): AgentAlert {
  return {
    id:               r.id as string,
    type:             r.type as string,
    severity:         r.severity as AlertSeverity,
    title:            r.title as string,
    message:          r.message as string,
    relatedProjectId: (r.related_project_id as string | null) ?? null,
    relatedClientId:  (r.related_client_id  as string | null) ?? null,
    metadata:         (r.metadata as Record<string, unknown>) ?? {},
    suggestedActions: (r.suggested_actions as string[]) ?? [],
    source:           (r.source as AgentAlert["source"]) ?? "scheduled",
    status:           (r.status as AlertStatus) ?? "new",
    sentNotification: (r.sent_notification as boolean) ?? false,
    entityKey:        (r.entity_key as string | null) ?? null,
    createdAt:        r.created_at as string,
    updatedAt:        r.updated_at as string,
  };
}

/**
 * Create an alert only if no recent matching alert exists (cooldown).
 * Returns the created alert, or null if in cooldown.
 */
export async function createAlertIfNotCoolingDown(
  input: AlertInput
): Promise<AgentAlert | null> {
  const cooldownH = COOLDOWN_HOURS[input.severity ?? "warning"];
  const cooldownAgo = new Date(Date.now() - cooldownH * 3600 * 1000).toISOString();

  // Check cooldown.
  // If entityKey is present: check by entity_key (most precise — one alert per entity).
  // Otherwise: check by type + relatedProjectId (existing behavior).
  let existing: { id: string }[] | null = null;

  if (input.entityKey) {
    const { data } = await supabase
      .from("agent_alerts")
      .select("id")
      .eq("entity_key", input.entityKey)
      .gte("created_at", cooldownAgo)
      .not("status", "in", '("dismissed","ignored")')
      .limit(1);
    existing = data;
  } else {
    const query = supabase
      .from("agent_alerts")
      .select("id")
      .eq("type", input.type)
      .gte("created_at", cooldownAgo)
      .not("status", "in", '("dismissed","ignored")')
      .limit(1);

    if (input.relatedProjectId) {
      query.eq("related_project_id", input.relatedProjectId);
    } else {
      query.is("related_project_id", null);
    }
    const { data } = await query;
    existing = data;
  }

  if (existing && existing.length > 0) {
    return null; // in cooldown
  }

  // Insert alert
  const { data, error } = await supabase
    .from("agent_alerts")
    .insert({
      type:               input.type,
      severity:           input.severity ?? "warning",
      title:              input.title,
      message:            input.message,
      related_project_id: input.relatedProjectId ?? null,
      related_client_id:  input.relatedClientId  ?? null,
      metadata:           input.metadata          ?? {},
      suggested_actions:  input.suggestedActions  ?? [],
      source:             input.source             ?? "scheduled",
      status:             "new",
      sent_notification:  false,
      entity_key:         input.entityKey          ?? null,
    })
    .select()
    .single();

  if (error || !data) {
    console.error("[alerts-store] insert error:", error);
    return null;
  }
  return mapRow(data as Record<string, unknown>);
}

/** List alerts with optional filters */
export async function getAlerts(opts: {
  status?: AlertStatus | AlertStatus[];
  severity?: AlertSeverity | AlertSeverity[];
  limit?: number;
  sinceHours?: number;
}): Promise<AgentAlert[]> {
  let q = supabase
    .from("agent_alerts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 100);

  if (opts.status) {
    const statuses = Array.isArray(opts.status) ? opts.status : [opts.status];
    if (statuses.length === 1) {
      q = q.eq("status", statuses[0]);
    } else {
      q = q.in("status", statuses);
    }
  }
  if (opts.severity) {
    const severities = Array.isArray(opts.severity) ? opts.severity : [opts.severity];
    q = q.in("severity", severities);
  }
  if (opts.sinceHours) {
    const since = new Date(Date.now() - opts.sinceHours * 3600 * 1000).toISOString();
    q = q.gte("created_at", since);
  }

  const { data } = await q;
  return (data ?? []).map((r) => mapRow(r as Record<string, unknown>));
}

/** Count unread (status=new) alerts */
export async function getUnreadCount(): Promise<number> {
  const { count } = await supabase
    .from("agent_alerts")
    .select("id", { count: "exact", head: true })
    .eq("status", "new");
  return count ?? 0;
}

/** Update alert status */
export async function updateAlertStatus(id: string, status: AlertStatus): Promise<void> {
  await supabase
    .from("agent_alerts")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
}

/** Mark alert as having sent a push notification */
export async function markNotificationSent(id: string): Promise<void> {
  await supabase
    .from("agent_alerts")
    .update({ sent_notification: true, updated_at: new Date().toISOString() })
    .eq("id", id);
}
