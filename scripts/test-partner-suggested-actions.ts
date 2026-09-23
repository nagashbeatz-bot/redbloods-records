/**
 * Golden tests — Partner chain interpretation + Suggested Actions (Phase F.1F).
 *
 * Run with:   npx tsx scripts/test-partner-suggested-actions.ts
 *
 * Pure: no Supabase, no network, no AI, no persistence, no execution.
 * Fixtures = the real production chain for "קרוב אלייך":
 *   Case project_deadline_passed:10d23186-… (deadline 2026-07-14, status במיקס, fingerprint cc7d8bca34c49059)
 *   Context A fe35603a-… WHY_DEADLINE_STILL_ACTIVE → DEADLINE_NOT_UPDATED (v1)
 *   Context B de27b6d2-… WHAT_IS_NEW_PROJECT_DEADLINE → IN_TWO_WEEKS → 2026-10-07 (v2, trigger A)
 */
import fs from "node:fs";
import path from "node:path";
import { CASE_SCHEMA_VERSION, type PartnerCase } from "../lib/partner/cases/types";
import { fingerprintCaseFacts } from "../lib/partner/feedback";
import { deriveCaseDecisionState, interpretCase, decideInvestigation } from "../lib/partner/investigation";
import type { PersistedOwnerContext } from "../lib/partner/investigation/context-row";
import { deriveSuggestedActions, revalidateSuggestedAction, type PartnerSuggestedAction } from "../lib/partner/actions";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}
const ok = (name: string, cond: boolean) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}`); fail++; } };

const PID = "10d23186-a5ab-4eed-a9a4-eeda221a34d5";
const CASE_ID = `project_deadline_passed:${PID}`;
const A_ID = "fe35603a-79e6-45eb-92df-2567933e220f";
const B_ID = "de27b6d2-f35e-47c0-99e6-359db9d3d13c";
const FP = "cc7d8bca34c49059";

function caseWith(deadline = "2026-07-14", status = "במיקס"): PartnerCase {
  return {
    id: CASE_ID, schemaVersion: CASE_SCHEMA_VERSION, caseType: "PROJECT_DEADLINE_PASSED", subjectType: "project", subjectId: PID,
    classification: "RISK", status: "OPEN", createdFrom: "STATE",
    facts: [{ domain: "projects", entityId: PID, field: "deadline", value: deadline, label: "deadline" }, { domain: "projects", entityId: PID, field: "status", value: status, label: "status" }],
    derivedFacts: [{ id: "days_late", label: "ימים באיחור", value: 71, basis: "x" }, { id: "days_since_update", label: "x", value: 1, basis: "x" }, { id: "activity_after_deadline", label: "x", value: true, basis: "x" }],
    hypotheses: [], ownerRulesApplied: [], workingPrinciplesApplied: [], unknowns: [], dataQuality: { notes: [] },
    interventionStyle: "GENTLE", summaryHe: "", changeContext: null,
  };
}
const C = caseWith();
const A: PersistedOwnerContext = {
  id: A_ID, schemaVersion: "partner-owner-context-schema-v1", questionId: `${CASE_ID}::WHY_DEADLINE_STILL_ACTIVE`, questionType: "WHY_DEADLINE_STILL_ACTIVE",
  caseId: CASE_ID, caseType: "PROJECT_DEADLINE_PASSED", subjectType: "project", subjectId: PID, answerCode: "DEADLINE_NOT_UPDATED",
  answerValue: null, triggerContextId: null, questionTextHe: "הדדליין של הפרויקט עבר, אבל הפרויקט עדיין פעיל והייתה עליו פעילות לאחרונה. למה הדדליין הישן עדיין מוגדר?",
  caseFactsFingerprint: FP, note: "לא הספקתי לעדכן את הדדליין בזמן, והפרויקט המשיך להתקדם בלי שעידכנתי תאריך חדש.",
  answeredAt: "2026-09-23T09:10:08.684Z", scope: "CASE_INSTANCE", provenance: { source: "owner_manual" }, caseSchemaVersion: CASE_SCHEMA_VERSION, supersedesId: null,
};
const B: PersistedOwnerContext = {
  id: B_ID, schemaVersion: "partner-owner-context-schema-v2", questionId: `${CASE_ID}::WHAT_IS_NEW_PROJECT_DEADLINE`, questionType: "WHAT_IS_NEW_PROJECT_DEADLINE",
  caseId: CASE_ID, caseType: "PROJECT_DEADLINE_PASSED", subjectType: "project", subjectId: PID, answerCode: "IN_TWO_WEEKS",
  answerValue: { kind: "DATE", ymd: "2026-10-07", resolution: { method: "RELATIVE", rule: "PLUS_14_DAYS", anchorYmd: "2026-09-23", timeZone: "Asia/Jerusalem" } },
  triggerContextId: A_ID, questionTextHe: "הדדליין השמור (14.07.2026) כבר לא משקף את התכנון. מה הדדליין החדש לפרויקט?",
  caseFactsFingerprint: FP, note: null, answeredAt: "2026-09-23T09:50:47.036Z", scope: "CASE_INSTANCE", provenance: { source: "owner_manual" },
  caseSchemaVersion: CASE_SCHEMA_VERSION, supersedesId: null,
};
const LABEL = "קרוב אלייך";
const derive = (c: PartnerCase, hist: PersistedOwnerContext[]) => deriveSuggestedActions({ case: c, decisionState: deriveCaseDecisionState(c, hist), subjectLabelHe: LABEL });

console.log("Chain interpretation");
{
  ok("fixture: the Case fingerprint is the real production one", fingerprintCaseFacts(C) === FP);
  const onlyA = deriveCaseDecisionState(C, [A]);
  check("1. A alone → NEW_PROJECT_DEADLINE remains UNKNOWN (raised by A)", onlyA.unknownsRemaining.map((u) => [u.code, "contextId" in u.raisedBy ? u.raisedBy.contextId : null]), [["NEW_PROJECT_DEADLINE", A_ID]]);
  check("   readiness AWAITING_FOLLOW_UP + the follow-up is open", [onlyA.readiness, onlyA.openQuestionIds], ["AWAITING_FOLLOW_UP", [`${CASE_ID}::WHAT_IS_NEW_PROJECT_DEADLINE`]]);
  const ab = deriveCaseDecisionState(C, [A, B]);
  check("2. A + B → the unknown is RESOLVED (raised by A, resolved by B)", ab.unknownsResolved.map((u) => [u.code, u.raisedBy.contextId, u.resolvedBy.contextId]), [["NEW_PROJECT_DEADLINE", A_ID, B_ID]]);
  check("6. …and it is no longer a current unknown; decision complete", [ab.unknownsRemaining, ab.readiness], [[], "DECISION_COMPLETE"]);
  check("3. persisted FACT stays 2026-07-14", ab.facts.find((f) => f.field === "deadline")?.value, "2026-07-14");
  const sv = ab.selectedBusinessValues[0];
  check("4. INTENDED deadline = 2026-10-07 as an OWNER_DECISION (not a fact), next to the persisted fact", [sv.code, sv.epistemicStatus, sv.value.ymd, sv.persistedFact], ["INTENDED_PROJECT_DEADLINE", "OWNER_DECISION", "2026-10-07", { field: "deadline", value: "2026-07-14" }]);
  check("5. source traceability (Case, questions A→B, contexts A→B)", sv.source, { caseId: CASE_ID, questionIds: [A.questionId, B.questionId], contextIds: [A_ID, B_ID] });
  check("derived statements carry their sources", ab.derived.map((d) => [d.statementHe, d.source.contextIds]), [["הדדליין השמור אינו משקף את התכנון הנוכחי (לפי הבעלים).", [A_ID]], ["נקבע דדליין חדש לפרויקט (לפי הבעלים).", [A_ID, B_ID]]]);
  check("hypothesis stays HYPOTHESIS", ab.hypotheses.map((h) => h.epistemicStatus), ["HYPOTHESIS"]);
  const before = JSON.stringify(C);
  deriveCaseDecisionState(C, [A, B]);
  ok("7. no facts rewritten (Case object byte-identical)", JSON.stringify(C) === before);
  check("per-question interpretCase() is unchanged (A alone still lists its own unknown)", interpretCase(C, decideInvestigation(C).question, [A, B]).unknownsRemaining, ["מהו הדדליין הנכון כעת — לא ידוע."]);
  check("no answer at all → INVESTIGATION_OPEN", deriveCaseDecisionState(C, []).readiness, "INVESTIGATION_OPEN");
  const notKnown: PersistedOwnerContext = { ...B, id: "11111111-1111-4111-8111-111111111111", answerCode: "NOT_KNOWN_YET", answerValue: null };
  const nk = deriveCaseDecisionState(C, [A, notKnown]);
  check("NOT_KNOWN_YET → answered but the unknown remains", [nk.readiness, nk.unknownsRemaining.map((u) => u.code), nk.selectedBusinessValues.length], ["ANSWERED_UNKNOWNS_REMAIN", ["NEW_PROJECT_DEADLINE", "NEW_PROJECT_DEADLINE"], 0]);
}

console.log("Suggested Actions");
let real: PartnerSuggestedAction;
{
  const r0 = derive(C, [A]);
  check("8. A alone → no UPDATE_PROJECT_DEADLINE; explicit reason", [r0.actions.length, r0.skipped.map((s) => s.reason)], [0, ["DECISION_INCOMPLETE"]]);
  const r = derive(C, [A, B]);
  check("9. A + applicable B → exactly one action", r.actions.map((a) => [a.actionType, a.status]), [["UPDATE_PROJECT_DEADLINE", "PROPOSED"]]);
  real = r.actions[0];
  check("10/11. change 2026-07-14 → 2026-10-07 on project 10d23186…", real.proposedChange, { entity: "project", entityId: PID, field: "deadline", from: "2026-07-14", to: "2026-10-07" });
  check("12. requiresOwnerApproval", real.requiresOwnerApproval, true);
  check("deterministic id", real.id, `UPDATE_PROJECT_DEADLINE:${PID}:${B_ID}:2026-10-07`);
  check("13. same input → same action (byte-identical)", JSON.stringify(derive(C, [A, B])), JSON.stringify(r));
  const noteChanged = derive(C, [{ ...A, note: "IN_ONE_WEEK 2027-01-01 בעצם לא, תבטל" }, { ...B, note: "SPECIFIC_DATE 2026-12-31" }]);
  check("14. note changes do not change the action", JSON.stringify(noteChanged.actions), JSON.stringify(r.actions));
  const src = ["../lib/partner/actions/suggested.ts", "../lib/partner/actions/types.ts", "../lib/partner/investigation/decision-state.ts"].map((f) => fs.readFileSync(path.resolve(__dirname, f), "utf8")).join("\n");
  ok("15. note is never read by decision state / actions", !/\.note\b/.test(src));
  check("21. source traceability complete", [real.sourceCaseId, real.sourceQuestionIds, real.sourceContextIds, real.caseFactsFingerprint], [CASE_ID, [A.questionId, B.questionId], [A_ID, B_ID], FP]);
  check("20. structured evidence (fact, both contexts, resolved value)", real.evidence.map((e) => e.kind === "CASE_FACT" ? `FACT deadline=${e.value}` : e.kind === "OWNER_CONTEXT" ? `CTX ${e.answerCode}` : `VALUE ${e.value.ymd}`), ["FACT deadline=2026-07-14", "CTX DEADLINE_NOT_UPDATED", "CTX IN_TWO_WEEKS", "VALUE 2026-10-07"]);
  check("22. explanation built from structured values", real.explanationHe, "לעדכן את הדדליין של 'קרוב אלייך' מ-14.07.2026 ל-07.10.2026.\n\nהסיבה: ציינת שהדדליין הישן לא עודכן, ולאחר מכן בחרת יעד חדש של עוד שבועיים.");
  check("all preconditions satisfied, not stale", [real.preconditions.every((p) => p.satisfied), real.staleness], [true, { stale: false, reasons: [] }]);
  ok("no APPROVED / EXECUTED state in the model", !/"APPROVED"|"EXECUTED"/.test(fs.readFileSync(path.resolve(__dirname, "../lib/partner/actions/types.ts"), "utf8")));
}

console.log("Eligibility + staleness");
{
  // 16. B no longer applicable (A revised to DEADLINE_NO_LONGER_RELEVANT).
  const A2: PersistedOwnerContext = { ...A, id: "22222222-2222-4222-8222-222222222222", schemaVersion: "partner-owner-context-schema-v2", answerCode: "DEADLINE_NO_LONGER_RELEVANT", supersedesId: A_ID, answeredAt: "2026-09-24T08:00:00.000Z" };
  const r16 = derive(C, [A, B, A2]);
  check("16. B not applicable → no action derived from historical B", r16.actions.length, 0);
  check("16. an earlier proposal becomes STALE (value/trigger context no longer applicable)", revalidateSuggestedAction(real, { case: C, caseContextHistory: [A, B, A2] }).staleness, { stale: true, reasons: ["TRIGGER_CONTEXT_APPLICABLE", "VALUE_CONTEXT_APPLICABLE"] });
  // Note-only revision of A keeps the chain → the action stays PROPOSED with the SAME id.
  const A3: PersistedOwnerContext = { ...A, id: "33333333-3333-4333-8333-333333333333", schemaVersion: "partner-owner-context-schema-v2", note: "עוד הקשר", supersedesId: A_ID, answeredAt: "2026-09-24T08:00:00.000Z" };
  const r3 = derive(C, [A, B, A3]);
  check("note-only trigger revision: still PROPOSED, same action id, sources follow the ORIGINAL trigger", [r3.actions[0]?.status, r3.actions[0]?.id, r3.actions[0]?.sourceContextIds], ["PROPOSED", real.id, [A_ID, B_ID]]);
  const ds3 = deriveCaseDecisionState(C, [A, B, A3]);
  check("…original trigger A kept as a REFERENCED (causal, historical) context; A3 is the current one", [ds3.referencedContexts.map((x) => [x.contextId, x.applicability]), ds3.ownerContexts.find((x) => x.contextId === B_ID)?.effectiveTriggerContextId], [[[A_ID, "SUPERSEDED"]], A3.id]);
  check("…and an earlier proposal revalidates as still PROPOSED (no false staleness)", revalidateSuggestedAction(real, { case: C, caseContextHistory: [A, B, A3] }).status, "PROPOSED");

  // 17. Case facts changed (status) while the deadline is unchanged → the decision was made on different facts.
  const statusChanged = caseWith("2026-07-14", "הושלם");
  const r17 = derive(statusChanged, [A, B]);
  check("17. Case fingerprint changed → action STALE (CASE_FACTS_MATCH_DECISION)", [r17.actions[0]?.status, r17.actions[0]?.blockingReasons], ["STALE", ["CASE_FACTS_MATCH_DECISION"]]);

  // 18. Project deadline changed manually to 01.10 before approval → earlier proposal STALE, never overwrites 01.10.
  const moved = caseWith("2026-10-01");
  const re = revalidateSuggestedAction(real, { case: moved, caseContextHistory: [A, B] });
  check("18. deadline already changed → STALE with explicit reasons", [re.status, re.staleness.reasons], ["STALE", ["CASE_FACTS_MATCH_DECISION", "PERSISTED_VALUE_MATCHES_EXPECTED"]]);
  check("18. the stale proposal still expects 2026-07-14 (it can never be used to overwrite 2026-10-01)", re.proposedChange.from, "2026-07-14");
  check("revalidation does not mutate the original proposal", real.status, "PROPOSED");
  check("Case disappeared (deadline updated to the future) → STALE CASE_EXISTS", revalidateSuggestedAction(real, { case: null, caseContextHistory: [A, B] }).staleness.reasons.includes("CASE_EXISTS"), true);
  check("unchanged truth → revalidation keeps PROPOSED", revalidateSuggestedAction(real, { case: C, caseContextHistory: [A, B] }).status, "PROPOSED");

  // 19. Proposed equals persisted → no-op.
  const same = caseWith("2026-10-07");
  const r19 = derive(same, [{ ...A, caseFactsFingerprint: fingerprintCaseFacts(same) }, { ...B, caseFactsFingerprint: fingerprintCaseFacts(same) }]);
  check("19. proposed == persisted → no action (NO_OP)", [r19.actions.length, r19.skipped.map((s) => s.reason)], [0, ["NO_OP_VALUE_ALREADY_PERSISTED"]]);

  // 20. Invalid date value → not eligible.
  const bad: PersistedOwnerContext = { ...B, answerValue: { kind: "DATE", ymd: "2026-10-08", resolution: { method: "RELATIVE", rule: "PLUS_14_DAYS", anchorYmd: "2026-09-23", timeZone: "Asia/Jerusalem" } } };
  const r20 = derive(C, [A, bad]);
  check("20. value that does not match its resolution → NOT_ELIGIBLE", [r20.actions[0]?.status, r20.actions[0]?.blockingReasons], ["NOT_ELIGIBLE", ["VALUE_IS_VALID_DATE"]]);
  const past: PersistedOwnerContext = { ...B, answerCode: "SPECIFIC_DATE", answerValue: { kind: "DATE", ymd: "2026-09-01", resolution: { method: "EXPLICIT", anchorYmd: "2026-09-23", timeZone: "Asia/Jerusalem" } } };
  check("20. a date before the answer date → NOT_ELIGIBLE", derive(C, [A, past]).actions[0]?.status, "NOT_ELIGIBLE");
}

console.log("Isolation (23-26)");
{
  const files = ["../lib/partner/actions/suggested.ts", "../lib/partner/actions/types.ts", "../lib/partner/actions/index.ts", "../lib/partner/investigation/decision-state.ts"];
  const src = Object.fromEntries(files.map((f) => [f, fs.readFileSync(path.resolve(__dirname, f), "utf8")]));
  ok("23. no DB access (no supabase / store / insert / update)", Object.values(src).every((s) => !/lib\/supabase|@supabase|context-store|feedback\/store|\.(insert|update|upsert|rpc)\(|\)\s*\.delete\(/.test(s)));
  ok("24. no project mutation / business-table reference", Object.values(src).every((s) => !/from\(\s*["'](projects|tasks|settings|transactions|sessions)["']|server-only/.test(s)));
  ok("25. no execution handler (no execute/apply/approve function)", Object.values(src).every((s) => !/export function (execute|apply|approve|run)\w*/i.test(s)));
  ok("26. no AI / provider / browser dependency", Object.values(src).every((s) => !/openai|anthropic|claude-in-chrome|puppeteer|playwright|lib\/mai|\bwindow\.|\bdocument\./.test(s)));
  ok("no clock / randomness in derivation", Object.values(src).every((s) => !/Date\.now\(|new Date\(\)|Math\.random/.test(s)));
  const ROOT = path.resolve(__dirname, "..");
  const walk = (d: string): string[] => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]) : [];
  // F.1I: the ONLY app/components consumers are the Owner-only READ-ONLY surface (GET route + dashboard card).
  // F.1I read surface + F.1J Owner decision UI/routes are the ONLY app/components consumers of actions.
  const READ_ONLY_SURFACE = [path.join("app", "api", "partner", "actions", "route.ts"), path.join("components", "partner", "PartnerActionCard.tsx"), path.join("components", "partner", "partner-decision-client.ts"), path.join("components", "partner", "PartnerActionsSection.tsx")];
  const DECISION_ROUTES = [path.join("app", "api", "partner", "actions", "decide", "route.ts"), path.join("app", "api", "partner", "actions", "change-deadline", "route.ts"), path.join("app", "api", "partner", "actions", "execute", "route.ts")];
  const importers = [...walk(path.join(ROOT, "app")), ...walk(path.join(ROOT, "components"))].filter((f) => /\.(ts|tsx)$/.test(f) && /partner\/actions/.test(fs.readFileSync(f, "utf8"))).map((f) => path.relative(ROOT, f));
  // F.1M: the read-only recent Outcomes GET route + its presentational card are the only other consumers.
  const OUTCOMES_READ_ONLY = [path.join("app", "api", "partner", "outcomes", "route.ts"), path.join("components", "partner", "PartnerOutcomeCard.tsx")];
  check("no app/ or components/ file imports actions except the approved surface + the Owner decision routes + the F.1M read-only outcomes route/card", importers.filter((f) => !READ_ONLY_SURFACE.includes(f) && !DECISION_ROUTES.includes(f) && !OUTCOMES_READ_ONLY.includes(f)), []);
  ok("F.1M: the outcomes route/card never reach a write / decision / execution path and import only outcome-server / outcome-dto", OUTCOMES_READ_ONLY.every((f) => {
    const s = fs.readFileSync(path.join(ROOT, f), "utf8");
    return !/action-service|event-persistence|actions\/event-store|actions\/live|actions\/service|decideSuggestedAction|executeApprovedAction|appendOwnerContext|partner_execute_update_project_deadline|\.insert\(|\.update\(|\.rpc\(|onClick|<button/.test(s)
      && [...s.matchAll(/from "([^"]*partner\/actions[^"]*)"/g)].every((m) => /actions\/(outcome-server|outcome-dto)$/.test(m[1]));
  }));
  ok("the surface / UI files never reach a server write path directly (UI talks to the routes over HTTP only)", READ_ONLY_SURFACE.every((f) => !/action-service|event-persistence|actions\/event-store|actions\/live|actions\/service|decideSuggestedAction|executeApprovedAction|appendOwnerContext|partner_execute_update_project_deadline|\.insert\(|\.update\(|\.rpc\(/.test(fs.readFileSync(path.join(ROOT, f), "utf8"))));
  // F.1K: the ONLY app/components file that can execute is the execute route, and only through executeApprovedAction.
  const EXECUTE_ROUTE = path.join("app", "api", "partner", "actions", "execute", "route.ts");
  check("F.1K: only the execute route references executeApprovedAction; none names the RPC / callExecuteRpc", [...walk(path.join(ROOT, "app")), ...walk(path.join(ROOT, "components"))].filter((f) => /\.(ts|tsx)$/.test(f) && /executeApprovedAction|callExecuteRpc|partner_execute_update_project_deadline/.test(fs.readFileSync(f, "utf8"))).map((f) => path.relative(ROOT, f)), [EXECUTE_ROUTE]);
  ok("F.1K: the execute route references neither callExecuteRpc nor the RPC name", !/callExecuteRpc|partner_execute_update_project_deadline/.test(fs.readFileSync(path.join(ROOT, EXECUTE_ROUTE), "utf8")));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
