/**
 * Tests — Redbloods Partner "בצע עכשיו": approved-action execution UI + route (Phase F.1K).
 *
 * Run with:   npx tsx scripts/test-partner-action-execute.tsx
 *
 * NEVER touches production:
 *   - the REAL execute route runs in-process with its only dependency (action-service →
 *     executeApprovedAction) replaced by a fake that either answers an auth failure or runs the
 *     REAL executeApprovedActionCore against an in-memory Action Event store + scripted RPC;
 *   - cards are rendered with react-dom/server from the REAL surface builder;
 *   - the REAL PartnerActionsSection is bundled (esbuild) and driven in headless Chrome against a
 *     faked fetch (no network, no server): clicks, double clicks, retry, re-fetch;
 *   - static guards cover the execution boundaries.
 * Fixture = the real "קרוב אלייך" chain (2026-07-14 → 2026-10-07).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Module from "node:module";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { CASE_SCHEMA_VERSION, type PartnerCase } from "../lib/partner/cases/types";
import type { PersistedOwnerContext } from "../lib/partner/investigation/context-row";
import { resolveAnswerValue } from "../lib/partner/investigation/answer-value";
import { deriveCaseDecisionState } from "../lib/partner/investigation";
import { deriveSuggestedActions, type PartnerSuggestedAction } from "../lib/partner/actions";
import { mapActionEventRow, type ActionEventInsertRow } from "../lib/partner/actions/events";
import { createActionEventStore, type ActionEventDbResponse, type ActionEventTableClient, type ActionEventSelectQuery, type ExecuteRpcArgs } from "../lib/partner/actions/event-persistence";
import { decideSuggestedActionCore, executeApprovedActionCore, type ActionServiceDeps, type LiveActionLookup, type LiveCaseView } from "../lib/partner/actions/service";
import { buildActionSurface } from "../lib/partner/actions/surface";
import { parseActionSurfaceResponse, ACTION_SURFACE_DTO_VERSION, type ActionSurfaceItemDto, type PartnerActionCardDto } from "../lib/partner/actions/surface-dto";
import { PartnerActionsView, type CardControls } from "../components/partner/PartnerActionCard";
import { EXECUTE_STALE_MESSAGE_HE, EXECUTE_URL, STALE_MESSAGE_HE, buildExecuteAttempt, interpretExecuteResponse, phaseForOutcome } from "../components/partner/partner-decision-client";
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
const R_ID = "c3333333-3333-4333-8333-333333333333";
const FP = "cc7d8bca34c49059";
const LABEL = "קרוב אלייך";
const OWNER = "5f1c1d2e-0000-4000-8000-00000000aaaa";
const caseWith = (deadline: string): PartnerCase => ({
  id: CASE_ID, schemaVersion: CASE_SCHEMA_VERSION, caseType: "PROJECT_DEADLINE_PASSED", subjectType: "project", subjectId: PID,
  classification: "RISK", status: "OPEN", createdFrom: "STATE",
  facts: [{ domain: "projects", entityId: PID, field: "deadline", value: deadline, label: "deadline" }, { domain: "projects", entityId: PID, field: "status", value: "במיקס", label: "status" }],
  derivedFacts: [], hypotheses: [], ownerRulesApplied: [], workingPrinciplesApplied: [], unknowns: [], dataQuality: { notes: [] },
  interventionStyle: "GENTLE", summaryHe: "", changeContext: null,
});
const C = caseWith("2026-07-14");
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
const revisedValue = resolveAnswerValue("WHAT_IS_NEW_PROJECT_DEADLINE", "SPECIFIC_DATE", { anchorYmd: "2026-09-23", explicitYmd: "2026-10-30" });
if (!revisedValue.ok) throw new Error("fixture: revised value");
const R: PersistedOwnerContext = { ...B, id: R_ID, answerCode: "SPECIFIC_DATE", answerValue: revisedValue.value, supersedesId: B_ID, answeredAt: "2026-09-23T12:00:00.000Z" };
const derive = (c: PartnerCase, h: PersistedOwnerContext[]) => deriveSuggestedActions({ case: c, decisionState: deriveCaseDecisionState(c, h), subjectLabelHe: LABEL }).actions;
const action: PartnerSuggestedAction = derive(C, [A, B])[0];
const ACTION_ID = action.id;
const revisedAction = derive(C, [A, B, R]).find((a) => a.status === "PROPOSED")!;

// ── fakes ──
class FakeEvents {
  rows: Record<string, unknown>[] = [];
  rpcCalls: Array<{ fn: string; args: ExecuteRpcArgs }> = [];
  tables = new Set<string>();
  rpcResponse: ActionEventDbResponse<unknown> = { data: null, error: { code: "XX000", message: "no rpc response scripted" } };
  clock = Date.parse("2026-09-23T10:00:00Z");
  client(): ActionEventTableClient {
    const db = this;
    return {
      from(t: string) {
        db.tables.add(t);
        if (t !== "partner_action_events") throw new Error(`fake: table ${t} is not reachable from the Action store`);
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
      rpc: async (fn: string, args: ExecuteRpcArgs) => { db.rpcCalls.push({ fn, args }); return db.rpcResponse; },
    } as unknown as ActionEventTableClient;
  }
}
function liveFor(caseRef: PartnerCase | null, contexts: PersistedOwnerContext[]) {
  return {
    async findAction(id: string): Promise<LiveActionLookup> { if (!caseRef) return { status: "NOT_DERIVABLE" }; const a = derive(caseRef, contexts).find((x) => x.id === id); return a ? { status: "FOUND", action: a, caseRef } : { status: "NOT_DERIVABLE" }; },
    async loadCaseView(): Promise<LiveCaseView> { return { status: "OK", caseRef, contexts, derived: caseRef ? derive(caseRef, contexts) : [] }; },
  };
}
function setup(caseRef: PartnerCase = C, contexts = [A, B]) {
  const db = new FakeEvents();
  const audits: string[] = [];
  const deps: ActionServiceDeps = { now: () => new Date("2026-09-23T10:00:00Z"), store: createActionEventStore(db.client()), live: liveFor(caseRef, contexts), audit: (e, d) => audits.push(`${e}:${String((d as Record<string, unknown>).result ?? "")}`) };
  return { db, deps, audits };
}
async function decide(deps: ActionServiceDeps, decision: "APPROVE" | "NOT_NOW" | "REJECT", head: string | null = null, extra: Record<string, unknown> = {}) {
  const item = await surfaceItem([]);
  return decideSuggestedActionCore(deps, { userId: OWNER }, { actionId: ACTION_ID, decision, seenSnapshotHash: item!.snapshotHash, expectedHeadEventId: head, requestId: randomUUID(), ...extra });
}
/** A terminal execution row as the RPC would append it (for surfacing / render tests only). */
const execRow = (approved: Record<string, unknown>, type: "EXECUTED" | "STALE_AT_EXECUTION") => ({ ...approved, id: randomUUID(), request_id: randomUUID(), event_type: type, supersedes_event_id: approved.id, execution: {}, created_at: "2026-09-23T10:10:00+00:00" });

async function surface(chainRows: Record<string, unknown>[], opts: { now?: string; proposals?: Array<{ action: PartnerSuggestedAction; caseRef: PartnerCase }> } = {}) {
  const events = chainRows.map((r) => { const m = mapActionEventRow(r); if (!m.ok) throw new Error(m.errors.join()); return m.value; });
  const r = await buildActionSurface({
    listProposals: async () => ({ status: "OK", items: (opts.proposals ?? [{ action, caseRef: C }]).map((p) => ({ ...p, subjectLabelHe: LABEL })) }),
    getActionChain: async (id) => { const own = events.filter((e) => e.actionId === id); return { status: "OK", chain: own, head: own[own.length - 1] ?? null }; },
    now: () => new Date(opts.now ?? "2026-09-23T12:00:00Z"), log: () => {},
  });
  if (r.status !== "OK") throw new Error("surface unavailable");
  return r;
}
async function surfaceItem(chainRows: Record<string, unknown>[], opts: { now?: string; proposals?: Array<{ action: PartnerSuggestedAction; caseRef: PartnerCase }> } = {}): Promise<PartnerActionCardDto | undefined> {
  return (await surface(chainRows, opts)).response.items[0] as PartnerActionCardDto;
}

function controls(over: Partial<CardControls> = {}): CardControls {
  const noop = () => {};
  return { phase: "idle", panel: "none", message: null, canRetry: false, notNowChoice: null, customYmd: "", changeCode: null, changeYmd: "",
    onApprove: noop, onOpenNotNow: noop, onOpenChange: noop, onCancel: noop, onRetry: noop, onNotNowChoice: noop, onCustomYmd: noop, onConfirmNotNow: noop,
    onChangeCode: noop, onChangeYmd: noop, onConfirmChange: noop, onExecute: noop, renderDatePicker: ({ ariaLabel }) => <div data-date-picker={ariaLabel} />, ...over };
}
const render = (items: ActionSurfaceItemDto[], isMobile = false, over: Partial<CardControls> = {}) => renderToStaticMarkup(<PartnerActionsView items={items} isMobile={isMobile} controlsFor={() => controls(over)} />);

// ── the REAL execute route, with its single dependency faked ──
type FakeMode = "UNAUTHORIZED" | "FORBIDDEN" | "CORE" | "THROW";
const svc = { mode: "CORE" as FakeMode, calls: [] as unknown[], deps: null as ActionServiceDeps | null };
const ML = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
const origLoad = ML._load;
ML._load = function (request: string, parent: unknown, isMain: boolean) {
  if (/partner\/actions\/action-service$/.test(request)) {
    return {
      // Stand-in for the server binding: requireOwner() → actor from the session, then the REAL core.
      async executeApprovedAction(input: unknown) {
        svc.calls.push(input);
        if (svc.mode === "UNAUTHORIZED") return { status: "UNAUTHORIZED" };
        if (svc.mode === "FORBIDDEN") return { status: "FORBIDDEN" };
        if (svc.mode === "THROW") throw new Error("boom: relation \"projects\" SQLSTATE 42501");
        return executeApprovedActionCore(svc.deps!, { userId: OWNER }, input);
      },
    };
  }
  return origLoad.call(this, request, parent, isMain);
};
const GOOD = { "content-type": "application/json", origin: "https://app.example", host: "app.example", "sec-fetch-site": "same-origin" };
type RouteModule = { POST(req: NextRequest): Promise<Response> };
let route: RouteModule;
async function post(body: unknown, headers: Record<string, string> = GOOD) {
  const req = new NextRequest("https://app.example/api/partner/actions/execute", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
  const res = await route.POST(req);
  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json: json as Record<string, unknown> | null, text, cache: res.headers.get("cache-control") };
}

// ── headless-Chrome run of the REAL section ──
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((p) => fs.existsSync(p));
const SCENARIO = String.raw`
const srv = { surface: null, gets: 0, posts: [], queue: [], release: null };
window.fetch = async (url, init) => {
  // F.1M: the section also reads the recent Outcomes (read-only GET) — served explicitly, never counted as a POST.
  // F2: the section also reads the Finance Brief (read-only GET) — served explicitly as "unavailable" (block not rendered).
  if (url === "/api/partner/finance" && (!init || !init.method || init.method === "GET")) { srv.financeGets = (srv.financeGets || 0) + 1; return new Response(JSON.stringify({ error: "x" }), { status: 503 }); }
  if (url === "/api/partner/outcomes" && (!init || !init.method || init.method === "GET")) { srv.outcomeGets = (srv.outcomeGets || 0) + 1; return new Response(JSON.stringify({ v: 1, items: [] }), { status: 200, headers: { "content-type": "application/json" } }); }
  if (url === "/api/partner/actions" && (!init || !init.method || init.method === "GET")) { srv.gets++; return new Response(JSON.stringify(srv.surface), { status: 200, headers: { "content-type": "application/json" } }); }
  srv.posts.push({ url, method: init.method, credentials: init.credentials, contentType: init.headers["Content-Type"], body: JSON.parse(init.body) });
  const next = srv.queue.shift();
  if (!next) return new Response(JSON.stringify({ status: "NO_SCRIPT" }), { status: 500 });
  if (next.hold) await new Promise((r) => { srv.release = r; });
  if (next.surfaceAfter !== undefined) srv.surface = next.surfaceAfter;
  if (next.networkError) throw new TypeError("network down");
  return new Response(typeof next.json === "string" ? next.json : JSON.stringify(next.json), { status: next.status });
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const F = window.__F1K;
let root = null;
async function mount(surface, role = "owner", isMobile = false) {
  if (root) root.unmount();
  document.body.innerHTML = '<div id="app"></div>';
  srv.surface = surface; srv.gets = 0; srv.posts = []; srv.queue = []; srv.release = null;
  window.__role = role;
  root = window.__mount(document.getElementById("app"), isMobile);
  await sleep(150);
}
const buttons = () => [...document.querySelectorAll("button")];
const btn = (label) => buttons().find((b) => b.textContent.trim() === label);
const labels = () => buttons().map((b) => b.textContent.trim());
const text = () => document.getElementById("app").textContent;
const snap = () => ({ gets: srv.gets, posts: srv.posts.length, labels: labels(), notice: (document.querySelector("[data-partner-notice]") || {}).textContent || null,
  message: (document.querySelector("[data-decision-message]") || {}).textContent || null, messagePhase: (document.querySelector("[data-decision-message]") || { dataset: {} }).dataset.decisionMessage || null,
  card: !!document.querySelector("[data-partner-action]"), awaitingNote: !!document.querySelector("[data-awaiting-note]"), approvedLine: (document.querySelector("[data-approved-change]") || {}).textContent || null });
const obs = { secure: window.isSecureContext };
(async () => {
  try {
    // non-owner: nothing rendered, nothing fetched
    await mount(F.awaiting, "victor");
    obs.nonOwner = { html: document.getElementById("app").innerHTML, gets: srv.gets, posts: srv.posts.length };

    // S1: one deliberate click (double-clicked), held response, EXECUTED, re-fetch → DONE (card gone)
    await mount(F.awaiting);
    obs.s1mount = snap();
    srv.queue.push({ hold: true, status: 200, json: { status: "EXECUTED", eventType: "EXECUTED" }, surfaceAfter: F.empty });
    const b = btn("בצע עכשיו"); b.click(); b.click(); btn("בצע עכשיו").click();
    await sleep(80);
    const busyBtn = btn("בצע עכשיו");
    obs.s1during = { ...snap(), disabled: busyBtn.disabled, ariaBusy: document.querySelector("[data-partner-action]").getAttribute("aria-busy"), saving: text().includes("שומר…"), executedShown: text().includes("הפעולה בוצעה"), post: srv.posts[0] };
    busyBtn.click();
    await sleep(40);
    obs.s1clickWhileBusy = srv.posts.length;
    srv.release();
    await sleep(200);
    obs.s1after = snap();
    await sleep(3000);
    obs.s1later = snap();

    // S2: RETRYABLE → manual retry re-sends the SAME attempt; a new click is a NEW attempt
    await mount(F.awaiting);
    srv.queue.push({ status: 503, json: { status: "RETRYABLE" } });
    btn("בצע עכשיו").click();
    await sleep(200);
    obs.s2first = snap();
    await sleep(3000);
    obs.s2noAuto = snap();
    srv.queue.push({ networkError: true });
    btn("נסה שוב").click();
    await sleep(200);
    obs.s2retry = snap();
    srv.queue.push({ status: 503, json: { status: "RETRYABLE" } });
    btn("נסה שוב").click();
    await sleep(200);
    srv.queue.push({ status: 200, json: { status: "EXECUTED", eventType: "EXECUTED" }, surfaceAfter: F.empty });
    btn("בצע עכשיו").click();
    await sleep(200);
    obs.s2final = { ...snap(), bodies: srv.posts.map((p) => p.body) };

    // S3: STALE_AT_EXECUTION → calm message, re-fetch shows the NEW proposal through the normal surface, nothing auto-approved
    await mount(F.awaiting);
    srv.queue.push({ status: 200, json: { status: "STALE_AT_EXECUTION", eventType: "STALE_AT_EXECUTION" }, surfaceAfter: F.revised });
    btn("בצע עכשיו").click();
    await sleep(200);
    obs.s3 = snap();
    await sleep(3000);
    obs.s3later = { ...snap(), urls: srv.posts.map((p) => p.url) };

    // S4: every other structured result
    obs.results = {};
    for (const c of F.cases) {
      await mount(F.awaiting);
      srv.queue.push({ status: c.status, json: c.json, surfaceAfter: c.surfaceAfter });
      btn("בצע עכשיו").click();
      await sleep(200);
      obs.results[c.name] = snap();
    }

    // S5: APPROVE on a fresh proposal never executes; the card becomes AWAITING with a deliberate [בצע עכשיו]
    await mount(F.show);
    srv.queue.push({ status: 200, json: { status: "RECORDED", eventType: "APPROVED", eventId: F.awaiting.items[0].approvalEventId, deferUntil: null }, surfaceAfter: F.awaiting });
    btn("אשר").click();
    await sleep(200);
    obs.s5 = snap();
    await sleep(3000);
    obs.s5later = { ...snap(), urls: srv.posts.map((p) => p.url) };

    // S6: keyboard basics — the button is focusable and native
    await mount(F.awaiting, "owner", true);
    const kb = btn("בצע עכשיו"); kb.focus();
    obs.s6 = { focused: document.activeElement === kb, type: kb.getAttribute("type"), tabIndex: kb.tabIndex, live: !!document.querySelector('[aria-live="polite"][role="status"]'), dir: document.querySelector("section").getAttribute("dir"), lang: document.querySelector("section").getAttribute("lang"), minHeight: getComputedStyle(kb).minHeight };
  } catch (e) { obs.error = String(e && e.stack || e); }
  const out = document.createElement("pre"); out.id = "f1k-result";
  out.textContent = btoa(unescape(encodeURIComponent(JSON.stringify(obs))));
  document.body.appendChild(out);
})();
`;

async function runSectionInChrome(ROOT: string, fixtures: Record<string, unknown>): Promise<Record<string, unknown> | { error: string }> {
  if (!CHROME) return { error: "Chrome not found" };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const esbuild = require("esbuild") as typeof import("esbuild");
  const stubs: Record<string, string> = {
    "@/lib/use-role": "export function useRole() { return window.__role; }",
    "@/components/ui/DatePickerInput": "export default function DatePickerInput() { return null; }",
  };
  const built = await esbuild.build({
    stdin: { contents: `import { createRoot } from "react-dom/client";\nimport PartnerActionsSection from "./components/partner/PartnerActionsSection";\nwindow.__mount = (el, isMobile) => { const r = createRoot(el); r.render(<PartnerActionsSection isMobile={isMobile} />); return r; };`, resolveDir: ROOT, loader: "tsx", sourcefile: "f1k-entry.tsx" },
    bundle: true, format: "iife", platform: "browser", write: false, jsx: "automatic", minify: false, logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"' }, tsconfig: path.join(ROOT, "tsconfig.json"),
    plugins: [{ name: "f1k-stubs", setup(b) {
      b.onResolve({ filter: /^@\/(lib\/use-role|components\/ui\/DatePickerInput)$/ }, (a) => ({ path: a.path, namespace: "f1k-stub" }));
      b.onLoad({ filter: /.*/, namespace: "f1k-stub" }, (a) => ({ contents: stubs[a.path], loader: "js" }));
    } }],
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "f1k-"));
  const html = path.join(dir, "section.html");
  const safe = (s: string) => s.replace(/<\/script/gi, "<\\/script");
  fs.writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8"></head><body><script>window.__F1K = ${safe(JSON.stringify(fixtures))};</script><script>${safe(built.outputFiles[0].text)}</script><script>${safe(SCENARIO)}</script></body></html>`);
  const r = spawnSync(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${path.join(dir, "profile")}`, "--virtual-time-budget=120000", "--dump-dom", `file:///${html.replace(/\\/g, "/")}`], { encoding: "utf8", timeout: 180000, maxBuffer: 64 * 1024 * 1024 });
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  const m = /<pre id="f1k-result">([A-Za-z0-9+/=]+)<\/pre>/.exec(r.stdout ?? "");
  if (!m) return { error: `no result from Chrome (status ${r.status}) ${String(r.stderr ?? "").slice(0, 400)}` };
  return JSON.parse(Buffer.from(m[1], "base64").toString("utf8"));
}

async function main() {
  const ROOT = path.resolve(__dirname, "..");
  const rd = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  const EXEC = rd("app/api/partner/actions/execute/route.ts"), DECIDE = rd("app/api/partner/actions/decide/route.ts"), CHANGE = rd("app/api/partner/actions/change-deadline/route.ts"), GETR = rd("app/api/partner/actions/route.ts");
  const SECTION = rd("components/partner/PartnerActionsSection.tsx"), CARD = rd("components/partner/PartnerActionCard.tsx"), CLIENT = rd("components/partner/partner-decision-client.ts");
  const ACTION_SERVICE = rd("lib/partner/actions/action-service.ts");
  route = require("../app/api/partner/actions/execute/route") as RouteModule; // eslint-disable-line @typescript-eslint/no-require-imports

  // Persisted chain fixtures (built by the REAL decision core).
  const base = setup();
  const ap = await decide(base.deps, "APPROVE");
  if (!("event" in ap)) throw new Error("fixture approve failed");
  const approvedRow = base.db.rows[0];
  const awaiting = (await surfaceItem([approvedRow]))!;
  const show = (await surfaceItem([]))!;
  const APPROVAL = awaiting.approvalEventId!;

  console.log("Endpoint: auth + transport (1-4)");
  {
    svc.mode = "UNAUTHORIZED"; svc.calls = [];
    const u = await post({ approvalEventId: APPROVAL, requestId: randomUUID() });
    check("1. no Owner session → 401 UNAUTHORIZED (auth resolved inside executeApprovedAction, nothing executed)", [u.status, u.json], [401, { status: "UNAUTHORIZED" }]);
    // F2.31: the Owner is resolved FIRST; only then the persisted approval picks the executor (finance → finance core,
    // otherwise the unchanged deadline core). The actor always comes from the session.
    ok("1. executeApprovedAction resolves the Owner (requireOwner + session user) BEFORE any core; actor never from input",
      /export async function executeApprovedAction\(input: unknown\)[^{]*\{\s*const a = await resolveOwnerActor\(\);\s*if \(!a\.ok\) return a\.result;/.test(ACTION_SERVICE)
      && /if \(fin\.status === "FOUND"\) return executeFinanceActionCore\(financeDeps, a\.actor, input\);\s*\}\s*return executeApprovedActionCore\(deps, a\.actor, input\);/.test(ACTION_SERVICE)
      && /requireOwner\(\)[\s\S]*getAuthUser\(\)[\s\S]*actor: \{ userId: user\.id \}/.test(ACTION_SERVICE));
    svc.mode = "FORBIDDEN";
    const f = await post({ approvalEventId: APPROVAL, requestId: randomUUID() });
    check("2. non-owner session → 403 FORBIDDEN", [f.status, f.json], [403, { status: "FORBIDDEN" }]);
    check("2. no non-owner role may reach the execute route (proxy allowlists)", [isVictorAllowedPath, isStevenAllowedPath, isShalevAllowedPath, isCleantoneAllowedPath, isAviAllowedPath].map((fn) => fn(EXECUTE_URL)), [false, false, false, false, false]);
    ok("2. the UI is Owner-gated too (no fetch, no render for other roles)", /if \(role !== "owner"\) return;/.test(SECTION) && /if \(role !== "owner"\) return null;/.test(SECTION));
    svc.mode = "CORE"; svc.calls = [];
    const bad: Array<[string, Record<string, string>]> = [
      ["text/plain", { ...GOOD, "content-type": "text/plain" }],
      ["cross-origin", { ...GOOD, origin: "https://evil.example" }],
      ["missing Origin", { "content-type": "application/json", host: "app.example" }],
      ["cross-site fetch", { ...GOOD, "sec-fetch-site": "cross-site" }],
      ["malformed Origin", { ...GOOD, origin: "not a url" }],
    ];
    const rs = [];
    for (const [, h] of bad) rs.push(await post({ approvalEventId: APPROVAL, requestId: randomUUID() }, h));
    check("3. same-origin guard (identical to F.1J): every foreign / non-JSON request → 403 FORBIDDEN_ORIGIN", rs.map((r) => [r.status, r.json?.status]), bad.map(() => [403, "FORBIDDEN_ORIGIN"]));
    ok("3. identical guard code path as F.1J (checkSameOriginJson first, readSmallJson)", [EXEC, DECIDE].every((s) => /const guard = checkSameOriginJson\(req\.headers\);\s*if \(guard\) return json\(\{ status: "FORBIDDEN_ORIGIN" \}, 403\);/.test(s) && /await readSmallJson\(req\)/.test(s)));
    const mal = [];
    for (const b of ["{not json", "[]", "null", "42", '"str"', JSON.stringify({ approvalEventId: APPROVAL, requestId: randomUUID(), pad: "x".repeat(5000) })]) mal.push(await post(b));
    check("4. malformed / array / scalar / oversize (>4KB) body → 400 INVALID_INPUT", mal.map((r) => [r.status, r.json?.status]), mal.map(() => [400, "INVALID_INPUT"]));
    check("3/4. …and the primitive was NEVER called for any of them", svc.calls.length, 0);
    ok("POST only: the route exports no GET/PUT/PATCH/DELETE; responses are no-store", /export async function POST\(/.test(EXEC) && !/export (async )?function (GET|PUT|PATCH|DELETE|HEAD|OPTIONS)/.test(EXEC) && rs[0].cache === "no-store");
  }

  console.log("Endpoint: input whitelist (5-9)");
  {
    svc.mode = "CORE"; svc.calls = [];
    const rid = randomUUID();
    const cases: Array<[string, unknown]> = [
      ["5. approvalEventId missing", { requestId: rid }],
      ["5. approvalEventId not a uuid", { approvalEventId: "approval-1", requestId: rid }],
      ["5. approvalEventId uppercase", { approvalEventId: APPROVAL.toUpperCase(), requestId: rid }],
      ["6. requestId missing", { approvalEventId: APPROVAL }],
      ["6. requestId empty", { approvalEventId: APPROVAL, requestId: "" }],
      ["6. requestId number", { approvalEventId: APPROVAL, requestId: 7 }],
      ["7. client actor (actorUserId)", { approvalEventId: APPROVAL, requestId: rid, actorUserId: OWNER }],
      ["7. client actor (userId)", { approvalEventId: APPROVAL, requestId: rid, userId: OWNER }],
      ["7. client actor (actor)", { approvalEventId: APPROVAL, requestId: rid, actor: { userId: OWNER } }],
      ["8. client snapshot", { approvalEventId: APPROVAL, requestId: rid, snapshot: { proposedChange: { to: "2027-01-01" } } }],
      ["8. client snapshotHash", { approvalEventId: APPROVAL, requestId: rid, snapshotHash: "0".repeat(64) }],
      ["8. client seenSnapshotHash", { approvalEventId: APPROVAL, requestId: rid, seenSnapshotHash: "0".repeat(64) }],
      ["9. client from", { approvalEventId: APPROVAL, requestId: rid, from: "2026-07-14" }],
      ["9. client to", { approvalEventId: APPROVAL, requestId: rid, to: "2027-01-01" }],
      ["9. client deadline / projectId", { approvalEventId: APPROVAL, requestId: rid, deadline: "2027-01-01", projectId: PID }],
      ["9. client actionId", { approvalEventId: APPROVAL, requestId: rid, actionId: ACTION_ID }],
    ];
    for (const [name, body] of cases) {
      const r = await post(body);
      check(`${name} → 400 INVALID_INPUT before the primitive`, [r.status, r.json?.status], [400, "INVALID_INPUT"]);
    }
    check("5-9. the primitive was never reached by any rejected body", svc.calls.length, 0);
    const s = setup();
    const a2 = await decide(s.deps, "APPROVE");
    const forged = await executeApprovedActionCore(s.deps, { userId: OWNER }, { approvalEventId: "event" in a2 ? a2.event.id : "", requestId: randomUUID(), to: "2027-01-01", actorUserId: randomUUID(), snapshot: {} });
    check("7-9. defence in depth: the core itself also refuses actor / snapshot / values (no RPC)", [forged.status, s.db.rpcCalls.length], ["INVALID_INPUT", 0]);
  }

  console.log("Endpoint → executeApprovedAction → RPC only (10-11)");
  {
    const s = setup();
    const a2 = await decide(s.deps, "APPROVE");
    const approvalId = "event" in a2 ? a2.event.id : "";
    svc.deps = s.deps; svc.mode = "CORE"; svc.calls = [];
    const evId = randomUUID(), rid = randomUUID();
    s.db.rpcResponse = { data: { result: "EXECUTED", eventId: evId, eventType: "EXECUTED", actionId: ACTION_ID, from: "2026-07-14", to: "2026-10-07" }, error: null };
    const r = await post({ approvalEventId: approvalId, requestId: rid });
    check("10. valid body → executeApprovedAction called ONCE with EXACTLY {approvalEventId, requestId}", svc.calls, [{ approvalEventId: approvalId, requestId: rid }]);
    check("10. → 200 {status: EXECUTED, eventType} (minimal, no values / internals)", [r.status, r.json], [200, { status: "EXECUTED", eventType: "EXECUTED" }]);
    const call = s.db.rpcCalls[0];
    check("10. the ONLY business call is the approved RPC, actor from the session, values from the stored approval", [s.db.rpcCalls.length, call.fn, call.args.p_actor_user_id, call.args.p_approval_event_id, call.args.p_request_id, call.args.p_action_id], [1, "partner_execute_update_project_deadline", OWNER, approvalId, rid, ACTION_ID]);
    check("11. TypeScript never touches projects (the store only ever reaches partner_action_events)", [...s.db.tables], ["partner_action_events"]);
    ok("10. the route imports ONLY next/server, request-guard and executeApprovedAction from action-service", (() => {
      const imports = [...EXEC.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]).sort();
      return JSON.stringify(imports) === JSON.stringify(["@/lib/partner/actions/action-service", "@/lib/partner/actions/request-guard", "next/server"]) && /^import \{ executeApprovedAction \} from "@\/lib\/partner\/actions\/action-service";$/m.test(EXEC);
    })());
    ok("10. the route has exactly one primitive call and no other execution / DB path", (strip(EXEC).match(/executeApprovedAction\(/g) ?? []).length === 1 && !/\.rpc\(|callExecuteRpc|partner_execute_update_project_deadline|createClient|supabase|decideSuggestedAction|changeSuggestedActionValue|appendDecision/.test(strip(EXEC)));
    const F1K_FILES = ["app/api/partner/actions/execute/route.ts", "components/partner/PartnerActionsSection.tsx", "components/partner/PartnerActionCard.tsx", "components/partner/partner-decision-client.ts", "lib/partner/actions/surface.ts", "lib/partner/actions/surface-dto.ts"];
    ok("11. no direct project update in any F.1K file", F1K_FILES.every((f) => !/from\(\s*["']projects["']|\.update\(|updateProject|\/api\/projects/.test(strip(rd(f)))));
    ok("11. the route never sends deadline values or SQL details to the client", !/from:|to:|deadline|detail\b(?!\))/.test(strip(EXEC).replace(/console\.error\([^\n]*\)/g, "")));
    ok("GET surface route stays read-only (no execution from the read path)", !/executeApprovedAction|callExecuteRpc|\.rpc\(|decideSuggestedAction|export async function POST/.test(strip(GETR)));
  }

  console.log("No automatic execution after APPROVE (12)");
  {
    const s = setup();
    const a2 = await decide(s.deps, "APPROVE");
    check("12. APPROVE records APPROVED and never calls the RPC", [a2.status, s.db.rpcCalls.length, s.db.rows.map((r) => r.event_type)], ["RECORDED", 0, ["APPROVED"]]);
    ok("12. decide / change routes never reference execution", [DECIDE, CHANGE].every((f) => !/executeApprovedAction|callExecuteRpc|\/execute|partner_execute_update_project_deadline/.test(strip(f))));
    ok("12. the section builds an execute attempt ONLY in the explicit onExecute handler; APPROVE success only re-fetches", (strip(SECTION).match(/buildExecuteAttempt\(/g) ?? []).length === 1 && /onExecute: \(\) => submit\(item\.actionId, executeAttempt\(buildExecuteAttempt\(item, newRequestId\(\)\)\)\)/.test(SECTION) && !/onApprove:[^\n]*execute/i.test(SECTION));
    ok("12. submit() never chains another submit (no auto-execute / auto-retry loop)", (() => { const body = /const submit = useCallback\(async[\s\S]*?\}, \[load\]\);/.exec(strip(SECTION))?.[0] ?? ""; return body.length > 0 && !/submit\(|setTimeout|setInterval|executeAttempt|buildExecuteAttempt/.test(body.replace(/^const submit = /, "")); })());
    check("12. the client builds no execute attempt for a SHOW (not yet approved) card", buildExecuteAttempt(show, randomUUID()), null);
  }

  console.log("Render rules per chain state (13-18)");
  {
    const s = setup();
    const nn = await decide(s.deps, "NOT_NOW", null, { deferChoice: "TOMORROW" });
    const nnRow = s.db.rows[0];
    const s2 = setup();
    await decide(s2.deps, "REJECT");
    const rejRow = s2.db.rows[0];
    const exec = execRow(approvedRow, "EXECUTED"), stale = execRow(approvedRow, "STALE_AT_EXECUTION");
    const has = (items: ActionSurfaceItemDto[]) => /בצע עכשיו/.test(render(items));
    const aw = await surface([approvedRow]);
    check("13. APPROVED head → AWAITING_EXECUTION card with [בצע עכשיו]", [aw.states[ACTION_ID], has(aw.response.items)], ["AWAITING_EXECUTION", true]);
    check("13. the AWAITING DTO carries the persisted approval id (= head)", [awaiting.approvalEventId, awaiting.headEventId, awaiting.approvalEventId === approvedRow.id], [approvedRow.id, approvedRow.id, true]);
    const pr = await surface([]);
    check("14. PROPOSED (empty chain) → SHOW card, NO execute button, approvalEventId null", [pr.states[ACTION_ID], has(pr.response.items), pr.response.items[0].approvalEventId], ["SHOW", false, null]);
    check("15. NOT_NOW (deferred) → hidden, NO execute button", [nn.status, (await surface([nnRow])).states[ACTION_ID], has((await surface([nnRow])).response.items)], ["RECORDED", "HIDDEN", false]);
    const nnLater = await surface([nnRow], { now: "2026-10-30T12:00:00Z" });
    check("15. NOT_NOW after the stored defer → SHOW again, still NO execute button", [nnLater.states[ACTION_ID], has(nnLater.response.items)], ["SHOW", false]);
    const rj = await surface([rejRow]);
    check("16. REJECTED → suppressed, NO execute button", [rj.states[ACTION_ID], has(rj.response.items)], ["SUPPRESSED", false]);
    const ex = await surface([approvedRow, exec]);
    check("17. EXECUTED → DONE: the old proposal never reappears, NO execute button", [ex.states[ACTION_ID], ex.response.items.length, has(ex.response.items)], ["DONE", 0, false]);
    const st = await surface([approvedRow, stale], { proposals: [{ action, caseRef: caseWith("2026-08-01") }, { action: revisedAction, caseRef: C }] });
    check("18. STALE_AT_EXECUTION → the stale action is not re-offered; a new derivable proposal shows as a normal SHOW card; NO execute button", [st.states[ACTION_ID], st.response.items.map((i) => [i.actionId === revisedAction.id, i.state]), has(st.response.items)], ["NOT_PROPOSED", [[true, "SHOW"]], false]);
    const forgedDto = { v: ACTION_SURFACE_DTO_VERSION, items: [{ ...show, approvalEventId: APPROVAL }] };
    const forgedAwait = { v: ACTION_SURFACE_DTO_VERSION, items: [{ ...awaiting, approvalEventId: null }] };
    const forgedMismatch = { v: ACTION_SURFACE_DTO_VERSION, items: [{ ...awaiting, approvalEventId: randomUUID() }] };
    check("13-14. the client parser fails closed on a SHOW card with an approval id / an AWAITING card without one / approval ≠ head", [parseActionSurfaceResponse(forgedDto).ok, parseActionSurfaceResponse(forgedAwait).ok, parseActionSurfaceResponse(forgedMismatch).ok], [false, false, false]);
    check("13-18. only an AWAITING card can yield an execute attempt", [buildExecuteAttempt(awaiting, "r")?.body, buildExecuteAttempt(show, "r"), buildExecuteAttempt({ ...awaiting, approvalEventId: null }, "r"), buildExecuteAttempt(awaiting, "")], [{ approvalEventId: APPROVAL, requestId: "r" }, null, null, null]);
  }

  console.log("Result mapping: route → client (21-31)");
  {
    const s = setup();
    const a2 = await decide(s.deps, "APPROVE");
    const approvalId = "event" in a2 ? a2.event.id : "";
    svc.deps = s.deps; svc.mode = "CORE";
    const errs: unknown[][] = [];
    const origErr = console.error;
    console.error = (...a: unknown[]) => { errs.push(a); };
    const via = async (rpc: ActionEventDbResponse<unknown>) => { s.db.rpcResponse = rpc; const r = await post({ approvalEventId: approvalId, requestId: randomUUID() }); return { r, o: interpretExecuteResponse(r.status, r.json) }; };
    const ev = () => randomUUID();
    try {
      const e = await via({ data: { result: "EXECUTED", eventId: ev(), eventType: "EXECUTED" }, error: null });
      check("21. EXECUTED → 'הפעולה בוצעה.' (success)", [e.r.status, e.o, phaseForOutcome(e.o)], [200, { ui: "executed", messageHe: "הפעולה בוצעה." }, "success"]);
      const rpE = await via({ data: { result: "REPLAY", eventId: ev(), eventType: "EXECUTED" }, error: null });
      const rpS = await via({ data: { result: "REPLAY", eventId: ev(), eventType: "STALE_AT_EXECUTION" }, error: null });
      check("22. REPLAY follows the PERSISTED final event (EXECUTED → done, STALE → stale)", [rpE.r.json, rpE.o.ui, rpS.r.json, rpS.o], [{ status: "REPLAY", eventType: "EXECUTED" }, "executed", { status: "REPLAY", eventType: "STALE_AT_EXECUTION" }, { ui: "stale", messageHe: EXECUTE_STALE_MESSAGE_HE }]);
      check("22. REPLAY with an unknown persisted type fails closed", interpretExecuteResponse(200, { status: "REPLAY", eventType: "APPROVED" }).ui, "error");
      const ae = await via({ data: { result: "ALREADY_EXECUTED", eventId: ev(), eventType: "EXECUTED" }, error: null });
      check("23. ALREADY_EXECUTED → completed state + re-fetch", [ae.r.status, ae.o], [200, { ui: "executed", messageHe: "הפעולה כבר בוצעה." }]);
      const stl = await via({ data: { result: "STALE_AT_EXECUTION", eventId: ev(), reasons: ["PERSISTED_VALUE_MATCHES_EXPECTED"] }, error: null });
      check("24. STALE_AT_EXECUTION → exact calm Hebrew message, no further mutation", [stl.r.json, stl.o, EXECUTE_STALE_MESSAGE_HE], [{ status: "STALE_AT_EXECUTION", eventType: "STALE_AT_EXECUTION" }, { ui: "stale", messageHe: EXECUTE_STALE_MESSAGE_HE }, "הפעולה כבר לא מתאימה למצב הנוכחי. רעננתי את המידע."]);
      const nc = await via({ data: { result: "APPROVAL_NOT_CURRENT" }, error: null });
      check("25. APPROVAL_NOT_CURRENT → calm stale message + re-fetch", [nc.r.json, nc.o], [{ status: "APPROVAL_NOT_CURRENT" }, { ui: "stale", messageHe: STALE_MESSAGE_HE }]);
      const nf = await via({ data: { result: "APPROVAL_NOT_FOUND" }, error: null });
      check("26. APPROVAL_NOT_FOUND → error (not executed) + re-fetch", [nf.r.json, nf.o.ui, nf.o.messageHe.includes("לא בוצעה")], [{ status: "APPROVAL_NOT_FOUND" }, "error", true]);
      const s3 = setup();
      svc.deps = s3.deps;
      const unknownApproval = await post({ approvalEventId: randomUUID(), requestId: randomUUID() });
      check("26. an approval id that does not exist → APPROVAL_NOT_FOUND without any RPC", [unknownApproval.json, s3.db.rpcCalls.length], [{ status: "APPROVAL_NOT_FOUND" }, 0]);
      svc.deps = s.deps;
      const mm = await via({ data: { result: "ACTION_MISMATCH" }, error: null });
      check("27. ACTION_MISMATCH fails closed (error, never success)", [mm.r.json, mm.o.ui, phaseForOutcome(mm.o)], [{ status: "ACTION_MISMATCH" }, "error", "error"]);
      const rc = await via({ data: { result: "REQUEST_ID_CONFLICT" }, error: null });
      check("28. REQUEST_ID_CONFLICT fails closed (error, never success)", [rc.r.json, rc.o.ui, phaseForOutcome(rc.o)], [{ status: "REQUEST_ID_CONFLICT" }, "error", "error"]);
      const rt = await via({ data: null, error: { code: "40P01", message: "deadlock detected" } });
      check("29. RETRYABLE (deadlock) → 503 + 'לא הצלחתי לבצע כרגע. אפשר לנסות שוב.' (manual retry offered)", [rt.r.status, rt.r.json, rt.o], [503, { status: "RETRYABLE" }, { ui: "retry", messageHe: "לא הצלחתי לבצע כרגע. אפשר לנסות שוב." }]);
      ok("29. RETRYABLE response exposes no SQL detail", !/deadlock|40P01/.test(rt.r.text));
      const before = errs.length;
      const iv = await via({ data: null, error: { code: "42501", message: "PARTNER_ACTION_EVENTS_APPEND_ONLY" } });
      check("31. INVARIANT_VIOLATION → 500 generic, fails closed (error)", [iv.r.status, iv.r.json, iv.o, phaseForOutcome(iv.o)], [500, { status: "INVARIANT_VIOLATION" }, { ui: "error", messageHe: "משהו השתבש — הפעולה לא בוצעה." }, "error"]);
      ok("31. …logged server-side, but no SQL / internal detail reaches the Owner", errs.length === before + 1 && JSON.stringify(errs[before]).includes("PARTNER_ACTION_EVENTS_APPEND_ONLY") && !/42501|PARTNER_|APPEND_ONLY/.test(iv.r.text));
      const bogus = await via({ data: { result: "DONE" }, error: null });
      check("31. an unknown RPC result → INVARIANT_VIOLATION (fail closed)", [bogus.r.status, bogus.r.json], [500, { status: "INVARIANT_VIOLATION" }]);
      svc.mode = "THROW";
      const th = await post({ approvalEventId: approvalId, requestId: randomUUID() });
      check("31. an unexpected exception → 500 generic, no internals", [th.status, th.json, /boom|SQLSTATE|projects/.test(th.text)], [500, { status: "INVARIANT_VIOLATION" }, false]);
      svc.mode = "CORE";
    } finally { console.error = origErr; }
    check("auth / transport failures never claim success", [interpretExecuteResponse(401, { status: "UNAUTHORIZED" }).ui, interpretExecuteResponse(403, { status: "FORBIDDEN_ORIGIN" }).ui, interpretExecuteResponse(400, { status: "INVALID_INPUT" }).ui, interpretExecuteResponse(200, "garbage").ui, interpretExecuteResponse(200, { status: "WHATEVER" }).ui, interpretExecuteResponse(200, null).ui], ["error", "error", "error", "error", "error", "error"]);
    check("a network failure is treated as RETRYABLE (the section maps it to 503)", interpretExecuteResponse(503, { status: "RETRYABLE" }).ui, "retry");
  }

  console.log("Persisted approved snapshot + no optimistic change (33-34)");
  {
    // The live deadline moved AFTER approval (same deterministic action id, different "from"). The card must still
    // show EXACTLY what was approved: 14.07.2026 → 07.10.2026 from the persisted APPROVED snapshot.
    const moved = caseWith("2026-08-01");
    const liveNow = derive(moved, [A, B]).find((a) => a.id === ACTION_ID);
    const it = (await surfaceItem([approvedRow], { proposals: [{ action: liveNow ?? action, caseRef: moved }] }))!;
    const html = render([it]);
    check("33. the AWAITING card shows the persisted APPROVED values (not a newer derivation)", [liveNow?.id === ACTION_ID, it.state, it.currentDeadlineHe, it.suggestedDeadlineHe, it.snapshotHash === approvedRow.snapshot_hash], [true, "AWAITING_EXECUTION", "14.07.2026", "07.10.2026", true]);
    ok("33. text: 'הפעולה אושרה' + \"עדכון הדדליין של 'קרוב אלייך' מ־14.07.2026 ל־07.10.2026\" + 'השינוי עדיין לא בוצע.'", html.includes("הפעולה אושרה") && /data-approved-change="true"[^>]*>עדכון הדדליין של &#x27;קרוב אלייך&#x27; מ־<bdi dir="ltr">14\.07\.2026<\/bdi> ל־<bdi dir="ltr">07\.10\.2026<\/bdi>/.test(html) && html.includes("השינוי עדיין לא בוצע.") && !html.includes("01.08.2026"));
    const busy = render([awaiting], false, { phase: "submitting" });
    ok("34. while executing: still 'השינוי עדיין לא בוצע.', no success text, no struck/changed date", busy.includes("השינוי עדיין לא בוצע.") && !busy.includes("הפעולה בוצעה") && !/line-through/.test(busy));
    ok("34. no optimistic change: the section never edits items locally (only the server surface replaces them)", !/setItems\(\s*\(?\s*\w*\s*\)?\s*=>/.test(SECTION) && (SECTION.match(/setItems\(/g) ?? []).length === 4 && /setItems\(parsed\.items\)/.test(SECTION));
  }

  console.log("UI: RTL desktop / mobile / accessibility (19, 35-37)");
  {
    const d = render([awaiting]);
    const m = render([awaiting], true);
    ok("35. RTL desktop: <section dir=rtl lang=he>, compact 36px button, LTR-isolated dates", /<section dir="rtl" lang="he"/.test(d) && (d.match(/min-height:36px/g) ?? []).length === 1 && (d.match(/<bdi dir="ltr">/g) ?? []).length === 2);
    ok("36. RTL mobile: comfortable 44px tap target, wrapping row", /<section dir="rtl" lang="he"/.test(m) && (m.match(/min-height:44px/g) ?? []).length === 1 && m.includes("flex:1 1 30%") && m.includes("flex-wrap:wrap"));
    ok("37. accessibility: one native <button type=button>, aria-live status region, card = <article>", (d.match(/<button type="button"/g) ?? []).length === 1 && /aria-live="polite" role="status"/.test(d) && /<article data-partner-action=/.test(d) && /aria-label="סאני — הצעות לפעולה"/.test(d));
    const busy = render([awaiting], false, { phase: "submitting" });
    ok("19. submitting: [בצע עכשיו] disabled, aria-busy, 'שומר…' announced", /<button type="button" disabled=""[^>]*>בצע עכשיו<\/button>/.test(busy) && busy.includes('aria-busy="true"') && busy.includes("שומר…"));
    const err = render([awaiting], false, { phase: "error", message: "לא הצלחתי לבצע כרגע. אפשר לנסות שוב.", canRetry: true });
    ok("29. RETRYABLE: message + a real [נסה שוב] button in the live region", err.includes("לא הצלחתי לבצע כרגע. אפשר לנסות שוב.") && err.includes(">נסה שוב<") && /data-decision-message="error"/.test(err));
    const errNoRetry = render([awaiting], false, { phase: "error", message: "משהו לא תואם — הפעולה לא בוצעה.", canRetry: false });
    ok("27/28. non-retryable errors show NO [נסה שוב]", !errNoRetry.includes("נסה שוב"));
    ok("20. double-click: synchronous ref guard in submit()", /if \(!attempt \|\| submitting\.current\) return;/.test(SECTION) && /submitting\.current = true;/.test(SECTION));
    ok("30. retry re-sends the SAME attempt object (same body, same requestId)", /retryAttempt: attempt/.test(SECTION) && /onRetry: \(\) => \{ const a = ui\.retryAttempt; if \(a\) submit\(item\.actionId, a\); \}/.test(SECTION));
    ok("32. re-fetch after EVERY answer (retry included) — unconditional `await load()` at the end of submit()", /\n {4}await load\(\);\n {2}\}, \[load\]\);/.test(SECTION) && !/outcome\.ui === "retry"\)[^\n]*return;/.test(SECTION));
  }

  console.log("Real section in headless Chrome (1-2, 12, 19-34)");
  {
    const revisedSurface = await surface([approvedRow, execRow(approvedRow, "STALE_AT_EXECUTION")], { proposals: [{ action, caseRef: caseWith("2026-08-01") }, { action: revisedAction, caseRef: C }] });
    const S = (items: PartnerActionCardDto[]) => ({ v: ACTION_SURFACE_DTO_VERSION, items });
    const fixtures = {
      awaiting: S([awaiting]), show: S([show]), empty: S([]), revised: revisedSurface.response,
      cases: [
        { name: "REPLAY_EXECUTED", status: 200, json: { status: "REPLAY", eventType: "EXECUTED" }, surfaceAfter: S([]) },
        { name: "REPLAY_STALE", status: 200, json: { status: "REPLAY", eventType: "STALE_AT_EXECUTION" }, surfaceAfter: S([]) },
        { name: "ALREADY_EXECUTED", status: 200, json: { status: "ALREADY_EXECUTED", eventType: "EXECUTED" }, surfaceAfter: S([]) },
        { name: "APPROVAL_NOT_CURRENT", status: 200, json: { status: "APPROVAL_NOT_CURRENT" }, surfaceAfter: S([show]) },
        { name: "APPROVAL_NOT_FOUND", status: 200, json: { status: "APPROVAL_NOT_FOUND" } },
        { name: "ACTION_MISMATCH", status: 200, json: { status: "ACTION_MISMATCH" } },
        { name: "REQUEST_ID_CONFLICT", status: 200, json: { status: "REQUEST_ID_CONFLICT" } },
        { name: "INVARIANT_VIOLATION", status: 500, json: { status: "INVARIANT_VIOLATION" } },
        { name: "UNAUTHORIZED", status: 401, json: { status: "UNAUTHORIZED" } },
        { name: "FORBIDDEN_ORIGIN", status: 403, json: { status: "FORBIDDEN_ORIGIN" } },
        { name: "GARBAGE", status: 200, json: "<html>oops" },
      ],
    };
    const obs = await runSectionInChrome(ROOT, fixtures) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    if ("error" in obs && obs.error) { ok(`Chrome run: ${obs.error}`, false); }
    else {
      check("crypto.randomUUID available (secure context)", obs.secure, true);
      check("2. non-owner: nothing rendered, nothing fetched, nothing posted", [obs.nonOwner.html, obs.nonOwner.gets, obs.nonOwner.posts], ["", 0, 0]);
      check("13. mounted AWAITING card: one GET, only [בצע עכשיו], approved line + not-yet-executed note", [obs.s1mount.gets, obs.s1mount.labels, obs.s1mount.awaitingNote, obs.s1mount.approvedLine], [1, ["בצע עכשיו"], true, "עדכון הדדליין של 'קרוב אלייך' מ־14.07.2026 ל־07.10.2026"]);
      const p = obs.s1during.post;
      check("20. triple click while pending → exactly ONE POST", [obs.s1during.posts, obs.s1clickWhileBusy], [1, 1]);
      check("19. while pending: button disabled, aria-busy, 'שומר…', no success shown", [obs.s1during.disabled, obs.s1during.ariaBusy, obs.s1during.saving, obs.s1during.executedShown], [true, "true", true, false]);
      check("34. while pending: the card still says the change is NOT executed (no optimistic update)", [obs.s1during.awaitingNote, obs.s1during.approvedLine], [true, "עדכון הדדליין של 'קרוב אלייך' מ־14.07.2026 ל־07.10.2026"]);
      ok("D. the POST: /execute, same-origin credentials, JSON, body = {approvalEventId, requestId(uuid v4)} only", p.url === EXECUTE_URL && p.method === "POST" && p.credentials === "same-origin" && p.contentType === "application/json" && JSON.stringify(Object.keys(p.body).sort()) === JSON.stringify(["approvalEventId", "requestId"]) && p.body.approvalEventId === APPROVAL && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(p.body.requestId));
      check("21/32. EXECUTED → 'הפעולה בוצעה.' after the server answer, surface re-fetched, the card is gone (DONE)", [obs.s1after.notice, obs.s1after.gets, obs.s1after.card, obs.s1after.posts], ["הפעולה בוצעה.", 2, false, 1]);
      check("no automatic repeat afterwards (3s later: still one POST, no extra GET)", [obs.s1later.posts, obs.s1later.gets], [1, 2]);
      check("29/32. RETRYABLE → message + [נסה שוב], surface re-fetched, card kept", [obs.s2first.message, obs.s2first.labels, obs.s2first.gets, obs.s2first.posts], ["לא הצלחתי לבצע כרגע. אפשר לנסות שוב. נסה שוב", ["בצע עכשיו", "נסה שוב"], 2, 1]);
      check("29. no automatic retry loop (3s later: still one POST)", obs.s2noAuto.posts, 1);
      check("29. a network failure → the same retry offer", [obs.s2retry.message, obs.s2retry.posts], ["לא הצלחתי לבצע כרגע. אפשר לנסות שוב. נסה שוב", 2]);
      const bodies = obs.s2final.bodies as Array<{ approvalEventId: string; requestId: string }>;
      check("30. [נסה שוב] re-sends the SAME approvalEventId + SAME requestId (twice)", [bodies.length, JSON.stringify(bodies[1]) === JSON.stringify(bodies[0]), JSON.stringify(bodies[2]) === JSON.stringify(bodies[0])], [4, true, true]);
      check("30. a genuinely new [בצע עכשיו] click is a NEW attempt (new requestId, same approval)", [bodies[3].requestId !== bodies[0].requestId, bodies[3].approvalEventId === bodies[0].approvalEventId, obs.s2final.notice], [true, true, "הפעולה בוצעה."]);
      check("24. STALE_AT_EXECUTION → exact calm message, re-fetch shows the NEW proposal via the normal surface", [obs.s3.notice, obs.s3.gets, obs.s3.labels, obs.s3.awaitingNote], [EXECUTE_STALE_MESSAGE_HE, 2, ["אשר", "לא עכשיו", "שנה תאריך"], false]);
      check("24. the new proposal is NOT approved or executed automatically (3s later: one POST total, to /execute)", obs.s3later.urls, [EXECUTE_URL]);
      const R = obs.results;
      check("22. REPLAY(EXECUTED) → done + re-fetch", [R.REPLAY_EXECUTED.notice, R.REPLAY_EXECUTED.gets, R.REPLAY_EXECUTED.card], ["הפעולה בוצעה.", 2, false]);
      check("22. REPLAY(STALE_AT_EXECUTION) → stale message + re-fetch", [R.REPLAY_STALE.notice, R.REPLAY_STALE.gets], [EXECUTE_STALE_MESSAGE_HE, 2]);
      check("23. ALREADY_EXECUTED → completed + re-fetch", [R.ALREADY_EXECUTED.notice, R.ALREADY_EXECUTED.gets, R.ALREADY_EXECUTED.card], ["הפעולה כבר בוצעה.", 2, false]);
      check("25. APPROVAL_NOT_CURRENT → calm stale message + re-fetch (current state shown)", [R.APPROVAL_NOT_CURRENT.notice, R.APPROVAL_NOT_CURRENT.gets, R.APPROVAL_NOT_CURRENT.labels], [STALE_MESSAGE_HE, 2, ["אשר", "לא עכשיו", "שנה תאריך"]]);
      const errCase = (n: string, msg: string) => check(`${n} → error on the card, no retry offer, re-fetched, one POST`, [R[n].message, R[n].messagePhase, R[n].labels, R[n].gets, R[n].posts], [msg, "error", ["בצע עכשיו"], 2, 1]);
      errCase("APPROVAL_NOT_FOUND", "האישור לא נמצא — רעננתי את המידע. הפעולה לא בוצעה.");
      errCase("ACTION_MISMATCH", "משהו לא תואם — הפעולה לא בוצעה.");
      errCase("REQUEST_ID_CONFLICT", "משהו השתבש — רעננתי את המידע. הפעולה לא בוצעה.");
      errCase("INVARIANT_VIOLATION", "משהו השתבש — הפעולה לא בוצעה.");
      errCase("UNAUTHORIZED", "אין הרשאה לבצע את הפעולה הזו.");
      errCase("FORBIDDEN_ORIGIN", "אין הרשאה לבצע את הפעולה הזו.");
      errCase("GARBAGE", "משהו השתבש — הפעולה לא בוצעה.");
      check("12. APPROVE → only a /decide POST; the re-fetched card is AWAITING with [בצע עכשיו]; no approval notice", [obs.s5.labels, obs.s5.notice, obs.s5.awaitingNote], [["בצע עכשיו"], null, true]);
      check("12. no automatic execution after APPROVE (3s later: still exactly one POST, to /decide)", obs.s5later.urls, ["/api/partner/actions/decide"]);
      check("37. keyboard: the native button takes focus; live region present; RTL Hebrew section; mobile 44px target", [obs.s6.focused, obs.s6.type, obs.s6.tabIndex >= 0, obs.s6.live, obs.s6.dir, obs.s6.lang, obs.s6.minHeight], [true, "button", true, true, "rtl", "he", "44px"]);
    }
  }

  console.log("No cron / Push / Agent Alerts (38-40) + static execution boundaries");
  {
    const F1K = ["app/api/partner/actions/execute/route.ts", "components/partner/PartnerActionsSection.tsx", "components/partner/PartnerActionCard.tsx", "components/partner/partner-decision-client.ts", "lib/partner/actions/surface.ts", "lib/partner/actions/surface-dto.ts", "lib/partner/actions/action-service.ts", "lib/partner/actions/service.ts", "lib/partner/actions/event-persistence.ts"].map((f) => strip(rd(f)));
    ok("38. no cron in the execution path (node-cron / instrumentation / schedules)", F1K.every((s) => !/node-cron|instrumentation|cron/i.test(s)));
    ok("38. no cron / instrumentation module reaches Partner actions", !/partner\/actions|executeApprovedAction/.test(rd("instrumentation.ts")) && fs.readdirSync(path.join(ROOT, "lib", "agent")).every((f) => !/partner\/actions|executeApprovedAction/.test(fs.readFileSync(path.join(ROOT, "lib", "agent", f), "utf8"))));
    ok("39. no Push in the execution path", F1K.every((s) => !/web-push|lib\/push|sendPush|pushTo|notify/i.test(s)) && !/partner\/actions/.test(rd("lib/push.ts")));
    ok("40. no Agent Alerts in the execution path", F1K.every((s) => !/agent_alerts|alerts-store|lib\/agent\/|createAlert/i.test(s)));
    ok("the RPC name is defined ONLY in events.ts; only event-persistence.ts calls .rpc(", (() => {
      const dir = path.join(ROOT, "lib", "partner", "actions");
      const files = fs.readdirSync(dir).filter((f) => /\.tsx?$/.test(f));
      return JSON.stringify(files.filter((f) => /partner_execute_update_project_deadline/.test(strip(fs.readFileSync(path.join(dir, f), "utf8"))))) === JSON.stringify(["events.ts"])
        && JSON.stringify(files.filter((f) => /\.rpc\(/.test(strip(fs.readFileSync(path.join(dir, f), "utf8"))))) === JSON.stringify(["event-persistence.ts"]);
    })());
    ok("the UI never imports server code (HTTP only)", [SECTION, CARD, CLIENT].every((s) => !/action-service|event-store|event-persistence|actions\/live|actions\/service"|context-store|lib\/supabase/.test(s)));
    ok("REJECT is still not exposed in the UI", !/REJECT/.test(strip(SECTION + CARD + CLIENT)));
  }

  const self = fs.readFileSync(__filename, "utf8");
  ok("this test never imports a production binding", !/from\s+["'][^"']*(lib\/supabase|surface-server|actions\/event-store|actions\/live|actions\/action-service|context-store)["']/.test(self));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
