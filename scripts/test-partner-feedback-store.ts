/**
 * Store tests for Redbloods Partner — Structured Owner Feedback persistence
 * (Phase F.1B + F.1B hardening).
 *
 * Run with:   npx tsx scripts/test-partner-feedback-store.ts
 *
 * NEVER touches production: every write-path test drives the real
 * persistence core (lib/partner/feedback/persistence.ts) against an
 * in-memory fake that mimics PostgREST + the verified partner_feedback
 * table: id DEFAULT gen_random_uuid(), created_at DEFAULT now(), PK,
 * self-FK on supersedes_id, partial UNIQUE on supersedes_id, target_scope
 * CHECK, jsonb round-trip, "+00:00" timestamps, range paging. store.ts itself
 * is only inspected statically (it imports "server-only" + the real
 * service-role client).
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
import { PARTNER_FEEDBACK_COLUMNS, mapFeedbackRow, type PartnerFeedbackInsertRow } from "../lib/partner/feedback/row";

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

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const DB_CLOCK_START = Date.parse("2026-09-23T10:00:00.000Z");

class FakeFeedbackDb {
  rows: Row[] = [];
  log: string[] = [];
  tables = new Set<string>();
  insertPayloads: Row[] = [];
  opts: FakeOptions = {};
  /** DB clock (now()): advances 1s per INSERT unless frozen. */
  clockMs = DB_CLOCK_START;
  freezeClock = false;
  /** DB id sequence (gen_random_uuid() stand-in); forceNextIds lets a test pick the DB's next ids. */
  private idSeq = 0;
  forceNextIds: string[] = [];

  seedRaw(row: Row) { this.rows.push(JSON.parse(JSON.stringify(row))); }

  private insertRow(row: PartnerFeedbackInsertRow): FeedbackDbResponse<unknown> {
    this.insertPayloads.push(JSON.parse(JSON.stringify(row)));
    if (this.opts.failInsert) return { data: null, error: { code: "08006", message: "connection failure apikey=eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sig sb_secret_ABCdef123" } };
    // Column DEFAULTs — only applied when the INSERT omits the column (as PostgREST does).
    const id = "id" in row ? (row as Row).id : (this.forceNextIds.shift() ?? uid(++this.idSeq));
    if (!this.freezeClock && this.rows.length) this.clockMs += 1000;
    const createdAt = "created_at" in row ? (row as Row).created_at : new Date(this.clockMs).toISOString().replace("Z", "123+00:00");
    const full: Row = { ...(row as unknown as Row), id, created_at: createdAt };
    if (this.rows.some((r) => r.id === id)) return { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "partner_feedback_pkey"' } };
    if (!["CASE_INSTANCE", "CASE_TYPE", "SUBJECT", "RULE_APPLICATION", "HYPOTHESIS", "THRESHOLD_PROPOSAL"].includes(row.target_scope)) return { data: null, error: { code: "23514", message: "violates check constraint" } };
    if (row.supersedes_id !== null && !this.rows.some((r) => r.id === row.supersedes_id)) return { data: null, error: { code: "23503", message: "violates foreign key constraint" } };
    if (row.supersedes_id !== null && this.rows.some((r) => r.supersedes_id === row.supersedes_id)) {
      return { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "partner_feedback_supersedes_unique_idx"', details: `Key (supersedes_id)=(${row.supersedes_id}) already exists.` } };
    }
    const stored = JSON.parse(JSON.stringify(full)) as Row;
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
/** A caller-side clock deliberately far from the DB clock — proves nothing persisted depends on it. */
const CALLER_CLOCK = "2031-01-01T00:00:00.000Z";

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
const projectCase = (pid: string) => makeCase({ id: `project_deadline_passed:${pid}`, caseType: "PROJECT_DEADLINE_PASSED", subjectType: "project", subjectId: pid });

function dims(patch: Partial<PartnerFeedbackDimensions> = {}): PartnerFeedbackDimensions {
  return { ...emptyFeedbackDimensions(), ...patch };
}

/** A CASE_INSTANCE draft for Case `c` — target carries Case + subject identity copied from the Case (as the future UI must). */
function caseDraft(c: PartnerCase = makeCase(), patch: Partial<AppendPartnerFeedbackInput> = {}): AppendPartnerFeedbackInput {
  return {
    target: { scope: "CASE_INSTANCE", caseId: c.id, caseType: c.caseType, subjectType: c.subjectType, subjectId: c.subjectId },
    dimensions: dims({ accuracy: "CORRECT", importance: "NOT_IMPORTANT" }),
    note: null, caseSnapshot: buildCaseFeedbackSnapshot(c, CALLER_CLOCK), supersedesId: null,
    provenance: { source: "owner_manual" },
    ...patch,
  };
}
function hypothesisDraft(c: PartnerCase = makeCase(), patch: Partial<AppendPartnerFeedbackInput> = {}): AppendPartnerFeedbackInput {
  return caseDraft(c, {
    target: { scope: "HYPOTHESIS", caseId: c.id, caseType: c.caseType, subjectType: c.subjectType, subjectId: c.subjectId, hypothesisId: "h1" },
    dimensions: dims({ inference: { value: "DO_NOT_INFER", hypothesisId: "h1" } }),
    ...patch,
  });
}
function subjectDraft(subjectType: string, subjectId: string, patch: Partial<AppendPartnerFeedbackInput> = {}): AppendPartnerFeedbackInput {
  return { ...caseDraft(), target: { scope: "SUBJECT", subjectType, subjectId }, caseSnapshot: null, dimensions: dims({ context: { value: "HAS_MISSING_CONTEXT", contextCode: "FRIEND_CLIENT" } }), ...patch };
}
function caseTypeDraft(caseType: string): AppendPartnerFeedbackInput {
  return { ...caseDraft(), target: { scope: "CASE_TYPE", caseType }, caseSnapshot: null };
}

function fresh(opts: FakeOptions = {}) {
  const db = new FakeFeedbackDb();
  db.opts = opts;
  return { db, store: createPartnerFeedbackStore(db.client()) };
}
const O = { knownCaseTypes: KNOWN };
const ids = (r: { status: string; feedback?: PartnerFeedback[] }) => r.status === "OK" && r.feedback ? r.feedback.map((f) => f.id) : r.status;

const WRITE_VERBS = /\b(update|delete|upsert|rpc)\b/;

async function main() {
  // 1 ──
  console.log("1. Valid feedback inserts");
  {
    const { db, store } = fresh();
    const r = await store.appendPartnerFeedback(caseDraft(), O);
    check("one row stored", db.rows.length, 1);
    check("dimensions round-trip", r.feedback.dimensions, dims({ accuracy: "CORRECT", importance: "NOT_IMPORTANT" }));
    check("no warnings for a known caseType", r.warnings, []);
    const row = db.rows[0];
    check("DB row uses snake_case columns (explicit mapping)", Object.keys(row).sort(), PARTNER_FEEDBACK_COLUMNS.split(",").sort());
    check("target columns mapped", [row.target_scope, row.case_id, row.case_type, row.subject_type, row.subject_id], ["CASE_INSTANCE", "task_due_date_passed:t1", "TASK_DUE_DATE_PASSED", "task", "t1"]);
    ok("domain record exposes no snake_case keys", Object.keys(r.feedback).every((k) => !k.includes("_")));
  }

  // 2 ──
  console.log("2. Invalid feedback rejected BEFORE any DB call");
  {
    const c = makeCase();
    const cases: Array<[string, AppendPartnerFeedbackInput]> = [
      ["no signal at all", caseDraft(c, { dimensions: dims() })],
      ["CASE_INSTANCE without snapshot", caseDraft(c, { caseSnapshot: null })],
      ["DO_NOT_INFER without hypothesisId", caseDraft(c, { dimensions: dims({ inference: { value: "DO_NOT_INFER", hypothesisId: null } }) })],
      ["unknown accuracy enum", caseDraft(c, { dimensions: { ...dims(), accuracy: "MAYBE" as never } })],
      ["unknown dimension key", caseDraft(c, { dimensions: { ...dims({ accuracy: "CORRECT" }), mood: "x" } as never })],
      ["unknown provenance source", caseDraft(c, { provenance: { source: "ai_inferred" } as never })],
      ["unknown scope", caseDraft(c, { target: { scope: "EVERYTHING" as never, caseId: "x" } })],
      ["CASE_TYPE carrying a snapshot", caseDraft(c, { target: { scope: "CASE_TYPE", caseType: "TASK_DUE_DATE_PASSED" } })],
      ["uppercase supersedesId (never silently lower-cased)", caseDraft(c, { supersedesId: "ABCDEF00-0000-4000-8000-000000000002" })],
      ["schemaVersion passed in", { ...caseDraft(c), schemaVersion: FEEDBACK_SCHEMA_VERSION } as AppendPartnerFeedbackInput],
      ["extra top-level key", { ...caseDraft(c), applyNow: true } as AppendPartnerFeedbackInput],
    ];
    for (const [name, input] of cases) {
      const { db, store } = fresh();
      await expectStoreError(name, () => store.appendPartnerFeedback(input, O), "VALIDATION_FAILED");
      ok(`   ${name}: zero DB calls`, db.log.length === 0 && db.rows.length === 0);
    }
  }

  // 3 + 4 ──
  console.log("3/4. FEEDBACK_SCHEMA_VERSION stamped by the store; provenance preserved");
  {
    const { db, store } = fresh();
    const input = caseDraft();
    ok("draft carries no schemaVersion", !("schemaVersion" in input));
    const r = await store.appendPartnerFeedback(input, O);
    check("row.feedback_schema_version", db.rows[0].feedback_schema_version, FEEDBACK_SCHEMA_VERSION);
    check("record.schemaVersion", r.feedback.schemaVersion, FEEDBACK_SCHEMA_VERSION);
    check("row.provenance", db.rows[0].provenance, { source: "owner_manual" });
    check("record.provenance", r.feedback.provenance, { source: "owner_manual" });
  }

  // 5 + 6 ──
  console.log("5/6. Compact case snapshot persisted; a full PartnerCase never is");
  {
    const { db, store } = fresh();
    const c = makeCase();
    const input = caseDraft(c);
    const r = await store.appendPartnerFeedback(input, O);
    const snap = db.rows[0].case_snapshot as Record<string, unknown>;
    check("stored snapshot keys = the 10 compact fields", Object.keys(snap).sort(), ["capturedAt", "caseId", "caseSchemaVersion", "caseType", "classification", "createdFrom", "evidenceFingerprint", "status", "subjectId", "subjectType"]);
    check("snapshot round-trips exactly", r.feedback.caseSnapshot, input.caseSnapshot);
    ok("no facts / derivedFacts / hypotheses / summaryHe anywhere in the stored row", !/"facts"|"derivedFacts"|"hypotheses"|"summaryHe"|"dataQuality"/.test(JSON.stringify(db.rows[0])));
    const { db: db2, store: store2 } = fresh();
    const full = { ...c, capturedAt: CALLER_CLOCK, caseSchemaVersion: c.schemaVersion, evidenceFingerprint: "x", caseId: c.id };
    await expectStoreError("full PartnerCase passed as caseSnapshot", () => store2.appendPartnerFeedback(caseDraft(c, { caseSnapshot: full as never }), O), "VALIDATION_FAILED");
    ok("   …and nothing reached the DB", db2.log.length === 0);
  }

  // 7 ──
  console.log("7. Valid revision insert succeeds (append-only)");
  {
    const { db, store } = fresh();
    const a = await store.appendPartnerFeedback(caseDraft(), O);
    const before = JSON.stringify(db.rows[0]);
    const b = await store.appendPartnerFeedback(caseDraft(makeCase(), { supersedesId: a.feedback.id, dimensions: dims({ accuracy: "CORRECT", importance: "IMPORTANT" }) }), O);
    check("two rows now", db.rows.length, 2);
    check("revision points at the prior's DB-assigned id", b.feedback.supersedesId, a.feedback.id);
    ok("prior row is byte-identical (never updated)", JSON.stringify(db.rows[0]) === before);
    const c3 = await store.appendPartnerFeedback(caseDraft(makeCase(), { supersedesId: b.feedback.id, dimensions: dims({ accuracy: "INCORRECT" }) }), O);
    check("revision of the revision (chain of 3)", c3.feedback.supersedesId, b.feedback.id);
  }

  // 8 ──
  console.log("8. Revision target mismatch rejected");
  {
    const { db, store } = fresh();
    const a = await store.appendPartnerFeedback(caseDraft(), O);
    const other = makeCase({ id: "task_due_date_passed:t2", subjectId: "t2" });
    await expectStoreError("revision about a different case", () => store.appendPartnerFeedback(caseDraft(other, { supersedesId: a.feedback.id }), O), "REVISION_TARGET_MISMATCH");
    await expectStoreError("revision that changes scope (CASE_INSTANCE → CASE_TYPE)", () => store.appendPartnerFeedback({ ...caseTypeDraft("TASK_DUE_DATE_PASSED"), supersedesId: a.feedback.id }, O), "REVISION_TARGET_MISMATCH");
    const drift = makeCase({ subjectId: "t9" }); // same caseId, consistently different subject on target + snapshot
    await expectStoreError("revision whose subject drifts (same caseId, different subject)", () => store.appendPartnerFeedback(caseDraft(drift, { supersedesId: a.feedback.id }), O), "REVISION_TARGET_MISMATCH");
    const s = await store.appendPartnerFeedback(subjectDraft("project", "p1"), O);
    await expectStoreError("SUBJECT revision about another project", () => store.appendPartnerFeedback(subjectDraft("project", "p2", { supersedesId: s.feedback.id }), O), "REVISION_TARGET_MISMATCH");
    await expectStoreError("supersedesId that does not exist", () => store.appendPartnerFeedback(caseDraft(makeCase(), { supersedesId: uid(999) }), O), "SUPERSEDED_NOT_FOUND");
    check("only the 2 valid rows exist", db.rows.length, 2);
  }

  // 9 ──
  console.log("9. Branch revision rejected (pre-check AND DB unique index)");
  {
    const { db, store } = fresh();
    const a = await store.appendPartnerFeedback(caseDraft(), O);
    await store.appendPartnerFeedback(caseDraft(makeCase(), { supersedesId: a.feedback.id }), O);
    await expectStoreError("second successor of the same row (application pre-check)", () => store.appendPartnerFeedback(caseDraft(makeCase(), { supersedesId: a.feedback.id }), O), "REVISION_BRANCH_CONFLICT");
    db.opts.hideSuccessorPrecheck = true; // simulate losing a race: pre-check sees nothing, DB unique index fires
    const e = await expectStoreError("race: DB partial UNIQUE violation surfaced, not swallowed", () => store.appendPartnerFeedback(caseDraft(makeCase(), { supersedesId: a.feedback.id }), O), "REVISION_BRANCH_CONFLICT");
    ok("   DB detail preserved in error.details", !!e && e.details.some((d) => d.includes("23505")));
    check("still exactly 2 rows", db.rows.length, 2);
    db.opts.hideSuccessorPrecheck = false;
    db.forceNextIds = [a.feedback.id];
    await expectStoreError("DB-generated id collision surfaced", () => store.appendPartnerFeedback(caseDraft(makeCase({ id: "task_due_date_passed:t5", subjectId: "t5" })), O), "DUPLICATE_FEEDBACK_ID");
  }

  // 10 ──
  console.log("10. Unsupported / invalid stored rows rejected on read (fail-closed)");
  {
    const { db, store } = fresh();
    await store.appendPartnerFeedback(caseDraft(), O);
    db.seedRaw({ ...db.rows[0], id: uid(50), feedback_schema_version: "partner-feedback-schema-v2" });
    const r = await store.listPartnerFeedback();
    check("status", r.status, "INVALID_STORED_ROWS");
    if (r.status === "INVALID_STORED_ROWS") check("rejected row + code", r.rejected.map((x) => [x.id, x.code]), [[uid(50), "UNSUPPORTED_FEEDBACK_SCHEMA"]]);
    ok("mapFeedbackRow: v2 row never parsed as v1", !mapFeedbackRow({ ...db.rows[0], feedback_schema_version: "partner-feedback-schema-v2" }).ok);
    const bad = mapFeedbackRow({ ...db.rows[0], dimensions: { ...(db.rows[0].dimensions as object), accuracy: "SORT_OF" } });
    check("bad jsonb dimensions → INVALID_STORED_ROW", bad.ok ? "ok" : bad.code, "INVALID_STORED_ROW");
    const bad2 = mapFeedbackRow({ ...db.rows[0], provenance: { source: "llm" } });
    check("bad provenance → INVALID_STORED_ROW", bad2.ok ? "ok" : bad2.code, "INVALID_STORED_ROW");
    const bad3 = mapFeedbackRow({ ...db.rows[0], case_snapshot: { ...(db.rows[0].case_snapshot as object), facts: [] } });
    check("snapshot with extra keys → INVALID_STORED_ROW", bad3.ok ? "ok" : bad3.code, "INVALID_STORED_ROW");
    const bad4 = mapFeedbackRow({ ...db.rows[0], subject_id: "t2" });
    check("stored subject_id contradicting case_snapshot → INVALID_STORED_ROW", bad4.ok ? "ok" : bad4.code, "INVALID_STORED_ROW");
    const bad5 = mapFeedbackRow({ ...db.rows[0], subject_type: null, subject_id: null });
    check("stored CASE_INSTANCE row without subject columns → INVALID_STORED_ROW", bad5.ok ? "ok" : bad5.code, "INVALID_STORED_ROW");
    const { db: dbS, store: storeS } = fresh();
    await storeS.appendPartnerFeedback(caseDraft(), O);
    dbS.seedRaw({ ...dbS.rows[0], id: uid(51), feedback_schema_version: "partner-feedback-schema-v2", supersedes_id: null });
    await expectStoreError("revising an unsupported-schema row", () => storeS.appendPartnerFeedback(caseDraft(makeCase(), { supersedesId: uid(51) }), O), "UNSUPPORTED_FEEDBACK_SCHEMA");
  }

  // 11 ──
  console.log("11. Read DB failure ≠ empty history; write failure never silent");
  {
    const { store } = fresh();
    check("empty table → NO_FEEDBACK", (await store.listPartnerFeedback()).status, "NO_FEEDBACK");
    const { store: s2 } = fresh({ failSelect: true });
    const r = await s2.listPartnerFeedback();
    check("DB error → READ_FAILED", r.status, "READ_FAILED");
    ok("   READ_FAILED carries no feedback array", !("feedback" in r));
    check("getFeedbackForCase on DB error → READ_FAILED", (await s2.getFeedbackForCase("x")).status, "READ_FAILED");
    check("getFeedbackForSubject on DB error → READ_FAILED", (await s2.getFeedbackForSubject("project", "p1")).status, "READ_FAILED");
    check("resolveCurrentFeedbackRevision on DB error → READ_FAILED", (await s2.resolveCurrentFeedbackRevision()).status, "READ_FAILED");
    const { store: s3 } = fresh({ throwOnSelect: true });
    const r3 = await s3.listPartnerFeedback();
    check("network throw → READ_FAILED", r3.status, "READ_FAILED");
    ok("   secrets redacted from the error message", r3.status === "READ_FAILED" && !/sb_secret_zzz/.test(r3.error.message) && /redacted/.test(r3.error.message));
    const { db: dbW, store: sW } = fresh({ failInsert: true });
    const e = await expectStoreError("insert failure is thrown, never silent", () => sW.appendPartnerFeedback(caseDraft(), O), "WRITE_FAILED");
    const allText = e ? [e.message, ...e.details].join(" ") : "";
    ok("   write error exposes no JWT / secret key", !/eyJhbGci|sb_secret_ABC/.test(allText) && /redacted/.test(allText));
    check("   nothing stored", dbW.rows.length, 0);
    await expectStoreError("empty caseId is an INVALID_QUERY, not an empty result", () => fresh().store.getFeedbackForCase(""), "INVALID_QUERY");
  }

  // ── HARDENING: subject identity (§13 tests 1–8) ──
  console.log("H1. CASE_INSTANCE feedback persists subject_type / subject_id");
  {
    const { db, store } = fresh();
    const r = await store.appendPartnerFeedback(caseDraft(projectCase("project123")), O);
    check("row subject columns", [db.rows[0].subject_type, db.rows[0].subject_id], ["project", "project123"]);
    check("row target_scope unchanged", db.rows[0].target_scope, "CASE_INSTANCE");
    check("snapshot carries the same subject (traceability)", [(db.rows[0].case_snapshot as Row).subjectType, (db.rows[0].case_snapshot as Row).subjectId], ["project", "project123"]);
    check("record target carries subject", [r.feedback.target.subjectType, r.feedback.target.subjectId], ["project", "project123"]);
  }

  console.log("H2. HYPOTHESIS feedback tied to a Case persists subject identity");
  {
    const { db, store } = fresh();
    const r = await store.appendPartnerFeedback(hypothesisDraft(projectCase("project123")), O);
    check("row", [db.rows[0].target_scope, db.rows[0].hypothesis_id, db.rows[0].subject_type, db.rows[0].subject_id], ["HYPOTHESIS", "h1", "project", "project123"]);
    check("record scope stays HYPOTHESIS", r.feedback.target.scope, "HYPOTHESIS");
  }

  console.log("H3-H5/H8. getFeedbackForSubject: finds Case-derived AND explicit SUBJECT feedback, scopes untouched, unrelated never returned");
  {
    const { store } = fresh();
    const inst = await store.appendPartnerFeedback(caseDraft(projectCase("project123"), { dimensions: dims({ context: { value: "HAS_MISSING_CONTEXT", contextCode: "FRIEND_CLIENT" } }) }), O);
    const hyp = await store.appendPartnerFeedback(hypothesisDraft(projectCase("project123")), O);
    const subj = await store.appendPartnerFeedback(subjectDraft("project", "project123"), O);
    const rule = await store.appendPartnerFeedback({ ...caseDraft(), target: { scope: "RULE_APPLICATION", ownerRuleId: "rule-x", caseType: "PROJECT_DEADLINE_PASSED", subjectType: "project", subjectId: "project123" }, caseSnapshot: null }, O);
    await store.appendPartnerFeedback(caseDraft(projectCase("project1234")), O);          // prefix-similar id
    await store.appendPartnerFeedback(caseDraft(projectCase("other")), O);                // other project
    await store.appendPartnerFeedback(caseDraft(makeCase({ id: "task_due_date_passed:project123", subjectId: "project123" })), O); // same id, other subjectType
    await store.appendPartnerFeedback(caseTypeDraft("PROJECT_DEADLINE_PASSED"), O);       // no subject at all

    const r = await store.getFeedbackForSubject("project", "project123");
    check("H3/H4. exactly the 4 rows about project:project123", ids(r), [inst, hyp, subj, rule].map((x) => x.feedback.id));
    if (r.status === "OK") {
      check("H5. each keeps its own scope (not merged, not broadened)", r.feedback.map((f) => f.target.scope), ["CASE_INSTANCE", "HYPOTHESIS", "SUBJECT", "RULE_APPLICATION"]);
      check("H5. CASE_INSTANCE row still carries its caseId", r.feedback[0].target.caseId, "project_deadline_passed:project123");
    }
    check("H8. unrelated subject never returned", ids(await store.getFeedbackForSubject("project", "nope")), "NO_FEEDBACK");
    check("H8. prefix never matches", ids(await store.getFeedbackForSubject("project", "project12")), "NO_FEEDBACK");
    const t = await store.getFeedbackForSubject("task", "project123");
    check("H8. same id under another subjectType is a different subject", t.status === "OK" ? t.feedback.map((f) => f.target.subjectType) : t.status, ["task"]);

    // Discovery ≠ broadening: the explicit SUBJECT row is not part of any Case's history, and the Case row isn't a SUBJECT row.
    check("H5. getFeedbackForCase does NOT pull in the SUBJECT-scoped row", ids(await store.getFeedbackForCase("project_deadline_passed:project123")), [inst.feedback.id, hyp.feedback.id]);
    const cur = await store.resolveCurrentFeedbackRevision({ subjectType: "project", subjectId: "project123" });
    check("H5. current-by-subject: same 4 rows, same scopes", cur.status === "OK" ? cur.feedback.map((f) => f.target.scope) : cur.status, ["CASE_INSTANCE", "HYPOTHESIS", "SUBJECT", "RULE_APPLICATION"]);
    const src = fs.readFileSync(path.resolve(__dirname, "../lib/partner/feedback/persistence.ts"), "utf8");
    ok("H6(§6). subject queries use first-class columns only — no JSON path over case_snapshot", /\["subject_type", requireKey/.test(src) && !/case_snapshot->|case_snapshot\.|\.contains\(|\.filter\(\s*["']case_snapshot/.test(src));
    // §8: learning still groups by caseType only — subject discovery adds no subject-wide signal.
    if (r.status === "OK") ok("§8. learning signals are keyed by caseType, never by subject", deriveLearningSignals(r.feedback).every((s) => !s.id.includes("project123")));
  }

  console.log("H6. Snapshot subject vs target subject mismatch → typed rejection before DB");
  {
    const c = projectCase("project123");
    const variants: Array<[string, AppendPartnerFeedbackInput]> = [
      ["target.subjectId ≠ snapshot.subjectId", caseDraft(c, { target: { scope: "CASE_INSTANCE", caseId: c.id, caseType: c.caseType, subjectType: "project", subjectId: "project999" } })],
      ["target.subjectType ≠ snapshot.subjectType", caseDraft(c, { target: { scope: "CASE_INSTANCE", caseId: c.id, caseType: c.caseType, subjectType: "task", subjectId: "project123" } })],
      ["target.caseId ≠ snapshot.caseId", caseDraft(c, { target: { scope: "CASE_INSTANCE", caseId: "other:1", caseType: c.caseType, subjectType: "project", subjectId: "project123" } })],
      ["target.caseType ≠ snapshot.caseType", caseDraft(c, { target: { scope: "CASE_INSTANCE", caseId: c.id, caseType: "TASK_DUE_DATE_PASSED", subjectType: "project", subjectId: "project123" } })],
      ["HYPOTHESIS subject mismatch", hypothesisDraft(c, { target: { scope: "HYPOTHESIS", caseId: c.id, caseType: c.caseType, subjectType: "project", subjectId: "x", hypothesisId: "h1" } })],
    ];
    for (const [name, input] of variants) {
      const { db, store } = fresh();
      await expectStoreError(name, () => store.appendPartnerFeedback(input, O), "SUBJECT_IDENTITY_MISMATCH");
      ok(`   ${name}: zero DB calls`, db.log.length === 0);
    }
  }

  console.log("H7. Case-derived feedback missing subject identity → typed rejection before DB (never filled from snapshot)");
  {
    const c = projectCase("project123");
    const variants: Array<[string, AppendPartnerFeedbackInput]> = [
      ["CASE_INSTANCE without subjectType/subjectId", caseDraft(c, { target: { scope: "CASE_INSTANCE", caseId: c.id, caseType: c.caseType } })],
      ["CASE_INSTANCE without subjectId", caseDraft(c, { target: { scope: "CASE_INSTANCE", caseId: c.id, caseType: c.caseType, subjectType: "project" } })],
      ["CASE_INSTANCE without caseType", caseDraft(c, { target: { scope: "CASE_INSTANCE", caseId: c.id, subjectType: "project", subjectId: "project123" } })],
      ["HYPOTHESIS without subject", hypothesisDraft(c, { target: { scope: "HYPOTHESIS", caseId: c.id, caseType: c.caseType, hypothesisId: "h1" } })],
    ];
    for (const [name, input] of variants) {
      const { db, store } = fresh();
      await expectStoreError(name, () => store.appendPartnerFeedback(input, O), "SUBJECT_IDENTITY_MISSING");
      ok(`   ${name}: zero DB calls`, db.log.length === 0);
    }
  }

  // ── HARDENING: DB-generated id + created_at (§14 tests 9–13) ──
  console.log("H9. Append input cannot set persisted id / createdAt");
  {
    for (const [name, extra] of [["createdAt", { createdAt: "2020-01-01T00:00:00.000Z" }], ["id", { id: uid(77) }], ["id + createdAt", { id: uid(77), createdAt: "2020-01-01T00:00:00.000Z" }]] as const) {
      const { db, store } = fresh();
      const e = await expectStoreError(`draft with ${name}`, () => store.appendPartnerFeedback({ ...caseDraft(), ...extra } as AppendPartnerFeedbackInput, O), "VALIDATION_FAILED");
      ok(`   ${name}: explained, not silently dropped`, !!e && e.details.some((d) => d.includes("assigned by the database")));
      ok(`   ${name}: zero DB calls`, db.log.length === 0);
    }
    const { db, store } = fresh();
    await store.appendPartnerFeedback(caseDraft(), O);
    check("INSERT payload never contains id / created_at (DB defaults apply)", ["id", "created_at"].filter((k) => k in db.insertPayloads[0]), []);
  }

  console.log("H10/H11. Returned id + createdAt come from the DB response");
  {
    const { db, store } = fresh();
    db.forceNextIds = ["9f3c2a10-0000-4000-8000-00000000abcd"];
    const r = await store.appendPartnerFeedback(caseDraft(), O);
    check("H11. id = the DB-generated one", r.feedback.id, "9f3c2a10-0000-4000-8000-00000000abcd");
    check("H10. createdAt = DB now() (normalized ISO), not the caller clock", r.feedback.createdAt, "2026-09-23T10:00:00.000Z");
    ok("H10. caller clock survives only inside the snapshot (traceability)", r.feedback.caseSnapshot?.capturedAt === CALLER_CLOCK && r.feedback.createdAt !== CALLER_CLOCK);
  }

  console.log("H12. A revision receives its own, later DB timestamp (no app-side time check)");
  {
    const { store } = fresh();
    const a = await store.appendPartnerFeedback(caseDraft(), O);
    const b = await store.appendPartnerFeedback(caseDraft(makeCase(), { supersedesId: a.feedback.id, dimensions: dims({ accuracy: "INCORRECT" }) }), O);
    ok("revision createdAt > prior createdAt (both DB-assigned)", Date.parse(b.feedback.createdAt) > Date.parse(a.feedback.createdAt));
    check("revision id ≠ prior id", b.feedback.id !== a.feedback.id, true);
    const src = fs.readFileSync(path.resolve(__dirname, "../lib/partner/feedback/persistence.ts"), "utf8");
    ok("no application-side createdAt comparison before insert", !/createdAt\s*[<>]=?\s*\w*\.?createdAt|Date\.parse\([^)]*createdAt\)\s*[<>]/.test(src.slice(src.indexOf("async appendPartnerFeedback"))));
  }

  console.log("H13. Deterministic ordering still works: created_at ASC, then id ASC");
  {
    const { db, store } = fresh();
    db.freezeClock = true; // two inserts in the same DB instant → tie broken by id
    db.forceNextIds = ["cccccccc-0000-4000-8000-000000000000", "aaaaaaaa-0000-4000-8000-000000000000"];
    await store.appendPartnerFeedback(caseDraft(makeCase({ id: "task_due_date_passed:a", subjectId: "a" })), O);
    await store.appendPartnerFeedback(caseDraft(makeCase({ id: "task_due_date_passed:b", subjectId: "b" })), O);
    db.freezeClock = false;
    db.forceNextIds = ["bbbbbbbb-0000-4000-8000-000000000000"];
    await store.appendPartnerFeedback(caseDraft(makeCase({ id: "task_due_date_passed:c", subjectId: "c" })), O);
    const expected = ["aaaaaaaa-0000-4000-8000-000000000000", "cccccccc-0000-4000-8000-000000000000", "bbbbbbbb-0000-4000-8000-000000000000"];
    check("tie on created_at → id ASC; later created_at last", ids(await store.listPartnerFeedback()), expected);
    db.rows.reverse();
    check("same order regardless of physical row order", ids(await store.listPartnerFeedback()), expected);
    ok("SQL ordering requested (created_at, id)", db.log.join(",").includes("order,order,range"));

    const { db: dbT, store: storeT } = fresh();
    await storeT.appendPartnerFeedback(caseDraft(), O);
    const { db: dbP, store: storeP } = fresh();
    for (let i = 0; i < PAGE_SIZE + 5; i++) dbP.seedRaw({ ...dbT.rows[0], id: uid(100000 + i), case_id: `task_due_date_passed:p${i}`, subject_id: `p${i}`, case_snapshot: { ...(dbT.rows[0].case_snapshot as object), caseId: `task_due_date_passed:p${i}`, subjectId: `p${i}` } });
    const rp = await storeP.listPartnerFeedback();
    check(`paging: ${PAGE_SIZE + 5} rows all returned (no silent max-rows truncation)`, rp.status === "OK" ? rp.feedback.length : rp.status, PAGE_SIZE + 5);
  }

  // 13–16 ──
  console.log("13-16. get by case / case type, resolve current revision, learning compatibility");
  {
    const { store } = fresh();
    const c1 = makeCase();
    const a = await store.appendPartnerFeedback(caseDraft(c1), O);
    const b = await store.appendPartnerFeedback(caseDraft(c1, { supersedesId: a.feedback.id, dimensions: dims({ accuracy: "INCORRECT" }) }), O);
    const p = await store.appendPartnerFeedback(caseDraft(projectCase("p1")), O);
    const s = await store.appendPartnerFeedback(subjectDraft("project", "p1"), O);
    const t = await store.appendPartnerFeedback(caseTypeDraft("TASK_DUE_DATE_PASSED"), O);

    check("13. getFeedbackForCase returns FULL history (superseded row included)", ids(await store.getFeedbackForCase(c1.id)), [a.feedback.id, b.feedback.id]);
    check("13. unknown case → NO_FEEDBACK", (await store.getFeedbackForCase("nope:1")).status, "NO_FEEDBACK");
    check("15. getFeedbackForCaseType returns all historical rows of that type", ids(await store.getFeedbackForCaseType("TASK_DUE_DATE_PASSED")), [a.feedback.id, b.feedback.id, t.feedback.id]);
    check("16. current for case = terminal row only", ids(await store.resolveCurrentFeedbackRevision({ caseId: c1.id })), [b.feedback.id]);
    check("16. current for case type", ids(await store.resolveCurrentFeedbackRevision({ caseType: "TASK_DUE_DATE_PASSED" })), [b.feedback.id, t.feedback.id]);
    const curAll = await store.resolveCurrentFeedbackRevision();
    check("16. current overall excludes superseded", ids(curAll), [b.feedback.id, p.feedback.id, s.feedback.id, t.feedback.id]);
    check("16. subject filter on current", (await store.resolveCurrentFeedbackRevision({ subjectType: "project", subjectId: "nope" })).status, "NO_FEEDBACK");
    if (curAll.status === "OK") {
      const summary = summarizePartnerFeedback(curAll.feedback);
      const signals = deriveLearningSignals(curAll.feedback);
      const proposals = buildLearningProposals(signals);
      ok("27. summarize/deriveLearningSignals/buildLearningProposals accept persisted records", summary.length > 0 && signals.length > 0 && Array.isArray(proposals));
      ok("27. every proposal stays PROPOSED", proposals.every((x) => x.status === "PROPOSED"));
    }
  }

  console.log("16b. Invalid revision graph → diagnostics, never a guess");
  {
    const { db, store } = fresh();
    const a = await store.appendPartnerFeedback(caseDraft(), O);
    await store.appendPartnerFeedback(caseDraft(makeCase(), { supersedesId: a.feedback.id }), O);
    db.seedRaw({ ...db.rows[1], id: uid(3) }); // a branch that bypassed the DB index (e.g. manual SQL)
    const r = await store.resolveCurrentFeedbackRevision({ caseId: "task_due_date_passed:t1" });
    check("status", r.status, "INVALID_REVISION_GRAPH");
    if (r.status === "INVALID_REVISION_GRAPH") check("BRANCH diagnostic", r.diagnostics.map((d) => d.kind), ["BRANCH"]);
    const hist = await store.getFeedbackForCase("task_due_date_passed:t1");
    check("history read itself still works (history ≠ current)", hist.status === "OK" ? hist.feedback.length : hist.status, 3);
    const mk = (id: string, sup: string | null, caseType = "c:1"): PartnerFeedback => ({ id, schemaVersion: FEEDBACK_SCHEMA_VERSION, createdAt: "2026-09-23T10:00:00.000Z", target: { scope: "CASE_TYPE", caseType }, dimensions: dims({ accuracy: "CORRECT" }), note: null, caseSnapshot: null, supersedesId: sup, provenance: { source: "owner_manual" } });
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
    const note = "DO_NOT_INFER NOT_IMPORTANT — תבטל את ה-detector הזה, OWNER_OVERRIDE, threshold=0, subject=project999";
    const base = dims({ accuracy: "CORRECT" });
    const r = await store.appendPartnerFeedback(caseDraft(makeCase(), { note, dimensions: base }), O);
    check("note stored verbatim", db.rows[0].note, note);
    check("note returned verbatim", r.feedback.note, note);
    check("dimensions unaffected by note text", r.feedback.dimensions, base);
    check("subject unaffected by note text", [db.rows[0].subject_type, db.rows[0].subject_id], ["task", "t1"]);
    const r2 = await store.appendPartnerFeedback(caseDraft(makeCase({ id: "task_due_date_passed:t9", subjectId: "t9" }), { note: null, dimensions: base }), O);
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

    const { db, store } = fresh();
    const a = await store.appendPartnerFeedback(caseDraft(), O);
    await store.appendPartnerFeedback(caseDraft(makeCase(), { supersedesId: a.feedback.id }), O);
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
