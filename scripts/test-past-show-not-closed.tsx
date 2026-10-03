/**
 * PAST_SHOW_NOT_CLOSED (Owner decision 2026-10-03): a PAID show whose date passed and that is still נסגר / אושרה.
 * Locks the law: עבר הזמן ≠ בוצע; no write; Sunny never assumes the show took place; an unpaid client does not prevent בוצע.
 * Run with:   npx tsx scripts/test-past-show-not-closed.tsx
 */
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 300)}` : ""}`); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const TODAY = "2026-10-03";
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const ML = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
const orig = ML._load;
ML._load = function (request: string, parent: unknown, isMain: boolean) { if (request === "server-only") return {}; return orig.call(this, request, parent, isMain); };

(async () => {
  const { pastUnclosedOf, PAST_SHOW_NEW_TODAY_DAYS } = await import("../lib/partner/shows/past-unclosed");
  type In = Parameters<typeof pastUnclosedOf>[0];
  const { buildNeedsMe } = await import("../lib/partner/needs-me/curate");
  const { buildShowView } = await import("../lib/partner/shows/view");
  type GatewaySources = Parameters<typeof buildNeedsMe>[0];

  const base: In = {
    name: "פסטידאנס ת\"א", date: "2026-10-02", status: "נסגר", dealType: "PAID", currency: "₪", today: TODAY, price: 2500, paymentStatus: "לא שולם", advancePayment: 0,
    financeRead: true, clientRemaining: 2500, hasDj: true, djRow: { exists: true, status: "צפוי", amount: 500 }, djFee: 500, entitlement: { type: "הכנסות צפויות", amount: 1000 },
  };
  const P = (o: Partial<In> = {}) => pastUnclosedOf({ ...base, ...o });

  console.log("The rule: date only, status נסגר / אושרה, PAID");
  ok("past + נסגר → PAST_SHOW_NOT_CLOSED", !!P());
  ok("past + אושרה → PAST_SHOW_NOT_CLOSED", !!P({ status: "אושרה" }));
  ok("today / future → not past", P({ date: TODAY }) === null && P({ date: "2026-10-04" }) === null);
  ok("בוצע / בוטל / a lead → not 'past, not closed'", P({ status: "בוצע" }) === null && P({ status: "בוטל" }) === null && P({ status: "ליד" }) === null);
  ok("an unpaid collaboration has no money layer → never", P({ dealType: "UNPAID_COLLAB" }) === null);
  ok("an unparseable date is never past", P({ date: "מחר" }) === null && P({ date: null }) === null);

  console.log("\nMoney raises urgency; it is never the reason a show enters");
  const p = P()!;
  ok("client 2,500 + DJ 500 open → HIGH_MONEY, NEW_TODAY (≤ 3 days)", p.urgency === "HIGH_MONEY" && p.group === "NEW_TODAY" && p.client.amount === 2500 && p.dj.amount === 500);
  ok("money line is the Owner's wording pieces", p.moneyLineHe === "2,500₪ מהלקוח עדיין פתוחים · DJ 500₪ עדיין פתוח", p.moneyLineHe);
  const old = P({ date: "2026-09-25" })!;
  ok(`after ${PAST_SHOW_NEW_TODAY_DAYS} days → YOUR_TASK, still present, age shown`, old.group === "YOUR_TASK" && old.ageDays === 8 && /לפני 8 ימים/.test(old.titleHe), old.titleHe);
  const dj = P({ clientRemaining: 0 })!;
  ok("only DJ open → DJ_OBLIGATION", dj.urgency === "DJ_OBLIGATION" && !dj.client.open && dj.dj.open);
  const none = P({ clientRemaining: 0, djRow: { exists: true, status: "שולם", amount: 500 } })!;
  ok("no money open → still an item (OPERATIONAL, YOUR_TASK), no invented money", none.urgency === "OPERATIONAL" && none.group === "YOUR_TASK" && none.moneyLineHe === "" && /אין כסף פתוח רשום/.test(none.whyHe));
  ok("artist entitlement is context only (never the money line / headline)", !!p.entitlementExpected && !/זכאות/.test(p.moneyLineHe) && !/זכאות/.test(p.titleHe) && /צפויה/.test(p.entitlementHe ?? ""));
  const mirror = P({ financeRead: false, clientRemaining: null, djRow: null })!;
  ok("Finance not read → the stored mirror, labelled; DJ unknown", mirror.client.basis === "MIRROR" && /הכספים לא נקראו/.test(mirror.clientHe ?? "") && !mirror.dj.known);

  console.log("\nThe law: עבר הזמן ≠ בוצע (Owner correction)");
  const all = [p.titleHe, p.whyHe, p.nextActionHe, p.ruleHe, p.sunnyHe, p.sunnyIfHeldHe, p.shortHe].join("\n");
  const stripC = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  ok("the pure module is read-only: no write / push / cron / fetch / db", !/\.(insert|update|upsert|delete)\(|sendPush|setInterval|fetch\(|supabase/.test(stripC(read("lib/partner/shows/past-unclosed.ts"))));
  ok("a past date alone never makes the show 'בוצע' (no status in the output; wording: it was SUPPOSED to take place)", !("status" in p) && /הייתה אמורה להתקיים/.test(p.sunnyHe) && /עבר הזמן ≠ בוצע/.test(p.ruleHe));
  ok("general wording asks what happened and does not assume it took place", /צריך לעדכן מה קרה בהופעה; אם היא התקיימה, לסגור אותה כבוצע ולתעד את מצב התשלומים/.test(p.sunnyHe));
  ok("if it did NOT take place it must not be בוצע — the next step says so", /אם לא — לעדכן סטטוס מתאים/.test(p.nextActionHe));
  ok("an unpaid client does not prevent בוצע (stated conditional on it having taken place)", /אם היא התקיימה — לסגור אותה כבוצע[\s\S]*חוב פתוח לא מונע סגירה/.test(p.nextActionHe));
  ok("NEVER the forbidden general rules", !/קודם סוגרים, אחר כך גובים|הלקוח לא שילם ⇒ סוגרים|סוגרים את ההופעה כבוצע והחוב נשאר פתוח/.test(all));
  ok("only the Owner-told variant (Festidance) uses his exact wording", p.sunnyIfHeldHe === "אתמול הייתה פסטידאנס ת\"א ועדיין לא סגרת אותה במערכת. 2,500₪ מהלקוח עדיין פתוחים ושכר ה-DJ בסך 500₪ עדיין פתוח. צריך לסגור את ההופעה ולתעד אם הלקוח שילם ואם ה-DJ שולם.", p.sunnyIfHeldHe);

  console.log("\nneeds_me: the card, its place, its button, no write");
  const show = (id: string, status: string, date: string, extra: object = {}) => ({ id, name: "פסטידאנס ת\"א", artistText: "שליו טסמה", date, startTime: "22:00", location: null, contactPerson: null, hasPhone: false, status, paymentStatus: "לא שולם", price: 2500, djFee: 500, artistFee: 0, advancePayment: 0, currency: "₪", notes: null, djClientId: U(99), djConfirmationStatus: null, artistClientId: null, bookerClientId: null, dealType: "PAID", ...extra });
  const src = (shows: unknown[]): GatewaySources => ({
    now: new Date(`${TODAY}T09:00:00Z`), identities: { cleantone: null },
    state: { status: "OK", value: { todayIL: TODAY, domains: { projects: { data: { index: {}, open: [] } }, clients: { data: { items: [] } }, labelArtists: { data: { items: [] } }, victor: { data: { active: [] } }, sessions: { data: { items: [] } }, releasesFull: { data: { items: [] } }, proposalsFull: { data: { items: [] } }, tasksFull: { data: { items: [] } } } } },
    operations: { status: "OK", value: { engineerWork: { rows: [], capped: false }, mixVersions: { rows: [], capped: false }, projectsMeta: { rows: [], capped: false }, projectActions: { rows: [], capped: false } } },
    projectDetail: { status: "OK", value: { victor: { rows: [], capped: false }, engineerWork: { rows: [], capped: false }, mixVersions: { rows: [], capped: false }, mixComments: { rows: [], capped: false }, mixTargets: { rows: [], capped: false }, mixTargetNotes: { rows: [], capped: false }, finalFiles: { rows: [], capped: false }, projectSettings: { rows: [], capped: false }, tasks: { rows: [], capped: false }, actions: { rows: [], capped: false } } },
    labelDetail: { status: "OK", value: { shows: { rows: shows, capped: false }, artists: { rows: [], capped: false } } },
    settings: { status: "OK", value: { families: {} } },
    actions: { status: "OK", value: [] }, integrity: { status: "OK", value: { questions: [] } },
    ownerInbox: { status: "OK", value: [] }, inboxMemory: { status: "OK", value: { links: [], interpretations: [] } },
    audience: { channel: "INTERNAL", ownerAuthorized: true },
  } as unknown as GatewaySources);
  const n = buildNeedsMe(src([show(U(1), "נסגר", "2026-10-02"), show(U(2), "אושרה", "2026-09-20", { name: "ישנה" }), show(U(3), "בוצע", "2026-10-01"), show(U(4), "נסגר", "2026-10-02", { dealType: "UNPAID_COLLAB", price: 0 })]));
  const a = n.items.find((i) => i.entityKey === `show:${U(1)}`);
  const b = n.items.find((i) => i.entityKey === `show:${U(2)}`);
  ok("yesterday + money → on the board in NEW_TODAY", a?.group === "NEW_TODAY", n.items.map((i) => [i.entityKey, i.group]));
  ok("the Owner holds the ball; title says it was not closed; nothing assumed", a?.ball.holder === "OWNER" && /עדיין לא נסגרה/.test(a?.title ?? ""));
  ok("the old past show stays (YOUR_TASK) with its age — not the backlog", b?.group === "YOUR_TASK" && (b?.waitingDays ?? 0) >= 13, b);
  ok("the button opens the existing close flow: /shows?close=<showId>", JSON.stringify(a?.open ?? {}).includes(`/shows?close=${U(1)}`), a?.open);
  ok("בוצע and UNPAID_COLLAB are not items", !n.items.some((i) => i.entityKey === `show:${U(3)}` || i.entityKey === `show:${U(4)}`));
  const v = buildShowView(src([show(U(1), "נסגר", "2026-10-02")]), U(1));
  ok("show_view carries the derived event + the signal", !!v?.pastUnclosed && JSON.stringify(v).includes("DATE_PASSED_NOT_CLOSED"));

  console.log("\nStatic: no auto-close, no push, no cron; the button is only a link");
  const hub = read("components/shows/ShowsHubPreview.tsx");
  ok("/shows?close only opens the existing modal", /close/.test(hub) && /CloseShowModal|setClos/i.test(hub));
  ok("the needs_me branch has no write", !/\.(insert|update|upsert|delete)\(|sendPush|setInterval/.test(stripC(read("lib/partner/needs-me/curate.ts"))));
  const om = read("lib/partner/system/owner-model.ts"), reg = read("lib/partner/system/registry.ts");
  ok("owner workflow PAST_SHOW_NOT_CLOSED exists and states עבר הזמן ≠ בוצע", /PAST_SHOW_NOT_CLOSED/.test(om) && /עבר הזמן ≠ בוצע/.test(om + reg));
  ok("the Finance receivable carries showId / showName", /showId/.test(read("lib/partner/finance/types.ts")) && /showName/.test(read("lib/partner/finance/types.ts")));
  ok("registry: canonical rule + changelog", /R\("PAST_SHOW_NOT_CLOSED", "CANONICAL_BUSINESS_RULE"/.test(reg) && /2026\.10\.03-89/.test(reg));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
