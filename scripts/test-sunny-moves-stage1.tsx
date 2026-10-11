/**
 * Sunny — MOVES, NOT REPORTS (Owner-approved 2026-10-11, stage 1: instructions only).
 *
 * Pins the connector instructions that turn a reported problem into ONE concrete move, AND the existing mechanisms those
 * instructions rely on — so an instruction can never promise something the code does not do:
 *   • no automatic preview in a greeting; a plan only on real intent + verified parameters, never an extra "prepare?" round;
 *   • one focused question for a missing material parameter; a planned expense is never the agreed price of a new work;
 *   • a moved deadline comes with the step that makes the new date achievable (proposal only);
 *   • dated commitments use the kinds whose review IS the date (VENDOR_COMMITMENT due, FOLLOW_UP_EXPECTATION when);
 *     PROJECT_BLOCKER keeps its fixed 14-day review (said honestly);
 *   • no record ≠ not done: the existing "טופל מחוץ למערכת?" question / "שולם?" instead of a conclusion;
 *   • fact / inference / missing kept apart.
 * Nothing else moved: the approval mechanism, the core preamble and the "one plan, none in advance" rule are unchanged.
 * Run with:   npx tsx scripts/test-sunny-moves-stage1.tsx
 */
import fs from "node:fs";
import path from "node:path";
import { SERVER_INSTRUCTIONS } from "../lib/integrations/partner-mcp/mcp";
import { KNOWLEDGE_KINDS } from "../lib/partner/owner-knowledge/kinds";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 400)}` : ""}`); } };
const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const I = SERVER_INSTRUCTIONS;
const S = I.slice(I.indexOf("MOVES, NOT REPORTS"), I.indexOf("COO (2026-10-02)"));

console.log("\n1. The stage-1 section exists, in the right place");
ok("1a. a MOVES, NOT REPORTS section sits before the COO section", I.indexOf("MOVES, NOT REPORTS") > 0 && I.indexOf("MOVES, NOT REPORTS") < I.indexOf("COO (2026-10-02)") && S.length > 500);
ok("1b. the SUNNY CORE preamble (first 1,200 chars) is untouched by stage 1", !I.slice(0, 1200).includes("MOVES, NOT REPORTS") && I.startsWith("SUNNY CORE — you ARE Sunny"));

console.log("\n2. From a report to a move");
ok("2a. every raised problem becomes ONE concrete move: record key + registered action + verified values + what is missing", S.includes("ONE concrete move") && S.includes("entity key") && S.includes("registered action") && S.includes("VERIFIED in the records") && S.includes("still missing"));
ok("2b. no automatic preview in a greeting / overview", S.includes("Do NOT open a preview automatically in a greeting or an overview"));
ok("2c. real intent + every material parameter verified → plan right away, never an extra 'prepare?' round", S.includes("real intent") && S.includes("every material parameter is verified") && S.includes("call partner_plan_action right away") && S.includes("never an extra"));
ok("2d. a missing / unverified material parameter → ONE focused question, never an invented value", S.includes("ONE focused question for exactly that") && S.includes("Never invent a value"));
ok("2e. a planned expense amount is a budget, NOT the agreed price of a new work", S.includes("an expected (planned) expense amount is evidence of a budget, NOT the agreed price of a new work"));
ok("2f. an unread engineer / date / time / amount is unknown; a free slot is a candidate, never a booking", S.includes("is unknown") && S.includes("a free calendar slot is a candidate, never a booking"));

console.log("\n3. Deadlines");
ok("3a. a moved / at-risk deadline comes with the step that makes the NEW date achievable — as a proposal", S.includes("make the NEW date achievable") && S.includes("as a proposal"));
ok("3b. that extra step is never planned / executed without his approval", S.includes("never plan or execute that extra step without his approval"));
ok("3c. a date already moved without the work moving → say it, do not move it again (motion learning)", S.includes("already moved and the work did not move") && S.includes("instead of moving it again"));

console.log("\n4. Dates in memory — only what the existing mechanism does");
const kind = (k: string) => KNOWLEDGE_KINDS.find((x) => x.kind === k)!;
ok("4a. VENDOR_COMMITMENT: its review follows the due date (the instruction is true)", kind("VENDOR_COMMITMENT").reviewAt({ commitment: "DELIVER_WORK", due: "2026-10-20" }, "2026-10-11") === "2026-10-21");
ok("4b. FOLLOW_UP_EXPECTATION: its review IS the 'when' date", kind("FOLLOW_UP_EXPECTATION").reviewAt({ who: "COUNTERPART_WILL_CONTACT", when: "2026-10-20" }, "2026-10-11") === "2026-10-20");
ok("4c. PROJECT_BLOCKER: a fixed 14-day review (no date field) — and the instruction says so honestly", kind("PROJECT_BLOCKER").reviewAt({ reason: "WAITING_FOR_OWNER", detail: "עד 04.10" }, "2026-10-11") === "2026-10-25" && S.includes("PROJECT_BLOCKER has a fixed 14-day review"));
ok("4d. the instruction names exactly those kinds + fields", S.includes("VENDOR_COMMITMENT due") && S.includes("FOLLOW_UP_EXPECTATION when"));
ok("4e. a passed date / a closed project → not current: what was said + when, the records now, only 'זה עדיין נכון?'", S.includes("whose date has passed, or whose project is closed in the records, is NOT current") && S.includes("זה עדיין נכון?"));

console.log("\n5. No record ≠ not done");
ok("5a. the existing Victor question is used (partner_answer_question + questionRef), never a conclusion", S.includes("NO RECORD ≠ NOT DONE") && S.includes("טופל מחוץ למערכת?") && S.includes("partner_answer_question with its questionRef") && S.includes("ask, never conclude"));
ok("5b. the Victor question really exists in the answer bridge (case answer WAS_DELIVERY_REVIEWED_OUTSIDE_SYSTEM)", read("lib/partner/investigation/case-answer.ts").includes("WAS_DELIVERY_REVIEWED_OUTSIDE_SYSTEM"));
ok("5c. a passed payment date → 'שולם?' (a question, never 'unpaid')", S.includes("a passed payment date → \"שולם?\""));
ok("5d. fact / inference / missing kept apart in every move", S.includes("FACT (\"לפי הרשומות\")") && S.includes("INFERENCE (\"אני מבינה\"") && S.includes("MISSING (\"אני לא רואה\")"));

console.log("\n6. Nothing else moved");
ok("6a. one logical request = one plan, none prepared in advance — still there", I.includes("do not prepare several plans in advance"));
ok("6b. the approval rule is unchanged: approve only after his explicit approval of THIS preview; 'מאשר' is enough", I.includes("ONLY after the Boss explicitly approves THIS preview") && I.includes("\"מאשר\" / \"כן, מאשר\" / \"מאושר\" is enough"));
ok("6c. stage 1 touched no approval / motion / memory / finance module (instructions only)", !/MOVES, NOT REPORTS/.test(read("lib/partner/act/approval.ts") + read("lib/partner/coo/motion.ts") + read("lib/partner/sunny/known-context.ts") + read("lib/partner/coo/financial-forward.ts")));
ok("6d. no future promises rule kept (no background follow-up)", I.includes("NO FUTURE PROMISES"));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
