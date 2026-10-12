/**
 * Sunny stage 2 (Owner-approved 2026-10-12) — BUSINESS_MOTION drafts + "ביומן ולא ב-Redbloods".
 *
 * Every move carries a DRAFT the server can plan from without inventing anything: args = only values read in the
 * records, missing = material parameters asked ONE at a time, context = evidence that is never a value (a planned expense
 * is a budget, not the agreed price of a new work; "all earlier works were at X" is an inference). The week names
 * work-like calendar events that have no Redbloods record. Pure, in-memory fixtures (the SAME motion-company fixture the
 * motion contract is proven on), the real action contracts. Nothing executes; no plan is created.
 *
 * Cases: יהלום (stage vs deadline → open a mix), צועדים (overdue + the learning: no deadline move kept),
 * לא מאמינה / ויקטור (notes text missing — never invented), דאנסהול (Owner one action), the 12.10 Itamar session.
 * Run with:   npx tsx scripts/test-sunny-motion-drafts.tsx
 */
import fs from "node:fs";
import path from "node:path";
import type { GatewaySources } from "../lib/partner/gateway/core";
import { buildCooView } from "../lib/partner/coo/priorities";
import { applyMotionLearning, motionAnswerHe, motionSummary, type BusinessMotion, type MotionItem } from "../lib/partner/coo/motion";
import { deriveWithActionHistory } from "../lib/partner/sunny/with-history";
import { ACTION_REGISTRY } from "../lib/partner/act/registry";
import { src, TODAY, D, U, K, P_YAHALOM, P_TZOADIM, P_LO, P_DH, calEvent, calWindow, type Fx } from "./fixtures/motion-company";
import type { OutcomeAssessment } from "../lib/partner/sunny/learning";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 700)}` : ""}`); } };
const section = (t: string) => console.log(`\n${t}`);
const ROOT = path.resolve(__dirname, "..");
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const motionOf = (s: GatewaySources): BusinessMotion => buildCooView(s).motion;
const itemFor = (m: BusinessMotion, entity: string): MotionItem | undefined => m.all.find((i) => i.entity === entity) ?? m.all.find((i) => i.entities.includes(entity) && i.entity?.startsWith("project:"));

/** The fixture + a planned (expected) mix expense of $210 on יהלום — the 29.09 production shape. */
function withPlannedMix(fx: Fx = {}): GatewaySources {
  type F = { raw: { transactions: unknown[] } & Record<string, unknown>; state: { openExpenses?: { items?: unknown[] } & Record<string, unknown> } & Record<string, unknown> } & Record<string, unknown>;
  const f = (src(fx) as unknown as { finance: { value: F } }).finance.value;
  const planned = { id: "pm-yahalom", projectId: P_YAHALOM, type: "expense", date: D(-4), amount: 210, currency: "$", status: "צפוי", category: "מיקס", scope: "מיקס", description: "מיקס יהלום", businessUnit: "STUDIO", artist: null, showId: null };
  const open = { id: "TX:pm-yahalom", source: "TRANSACTION", amount: 210, currency: "$", dueDate: D(-4), projectId: P_YAHALOM };
  return src({ ...fx, finance: { ...f, raw: { ...f.raw, transactions: [...f.raw.transactions, planned] }, state: { ...f.state, openExpenses: { ...(f.state.openExpenses ?? {}), items: [...(f.state.openExpenses?.items ?? []), open] } } } });
}

async function main() {
  const M = motionOf(withPlannedMix());
  const drafted = M.all.filter((i) => i.move?.draft);

  section("1. Every draft is plannable: a registered action, only declared args, every required arg filled or asked");
  ok("1a. there are drafts on the moves", drafted.length >= 3, drafted.map((i) => i.key));
  const bad = drafted.flatMap((i) => {
    const d = i.move!.draft!;
    const c = ACTION_REGISTRY.get(d.actionId);
    if (!c) return [`${i.key}: ${d.actionId} not registered`];
    const declared = new Set(c.args.map((a) => a.name));
    const errs = Object.keys(d.args).filter((k) => !declared.has(k)).map((k) => `${i.key}: undeclared arg ${k}`);
    const covered = new Set([...Object.keys(d.args), ...d.missing.map((x) => x.arg)]);
    const req = c.args.filter((a) => a.required && !covered.has(a.name) && !(d.actionId === "SEND_VICTOR_VERSION_NOTES" && a.name === "versionKey")).map((a) => `${i.key}: required ${a.name} neither filled nor asked`);
    return [...errs, ...req, ...(i.move!.actionIds.includes(d.actionId) ? [] : [`${i.key}: draft action not in the move`])];
  });
  ok("1b. no undeclared arg, no silently-missing required arg, the draft action is one of the move's actions", bad.length === 0, bad);
  ok("1c. every arg value is an entity key read from the records or a status the evidence proves — never a guessed date / time / amount", drafted.every((i) => Object.entries(i.move!.draft!.args).every(([k, v]) => /^(project|victor-work|mix-work):/.test(v) || (k === "title" && v.length > 0) || (k === "status" && v === "הושלם"))));
  ok("1d. drafts are DERIVED, and a financial move carries none (money is FINANCIAL_FORWARD's)", drafted.every((i) => i.move!.draft!.epistemic === "DERIVED") && M.all.filter((i) => i.financial).every((i) => !i.move?.draft));

  section("2. יהלום — stage vs deadline → open a mix; the planned expense is a budget, never the price");
  const y = itemFor(M, K(P_YAHALOM))!;
  const yd = y?.move?.draft;
  ok("2a. the draft is CREATE_ENGINEER_WORK on יהלום's exact key", yd?.actionId === "CREATE_ENGINEER_WORK" && yd.args.project === K(P_YAHALOM), yd);
  ok("2b. the engineer is ASKED first — never chosen (all earlier works at Steven = context, an inference)", yd?.missing[0]?.arg === "engineerName" && !("engineerName" in (yd?.args ?? {})) && yd!.contextHe.some((x) => x.includes("Steven") && x.includes("הסקה")));
  ok("2c. the planned $210 is context ('a budget, not the agreed price') and never an agreedPrice arg", !("agreedPrice" in (yd?.args ?? {})) && yd!.contextHe.some((x) => x.includes("210") && x.includes("תקציב, לא מחיר מוסכם")) && yd!.missing.some((x) => x.arg === "agreedPrice"));
  ok("2d. the work type is asked, never assumed", yd!.missing.some((x) => x.arg === "workType") && !("workType" in yd!.args));
  const noPlanned = itemFor(motionOf(src()), K(P_YAHALOM))!.move!.draft!;
  ok("2e. without a planned expense there is no budget line (nothing invented)", !noPlanned.contextHe.some((x) => x.includes("תקציב")));

  section("3. צועדים — overdue; after the learning the draft keeps the concrete step, never a deadline move");
  const t = itemFor(M, K(P_TZOADIM))!;
  ok("3a. צועדים carries a CREATE_ENGINEER_WORK draft (the step that makes a date achievable)", t?.move?.draft?.actionId === "CREATE_ENGINEER_WORK", t?.move);
  const tried: OutcomeAssessment[] = [{ planId: "pl_" + "t".repeat(18), entity: K(P_TZOADIM), at: `${D(-4)}T07:39:00Z`, meaning: "PLANNING", level: "DID_NOT_RESOLVE" } as unknown as OutcomeAssessment];
  const learned = applyMotionLearning(M, tried);
  const tl = itemFor(learned, K(P_TZOADIM))!;
  ok("3b. the learning removes the deadline move and KEEPS the mix draft", !tl.move!.actionIds.includes("UPDATE_PROJECT_DEADLINE") && tl.move!.draft?.actionId === "CREATE_ENGINEER_WORK" && !!tl.learning?.changed, tl.move);
  ok("3c. no draft ever proposes UPDATE_PROJECT_DEADLINE (a date is the Boss's, never a draft value)", M.all.every((i) => i.move?.draft?.actionId !== "UPDATE_PROJECT_DEADLINE"));

  section("4. לא מאמינה / ויקטור — the notes are his; asked, never invented");
  const lo = itemFor(M, K(P_LO))!;
  const ld = lo?.move?.draft;
  ok("4a. the release move drafts SEND_VICTOR_VERSION_NOTES on the exact Victor work", ld?.actionId === "SEND_VICTOR_VERSION_NOTES" && ld.args.victorWork === `victor-work:${U(50)}`, ld);
  ok("4b. the notes are the missing parameter — and the question offers 'handled outside the system?' (no record ≠ not done)", ld?.missing[0]?.arg === "notes" && ld.missing[0].questionHe.includes("מחוץ למערכת"));
  ok("4c. the version key is taken from action_targets (said), never guessed", ld!.contextHe.some((x) => x.includes("action_targets")) && !("versionKey" in ld!.args));

  section("5. דאנסהול — the Owner's one action on a mix version");
  const dh = itemFor(M, K(P_DH))!;
  ok("5a. SEND_MIX_NOTES on the exact mix work; the decision (notes or approve) is asked", dh?.move?.draft?.actionId === "SEND_MIX_NOTES" && /^mix-work:/.test(dh.move.draft.args.mixWork) && dh.move.draft.missing[0]?.arg === "decision", dh?.move);

  section("6. The greeting's lead line = the move itself (no 'shall I prepare?')");
  const lead = M.answerHe.split("\n").pop() ?? "";
  const first = M.greeting[0];
  ok("6a. the lead names the first move and, when something is missing, asks exactly its first question", lead.startsWith(`אני הייתי מתחילה ב${first.titleHe}`) && (!first.move?.draft?.missing.length || lead.endsWith(first.move.draft.missing[0].questionHe)), lead);
  ok("6b. never 'אם תאשר, אכין' when a draft exists", !!first.move?.draft && !lead.includes("אם תאשר, אכין"), lead);
  ok("6c. the confirmed fact is said as 'לפי הרשומות', the context as context", !first.move?.draft?.confirmedHe.length || lead.includes("לפי הרשומות:"));

  section("7. The 12.10 case — a session in the calendar with no Redbloods record");
  const itamar = calEvent("itamar", "סשן – איתמר אשטה", `${TODAY}T15:00:00Z`, `${TODAY}T18:00:00Z`);
  const W = motionOf(src({ calendar: { status: "OK", value: calWindow([itamar]) } }));
  ok("7a. the week names it ('ביומן ולא ב-Redbloods') with today + the Israel time", W.week.untracked.length === 1 && W.week.untracked[0].title === "סשן – איתמר אשטה" && W.week.untracked[0].start === "18:00" && W.week.untracked[0].end === "21:00" && W.week.untrackedHe!.includes("היום"), W.week.untracked);
  ok("7b. it is in the greeting answer, right after the week line, as a question (never recorded)", W.answerHe.includes("ביומן ולא ב-Redbloods: סשן – איתמר אשטה") && W.week.untrackedHe!.endsWith("לרשום?"));
  ok("7c. a Redbloods session (canonical event) is never listed as untracked", !M.week.untracked.some((u) => u.quality === "CANONICAL_RELATION"));
  const unread = motionOf(src({ calendar: { status: "OK", value: { ...calWindow([itamar]), status: "CALENDAR_NEEDS_REAUTH", events: [] } } }));
  ok("7d. an unreadable calendar lists nothing and claims nothing (unknown, never 'no untracked sessions')", unread.week.untracked.length === 0 && unread.week.untrackedHe === null && unread.week.capacity === "UNKNOWN");
  const personal = motionOf(src({ calendar: { status: "OK", value: calWindow([calEvent("p", "ארוחת ערב עם המשפחה", `${TODAY}T17:00:00Z`, `${TODAY}T19:00:00Z`)]) } }));
  ok("7e. a personal event is never called work", personal.week.untracked.length === 0);

  section("8. The SAME object everywhere: partner_brief / coo / the connector's history derivation");
  const slim = motionSummary(M) as unknown as { greeting: Array<{ move: { draft?: unknown } | null }>; week: { untracked: unknown[] }; answerHe: string };
  ok("8a. motionSummary (partner_brief / coo) carries the drafts and the untracked list", slim.greeting.some((g) => !!g.move?.draft) && Array.isArray(slim.week.untracked));
  const W2 = motionSummary(W);
  const re = deriveWithActionHistory("motion", { motion: W2 } as never, [], Date.parse(`${TODAY}T18:00:00Z`)) as unknown as { motion: { answerHe: string } };
  ok("8b. the connector's re-derived answer keeps the untracked line and the drafted lead", re.motion.answerHe.includes("ביומן ולא ב-Redbloods") && re.motion.answerHe === motionAnswerHe(re.motion as never));

  section("9. Boundaries");
  const src9 = code(fs.readFileSync(path.join(ROOT, "lib/partner/coo/motion.ts"), "utf8"));
  ok("9a. motion still never writes / plans / pushes (no plan call, no write verbs)", !/partner_plan_action\(|planAction\(|\.(insert|upsert|rpc)\(|sendPush|createEvent|fetch\(/.test(src9));
  ok("9b. the draft builder reads no price as a value (agreedPrice is only ever a missing question)", !/agreedPrice:\s*[^"']/.test(src9.slice(src9.indexOf("function draftFor"), src9.indexOf("function lastShowOf"))));

  const { SERVER_INSTRUCTIONS: I } = await import("../lib/integrations/partner-mcp/mcp");
  ok("9c. the connector tells Sunny to plan only from draft.args + his answers, ask missing[0], context is never a value, and to say untrackedHe as a question", I.includes("plan ONLY from draft.args + what he answers to draft.missing") && I.includes("contextHe is evidence and NEVER a value") && I.includes("motion.week.untrackedHe"));
  ok("9d. AGENTS.md carries the stage-2 contract", fs.readFileSync(path.join(ROOT, "AGENTS.md"), "utf8").includes("Stage 2 drafts (Owner-approved 2026-10-12)"));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
