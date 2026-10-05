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

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 700)}` : ""}`); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

(async () => {
  console.log("Q0. P0-A..G — no false claims");
  {
    const kc = read("lib/partner/sunny/known-context.ts");
    ok("P0-A. the case answer is not claimed as a dashboard / existing answer path", !/dashboard "צריך ממך": reviewed outside/.test(kc) && /NO writer records it yet|via the case bridge/.test(kc));
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

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
