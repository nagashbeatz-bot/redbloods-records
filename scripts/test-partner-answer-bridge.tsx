/**
 * Tests — Redbloods Partner ↔ Claude P1: answer an EXISTING surfaced Partner question through the connector.
 *
 * Run with:   npx tsx scripts/test-partner-answer-bridge.tsx
 *
 * NEVER touches production. Real OAuth core (in-memory store), real MCP adapter (handleMcpHttp), real Partner bridge,
 * real Integrity answer core, real Owner Context store over the in-memory fake of partner_owner_context, real register
 * over the production-shaped fixture. Plus: scope negotiation, fetch-guard boundary, provenance parser, static guards.
 */
import fs from "node:fs";
import path from "node:path";
import { readMcpConfig, ANSWER_SCOPE_STRING, MCP_SCOPE } from "../lib/integrations/partner-mcp/config";
import { authenticateBearer, consentToken, decideAuthorization, registerClientCore, tokenCore, validateAuthorizeRequest, advertisedScope, type OAuthDeps } from "../lib/integrations/partner-mcp/oauth";
import { protectedResourceMetadata } from "../lib/integrations/partner-mcp/metadata";
import { MemoryConsentReplayGuard } from "../lib/integrations/partner-mcp/consent";
import { pkceS256 } from "../lib/integrations/partner-mcp/crypto";
import { handleMcpHttp, type McpDeps } from "../lib/integrations/partner-mcp/mcp";
import { SlidingWindowLimiter } from "../lib/integrations/partner-mcp/rate-limit";
import { isAllowedMcpOnlyFetch } from "../lib/integrations/partner-mcp/mcp-only";
import type { AuditRow } from "../lib/integrations/partner-mcp/store";
import { createOwnerContextStore } from "../lib/partner/investigation/context-persistence";
import { mapOwnerContextRow, parseContextProvenance, type PersistedOwnerContext } from "../lib/partner/investigation/context-row";
import type { OwnerContextProvenance } from "../lib/partner/investigation/types";
import { buildCompanyIntegrityRegister } from "../lib/partner/integrity/register";
import { createIntegrityRequestLedger, registerAppliesContext, type IntegrityAnswerDeps } from "../lib/partner/integrity/answer";
import type { CompanyIntegrityRegister } from "../lib/partner/integrity/types";
import { answerViaConnectorCore, type BridgeDeps } from "../lib/partner/bridge/answer";
import { decodeQuestionRef, encodeQuestionRef } from "../lib/partner/bridge/ref";
import { FakeOwnerContextDb } from "./fixtures/owner-context-fake";
import { memoryMcpStore } from "./fixtures/mcp-memory-store";
import { BASE_ENV, CALLBACK, OWNER_BINDING, VERIFIER } from "./fixtures/mcp-oauth-scenarios";
import { NOW, LA_AVI, LA_NAGASH, U, input, type Opts } from "./fixtures/integrity-company";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}
const ok = (name: string, cond: boolean) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}`); fail++; } };

const OWNER_ID = "0f0f0f0f-0000-4000-8000-00000000a0a0";
const CLIENT = "rbmcp_" + "c".repeat(40);
const TOKEN = "00000000-0000-4000-8000-00000000abcd";
const ENV_ON = { ...BASE_ENV, PARTNER_MCP_ANSWER_ENABLED: "true", REDBLOODS_MCP_ONLY: "true" };
const cfg = (env: Record<string, string>) => { const r = readMcpConfig(env); if (!r.ok) throw new Error("config"); return r.config; };

/** A Partner world: fake Owner Context table + live company + the REAL integrity core deps + the REAL bridge. */
function world(o: { owner?: boolean; freshOverride?: () => Promise<CompanyIntegrityRegister | null> } = {}) {
  const db = new FakeOwnerContextDb();
  const live = { opts: {} as Opts, isOwner: o.owner ?? true };
  const readActive = async () => {
    const r = await createOwnerContextStore(db.client(), { now: () => NOW }).resolveCurrentOwnerContexts();
    return r.status === "OK" ? r.contexts : r.status === "NO_CONTEXT" ? [] : null;
  };
  const register = async () => buildCompanyIntegrityRegister(input({ ...live.opts, contexts: await readActive() }));
  const store = createOwnerContextStore(db.client(), { now: () => NOW });
  const ledger = createIntegrityRequestLedger();
  const base: IntegrityAnswerDeps = {
    async loadLive() { const c = await readActive(); if (!c) return { ok: false, detail: "x" }; return { ok: true, register: buildCompanyIntegrityRegister(input({ ...live.opts, contexts: c })), activeContexts: c }; },
    appendOwnerContext: (d) => store.appendOwnerContext(d),
    async verify(id, qid) { return registerAppliesContext(await register(), id, qid); },
    ledger, audit: () => {},
  };
  const bridge: BridgeDeps = {
    isOwner: async (uid) => live.isOwner && uid === OWNER_ID,
    integrityDeps: (prov: OwnerContextProvenance) => ({ ...base, provenance: prov }),
    freshRegister: o.freshOverride ?? register,
  };
  return { db, live, register, bridge };
}

function mcp(w: ReturnType<typeof world>, o: { scope?: string; env?: Record<string, string>; bind?: boolean; auditFail?: "attempt" | "result"; answerMax?: number } = {}) {
  const audit: AuditRow[] = [];
  const submits: unknown[] = [];
  let n = 0;
  const config = cfg(o.env ?? ENV_ON);
  const deps: McpDeps = {
    config,
    authenticate: async () => ({ ok: true as const, principal: { tokenId: TOKEN, clientId: CLIENT, userId: OWNER_ID, scope: o.scope ?? ANSWER_SCOPE_STRING } }),
    gateway: { brief: async () => ({ tool: "partner_brief", items: [] }), resolve: async () => ({ status: "NOT_FOUND" }), entity: async () => ({ status: "NOT_FOUND" }), query: async () => ({ status: "OK", items: [] }), capabilityIndex: () => [] },
    limiter: new SlidingWindowLimiter([{ windowMs: 60_000, max: 500 }]),
    audit: async (r) => {
      if (o.auditFail === "attempt" && r.method === "answer/attempt") throw new Error("audit down");
      if (o.auditFail === "result" && r.method === "tools/call" && r.tool === "partner_answer_question") throw new Error("audit down");
      audit.push(r);
    },
    auditRejected: async () => undefined, nowMs: () => Date.now(),
    ...(o.bind === false ? {} : { answer: {
      limiter: new SlidingWindowLimiter([{ windowMs: 3_600_000, max: o.answerMax ?? 10 }]),
      newId: () => U(5000 + ++n),
      submit: async (i) => { submits.push(i); return answerViaConnectorCore(w.bridge, i) as unknown as Record<string, unknown>; },
    } }),
  };
  const rpc = async (method: string, params?: unknown) => {
    const res = await handleMcpHttp({ method: "POST", header: (h) => (h === "authorization" ? "Bearer t" : null), bodyText: async () => JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params !== undefined ? { params } : {}) }) }, deps);
    return { status: res.status, headers: res.headers, json: res.body ? JSON.parse(res.body) : null };
  };
  const answer = async (args: Record<string, unknown>) => rpc("tools/call", { name: "partner_answer_question", arguments: args });
  return { deps, audit, submits, rpc, answer };
}

const refFor = async (w: ReturnType<typeof world>, labelArtistId: string) => {
  const q = (await w.register()).questions.find((x) => x.subject.id === labelArtistId)!;
  return { q, ref: encodeQuestionRef({ kind: "integrity", questionId: q.questionId, subjectId: q.subject.id, fingerprint: q.fingerprint }) };
};

void (async () => {
  console.log("\nA. scope: partner:answer is least-privilege, explicit, never implied");
  {
    const off = cfg(BASE_ENV), on = cfg(ENV_ON);
    check("switch off → the deployment advertises / grants read only", [advertisedScope(off), protectedResourceMetadata(off).scopes_supported], [MCP_SCOPE, [MCP_SCOPE]]);
    check("switch on without MCP-only → still off (never on the main app)", cfg({ ...BASE_ENV, PARTNER_MCP_ANSWER_ENABLED: "true" }).answerEnabled, false);
    check("switch on + MCP-only → partner:answer advertised", [on.answerEnabled, protectedResourceMetadata(on).scopes_supported], [true, ["partner:read", "partner:answer"]]);
    check("finance answering stays off (not wired)", [on.answerFinanceEnabled, cfg({ ...ENV_ON, PARTNER_MCP_ANSWER_FINANCE: "true" }).answerFinanceEnabled], [false, false]);
    const mk = (c: typeof on): OAuthDeps => ({ config: c, store: memoryMcpStore(() => Date.now()), nowSec: () => Math.floor(Date.now() / 1000), consentReplay: new MemoryConsentReplayGuard() });
    const offDeps = mk(off), onDeps = mk(on);
    check("switch off: DCR with partner:answer refused", (await registerClientCore({ redirect_uris: [CALLBACK], scope: "partner:read partner:answer" }, offDeps)).status, 400);
    const clientOff = JSON.parse((await registerClientCore({ redirect_uris: [CALLBACK] }, offDeps)).body!).client_id as string;
    const authz = async (d: OAuthDeps, clientId: string, scope?: string) => validateAuthorizeRequest({ response_type: "code", client_id: clientId, redirect_uri: CALLBACK, code_challenge: pkceS256(VERIFIER), code_challenge_method: "S256", resource: d.config.resource, state: "s", ...(scope !== undefined ? { scope } : {}) }, d);
    const offAns = await authz(offDeps, clientOff, "partner:read partner:answer");
    check("switch off: authorize asking for partner:answer → invalid_scope (redirect error)", !offAns.ok && offAns.kind === "REDIRECT" && offAns.location.includes("invalid_scope"), true);
    const offNone = await authz(offDeps, clientOff);
    check("switch off: no scope → read only", offNone.ok && offNone.request.scope, MCP_SCOPE);
    const clientOn = JSON.parse((await registerClientCore({ redirect_uris: [CALLBACK] }, onDeps)).body!).client_id as string;
    const readOnly = await authz(onDeps, clientOn, "partner:read");
    check("switch on: a request for read alone stays read-only (read never implies answer)", readOnly.ok && readOnly.request.scope, MCP_SCOPE);
    const both = await authz(onDeps, clientOn, "partner:read partner:answer");
    check("switch on: explicit request → exactly 'partner:read partner:answer'", both.ok && both.request.scope, ANSWER_SCOPE_STRING);
    const none = await authz(onDeps, clientOn);
    check("switch on: no scope asked → the consent shows + grants read + answer explicitly", none.ok && none.request.scope, ANSWER_SCOPE_STRING);
    if (both.ok && readOnly.ok) {
      const csrfRead = consentToken(readOnly.request, OWNER_BINDING, onDeps);
      const escalated = await decideAuthorization({ ...readOnly.request, scope: ANSWER_SCOPE_STRING }, { binding: OWNER_BINDING, approve: true, csrf: csrfRead }, onDeps);
      check("the consent token binds the scope: a read-only consent cannot be replayed as answer", escalated.ok, false);
      const d = await decideAuthorization(both.request, { binding: OWNER_BINDING, approve: true, csrf: consentToken(both.request, OWNER_BINDING, onDeps) }, onDeps);
      const code = d.ok ? new URL(d.location).searchParams.get("code")! : "";
      const t = JSON.parse((await tokenCore({ grant_type: "authorization_code", client_id: clientOn, code, redirect_uri: CALLBACK, code_verifier: VERIFIER, resource: onDeps.config.resource }, onDeps)).body!);
      check("token response states the granted scope", t.scope, ANSWER_SCOPE_STRING);
      const r2 = JSON.parse((await tokenCore({ grant_type: "refresh_token", client_id: clientOn, refresh_token: t.refresh_token, resource: onDeps.config.resource }, onDeps)).body!);
      check("refresh keeps exactly the same scope (no escalation by refresh)", r2.scope, ANSWER_SCOPE_STRING);
      const principal = await authenticateBearer(`Bearer ${r2.access_token}`, onDeps);
      check("an answer token is still a valid read token", principal.ok && principal.principal.scope, ANSWER_SCOPE_STRING);
      const dr = await decideAuthorization(readOnly.request, { binding: OWNER_BINDING, approve: true, csrf: consentToken(readOnly.request, OWNER_BINDING, onDeps) }, onDeps);
      const codeR = dr.ok ? new URL(dr.location).searchParams.get("code")! : "";
      const tr = JSON.parse((await tokenCore({ grant_type: "authorization_code", client_id: clientOn, code: codeR, redirect_uri: CALLBACK, code_verifier: VERIFIER, resource: onDeps.config.resource }, onDeps)).body!);
      const rr = JSON.parse((await tokenCore({ grant_type: "refresh_token", client_id: clientOn, refresh_token: tr.refresh_token, resource: onDeps.config.resource }, onDeps)).body!);
      check("a read-only family never gains partner:answer on refresh", [tr.scope, rr.scope], [MCP_SCOPE, MCP_SCOPE]);
      await onDeps.store.revokeToken((await import("../lib/integrations/partner-mcp/crypto")).sha256Hex(r2.access_token), clientOn);
      const revoked = await authenticateBearer(`Bearer ${r2.access_token}`, onDeps);
      check("revoked answer token → 401 before any tool", revoked.ok ? 200 : revoked.status, 401);
    }
  }

  console.log("\nB. switch OFF (the deployed state): the answer tool does not exist");
  {
    const w = world();
    const m = mcp(w, { env: BASE_ENV, bind: false });
    const tools = (await m.rpc("tools/list")).json.result.tools as Array<{ name: string }>;
    check("tools/list = the 4 read tools only", tools.map((t) => t.name), ["partner_brief", "partner_resolve", "partner_entity", "partner_query"]);
    const { ref } = await refFor(w, LA_AVI);
    const r = await m.answer({ questionRef: ref, answer: "LABEL_SONGS" });
    check("a call → 'Unknown tool', nothing submitted, nothing written", [r.json.error?.code, r.json.error?.message, m.submits.length, w.db.rows.length], [-32602, "Unknown tool", 0, 0]);
    check("audit: REJECTED UNKNOWN_TOOL with tool NULL (fits today's audit CHECK)", (() => { const c = m.audit.find((a) => a.method === "tools/call")!; return [c.status, c.error_category, c.tool]; })(), ["REJECTED", "UNKNOWN_TOOL", null]);
    const m2 = mcp(w, { env: ENV_ON, bind: false });
    check("switch on but bridge not bound → still unknown", (await m2.answer({ questionRef: ref, answer: "LABEL_SONGS" })).json.error?.message, "Unknown tool");
  }

  console.log("\nC. switch ON: authorization chain");
  {
    const w = world();
    const ro = mcp(w, { scope: MCP_SCOPE });
    check("read-only token: the answer tool is NOT listed", ((await ro.rpc("tools/list")).json.result.tools as Array<{ name: string }>).some((t) => t.name === "partner_answer_question"), false);
    const { ref } = await refFor(w, LA_AVI);
    const r = await ro.answer({ questionRef: ref, answer: "LABEL_SONGS" });
    check("read-only token calling it → HTTP 403 insufficient_scope + step-up challenge; nothing submitted / written", [r.status, /insufficient_scope/.test(r.headers["WWW-Authenticate"] ?? ""), /scope="partner:read partner:answer"/.test(r.headers["WWW-Authenticate"] ?? ""), ro.submits.length, w.db.rows.length], [403, true, true, 0, 0]);
    const m = mcp(w);
    const tools = (await m.rpc("tools/list")).json.result.tools as Array<{ name: string; annotations: Record<string, boolean>; inputSchema: { properties: Record<string, unknown>; additionalProperties: boolean } }>;
    const t = tools.find((x) => x.name === "partner_answer_question")!;
    check("answer token: listed, narrow schema {questionRef, answer}, not read-only, not destructive, idempotent", [!!t, Object.keys(t.inputSchema.properties).sort(), t.inputSchema.additionalProperties, t.annotations.readOnlyHint, t.annotations.destructiveHint, t.annotations.idempotentHint], [true, ["answer", "questionRef"], false, false, false, true]);
    const nonOwner = world({ owner: false });
    const mn = mcp(nonOwner);
    const rn = await mn.answer({ questionRef: (await refFor(nonOwner, LA_AVI)).ref, answer: "LABEL_SONGS" });
    check("the token's user is no longer the Owner → NOT_AUTHORIZED, nothing written", [rn.json.result.structuredContent.status, nonOwner.db.rows.length], ["NOT_AUTHORIZED", 0]);
  }

  console.log("\nD. the happy path: LEARNED only after full verification");
  {
    const w = world();
    const m = mcp(w);
    const { q, ref } = await refFor(w, LA_AVI);
    const r = await m.answer({ questionRef: ref, answer: "LABEL_SONGS" });
    const sc = r.json.result.structuredContent;
    check("LEARNED + recorded OWNER_DECISION via Claude + the fixed confirmation", [r.json.result.isError, sc.status, sc.recorded?.epistemic, sc.recorded?.provenance, sc.recorded?.answerCode, sc.ownerMessageHe], [false, "LEARNED", "OWNER_DECISION", "OWNER_VIA_CLAUDE", "LABEL_SONGS", "למדתי. אשתמש בזה כשאני מנתח את הפרויקטים של אבי מולה."]);
    check("exactly one Owner Context row", w.db.rows.length, 1);
    const row = w.db.rows[0];
    const attempt = m.audit.find((a) => a.method === "answer/attempt")!;
    check("row provenance = owner_via_claude with client, token and the ATTEMPT audit id", row.provenance, { source: "owner_via_claude", channel: "mcp", client_id: CLIENT, token_id: TOKEN, attempt_audit_id: attempt.id });
    check("row content comes from the LIVE question (text / fingerprint / subject / type), answer = the selected code", [row.question_text === q.textHe, row.case_facts_fingerprint === q.fingerprint, row.subject_id, row.question_type, row.answer_code, row.supersedes_id, row.scope], [true, true, LA_AVI, "INTEGRITY_LABEL_PROJECT_CLASSIFICATION", "LABEL_SONGS", null, "CASE_INSTANCE"]);
    check("audit: attempt row BEFORE the write, result row after (OK)", m.audit.filter((a) => a.tool === "partner_answer_question").map((a) => [a.method, a.status, a.error_category]), [["answer/attempt", "OK", null], ["tools/call", "OK", null]]);
    ok("audit rows carry no question text / answer label / ref (fingerprint only)", m.audit.every((a) => !JSON.stringify(a).includes("אבי") && !JSON.stringify(a).includes("pq1.") && (a.input_fingerprint === null || /^[0-9a-f]{64}$/.test(a.input_fingerprint))));
    const fresh = await w.register();
    ok("fresh read: the question is gone, OWNER_DECISION applied, learned via CLAUDE", !fresh.questions.some((x) => x.subject.id === LA_AVI) && fresh.learned.some((l) => l.decision.via === "CLAUDE" && l.status === "APPLIES"));
    ok("the reply's nextQuestions come from the fresh read (Avi gone, deferred moved up)", !sc.nextQuestions.some((x: { subject: string }) => x.subject === "אבי מולה") && sc.nextQuestions.length === 2);
    const back = mapOwnerContextRow(row);
    ok("the stored row reads back through the strict parser with its provenance", back.ok && back.value.provenance.source === "owner_via_claude");
  }

  console.log("\nE. stale / replay / concurrency / forged refs / invalid codes");
  {
    const w = world();
    const m = mcp(w);
    const { q, ref } = await refFor(w, LA_AVI);
    const [a1, a2] = await Promise.all([m.answer({ questionRef: ref, answer: "LABEL_SONGS" }), m.answer({ questionRef: ref, answer: "LABEL_SONGS" })]);
    check("concurrent double submit → one LEARNED + one ALREADY_ANSWERED, one row", [[a1.json.result.structuredContent.status, a2.json.result.structuredContent.status].sort(), w.db.rows.length], [["ALREADY_ANSWERED", "LEARNED"], 1]);
    const again = await m.answer({ questionRef: ref, answer: "LABEL_SONGS" });
    check("replay later → ALREADY_ANSWERED, still one row", [again.json.result.structuredContent.status, w.db.rows.length], ["ALREADY_ANSWERED", 1]);
    const other = await m.answer({ questionRef: ref, answer: "CLIENT_WORK" });
    check("a different answer for the same facts → ALREADY_ANSWERED (no overwrite; revision not supported)", [other.json.result.structuredContent.status, w.db.rows.length, w.db.rows[0].answer_code], ["ALREADY_ANSWERED", 1, "LABEL_SONGS"]);

    const w2 = world();
    const m2 = mcp(w2);
    const r2 = await refFor(w2, LA_NAGASH);
    w2.live.opts = { businessType: { [`00000000-0000-4000-8000-000000000104`]: "לייבל" } };
    const gone = await m2.answer({ questionRef: r2.ref, answer: "MIXED" });
    check("facts changed so the question is no longer asked → NOT_CURRENT, nothing written", [gone.json.result.structuredContent.status, w2.db.rows.length], ["NOT_CURRENT", 0]);
    w2.live.opts = { extraAviProject: true };
    const aviOld = await refFor(world(), LA_AVI);
    const stale = await m2.answer({ questionRef: aviOld.ref, answer: "LABEL_SONGS" });
    check("the question's facts changed after it was shown → STALE_QUESTION + the fresh ref returned", [stale.json.result.structuredContent.status, stale.json.result.structuredContent.nextQuestions.some((x: { questionRef: string }) => decodeQuestionRef(x.questionRef)?.fingerprint !== decodeQuestionRef(aviOld.ref)!.fingerprint), w2.db.rows.length], ["STALE_QUESTION", true, 0]);

    const w3 = world();
    const m3 = mcp(w3);
    const good = await refFor(w3, LA_AVI);
    const forged = [
      encodeQuestionRef({ kind: "integrity", questionId: good.q.questionId, subjectId: LA_NAGASH, fingerprint: good.q.fingerprint }),
      encodeQuestionRef({ kind: "integrity", questionId: good.q.questionId, subjectId: good.q.subject.id, fingerprint: "0".repeat(64) }),
      encodeQuestionRef({ kind: "integrity", questionId: "integrity:INTEGRITY_CLIENT_IDENTITY:לקוח כפול::INTEGRITY_CLIENT_IDENTITY", subjectId: "לקוח כפול", fingerprint: "a".repeat(64) }),
      encodeQuestionRef({ kind: "integrity", questionId: "finance:X:recurring:VICTOR_SALARY:2026-05::FINANCE_RECURRING_PAYMENT_STATUS", subjectId: "x", fingerprint: "a".repeat(64) }),
      "pq1." + "A".repeat(40),
    ];
    const statuses = [];
    for (const f of forged) statuses.push((await m3.answer({ questionRef: f, answer: "LABEL_SONGS" })).json.result.structuredContent.status);
    check("forged refs (other subject / wrong fingerprint / deferred question / finance id / garbage) never write", [statuses, w3.db.rows.length], [["NOT_CURRENT", "STALE_QUESTION", "INVALID_ANSWER", "NOT_CURRENT", "NOT_CURRENT"], 0]);
    const fin = await m3.answer({ questionRef: encodeQuestionRef({ kind: "finance", questionId: "finance:X:recurring:VICTOR_SALARY:2026-05::FINANCE_RECURRING_PAYMENT_STATUS", subjectId: "VICTOR_SALARY:2026-05", fingerprint: "a".repeat(64) }), answer: "PAID_NEEDS_RECORDING" });
    check("finance refs → FINANCE_ANSWERING_DISABLED (not wired in P1)", fin.json.result.structuredContent.status, "FINANCE_ANSWERING_DISABLED");
    const codes = [];
    for (const c of ["SAME_PERSON", "OTHER", "MAYBE"]) codes.push((await m3.answer({ questionRef: good.ref, answer: c })).json.result.structuredContent.status);
    check("codes the question does not offer → INVALID_ANSWER", codes, ["INVALID_ANSWER", "INVALID_ANSWER", "INVALID_ANSWER"]);
    const badShape = await m3.answer({ questionRef: good.ref, answer: "label_songs" });
    const extra = await m3.answer({ questionRef: good.ref, answer: "LABEL_SONGS", provenance: { source: "owner_manual" } });
    const construct = await m3.answer({ questionRef: good.ref, answer: "LABEL_SONGS", questionText: "x", subjectId: LA_NAGASH, supersedesId: U(1), note: "x" });
    check("input shape: lowercase code / extra keys (provenance, text, subject, supersedes, note) → INVALID_ARGS, nothing submitted", [badShape.json.error?.code, extra.json.error?.code, construct.json.error?.code, w3.db.rows.length], [-32602, -32602, -32602, 0]);
  }

  console.log("\nF. failure modes: audit / verification / rate limit");
  {
    const w = world();
    const mA = mcp(w, { auditFail: "attempt" });
    const { ref } = await refFor(w, LA_AVI);
    const ra = await mA.answer({ questionRef: ref, answer: "LABEL_SONGS" });
    check("attempt audit cannot be written → refused, NOTHING written, bridge never called", [ra.json.error?.code, w.db.rows.length, mA.submits.length], [-32001, 0, 0]);
    const mR = mcp(w, { auditFail: "result" });
    const rr = await mR.answer({ questionRef: ref, answer: "LABEL_SONGS" });
    check("result audit fails after the write → AUDIT_FAILED (persisted:true), never LEARNED", [rr.json.result.structuredContent.status, rr.json.result.structuredContent.persisted, rr.json.result.isError, w.db.rows.length], ["AUDIT_FAILED", true, true, 1]);
    const wv = world({ freshOverride: async () => null });
    const mv = mcp(wv);
    const rv = await mv.answer({ questionRef: (await refFor(wv, LA_AVI)).ref, answer: "LABEL_SONGS" });
    check("fresh verification impossible → NOT_VERIFIED (row persisted) — never LEARNED", [rv.json.result.structuredContent.status, rv.json.result.structuredContent.persisted, wv.db.rows.length], ["NOT_VERIFIED", true, 1]);
    const wr = world();
    const ml = mcp(wr, { answerMax: 1 });
    const refs = [(await refFor(wr, LA_AVI)).ref, (await refFor(wr, LA_NAGASH)).ref];
    await ml.answer({ questionRef: refs[0], answer: "LABEL_SONGS" });
    const limited = await ml.answer({ questionRef: refs[1], answer: "MIXED" });
    check("answer rate limit → RATE_LIMITED, no second write", [limited.json.result.structuredContent.error, wr.db.rows.length], ["RATE_LIMITED", 1]);
  }

  console.log("\nG. the write boundary (MCP can SELECT an answer, never CONSTRUCT an Owner Context row)");
  {
    const on = { ownerContextAppend: true };
    const host = "abc.supabase.co";
    const f = (p: string, m: string, o: { ownerContextAppend?: boolean } = on) => isAllowedMcpOnlyFetch(new URL(`https://${host}${p}`), m, host, o);
    check("fetch guard: answer switch OFF → Owner Context POST blocked", f("/rest/v1/partner_owner_context?columns=a&select=*", "POST", {}), false);
    check("fetch guard ON: only POST to the exact table path; no upsert; no PATCH / DELETE / PUT; no look-alike paths; no other table",
      [f("/rest/v1/partner_owner_context?columns=a&select=*", "POST"), f("/rest/v1/partner_owner_context?on_conflict=id", "POST"), f("/rest/v1/partner_owner_context?id=eq.1", "PATCH"), f("/rest/v1/partner_owner_context", "DELETE"), f("/rest/v1/partner_owner_context", "PUT"),
        f("/rest/v1/partner_owner_context2", "POST"), f("/rest/v1/partner_owner_context/x", "POST"), f("/rest/v1/projects", "POST"), f("/rest/v1/transactions", "POST"), f("/rest/v1/rpc/partner_execute_record_paid_expense", "POST"), f("/rest/v1/partner_action_events", "POST")],
      [true, false, false, false, false, false, false, false, false, false, false]);
    const root = path.resolve(__dirname, "..");
    const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
    const mcpSrc = ["mcp.ts", "tools.ts", "server.ts", "oauth.ts", "mcp-only.ts", "store-supabase.ts"].map((x) => read(`lib/integrations/partner-mcp/${x}`)).join("\n");
    ok("MCP never imports the Owner Context store / persistence / answer cores (only the bridge server, lazily)", !/context-store|context-persistence|integrity\/answer|integrity\/server|finance\/answer/.test(mcpSrc) && /await import\("@\/lib\/partner\/bridge\/server"\)/.test(read("lib/integrations/partner-mcp/server.ts")));
    ok("MCP has no generic table write (only the audit insert)", (mcpSrc.match(/\.from\("/g) ?? []).length === 2 && /from\("partner_gateway_audit"\)\.insert/.test(mcpSrc) && /from\("partner_mcp_clients"\)\.select/.test(mcpSrc));
    const bridge = read("lib/partner/bridge/answer.ts") + read("lib/partner/bridge/server.ts") + read("lib/partner/bridge/ref.ts");
    ok("the bridge imports no store, no Supabase table access, no finance / action code", !/context-store|context-persistence|appendOwnerContext|\.insert\(|\.rpc\(|finance\/|actions\/(service|action-service|event)/.test(bridge) && !/\.from\(/.test(bridge.replace(/Uint8Array\.from\(/g, "")));
    ok("the bridge calls ONLY the existing integrity core (with provenance) — no draft is built here", /answerIntegrityQuestionCore\(deps\.integrityDeps\(provenance\)/.test(bridge) && !/questionText:|caseFactsFingerprint:|supersedesId:/.test(bridge));
    const core = read("lib/partner/integrity/answer.ts").replace(/\/\*[\s\S]*?\*\//g, "");
    ok("the core builds every draft field from the LIVE question; only provenance comes from the binding", /questionText: q\.textHe/.test(core) && /caseFactsFingerprint: q\.fingerprint/.test(core) && /subjectId: q\.subject\.id/.test(core) && /provenance: deps\.provenance \?\? \{ source: "owner_manual" \}/.test(core));
    ok("only the bridge server sets owner_via_claude provenance (via the bridge core)", /source: "owner_via_claude"/.test(read("lib/partner/bridge/answer.ts")) && !/owner_via_claude/.test(mcpSrc));
    ok("the answer switch requires MCP-only mode, and the MCP binding is created only when it is on", /PARTNER_MCP_ANSWER_ENABLED === "true" && env\.REDBLOODS_MCP_ONLY === "true"/.test(read("lib/integrations/partner-mcp/config.ts")) && /if \(config\.answerEnabled\) \{/.test(read("lib/integrations/partner-mcp/server.ts")));
    ok("instrumentation opens the Owner Context append only with the answer switch", /ownerContextAppend: process\.env\.PARTNER_MCP_ANSWER_ENABLED === "true"/.test(read("instrumentation.ts")));
    ok("no Calendar / Push / Cron / Finance write in P1 files", !/googleapis|web-push|sendPush|cron|transactions/.test(bridge));
  }

  console.log("\nH. provenance parser (strict)");
  {
    const e: string[] = [];
    const good = { source: "owner_via_claude", channel: "mcp", client_id: CLIENT, token_id: TOKEN, attempt_audit_id: U(9) };
    check("owner_via_claude accepted exactly", parseContextProvenance(good, e), good);
    const bad = [{ ...good, extra: 1 }, { ...good, channel: "web" }, { ...good, client_id: "x" }, { ...good, token_id: "x" }, { source: "claude" }, { source: "owner_manual", by: "x" }];
    check("extra keys / wrong channel / bad ids / unknown source refused", bad.map((b) => parseContextProvenance(b, [])), [null, null, null, null, null, null]);
    check("owner_manual unchanged", parseContextProvenance({ source: "owner_manual" }, []), { source: "owner_manual" });
  }

  console.log("\nI. the ref codec");
  {
    const r = { kind: "integrity" as const, questionId: `integrity:INTEGRITY_LABEL_PROJECT_CLASSIFICATION:${LA_AVI}::INTEGRITY_LABEL_PROJECT_CLASSIFICATION`, subjectId: LA_AVI, fingerprint: "b".repeat(64) };
    check("round trip", decodeQuestionRef(encodeQuestionRef(r)), r);
    check("Hebrew subject survives", decodeQuestionRef(encodeQuestionRef({ ...r, subjectId: "לקוח כפול" }))?.subjectId, "לקוח כפול");
    check("garbage / wrong prefix / bad fingerprint → null", [decodeQuestionRef("pq2.xxxxxxxxxxxxxxxxxxxx"), decodeQuestionRef(`pq1.${Buffer.from(JSON.stringify(["i", "q", "s", "nothex"])).toString("base64url")}`), decodeQuestionRef(42)], [null, null, null]);
    ok("the ref never exposes more than kind / question / subject / fingerprint", JSON.parse(Buffer.from(encodeQuestionRef(r).slice(4), "base64url").toString()).length === 4);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
