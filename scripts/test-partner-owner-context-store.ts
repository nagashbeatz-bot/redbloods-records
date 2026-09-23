/**
 * Store tests for Redbloods Partner — Owner Context persistence (Phase F.1E).
 *
 * Run with:   npx tsx scripts/test-partner-owner-context-store.ts
 *
 * NEVER touches production: every test drives the real persistence core
 * (lib/partner/investigation/context-persistence.ts) against an in-memory
 * fake that mimics PostgREST + the verified public.partner_owner_context
 * table: id DEFAULT gen_random_uuid(), created_at DEFAULT now(), PK,
 * UNIQUE (id, question_id), composite FK (supersedes_id, question_id) →
 * (id, question_id), partial UNIQUE on supersedes_id, scope / question-id /
 * format CHECKs, jsonb provenance, "+00:00" timestamps, range paging.
 * context-store.ts is only inspected statically (server-only + service role).
 */
import fs from "node:fs";
import path from "node:path";
import { CASE_SCHEMA_VERSION, type PartnerCase } from "../lib/partner/cases/types";
import { fingerprintCaseFacts } from "../lib/partner/feedback";
import { decideInvestigation, buildAttentionQueue, interpretCase, deriveContextLearningSignals, buildFollowUpQuestions, triggersFollowUp, resolveAnswerValue, validateAnswerValue, classifyOwnerContexts, applicableContexts, type PartnerInvestigationQuestion } from "../lib/partner/investigation";
import {
  createOwnerContextStore, buildOwnerContextDraft, analyzeOwnerContextGraph, OwnerContextStoreError, CONTEXT_PAGE_SIZE,
  type ContextDbResponse, type ContextSelectQuery, type OwnerContextTableClient, type OwnerContextDraft,
} from "../lib/partner/investigation/context-persistence";
import { OWNER_CONTEXT_COLUMNS, OWNER_CONTEXT_SCHEMA_VERSION, mapOwnerContextRow, type OwnerContextInsertRow, type PersistedOwnerContext } from "../lib/partner/investigation/context-row";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}
const ok = (name: string, cond: boolean) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}`); fail++; } };
async function expectErr(name: string, fn: () => Promise<unknown>, code: string): Promise<OwnerContextStoreError | null> {
  try { await fn(); ok(`${name} (expected ${code}, got success)`, false); return null; }
  catch (e) {
    const typed = e instanceof OwnerContextStoreError;
    ok(`${name} → ${code}`, typed && (e as OwnerContextStoreError).code === code);
    if (!typed || (e as OwnerContextStoreError).code !== code) console.log(`      got: ${String(e)}`);
    return typed ? (e as OwnerContextStoreError) : null;
  }
}

// ── in-memory fake of public.partner_owner_context ──

type Row = Record<string, unknown>;
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const FMT = /^[A-Z][A-Z0-9_]*$/;

class FakeContextDb {
  rows: Row[] = [];
  log: string[] = [];
  tables = new Set<string>();
  insertPayloads: Row[] = [];
  opts: { failSelect?: boolean; throwOnSelect?: boolean; failInsert?: boolean; hideRowIdsOnRead?: Set<string> } = {};
  /** DB now(): starts at the real Context A's created_at (2026-09-23T09:10:08.684Z). */
  clockMs = Date.parse("2026-09-23T09:10:08.000Z");
  freezeClock = false;
  private idSeq = 0;
  forceNextIds: string[] = [];

  seedRaw(row: Row) { this.rows.push(JSON.parse(JSON.stringify(row))); }

  private insertRow(row: OwnerContextInsertRow): ContextDbResponse<unknown> {
    this.insertPayloads.push(JSON.parse(JSON.stringify(row)));
    if (this.opts.failInsert) return { data: null, error: { code: "08006", message: "connection failure Bearer sb_secret_XYZ" } };
    const r = row as unknown as Row;
    const id = "id" in r ? r.id : (this.forceNextIds.shift() ?? uid(++this.idSeq));
    if (!this.freezeClock && this.rows.length) this.clockMs += 1000;
    const created_at = "created_at" in r ? r.created_at : new Date(this.clockMs).toISOString().replace("Z", "456+00:00");
    if (this.rows.some((x) => x.id === id)) return { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "partner_owner_context_pkey"' } };
    if (row.scope !== "CASE_INSTANCE") return { data: null, error: { code: "23514", message: "violates check constraint partner_owner_context_scope_chk" } };
    if (row.question_id !== `${row.case_id}::${row.question_type}`) return { data: null, error: { code: "23514", message: "violates check constraint partner_owner_context_question_id_derived_chk" } };
    if (!FMT.test(row.question_type) || !FMT.test(row.answer_code)) return { data: null, error: { code: "23514", message: "violates format check" } };
    if (typeof row.provenance !== "object" || row.provenance === null || !("source" in (row.provenance as object))) return { data: null, error: { code: "23514", message: "violates provenance check" } };
    if (row.trigger_context_id !== null && row.trigger_context_id === id) return { data: null, error: { code: "23514", message: "violates check constraint partner_owner_context_trigger_not_self_chk" } };
    if (row.context_schema_version === "partner-owner-context-schema-v1" && (row.answer_value !== null || row.trigger_context_id !== null)) return { data: null, error: { code: "23514", message: "violates check constraint partner_owner_context_v1_shape_chk" } };
    const av = row.answer_value as Record<string, unknown> | null;
    if (av !== null && (typeof av !== "object" || av.kind !== "DATE" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(av.ymd)) || typeof av.resolution !== "object")) return { data: null, error: { code: "23514", message: "violates check constraint partner_owner_context_answer_value_chk" } };
    if (row.trigger_context_id !== null && !this.rows.some((x) => x.id === row.trigger_context_id)) return { data: null, error: { code: "23503", message: 'insert violates foreign key constraint "partner_owner_context_trigger_fk"' } };
    if (row.supersedes_id === null && this.rows.some((x) => x.supersedes_id === null && x.question_id === row.question_id && (x.trigger_context_id ?? "") === (row.trigger_context_id ?? ""))) {
      return { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "partner_owner_context_one_root_per_slot_idx"' } };
    }
    if (row.supersedes_id !== null && !this.rows.some((x) => x.id === row.supersedes_id && x.question_id === row.question_id)) {
      return { data: null, error: { code: "23503", message: 'insert violates foreign key constraint "partner_owner_context_supersedes_same_question_fk"' } };
    }
    if (row.supersedes_id !== null && this.rows.some((x) => x.supersedes_id === row.supersedes_id)) {
      return { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "partner_owner_context_supersedes_unique_idx"' } };
    }
    const stored = JSON.parse(JSON.stringify({ ...r, id, created_at })) as Row;
    this.rows.push(stored);
    return { data: JSON.parse(JSON.stringify(stored)), error: null };
  }

  client(): OwnerContextTableClient {
    const db = this;
    return {
      from(table) {
        db.tables.add(table); db.log.push(`from:${table}`);
        return {
          select(columns) {
            db.log.push("select");
            const filters: Array<[string, string]> = [], orders: Array<[string, boolean]> = [];
            let range: [number, number] | null = null;
            const run = (): ContextDbResponse<unknown[]> => {
              if (db.opts.failSelect) return { data: null, error: { code: "57014", message: "statement timeout" } };
              let out = db.rows.filter((r) => filters.every(([c, v]) => r[c] === v) && !db.opts.hideRowIdsOnRead?.has(String(r.id)));
              out = [...out].sort((a, b) => {
                for (const [c, asc] of orders) {
                  const av = c === "created_at" ? Date.parse(String(a[c])) : String(a[c]), bv = c === "created_at" ? Date.parse(String(b[c])) : String(b[c]);
                  if (av < bv) return asc ? -1 : 1;
                  if (av > bv) return asc ? 1 : -1;
                }
                return 0;
              });
              if (range) out = out.slice(range[0], range[1] + 1);
              const cols = columns.split(",");
              return { data: out.map((r) => JSON.parse(JSON.stringify(Object.fromEntries(cols.map((c) => [c, r[c]]))))), error: null };
            };
            const q: ContextSelectQuery = {
              eq(c, v) { db.log.push("eq"); filters.push([c, v]); return q; },
              order(c, o) { db.log.push("order"); orders.push([c, o.ascending]); return q; },
              range(a, b) { db.log.push("range"); range = [a, b]; return q; },
              maybeSingle() { db.log.push("maybeSingle"); const r = run(); return Promise.resolve(r.error ? { data: null, error: r.error } : { data: r.data && r.data.length ? r.data[0] : null, error: null }); },
              then(onF, onR) {
                if (db.opts.throwOnSelect) return Promise.reject(new Error("fetch failed: Authorization: Bearer sb_secret_zzz")).then(onF, onR);
                return Promise.resolve(run()).then(onF, onR);
              },
            };
            return q;
          },
          insert(row) {
            db.log.push("insert");
            return { select() { db.log.push("insert.select"); return { single() { db.log.push("single"); return Promise.resolve(db.insertRow(row)); } }; } };
          },
        };
      },
    };
  }
}

// ── fixtures (real production Case shapes) ──

function projectDeadlineCase(pid = "10d23186-a5ab-4eed-a9a4-eeda221a34d5", deadline = "2026-07-14"): PartnerCase {
  return {
    id: `project_deadline_passed:${pid}`, schemaVersion: CASE_SCHEMA_VERSION, caseType: "PROJECT_DEADLINE_PASSED", subjectType: "project", subjectId: pid,
    classification: "RISK", status: "OPEN", createdFrom: "STATE",
    facts: [{ domain: "projects", entityId: pid, field: "deadline", value: deadline, label: "deadline" }, { domain: "projects", entityId: pid, field: "status", value: "במיקס", label: "status" }],
    derivedFacts: [{ id: "days_late", label: "ימים באיחור", value: 71, basis: "x" }, { id: "days_since_update", label: "x", value: 1, basis: "x" }, { id: "activity_after_deadline", label: "x", value: true, basis: "x" }],
    hypotheses: [], ownerRulesApplied: [], workingPrinciplesApplied: [], unknowns: [], dataQuality: { notes: [] },
    interventionStyle: "GENTLE", summaryHe: "", changeContext: null,
  };
}
const questionFor = (c: PartnerCase): PartnerInvestigationQuestion => decideInvestigation(c).question!;
const C3 = projectDeadlineCase();
const Q3 = questionFor(C3);
const draft = (patch: Partial<OwnerContextDraft> = {}, q: PartnerInvestigationQuestion = Q3): OwnerContextDraft =>
  ({ ...buildOwnerContextDraft(q, CASE_SCHEMA_VERSION, { answerCode: "DEADLINE_NOT_UPDATED" }), ...patch });
const SERVER_NOW = new Date("2026-09-23T12:00:00.000Z"); // 15:00 in Israel → Israel date 2026-09-23
const fresh = () => { const db = new FakeContextDb(); return { db, store: createOwnerContextStore(db.client(), { now: () => SERVER_NOW }) }; };
const ids = (r: { status: string; contexts?: PersistedOwnerContext[] }) => (r.status === "OK" && r.contexts ? r.contexts.map((c) => c.id) : r.status);

async function main() {
  console.log("1/4/5/6. Valid context inserts; DB id + created_at returned; schema version stamped");
  {
    const { db, store } = fresh();
    db.forceNextIds = ["9f3c2a10-0000-4000-8000-00000000abcd"];
    const r = await store.appendOwnerContext(draft());
    check("one row", db.rows.length, 1);
    check("4. id from DB", r.id, "9f3c2a10-0000-4000-8000-00000000abcd");
    check("5. answeredAt = DB created_at (normalized ISO)", r.answeredAt, "2026-09-23T09:10:08.000Z");
    check("6. context_schema_version stamped", [db.rows[0].context_schema_version, r.schemaVersion], [OWNER_CONTEXT_SCHEMA_VERSION, OWNER_CONTEXT_SCHEMA_VERSION]);
    check("INSERT never carries id / created_at / schema from the caller", ["id", "created_at"].filter((k) => k in db.insertPayloads[0]), []);
    check("row columns (explicit mapping)", Object.keys(db.rows[0]).sort(), OWNER_CONTEXT_COLUMNS.split(",").sort());
    ok("domain record has no snake_case keys", Object.keys(r).every((k) => !k.includes("_")));
    check("identity round-trip", [r.questionId, r.questionType, r.caseId, r.caseType, r.subjectType, r.subjectId, r.answerCode, r.scope], [Q3.id, "WHY_DEADLINE_STILL_ACTIVE", C3.id, "PROJECT_DEADLINE_PASSED", "project", C3.subjectId, "DEADLINE_NOT_UPDATED", "CASE_INSTANCE"]);
    for (const k of ["id", "createdAt", "answeredAt", "schemaVersion", "contextSchemaVersion", "answerValue"]) {
      const f = fresh();
      await expectErr(`caller-supplied ${k} rejected`, () => f.store.appendOwnerContext({ ...draft(), [k]: "x" } as OwnerContextDraft), "VALIDATION_FAILED");
      ok(`   ${k}: zero DB calls`, f.db.log.length === 0);
    }
  }

  console.log("2/3. Question identity + answer semantics rejected before any DB call");
  {
    const cases: Array<[string, OwnerContextDraft, string]> = [
      ["questionId ≠ caseId::questionType", draft({ questionId: "project_deadline_passed:other::WHY_DEADLINE_STILL_ACTIVE" }), "INVALID_QUESTION_IDENTITY"],
      ["unknown questionType", draft({ questionType: "WHY_EVERYTHING" as never, questionId: `${C3.id}::WHY_EVERYTHING` }), "INVALID_QUESTION_IDENTITY"],
      ["answer of another question type (task answer on a deadline question)", draft({ answerCode: "ALREADY_DONE_NOT_MARKED" }), "INVALID_ANSWER_CODE"],
      ["made-up answer code", draft({ answerCode: "MADE_UP" }), "INVALID_ANSWER_CODE"],
      ["empty questionText", draft({ questionText: "" }), "VALIDATION_FAILED"],
      ["empty caseFactsFingerprint", draft({ caseFactsFingerprint: "" }), "VALIDATION_FAILED"],
      ["empty caseSchemaVersion", draft({ caseSchemaVersion: "" }), "VALIDATION_FAILED"],
      ["missing subjectId", draft({ subjectId: "" }), "VALIDATION_FAILED"],
      ["broadened scope", draft({ scope: "SUBJECT" as never }), "VALIDATION_FAILED"],
      ["unknown provenance", draft({ provenance: { source: "ai" } as never }), "VALIDATION_FAILED"],
      ["uppercase supersedesId (never lower-cased silently)", draft({ supersedesId: "ABCDEF00-0000-4000-8000-000000000001" }), "VALIDATION_FAILED"],
      ["extra key", { ...draft(), applyNow: true } as OwnerContextDraft, "VALIDATION_FAILED"],
    ];
    for (const [name, d, code] of cases) {
      const { db, store } = fresh();
      await expectErr(name, () => store.appendOwnerContext(d), code);
      ok(`   ${name}: zero DB calls`, db.log.length === 0);
    }
    const { store } = fresh();
    const other = await store.appendOwnerContext(draft({ answerCode: "OTHER", note: "x" }));
    check("OTHER is valid for every question type", other.answerCode, "OTHER");
  }

  console.log("7/8/9/10. questionText, fingerprint, provenance, note persisted verbatim");
  {
    const { db, store } = fresh();
    const note = "DEADLINE_NOT_UPDATED? בעצם CLIENT_DELAY — suppress, OWNER_RULE";
    const r = await store.appendOwnerContext(draft({ answerCode: "OTHER", note }));
    check("7. exact questionText persisted + returned (not regenerated)", [db.rows[0].question_text, r.questionTextHe], [Q3.questionTextHe, Q3.questionTextHe]);
    const tampered = { ...db.rows[0], question_text: "ניסוח היסטורי שונה" };
    check("7. read returns the STORED wording even if today's generator would word it differently", (mapOwnerContextRow(tampered) as { ok: true; value: PersistedOwnerContext }).value.questionTextHe, "ניסוח היסטורי שונה");
    check("8. caseFactsFingerprint persisted", [db.rows[0].case_facts_fingerprint, r.caseFactsFingerprint], [fingerprintCaseFacts(C3), fingerprintCaseFacts(C3)]);
    check("9. provenance preserved", [db.rows[0].provenance, r.provenance], [{ source: "owner_manual" }, { source: "owner_manual" }]);
    check("10. note verbatim", [db.rows[0].note, r.note], [note, note]);
    check("10. answer stays OTHER (codes inside the note are not picked up)", r.answerCode, "OTHER");
    const src = ["context-row.ts", "context-persistence.ts", "context-store.ts"].map((f) => fs.readFileSync(path.resolve(__dirname, "../lib/partner/investigation", f), "utf8")).join("\n");
    ok("10. no code inspects note content", !/\.note\s*\??\.\s*(match|includes|split|toLowerCase|indexOf|search|replace|startsWith)\b|\.test\(\s*[\w.]*note/.test(src));
  }

  console.log("11-15. Revisions: valid, different question, subject drift, Case drift, branch");
  {
    const { db, store } = fresh();
    const a = await store.appendOwnerContext(draft());
    const before = JSON.stringify(db.rows[0]);
    const b = await store.appendOwnerContext(draft({ answerCode: "CLIENT_DELAY", supersedesId: a.id }));
    check("11. revision stored, points at prior", [db.rows.length, b.supersedesId], [2, a.id]);
    ok("11. prior row byte-identical (never updated)", JSON.stringify(db.rows[0]) === before);
    ok("11. revision gets its own later DB timestamp", Date.parse(b.answeredAt) > Date.parse(a.answeredAt));

    const taskCase: PartnerCase = { ...projectDeadlineCase(), id: "task_due_date_passed:t1", caseType: "TASK_DUE_DATE_PASSED", subjectType: "task", subjectId: "t1", facts: [{ domain: "tasks", entityId: "t1", field: "dueYmd", value: "2026-08-26", label: "dueYmd" }], derivedFacts: [{ id: "days_overdue", label: "x", value: 28, basis: "x" }] };
    const e12 = await expectErr("12. revision of a DIFFERENT question", () => store.appendOwnerContext({ ...buildOwnerContextDraft(questionFor(taskCase), CASE_SCHEMA_VERSION, { answerCode: "NO_LONGER_RELEVANT" }), supersedesId: b.id }), "REVISION_TARGET_MISMATCH");
    ok("   diff names questionId", !!e12 && e12.details.some((d) => d.startsWith("questionId")));
    const e13 = await expectErr("13. revision whose subject drifts", () => store.appendOwnerContext(draft({ supersedesId: b.id, subjectId: "another-project" })), "REVISION_TARGET_MISMATCH");
    ok("   diff names subjectId", !!e13 && e13.details.some((d) => d.startsWith("subjectId")));
    const e14 = await expectErr("14. revision whose Case type drifts", () => store.appendOwnerContext(draft({ supersedesId: b.id, caseType: "RELEASE_TARGET_DATE_PASSED" })), "REVISION_TARGET_MISMATCH");
    ok("   diff names caseType", !!e14 && e14.details.some((d) => d.startsWith("caseType")));
    await expectErr("15. branch — second successor of the same row (pre-check)", () => store.appendOwnerContext(draft({ supersedesId: a.id })), "REVISION_BRANCH_CONFLICT");
    db.opts.hideRowIdsOnRead = new Set([b.id]); // the app's read misses the concurrent successor
    const race = await expectErr("15. race reaching the DB partial UNIQUE index", () => store.appendOwnerContext(draft({ supersedesId: a.id })), "REVISION_BRANCH_CONFLICT");
    ok("   DB detail kept", !!race && race.details.some((d) => d.includes("23505")));
    db.opts.hideRowIdsOnRead = undefined;
    await expectErr("supersedesId that does not exist", () => store.appendOwnerContext(draft({ supersedesId: uid(999) })), "SUPERSEDED_NOT_FOUND");
    check("only the 2 valid rows exist", db.rows.length, 2);
  }

  console.log("16/17/18. Fail-closed reads; read failure ≠ empty");
  {
    const { db, store } = fresh();
    await store.appendOwnerContext(draft());
    db.seedRaw({ ...db.rows[0], id: uid(50), context_schema_version: "partner-owner-context-schema-v3" });
    const r = await store.listOwnerContexts();
    check("16. unsupported schema → INVALID_STORED_ROWS / UNSUPPORTED_CONTEXT_SCHEMA", r.status === "INVALID_STORED_ROWS" ? r.rejected.map((x) => [x.id, x.code]) : r.status, [[uid(50), "UNSUPPORTED_CONTEXT_SCHEMA"]]);
    const bad = (patch: Row) => { const m = mapOwnerContextRow({ ...db.rows[0], ...patch }); return m.ok ? "ok" : m.code; };
    check("17. answer_code not valid for its question_type", bad({ answer_code: "ALREADY_DONE_NOT_MARKED" }), "INVALID_STORED_ROW");
    check("17. question_id not derived", bad({ question_id: "x::y" }), "INVALID_STORED_ROW");
    check("17. unknown provenance", bad({ provenance: { source: "llm" } }), "INVALID_STORED_ROW");
    check("17. broadened scope", bad({ scope: "SUBJECT" }), "INVALID_STORED_ROW");
    check("17. unknown question_type", bad({ question_type: "WHY_X", question_id: `${C3.id}::WHY_X` }), "INVALID_STORED_ROW");
    check("17. empty question_text", bad({ question_text: "" }), "INVALID_STORED_ROW");
    const empty = fresh();
    check("18. empty table → NO_CONTEXT", (await empty.store.listOwnerContexts()).status, "NO_CONTEXT");
    const failing = fresh(); failing.db.opts.failSelect = true;
    const rf = await failing.store.listOwnerContexts();
    check("18. DB error → READ_FAILED", rf.status, "READ_FAILED");
    ok("   READ_FAILED carries no contexts array", !("contexts" in rf));
    check("18. getCurrentContextForQuestion on DB error → READ_FAILED", (await failing.store.getCurrentContextForQuestion(Q3.id)).status, "READ_FAILED");
    const throwing = fresh(); throwing.db.opts.throwOnSelect = true;
    const rt = await throwing.store.listOwnerContexts();
    ok("18. network throw → READ_FAILED with secrets redacted", rt.status === "READ_FAILED" && !/sb_secret_zzz/.test(rt.error.message));
    const w = fresh(); w.db.opts.failInsert = true;
    const we = await expectErr("write failure thrown, never silent", () => w.store.appendOwnerContext(draft()), "WRITE_FAILED");
    ok("   write error redacted", !!we && ![we.message, ...we.details].join(" ").includes("sb_secret_XYZ"));
    await expectErr("empty questionId query → INVALID_QUERY (not an empty result)", () => fresh().store.getContextsForQuestion(""), "INVALID_QUERY");
  }

  console.log("19-24. Ordering, get by question/case/subject/case type, current resolution");
  {
    const { db, store } = fresh();
    const c2 = projectDeadlineCase("232cb772-af50-41f3-8a11-3ab6a0e50439");
    const q2 = questionFor(c2);
    db.freezeClock = true; db.forceNextIds = ["cccccccc-0000-4000-8000-000000000000", "aaaaaaaa-0000-4000-8000-000000000000"];
    const a = await store.appendOwnerContext(draft());
    const other = await store.appendOwnerContext(buildOwnerContextDraft(q2, CASE_SCHEMA_VERSION, { answerCode: "CLIENT_DELAY" }));
    db.freezeClock = false;
    const b = await store.appendOwnerContext(draft({ answerCode: "INTENTIONALLY_DELAYED", supersedesId: a.id }));
    check("19. created_at ASC, tie → id ASC", ids(await store.listOwnerContexts()), [other.id, a.id, b.id]);
    db.rows.reverse();
    check("19. independent of physical order", ids(await store.listOwnerContexts()), [other.id, a.id, b.id]);
    check("20. by question = full revision history", ids(await store.getContextsForQuestion(Q3.id)), [a.id, b.id]);
    check("21. by case", ids(await store.getContextsForCase(C3.id)), [a.id, b.id]);
    check("22. by subject (exact indexed columns)", ids(await store.getContextsForSubject("project", C3.subjectId)), [a.id, b.id]);
    check("22. no prefix / fuzzy match", (await store.getContextsForSubject("project", C3.subjectId.slice(0, 8))).status, "NO_CONTEXT");
    check("23. by case type", ids(await store.getContextsForCaseType("PROJECT_DEADLINE_PASSED")), [other.id, a.id, b.id]);
    check("24. current overall = terminal rows", ids(await store.resolveCurrentOwnerContexts()), [other.id, b.id]);
    const cur = await store.getCurrentContextForQuestion(Q3.id);
    check("24. current for question = latest revision; history kept", cur.status === "CURRENT" ? [cur.context.id, cur.context.answerCode, cur.historyCount] : cur.status, [b.id, "INTENTIONALLY_DELAYED", 3]);
    check("24. unanswered question → NO_CONTEXT", (await store.getCurrentContextForQuestion(`${C3.id}::WHY_RELEASE_TARGET_PASSED`)).status, "NO_CONTEXT");
    const src = fs.readFileSync(path.resolve(__dirname, "../lib/partner/investigation/context-persistence.ts"), "utf8");
    ok("22. subject query uses subject_type/subject_id columns, no JSON path", /\["subject_type", requireKey/.test(src) && !/->>|\.contains\(|\.textSearch\(|\.i?like\(/.test(src));

    const dbP = fresh();
    for (let i = 0; i < CONTEXT_PAGE_SIZE + 3; i++) dbP.db.seedRaw({ ...db.rows[0], id: `00000000-0000-4000-9000-${String(i).padStart(12, "0")}`, supersedes_id: null, case_id: `project_deadline_passed:p${i}`, subject_id: `p${i}`, question_id: `project_deadline_passed:p${i}::WHY_DEADLINE_STILL_ACTIVE` });
    const rp = await dbP.store.listOwnerContexts();
    check(`paging: ${CONTEXT_PAGE_SIZE + 3} rows (no silent truncation)`, rp.status === "OK" ? rp.contexts.length : rp.status, CONTEXT_PAGE_SIZE + 3);

    // Invalid graphs are diagnosed, never guessed around.
    db.seedRaw({ ...db.rows.find((r) => r.id === b.id)!, id: uid(77) }); // a branch that bypassed the DB index
    const g = await store.resolveCurrentOwnerContexts({ questionId: Q3.id });
    check("15/24. branch in stored history → INVALID_REVISION_GRAPH", g.status === "INVALID_REVISION_GRAPH" ? g.diagnostics.map((d) => d.kind) : g.status, ["BRANCH"]);
    check("history read itself still works", (await store.getContextsForQuestion(Q3.id)).status, "OK");
    const mk = (id: string, sup: string | null, q = "c:1::WHY_DEADLINE_STILL_ACTIVE"): PersistedOwnerContext => ({ id, schemaVersion: OWNER_CONTEXT_SCHEMA_VERSION, questionId: q, questionType: "WHY_DEADLINE_STILL_ACTIVE", caseId: q.split("::")[0], caseType: "PROJECT_DEADLINE_PASSED", subjectType: "project", subjectId: "1", answerCode: "OTHER", questionTextHe: "q", caseFactsFingerprint: "f", note: null, answeredAt: "2026-09-24T09:00:00.000Z", scope: "CASE_INSTANCE", provenance: { source: "owner_manual" }, caseSchemaVersion: CASE_SCHEMA_VERSION, supersedesId: sup, answerValue: null, triggerContextId: null });
    check("CYCLE detected", analyzeOwnerContextGraph([mk("a", "b"), mk("b", "a")]).map((d) => d.kind), ["CYCLE"]);
    check("SELF_SUPERSESSION detected", analyzeOwnerContextGraph([mk("a", "a")]).map((d) => d.kind), ["SELF_SUPERSESSION"]);
    check("DANGLING_SUPERSEDES detected", analyzeOwnerContextGraph([mk("a", "zzz")]).map((d) => d.kind), ["DANGLING_SUPERSEDES"]);
    check("TARGET_MISMATCH detected", analyzeOwnerContextGraph([mk("a", null), mk("b", "a", "c:2::WHY_DEADLINE_STILL_ACTIVE")]).map((d) => d.kind), ["TARGET_MISMATCH"]);
    check("clean chain → no diagnostics", analyzeOwnerContextGraph([mk("a", null), mk("b", "a"), mk("c", "b")]), []);
  }

  console.log("25/26. Persisted current contexts feed the pure queue + interpretation; changed facts detectable");
  {
    const { store } = fresh();
    await store.appendOwnerContext(draft());
    const cur = await store.resolveCurrentOwnerContexts();
    const contexts = cur.status === "OK" ? cur.contexts : [];
    const projects = { [C3.subjectId]: { status: "במיקס", active: true, businessType: "לקוח", daysSinceUpdate: 1 } };
    const q = buildAttentionQueue({ cases: [C3], projects, contexts });
    check("25. answered, facts unchanged → ANSWERED_UNCHANGED, not resurfaced", [q.recommended.length, q.answered[0]?.explanation], [0, ["ANSWERED_UNCHANGED"]]);
    const aged: PartnerCase = { ...C3, derivedFacts: C3.derivedFacts.map((d) => (d.id === "days_late" ? { ...d, value: 90 } : d)) };
    check("25. only clock-derived values changed → still answered", buildAttentionQueue({ cases: [aged], projects, contexts }).answered.length, 1);
    const moved = projectDeadlineCase(C3.subjectId, "2026-08-30");
    const q2 = buildAttentionQueue({ cases: [moved], projects, contexts });
    check("26. real fact changed (new deadline) → ANSWERED_EVIDENCE_CHANGED, resurfaces", q2.recommended[0]?.answerState, "ANSWERED_EVIDENCE_CHANGED");
    const i = interpretCase(C3, Q3, contexts);
    check("persisted context drives the deterministic interpretation", [i.investigationStatus, i.ownerContext?.answerCode], ["ANSWERED", "DEADLINE_NOT_UPDATED"]);
    check("…and context learning (counts only)", deriveContextLearningSignals(contexts).map((s) => s.id), ["PROJECT_DEADLINE_PASSED:WHY_DEADLINE_STILL_ACTIVE:DEADLINE_NOT_UPDATED"]);
    const queueSrc = fs.readFileSync(path.resolve(__dirname, "../lib/partner/investigation/queue.ts"), "utf8");
    ok("queue.ts stays decoupled from the store / Supabase", !/context-store|context-persistence|lib\/supabase/.test(queueSrc));
  }

  console.log("27-32. Append/read only; server-only; no route; no browser; no AI");
  {
    const dir = path.resolve(__dirname, "../lib/partner/investigation");
    const files = fs.readdirSync(dir);
    const src = Object.fromEntries(files.map((f) => [f, fs.readFileSync(path.join(dir, f), "utf8")]));
    for (const f of ["context-store.ts", "context-persistence.ts", "context-row.ts"]) {
      ok(`27. ${f}: no .update(`, !/\.update\s*\(/.test(src[f]));
      ok(`28. ${f}: no .delete(`, !/\.delete\s*\(/.test(src[f]));
      ok(`29. ${f}: no .upsert(`, !/\.upsert\s*\(/.test(src[f]));
      ok(`   ${f}: no .rpc( / raw SQL`, !/\.rpc\s*\(|\b(ALTER|DROP|TRUNCATE)\s+TABLE\b|\bCREATE\s+(TABLE|INDEX|POLICY)\b/i.test(src[f]));
    }
    const exported = [...src["context-store.ts"].matchAll(/export const (\w+)/g)].map((m) => m[1]).sort();
    check("store surface (exact)", exported, ["appendOwnerContext", "getContextsForCase", "getContextsForCaseType", "getContextsForQuestion", "getContextsForSubject", "getCurrentContextForQuestion", "listOwnerContexts", "resolveCurrentOwnerContexts"]);
    check("factory surface (exact)", Object.keys(fresh().store).sort(), exported);
    ok("no update/delete/replace/upsert/mutate export", !/export\s+(const|function|async function)\s+\w*(update|delete|upsert|replace|mutate)\w*/i.test(src["context-store.ts"]));
    ok("injected client type exposes only select + insert", /from\(table[^)]*\): \{\s*select\(columns: string\): ContextSelectQuery;\s*insert\(/.test(src["context-persistence.ts"]));
    ok("context-store.ts imports \"server-only\"", /^\s*import\s+"server-only"\s*;/m.test(src["context-store.ts"]));
    check("only context-store.ts imports a Supabase client", files.filter((f) => /lib\/supabase|@supabase\//.test(src[f])), ["context-store.ts"]);
    ok("index.ts does not re-export the server store", !/context-store/.test(src["index.ts"]));
    ok("31. no browser client / NEXT_PUBLIC / window / document", Object.values(src).every((s) => !/supabase-browser|NEXT_PUBLIC_|\bwindow\.|\bdocument\./.test(s)));
    ok("32. no AI / provider / Chrome dependency", Object.values(src).every((s) => !/from "openai"|@anthropic|anthropic\.|claude-in-chrome|puppeteer|playwright|lib\/mai/.test(s)));
    ok("no Agent Alerts / Push / Cron / baseline / Charter mutation", ["context-store.ts", "context-persistence.ts", "context-row.ts"].every((f) => !/agent_alerts|alerts-store|web-push|node-cron|partner\/baseline|from "\.\.\/charter"/.test(src[f])));
    const ROOT = path.resolve(__dirname, "..");
    const walk = (d: string): string[] => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.name === "node_modules" || e.name.startsWith(".") ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]) : [];
    const importers = [...walk(path.join(ROOT, "app")), ...walk(path.join(ROOT, "components")), ...walk(path.join(ROOT, "lib"))].filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes(`${path.sep}investigation${path.sep}`) && /investigation\/context-(store|persistence)/.test(fs.readFileSync(f, "utf8")));
    // F.1H: the ONE approved consumer is the server-only live Partner view (read-only context reads before an Owner decision).
    // F.1J adds exactly two more: the server-only Owner binding (appendOwnerContext for "שנה תאריך") and the pure
    // change-value core (draft builder + error type only, never the store binding).
    const APPROVED_READERS = [path.join("lib", "partner", "actions", "live.ts"), path.join("lib", "partner", "actions", "action-service.ts"), path.join("lib", "partner", "actions", "change-value.ts")];
    check("30. nothing in app/ components/ lib/ imports the store (no route, no UI) — except the approved Partner action files", importers.map((f) => path.relative(ROOT, f)).filter((f) => !APPROVED_READERS.includes(f)), []);
    const liveSrc = fs.readFileSync(path.join(ROOT, APPROVED_READERS[0]), "utf8");
    ok("30. the live view is server-only and only READS Owner Context (no append)", /^import "server-only";/m.test(liveSrc) && !/appendOwnerContext|\.insert\(|\.update\(|\.upsert\(/.test(liveSrc));
    const svcSrc = fs.readFileSync(path.join(ROOT, APPROVED_READERS[1]), "utf8");
    ok("30. the Owner binding is server-only and appends Owner Context ONLY inside changeSuggestedActionValue (requireOwner first)", /^import "server-only";/m.test(svcSrc) && (svcSrc.match(/appendOwnerContext/g) ?? []).length === 2 && /export async function changeSuggestedActionValue[\s\S]*?resolveOwnerActor\(\)[\s\S]*?appendOwnerContext/.test(svcSrc));
    const cvSrc = fs.readFileSync(path.join(ROOT, APPROVED_READERS[2]), "utf8");
    ok("30. the change-value core never binds a store (injected append only)", !/context-store|createOwnerContextStore|lib\/supabase|server-only/.test(cvSrc.replace(/\/\*[\s\S]*?\*\//g, "")));
    // F.1I/F.1J: /api/partner holds exactly the GET surface + the two Owner decision POST routes.
    const partnerApi = path.join(ROOT, "app", "api", "partner");
    const partnerRoutes = walk(partnerApi).map((f) => path.relative(partnerApi, f)).sort();
    check("30. /api/partner holds only the actions surface + the three Owner routes (decide / change-deadline / execute) + the F.1M outcomes GET + the F2 finance GET", partnerRoutes, [path.join("actions", "change-deadline", "route.ts"), path.join("actions", "decide", "route.ts"), path.join("actions", "execute", "route.ts"), path.join("actions", "route.ts"), path.join("finance", "route.ts"), path.join("outcomes", "route.ts")].sort());
    const financeRoute = fs.readFileSync(path.join(partnerApi, "finance", "route.ts"), "utf8");
    ok("30. F2 finance route is GET-only, requireOwner, imports only the read-only finance binding, never touches Owner Context", /export async function GET\(/.test(financeRoute) && !/export (async )?function (POST|PUT|PATCH|DELETE)/.test(financeRoute) && /requireOwner\(\)/.test(financeRoute) && !/context-store|context-persistence|appendOwnerContext/.test(financeRoute) && JSON.stringify([...financeRoute.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]).sort()) === JSON.stringify(["@/lib/partner/finance/server", "@/lib/require-auth", "next/server"]));
    const outcomesRoute = fs.readFileSync(path.join(partnerApi, "outcomes", "route.ts"), "utf8");
    ok("30. F.1M outcomes route is GET-only, requireOwner, imports only the read-only outcome binding, never touches Owner Context", /export async function GET\(/.test(outcomesRoute) && !/export (async )?function (POST|PUT|PATCH|DELETE)/.test(outcomesRoute) && /requireOwner\(\)/.test(outcomesRoute) && !/context-store|context-persistence|appendOwnerContext/.test(outcomesRoute) && JSON.stringify([...outcomesRoute.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]).sort()) === JSON.stringify(["@/lib/partner/actions/outcome-server", "@/lib/require-auth", "next/server"]));
    const surfaceRoute = fs.readFileSync(path.join(partnerApi, "actions", "route.ts"), "utf8");
    ok("30. the surface route is GET-only, requireOwner, and never touches Owner Context", /export async function GET\(/.test(surfaceRoute) && !/export (async )?function (POST|PUT|PATCH|DELETE)/.test(surfaceRoute) && /requireOwner\(\)/.test(surfaceRoute) && !/context-store|context-persistence|appendOwnerContext/.test(surfaceRoute));
    for (const r of ["decide", "change-deadline", "execute"]) {
      const s = fs.readFileSync(path.join(partnerApi, "actions", r, "route.ts"), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      ok(`30. ${r} route is POST-only, same-origin guarded, and never touches the Owner Context store directly`, /export async function POST\(/.test(s) && !/export (async )?function (GET|PUT|PATCH|DELETE)/.test(s) && /checkSameOriginJson\(/.test(s) && !/context-store|context-persistence|appendOwnerContext/.test(s));
    }

    const { db, store } = fresh();
    const a = await store.appendOwnerContext(draft());
    await store.appendOwnerContext(draft({ supersedesId: a.id, answerCode: "CLIENT_DELAY" }));
    await store.listOwnerContexts(); await store.getContextsForQuestion(Q3.id); await store.getContextsForCase(C3.id);
    await store.getContextsForSubject("project", "1"); await store.getContextsForCaseType("X"); await store.getCurrentContextForQuestion(Q3.id);
    check("every DB verb issued (appends validate against one full history read)", [...new Set(db.log.map((l) => l.split(":")[0]))].sort(), ["eq", "from", "insert", "insert.select", "order", "range", "select", "single"]);
    check("only table ever touched: partner_owner_context", [...db.tables], ["partner_owner_context"]);
  }

  // ════════════════════════════════════════════════════════════════════
  // F.1E v2 — structured answer values, follow-ups, trigger continuity
  // Canonical fixture = the real production Context A (fe35603a…).
  // ════════════════════════════════════════════════════════════════════
  const A_ID = "fe35603a-79e6-45eb-92df-2567933e220f";
  const OWNER_Q_TEXT = "הדדליין של הפרויקט עבר, אבל הפרויקט עדיין פעיל והייתה עליו פעילות לאחרונה. למה הדדליין הישן עדיין מוגדר?";
  const rowA: Row = {
    id: A_ID, created_at: "2026-09-23T09:10:08.684+00:00", context_schema_version: "partner-owner-context-schema-v1",
    question_id: Q3.id, question_type: "WHY_DEADLINE_STILL_ACTIVE", question_text: OWNER_Q_TEXT,
    case_id: C3.id, case_type: "PROJECT_DEADLINE_PASSED", case_schema_version: CASE_SCHEMA_VERSION, case_facts_fingerprint: "cc7d8bca34c49059",
    subject_type: "project", subject_id: C3.subjectId, answer_code: "DEADLINE_NOT_UPDATED",
    note: "לא הספקתי לעדכן את הדדליין בזמן, והפרויקט המשיך להתקדם בלי שעידכנתי תאריך חדש.", scope: "CASE_INSTANCE",
    provenance: { source: "owner_manual" }, supersedes_id: null, answer_value: null, trigger_context_id: null,
  };
  const withA = () => { const f = fresh(); f.db.seedRaw(rowA); return f; };
  type Store = ReturnType<typeof fresh>["store"];
  const currentOf = async (store: Store) => { const r = await store.resolveCurrentOwnerContexts(); return r.status === "OK" ? r.contexts : []; };
  const followUpFor = async (store: Store) => buildFollowUpQuestions(C3, await currentOf(store))[0];

  console.log("v2-A. Fixture sanity + v1 compatibility");
  {
    check("C3 fixture facts fingerprint = the real production fingerprint", fingerprintCaseFacts(C3), "cc7d8bca34c49059");
    const m = mapOwnerContextRow(rowA);
    check("1. the real v1 row stays valid; value + trigger read as null", m.ok ? [m.value.schemaVersion, m.value.answerValue, m.value.triggerContextId, m.value.answerCode] : m, ["partner-owner-context-schema-v1", null, null, "DEADLINE_NOT_UPDATED"]);
    const bad = mapOwnerContextRow({ ...rowA, answer_value: { kind: "DATE", ymd: "2026-10-07", resolution: { method: "EXPLICIT", anchorYmd: "2026-09-23", timeZone: "Asia/Jerusalem" } } });
    check("2. a v1 row with answer_value → INVALID_STORED_ROW", bad.ok ? "ok" : bad.code, "INVALID_STORED_ROW");
    const { db, store } = fresh();
    const other = projectDeadlineCase("p-v2root");
    const r = await store.appendOwnerContext(buildOwnerContextDraft(questionFor(other), CASE_SCHEMA_VERSION, { answerCode: "CLIENT_DELAY" }));
    check("3. v2 code-only root context (spec NONE) → value null, trigger null, schema v2", [r.schemaVersion, r.answerValue, r.triggerContextId, db.rows[0].answer_value], ["partner-owner-context-schema-v2", null, null, null]);
  }

  console.log("v2-B. Follow-up rules (Owner decision)");
  {
    ok("1. DEADLINE_NOT_UPDATED triggers WHAT_IS_NEW_PROJECT_DEADLINE", triggersFollowUp("WHY_DEADLINE_STILL_ACTIVE", "DEADLINE_NOT_UPDATED", "WHAT_IS_NEW_PROJECT_DEADLINE"));
    ok("2. INTENTIONALLY_DELAYED triggers it", triggersFollowUp("WHY_DEADLINE_STILL_ACTIVE", "INTENTIONALLY_DELAYED", "WHAT_IS_NEW_PROJECT_DEADLINE"));
    ok("3. DEADLINE_NO_LONGER_RELEVANT does NOT", !triggersFollowUp("WHY_DEADLINE_STILL_ACTIVE", "DEADLINE_NO_LONGER_RELEVANT", "WHAT_IS_NEW_PROJECT_DEADLINE"));
    ok("4. other causes do NOT trigger it in v1", ["CLIENT_DELAY", "ARTIST_DELAY", "QUALITY_WORK_CONTINUED", "EXTERNAL_DEPENDENCY", "PROJECT_WAS_PAUSED", "OTHER"].every((c) => !triggersFollowUp("WHY_DEADLINE_STILL_ACTIVE", c, "WHAT_IS_NEW_PROJECT_DEADLINE")));
    ok("a Case alone never yields a follow-up question type", decideInvestigation(C3).question?.questionType === "WHY_DEADLINE_STILL_ACTIVE" && decideInvestigation(C3).question?.origin.kind === "CASE");
    const { store } = withA();
    const fq = await followUpFor(store);
    check("follow-up question identity (questionId = caseId::type — unchanged rule)", [fq.id, fq.questionType], [`${C3.id}::WHAT_IS_NEW_PROJECT_DEADLINE`, "WHAT_IS_NEW_PROJECT_DEADLINE"]);
    check("10. origin points at the EXACT triggering context", fq.origin, { kind: "OWNER_CONTEXT", triggerContextId: A_ID, triggerQuestionId: Q3.id, triggerAnswerCode: "DEADLINE_NOT_UPDATED" });
    check("wording grounded in the stored deadline", fq.questionTextHe, "הדדליין השמור (14.07.2026) כבר לא משקף את התכנון. מה הדדליין החדש לפרויקט?");
    check("answers", fq.answerOptions.map((o) => o.code), ["IN_ONE_WEEK", "IN_TWO_WEEKS", "END_OF_MONTH", "SPECIFIC_DATE", "NOT_KNOWN_YET", "OTHER"]);
    const noTrigger = buildFollowUpQuestions(C3, [{ ...(await currentOf(store))[0], answerCode: "DEADLINE_NO_LONGER_RELEVANT" }]);
    check("no follow-up from DEADLINE_NO_LONGER_RELEVANT", noTrigger, []);
  }

  console.log("v2-C. Date resolver (server-side, Asia/Jerusalem)");
  {
    const r = resolveAnswerValue("WHAT_IS_NEW_PROJECT_DEADLINE", "IN_TWO_WEEKS", { anchorYmd: "2026-09-23" });
    check("5. 2026-09-23 + PLUS_14_DAYS = 2026-10-07", r, { ok: true, value: { kind: "DATE", ymd: "2026-10-07", resolution: { method: "RELATIVE", rule: "PLUS_14_DAYS", anchorYmd: "2026-09-23", timeZone: "Asia/Jerusalem" } } });
    const ymdOf = (x: ReturnType<typeof resolveAnswerValue>) => (x.ok && x.value ? x.value.ymd : "REJECTED");
    check("IN_ONE_WEEK → 2026-09-30", ymdOf(resolveAnswerValue("WHAT_IS_NEW_PROJECT_DEADLINE", "IN_ONE_WEEK", { anchorYmd: "2026-09-23" })), "2026-09-30");
    check("END_OF_MONTH → 2026-09-30 / Feb 2026 → 02-28 / Feb 2028 → 02-29", ["2026-09-23", "2026-02-10", "2028-02-10"].map((a) => ymdOf(resolveAnswerValue("WHAT_IS_NEW_PROJECT_DEADLINE", "END_OF_MONTH", { anchorYmd: a }))), ["2026-09-30", "2026-02-28", "2028-02-29"]);
    const exp = resolveAnswerValue("WHAT_IS_NEW_PROJECT_DEADLINE", "SPECIFIC_DATE", { anchorYmd: "2026-09-23", explicitYmd: "2026-11-15" });
    check("7. explicit valid date accepted", exp.ok ? exp.value : exp, { kind: "DATE", ymd: "2026-11-15", resolution: { method: "EXPLICIT", anchorYmd: "2026-09-23", timeZone: "Asia/Jerusalem" } });
    ok("8. explicit date before the answer date rejected", !resolveAnswerValue("WHAT_IS_NEW_PROJECT_DEADLINE", "SPECIFIC_DATE", { anchorYmd: "2026-09-23", explicitYmd: "2026-09-22" }).ok);
    ok("9. same-day explicit date accepted", resolveAnswerValue("WHAT_IS_NEW_PROJECT_DEADLINE", "SPECIFIC_DATE", { anchorYmd: "2026-09-23", explicitYmd: "2026-09-23" }).ok);
    ok("impossible calendar date (2026-02-30) rejected", !resolveAnswerValue("WHAT_IS_NEW_PROJECT_DEADLINE", "SPECIFIC_DATE", { anchorYmd: "2026-01-01", explicitYmd: "2026-02-30" }).ok);
    check("NOT_KNOWN_YET → no value", resolveAnswerValue("WHAT_IS_NEW_PROJECT_DEADLINE", "NOT_KNOWN_YET", { anchorYmd: "2026-09-23" }), { ok: true, value: null });
    ok("6. a caller-supplied date for a relative answer is rejected", !resolveAnswerValue("WHAT_IS_NEW_PROJECT_DEADLINE", "IN_TWO_WEEKS", { anchorYmd: "2026-09-23", explicitYmd: "2026-10-07" }).ok);
    ok("a date on a code-only answer is rejected", !resolveAnswerValue("WHY_DEADLINE_STILL_ACTIVE", "DEADLINE_NOT_UPDATED", { anchorYmd: "2026-09-23", explicitYmd: "2026-10-07" }).ok);
    const spoof = { kind: "DATE", ymd: "2026-10-08", resolution: { method: "RELATIVE", rule: "PLUS_14_DAYS", anchorYmd: "2026-09-23", timeZone: "Asia/Jerusalem" } };
    ok("6. a spoofed resolved ymd fails re-verification", validateAnswerValue("WHAT_IS_NEW_PROJECT_DEADLINE", "IN_TWO_WEEKS", spoof).length > 0);
    ok("no browser locale: the resolver has no clock / locale of its own", !/new Date\(\)|Date\.now|toLocale/.test(fs.readFileSync(path.resolve(__dirname, "../lib/partner/investigation/answer-value.ts"), "utf8")));
  }

  console.log("v2-D. Real flow: A → follow-up → B (IN_TWO_WEEKS, answered 2026-09-23)");
  let realB: PersistedOwnerContext | null = null;
  {
    const { db, store } = withA();
    const fq = await followUpFor(store);
    const B = await store.appendOwnerContext(buildOwnerContextDraft(fq, CASE_SCHEMA_VERSION, { answerCode: "IN_TWO_WEEKS", answeredOnYmd: "2026-09-23" }));
    realB = B;
    check("B: schema v2, exact trigger, DATE 2026-10-07", [B.schemaVersion, B.triggerContextId, B.answerValue?.ymd, B.answerValue?.resolution], ["partner-owner-context-schema-v2", A_ID, "2026-10-07", { method: "RELATIVE", rule: "PLUS_14_DAYS", anchorYmd: "2026-09-23", timeZone: "Asia/Jerusalem" }]);
    check("B row stored with answer_value + trigger_context_id", [db.rows[1].trigger_context_id, (db.rows[1].answer_value as { ymd: string }).ymd], [A_ID, "2026-10-07"]);
    check("A untouched", JSON.stringify(db.rows[0]), JSON.stringify(rowA));
    const cur = await store.resolveCurrentOwnerContexts({ caseId: C3.id });
    check("A and B both CURRENT_APPLICABLE", cur.status === "OK" ? cur.contexts.map((c) => c.id) : cur.status, [A_ID, B.id]);
    const i = interpretCase(C3, fq, cur.status === "OK" ? cur.contexts : []);
    check("interpretation states the Owner's decision; the project fact is unchanged", [i.derivedFromContext.map((d) => d.statementHe), i.facts.find((f) => f.field === "deadline")?.value, i.unknownsRemaining], [["נקבע דדליין חדש לפרויקט (לפי הבעלים).", "הדדליין החדש שנבחר: 07.10.2026 (לפי הבעלים)."], "2026-07-14", []]);
    ok("17. no Action is executed / modeled", !fs.readdirSync(path.resolve(__dirname, "../lib/partner/investigation")).some((f) => /action/i.test(f)));
  }

  console.log("v2-E. Store validation for follow-ups / values / root slots");
  {
    const { store } = withA();
    const fq = await followUpFor(store);
    await expectErr("6. caller-supplied answerValue rejected", () => store.appendOwnerContext({ ...buildOwnerContextDraft(fq, CASE_SCHEMA_VERSION, { answerCode: "IN_TWO_WEEKS" }), answerValue: { kind: "DATE", ymd: "2030-01-01" } } as unknown as OwnerContextDraft), "VALIDATION_FAILED");
    await expectErr("6. caller-supplied date on a relative answer rejected", () => store.appendOwnerContext(buildOwnerContextDraft(fq, CASE_SCHEMA_VERSION, { answerCode: "IN_TWO_WEEKS", explicitDateYmd: "2026-10-07" })), "INVALID_ANSWER_VALUE");
    await expectErr("11. follow-up without trigger rejected", () => store.appendOwnerContext({ ...buildOwnerContextDraft(fq, CASE_SCHEMA_VERSION, { answerCode: "IN_TWO_WEEKS" }), triggerContextId: null }), "INVALID_TRIGGER");
    await expectErr("12. Case question with a trigger rejected", () => store.appendOwnerContext({ ...draft({ answerCode: "CLIENT_DELAY" }, questionFor(projectDeadlineCase("p-x"))), triggerContextId: A_ID }), "INVALID_TRIGGER");
    await expectErr("unknown trigger rejected", () => store.appendOwnerContext({ ...buildOwnerContextDraft(fq, CASE_SCHEMA_VERSION, { answerCode: "IN_TWO_WEEKS" }), triggerContextId: uid(4040) }), "INVALID_TRIGGER");
    const otherCase = projectDeadlineCase("p-other");
    const otherFq = buildFollowUpQuestions(otherCase, [{ ...(await currentOf(store))[0], caseId: otherCase.id }])[0];
    await expectErr("trigger about another Case rejected", () => store.appendOwnerContext(buildOwnerContextDraft(otherFq, CASE_SCHEMA_VERSION, { answerCode: "IN_TWO_WEEKS" })), "INVALID_TRIGGER");
    await expectErr("answer date in the future rejected", () => store.appendOwnerContext(buildOwnerContextDraft(fq, CASE_SCHEMA_VERSION, { answerCode: "IN_TWO_WEEKS", answeredOnYmd: "2026-09-24" })), "INVALID_ANSWER_VALUE");
    await expectErr("answer date before the trigger was answered rejected", () => store.appendOwnerContext(buildOwnerContextDraft(fq, CASE_SCHEMA_VERSION, { answerCode: "IN_TWO_WEEKS", answeredOnYmd: "2026-09-22" })), "INVALID_ANSWER_VALUE");
    await expectErr("8. SPECIFIC_DATE before the answer date rejected", () => store.appendOwnerContext(buildOwnerContextDraft(fq, CASE_SCHEMA_VERSION, { answerCode: "SPECIFIC_DATE", explicitDateYmd: "2026-09-20" })), "INVALID_ANSWER_VALUE");
    const same = await store.appendOwnerContext(buildOwnerContextDraft(fq, CASE_SCHEMA_VERSION, { answerCode: "SPECIFIC_DATE", explicitDateYmd: "2026-09-23" }));
    check("9. same-day SPECIFIC_DATE accepted (server date 2026-09-23)", [same.answerValue?.ymd, same.answerValue?.resolution.method], ["2026-09-23", "EXPLICIT"]);
    await expectErr("second independent answer to the same question → use a revision", () => store.appendOwnerContext(buildOwnerContextDraft(fq, CASE_SCHEMA_VERSION, { answerCode: "IN_TWO_WEEKS" })), "ANSWER_EXISTS_USE_REVISION");
    await expectErr("…also for Case questions (the F.1E gap, closed)", () => store.appendOwnerContext(draft({ answerCode: "CLIENT_DELAY" })), "ANSWER_EXISTS_USE_REVISION");
    const { db: db2, store: s2 } = withA();
    const fq2 = await followUpFor(s2);
    await s2.appendOwnerContext(buildOwnerContextDraft(fq2, CASE_SCHEMA_VERSION, { answerCode: "NOT_KNOWN_YET", note: "IN_TWO_WEEKS 2026-12-31" }));
    check("16. note never parsed: NOT_KNOWN_YET + a date-looking note → value null", db2.rows[1].answer_value, null);
    db2.opts.hideRowIdsOnRead = new Set([String(db2.rows[1].id)]);
    const race = await expectErr("root-slot race reaching the DB unique index → ANSWER_EXISTS_USE_REVISION", () => s2.appendOwnerContext(buildOwnerContextDraft(fq2, CASE_SCHEMA_VERSION, { answerCode: "IN_ONE_WEEK" })), "ANSWER_EXISTS_USE_REVISION");
    ok("   DB detail kept", !!race && race.details.some((d) => d.includes("23505")));
  }

  console.log("v2-F. Revisions of B + trigger continuity");
  {
    const { store } = withA();
    const fq = await followUpFor(store);
    const B = await store.appendOwnerContext(buildOwnerContextDraft(fq, CASE_SCHEMA_VERSION, { answerCode: "IN_TWO_WEEKS", answeredOnYmd: "2026-09-23" }));
    const B2 = await store.appendOwnerContext(buildOwnerContextDraft(fq, CASE_SCHEMA_VERSION, { answerCode: "IN_ONE_WEEK", supersedesId: B.id }));
    check("revision of B keeps the same trigger; value re-resolved by the server (2026-09-23 + 7)", [B2.triggerContextId, B2.answerValue?.ymd], [A_ID, "2026-09-30"]);
  }
  {
    // 5/6/9/13: note-only revision of A keeps B applicable; B keeps pointing at A.
    const { db, store } = withA();
    const fq = await followUpFor(store);
    const B = await store.appendOwnerContext(buildOwnerContextDraft(fq, CASE_SCHEMA_VERSION, { answerCode: "IN_TWO_WEEKS", answeredOnYmd: "2026-09-23" }));
    const A2 = await store.appendOwnerContext({ ...buildOwnerContextDraft(Q3, CASE_SCHEMA_VERSION, { answerCode: "DEADLINE_NOT_UPDATED", note: "הוספתי הקשר: הלקוח לא לחץ.", supersedesId: A_ID }), questionText: OWNER_Q_TEXT, caseFactsFingerprint: "cc7d8bca34c49059" });
    const hist = await store.listOwnerContexts();
    const cls = classifyOwnerContexts(hist.status === "OK" ? hist.contexts : []);
    check("5/6. note-only trigger revision → B still CURRENT_APPLICABLE (continuity via A2)", [cls.get(B.id)?.status, cls.get(B.id)?.effectiveTriggerId, cls.get(A_ID)?.status], ["CURRENT_APPLICABLE", A2.id, "SUPERSEDED"]);
    check("9. B still points at the ORIGINAL trigger A", db.rows.find((r) => r.id === B.id)?.trigger_context_id, A_ID);
    const cur = await store.getCurrentContextForQuestion(fq.id);
    check("the new-deadline question is NOT re-asked: current answer is B", cur.status === "CURRENT" ? cur.context.id : cur.status, B.id);
    const regenerated = buildFollowUpQuestions(C3, await currentOf(store), { [fq.id]: A_ID })[0];
    check("regenerated follow-up keeps B's slot (original trigger A)", regenerated.origin.kind === "OWNER_CONTEXT" ? regenerated.origin.triggerContextId : null, A_ID);
    await expectErr("13. revising B while changing its trigger to A2 is rejected", () => store.appendOwnerContext({ ...buildOwnerContextDraft(fq, CASE_SCHEMA_VERSION, { answerCode: "IN_ONE_WEEK", supersedesId: B.id }), triggerContextId: A2.id }), "REVISION_TARGET_MISMATCH");
  }
  {
    // 7/14/15/10: trigger revised to DEADLINE_NO_LONGER_RELEVANT → B stays in history, not applicable.
    const { store } = withA();
    const fq = await followUpFor(store);
    const B = await store.appendOwnerContext(buildOwnerContextDraft(fq, CASE_SCHEMA_VERSION, { answerCode: "IN_TWO_WEEKS", answeredOnYmd: "2026-09-23" }));
    await store.appendOwnerContext({ ...buildOwnerContextDraft(Q3, CASE_SCHEMA_VERSION, { answerCode: "DEADLINE_NO_LONGER_RELEVANT", supersedesId: A_ID }), questionText: OWNER_Q_TEXT });
    const cur = await store.getCurrentContextForQuestion(fq.id);
    check("7/15. answer changed → B NOT_APPLICABLE with explicit reasons", cur.status === "NOT_APPLICABLE" ? [cur.context.id, cur.applicability.reasons] : cur.status, [B.id, ["TRIGGER_ANSWER_CHANGED", "TRIGGER_NO_LONGER_SATISFIES_RULE"]]);
    const byQ = await store.getContextsForQuestion(fq.id);
    check("14. B remains in history, untouched", byQ.status === "OK" ? byQ.contexts.map((c) => [c.id, c.triggerContextId, c.answerValue?.ymd]) : byQ.status, [[B.id, A_ID, "2026-10-07"]]);
    const all = await store.listOwnerContexts();
    ok("10. Action eligibility input (applicableContexts) excludes B", all.status === "OK" && !applicableContexts(all.contexts).some((c) => c.id === B.id));
    const rc = await store.resolveCurrentOwnerContexts({ caseId: C3.id });
    ok("resolveCurrent reports B under notApplicable, not as current", rc.status === "OK" && !rc.contexts.some((c) => c.id === B.id) && rc.notApplicable.some((x) => x.context.id === B.id));
    check("no follow-up question is generated from the revised answer", buildFollowUpQuestions(C3, rc.status === "OK" ? rc.contexts : []), []);
  }
  {
    // 8 + re-trigger: facts changed on the trigger revision → B not applicable; a new answer lives in a new slot.
    const { store } = withA();
    const fq = await followUpFor(store);
    await store.appendOwnerContext(buildOwnerContextDraft(fq, CASE_SCHEMA_VERSION, { answerCode: "IN_TWO_WEEKS", answeredOnYmd: "2026-09-23" }));
    const A2 = await store.appendOwnerContext({ ...buildOwnerContextDraft(Q3, CASE_SCHEMA_VERSION, { answerCode: "DEADLINE_NOT_UPDATED", supersedesId: A_ID }), questionText: OWNER_Q_TEXT, caseFactsFingerprint: "0000000000000000" });
    const cur = await store.getCurrentContextForQuestion(fq.id);
    check("8. trigger facts changed → B NOT_APPLICABLE (TRIGGER_FACTS_CHANGED)", cur.status === "NOT_APPLICABLE" ? cur.applicability.reasons : cur.status, ["TRIGGER_FACTS_CHANGED"]);
    const fqNew = buildFollowUpQuestions(C3, await currentOf(store))[0];
    check("re-triggered follow-up points at A2 (new slot, same questionId)", [fqNew.id, fqNew.origin.kind === "OWNER_CONTEXT" ? fqNew.origin.triggerContextId : null], [fq.id, A2.id]);
    const Bn = await store.appendOwnerContext(buildOwnerContextDraft(fqNew, CASE_SCHEMA_VERSION, { answerCode: "END_OF_MONTH" }));
    const cur2 = await store.getCurrentContextForQuestion(fq.id);
    check("new answer in the new slot is current; B stays history", [cur2.status === "CURRENT" ? cur2.context.id : cur2.status, Bn.answerValue?.ymd], [Bn.id, "2026-09-30"]);
  }

  console.log("v2-G. Read-side validation of v2 rows");
  {
    const base: Row = { ...rowA, id: uid(900), context_schema_version: "partner-owner-context-schema-v2", question_id: `${C3.id}::WHAT_IS_NEW_PROJECT_DEADLINE`, question_type: "WHAT_IS_NEW_PROJECT_DEADLINE", answer_code: "IN_TWO_WEEKS", trigger_context_id: A_ID, answer_value: { kind: "DATE", ymd: "2026-10-07", resolution: { method: "RELATIVE", rule: "PLUS_14_DAYS", anchorYmd: "2026-09-23", timeZone: "Asia/Jerusalem" } } };
    const res = (patch: Row) => { const m = mapOwnerContextRow({ ...base, ...patch }); return m.ok ? "ok" : m.code; };
    check("valid v2 follow-up row", res({}), "ok");
    check("v2 follow-up without trigger → INVALID", res({ trigger_context_id: null }), "INVALID_STORED_ROW");
    check("v2 value that does not match its resolution → INVALID", res({ answer_value: { ...(base.answer_value as object), ymd: "2026-10-08" } }), "INVALID_STORED_ROW");
    check("v2 relative answer without a value → INVALID", res({ answer_value: null }), "INVALID_STORED_ROW");
    check("v2 code-only answer carrying a value → INVALID", res({ answer_code: "NOT_KNOWN_YET" }), "INVALID_STORED_ROW");
    check("v2 value with an unknown key → INVALID", res({ answer_value: { ...(base.answer_value as object), extra: 1 } }), "INVALID_STORED_ROW");
  }

  console.log("v2-H. Safety");
  {
    const src = ["answer-value.ts", "context-applicability.ts", "questions.ts", "context-row.ts", "context-persistence.ts"].map((f) => fs.readFileSync(path.resolve(__dirname, "../lib/partner/investigation", f), "utf8")).join("\n");
    ok("18. no production client in the v2 code paths under test (fake only)", !/lib\/supabase/.test(src));
    ok("no project/business-table write anywhere (no deadline change)", !/from\(\s*["'](projects|tasks|partner_feedback)["']/.test(src));
    ok("realB came from the fake store (DB-generated fake id)", realB !== null && realB.id.startsWith("00000000-0000-4000-8000-"));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
