/**
 * Universal Action Layer — Owner Inbox MEMORY (Phase 1, 2026-10-01): LINK_INBOX_ENTITY, RECORD_INBOX_INTERPRETATION,
 * RETRACT_INBOX_LINK, RETRACT_INBOX_INTERPRETATION through the REAL service, the REAL writer (lib/writes/inbox-memory)
 * and the REAL store, on a fake that does exactly what the applied SQL does. Standard checks (happy / invalid / missing /
 * wrong kind / stale / no approval / exact verify) + the Owner's own example end to end under the standing authorization
 * (ONE plan per update after the Boss's confirmation: links → interpretations → NO_ACTION_NEEDED), the ask-don't-guess rule, the locked 5-primitive
 * standing list (memory only), and the mixed-plan refusal.
 * Run with:   npx tsx scripts/test-sunny-act-inbox-memory.tsx      Pure; never touches production.
 */
import { randomUUID } from "node:crypto";
import { runCases, mkDeps, U, OWNER, type FamilyCase } from "./fixtures/act-harness";
import { FakeInboxMemoryDb } from "./fixtures/inbox-memory-db";
import { planAction, approveAction, executeAction, planStatus } from "../lib/partner/act/service";
import { STANDING_AUTHORIZATIONS, STANDING_PHRASE, STANDING_SCOPE } from "../lib/partner/act/standing";
import { INBOX_MEMORY_PRIMITIVES } from "../lib/partner/act/primitives/inbox-memory";
import { OWNER_INBOX_PRIMITIVES } from "../lib/partner/act/primitives/owner-inbox";
import { PRIMITIVES_BY_ID } from "../lib/partner/act/primitives";
import { ACTION_REGISTRY } from "../lib/partner/act/registry";
import { NON_KEY_TARGETS } from "../lib/partner/act/targets";
import { ACT_TABLES } from "../lib/partner/act/store-supabase";
import { createInboxMemoryStore, type InboxMemoryClient } from "../lib/inbox-memory-store";
import * as W from "../lib/writes/inbox-memory";
import { normalizeName } from "../lib/partner/gateway/resolve";
import { checkOutcomeRef } from "../lib/owner-inbox";
import type { MentionEntry } from "../lib/partner/knowledge/inbox-mentions";
import type { ResolverProject } from "../lib/partner/knowledge/inbox-resolver";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 700)}` : ""}`); } };

const P_CLOSER = `project:${U(10)}`, P_TAL = `project:${U(11)}`, C_TAL = `client:${U(20)}`;
const E = (key: string, name: string, type: MentionEntry["type"]): MentionEntry => ({ key, type, name, norm: normalizeName(name), group: key });
const BODY = "Closer נשמע הרבה יותר טוב, נשאר לסדר את הבאקים ואז לשלוח לאמן. אצל טל סיימנו היום את הפזמון אבל עדיין אין בית שני.";
const ITEM = U(1), I1 = `owner-inbox:${U(1)}`;

interface World { db: FakeInboxMemoryDb; item: { body: string; status: string; outcome: string | null; outcomeRef: string | null; processedVia: string | null }; index: MentionEntry[]; business: string[] }
function mk(seed?: (db: FakeInboxMemoryDb) => void) {
  const db = new FakeInboxMemoryDb();
  db.items.set(ITEM, { body: BODY, status: "NEW", created_at: "2026-10-01T08:00:00Z" });
  for (const k of [P_CLOSER, P_TAL, C_TAL]) db.entities.add(k);
  seed?.(db);
  const w: World = { db, item: { body: BODY, status: "NEW", outcome: null, outcomeRef: null, processedVia: null }, index: [E(P_CLOSER, "Closer", "project"), E(C_TAL, "טל", "client"), E(P_TAL, "Tal Song", "project")], business: [] };
  const projects: ResolverProject[] = [{ key: P_CLOSER, name: "Closer", status: "במיקס", artistText: "Someone", hidden: false }, { key: P_TAL, name: "Tal Song", status: "בעבודה", artistText: "טל", hidden: false }];
  const store = createInboxMemoryStore(db.client() as unknown as InboxMemoryClient);
  const calls: string[] = [];
  const deps: W.InboxMemoryDeps = {
    store,
    async readItem(id) { return id === ITEM ? { body: w.item.body, status: w.item.status } : null; },
    async readMemory() { const r = await store.readAll(); if (r.status !== "OK") throw new Error(r.detail); return r.value; },
    async resolverContext() { return { index: w.index, projects }; },
    async projectBasis(id) { return id === U(10) ? { status: "במיקס", ball: "ENGINEER", lastEventAt: "2026-09-30T10:00:00Z" } : { status: "בעבודה", ball: "NONE", lastEventAt: null }; },
  };
  const must = (r: W.MemoryWriteResult) => { if (r.status !== "OK") throw new Error(r.status === "REFUSED" ? `${r.code} ${r.messageHe}` : r.messageHe); return r.id; };
  // the SAME wiring as MAIN (lib/partner/act/server.ts inboxMemoryFamilyWriters) over the fake
  const writers = {
    async readOwnerInboxItem(id: string) { return id === ITEM ? { ...w.item } : null; },
    async listOwnerInboxNew() { return w.item.status === "NEW" ? [{ id: ITEM, body: w.item.body }] : []; },
    async readActionPlanState() { return "NOT_FOUND" as const; },
    async ownerKnowledgeExists() { return false; },
    async markOwnerInboxItem(id: string, outcome: string, ref: string | null) {
      calls.push("markOwnerInboxItem");
      const r = checkOutcomeRef(outcome as never, ref); if (!r.ok) throw new Error(r.code);
      if (id !== ITEM || w.item.status !== "NEW") throw new Error("NOT_NEW_OR_MISSING");
      Object.assign(w.item, { status: "PROCESSED", outcome, outcomeRef: r.ref, processedVia: "SUNNY" });
    },
    async readProjectMeta(id: string) { const p = projects.find((x) => x.key === `project:${id}`); return p ? { name: p.name, artist: p.artistText ?? "", status: p.status ?? "", isHidden: false, businessType: "לקוח", projectType: "", hasRelease: false } : null; },
    readInboxMemory: () => deps.readMemory(),
    async checkInboxLink(a: Parameters<typeof W.checkLink>[1]) { const v = await W.checkLink(deps, a); return v.ok ? { ok: true as const, method: v.method, candidates: v.candidates } : { ok: false as const, code: v.code, messageHe: v.messageHe }; },
    async createInboxLink(a: Parameters<typeof W.linkInboxEntity>[1]) { calls.push("createInboxLink"); return must(await W.linkInboxEntity(deps, a)); },
    async createInboxInterpretation(a: W.InterpretationInput) { calls.push("createInboxInterpretation"); return must(await W.recordInboxInterpretation(deps, a)); },
    async retractInboxLinkRow(id: string, reason: string) { calls.push("retractInboxLinkRow"); must(await W.retractInboxLink(deps, { linkId: id, reason })); },
    async retractInboxInterpretationRow(id: string, reason: string) { calls.push("retractInboxInterpretationRow"); must(await W.retractInboxInterpretation(deps, { interpretationId: id, reason })); },
  };
  return { w, calls, writers };
}
const L1 = U(50), X1 = U(60);
const seedLink = (db: FakeInboxMemoryDb, id = L1, entity = P_CLOSER) => { db.links.push({ id, item_id: ITEM, entity_key: entity, quality: "EXACT_UNIQUE", method: "RESOLVER_UNIQUE", surface: "Closer", candidates: null, request_key: randomUUID(), payload_hash: "x", created_at: "2026-10-01T08:01:00Z", retracted_at: null, retracted_reason: null }); };
const seedInterp = (db: FakeInboxMemoryDb, id = X1, seq = 1) => { db.interps.push({ id, seq, item_id: ITEM, link_id: L1, entity_key: P_CLOSER, what_happened: "קודם", completed: [], open_gaps: [], blockers: [], ball_with: "UNKNOWN", inferred_next_step: null, confidence: "LOW", epistemic: "HYPOTHESIS", source: "OWNER_REPORTED_DERIVED", basis_status: "במיקס", basis_ball: "ENGINEER", basis_event_at: null, supersedes_id: null, supersede_kind: null, supersede_reason: null, request_key: randomUUID(), payload_hash: "x", created_at: "2026-10-01T08:02:00Z", retracted_at: null, retracted_reason: null }); };
const active = (db: FakeInboxMemoryDb) => db.links.filter((l) => !l.retracted_at);

const CASES: FamilyCase<World>[] = [
  {
    id: "LINK_INBOX_ENTITY", args: { item: I1, entity: P_CLOSER, surface: "Closer", linkMethod: "RESOLVER_UNIQUE" },
    bad: { item: I1, entity: P_CLOSER, surface: "Closer", linkMethod: "GUESS" },
    missing: { item: `owner-inbox:${U(9)}`, entity: P_CLOSER, surface: "Closer", linkMethod: "RESOLVER_UNIQUE" },
    wrongKind: { item: `notification:${U(1)}`, entity: P_CLOSER, surface: "Closer", linkMethod: "RESOLVER_UNIQUE" },
    stale: (w) => seedLink(w.db),
    check: (w, calls) => active(w.db).length === 1 && active(w.db)[0].entity_key === P_CLOSER && active(w.db)[0].quality === "EXACT_UNIQUE" && calls.join() === "createInboxLink",
  },
  {
    id: "RECORD_INBOX_INTERPRETATION", args: { item: I1, project: P_CLOSER, whatHappened: "הגרסה האחרונה השתפרה משמעותית", openGaps: "תיקוני BGV", blockers: "תיקוני הבאקים לפני מסירה", inferredNextStep: "לסיים את תיקוני הבאקים ואז לשלוח לאמן", confidence: "MEDIUM" },
    bad: { item: I1, project: P_CLOSER, whatHappened: "x", confidence: "SURE" },
    missing: { item: I1, project: `project:${U(98)}`, whatHappened: "x", confidence: "LOW" },
    wrongKind: { item: I1, project: C_TAL, whatHappened: "x", confidence: "LOW" },
    stale: (w) => seedInterp(w.db),
    check: (w, calls) => w.db.interps.length === 1 && w.db.interps[0].epistemic === "HYPOTHESIS" && w.db.interps[0].basis_ball === "ENGINEER" && JSON.stringify(w.db.interps[0].blockers) === JSON.stringify(["תיקוני הבאקים לפני מסירה"]) && calls.join() === "createInboxInterpretation",
  },
  {
    id: "RETRACT_INBOX_LINK", args: { link: `inbox-link:${L1}`, reason: "לא התכוונתי ל-Closer" },
    bad: { link: `inbox-link:${L1}`, reason: "" },
    missing: { link: `inbox-link:${U(97)}`, reason: "x" },
    wrongKind: { link: `inbox-interpretation:${X1}`, reason: "x" },
    stale: (w) => { Object.assign(w.db.links[0], { retracted_at: "2026-10-01T09:00:00Z", retracted_reason: "אחר" }); },
    check: (w, calls) => !!w.db.links[0].retracted_at && w.db.links[0].retracted_reason === "לא התכוונתי ל-Closer" && !!w.db.interps[0].retracted_at && calls.join() === "retractInboxLinkRow",
  },
  {
    id: "RETRACT_INBOX_INTERPRETATION", args: { interpretation: `inbox-interpretation:${X1}`, reason: "הבנתי לא נכון" },
    bad: { interpretation: `inbox-interpretation:${X1}` },
    missing: { interpretation: `inbox-interpretation:${U(96)}`, reason: "x" },
    wrongKind: { interpretation: `inbox-link:${L1}`, reason: "x" },
    stale: (w) => { Object.assign(w.db.interps[0], { retracted_at: "2026-10-01T09:00:00Z", retracted_reason: "אחר" }); },
    check: (w, calls) => !!w.db.interps[0].retracted_at && w.db.interps[0].retracted_reason === "הבנתי לא נכון" && !w.db.links[0].retracted_at && calls.join() === "retractInboxInterpretationRow",
  },
];
const SEEDS: Record<string, (db: FakeInboxMemoryDb) => void> = {
  LINK_INBOX_ENTITY: () => undefined,
  RECORD_INBOX_INTERPRETATION: (db) => seedLink(db),
  RETRACT_INBOX_LINK: (db) => { seedLink(db); seedInterp(db); },
  RETRACT_INBOX_INTERPRETATION: (db) => { seedLink(db); seedInterp(db); },
};

(async () => {
  console.log("Inbox memory primitives — standard checks");
  ok("the case table covers every inbox-memory primitive", CASES.map((c) => c.id).join() === INBOX_MEMORY_PRIMITIVES.map((p) => p.actionId).join());
  for (const c of CASES) await runCases([c], () => mk(SEEDS[c.id]), ok);

  console.log("\nThe Owner's example — ONE update, ONE plan, standing authorization");
  {
    const h = mk(); const d = mkDeps(h.writers);
    const steps = [
      { actionId: "LINK_INBOX_ENTITY", args: { item: I1, entity: P_CLOSER, surface: "Closer", linkMethod: "RESOLVER_UNIQUE" } },
      { actionId: "LINK_INBOX_ENTITY", args: { item: I1, entity: P_TAL, surface: "אצל טל", linkMethod: "OWNER_ANSWER", candidates: `${C_TAL} ${P_TAL}` } },
      { actionId: "RECORD_INBOX_INTERPRETATION", args: { item: I1, project: P_CLOSER, whatHappened: "הגרסה האחרונה השתפרה משמעותית", openGaps: "תיקוני BGV", blockers: "תיקוני הבאקים לפני מסירה", inferredNextStep: "לסיים את תיקוני הבאקים ואז לשלוח לאמן", confidence: "MEDIUM" } },
      { actionId: "RECORD_INBOX_INTERPRETATION", args: { item: I1, project: P_TAL, whatHappened: "בוצעה עבודה על הפזמון בסשן האחרון", completed: "הפזמון (דווח ע״י הבעלים)", openGaps: "בית שני", inferredNextStep: "להשלים את הבית השני", confidence: "HIGH" } },
      { actionId: "MARK_OWNER_INBOX_ITEM", args: { item: I1, outcome: "NO_ACTION_NEEDED" } },
    ];
    const p = await planAction({ intentHe: "זיכרון מעדכון לסאני", steps }, OWNER, d.d);
    ok("5 steps → ONE plan (links, interpretations, mark)", p.status === "PREVIEW" && (p.preview as { steps?: unknown[] })?.steps?.length === 5, { s: p.status, m: p.messageHe ?? p.codes });
    const txt = JSON.stringify(p.preview ?? {});
    ok("the preview says HYPOTHESIS ≠ the project's state, and 'reported done' is not a status", txt.includes("HYPOTHESIS") && txt.includes("דווח כהושלם, לא סטטוס") && txt.includes("זיכרון בלבד"));
    const a = await approveAction({ planId: p.planId, planHash: p.planHash, confirmationText: STANDING_PHRASE }, OWNER, d.d);
    ok("approved with the standing phrase (approvedBy STANDING_AUTHORIZATION)", a.status === "APPROVED_PENDING_EXECUTION" && a.approvedBy === "STANDING_AUTHORIZATION", a);
    const e = await executeAction({ planId: p.planId, approvalToken: a.approvalToken, confirmationText: STANDING_PHRASE }, OWNER, d.d);
    ok("every step applied and verified", (e.status === "EXECUTED" || e.status === "APPLIED_AS_EXPECTED") && (e.steps as Array<{ status: string }>).every((x) => x.status === "APPLIED_AS_EXPECTED"), e);
    const L = active(h.w.db);
    ok("2 links: Closer EXACT_UNIQUE, the Tal song OWNER_CONFIRMED (from the server's candidates)", L.length === 2 && L.find((l) => l.entity_key === P_CLOSER)?.quality === "EXACT_UNIQUE" && L.find((l) => l.entity_key === P_TAL)?.quality === "OWNER_CONFIRMED");
    const tal = h.w.db.interps.find((i) => i.entity_key === P_TAL);
    ok("2 interpretations, one per project, each from the full text for THAT project (Tal: chorus reported done, second verse open)", h.w.db.interps.length === 2 && JSON.stringify(tal?.completed) === JSON.stringify(["הפזמון (דווח ע״י הבעלים)"]) && JSON.stringify(tal?.open_gaps) === JSON.stringify(["בית שני"]));
    ok("the item is closed with an EXISTING outcome (NO_ACTION_NEEDED: understanding confirmed, follow-ups captured in the project memory) via SUNNY", h.w.item.status === "PROCESSED" && h.w.item.outcome === "NO_ACTION_NEEDED" && h.w.item.processedVia === "SUNNY");
    ok("no business writer was called", h.w.business.length === 0 && h.calls.every((c) => ["createInboxLink", "createInboxInterpretation", "markOwnerInboxItem"].includes(c)), h.calls);
    const hist = await planStatus({ history: true }, OWNER, d.d);
    ok("history records STANDING_AUTHORIZATION", ((hist.items as Array<{ planId: string; approvedBy: string | null }>) ?? []).find((x) => x.planId === p.planId)?.approvedBy === "STANDING_AUTHORIZATION");
  }

  console.log("\nAsk, don't guess");
  {
    const h = mk(); const d = mkDeps(h.writers);
    const g = await planAction({ intentHe: "x", actionId: "LINK_INBOX_ENTITY", args: { item: I1, entity: P_TAL, surface: "אצל טל", linkMethod: "RESOLVER_UNIQUE" } }, OWNER, d.d);
    ok("a short / ambiguous name as RESOLVER_UNIQUE → refused at planning (AMBIGUOUS_ASK_OWNER), no plan", g.status === "AMBIGUOUS_ASK_OWNER" && !d.db.rows(ACT_TABLES.plans).length, g.status);
    const f = await planAction({ intentHe: "x", actionId: "LINK_INBOX_ENTITY", args: { item: I1, entity: P_CLOSER, surface: "אצל טל", linkMethod: "OWNER_ANSWER", candidates: `${C_TAL} ${P_TAL}` } }, OWNER, d.d);
    ok("an 'answer' outside the server's candidates → refused (no free entity)", f.status !== "PREVIEW", f.status);
    const m = await planAction({ intentHe: "x", actionId: "LINK_INBOX_ENTITY", args: { item: I1, entity: P_TAL, surface: "אצל טל", linkMethod: "OWNER_ANSWER", candidates: P_TAL } }, OWNER, d.d);
    ok("candidates that are not EXACTLY the server's list → refused", m.status === "CANDIDATES_MISMATCH", m.status);
  }

  console.log("\nMEMORY_RECORDED is retired — only the four existing outcomes");
  {
    const h = mk(); const d = mkDeps(h.writers);
    const p = await planAction({ intentHe: "x", actionId: "MARK_OWNER_INBOX_ITEM", args: { item: I1, outcome: "MEMORY_RECORDED" } }, OWNER, d.d);
    ok("MARK with MEMORY_RECORDED → refused at planning, nothing written", p.status !== "PREVIEW" && h.w.item.status === "NEW" && !d.db.rows(ACT_TABLES.plans).length, p.status);
  }

  console.log("\nStanding authorization — OWNER_MEMORY only");
  ok("the list is exactly the 5 memory primitives, scope OWNER_MEMORY", STANDING_SCOPE === "OWNER_MEMORY" && JSON.stringify([...STANDING_AUTHORIZATIONS].sort()) === JSON.stringify(["LINK_INBOX_ENTITY", "MARK_OWNER_INBOX_ITEM", "RECORD_INBOX_INTERPRETATION", "RETRACT_INBOX_INTERPRETATION", "RETRACT_INBOX_LINK"]));
  ok("every standing primitive declares NO effect (no push / calendar / finance / deletion / cascade …)", STANDING_AUTHORIZATIONS.every((id) => PRIMITIVES_BY_ID.get(id)?.meta.effects.length === 0), STANDING_AUTHORIZATIONS.map((id) => [id, PRIMITIVES_BY_ID.get(id)?.meta.effects]));
  ok("every standing primitive writes only through the inbox / inbox-memory writers", STANDING_AUTHORIZATIONS.every((id) => /lib\/writes\/(owner-inbox|inbox-memory)/.test(PRIMITIVES_BY_ID.get(id)?.meta.writer ?? "")));
  ok("each is registered READY / executable in the registry", STANDING_AUTHORIZATIONS.every((id) => ACTION_REGISTRY.get(id)?.availability === "SUNNY_EXECUTABLE"), STANDING_AUTHORIZATIONS.map((id) => ACTION_REGISTRY.get(id)?.availability));
  {
    const sysW = { async readBusinessGoals() { return { monthlyRevenue: { target: 20000, currency: "₪" } }; }, async setBusinessGoal() { throw new Error("must not write"); } };
    const h = mk(); const d = mkDeps({ ...h.writers, ...sysW });
    const p = await planAction({ intentHe: "x", steps: [{ actionId: "LINK_INBOX_ENTITY", args: { item: I1, entity: P_CLOSER, surface: "Closer", linkMethod: "RESOLVER_UNIQUE" } }, { actionId: "SET_BUSINESS_GOAL", args: { goal: "monthlyRevenue", target: 25000, currency: "₪" } }] }, OWNER, d.d);
    const a = await approveAction({ planId: p.planId, planHash: p.planHash, confirmationText: STANDING_PHRASE }, OWNER, d.d);
    ok("a MIXED plan (memory + a business action) with the standing phrase → NOT_AN_APPROVAL, nothing written", p.status === "PREVIEW" && a.status === "NOT_AN_APPROVAL" && active(h.w.db).length === 0, { p: p.status, a: a.status });
    const old = await approveAction({ planId: p.planId, planHash: p.planHash, confirmationText: "STANDING:OWNER_INBOX_HOUSEKEEPING" }, OWNER, d.d);
    ok("the retired phrase is not an approval", old.status === "NOT_AN_APPROVAL");
  }

  console.log("\nAddressability + registry");
  ok("inbox-link / inbox-interpretation targets are documented (NON_KEY_TARGETS)", !!NON_KEY_TARGETS["inbox-link"] && !!NON_KEY_TARGETS["inbox-interpretation"]);
  ok("MARK_OWNER_INBOX_ITEM offers exactly the four existing outcomes", JSON.stringify(OWNER_INBOX_PRIMITIVES[0].meta.args.find((x) => x.name === "outcome")?.values) === JSON.stringify(["LEARNED_KNOWLEDGE", "ACTION_PLANNED", "NO_ACTION_NEEDED", "DISMISSED"]));
  ok("no primitive argument is named method / proof / basis (typed business fields only)", INBOX_MEMORY_PRIMITIVES.every((p) => p.meta.args.every((x) => !/^(method|proof|basis.*|requestKey|payloadHash)$/.test(x.name))));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
