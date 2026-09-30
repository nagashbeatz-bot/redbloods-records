/**
 * Universal Action Layer — the Owner Inbox family (Owner decision 2026-09-30): MARK_OWNER_INBOX_ITEM through the REAL
 * service on fakes. The standard checks (happy / invalid / missing / wrong kind / stale / no approval / exact verify)
 * plus the family rules: outcomeRef is a REAL reference (ACTION_PLANNED → pl_…, LEARNED_KNOWLEDGE → uuid, else null —
 * never a note), the preview names the linked object, PROCESSED is final (no reopen), via = SUNNY exactly, several items
 * in ONE compound plan with ONE approval, and nothing creates knowledge or an action. The primitive uses the SAME shared
 * writer as the dashboard route.
 * Run with:   npx tsx scripts/test-sunny-act-owner-inbox.tsx      Pure; never touches production.
 */
import fs from "node:fs";
import path from "node:path";
import { runCases, mkDeps, fullFlow, U, OWNER, type FamilyCase } from "./fixtures/act-harness";
import { planAction, approveAction, executeAction } from "../lib/partner/act/service";
import { ACT_TABLES } from "../lib/partner/act/store-supabase";
import { OWNER_INBOX_PRIMITIVES } from "../lib/partner/act/primitives/owner-inbox";
import { ACTION_REGISTRY } from "../lib/partner/act/registry";
import { coverageOf } from "../lib/partner/act/matrix";
import { NON_KEY_TARGETS } from "../lib/partner/act/targets";
import { checkOutcomeRef } from "../lib/owner-inbox";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 600)}` : ""}`); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");

interface Item { body: string; status: string; outcome: string | null; outcomeRef: string | null; processedVia: string | null }
interface W { items: Record<string, Item>; knowledge: number; actions: number }
const PLAN = "pl_AbCdEfGhIjKlMnOpQrStUvWx";
const KNOW = U(77);
const world = (): W => ({
  items: {
    [U(1)]: { body: "נפגשתי היום עם אמן חדש מבאר שבע", status: "NEW", outcome: null, outcomeRef: null, processedVia: null },
    [U(2)]: { body: "סטיבן יחזיר מיקס ביום ראשון", status: "NEW", outcome: null, outcomeRef: null, processedVia: null },
    [U(3)]: { body: "להזכיר לי לשלם גז", status: "NEW", outcome: null, outcomeRef: null, processedVia: null },
    [U(4)]: { body: "כבר טופל", status: "PROCESSED", outcome: "DISMISSED", outcomeRef: null, processedVia: "DASHBOARD" },
  },
  knowledge: 27, actions: 0,
});
function mk() {
  const w = world(); const calls: string[] = [];
  const writers = {
    async readOwnerInboxItem(id: string) { const x = w.items[id]; return x ? { ...x } : null; },
    async listOwnerInboxNew() { return Object.entries(w.items).filter(([, x]) => x.status === "NEW").map(([id, x]) => ({ id, body: x.body })); },
    // behaves like the shared writer + the RPC: validates the ref, NEW only, via stored
    async markOwnerInboxItem(id: string, outcome: string, outcomeRef: string | null) {
      calls.push("markOwnerInboxItem");
      const r = checkOutcomeRef(outcome as never, outcomeRef);
      if (!r.ok) throw new Error(r.code);
      const x = w.items[id]; if (!x || x.status !== "NEW") throw new Error("NOT_NEW_OR_MISSING");
      Object.assign(x, { status: "PROCESSED", outcome, outcomeRef: r.ref, processedVia: "SUNNY" });
    },
  };
  return { w, calls, writers };
}
const I1 = `owner-inbox:${U(1)}`, I2 = `owner-inbox:${U(2)}`, I3 = `owner-inbox:${U(3)}`, I4 = `owner-inbox:${U(4)}`;
const done = (x: Item, outcome: string, ref: string | null) => x.status === "PROCESSED" && x.outcome === outcome && x.outcomeRef === ref && x.processedVia === "SUNNY";

const CASES: FamilyCase<W>[] = [
  {
    id: "MARK_OWNER_INBOX_ITEM", args: { item: I1, outcome: "NO_ACTION_NEEDED" },
    bad: { item: I1, outcome: "MADE_IT_A_FACT" },
    missing: { item: `owner-inbox:${U(9)}`, outcome: "NO_ACTION_NEEDED" },
    wrongKind: { item: `notification:${U(1)}`, outcome: "NO_ACTION_NEEDED" },
    stale: (w) => { Object.assign(w.items[U(1)], { status: "PROCESSED", outcome: "DISMISSED", processedVia: "DASHBOARD" }); },
    check: (w, calls) => done(w.items[U(1)], "NO_ACTION_NEEDED", null) && w.items[U(2)].status === "NEW" && calls.join() === "markOwnerInboxItem",
  },
];

(async () => {
  console.log("Owner Inbox — standard checks (happy / invalid / missing / wrong kind / stale / no approval / exact verify)");
  ok("the case table covers every owner-inbox primitive", CASES.map((c) => c.id).join() === OWNER_INBOX_PRIMITIVES.map((p) => p.actionId).join());
  await runCases(CASES, mk, ok);

  const q = (args: Record<string, unknown>, h = mk()) => planAction({ intentHe: "x", actionId: "MARK_OWNER_INBOX_ITEM", args }, OWNER, mkDeps(h.writers).d);

  console.log("\noutcomeRef = a REAL reference, never a note");
  ok("NO_ACTION_NEEDED with a free-text ref → refused", (await q({ item: I1, outcome: "NO_ACTION_NEEDED", outcomeRef: "בדקתי, הכל בסדר" })).status === "REF_NOT_ALLOWED");
  ok("DISMISSED with any ref → refused", (await q({ item: I1, outcome: "DISMISSED", outcomeRef: PLAN })).status === "REF_NOT_ALLOWED");
  ok("ACTION_PLANNED without a ref → refused", (await q({ item: I1, outcome: "ACTION_PLANNED" })).status === "REF_REQUIRED");
  ok("ACTION_PLANNED with a non-plan ref → refused", (await q({ item: I1, outcome: "ACTION_PLANNED", outcomeRef: KNOW })).status === "BAD_PLAN_REF");
  ok("LEARNED_KNOWLEDGE without a ref → refused", (await q({ item: I1, outcome: "LEARNED_KNOWLEDGE" })).status === "REF_REQUIRED");
  ok("LEARNED_KNOWLEDGE with a non-uuid ref → refused", (await q({ item: I1, outcome: "LEARNED_KNOWLEDGE", outcomeRef: "knowledge-1" })).status === "BAD_KNOWLEDGE_REF");
  for (const [outcome, ref] of [["ACTION_PLANNED", PLAN], ["LEARNED_KNOWLEDGE", KNOW], ["DISMISSED", null]] as const) {
    const h = mk(); const r = await fullFlow(mkDeps(h.writers).d, "MARK_OWNER_INBOX_ITEM", { item: I1, outcome, ...(ref ? { outcomeRef: ref } : {}) }, "מאשר");
    ok(`${outcome}: executes and verifies exactly (via SUNNY, ref ${ref ?? "null"})`, r.e?.status === "APPLIED_AS_EXPECTED" && done(h.w.items[U(1)], outcome, ref), { e: r.e?.status, item: h.w.items[U(1)] });
  }

  console.log("\nPreview names the linked object");
  const text = (p: Record<string, unknown>) => JSON.stringify(p.preview ?? p);
  const pa = await q({ item: I1, outcome: "ACTION_PLANNED", outcomeRef: PLAN });
  const pk = await q({ item: I1, outcome: "LEARNED_KNOWLEDGE", outcomeRef: KNOW });
  const pn = await q({ item: I1, outcome: "NO_ACTION_NEEDED" });
  ok("ACTION_PLANNED → 'מקושר ל-plan: pl_…'", pa.status === "PREVIEW" && text(pa).includes(`מקושר ל-plan: ${PLAN}`), text(pa).slice(0, 600));
  ok("LEARNED_KNOWLEDGE → 'מקושר לידע שנלמד: <id>'", pk.status === "PREVIEW" && text(pk).includes(`מקושר לידע שנלמד: ${KNOW}`));
  ok("NO_ACTION_NEEDED → 'ללא אובייקט מקושר'", pn.status === "PREVIEW" && text(pn).includes("ללא אובייקט מקושר"));
  ok("the preview shows the item text (as the target label) and NEW → PROCESSED", text(pn).includes("נפגשתי היום עם אמן חדש") && text(pn).includes("PROCESSED") && text(pn).includes("NEW"));
  ok("the preview discloses: no knowledge / action created, text unchanged, PROCESSED is final", ["לא נוצר ידע ולא נוצרת פעולה", "לא משתנה ולא נמחק", "אין החזרה ל-NEW"].every((s) => text(pn).includes(s)));

  console.log("\nPROCESSED is final — no reopen");
  ok("an item already PROCESSED → ALREADY_PROCESSED, no plan, no write", await (async () => { const h = mk(); const d = mkDeps(h.writers); const r = await planAction({ intentHe: "x", actionId: "MARK_OWNER_INBOX_ITEM", args: { item: I4, outcome: "NO_ACTION_NEEDED" } }, OWNER, d.d); return r.status === "ALREADY_PROCESSED" && h.calls.length === 0 && !d.db.rows(ACT_TABLES.plans).length; })());
  ok("there is no outcome / primitive that sets NEW", !OWNER_INBOX_PRIMITIVES.some((p) => p.meta.args.some((a) => (a.values ?? []).includes("NEW"))) && OWNER_INBOX_PRIMITIVES.length === 1);

  console.log("\nNo approval = no write");
  {
    const h = mk(); const d = mkDeps(h.writers);
    const p = await planAction({ intentHe: "x", actionId: "MARK_OWNER_INBOX_ITEM", args: { item: I1, outcome: "DISMISSED" } }, OWNER, d.d);
    const noAppr = await executeAction({ planId: p.planId, approvalToken: "not-a-token", confirmationText: "מאשר" }, OWNER, d.d);
    const notYes = await approveAction({ planId: p.planId, planHash: p.planHash, confirmationText: "לא" }, OWNER, d.d);
    ok("execute without a real approval token → refused, nothing written", noAppr.status !== "EXECUTED" && h.calls.length === 0 && h.w.items[U(1)].status === "NEW", noAppr.status);
    ok("'לא' is never an approval", notYes.status === "NOT_AN_APPROVAL" && h.calls.length === 0);
  }

  console.log("\nCompound: several items, ONE plan, ONE approval");
  {
    const h = mk(); const d = mkDeps(h.writers);
    const steps = [
      { actionId: "MARK_OWNER_INBOX_ITEM", args: { item: I1, outcome: "LEARNED_KNOWLEDGE", outcomeRef: KNOW } },
      { actionId: "MARK_OWNER_INBOX_ITEM", args: { item: I2, outcome: "NO_ACTION_NEEDED" } },
      { actionId: "MARK_OWNER_INBOX_ITEM", args: { item: I3, outcome: "ACTION_PLANNED", outcomeRef: PLAN } },
    ];
    const p = await planAction({ intentHe: "סיכום עדכוני היום", steps }, OWNER, d.d);
    ok("3 items → ONE plan with 3 previewed steps", p.status === "PREVIEW" && ((p.preview as { steps?: unknown[] })?.steps?.length === 3) && d.db.rows(ACT_TABLES.plans).length === 1, { s: p.status, m: p.messageHe ?? p.codes });
    const a = await approveAction({ planId: p.planId, planHash: p.planHash, confirmationText: "מאשר" }, OWNER, d.d);
    const e = await executeAction({ planId: p.planId, approvalToken: a.approvalToken, confirmationText: "מאשר" }, OWNER, d.d);
    ok("ONE approval executes all three, each verified", (e.status === "EXECUTED" || e.status === "APPLIED_AS_EXPECTED") && (e.steps as Array<{ status: string }>).every((x) => x.status === "APPLIED_AS_EXPECTED") && done(h.w.items[U(1)], "LEARNED_KNOWLEDGE", KNOW) && done(h.w.items[U(2)], "NO_ACTION_NEEDED", null) && done(h.w.items[U(3)], "ACTION_PLANNED", PLAN), { e: e.status, steps: e.steps });
    const twice = await planAction({ intentHe: "x", steps: [steps[1], { actionId: "MARK_OWNER_INBOX_ITEM", args: { item: I2, outcome: "DISMISSED" } }] }, OWNER, mkDeps(mk().writers).d);
    ok("the same item twice in one plan is refused (no chained re-marking)", twice.status !== "PREVIEW", twice.status);
  }

  console.log("\nNo auto-learning / auto-action");
  {
    const h = mk(); const r = await fullFlow(mkDeps(h.writers).d, "MARK_OWNER_INBOX_ITEM", { item: I1, outcome: "LEARNED_KNOWLEDGE", outcomeRef: KNOW }, "מאשר");
    ok("LEARNED_KNOWLEDGE only records the link: no knowledge / action writer is called", r.e?.status === "APPLIED_AS_EXPECTED" && h.w.knowledge === 27 && h.w.actions === 0 && h.calls.join() === "markOwnerInboxItem");
    const src = read("lib/partner/act/primitives/owner-inbox.ts");
    ok("the primitive has no knowledge / plan / push / finance / calendar path", !/propose|commitKnowledge|planAction|sendPush|transactions|google-calendar|owner-knowledge\/store/.test(src.replace(/\/\*[\s\S]*?\*\//g, "")));
    ok("its only writer is markOwnerInboxItem", (src.match(/d\.[a-zA-Z]+\(/g) ?? []).every((m) => ["d.listOwnerInboxNew(", "d.readOwnerInboxItem(", "d.markOwnerInboxItem("].includes(m)));
  }

  console.log("\nWiring");
  const c = ACTION_REGISTRY.get("MARK_OWNER_INBOX_ITEM");
  ok("READY contract from the primitive (no effects, NORMAL_BUSINESS, irreversible)", !!c && c.effects.length === 0 && c.riskClass === "NORMAL_BUSINESS" && c.reversible === "NO", c);
  const row = coverageOf(ACTION_REGISTRY.get("SUNNY.OWNER_INBOX_MARK_PROCESSED")!);
  ok("the census row is EXECUTABLE from Claude (by MARK_OWNER_INBOX_ITEM)", row?.klass === "EXECUTABLE" && row.claude === "EXECUTABLE_FROM_CLAUDE", row);
  ok("the key kind is addressable (NON_KEY_TARGETS → owner_inbox)", !!NON_KEY_TARGETS["owner-inbox"]);
  const server = read("lib/partner/act/server.ts");
  ok("MAIN wires the SAME shared writer with via SUNNY", server.includes('markOwnerInboxItemProcessed(store, "SUNNY"') && server.includes("@/lib/owner-inbox-store"));
  ok("the dashboard route keeps via DASHBOARD through the same writer", read("app/api/sunny/inbox/[id]/route.ts").includes('markOwnerInboxItemProcessed(store, "DASHBOARD"'));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
