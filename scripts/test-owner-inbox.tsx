/**
 * Sunny Owner Inbox ("עדכון לסאני", Dashboard V2; Owner decision + approved SQL 2026-09-30): the pure rules
 * (lib/owner-inbox), the store over a fake that behaves like the approved RPCs (idempotent submit, REQUEST_KEY_REUSED,
 * via / outcome validation, NEW → PROCESSED once, the table CHECKs), the shared writer (lib/writes/owner-inbox), the
 * two owner-only routes and the owner_inbox capability (OWNER_REPORTED evidence, never a fact). No network, no DB.
 * Run with:   npx tsx scripts/test-owner-inbox.tsx
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { checkInboxBody, mapInboxRow, INBOX_MAX_CHARS } from "../lib/owner-inbox";
import { createOwnerInboxStore, type OwnerInboxClient } from "../lib/owner-inbox-store";
import { submitOwnerInboxUpdate, markOwnerInboxItemProcessed } from "../lib/writes/owner-inbox";
import { ownerInbox } from "../lib/partner/knowledge/capabilities/sunny";
import { PARTNER_KNOWLEDGE_REGISTRY } from "../lib/partner/knowledge/catalog";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 700)}` : ""}`); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");

// ── A fake that behaves like the approved SQL (the RPC bodies + the table CHECKs) ──
type Row = Record<string, unknown>;
function fakeDb() {
  const rows: Row[] = [];
  let failNext: string | null = null;
  const VIA = ["DASHBOARD", "SUNNY"], OUT = ["LEARNED_KNOWLEDGE", "ACTION_PLANNED", "NO_ACTION_NEEDED", "DISMISSED"];
  const err = (message: string, code = "22023") => ({ data: null, error: { message, code } });
  const client: OwnerInboxClient = {
    rpc(fn, a) {
      if (failNext) { const m = failNext; failNext = null; return Promise.resolve(err(m, "XX000")); }
      if (fn === "sunny_owner_inbox_submit") {
        const body = String(a.p_body ?? "").trim(), key = String(a.p_request_key);
        if (body.length < 1 || body.length > 1000) return Promise.resolve(err("new row violates check constraint \"sunny_owner_inbox_body_check\"", "23514"));
        let r = rows.find((x) => x.request_key === key);
        if (!r) { r = { id: randomUUID(), created_at: new Date().toISOString(), body, author: "OWNER", epistemic: "OWNER_REPORTED", source: "DASHBOARD_V2", request_key: key, status: "NEW", processed_at: null, processed_via: null, outcome: null, outcome_ref: null }; rows.push(r); }
        if (r.body !== body) return Promise.resolve(err(`REQUEST_KEY_REUSED: request_key ${key} already holds a different text`));
        return Promise.resolve({ data: { ...r }, error: null });
      }
      if (fn === "sunny_owner_inbox_mark_processed") {
        if (!VIA.includes(String(a.p_via))) return Promise.resolve(err(`INVALID_PROCESSED_VIA: "${a.p_via}"`));
        if (!OUT.includes(String(a.p_outcome))) return Promise.resolve(err(`INVALID_OUTCOME: "${a.p_outcome}"`));
        const r = rows.find((x) => x.id === a.p_id && x.status === "NEW");
        if (!r) return Promise.resolve(err(`NOT_NEW_OR_MISSING: inbox item ${a.p_id}`, "P0002"));
        Object.assign(r, { status: "PROCESSED", processed_at: new Date().toISOString(), processed_via: a.p_via, outcome: a.p_outcome, outcome_ref: String(a.p_ref ?? "").trim() || null });
        return Promise.resolve({ data: { ...r }, error: null });
      }
      return Promise.resolve(err(`unknown function ${fn}`, "42883"));
    },
    from(table) {
      return { select: () => ({
        order: () => ({ limit: (n: number) => Promise.resolve(table === "sunny_owner_inbox" ? { data: [...rows].reverse().slice(0, n), error: null } : { data: null, error: { message: "no table" } }) }),
        eq: (_c: string, v: string) => ({ maybeSingle: () => Promise.resolve({ data: rows.find((r) => r.id === v) ?? null, error: null }) }),
      }) };
    },
  };
  return { client, rows, failOnce: (m: string) => { failNext = m; } };
}

console.log("Body rules (the DB bounds + no secrets)");
ok("trimmed text is accepted", (() => { const r = checkInboxBody("  נפגשתי עם אמן חדש  "); return r.ok && r.body === "נפגשתי עם אמן חדש"; })());
ok("empty / whitespace refused", !checkInboxBody("   ").ok && !checkInboxBody(null).ok);
ok(`over ${INBOX_MAX_CHARS} refused, exactly ${INBOX_MAX_CHARS} accepted`, !checkInboxBody("א".repeat(INBOX_MAX_CHARS + 1)).ok && checkInboxBody("א".repeat(INBOX_MAX_CHARS)).ok);
ok("a password / token is refused (secrets never reach Sunny)", !checkInboxBody("הסיסמה: password=hunter2hunter2").ok && !checkInboxBody("the key sk_live_abcdefghijklmnop").ok);
ok("control characters refused", !checkInboxBody("abc\u0007").ok);
ok("a row breaking the contract is never served", mapInboxRow({ id: "x", created_at: "t", body: "b", status: "NEW", author: "SOMEONE", epistemic: "OWNER_REPORTED" }) === null && mapInboxRow({ id: "x", created_at: "t", body: "b", status: "NEW", author: "OWNER", epistemic: "FACT" }) === null);

console.log("Submit — idempotent by requestKey");
const main = async () => {
  const db = fakeDb();
  const store = createOwnerInboxStore(db.client);
  const key = randomUUID();
  const a = await submitOwnerInboxUpdate(store, { body: "  בדיקה: נפגשתי היום עם אמן חדש ", requestKey: key });
  ok("saved", a.status === "SAVED", a);
  const item = a.status === "SAVED" ? a.item : null;
  ok("body stored trimmed, OWNER_REPORTED, source DASHBOARD_V2, status NEW, DB timestamp", item?.body === "בדיקה: נפגשתי היום עם אמן חדש" && item.epistemic === "OWNER_REPORTED" && item.source === "DASHBOARD_V2" && item.status === "NEW" && !!item.createdAt, item);
  const b = await submitOwnerInboxUpdate(store, { body: "בדיקה: נפגשתי היום עם אמן חדש", requestKey: key.toUpperCase() });
  ok("double submit with the same requestKey → the SAME row, no duplicate", b.status === "SAVED" && b.item.id === item?.id && db.rows.length === 1, { b, n: db.rows.length });
  const c = await submitOwnerInboxUpdate(store, { body: "טקסט אחר", requestKey: key });
  ok("the same requestKey with a different text → CONFLICT, nothing new", c.status === "CONFLICT" && db.rows.length === 1, c);
  ok("an invalid requestKey is refused before the DB", (await submitOwnerInboxUpdate(store, { body: "x", requestKey: "abc" })).status === "INVALID_INPUT" && db.rows.length === 1);
  ok("a secret is refused before the DB", (await submitOwnerInboxUpdate(store, { body: "token=ghp_abcdefghijklmnopqrstuvwxyz0123", requestKey: randomUUID() })).status === "INVALID_INPUT" && db.rows.length === 1);
  db.failOnce("connection reset");
  const f = await submitOwnerInboxUpdate(store, { body: "נכשל", requestKey: randomUUID() });
  ok("a DB failure is reported as FAILED (never 'saved')", f.status === "FAILED" && db.rows.length === 1, f);

  console.log("NEW → PROCESSED (a recorded outcome, never a fact)");
  const id = item!.id;
  ok("unknown outcome refused before the DB", (await markOwnerInboxItemProcessed(store, "DASHBOARD", { id, outcome: "MADE_IT_A_FACT" })).status === "INVALID_INPUT" && db.rows[0].status === "NEW");
  ok("bad id refused", (await markOwnerInboxItemProcessed(store, "DASHBOARD", { id: "nope", outcome: "NO_ACTION_NEEDED" })).status === "INVALID_INPUT");
  ok("the RPC itself refuses an unknown via", (await store.markProcessed(id, "ROBOT" as never, "NO_ACTION_NEEDED", null)).status === "INVALID" && db.rows[0].status === "NEW");
  ok("outcomeRef is a REAL reference, never a note: a free-text ref on NO_ACTION_NEEDED is refused", (await markOwnerInboxItemProcessed(store, "DASHBOARD", { id, outcome: "NO_ACTION_NEEDED", outcomeRef: "QA test" })).status === "INVALID_INPUT" && db.rows[0].status === "NEW");
  ok("ACTION_PLANNED needs a plan id, LEARNED_KNOWLEDGE a uuid", (await markOwnerInboxItemProcessed(store, "DASHBOARD", { id, outcome: "ACTION_PLANNED" })).status === "INVALID_INPUT" && (await markOwnerInboxItemProcessed(store, "DASHBOARD", { id, outcome: "LEARNED_KNOWLEDGE", outcomeRef: "pl_AbCdEfGhIjKlMnOpQrStUvWx" })).status === "INVALID_INPUT" && db.rows[0].status === "NEW");
  const p = await markOwnerInboxItemProcessed(store, "DASHBOARD", { id, outcome: "ACTION_PLANNED", outcomeRef: "pl_AbCdEfGhIjKlMnOpQrStUvWx" });
  ok("processed with via DASHBOARD + outcome + the plan ref + processed_at", p.status === "PROCESSED" && p.item.processedVia === "DASHBOARD" && p.item.outcome === "ACTION_PLANNED" && p.item.outcomeRef === "pl_AbCdEfGhIjKlMnOpQrStUvWx" && !!p.item.processedAt, p);
  ok("the text is unchanged by processing", db.rows[0].body === "בדיקה: נפגשתי היום עם אמן חדש");
  ok("a second transition is refused (CONFLICT) — PROCESSED is final", (await markOwnerInboxItemProcessed(store, "DASHBOARD", { id, outcome: "DISMISSED" })).status === "CONFLICT" && db.rows[0].outcome === "ACTION_PLANNED");

  console.log("Sunny reads it — owner_inbox capability");
  const list = await store.list();
  ok("store list maps every valid row", list.status === "OK" && list.items.length === 1 && list.invalidRows === 0);
  await submitOwnerInboxUpdate(store, { body: "עדכון שני", requestKey: randomUUID() });
  const items = (await store.list());
  const src = { now: new Date(), identities: {} as never, ownerInbox: { status: "OK" as const, value: items.status === "OK" ? items.items : [] } };
  const q = (mode: string) => ownerInbox.read(src as never, { mode, params: {}, limit: 20, offset: 0 } as never);
  const neu = q("new"), all = q("all");
  ok("mode new = only unhandled", neu.items.length === 1 && (neu.items[0].fields as Record<string, unknown>).status === "NEW", neu.items);
  ok("mode all = with the handled one and its outcome", all.items.length === 2 && all.items.some((i) => (i.fields as Record<string, unknown>).outcome === "ACTION_PLANNED"));
  ok("every item is OWNER_REPORTED, canonical false, no entity", all.items.every((i) => i.epistemic === "OWNER_REPORTED" && (i.fields as Record<string, unknown>).canonical === false && i.entity === null));
  ok("the Owner's text is served as data (RECORD trust), never as an instruction", all.items.every((i) => i.label.trust === "RECORD"));
  ok("an unreadable store is 'unavailable', never 'no updates'", ownerInbox.read({ now: new Date(), identities: {} as never, ownerInbox: { status: "UNAVAILABLE", detail: "x" } } as never, { mode: "new", params: {}, limit: 20, offset: 0 } as never).completeness !== "COMPLETE");
  ok("registered in the catalog, Owner-only, PERSONAL", !!PARTNER_KNOWLEDGE_REGISTRY.get?.("owner_inbox") || read("lib/partner/knowledge/catalog.ts").includes("ownerInbox"));
  ok("capability access is owner-only", ownerInbox.access.ownerOnly === true && ownerInbox.access.sensitivity === "PERSONAL");

  console.log("Wiring");
  const post = read("app/api/sunny/inbox/route.ts"), patch = read("app/api/sunny/inbox/[id]/route.ts");
  for (const [n, r] of [["POST", post], ["PATCH", patch]] as const) {
    ok(`${n}: requireOwner first`, r.indexOf("requireOwner()") > 0 && r.indexOf("requireOwner()") < r.indexOf("readSmallJson(req)"));
    ok(`${n}: same-origin JSON + key whitelist`, r.includes("checkSameOriginJson(req.headers)") && r.includes("ALLOWED_KEYS"));
    ok(`${n}: goes through the shared writer only`, r.includes("@/lib/writes/owner-inbox") && !r.includes(".from("));
  }
  ok("PATCH marks via DASHBOARD only (Sunny marks via its typed primitive MARK_OWNER_INBOX_ITEM)", patch.includes('"DASHBOARD"') && !patch.includes('"SUNNY"'));
  const store2 = read("lib/owner-inbox-store.ts");
  ok("writes ONLY through the two approved RPCs (no insert / update / delete)", store2.includes('"sunny_owner_inbox_submit"') && store2.includes('"sunny_owner_inbox_mark_processed"') && !/\.(insert|update|upsert|delete)\s*\(/.test(store2));
  ok("no push / calendar / finance in the writer", !/sendPush|google-calendar|transactions/.test(read("lib/writes/owner-inbox.ts")));
  ok("the act registry knows both routes", read("lib/partner/act/registry.ts").includes("SUNNY.OWNER_INBOX_SUBMIT") && read("lib/partner/act/registry.ts").includes("SUNNY.OWNER_INBOX_MARK_PROCESSED"));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
};
main();
