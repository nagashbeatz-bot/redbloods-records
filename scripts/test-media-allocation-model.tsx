/**
 * The media ALLOCATION model (Owner decision 2026-09-28; Owner-approved SQL applied 2026-09-29 after Stage 0 v2 PASS):
 *   ONE media income → ONE Finance income (full amount, ₪, RECORDS) → 0..N artist allocations → each allocation at most ONE
 *   ledger entitlement. The DB side (RPCs, constraints, grants, lifecycle, reversal, external-row ownership, Mobile1) was
 *   proven in production inside a rolled-back transaction (Stage 0 v2 A–L); this test proves the CODE side on fakes:
 *   the rule, the store → RPC arguments, the per-artist totals (never counted twice across the roster), Finance
 *   ownership, the legacy Mobile1 reading, and the wiring. No production, no network, no push.
 * Run with:   npx tsx scripts/test-media-allocation-model.tsx
 */
import Module from "node:module";
import fs from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 700)}` : ""}`); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");

type Row = Record<string, unknown>;
const DB: Record<string, Row[]> = {};
const t = (name: string) => (DB[name] ??= []);
const rpcCalls: Array<{ fn: string; args: Row }> = [];
function from(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let one = false;
  const run = () => { const rows = t(table).filter((r) => filters.every((f) => f(r))).map((r) => ({ ...r })); return { data: one ? rows[0] ?? null : rows, error: null }; };
  const c: Record<string, unknown> = {
    select() { return c; },
    eq(k: string, v: unknown) { filters.push((r) => r[k] === v); return c; },
    in(k: string, vs: unknown[]) { filters.push((r) => vs.includes(r[k])); return c; },
    order() { return c; },
    maybeSingle() { one = true; return Promise.resolve(run()); },
    single() { one = true; return Promise.resolve(run()); },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(run()).then(res, rej); },
  };
  return { select: () => c };
}
const rpc = async (fn: string, args: Row) => { rpcCalls.push({ fn, args }); return { data: "new-id", error: null }; };
const ML = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
const orig = ML._load;
ML._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  if (/(^|\/)supabase$/.test(request)) return { supabase: { from, rpc } };
  return orig.call(this, request, parent, isMain);
};

const SH = "8806fe5e-1238-4228-8078-b3db3ccc9b46", AV = "b3499c72-069d-46c9-9c31-52b1db27c51f", NB = "cbb64ff9-2208-49ce-9002-509b250e3ecd", EXT = "11111111-1111-4111-8111-111111111111";

(async () => {
  const R = await import("../lib/records-expense-share");
  const S = await import("../lib/media-income-store");
  const O = await import("../lib/finance/ownership");
  t("label_artists").push({ id: SH, name: "שליו טסמה" }, { id: AV, name: "אבי מולה" }, { id: NB, name: "נגש ביטס" }, { id: EXT, name: "אמן חיצוני" });

  console.log("The ONE rule (lib/records-expense-share mediaAllocationsOf)");
  const alloc = (kind: "DISTRIBUTION" | "YOUTUBE" | "ACUM", names: string[]) => R.mediaAllocationsOf(kind, names);
  const a = alloc("DISTRIBUTION", ["שליו טסמה"]), av = alloc("DISTRIBUTION", ["אבי מולה"]);
  ok("A. Shalev alone → one allocation 50 %", a.status === "DEFINED" && a.allocations.length === 1 && a.allocations[0].artistId === SH && a.allocations[0].pct === 50 && a.recordsPct === 50);
  ok("   Avi alone → one allocation 50 %", av.status === "DEFINED" && av.allocations.length === 1 && av.allocations[0].artistId === AV && av.allocations[0].pct === 50);
  const b = alloc("DISTRIBUTION", ["שליו טסמה", "אבי מולה"]);
  ok("B. Shalev + Avi → two allocations, 25 % each (Records 50 %)", b.status === "DEFINED" && b.allocations.length === 2 && b.allocations.every((x) => x.pct === 25) && new Set(b.allocations.map((x) => x.artistId)).size === 2 && b.recordsPct === 50);
  ok("C. YouTube → 0 allocations (100 % Records), whoever is credited", ["שליו טסמה", "אבי מולה"].every((n) => { const y = alloc("YOUTUBE", [n]); return y.status === "DEFINED" && y.allocations.length === 0 && y.recordsPct === 100; }));
  ok("D. ACUM → 0 allocations (100 % Records)", (() => { const y = alloc("ACUM", ["שליו טסמה", "אבי מולה"]); return y.status === "DEFINED" && y.allocations.length === 0 && y.recordsPct === 100; })());
  ok("E. NagashBeatz credited → 0 allocations (with Shalev, with Avi, alone)", [["נגש ביטס"], ["נגש ביטס", "שליו טסמה"], ["אבי מולה", "NagashBeatz"]].every((n) => { const y = alloc("DISTRIBUTION", n); return y.status === "DEFINED" && y.allocations.length === 0; }));
  ok("   a credit without a rule (an external / non-Records artist) → UNDEFINED, never a guessed split", alloc("DISTRIBUTION", ["אמן חיצוני"]).status === "UNDEFINED" && alloc("DISTRIBUTION", ["אמן חיצוני", "שליו טסמה"]).status === "UNDEFINED");
  ok("   amounts round to agorot like the RPC (round(gross × pct / 100, 2))", R.allocationAmountOf(2000, 25) === 500 && R.allocationAmountOf(765.5, 50) === 382.75 && R.allocationAmountOf(333.33, 25) === 83.33);
  ok("   the kind vocabulary = the DB CHECK (DISTRIBUTION / YOUTUBE / ACUM)", JSON.stringify(R.RECORDS_INCOME_KINDS) === JSON.stringify(["DISTRIBUTION", "YOUTUBE", "ACUM"]) && R.isRecordsIncomeKind("ACUM") && !R.isRecordsIncomeKind("X"));

  console.log("\nThe store → the RPC (the allocations come from the rule, never from the screen)");
  rpcCalls.length = 0;
  const c1 = await S.createMedia(SH, "שליו טסמה", { grossAmount: 2000, source: "Mobile1", reportPeriod: "Q3", status: "התקבל", requestKey: "req-00000001" });
  const x1 = rpcCalls[0];
  ok("A. Shalev distribution → create RPC with p_income_kind DISTRIBUTION, p_allocations [Shalev 50], the request key, no Finance link", c1.ok && x1.fn === "create_label_media_income" && x1.args.p_income_kind === "DISTRIBUTION" && JSON.stringify(x1.args.p_allocations) === JSON.stringify([{ artist_id: SH, artist_pct: 50 }]) && x1.args.p_request_key === "req-00000001" && x1.args.p_finance_transaction_id === null && x1.args.p_recoup_target === 0, x1);
  rpcCalls.length = 0;
  await S.createMedia(SH, "שליו טסמה", { grossAmount: 2000, source: "Mobile1", creditedArtistIds: [AV] });
  ok("B. Shalev + Avi → p_allocations [25, 25] (owner first, then the co-credited)", JSON.stringify(rpcCalls[0].args.p_allocations) === JSON.stringify([{ artist_id: SH, artist_pct: 25 }, { artist_id: AV, artist_pct: 25 }]), rpcCalls[0].args);
  rpcCalls.length = 0;
  await S.createMedia(SH, "שליו טסמה", { grossAmount: 2000, source: "YouTube" });
  await S.createMedia(SH, "שליו טסמה", { grossAmount: 2000, source: "Mobile1", incomeKind: "ACUM" });
  ok("C/D. YouTube (by source text) / ACUM (explicit kind) → p_allocations [] — still the allocation path (never NULL = legacy)", rpcCalls[0].args.p_income_kind === "YOUTUBE" && Array.isArray(rpcCalls[0].args.p_allocations) && (rpcCalls[0].args.p_allocations as unknown[]).length === 0 && rpcCalls[1].args.p_income_kind === "ACUM" && (rpcCalls[1].args.p_allocations as unknown[]).length === 0);
  rpcCalls.length = 0;
  await S.createMedia(NB, "נגש ביטס", { grossAmount: 2000 });
  await S.createMedia(SH, "שליו טסמה", { grossAmount: 2000, creditedArtistIds: [NB] });
  ok("E. NagashBeatz (owner or co-credited) → p_allocations []", rpcCalls.every((x) => Array.isArray(x.args.p_allocations) && (x.args.p_allocations as unknown[]).length === 0) && rpcCalls.length === 2);
  rpcCalls.length = 0;
  const und = await S.createMedia(EXT, "אמן חיצוני", { grossAmount: 2000 });
  const miss = await S.createMedia(SH, "שליו טסמה", { grossAmount: 2000, creditedArtistIds: ["nope"] });
  ok("an undefined credit / an unknown artist is refused BEFORE the RPC (LM400 / LM404) — nothing is written", !und.ok && und.code === "LM400" && /אין חוק חלוקה/.test(und.message) && !miss.ok && miss.code === "LM404" && rpcCalls.length === 0);
  rpcCalls.length = 0;
  await S.createMedia(SH, "שליו טסמה", { grossAmount: 2000, financeTransactionId: "00000000-0000-4000-8000-00000000f001" });
  ok("I. the Owner's existing Finance income is passed as p_finance_transaction_id (the RPC checks it matches; media never changes it)", rpcCalls[0].args.p_finance_transaction_id === "00000000-0000-4000-8000-00000000f001");

  console.log("\nUpdate (expected allocation-model income): a new kind / new credits → re-derived by the rule");
  t("label_media_income").push({ id: "exp1", label_artist_id: SH, income_kind: "DISTRIBUTION", source: "Mobile1" });
  t("label_media_income_allocations").push({ id: "al-exp1-sh", media_income_id: "exp1", artist_id: SH, artist_pct: 25, amount: 500, status: "active" }, { id: "al-exp1-av", media_income_id: "exp1", artist_id: AV, artist_pct: 25, amount: 500, status: "active" });
  rpcCalls.length = 0;
  await S.updateMedia("exp1", SH, "שליו טסמה", "ts", { grossAmount: 3000 });
  ok("G. amount only → p_allocations NULL (the RPC re-prices the SAME active allocations)", rpcCalls[0].fn === "update_label_media_income" && rpcCalls[0].args.p_allocations === null && rpcCalls[0].args.p_gross === 3000 && rpcCalls[0].args.p_income_kind === null);
  rpcCalls.length = 0;
  await S.updateMedia("exp1", SH, "שליו טסמה", "ts", { creditedArtistIds: [] });
  ok("G-remove. Avi removed from the credits → p_allocations [Shalev 50] (the RPC keeps Avi's entitlement at 0 with the reason)", JSON.stringify(rpcCalls[0].args.p_allocations) === JSON.stringify([{ artist_id: SH, artist_pct: 50 }]));
  rpcCalls.length = 0;
  await S.updateMedia("exp1", SH, "שליו טסמה", "ts", { incomeKind: "YOUTUBE" });
  ok("   kind → YouTube → p_allocations [] + p_income_kind YOUTUBE", rpcCalls[0].args.p_income_kind === "YOUTUBE" && Array.isArray(rpcCalls[0].args.p_allocations) && (rpcCalls[0].args.p_allocations as unknown[]).length === 0);
  rpcCalls.length = 0;
  await S.updateMedia("exp1", SH, "שליו טסמה", "ts", { incomeKind: "DISTRIBUTION" });
  ok("   kind only → the CURRENT active credits are kept (Shalev + Avi → 25 / 25)", JSON.stringify(rpcCalls[0].args.p_allocations) === JSON.stringify([{ artist_id: SH, artist_pct: 25 }, { artist_id: AV, artist_pct: 25 }]));

  console.log("\nPer-artist totals: gross + Records on the OWNER only, each artist its own allocation — never twice across the roster");
  DB.label_media_income = []; DB.label_media_income_allocations = [];
  const inc = (o: Row) => t("label_media_income").push({ record_type: "income", reverses_id: null, source: "Mobile1", report_period: "", received_date: "2026-09-29", notes: "", recoup_before: 0, recouped: 0, recoup_after: 0, created_at: `2026-09-29T0${t("label_media_income").length}:00:00Z`, updated_at: "x", income_kind: "DISTRIBUTION", allocation_model: true, finance_transaction_id: "fin", ...o });
  const al = (o: Row) => t("label_media_income_allocations").push({ status: "active", ...o });
  // LEGACY Mobile1 (exactly as in production)
  inc({ id: "mobile1", label_artist_id: SH, gross_amount: 765.5, label_share: 382.75, artist_share_gross: 382.75, artist_payable: 382.75, status: "התקבל", allocation_model: false, finance_transaction_id: null, income_kind: "DISTRIBUTION" });
  // B: Shalev + Avi 2,000 received (owner Shalev)
  inc({ id: "duo", label_artist_id: SH, gross_amount: 2000, label_share: 1000, artist_share_gross: 1000, artist_payable: 1000, status: "התקבל" });
  al({ id: "d-sh", media_income_id: "duo", artist_id: SH, artist_pct: 25, amount: 500 }); al({ id: "d-av", media_income_id: "duo", artist_id: AV, artist_pct: 25, amount: 500 });
  // C: YouTube 2,000 received (owner Avi) — 100 % Records
  inc({ id: "yt", label_artist_id: AV, gross_amount: 2000, label_share: 2000, artist_share_gross: 0, artist_payable: 0, status: "התקבל", income_kind: "YOUTUBE", source: "YouTube" });
  // expected Avi 1,000 (50 %)
  inc({ id: "exp", label_artist_id: AV, gross_amount: 1000, label_share: 500, artist_share_gross: 500, artist_payable: 0, status: "צפוי", received_date: null });
  al({ id: "e-av", media_income_id: "exp", artist_id: AV, artist_pct: 50, amount: 500 });
  // H: a received Shalev 2,000 that was reversed (allocation inactive after cancel) + its reversal row
  inc({ id: "rev-orig", label_artist_id: SH, gross_amount: 2000, label_share: 1000, artist_share_gross: 1000, artist_payable: 1000, status: "התקבל" });
  al({ id: "r-sh", media_income_id: "rev-orig", artist_id: SH, artist_pct: 50, amount: 1000, status: "inactive" });
  inc({ id: "rev", label_artist_id: SH, record_type: "reversal", reverses_id: "rev-orig", gross_amount: 2000, label_share: 1000, artist_share_gross: 1000, artist_payable: 1000, status: "התקבל", finance_transaction_id: null });
  // G: a cancelled expected income
  inc({ id: "canc", label_artist_id: SH, gross_amount: 3000, label_share: 1500, artist_share_gross: 1500, artist_payable: 0, status: "בוטל" });
  al({ id: "c-sh", media_income_id: "canc", artist_id: SH, artist_pct: 25, amount: 750, status: "inactive" }); al({ id: "c-av", media_income_id: "canc", artist_id: AV, artist_pct: 25, amount: 750, status: "inactive" });

  const sh = await S.getArtistMedia(SH, "שליו טסמה"), avm = await S.getArtistMedia(AV, "אבי מולה");
  ok("Shalev: gross = Mobile1 765.5 + duo 2,000 (the reversed pair and the cancelled income count nothing)", sh.totals.mediaGross === 2765.5, sh.totals);
  ok("Shalev: Records received = Mobile1 382.75 (legacy reading) + duo 1,000; artist share = 382.75 + his 500", sh.totals.labelShareReceived === 1382.75 && sh.totals.artistShareGross === 882.75, sh.totals);
  ok("Avi: sees the duo (not its owner): gross 0 from it; YouTube gross 2,000 → Records 2,000, artist 0; his duo share 500", avm.totals.mediaGross === 2000 && avm.totals.labelShareReceived === 2000 && avm.totals.artistShareGross === 500, avm.totals);
  ok("Avi: expected → Records 500 + his 500", avm.totals.labelShareExpected === 500 && avm.totals.artistShareExpected === 500, avm.totals);
  const sumGross = sh.totals.mediaGross + avm.totals.mediaGross, sumRecords = sh.totals.labelShareReceived + avm.totals.labelShareReceived, sumArtists = sh.totals.artistShareGross + avm.totals.artistShareGross;
  ok("across the roster: gross 4,765.5 = every income once; Records + artists = gross (no double count)", sumGross === 4765.5 && Math.round((sumRecords + sumArtists) * 100) / 100 === 4765.5, { sumGross, sumRecords, sumArtists });
  const duoOnBoth = sh.records.some((r) => r.id === "duo") && avm.records.some((r) => r.id === "duo");
  ok("the duo record is listed for BOTH artists (the label page dedupes by id), with its owner + allocations", duoOnBoth && avm.records.find((r) => r.id === "duo")!.primaryArtistId === SH && avm.records.find((r) => r.id === "duo")!.allocations.length === 2);
  const m1 = sh.records.find((r) => r.id === "mobile1")!;
  ok("J. Mobile1 stays LEGACY: allocationModel false, no Finance link, no allocations, 765.5 / 382.75 / 382.75", !m1.allocationModel && m1.financeTransactionId === null && m1.allocations.length === 0 && m1.grossAmount === 765.5 && m1.labelShare === 382.75 && m1.artistShareGross === 382.75);
  ok("   Mobile1 alone reads exactly as before the model (label 382.75 / artist 382.75 / payable 382.75)", (() => { DB.label_media_income = t("label_media_income").filter((r) => r.id === "mobile1"); return true; })() && await S.getArtistMedia(SH, "שליו טסמה").then((m) => m.totals.mediaGross === 765.5 && m.totals.labelShareReceived === 382.75 && m.totals.artistShareGross === 382.75 && m.totals.artistPayableTotal === 382.75 && m.totals.recoupedTotal === 0));

  console.log("\nFinance ownership: a media-created row is owned by the media lifecycle; the Owner's linked row stays the Owner's");
  ok("marker media_income:<id> → owner MEDIA_INCOME", O.ownerFromLinks({ linkedSessionId: "media_income:abc" }) === "MEDIA_INCOME");
  ok("the Owner's own row (no marker) → no owner (media never changes it)", O.ownerFromLinks({ linkedSessionId: "" }) === null);
  const amt = O.transactionEditVerdict("MEDIA_INCOME", ["amount"]), st = O.transactionEditVerdict("MEDIA_INCOME", ["paymentStatus"], "בוטל"), del = O.transactionEditVerdict("MEDIA_INCOME", "delete"), note = O.transactionEditVerdict("MEDIA_INCOME", ["notes", "paymentMethod"]);
  ok("a media-owned row: amount / status / delete refused in Finance (409, names the media screen); notes / method allowed", !amt.ok && !st.ok && !del.ok && note.ok && !amt.ok && /הכנסת מדיה/.test(amt.messageHe));
  ok("the RPC marks the row it creates with that marker (linked_session_id 'media_income:' || id)", O.MEDIA_INCOME_MARKER_PREFIX === "media_income:");

  console.log("\nWiring");
  const store = read("lib/media-income-store.ts"), modal = read("components/label/MediaModals.tsx"), page = read("components/label/LabelPage.tsx"), post = read("app/api/label/artists/[id]/media/route.ts");
  ok("the store sends every new create through the allocation path (p_allocations from the rule) — never NULL (= legacy)", /p_allocations: al\.allocations/.test(store) && /mediaAllocationsOf\(kind, names/.test(store));
  ok("the screen sends kind + credited artists + one request key per modal; edits / cancels address the OWNER (primaryArtistId)", /incomeKind: kind, creditedArtistIds: credited, requestKey/.test(modal) && /useState<string>\(\(\) => \(typeof crypto/.test(modal) && (modal.match(/artistId: record!?\.primaryArtistId/g) ?? []).length === 3);
  ok("the label page lists a shared income ONCE (by id) under its owner", /if \(seen\.has\(rec\.id\)\) continue;/.test(page) && /rec\.primaryArtistId/.test(page));
  ok("the create route validates kind / artists / request key / Finance id", /isRecordsIncomeKind\(body\.incomeKind\)/.test(post) && /creditedArtistIds/.test(post) && /requestKey/.test(post) && /financeTransactionId/.test(post));
  ok("no direct write to the media / allocation tables from the code (RPCs only)", !/from\("label_media_income(_allocations)?"\)\.(insert|update|upsert|delete)/.test(store + read("lib/writes/label.ts")));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
