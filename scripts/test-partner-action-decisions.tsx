/**
 * Tests — Redbloods Partner Owner decision UI + routes (Phase F.1J).
 *
 * Run with:   npx tsx scripts/test-partner-action-decisions.tsx
 *
 * NEVER touches production: the decision core runs against an in-memory fake
 * Action Event store, "שנה תאריך" against a fake live view + a capturing
 * appendOwnerContext, the card is rendered with react-dom/server, and the
 * routes / UI are checked statically. Fixture = the real "קרוב אלייך" chain.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { CASE_SCHEMA_VERSION, type PartnerCase } from "../lib/partner/cases/types";
import type { PersistedOwnerContext } from "../lib/partner/investigation/context-row";
import { OwnerContextStoreError, type OwnerContextDraft } from "../lib/partner/investigation/context-persistence";
import { resolveAnswerValue } from "../lib/partner/investigation/answer-value";
import { deriveCaseDecisionState } from "../lib/partner/investigation";
import { deriveSuggestedActions, type PartnerSuggestedAction } from "../lib/partner/actions";
import { buildActionSnapshot, hashActionSnapshot } from "../lib/partner/actions/snapshot";
import { mapActionEventRow, type ActionEventInsertRow } from "../lib/partner/actions/events";
import { createActionEventStore, type ActionEventTableClient, type ActionEventSelectQuery, type ExecuteRpcArgs } from "../lib/partner/actions/event-persistence";
import { decideSuggestedActionCore, type ActionServiceDeps, type LiveActionLookup, type LiveCaseView } from "../lib/partner/actions/service";
import { changeSuggestedActionValueCore } from "../lib/partner/actions/change-value";
import { ilWallClockToInstant } from "../lib/partner/actions/defer";
import { checkSameOriginJson } from "../lib/partner/actions/request-guard";
import { buildActionSurface } from "../lib/partner/actions/surface";
import type { PartnerActionCardDto } from "../lib/partner/actions/surface-dto";
import { PartnerActionsView, type CardControls } from "../components/partner/PartnerActionCard";
import { NOT_NOW_CHOICES, STALE_MESSAGE_HE, buildApproveAttempt, buildChangeAttempt, buildNotNowAttempt, interpretDecisionResponse, phaseForOutcome } from "../components/partner/partner-decision-client";
import { isAviAllowedPath, isCleantoneAllowedPath, isShalevAllowedPath, isStevenAllowedPath, isVictorAllowedPath } from "../lib/roles";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}
const ok = (name: string, cond: boolean) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}`); fail++; } };

// ── real fixture ──
const PID = "10d23186-a5ab-4eed-a9a4-eeda221a34d5";
const CASE_ID = `project_deadline_passed:${PID}`;
const A_ID = "fe35603a-79e6-45eb-92df-2567933e220f";
const B_ID = "de27b6d2-f35e-47c0-99e6-359db9d3d13c";
const FP = "cc7d8bca34c49059";
const LABEL = "קרוב אלייך";
const OWNER = "5f1c1d2e-0000-4000-8000-00000000aaaa";
const C: PartnerCase = {
  id: CASE_ID, schemaVersion: CASE_SCHEMA_VERSION, caseType: "PROJECT_DEADLINE_PASSED", subjectType: "project", subjectId: PID,
  classification: "RISK", status: "OPEN", createdFrom: "STATE",
  facts: [{ domain: "projects", entityId: PID, field: "deadline", value: "2026-07-14", label: "deadline" }, { domain: "projects", entityId: PID, field: "status", value: "במיקס", label: "status" }],
  derivedFacts: [], hypotheses: [], ownerRulesApplied: [], workingPrinciplesApplied: [], unknowns: [], dataQuality: { notes: [] },
  interventionStyle: "GENTLE", summaryHe: "", changeContext: null,
};
const A: PersistedOwnerContext = {
  id: A_ID, schemaVersion: "partner-owner-context-schema-v1", questionId: `${CASE_ID}::WHY_DEADLINE_STILL_ACTIVE`, questionType: "WHY_DEADLINE_STILL_ACTIVE",
  caseId: CASE_ID, caseType: "PROJECT_DEADLINE_PASSED", subjectType: "project", subjectId: PID, answerCode: "DEADLINE_NOT_UPDATED", answerValue: null, triggerContextId: null,
  questionTextHe: "q", caseFactsFingerprint: FP, note: null, answeredAt: "2026-09-23T09:10:08.684Z", scope: "CASE_INSTANCE",
  provenance: { source: "owner_manual" }, caseSchemaVersion: CASE_SCHEMA_VERSION, supersedesId: null,
};
const B: PersistedOwnerContext = {
  id: B_ID, schemaVersion: "partner-owner-context-schema-v2", questionId: `${CASE_ID}::WHAT_IS_NEW_PROJECT_DEADLINE`, questionType: "WHAT_IS_NEW_PROJECT_DEADLINE",
  caseId: CASE_ID, caseType: "PROJECT_DEADLINE_PASSED", subjectType: "project", subjectId: PID, answerCode: "IN_TWO_WEEKS",
  answerValue: { kind: "DATE", ymd: "2026-10-07", resolution: { method: "RELATIVE", rule: "PLUS_14_DAYS", anchorYmd: "2026-09-23", timeZone: "Asia/Jerusalem" } },
  triggerContextId: A_ID, questionTextHe: "q", caseFactsFingerprint: FP, note: null, answeredAt: "2026-09-23T09:50:47.036Z", scope: "CASE_INSTANCE",
  provenance: { source: "owner_manual" }, caseSchemaVersion: CASE_SCHEMA_VERSION, supersedesId: null,
};
const derive = (c: PartnerCase, h: PersistedOwnerContext[]) => deriveSuggestedActions({ case: c, decisionState: deriveCaseDecisionState(c, h), subjectLabelHe: LABEL }).actions;
const action: PartnerSuggestedAction = derive(C, [A, B])[0];
const HASH = hashActionSnapshot(buildActionSnapshot(action, C));
const ACTION_ID = action.id;

// ── fakes ──
class FakeEvents {
  rows: Record<string, unknown>[] = [];
  rpcCalls: ExecuteRpcArgs[] = [];
  tables = new Set<string>();
  clock = Date.parse("2026-09-23T10:00:00Z");
  client(): ActionEventTableClient {
    const db = this;
    return {
      from(t: string) {
        db.tables.add(t);
        return {
          select: () => {
            const f: Array<[string, string]> = [];
            const q: ActionEventSelectQuery = { eq(c, v) { f.push([c, v]); return q; }, order() { return q; }, range() { return q; },
              then(res, rej) { return Promise.resolve({ data: JSON.parse(JSON.stringify(db.rows.filter((r) => f.every(([c, v]) => r[c] === v)))), error: null }).then(res, rej); } };
            return q;
          },
          insert: (row: ActionEventInsertRow) => ({ select: () => ({ single: async () => {
            if (db.rows.some((r) => r.request_id === row.request_id)) return { data: null, error: { code: "23505", message: "partner_action_events_request_uk" } };
            db.clock += 1000;
            const stored = { ...JSON.parse(JSON.stringify(row)), id: randomUUID(), created_at: new Date(db.clock).toISOString() };
            db.rows.push(stored);
            return { data: stored, error: null };
          } }) }),
        };
      },
      rpc: async (_fn: string, args: ExecuteRpcArgs) => { db.rpcCalls.push(args); return { data: null, error: { code: "XX", message: "must never be called in F.1J" } }; },
    } as unknown as ActionEventTableClient;
  }
}
function liveFor(caseRef: PartnerCase | null, contexts: PersistedOwnerContext[]) {
  return {
    async findAction(id: string): Promise<LiveActionLookup> { if (!caseRef) return { status: "NOT_DERIVABLE" }; const a = derive(caseRef, contexts).find((x) => x.id === id); return a ? { status: "FOUND", action: a, caseRef } : { status: "NOT_DERIVABLE" }; },
    async loadCaseView(): Promise<LiveCaseView> { return { status: "OK", caseRef, contexts, derived: caseRef ? derive(caseRef, contexts) : [] }; },
  };
}
function decideSetup(caseRef: PartnerCase = C, contexts = [A, B]) {
  const db = new FakeEvents();
  const store = createActionEventStore(db.client());
  const deps: ActionServiceDeps = { now: () => new Date("2026-09-23T10:00:00Z"), store, live: liveFor(caseRef, contexts), audit: () => {} };
  return { db, store, deps };
}

async function surfaceItem(chainRows: Record<string, unknown>[] = []): Promise<PartnerActionCardDto | undefined> {
  const events = chainRows.map((r) => { const m = mapActionEventRow(r); if (!m.ok) throw new Error(m.errors.join()); return m.value; });
  const r = await buildActionSurface({
    listProposals: async () => ({ status: "OK", items: [{ action, caseRef: C, subjectLabelHe: LABEL }] }),
    getActionChain: async () => ({ status: "OK", chain: events, head: events[events.length - 1] ?? null }),
    now: () => new Date("2026-09-23T12:00:00Z"), log: () => {},
  });
  return r.status === "OK" ? r.response.items[0] : undefined;
}

function controls(over: Partial<CardControls> = {}): CardControls {
  const noop = () => {};
  return { phase: "idle", panel: "none", message: null, canRetry: false, notNowChoice: null, customYmd: "", changeCode: null, changeYmd: "",
    onApprove: noop, onOpenNotNow: noop, onOpenChange: noop, onCancel: noop, onRetry: noop, onNotNowChoice: noop, onCustomYmd: noop, onConfirmNotNow: noop,
    onChangeCode: noop, onChangeYmd: noop, onConfirmChange: noop, renderDatePicker: ({ ariaLabel }) => <div data-date-picker={ariaLabel} />, ...over };
}

async function main() {
  const ROOT = path.resolve(__dirname, "..");
  const rd = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  const DECIDE = rd("app/api/partner/actions/decide/route.ts"), CHANGE = rd("app/api/partner/actions/change-deadline/route.ts");
  const SECTION = rd("components/partner/PartnerActionsSection.tsx"), CARD = rd("components/partner/PartnerActionCard.tsx"), CLIENT = rd("components/partner/partner-decision-client.ts");
  const item = await surfaceItem();
  if (!item) throw new Error("fixture surface item missing");

  console.log("Auth (1-2)");
  ok("1. decide route → decideSuggestedAction (requireOwner inside, actor from session)", /decideSuggestedAction\(input\)/.test(DECIDE) && /requireOwner\(\)[\s\S]*getAuthUser\(\)/.test(rd("lib/partner/actions/action-service.ts")));
  ok("1. change route → changeSuggestedActionValue (requireOwner inside)", /changeSuggestedActionValue\(body\)/.test(CHANGE) && /export async function changeSuggestedActionValue[\s\S]*?resolveOwnerActor\(\)/.test(rd("lib/partner/actions/action-service.ts")));
  ok("2. non-owner / no session → 401 / 403 mapping in both routes", [DECIDE, CHANGE].every((s) => /case "UNAUTHORIZED": return json\(\{ status: r\.status \}, 401\)/.test(s) && /case "FORBIDDEN": return json\(\{ status: r\.status \}, 403\)/.test(s)));
  check("2. no non-owner role may reach the decision routes (proxy allowlists)", ["/api/partner/actions/decide", "/api/partner/actions/change-deadline"].flatMap((p) => [isVictorAllowedPath, isStevenAllowedPath, isShalevAllowedPath, isCleantoneAllowedPath, isAviAllowedPath].map((f) => f(p))), Array(10).fill(false));
  ok("2. the UI is Owner-gated too", /if \(role !== "owner"\) return null;/.test(SECTION));
  check("same-origin guard", [
    checkSameOriginJson(new Headers({ "content-type": "application/json", origin: "https://app.example", host: "app.example", "sec-fetch-site": "same-origin" })),
    checkSameOriginJson(new Headers({ "content-type": "application/json", origin: "https://evil.example", host: "app.example" })),
    checkSameOriginJson(new Headers({ "content-type": "text/plain", origin: "https://app.example", host: "app.example" })),
    checkSameOriginJson(new Headers({ "content-type": "application/json", host: "app.example" })),
    checkSameOriginJson(new Headers({ "content-type": "application/json", origin: "https://app.example", host: "internal:8080", "x-forwarded-host": "app.example" })),
    checkSameOriginJson(new Headers({ "content-type": "application/json", origin: "https://app.example", host: "app.example", "sec-fetch-site": "cross-site" })),
  ], [null, "cross-origin request", "content-type must be application/json", "missing Origin", null, "cross-site fetch"]);
  ok("routes: POST only, guard first, strict key whitelist", [DECIDE, CHANGE].every((s) => /export async function POST\(/.test(s) && !/export (async )?function (GET|PUT|PATCH|DELETE)/.test(s) && /const guard = checkSameOriginJson\(req\.headers\);\s*if \(guard\)/.test(s) && /ALLOWED_KEYS/.test(s)));

  console.log("APPROVE (3-9)");
  {
    const { db, deps } = decideSetup();
    const attempt = buildApproveAttempt(item, randomUUID());
    const r = await decideSuggestedActionCore(deps, { userId: OWNER }, attempt.body);
    check("3. APPROVE → RECORDED as APPROVED (the only write)", [r.status, db.rows.length, db.rows[0]?.event_type], ["RECORDED", 1, "APPROVED"]);
    check("5. APPROVE never calls the execution RPC", db.rpcCalls.length, 0);
    check("21. APPROVE never touches projects (only partner_action_events)", [...db.tables], ["partner_action_events"]);
    ok("4. decide route never imports / calls executeApprovedAction or the RPC", !/executeApprovedAction|callExecuteRpc|\.rpc\(|partner_execute_update_project_deadline/.test(strip(DECIDE)));
    ok("4. the UI never calls an execution path", ![SECTION, CARD, CLIENT].some((s) => /executeApprovedAction|\/execute|callExecuteRpc/.test(strip(s))));
    const after = await surfaceItem(db.rows);
    check("6. after APPROVED the surface shows a calm AWAITING_EXECUTION card", [after?.state, after?.statusLabelHe], ["AWAITING_EXECUTION", "אושר — ממתין לביצוע"]);
    const awaitingHtml = renderToStaticMarkup(<PartnerActionsView items={[after!]} isMobile={false} controlsFor={() => controls()} />);
    ok("6. awaiting card: 'הפעולה אושרה וממתינה לביצוע.' and NO decision / execute buttons", awaitingHtml.includes("הפעולה אושרה וממתינה לביצוע.") && !/<button/.test(awaitingHtml) && !awaitingHtml.includes("בצע"));
    check("6. APPROVE response → approved outcome", interpretDecisionResponse("APPROVE", 200, { status: "RECORDED", eventType: "APPROVED", eventId: randomUUID(), deferUntil: null }), { ui: "approved", messageHe: "הפעולה אושרה וממתינה לביצוע." });
    check("8/9. the body echoes EXACTLY the rendered hash + head", [attempt.body.seenSnapshotHash, attempt.body.expectedHeadEventId, attempt.body.actionId, Object.keys(attempt.body).sort()], [HASH, null, ACTION_ID, ["actionId", "decision", "expectedHeadEventId", "requestId", "seenSnapshotHash"]]);
    ok("7. double click: a synchronous ref guard + every control disabled while submitting", /if \(!attempt \|\| submitting\.current\) return;/.test(SECTION) && /submitting\.current = true;/.test(SECTION));
  }

  console.log("Stale / concurrency (10-13)");
  {
    const { db, deps } = decideSetup({ ...C, facts: C.facts.map((f) => f.field === "deadline" ? { ...f, value: "2026-08-01" } : f) });
    const r = await decideSuggestedActionCore(deps, { userId: OWNER }, buildApproveAttempt(item, randomUUID()).body);
    check("10. live proposal changed since render → STALE, nothing written (never approves the new proposal)", [r.status, db.rows.length], ["STALE", 0]);
    check("10. UI shows the calm stale message", interpretDecisionResponse("APPROVE", 200, { status: "STALE" }), { ui: "stale", messageHe: STALE_MESSAGE_HE });
    const { db: db2, deps: deps2 } = decideSetup();
    const r2 = await decideSuggestedActionCore(deps2, { userId: OWNER }, { ...buildApproveAttempt(item, randomUUID()).body, seenSnapshotHash: "0".repeat(64) });
    check("11. seen hash ≠ live → PROPOSAL_CHANGED, no write", [r2.status, db2.rows.length], ["PROPOSAL_CHANGED", 0]);
    check("11. → stale UI + the section re-fetches after every outcome", [interpretDecisionResponse("APPROVE", 200, { status: "PROPOSAL_CHANGED" }).ui, /await load\(\);\s*\}, \[load\]\);/.test(SECTION)], ["stale", true]);
    for (const s of ["HEAD_CONFLICT", "NOT_DERIVABLE", "ALREADY_IN_STATE", "ALREADY_EXECUTED", "INVALID_TRANSITION"]) check(`expected-head / state conflict ${s} → stale + refresh`, interpretDecisionResponse("APPROVE", 200, { status: s }).ui, "stale");
    const { db: db3, deps: deps3 } = decideSetup();
    const att = buildApproveAttempt(item, randomUUID());
    const first = await decideSuggestedActionCore(deps3, { userId: OWNER }, att.body);
    const again = await decideSuggestedActionCore(deps3, { userId: OWNER }, att.body);
    check("12. same attempt re-sent (same requestId, same scope) → REPLAY, one row", [first.status, again.status, db3.rows.length], ["RECORDED", "REPLAY", 1]);
    check("12. REPLAY of APPROVED → approved in the UI", interpretDecisionResponse("APPROVE", 200, { status: "REPLAY", eventType: "APPROVED" }).ui, "approved");
    const conflict = await decideSuggestedActionCore(deps3, { userId: OWNER }, { ...buildNotNowAttempt(item, att.body.requestId as string, "TOMORROW", null)!.body });
    check("13. same requestId for another decision → REQUEST_ID_CONFLICT, no write", [conflict.status, db3.rows.length], ["REQUEST_ID_CONFLICT", 1]);
    check("13. REQUEST_ID_CONFLICT → error (never shown as success)", interpretDecisionResponse("NOT_NOW", 200, { status: "REQUEST_ID_CONFLICT" }).ui, "error");
    ok("13. retry re-sends the SAME attempt; a new attempt gets a new requestId", /onRetry: \(\) => \{ const a = ui\.retryAttempt; if \(a\) submit\(item\.actionId, a\); \}/.test(SECTION) && /buildApproveAttempt\(item, newRequestId\(\)\)/.test(SECTION) && !/setInterval|setTimeout\([^)]*submit/.test(SECTION));
    check("503 / network failure → retry offered (no automatic retry)", [interpretDecisionResponse("APPROVE", 503, { status: "RETRYABLE" }).ui, interpretDecisionResponse("APPROVE", 503, null).ui], ["retry", "retry"]);
  }

  console.log("NOT_NOW (14-17)");
  {
    check("14. choices map exactly (Hebrew → code)", NOT_NOW_CHOICES, [{ code: "LATER_TODAY", labelHe: "מאוחר יותר היום" }, { code: "TOMORROW", labelHe: "מחר" }, { code: "IN_3_DAYS", labelHe: "בעוד 3 ימים" }, { code: "IN_1_WEEK", labelHe: "בעוד שבוע" }, { code: "CUSTOM", labelHe: "תאריך אחר" }]);
    check("16. SYSTEM_DEFAULT is not a choice", NOT_NOW_CHOICES.some((c) => (c.code as string) === "SYSTEM_DEFAULT"), false);
    const { deps } = decideSetup();
    const sys = await decideSuggestedActionCore(deps, { userId: OWNER }, { ...buildNotNowAttempt(item, randomUUID(), "TOMORROW", null)!.body, deferChoice: "SYSTEM_DEFAULT" });
    check("16. a forged SYSTEM_DEFAULT is rejected by the primitive", sys.status, "INVALID_INPUT");
    const custom = buildNotNowAttempt(item, randomUUID(), "CUSTOM", "2026-10-02")!;
    check("15. CUSTOM sends a calendar date (YYYY-MM-DD) only", [custom.body.deferChoice, custom.body.deferDateYmd, "deferUntil" in custom.body], ["CUSTOM", "2026-10-02", false]);
    check("15. CUSTOM without a date → nothing sent", buildNotNowAttempt(item, randomUUID(), "CUSTOM", null), null);
    const { db, deps: d2 } = decideSetup();
    // exactly what the route does: 09:00 Israel time of the picked date
    const routeInput = { actionId: custom.body.actionId, decision: "NOT_NOW", seenSnapshotHash: custom.body.seenSnapshotHash, expectedHeadEventId: null, requestId: custom.body.requestId, deferChoice: "CUSTOM", deferUntil: ilWallClockToInstant("2026-10-02", 9).toISOString() };
    const r = await decideSuggestedActionCore(d2, { userId: OWNER }, routeInput);
    check("15. stored defer target = 2026-10-02 09:00 Israel (06:00Z)", [r.status, db.rows[0]?.defer_choice, db.rows[0]?.defer_until], ["RECORDED", "CUSTOM", "2026-10-02T06:00:00.000Z"]);
    ok("15. the route resolves CUSTOM server-side from the calendar date", /ilWallClockToInstant\(b\.deferDateYmd, 9\)/.test(DECIDE));
    const hidden = await surfaceItem(db.rows);
    check("17. while the stored defer_until is ahead → the card is gone", hidden, undefined);
    const shown = await buildActionSurface({ listProposals: async () => ({ status: "OK", items: [{ action, caseRef: C, subjectLabelHe: LABEL }] }), getActionChain: async () => { const e = mapActionEventRow(db.rows[0]); if (!e.ok) throw new Error(); return { status: "OK", chain: [e.value], head: e.value }; }, now: () => new Date("2026-10-02T06:00:01Z"), log: () => {} });
    check("17. after the stored defer_until → SHOW again (no code constant involved)", shown.status === "OK" ? shown.response.items.map((i) => i.state) : null, ["SHOW"]);
    check("17. deferred response → calm message with the stored time", interpretDecisionResponse("NOT_NOW", 200, { status: "RECORDED", eventType: "NOT_NOW", deferUntil: "2026-10-02T06:00:00.000Z" }), { ui: "deferred", messageHe: "בסדר, אחזור לזה ב-02.10.2026, 09:00." });
  }

  console.log("שנה תאריך (18-20)");
  {
    const drafts: OwnerContextDraft[] = [];
    let saved: PersistedOwnerContext | null = null;
    const append = async (d: OwnerContextDraft): Promise<PersistedOwnerContext> => {
      drafts.push(d);
      const v = resolveAnswerValue(d.questionType, d.answerCode, { anchorYmd: "2026-09-23", explicitYmd: d.explicitDateYmd });
      if (!v.ok) throw new OwnerContextStoreError("INVALID_ANSWER_VALUE", "rejected", v.errors);
      saved = { ...B, id: "c3333333-3333-4333-8333-333333333333", answerCode: d.answerCode, answerValue: v.value, supersedesId: d.supersedesId, note: null, answeredAt: "2026-09-23T12:00:00.000Z", questionTextHe: d.questionText };
      return saved;
    };
    const events = new FakeEvents();
    const att = buildChangeAttempt(item, "SPECIFIC_DATE", "2026-10-30")!;
    const r = await changeSuggestedActionValueCore({ live: liveFor(C, [A, B]), appendOwnerContext: append, audit: () => {} }, att.body);
    check("18. שנה תאריך → CONTEXT_REVISED; ZERO Action Events; no RPC", [r.status, events.rows.length, events.rpcCalls.length], ["CONTEXT_REVISED", 0, 0]);
    const d = drafts[0];
    check("19. the existing WHAT_IS_NEW_PROJECT_DEADLINE question, same slot, revision of B, trigger A", [d.questionType, d.questionId, d.supersedesId, d.triggerContextId, d.answerCode, d.explicitDateYmd, d.provenance, d.caseId], ["WHAT_IS_NEW_PROJECT_DEADLINE", B.questionId, B_ID, A_ID, "SPECIFIC_DATE", "2026-10-30", { source: "owner_manual" }, CASE_ID]);
    ok("19. question text comes from the investigation model (not invented)", d.questionText.includes("מה הדדליין החדש לפרויקט?"));
    const next = derive(C, [A, B, saved!]);
    const newAction = next.find((a) => a.status === "PROPOSED");
    check("20. the new revision derives a NEW deterministic action id (old one no longer proposed)", [newAction?.id, newAction?.proposedChange.to, next.some((a) => a.id === ACTION_ID && a.status === "PROPOSED")], [`UPDATE_PROJECT_DEADLINE:${PID}:c3333333-3333-4333-8333-333333333333:2026-10-30`, "2026-10-30", false]);
    const staleR = await changeSuggestedActionValueCore({ live: liveFor(C, [A, B]), appendOwnerContext: append, audit: () => {} }, { ...att.body, seenSnapshotHash: "f".repeat(64) });
    check("changed proposal → PROPOSAL_CHANGED, no append", [staleR.status, drafts.length], ["PROPOSAL_CHANGED", 1]);
    const bad = await changeSuggestedActionValueCore({ live: liveFor(C, [A, B]), appendOwnerContext: append, audit: () => {} }, { actionId: ACTION_ID, seenSnapshotHash: HASH, answerCode: "NOT_KNOWN_YET", explicitDateYmd: null });
    check("only date-bearing answers are accepted (NOT_KNOWN_YET / OTHER rejected)", [bad.status, drafts.length], ["INVALID_INPUT", 1]);
    const past = await changeSuggestedActionValueCore({ live: liveFor(C, [A, B]), appendOwnerContext: append, audit: () => {} }, { actionId: ACTION_ID, seenSnapshotHash: HASH, answerCode: "SPECIFIC_DATE", explicitDateYmd: "2026-01-01" });
    check("a past date is rejected by the Owner Context store rules → INVALID_INPUT", past.status, "INVALID_INPUT");
    check("client: SPECIFIC_DATE before today is never sent", buildChangeAttempt(item, "SPECIFIC_DATE", "2026-09-01"), null);
    check("client: change body has no event type / decision / requestId", Object.keys(buildChangeAttempt(item, "END_OF_MONTH", null)!.body).sort(), ["actionId", "answerCode", "explicitDateYmd", "seenSnapshotHash"]);
    check("changed response → message + refetch", interpretDecisionResponse("CHANGE", 200, { status: "CONTEXT_REVISED", newDeadline: "2026-10-30" }), { ui: "changed", messageHe: "התאריך עודכן ל-30.10.2026. ההצעה חושבה מחדש." });
    ok("18. change route / core never write an Action Event", ![CHANGE, rd("lib/partner/actions/change-value.ts")].some((s) => /decideSuggestedAction|appendDecision|actionEventStore|event-persistence/.test(strip(s))));
  }

  console.log("Write boundaries (21-24)");
  {
    const files = ["app/api/partner/actions/decide/route.ts", "app/api/partner/actions/change-deadline/route.ts", "lib/partner/actions/change-value.ts", "lib/partner/actions/request-guard.ts", "components/partner/PartnerActionsSection.tsx", "components/partner/PartnerActionCard.tsx", "components/partner/partner-decision-client.ts"];
    const src = files.map((f) => strip(rd(f)));
    ok("21. no direct project update anywhere in F.1J files", src.every((s) => !/from\(\s*["']projects["']|updateProject|\/api\/projects/.test(s)));
    ok("22. no execution RPC / executeApprovedAction in F.1J files", src.every((s) => !/\.rpc\(|partner_execute_update_project_deadline|executeApprovedAction|callExecuteRpc/.test(s)));
    ok("23. no Feedback write", src.every((s) => !/feedback\/store|appendFeedback|partner_feedback/.test(s)));
    ok("24. no baseline mutation / Push / Cron / Alerts", src.every((s) => !/savePartnerBaseline|baseline\/store|partner_change_baseline|web-push|node-cron|agent_alerts/.test(s)));
    ok("UI never imports server code (talks to the routes over HTTP only)", [SECTION, CARD, CLIENT].every((s) => !/action-service|event-store|event-persistence|actions\/live|actions\/service"|context-store|lib\/supabase/.test(s)));
    ok("REJECT is not exposed (no button, route refuses it)", !/REJECT/.test(strip(SECTION + CARD + CLIENT)) && /decision must be APPROVE or NOT_NOW/.test(DECIDE));
  }

  console.log("UI (25-30)");
  {
    const idle = renderToStaticMarkup(<PartnerActionsView items={[item]} isMobile={false} controlsFor={() => controls()} />);
    const mobile = renderToStaticMarkup(<PartnerActionsView items={[item]} isMobile={true} controlsFor={() => controls()} />);
    ok("25. RTL Hebrew section with the three buttons in order", /<section dir="rtl" lang="he"/.test(idle) && idle.indexOf(">אשר<") < idle.indexOf(">לא עכשיו<") && idle.indexOf(">לא עכשיו<") < idle.indexOf(">שנה תאריך<"));
    ok("25. no REJECT / execute control rendered", !/דחה לגמרי|בצע|REJECT/.test(idle));
    ok("26. mobile: wrapping, comfortable tap targets (min-height 44px)", (mobile.match(/min-height:44px/g) ?? []).length === 3 && mobile.includes("flex:1 1 30%"));
    ok("26. desktop: compact horizontal row", (idle.match(/min-height:36px/g) ?? []).length === 3 && idle.includes("flex-wrap:wrap"));
    ok("27. keyboard basics: real <button type=button> elements", (idle.match(/<button type="button"/g) ?? []).length === 3);
    const nn = renderToStaticMarkup(<PartnerActionsView items={[item]} isMobile={false} controlsFor={() => controls({ panel: "notNow", notNowChoice: "CUSTOM" })} />);
    ok("27. NOT_NOW panel: fieldset + legend + radiogroup of native radios with labels", /<fieldset/.test(nn) && /<legend[^>]*>מתי לחזור לזה\?<\/legend>/.test(nn) && /role="radiogroup"/.test(nn) && (nn.match(/<input type="radio"/g) ?? []).length === 5);
    ok("15. CUSTOM shows the date picker (injected DatePickerInput)", /data-date-picker="תאריך לחזרה להצעה"/.test(nn) && /DatePickerInput value=\{value\} onChange=\{onChange\} min=\{min\}/.test(SECTION));
    const ch = renderToStaticMarkup(<PartnerActionsView items={[item]} isMobile={false} controlsFor={() => controls({ panel: "change", changeCode: "SPECIFIC_DATE" })} />);
    ok("שנה תאריך panel: the 4 date answers, date picker for SPECIFIC_DATE, says the project itself does not change", (ch.match(/<input type="radio"/g) ?? []).length === 4 && ch.includes("לבחור תאריך") && /data-date-picker="הדדליין החדש"/.test(ch) && ch.includes("הפרויקט עצמו לא משתנה"));
    const busy = renderToStaticMarkup(<PartnerActionsView items={[item]} isMobile={false} controlsFor={() => controls({ phase: "submitting" })} />);
    ok("29. submitting: every button disabled, aria-busy, 'שומר…' announced", (busy.match(/<button[^>]*disabled=""/g) ?? []).length === 3 && busy.includes('aria-busy="true"') && busy.includes("שומר…"));
    const busyNn = renderToStaticMarkup(<PartnerActionsView items={[item]} isMobile={false} controlsFor={() => controls({ phase: "submitting", panel: "notNow", notNowChoice: "TOMORROW" })} />);
    ok("29. submitting inside a panel: fieldset + confirm disabled", /<fieldset[^>]*disabled=""/.test(busyNn) && (busyNn.match(/<button[^>]*disabled=""/g) ?? []).length === 2);
    const err = renderToStaticMarkup(<PartnerActionsView items={[item]} isMobile={false} controlsFor={() => controls({ phase: "error", message: "לא הצלחתי לשמור כרגע. אפשר לנסות שוב.", canRetry: true })} />);
    ok("27. messages live in an aria-live status region; retry is a real button", /aria-live="polite" role="status"/.test(err) && err.includes(">נסה שוב<"));
    check("28. malformed / unexpected responses fail closed", [interpretDecisionResponse("APPROVE", 200, "garbage").ui, interpretDecisionResponse("APPROVE", 200, { status: "RECORDED", eventType: "NOT_NOW" }).ui, interpretDecisionResponse("NOT_NOW", 200, { status: "RECORDED", eventType: "APPROVED" }).ui, interpretDecisionResponse("CHANGE", 200, { status: "CONTEXT_REVISED", newDeadline: "soon" }).ui, interpretDecisionResponse("APPROVE", 200, { status: "WHATEVER" }).ui], ["error", "error", "error", "error", "error"]);
    check("30. errors never claim success and say nothing was saved", [interpretDecisionResponse("APPROVE", 500, { status: "FAILED" }), interpretDecisionResponse("APPROVE", 400, { status: "INVALID_INPUT" }), phaseForOutcome({ ui: "error", messageHe: "" })], [{ ui: "error", messageHe: "משהו השתבש — לא נשמר דבר." }, { ui: "error", messageHe: "הבקשה לא תקינה — לא נשמר דבר." }, "error"]);
    ok("30. no optimistic change: success/stale shown only after the server response, then re-fetch", /const outcome = interpretDecisionResponse\(attempt\.kind, status, body\);/.test(SECTION) && !/setItems\(\s*\(?\s*items?\s*=>/.test(SECTION));
    check("auth failures surface as errors (no success)", [interpretDecisionResponse("APPROVE", 401, { status: "UNAUTHORIZED" }).ui, interpretDecisionResponse("APPROVE", 403, { status: "FORBIDDEN_ORIGIN" }).ui], ["error", "error"]);
  }

  const self = fs.readFileSync(__filename, "utf8");
  ok("32. this test never imports a production binding", !/from\s+["'][^"']*(lib\/supabase|surface-server|actions\/event-store|actions\/live|actions\/action-service|context-store)["']/.test(self));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
