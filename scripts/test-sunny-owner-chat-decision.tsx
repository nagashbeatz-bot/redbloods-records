/**
 * Tests — the Owner decides a pending Sunny (T2) request FROM THE CLAUDE CHAT (2026-10-02).
 *
 * Run with:   npx tsx scripts/test-sunny-owner-chat-decision.tsx
 *
 * NEVER touches production: the DB is an in-memory fake that behaves like owner_approval_decide_mcp (it refuses without
 * a live Owner token hash, a wrong payload hash, a second decision). The SQL itself is proven on the local Postgres
 * harness (scripts/sql/sunny-brain/t2-chat/harness: run.sh + lifecycle.sh + e2e-chat.tsx).
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { chatDecisionWords, isExplicitRejection, PresentationRegistry, PRESENTATION_TTL_MS, readBackOf, runChatDecision, type ChatDecisionDeps } from "../lib/partner/brain/chat-decision";
import * as W from "../lib/writes/brain";
import type { BrainRead, BrainRpcClient } from "../lib/brain-store";
import type { BrainSnapshot } from "../lib/partner/brain/model";
import { readMcpConfig } from "../lib/integrations/partner-mcp/config";
import { isAllowedMcpOnlyFetch } from "../lib/integrations/partner-mcp/mcp-only";
import { handleMcpHttp, type McpDeps } from "../lib/integrations/partner-mcp/mcp";
import { SlidingWindowLimiter } from "../lib/integrations/partner-mcp/rate-limit";
import { OBSERVE_TOOL, observeToolDefinition, validateObserveInput } from "../lib/integrations/partner-mcp/observe-tool";
import { authenticateBearer } from "../lib/integrations/partner-mcp/oauth";
import { BASE_ENV } from "./fixtures/mcp-oauth-scenarios";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}${detail === undefined ? "" : `  ${JSON.stringify(detail).slice(0, 400)}`}`); fail++; } };
const section = (t: string) => console.log(`\n${t}`);
const ROOT = path.resolve(__dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const H = (s: string) => createHash("sha256").update(s).digest("hex");

const OWNER = U(10), TEAM = U(11);
const OWNER_TOKEN = H("owner-live-token"), TEAM_TOKEN = H("team-live-token"), REVOKED_TOKEN = H("owner-revoked");
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
const yesterday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date(Date.now() - 86_400_000));

/** A fake DB with the semantics of owner_approval_decide_mcp + the T2 core (the harness proves the real one). */
function fakeDb() {
  const requests = new Map<string, { id: string; kind: string; payload: Record<string, unknown>; hash: string; summary: string; risk: string }>();
  const decisions: Array<{ requestId: string; decision: string; role: string; by: string }> = [];
  const tokens = new Map([[OWNER_TOKEN, { user: OWNER, valid: true, scope: "partner:read partner:observe" }], [TEAM_TOKEN, { user: TEAM, valid: true, scope: "partner:read partner:observe" }], [REVOKED_TOKEN, { user: OWNER, valid: false, scope: "partner:read partner:observe" }]]);
  const principals = new Set([OWNER]);
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const add = (n: number, handle: string, validFrom = today) => {
    const payload = { purposeKind: "OWN_PRESENCE", purposeHe: `מעקב ${handle}`, newResources: [{ platform: "instagram", identityKey: `account:handle:${handle}` }], validFrom, maxObservationsPerDay: 3 };
    requests.set(U(n), { id: U(n), kind: "TRACKING_AUTHORIZATION", payload, hash: H(JSON.stringify(payload)), summary: `מעקב אינסטגרם של ${handle}`, risk: "קריאת נתונים ציבוריים בלבד" });
  };
  const rpc: BrainRpcClient = {
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      const err = (message: string, code?: string) => ({ data: null, error: { message, code } });
      if (fn !== "owner_approval_decide_mcp") return err(`permission denied for function ${fn}`, "42501");
      const h = args.p_token_hash as string | null;
      if (!h || !/^[0-9a-f]{64}$/.test(h)) return err("OWNER_TOKEN_REQUIRED", "42501");
      const t = tokens.get(h);
      if (!t || !t.valid) return err("OWNER_TOKEN_INVALID", "42501");
      if (!t.scope.split(" ").includes("partner:observe")) return err("OWNER_TOKEN_SCOPE: partner:observe required", "42501");
      if (!principals.has(t.user)) return err("OWNER_SESSION_REQUIRED: this token does not belong to the Owner", "42501");
      const r = requests.get(args.p_request_id as string);
      if (!r) return err("REQUEST_NOT_FOUND");
      if (decisions.some((d) => d.requestId === r.id)) return err("ALREADY_DECIDED");
      if (args.p_seen_hash !== r.hash) return err("SEEN_HASH_MISMATCH");
      if (args.p_decision === "APPROVED" && typeof r.payload.validFrom === "string" && r.payload.validFrom < today) return err("BACKDATED_AUTHORIZATION");
      decisions.push({ requestId: r.id, decision: args.p_decision as string, role: "mcp_owner_token", by: t.user });
      return { data: { result: args.p_decision === "APPROVED" ? `GRANTED:${U(500 + decisions.length)}` : "REJECTED" }, error: null };
    },
  };
  const snapshot = (): BrainRead => ({
    status: "OK",
    value: {
      resources: [], authorizations: [], observations: [], records: [], links: [], events: [], truncated: false,
      approvals: {
        requests: [...requests.values()].map((r, i) => ({ id: r.id, seq: i + 1, kind: r.kind, payload: r.payload, payloadHash: r.hash, summaryHe: r.summary, riskHe: r.risk, requestedVia: "SUNNY", expiresAt: null, createdAt: new Date().toISOString() })),
        decisions: decisions.map((d, i) => ({ id: U(700 + i), requestId: d.requestId, decision: d.decision as "APPROVED", approvedPayload: null, narrowed: false, decidedRole: d.role, reasonHe: null, resultRef: null, createdAt: new Date().toISOString() })),
      },
    } as unknown as BrainSnapshot,
  });
  return { requests, decisions, calls, rpc, add, snapshot, tokens };
}

async function main() {
  section("A. Presentation registry — one open presentation per token, short, bound, consumed once");
  {
    const reg = new PresentationRegistry();
    const a = reg.present("tok1", { requestId: U(1), payloadHash: H("a"), readBack: [] }, 1000);
    ok("a presentation token is 48 hex (unguessable)", /^[0-9a-f]{48}$/.test(a.token));
    check("the presented request + token → accepted", reg.peek("tok1", U(1), a.token, 2000).ok, true);
    check("another connector token cannot use it", reg.peek("tok2", U(1), a.token, 2000), { ok: false, code: "PRESENTATION_REQUIRED", messageHe: (reg.peek("tok2", U(1), a.token, 2000) as { messageHe: string }).messageHe });
    const b = reg.present("tok1", { requestId: U(2), payloadHash: H("b"), readBack: [] }, 3000);
    check("presenting request B REPLACES A: an old \"מאשר\" never lands on A", [reg.peek("tok1", U(1), a.token, 3500).ok, (reg.peek("tok1", U(1), a.token, 3500) as { code?: string }).code, reg.peek("tok1", U(2), b.token, 3500).ok], [false, "NOT_THE_PRESENTED_REQUEST", true]);
    check("B's id with A's token → refused", (reg.peek("tok1", U(2), a.token, 3500) as { code?: string }).code, "NOT_THE_PRESENTED_REQUEST");
    check("expired → PRESENTATION_EXPIRED (present again)", (reg.peek("tok1", U(2), b.token, 3000 + PRESENTATION_TTL_MS + 1) as { code?: string }).code, "PRESENTATION_EXPIRED");
    const c = reg.present("tok1", { requestId: U(3), payloadHash: H("c"), readBack: [] }, 10_000);
    reg.consume("tok1", c.token);
    check("consumed → the same token can never decide again (replay)", (reg.peek("tok1", U(3), c.token, 10_001) as { code?: string }).code, "PRESENTATION_REQUIRED");
    check("a fresh registry (process restart) knows nothing → fail closed", (new PresentationRegistry().peek("tok1", U(3), c.token, 10_001) as { code?: string }).code, "PRESENTATION_REQUIRED");
  }

  section("B. The Owner's words");
  const rb = readBackOf({ summaryHe: "מעקב אינסטגרם של שליו ואבי", riskHe: "קריאה ציבורית", payload: { purposeHe: "מעקב", maxObservationsPerDay: 3, newResources: [{ identityKey: "account:handle:shalev" }] } });
  const W1 = (d: "APPROVED" | "REJECTED", t: unknown) => { const v = chatDecisionWords(d, t, rb); return v.ok ? "OK" : v.code; };
  check("\"מאשר\" / \"כן, מאשר\" / \"מאושר\" / \"approve\" → APPROVED", ["מאשר", "כן, מאשר", "מאושר", "approve"].map((t) => W1("APPROVED", t)), ["OK", "OK", "OK", "OK"]);
  check("\"לא מאשר\" / \"דוחה\" / \"תדחי את זה\" / \"reject\" → REJECTED", ["לא מאשר", "דוחה", "תדחי את זה", "reject"].map((t) => W1("REJECTED", t)), ["OK", "OK", "OK", "OK"]);
  check("\"מאשר רק את שליו\" → TERMS_CHANGED (not an approval; nothing decided)", W1("APPROVED", "מאשר רק את שליו"), "TERMS_CHANGED");
  check("\"מאשר אבל עם תקרה 5\" → TERMS_CHANGED", W1("APPROVED", "מאשר אבל עם תקרה 5"), "TERMS_CHANGED");
  check("repeating a shown value is not a change (\"כן, 3 ביום\")", W1("APPROVED", "כן, 3 ביום"), "OK");
  check("a hold (\"רגע\", \"תן לי לחשוב\") is never a decision", [W1("APPROVED", "רגע"), W1("REJECTED", "רגע"), W1("APPROVED", "תן לי לחשוב")], ["NOT_A_DECISION", "NOT_A_DECISION", "NOT_A_DECISION"]);
  check("words and decision must agree (\"מאשר\" as REJECTED, \"לא מאשר\" as APPROVED)", [W1("REJECTED", "מאשר"), W1("APPROVED", "לא מאשר")], ["DECISION_MISMATCH", "DECISION_MISMATCH"]);
  check("no words → APPROVAL_MISSING", [W1("APPROVED", ""), W1("APPROVED", undefined), W1("REJECTED", "  ")], ["APPROVAL_MISSING", "APPROVAL_MISSING", "APPROVAL_MISSING"]);
  check("\"לא\" alone / \"לא עכשיו\" is not an explicit rejection", [isExplicitRejection("לא"), isExplicitRejection("לא עכשיו"), isExplicitRejection("לא מאשר, רק את שליו")], [false, false, false]);

  section("C. The flow — Owner connected → approve; everything else → nothing decided");
  const db = fakeDb();
  db.add(1, "shalev"); db.add(2, "avi"); db.add(3, "ref1"); db.add(4, "old", yesterday);
  const reg = new PresentationRegistry();
  const deps: ChatDecisionDeps = { read: async () => db.snapshot(), rpc: db.rpc, registry: reg, now: new Date() };
  const OWNER_ACTOR = { tokenId: "token-owner", tokenHash: OWNER_TOKEN };
  const run = (op: "present_request" | "decide_request", input: Record<string, unknown>, actor: { tokenId?: string; tokenHash?: string } = OWNER_ACTOR) => runChatDecision(op, input, actor, deps);

  check("\"מאשר\" with NO request presented → no action (no DB call)", [(await run("decide_request", { requestId: U(1), decision: "APPROVED", presentationToken: "0".repeat(48), confirmationText: "מאשר" })).status, db.calls.length], ["PRESENTATION_REQUIRED", 0]);
  const p1 = await run("present_request", { requestId: U(1) });
  check("present_request: the exact request, its hash, a presentation token, the other pending requests", [p1.status, (p1.request as { payloadHash: string }).payloadHash === db.requests.get(U(1))!.hash, /^[0-9a-f]{48}$/.test(String(p1.presentationToken)), (p1.otherPending as unknown[]).length, p1.chatApprovable], ["OK", true, true, 3, true]);
  check("terms changed in the reply → nothing decided, no DB call", [(await run("decide_request", { requestId: U(1), decision: "APPROVED", presentationToken: p1.presentationToken, confirmationText: "מאשר רק את שליו" })).status, db.calls.length], ["TERMS_CHANGED", 0]);
  check("a hold → nothing decided, the presentation stays open", [(await run("decide_request", { requestId: U(1), decision: "APPROVED", presentationToken: p1.presentationToken, confirmationText: "רגע" })).status, db.calls.length], ["NOT_A_DECISION", 0]);
  check("a decision without the token hash (service role alone) → refused before the DB", [(await run("decide_request", { requestId: U(1), decision: "APPROVED", presentationToken: p1.presentationToken, confirmationText: "מאשר" }, { tokenId: "token-owner" })).status, db.calls.length], ["OWNER_TOKEN_REQUIRED", 0]);
  const ap = await run("decide_request", { requestId: U(1), decision: "APPROVED", presentationToken: p1.presentationToken, confirmationText: "מאשר" });
  check("Owner connected + presented + \"מאשר\" → APPROVED by the DB, exactly the presented hash", [ap.status, db.calls.length, db.calls[0].fn, db.calls[0].args.p_seen_hash === db.requests.get(U(1))!.hash, db.calls[0].args.p_token_hash === OWNER_TOKEN, "p_approved" in db.calls[0].args], ["OK", 1, "owner_approval_decide_mcp", true, true, false]);
  check("exact audit trail: one decision, role mcp_owner_token, decided_by = the Owner (from the token)", db.decisions, [{ requestId: U(1), decision: "APPROVED", role: "mcp_owner_token", by: OWNER }]);
  check("replay of the same \"מאשר\" → no second decision (presentation consumed)", [(await run("decide_request", { requestId: U(1), decision: "APPROVED", presentationToken: p1.presentationToken, confirmationText: "מאשר" })).status, db.decisions.length], ["PRESENTATION_REQUIRED", 1]);
  check("presenting a decided request again → NOT_PENDING (nothing to approve)", (await run("present_request", { requestId: U(1) })).status, "NOT_PENDING");

  const p2 = await run("present_request", { requestId: U(2) });
  const p3 = await run("present_request", { requestId: U(3) });
  check("two requests presented → \"מאשר\" on the EARLIER one is refused (ambiguous → ask, present again)", [(await run("decide_request", { requestId: U(2), decision: "APPROVED", presentationToken: p2.presentationToken, confirmationText: "מאשר" })).status, db.decisions.length], ["NOT_THE_PRESENTED_REQUEST", 1]);
  const rj = await run("decide_request", { requestId: U(3), decision: "REJECTED", presentationToken: p3.presentationToken, confirmationText: "לא מאשר" });
  check("reject from chat → REJECTED by the DB (role mcp_owner_token)", [rj.status, db.decisions[1]], ["OK", { requestId: U(3), decision: "REJECTED", role: "mcp_owner_token", by: OWNER }]);

  // non-owner / revoked / stale / already decided — the DB refuses; the flow reports, never claims
  const p2b = await run("present_request", { requestId: U(2) }, { tokenId: "token-team", tokenHash: TEAM_TOKEN });
  check("a non-owner's live token → OWNER_SESSION_REQUIRED (DB), nothing decided", [(await run("decide_request", { requestId: U(2), decision: "APPROVED", presentationToken: p2b.presentationToken, confirmationText: "מאשר" }, { tokenId: "token-team", tokenHash: TEAM_TOKEN })).code, db.decisions.length], ["OWNER_SESSION_REQUIRED", 2]);
  const p2c = await run("present_request", { requestId: U(2) }, { tokenId: "token-rev", tokenHash: REVOKED_TOKEN });
  check("the Owner's revoked token → OWNER_TOKEN_INVALID (DB), nothing decided", [(await run("decide_request", { requestId: U(2), decision: "APPROVED", presentationToken: p2c.presentationToken, confirmationText: "מאשר" }, { tokenId: "token-rev", tokenHash: REVOKED_TOKEN })).code, db.decisions.length], ["OWNER_TOKEN_INVALID", 2]);
  const p2d = await run("present_request", { requestId: U(2) });
  db.requests.get(U(2))!.hash = H("changed after it was shown");
  check("stale hash (the request changed after it was shown) → SEEN_HASH_MISMATCH, nothing decided", [(await run("decide_request", { requestId: U(2), decision: "APPROVED", presentationToken: p2d.presentationToken, confirmationText: "מאשר" })).code, db.decisions.length], ["SEEN_HASH_MISMATCH", 2]);
  const p4 = await run("present_request", { requestId: U(4) });
  check("a request whose start date passed: flagged not chat-approvable; approving is refused by the DB", [p4.chatApprovable, typeof p4.chatApprovableNoteHe === "string", (await run("decide_request", { requestId: U(4), decision: "APPROVED", presentationToken: p4.presentationToken, confirmationText: "מאשר" })).code], [false, true, "BACKDATED_AUTHORIZATION"]);
  db.decisions.push({ requestId: U(2), decision: "APPROVED", role: "authenticated", by: OWNER }); // decided in /sunny-approvals meanwhile
  db.requests.get(U(2))!.hash = H(JSON.stringify(db.requests.get(U(2))!.payload));
  const late = await W.ownerDecideFromChat(db.rpc, { tokenHash: OWNER_TOKEN, requestId: U(2), decision: "APPROVED", seenHash: db.requests.get(U(2))!.hash });
  check("already decided (e.g. in /sunny-approvals) → ALREADY_DECIDED", (late as { code?: string }).code, "ALREADY_DECIDED");
  check("the migration not applied → NOT_INSTALLED, nothing decided", (await W.ownerDecideFromChat({ rpc: async () => ({ data: null, error: { message: "Could not find the function public.owner_approval_decide_mcp", code: "PGRST202" } }) }, { tokenHash: OWNER_TOKEN, requestId: U(9), decision: "APPROVED", seenHash: H("x") })).status, "NOT_INSTALLED");
  check("the writer refuses a non-hex token hash before the DB", (await W.ownerDecideFromChat(db.rpc, { tokenHash: "rbmcp_plain", requestId: U(9), decision: "APPROVED", seenHash: H("x") }) as { code?: string }).code, "OWNER_TOKEN_REQUIRED");

  section("D. Connector — off by default; the token hash goes only to the DB proof");
  const cfg = (env: Record<string, string>) => { const r = readMcpConfig(env); if (!r.ok) throw new Error("cfg"); return r.config; };
  const OBS = { ...BASE_ENV, REDBLOODS_MCP_ONLY: "true", PARTNER_MCP_OBSERVE_ENABLED: "true" };
  const ON = { ...OBS, PARTNER_MCP_OWNER_DECIDE_ENABLED: "true" };
  check("ownerDecideEnabled: default off; flag without observe off; observe + flag on", [cfg(BASE_ENV).ownerDecideEnabled, cfg(OBS).ownerDecideEnabled, cfg({ ...BASE_ENV, PARTNER_MCP_OWNER_DECIDE_ENABLED: "true" }).ownerDecideEnabled, cfg(ON).ownerDecideEnabled], [false, false, false, true]);
  const dbh = "db.example.supabase.co", u = (p: string) => new URL(`https://${dbh}${p}`);
  check("fetch guard: owner_approval_decide_mcp only with observe + owner-decide; never decide / the core", [
    isAllowedMcpOnlyFetch(u("/rest/v1/rpc/owner_approval_decide_mcp"), "POST", dbh, { brainRpc: true }),
    isAllowedMcpOnlyFetch(u("/rest/v1/rpc/owner_approval_decide_mcp"), "POST", dbh, { ownerDecideRpc: true }),
    isAllowedMcpOnlyFetch(u("/rest/v1/rpc/owner_approval_decide_mcp"), "POST", dbh, { brainRpc: true, ownerDecideRpc: true }),
    isAllowedMcpOnlyFetch(u("/rest/v1/rpc/owner_approval_decide"), "POST", dbh, { brainRpc: true, ownerDecideRpc: true }),
    isAllowedMcpOnlyFetch(u("/rest/v1/rpc/owner_approval_decide_core"), "POST", dbh, { brainRpc: true, ownerDecideRpc: true }),
  ], [false, false, true, false, false]);
  ok("instrumentation passes ownerDecideRpc only from PARTNER_MCP_OWNER_DECIDE_ENABLED", /ownerDecideRpc: process\.env\.PARTNER_MCP_OWNER_DECIDE_ENABLED === "true"/.test(read("instrumentation.ts")));
  const defOff = observeToolDefinition(false), defOn = observeToolDefinition(true);
  check("definition: off → no chat ops; on → present_request / decide_request + decision / presentationToken / confirmationText", [
    (defOff.inputSchema.properties.op.enum as string[]).filter((o) => /present|decide/.test(o)), "decision" in defOff.inputSchema.properties,
    (defOn.inputSchema.properties.op.enum as string[]).filter((o) => /present|decide/.test(o)), ["decision", "presentationToken", "confirmationText"].every((k) => k in defOn.inputSchema.properties),
  ], [[], false, ["present_request", "decide_request"], true]);
  ok("definition on: decide in chat, ask which one when unclear, terms changed = not an approval, never claim", /present_request \{requestId\} — exactly ONE request/.test(defOn.description) && /ask which one, present it, ask again — never guess/.test(defOn.description) && /\"מאשר רק את שליו\"\) it is NOT an approval/.test(defOn.description) && /you never claim an approval/.test(defOn.description) && !/decides it ONLY in Redbloods/.test(defOn.description));
  check("strict shape: no extra field (no token / uid / actor / approved payload)", [validateObserveInput({ op: "decide_request", requestId: U(1), decision: "APPROVED", presentationToken: "a".repeat(48), confirmationText: "מאשר", approved: {} }), validateObserveInput({ op: "decide_request", requestId: U(1), decision: "APPROVED", presentationToken: "a".repeat(48), confirmationText: "מאשר", token: "x" }), validateObserveInput({ op: "decide_request", requestId: U(1), decision: "APPROVED", confirmationText: "מאשר" })].map((v) => (v.ok ? "OK" : v.code)), ["UNKNOWN_FIELD", "FORBIDDEN_FIELD", "MISSING_FIELD"]);

  const mk = (env: Record<string, string>) => {
    const audit: Array<Record<string, unknown>> = [];
    const calls: Array<{ op: string; actor: Record<string, unknown> }> = [];
    const deps: McpDeps = {
      config: cfg(env), authenticate: async () => ({ ok: true as const, principal: { tokenId: U(900), clientId: "rbmcp_" + "c".repeat(40), userId: OWNER, scope: "partner:read partner:observe", tokenHash: OWNER_TOKEN } }),
      gateway: { brief: async () => ({}), resolve: async () => ({}), entity: async () => ({}), query: async () => ({ status: "OK" }), capabilityIndex: () => [] },
      limiter: new SlidingWindowLimiter([{ windowMs: 60_000, max: 500 }]), audit: async (r) => { audit.push(r as unknown as Record<string, unknown>); }, auditRejected: async () => undefined, nowMs: () => Date.now(),
      observe: { limiter: new SlidingWindowLimiter([{ windowMs: 3_600_000, max: 60 }]), call: async (op, _input, actor) => { calls.push({ op, actor: actor as unknown as Record<string, unknown> }); return { status: "OK", result: {} }; } },
    };
    const rpc = async (method: string, params?: unknown) => { const res = await handleMcpHttp({ method: "POST", header: (h) => (h === "authorization" ? "Bearer t" : null), bodyText: async () => JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params !== undefined ? { params } : {}) }) }, deps); return { status: res.status, json: res.body ? JSON.parse(res.body) : null, body: res.body ?? "" }; };
    return { rpc, audit, calls };
  };
  const off = mk(OBS);
  const offTools = (await off.rpc("tools/list")).json.result.tools as Array<{ name: string; inputSchema: { properties: { op: { enum: string[] } } } }>;
  check("switch off: partner_observe has no chat ops; a decide_request call → UNKNOWN_OP, nothing relayed", [offTools.find((t) => t.name === OBSERVE_TOOL)!.inputSchema.properties.op.enum.includes("decide_request"), (await off.rpc("tools/call", { name: OBSERVE_TOOL, arguments: { op: "decide_request", requestId: U(1), decision: "APPROVED", presentationToken: "a".repeat(48), confirmationText: "מאשר" } })).json.error?.message, off.calls.length], [false, "invalid arguments (UNKNOWN_OP)", 0]);
  const on = mk(ON);
  const onTools = (await on.rpc("tools/list")).json.result.tools as Array<{ name: string; inputSchema: { properties: { op: { enum: string[] } } } }>;
  ok("switch on: partner_observe lists present_request / decide_request", onTools.find((t) => t.name === OBSERVE_TOOL)!.inputSchema.properties.op.enum.includes("decide_request"));
  const dr = await on.rpc("tools/call", { name: OBSERVE_TOOL, arguments: { op: "decide_request", requestId: U(1), decision: "APPROVED", presentationToken: "a".repeat(48), confirmationText: "מאשר בהחלט" } });
  await on.rpc("tools/call", { name: OBSERVE_TOOL, arguments: { op: "cancel_request", requestId: U(1) } });
  check("the token id + hash reach ONLY the chat ops (cancel_request gets neither)", on.calls.map((c) => [c.op, c.actor.tokenHash === OWNER_TOKEN, "tokenId" in c.actor]), [["decide_request", true, true], ["cancel_request", false, false]]);
  ok("no audit row and no reply carries the token hash or the Owner's words", on.audit.every((a) => !JSON.stringify(a).includes(OWNER_TOKEN) && !JSON.stringify(a).includes("בהחלט")) && !dr.body.includes(OWNER_TOKEN));
  check("audit: method observe/decide_request (+ _try), tool NULL", on.audit.filter((a) => String(a.method).includes("decide")).map((a) => [a.tool, a.method]), [[null, "observe/decide_request_try"], [null, "observe/decide_request"]]);

  section("E. authenticateBearer — the hash is the sha256 of the presented bearer (the DB's own key)");
  {
    const bearer = "rbmcp_at_" + "x".repeat(40);
    let seenHash = "";
    const conf = cfg(ON);
    const r = await authenticateBearer(`Bearer ${bearer}`, { config: conf, store: { checkAccess: async (h: string) => { seenHash = h; return { result: "VALID", tokenId: U(1), clientId: "c", userId: OWNER, scope: "partner:read partner:observe", resource: conf.resource }; } } } as never);
    check("principal.tokenHash = sha256(bearer) = the hash checkAccess was given", [r.ok, r.ok ? r.principal.tokenHash : null], [true, seenHash]);
    ok("…and it is sha256 hex", /^[0-9a-f]{64}$/.test(seenHash) && seenHash === H(bearer));
  }

  section("F. Static guards");
  const src = read("lib/partner/brain/chat-decision.ts") + read("lib/partner/brain/server.ts");
  ok("the chat flow never calls owner_approval_decide (the session function) or a core", !/owner_approval_decide"|owner_approval_decide_core/.test(src));
  ok("the chat flow never passes an approved payload (APPROVED = exactly as presented)", !/approved:/.test(read("lib/partner/brain/chat-decision.ts")) && !/p_approved/.test(read("lib/brain-store.ts").split("createBrainOwnerTokenStore")[1].split("\n}\n")[0]));
  ok("no Push / cron / schedule in the chat decision path", !/sendPush|cron|setInterval|schedule/i.test(src));
  ok("the /sunny-approvals route still decides with the Owner's own session", /createSupabaseServer/.test(read("app/api/partner/approvals/route.ts")) && /ownerDecide\(/.test(read("app/api/partner/approvals/route.ts")));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
