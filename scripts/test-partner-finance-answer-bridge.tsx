/**
 * Tests — Redbloods Partner ↔ Claude: answering a FINANCE question through the connector (partner_answer_question, kind "finance").
 *
 * Run with:   npx tsx scripts/test-partner-finance-answer-bridge.tsx
 *
 * NEVER touches production. Real Finance brain / integrity / answer core / Owner Context store (in-memory fake of
 * partner_owner_context), real bridge core, real readers (owner_needs, partner_entity questions), real MCP config.
 * A Finance answer is the Owner's DECISION only: it never writes a transaction, an income, a price or a setting.
 */
import fs from "node:fs";
import path from "node:path";
import { buildFinanceBrief } from "../lib/partner/finance/brief";
import { deriveFinanceView } from "../lib/partner/finance/view";
import { answerFinanceQuestionCore, createRequestLedger, type FinanceAnswerDeps, type FinanceLiveView } from "../lib/partner/finance/answer";
import { financeAnswersFromContexts } from "../lib/partner/finance/owner-answers";
import type { OwnerQuestion } from "../lib/partner/finance/integrity";
import type { FinanceRaw } from "../lib/partner/finance/types";
import { createOwnerContextStore } from "../lib/partner/investigation/context-persistence";
import { answerViaConnectorCore, type BridgeDeps } from "../lib/partner/bridge/answer";
import { financeAnswerAvailableFor, financeAnswerOffer, financeAnswerSwitch } from "../lib/partner/bridge/finance-ref";
import { decodeQuestionRef, encodeQuestionRef } from "../lib/partner/bridge/ref";
import { readMcpConfig } from "../lib/integrations/partner-mcp/config";
import { ownerNeeds } from "../lib/partner/knowledge/capabilities/partner";
import { questionsFor } from "../lib/partner/gateway/entity-common";
import { FINANCE_ANSWER_OPTIONS } from "../lib/partner/investigation/finance-questions";
import type { OwnerContextProvenance } from "../lib/partner/investigation/types";
import { BASE_ENV } from "./fixtures/mcp-oauth-scenarios";
import { empty, project, tx } from "./fixtures/finance-mirror";
import { FakeOwnerContextDb } from "./fixtures/owner-context-fake";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}
const ok = (name: string, cond: boolean) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}`); fail++; } };

const NOW = new Date("2026-09-24T09:00:00Z");
const OWNER = "0f0f0f0f-0000-4000-8000-00000000a0a0";
const ACTOR = { userId: OWNER, clientId: "rbmcp_" + "c".repeat(40), tokenId: "00000000-0000-4000-8000-00000000abcd" };
const TYPE = "FINANCE_COMPLETED_PROJECT_INCOME_STATUS";
const CODE = "INCOME_RECEIVED_NOT_RECORDED";
const HE_LABEL = "ההכנסה התקבלה ולא נרשמה";

/** A completed client project with a paid expense and NO income → the Owner is asked FINANCE_COMPLETED_PROJECT_INCOME_STATUS. */
const makeRaw = (): FinanceRaw => {
  const p = project({ name: "מה באלי", status: "הושלם", businessType: "לקוח", updatedAt: "2026-09-20T00:00:00Z" });
  return empty({ projects: [p], transactions: [tx({ projectId: p.id, type: "expense", amount: 300, status: "שולם", expenseScope: "פרויקט" })] });
};

function world() {
  const db = new FakeOwnerContextDb();
  const store = createOwnerContextStore(db.client(), { now: () => NOW });
  const st = { raw: makeRaw(), isOwner: true, flag: true, calls: { live: 0, append: 0, financeDeps: 0, integrity: 0 }, prov: [] as OwnerContextProvenance[] };
  const answers = async () => { const r = await store.resolveCurrentOwnerContexts(); if (r.status === "OK") return financeAnswersFromContexts(r.contexts); if (r.status === "NO_CONTEXT") return []; throw new Error(r.status); };
  const view = async () => { const a = await answers(); const v = deriveFinanceView(st.raw, NOW, a); return { v, a, brief: buildFinanceBrief(v.state, v.integrity, { actionNoteHe: v.actionNoteHe }) }; };
  const financeDeps = (provenance: OwnerContextProvenance): FinanceAnswerDeps => ({
    async loadLive() { st.calls.live++; const a = await answers(); return { ok: true, integrity: deriveFinanceView(st.raw, NOW, a).integrity, answers: a }; },
    async appendOwnerContext(d) { st.calls.append++; st.prov.push(provenance); return store.appendOwnerContext(d); },
    ledger: ledger, audit: () => {}, provenance,
  });
  const ledger = createRequestLedger();
  const bridge: BridgeDeps = {
    isOwner: async (u) => st.isOwner && u === OWNER,
    integrityDeps: () => { st.calls.integrity++; throw new Error("integrity must not be used for a finance ref"); },
    freshRegister: async () => null,
    financeEnabled: () => st.flag,
    financeDeps: (p) => { st.calls.financeDeps++; return financeDeps(p); },
    async freshFinance(): Promise<FinanceLiveView | null> { const a = await answers(); return { ok: true, integrity: deriveFinanceView(st.raw, NOW, a).integrity, answers: a }; },
  };
  const question = async (): Promise<OwnerQuestion> => (await view()).v.integrity.top.questions.find((q) => q.questionType === TYPE)!;
  const refOf = (q: OwnerQuestion) => financeAnswerOffer(q)!.questionRef;
  const answer = (questionRef: unknown, a: unknown, confirmationText: unknown = "כן") => answerViaConnectorCore(bridge, { questionRef, answer: a, confirmationText, actor: ACTOR, attemptAuditId: "00000000-0000-4000-8000-000000000001" });
  return { db, st, view, question, refOf, answer, bridge };
}

const ENV_ON = { ...BASE_ENV, PARTNER_MCP_ANSWER_ENABLED: "true", REDBLOODS_MCP_ONLY: "true", PARTNER_MCP_ANSWER_FINANCE: "true" };
const withEnv = async <T,>(env: Record<string, string | undefined>, fn: () => Promise<T> | T): Promise<T> => {
  const keys = ["PARTNER_MCP_ANSWER_ENABLED", "REDBLOODS_MCP_ONLY", "PARTNER_MCP_ANSWER_FINANCE"];
  const saved = keys.map((k) => process.env[k]);
  keys.forEach((k) => { if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; });
  try { return await fn(); } finally { keys.forEach((k, i) => { if (saved[i] === undefined) delete process.env[k]; else process.env[k] = saved[i]; }); }
};
const ON = { PARTNER_MCP_ANSWER_ENABLED: "true", REDBLOODS_MCP_ONLY: "true", PARTNER_MCP_ANSWER_FINANCE: "true" };
const EXTERNAL = { channel: "EXTERNAL" as const, ownerAuthorized: true };

void (async () => {
  console.log("\nA. the flag: default off, honoured only with the answer switch + MCP-only");
  {
    const cfg = (env: Record<string, string>) => { const r = readMcpConfig(env); if (!r.ok) throw new Error("config"); return r.config; };
    check("default → off", cfg(BASE_ENV).answerFinanceEnabled, false);
    check("finance flag alone → off (needs the answer switch + MCP-only)", [cfg({ ...BASE_ENV, PARTNER_MCP_ANSWER_FINANCE: "true" }).answerFinanceEnabled, cfg({ ...BASE_ENV, PARTNER_MCP_ANSWER_ENABLED: "true", PARTNER_MCP_ANSWER_FINANCE: "true" }).answerFinanceEnabled], [false, false]);
    check("answer switch + MCP-only without the finance flag → off", cfg({ ...BASE_ENV, PARTNER_MCP_ANSWER_ENABLED: "true", REDBLOODS_MCP_ONLY: "true" }).answerFinanceEnabled, false);
    check("any value but exactly \"true\" → off", cfg({ ...ENV_ON, PARTNER_MCP_ANSWER_FINANCE: "1" }).answerFinanceEnabled, false);
    check("all three → on", cfg(ENV_ON).answerFinanceEnabled, true);
    check("the reader predicate and the config agree", [financeAnswerSwitch({}), financeAnswerSwitch(ENV_ON), financeAnswerSwitch({ ...ENV_ON, PARTNER_MCP_ANSWER_FINANCE: "" })], [false, true, false]);
    check("INTERNAL audience / no audience never sees a finance question as answerable through Claude", [financeAnswerAvailableFor(undefined, ENV_ON), financeAnswerAvailableFor({ channel: "INTERNAL", ownerAuthorized: true }, ENV_ON), financeAnswerAvailableFor(EXTERNAL, ENV_ON)], [false, false, true]);
  }

  console.log("\nB. the question carries a ref + option codes (owner_needs + partner_entity)");
  {
    const w = world();
    const q = await w.question();
    ok("the fixture asks FINANCE_COMPLETED_PROJECT_INCOME_STATUS", !!q && !!q.identity);
    const offer = financeAnswerOffer(q)!;
    const ref = decodeQuestionRef(offer.questionRef)!;
    check("ref is the existing pq1 format, kind finance, with the live id + fingerprint", [offer.questionRef.startsWith("pq1."), ref.kind, ref.questionId, ref.subjectId, ref.fingerprint], [true, "finance", q.identity!.questionId, q.subject.id, q.identity!.fingerprint]);
    check("every option is { code, labelHe } — the code is not lost", offer.options, FINANCE_ANSWER_OPTIONS[TYPE].map((o) => ({ code: o.code, labelHe: o.labelHe })));
    ok("INCOME_RECEIVED_NOT_RECORDED is offered with its Hebrew label", offer.options.some((o) => o.code === CODE && o.labelHe === HE_LABEL));

    const { v, brief } = await w.view();
    const fin = { state: v.state, integrity: v.integrity, actions: v.actions, raw: w.st.raw, brief, answersAvailable: true };
    const src = { now: NOW, finance: { status: "OK", value: fin }, audience: EXTERNAL } as never;
    const on = await withEnv(ON, () => ownerNeeds.read(src, { mode: "current", params: {}, limit: 10, cursor: null } as never));
    const off = await withEnv({}, () => ownerNeeds.read(src, { mode: "current", params: {}, limit: 10, cursor: null } as never));
    const fq = (r: typeof on) => r.items.find((i) => (i.fields as { topic?: string }).topic === TYPE)!;
    const fOn = fq(on).fields as Record<string, unknown> & { answer?: { questionRef: string; options: Array<{ code: string; label: { text: string } }> }; options: Array<{ code: string; label: { text: string } }> };
    const fOff = fq(off).fields as typeof fOn;
    check("owner_needs, flag ON: answerable + answerVia CLAUDE + the exact ref", [fOn.answerable, fOn.answerVia, fOn.answer?.questionRef], [true, "CLAUDE", offer.questionRef]);
    check("owner_needs, flag ON: answer.options are { code, label } incl. INCOME_RECEIVED_NOT_RECORDED", fOn.answer?.options.find((o) => o.code === CODE)?.label.text, HE_LABEL);
    check("owner_needs, flag ON: display options keep their codes too", fOn.options.map((o) => o.code), FINANCE_ANSWER_OPTIONS[TYPE].map((o) => o.code));
    check("owner_needs, flag OFF: not answerable, no ref, dashboard only (codes still visible)", [fOff.answerable, fOff.answerVia, fOff.answer === undefined, fOff.options.map((o) => o.code)], [false, "DASHBOARD_ONLY", true, FINANCE_ANSWER_OPTIONS[TYPE].map((o) => o.code)]);
    check("owner_needs through an INTERNAL audience → never answerable via Claude", (await withEnv(ON, () => ownerNeeds.read({ ...(src as object), audience: { channel: "INTERNAL", ownerAuthorized: true } } as never, { mode: "current", params: {}, limit: 10, cursor: null } as never))).items.filter((i) => (i.fields as { topic?: string }).topic === TYPE).map((i) => (i.fields as { answerable: boolean }).answerable), [false]);

    const keys = new Set([`project:${q.subject.id}`]);
    const eOn = await withEnv(ON, () => questionsFor({ now: NOW, finance: { status: "OK", value: fin }, audience: EXTERNAL } as never, keys));
    const eOff = await withEnv({}, () => questionsFor({ now: NOW, finance: { status: "OK", value: fin }, audience: EXTERNAL } as never, keys));
    const pick = (a: typeof eOn) => a.find((x) => x.questionType === TYPE)!;
    check("openQuestions, flag ON: answerable + the SAME ref + codes", [pick(eOn).answerable, pick(eOn).answer?.questionRef, pick(eOn).answer?.options.some((o) => o.code === CODE)], [true, offer.questionRef, true]);
    check("openQuestions, flag OFF: answerable is false (no answer path) and no ref", [pick(eOff).answerable, pick(eOff).answer === undefined], [false, true]);
    check("owner_needs and openQuestions agree", [fOn.answer?.questionRef === pick(eOn).answer?.questionRef, fOn.answerable === pick(eOn).answerable, fOff.answerable === pick(eOff).answerable], [true, true, true]);
  }

  console.log("\nC. answering: the existing Finance core, owner_via_claude, Owner Context only");
  {
    const w = world();
    const q = await w.question();
    const before = JSON.stringify(w.st.raw);
    const r = await w.answer(w.refOf(q), CODE);
    check("INCOME_RECEIVED_NOT_RECORDED → LEARNED + persisted", [r.status, r.persisted], ["LEARNED", true]);
    check("recorded = the Owner's decision, via Claude, with the code + Hebrew label", [r.recorded?.answerCode, r.recorded?.answerHe, r.recorded?.epistemic, r.recorded?.provenance], [CODE, HE_LABEL, "OWNER_DECISION", "OWNER_VIA_CLAUDE"]);
    check("exactly ONE Owner Context row, provenance owner_via_claude (client + token + attempt audit), code stored", [w.db.rows.length, w.db.rows[0].answer_code, (w.db.rows[0] as { provenance_source?: string; provenance?: { source?: string } }).provenance_source ?? (w.db.rows[0] as { provenance?: { source?: string } }).provenance?.source ?? null], [1, CODE, "owner_via_claude"]);
    check("the message says it records no income / transaction", /לא רושם הכנסה/.test(r.ownerMessageHe), true);
    check("I. no transaction, income, price or setting was created or changed (the raw finance data is byte-identical)", JSON.stringify(w.st.raw) === before, true);
    check("I. the ONLY table written is the Owner Context table (rows have only that shape)", w.db.rows.every((x: Record<string, unknown>) => x.question_type === TYPE), true);
    check("the question is no longer asked afterwards (CONSUMED as an Owner decision)", (await w.view()).v.integrity.top.questions.some((x) => x.questionType === TYPE && x.subject.id === q.subject.id), false);
  }

  console.log("\nD. only a closed option CODE is an answer");
  {
    const w = world();
    const q = await w.question();
    const ref = w.refOf(q);
    const stat = async (a: unknown) => (await w.answer(ref, a)).status;
    check("the Hebrew label is not an answer", await stat(HE_LABEL), "INVALID_ANSWER");
    check("a code of ANOTHER question / unknown code / lowercase / empty / non-string", [await stat("PAID_NEEDS_RECORDING"), await stat("MAYBE"), await stat("income_received_not_recorded"), await stat(""), await stat(5)], ["INVALID_ANSWER", "INVALID_ANSWER", "INVALID_ANSWER", "INVALID_ANSWER", "INVALID_ANSWER"]);
    check("EXACT_DATE can never travel through { questionRef, answer } (stays a dashboard answer)", await stat("EXACT_DATE"), "INVALID_ANSWER");
    check("nothing was written and the core was never reached", [w.db.rows.length, w.st.calls.append], [0, 0]);
  }

  console.log("\nE. stale / forged refs");
  {
    const w = world();
    const q = await w.question();
    const ref = w.refOf(q);
    w.st.raw.transactions.push(tx({ projectId: q.subject.id, type: "expense", amount: 111, status: "שולם", expenseScope: "פרויקט" }));
    const stale = await w.answer(ref, CODE);
    check("the facts changed after the question was shown → STALE_QUESTION, nothing written", [stale.status, w.db.rows.length], ["STALE_QUESTION", 0]);
    ok("the fresh question (new ref) is returned", stale.nextQuestions.length > 0 && stale.nextQuestions.every((n) => n.questionRef !== ref && n.options.every((o) => /^[A-Z_]+$/.test(o.code))));
    const q2 = await w.question();
    const forged = [
      encodeQuestionRef({ kind: "finance", questionId: q2.identity!.questionId, subjectId: q2.subject.id, fingerprint: "0".repeat(64) }),
      encodeQuestionRef({ kind: "finance", questionId: "finance:X:nope::FINANCE_COMPLETED_PROJECT_INCOME_STATUS", subjectId: "x", fingerprint: "a".repeat(64) }),
      encodeQuestionRef({ kind: "finance", questionId: "finance:X:nope::NOT_A_FINANCE_TYPE", subjectId: "x", fingerprint: "a".repeat(64) }),
      "pq1." + "A".repeat(40),
    ];
    const out: string[] = [];
    for (const f of forged) out.push((await w.answer(f, CODE)).status);
    check("forged / unknown / foreign refs never write", [out, w.db.rows.length], [["STALE_QUESTION", "NOT_CURRENT", "NOT_CURRENT", "NOT_CURRENT"], 0]);
  }

  console.log("\nF. owner-only");
  {
    const w = world();
    const q = await w.question();
    w.st.isOwner = false;
    const r = await w.answer(w.refOf(q), CODE);
    check("a non-Owner principal → NOT_AUTHORIZED, nothing written", [r.status, w.db.rows.length, w.st.calls.append], ["NOT_AUTHORIZED", 0, 0]);
  }

  console.log("\nG. flag OFF → Finance answering is refused before anything runs");
  {
    const w = world();
    const q = await w.question();
    w.st.flag = false;
    const r = await w.answer(w.refOf(q), CODE);
    check("FINANCE_ANSWERING_DISABLED, nothing written, no finance dependency created", [r.status, r.persisted, w.db.rows.length, w.st.calls.financeDeps, w.st.calls.live], ["FINANCE_ANSWERING_DISABLED", false, 0, 0, 0]);
    const bare = await answerViaConnectorCore({ isOwner: async () => true, integrityDeps: () => { throw new Error("x"); }, freshRegister: async () => null }, { questionRef: w.refOf(q), answer: CODE, confirmationText: "כן", actor: ACTOR, attemptAuditId: "a" });
    check("a bridge without finance dependencies behaves as OFF (the pre-existing default)", bare.status, "FINANCE_ANSWERING_DISABLED");
  }

  console.log("\nH. flag ON → the EXISTING Finance answer core is reached");
  {
    const w = world();
    const q = await w.question();
    const r = await w.answer(w.refOf(q), CODE);
    check("core reached: live re-derivation, one append, owner_via_claude provenance, integrity deps untouched", [r.status, w.st.calls.live > 0, w.st.calls.append, w.st.prov[0]?.source, (w.st.prov[0] as { channel?: string } | undefined)?.channel, w.st.calls.integrity], ["LEARNED", true, 1, "owner_via_claude", "mcp", 0]);
    const direct = world();
    const dq = await direct.question();
    const viaCore = await answerFinanceQuestionCore({ ...({} as FinanceAnswerDeps), async loadLive() { const a = financeAnswersFromContexts([]); return { ok: true, integrity: deriveFinanceView(direct.st.raw, NOW, a).integrity, answers: a }; }, async appendOwnerContext() { throw new Error("not reached"); }, ledger: createRequestLedger(), audit: () => {} }, OWNER, { questionId: dq.identity!.questionId, answerCode: "NOT_A_CODE", seenQuestionFingerprint: dq.identity!.fingerprint, requestId: "0f0f0f0f-0000-4000-8000-000000000001", exactDateYmd: null });
    check("the dashboard core rejects a code the question does not offer (STALE_QUESTION / INVALID_INPUT, nothing appended)", ["INVALID_INPUT", "STALE_QUESTION"].includes(viaCore.status), true);
  }

  console.log("\nL. idempotent replay");
  {
    const w = world();
    const q = await w.question();
    const ref = w.refOf(q);
    const first = await w.answer(ref, CODE);
    const second = await w.answer(ref, CODE);
    check("same question + same answer again → ALREADY_ANSWERED, no second row", [first.status, second.status, w.db.rows.length, w.st.calls.append], ["LEARNED", "ALREADY_ANSWERED", 1, 1]);
    const other = await w.answer(ref, "UNKNOWN");
    check("a DIFFERENT answer to the answered question does not overwrite it", [other.status, w.db.rows.length], ["ALREADY_ANSWERED", 1]);
  }

  console.log("\nK/I. static guards");
  {
    const ROOT = path.resolve(__dirname, "..");
    const rd = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    const bridgeSrc = ["lib/partner/bridge/answer.ts", "lib/partner/bridge/finance-ref.ts", "lib/partner/bridge/server.ts"].map(rd).join("\n");
    ok("the bridge imports no transaction / income / finance writer, no push, no calendar", !/lib\/writes|\/transactions|insertTransaction|sendPush|calendar|\.from\(["']transactions/.test(bridgeSrc));
    ok("the bridge writes only through the existing Finance answer core (no own Owner Context store import)", !/context-store|context-persistence/.test(rd("lib/partner/bridge/answer.ts") + rd("lib/partner/bridge/finance-ref.ts")) && /answerFinanceQuestionCore/.test(rd("lib/partner/bridge/answer.ts")));
    ok("no hardcoded finance enablement in the config", !/answerFinanceEnabled:\s*(true|false)\b/.test(rd("lib/integrations/partner-mcp/config.ts")));
    ok("the dashboard route is unchanged: it never sets a provenance", !/provenance/.test(rd("app/api/partner/finance/answer/route.ts")));
  }

  console.log("\nT1 (2026-10-01). Finance answers need the Owner's confirmation words too");
  {
    const w = world();
    const q = await w.question();
    const ref = w.refOf(q);
    check("missing / \"לא\" / approval + change → refused, nothing written", [(await w.answer(ref, CODE, null)).status, (await w.answer(ref, CODE, "לא")).status, (await w.answer(ref, CODE, "כן אבל 200")).status, w.db.rows.length], ["APPROVAL_MISSING", "NOT_AN_APPROVAL", "APPROVAL_WITH_CHANGES", 0]);
    check("the Owner's \"מאשר\" → LEARNED", [(await w.answer(ref, CODE, "מאשר")).status, w.db.rows.length], ["LEARNED", 1]);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
