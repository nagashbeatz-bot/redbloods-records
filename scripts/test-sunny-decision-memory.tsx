/**
 * Tests — Sunny decision memory + the claim contract (Owner-approved 2026-10-05, the "מה באלי" fix). CASES 1–12.
 *
 * Run with:   npx tsx scripts/test-sunny-decision-memory.tsx
 *
 * The case that exposed it: the Owner told Sunny a project's price was ₪2,000, the money was never collected and he
 * gives it up. Sunny stored ONLY a P2 BUSINESS_DECISION on company:REDBLOODS, said "I won't ask again", and two days
 * later partner_brief asked "the project is completed, has an expense, no income — what happened?".
 *
 * What is proven here (real engines on in-memory fixtures; NEVER touches production):
 *  - P2 knowledge changes no record and says so (canonicalEffect NONE, stillSurfaced, canonicalPath) — never a resolution;
 *  - the decision gate: an Owner answer / entity-linked knowledge turns a repeated question into a reconciliation
 *    (KNOWN_DECISION_RECONCILE) with the typed canonical action — never a fresh question, never silent, never money;
 *  - after the approved canonical actions (exception first, then the price) the issue disappears from every consumer;
 *  - the finance fingerprint v2 (facts only) keeps an answer through edits / renames / new options, and still reads v1;
 *  - the act layer words success by verifyKind (FRESH_READ / PARTIAL / RECEIPT) and never claims a failed / mismatched write.
 */
import fs from "node:fs";
import path from "node:path";
import { computeCoo } from "../lib/coo/pipeline";
import type { CooRawInput } from "../lib/coo/types";
import { assemblePartnerCompanyState } from "../lib/partner/eyes/company-state";
import type { PartnerEyesRaw } from "../lib/partner/eyes/types";
import { buildPartnerCases } from "../lib/partner/cases/engine";
import { deriveFinanceView } from "../lib/partner/finance/view";
import { buildFinanceBrief } from "../lib/partner/finance/brief";
import { answerableFinanceQuestions, type OwnerQuestion } from "../lib/partner/finance/integrity";
import { financeKnowledgeContextOf, type FinanceKnowledgeContext } from "../lib/partner/finance/decision-gate";
import { financeAnswerMatches, financeQuestionFingerprint, financeQuestionFingerprintV2, type FinanceOwnerAnswer } from "../lib/partner/finance/owner-answers";
import type { FinanceRaw } from "../lib/partner/finance/types";
import { buildPartnerMemory } from "../lib/partner/memory/core";
import { getPartnerEntityCore } from "../lib/partner/gateway/entity";
import { getPartnerBriefCore } from "../lib/partner/gateway/brief";
import type { GatewaySources, GatewayFinance } from "../lib/partner/gateway/core";
import type { OwnerKnowledgeDraft, OwnerKnowledgeRecord, OwnerKnowledgeStore } from "../lib/partner/owner-knowledge/store";
import { canonicalEffectOf, commitKnowledgeCore, createNonceGuard, previewKnowledgeCore, type KnowledgeProposeDeps } from "../lib/partner/owner-knowledge/propose";
import { PRIMITIVES_BY_ID } from "../lib/partner/act/primitives";
import { CUSTOM_FRESH_READ, PARTIAL_VERIFIED, RECEIPT_VERIFIED, verifyKindOf } from "../lib/partner/act/verify-kind";
import { planAction, approveAction, executeAction } from "../lib/partner/act/service";
import { SERVER_INSTRUCTIONS } from "../lib/integrations/partner-mcp/mcp";
import { KNOWLEDGE_TOOL_DEFINITION } from "../lib/integrations/partner-mcp/tools";
import { fullFlow, mkDeps, OWNER, YES } from "./fixtures/act-harness";
import { empty, project, tx } from "./fixtures/finance-mirror";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}${detail === undefined ? "" : `\n      ${JSON.stringify(detail).slice(0, 600)}`}`); fail++; } };
const section = (s: string) => console.log(`\n${s}`);
const ROOT = path.resolve(__dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");

const NOW = new Date("2026-10-05T09:00:00Z");
const U = (n: number) => `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`;
const P_MB = U(1), P_MB2 = U(2), P_OPEN = U(3);
const KEY_MB = `project:${P_MB}`, KEY_MB2 = `project:${P_MB2}`;
const INCOME_Q = "FINANCE_COMPLETED_PROJECT_INCOME_STATUS";
const CLAIM_WORDS = /עדכנתי|הזנתי|סגרתי|הוצאתי מהמעקב|לא אשאל|בדקתי מחדש/;

interface Fx { setting?: Record<string, unknown> | null; name?: string; updatedAt?: string }
/** "מה באלי": completed client project, ₪650 paid expense, no income, no finance setting (the production state) + a twin with a similar name. */
function financeRaw(o: Fx = {}): FinanceRaw {
  return empty({
    projects: [
      project({ id: P_MB, name: o.name ?? "מה באלי", status: "הושלם", businessType: "לקוח", artist: "יהב פלאח", updatedAt: o.updatedAt ?? "2026-09-28T00:16:02Z" }),
      project({ id: P_MB2, name: "מה באלי (רמיקס)", status: "הושלם", businessType: "לקוח", artist: "יהב פלאח", updatedAt: "2026-09-20T00:00:00Z" }),
      project({ id: P_OPEN, name: "פרויקט פתוח", status: "במיקס", businessType: "לקוח", artist: "לקוח ג", updatedAt: "2026-09-20T08:00:00Z" }),
    ],
    financeSettings: [...(o.setting ? [{ projectId: P_MB, value: o.setting }] : []), { projectId: P_OPEN, value: { agreedPrice: 4000, currency: "₪" } }],
    transactions: [
      tx({ projectId: P_MB, scope: "project", type: "expense", amount: 650, status: "שולם", date: "2026-07-05" }),
      tx({ projectId: P_MB2, scope: "project", type: "expense", amount: 300, status: "שולם", date: "2026-07-10" }),
      tx({ projectId: P_OPEN, scope: "project", type: "income", amount: 1000, status: "שולם", date: "2026-09-15" }),
    ],
  });
}
function cooRaw(o: Fx): CooRawInput {
  const st = (source: string) => ({ source, status: "ok" as const, rowCount: 1 });
  const proj = (id: string, name: string, status: string) => ({ id, name, artist: "יהב פלאח", status, deadline: null, projectType: "שיר", businessType: "לקוח", updatedAt: "2026-09-20T10:00:00Z", isHidden: false });
  const v = o.setting ?? null;
  return structuredClone<CooRawInput>({
    sources: ["projects", "tasks", "steven", "victor", "proposals", "shows", "sessions", "transactions", "finance_settings", "releases"].map(st),
    projects: [proj(P_MB, o.name ?? "מה באלי", "הושלם"), proj(P_MB2, "מה באלי (רמיקס)", "הושלם"), proj(P_OPEN, "פרויקט פתוח", "במיקס")],
    tasks: [], steven: [], victor: { stuckAfterDays: 5, works: [] }, proposals: [], shows: [], sessions: [], transactions: [],
    financeSettings: [...(v ? [{ projectId: P_MB, agreedPrice: Number(v.agreedPrice ?? 0), currency: "₪", financeException: !!v.financeException }] : []), { projectId: P_OPEN, agreedPrice: 4000, currency: "₪", financeException: false }],
    orphanFinanceKeyCount: 0, releases: { labelProjectsTotal: 0, rows: [] },
  });
}
function eyesRaw(): PartnerEyesRaw {
  return structuredClone<PartnerEyesRaw>({
    sources: ["clients", "label_artists", "clip_productions", "artist_balance_entries", "sessions_eyes", "shows_eyes", "proposals_eyes", "releases_eyes", "transactions_eyes", "tasks_eyes"].map((s) => ({ source: s, status: "ok" as const, rowCount: 1 })),
    clients: [], labelArtists: [], clips: [], artistBalanceEntries: [], sessions: [], shows: [], proposalsFull: [], releasesFull: [], transactions: [], tasksFull: [],
  });
}

/** A knowledge record exactly as the store returns it (only the fields the readers use matter). */
let kSeq = 100;
function knowledge(o: { kind?: string; subjectKey?: string; value?: Record<string, string | number>; meaningHe?: string; createdAt?: string; operation?: "ASSERT" | "WITHDRAW"; supersedesId?: string | null; slotKey?: string }): OwnerKnowledgeRecord {
  const kind = o.kind ?? "BUSINESS_DECISION", subjectKey = o.subjectKey ?? "company:REDBLOODS";
  const value = o.value ?? { area: "FINANCE", topic: "ma-bali-income-excluded", decisionHe: "המחיר היה 2,000, לא נגבה — לא לרדוף" };
  return {
    id: U(++kSeq), createdAt: o.createdAt ?? "2026-10-03T19:39:02.000Z", kind, subjectKey, identityKeys: [subjectKey], value, epistemic: "OWNER_DECISION",
    meaningHe: o.meaningHe ?? "החלטה (כספים): בפרויקט 'מה באלי' המחיר היה ₪2,000, לא נגבה — לא לרדוף.", operation: o.operation ?? "ASSERT", supersedesId: o.supersedesId ?? null,
    slotKey: o.slotKey ?? `${kind}|${subjectKey}|decision:FINANCE:${String(value.topic ?? "t")}${value.about ? `:${value.about}` : ""}`, reviewAt: null, expiresAt: null,
    provenance: { source: "owner_via_sunny", channel: "mcp", client_id: "rbmcp_" + "c".repeat(40), token_id: U(9), attempt_audit_id: U(8), operation: "LEARN_KNOWLEDGE" }, confirmationId: "conf_" + "x".repeat(20), itemIndex: 0,
  };
}

/** One brand-new "conversation": every source built from scratch by the real engines (answers + knowledge injected). */
function conversation(o: Fx = {}, answers: FinanceOwnerAnswer[] = [], kn: OwnerKnowledgeRecord[] = []): GatewaySources {
  const raw = financeRaw(o);
  const ctx: FinanceKnowledgeContext[] = financeKnowledgeContextOf(kn, "2026-10-05");
  const view = deriveFinanceView(raw, NOW, answers, ctx);
  const s = assemblePartnerCompanyState(computeCoo(cooRaw(o), NOW), eyesRaw());
  const finance: GatewayFinance = { state: view.state, integrity: view.integrity, actions: view.actions, raw, brief: buildFinanceBrief(view.state, view.integrity, { answersAvailable: true, actionNoteHe: view.actionNoteHe }), answersAvailable: true };
  const memory = buildPartnerMemory({ now: NOW, finance: { status: "OK", raw, view }, ownerContexts: { status: "OK", history: [] }, actionEvents: { status: "OK", events: [] }, outcomes: { status: "OK", outcomes: [] } });
  return {
    now: NOW, state: { status: "OK", value: s }, finance: { status: "OK", value: finance }, memory: { status: "OK", value: memory },
    cases: { status: "OK", value: buildPartnerCases({ state: s, today: s.todayIL }) }, actions: { status: "OK", value: [] }, outcomes: { status: "OK", value: [] },
    identities: { cleantone: null }, ownerKnowledge: { status: "OK", value: kn },
  };
}
const fin = (src: GatewaySources) => (src.finance!.status === "OK" ? src.finance!.value : null)!;
const asks = (src: GatewaySources, pid: string) => fin(src).integrity.questions.some((q) => q.subject.id === pid && q.questionType === INCOME_Q);
const briefAsks = (src: GatewaySources, key: string) => getPartnerBriefCore(src).items.some((i) => i.category === "OWNER_DECISION_NEEDED" && i.subject === key);
const briefReconciles = (src: GatewaySources, key: string) => getPartnerBriefCore(src).items.some((i) => i.category === "KNOWN_DECISION_RECONCILE" && i.subject === key);
const entity = (src: GatewaySources, key: string) => getPartnerEntityCore(key, src);
const reconcileOf = (src: GatewaySources, pid: string) => fin(src).integrity.top.reconcile.find((r) => r.subject.id === pid) ?? null;
const issueOf = (src: GatewaySources, pid: string) => fin(src).integrity.issues.find((i) => i.issueType === "COMPLETED_WORK_NO_INCOME" && i.subjectId === pid);

/** The live question for "מה באלי" → an Owner answer with the question's CURRENT (v2) fingerprint. */
function answerFor(src: GatewaySources, code: string, opts: { fingerprint?: string; answeredAt?: string } = {}): FinanceOwnerAnswer {
  const q = answerableFinanceQuestions(fin(src).integrity).find((x) => x.subject.id === P_MB && x.questionType === INCOME_Q) as OwnerQuestion;
  return { contextId: U(700), questionId: q.identity!.questionId, questionType: INCOME_Q, caseId: q.identity!.caseId, caseType: "COMPLETED_WORK_NO_INCOME", subjectType: "project", subjectId: P_MB, answerCode: code, answerValueYmd: null, factsFingerprint: opts.fingerprint ?? q.identity!.fingerprint, answeredAt: opts.answeredAt ?? "2026-10-03T19:40:00.000Z" };
}

// ── a propose-core harness (the real preview → commit, in-memory store) ──
const OWNER_ID = "0f0f0f0f-0000-4000-8000-00000000a0a0";
const ACTOR = { userId: OWNER_ID, clientId: "rbmcp_" + "c".repeat(40), tokenId: "00000000-0000-4000-8000-00000000abcd" };
function proposeWorld(src: GatewaySources) {
  const recs: OwnerKnowledgeRecord[] = [];
  let n = 0;
  const store: OwnerKnowledgeStore = {
    async list() { return { status: "OK", records: recs.map((r) => ({ ...r })) }; },
    async appendBatch(drafts: OwnerKnowledgeDraft[]) { const out = drafts.map((d) => ({ ...d, id: U(5000 + ++n), createdAt: NOW.toISOString() })) as OwnerKnowledgeRecord[]; recs.push(...out); return { status: "APPENDED", records: out }; },
  };
  const nonce = createNonceGuard();
  const st = src.state!.status === "OK" ? src.state!.value : null;
  const deps: KnowledgeProposeDeps = {
    secret: "s".repeat(48), nowMs: () => NOW.getTime(), isOwner: async (u) => u === OWNER_ID,
    async loadLive() { return { ok: true, live: { src, records: recs.map((r) => ({ ...r })), facts: { todayIL: "2026-10-05", projectStatus: (id) => st?.domains.projects.data?.index[id]?.status ?? null, financeMatch: () => null } } }; },
    store, async freshRecords() { return recs.map((r) => ({ ...r })); }, consumeNonce: (x, e) => nonce(x, e),
  };
  return { deps, recs };
}
type AnyRes = Record<string, unknown> & { status: string };
async function learn(deps: KnowledgeProposeDeps, items: unknown[]) {
  const pv = (await previewKnowledgeCore(deps, ACTOR, items)) as AnyRes & { confirmationToken?: string };
  if (pv.status !== "PREVIEW") return { pv, c: null as AnyRes | null };
  const c = (await commitKnowledgeCore(deps, ACTOR, items, pv.confirmationToken!, U(4000), "מאשר")) as AnyRes;
  return { pv, c };
}
const DECISION = (about?: string) => ({ kind: "BUSINESS_DECISION", subject: "Redbloods", fields: { area: "FINANCE", topic: "ma-bali-income-excluded", decisionHe: "בפרויקט מה באלי המחיר היה 2,000 ש״ח, הכסף לא נגבה — לא לרדוף אחרי הגבייה", ...(about ? { about } : {}) } });

// ── act harness for the finance settings primitives (SET_AGREED_PRICE / SET_FINANCE_EXCEPTION) ──
interface Fs { agreedPrice: number; currency: string; financialNotes: string; financeException: boolean; financeExceptionReason: string; financeExceptionDate: string }
function financeWriters(mode: "OK" | "THROWS" | "WRONG_VALUE" = "OK") {
  const fsw: Record<string, Fs> = { [P_MB]: { agreedPrice: 0, currency: "₪", financialNotes: "", financeException: false, financeExceptionReason: "", financeExceptionDate: "" } };
  const calls: string[] = [];
  const writers = {
    async readProjectMeta(id: string) { return id === P_MB ? { name: "מה באלי", artist: "יהב פלאח", status: "הושלם", isHidden: false, businessType: "לקוח", projectType: "שיר", hasRelease: false } : null; },
    async readFinanceSettings(id: string) { return { ...fsw[id] }; },
    async setFinanceSettings(id: string, p: Partial<Fs>) {
      calls.push(`set:${Object.keys(p).sort().join(",")}`);
      if (mode === "THROWS") throw new Error("simulated write failure");
      fsw[id] = { ...fsw[id], ...p, ...(mode === "WRONG_VALUE" && p.agreedPrice !== undefined ? { agreedPrice: Number(p.agreedPrice) - 1 } : {}) };
    },
  };
  return { fsw, calls, writers };
}

(async () => {
  section("CASE 1 — the exact \"מה באלי\" flow");
  {
    // a. today's production state: P2 on the company, not linked to the project → it never changes the question (and never claims it does)
    const legacy = knowledge({});
    const s0 = conversation({}, [], [legacy]);
    ok("1a. P2 on company:REDBLOODS (no entity link) leaves the records as they are — the income question is still a question", asks(s0, P_MB) && briefAsks(s0, KEY_MB));
    ok("1a. …it is never silently treated as resolved (no reconcile without a canonical link — a name in the text links nothing)", !reconcileOf(s0, P_MB));
    const fx = canonicalEffectOf(s0, [{ kind: legacy.kind, subjectKey: legacy.subjectKey, identityKeys: legacy.identityKeys, value: legacy.value, meaningHe: legacy.meaningHe }], "2026-10-05");
    ok("1a. canonicalEffect NONE + no linked records + the Owner-facing text says nothing changed", fx.canonicalEffect === "NONE" && fx.linkedEntities.length === 0 && fx.effectHe.includes("שום רשומה ב-Redbloods לא השתנתה"), fx);

    // b. the real preview → commit of the SAME decision, with `about` = the project key
    const w = proposeWorld(conversation());
    const { pv, c } = await learn(w.deps, [DECISION(KEY_MB)]);
    ok("1b. preview: canonicalEffect NONE, linked to the project, the question is listed as a RECONCILIATION, canonicalPath = SET_FINANCE_EXCEPTION", pv.status === "PREVIEW" && pv.canonicalEffect === "NONE" && JSON.stringify(pv.linkedEntities) === JSON.stringify([KEY_MB])
      && (pv.stillSurfaced as Array<{ willAppearAs: string; entityKey: string }>).some((x) => x.entityKey === KEY_MB && x.willAppearAs === "RECONCILIATION") && (pv.canonicalPath as Array<{ actionId: string }>)[0]?.actionId === "SET_FINANCE_EXCEPTION", pv);
    ok("1b. the read-back the Owner approves says the records do not change", String(pv.readBackHe).includes("שום רשומה ב-Redbloods לא השתנתה"));
    ok("1b. commit → LEARNED with canonicalEffect NONE; the message never claims a change / 'won't ask again'", c?.status === "LEARNED" && c.canonicalEffect === "NONE" && !CLAIM_WORDS.test(String(c.ownerMessageHe)) && String(c.ownerMessageHe).includes("לא השתנתה"), c);
    ok("1b. the stored decision stays on the company subject (no subjectTypes change) and carries about = the project key", w.recs[0]?.subjectKey === "company:REDBLOODS" && w.recs[0]?.value.about === KEY_MB && w.recs[0]?.slotKey.endsWith(`:${KEY_MB}`));

    // c. the next conversation reads that knowledge: a reconciliation, never the same question again
    const s1 = conversation({}, [], w.recs);
    const r1 = reconcileOf(s1, P_MB);
    ok("1c. the income question is NOT asked again (integrity / brief / entity)", !asks(s1, P_MB) && !briefAsks(s1, KEY_MB) && !entity(s1, KEY_MB).openQuestions.some((q) => q.questionType === INCOME_Q));
    ok("1c. it is shown as KNOWN_CONTEXT_RECONCILE: \"כבר אמרת לי …\" + SET_FINANCE_EXCEPTION (missing: reason) + an optional price", r1?.state === "KNOWN_CONTEXT_RECONCILE" && r1.knownHe.startsWith("כבר אמרת לי") && r1.actions[0]?.actionId === "SET_FINANCE_EXCEPTION" && r1.actions[0].missing.includes("reason") && r1.actions[1]?.actionId === "SET_AGREED_PRICE" && r1.actions[1].required === false, r1);
    ok("1c. partner_brief: KNOWN_DECISION_RECONCILE for the project (OWNER_DECISION epistemic)", briefReconciles(s1, KEY_MB) && getPartnerBriefCore(s1).items.find((i) => i.category === "KNOWN_DECISION_RECONCILE")?.epistemic === "OWNER_DECISION");
    ok("1c. partner_entity knownDecisions carries the typed actions; it is never money (no amount changed)", entity(s1, KEY_MB).knownDecisions.some((k) => k.state === "KNOWN_CONTEXT_RECONCILE" && k.actions.some((a) => a.actionId === "SET_FINANCE_EXCEPTION")));
    ok("1c. the answer stays possible (the open question behind the reconciliation is answerable — WRITTEN_OFF)", answerableFinanceQuestions(fin(s1).integrity).some((q) => q.subject.id === P_MB && q.options.some((o) => o.code === "WRITTEN_OFF")));
    const money = (x: GatewaySources) => JSON.stringify([fin(x).state.realized, fin(x).state.receivables.map((r) => [r.id, r.amount, r.currency, r.collection.state])]);
    check("1c. knowledge never changes money: realized / receivables identical with or without it", money(s1), money(s0));

    // d. the approved canonical plan: exception FIRST, then the price — one compound plan, verified by a fresh read
    const h = financeWriters();
    const { d } = mkDeps(h.writers);
    const p = await planAction({ intentHe: "סנכרון ההחלטה על מה באלי", steps: [{ actionId: "SET_FINANCE_EXCEPTION", args: { project: KEY_MB, on: true, reason: "מחיר מוסכם 2,000₪, הכסף לא נגבה — הבוס החליט לא לרדוף אחרי הגבייה", date: "2026-10-03" } }, { actionId: "SET_AGREED_PRICE", args: { project: KEY_MB, agreedPrice: 2000, currency: "₪" } }] }, OWNER, d) as AnyRes & { planId: string; planHash: string };
    ok("1d. ONE compound plan (exception + price on the same record) is planned", p.status === "PREVIEW", p);
    const a = await approveAction({ planId: p.planId, planHash: p.planHash, confirmationText: YES }, OWNER, d) as AnyRes & { approvalToken: string };
    const e = await executeAction({ planId: p.planId, approvalToken: a.approvalToken, confirmationText: YES }, OWNER, d) as AnyRes;
    ok("1d. executed in order: the exception write comes BEFORE the price write (never a price without the exception)", e.status === "APPLIED_AS_EXPECTED" && h.calls[0]?.includes("financeException") && h.calls[1]?.includes("agreedPrice"), { e: e.status, calls: h.calls });
    ok("1d. verified by a fresh read → canonicalEffect FRESH_READ + the full claim", e.canonicalEffect === "FRESH_READ" && String(e.messageHe).includes("בדקתי מחדש"), e);

    // e. the next brief: nothing to ask, nothing to reconcile, no debt — in every consumer
    const done = conversation({ setting: { agreedPrice: 2000, currency: "₪", financeException: true, financeExceptionReason: "מחיר מוסכם 2,000₪, הכסף לא נגבה", financeExceptionDate: "2026-10-03" } }, [], w.recs);
    ok("1e. after the canonical sync: no income question, no reconcile, no PRICE_MISSING, no receivable for the project", !asks(done, P_MB) && !reconcileOf(done, P_MB) && !fin(done).integrity.issues.some((i) => i.subjectId === P_MB) && !fin(done).state.receivables.some((r) => r.projectId === P_MB));
    ok("1e. the next partner_brief neither asks nor reconciles it; partner_entity shows the exception as the Owner's decision", !briefAsks(done, KEY_MB) && !briefReconciles(done, KEY_MB) && entity(done, KEY_MB).knownDecisions.length === 0 && entity(done, KEY_MB).facts.some((f) => f.code === "FINANCE_EXCEPTION"));
    const priceOnly = conversation({ setting: { agreedPrice: 2000, currency: "₪" } });
    ok("1e. WHY the order matters: a price WITHOUT the exception would be a ₪2,000 open debt", fin(priceOnly).state.receivables.some((r) => r.projectId === P_MB && r.amount === 2000));
  }

  section("CASE 2 — knowledge only (nothing canonical to change)");
  {
    const w = proposeWorld(conversation());
    const { c } = await learn(w.deps, [{ kind: "PROCESS_FRICTION", subject: "Redbloods", fields: { area: "OPERATIONS", frictionHe: "סטיבן שולח קבצים בדרך כלל בלילה" } }]);
    ok("2. LEARNED, canonicalEffect NONE, nothing linked / surfaced / to sync — and no claim that a record changed", c?.status === "LEARNED" && c.canonicalEffect === "NONE" && (c.linkedEntities as unknown[]).length === 0 && (c.stillSurfaced as unknown[]).length === 0 && (c.canonicalPath as unknown[]).length === 0 && !CLAIM_WORDS.test(String(c.ownerMessageHe)), c);
    ok("2. …and it is remembered (stored, active, readable)", w.recs.length === 1 && w.recs[0].kind === "PROCESS_FRICTION");
  }

  section("CASE 3–5 — a canonical write: success / failure / read-back disagrees");
  {
    const okW = financeWriters();
    const r3 = await fullFlow(mkDeps(okW.writers).d, "SET_AGREED_PRICE", { project: KEY_MB, agreedPrice: 2000, currency: "₪" });
    ok("3. set the agreed price → write + fresh read-back → FRESH_READ, \"בוצע… בדקתי מחדש\", freshState shows 2000", r3.e?.status === "APPLIED_AS_EXPECTED" && r3.e.canonicalEffect === "FRESH_READ" && String(r3.e.messageHe).includes("בדקתי מחדש") && JSON.stringify(r3.e.freshState).includes("\"value\":2000") && okW.fsw[P_MB].agreedPrice === 2000, r3.e);
    const bad = financeWriters("THROWS");
    const r4 = await fullFlow(mkDeps(bad.writers).d, "SET_AGREED_PRICE", { project: KEY_MB, agreedPrice: 2000, currency: "₪" });
    ok("4. the write fails → FAILED, canonicalEffect FAILED, never \"בוצע\"", r4.e?.status === "FAILED" && r4.e.canonicalEffect === "FAILED" && !String(r4.e.messageHe).startsWith("בוצע"), r4.e);
    const wrong = financeWriters("WRONG_VALUE");
    const r5 = await fullFlow(mkDeps(wrong.writers).d, "SET_AGREED_PRICE", { project: KEY_MB, agreedPrice: 2000, currency: "₪" });
    const st5 = (r5.e?.steps as Array<{ detail: string }> | undefined)?.[0];
    ok("5. the write \"succeeds\" but the fresh read disagrees (1999) → FAILED with the verification failure, never resolved", r5.e?.status === "FAILED" && r5.e.canonicalEffect === "FAILED" && !String(r5.e.messageHe).startsWith("בוצע") && /does not match/.test(st5?.detail ?? ""), r5.e);
    // RECEIPT: an email command has no fresh read of its effect → never "I checked again", never a constant presented as a record
    const sent: string[] = [];
    const rep = await fullFlow(mkDeps({ async reportEmailConfigured() { return true; }, async sendReportNow(k: string) { sent.push(k); return { subject: "דוח בוקר" }; } }).d, "SEND_REPORT_NOW", { report: "morning" }, "כן בוס, דוח בוקר");
    ok("5b. RECEIPT (email): applied → canonicalEffect RECEIPT, the message says it is the writer's receipt — never \"בדקתי מחדש\"", rep.e?.status === "APPLIED_AS_EXPECTED" && rep.e.canonicalEffect === "RECEIPT" && !String(rep.e.messageHe).includes("בדקתי מחדש") && String(rep.e.messageHe).includes("קבלה") && sent.join() === "morning", rep.e);
    ok("5b. …and freshState never shows the constant read view ({sent:false}) as a RECORD", JSON.stringify(rep.e?.freshState).includes("receiptOnly") && !JSON.stringify(rep.e?.freshState).includes("\"sent\""), rep.e?.freshState);
  }

  section("CASE 6 / 8 — an answered question is not asked again (fingerprint v2, facts only)");
  {
    const s0 = conversation();
    const a = answerFor(s0, "INCOME_NOT_RECEIVED");
    const s1 = conversation({}, [a]);
    ok("6. answered → brief / entity / owner questions do not ask it again", !asks(s1, P_MB) && !briefAsks(s1, KEY_MB) && !entity(s1, KEY_MB).openQuestions.some((q) => q.questionType === INCOME_Q));
    const s2 = conversation({ updatedAt: "2026-10-04T12:00:00Z" }, [a]);
    ok("6. an unrelated project edit (updated_at) does NOT re-open it (v1 would have)", !asks(s2, P_MB));
    const s3 = conversation({ name: "מה באלי (סופי)" }, [a]);
    ok("8. a rename (label + wording change) does NOT re-open it — the case id + facts are the identity", !asks(s3, P_MB));
    const base = { questionType: INCOME_Q as typeof INCOME_Q, issueType: "COMPLETED_WORK_NO_INCOME", subject: { type: "project", id: P_MB, labelHe: "מה באלי" }, textHe: "a", optionCodes: ["A", "B"], amount: 650, currency: "₪", date: "2026-09-28", evidence: [{ sourceType: "project" as const, sourceId: P_MB, reasonCode: "R" }] };
    check("8. v2 ignores wording / label / option codes / a non-fact date", financeQuestionFingerprintV2({ ...base, textHe: "b", optionCodes: ["A", "B", "C"], subject: { ...base.subject, labelHe: "x" }, date: "2026-10-01" }), financeQuestionFingerprintV2(base));
    ok("8. v2 still changes with the FACTS (amount)", financeQuestionFingerprintV2({ ...base, amount: 700 }) !== financeQuestionFingerprintV2(base));
    const q0 = answerableFinanceQuestions(fin(s0).integrity).find((x) => x.subject.id === P_MB)!;
    const v1 = financeQuestionFingerprint({ questionType: INCOME_Q, issueType: "COMPLETED_WORK_NO_INCOME", subject: q0.subject, textHe: q0.textHe, optionCodes: q0.options.map((o) => o.code), amount: 650, currency: "₪", date: "2026-09-28", evidence: q0.evidence });
    ok("6. backward compatibility: an answer stored with the LEGACY v1 fingerprint still applies", financeAnswerMatches(v1, q0.identity!) && !asks(conversation({}, [answerFor(s0, "INCOME_NOT_RECEIVED", { fingerprint: v1 })]), P_MB));
    ok("6. a forged fingerprint never applies", asks(conversation({}, [answerFor(s0, "INCOME_NOT_RECEIVED", { fingerprint: "f".repeat(64) })]), P_MB));
  }

  section("CASE 7 — an answer the records do not reflect → reconciliation, not a repeated question");
  {
    const s0 = conversation();
    for (const code of ["WRITTEN_OFF", "NON_PAID_PROJECT"]) {
      const s = conversation({}, [answerFor(s0, code)]);
      const r = reconcileOf(s, P_MB);
      ok(`7. ${code}: not asked again; KNOWN_DECISION_RECONCILE with SET_FINANCE_EXCEPTION (reason + the answer date filled)`, !asks(s, P_MB) && r?.state === "KNOWN_DECISION_RECONCILE" && r.actions[0]?.actionId === "SET_FINANCE_EXCEPTION" && r.actions[0].missing.length === 0 && r.actions[0].args.date === "2026-10-03" && briefReconciles(s, KEY_MB) && !briefAsks(s, KEY_MB), r);
    }
    const wo = reconcileOf(conversation({}, [answerFor(s0, "WRITTEN_OFF")]), P_MB)!;
    ok("7. WRITTEN_OFF keeps the truth: a price existed (optional SET_AGREED_PRICE after the exception), never \"not a paid project\"", wo.actions[1]?.actionId === "SET_AGREED_PRICE" && wo.actions[1].required === false && !!wo.orderHe && wo.knownHe.includes("ויתרתי"));
    ok("7. an answer needing nothing canonical (INCOME_NOT_RECEIVED) → no reconcile (KNOWN_MATCHES)", !reconcileOf(conversation({}, [answerFor(s0, "INCOME_NOT_RECEIVED")]), P_MB) && issueOf(conversation({}, [answerFor(s0, "INCOME_NOT_RECEIVED")]), P_MB)?.decision === "KNOWN_MATCHES");
    ok("7. once the exception is recorded the reconciliation is gone (the detector no longer raises the issue)", !reconcileOf(conversation({ setting: { financeException: true, financeExceptionReason: "x", financeExceptionDate: "2026-10-03" } }, [answerFor(s0, "WRITTEN_OFF")]), P_MB));
  }

  section("CASE 9 / 10 — entity identity: same / similar names, company vs project");
  {
    const s = conversation({}, [], [knowledge({ value: { area: "FINANCE", topic: "ma-bali-income-excluded", decisionHe: "לא לרדוף", about: KEY_MB } })]);
    ok("9. a decision about project A (about = A) reconciles A …", reconcileOf(s, P_MB)?.state === "KNOWN_CONTEXT_RECONCILE" && !asks(s, P_MB));
    ok("9. …and never touches project B with a similar name — B is still asked", asks(s, P_MB2) && !reconcileOf(s, P_MB2));
    const comp = conversation({}, [], [knowledge({ value: { area: "FINANCE", topic: "general-collection-policy", decisionHe: "לא רודפים אחרי חובות ישנים" } })]);
    ok("10. company-level knowledge (no about) never changes an entity's question", asks(comp, P_MB) && asks(comp, P_MB2) && !reconcileOf(comp, P_MB));
    const withdrawn = knowledge({ value: { area: "FINANCE", topic: "ma-bali-income-excluded", decisionHe: "לא לרדוף", about: KEY_MB } });
    const w2 = knowledge({ operation: "WITHDRAW", supersedesId: withdrawn.id, slotKey: withdrawn.slotKey, value: withdrawn.value, createdAt: "2026-10-04T10:00:00.000Z" });
    ok("10. a WITHDRAWN decision is history: the question is asked again (activeKnowledge, one rule)", asks(conversation({}, [], [withdrawn, w2]), P_MB));
    ok("10. a non-FINANCE decision about the project is not money context", asks(conversation({}, [], [knowledge({ value: { area: "RELEASES", topic: "x", decisionHe: "לשחרר באביב", about: KEY_MB } })]), P_MB));
    const paid = knowledge({ kind: "PAYMENT_REPORTED_BY_OWNER", subjectKey: KEY_MB, value: { direction: "PAID", amount: 650, currency: "₪" }, slotKey: `PAYMENT_REPORTED_BY_OWNER|${KEY_MB}|payment:PAID:650:₪:` });
    ok("10. a payment the Owner MADE (direction PAID) never reconciles the missing INCOME question", asks(conversation({}, [], [paid]), P_MB));
    const recv = knowledge({ kind: "PAYMENT_REPORTED_BY_OWNER", subjectKey: KEY_MB, value: { direction: "RECEIVED", amount: 2000, currency: "₪" }, slotKey: `PAYMENT_REPORTED_BY_OWNER|${KEY_MB}|payment:RECEIVED:2000:₪:` });
    const sr = conversation({}, [], [recv]);
    const ra = reconcileOf(sr, P_MB);
    // D4 (Owner-approved 2026-10-05): the reconcile now carries the ONE canonical path, built ONLY from the report + the shared matcher (no row in Finance → ADD_TRANSACTION prefilled; the missing date is asked, never invented)
    ok("10. a payment the Owner says he RECEIVED → the missing-income question is a reconciliation (\"not recorded in Finance\") whose action comes only from the report", !asks(sr, P_MB) && ra?.state === "KNOWN_CONTEXT_RECONCILE" && ra.canonicalHe.includes("לא רשום בכספים") && ra.actions.length === 1 && ra.actions[0].actionId === "ADD_TRANSACTION" && ra.actions[0].args.amount === 2000 && ra.actions[0].args.type === "income" && ra.actions[0].args.paymentStatus === "התקבל" && ra.actions[0].missing.join() === "date", ra);
  }

  section("CASE 11 — the finance exception is respected by every consumer");
  {
    const exc = conversation({ setting: { financeException: true, financeExceptionReason: "x", financeExceptionDate: "2026-10-03" } });
    ok("11. exception → no income issue / question / reconcile / receivable; brief + entity quiet", !issueOf(exc, P_MB) && !asks(exc, P_MB) && !reconcileOf(exc, P_MB) && !fin(exc).state.receivables.some((r) => r.projectId === P_MB) && !briefAsks(exc, KEY_MB) && !briefReconciles(exc, KEY_MB) && entity(exc, KEY_MB).knownDecisions.length === 0);
    ok("11. the same project without it IS raised (the guard is the exception, not the fixture)", asks(conversation(), P_MB));
  }

  section("CASE 12 — \"don't ask again\" with no canonical primitive: an honest contract, never a false promise");
  {
    const s = conversation();
    const fx = canonicalEffectOf(s, [{ kind: "BUSINESS_DECISION", subjectKey: "company:REDBLOODS", identityKeys: ["company:REDBLOODS"], value: { area: "TEAM", topic: "no-friday-sessions", decisionHe: "לא קובעים סשנים בשישי" }, meaningHe: "החלטה (צוות): לא קובעים סשנים בשישי" }], "2026-10-05");
    ok("12. no canonical path → canonicalEffect NONE, canonicalPath [], and the text says nothing changed (no promise)", fx.canonicalEffect === "NONE" && fx.canonicalPath.length === 0 && fx.effectHe.includes("לא השתנתה") && !CLAIM_WORDS.test(fx.effectHe), fx);
    ok("12. SERVER_INSTRUCTIONS carry the claim contract (verifyKind, knowledge = no record, never 'לא אשאל שוב', remember-but-records-keep-showing)",
      SERVER_INSTRUCTIONS.includes("CLAIM CONTRACT") && SERVER_INSTRUCTIONS.includes("canonicalEffect NONE") && SERVER_INSTRUCTIONS.includes("\"לא אשאל שוב\"") && SERVER_INSTRUCTIONS.includes("KNOWN_DECISION_RECONCILE") && SERVER_INSTRUCTIONS.includes("the records will keep showing it"));
    ok("12. the knowledge tool description: canonicalEffect NONE, stillSurfaced, canonicalPath, BUSINESS_DECISION.about", KNOWLEDGE_TOOL_DEFINITION.description.includes("canonicalEffect NONE") && KNOWLEDGE_TOOL_DEFINITION.description.includes("stillSurfaced") && KNOWLEDGE_TOOL_DEFINITION.description.includes("about?:"));
  }

  section("verifyKind — every primitive's verification is classified, the success wording follows it");
  {
    const src = fs.readdirSync(path.join(ROOT, "lib/partner/act/primitives")).filter((f) => f.endsWith(".ts") && f !== "core.ts" && f !== "index.ts").map((f) => read(`lib/partner/act/primitives/${f}`)).join("\n");
    const custom: string[] = [];
    const re = /actionId: "([A-Z_]+)"/g; let m: RegExpExecArray | null; const pos: Array<[string, number]> = [];
    while ((m = re.exec(src))) pos.push([m[1], m.index]);
    pos.forEach(([id, at], k) => { const blk = src.slice(at, k + 1 < pos.length ? pos[k + 1][1] : src.length); if (/\n\s*(async )?verify\s*[(:]/.test(blk)) custom.push(id); });
    const isDelete = (id: string) => /^(DELETE_|REMOVE_)/.test(id);
    const unclassified = custom.filter((id) => !RECEIPT_VERIFIED.has(id) && !PARTIAL_VERIFIED.has(id) && !CUSTOM_FRESH_READ.has(id) && !isDelete(id));
    check("every custom verify is classified (RECEIPT / PARTIAL / CUSTOM_FRESH_READ / delete-by-absence)", unclassified, []);
    const sets = [RECEIPT_VERIFIED, PARTIAL_VERIFIED, CUSTOM_FRESH_READ];
    ok("the three sets are disjoint and every id is a real primitive", sets.every((a, i) => sets.every((b, j) => i === j || [...a].every((x) => !b.has(x)))) && sets.every((x) => [...x].every((id) => PRIMITIVES_BY_ID.has(id))));
    ok("uploads are RECEIPT (the inbox is consumed; the file's arrival is the writer's receipt); DISCARD_INBOX_ITEM is FRESH_READ", verifyKindOf("UPLOAD_PROJECT_FILE", PRIMITIVES_BY_ID.get("UPLOAD_PROJECT_FILE")!.kinds) === "RECEIPT" && verifyKindOf("DISCARD_INBOX_ITEM", PRIMITIVES_BY_ID.get("DISCARD_INBOX_ITEM")!.kinds) === "FRESH_READ");
    ok("the previously \"verified by a fresh read\" commands are RECEIPT now (SEND_REPORT_NOW / SHARE_FILE_TO_PORTAL / IMPORT_DELIVERY_FROM_LINK / pushes)", ["SEND_REPORT_NOW", "SHARE_FILE_TO_PORTAL", "IMPORT_DELIVERY_FROM_LINK", "NOTIFY_MIX_READY", "SEND_VICTOR_VERSION_NOTES"].every((id) => verifyKindOf(id) === "RECEIPT"));
    ok("CLOSE_SHOW / CREATE_PROJECT are PARTIAL; SET_FINANCE_EXCEPTION / SET_AGREED_PRICE are FRESH_READ", verifyKindOf("CLOSE_SHOW") === "PARTIAL" && verifyKindOf("CREATE_PROJECT") === "PARTIAL" && verifyKindOf("SET_FINANCE_EXCEPTION") === "FRESH_READ" && verifyKindOf("SET_AGREED_PRICE") === "FRESH_READ");
    const svc = read("lib/partner/act/service.ts");
    ok("an interrupted RECEIPT step is OUTCOME_UNKNOWN (it may have happened) — never \"not applied\"", svc.includes("verifyKindOf(spec.actionId, spec.kinds) === \"RECEIPT\"") && svc.includes("it may have happened"));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
