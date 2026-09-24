/**
 * Tests — Redbloods Partner read-only Action surface (Phase F.1I).
 *
 * Run with:   npx tsx scripts/test-partner-action-surface.tsx
 *
 * Pure: the surface core runs with injected fakes (no Supabase, never
 * production); the card is rendered with react-dom/server. Fixture = the real
 * production chain for "קרוב אלייך". Writes an HTML preview of the real card
 * (mobile + desktop) to F1I_PREVIEW_DIR when set, for headless screenshots.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { CASE_SCHEMA_VERSION, type PartnerCase } from "../lib/partner/cases/types";
import type { PersistedOwnerContext } from "../lib/partner/investigation/context-row";
import { deriveCaseDecisionState } from "../lib/partner/investigation";
import { deriveSuggestedActions, type PartnerSuggestedAction } from "../lib/partner/actions";
import { buildActionSnapshot, hashActionSnapshot } from "../lib/partner/actions/snapshot";
import type { PartnerActionEvent } from "../lib/partner/actions/events";
import type { ActionChainReadResult } from "../lib/partner/actions/event-persistence";
import { buildActionSurface, type ActionSurfaceDeps } from "../lib/partner/actions/surface";
import { parseActionSurfaceResponse, toActionCardDto, type PartnerActionCardDto } from "../lib/partner/actions/surface-dto";
import { PartnerActionsView } from "../components/partner/PartnerActionCard";
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
const ACTION_ID = `UPDATE_PROJECT_DEADLINE:${PID}:${B_ID}:2026-10-07`;
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
  questionTextHe: "q", caseFactsFingerprint: FP, note: "IN_ONE_WEEK 2027-01-01 — never parsed", answeredAt: "2026-09-23T09:10:08.684Z", scope: "CASE_INSTANCE",
  provenance: { source: "owner_manual" }, caseSchemaVersion: CASE_SCHEMA_VERSION, supersedesId: null,
};
const B: PersistedOwnerContext = {
  id: B_ID, schemaVersion: "partner-owner-context-schema-v2", questionId: `${CASE_ID}::WHAT_IS_NEW_PROJECT_DEADLINE`, questionType: "WHAT_IS_NEW_PROJECT_DEADLINE",
  caseId: CASE_ID, caseType: "PROJECT_DEADLINE_PASSED", subjectType: "project", subjectId: PID, answerCode: "IN_TWO_WEEKS",
  answerValue: { kind: "DATE", ymd: "2026-10-07", resolution: { method: "RELATIVE", rule: "PLUS_14_DAYS", anchorYmd: "2026-09-23", timeZone: "Asia/Jerusalem" } },
  triggerContextId: A_ID, questionTextHe: "q", caseFactsFingerprint: FP, note: null, answeredAt: "2026-09-23T09:50:47.036Z", scope: "CASE_INSTANCE",
  provenance: { source: "owner_manual" }, caseSchemaVersion: CASE_SCHEMA_VERSION, supersedesId: null,
};
const action: PartnerSuggestedAction = deriveSuggestedActions({ case: C, decisionState: deriveCaseDecisionState(C, [A, B]), subjectLabelHe: LABEL }).actions[0];
const HASH = hashActionSnapshot(buildActionSnapshot(action, C));

function ev(type: PartnerActionEvent["eventType"], sup: string | null, extra: Partial<PartnerActionEvent> = {}): PartnerActionEvent {
  return {
    id: randomUUID(), createdAt: new Date().toISOString(), requestId: randomUUID(), actionId: ACTION_ID, actionType: "UPDATE_PROJECT_DEADLINE", subjectType: "project", subjectId: PID,
    eventType: type, supersedesEventId: sup, actorKind: "OWNER", actorUserId: randomUUID(), snapshot: buildActionSnapshot(action, C), snapshotHash: HASH,
    revalidation: {}, execution: type === "EXECUTED" || type === "STALE_AT_EXECUTION" ? {} : null, deferChoice: null, deferUntil: null, note: null, ...extra,
  };
}
function deps(chain: ActionChainReadResult | PartnerActionEvent[], opts: { listFails?: boolean; items?: boolean } = {}): ActionSurfaceDeps & { logs: string[]; chainReads: number } {
  const logs: string[] = [];
  const d = {
    logs, chainReads: 0,
    listProposals: async () => opts.listFails ? { status: "READ_FAILED" as const, detail: "boom secret-ish internal" } : { status: "OK" as const, items: opts.items === false ? [] : [{ action, caseRef: C, subjectLabelHe: LABEL }] },
    getActionChain: async (_id: string): Promise<ActionChainReadResult> => { d.chainReads++; if (Array.isArray(chain)) { const [head] = chain.slice(-1); return { status: "OK", chain, head: head ?? null }; } return chain; },
    now: () => new Date("2026-09-23T12:00:00Z"),
    log: (e: string, data: Record<string, unknown>) => { logs.push(`${e}:${JSON.stringify(data)}`); },
  };
  return d;
}

async function main() {
  console.log("Real card (1-4)");
  const d0 = deps([]);
  const r = await buildActionSurface(d0);
  const item = (r.status === "OK" ? r.response.items[0] : undefined) as PartnerActionCardDto | undefined;
  check("1. real PROPOSED + empty chain → SHOW → exactly one card", [r.status, r.status === "OK" ? r.response.items.length : -1, r.status === "OK" ? r.states[ACTION_ID] : null], ["OK", 1, "SHOW"]);
  check("2. project name (from the live label, not hardcoded)", [item?.projectName, item?.projectId, item?.headlineHe], [LABEL, PID, "הדדליין של 'קרוב אלייך' לא מעודכן."]);
  check("3. from / to dates (ISO + Hebrew display)", [item?.currentDeadline, item?.currentDeadlineHe, item?.suggestedDeadline, item?.suggestedDeadlineHe], ["2026-07-14", "14.07.2026", "2026-10-07", "07.10.2026"]);
  check("4. reason = the deterministic explanation's structured 'why'", item?.reasonHe, "ציינת שהדדליין הישן לא עודכן, ולאחר מכן בחרת יעד חדש של עוד שבועיים.");
  check("4. full explanation is the derived one", item?.explanationHe, "לעדכן את הדדליין של 'קרוב אלייך' מ-14.07.2026 ל-07.10.2026.\n\nהסיבה: ציינת שהדדליין הישן לא עודכן, ולאחר מכן בחרת יעד חדש של עוד שבועיים.");
  check("4. …and it rests on the structured evidence (A: DEADLINE_NOT_UPDATED, B: IN_TWO_WEEKS → 2026-10-07)", action.evidence.map((e) => e.kind === "OWNER_CONTEXT" ? e.answerCode : e.kind === "RESOLVED_VALUE" ? e.value.ymd : `${e.field}=${e.value}`), ["deadline=2026-07-14", "DEADLINE_NOT_UPDATED", "IN_TWO_WEEKS", "2026-10-07"]);
  ok("4. the note is never surfaced", !JSON.stringify(r).includes("never parsed"));
  check("status label", item?.statusLabelHe, "הצעה לפעולה");
  check("DTO v3: display data + what a decision must echo (hash, head, approval id) — no snapshot body, no actor", Object.keys(item ?? {}).sort(), ["actionId", "actionType", "approvalEventId", "changeValueOptions", "currentDeadline", "currentDeadlineHe", "explanationHe", "headEventId", "headlineHe", "minChangeDate", "projectId", "projectName", "reasonHe", "snapshotHash", "state", "statusLabelHe", "suggestedDeadline", "suggestedDeadlineHe", "v"]);
  check("v2: SHOW state, exact live snapshot hash, empty chain head", [item?.state, item?.snapshotHash, item?.headEventId], ["SHOW", HASH, null]);
  check("v2: change options = the date answers of WHAT_IS_NEW_PROJECT_DEADLINE (with its labels)", item?.changeValueOptions, [{ code: "IN_ONE_WEEK", labelHe: "עוד שבוע" }, { code: "IN_TWO_WEEKS", labelHe: "עוד שבועיים" }, { code: "END_OF_MONTH", labelHe: "סוף החודש" }, { code: "SPECIFIC_DATE", labelHe: "לבחור תאריך" }]);
  check("v2: min change date = today (Israel)", item?.minChangeDate, "2026-09-23");

  console.log("States (5-9)");
  const empty = await buildActionSurface(deps([], { items: false }));
  check("5. no actions → empty list", empty.status === "OK" ? empty.response.items : null, []);
  check("5. empty → the view renders nothing", renderToStaticMarkup(<PartnerActionsView items={[]} isMobile={false} />), "");
  const nn = ev("NOT_NOW", null, { deferChoice: "TOMORROW", deferUntil: "2026-09-24T06:00:00.000Z" });
  const hidden = await buildActionSurface(deps([nn]));
  check("6. NOT_NOW before defer_until → HIDDEN, not rendered", [hidden.status === "OK" ? hidden.states[ACTION_ID] : null, hidden.status === "OK" ? hidden.response.items.length : -1], ["HIDDEN", 0]);
  const sup = await buildActionSurface(deps([ev("REJECTED", null)]));
  check("7. REJECTED → SUPPRESSED, not rendered", [sup.status === "OK" ? sup.states[ACTION_ID] : null, sup.status === "OK" ? sup.response.items.length : -1], ["SUPPRESSED", 0]);
  const ap = ev("APPROVED", null);
  const awaiting = await buildActionSurface(deps([ap]));
  check("AWAITING_EXECUTION → a calm approved card, not a fresh proposal", [awaiting.status === "OK" ? awaiting.states[ACTION_ID] : null, awaiting.status === "OK" ? awaiting.response.items.map((i) => [i.state, i.statusLabelHe, i.headEventId === ap.id]) : null], ["AWAITING_EXECUTION", [["AWAITING_EXECUTION", "אושר — ממתין לביצוע", true]]]);
  const done = await buildActionSurface(deps([ap, ev("EXECUTED", ap.id)]));
  check("8. EXECUTED → DONE, not rendered", [done.status === "OK" ? done.states[ACTION_ID] : null, done.status === "OK" ? done.response.items.length : -1], ["DONE", 0]);
  const branchDeps = deps([ap, ev("REJECTED", ap.id), ev("NOT_NOW", ap.id, { deferChoice: "TOMORROW", deferUntil: "2026-09-30T00:00:00Z" })]);
  const blocked = await buildActionSurface(branchDeps);
  check("9. branched chain → BLOCKED, not rendered, logged server-side", [blocked.status === "OK" ? blocked.states[ACTION_ID] : null, blocked.status === "OK" ? blocked.response.items.length : -1, branchDeps.logs.some((l) => l.startsWith("partner_action_surface_blocked"))], ["BLOCKED", 0, true]);
  ok("9. BLOCKED exposes no internal chain data to the Owner payload", blocked.status === "OK" && JSON.stringify(blocked.response) === JSON.stringify({ v: 3, items: [] }));
  const unreadable = await buildActionSurface(deps({ status: "INVALID_STORED_EVENT", errors: ["x"] }));
  check("9. unreadable chain → fail closed (not rendered)", unreadable.status === "OK" ? [unreadable.states[ACTION_ID], unreadable.response.items.length] : null, ["BLOCKED", 0]);
  const failedRead = await buildActionSurface(deps({ status: "READ_FAILED", detail: "x" }));
  check("9. chain read failure → fail closed", failedRead.status === "OK" ? failedRead.response.items.length : -1, 0);
  const unavailable = await buildActionSurface(deps([], { listFails: true }));
  check("live state unreadable → UNAVAILABLE (route answers 503, card renders nothing)", unavailable.status, "UNAVAILABLE");
  const staleDeps = deps([]);
  staleDeps.listProposals = async () => ({ status: "OK", items: [{ action: { ...action, status: "STALE" }, caseRef: C, subjectLabelHe: LABEL }] });
  const stale = await buildActionSurface(staleDeps);
  check("a STALE derived action is never surfaced", stale.status === "OK" ? stale.response.items.length : -1, 0);

  console.log("Fail-closed client parsing (14)");
  const good = { v: 3, items: [item] };
  check("valid payload parses", parseActionSurfaceResponse(JSON.parse(JSON.stringify(good))).ok, true);
  const bad: Array<[string, unknown]> = [
    ["null", null], ["array", [item]], ["old version", { v: 2, items: [item] }], ["items not an array", { v: 3, items: {} }], ["extra top-level key", { v: 3, items: [item], debug: {} }],
    ["missing field", { v: 3, items: [{ ...item, reasonHe: undefined }] }], ["extra field (snapshot)", { v: 3, items: [{ ...item, snapshot: {} }] }],
    ["bad date", { v: 3, items: [{ ...item, suggestedDeadline: "07.10.2026" }] }], ["same from/to", { v: 3, items: [{ ...item, suggestedDeadline: item?.currentDeadline }] }],
    ["wrong action type", { v: 3, items: [{ ...item, actionType: "DELETE_PROJECT" }] }], ["empty text", { v: 3, items: [{ ...item, headlineHe: "" }] }],
    ["non-string name", { v: 3, items: [{ ...item, projectName: 42 }] }], ["wrong status label", { v: 3, items: [{ ...item, statusLabelHe: "אושר" }] }], ["bad hash", { v: 3, items: [{ ...item, snapshotHash: "abc" }] }], ["bad head", { v: 3, items: [{ ...item, headEventId: "not-a-uuid" }] }], ["unknown state", { v: 3, items: [{ ...item, state: "DONE" }] }], ["foreign change option", { v: 3, items: [{ ...item, changeValueOptions: [{ code: "NOT_KNOWN_YET", labelHe: "x" }] }] }],
  ];
  for (const [label, payload] of bad) ok(`14. malformed (${label}) → fail closed`, parseActionSurfaceResponse(JSON.parse(JSON.stringify(payload ?? null))).ok === false);

  console.log("Rendering (15-17)");
  const items: PartnerActionCardDto[] = [item!];
  const desktop = renderToStaticMarkup(<PartnerActionsView items={items} isMobile={false} />);
  const mobile = renderToStaticMarkup(<PartnerActionsView items={items} isMobile={true} />);
  ok("15. RTL + Hebrew section", /<section dir="rtl" lang="he"/.test(desktop));
  ok("15. labels in Hebrew (מה קיים עכשיו / מה Partner מציע / למה / הצעה לפעולה)", ["מה קיים עכשיו", "מה Partner מציע", "למה", "הצעה לפעולה"].every((s) => desktop.includes(s)));
  ok("15. dates isolated LTR (bdi) so digits never reorder", (desktop.match(/<bdi dir="ltr"/g) ?? []).length === 2 && desktop.includes("14.07.2026") && desktop.includes("07.10.2026"));
  ok("current is shown before suggested (reading order)", desktop.indexOf("14.07.2026") < desktop.indexOf("07.10.2026"));
  ok("name + headline + reason rendered", desktop.includes("הדדליין של &#x27;קרוב אלייך&#x27; לא מעודכן.") && desktop.includes("ציינת שהדדליין הישן לא עודכן, ולאחר מכן בחרת יעד חדש של עוד שבועיים."));
  ok("without decision controls (no handlers wired) the card renders no buttons / inputs / links", !/<button|<input|<a |onclick|href=/i.test(desktop + mobile));
  ok("16. mobile layout: compact padding, dates stacked with ↓", mobile.includes("padding:12px 12px 10px") && mobile.includes("flex-direction:column") && mobile.includes("↓") && !mobile.includes("←"));
  ok("17. desktop layout: wider padding, dates side by side with ←", desktop.includes("padding:14px 16px 12px") && desktop.includes("flex-direction:row") && desktop.includes("gap:12px") && desktop.includes("←"));
  ok("the current deadline is not struck through (it is still the real value)", !/line-through/.test(desktop + mobile));
  ok("escaped text (no raw HTML injection path)", renderToStaticMarkup(<PartnerActionsView items={[{ ...item!, reasonHe: "<img src=x onerror=alert(1)>" }]} isMobile={false} />).includes("&lt;img"));
  if (process.env.F1I_PREVIEW_DIR) {
    const page = (body: string, w: number) => `<!doctype html><html lang="he"><head><meta charset="utf-8"><style>body{margin:0;background:#0E0E0E;font-family:system-ui,-apple-system,"Segoe UI",Arial,sans-serif;padding:16px;width:${w - 32}px}</style></head><body>${body}</body></html>`;
    fs.writeFileSync(path.join(process.env.F1I_PREVIEW_DIR, "f1i-desktop.html"), page(desktop, 900));
    fs.writeFileSync(path.join(process.env.F1I_PREVIEW_DIR, "f1i-mobile.html"), page(mobile, 390));
    console.log(`  (preview written to ${process.env.F1I_PREVIEW_DIR})`);
  }

  console.log("Write safety + auth (10-13)");
  {
    const ROOT = path.resolve(__dirname, "..");
    const files = ["lib/partner/actions/surface.ts", "lib/partner/actions/surface-server.ts", "lib/partner/actions/surface-dto.ts", "app/api/partner/actions/route.ts", "components/partner/PartnerActionsSection.tsx", "components/partner/PartnerActionCard.tsx"];
    const src = Object.fromEntries(files.map((f) => [f, fs.readFileSync(path.join(ROOT, f), "utf8")]));
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    ok("10. no decision / write primitive referenced (decideSuggestedAction / appendDecision / action-service / event-persistence writes)", Object.values(src).every((s) => !/decideSuggestedAction|executeApprovedAction|appendDecision|action-service|\.insert\(|\.update\(|\.upsert\(|\.delete\(/.test(strip(s))));
    ok("11. no RPC execution path (no callExecuteRpc / .rpc( / partner_execute_update_project_deadline)", Object.values(src).every((s) => !/callExecuteRpc|\.rpc\(|partner_execute_update_project_deadline/.test(strip(s))));
    ok("12. no Owner Context write (no appendOwnerContext / context-persistence)", Object.values(src).every((s) => !/appendOwnerContext|context-persistence/.test(strip(s))));
    // F2.31: + the finance chain READ (no decision / append / RPC capability reaches the surface)
    ok("the surface binding gets ONLY chain reads from the store (deadline + finance)", /getActionChain: \(actionId\) => actionEventStore\.getActionChain\(actionId\)/.test(src["lib/partner/actions/surface-server.ts"]) && (strip(src["lib/partner/actions/surface-server.ts"]).match(/actionEventStore\.\w+/g) ?? []).every((m) => m === "actionEventStore.getActionChain" || m === "actionEventStore.getFinanceActionChain"));
    ok("no Feedback / baseline / Push / Cron / Alerts write", Object.values(src).every((s) => !/feedback\/store|appendFeedback|savePartnerBaseline|baseline\/store|web-push|node-cron|agent_alerts/.test(strip(s))));
    ok("13. route: requireOwner() before any work, GET only", /const denied = await requireOwner\(\);\s*if \(denied\) return denied;/.test(src["app/api/partner/actions/route.ts"]) && !/export (async )?function (POST|PUT|PATCH|DELETE)/.test(src["app/api/partner/actions/route.ts"]));
    ok("13. client section is Owner-gated in the UI too", /if \(role !== "owner"\) return null;/.test(src["components/partner/PartnerActionsSection.tsx"]));
    check("13. no non-owner role may reach /api/partner/actions (proxy allowlists)", [isVictorAllowedPath, isStevenAllowedPath, isShalevAllowedPath, isCleantoneAllowedPath, isAviAllowedPath].map((f) => f("/api/partner/actions")), [false, false, false, false, false]);
    ok("13. /api/partner is not a public bypass", !/\/api\/partner/.test(fs.readFileSync(path.join(ROOT, "proxy.ts"), "utf8")));
    ok("mounted once, on the dashboard, right under the COO brief", /<CooSection \/>\s*\n\s*\{\/\* ── Redbloods Partner[^\n]*\*\/\}\s*\n\s*<PartnerActionsSection isMobile=\{isMobile\} \/>/.test(fs.readFileSync(path.join(ROOT, "components/dashboard/DashboardDesignPreview.tsx"), "utf8")));
    ok("no AI / Chrome dependency", Object.values(src).every((s) => !/openai|anthropic|claude-in-chrome|puppeteer|playwright/i.test(strip(s))));
    const self = fs.readFileSync(__filename, "utf8");
    ok("this test never imports a production binding", !/from\s+["'][^"']*(lib\/supabase|surface-server|actions\/event-store|actions\/live|actions\/action-service)["']/.test(self));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
