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
import { decideInvestigation, buildAttentionQueue, interpretCase, deriveContextLearningSignals, type PartnerInvestigationQuestion } from "../lib/partner/investigation";
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
  opts: { failSelect?: boolean; throwOnSelect?: boolean; failInsert?: boolean; hideSuccessorPrecheck?: boolean } = {};
  clockMs = Date.parse("2026-09-24T09:00:00.000Z");
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
              if (db.opts.hideSuccessorPrecheck && columns === "id" && filters.some(([c]) => c === "supersedes_id")) return { data: [], error: null };
              let out = db.rows.filter((r) => filters.every(([c, v]) => r[c] === v));
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
const fresh = () => { const db = new FakeContextDb(); return { db, store: createOwnerContextStore(db.client()) }; };
const ids = (r: { status: string; contexts?: PersistedOwnerContext[] }) => (r.status === "OK" && r.contexts ? r.contexts.map((c) => c.id) : r.status);

async function main() {
  console.log("1/4/5/6. Valid context inserts; DB id + created_at returned; schema version stamped");
  {
    const { db, store } = fresh();
    db.forceNextIds = ["9f3c2a10-0000-4000-8000-00000000abcd"];
    const r = await store.appendOwnerContext(draft());
    check("one row", db.rows.length, 1);
    check("4. id from DB", r.id, "9f3c2a10-0000-4000-8000-00000000abcd");
    check("5. answeredAt = DB created_at (normalized ISO)", r.answeredAt, "2026-09-24T09:00:00.000Z");
    check("6. context_schema_version stamped", [db.rows[0].context_schema_version, r.schemaVersion], [OWNER_CONTEXT_SCHEMA_VERSION, OWNER_CONTEXT_SCHEMA_VERSION]);
    check("INSERT never carries id / created_at / schema from the caller", ["id", "created_at"].filter((k) => k in db.insertPayloads[0]), []);
    check("row columns (explicit mapping)", Object.keys(db.rows[0]).sort(), OWNER_CONTEXT_COLUMNS.split(",").sort());
    ok("domain record has no snake_case keys", Object.keys(r).every((k) => !k.includes("_")));
    check("identity round-trip", [r.questionId, r.questionType, r.caseId, r.caseType, r.subjectType, r.subjectId, r.answerCode, r.scope], [Q3.id, "WHY_DEADLINE_STILL_ACTIVE", C3.id, "PROJECT_DEADLINE_PASSED", "project", C3.subjectId, "DEADLINE_NOT_UPDATED", "CASE_INSTANCE"]);
    for (const k of ["id", "createdAt", "answeredAt", "schemaVersion", "contextSchemaVersion"]) {
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
    db.opts.hideSuccessorPrecheck = true;
    const race = await expectErr("15. race reaching the DB partial UNIQUE index", () => store.appendOwnerContext(draft({ supersedesId: a.id })), "REVISION_BRANCH_CONFLICT");
    ok("   DB detail kept", !!race && race.details.some((d) => d.includes("23505")));
    db.opts.hideSuccessorPrecheck = false;
    await expectErr("supersedesId that does not exist", () => store.appendOwnerContext(draft({ supersedesId: uid(999) })), "SUPERSEDED_NOT_FOUND");
    check("only the 2 valid rows exist", db.rows.length, 2);
  }

  console.log("16/17/18. Fail-closed reads; read failure ≠ empty");
  {
    const { db, store } = fresh();
    await store.appendOwnerContext(draft());
    db.seedRaw({ ...db.rows[0], id: uid(50), context_schema_version: "partner-owner-context-schema-v2" });
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
    const mk = (id: string, sup: string | null, q = "c:1::WHY_DEADLINE_STILL_ACTIVE"): PersistedOwnerContext => ({ id, schemaVersion: OWNER_CONTEXT_SCHEMA_VERSION, questionId: q, questionType: "WHY_DEADLINE_STILL_ACTIVE", caseId: q.split("::")[0], caseType: "PROJECT_DEADLINE_PASSED", subjectType: "project", subjectId: "1", answerCode: "OTHER", questionTextHe: "q", caseFactsFingerprint: "f", note: null, answeredAt: "2026-09-24T09:00:00.000Z", scope: "CASE_INSTANCE", provenance: { source: "owner_manual" }, caseSchemaVersion: CASE_SCHEMA_VERSION, supersedesId: sup });
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
    check("30. nothing in app/ components/ lib/ imports the store (no route, no UI)", importers.map((f) => path.relative(ROOT, f)), []);
    ok("30. no /api/partner route exists", !fs.existsSync(path.join(ROOT, "app", "api", "partner")));

    const { db, store } = fresh();
    const a = await store.appendOwnerContext(draft());
    await store.appendOwnerContext(draft({ supersedesId: a.id, answerCode: "CLIENT_DELAY" }));
    await store.listOwnerContexts(); await store.getContextsForQuestion(Q3.id); await store.getContextsForCase(C3.id);
    await store.getContextsForSubject("project", "1"); await store.getContextsForCaseType("X"); await store.getCurrentContextForQuestion(Q3.id);
    check("every DB verb issued", [...new Set(db.log.map((l) => l.split(":")[0]))].sort(), ["eq", "from", "insert", "insert.select", "maybeSingle", "order", "range", "select", "single"]);
    check("only table ever touched: partner_owner_context", [...db.tables], ["partner_owner_context"]);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
