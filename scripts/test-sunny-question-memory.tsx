/**
 * QUESTION MEMORY (Owner-approved Phase 2, 2026-10-05, Q1–Q4) — every question Sunny shows ends in ONE of
 * ASK / KNOWN / RECONCILE / REOPENED_BECAUSE_EVIDENCE_CHANGED; never re-asked after an answer without new canonical evidence.
 *
 *   Q0 (P0-A..G): no false claims — no answer path claimed before it exists; the real Red Films status; the show split
 *                 only for an agreement artist; leaving יצא keeps the first-release date; source missing ≠ fact missing;
 *                 a DJ recorded by name is a DJ; an interrupted create is OUTCOME_UNKNOWN.
 *
 * Run with:   npx tsx scripts/test-sunny-question-memory.tsx      Pure; never touches production.
 */
import fs from "node:fs";
import path from "node:path";
import { mayHaveRun, MAY_HAVE_RUN } from "../lib/partner/act/service";
import { answerAsOf, answerTopicOf, resolveQuestions } from "../lib/partner/sunny/known-context";
import { activeKnowledge, type OwnerKnowledgeRecord } from "../lib/partner/owner-knowledge/store";
import { CASE_ANSWER_OPTIONS, answerCaseQuestionCore, victorDeliveryQuestionRef, victorDeliverySeen, type CaseAnswerDeps } from "../lib/partner/investigation/case-answer";
import { decodeQuestionRef } from "../lib/partner/bridge/ref";
import { answerViaConnectorCore, type BridgeDeps } from "../lib/partner/bridge/answer";
import { createOwnerContextStore } from "../lib/partner/investigation/context-persistence";
import type { OwnerContextProvenance } from "../lib/partner/investigation/types";
import { CASE_SCHEMA_VERSION, type PartnerCase } from "../lib/partner/cases/types";
import { entityForSubject } from "../lib/partner/memory/core";
import { vendorWorkKnown, victorDeliveryQuestionId } from "../lib/partner/sunny/known-context";
import { FakeOwnerContextDb } from "./fixtures/owner-context-fake";
import { fullFlow, mkDeps, OWNER, U } from "./fixtures/act-harness";
import { approveAction, planAction } from "../lib/partner/act/service";
import { executionKey, planHash } from "../lib/partner/act/plan";
import { ACT_TABLES } from "../lib/partner/act/store-supabase";
import type { Plan } from "../lib/partner/act/types";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 700)}` : ""}`); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

(async () => {
  console.log("Q0. P0-A..G — no false claims");
  {
    const kc = read("lib/partner/sunny/known-context.ts");
    ok("P0-A. the case answer is not claimed as a dashboard / existing answer path", !/dashboard "צריך ממך": reviewed outside/.test(kc) && /written through the Claude[\s*]*case bridge/.test(kc) && !/NO writer records it yet/.test(kc));
    const rf = code(read("lib/partner/redfilms/view.ts"));
    ok("P0-B. the Red Films STATUS question names each production's REAL status — never a hard-coded 'רעיון'", !/והסטטוס 'רעיון'/.test(rf) && /סטטוס: '\$\{p\.status\}'/.test(rf));
    const op = read("lib/partner/sunny/operating.ts"), lv = read("lib/partner/label/view.ts"), sh = read("lib/partner/act/primitives/shows.ts");
    ok("P0-C. no global 50/50: operating's split item is gated on the agreement (שליו / אבי) and NOT_DEFINED otherwise", /agreementArtistOf\(\{ id: la\?\.id \?\? null, name \}\)/.test(op) && /NOT_DEFINED — no show agreement/.test(op) && !/value: "net = price − DJ fee − counted rehearsal costs; artist half, label half"/.test(op));
    ok("P0-C. the label view's split note follows the agreement (NOT_DEFINED for any other artist)", /agreementArtistOf\(\{ id: artistId, name \}\)/.test(lv) && /split is NOT_DEFINED/.test(lv));
    ok("P0-C. show action previews never claim 50/50 for every artist", !/חלוקת 50\/50 מחושבות מחדש/.test(sh) && !/לפי הכלל \(50\/50 אחרי DJ וחזרות\)/.test(sh) && /רק לשליו טסמה \/ אבי מולה/.test(sh));
    ok("P0-C. the money paths use the agreement rule only (showAgreementSplit) — text-only fix, no historical data affected", /showAgreementSplit/.test(read("lib/shows-finance-sync.ts")) && /showAgreementSplit/.test(read("lib/writes/shows.ts")));
    const w1 = read("lib/partner/act/primitives/wave1.ts"), rs = read("lib/release-store.ts");
    ok("P0-D. CHANGE_RELEASE_STAGE says what the store does: leaving יצא keeps the first-release date", /יציאה מ'יצא' לא מוחקת אותו/.test(w1) && !/יציאה מ'יצא' מוחקת אותו/.test(w1) && /NEVER cleared/.test(rs));
    ok("P0-E. RELEASE asks only when the release detail was READ (source missing ≠ fact missing)", /const relRead = !!c\.det\?\.releases;/.test(lv) && /r\.active && relRead && !r\.nextAction && !r\.blocker/.test(lv));
    const sv = code(read("lib/partner/shows/view.ts"));
    ok("P0-F. NO_DJ / the DJ question check BOTH representations (dj_client_id AND dj_name); a name-only DJ is its own fact", /!s\.djClientId && !s\.djName && s\.status !== "בוטל"\) \{ signals\.push\(\{ code: "NO_DJ"/.test(sv) && /DJ_NAME_ONLY/.test(sv));
    ok("P0-F. the label view and showWorkflow count a name-only DJ too", /s\.djName \? \{ client: null, name: s\.djName/.test(lv) && /!existing\.djClientId && !existingDjName/.test(op));
    ok("P0-G. an interrupted CREATE is written with the MAY_HAVE_RUN marker (OUTCOME_UNKNOWN, never 'not applied')", /stepTargetId\(s\) === "new"\) return out\("FAILED", `\$\{MAY_HAVE_RUN\}/.test(read("lib/partner/act/service.ts"))
      && mayHaveRun({ status: "FAILED", outcome: { detail: `${MAY_HAVE_RUN} the execution was interrupted; a created record cannot be verified` } }));
  }

  console.log("\nQ1. One identity per (question, entity); the four contract states; exact entity only");
  {
    const T = "2026-10-05";
    const SH = "show:00000000-0000-4000-8000-000000000101", SH2 = "show:00000000-0000-4000-8000-000000000102";
    const dec = (o: { id: string; about?: string; ref?: string; topic: string; decisionHe: string; createdAt?: string; reviewAt?: string | null; op?: "ASSERT" | "WITHDRAW"; slot?: string }) => ({ id: o.id, createdAt: o.createdAt ?? "2026-10-04T10:00:00Z", kind: "BUSINESS_DECISION", subjectKey: "company:REDBLOODS", identityKeys: ["company:REDBLOODS"], slotKey: o.slot ?? `${o.id}-s`, value: { area: "SHOWS", topic: o.topic, decisionHe: o.decisionHe, ...(o.about ? { about: o.about } : {}), ...(o.ref ? { ref: o.ref } : {}) }, epistemic: "OWNER_DECISION", meaningHe: o.decisionHe, operation: o.op ?? "ASSERT", supersedesId: null, reviewAt: o.reviewAt ?? null, expiresAt: null } as unknown as OwnerKnowledgeRecord);
    const q = (kind: string, entity: string, text = "מי ה-DJ בהופעה?") => ({ kind, entity, questionHe: text, why: "x" });
    const noDj = dec({ id: "d1", about: SH, topic: answerTopicOf("DJ"), decisionHe: "אין צורך ב-DJ בהופעה הזאת" });
    const r1 = resolveQuestions([q("DJ", SH), q("SHOW_DJ", SH, "מי ה-DJ בהופעה ב-12.10?")], [noDj], T);
    ok("1a. the same question from two subsystems (show_view DJ + label SHOW_DJ) is ONE identity — answered once, known once, never asked", r1.asked.length === 0 && r1.known.length === 1 && r1.known[0].contractState === "KNOWN" && answerTopicOf("SHOW_DJ") === answerTopicOf("DJ"), r1);
    const r2 = resolveQuestions([q("DJ", SH), q("DJ", SH2)], [noDj], T);
    ok("1b. the same text on two shows = two identities; the answer on show A never silences show B", r2.known.length === 1 && r2.asked.length === 1 && r2.asked[0].entity === SH2 && r2.asked[0].state === "ASK", r2);
    const companyLevel = dec({ id: "d2", topic: answerTopicOf("DJ"), decisionHe: "באופן כללי אין צורך ב-DJ" });
    ok("1c. a company-level decision (no about / ref) never suppresses an entity question", resolveQuestions([q("DJ", SH)], [companyLevel], T).asked.length === 1);
    const otherTopic = dec({ id: "d3", about: SH, topic: answerTopicOf("PRICE"), decisionHe: "המחיר עוד לא סוכם" });
    ok("1d. an answer to PRICE on the show never answers DJ on the same show (topic = the question)", resolveQuestions([q("DJ", SH)], [otherTopic], T).asked.length === 1 && resolveQuestions([q("PRICE", SH, "מה המחיר?")], [otherTopic], T).known.length === 1);
    const closeLater = dec({ id: "d4", about: SH, topic: answerTopicOf("CLOSE"), decisionHe: "ההופעה התקיימה, אסגור אחר כך" });
    const rc = resolveQuestions([q("CLOSE", SH, "ההופעה התקיימה?")], [closeLater], T);
    ok("1e. RECONCILE: 'התקיימה, אסגור אחר כך' → 'כבר אמרת לי … לסנכרן?' + CLOSE_SHOW (missing payment facts asked, never guessed)", rc.known[0]?.contractState === "RECONCILE" && rc.known[0].actions[0]?.actionId === "CLOSE_SHOW" && rc.known[0].actions[0].missing.includes("paymentStatus") && /לסנכרן\?/.test(rc.known[0].textHe), rc.known);
    const evQ = { ...q("PAYMENT", "mix-work:00000000-0000-4000-8000-000000000201", "שולמה מחוץ למערכת?") };
    const paidOut = dec({ id: "d5", ref: evQ.entity, topic: answerTopicOf("PAYMENT"), decisionHe: "שולם מחוץ למערכת", createdAt: "2026-10-01T10:00:00Z" });
    const reo = resolveQuestions([evQ], [paidOut], T, () => "2026-10-03");
    ok("1f. REOPENED_BECAUSE_EVIDENCE_CHANGED: a real canonical event after the answer → asked again WITH what he said", reo.asked[0]?.state === "REOPENED_BECAUSE_EVIDENCE_CHANGED" && /קודם אמרת לי/.test(reo.asked[0].questionHe) && /שולם מחוץ למערכת/.test(reo.asked[0].questionHe), reo.asked);
    ok("1g. no evidence (or older evidence) → KNOWN, not reopened (refresh / build / time never reopen)", resolveQuestions([evQ], [paidOut], T, () => "2026-09-30").known[0]?.contractState === "KNOWN" && resolveQuestions([evQ], [paidOut], T).known.length === 1);
    const due = dec({ id: "d6", about: SH, topic: answerTopicOf("PLACE"), decisionHe: "המקום עוד לא נקבע", reviewAt: "2026-10-01" });
    const rd = resolveQuestions([q("PLACE", SH, "איפה ההופעה?")], [due], T);
    ok("1h. reviewAt passed → 'זה עדיין נכון?' (never expiry, never the bare original question)", rd.known[0]?.state === "STILL_TRUE_CHECK" && /עדיין נכון\?/.test(rd.known[0].textHe), rd.known);
    const wd = [noDj, dec({ id: "d1w", about: SH, topic: answerTopicOf("DJ"), decisionHe: "x", op: "WITHDRAW", createdAt: "2026-10-05T08:00:00Z", slot: "d1-s" })];
    ok("1i. withdrawn knowledge stops counting (activeKnowledge) → the question is asked", resolveQuestions([q("DJ", SH)], activeKnowledge([{ ...noDj, slotKey: "d1-s" }, wd[1]], T), T).asked.length === 1);
    ok("1j. wording change alone never changes the identity (kind + entity), so an answer still holds", resolveQuestions([q("DJ", SH, "ניסוח אחר לגמרי?")], [noDj], T).known.length === 1);
    ok("1k. SESSION_STATE is canonical-only: no context home, knowledge never answers it (the status is the answer)", (() => { const r = resolveQuestions([{ kind: "SESSION_STATE", entity: "session:00000000-0000-4000-8000-000000000301", questionHe: "התקיים?", why: "x" }], [dec({ id: "d7", about: "session:00000000-0000-4000-8000-000000000301", topic: answerTopicOf("SESSION_STATE"), decisionHe: "התקיים" })], T); return r.asked.length === 1 && (r.asked[0].answerAs as { contextKind: unknown }).contextKind === null; })());
    ok("1l. answerAs pins the context answer EXACTLY (about for subjects / ref for proposal / work / transaction / production; none for a clip row)", (answerAsOf(q("DJ", SH)) as Record<string, unknown>).about === SH && (answerAsOf(q("PAYMENT", evQ.entity)) as Record<string, unknown>).ref === evQ.entity && (answerAsOf(q("FINANCE", "clip-row:00000000-0000-4000-8000-000000000401")) as { contextKind: unknown }).contextKind === null);
    ok("1m. canonical state beats context: a resolved canonical field means the question is never generated (resolver input only holds open questions)", /never generated at all/.test(read("lib/partner/sunny/known-context.ts")));
    const MW = "mix-work:00000000-0000-4000-8000-000000000501", LP = "project:00000000-0000-4000-8000-000000000502";
    const talked = dec({ id: "d8", ref: MW, topic: answerTopicOf("OUTSIDE_COMMUNICATION"), decisionHe: "נתתי לו פידבק בטלפון", createdAt: "2026-10-04T10:00:00Z" });
    const oc = q("OUTSIDE_COMMUNICATION", MW, "נתת פידבק מחוץ למערכת?");
    ok("1n. OUTSIDE_COMMUNICATION has a home: an exact-work context answer → KNOWN (no re-ask without a new version)", resolveQuestions([oc], [talked], T, () => "2026-10-01").known.length === 1 && resolveQuestions([oc], [talked], T, () => "2026-10-01").asked.length === 0);
    ok("1o. …a version uploaded after the answer → REOPENED on that work only", resolveQuestions([oc], [talked], T, () => "2026-10-05").asked[0]?.state === "REOPENED_BECAUSE_EVIDENCE_CHANGED" && resolveQuestions([q("OUTSIDE_COMMUNICATION", "mix-work:00000000-0000-4000-8000-000000000599")], [talked], T).asked.length === 1);
    ok("1p. PROJECT_STATE has a home: 'מחכה לאמן' on THAT project → KNOWN; another project still asked", resolveQuestions([q("PROJECT_STATE", LP)], [dec({ id: "d9", about: LP, topic: answerTopicOf("PROJECT_STATE"), decisionHe: "מחכה לאמן" })], T).known.length === 1 && resolveQuestions([q("PROJECT_STATE", "project:00000000-0000-4000-8000-000000000598")], [dec({ id: "d9", about: LP, topic: answerTopicOf("PROJECT_STATE"), decisionHe: "מחכה לאמן" })], T).asked.length === 1);
  }

  console.log("\nQ2. Per-entity questions in the views (split, served identity, company dedup)");
  {
    const rf = code(read("lib/partner/redfilms/view.ts")), mx = code(read("lib/partner/mix/view.ts")), vc = code(read("lib/partner/victor/view.ts")), cv = code(read("lib/partner/clients/view.ts")), cmp = code(read("lib/partner/company/view.ts"));
    ok("2a. Red Films STATUS / FINANCE: one question per production / planning row (no aggregate across entities)", /for \(const p of active\.filter\(\(x\) => x\.shoot\.datePassed && !x\.shoot\.statusSaysShot\)\) questions\.push\(\{ kind: "STATUS", entity: `rf-production:/.test(rf) && /entity: `clip-row:\$\{r\.id\}`/.test(rf));
    ok("2b. mix PAYMENT / FINANCE: one question per work / per orphan expense (3 unpaid works = 3 identities)", /for \(const w of unpaidDone\) questions\.push\(\{ kind: "PAYMENT", work: w\.key/.test(mx) && /for \(const t of orphanExpenses\) questions\.push\(\{ kind: "FINANCE", work: `transaction:/.test(mx));
    ok("2c. Victor salary PAYMENT: one question per month (recurring:VICTOR_SALARY:<month>)", /work: `recurring:VICTOR_SALARY:\$\{m\.month\}`/.test(vc));
    ok("2d. clients: FOLLOW_UP / CONVERSION per proposal, PAYMENT_EVIDENCE per project", /kind: "FOLLOW_UP", entity: p\.key/.test(cv) && /kind: "CONVERSION", entity: p\.key/.test(cv) && /kind: "PAYMENT_EVIDENCE", entity: p\.key/.test(cv));
    ok("2e. company_view dedups by the question identity (kind + entity), never by text", /const k = identity \?\? `\$\{d\.kind\}\|\$\{normQ\(d\.questionHe\)\}`/.test(cmp) && /a\.questions\.forEach\(\(q, i\) => addQ\(\{ id: qid\("label", q, i\)/.test(cmp));
    ok("2f. every view resolves its questions through the ONE resolver", ["lib/partner/shows/view.ts", "lib/partner/label/view.ts", "lib/partner/work/view.ts", "lib/partner/redfilms/view.ts", "lib/partner/mix/view.ts", "lib/partner/victor/view.ts", "lib/partner/clients/view.ts"].every((f) => /resolveQ(uestions)?\(/.test(read(f))));
    ok("2g. no view reopens on updatedAt: evidence days come from uploads, never from updatedAt", !/evidenceOf[^\n]*updatedAt/.test(mx + vc));
  }

  console.log("\nQ3. Victor delivery case bridge (Owner Q1) — exact work, write + fresh read-back, never a commitment");
  {
    const WA = "00000000-0000-4000-8000-000000000a01", WB = "00000000-0000-4000-8000-000000000b02";
    const vcase = (work: string, upload: string): PartnerCase => ({ id: `victor_delivery_no_followup:${work}`, caseType: "DELIVERY_WITHOUT_RECORDED_FOLLOWUP", subjectType: "victorWork", subjectId: work, classification: "ATTENTION", status: "OPEN", createdFrom: "STATE", schemaVersion: CASE_SCHEMA_VERSION,
      facts: [{ domain: "victor", entityId: work, field: "lastUploadAt", value: upload, label: "lastUploadAt" }, { domain: "victor", entityId: work, field: "ball.code", value: "OWNER", label: "ball.code" }, { domain: "victor", entityId: work, field: "projectId", value: null, label: "projectId" }],
      derivedFacts: [{ id: "days_since_delivery", label: "x", value: 10, basis: "x" }], hypotheses: [], ownerRulesApplied: [], workingPrinciplesApplied: [], unknowns: [], dataQuality: { notes: [] }, interventionStyle: "GENTLE", summaryHe: "x", changeContext: null } as unknown as PartnerCase);
    const NOWD = new Date("2026-10-05T09:00:00Z");
    const db = new FakeOwnerContextDb();
    const store = createOwnerContextStore(db.client(), { now: () => NOWD });
    const uploads: Record<string, string> = { [WA]: "2026-09-20T10:00:00.000Z", [WB]: "2026-09-21T10:00:00.000Z" };
    const prov: OwnerContextProvenance = { source: "owner_via_claude", channel: "mcp", client_id: "rbmcp_" + "c".repeat(40), token_id: "00000000-0000-4000-8000-00000000abcd", attempt_audit_id: "00000000-0000-4000-8000-00000000aaaa" };
    const deps = (): CaseAnswerDeps => ({
      async loadCase(caseId) { const w = caseId.split(":")[1]; const h = await store.getContextsForCase(caseId); return { status: "OK", caseRef: uploads[w] ? vcase(w, uploads[w]) : null, contexts: h.status === "OK" ? h.contexts : [] }; },
      appendOwnerContext: (d) => store.appendOwnerContext(d),
      async verify(id, qid) { const r = await store.resolveCurrentOwnerContexts(); return r.status === "OK" && r.contexts.some((c) => c.id === id && c.questionId === qid); },
      audit: () => {},
    });
    const core = (ref: Parameters<typeof answerCaseQuestionCore>[2], code: string) => answerCaseQuestionCore({ ...deps(), provenance: prov }, "u", ref, code);
    const refA = decodeQuestionRef(victorDeliveryQuestionRef(WA, uploads[WA]))!;
    ok("3a. the ref decodes as kind 'case' with the exact work + question id", refA?.kind === "case" && refA.subjectId === WA && refA.questionId === victorDeliveryQuestionId(WA));
    ok("3b. options = the question's own closed answers, never OTHER", CASE_ANSWER_OPTIONS.length === 4 && !CASE_ANSWER_OPTIONS.some((o) => o.code === "OTHER"));
    const r1 = await core(refA, "REVIEWED_OUTSIDE_SYSTEM");
    const row = (db.rows[0] ?? {}) as unknown as Record<string, unknown> & { provenance?: { source?: string } };
    ok("3c. write + fresh read-back → ANSWER_SAVED learned (one append-only row, provenance owner_via_claude)", r1.status === "ANSWER_SAVED" && r1.learned && db.rows.length === 1 && row.provenance?.source === "owner_via_claude", r1);
    ok("3d. exact identity: the row is on work A's case / subject only", row.case_id === `victor_delivery_no_followup:${WA}` && row.subject_type === "victorWork" && row.subject_id === WA && row.question_type === "WAS_DELIVERY_REVIEWED_OUTSIDE_SYSTEM", row);
    const r2 = await core(refA, "REVIEWED_OUTSIDE_SYSTEM");
    ok("3e. the same answer again on the same version → ALREADY_ANSWERED, nothing written", r2.status === "ALREADY_ANSWERED" && db.rows.length === 1, r2);
    ok("3f. a ref mixing work A's question with work B is refused (INVALID), nothing written", (await core({ ...refA, subjectId: WB }, "REVIEWED_OUTSIDE_SYSTEM")).status === "INVALID" && db.rows.length === 1);
    ok("3g. OTHER / a foreign code is refused", (await core(refA, "OTHER")).status === "INVALID");
    uploads[WA] = "2026-10-03T10:00:00.000Z";
    ok("3h. a NEW version since the question was shown → STALE_QUESTION, nothing written", (await core(refA, "NOT_REVIEWED_YET")).status === "STALE_QUESTION" && db.rows.length === 1);
    const refA2 = decodeQuestionRef(victorDeliveryQuestionRef(WA, uploads[WA]))!;
    const r3 = await core(refA2, "NOT_REVIEWED_YET");
    ok("3i. answering the new version is a REVISION of A's head (server-picked supersedes)", r3.status === "ANSWER_SAVED" && r1.status === "ANSWER_SAVED" && r3.supersedesId === r1.contextId && r3.learned, r3);
    ok("3j. work B has no answer (answering A never touched B)", !db.rows.some((x) => (x as unknown as Record<string, unknown>).subject_id === WB));
    const gone = decodeQuestionRef(victorDeliveryQuestionRef(WB, uploads[WB]))!;
    delete uploads[WB];
    ok("3k. a case that no longer exists (notes sent) → NOT_CURRENT", (await core(gone, "REVIEWED_OUTSIDE_SYSTEM")).status === "NOT_CURRENT");
    ok("3l. the seen mark normalizes the instant (same upload, different string form → same mark)", victorDeliverySeen(WA, "2026-10-03T10:00:00Z") === victorDeliverySeen(WA, "2026-10-03T10:00:00.000Z"));
    const actor = { userId: "0f0f0f0f-0000-4000-8000-00000000a0a0", clientId: "rbmcp_" + "c".repeat(40), tokenId: "00000000-0000-4000-8000-00000000abcd" };
    const bd = (isOwner: boolean, withCase = true): BridgeDeps => ({ isOwner: async () => isOwner, integrityDeps: () => { throw new Error("not used"); }, freshRegister: async () => null, ...(withCase ? { caseDeps: deps } : {}) });
    uploads[WB] = "2026-09-25T10:00:00.000Z";
    const refB = victorDeliveryQuestionRef(WB, uploads[WB]);
    ok("3m. bridge: no approval words → nothing written", (await answerViaConnectorCore(bd(true), { questionRef: refB, answer: "REVIEWED_OUTSIDE_SYSTEM", confirmationText: "", actor, attemptAuditId: "a" })).status === "APPROVAL_MISSING");
    ok("3n. bridge: not the Owner → NOT_AUTHORIZED", (await answerViaConnectorCore(bd(false), { questionRef: refB, answer: "REVIEWED_OUTSIDE_SYSTEM", confirmationText: "כן, נבדקה/טופלה מחוץ למערכת", actor, attemptAuditId: "a" })).status === "NOT_AUTHORIZED");
    ok("3o. bridge: case answering not bound → NOT_CURRENT (never a fallback)", (await answerViaConnectorCore(bd(true, false), { questionRef: refB, answer: "REVIEWED_OUTSIDE_SYSTEM", confirmationText: "כן", actor, attemptAuditId: "a" })).status === "NOT_CURRENT");
    const lb = await answerViaConnectorCore(bd(true), { questionRef: refB, answer: "REVIEWED_OUTSIDE_SYSTEM", confirmationText: "כן, נבדקה/טופלה מחוץ למערכת", actor, attemptAuditId: "00000000-0000-4000-8000-00000000aaab" });
    ok("3p. bridge LEARNED: this delivery only, not Victor's commitment, no record changed, a new version reopens", lb.status === "LEARNED" && /לא התחייבות של ויקטור/.test(lb.ownerMessageHe) && /שום רשומה לא השתנתה/.test(lb.ownerMessageHe) && /גרסה חדשה/.test(lb.ownerMessageHe), lb);
    ok("3q. memory maps a victorWork answer to victor-work:<id> (never a transaction)", entityForSubject("victorWork", WA).key === `victor-work:${WA}`);
    const ans = [{ questionId: victorDeliveryQuestionId(WA), contextId: "c1", questionType: "WAS_DELIVERY_REVIEWED_OUTSIDE_SYSTEM", answerCode: "REVIEWED_OUTSIDE_SYSTEM", answeredAt: "2026-10-04T10:00:00Z", status: "ACTIVE" }];
    const vk = (work: string, up: string) => vendorWorkKnown({ workKey: `victor-work:${work}`, label: "w", lastUploadAt: up, todayIL: "2026-10-05", records: [], answers: ans, vendorLabel: "ויקטור", vendorBall: "VICTOR" });
    const kA = vk(WA, "2026-10-03T10:00:00Z");
    ok("3r. the answer is KNOWN on work A and only A (the line still says no canonical action records it)", kA?.basis.kind === "OWNER_ANSWER" && vk(WB, "2026-10-03T10:00:00Z") === null && /אין פעולה קנונית/.test(kA?.canonicalHe ?? ""), kA);
    ok("3s. a version uploaded AFTER the answer reopens work A only", vk(WA, "2026-10-05T10:00:00Z") === null);
    const pk = "project:00000000-0000-4000-8000-000000000c01";
    const blk = { id: "k1", kind: "PROJECT_BLOCKER", subjectKey: pk, identityKeys: [pk], value: { reason: "WAITING_FOR_VENDOR" }, meaningHe: "מחכים לויקטור", createdAt: "2026-10-04T10:00:00Z", status: "ACTIVE" } as unknown as OwnerKnowledgeRecord;
    const vb = (single: string | null) => vendorWorkKnown({ workKey: `victor-work:${WB}`, label: "w", lastUploadAt: "2026-10-03T10:00:00Z", todayIL: "2026-10-05", records: [blk], answers: [], vendorLabel: "ויקטור", vendorBall: "VICTOR", singleWorkProjectKey: single });
    ok("3t. a project WAITING_FOR_VENDOR blocker counts only for a single-work project", vb(pk)?.questionKind === "OUTSIDE_COMMUNICATION" && vb(null) === null, [vb(pk), vb(null)]);
    const vc = code(read("lib/partner/victor/view.ts"));
    ok("3u. Victor send log: a linked entry belongs to ITS work only; unlinked entries only in a single-work project", /a\.linkedWorkId \? a\.linkedWorkId === w\.id : victorWorksInProject === 1/.test(vc));
    ok("3v. computeVictorBall / send-log rules untouched (the view still calls the app's own functions)", /computeVictorBall\(/.test(vc) && /sendEntryCurrent\(/.test(vc) && /isOpenSendState\(/.test(vc));
    ok("3w. the question carries its questionRef + options only through the case bridge helper", /victorDeliveryQuestionRef\(w\.id, w\.handoff\.lastUploadAt/.test(vc));
  }

  console.log("\nQ4. Create duplicate warnings (stage 7) — warning only, live lookup, 'could not check' ≠ 'no duplicate'");
  {
    const prev = (p: Record<string, unknown>) => JSON.stringify(p.preview ?? {});
    const taskW = (rows: () => Promise<Array<{ id: string; title: string; dueDate: string | null; relatedType: string | null; relatedId: string | null }>>) => mkDeps({ openTasksLike: rows, async createTask() { return { id: U(901), mirrored: false }; }, async readTask() { return null; } });
    const targs = { title: "  להתקשר  לטל ", dueDate: "2026-10-09", relatedType: "general", mirrorToGoogle: false };
    const t1 = await planAction({ intentHe: "משימה", actionId: "CREATE_TASK", args: targs }, OWNER, taskW(async () => [{ id: U(902), title: "להתקשר לטל", dueDate: "2026-10-09", relatedType: "general", relatedId: null }]).d);
    ok("4a. CREATE_TASK: an open task with the same normalized title on the same date → warning (never a block)", t1.status === "PREVIEW" && /כבר יש משימה פתוחה עם אותה כותרת באותו תאריך/.test(prev(t1)), t1);
    const t2 = await planAction({ intentHe: "משימה", actionId: "CREATE_TASK", args: targs }, OWNER, taskW(async () => { throw new Error("db down"); }).d);
    ok("4b. CREATE_TASK: the lookup failed → 'לא הצלחתי לבדוק' (never 'אין כפילות'), still a preview", t2.status === "PREVIEW" && /לא הצלחתי לבדוק אם כבר קיימת משימה/.test(prev(t2)) && !/אין כפילות/.test(prev(t2)), t2);
    const t3 = await planAction({ intentHe: "משימה", actionId: "CREATE_TASK", args: targs }, OWNER, taskW(async () => []).d);
    ok("4c. CREATE_TASK: nothing similar → no duplicate warning", t3.status === "PREVIEW" && !/כבר יש משימה|לא הצלחתי לבדוק/.test(prev(t3)), t3);
    const evW = (rows: () => Promise<Array<{ id: string; summary: string; start: string }>>) => mkDeps({ async calendarConnected() { return true; }, calendarEventsOnDay: rows });
    const eargs = { summary: "חזרה להופעה", start: "2026-10-08T18:00", end: "2026-10-08T20:00" };
    const e1 = await planAction({ intentHe: "אירוע", actionId: "CREATE_CALENDAR_EVENT", args: eargs }, OWNER, evW(async () => [{ id: "evA", summary: "חזרה  להופעה", start: "2026-10-08T18:00" }]).d);
    ok("4d. CREATE_CALENDAR_EVENT: same title + same start on the main calendar → warning", e1.status === "PREVIEW" && /כבר יש ביומן אירוע עם אותה כותרת באותה שעה/.test(prev(e1)), e1);
    const e2 = await planAction({ intentHe: "אירוע", actionId: "CREATE_CALENDAR_INVITE", args: { ...eargs, attendees: "a@b.co" } }, OWNER, evW(async () => { throw new Error("google down"); }).d);
    ok("4e. CREATE_CALENDAR_INVITE: the calendar read failed → 'לא הצלחתי לבדוק ביומן' (never 'none')", e2.status === "PREVIEW" && /לא הצלחתי לבדוק ביומן/.test(prev(e2)), e2);
    const e3 = await planAction({ intentHe: "אירוע", actionId: "CREATE_CALENDAR_EVENT", args: eargs }, OWNER, evW(async () => [{ id: "evB", summary: "אחר", start: "2026-10-08T18:00" }]).d);
    ok("4f. a different event at the same time is not a duplicate", e3.status === "PREVIEW" && !/כבר יש ביומן/.test(prev(e3)), e3);
    // CREATE_GOOGLE_TASK: the created id comes back; a second identical create warns with the date (prior execution, provenance only)
    const g = mkDeps({ async calendarConnected() { return true; }, async addGoogleTask() { return "gtAbc12345"; } });
    const gargs = { title: "לשלוח חוזה", due: "2026-10-10" };
    const r1 = await fullFlow(g.d, "CREATE_GOOGLE_TASK", gargs, "מאשר 2026-10-10");
    const steps = ((r1.e as { steps?: Array<{ createdKey?: string }> } | null)?.steps ?? []);
    ok("4g. CREATE_GOOGLE_TASK returns the created id (createdKey gtask:<id>)", r1.e?.status === "APPLIED_AS_EXPECTED" && steps.some((s) => s.createdKey === "gtask:gtAbc12345"), r1.e);
    const g2 = await planAction({ intentHe: "שוב", actionId: "CREATE_GOOGLE_TASK", args: { ...gargs, title: " לשלוח  חוזה" } }, OWNER, g.d);
    const pg = (g2.priorExecution as Array<{ outcome: string; warningHe: string }> | undefined) ?? [];
    ok("4h. the same create again (normalized title + same date) → 'כבר יצרתי … עם אותם פרטים' (warning only)", g2.status === "PREVIEW" && pg[0]?.outcome === "APPLIED_AS_EXPECTED" && /כבר יצרתי/.test(pg[0].warningHe), g2);
    const g3 = await planAction({ intentHe: "אחר", actionId: "CREATE_GOOGLE_TASK", args: { ...gargs, due: "2026-10-11" } }, OWNER, g.d);
    ok("4i. a different date is a different create → no prior-execution warning", g3.status === "PREVIEW" && !(g3.priorExecution as unknown[] | undefined)?.length, g3);
    // an interrupted earlier create → "ייתכן שכבר נוצר"
    const m3 = taskW(async () => []);
    const q1 = await planAction({ intentHe: "משימה", actionId: "CREATE_TASK", args: targs }, OWNER, m3.d);
    await approveAction({ planId: q1.planId, planHash: q1.planHash, confirmationText: "מאשר" }, OWNER, m3.d);
    const plan1 = m3.db.rows(ACT_TABLES.plans).find((x) => x.plan_id === q1.planId)!.plan as Plan;
    const old = new Date(m3.d.nowMs() - 3_600_000).toISOString();
    m3.db.rows(ACT_TABLES.executions).push({ execution_key: executionKey(planHash(plan1), plan1.steps[0]), plan_id: q1.planId, step_index: 0, action_id: "CREATE_TASK", action_version: plan1.steps[0].actionVersion, status: "FAILED", outcome: { index: 0, actionId: "CREATE_TASK", status: "FAILED", detail: `${MAY_HAVE_RUN} interrupted`, replayed: false, at: old }, recorded_at: old });
    const q2 = await planAction({ intentHe: "משימה", actionId: "CREATE_TASK", args: targs }, OWNER, m3.d);
    const pu = (q2.priorExecution as Array<{ outcome: string; warningHe: string }> | undefined) ?? [];
    ok("4j. an interrupted earlier create (MAY_HAVE_RUN) → 'ייתכן שכבר נוצר' — never 'created', never 'not created'", q2.status === "PREVIEW" && pu[0]?.outcome === "OUTCOME_UNKNOWN" && /ייתכן שכבר נוצר/.test(pu[0].warningHe), q2);
    const core = read("lib/partner/act/primitives/core.ts");
    ok("4k. this run's own created task / event never counts as an existing duplicate (withExcluded)", /k === "openTasksLike"/.test(core) && /k === "calendarEventsOnDay"/.test(core));
    ok("5a. P1: the CLOSE question of an unpaid collaboration never asks to record client / DJ money", /unpaidCollab \? "ההופעה התקיימה\?[^"]*אין כסף לתעד/.test(read("lib/partner/shows/view.ts")));
    ok("5b. P1: two clients with the exact same name → SAME_NAME_AMBIGUOUS (never a false 'new client'), no merge", /byName\.length > 1 \? "SAME_NAME_AMBIGUOUS"/.test(read("lib/partner/clients/view.ts")));
    ok("4l. the main-calendar reader never swallows an error (a failed read is not 'none')", !/catch/.test(read("lib/google-calendar.ts").split("export async function listMainCalendarEventsOnDay")[1] ?? "catch"));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
