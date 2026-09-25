/**
 * Sunny System Awareness — validation + the SERVED (semantic) view of the registry. Pure.
 *
 * validateSystemRegistry() is the contract test's core: unique ids, every read capability / knowledge kind / action it
 * names really exists, notifications are never Sunny-triggerable, and nothing implementation-internal leaks into what
 * is served (served descriptors never include `surfaces`).
 */
import { BUSINESS_ACTIONS, CAPABILITY_CHANGES, DOMAIN_CONTRACTS, RELATIONSHIPS, SURFACE_EXCLUSIONS, SYSTEM_BASELINE_VERSION } from "./registry";
import type { DomainContract } from "./types";
import { PUSH_CONTRACTS, SECURITY_GAPS, USER_CONTRACTS, servedPush, servedUser } from "./people-view";

export { BUSINESS_ACTIONS, CAPABILITY_CHANGES, DOMAIN_CONTRACTS, RELATIONSHIPS, SURFACE_EXCLUSIONS, SYSTEM_BASELINE_VERSION };
export type * from "./types";

/** Implementation terms that must never appear in anything served to a remote interface. */
export const FORBIDDEN_SERVED_TERMS = [
  "supabase", "service_role", "service-role", "SUPABASE_", "PARTNER_MCP_SECRET", "CRON_SECRET", "google_calendar_token", "dropbox_tokens", "push_subscriptions",
  "sound_engineer_work", "artist_balance_entries", "artist_balance_cycles", "label_media_income", "red_films_productions", "red_films_budget", "project_release_details", "partner_owner_context",
  "partner_owner_knowledge", "partner_action_events", "partner_gateway_audit", "vendor_project_work", "lib/", "app/api", ".tsx", ".ts:", "PARTNER_INTERNAL_SERVICE_SECRET", "x-redbloods-internal-auth",
];

export type ServedDomain = Omit<DomainContract, "surfaces">;
export const servedDomain = (d: DomainContract): ServedDomain => { const { surfaces: _s, ...rest } = d; void _s; return rest; };

export function validateSystemRegistry(o: { capabilityIds: readonly string[]; knowledgeKinds: readonly string[] }): string[] {
  const e: string[] = [];
  const ids = new Set<string>();
  const actionIds = new Set(BUSINESS_ACTIONS.map((a) => a.id));
  for (const d of DOMAIN_CONTRACTS) {
    if (!/^[A-Z][A-Z0-9_]{2,40}$/.test(d.id)) e.push(`${d.id}: bad id`);
    if (ids.has(d.id)) e.push(`${d.id}: duplicate`);
    ids.add(d.id);
    for (const c of d.readCapabilities) if (!o.capabilityIds.includes(c)) e.push(`${d.id}: read capability ${c} is not registered`);
    for (const k of d.learnKinds) if (!o.knowledgeKinds.includes(k)) e.push(`${d.id}: knowledge kind ${k} does not exist`);
    for (const a of d.proposableActions) if (!BUSINESS_ACTIONS.some((x) => x.id === a && x.class === "VALIDATED_ACTION_EXISTS")) e.push(`${d.id}: proposable action ${a} is not a validated action`);
    if (d.support.read !== "MISSING" && d.support.read !== "INTENTIONALLY_UNAVAILABLE" && d.readCapabilities.length === 0) e.push(`${d.id}: read ${d.support.read} but no read capability`);
    if (d.support.read === "FULL" && d.freshness === "NOT_CONNECTED") e.push(`${d.id}: FULL read cannot be NOT_CONNECTED`);
    if (d.support.learn !== "MISSING" && d.support.learn !== "INTENTIONALLY_UNAVAILABLE" && d.learnKinds.length === 0) e.push(`${d.id}: learn ${d.support.learn} but no knowledge kind`);
    if (d.support.execute !== "NOT_YET_EXECUTABLE" && d.support.execute !== "MISSING") e.push(`${d.id}: Sunny execute is NOT_YET_EXECUTABLE in this baseline (never "forbidden forever")`);
    for (const r of d.rules) if (!/^[A-Z][A-Z0-9_]{2,50}$/.test(r.id)) e.push(`${d.id}.${r.id}: bad rule id`);
    for (const n of d.notifications ?? []) if (n.sunnyMayTrigger !== false) e.push(`${d.id}.${n.id}: Sunny may never trigger notifications`);
    if (!d.limitationsHe.every((l) => l.length > 0)) e.push(`${d.id}: empty limitation`);
    if (!d.surfaces.pages.length && !d.surfaces.api.length) e.push(`${d.id}: owns no surface`);
  }
  const known = new Set(DOMAIN_CONTRACTS.map((d) => d.id));
  for (const d of DOMAIN_CONTRACTS) {
    for (const r of d.rules) for (const t of r.touches ?? []) if (!known.has(t)) e.push(`${d.id}.${r.id}: touches unknown domain ${t}`);
    for (const x of d.sideEffects) for (const t of x.targets) if (!known.has(t)) e.push(`${d.id}.${x.id}: targets unknown domain ${t}`);
  }
  for (const a of BUSINESS_ACTIONS) {
    if (!ids.has(a.domain)) e.push(`action ${a.id}: unknown domain ${a.domain}`);
    if (a.class === "VALIDATED_ACTION_EXISTS" && !a.primitive && a.id !== "ANSWER_QUESTION") e.push(`action ${a.id}: validated but no primitive`);
    if (a.class !== "READ_ONLY" && a.class !== "LEARN_ONLY" && !a.confirmations.includes("OWNER_APPROVAL_REQUIRED")) e.push(`action ${a.id}: every mutation needs OWNER_APPROVAL_REQUIRED`);
    if (a.class === "SECURITY_RESTRICTED" && a.domain !== "PLATFORM_ACCESS") e.push(`action ${a.id}: SECURITY_RESTRICTED is only for auth / roles / credentials`);
    if (a.sunnyCanExecuteToday !== false) e.push(`action ${a.id}: no action is executable by Sunny in this baseline`);
    if (a.financialRisk === "HIGH" && !a.confirmations.includes("FINANCIAL_CONFIRMATION_REQUIRED") && a.class !== "READ_ONLY" && a.class !== "LEARN_ONLY") e.push(`action ${a.id}: high financial risk needs FINANCIAL_CONFIRMATION_REQUIRED`);
    if (a.externalRisk !== "NONE" && !a.confirmations.includes("EXTERNAL_EFFECT_CONFIRMATION_REQUIRED") && a.class !== "READ_ONLY" && a.class !== "LEARN_ONLY") e.push(`action ${a.id}: external effects need EXTERNAL_EFFECT_CONFIRMATION_REQUIRED`);
  }
  if (new Set(BUSINESS_ACTIONS.map((a) => a.id)).size !== actionIds.size) e.push("duplicate action id");
  for (const c of CAPABILITY_CHANGES) if (!ids.has(c.domain)) e.push(`change ${c.version}: unknown domain ${c.domain}`);
  if (!CAPABILITY_CHANGES.some((c) => c.version === SYSTEM_BASELINE_VERSION)) e.push("baseline version has no change entry");
  const served = JSON.stringify({ d: DOMAIN_CONTRACTS.map(servedDomain), r: RELATIONSHIPS, a: BUSINESS_ACTIONS, c: CAPABILITY_CHANGES, u: USER_CONTRACTS.map(servedUser), p: PUSH_CONTRACTS.map(servedPush), g: SECURITY_GAPS }).toLowerCase();
  for (const t of FORBIDDEN_SERVED_TERMS) if (served.includes(t.toLowerCase())) e.push(`served content contains implementation term "${t}"`);
  return e;
}

/** Coverage matrix row per domain. */
export const coverageMatrix = () => DOMAIN_CONTRACTS.map((d) => ({ domain: d.id, title: d.titleHe, group: d.group, ...d.support, states: [...d.states] }));
