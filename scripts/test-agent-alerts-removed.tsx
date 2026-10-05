/**
 * Agent Alerts removal (Owner decision, 2026-10-05) — permanent guards: the retired alert subsystem must not come back.
 *
 *   - every alert route / engine / notifier / holiday check / snapshot / week-strength file and the flag file are gone;
 *   - no product code reads or writes agent_alerts (only the system contracts may DECLARE the dormant table);
 *   - no alert UI, badge, card or panel; no alert cron; no PUBLIC_BYPASS entry for an alert route;
 *   - no P_AGENT_ALERTS push contract, no alert action, census row, candidate or target;
 *   - Sunny (lib/partner, the connector) reads no alert, history included; COO has no EXTERNAL_ALERT;
 *   - the table + the push_cooldown_* keys stay DORMANT (declared, never dropped by code); goals stay (COMPANY_OVERVIEW);
 *   - AGENTS.md marks Agent Alerts as Retired.
 *
 * Run with:   npx tsx scripts/test-agent-alerts-removed.tsx      Pure; never touches production.
 */
import fs from "node:fs";
import path from "node:path";
import { PUSH_CONTRACTS } from "../lib/partner/system/people";
import { DOMAIN_CONTRACTS } from "../lib/partner/system/registry";
import { TABLE_COVERAGE } from "../lib/partner/system/company";
import { PROJECT_DORMANT_TABLES } from "../lib/partner/system/project-columns";
import { ACTION_REGISTRY, WAVE1_CANDIDATES } from "../lib/partner/act/registry";
import { PRIMITIVE_SYSTEM_DOMAIN } from "../lib/partner/act/coverage-map";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}`); fail++; } };
const check = (name: string, actual: unknown, expected: unknown) => ok(`${name}${JSON.stringify(actual) === JSON.stringify(expected) ? "" : ` — got ${JSON.stringify(actual)}`}`, JSON.stringify(actual) === JSON.stringify(expected));
const ROOT = path.resolve(__dirname, "..");
const exists = (f: string) => fs.existsSync(path.join(ROOT, f));
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const walk = (d: string): string[] => exists(d) ? fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) => e.name === "node_modules" || e.name.startsWith(".") ? [] : e.isDirectory() ? walk(`${d}/${e.name}`) : /\.(ts|tsx)$/.test(e.name) ? [`${d}/${e.name}`] : []) : [];
// Comments are history, not behaviour: strip them before looking for code.
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const PRODUCT = [...walk("app"), ...walk("components"), ...walk("lib"), "instrumentation.ts", "proxy.ts"].filter(exists);
const CONTRACTS = (f: string) => f.startsWith("lib/partner/system/");
const refs = (re: RegExp, allow: (f: string) => boolean = () => false) => PRODUCT.filter((f) => !allow(f) && re.test(code(read(f))));

console.log("\n1. Every retired file is gone");
const REMOVED = [
  "app/api/agent/alerts/route.ts", "app/api/agent/alerts/[id]/route.ts", "app/api/agent/check/route.ts", "app/api/agent/snapshot/route.ts",
  "lib/agent/alerts-store.ts", "lib/agent/rules.ts", "lib/agent/notifications.ts", "lib/agent/holiday-check.ts", "lib/agent/snapshot.ts",
  "lib/week-strength-notify.ts", "lib/week-strength-pure.ts", "lib/feature-flags.ts", "components/dashboard/AgentSummaryCard.tsx",
];
check("every removed file is absent", REMOVED.filter(exists), []);
check("app/api/agent holds only the goals route", fs.readdirSync(path.join(ROOT, "app/api/agent")).sort(), ["goals"]);
ok("goals stay: lib/agent/goals.ts + /api/agent/goals", exists("lib/agent/goals.ts") && exists("app/api/agent/goals/route.ts"));

console.log("\n2. No product code reads or writes agent_alerts (contracts may only declare the dormant table)");
check("no .from(\"agent_alerts\") outside the contracts", refs(/from\(\s*["'`]agent_alerts["'`]\s*\)|["'`]agent_alerts["'`]/, CONTRACTS), []);
check("no import of the retired engine / store / notifier / snapshot / week-strength / flag", refs(/agent\/(alerts-store|rules|notifications|holiday-check|snapshot)["']|week-strength-(notify|pure)|feature-flags/), []);
check("no AGENT_ALERT_RULES_ENABLED anywhere", refs(/AGENT_ALERT_RULES_ENABLED/), []);
check("no alert fetch / route reference", refs(/\/api\/agent\/(alerts|check|snapshot)/, CONTRACTS), []);
check("no alert types (AgentAlert / AlertStatus / AlertSeverity / AlertInput)", refs(/\b(AgentAlert|AlertStatus|AlertSeverity|AlertInput)\b/), []);

console.log("\n3. No UI, badge, cron or bypass");
check("no alert card / panel / badge in the UI", refs(/AgentSummaryCard|AgentAlertCard|insightsBadge|ALERT_CATEGORIES/), []);
ok("no week-strength / agent-check schedule in instrumentation", !/week[-_ ]?strength|agent\/check|runAgentCheck/i.test(code(read("instrumentation.ts"))));
ok("no alert route in PUBLIC_BYPASS", !/\/api\/agent\/(check|snapshot|alerts)/.test(code(read("proxy.ts"))));

console.log("\n4. No push contract, action, census row, candidate or target");
ok("no P_AGENT_ALERTS push contract", !PUSH_CONTRACTS.some((p) => p.id === "P_AGENT_ALERTS"));
ok("no Owner receivesPush entry for it", !read("lib/partner/system/people.ts").includes('"P_AGENT_ALERTS"'));
check("no alert action in the registry", ["MARK_AGENT_ALERT_HANDLED", "AGENT.MARK_ALERT_HANDLED", "AGENT.CREATE_ALERT", "AGENT.RUN_CHECK"].filter((id) => ACTION_REGISTRY.has(id)), []);
ok("no alert Wave-1 candidate", !WAVE1_CANDIDATES.some((w) => /ALERT/.test(w.id)));
ok("no primitive maps to AGENT_ALERTS; SET_BUSINESS_GOAL is COMPANY_OVERVIEW", !Object.values(PRIMITIVE_SYSTEM_DOMAIN).includes("AGENT_ALERTS" as never) && PRIMITIVE_SYSTEM_DOMAIN.SET_BUSINESS_GOAL === "COMPANY_OVERVIEW");
ok("no agent-alert target kind", !/agent-alert/.test(code(read("lib/partner/act/targets.ts"))));
ok("no alert-status writer in the shared system writer", !/setAlertStatus|ALERT_STATUSES|readAlert|alertActionable/.test(code(read("lib/writes/system.ts"))));
ok("the generated handler map has no alert route", !/agent\/(alerts|check|snapshot)/.test(read("lib/partner/act/handler-map.generated.ts")));

console.log("\n5. Sunny and COO read no alert");
check("lib/partner (outside the contracts) reads no alert", refs(/agent_alerts|companyAlerts|agentAlerts|ALERT_GOAL|ALERT_MEANING/, CONTRACTS).filter((f) => f.startsWith("lib/partner/") || f.startsWith("lib/integrations/")), []);
ok("COO has no EXTERNAL_ALERT / alerts source", ["lib/coo/types.ts", "lib/coo/readers.ts", "lib/coo/signals.ts", "lib/coo/config.ts", "lib/coo/facts.ts"].every((f) => !/EXTERNAL_ALERT|agent_alerts|getAlerts|COMPANY_ALERTS/.test(code(read(f)))));
ok("project delete does not touch agent_alerts", !/agent_alerts/.test(code(read("lib/writes/project-delete.ts"))));

console.log("\n6. Contracts: RETIRED domain, DORMANT table, goals under COMPANY_OVERVIEW");
const AA = DOMAIN_CONTRACTS.find((d) => d.id === "AGENT_ALERTS")!;
ok("AGENT_ALERTS domain is retired (no read capability, no API surface, nothing executable)", AA.readCapabilities.length === 0 && AA.support.execute === "NOT_YET_EXECUTABLE" && AA.rules.some((r) => r.id === "AGENT_ALERTS_RETIRED"));
ok("COMPANY_OVERVIEW owns the business goals", DOMAIN_CONTRACTS.find((d) => d.id === "COMPANY_OVERVIEW")!.rules.some((r) => r.id === "BUSINESS_GOALS_KPI"));
ok("agent_alerts is declared DORMANT in table coverage (exists in the schema, not an active subsystem)", /DORMANT/.test(TABLE_COVERAGE.agent_alerts ?? ""));
ok("agent_alerts is a dormant project table", "agent_alerts" in PROJECT_DORMANT_TABLES);
ok("CO_AGENT_ALERTS_PARALLEL is CLOSED_NOW", /CO_AGENT_ALERTS_PARALLEL[\s\S]{0,1500}?status: "CLOSED_NOW"/.test(read("lib/partner/system/gaps.ts")));
ok("no SQL migration drops the table or deletes its rows", !walk("scripts").concat(fs.readdirSync(path.join(ROOT, "scripts")).filter((f) => f.endsWith(".sql")).map((f) => `scripts/${f}`)).filter(exists).some((f) => /drop\s+table[^;]*agent_alerts|delete\s+from[^;]*agent_alerts/i.test(read(f))));

console.log("\n7. AGENTS.md");
const AG = read("AGENTS.md");
ok("AGENTS.md has a 'Retired: Agent Alerts' section", /## Retired: Agent Alerts/.test(AG));
ok("AGENTS.md no longer names AGENT_ALERT_RULES_ENABLED as live", !/`AGENT_ALERT_RULES_ENABLED` \(off\) gates/.test(AG));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
