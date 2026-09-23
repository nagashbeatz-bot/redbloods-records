/**
 * In-memory fake of public.partner_owner_context for tests (mirrors the verified production table:
 * DB id + created_at defaults, PK, question-id / scope / format / provenance / answer_value CHECKs,
 * composite supersedes FK, one-root-per-slot and supersedes UNIQUE indexes, PostgREST-style
 * select / eq / order / range and insert → select → single). Never touches production.
 */
import type { ContextDbResponse, ContextSelectQuery, OwnerContextTableClient } from "../../lib/partner/investigation/context-persistence";
import type { OwnerContextInsertRow } from "../../lib/partner/investigation/context-row";

export type Row = Record<string, unknown>;
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const FMT = /^[A-Z][A-Z0-9_]*$/;

export class FakeOwnerContextDb {
  rows: Row[] = [];
  log: string[] = [];
  insertPayloads: Row[] = [];
  opts: { failSelect?: boolean; failInsert?: boolean } = {};
  clockMs = Date.parse("2026-09-24T09:00:00.000Z");
  private idSeq = 100;

  private insertRow(row: OwnerContextInsertRow): ContextDbResponse<unknown> {
    this.insertPayloads.push(JSON.parse(JSON.stringify(row)));
    if (this.opts.failInsert) return { data: null, error: { code: "08006", message: "connection failure" } };
    const r = row as unknown as Row;
    const id = uid(++this.idSeq);
    this.clockMs += 1000;
    const created_at = new Date(this.clockMs).toISOString().replace("Z", "456+00:00");
    if (row.scope !== "CASE_INSTANCE") return { data: null, error: { code: "23514", message: "violates check constraint partner_owner_context_scope_chk" } };
    if (row.question_id !== `${row.case_id}::${row.question_type}`) return { data: null, error: { code: "23514", message: "violates check constraint partner_owner_context_question_id_derived_chk" } };
    if (!FMT.test(row.question_type) || !FMT.test(row.answer_code)) return { data: null, error: { code: "23514", message: "violates format check" } };
    if (typeof row.provenance !== "object" || row.provenance === null || !("source" in (row.provenance as object))) return { data: null, error: { code: "23514", message: "violates provenance check" } };
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
        db.log.push(`from:${table}`);
        return {
          select(columns) {
            db.log.push("select");
            const filters: Array<[string, string]> = [], orders: Array<[string, boolean]> = [];
            let range: [number, number] | null = null;
            const run = (): ContextDbResponse<unknown[]> => {
              if (db.opts.failSelect) return { data: null, error: { code: "57014", message: "statement timeout" } };
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
              eq(c, v) { filters.push([c, v]); return q; },
              order(c, o) { orders.push([c, o.ascending]); return q; },
              range(a, b) { range = [a, b]; return q; },
              maybeSingle() { const r = run(); return Promise.resolve(r.error ? { data: null, error: r.error } : { data: r.data && r.data.length ? r.data[0] : null, error: null }); },
              then(onF, onR) { return Promise.resolve(run()).then(onF, onR); },
            };
            return q;
          },
          insert(row) {
            db.log.push("insert");
            return { select() { return { single() { return Promise.resolve(db.insertRow(row)); } }; } };
          },
        };
      },
    };
  }
}
