/**
 * Mai AI removal (Owner decision, 2026-09-25) — permanent guards: the retired in-app AI assistant must not come back.
 *
 *   - every Mai-only file / route / component is gone;
 *   - no code references the old kill switch, the prompt, the context builder, the provider router, the providers or
 *     the AI budget tracker; the model SDK dependency is gone;
 *   - no user-visible "מאי AI" / "סוכן AI" string, no chat panel, no chat entry in navigation;
 *   - the remaining switch only gates the rule-based agent-alert pipeline and stays OFF (behaviour unchanged);
 *   - the reports keep their deterministic recommendations and make no model call;
 *   - Sunny (lib/partner, the connector) imports nothing of it;
 *   - the orphaned storage (memory table, AI budget / log keys) is only described, never read or written by code.
 *
 * Run with:   npx tsx scripts/test-mai-removed.tsx      Pure; never touches production.
 */
import fs from "node:fs";
import path from "node:path";
import { AGENT_ALERT_RULES_ENABLED } from "../lib/feature-flags";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}`); fail++; } };
const check = (name: string, actual: unknown, expected: unknown) => ok(`${name}${JSON.stringify(actual) === JSON.stringify(expected) ? "" : ` — got ${JSON.stringify(actual)}`}`, JSON.stringify(actual) === JSON.stringify(expected));
const ROOT = path.resolve(__dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const walk = (d: string): string[] => fs.existsSync(path.join(ROOT, d)) ? fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) => e.name === "node_modules" || e.name.startsWith(".") ? [] : e.isDirectory() ? walk(`${d}/${e.name}`) : /\.(ts|tsx)$/.test(e.name) ? [`${d}/${e.name}`] : []) : [];
const PRODUCT = [...walk("app"), ...walk("components"), ...walk("lib"), "instrumentation.ts", "proxy.ts"];

console.log("\n1. Mai-only artifacts are gone");
const REMOVED = ["components/ai/ChatPanel.tsx", "app/api/ai/chat/route.ts", "app/api/agent/context/route.ts", "app/api/agent/memory/route.ts", "lib/ai-router.ts", "lib/openai.ts", "lib/agent-core.ts", "lib/providers/openai.ts", "lib/providers/groq.ts", "lib/agent/context-builder.ts", "lib/agent/budget.ts", "lib/mai/operational-rules.ts"];
check("every removed file is absent", REMOVED.filter((f) => fs.existsSync(path.join(ROOT, f))), []);
ok("no /api/ai route family exists", !fs.existsSync(path.join(ROOT, "app/api/ai")));

console.log("\n2. No code path can reach or revive it");
const refs = (re: RegExp) => PRODUCT.filter((f) => re.test(read(f)));
check("no reference to the old kill switch", refs(/MAI_AI_ENABLED/), []);
check("no import of the prompt / context builder / router / providers / budget tracker", refs(/agent-core|ai-router|context-builder|providers\/(openai|groq)|agent\/budget|lib\/openai|lib\/mai\//), []);
check("no model SDK import anywhere in the product", refs(/from ["']openai["']|import\(["']openai["']\)|groq\.com|api\.openai\.com/), []);
check("no chat endpoint / chat panel reference", refs(/\/api\/ai\/chat|ChatPanel|rb:quicksend/), []);
check("no context-snapshot / memory route reference", refs(/\/api\/agent\/context|\/api\/agent\/memory|business_memory/).filter((f) => !f.startsWith("lib/partner/system/")), []);
const pkg = JSON.parse(read("package.json"));
ok("the model SDK dependency is removed", !Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).some((d) => /^openai$|groq/i.test(d)));

console.log("\n3. Nothing user-visible remains");
check("no 'מאי AI' / 'סוכן AI' / 'סגור סוכן' / 'Mai AI' string in the product", refs(/מאי AI|סוכן AI|סגור סוכן|Mai AI/i), []);
check("no word 'Mai' (the assistant) left in product code", refs(/\bMai\b/), []);

console.log("\n4. The remaining switch is neutral and OFF (behaviour unchanged)");
ok("the agent-alert rules switch stays off", AGENT_ALERT_RULES_ENABLED === false);
ok("the flag file names no AI feature that it could enable", !/export const [A-Z_]*(AI|CHAT|ASSISTANT)[A-Z_]*\s*=/.test(read("lib/feature-flags.ts")));
ok("the agent check still stops early while the switch is off (holiday alerts before it)", /if \(!AGENT_ALERT_RULES_ENABLED\) return NextResponse\.json\(\{ ok: true, disabled: true/.test(read("app/api/agent/check/route.ts")) && read("app/api/agent/check/route.ts").indexOf("runHolidayAlertCycle") < read("app/api/agent/check/route.ts").indexOf("if (!AGENT_ALERT_RULES_ENABLED)"));
ok("the alerts API still exempts only the week-strength alert while off", /AGENT_ALERT_RULES_ENABLED/.test(read("app/api/agent/alerts/route.ts")) && /WEEK_STRENGTH_ALERT_TYPE/.test(read("app/api/agent/alerts/route.ts")));

console.log("\n5. Reports keep working without any model");
ok("daily recommendations are the deterministic rules", /return genericRecommendations\(data, reportType\);/.test(read("lib/reports/ai.ts")) && !/fetch\(|openAI|Groq/i.test(read("lib/reports/ai.ts").replace(/\/\*[\s\S]*?\*\//g, "")));
ok("weekly recommendations are the deterministic rules", !/openAIJSON|OPENAI_API_KEY|GROQ_API_KEY/.test(read("lib/reports/weekly.ts")) && /const defaults = \[/.test(read("lib/reports/weekly.ts")));
ok("the report scheduler is untouched (still sends morning / evening)", /maybeSend\("morning"\)/.test(read("instrumentation.ts")) && /maybeSend\("evening"\)/.test(read("instrumentation.ts")));

console.log("\n6. Sunny has zero dependency on it");
check("nothing under lib/partner or the connector imports the removed code", [...walk("lib/partner"), ...walk("lib/integrations")].filter((f) => /from ["'](@\/lib\/|\.\.\/)+(agent-core|ai-router|openai|providers\/|mai\/|agent\/context-builder|agent\/budget|feature-flags)/.test(read(f))), []);

console.log("\n7. Proposal follow-up rules survive under a neutral name");
ok("the client drawer uses the renamed pure module", /from "@\/lib\/proposal-followups"/.test(read("components/clients/ClientDrawer.tsx")) && fs.existsSync(path.join(ROOT, "lib/proposal-followups.ts")));
ok("the renamed module is pure (no fetch / DB / model)", !/fetch\(|supabase|openai/i.test(read("lib/proposal-followups.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")));

console.log("\n8. Its storage is gone from the model too");
ok("no table coverage entry for the dropped memory table", !/business_memory/.test(read("lib/partner/system/company.ts")));
ok("no settings family for the deleted AI budget / log keys", !/OLD_AI_BUDGET_AND_LOG|ai_budget_|ai_log_/.test(read("lib/partner/system/settings.ts")));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
