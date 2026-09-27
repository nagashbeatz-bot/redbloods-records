/**
 * UI ↔ Sunny PARITY (Phase C of the 2026-09-27 integrity mission).
 *
 * For every business fact the Owner reads on a screen AND asks Sunny about, the screen helper and the Sunny reader must
 * give the SAME answer on the same fixture — either because both call ONE shared rule (proved statically: both import
 * and call it, no local copy) or because two implementations agree on a shared fixture (proved by computing both).
 * Where a different rule genuinely remains, this test asserts that Sunny SURFACES it (a registered CONFLICT rule /
 * gap, or a documented difference) — never a silent disagreement.
 *
 * Covered: project received / remaining / paid / PRICE_UNKNOWN · show received / remaining · DJ / artist fee paid ·
 * show notification sent · project overdue · session happened / past-unconfirmed · mix paid · budget line paid ·
 * social overdue · release out · delivered · label classification · currency buckets never mixed.
 *
 * Pure: fixtures + source reads only. No Supabase, no network, no Push, no server.
 * Run with:   npx tsx scripts/test-sunny-ui-parity.tsx
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { buildProjectFinanceSummary, projectMoneyBadge, projectCollectible } from "../lib/finance/project-summary";
import { projectMoney } from "../lib/partner/projects/money";
import type { FinanceRaw, FinanceTxRow } from "../lib/partner/finance/types";
import { showMoneyOf, summarizeArtistFeeRows, SHOW_MONEY_ROLES, type ShowMoneyRow } from "../lib/shows-types";
import { showNotifyStateOf, type ShowNotifyClaimValue } from "../lib/show-notify-pure";
import { EXPECTED_STATUSES } from "../lib/finance/classify";
import { isProjectOverdue } from "../lib/project-deadline";
import { isPastUnconfirmed, sessionEndPassed, heldIsLegacyPossiblyAutoMarked } from "../lib/session-duration";
import { isEngineerWorkPaid, engineerPayStatus } from "../lib/mix-payment-pure";
import { budgetLinePaidState } from "../lib/clip-rf-money-pure";
import { isSocialItemOverdue, socialPhaseOf } from "../lib/types";
import { checkMissing } from "../lib/social-missing-checker";
import { isLabelProject, classificationSignal, rosterIdByNameOf, OWNER_LABEL_REGISTERED_ROSTER } from "../lib/project-classification";
import { normalizeCurrency } from "../lib/finance/currency";
import { DOMAIN_CONTRACTS } from "../lib/partner/system";
import { KNOWLEDGE_GAPS } from "../lib/partner/system/gaps";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}
const ok = (name: string, cond: boolean) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}`); fail++; } };
const section = (t: string) => console.log(`\n${t}`);
const ROOT = path.resolve(__dirname, "..");
const rd = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
/** Source without comments — a "uses the shared rule" check must not be satisfied by a comment. */
const code = (f: string) => rd(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const uses = (f: string, fn: string) => { const c = code(f); return new RegExp(`\\b${fn}\\(`).test(c) && new RegExp(`import\\s*(type\\s*)?\\{[^}]*\\b${fn}\\b[^}]*\\}`).test(c); };
const rule = (id: string) => DOMAIN_CONTRACTS.flatMap((d) => d.rules).find((r) => r.id === id);

// ── shared fixture: project money ────────────────────────────────────────────────────────────────────────────────────
const tx = (id: string, projectId: string, type: "income" | "expense", amount: number, status: string, o: Partial<FinanceTxRow> = {}): FinanceTxRow =>
  ({ id, projectId, type, date: "2026-09-01", amount, currency: "₪", status, category: null, scope: "project", expenseScope: null, linkedSessionId: null, createdAt: "2026-09-01T10:00:00Z", ...o });
const SETTINGS: Array<{ projectId: string; value: Record<string, unknown> }> = [
  { projectId: "P1", value: { agreedPrice: 1000, currency: "₪" } },          // partial
  { projectId: "P2", value: { agreedPrice: 1000, currency: "₪" } },          // paid in full
  { projectId: "P4", value: { agreedPrice: 0, currency: "₪" } },             // price 0 = unknown
  { projectId: "P5", value: { agreedPrice: 1000, currency: "₪" } },          // overpaid
  { projectId: "P6", value: { agreedPrice: 1000, currency: "₪", financeException: true } },
  { projectId: "P7", value: { agreedPrice: 1000, currency: "₪" } },          // cancelled project
  { projectId: "P8", value: { agreedPrice: 500, currency: "$" } },           // $ deal, ₪ income never counts
];
const TXS: FinanceTxRow[] = [
  tx("t1", "P1", "income", 600, "התקבל"), tx("t1b", "P1", "income", 400, "צפוי"), tx("t1c", "P1", "income", 200, "שולם", { expenseScope: "קליפ" }), tx("t1d", "P1", "income", 300, "שולם", { currency: "$" }),
  tx("t2", "P2", "income", 1000, "שולם"),
  tx("t3", "P3", "income", 500, "שולם"),                                       // no setting at all
  tx("t5", "P5", "income", 1200, "שולם"),
  tx("t6", "P6", "income", 100, "שולם"),
  tx("t7", "P7", "income", 200, "שולם"),
  tx("t8", "P8", "income", 900, "שולם"), tx("t8b", "P8", "income", 200, "שולם", { currency: "$" }),
];
const STATUS: Record<string, string> = { P1: "בעבודה", P2: "הושלם", P3: "בעבודה", P4: "בעבודה", P5: "הושלם", P6: "בעבודה", P7: "בוטל", P8: "בעבודה" };
const raw = { transactions: TXS, financeSettings: SETTINGS, projects: [], engineerWorks: [], shows: [], proposals: [], clients: [], labelArtists: [], ledger: [], mediaIncome: [], redFilmsPayments: [], victorSalary: [] } as unknown as FinanceRaw;
const uiSummary = buildProjectFinanceSummary(
  SETTINGS.map((s) => ({ project_id: s.projectId, agreedPrice: s.value.agreedPrice as number, currency: s.value.currency as string, financeException: s.value.financeException === true })),
  TXS.map((t) => ({ project_id: t.projectId, type: t.type, payment_status: t.status, amount: Number(t.amount), expense_scope: t.expenseScope, currency: t.currency })),
);
const ui = (id: string) => { const f = uiSummary[id]; return { f, badge: projectMoneyBadge(f), collectible: projectCollectible(f, STATUS[id]) }; };
const sunny = (id: string) => projectMoney(raw, { id, status: STATUS[id] });

async function main() {
  section("1. Project money — the Projects table badge (lib/finance/project-summary) vs Sunny's project_view money (lib/partner/projects/money)");
  {
    const a = ui("P1"), b = sunny("P1");
    check("P1 partial: received (song, deal currency only)", [a.f.paid, b.song?.received], [600, 600]);
    check("P1 partial: remaining", [a.badge.kind === "BALANCE" ? a.badge.balance : null, a.collectible, b.song?.collectible], [400, 400, 400]);
    ok("P1 partial: neither says paid", a.badge.kind === "BALANCE" && b.verdict === "DEBT" && b.song?.fullyPaid === false);
    ok("P1: clip income and $ income are NOT counted against the song price (both sides)", a.f.paid === 600 && b.song?.received === 600 && b.otherCurrencyIncome["$"]?.received === 300);
    const c = ui("P2"), d = sunny("P2");
    ok("P2 paid in full: UI PAID ⇔ Sunny NO_DEBT / fullyPaid", c.badge.kind === "PAID" && d.verdict === "NO_DEBT" && d.song?.fullyPaid === true && c.collectible === 0 && d.song?.collectible === 0);
    const e = ui("P4"), f = sunny("P4");
    ok("P4 agreed 0: PRICE_UNKNOWN on both — never 'paid', never 'free'", e.badge.kind === "PRICE_UNKNOWN" && f.verdict === "PRICE_UNKNOWN" && f.song === null && e.collectible === 0);
    const g = ui("P3"), h = sunny("P3");
    ok("P3 no price but income rows: UI PRICE_UNKNOWN (shows the received amount) ⇔ Sunny INSUFFICIENT_EVIDENCE (explains the price is unknown) — both refuse 'paid'",
      g.badge.kind === "PRICE_UNKNOWN" && g.badge.received === 500 && h.verdict === "INSUFFICIENT_EVIDENCE" && h.song === null && h.reasonsHe.some((r) => /מחיר/.test(r)));
    const i = ui("P5"), j = sunny("P5");
    check("P5 overpaid: credit on both", [i.badge.kind === "OVERPAID" ? i.badge.credit : null, j.verdict, j.song?.overpayment], [200, "OVERPAYMENT", 200]);
    const k = ui("P6"), l = sunny("P6");
    ok("P6 finance exception: no receivable on both", k.badge.kind === "EXCEPTION" && k.collectible === 0 && l.verdict === "FINANCE_EXCEPTION");
    const m = ui("P7"), n = sunny("P7");
    check("P7 cancelled project, expected income NOT cancelled: the same collectible number on both (the app nets only cancelled income rows)", [m.collectible, n.song?.collectible], [800, 800]);
    ok("documented difference: Sunny labels it PROJECT_CANCELLED (not debt) while the UI collection total still counts it until the expected income is cancelled", n.verdict === "PROJECT_CANCELLED" && n.reasonsHe.some((r) => /בוטל/.test(r)));
    const raw7b = { ...raw, transactions: [...TXS, tx("t7b", "P7", "income", 800, "בוטל")] } as unknown as FinanceRaw;
    const ui7b = buildProjectFinanceSummary([{ project_id: "P7", agreedPrice: 1000, currency: "₪" }], [{ project_id: "P7", type: "income", payment_status: "שולם", amount: 200, currency: "₪" }, { project_id: "P7", type: "income", payment_status: "בוטל", amount: 800, currency: "₪" }]);
    check("P7 once its expected income is cancelled: 0 collectible on both", [projectCollectible(ui7b.P7, "בוטל"), projectMoney(raw7b, { id: "P7", status: "בוטל" }).song?.collectible], [0, 0]);
    const o = ui("P8"), p = sunny("P8");
    check("P8 $ deal: only $ income counts (₪ rows never converted)", [o.f.currency, o.f.paid, p.price.currency, p.song?.received, p.otherCurrencyIncome["₪"]?.received], ["$", 200, "$", 200, 900]);
    ok("Projects table uses the shared summary + badge (no local 'שולם / התקבל' copy)", uses("components/projects/ProjectsTable.tsx", "buildProjectFinanceSummary") && uses("components/projects/ProjectsTable.tsx", "projectMoneyBadge"));
    ok("both sides use the ONE received-status rule (lib/finance/classify via isReceivedStatus / validateTx)", /isReceivedStatus/.test(code("lib/finance/project-summary.ts")) && /validateTx/.test(code("lib/partner/projects/money.ts")) && /isReceivedStatus/.test(code("lib/partner/finance/core.ts")));
  }

  section("2. Show money — Shows hub / show payments vs Sunny's show_view (showMoneyOf is the ONE rule)");
  {
    const rows: ShowMoneyRow[] = [
      { id: "s1", role: SHOW_MONEY_ROLES.PAYMENT, status: "התקבל", amount: 1500, currency: "₪", date: "2026-09-01" },
      { id: "s2", role: SHOW_MONEY_ROLES.PAYMENT, status: "צפוי", amount: 999, currency: "₪", date: "2026-09-02" },
      { id: "s3", role: SHOW_MONEY_ROLES.PAYMENT, status: "שולם", amount: 100, currency: "$", date: "2026-09-03" },
    ];
    const m = showMoneyOf({ show_price: 4000, currency: "₪" }, rows);
    check("received = payment rows שולם / התקבל in the show currency; remaining = agreed − received; another currency kept apart", [m.received, m.remaining], [1500, 2500]);
    ok("the finance sync and Sunny's show_view call showMoneyOf; the show-payments writer reads through the sync's showMoneyForShow (no second rule)", ["lib/partner/shows/view.ts", "lib/shows-finance-sync.ts"].every((f) => uses(f, "showMoneyOf")) && /showMoneyForShow\(/.test(code("lib/writes/show-payments.ts")) && /export async function showMoneyForShow[\s\S]{0,1200}showMoneyOf\(/.test(code("lib/shows-finance-sync.ts")));
  }

  section("3. DJ / artist fee paid — the DJ portal, the artist summary and Sunny read the fee row's OWN status (never the client payment)");
  {
    const fee = [
      { id: "f1", date: "2026-09-01", description: "שכר אמן", amount: 900, currency: "₪", payment_status: "שולם" },
      { id: "f2", date: "2026-09-05", description: "שכר אמן", amount: 700, currency: "₪", payment_status: "צפוי" },
      { id: "f3", date: "2026-09-06", description: "שכר אמן", amount: 300, currency: "$", payment_status: "שולם" },
    ];
    const s = summarizeArtistFeeRows(fee);
    check("artist fee paid = rows שולם, expected = rows צפוי, per currency", [s.paidTotal, s.expectedTotal, s.byCurrency.find((b) => b.currency === "$")?.paidTotal], [900, 700, 300]);
    ok("the label artist summary and Shalev's summary use summarizeArtistFeeRows on the ARTIST_FEE rows", uses("app/api/label/artists/[id]/summary/route.ts", "summarizeArtistFeeRows") && uses("app/api/red-artists/shalev-summary/route.ts", "summarizeArtistFeeRows"));
    const dj = code("app/api/red-artists/cleantone-summary/route.ts");
    ok("DJ portal pill = his DJ_FEE row status (the client payment is never returned as his)", /paymentStatus:\s*fees\[s\.id\]\?\.DJ_FEE\?\.status/.test(dj) && !/paymentStatus:\s*s\.payment_status/.test(dj));
    const view = code("lib/partner/shows/view.ts");
    ok("Sunny's show_view reads the DJ / artist fee rows by their own status (rowOf …status) and flags a paid-row mismatch with the app's rule", /status: t\.status/.test(view) && /feeRowPaidConflicts\(/.test(view));
  }

  section("4. Show notification sent — the send button / notify writers vs Sunny's show_view (showNotifyStateOf)");
  {
    const claim = (o: Partial<ShowNotifyClaimValue>): ShowNotifyClaimValue => ({ status: "sent", fingerprint: "fp1", claimedAt: "2026-09-01T10:00:00Z", sentAt: "2026-09-01T10:00:05Z", ...o });
    check("the one read rule: current / older version / failed / processing / none",
      [showNotifyStateOf(claim({}), "fp1").state, showNotifyStateOf(claim({}), "fp2").state, showNotifyStateOf(claim({ status: "failed", sentAt: undefined }), "fp1").state, showNotifyStateOf(claim({ status: "processing", sentAt: undefined }), "fp1").state, showNotifyStateOf(null, "fp1").state],
      ["SENT", "SENT_PREVIOUS_VERSION", "FAILED", "PROCESSING", "NOT_SENT"]);
    ok("the artist + DJ notify writers and Sunny's show_view all use showNotifyStateOf", uses("lib/show-notify.ts", "showNotifyStateOf") && uses("lib/dj-show-notify.ts", "showNotifyStateOf") && uses("lib/partner/shows/view.ts", "showNotifyStateOf"));
    const readers = ["lib/partner/shows/view.ts", "lib/partner/label/view.ts", "lib/partner/sunny/operating.ts"];
    ok("ALL THREE Sunny readers (show_view, artist_view, operating_model) use showNotifyStateOf with the show's current computeShowNotifyFingerprint — no inline sent mapping", readers.every((f) => uses(f, "showNotifyStateOf") && uses(f, "computeShowNotifyFingerprint") && !/status === "failed" \? "FAILED"/.test(code(f))));
  }

  section("5. Project overdue — every screen / push / report vs Sunny (lib/project-deadline isProjectOverdue)");
  {
    const T = "2026-09-27";
    const cases = [
      { deadline: "2026-09-20", status: "בעבודה", isHidden: false }, { deadline: "2026-09-20", status: "הושלם", isHidden: false },
      { deadline: "2026-09-20", status: "בהשהייה", isHidden: false }, { deadline: "2026-09-20", status: "בעבודה", isHidden: true },
      { deadline: "20/09/2026", status: "בעבודה", isHidden: false }, { deadline: "2026-09-27", status: "בעבודה", isHidden: false },
    ];
    check("overdue only for a valid past deadline on an open, visible project", cases.map((c) => isProjectOverdue(c, T)), [true, false, false, false, false, false]);
    ok("Projects table, project store, dashboard, push digest, reports, health, agent AND Sunny (project_view, operating model) all call isProjectOverdue",
      ["components/projects/ProjectsTable.tsx", "lib/projects-store.ts", "components/dashboard/StatsGrid.tsx", "lib/push-digest-pure.ts", "lib/reports/weekly.ts", "lib/health.ts", "lib/agent/rules.ts", "lib/partner/projects/view.ts", "lib/partner/sunny/operating.ts"].every((f) => uses(f, "isProjectOverdue")));
  }

  section("6. Session happened / past-unconfirmed — the drawers vs Sunny's session_view (lib/session-duration)");
  {
    const now = "2026-09-27T12:00:00";
    const s = (status: string, date: string, start: string | null, end: string | null) => ({ status, date, start_time: start, end_time: end });
    check("past-unconfirmed: planned + end passed (overnight-aware; a dated session with no times ends at the end of its day)",
      [isPastUnconfirmed(s("מתוכנן", "2026-09-20", "12:00", "14:00"), now), isPastUnconfirmed(s("מתוכנן", "2026-09-26", "22:00", "02:00"), now), isPastUnconfirmed(s("מתוכנן", "2026-09-26", null, null), now), isPastUnconfirmed(s("מתוכנן", "2026-09-27", null, null), now), isPastUnconfirmed(s("התקיים", "2026-09-20", "12:00", "14:00"), now)],
      [true, true, true, false, false]);
    ok("held on / before the retirement day is 'possibly auto-marked (legacy)'; after it is an explicit record", heldIsLegacyPossiblyAutoMarked(s("התקיים", "2026-09-20", "10:00", "12:00")) && !heldIsLegacyPossiblyAutoMarked(s("התקיים", "2026-09-28", "10:00", "12:00")));
    ok("the drawers use isPastUnconfirmed; Sunny's session_view uses the SAME sessionEndPassed (isPastUnconfirmed = מתוכנן && sessionEndPassed)",
      ["components/ui/ProjectDrawer.tsx", "components/ui/ProjectDrawerV2.tsx", "components/clients/ClientDrawer.tsx"].every((f) => uses(f, "isPastUnconfirmed")) && uses("lib/partner/work/view.ts", "sessionEndPassed") && /return s\.status === "מתוכנן" && sessionEndPassed\(s, nowLocal\)/.test(code("lib/session-duration.ts")));
    ok("documented difference: the drawer clock is the device wall clock, Sunny's is Israel time (display only; the Owner's device is in Israel)", /DISPLAY ONLY/.test(rd("lib/session-duration.ts")) && /israelNowString\(src\.now\)/.test(code("lib/partner/work/view.ts")));
    ok("no page load writes a session status (the auto-mark route is gone; nothing POSTs to it)", !fs.existsSync(path.join(ROOT, "app/api/sessions/auto-mark/route.ts")) && !/sessions\/auto-mark/.test(code("components/AppShell.tsx") + code("components/ui/ProjectDrawer.tsx")));
    ok("sessionEndPassed on its own agrees", sessionEndPassed(s("מתוכנן", "2026-09-26", null, null), now) && !sessionEndPassed({ date: null, start_time: "10:00", end_time: "11:00" }, now));
  }

  section("7. Mix paid — the Steven page vs Sunny's mix_view / project_view (lib/mix-payment-pure)");
  {
    const w = [{ agreedPrice: 200, amountPaid: 200, paymentDate: "2026-09-01" }, { agreedPrice: 200, amountPaid: 200, paymentDate: null }, { agreedPrice: 200, amountPaid: 50, paymentDate: "2026-09-01" }, { agreedPrice: 0, amountPaid: 0, paymentDate: null }];
    check("paid = agreed > 0, paid ≥ agreed AND a payment date (the page's chip derives from the same rule)", w.map((x) => [isEngineerWorkPaid(x), engineerPayStatus(x)]), [[true, "שולם"], [false, "חלקי"], [false, "חלקי"], [false, "לא שולם"]]);
    ok("the Steven page uses engineerPayStatus; the store, Sunny's mix_view, project_view and the mix_pipeline capability use isEngineerWorkPaid",
      uses("components/team/StevenProfilePage.tsx", "engineerPayStatus") && ["lib/sound-engineer-store.ts", "lib/partner/mix/view.ts", "lib/partner/projects/view.ts", "lib/partner/knowledge/capabilities/operations.ts"].every((f) => uses(f, "isEngineerWorkPaid")));
  }

  section("8. Budget line paid — the Red Films screen vs Sunny's video_view (budgetLinePaidState)");
  {
    const line = { planned_amount: 3000, currency: "₪", status: "שולם" };
    check("paid from payments in the line currency (the stored status is intent only)",
      [budgetLinePaidState(line, [{ amount: 1000, currency: "₪" }]).state, budgetLinePaidState(line, [{ amount: 3000, currency: "₪" }]).state, budgetLinePaidState(line, [{ amount: 3000, currency: "$" }]).state, budgetLinePaidState({ planned_amount: 0, currency: "₪", status: "מתוכנן" }, []).state],
      ["PARTIAL", "PAID", "UNPAID", "NO_PLAN"]);
    ok("the budget screen, the line modal, Sunny's video_view and the red_films capability all call budgetLinePaidState",
      ["components/red-films/RedFilmsBudgetItems.tsx", "components/red-films/BudgetItemDetailModal.tsx", "lib/partner/redfilms/view.ts", "lib/partner/knowledge/capabilities/operations.ts"].every((f) => uses(f, "budgetLinePaidState")));
  }

  section("9. Social overdue — the missing-content checker vs Sunny's social_view (socialPhaseOf / isSocialItemOverdue)");
  {
    const T = "2026-09-27";
    const items = [
      { status: "draft", due_date: "2026-09-20" }, { status: "published", due_date: "2026-09-20" }, { status: "posted", due_date: "2026-09-20" },
      { status: "cancelled", due_date: "2026-09-20" }, { status: "ready_to_post", due_date: "2026-09-30" },
    ];
    check("overdue only while not published / cancelled, past a strict due date", items.map((i) => isSocialItemOverdue(i, T)), [true, false, false, false, false]);
    check("one phase map covers both vocabularies", ["ready_to_post", "ready", "published", "posted", "cancelled", "idea"].map(socialPhaseOf), ["READY", "READY", "PUBLISHED", "PUBLISHED", "CANCELLED", "IDEA"]);
    const missing = checkMissing({ id: "c1", release_date: null } as never, [{ id: "i1", status: "draft", due_date: "2026-09-20", content_type: "reel", title: "ריל" } as never], T);
    ok("the checker reports the same overdue item", missing.some((m) => /1 תוכן שעבר תאריך יעד/.test(m.label)));
    ok("the checker and Sunny's social_view both use isSocialItemOverdue", uses("lib/social-missing-checker.ts", "isSocialItemOverdue") && /isSocialItemOverdue/.test(code("lib/partner/work/view.ts")));
  }

  section("10. Release out — the label page vs Sunny (the stage decides)");
  {
    ok("Sunny's label view and company view decide 'out' by the stage יצא", /r\.stage === "יצא"/.test(code("lib/partner/label/view.ts")) && /r\.stage === "יצא"/.test(code("lib/partner/company/view.ts")));
    ok("documented difference: the label page's 'released' list needs a date (cadence), Sunny counts יצא without a date as 'released — date unknown' (never hidden)",
      /releaseStage === "יצא" && r\.release\.releasedAt/.test(code("components/label/LabelPage.tsx")) && /releasedUnknownDate/.test(code("lib/partner/company/view.ts")) && rule("RELEASED_AT_FIRST_RELEASE")?.text.includes("date unknown") === true);
  }

  section("11. Delivered — the project drawer vs Sunny's delivery_view (only the delivery record)");
  {
    ok("the drawer shows 'delivered' only from the record's status (+ its date)", /delivery\.deliveryStatus === "delivered"/.test(code("components/ui/ProjectDrawer.tsx")));
    ok("Sunny: DELIVERY_RECORDED only from status delivered; DELIVERED_BEFORE is history, not current", /d\?\.status === "delivered" \? "DELIVERY_RECORDED" : d\?\.lastDeliveredAt \? "DELIVERED_BEFORE"/.test(code("lib/partner/work/view.ts")));
  }

  section("12. Label classification — screens vs Sunny (the ONE stored business type)");
  {
    check("isLabelProject reads only the stored type", [isLabelProject({ businessType: "לייבל" }), isLabelProject({ businessType: "לקוח" }), isLabelProject({ businessType: null })], [true, false, false]);
    const roster = rosterIdByNameOf(OWNER_LABEL_REGISTERED_ROSTER);
    const sig = classificationSignal({ businessType: "לקוח", artistText: OWNER_LABEL_REGISTERED_ROSTER[0].name }, roster);
    ok("a stored לקוח crediting Shalev is MISMATCH_OWNER_RULE (never auto-fixed) — the drawer control and Sunny share classificationSignal", sig?.code === "MISMATCH_OWNER_RULE" && sig.fix === "OWNER_ACTION_SET_PROJECT_BUSINESS_TYPE" && uses("components/ui/ProjectDrawerV2.tsx", "classificationSignal"));
    ok("Sunny's label view, company view and operating model use isLabelProject; the projects list's roster flag is documented as a SORT HINT ONLY (never a classification)", ["lib/partner/label/view.ts", "lib/partner/company/view.ts", "lib/partner/sunny/operating.ts"].every((f) => uses(f, "isLabelProject")) && /SORT HINT ONLY/.test(rd("lib/projects-sort-meta.ts")));
  }

  section("13. Currency buckets — never mixed");
  {
    ok("normalizeCurrency: blank → ₪, others kept", normalizeCurrency(null) === "₪" && normalizeCurrency("$") === "$");
    ok("the project badge carries the deal currency; Sunny lists other currencies apart", ui("P1").badge.kind === "BALANCE" && (ui("P1").badge as { currency: string }).currency === "₪" && Object.keys(sunny("P1").otherCurrencyIncome).join() === "$");
    ok("no writer multiplies by the working ratio (3.25 is an estimate in notes only)", !/\*\s*3\.25|APP_PAYMENT_RATIO\s*\*/.test(code("lib/writes/mix.ts") + code("lib/sound-engineer-store.ts")));
    ok("Sunny uses the ratio only to CHECK a historical ₪ row against the retired rule (ratioExpected), never as money", /const ratioExpected = /.test(code("lib/partner/mix/view.ts")));
  }

  section("14. Where a different rule remains, Sunny surfaces it (never a silent disagreement)");
  {
    ok("'expected income' is ONE rule now: the former conflict is closed (CANONICAL_BUSINESS_RULE naming isExpectedStatus)", rule("EXPECTED_INCOME_CONFLICT")?.class === "CANONICAL_BUSINESS_RULE" && /isExpectedStatus/.test(rule("EXPECTED_INCOME_CONFLICT")?.text ?? "") && rule("LO_SHULAM_INCOME_CONFLICT")?.class === "CANONICAL_BUSINESS_RULE");
    const expectedScreens = ["lib/finance/stats.ts", "components/clients/ClientDrawer.tsx", "components/ui/ProjectDrawer.tsx", "components/ui/ProjectDrawerV2.tsx", "components/ui/HealthAlert.tsx", "components/ui/StatusDropdown.tsx", "components/album/AlbumFinanceTab.tsx", "components/album/AlbumOverviewTab.tsx", "components/dashboard/DashboardDesignPreview.tsx", "lib/agent/rules.ts"];
    ok("every expected-income screen (Finance stats / Insights, project + client drawers, health, balance reminder, album, dashboard, agent) uses isExpectedStatus — no literal expected set left", expectedScreens.every((f) => uses(f, "isExpectedStatus") && !/\[\s*"צפוי",\s*"חלקי"|"לבדיקה"\]\.includes|EXPECT_S|=== "צפוי" \|\| [\w.]+ === "(חלקי|לא שולם)"/.test(code(f))));
    check("the one rule's set, pinned", [...EXPECTED_STATUSES], ["צפוי", "לא שולם", "חלקי"]);
    ok("report money (creation date / UTC day) vs the Finance Brain → a registered CONFLICTING_SOURCES gap", KNOWLEDGE_GAPS.some((g) => g.id === "RP_REPORT_SEMANTICS_CONFLICT" && g.class === "CONFLICTING_SOURCES"));
    ok("media recoup: old snapshots (retired target) stay registered; new writes use the agreement target; the ledger ↔ media double offset is a registered conflict", KNOWLEDGE_GAPS.some((g) => g.id === "LBL_MEDIA_RECOUP_TARGET_LEGACY" && g.class === "CONFLICTING_SOURCES" && g.status === "PARTIALLY_CLOSED") && rule("MEDIA_RECOUP_TARGET_AGREEMENT")?.class === "OWNER_POLICY" && rule("ARTIST_CLIP_SHARE_DOUBLE_OFFSET_RISK")?.class === "CONFLICT" && KNOWLEDGE_GAPS.some((g) => g.id === "LBL_ARTIST_CLIP_SHARE_DOUBLE_OFFSET" && g.status === "CONFLICT_REQUIRES_OWNER_DECISION"));
    ok("Red Films ledger vs Finance → registered (DB-1 pending), never summed", KNOWLEDGE_GAPS.some((g) => g.id === "RF_LEDGER_NOT_FINANCE" && g.class === "CONFLICTING_SOURCES"));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
