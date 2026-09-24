/**
 * Tests — Redbloods Partner Company Integrity OWNER LEARNING LOOP.
 *
 * Run with:   npx tsx scripts/test-partner-integrity-answer.tsx
 *
 * NEVER touches production. The live company is the production-shaped fixture (REAL computeCoo + Eyes), the register is
 * the REAL buildCompanyIntegrityRegister(), the answer path is the REAL answerIntegrityQuestionCore() writing through the
 * REAL Owner Context store (createOwnerContextStore) into an in-memory fake of partner_owner_context that mirrors the
 * verified production constraints. Plus: memory integration, UI static render, request guards, static no-write guards.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { renderToStaticMarkup } from "react-dom/server";
import { createOwnerContextStore } from "../lib/partner/investigation/context-persistence";
import type { PersistedOwnerContext } from "../lib/partner/investigation/context-row";
import { buildCompanyIntegrityRegister, labelProjectInterpretation } from "../lib/partner/integrity/register";
import { answerIntegrityQuestionCore, createIntegrityRequestLedger, registerAppliesContext, type IntegrityAnswerDeps, type IntegrityAnswerResult } from "../lib/partner/integrity/answer";
import { toIntegritySurfaceDto, parseIntegritySurfaceResponse } from "../lib/partner/integrity/dto";
import type { CompanyIntegrityRegister } from "../lib/partner/integrity/types";
import { buildPartnerMemory, type MemorySources } from "../lib/partner/memory/core";
import { toOwnerDecisions } from "../lib/partner/gateway/core";
import { checkSameOriginJson, readSmallJson } from "../lib/partner/actions/request-guard";
import { PartnerIntegrityView } from "../components/partner/PartnerIntegrityView";
import { buildIntegrityAnswerAttempt, interpretIntegrityAnswerResponse, learnedMessageHe } from "../components/partner/partner-integrity-answer-client";
import { FakeOwnerContextDb } from "./fixtures/owner-context-fake";
import { NOW, LA_AVI, LA_NAGASH, LA_SHALEV, P, state, input, find, type Opts } from "./fixtures/integrity-company";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}
const ok = (name: string, cond: boolean) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}`); fail++; } };

const RID = (n: number) => `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`;
const LABEL_Q = "INTEGRITY_LABEL_PROJECT_CLASSIFICATION";

/** One test world: the fake table, a mutable live company, and the real core wired like answer-service.ts. */
function world(initial: Opts = {}) {
  const db = new FakeOwnerContextDb();
  const live = { opts: { ...initial } as Opts, loads: 0 };
  const readActive = async (store = createOwnerContextStore(db.client(), { now: () => NOW })): Promise<PersistedOwnerContext[] | null> => {
    const r = await store.resolveCurrentOwnerContexts();
    return r.status === "OK" ? r.contexts : r.status === "NO_CONTEXT" ? [] : null;
  };
  // "a completely new request / process": a brand-new store instance over the same persisted rows
  const freshRegister = async (): Promise<CompanyIntegrityRegister> => buildCompanyIntegrityRegister(input({ ...live.opts, contexts: await readActive(createOwnerContextStore(db.client(), { now: () => NOW })) }));
  const store = createOwnerContextStore(db.client(), { now: () => NOW });
  const deps: IntegrityAnswerDeps = {
    async loadLive() {
      live.loads++;
      const contexts = await readActive(store);
      if (!contexts) return { ok: false, detail: "owner answers unreadable" };
      return { ok: true, register: buildCompanyIntegrityRegister(input({ ...live.opts, contexts })), activeContexts: contexts };
    },
    appendOwnerContext: (d) => store.appendOwnerContext(d),
    async verify(contextId, questionId) {
      const fresh = await freshRegister();
      return registerAppliesContext(fresh, contextId, questionId);
    },
    ledger: createIntegrityRequestLedger(),
    audit: () => {},
  };
  const answer = (body: Record<string, unknown>): Promise<IntegrityAnswerResult> => answerIntegrityQuestionCore(deps, "owner-user", body);
  const body = (r: CompanyIntegrityRegister, labelArtistId: string, answerCode: string, requestId: string, over: Record<string, unknown> = {}) => {
    const q = r.questions.find((x) => x.subject.id === labelArtistId)!;
    return { questionId: q.questionId, subjectId: q.subject.id, answerCode, seenQuestionFingerprint: q.fingerprint, requestId, ...over };
  };
  return { db, live, deps, answer, body, freshRegister };
}

void (async () => {
  // ──────────────────────────────────────────────────────────────────────────
  console.log("\n0. schema / taxonomy fit (no DDL)");
  {
    const w = world();
    const r0 = await w.freshRegister();
    const q = r0.questions.find((x) => x.subject.id === LA_AVI)!;
    ok("question id = case_id::question_type (production CHECK partner_owner_context_question_id_derived_chk)", q.questionId === `${q.caseId}::${q.questionType}`);
    ok("question / answer codes match the production format CHECKs", /^[A-Z][A-Z0-9_]*$/.test(q.questionType) && q.options.every((o) => /^[A-Z][A-Z0-9_]*$/.test(o.code)));
    check("Owner-facing option wording", q.options.map((o) => o.labelHe), ["הפרויקטים האלה הם עבודת לייבל", "אלה עבודות לקוח, למרות שהאמן חתום בלייבל", "יש גם עבודות לייבל וגם עבודות לקוח — צריך להבדיל בין הפרויקטים", "עוד לא החלטתי / צריך לבדוק"]);
    ok("question text is plain Hebrew and names the artist", q.textHe.includes("אבי מולה") && q.textHe.includes("ברשימת אמני הלייבל") && q.textHe.includes("איך להתייחס"));
  }

  console.log("\n1–2. live re-derivation before write; valid answer persists exactly once");
  {
    const w = world();
    const r0 = await w.freshRegister();
    const loadsBefore = w.live.loads;
    const res = await w.answer(w.body(r0, LA_AVI, "LABEL_SONGS", RID(1)));
    check("ANSWER_SAVED + learned (re-read on a fresh read)", [res.status, (res as { learned?: boolean }).learned], ["ANSWER_SAVED", true]);
    ok("the live register was re-derived before the write", w.live.loads === loadsBefore + 1);
    check("exactly one row written", w.db.rows.length, 1);
    const row = w.db.rows[0];
    check("row: question identity / type / subject / answer / scope / provenance / root", [row.question_type, row.subject_type, row.subject_id, row.answer_code, row.scope, JSON.stringify(row.provenance), row.supersedes_id, row.answer_value, row.trigger_context_id],
      [LABEL_Q, "label-artist", LA_AVI, "LABEL_SONGS", "CASE_INSTANCE", '{"source":"owner_manual"}', null, null, null]);
    const q = r0.questions.find((x) => x.subject.id === LA_AVI)!;
    ok("row keeps the exact fingerprint + wording the Owner saw, and a created timestamp", row.case_facts_fingerprint === q.fingerprint && row.question_text === q.textHe && typeof row.created_at === "string");
  }

  console.log("\n3–6. stale / subject / answer refusals (no write)");
  {
    const w = world();
    const r0 = await w.freshRegister();
    const wrongFp = await w.answer(w.body(r0, LA_AVI, "LABEL_SONGS", RID(2), { seenQuestionFingerprint: "0".repeat(64) }));
    check("3. wrong fingerprint → STALE_QUESTION", wrongFp.status, "STALE_QUESTION");
    w.live.opts = { extraAviProject: true };
    const changed = await w.answer(w.body(r0, LA_AVI, "LABEL_SONGS", RID(3)));
    check("4. evidence changed after render (new project) → STALE_QUESTION", changed.status, "STALE_QUESTION");
    w.live.opts = {};
    const wrongSubject = await w.answer(w.body(r0, LA_AVI, "LABEL_SONGS", RID(4), { subjectId: LA_SHALEV }));
    check("5. wrong subject → refused (INVALID_INPUT)", wrongSubject.status, "INVALID_INPUT");
    const otherType = await w.answer(w.body(r0, LA_AVI, "SAME_PERSON", RID(5)));
    const other = await w.answer(w.body(r0, LA_AVI, "OTHER", RID(6)));
    check("6. unsupported answer codes → refused", [otherType.status, other.status], ["INVALID_INPUT", "INVALID_INPUT"]);
    const extra = await w.answer({ ...w.body(r0, LA_AVI, "LABEL_SONGS", RID(7)), epistemic: "FACT" });
    const extra2 = await w.answer({ ...w.body(r0, LA_AVI, "LABEL_SONGS", RID(8)), supersedesId: RID(1) });
    check("client cannot supply epistemic / supersedes (strict keys)", [extra.status, extra2.status], ["INVALID_INPUT", "INVALID_INPUT"]);
    const finQ = await w.answer({ questionId: "finance:X:recurring:VICTOR_SALARY:2026-05::FINANCE_RECURRING_PAYMENT_STATUS", subjectId: "x", answerCode: "PAID", seenQuestionFingerprint: "a".repeat(64), requestId: RID(9) });
    check("a non-integrity question id → refused (no generic Owner Context write)", finQ.status, "INVALID_INPUT");
    const deferred = r0.findings.find((f) => f.type === "PROJECT_CLIENT_MATCH_INTEGRITY" && f.subject.type === "client-name")!;
    ok("a deferred (not surfaced) question cannot be answered", !r0.questions.some((q) => q.questionType === "INTEGRITY_CLIENT_IDENTITY") && deferred.questionId === null);
    check("nothing written by any refused attempt", w.db.rows.length, 0);
  }

  console.log("\n7–9. Owner-only, same-origin, JSON-only (route guards)");
  {
    const h = (o: Record<string, string>) => new Headers(o);
    ok("8. cross-site POST refused", checkSameOriginJson(h({ "content-type": "application/json", origin: "https://evil.example", host: "app.example" })) !== null);
    ok("8. Sec-Fetch-Site cross-site refused", checkSameOriginJson(h({ "content-type": "application/json", origin: "https://app.example", host: "app.example", "sec-fetch-site": "cross-site" })) !== null);
    ok("8. form content-type refused", checkSameOriginJson(h({ "content-type": "application/x-www-form-urlencoded", origin: "https://app.example", host: "app.example" })) !== null);
    ok("same-origin JSON accepted", checkSameOriginJson(h({ "content-type": "application/json", origin: "https://app.example", host: "app.example", "sec-fetch-site": "same-origin" })) === null);
    check("9. malformed JSON → null", await readSmallJson(new Request("https://app.example/x", { method: "POST", body: "{nope" })), null);
    check("9. oversize body → null", await readSmallJson(new Request("https://app.example/x", { method: "POST", body: JSON.stringify({ a: "x".repeat(5000) }) })), null);
    const root = path.resolve(__dirname, "..");
    const route = fs.readFileSync(path.join(root, "app/api/partner/integrity/answer/route.ts"), "utf8");
    const srv = fs.readFileSync(path.join(root, "lib/partner/integrity/server.ts"), "utf8");
    ok("route: same-origin guard + small JSON + strict key whitelist before the service", /checkSameOriginJson\(req\.headers\)/.test(route) && /readSmallJson\(req\)/.test(route) && /ALLOWED_KEYS = \["questionId", "subjectId", "answerCode", "seenQuestionFingerprint", "requestId"\]/.test(route));
    ok("7. service: requireOwner() before the core (answer AND surface); actor from the session", /async function ownerOrFailure[\s\S]*?requireOwner\(\)[\s\S]*?getAuthUser\(\)/.test(srv) && /answerIntegrityQuestion[\s\S]*?ownerOrFailure\(\)[\s\S]*?answerIntegrityQuestionCore\(deps, who\.userId, input\)/.test(srv) && /getIntegritySurface[\s\S]*?ownerOrFailure\(\)/.test(srv));
    const get = fs.readFileSync(path.join(root, "app/api/partner/integrity/route.ts"), "utf8");
    ok("GET surface route exports GET only (no write verb)", /export async function GET/.test(get) && !/export async function (POST|PUT|PATCH|DELETE)/.test(get));
  }

  console.log("\n10. duplicate / replay");
  {
    const w = world();
    const r0 = await w.freshRegister();
    const b = w.body(r0, LA_AVI, "CLIENT_WORK", RID(20));
    const [a1, a2] = await Promise.all([w.answer(b), w.answer(b)]);
    check("same requestId in flight → one ANSWER_SAVED + one REPLAY", [a1.status, a2.status].sort(), ["ANSWER_SAVED", "REPLAY"]);
    const a3 = await w.answer({ ...b, requestId: RID(21) });
    check("same answer, new requestId (e.g. a second tab) → REPLAY from the database", a3.status, "REPLAY");
    const a4 = await w.answer({ ...b, answerCode: "LABEL_SONGS" });
    check("same requestId, different answer → REQUEST_ID_CONFLICT", a4.status, "REQUEST_ID_CONFLICT");
    const a5 = await w.answer({ ...b, requestId: RID(22), answerCode: "LABEL_SONGS" });
    check("a different answer to an already-answered question (unchanged facts) → STALE, no overwrite", a5.status, "STALE_QUESTION");
    check("still exactly one row", w.db.rows.length, 1);
  }

  console.log("\n11–17. suppression, revision, fresh-process read, reopen");
  {
    const w = world();
    const r0 = await w.freshRegister();
    const first = await w.answer(w.body(r0, LA_AVI, "LABEL_SONGS", RID(30)));
    const firstId = (first as { contextId: string }).contextId;
    const snapshot = JSON.stringify(w.db.rows[0]);
    const r1 = await w.freshRegister();
    ok("13. the answer is read on a completely new request / store (restart-safe)", r1.answeredQuestions.some((a) => a.contextId === firstId));
    ok("14. the exact question is no longer asked", !r1.questions.some((q) => q.subject.id === LA_AVI));
    const f1 = find(r1, "LABEL_PROJECT_CLASSIFICATION_MISMATCH", `label-artist:${LA_AVI}`)[0];
    check("20. the decision is OWNER_DECISION (finding + decision), never FACT", [f1.stance, f1.epistemic, f1.ownerDecision?.epistemic, f1.ownerDecision?.basis], ["OWNER_DECIDED", "OWNER_DECISION", "OWNER_DECISION", "EXACT_FACTS"]);
    ok("5. Partner uses it to interpret the artist's projects", labelProjectInterpretation(r1, LA_AVI).basis === "OWNER_DECISION" && f1.interpretationHe.includes("עבודת לייבל"));
    ok("the canonical field is still reported as stored (לקוח)", JSON.stringify(f1.evidence).includes('"businessType":"לקוח"'));
    check("learned: APPLIES, with the wording the Owner answered as historical evidence", r1.learned.map((l) => [l.entityKey, l.status, l.decision.answerCode, l.askedHe === w.db.rows[0].question_text]), [[`label-artist:${LA_AVI}`, "APPLIES", "LABEL_SONGS", true]]);

    // the facts change: a new project of the artist
    w.live.opts = { extraAviProject: true };
    const r2 = await w.freshRegister();
    const q2 = r2.questions.find((q) => q.subject.id === LA_AVI);
    ok("16. changed fingerprint → the ambiguity is surfaced again (not blindly reused)", !!q2 && !r2.answeredQuestions.some((a) => a.contextId === firstId));
    check("17. the previous answer is shown", [q2?.previousAnswer?.contextId, q2?.previousAnswer?.answerCode], [firstId, "LABEL_SONGS"]);
    ok("17. DTO shows it in plain Hebrew", !!toIntegritySurfaceDto(r2).questions.find((q) => q.subjectId === LA_AVI)?.previousAnswerHe?.includes("הפרויקטים האלה הם עבודת לייבל"));
    check("learned: FACTS_CHANGED (history kept, not applied)", r2.learned.find((l) => l.entityKey === `label-artist:${LA_AVI}`)?.status, "FACTS_CHANGED");
    const rev = await w.answer(w.body(r2, LA_AVI, "CLIENT_WORK", RID(31)));
    check("11. the new answer is an append-only successor", [rev.status, (rev as { supersedesId?: string }).supersedesId], ["ANSWER_SAVED", firstId]);
    check("12. the previous row is preserved byte-for-byte", JSON.stringify(w.db.rows[0]), snapshot);
    check("two rows, chained", [w.db.rows.length, w.db.rows[1].supersedes_id], [2, firstId]);
    const r3 = await w.freshRegister();
    check("the successor is what Partner applies now", find(r3, "LABEL_PROJECT_CLASSIFICATION_MISMATCH", `label-artist:${LA_AVI}`)[0].ownerDecision?.answerCode, "CLIENT_WORK");
    const mem = buildPartnerMemory({ now: NOW, finance: { status: "UNAVAILABLE", detail: "not needed" }, actionEvents: { status: "UNAVAILABLE", detail: "not needed" }, outcomes: { status: "UNAVAILABLE", detail: "not needed" }, ownerContexts: { status: "OK", history: (await createOwnerContextStore(w.db.client(), { now: () => NOW }).listOwnerContexts() as { contexts: PersistedOwnerContext[] }).contexts } } as unknown as MemorySources);
    const ent = mem.entities.find((m) => m.entity.key === `label-artist:${LA_AVI}`);
    check("memory: the label-artist entity keeps both revisions (ACTIVE + SUPERSEDED)", ent?.ownerDecisions.map((d) => [d.answerCode, d.status]), [["LABEL_SONGS", "SUPERSEDED"], ["CLIENT_WORK", "ACTIVE"]]);
    check("memory: entity kind label_artist (never filed as a transaction)", [ent?.entity.kind, mem.entities.some((m) => m.entity.key.startsWith("transaction:"))], ["label_artist", false]);
    ok("20. memory → Gateway owner decisions are OWNER_DECISION", !!ent && toOwnerDecisions([ent]).every((d) => d.epistemic === "OWNER_DECISION"));
  }

  console.log("\n15. UNKNOWN suppresses the unchanged question (no nagging)");
  {
    const w = world();
    const r0 = await w.freshRegister();
    await w.answer(w.body(r0, LA_NAGASH, "UNKNOWN", RID(40)));
    const r1 = await w.freshRegister();
    ok("UNKNOWN → not asked again for the same facts", !r1.questions.some((q) => q.subject.id === LA_NAGASH));
    const f = find(r1, "LABEL_PROJECT_CLASSIFICATION_MISMATCH", `label-artist:${LA_NAGASH}`)[0];
    check("UNKNOWN keeps the ambiguity (CONFLICT, not OWNER_DECIDED) with the Owner's answer attached", [f.stance, f.ownerDecision?.answerCode, f.ownerInputRequired], ["CONFLICT", "UNKNOWN", false]);
    ok("interpretation stays unresolved", labelProjectInterpretation(r1, LA_NAGASH).basis === "UNRESOLVED");
  }

  console.log("\n18–19. max 2 visible; the deferred question moves up");
  {
    const w = world();
    const r0 = await w.freshRegister();
    check("18. max 2 visible (+1 deferred)", [r0.questions.length, r0.deferredQuestions], [2, 1]);
    ok("visible = אבי + נגש (active work); the same-name client question is deferred", r0.questions.map((q) => q.subject.label).join(",") === "אבי מולה,נגש ביטס");
    await w.answer(w.body(r0, LA_AVI, "LABEL_SONGS", RID(50)));
    const r1 = await w.freshRegister();
    check("19. after one answer the deferred question becomes visible", [r1.questions.length, r1.deferredQuestions, r1.questions.some((q) => q.questionType === "INTEGRITY_CLIENT_IDENTITY")], [2, 0, true]);
  }

  console.log("\nQuestion minimization");
  {
    const r = buildCompanyIntegrityRegister(input());
    const shalev = find(r, "LABEL_PROJECT_CLASSIFICATION_MISMATCH", `label-artist:${LA_SHALEV}`)[0];
    check("a mismatch with no active work is visible but NOT asked", [!!shalev, shalev.ownerInputRequired, r.questions.some((q) => q.subject.id === LA_SHALEV), shalev.interpretationHe.includes("לא אשאל על זה עכשיו")], [true, false, false, true]);
    const blind = buildCompanyIntegrityRegister(input({ contexts: null }));
    check("Owner Context unreadable → no questions (cannot tell what is already answered)", blind.questions.length, 0);
  }

  console.log("\nMIXED = a standing definition (no per-project questions)");
  {
    const w = world();
    const r0 = await w.freshRegister();
    await w.answer(w.body(r0, LA_AVI, "MIXED", RID(60)));
    w.live.opts = { extraAviProject: true };
    const r1 = await w.freshRegister();
    const f = find(r1, "LABEL_PROJECT_CLASSIFICATION_MISMATCH", `label-artist:${LA_AVI}`)[0];
    check("a new project does not re-open MIXED; basis DEFINITION", [r1.questions.some((q) => q.subject.id === LA_AVI), f.stance, f.ownerDecision?.basis], [false, "OWNER_DECIDED", "DEFINITION"]);
    ok("no per-project questions were generated", r1.questions.every((q) => q.subject.type !== "project") && r1.findings.every((x) => x.subject.type !== "project"));
    ok("wording: Partner does not classify projects itself", f.interpretationHe.includes("אני לא מסווג פרויקטים בעצמי"));
  }

  console.log("\nLive state overrides memory");
  {
    const w = world();
    const r0 = await w.freshRegister();
    await w.answer(w.body(r0, LA_AVI, "CLIENT_WORK", RID(70)));
    // canonical data becomes unambiguous: the artist's projects are now typed לייבל
    w.live.opts = { businessType: { [P(2)]: "לייבל", [P(3)]: "לייבל" } };
    const r1 = await w.freshRegister();
    check("no mismatch finding, no question for the artist", [find(r1, "LABEL_PROJECT_CLASSIFICATION_MISMATCH", `label-artist:${LA_AVI}`).length, r1.questions.some((q) => q.subject.id === LA_AVI)], [0, false]);
    check("the old decision is history (NO_LONGER_AMBIGUOUS), live facts win", r1.learned.find((l) => l.entityKey === `label-artist:${LA_AVI}`)?.status, "NO_LONGER_AMBIGUOUS");
    check("interpretation = LIVE_FACTS", labelProjectInterpretation(r1, LA_AVI).basis, "LIVE_FACTS");
    check("the Owner Context row is still there (history)", w.db.rows.length, 1);
  }

  console.log("\n21. no business mutation");
  {
    const w = world();
    const before = JSON.stringify(state().domains.projects.data!.index);
    const r0 = await w.freshRegister();
    await w.answer(w.body(r0, LA_AVI, "LABEL_SONGS", RID(80)));
    check("project rows unchanged (project_business_type still לקוח)", JSON.stringify(state().domains.projects.data!.index), before);
    ok("the only table touched is partner_owner_context (1 insert)", w.db.insertPayloads.length === 1 && w.db.log.every((l) => !/projects|clients|label_artists|transactions|sessions|project_release_details/.test(l)));
  }

  console.log("\nUI (static render) + client helpers");
  {
    const w = world();
    const r0 = await w.freshRegister();
    const dto = toIntegritySurfaceDto(r0);
    check("DTO parses strictly", parseIntegritySurfaceResponse(JSON.parse(JSON.stringify(dto))).ok, true);
    check("DTO with an extra key is rejected", parseIntegritySurfaceResponse({ ...dto, extra: 1 }).ok, false);
    check("DTO with 3 questions is rejected (max 2)", parseIntegritySurfaceResponse({ ...dto, questions: [...dto.questions, dto.questions[0]] }).ok, false);
    const html = renderToStaticMarkup(PartnerIntegrityView({ surface: dto, isMobile: true, message: null, controls: { busy: false, selected: {}, onSelect: () => {}, onSave: () => {} } })!);
    ok("renders 'צריך ממך', the artist, the question and the four choices", html.includes("צריך ממך") && html.includes("אבי מולה") && html.includes("איך להתייחס") && html.includes("עוד לא החלטתי / צריך לבדוק") && html.includes("שמור תשובה"));
    ok("evidence shows project names + statuses", html.includes("אבי 1 — בעבודה"));
    ok("never renders ids, hashes, table or schema names", !/[0-9a-f]{8}-[0-9a-f]{4}-|[0-9a-f]{64}|partner_owner_context|label_artists|project_business_type|INTEGRITY_|LABEL_SONGS|schema/i.test(html));
    ok("deferred count shown, not the deferred question", html.includes("יש עוד שאלה אחת") && !html.includes("לקוח  כפול"));
    const q = dto.questions[0];
    check("attempt echoes the rendered question exactly", buildIntegrityAnswerAttempt(q, "LABEL_SONGS", RID(90))?.body, { questionId: q.questionId, subjectId: q.subjectId, answerCode: "LABEL_SONGS", seenQuestionFingerprint: q.fingerprint, requestId: RID(90) });
    check("no attempt for an answer the question does not offer", buildIntegrityAnswerAttempt(q, "SAME_PERSON", RID(91)), null);
    check("'למדתי' only when saved AND re-read", [interpretIntegrityAnswerResponse(200, { status: "ANSWER_SAVED", learned: true }, "אבי מולה").messageHe, interpretIntegrityAnswerResponse(200, { status: "ANSWER_SAVED", learned: false }, "אבי מולה").ui, interpretIntegrityAnswerResponse(200, { status: "STALE_QUESTION" }, "x").ui, interpretIntegrityAnswerResponse(403, {}, "x").ui],
      [learnedMessageHe("אבי מולה"), "unverified", "stale", "error"]);
    check("confirmation wording", learnedMessageHe("שליו טסמה"), "למדתי. אשתמש בזה כשאני מנתח את הפרויקטים של שליו טסמה.");
    const saved = await w.answer(w.body(r0, LA_AVI, "LABEL_SONGS", RID(92)));
    const after = toIntegritySurfaceDto(await w.freshRegister());
    const html2 = renderToStaticMarkup(PartnerIntegrityView({ surface: after, isMobile: false, message: learnedMessageHe("אבי מולה"), controls: { busy: false, selected: {}, onSelect: () => {}, onSave: () => {} } })!);
    ok("after saving: the question is gone and 'מה למדתי' lists it", saved.status === "ANSWER_SAVED" && !after.questions.some((x) => x.subjectLabel === "אבי מולה") && html2.includes("מה למדתי ממך") && html2.includes("למדתי. אשתמש בזה"));
  }

  console.log("\n22–25. static guards");
  {
    const root = path.resolve(__dirname, "..");
    const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
    const diff = (p: string) => execFileSync("git", ["status", "--porcelain", "--", p], { cwd: root, encoding: "utf8" }).trim();
    check("22. Finance Brain untouched", diff("lib/partner/finance"), "");
    check("23. Agent Alerts untouched", diff("lib/agent"), "");
    check("24. MCP OAuth / consent / discovery untouched", [diff("lib/integrations/partner-mcp/oauth.ts"), diff("lib/integrations/partner-mcp/consent.ts"), diff("app/api/mcp-oauth"), diff("app/.well-known"), diff("app/mcp-oauth")], ["", "", "", "", ""]);
    const mcpSrc = fs.readdirSync(path.join(root, "lib/integrations/partner-mcp")).map((f) => read(`lib/integrations/partner-mcp/${f}`)).join("\n");
    const gwSrc = fs.readdirSync(path.join(root, "lib/partner/gateway")).map((f) => read(`lib/partner/gateway/${f}`)).join("\n");
    ok("24. no Owner answer path through MCP / the Gateway (read-only: no answer core, no Owner Context store)", !/integrity\/answer|integrity\/server|context-store|appendOwnerContext/.test(mcpSrc + gwSrc));
    check("no migration / SQL added", diff("supabase"), "");
    const files = ["lib/partner/integrity/answer.ts", "lib/partner/integrity/server.ts", "lib/partner/integrity/register.ts", "lib/partner/integrity/dto.ts", "app/api/partner/integrity/route.ts", "app/api/partner/integrity/answer/route.ts", "components/partner/PartnerIntegritySection.tsx", "components/partner/PartnerIntegrityView.tsx", "components/partner/partner-integrity-answer-client.ts"];
    const src = files.map(read).join("\n");
    ok("25. no direct table writes anywhere in the loop (insert / update / upsert / delete / rpc / from())", !/\.(insert|update|upsert|delete|rpc)\(/.test(src.replace(/createHash\("sha256"\)\.update\(|\bm\.delete\(|ledger\.delete\(|delete: \(id\)/g, "")) && !/\.from\(/.test(src.replace(/Array\.from\(/g, "")));
    const srv = read("lib/partner/integrity/server.ts");
    ok("25. the only write primitive is appendOwnerContext, used once, via the core", /^import \{ appendOwnerContext \} from "\.\.\/investigation\/context-store";$/m.test(srv) && (srv.match(/appendOwnerContext/g) ?? []).length === 2);
    const core = read("lib/partner/integrity/answer.ts").replace(/\/\*[\s\S]*?\*\//g, "");
    ok("25. the draft is built from the LIVE question only (client never supplies text / type / subject / supersedes)", /questionText: q\.textHe/.test(core) && /questionType: q\.questionType/.test(core) && /subjectId: q\.subject\.id/.test(core) && /caseFactsFingerprint: q\.fingerprint/.test(core) && /const supersedesId = q\.previousAnswer\?\.contextId \?\? null/.test(core) && /provenance: \{ source: "owner_manual" \}/.test(core));
    ok("no Google Calendar / push / cron / email in the loop", !/googleapis|calendar\.events|web-push|sendPush|sendEmail|cron/i.test(src));
    ok("session status fix NOT included (legacy readers unchanged)", diff("lib/reports") === "" && diff("lib/agent") === "");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
