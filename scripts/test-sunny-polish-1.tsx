/**
 * SUNNY POLISH FIX #1 (2026-09-27) — pre-write duplicate awareness (B) + simple Owner approval (C).
 * (A — the Push sent-state — is proven in scripts/test-sunny-act-shows.tsx with fake senders.)
 * Run with:   npx tsx scripts/test-sunny-polish-1.tsx      Pure; in-memory fakes; never touches production, never pushes.
 */
import fs from "node:fs";
import path from "node:path";
import { fullFlow, mkDeps, OWNER, U } from "./fixtures/act-harness";
import { approveAction, executeAction, planAction } from "../lib/partner/act/service";
import { classifyApprovalText } from "../lib/partner/act/approval-text";
import { dupCandidates, textsSimilar } from "../lib/partner/act/primitives/duplicates";
import { ACTION_REGISTRY } from "../lib/partner/act/registry";
import { ACT_TABLES } from "../lib/partner/act/store-supabase";
import { SERVER_INSTRUCTIONS } from "../lib/integrations/partner-mcp/mcp";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 600)}` : ""}`); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");

type Entry = { artistId: string; entryType: string; amount: number; entryDate: string; description: string; note: string };
const A1 = `label-artist:${U(1)}`, A2 = `label-artist:${U(2)}`;
function mk() {
  const w = {
    artists: { [U(1)]: "אבי", [U(2)]: "אמן אחר" } as Record<string, string>,
    entries: {
      [U(10)]: { artistId: U(1), entryType: "הוצאות", amount: 400, entryDate: "2026-09-22", description: "אקו\"ם", note: "" },
      [U(11)]: { artistId: U(1), entryType: "הוצאות", amount: 250, entryDate: "2026-09-20", description: "הדפסות", note: "" },
      [U(12)]: { artistId: U(2), entryType: "הוצאות", amount: 400, entryDate: "2026-09-22", description: "אקו\"ם של אמן אחר", note: "" },
    } as Record<string, Entry>,
  };
  const calls: string[] = []; let n = 100;
  const writers = {
    async readLabelArtistFull(id: string) { return w.artists[id] ? { name: w.artists[id], status: "פעיל", notes: "", portalSlug: null } : null; },
    async readLedgerEntry(id: string) { const e = w.entries[id]; return e ? { entryType: e.entryType, amount: e.amount, entryDate: e.entryDate, description: e.description, note: e.note } : null; },
    async createLedgerEntry(e: Entry) { calls.push("createLedgerEntry"); const id = U(++n); w.entries[id] = { ...e }; return id; },
    // the focused, context-bound reader: same artist + type + amount (exactly like lib/writes/duplicates.ts)
    async similarRecords(q: { kind: string; artistId?: string; entryType?: string; amount?: number }) {
      calls.push(`similarRecords:${q.kind}`);
      return q.kind !== "LEDGER_ENTRY" ? [] : Object.values(w.entries).filter((e) => e.artistId === q.artistId && e.entryType === q.entryType && e.amount === q.amount).map((e) => ({ date: e.entryDate, amount: e.amount, currency: null, text: [e.description, e.note].filter(Boolean).join(" · ") }));
    },
  };
  return { w, calls, writers };
}
const LEDGER = (o: Record<string, unknown> = {}) => ({ labelArtist: A1, entryType: "הוצאות", amount: 400, entryDate: "2026-09-27", description: "רישום לאקו\"ם", ...o });
const plan = (d: ReturnType<typeof mkDeps>["d"], args: Record<string, unknown>, actionId = "ADD_LEDGER_ENTRY") => planAction({ intentHe: "רישום במאזן", actionId, args }, OWNER, d);
const writes = (c: string[]) => c.filter((x) => !x.startsWith("similarRecords"));

(async () => {
  console.log("B. Pre-write duplicate awareness");
  {
    const h = mk(); const { d, db } = mkDeps(h.writers);
    const p = await plan(d, LEDGER());
    ok("B1. the existing אקו\"ם expense (22.9 · 400₪) is surfaced BEFORE any plan — the Boss is asked: same or additional?", p.status === "POSSIBLE_DUPLICATE" && String(p.messageHe).includes("22.9.2026") && String(p.messageHe).includes("400") && String(p.messageHe).includes("אקו\"ם") && String(p.messageHe).includes("אותה הוצאה או הוצאה נוספת"), p);
    ok("B1b. nothing is written and no plan is stored while the Boss decides", writes(h.calls).length === 0 && db.rows(ACT_TABLES.plans).length === 0);
    ok("B6. no unrelated record leaks (another artist's entry, another amount)", !String(p.messageHe).includes("אמן אחר") && !String(p.messageHe).includes("הדפסות"));
  }
  {
    const h = mk(); const { d } = mkDeps(h.writers);
    const blind = await plan(d, LEDGER({ separateFromSimilar: true }));
    ok("B2a. separateFromSimilar alone (no server ack) is refused — Claude cannot bypass the Boss's decision", blind.status === "DUPLICATE_ACK_REQUIRED" && writes(h.calls).length === 0, blind.status);
    const held = await plan(d, LEDGER());
    ok("B2c. the POSSIBLE_DUPLICATE refusal carries a server ack (dack1.<exp>.<hex>) to use only after the Boss says 'additional'", held.status === "POSSIBLE_DUPLICATE" && /^dack1\.\d{13}\.[0-9a-f]{64}$/.test(String(held.duplicateAck)), held);
    const r = await fullFlow(d, "ADD_LEDGER_ENTRY", LEDGER({ separateFromSimilar: true, duplicateAck: held.duplicateAck }), "מאשר");
    const pj = JSON.stringify(r.p);
    ok("B2. the Boss said 'additional' → the plan is allowed, the preview still lists the existing one and says it is recorded separately", r.p.status === "PREVIEW" && pj.includes("קיימת רשומה") && pj.includes("נרשמת כרשומה נוספת"), r.p);
    ok("B5. the preview shows every important field, including the description", pj.includes("\"description\"") && pj.includes("רישום לאקו") && pj.includes("\"entryType\"") && pj.includes("\"entryDate\""));
    ok("B2b. executed once; the existing entry is untouched (no auto-delete / update / merge)", r.e?.status === "APPLIED_AS_EXPECTED" && writes(h.calls).join() === "createLedgerEntry" && h.w.entries[U(10)].description === "אקו\"ם" && Object.keys(h.w.entries).length === 4, { e: r.e?.status, calls: h.calls });
  }
  {
    const h = mk(); const { d } = mkDeps(h.writers);
    const diffAmount = await plan(d, LEDGER({ amount: 450 }));
    const farDate = await plan(d, LEDGER({ entryDate: "2026-05-01" }));
    const otherArtist = await plan(d, LEDGER({ labelArtist: A2, description: "משהו אחר לגמרי", entryDate: "2026-12-30" }));
    const otherType = await plan(d, LEDGER({ entryType: "הכנסות" }));
    ok("B3. a different amount / a far date / another artist / another type is never a hard duplicate", [diffAmount, farDate, otherArtist, otherType].every((x) => x.status === "PREVIEW"), [diffAmount.status, farDate.status, otherArtist.status, otherType.status]);
    ok("B3b. …and a different amount carries no similar-record warning at all", !JSON.stringify(diffAmount).includes("קיימת רשומה"));
    const near = await plan(d, LEDGER({ entryDate: "2026-09-24", description: "ציוד" }));
    ok("B3c. same amount, 2 days apart, a different description → not blocked, shown as 'דומה'", near.status === "PREVIEW" && JSON.stringify(near).includes("דומה:"), near.status);
    ok("B4. planning never writes (only the focused reader ran)", writes(h.calls).length === 0 && h.calls.every((x) => x === "similarRecords:LEDGER_ENTRY"));
  }
  {
    const h = mk(); const { d } = mkDeps(h.writers);
    const p = await plan(d, LEDGER({ amount: 700, description: "הפקה" }));
    h.w.entries[U(50)] = { artistId: U(1), entryType: "הוצאות", amount: 700, entryDate: "2026-09-27", description: "הפקה", note: "" }; // recorded elsewhere meanwhile
    const a = await approveAction({ planId: p.planId, planHash: p.planHash, confirmationText: "מאשר" }, OWNER, d);
    const e = await executeAction({ planId: p.planId, approvalToken: a.approvalToken, confirmationText: "מאשר" }, OWNER, d);
    ok("B7. a similar record appearing after the preview → STALE, nothing written (the candidates are part of the live fingerprint)", p.status === "PREVIEW" && e.status === "STALE" && writes(h.calls).length === 0, e.status);
  }
  ok("B8. deterministic matching: 'רישום לאקו\"ם' ~ 'אקו\"ם'; 'Q3 2026' ≁ 'Q2 2026'; 'ציוד' ≁ 'אקו\"ם'", textsSimilar("רישום לאקו\"ם", "אקו\"ם") && !textsSimilar("Q3 2026", "Q2 2026") && !textsSimilar("ציוד", "אקו\"ם"));
  ok("B8b. windows: similar text ≤ 45 days = LIKELY_SAME; other text ≤ 7 days = SIMILAR; beyond = nothing", dupCandidates([{ date: "2026-08-20", amount: 1, currency: null, text: "אקום" }], { date: "2026-09-27", text: "אקו\"ם" })[0]?.level === "LIKELY_SAME" && dupCandidates([{ date: "2026-09-21", amount: 1, currency: null, text: "x" }], { date: "2026-09-27", text: "ציוד" })[0]?.level === "SIMILAR" && dupCandidates([{ date: "2026-09-01", amount: 1, currency: null, text: "x" }], { date: "2026-09-27", text: "ציוד" }).length === 0);
  const DUP_ACTIONS = ["ADD_LEDGER_ENTRY", "ADD_TRANSACTION", "ADD_MEDIA_INCOME", "RECORD_RF_BUDGET_PAYMENT", "ADD_CLIP_PAYMENT", "RECORD_SHOW_PAYMENT"];
  ok("B9. one shared layer on every money CREATE: each takes the Boss's 'separate' decision as a typed argument", DUP_ACTIONS.every((id) => ACTION_REGISTRY.get(id)?.args.some((x) => x.name === "separateFromSimilar" && x.kind === "boolean" && !x.required)), DUP_ACTIONS.filter((id) => !ACTION_REGISTRY.get(id)?.args.some((x) => x.name === "separateFromSimilar")));
  const prim = ["label", "finance", "redfilms", "shows"].map((f) => read(`lib/partner/act/primitives/${f}.ts`)).join("\n");
  ok("B9b. …through the same gate (dupGate) — never a per-feature rule, never hardcoded to אקו\"ם", (prim.match(/dupGate\(/g) ?? []).length === 8 /* the six money CREATEs + the two DB-1 Red Films → Finance links */ && !/אקו/.test(prim) && !/אקו/.test(read("lib/partner/act/primitives/duplicates.ts").replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")));
  const reader = read("lib/writes/duplicates.ts");
  ok("B10. the reader is SELECT-only, focused (eq on context + amount) and capped", !/\.(insert|update|upsert|delete)\(/.test(reader) && (reader.match(/\.limit\(LIMIT\)/g) ?? []).length === 5 && (reader.match(/\.eq\("amount"|\.eq\("gross_amount"/g) ?? []).length === 5);

  console.log("\nC. Simple Owner approval — bound to the exact plan hash");
  const approve = (d: ReturnType<typeof mkDeps>["d"], p: Record<string, unknown>, text: string) => approveAction({ planId: p.planId, planHash: p.planHash, confirmationText: text }, OWNER, d);
  for (const [i, text] of [["C1", "מאשר"], ["C2", "כן, מאשר"], ["C3", "מאושר"]] as const) {
    const h = mk(); const r = await fullFlow(mkDeps(h.writers).d, "ADD_LEDGER_ENTRY", LEDGER({ amount: 700, description: "הפקה" }), text);
    ok(`${i}. "${text}" after a clear preview approves and executes once (money — no repeated values)`, r.e?.status === "APPLIED_AS_EXPECTED" && writes(h.calls).join() === "createLedgerEntry", { a: r.a?.status, e: r.e?.status });
  }
  {
    const h = mk(); const { d } = mkDeps(h.writers);
    const A = await plan(d, LEDGER({ amount: 700, description: "הפקה" }));
    const a = await approve(d, A, "מאשר");
    d.nowMs = () => Date.parse("2026-09-27T09:01:00Z");
    const B = await plan(d, LEDGER({ amount: 800, description: "הפקה" }));
    const wrongHash = await approveAction({ planId: B.planId, planHash: A.planHash, confirmationText: "מאשר" }, OWNER, d);
    const crossToken = await executeAction({ planId: B.planId, approvalToken: a.approvalToken, confirmationText: "מאשר" }, OWNER, d);
    ok("C4. an approval of plan A never approves / executes plan B (hash binding)", wrongHash.status === "PLAN_CHANGED" && crossToken.status === "REFUSED" && writes(h.calls).length === 0, { wrongHash: wrongHash.status, crossToken: crossToken.status });
  }
  {
    const h = mk(); const { d } = mkDeps(h.writers);
    const p = await plan(d, LEDGER({ amount: 700, description: "הפקה" }));
    const a = await approve(d, p, "מאשר");
    h.w.artists[U(1)] = "אבי (שם חדש)";
    const e = await executeAction({ planId: p.planId, approvalToken: a.approvalToken, confirmationText: "מאשר" }, OWNER, d);
    ok("C5. approved, then the live state changed → STALE, nothing runs", a.status === "APPROVED_PENDING_EXECUTION" && e.status === "STALE" && writes(h.calls).length === 0, e.status);
  }
  {
    const h = mk(); const { d } = mkDeps(h.writers);
    const p = await plan(d, LEDGER({ amount: 400, description: "הפקה", entryDate: "2026-12-30" }));
    const c6 = await approve(d, p, "מאשר אבל תעשה 500 במקום 400");
    ok("C6. \"מאשר אבל תעשה 500 במקום 400\" is NOT an approval of plan A (no token, nothing written — a new plan is needed)", p.status === "PREVIEW" && c6.status === "APPROVAL_WITH_CHANGES" && !c6.approvalToken && writes(h.calls).length === 0, c6.status);
  }
  {
    const h = mk(); const { d } = mkDeps(h.writers);
    const A = await plan(d, LEDGER({ amount: 700, description: "הפקה" }));
    d.nowMs = () => Date.parse("2026-09-27T09:02:00Z");
    const B = await plan(d, LEDGER({ amount: 900, description: "הקלטה" }));
    const aA = await approve(d, A, "מאשר");
    const aB = await approve(d, B, "מאשר");
    ok("C7. two open previews: the older one is never guessed (AMBIGUOUS_OPEN_PREVIEWS); the newest can be approved", aA.status === "AMBIGUOUS_OPEN_PREVIEWS" && !aA.approvalToken && aB.status === "APPROVED_PENDING_EXECUTION", { aA: aA.status, aB: aB.status });
  }
  {
    const h = mk(); const { d } = mkDeps(h.writers);
    const p = await plan(d, LEDGER({ amount: 700, description: "הפקה" }));
    const a = await approve(d, p, "מאשר");
    const e1 = await executeAction({ planId: p.planId, approvalToken: a.approvalToken, confirmationText: "מאשר" }, OWNER, d);
    const e2 = await executeAction({ planId: p.planId, approvalToken: a.approvalToken, confirmationText: "מאשר" }, OWNER, d);
    ok("C8. replaying the same approval never executes twice", e1.status === "APPLIED_AS_EXPECTED" && writes(h.calls).length === 1, { e1: e1.status, e2: e2.status, calls: h.calls });
  }
  {
    const h = mk(); const { d } = mkDeps(h.writers);
    const p = await plan(d, LEDGER({ amount: 700, description: "הפקה" }));
    const a = await approve(d, p, "מאשר");
    d.nowMs = () => Date.parse("2026-09-27T09:11:00Z");
    const e = await executeAction({ planId: p.planId, approvalToken: a.approvalToken, confirmationText: "מאשר" }, OWNER, d);
    d.nowMs = () => Date.parse("2026-09-27T09:16:00Z");
    const late = await approve(d, p, "מאשר");
    ok("C9. an expired approval / an expired plan never executes", e.status === "REFUSED" && JSON.stringify(e).includes("TOKEN_EXPIRED") && late.status === "EXPIRED" && writes(h.calls).length === 0, { e: e.status, late: late.status });
  }
  {
    ok("C10. destructive / finance / push keep their strong class, full preview and explicit approval", ["DELETE_CLIENT", "NOTIFY_SHOW_ARTIST", "NOTIFY_SHOW_DJ", "DELETE_SHOW"].every((id) => ACTION_REGISTRY.get(id)?.confirmation === "C3_STRONG_APPROVAL") && ["ADD_TRANSACTION", "ADD_LEDGER_ENTRY"].every((id) => ACTION_REGISTRY.get(id)?.confirmation === "C2_APPROVAL_WITH_VALUES"));
    const h = mk(); const { d } = mkDeps(h.writers);
    const p = await plan(d, LEDGER({ amount: 700, description: "הפקה" }));
    ok("C10b. the preview says \"מאשר\" is enough and a change means a new plan", JSON.stringify(p).includes("מספיק") && JSON.stringify(p).includes("תוכנית חדשה"));
    const no = await approve(d, p, "לא"); const wait = await approve(d, p, "רגע"); const empty = await approve(d, p, "   ");
    ok("C10c. \"לא\" / \"רגע\" / empty are never an approval", no.status === "NOT_AN_APPROVAL" && wait.status === "NOT_AN_APPROVAL" && empty.status === "APPROVAL_MISSING" && writes(h.calls).length === 0);
    const a = await approve(d, p, "מאשר");
    const claims = JSON.parse(Buffer.from(String(a.approvalToken).split(".")[1], "base64url").toString("utf8"));
    ok("C10d. the token binds hash + Owner + client + expiry + one-time nonce, and carries no repeated-value requirement", !!claims.ph && !!claims.o && !!claims.c && typeof claims.exp === "number" && !!claims.n && claims.v === undefined);
  }
  const plainVals = ["400", "₪400", "הוצאות", "2026-09-27", "label-artist:x"];
  ok("C11. the classifier: plan values may be repeated; a new number / currency / 'אבל' is a change", classifyApprovalText("כן בוס, ₪400 הוצאות 2026-09-27", plainVals).ok && classifyApprovalText("מאשר 400", plainVals).ok && !classifyApprovalText("מאשר 450", plainVals).ok && !classifyApprovalText("מאשר, בדולרים", plainVals).ok && !classifyApprovalText("מאשר אבל מחר", plainVals).ok && !classifyApprovalText("שלום", plainVals).ok);
  ok("C12. the Claude instructions: \"מאשר\" is enough, never ask to repeat values, a change = a new plan, ambiguous = ask", SERVER_INSTRUCTIONS.includes("is enough") && SERVER_INSTRUCTIONS.includes("NEVER ask him to repeat") && SERVER_INSTRUCTIONS.includes("NOT an approval") && SERVER_INSTRUCTIONS.includes("never guess"));
  ok("C13. no value-repeat enforcement is left server-side", !/CONFIRMATION_VALUES_MISSING/.test(read("lib/partner/act/service.ts") + read("lib/partner/act/approval.ts") + read("lib/partner/act/engine.ts")));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
