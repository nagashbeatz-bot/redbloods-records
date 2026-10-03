/**
 * Sunny's KNOWLEDGE of the show close after Phase 1 + the DJ payment push (Owner decisions 2026-10-03).
 * Sunny reads the system contracts (system_awareness), the owner operating model, the action previews and the live show
 * capability text — a stale sentence there makes her describe the old "שולם לאמן" rule in a new conversation. This test pins
 * the CURRENT truth and fails if an old statement comes back:
 *   1. no "שולם לאמן" in the close; closing never creates a payment / payout to the artist;
 *   2. בוצע realizes the artist's entitlement as "הכנסות" in the balance (a credit);
 *   3. the payout to שליו / אבי is recorded only in the artist's balance / cycle;
 *   4. MARK_SHOW_FEE_PAID for the artist is refused (not a payment path);
 *   5. the DJ stays separate: DJ_FEE → שולם pushes CLEANTONE once, the Owner is told only after delivery;
 *   6. closing the show by itself sends no payment push — the 'שולם ל-DJ' tick can.
 * Run with:   npx tsx scripts/test-sunny-shows-phase1-knowledge.tsx
 */
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 300)}` : ""}`); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
// the current-state text of a registry file: the dated CAPABILITY_CHANGES history lines are changelog, not knowledge
const currentOf = (p: string) => read(p).split("\n").filter((l) => !/^\s*\{ version: "20\d\d\.\d\d\.\d\d-\d+"/.test(l)).join("\n");

const ML = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
const orig = ML._load;
ML._load = function (request: string, parent: unknown, isMain: boolean) { if (request === "server-only") return {}; return orig.call(this, request, parent, isMain); };

(async () => {
  const shows = currentOf("lib/partner/system/shows.ts");
  const label = currentOf("lib/partner/system/label-artists.ts");
  const registry = currentOf("lib/partner/system/registry.ts");
  const owner = currentOf("lib/partner/system/owner-model.ts");
  const people = currentOf("lib/partner/system/people.ts");
  const trans = currentOf("lib/partner/act/transitions.ts");
  const prims = currentOf("lib/partner/act/primitives/shows.ts");
  const deep = currentOf("lib/partner/knowledge/capabilities/shows-deep.ts");

  console.log("No stale statement of the old rule is served");
  const stale: Array<[string, string, RegExp]> = [
    ["shows contract: close transition has per-party paid / 'artist paid'", shows, /per-party paid|DJ paid \/ artist paid|PAYMENT if 'artist paid'|unticking 'artist paid'/],
    ["label-artists contract: a close pays the artist when 'artist paid' is ticked / asks 'was the artist paid?'", label, /'artist paid' is ticked|concept: "close-show dialog: בוצע \+ ledger income \(\+ payment\)"|was the artist paid/],
    ["label-artists contract: a close writes an optional REAL payment", label, /income \+ an optional REAL payment|tab \/ close \/ MARK_SHOW_FEE_PAID \/ Sunny/],
    ["registry: 'if the artist was paid, a payment row is added' / 'per-party payment' / the old close-preview bug", registry, /if the artist was paid, a payment row is added|Close a performed show with per-party payment|SHOW_CLOSE_PREVIEW_MISMATCH/],
    ["registry: DJ / artist fee row becomes שולם by the dialog / MARK_SHOW_FEE_PAID", registry, /שורת שכר DJ \/ אמן הופכת ל'שולם'/],
    ["owner model: 3 finance rows (artist fee = half of net) / CLOSE_SHOW is a future primitive / the artist ledger is frozen", owner, /3 finance rows|artist fee = half of net|CLOSE_SHOW — FUTURE_PRIMITIVE_REQUIRED|writes the artist ledger \(frozen\)/],
    ["owner model: the DJ / artist fee are 'marked paid' by the dialog / MARK_SHOW_FEE_PAID", owner, /Mark a DJ \/ artist fee paid only when/],
    ["people: the DJ portal pill shows whether the CLIENT paid", people, /מראה אם הלקוח שילם — לא אם הדי-ג׳יי קיבל תשלום/],
    ["action transitions: the close effect says 'who received payment → artist balance'", trans, /מי קיבל תשלום → כספים \/ מאזן אמן/],
    ["Sunny action previews: 'DJ שולם' / 'אמן שולם' mark the fee rows; the close sends no push at all", prims, /'DJ שולם' \/ 'אמן שולם'|"הפעלה חוזרת בטוחה, בלי כפילויות", "לא יישלח Push"/],
  ];
  for (const [name, text, re] of stale) ok(`not served: ${name}`, !re.test(text), text.match(re)?.[0]);

  console.log("\nThe current rule is served (1–4: the artist)");
  ok("1. registry: a canonical rule says closing never pays the artist; בוצע realizes the entitlement as 'הכנסות' (a credit); the payout is only in the artist's balance; MARK refuses the artist", /R\("SHOW_CLOSE_NO_ARTIST_PAYOUT", "CANONICAL_BUSINESS_RULE"/.test(registry) && /closing a show NEVER pays the artist/.test(registry) && /realized 'הכנסות' row in the artist's balance — a credit, not a payment/.test(registry) && /ONLY in the artist's balance/.test(registry) && /MARK_SHOW_FEE_PAID refuses the artist \(ARTIST_PAYOUT_VIA_BALANCE\)/.test(registry));
  ok("2. shows contract: the close transition has two ticks (client + DJ), writes the entitlement, never a payment / payout", /there is NO 'artist paid' — the dialog has two ticks, client \+ DJ/.test(shows) && /NEVER a payment \/ payout/.test(shows) && /NO PAYMENT is made by a close \(Phase 1/.test(shows));
  ok("3. label-artists contract: close = the entitlement only; the payout is recorded ONLY in the artist's balance / cycle (balance tab or ADD_LEDGER_ENTRY)", /the INCOME = the entitlement only — never a payment/.test(label) && /recorded ONLY in the artist's balance \/ cycle/.test(label) && /written ONLY from the artist.s balance/.test(label) );
  ok("4. MARK_SHOW_FEE_PAID is not an artist payment path: the primitive refuses the artist, the show contract and the coverage map say so", /a\.role === "ARTIST_FEE"\) return refuse\("ARTIST_PAYOUT_VIA_BALANCE"/.test(prims) && /The artist is refused \(ARTIST_PAYOUT_VIA_BALANCE, Phase 1\)/.test(shows) && !/"PROJECT\.RECORD_ARTIST_PAYMENT": \{ by: \[[^\]]*MARK_SHOW_FEE_PAID/.test(currentOf("lib/partner/act/coverage-map.ts")));
  ok("5. the action transition + the CLOSE_SHOW preview say the close enters the entitlement into the balance and pays no artist", /אין תשלום לאמן בסגירה/.test(trans) && /זכאות אחת להופעה נכנסת למאזן כשההופעה בוצעה — זה לא תשלום/.test(prims) && /the artist is NEVER paid by a close/.test(registry));
  ok("6. the artist payout contract: the ONLY artist payout path is the artist's balance (project actions + the ARTIST_PAYMENT workflow)", /the ONLY artist payout path: from the artist's balance, never from a show close or MARK_SHOW_FEE_PAID/.test(currentOf("lib/partner/system/project-actions.ts")) && /written ONLY from the artist's balance/.test(label));
  ok("7. the live show capability (every show_view / show_portfolio read) states: no 'שולם לאמן', entitlement ≠ payment, payout only in the balance; examples cover the question", /אין 'שולם לאמן' בסגירת הופעה/.test(deep) && /זו זכאות, לא תשלום/.test(deep) && /רק במאזן האמן/.test(deep) && /האם סגירת הופעה משלמת לאמן\?/.test(deep));

  console.log("\nThe DJ stays separate (5–8)");
  ok("8. registry: DJ_FEE is the DJ's source of truth; a real DJ_FEE → שולם pushes CLEANTONE once; the Owner is told only if that push was delivered; closing by itself sends no payment push", /R\("SHOW_DJ_PAYMENT_PUSH", "CANONICAL_BUSINESS_RULE"/.test(registry) && /pushes DJ CLEANTONE once per payment/.test(registry) && /only if that push was delivered the Owner gets a confirmation/.test(registry) && /Closing the show by itself sends no payment push/.test(registry));
  ok("9. shows contract: the DJ_PAYMENT_PAID notification (trigger, recipients, one claim per payment, failure never touches the money) and the close transition's push note", /id: "DJ_PAYMENT_PAID"/.test(shows) && /closing itself sends NO payment push; only the 'שולם ל-DJ' tick/.test(shows) && /dj_payment_paid:<DJ_FEE transaction id>/.test(shows));
  ok("10. push contract P_DJ_PAYMENT_PAID exists and CLEANTONE's page contract says the pill reads the DJ_FEE row and that he is pushed on payment", /id: "P_DJ_PAYMENT_PAID"/.test(people) && /שכר הדי-ג׳יי עצמו \(שורת DJ_FEE\) שולם — לא אם הלקוח שילם/.test(people) && /סגירת ההופעה עצמה לא שולחת Push תשלום/.test(people));
  ok("11. owner operating model: the show workflow lists 2 finance rows + the entitlement, the DJ push and its ordering; the rule text carries the Phase 1 + DJ decisions", /2 finance rows in the show currency \(expected balance, DJ fee\)/.test(owner) && /P_DJ_PAYMENT_PAID — when the DJ_FEE becomes שולם/.test(owner) && /The artist is NEVER paid from a show/.test(owner) && /only after that push was delivered the Owner gets a confirmation/.test(owner));
  ok("12. the CLOSE_SHOW and MARK_SHOW_FEE_PAID previews disclose the DJ push (declared PUSH effect) and that closing alone sends none", /effects: \["FINANCE", "LEDGER", "PUSH"\]/.test(prims) && /effects: \["FINANCE", "PUSH"\]/.test(prims) && /סגירת ההופעה עצמה לא שולחת Push תשלום/.test(prims) && /רק אם הוא הגיע — אישור אליך/.test(prims));
  ok("13. the live show capability states the DJ push rule (once, confirmation only after delivery, a failure never touches the money)", /ה-DJ נפרד: DJ_FEE הוא מקור האמת/.test(deep) && /ורק אם הוא הגיע — הבעלים מקבל אישור/.test(deep) && /כשל ב-Push לא נוגע בכסף/.test(deep) && /סגירת ההופעה עצמה לא שולחת Push תשלום/.test(deep));

  console.log("\nRuntime: the contracts as Sunny is served them");
  const ownerMod = await import("../lib/partner/system/owner-model");
  const showWf = (ownerMod.WORKFLOW_MODELS as ReadonlyArray<object>).find((w) => JSON.stringify(w).includes("P_DJ_PAYMENT_PAID"));
  ok("14. WORKFLOW_MODELS (served as operating_model) carries the DJ payment push", !!showWf, Object.keys(ownerMod).slice(0, 5));
  ok("15. OWNER_MODEL_VERSION moved (the owner model changed)", ownerMod.OWNER_MODEL_VERSION === "2026.10.03-owner-10", ownerMod.OWNER_MODEL_VERSION);
  const reg = await import("../lib/partner/system/registry");
  ok("16. the system baseline version covers this change and the changelog has the entry", reg.SYSTEM_BASELINE_VERSION === "2026.10.03-89" && reg.CAPABILITY_CHANGES.some((c) => c.version === "2026.10.03-89"), reg.SYSTEM_BASELINE_VERSION);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
