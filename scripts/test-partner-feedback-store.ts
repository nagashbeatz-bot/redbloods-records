/**
 * Store tests for Redbloods Partner — Structured Owner Feedback persistence
 * (Phase F.1B).
 *
 * Run with:   npx tsx scripts/test-partner-feedback-store.ts
 *
 * NEVER touches production: every write-path test drives the real
 * persistence core (lib/partner/feedback/persistence.ts) against an
 * in-memory fake that mimics PostgREST + the verified partner_feedback
 * constraints (PK, self-FK on supersedes_id, partial UNIQUE on
 * supersedes_id, target_scope CHECK, jsonb round-trip, "+00:00" timestamps,
 * range paging). store.ts itself is only inspected statically (it imports
 * "server-only" + the real service-role client).
 */
import fs from "node:fs";
import path from "node:path";
import { CASE_SCHEMA_VERSION, type PartnerCase } from "../lib/partner/cases/types";
import {
  FEEDBACK_SCHEMA_VERSION, buildCaseFeedbackSnapshot, emptyFeedbackDimensions,
  summarizePartnerFeedback, deriveLearningSignals, buildLearningProposals,
  type PartnerFeedback, type PartnerFeedbackDimensions,
} from "../lib/partner/feedback";
import {
  createPartnerFeedbackStore, analyzeFeedbackRevisionGraph, redactSecrets, PartnerFeedbackStoreError, PAGE_SIZE,
  type AppendPartnerFeedbackInput, type FeedbackDbResponse, type FeedbackSelectQuery, type FeedbackTableClient,
} from "../lib/partner/feedback/persistence";
import { PARTNER_FEEDBACK_COLUMNS, mapFeedbackRow, type PartnerFeedbackRow } from "../lib/partner/feedback/row";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}
const ok = (name: string, cond: boolean) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}`); fail++; } };

async function expectStoreError(name: string, fn: () => Promise<unknown>, code: string): Promise<PartnerFeedbackStoreError | null> {
  try { await fn(); ok(`${name} (expected ${code}, got success)`, false); return null; }
  catch (e) {
    const isTyped = e instanceof PartnerFeedbackStoreError;
    ok(`${name} → ${code}`, isTyped && (e as PartnerFeedbackStoreError).code === code);
    if (!isTyped || (e as PartnerFeedbackStoreError).code !== code) console.log(`      got: ${String(e)}`);
    return isTyped ? (e as PartnerFeedbackStoreError) : null;
  }
}

// ── in-memory fake of public.partner_feedback behind a PostgREST-shaped client ──

type Row = Record<string, unknown>;
interface FakeOptions { failSelect?: boolean; throwOnSelect?: boolean; failInsert?: boolean; hideSuccessorPrecheck?: boolean }

class FakeFeedbackDb {
  rows: Row[] = [];
  log: string[] = [];
  tables = new Set<string>();
  opts: FakeOptions = {};

  /** Mimic Postgres: jsonb round-trip + timestamptz rendered as "+00:00" with microseconds. */
  private store(row: Row): Row {
    const clone = JSON.parse(JSON.stringify(row)) as Row;
    clone.created_at = new Date(String(row.created_at)).toISOString().replace("Z", "000+00:00");
    return clone;
  }

  seedRaw(row: Row) { this.rows.push(JSON.parse(JSON.stringify(row))); }

  private insertRow(row: PartnerFeedbackRow): FeedbackDbResponse<unknown> {
    if (this.opts.failInsert) return { data: null, error: { code: "08006", message: "connection failure apikey=eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sig sb_secret_ABCdef123" } };
    if (this.rows.some((r) => r.id === row.id)) return { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "partner_feedback_pkey"' } };
    if (!["CASE_INSTANCE", "CASE_TYPE", "SUBJECT", "RULE_APPLICATION", "HYPOTHESIS", "THRESHOLD_PROPOSAL"].includes(row.target_scope)) return { data: null, error: { code: "23514", message: "violates check constraint" } };
    if (row.supersedes_id !== null && !this.rows.some((r) => r.id === row.supersedes_id)) return { data: null, error: { code: "23503", message: "violates foreign key constraint" } };
    if (row.supersedes_id !== null && this.rows.some((r) => r.supersedes_id === row.supersedes_id)) {
      return { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "partner_feedback_supersedes_unique_idx"', details: `Key (supersedes_id)=(${row.supersedes_id}) already exists.` } };
    }
    const stored = this.store(row as unknown as Row);
    this.rows.push(stored);
    return { data: JSON.parse(JSON.stringify(stored)), error: null };
  }

  client(): FeedbackTableClient {
    const db = this;
    return {
      from(table) {
        db.tables.add(table); db.log.push(`from:${table}`);
        return {
          select(columns) {
            db.log.push("select");
            const filters: Array<[string, string]> = [];
            const orders: Array<[string, boolean]> = [];
            let range: [number, number] | null = null;
            const run = (): FeedbackDbResponse<unknown[]> => {
              if (db.opts.failSelect) return { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
              if (db.opts.hideSuccessorPrecheck && columns === "id" && filters.some(([c]) => c === "supersedes_id")) return { data: [], error: null };
              let out = db.rows.filter((r) => filters.every(([c, v]) => r[c] === v));
              out = [...out].sort((a, b) => {
                for (const [c, asc] of orders) {
                  const av = c === "created_at" ? Date.parse(String(a[c])) : String(a[c]);
                  const bv = c === "created_at" ? Date.parse(String(b[c])) : String(b[c]);
                  if (av < bv) return asc ? -1 : 1;
                  if (av > bv) return asc ? 1 : -1;
                }
                return 0;
              });
              if (range) out = out.slice(range[0], range[1] + 1);
              const cols = columns.split(",");
              return { data: out.map((r) => JSON.parse(JSON.stringify(Object.fromEntries(cols.map((c) => [c, r[c]]))))), error: null };
            };
            const q: FeedbackSelectQuery = {
              eq(c, v) { db.log.push("eq"); filters.push([c, v]); return q; },
              order(c, o) { db.log.push("order"); orders.push([c, o.ascending]); return q; },
              range(a, b) { db.log.push("range"); range = [a, b]; return q; },
              maybeSingle() {
                db.log.push("maybeSingle");
                const r = run();
                return Promise.resolve(r.error ? { data: null, error: r.error } : { data: r.data && r.data.length ? r.data[0] : null, error: null });
              },
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

// ── fixtures ──

const KNOWN = ["TASK_DUE_DATE_PASSED", "PROJECT_DEADLINE_PASSED", "PROJECT_PAYMENT_OUTSTANDING"];
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function makeCase(overrides: Partial<PartnerCase> = {}): PartnerCase {
  return {
    id: "task_due_date_passed:t1", schemaVersion: CASE_SCHEMA_VERSION, caseType: "TASK_DUE_DATE_PASSED",
    subjectType: "task", subjectId: "t1", classification: "RISK", status: "OPEN", createdFrom: "STATE",
    facts: [{ domain: "tasks", entityId: "t1", field: "dueYmd", value: "2026-09-10", label: "dueYmd" }],
    derivedFacts: [{ id: "days_overdue", label: "ימים באיחור", value: 12, basis: "today − dueYmd" }],
    hypotheses: [{ id: "h1", statement: "ייתכן שהמשימה כבר לא רלוונטית.", evidenceIds: [] }],
    ownerRulesApplied: [], workingPrinciplesApplied: [], unknowns: [], dataQuality: { notes: [] },
    interventionStyle: "GENTLE", summaryHe: "תאריך היעד של המשימה עבר ב-12 ימים.", changeContext: null,
    ...overrides,
  };
}

function dims(patch: Partial<PartnerFeedbackDimensions> = {}): PartnerFeedbackDimensions {
  return { ...emptyFeedbackDimensions(), ...patch };
}

function caseInput(n: number, patch: Partial<AppendPartnerFeedbackInput> = {}, c: PartnerCase = makeCase()): AppendPartnerFeedbackInput {
  const createdAt = `2026-09-23T10:00:${String(n % 60).padStart(2, "0")}.000Z`;
  return {
    id: uid(n), createdAt,
    target: { scope: "CASE_INSTANCE", caseId: c.id, caseType: c.caseType },
    dimensions: dims({ accuracy: "CORRECT", importance: "NOT_IMPORTANT" }),
    note: null, caseSnapshot: buildCaseFeedbackSnapshot(c, createdAt), supersedesId: null,
    provenance: { source: "owner_manual" },
    ...patch,
  };
}

function fresh(opts: FakeOptions = {}) {
  const db = new FakeFeedbackDb();
  db.opts = opts;
  return { db, store: createPartnerFeedbackStore(db.client()) };
}

const WRITE_VERBS = /\b(update|delete|upsert|rpc)\b/;

async function main() {
  // 1 ──
  console.log("1. Valid feedback inserts");
  {
    const { db, store } = fresh();
    const r = await store.appendPartnerFeedback(caseInput(1), { knownCaseTypes: KNOWN });
    check("one row stored", db.rows.length, 1);
    check("returned record id", r.feedback.id, uid(1));
    check("createdAt normalized back to canonical ISO (same instant as input)", r.feedback.createdAt, "2026-09-23T10:00:01.000Z");
    check("dimensions round-trip", r.feedback.dimensions, dims({ accuracy: "CORRECT", importance: "NOT_IMPORTANT" }));
    check("no warnings for a known caseType", r.warnings, []);
    const row = db.rows[0];
    check("DB row uses snake_case columns (explicit mapping)", Object.keys(row).sort(), PARTNER_FEEDBACK_COLUMNS.split(",").sort());
    check("target columns mapped", [row.target_scope, row.case_id, row.case_type, row.subject_id], ["CASE_INSTANCE", "task_due_date_passed:t1", "TASK_DUE_DATE_PASSED", null]);
    ok("domain record exposes no snake_case keys", Object.keys(r.feedback).every((k) => !k.includes("_")));
  }

  // 2 ──
  console.log("2. Invalid feedback rejected BEFORE any DB call");
  {
    const cases: Array<[string, AppendPartnerFeedbackInput]> = [
      ["no signal at all", caseInput(2, { dimensions: dims() })],
      ["CASE_INSTANCE without snapshot", caseInput(2, { caseSnapshot: null })],
      ["snapshot caseId ≠ target caseId", caseInput(2, { target: { scope: "CASE_INSTANCE", caseId: "other:x", caseType: "TASK_DUE_DATE_PASSED" } })],
      ["CASE_INSTANCE missing caseType", caseInput(2, { target: { scope: "CASE_INSTANCE", caseId: "task_due_date_passed:t1" } })],
      ["DO_NOT_INFER without hypothesisId", caseInput(2, { dimensions: dims({ inference: { value: "DO_NOT_INFER", hypothesisId: null } }) })],
      ["unknown accuracy enum", caseInput(2, { dimensions: { ...dims(), accuracy: "MAYBE" as never } })],
      ["unknown dimension key", caseInput(2, { dimensions: { ...dims({ accuracy: "CORRECT" }), mood: "x" } as never })],
      ["non-uuid id", caseInput(2, { id: "fb-1" })],
      ["uppercase uuid id (never silently lower-cased)", caseInput(2, { id: "ABCDEF00-0000-4000-8000-000000000002" })],
      ["bad createdAt", caseInput(2, { createdAt: "yesterday" })],
      ["unknown provenance source", caseInput(2, { provenance: { source: "ai_inferred" } as never })],
      ["unknown scope", caseInput(2, { target: { scope: "EVERYTHING" as never, caseId: "x" } })],
      ["CASE_TYPE carrying a snapshot", caseInput(2, { target: { scope: "CASE_TYPE", caseType: "TASK_DUE_DATE_PASSED" } })],
      ["self-supersession", caseInput(2, { supersedesId: uid(2) })],
      ["stale schemaVersion passed in", { ...caseInput(2), schemaVersion: "partner-feedback-schema-v0" } as AppendPartnerFeedbackInput],
      ["extra top-level key", { ...caseInput(2), applyNow: true } as AppendPartnerFeedbackInput],
    ];
    for (const [name, input] of cases) {
      const { db, store } = fresh();
      await expectStoreError(name, () => store.appendPartnerFeedback(input, { knownCaseTypes: KNOWN }), "VALIDATION_FAILED");
      ok(`   ${name}: zero DB calls`, db.log.length === 0 && db.rows.length === 0);
    }
  }

  // 3 ──
  console.log("3. FEEDBACK_SCHEMA_VERSION stamped by the store");
  {
    const { db, store } = fresh();
    const input = caseInput(3);
    ok("input carries no schemaVersion", !("schemaVersion" in input));
    const r = await store.appendPartnerFeedback(input, { knownCaseTypes: KNOWN });
    check("row.feedback_schema_version", db.rows[0].feedback_schema_version, FEEDBACK_SCHEMA_VERSION);
    check("record.schemaVersion", r.feedback.schemaVersion, FEEDBACK_SCHEMA_VERSION);
  }

  // 4 ──
  console.log("4. Provenance preserved");
  {
    const { db, store } = fresh();
    const r = await store.appendPartnerFeedback(caseInput(4), { knownCaseTypes: KNOWN });
    check("row.provenance", db.rows[0].provenance, { source: "owner_manual" });
    check("record.provenance", r.feedback.provenance, { source: "owner_manual" });
  }

  // 5 + 6 ──
  console.log("5/6. Compact case snapshot persisted; a full PartnerCase never is");
  {
    const { db, store } = fresh();
    const c = makeCase();
    const input = caseInput(5, {}, c);
    const r = await store.appendPartnerFeedback(input, { knownCaseTypes: KNOWN });
    const snap = db.rows[0].case_snapshot as Record<string, unknown>;
    check("stored snapshot keys = the 10 compact fields", Object.keys(snap).sort(), ["capturedAt", "caseId", "caseSchemaVersion", "caseType", "classification", "createdFrom", "evidenceFingerprint", "status", "subjectId", "subjectType"]);
    check("snapshot round-trips exactly", r.feedback.caseSnapshot, input.caseSnapshot);
    ok("no facts / derivedFacts / hypotheses / summaryHe anywhere in the stored row", !/"facts"|"derivedFacts"|"hypotheses"|"summaryHe"|"dataQuality"/.test(JSON.stringify(db.rows[0])));

    const { db: db2, store: store2 } = fresh();
    const full = { ...c, capturedAt: input.createdAt, caseSchemaVersion: c.schemaVersion, evidenceFingerprint: "x", caseId: c.id };
    await expectStoreError("full PartnerCase passed as caseSnapshot", () => store2.appendPartnerFeedback(caseInput(6, { caseSnapshot: full as never }), { knownCaseTypes: KNOWN }), "VALIDATION_FAILED");
    ok("   …and nothing reached the DB", db2.log.length === 0);
  }

  // 7 ──
  console.log("7. Valid revision insert succeeds (append-only)");
  {
    const { db, store } = fresh();
    await store.appendPartnerFeedback(caseInput(1), { knownCaseTypes: KNOWN });
    const before = JSON.stringify(db.rows[0]);
    const r = await store.appendPartnerFeedback(caseInput(2, { supersedesId: uid(1), dimensions: dims({ accuracy: "CORRECT", importance: "IMPORTANT" }) }), { knownCaseTypes: KNOWN });
    check("two rows now", db.rows.length, 2);
    check("revision points at prior", r.feedback.supersedesId, uid(1));
    ok("prior row is byte-identical (never updated)", JSON.stringify(db.rows[0]) === before);
    const r3 = await store.appendPartnerFeedback(caseInput(3, { supersedesId: uid(2), dimensions: dims({ accuracy: "INCORRECT" }) }), { knownCaseTypes: KNOWN });
    check("revision of the revision (chain of 3)", r3.feedback.supersedesId, uid(2));
  }

  // 8 ──
  console.log("8. Revision target mismatch rejected");
  {
    const { db, store } = fresh();
    await store.appendPartnerFeedback(caseInput(1), { knownCaseTypes: KNOWN });
    const other = makeCase({ id: "task_due_date_passed:t2", subjectId: "t2" });
    await expectStoreError("revision about a different case", () => store.appendPartnerFeedback(caseInput(2, { supersedesId: uid(1) }, other), { knownCaseTypes: KNOWN }), "REVISION_TARGET_MISMATCH");
    await expectStoreError("revision that changes scope (CASE_INSTANCE → CASE_TYPE)", () => store.appendPartnerFeedback(caseInput(3, { supersedesId: uid(1), target: { scope: "CASE_TYPE", caseType: "TASK_DUE_DATE_PASSED" }, caseSnapshot: null }), { knownCaseTypes: KNOWN }), "REVISION_TARGET_MISMATCH");
    await store.appendPartnerFeedback({ ...caseInput(10), target: { scope: "SUBJECT", subjectType: "project", subjectId: "p1" }, caseSnapshot: null }, { knownCaseTypes: KNOWN });
    await expectStoreError("SUBJECT revision about another project", () => store.appendPartnerFeedback({ ...caseInput(11), target: { scope: "SUBJECT", subjectType: "project", subjectId: "p2" }, caseSnapshot: null, supersedesId: uid(10) }, { knownCaseTypes: KNOWN }), "REVISION_TARGET_MISMATCH");
    await expectStoreError("supersedesId that does not exist", () => store.appendPartnerFeedback(caseInput(12, { supersedesId: uid(999) }), { knownCaseTypes: KNOWN }), "SUPERSEDED_NOT_FOUND");
    check("only the 2 valid rows exist", db.rows.length, 2);
  }

  // 9 ──
  console.log("9. Branch revision rejected (pre-check AND DB unique index)");
  {
    const { db, store } = fresh();
    await store.appendPartnerFeedback(caseInput(1), { knownCaseTypes: KNOWN });
    await store.appendPartnerFeedback(caseInput(2, { supersedesId: uid(1) }), { knownCaseTypes: KNOWN });
    await expectStoreError("second successor of the same row (application pre-check)", () => store.appendPartnerFeedback(caseInput(3, { supersedesId: uid(1) }), { knownCaseTypes: KNOWN }), "REVISION_BRANCH_CONFLICT");
    db.opts.hideSuccessorPrecheck = true; // simulate losing a race: pre-check sees nothing, DB unique index fires
    const e = await expectStoreError("race: DB partial UNIQUE violation surfaced, not swallowed", () => store.appendPartnerFeedback(caseInput(4, { supersedesId: uid(1) }), { knownCaseTypes: KNOWN }), "REVISION_BRANCH_CONFLICT");
    ok("   DB detail preserved in error.details", !!e && e.details.some((d) => d.includes("23505")));
    check("still exactly 2 rows", db.rows.length, 2);
    db.opts.hideSuccessorPrecheck = false;
    await expectStoreError("duplicate primary key", () => store.appendPartnerFeedback(caseInput(1), { knownCaseTypes: KNOWN }), "DUPLICATE_FEEDBACK_ID");
  }

  // 10 ──
  console.log("10. Unsupported / invalid stored rows rejected on read (fail-closed)");
  {
    const { db, store } = fresh();
    await store.appendPartnerFeedback(caseInput(1), { knownCaseTypes: KNOWN });
    db.seedRaw({ ...db.rows[0], id: uid(50), feedback_schema_version: "partner-feedback-schema-v2" });
    const r = await store.listPartnerFeedback();
    check("status", r.status, "INVALID_STORED_ROWS");
    if (r.status === "INVALID_STORED_ROWS") {
      check("rejected row + code", r.rejected.map((x) => [x.id, x.code]), [[uid(50), "UNSUPPORTED_FEEDBACK_SCHEMA"]]);
    }
    ok("mapFeedbackRow: v2 row never parsed as v1", !mapFeedbackRow({ ...db.rows[0], feedback_schema_version: "partner-feedback-schema-v2" }).ok);
    const bad = mapFeedbackRow({ ...db.rows[0], dimensions: { ...(db.rows[0].dimensions as object), accuracy: "SORT_OF" } });
    check("bad jsonb dimensions → INVALID_STORED_ROW", bad.ok ? "ok" : bad.code, "INVALID_STORED_ROW");
    const bad2 = mapFeedbackRow({ ...db.rows[0], provenance: { source: "llm" } });
    check("bad provenance → INVALID_STORED_ROW", bad2.ok ? "ok" : bad2.code, "INVALID_STORED_ROW");
    const bad3 = mapFeedbackRow({ ...db.rows[0], case_snapshot: { ...(db.rows[0].case_snapshot as object), facts: [] } });
    check("snapshot with extra keys → INVALID_STORED_ROW", bad3.ok ? "ok" : bad3.code, "INVALID_STORED_ROW");
    const { db: dbS, store: storeS } = fresh();
    await storeS.appendPartnerFeedback(caseInput(1), { knownCaseTypes: KNOWN });
    dbS.seedRaw({ ...dbS.rows[0], id: uid(51), feedback_schema_version: "partner-feedback-schema-v2", supersedes_id: null });
    await expectStoreError("revising an unsupported-schema row", () => storeS.appendPartnerFeedback(caseInput(2, { supersedesId: uid(51) }), { knownCaseTypes: KNOWN }), "UNSUPPORTED_FEEDBACK_SCHEMA");
  }

  // 11 ──
  console.log("11. Read DB failure ≠ empty history");
  {
    const { store } = fresh();
    check("empty table → NO_FEEDBACK", (await store.listPartnerFeedback()).status, "NO_FEEDBACK");
    const { store: s2 } = fresh({ failSelect: true });
    const r = await s2.listPartnerFeedback();
    check("DB error → READ_FAILED", r.status, "READ_FAILED");
    ok("   READ_FAILED carries no feedback array", !("feedback" in r));
    check("getFeedbackForCase on DB error → READ_FAILED", (await s2.getFeedbackForCase("x")).status, "READ_FAILED");
    check("resolveCurrentFeedbackRevision on DB error → READ_FAILED", (await s2.resolveCurrentFeedbackRevision()).status, "READ_FAILED");
    const { store: s3 } = fresh({ throwOnSelect: true });
    const r3 = await s3.listPartnerFeedback();
    check("network throw → READ_FAILED", r3.status, "READ_FAILED");
    ok("   secrets redacted from the error message", r3.status === "READ_FAILED" && !/sb_secret_zzz/.test(r3.error.message) && /redacted/.test(r3.error.message));
    const { db: dbW, store: sW } = fresh({ failInsert: true });
    const e = await expectStoreError("insert failure is thrown, never silent", () => sW.appendPartnerFeedback(caseInput(1), { knownCaseTypes: KNOWN }), "WRITE_FAILED");
    const allText = e ? [e.message, ...e.details].join(" ") : "";
    ok("   write error exposes no JWT / secret key", !/eyJhbGci|sb_secret_ABC/.test(allText) && /redacted/.test(allText));
    check("   nothing stored", dbW.rows.length, 0);
    await expectStoreError("empty caseId is an INVALID_QUERY, not an empty result", () => fresh().store.getFeedbackForCase(""), "INVALID_QUERY");
  }

  // 12 ──
  console.log("12. Deterministic ordering: created_at ASC, then id ASC");
  {
    const { db, store } = fresh();
    // Insert out of order; two rows share a created_at.
    await store.appendPartnerFeedback(caseInput(30, { createdAt: "2026-09-23T12:00:00.000Z" }, makeCase({ id: "task_due_date_passed:a", subjectId: "a" })), { knownCaseTypes: KNOWN });
    await store.appendPartnerFeedback(caseInput(20, { createdAt: "2026-09-23T11:00:00.000Z" }, makeCase({ id: "task_due_date_passed:b", subjectId: "b" })), { knownCaseTypes: KNOWN });
    await store.appendPartnerFeedback(caseInput(10, { createdAt: "2026-09-23T12:00:00.000Z" }, makeCase({ id: "task_due_date_passed:c", subjectId: "c" })), { knownCaseTypes: KNOWN });
    const r = await store.listPartnerFeedback();
    check("order", r.status === "OK" ? r.feedback.map((f) => f.id) : r.status, [uid(20), uid(10), uid(30)]);
    db.rows.reverse();
    const r2 = await store.listPartnerFeedback();
    check("same order regardless of physical row order", r2.status === "OK" ? r2.feedback.map((f) => f.id) : r2.status, [uid(20), uid(10), uid(30)]);
    ok("SQL ordering requested (created_at, id)", db.log.join(",").includes("order,order,range"));

    const { db: dbP, store: storeP } = fresh();
    const { db: dbT, store: storeT } = fresh();
    await storeT.appendPartnerFeedback(caseInput(1), { knownCaseTypes: KNOWN });
    for (let i = 0; i < PAGE_SIZE + 5; i++) dbP.seedRaw({ ...dbT.rows[0], id: uid(100000 + i), case_id: `task_due_date_passed:p${i}`, case_snapshot: { ...(dbT.rows[0].case_snapshot as object), caseId: `task_due_date_passed:p${i}` } });
    const rp = await storeP.listPartnerFeedback();
    check(`paging: ${PAGE_SIZE + 5} rows all returned (no silent max-rows truncation)`, rp.status === "OK" ? rp.feedback.length : rp.status, PAGE_SIZE + 5);
  }

  // 13–16 ──
  console.log("13-16. get by case / subject / case type, resolve current revision");
  {
    const { store } = fresh();
    const c1 = makeCase();
    const c2 = makeCase({ id: "project_deadline_passed:p1", caseType: "PROJECT_DEADLINE_PASSED", subjectType: "project", subjectId: "p1" });
    await store.appendPartnerFeedback(caseInput(1, {}, c1), { knownCaseTypes: KNOWN });
    await store.appendPartnerFeedback(caseInput(2, { supersedesId: uid(1), dimensions: dims({ accuracy: "INCORRECT" }) }, c1), { knownCaseTypes: KNOWN });
    await store.appendPartnerFeedback(caseInput(3, {}, c2), { knownCaseTypes: KNOWN });
    await store.appendPartnerFeedback({ ...caseInput(4), target: { scope: "SUBJECT", subjectType: "project", subjectId: "p1" }, caseSnapshot: null }, { knownCaseTypes: KNOWN });
    await store.appendPartnerFeedback({ ...caseInput(5), target: { scope: "SUBJECT", subjectType: "project", subjectId: "p10" }, caseSnapshot: null }, { knownCaseTypes: KNOWN });
    await store.appendPartnerFeedback({ ...caseInput(6), target: { scope: "SUBJECT", subjectType: "task", subjectId: "p1" }, caseSnapshot: null }, { knownCaseTypes: KNOWN });
    await store.appendPartnerFeedback({ ...caseInput(7), target: { scope: "CASE_TYPE", caseType: "TASK_DUE_DATE_PASSED" }, caseSnapshot: null }, { knownCaseTypes: KNOWN });

    const byCase = await store.getFeedbackForCase(c1.id);
    check("13. getFeedbackForCase returns FULL history (superseded row included)", byCase.status === "OK" ? byCase.feedback.map((f) => f.id) : byCase.status, [uid(1), uid(2)]);
    check("13. unknown case → NO_FEEDBACK", (await store.getFeedbackForCase("nope:1")).status, "NO_FEEDBACK");

    const bySubj = await store.getFeedbackForSubject("project", "p1");
    check("14. getFeedbackForSubject exact (not p10, not task/p1)", bySubj.status === "OK" ? bySubj.feedback.map((f) => f.id) : bySubj.status, [uid(4)]);
    check("14. prefix never matches", (await store.getFeedbackForSubject("project", "p")).status, "NO_FEEDBACK");

    const byType = await store.getFeedbackForCaseType("TASK_DUE_DATE_PASSED");
    check("15. getFeedbackForCaseType returns all historical rows of that type", byType.status === "OK" ? byType.feedback.map((f) => f.id) : byType.status, [uid(1), uid(2), uid(7)]);

    const cur = await store.resolveCurrentFeedbackRevision({ caseId: c1.id });
    check("16. current for case = terminal row only", cur.status === "OK" ? cur.feedback.map((f) => f.id) : cur.status, [uid(2)]);
    const curType = await store.resolveCurrentFeedbackRevision({ caseType: "TASK_DUE_DATE_PASSED" });
    check("16. current for case type", curType.status === "OK" ? curType.feedback.map((f) => f.id) : curType.status, [uid(2), uid(7)]);
    const curAll = await store.resolveCurrentFeedbackRevision();
    check("16. current overall excludes superseded", curAll.status === "OK" ? curAll.feedback.map((f) => f.id) : curAll.status, [uid(2), uid(3), uid(4), uid(5), uid(6), uid(7)]);
    check("16. subject filter on current", (await store.resolveCurrentFeedbackRevision({ subjectType: "project", subjectId: "nope" })).status, "NO_FEEDBACK");

    // Learning layer stays compatible with persisted records — computed on demand, never applied.
    if (curAll.status === "OK") {
      const summary = summarizePartnerFeedback(curAll.feedback);
      const signals = deriveLearningSignals(curAll.feedback);
      const proposals = buildLearningProposals(signals);
      ok("27. summarize/deriveLearningSignals/buildLearningProposals accept persisted records", summary.length > 0 && signals.length > 0 && Array.isArray(proposals));
      ok("27. every proposal stays PROPOSED", proposals.every((p) => p.status === "PROPOSED"));
    }
  }

  console.log("16b. Invalid revision graph → diagnostics, never a guess");
  {
    const { db, store } = fresh();
    await store.appendPartnerFeedback(caseInput(1), { knownCaseTypes: KNOWN });
    await store.appendPartnerFeedback(caseInput(2, { supersedesId: uid(1) }), { knownCaseTypes: KNOWN });
    db.seedRaw({ ...db.rows[1], id: uid(3) }); // a branch that bypassed the DB index (e.g. manual SQL)
    const r = await store.resolveCurrentFeedbackRevision({ caseId: "task_due_date_passed:t1" });
    check("status", r.status, "INVALID_REVISION_GRAPH");
    if (r.status === "INVALID_REVISION_GRAPH") check("BRANCH diagnostic", r.diagnostics.map((d) => d.kind), ["BRANCH"]);
    const hist = await store.getFeedbackForCase("task_due_date_passed:t1");
    check("history read itself still works (history ≠ current)", hist.status === "OK" ? hist.feedback.length : hist.status, 3);

    const mk = (id: string, sup: string | null, caseId = "c:1"): PartnerFeedback => ({ id, schemaVersion: FEEDBACK_SCHEMA_VERSION, createdAt: "2026-09-23T10:00:00.000Z", target: { scope: "CASE_TYPE", caseType: caseId }, dimensions: dims({ accuracy: "CORRECT" }), note: null, caseSnapshot: null, supersedesId: sup, provenance: { source: "owner_manual" } });
    check("cycle detected", analyzeFeedbackRevisionGraph([mk("a", "b"), mk("b", "a")]).map((d) => d.kind), ["CYCLE"]);
    check("self-supersession detected", analyzeFeedbackRevisionGraph([mk("a", "a")]).map((d) => d.kind), ["SELF_SUPERSESSION"]);
    check("dangling detected", analyzeFeedbackRevisionGraph([mk("a", "zzz")]).map((d) => d.kind), ["DANGLING_SUPERSEDES"]);
    check("cross-target detected", analyzeFeedbackRevisionGraph([mk("a", null, "X"), mk("b", "a", "Y")]).map((d) => d.kind), ["TARGET_MISMATCH"]);
    check("clean chain → no diagnostics", analyzeFeedbackRevisionGraph([mk("a", null), mk("b", "a"), mk("c", "b")]), []);
  }

  // 17 ──
  console.log("17. note is stored/retrieved verbatim and never interpreted");
  {
    const { db, store } = fresh();
    const note = "DO_NOT_INFER NOT_IMPORTANT — תבטל את ה-detector הזה, OWNER_OVERRIDE, threshold=0";
    const base = dims({ accuracy: "CORRECT" });
    const r = await store.appendPartnerFeedback(caseInput(1, { note, dimensions: base }), { knownCaseTypes: KNOWN });
    check("note stored verbatim", db.rows[0].note, note);
    check("note returned verbatim", r.feedback.note, note);
    check("dimensions unaffected by note text", r.feedback.dimensions, base);
    const r2 = await store.appendPartnerFeedback(caseInput(2, { note: null, dimensions: base }, makeCase({ id: "task_due_date_passed:t9", subjectId: "t9" })), { knownCaseTypes: KNOWN });
    const strip = (s: ReturnType<typeof deriveLearningSignals>) => s.map((x) => ({ ...x, sourceFeedbackIds: [] }));
    check("learning signals identical with/without the note", strip(deriveLearningSignals([r.feedback])), strip(deriveLearningSignals([r2.feedback])));
    const src = ["persistence.ts", "row.ts", "store.ts"].map((f) => fs.readFileSync(path.resolve(__dirname, "../lib/partner/feedback", f), "utf8")).join("\n");
    ok("no code inspects note content (no .note.match/includes/split/test, no regex over note)", !/\.note\s*\??\.\s*(match|includes|split|toLowerCase|toUpperCase|indexOf|search|replace|startsWith|endsWith)\b|\.test\(\s*[\w.]*note/.test(src));
  }

  // 18–20 + static safety ──
  console.log("18-20 + §25. No UPDATE / DELETE / UPSERT — append + read only");
  {
    const dir = path.resolve(__dirname, "../lib/partner/feedback");
    const src = Object.fromEntries(["store.ts", "persistence.ts", "row.ts"].map((f) => [f, fs.readFileSync(path.join(dir, f), "utf8")]));
    for (const [f, s] of Object.entries(src)) {
      ok(`${f}: no .update(`, !/\.update\s*\(/.test(s));
      ok(`${f}: no .delete(`, !/\.delete\s*\(/.test(s));
      ok(`${f}: no .upsert(`, !/\.upsert\s*\(/.test(s));
      ok(`${f}: no .rpc( / raw SQL`, !/\.rpc\s*\(|\b(ALTER|DROP|TRUNCATE)\s+TABLE\b|\bCREATE\s+(TABLE|INDEX|POLICY)\b/i.test(s));
    }
    ok("store.ts exports no update/delete/upsert/replace/mutate function", !/export\s+(const|function|async function)\s+\w*(update|delete|upsert|replace|mutate)\w*/i.test(src["store.ts"]));
    const exported = [...src["store.ts"].matchAll(/export const (\w+)/g)].map((m) => m[1]).sort();
    check("store.ts exported functions (exact)", exported, ["appendPartnerFeedback", "getFeedbackForCase", "getFeedbackForCaseType", "getFeedbackForSubject", "listPartnerFeedback", "resolveCurrentFeedbackRevision"]);
    check("createPartnerFeedbackStore surface (exact)", Object.keys(fresh().store).sort(), ["appendPartnerFeedback", "getFeedbackForCase", "getFeedbackForCaseType", "getFeedbackForSubject", "listPartnerFeedback", "resolveCurrentFeedbackRevision"]);
    ok("injected client type exposes only select + insert", /from\(table[^)]*\): \{\s*select\(columns: string\): FeedbackSelectQuery;\s*insert\(/.test(src["persistence.ts"]) && !WRITE_VERBS.test(src["persistence.ts"].match(/export interface FeedbackTableClient \{[\s\S]*?\n\}/)?.[0] ?? "update"));

    // Dynamic: a full workout of the store only ever issued select/insert chains.
    const { db, store } = fresh();
    await store.appendPartnerFeedback(caseInput(1), { knownCaseTypes: KNOWN });
    await store.appendPartnerFeedback(caseInput(2, { supersedesId: uid(1) }), { knownCaseTypes: KNOWN });
    await store.listPartnerFeedback(); await store.getFeedbackForCase("x"); await store.getFeedbackForSubject("a", "b");
    await store.getFeedbackForCaseType("T"); await store.resolveCurrentFeedbackRevision();
    const verbs = [...new Set(db.log.map((l) => l.split(":")[0]))].sort();
    check("every DB verb issued", verbs, ["eq", "from", "insert", "insert.select", "maybeSingle", "order", "range", "select", "single"]);
    check("§29/§34: only table ever touched is partner_feedback (never settings/partner_change_baseline/agent_alerts)", [...db.tables], ["partner_feedback"]);
  }

  console.log("§20/§21/§28-§36. Security + isolation (static)");
  {
    const dir = path.resolve(__dirname, "../lib/partner/feedback");
    const files = fs.readdirSync(dir);
    const src = Object.fromEntries(files.map((f) => [f, fs.readFileSync(path.join(dir, f), "utf8")]));
    ok("store.ts imports \"server-only\"", /^\s*import\s+"server-only"\s*;/m.test(src["store.ts"]));
    ok("store.ts uses the existing server-side service-role client (@/lib/supabase)", /from "@\/lib\/supabase"/.test(src["store.ts"]));
    check("only store.ts imports a Supabase client", files.filter((f) => /lib\/supabase|@supabase\//.test(src[f])).sort(), ["store.ts"]);
    ok("no browser client import anywhere (supabase-browser / NEXT_PUBLIC_)", Object.values(src).every((s) => !/supabase-browser|NEXT_PUBLIC_/.test(s)));
    ok("persistence.ts / row.ts do not import server-only (testable core)", ["persistence.ts", "row.ts"].every((f) => !/^\s*import\s+"server-only"\s*;/m.test(src[f])));
    ok("index.ts does not re-export store.ts (pure entrypoint stays client-safe)", !/\.\/store/.test(src["index.ts"]));
    ok("no Agent Alerts / Push / Cron / Mai / LLM import", Object.values(src).every((s) => !/agent_alerts|alerts-store|lib\/push|web-push|node-cron|from "openai"|lib\/mai|\bmai-/.test(s)));
    ok("no Case Engine / Charter / baseline mutation import", Object.values(src).every((s) => !/partner\/baseline|from "\.\.\/charter"|cases\/(build|detectors)/.test(s)));
    ok("no settings table / partner_change_baseline reference", Object.values(src).every((s) => !/from\(\s*["']settings["']|partner_change_baseline/.test(s)));

    const ROOT = path.resolve(__dirname, "..");
    const walk = (d: string): string[] => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.name === "node_modules" || e.name.startsWith(".") ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]) : [];
    const appFiles = [...walk(path.join(ROOT, "app")), ...walk(path.join(ROOT, "components")), ...walk(path.join(ROOT, "lib"))].filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes(`${path.sep}partner${path.sep}feedback${path.sep}`));
    const importers = appFiles.filter((f) => /partner\/feedback\/(store|persistence)/.test(fs.readFileSync(f, "utf8")));
    check("§21/§32: nothing in app/ components/ lib/ imports the store yet (no API route, no UI)", importers.map((f) => path.relative(ROOT, f)), []);
    ok("no /api/partner/feedback route exists", !fs.existsSync(path.join(ROOT, "app", "api", "partner", "feedback")));
  }

  console.log("redactSecrets");
  check("jwt/key/bearer redacted", redactSecrets("x eyJa.eyJb.c sb_secret_abc Bearer tok"), "x [redacted-jwt] [redacted-key] Bearer [redacted]");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
