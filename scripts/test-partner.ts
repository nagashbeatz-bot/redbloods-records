/**
 * Golden tests for the Redbloods Partner Charter v0 (lib/partner).
 *
 * Run with:   npx tsx scripts/test-partner.ts
 *
 * Pure module: no Supabase, no network, no LLM. Tests protect MEANING
 * (which items are owner-approved, override semantics, provenance), not
 * just counts.
 */
import {
  CHARTER_ITEMS,
  validateCharter,
  getOwnerRules,
  getOwnerGoals,
  getWorkingPrinciples,
  getCharterRule,
  getCharterByDomain,
  isOwnerApproved,
} from "../lib/partner";
import type { CharterItem } from "../lib/partner/types";
import { COO_CONFIG, type TierRule } from "../lib/coo/config";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}
const ok = (name: string, cond: boolean) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}`); fail++; } };

const APPROVED_13 = [
  "GROWTH_WITHOUT_NEGLECT", "PROTECT_LABEL_RELEASES", "QUALITY_BEFORE_SPEED", "NO_HARD_WIP_CAP_FOR_VICTOR",
  "INTERNAL_DEADLINES_MATTER", "GENTLE_CHALLENGE_BY_DEFAULT", "STALE_IS_NOT_AUTOMATICALLY_URGENT",
  "INVESTIGATE_BEFORE_CONCLUDING", "REVENUE_GROWTH_PRIMARY", "MORE_RELEASES_AND_SHOWS",
  "UNDERSTAND_REVENUE_SOURCES", "BALANCE_SHORT_AND_LONG_TERM", "LABEL_ARTIST_INVESTMENT_SIGNALS",
];
const WORKING_7 = [
  "LABEL_ECONOMIC_VALUE", "CLIENT_WORK_AS_CASHFLOW_ENGINE", "IDENTIFY_GROWTH_BOTTLENECKS",
  "CONNECT_DATA_NOT_JUST_DISPLAY", "IDENTIFY_GROWTH_OPPORTUNITIES", "SUSTAINABLE_GROWTH", "TREND_OVER_SNAPSHOT",
];

console.log("Charter v0: the 13 owner-approved entries exist");
ok("all 13 approved ids are present", APPROVED_13.every((id) => !!getCharterRule(id)));
check("total item count is 13 approved + 7 working principles", CHARTER_ITEMS.length, 20);
ok("all 7 working principles are present", WORKING_7.every((id) => !!getCharterRule(id)));

console.log("IDs unique");
ok("no duplicate ids in the real Charter", new Set(CHARTER_ITEMS.map((i) => i.id)).size === CHARTER_ITEMS.length);
ok("validateCharter throws on a duplicate id", (() => {
  const dup = [...CHARTER_ITEMS.slice(0, 1), ...CHARTER_ITEMS.slice(0, 1)];
  try { validateCharter(dup); return false; } catch { return true; }
})());

console.log("provenance is valid (Epistemic Contract)");
ok("every OWNER_RULE / OWNER_GOAL carries source OWNER_CONFIRMED", CHARTER_ITEMS
  .filter((i) => i.status === "OWNER_RULE" || i.status === "OWNER_GOAL")
  .every((i) => i.source.type === "OWNER_CONFIRMED"));
ok("every WORKING_PRINCIPLE carries source SYSTEM_WORKING_HYPOTHESIS (never OWNER_CONFIRMED)", CHARTER_ITEMS
  .filter((i) => i.status === "WORKING_PRINCIPLE")
  .every((i) => i.source.type === "SYSTEM_WORKING_HYPOTHESIS"));
ok("validateCharter rejects an OWNER_RULE with a hypothesis source", (() => {
  const bad: CharterItem[] = [{ ...CHARTER_ITEMS[0], id: "X_BAD_1", status: "OWNER_RULE", source: { type: "SYSTEM_WORKING_HYPOTHESIS" } }];
  try { validateCharter(bad); return false; } catch { return true; }
})());
ok("validateCharter rejects a WORKING_PRINCIPLE with an OWNER_CONFIRMED source", (() => {
  const bad: CharterItem[] = [{ ...CHARTER_ITEMS[0], id: "X_BAD_2", status: "WORKING_PRINCIPLE", source: { type: "OWNER_CONFIRMED", session: "CHARTER_1" } }];
  try { validateCharter(bad); return false; } catch { return true; }
})());

console.log("Working Principles are never Owner Rules");
ok("getWorkingPrinciples() returns none of the 13 approved ids", getWorkingPrinciples().every((i) => !APPROVED_13.includes(i.id)));
ok("getOwnerRules() ∪ getOwnerGoals() returns none of the 7 working-principle ids", [...getOwnerRules(), ...getOwnerGoals()].every((i) => !WORKING_7.includes(i.id)));
check("getWorkingPrinciples() returns exactly the 7 working-principle ids", getWorkingPrinciples().map((i) => i.id).sort(), [...WORKING_7].sort());

console.log("override semantics are valid");
ok("every canOverride=true item has a non-empty overrideRule", CHARTER_ITEMS.filter((i) => i.canOverride).every((i) => !!i.overrideRule?.trim()));
ok("every canOverride=false item has overrideRule=null", CHARTER_ITEMS.filter((i) => !i.canOverride).every((i) => i.overrideRule === null));
ok("validateCharter rejects canOverride=true with no overrideRule", (() => {
  const bad: CharterItem[] = [{ ...CHARTER_ITEMS[0], id: "X_BAD_3", canOverride: true, overrideRule: null }];
  try { validateCharter(bad); return false; } catch { return true; }
})());
ok("validateCharter rejects canOverride=false with a non-null overrideRule", (() => {
  const bad: CharterItem[] = [{ ...CHARTER_ITEMS[0], id: "X_BAD_4", canOverride: false, overrideRule: "should not be here" }];
  try { validateCharter(bad); return false; } catch { return true; }
})());

console.log("domain queries work");
ok("getCharterByDomain('label') includes PROTECT_LABEL_RELEASES and LABEL_ARTIST_INVESTMENT_SIGNALS", (() => {
  const ids = getCharterByDomain("label").map((i) => i.id);
  return ids.includes("PROTECT_LABEL_RELEASES") && ids.includes("LABEL_ARTIST_INVESTMENT_SIGNALS");
})());
ok("getCharterByDomain('victor') includes NO_HARD_WIP_CAP_FOR_VICTOR only among the 13 approved", getCharterByDomain("victor").filter((i) => APPROVED_13.includes(i.id)).map((i) => i.id).join() === "NO_HARD_WIP_CAP_FOR_VICTOR");
ok("an unknown domain-adjacent id returns null from getCharterRule", getCharterRule("DOES_NOT_EXIST") === null);

console.log("isOwnerApproved / getOwnerRules / getOwnerGoals partition correctly");
ok("isOwnerApproved is true for every one of the 13 approved ids", APPROVED_13.every((id) => isOwnerApproved(id)));
ok("isOwnerApproved is false for every one of the 7 working-principle ids", WORKING_7.every((id) => !isOwnerApproved(id)));
ok("isOwnerApproved is false for an unknown id", !isOwnerApproved("DOES_NOT_EXIST"));
check("getOwnerRules() + getOwnerGoals() together equal exactly the 13 approved ids", [...getOwnerRules(), ...getOwnerGoals()].map((i) => i.id).sort(), [...APPROVED_13].sort());
check("REVENUE_GROWTH_PRIMARY and MORE_RELEASES_AND_SHOWS are OWNER_GOAL, not OWNER_RULE", getOwnerGoals().map((i) => i.id).sort(), ["MORE_RELEASES_AND_SHOWS", "REVENUE_GROWTH_PRIMARY"]);

console.log("semantic tests (protect meaning, not just counts)");
ok("PROTECT_LABEL_RELEASES can never read as a WORKING_PRINCIPLE", getCharterRule("PROTECT_LABEL_RELEASES")!.status === "OWNER_RULE");
ok("QUALITY_BEFORE_SPEED stays approved (OWNER_RULE + OWNER_CONFIRMED)", (() => {
  const r = getCharterRule("QUALITY_BEFORE_SPEED")!;
  return r.status === "OWNER_RULE" && r.source.type === "OWNER_CONFIRMED";
})());
ok("NO_HARD_WIP_CAP_FOR_VICTOR: the engine has no hard WIP cap/stop-rule for Victor today (only a managerial watch threshold)", (() => {
  const tier = COO_CONFIG.tiers.VICTOR_WORKLOAD as TierRule;
  // a real stop-rule would escalate/cap toward blocking tiers off count alone; today it's a flat P2 managerial notice
  return tier.base === "P2" && !tier.escalate && !tier.capByStatus;
})());
ok("STALE_IS_NOT_AUTOMATICALLY_URGENT: stale-deadline signals are P3-only in the engine (age alone never reaches P0/P1)", (() => {
  const stale: TierRule[] = [COO_CONFIG.tiers.STALE_PROJECT_DEADLINE, COO_CONFIG.tiers.STALE_INTERNAL_DEADLINE];
  return stale.every((t) => t.base === "P3" && !t.escalate);
})());
ok("INVESTIGATE_BEFORE_CONCLUDING keeps 'Hypothesis before conclusion' in its own text and stays OWNER_RULE", (() => {
  const r = getCharterRule("INVESTIGATE_BEFORE_CONCLUDING")!;
  return r.status === "OWNER_RULE" && r.principle.includes("Hypothesis");
})());
ok("GENTLE_CHALLENGE_BY_DEFAULT explicitly says the Partner does not block the owner, and its override still only raises to a recommendation", (() => {
  const r = getCharterRule("GENTLE_CHALLENGE_BY_DEFAULT")!;
  return r.principle.includes("לא חוסם") && r.overrideRule !== null && r.overrideRule.includes("המלצה");
})());

console.log("engine constraints (static checks)");
ok("no LLM / AI provider anywhere in lib/partner (Charter files only — eyes/ has its own static checks in test-partner-eyes.ts)", (() => {
  const fs = require("node:fs"); const path = require("node:path");
  const dir = path.join(__dirname, "..", "lib", "partner");
  const files = fs.readdirSync(dir).filter((f: string) => fs.statSync(path.join(dir, f)).isFile());
  return files.every((f: string) => !/openai|anthropic|groq|gpt-|claude-/i.test(fs.readFileSync(path.join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")));
})());
ok("no external HTTP / DB write verb / Supabase import anywhere in lib/partner Charter files", (() => {
  const fs = require("node:fs"); const path = require("node:path");
  const dir = path.join(__dirname, "..", "lib", "partner");
  const files = fs.readdirSync(dir).filter((f: string) => fs.statSync(path.join(dir, f)).isFile());
  return files.every((f: string) => {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    return !/\bfetch\(|axios|XMLHttpRequest|\.(insert|update|upsert|delete|rpc)\(|lib\/supabase|-store"/.test(src);
  });
})());
ok("lib/coo does not import lib/partner (Phase 1a stays untouched by this block)", (() => {
  const fs = require("node:fs"); const path = require("node:path");
  const dir = path.join(__dirname, "..", "lib", "coo");
  return fs.readdirSync(dir).every((f: string) => !/lib\/partner/.test(fs.readFileSync(path.join(dir, f), "utf8")));
})());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
