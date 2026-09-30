/**
 * Owner Inbox MEMORY (Phase 1, Owner decision + approved SQL 2026-10-01): the pure rules, the store on a fake that does
 * EXACTLY what the applied SQL does (scripts/fixtures/inbox-memory-db.ts), concurrent idempotency, the ONE writer, the
 * Option A boundary (resolver in the writer, never claimed by the DB) and pins on the applied SQL.
 * Run with:   npx tsx scripts/test-inbox-memory.tsx      Pure; never touches production.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { FakeInboxMemoryDb } from "./fixtures/inbox-memory-db";
import { createInboxMemoryStore, type InboxMemoryClient } from "../lib/inbox-memory-store";
import { canonicalBallOf, freshnessOf, headOf, mapInterpretationRow, mapLinkRow, parseListText, type ProjectBasis } from "../lib/inbox-memory";
import { linkVerdict, resolveSurface, type ResolverProject } from "../lib/partner/knowledge/inbox-resolver";
import { normalizeName } from "../lib/partner/gateway/resolve";
import type { MentionEntry } from "../lib/partner/knowledge/inbox-mentions";
import { checkLink, linkInboxEntity, recordInboxInterpretation, retractInboxInterpretation, retractInboxLink, type InboxMemoryDeps } from "../lib/writes/inbox-memory";
import { checkOutcomeRef } from "../lib/owner-inbox";
import { markOwnerInboxItemProcessed } from "../lib/writes/owner-inbox";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 600)}` : ""}`); } };
const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// ── a tiny company: Closer (project), טל (client, short name) with one open song, a label artist with two open projects ──
const P_CLOSER = `project:${U(10)}`, P_TAL = `project:${U(11)}`, P_S1 = `project:${U(12)}`, P_S2 = `project:${U(13)}`, P_OLD = `project:${U(14)}`;
const C_TAL = `client:${U(20)}`, A_SHALEV = `label-artist:${U(30)}`;
const E = (key: string, name: string, type: MentionEntry["type"], group = key): MentionEntry => ({ key, type, name, norm: normalizeName(name), group });
const INDEX: MentionEntry[] = [E(P_CLOSER, "Closer", "project"), E(C_TAL, "טל", "client"), E(A_SHALEV, "שליו טסמה", "label-artist"), E(P_S1, "Summer", "project"), E(P_S2, "Winter", "project"), E(P_TAL, "Tal Song", "project"), E("vendor:STEVEN", "Steven", "vendor")];
const PROJECTS: ResolverProject[] = [
  { key: P_CLOSER, name: "Closer", status: "במיקס", artistText: "Someone", hidden: false },
  { key: P_TAL, name: "Tal Song", status: "בעבודה", artistText: "טל", hidden: false },
  { key: P_S1, name: "Summer", status: "בעבודה", artistText: "שליו טסמה", hidden: false },
  { key: P_S2, name: "Winter", status: "לא התחיל", artistText: "שליו טסמה", hidden: false },
  { key: P_OLD, name: "Old", status: "הושלם", artistText: "שליו טסמה", hidden: false },
];
const BODY = "Closer נשמע הרבה יותר טוב, נשאר לסדר את הבאקים ואז לשלוח לאמן. אצל טל סיימנו היום את הפזמון אבל עדיין אין בית שני. שליו טסמה מחכה לסטיבן";
const ITEM = U(1);

function world() {
  const db = new FakeInboxMemoryDb();
  db.items.set(ITEM, { body: BODY, status: "NEW", created_at: "2026-10-01T08:00:00Z" });
  db.items.set(U(2), { body: "עוד עדכון על Closer", status: "NEW", created_at: "2026-10-01T09:00:00Z" });
  for (const k of [P_CLOSER, P_TAL, P_S1, P_S2, P_OLD, C_TAL, A_SHALEV]) db.entities.add(k);
  const store = createInboxMemoryStore(db.client() as unknown as InboxMemoryClient);
  let basis: ProjectBasis | null = { status: "במיקס", ball: "ENGINEER", lastEventAt: "2026-09-30T10:00:00Z" };
  const deps: InboxMemoryDeps = {
    store,
    async readItem(id) { const x = db.items.get(id); return x ? { body: x.body, status: x.status } : null; },
    async readMemory() { const r = await store.readAll(); if (r.status !== "OK") throw new Error(r.detail); return r.value; },
    async resolverContext() { return { index: INDEX, projects: PROJECTS }; },
    async projectBasis() { return basis; },
  };
  return { db, store, deps, setBasis: (b: ProjectBasis | null) => { basis = b; } };
}

(async () => {
  console.log("Pure rules");
  ok("parseListText: one item per line, trimmed, empty lines dropped", JSON.stringify(parseListText(" a \n\n b\r\nc ", "x")) === JSON.stringify({ ok: true, items: ["a", "b", "c"] }));
  ok("parseListText: > 5 items / > 160 chars refused (the DB limits)", !parseListText("1\n2\n3\n4\n5\n6", "x").ok && !parseListText("x".repeat(161), "x").ok);
  ok("mapLinkRow refuses a key outside the contract / an unknown quality", mapLinkRow({ id: "a", item_id: "b", entity_key: "PROJECT:x", quality: "EXACT_UNIQUE", method: "RESOLVER_UNIQUE", surface: "ab", created_at: "t" }) === null && mapLinkRow({ id: "a", item_id: "b", entity_key: P_CLOSER, quality: "GUESS", method: "RESOLVER_UNIQUE", surface: "ab", created_at: "t" }) === null);
  ok("mapInterpretationRow refuses anything but HYPOTHESIS / OWNER_REPORTED_DERIVED", mapInterpretationRow({ id: "a", seq: 1, item_id: "b", link_id: "c", entity_key: P_CLOSER, what_happened: "x", completed: [], open_gaps: [], blockers: [], ball_with: "UNKNOWN", confidence: "LOW", epistemic: "FACT", source: "OWNER_REPORTED_DERIVED", created_at: "t" }) === null);
  ok("canonicalBallOf projects ONLY project_view's own signals (one party / MIXED / NONE)", canonicalBallOf(["AT_ENGINEER", "NO_DEADLINE"]) === "ENGINEER" && canonicalBallOf(["ENGINEER_RETURNED_WORK"]) === "OWNER" && canonicalBallOf(["AT_VICTOR", "AT_ENGINEER"]) === "MIXED" && canonicalBallOf(["STALE"]) === "NONE");
  const H = { basisStatus: "במיקס", basisEventAt: "2026-09-30T10:00:00Z", ballWith: "ENGINEER" as const };
  ok("freshness CURRENT when nothing recorded changed", freshnessOf(H, { status: "במיקס", ball: "ENGINEER", lastEventAt: "2026-09-30T10:00:00Z" }) === "CURRENT");
  ok("freshness OUTDATED_BY_CANONICAL after a later recorded event (e.g. Steven uploaded V2)", freshnessOf(H, { status: "במיקס", ball: "OWNER", lastEventAt: "2026-10-02T10:00:00Z" }) === "OUTDATED_BY_CANONICAL");
  ok("freshness OUTDATED_BY_CANONICAL after a status change", freshnessOf(H, { status: "הושלם", ball: "NONE", lastEventAt: "2026-09-30T10:00:00Z" }) === "OUTDATED_BY_CANONICAL");
  ok("freshness BALL_CONFLICT when the live ball contradicts (no new event)", freshnessOf(H, { status: "במיקס", ball: "OWNER", lastEventAt: "2026-09-30T10:00:00Z" }) === "BALL_CONFLICT");
  ok("UNKNOWN ball never conflicts; TEAM fits VICTOR / ENGINEER", freshnessOf({ ...H, ballWith: "UNKNOWN" }, { status: "במיקס", ball: "OWNER", lastEventAt: H.basisEventAt }) === "CURRENT" && freshnessOf({ ...H, ballWith: "TEAM" }, { status: "במיקס", ball: "VICTOR", lastEventAt: H.basisEventAt }) === "CURRENT");
  ok("live state not read → UNVERIFIED (never CURRENT by default)", freshnessOf(H, null) === "UNVERIFIED");
  ok("the word is `freshness` — never `currency` (currency is money in Redbloods)", !/currency/i.test(read("lib/inbox-memory.ts")) && !/currency/i.test(read("lib/partner/projects/memory.ts")) && !/currency/i.test(read("lib/partner/knowledge/capabilities/project-memory.ts")));

  console.log("\nThe resolver (Option A — enforced in the writer)");
  const R = (s: string) => resolveSurface(BODY, s, INDEX, PROJECTS);
  const rc = R("Closer");
  ok("a unique name → RESOLVER_UNIQUE for exactly that entity", rc.status === "OK" && linkVerdict(rc, P_CLOSER, "RESOLVER_UNIQUE", null).ok && !linkVerdict(rc, P_TAL, "RESOLVER_UNIQUE", null).ok);
  const rt = R("אצל טל");
  ok("a short name (טל) is never linked by itself: candidates = the client + her open project", rt.status === "OK" && rt.ambiguous.join() === [C_TAL, P_TAL].sort().join() && !linkVerdict(rt, P_TAL, "RESOLVER_UNIQUE", null).ok, rt);
  ok("…the Boss's answer links it (OWNER_ANSWER) only with EXACTLY the server's candidates", linkVerdict(rt, P_TAL, "OWNER_ANSWER", [P_TAL, C_TAL]).ok && !linkVerdict(rt, P_TAL, "OWNER_ANSWER", [P_TAL, P_CLOSER]).ok && !linkVerdict(rt, P_CLOSER, "OWNER_ANSWER", [C_TAL, P_TAL]).ok);
  const rs = R("שליו טסמה");
  ok("an artist with 2 open projects: the artist is unique; which project → a question (closed / hidden excluded)", rs.status === "OK" && linkVerdict(rs, A_SHALEV, "RESOLVER_UNIQUE", null).ok && rs.projects.join() === [P_S1, P_S2].sort().join() && !linkVerdict(rs, P_S1, "RESOLVER_UNIQUE", null).ok && linkVerdict(rs, P_S1, "OWNER_ANSWER", [P_S2, P_S1]).ok);
  ok("a surface that is not literally in the text → refused", R("Closers").status === "NOT_IN_TEXT" && resolveSurface(BODY, "Winter", INDEX, PROJECTS).status === "NOT_IN_TEXT");
  ok("a surface with two names → refused (one name per link)", R("Closer נשמע הרבה יותר טוב, נשאר לסדר את הבאקים ואז לשלוח לאמן. אצל טל").status === "SEVERAL_NAMES");
  ok("OWNER_ANSWER when the name is unique → refused (no question to ask)", !linkVerdict(rc, P_CLOSER, "OWNER_ANSWER", [P_CLOSER, P_TAL]).ok);

  console.log("\nThe writer (the ONE path) on the DB-faithful fake");
  {
    const w = world();
    const l1 = await linkInboxEntity(w.deps, { itemId: ITEM, entityKey: P_CLOSER, method: "RESOLVER_UNIQUE", surface: "Closer", candidates: null });
    ok("link Closer (EXACT_UNIQUE) → written", l1.status === "OK" && w.db.links.length === 1 && w.db.links[0].quality === "EXACT_UNIQUE", l1);
    const l2 = await linkInboxEntity(w.deps, { itemId: ITEM, entityKey: P_TAL, method: "RESOLVER_UNIQUE", surface: "אצל טל", candidates: null });
    ok("link the Tal song by the short name as RESOLVER_UNIQUE → refused (ask the Boss), nothing written", l2.status === "REFUSED" && l2.code === "AMBIGUOUS_ASK_OWNER" && w.db.links.length === 1, l2);
    const l3 = await linkInboxEntity(w.deps, { itemId: ITEM, entityKey: P_TAL, method: "OWNER_ANSWER", surface: "אצל טל", candidates: [C_TAL, P_TAL] });
    ok("…after the Boss's answer: OWNER_CONFIRMED with the stored candidate list", l3.status === "OK" && w.db.links[1].quality === "OWNER_CONFIRMED" && JSON.stringify(w.db.links[1].candidates) === JSON.stringify([C_TAL, P_TAL].sort()), l3);
    ok("a free entity (not among the candidates) is refused", (await linkInboxEntity(w.deps, { itemId: ITEM, entityKey: P_CLOSER, method: "OWNER_ANSWER", surface: "אצל טל", candidates: [C_TAL, P_TAL] })).status === "REFUSED");
    ok("the same entity twice on one item → ALREADY_LINKED", (await linkInboxEntity(w.deps, { itemId: ITEM, entityKey: P_CLOSER, method: "RESOLVER_UNIQUE", surface: "Closer", candidates: null })).status === "REFUSED");

    const base = { itemId: ITEM, projectKey: P_CLOSER, whatHappened: "הגרסה האחרונה השתפרה משמעותית", completed: "", openGaps: "תיקוני BGV", blockers: "תיקוני הבאקים לפני מסירה", ballWith: "UNKNOWN", inferredNextStep: "לסיים את תיקוני הבאקים ואז לשלוח לאמן", confidence: "MEDIUM", supersedeKind: null, supersedeReason: null, expectedHeadId: null };
    const i1 = await recordInboxInterpretation(w.deps, base);
    const row = w.db.interps[0];
    ok("interpretation for Closer → written as HYPOTHESIS with the SERVER's basis", i1.status === "OK" && row.epistemic === "HYPOTHESIS" && row.basis_status === "במיקס" && row.basis_ball === "ENGINEER" && row.basis_event_at === "2026-09-30T10:00:00Z" && JSON.stringify(row.open_gaps) === JSON.stringify(["תיקוני BGV"]), row);
    ok("a second one without supersedeKind → refused (the project already has an understanding)", (await recordInboxInterpretation(w.deps, { ...base, expectedHeadId: i1.status === "OK" ? i1.id : null })).status === "REFUSED");
    ok("a stale head (the preview's head moved) → HEAD_CHANGED, nothing written", (await recordInboxInterpretation(w.deps, { ...base, supersedeKind: "NEW_UPDATE", expectedHeadId: null })).status === "REFUSED" && w.db.interps.length === 1);
    ok("a CORRECTION without a reason → refused", (await recordInboxInterpretation(w.deps, { ...base, supersedeKind: "CORRECTION", expectedHeadId: i1.status === "OK" ? i1.id : null })).status === "REFUSED");
    const i2 = await recordInboxInterpretation(w.deps, { ...base, whatHappened: "הבאקים סודרו", openGaps: "", blockers: "", supersedeKind: "CORRECTION", supersedeReason: "הבוס תיקן: הבאקים כבר סגורים", expectedHeadId: i1.status === "OK" ? i1.id : null });
    const mem = await w.deps.readMemory();
    ok("CORRECTION supersedes: the new one is the head, the old one stays history (not deleted)", i2.status === "OK" && headOf(mem.interpretations, P_CLOSER)?.id === (i2.status === "OK" ? i2.id : "") && mem.interpretations.length === 2 && w.db.interps[1].supersedes_id === (i1.status === "OK" ? i1.id : ""));
    ok("no link for that project → NO_LINK (nothing written)", (await recordInboxInterpretation(w.deps, { ...base, projectKey: P_S1 })).status === "REFUSED" && w.db.interps.length === 2);
    ok("an interpretation only for a PROJECT (Phase 1)", (await recordInboxInterpretation(w.deps, { ...base, projectKey: C_TAL })).status === "REFUSED");
    w.setBasis(null);
    ok("the canonical basis unreadable → refused (never a basis-less understanding)", (await recordInboxInterpretation(w.deps, { ...base, projectKey: P_TAL })).status === "REFUSED" && w.db.interps.length === 2);
    const rI = await retractInboxInterpretation(w.deps, { interpretationId: i2.status === "OK" ? i2.id : "", reason: "טעות" });
    const mem2 = await w.deps.readMemory();
    ok("retracting the head → the previous active understanding is current again (kept, not deleted)", rI.status === "OK" && headOf(mem2.interpretations, P_CLOSER)?.id === (i1.status === "OK" ? i1.id : "") && mem2.interpretations.length === 2);
    ok("a retraction needs a reason", (await retractInboxLink(w.deps, { linkId: w.db.links[0].id as string, reason: " " })).status === "REFUSED");
    const rL = await retractInboxLink(w.deps, { linkId: w.db.links[0].id as string, reason: "לא התכוונתי ל-Closer" });
    const mem3 = await w.deps.readMemory();
    ok("retracting a link retracts its interpretations with it (history kept; the project has no current understanding)", rL.status === "OK" && headOf(mem3.interpretations, P_CLOSER) === null && mem3.interpretations.every((i) => !!i.retractedAt) && mem3.links.length === 2);
    ok("a retracted link is final (a different reason → ALREADY_RETRACTED; the same → replay)", (await retractInboxLink(w.deps, { linkId: w.db.links[0].id as string, reason: "אחר" })).status === "REFUSED" && (await retractInboxLink(w.deps, { linkId: w.db.links[0].id as string, reason: "לא התכוונתי ל-Closer" })).status === "OK");
    const relink = await linkInboxEntity(w.deps, { itemId: ITEM, entityKey: P_CLOSER, method: "RESOLVER_UNIQUE", surface: "Closer", candidates: null });
    ok("after a retract the right link is a NEW row (the old one stays retracted)", relink.status === "OK" && w.db.links.length === 3 && !!w.db.links[0].retracted_at);
  }

  console.log("\nConcurrent idempotency (the lookup AFTER the lock)");
  {
    const w = world(); w.db.opts.yieldBeforeLock = true;
    const k = randomUUID();
    const args = { itemId: ITEM, entityKey: P_CLOSER, method: "RESOLVER_UNIQUE" as const, surface: "Closer", candidates: null, requestKey: k };
    const [a, b] = await Promise.all([w.store.linkEntity(args), w.store.linkEntity(args)]);
    ok("two identical link calls at once → ONE write + ONE replay (same id), no duplicate, no raw error", a.status === "OK" && b.status === "OK" && a.value.id === b.value.id && [a.value.replayed, b.value.replayed].sort().join() === "false,true" && w.db.links.length === 1, { a, b });
    const k2 = randomUUID();
    const [c, d] = await Promise.all([w.store.linkEntity({ ...args, entityKey: P_TAL, method: "OWNER_ANSWER", surface: "אצל טל", candidates: [C_TAL, P_TAL], requestKey: k2 }), w.store.linkEntity({ ...args, entityKey: C_TAL, method: "OWNER_ANSWER", surface: "אצל טל", candidates: [C_TAL, P_TAL], requestKey: k2 })]);
    ok("same key + a different payload at once → one write + REQUEST_KEY_REUSED", [c, d].filter((x) => x.status === "OK").length === 1 && [c, d].some((x) => x.status === "REFUSED" && x.code === "REQUEST_KEY_REUSED") && w.db.links.length === 2, { c, d });
    const k3 = randomUUID();
    const [e, f] = await Promise.all([w.store.linkEntity({ ...args, requestKey: k3, entityKey: P_S1, surface: "שליו טסמה" }), w.store.linkEntity({ itemId: U(2), entityKey: P_CLOSER, method: "RESOLVER_UNIQUE", surface: "Closer", candidates: null, requestKey: k3 })]);
    ok("same key on two DIFFERENT items at once (no shared lock) → the UNIQUE turns into REQUEST_KEY_REUSED, never a raw error", [e, f].filter((x) => x.status === "OK").length === 1 && [e, f].some((x) => x.status === "REFUSED" && x.code === "REQUEST_KEY_REUSED"), { e, f });
    const linkId = w.db.links[0].id as string;
    const ia = { linkId, requestKey: randomUUID(), whatHappened: "x", completed: [], openGaps: [], blockers: [], ballWith: "UNKNOWN", inferredNextStep: null, confidence: "LOW", basisStatus: "במיקס", basisBall: "NONE", basisEventAt: null, supersedesId: null, supersedeKind: null, supersedeReason: null };
    const [g, h] = await Promise.all([w.store.recordInterpretation(ia), w.store.recordInterpretation(ia)]);
    ok("two identical interpretation calls at once → ONE write + ONE replay", g.status === "OK" && h.status === "OK" && g.value.id === h.value.id && w.db.interps.length === 1, { g, h });
    const [i, j] = await Promise.all([w.store.recordInterpretation({ ...ia, requestKey: randomUUID(), whatHappened: "y", supersedesId: g.status === "OK" ? g.value.id : null, supersedeKind: "NEW_UPDATE" }), w.store.recordInterpretation({ ...ia, requestKey: randomUUID(), whatHappened: "z", supersedesId: g.status === "OK" ? g.value.id : null, supersedeKind: "NEW_UPDATE" })]);
    ok("two DIFFERENT interpretations of one project at once → one wins, the other HEAD_CHANGED (the chain stays linear)", [i, j].filter((x) => x.status === "OK").length === 1 && [i, j].some((x) => x.status === "REFUSED" && x.code === "HEAD_CHANGED") && w.db.interps.length === 2, { i, j });
    const k4 = randomUUID();
    await w.store.recordInterpretation({ ...ia, requestKey: k4, whatHappened: "w", supersedesId: w.db.interps[1].id as string, supersedeKind: "NEW_UPDATE" });
    ok("a retry of the same interpretation with a different basis replays the FIRST write (basis is not in the hash)", (await w.store.recordInterpretation({ ...ia, requestKey: k4, whatHappened: "w", supersedesId: w.db.interps[1].id as string, supersedeKind: "NEW_UPDATE", basisStatus: "הושלם" })).status === "OK" && w.db.interps.length === 3);
    const w2 = world(); w2.db.opts.yieldBeforeLock = true; w2.db.opts.skipRelookup = true;
    const k5 = randomUUID();
    const [x, y] = await Promise.all([w2.store.linkEntity({ ...args, requestKey: k5 }), w2.store.linkEntity({ ...args, requestKey: k5 })]);
    ok("(control) WITHOUT the lookup after the lock the same race FAILS the retry (ALREADY_LINKED / a raw unique violation) — the fix is what makes it a replay", [x, y].filter((r) => r.status === "OK").length === 1 && [x, y].some((r) => r.status !== "OK"), { x, y });
  }

  console.log("\nOption A — the boundary is the writer (the DB never claims the resolver)");
  {
    const w = world();
    const raw = await w.store.linkEntity({ itemId: ITEM, entityKey: P_TAL, method: "RESOLVER_UNIQUE", surface: "אצל טל", candidates: null, requestKey: randomUUID() });
    ok("the DB (fake = the SQL) ACCEPTS a structurally valid RESOLVER_UNIQUE link for an ambiguous name — it does not claim the resolver", raw.status === "OK");
    const w2 = world();
    const viaWriter = await linkInboxEntity(w2.deps, { itemId: ITEM, entityKey: P_TAL, method: "RESOLVER_UNIQUE", surface: "אצל טל", candidates: null });
    ok("…the writer REFUSES it (the resolver is enforced there) — nothing reaches the RPC", viaWriter.status === "REFUSED" && w2.db.rpcCalls.length === 0);
    ok("the DB still enforces structure: a surface not in the text / an unknown entity / a non-candidate", (await w2.store.linkEntity({ itemId: ITEM, entityKey: P_CLOSER, method: "RESOLVER_UNIQUE", surface: "Nope", candidates: null, requestKey: randomUUID() })).status === "REFUSED" && (await w2.store.linkEntity({ itemId: ITEM, entityKey: `project:${U(99)}`, method: "RESOLVER_UNIQUE", surface: "Closer", candidates: null, requestKey: randomUUID() })).status === "REFUSED" && (await w2.store.linkEntity({ itemId: ITEM, entityKey: P_CLOSER, method: "OWNER_ANSWER", surface: "Closer", candidates: [C_TAL, P_TAL], requestKey: randomUUID() })).status === "REFUSED");
    const walk = (d: string): string[] => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (e.name === "node_modules" || e.name.startsWith(".") ? [] : walk(path.join(d, e.name))) : /\.(ts|tsx)$/.test(e.name) ? [path.join(d, e.name).replace(/\\/g, "/")] : []);
    const files = [...walk("lib"), ...walk("app"), ...walk("components")];
    const rpcUsers = files.filter((f) => /\(\s*"sunny_inbox_(link_entity|record_interpretation|retract_link|retract_interpretation)"/.test(read(f)));
    ok("the four RPCs are CALLED only in the store", JSON.stringify(rpcUsers) === JSON.stringify(["lib/inbox-memory-store.ts"]), rpcUsers);
    const storeWriters = files.filter((f) => f !== "lib/inbox-memory-store.ts" && /\.(linkEntity|recordInterpretation|retractLink|retractInterpretation)\(/.test(read(f)));
    ok("the store's write methods are called ONLY by the one writer (lib/writes/inbox-memory.ts)", JSON.stringify(storeWriters) === JSON.stringify(["lib/writes/inbox-memory.ts"]), storeWriters);
    ok("no route / page / component writes inbox memory", !files.some((f) => /^(app|components)\//.test(f) && /writes\/inbox-memory|inbox-memory-store/.test(read(f))));
    const prim = read("lib/partner/act/primitives/inbox-memory.ts");
    ok("no primitive argument carries a proof / basis / resolver result (the server computes them)", !/name: "(proof|basis\w*|resolver|payloadHash|requestKey|expectedHeadId)"/.test(prim));
    const writer = read("lib/writes/inbox-memory.ts");
    ok("the writer computes the basis itself (deps.projectBasis) and checks the resolver before any RPC", /deps\.projectBasis\(/.test(writer) && /checkLink\(deps, a\)/.test(writer) && writer.indexOf("checkLink(deps, a)") < writer.indexOf("store.linkEntity("));
    ok("the writer never touches a business record (no status / task / deadline / finance / proposal / release / alert / push path)", !/updateProject|writes\/(projects|tasks|finance|proposals|releases?|shows|sessions)|from\("|\.rpc\(|transactions|agent_alert|sendPush|google/i.test(writer.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")));
    ok("checkLink is the SAME rule for the preview and the write", /export async function checkLink/.test(writer) && /W\.checkLink\(deps, a\)/.test(read("lib/partner/act/server.ts")));
  }

  console.log("\nMEMORY_RECORDED (item level)");
  ok("MEMORY_RECORDED takes no reference", checkOutcomeRef("MEMORY_RECORDED", null).ok && !checkOutcomeRef("MEMORY_RECORDED", "pl_AbCdEfGhIjKlMnOpQrStUvWx").ok);
  {
    const calls: string[] = [];
    const fakeStore = { async markProcessed() { calls.push("mark"); return { status: "OK" as const, item: {} as never }; } } as never;
    const r = await markOwnerInboxItemProcessed(fakeStore, "DASHBOARD", { id: ITEM, outcome: "MEMORY_RECORDED" });
    ok("the dashboard can never set MEMORY_RECORDED (Sunny only), nothing written", r.status === "INVALID_INPUT" && calls.length === 0);
  }

  console.log("\nThe applied SQL (scripts/sql/2026-10-01-inbox-memory.sql)");
  {
    const sql = read("scripts/sql/2026-10-01-inbox-memory.sql");
    const fn = (name: string) => { const i = sql.indexOf(`FUNCTION public.${name}(`); return sql.slice(i, sql.indexOf("END $$;", i)); };
    ok("ONE transaction (BEGIN … COMMIT) with a precondition guard", /^BEGIN;/m.test(sql) && /COMMIT;\s*$/.test(sql) && sql.includes("PRECONDITION: mark_processed changed"));
    const link = fn("sunny_inbox_link_entity"), rec = fn("sunny_inbox_record_interpretation");
    const after = (s: string, lock: string) => s.slice(s.indexOf(lock)).includes("WHERE request_key = p_request_key");
    ok("link: the request_key lookup is repeated AFTER the item FOR UPDATE", after(link, "FROM public.sunny_owner_inbox WHERE id = p_item_id FOR UPDATE") && link.split("WHERE request_key = p_request_key").length === 3);
    ok("interpretation: the lookup is repeated AFTER the advisory / row locks", after(rec, "pg_advisory_xact_lock") && rec.split("WHERE request_key = p_request_key").length === 3);
    ok("a unique violation on the request_key constraint (named exactly) → REQUEST_KEY_REUSED; anything else re-raised", link.includes("v_con = 'sunny_inbox_links_request_key_key'") && rec.includes("v_con = 'sunny_inbox_interpretations_request_key_key'") && /RAISE;\s*END;/.test(link) && /RAISE;\s*END;/.test(rec));
    const mp = fn("sunny_owner_inbox_mark_processed");
    ok("mark_processed keeps the ref contract: ACTION_PLANNED plan id, LEARNED_KNOWLEDGE uuid, NO_ACTION_NEEDED / DISMISSED / MEMORY_RECORDED no ref", mp.includes("p_outcome = 'ACTION_PLANNED' AND (v_ref IS NULL OR v_ref !~ '^pl_[A-Za-z0-9_-]{16,64}$')") && mp.includes("p_outcome = 'LEARNED_KNOWLEDGE' AND (v_ref IS NULL OR v_ref !~*") && mp.includes("p_outcome IN ('NO_ACTION_NEEDED','DISMISSED','MEMORY_RECORDED') AND v_ref IS NOT NULL"));
    ok("…MEMORY_RECORDED needs an active link and an interpretation for every active project link", mp.includes("NO_MEMORY") && mp.includes("UNINTERPRETED_PROJECT_LINK"));
    ok("…and the rest is unchanged (same via check, NEW-only update, NOT_NEW_OR_MISSING)", mp.includes("INVALID_PROCESSED_VIA") && mp.includes("WHERE id = p_id AND status = 'NEW'") && mp.includes("NOT_NEW_OR_MISSING"));
    ok("the tables are SELECT-only for service_role; the RPCs EXECUTE for service_role only; the sequence has no grants", sql.includes("GRANT SELECT ON TABLE public.sunny_inbox_links, public.sunny_inbox_interpretations TO service_role;") && sql.includes("REVOKE ALL ON SEQUENCE public.sunny_inbox_interpretations_seq_seq FROM PUBLIC, anon, authenticated, service_role;") && /REVOKE ALL ON FUNCTION public\.sunny_inbox_link_entity[\s\S]*FROM PUBLIC, anon, authenticated;/.test(sql));
    ok("nothing is ever deleted (guard triggers refuse DELETE on items, links and interpretations)", (sql.match(/IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'NO_DELETE/g) ?? []).length === 3);
    const rb = read("scripts/sql/2026-10-01-inbox-memory-rollback.sql");
    ok("the rollback refuses itself when memory rows exist and restores the captured mark_processed", rb.includes("ROLLBACK_REFUSED") && rb.includes("1f88114b2083b4fdc7730a6819dbcad6") && rb.includes("CREATE OR REPLACE FUNCTION public.sunny_owner_inbox_mark_processed"));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
