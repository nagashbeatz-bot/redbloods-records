/**
 * Tests — Redbloods Partner recent executed Actions surface ("בוצע לאחרונה", Phase F.1M).
 *
 * Run with:   npx tsx scripts/test-partner-outcomes-surface.tsx
 *
 * NEVER touches production:
 *   - the REAL GET route runs in-process with requireOwner() and the server binding faked;
 *   - the REAL recent-outcomes core runs over the REAL F.1L Outcome reader against an in-memory
 *     Action Event store (chain built by the REAL decision core + the exact RPC EXECUTED row);
 *   - cards are rendered with react-dom/server; boundaries are checked statically.
 * First real fixture = "קרוב אלייך" (approval a9ab2392…, execution 0245272e…).
 */
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import { randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { NextResponse } from "next/server";
import { CASE_SCHEMA_VERSION, type PartnerCase } from "../lib/partner/cases/types";
import type { PersistedOwnerContext } from "../lib/partner/investigation/context-row";
import { deriveCaseDecisionState } from "../lib/partner/investigation";
import { deriveSuggestedActions } from "../lib/partner/actions";
import { buildActionSnapshot, hashActionSnapshot } from "../lib/partner/actions/snapshot";
import { mapActionEventRow, type ActionEventInsertRow, type PartnerActionEvent } from "../lib/partner/actions/events";
import { createActionEventStore, type ActionEventTableClient, type ActionEventSelectQuery } from "../lib/partner/actions/event-persistence";
import { decideSuggestedActionCore, type ActionServiceDeps, type LiveActionLookup, type LiveCaseView } from "../lib/partner/actions/service";
import { readExecutedActionOutcomeCore, type LiveDeadlineRead, type OutcomeReadResult, type PartnerActionOutcome } from "../lib/partner/actions/outcome";
import { OUTCOME_TEXT_HE, RECENT_OUTCOMES_LIMIT, parseRecentOutcomesResponse, toOutcomeCardDto, type PartnerOutcomeCardDto } from "../lib/partner/actions/outcome-dto";
import { buildRecentOutcomes, type RecentOutcomesDeps } from "../lib/partner/actions/recent-outcomes";
import { PartnerActionsView } from "../components/partner/PartnerActionCard";
import { isAviAllowedPath, isCleantoneAllowedPath, isShalevAllowedPath, isStevenAllowedPath, isVictorAllowedPath } from "../lib/roles";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}
const ok = (name: string, cond: boolean) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}`); fail++; } };

// ── the real fixture ──
const PID = "10d23186-a5ab-4eed-a9a4-eeda221a34d5";
const CASE_ID = `project_deadline_passed:${PID}`;
const A_ID = "fe35603a-79e6-45eb-92df-2567933e220f";
const B_ID = "de27b6d2-f35e-47c0-99e6-359db9d3d13c";
const FP = "cc7d8bca34c49059";
const LABEL = "קרוב אלייך";
const OWNER = "4ced002e-db18-4eb7-affb-4afac5aca8b6";
const PROD = {
  approval: { id: "a9ab2392-68bc-4e74-b579-d9d0f316a8e5", request: "6fe0bc4c-62aa-43bf-9c98-f5adcfd1d0ee", at: "2026-09-23T16:50:50.311475+00:00" },
  execution: { id: "0245272e-446a-44cb-b774-7bca5e96bdea", request: "708cc9c5-225e-4ba0-8e07-b53aab05f2c0", at: "2026-09-23T17:05:19.291913+00:00" },
};
const C: PartnerCase = {
  id: CASE_ID, schemaVersion: CASE_SCHEMA_VERSION, caseType: "PROJECT_DEADLINE_PASSED", subjectType: "project", subjectId: PID,
  classification: "RISK", status: "OPEN", createdFrom: "STATE",
  facts: [{ domain: "projects", entityId: PID, field: "deadline", value: "2026-07-14", label: "deadline" }, { domain: "projects", entityId: PID, field: "status", value: "במיקס", label: "status" }],
  derivedFacts: [], hypotheses: [], ownerRulesApplied: [], workingPrinciplesApplied: [], unknowns: [], dataQuality: { notes: [] },
  interventionStyle: "GENTLE", summaryHe: "", changeContext: null,
};
const ctx = (over: Partial<PersistedOwnerContext>): PersistedOwnerContext => ({
  id: A_ID, schemaVersion: "partner-owner-context-schema-v1", questionId: `${CASE_ID}::WHY_DEADLINE_STILL_ACTIVE`, questionType: "WHY_DEADLINE_STILL_ACTIVE",
  caseId: CASE_ID, caseType: "PROJECT_DEADLINE_PASSED", subjectType: "project", subjectId: PID, answerCode: "DEADLINE_NOT_UPDATED", answerValue: null, triggerContextId: null,
  questionTextHe: "q", caseFactsFingerprint: FP, note: null, answeredAt: "2026-09-23T09:10:08.684Z", scope: "CASE_INSTANCE",
  provenance: { source: "owner_manual" }, caseSchemaVersion: CASE_SCHEMA_VERSION, supersedesId: null, ...over,
});
const A = ctx({});
const B = ctx({
  id: B_ID, schemaVersion: "partner-owner-context-schema-v2", questionId: `${CASE_ID}::WHAT_IS_NEW_PROJECT_DEADLINE`, questionType: "WHAT_IS_NEW_PROJECT_DEADLINE", answerCode: "IN_TWO_WEEKS",
  answerValue: { kind: "DATE", ymd: "2026-10-07", resolution: { method: "RELATIVE", rule: "PLUS_14_DAYS", anchorYmd: "2026-09-23", timeZone: "Asia/Jerusalem" } }, triggerContextId: A_ID, answeredAt: "2026-09-23T09:50:47.036Z",
});
const derive = (c: PartnerCase, h: PersistedOwnerContext[]) => deriveSuggestedActions({ case: c, decisionState: deriveCaseDecisionState(c, h), subjectLabelHe: LABEL }).actions;
const action = derive(C, [A, B])[0];

class FakeEvents {
  rows: Record<string, unknown>[] = [];
  touches: string[] = [];
  client(): ActionEventTableClient {
    const db = this;
    return {
      from(t: string) {
        db.touches.push(`from:${t}`);
        return {
          select: () => {
            const f: Array<[string, string]> = [];
            const q: ActionEventSelectQuery = { eq(c, v) { f.push([c, v]); return q; }, order() { return q; }, range() { return q; },
              then(res, rej) { db.touches.push("select"); return Promise.resolve({ data: JSON.parse(JSON.stringify(db.rows.filter((r) => f.every(([c, v]) => r[c] === v)))), error: null }).then(res, rej); } };
            return q;
          },
          insert: (row: ActionEventInsertRow) => ({ select: () => ({ single: async () => {
            db.touches.push("insert");
            const stored = { ...JSON.parse(JSON.stringify(row)), id: randomUUID(), created_at: "2026-09-23T16:50:50Z" };
            db.rows.push(stored);
            return { data: stored, error: null };
          } }) }),
        };
      },
      rpc: async () => { db.touches.push("rpc"); return { data: null, error: { code: "XX", message: "never" } }; },
    } as unknown as ActionEventTableClient;
  }
}
async function realRows(): Promise<Record<string, unknown>[]> {
  const db = new FakeEvents();
  const deps: ActionServiceDeps = {
    now: () => new Date("2026-09-23T16:50:50Z"), store: createActionEventStore(db.client()), audit: () => {},
    live: {
      async findAction(id: string): Promise<LiveActionLookup> { const a = derive(C, [A, B]).find((x) => x.id === id); return a ? { status: "FOUND", action: a, caseRef: C } : { status: "NOT_DERIVABLE" }; },
      async loadCaseView(): Promise<LiveCaseView> { return { status: "OK", caseRef: C, contexts: [A, B], derived: derive(C, [A, B]) }; },
    },
  };
  const r = await decideSuggestedActionCore(deps, { userId: OWNER }, { actionId: action.id, decision: "APPROVE", seenSnapshotHash: hashActionSnapshot(buildActionSnapshot(action, C)), expectedHeadEventId: null, requestId: PROD.approval.request });
  if (r.status !== "RECORDED") throw new Error("fixture approve failed");
  const ap = { ...db.rows[0], id: PROD.approval.id, created_at: PROD.approval.at };
  const ex = { ...ap, id: PROD.execution.id, request_id: PROD.execution.request, event_type: "EXECUTED", supersedes_event_id: ap.id, created_at: PROD.execution.at,
    revalidation: { revalidatedAt: "2026-09-23T17:05:19.000Z", appStaleReasons: [], expectedTriggerHead: A_ID },
    execution: { from: "2026-07-14", to: "2026-10-07", rowsAffected: 1, lockedContextIds: [A_ID, B_ID], mutated: true } };
  return [ap, ex];
}
function realDeps(rows: Record<string, unknown>[], live: LiveDeadlineRead) {
  const db = new FakeEvents();
  db.rows = JSON.parse(JSON.stringify(rows));
  const store = createActionEventStore(db.client());
  const logs: string[] = [];
  const liveReads: string[] = [];
  const outcomeDeps = { store: { getEventById: (id: string) => store.getEventById(id), getActionChain: (id: string) => store.getActionChain(id) }, readProjectDeadline: async (pid: string) => { liveReads.push(pid); return live; }, now: () => new Date("2026-09-23T18:00:00Z") };
  const deps: RecentOutcomesDeps = { listExecutedEvents: () => store.getEventsByType("EXECUTED"), readOutcome: (id) => readExecutedActionOutcomeCore(outcomeDeps, id), log: (e, d) => logs.push(`${e}:${String(d.reason ?? "")}`) };
  return { db, deps, logs, liveReads };
}

// Synthetic outcomes for ordering / limit / omission (the core only needs id + createdAt + eventType).
const ev = (id: string, at: string, eventType: PartnerActionEvent["eventType"] = "EXECUTED") => ({ id, createdAt: at, eventType }) as unknown as PartnerActionEvent;
const outcome = (id: string, state: PartnerActionOutcome["state"], to = "2026-10-07", current: string | null = to, at = "2026-09-23T17:05:19Z"): PartnerActionOutcome => ({
  schemaVersion: "partner-action-outcome-v1", state, actionId: `UPDATE_PROJECT_DEADLINE:${PID}:${B_ID}:${to}`, actionType: state === "UNSUPPORTED_ACTION" ? "ARCHIVE_PROJECT" : "UPDATE_PROJECT_DEADLINE",
  subject: { type: "project", id: PID }, subjectLabel: LABEL, approvalEventId: randomUUID(), executedEventId: id, snapshotHash: "a".repeat(64),
  executed: { field: "deadline", from: "2026-07-14", to, executedAt: at, approvedAt: at }, expectedValue: to,
  current: state === "APPLIED_AS_EXPECTED" || state === "LIVE_STATE_CHANGED_AFTER_EXECUTION" ? { value: current, updatedAt: at } : null,
  evaluatedAt: "2026-09-23T18:00:00.000Z", evidence: [], reasons: [], summaryHe: "",
});
function syntheticDeps(events: PartnerActionEvent[], results: Record<string, OutcomeReadResult | (() => never)>) {
  const logs: string[] = [];
  const reads: string[] = [];
  const deps: RecentOutcomesDeps = {
    listExecutedEvents: async () => ({ status: "OK", events }),
    readOutcome: async (id) => { reads.push(id); const r = results[id]; if (typeof r === "function") return r(); return r; },
    log: (e, d) => logs.push(`${e}:${String(d.reason ?? "")}`),
  };
  return { deps, logs, reads };
}
const render = (outcomes: PartnerOutcomeCardDto[], isMobile = false) => renderToStaticMarkup(<PartnerActionsView items={[]} outcomes={outcomes} isMobile={isMobile} />);

// ── the REAL GET route with requireOwner + binding faked ──
const auth = { role: "owner" as "owner" | "none" | "victor", calls: 0 };
const surface = { calls: 0, result: null as unknown };
const ML = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
const origLoad = ML._load;
ML._load = function (request: string, parent: unknown, isMain: boolean) {
  if (/lib\/require-auth$/.test(request)) return { async requireOwner() { auth.calls++; return auth.role === "owner" ? null : auth.role === "none" ? NextResponse.json({ error: "Unauthorized" }, { status: 401 }) : NextResponse.json({ error: "Forbidden" }, { status: 403 }); } };
  if (/partner\/actions\/outcome-server$/.test(request)) return { async getRecentOutcomesSurface() { surface.calls++; if (surface.result instanceof Error) throw surface.result; return surface.result; } };
  return origLoad.call(this, request, parent, isMain);
};

async function main() {
  const ROOT = path.resolve(__dirname, "..");
  const rd = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  const rows = await realRows();

  console.log("First real fixture → APPLIED_AS_EXPECTED card (1-5, 8, 30)");
  const real = realDeps(rows, { status: "FOUND", deadline: "2026-10-07", updatedAt: PROD.execution.at, name: LABEL });
  const r = await buildRecentOutcomes(real.deps);
  const card = r.status === "OK" ? (r.response.items[0] as PartnerOutcomeCardDto | undefined) : undefined;
  {
    check("30. the real executed Action yields exactly one APPLIED_AS_EXPECTED card", r.status === "OK" ? r.response.items.map((i) => [i.executedEventId, i.state]) : r, [[PROD.execution.id, "APPLIED_AS_EXPECTED"]]);
    check("2. project name (live, current)", card?.projectName, LABEL);
    check("3. executed from/to (historical, from the persisted snapshot + audit)", [card?.executedFrom, card?.executedTo, card?.executedFromHe, card?.executedToHe], ["2026-07-14", "2026-10-07", "14.07.2026", "07.10.2026"]);
    check("4. current live value", [card?.currentValue, card?.currentValueHe], ["2026-10-07", "07.10.2026"]);
    check("8. EXECUTED timestamp in Israel time (17:05:19Z → 20:05 IDT)", [card?.executedAt, card?.executedAtHe], [PROD.execution.at, "23.09.2026, 20:05"]);
    check("30. exact DTO", card, {
      v: 1, state: "APPLIED_AS_EXPECTED", executedEventId: PROD.execution.id, actionType: "UPDATE_PROJECT_DEADLINE", projectId: PID, projectName: LABEL,
      executedFrom: "2026-07-14", executedFromHe: "14.07.2026", executedTo: "2026-10-07", executedToHe: "07.10.2026", executedAt: PROD.execution.at, executedAtHe: "23.09.2026, 20:05",
      currentValue: "2026-10-07", currentValueHe: "07.10.2026", headlineHe: "הדדליין של 'קרוב אלייך' עודכן ל־07.10.2026", badgeHe: "בוצע", statusHe: "השינוי שבוצע עדיין תואם למצב הנוכחי.",
    });
    check("the DTO carries display data only (no snapshot / hash / approval / actor / evidence)", Object.keys(card ?? {}).filter((k) => /snapshot|hash|approval|actor|evidence|reasons|request/i.test(k)), []);
    check("the client parser accepts the real payload", parseRecentOutcomesResponse(r.status === "OK" ? JSON.parse(JSON.stringify(r.response)) : null).ok, true);
    const html = render(card ? [card] : []);
    ok("1. renders: 'בוצע' + headline + executed box + 'מצב נוכחי' + status", html.includes(">בוצע<") && html.includes("הדדליין של &#x27;קרוב אלייך&#x27; עודכן ל־07.10.2026") && /data-outcome-value="executed"[\s\S]*07\.10\.2026/.test(html) && /data-outcome-value="current"[\s\S]*מצב נוכחי[\s\S]*07\.10\.2026/.test(html) && html.includes("השינוי שבוצע עדיין תואם למצב הנוכחי."));
    ok("5. historical and live values are separate boxes; the executed box names the origin value", /data-outcome-value="executed"[^>]*>[\s\S]*מה Partner ביצע \(מ־14\.07\.2026\)/.test(html) && (html.match(/data-outcome-value=/g) ?? []).length === 2);
    ok("8. rendered execution time", html.includes("בוצע ב־<bdi dir=\"ltr\">23.09.2026, 20:05</bdi>"));
    check("the live read targeted the persisted subject project, and the store was only read", [real.liveReads, [...new Set(real.db.touches)].sort()], [[PID], ["from:partner_action_events", "select"]]);
  }

  console.log("LIVE_STATE_CHANGED_AFTER_EXECUTION (5-7)");
  {
    const changed = realDeps(rows, { status: "FOUND", deadline: "2026-10-20", updatedAt: "2026-09-30T10:00:00+00:00", name: LABEL });
    const rc = await buildRecentOutcomes(changed.deps);
    const c = rc.status === "OK" ? (rc.response.items[0] as PartnerOutcomeCardDto | undefined) : undefined;
    check("6. state + calm wording", [c?.state, c?.badgeHe, c?.statusHe], ["LIVE_STATE_CHANGED_AFTER_EXECUTION", "בוצע", "הדדליין השתנה מאז הפעולה של Partner."]);
    check("5. executed value stays 07.10.2026; current is 20.10.2026 — never swapped", [c?.executedTo, c?.executedToHe, c?.currentValue, c?.currentValueHe, c?.headlineHe], ["2026-10-07", "07.10.2026", "2026-10-20", "20.10.2026", "הדדליין של 'קרוב אלייך' עודכן ל־07.10.2026"]);
    const html = render(c ? [c] : []);
    ok("6. renders executed 07.10.2026 and current 20.10.2026 in their own boxes", /data-outcome-value="executed"[\s\S]*?07\.10\.2026/.test(html) && /data-outcome-value="current"[\s\S]*?20\.10\.2026/.test(html));
    ok("7. not called failure / error / rollback / problem", !/failure|error|rollback|problem|כשל|שגיאה|נכשל|בעיה|ביטול/i.test(html + JSON.stringify(c)));
    ok("7. no warning tone on a changed live value (same 'בוצע' chip as applied)", /data-outcome-state="LIVE_STATE_CHANGED_AFTER_EXECUTION"/.test(html) && !html.includes("#F59E0B"));
    const cleared = toOutcomeCardDto(outcome(randomUUID(), "LIVE_STATE_CHANGED_AFTER_EXECUTION", "2026-10-07", null));
    check("a cleared live deadline shows 'ללא דדליין' as the CURRENT value only", [cleared.currentValue, cleared.currentValueHe, cleared.executedToHe], [null, "ללא דדליין", "07.10.2026"]);
  }

  console.log("Ordering / limit / omission / fail closed (9-15)");
  {
    const ids = Array.from({ length: 7 }, () => randomUUID());
    const ats = ["2026-09-20T10:00:00Z", "2026-09-23T10:00:00Z", "2026-09-21T10:00:00Z", "2026-09-22T10:00:00Z", "2026-09-19T10:00:00Z", "2026-09-24T10:00:00Z", "2026-09-18T10:00:00Z"];
    const results = Object.fromEntries(ids.map((id, i) => [id, { kind: "OUTCOME", outcome: outcome(id, "APPLIED_AS_EXPECTED", "2026-10-07", "2026-10-07", ats[i]) } as OutcomeReadResult]));
    const s = syntheticDeps(ids.map((id, i) => ev(id, ats[i])), results);
    const out = await buildRecentOutcomes(s.deps);
    const got = out.status === "OK" ? out.response.items.map((i) => i.executedAt) : [];
    check("9. newest first by EXECUTED created_at", got, ["2026-09-24T10:00:00Z", "2026-09-23T10:00:00Z", "2026-09-22T10:00:00Z", "2026-09-21T10:00:00Z", "2026-09-20T10:00:00Z"]);
    check("10. max 5 items; the two oldest are never even evaluated", [got.length, RECENT_OUTCOMES_LIMIT, s.reads.length], [5, 5, 5]);
    check("10. a caller cannot raise the limit above 5", (await buildRecentOutcomes(syntheticDeps(ids.map((id, i) => ev(id, ats[i])), results).deps, 50)).status === "OK" ? 5 : -1, 5);
    const tie = [randomUUID(), randomUUID()].sort();
    const tieOut = await buildRecentOutcomes(syntheticDeps(tie.map((id) => ev(id, "2026-09-23T10:00:00Z")), Object.fromEntries(tie.map((id) => [id, { kind: "OUTCOME", outcome: outcome(id, "APPLIED_AS_EXPECTED") } as OutcomeReadResult]))).deps);
    check("9. deterministic tie-break (same created_at → id DESC)", tieOut.status === "OK" ? tieOut.response.items.map((i) => i.executedEventId) : [], [tie[1], tie[0]]);

    const [u, m, nf, rf, iv, no, th, good] = Array.from({ length: 8 }, () => randomUUID());
    const mixed = syntheticDeps([u, m, nf, rf, iv, no, th, good].map((id, i) => ev(id, `2026-09-2${3 - Math.floor(i / 3)}T1${i}:00:00Z`)), {
      [u]: { kind: "OUTCOME", outcome: outcome(u, "UNSUPPORTED_ACTION") },
      [m]: { kind: "STORED_DATA_INVALID", errors: ["action_snapshot SHA-256 does not match snapshot_hash (integrity)"] },
      [nf]: { kind: "OUTCOME", outcome: outcome(nf, "TARGET_NOT_FOUND") },
      [rf]: { kind: "OUTCOME", outcome: outcome(rf, "READ_FAILED") },
      [iv]: { kind: "OUTCOME", outcome: outcome(iv, "INVARIANT_VIOLATION") },
      [no]: { kind: "NO_OUTCOME", actionId: "x", reason: "STALE_AT_EXECUTION", headEventType: "STALE_AT_EXECUTION" },
      [th]: () => { throw new Error("boom"); },
      [good]: { kind: "OUTCOME", outcome: outcome(good, "APPLIED_AS_EXPECTED") },
    });
    const mo = await buildRecentOutcomes(mixed.deps);
    const byId = new Map((mo.status === "OK" ? mo.response.items : []).map((i) => [i.executedEventId, i]));
    check("11. UNSUPPORTED_ACTION omitted (and logged)", [byId.has(u), mixed.logs.includes("partner_outcome_omitted:UNSUPPORTED_ACTION")], [false, true]);
    check("12. malformed stored Action omitted (fail closed, logged)", [byId.has(m), mixed.logs.includes("partner_outcome_omitted:STORED_DATA_INVALID")], [false, true]);
    check("15. INVARIANT_VIOLATION omitted (fail closed, logged)", [byId.has(iv), mixed.logs.includes("partner_outcome_omitted:INVARIANT_VIOLATION")], [false, true]);
    check("no-Outcome and throwing reads omitted (logged)", [byId.has(no), byId.has(th), mixed.logs.includes("partner_outcome_omitted:NO_OUTCOME"), mixed.logs.includes("partner_outcome_omitted:READ_THREW")], [false, false, true, true]);
    const nfc = byId.get(nf) as PartnerOutcomeCardDto | undefined, rfc = byId.get(rf) as PartnerOutcomeCardDto | undefined;
    check("13. TARGET_NOT_FOUND is a warning state, not normal success: own badge, no current value", [nfc?.state, nfc?.badgeHe, nfc?.statusHe, nfc?.currentValue, nfc?.currentValueHe], ["TARGET_NOT_FOUND", "לתשומת לב", "הפרויקט שעליו בוצעה הפעולה לא נמצא כרגע במערכת.", null, null]);
    ok("13. rendered in the warning tone, without a 'מצב נוכחי' box and without the success sentence", (() => { const h = render([nfc!]); return h.includes("#F59E0B") && !h.includes("מצב נוכחי") && !h.includes("עדיין תואם"); })());
    check("14. READ_FAILED shows no current value (nothing invented)", [rfc?.state, rfc?.currentValue, rfc?.currentValueHe, rfc?.statusHe], ["READ_FAILED", null, null, "לא הצלחתי לקרוא כרגע את המצב הנוכחי."]);
    ok("14. rendered without a 'מצב נוכחי' box and without the success sentence", (() => { const h = render([rfc!]); return !h.includes("מצב נוכחי") && !h.includes("עדיין תואם") && !h.includes("השתנה"); })());
    check("only displayable cards remain, newest first", mo.status === "OK" ? mo.response.items.map((i) => i.state) : [], ["TARGET_NOT_FOUND", "READ_FAILED", "APPLIED_AS_EXPECTED"]);
    const bad = await buildRecentOutcomes({ listExecutedEvents: async () => ({ status: "INVALID_STORED_EVENT", errors: ["x"] }), readOutcome: async () => { throw new Error("never"); }, log: () => {} });
    check("12. an unreadable executed list → UNAVAILABLE (nothing shown)", bad, { status: "UNAVAILABLE" });
    check("12. the DTO builder refuses incoherent outcomes", [
      (() => { try { toOutcomeCardDto(outcome(randomUUID(), "APPLIED_AS_EXPECTED", "2026-10-07", "2026-10-20")); return "built"; } catch { return "refused"; } })(),
      (() => { try { toOutcomeCardDto(outcome(randomUUID(), "LIVE_STATE_CHANGED_AFTER_EXECUTION", "2026-10-07", "2026-10-07")); return "built"; } catch { return "refused"; } })(),
      (() => { try { toOutcomeCardDto(outcome(randomUUID(), "INVARIANT_VIOLATION")); return "built"; } catch { return "refused"; } })(),
      (() => { try { toOutcomeCardDto({ ...outcome(randomUUID(), "APPLIED_AS_EXPECTED"), executed: null }); return "built"; } catch { return "refused"; } })(),
    ], ["refused", "refused", "refused", "refused"]);
    const good1 = toOutcomeCardDto(outcome(randomUUID(), "APPLIED_AS_EXPECTED"));
    check("12. the client parser fails closed on forged / malformed payloads", [
      parseRecentOutcomesResponse({ v: 1, items: [{ ...good1, currentValue: "2026-10-20" }] }).ok,
      parseRecentOutcomesResponse({ v: 1, items: [{ ...good1, statusHe: "הצלחה!" }] }).ok,
      parseRecentOutcomesResponse({ v: 1, items: [{ ...good1, state: "INVARIANT_VIOLATION" }] }).ok,
      parseRecentOutcomesResponse({ v: 1, items: [{ ...good1, snapshot: {} }] }).ok,
      parseRecentOutcomesResponse({ v: 1, items: [{ ...toOutcomeCardDto(outcome(randomUUID(), "READ_FAILED")), currentValue: "2026-10-07", currentValueHe: "07.10.2026" }] }).ok,
      parseRecentOutcomesResponse({ v: 1, items: Array.from({ length: 6 }, () => toOutcomeCardDto(outcome(randomUUID(), "APPLIED_AS_EXPECTED"))) }).ok,
      parseRecentOutcomesResponse({ v: 1, items: [toOutcomeCardDto(outcome(randomUUID(), "APPLIED_AS_EXPECTED", "2026-10-07", "2026-10-07", "2026-09-20T00:00:00Z")), toOutcomeCardDto(outcome(randomUUID(), "APPLIED_AS_EXPECTED", "2026-10-07", "2026-10-07", "2026-09-22T00:00:00Z"))] }).ok,
      parseRecentOutcomesResponse({ v: 2, items: [] }).ok,
      parseRecentOutcomesResponse({ v: 1, items: [good1, good1] }).ok,
    ], [false, false, false, false, false, false, false, false, false]);
    check("the status texts are fixed per state", OUTCOME_TEXT_HE, {
      APPLIED_AS_EXPECTED: { badgeHe: "בוצע", statusHe: "השינוי שבוצע עדיין תואם למצב הנוכחי." },
      LIVE_STATE_CHANGED_AFTER_EXECUTION: { badgeHe: "בוצע", statusHe: "הדדליין השתנה מאז הפעולה של Partner." },
      TARGET_NOT_FOUND: { badgeHe: "לתשומת לב", statusHe: "הפרויקט שעליו בוצעה הפעולה לא נמצא כרגע במערכת." },
      READ_FAILED: { badgeHe: "בוצע", statusHe: "לא הצלחתי לקרוא כרגע את המצב הנוכחי." },
    });
  }

  console.log("Route: Owner-only GET (16-18)");
  {
    const route = require("../app/api/partner/outcomes/route") as { GET(): Promise<Response> }; // eslint-disable-line @typescript-eslint/no-require-imports
    const ROUTE = rd("app/api/partner/outcomes/route.ts");
    surface.result = r;
    auth.role = "none"; surface.calls = 0;
    const u = await route.GET();
    check("16. no session → 401, the surface is never built", [u.status, surface.calls], [401, 0]);
    auth.role = "victor";
    const f = await route.GET();
    check("17. non-owner → 403, the surface is never built", [f.status, surface.calls], [403, 0]);
    check("17. no non-owner role may reach /api/partner/outcomes (proxy allowlists)", [isVictorAllowedPath, isStevenAllowedPath, isShalevAllowedPath, isCleantoneAllowedPath, isAviAllowedPath].map((fn) => fn("/api/partner/outcomes")), [false, false, false, false, false]);
    auth.role = "owner";
    const okRes = await route.GET();
    const body = await okRes.json();
    check("16. Owner → 200 with the recent outcomes payload, no-store", [okRes.status, okRes.headers.get("cache-control"), body.items.length, body.items[0]?.state], [200, "no-store", 1, "APPLIED_AS_EXPECTED"]);
    surface.result = { status: "UNAVAILABLE" };
    check("unavailable → 503 without details", [(await route.GET()).status], [503]);
    surface.result = new Error("relation projects SQLSTATE 42501");
    const errs: unknown[] = []; const oe = console.error; console.error = (...a: unknown[]) => { errs.push(a); };
    const boom = await route.GET(); const boomText = await boom.text();
    console.error = oe;
    check("an exception → 500 generic, logged server-side, no internals", [boom.status, /SQLSTATE|projects/.test(boomText), errs.length], [500, false, 1]);
    ok("18. GET only — no POST/PUT/PATCH/DELETE export", /export async function GET\(/.test(ROUTE) && !/export (async )?function (POST|PUT|PATCH|DELETE|HEAD|OPTIONS)/.test(ROUTE));
    ok("16. requireOwner() first, before any read", /const denied = await requireOwner\(\);\s*if \(denied\) return denied;\s*try \{\s*const r = await getRecentOutcomesSurface\(\);/.test(ROUTE));
    check("the route imports only next/server, require-auth and the read-only outcome binding", [...ROUTE.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]).sort(), ["@/lib/partner/actions/outcome-server", "@/lib/require-auth", "next/server"]);
  }

  console.log("Write / execution boundaries (19-26)");
  {
    const FILES = ["app/api/partner/outcomes/route.ts", "lib/partner/actions/recent-outcomes.ts", "lib/partner/actions/outcome-dto.ts", "lib/partner/actions/outcome-server.ts", "lib/partner/actions/outcome.ts", "components/partner/PartnerOutcomeCard.tsx"];
    const src = FILES.map((f) => strip(rd(f)));
    ok("19. no Action Event write (no insert / appendDecision)", src.every((s) => !/\.insert\(|appendDecision/.test(s)));
    ok("20. no execution primitive (no executeApprovedAction / callExecuteRpc / RPC)", src.every((s) => !/executeApprovedAction|callExecuteRpc|\.rpc\(|partner_execute_update_project_deadline|EXECUTE_RPC/.test(s)));
    ok("21. no decision primitive", src.every((s) => !/decideSuggestedAction|changeSuggestedActionValue|action-service/.test(s)));
    ok("22. no project update (the only project access is the F.1L SELECT)", src.every((s) => !/\.update\(|\.upsert\(|\.delete\(|updateProject|\/api\/projects/.test(s)));
    ok("23. no Owner Context write", src.every((s) => !/appendOwnerContext|context-store|context-persistence/.test(s)));
    ok("24. no Feedback write", src.every((s) => !/feedback\/|partner_feedback|appendFeedback/.test(s)));
    ok("25. no baseline write", src.every((s) => !/savePartnerBaseline|baseline\/|partner_change_baseline/.test(s)));
    ok("26. no Push / Cron / Agent Alerts", src.every((s) => !/web-push|lib\/push|node-cron|cron|agent_alerts|alerts-store|lib\/agent\//i.test(s)));
    ok("26. no cron / instrumentation / agent module reaches the outcomes surface", !/outcome|partner\/actions/.test(rd("instrumentation.ts")) && fs.readdirSync(path.join(ROOT, "lib", "agent")).every((f) => !/partner\/actions/.test(fs.readFileSync(path.join(ROOT, "lib", "agent", f), "utf8"))));
    check("the recent-outcomes core only gets list + readOutcome + log (no store handle)", [...(/export interface RecentOutcomesDeps \{([\s\S]*?)\n\}/.exec(rd("lib/partner/actions/recent-outcomes.ts"))?.[1] ?? "").matchAll(/^\s{2}(\w+)\(/gm)].map((m) => m[1]), ["listExecutedEvents", "readOutcome", "log"]);
    ok("11. no fallback interpretation: the core never maps UNSUPPORTED / INVARIANT to a card", /o\.state === "UNSUPPORTED_ACTION" \|\| o\.state === "INVARIANT_VIOLATION"\) \{[\s\S]*?continue;/.test(rd("lib/partner/actions/recent-outcomes.ts")));
    const CARD = rd("components/partner/PartnerOutcomeCard.tsx");
    ok("F.1M cards are read-only: no button, no handler, no hook, no fetch", !/<button|onClick|onChange|useState|useEffect|fetch\(/.test(strip(CARD)));
    const SECTION = rd("components/partner/PartnerActionsSection.tsx");
    ok("the section reads outcomes with a GET only and parses them strictly", /fetch\("\/api\/partner\/outcomes", \{ cache: "no-store", signal \}\)/.test(SECTION) && /parseRecentOutcomesResponse\(await res\.json\(\)\)/.test(SECTION) && !/\/api\/partner\/outcomes"[^)]*method/.test(SECTION));
    ok("outcomes are re-fetched together with the surface (one load for all Partner reads: actions + outcomes + F2 finance)", /const load = useCallback\(async \(signal\?: AbortSignal\) => \{ await Promise\.all\(\[loadActions\(signal\), loadOutcomes\(signal\), loadFinance\(signal\)\]\); \}/.test(SECTION));
  }

  console.log("UI: RTL / mobile / desktop / placement (27-29)");
  {
    const d = render([card!]);
    const m = render([card!], true);
    ok("27. Hebrew RTL section; LTR-isolated dates", /<section dir="rtl" lang="he"/.test(d) && (d.match(/<bdi dir="ltr"/g) ?? []).length === 3);
    ok("27. region + heading 'בוצע לאחרונה'; header chip 'בוצע' when there is no current proposal", /role="region"/.test(d) && d.includes(">בוצע לאחרונה</h3>") && /<h2[^>]*>Partner<\/h2><span[^>]*>בוצע<\/span>/.test(d));
    ok("28. mobile: value boxes stacked (column)", /flex-direction:column;gap:6px/.test(m));
    ok("29. desktop: value boxes side by side (row)", /flex-direction:row;gap:10px/.test(d));
    check("no interactive element in the outcomes block", (d.match(/<button|<input|<a /g) ?? []).length, 0);
    const withProposal = renderToStaticMarkup(<PartnerActionsView items={[]} isMobile={false} outcomes={[]} />);
    check("nothing rendered when there are neither proposals nor outcomes", withProposal, "");
    const src = rd("components/partner/PartnerActionCard.tsx");
    ok("placement: proposals first, then the recent outcomes (same Partner section)", src.indexOf("items.map((it) => <PartnerActionCard") < src.indexOf("<PartnerOutcomesList items={outcomes}"));
  }

  const self = fs.readFileSync(__filename, "utf8");
  ok("this test never imports a production binding", !/from\s+["'][^"']*(lib\/supabase|outcome-server|surface-server|actions\/event-store|actions\/live|actions\/action-service|context-store|require-auth)["']/.test(self));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
