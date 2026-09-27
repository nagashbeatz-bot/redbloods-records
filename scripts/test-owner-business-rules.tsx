/**
 * Owner business rules (2026-09-27, FINAL): the שליו טסמה / אבי מולה agreement (lib/label-agreements), the retired income
 * status 'לבדיקה' (lib/finance/classify + the shared finance writer) and the Steven / Victor ball cycle (lib/team-ball-cycle
 * over computeVictorBall / engineerHandoff). Pure rules + the real writers on an in-memory database (no production,
 * no network, no push). Run with:   npx tsx scripts/test-owner-business-rules.tsx
 */
import Module from "node:module";
import fs from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 700)}` : ""}`); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");
const section = (s: string) => console.log(`\n${s}`);

// the shared finance writer must refuse 'לבדיקה' BEFORE any database call — a database that throws proves it
const ML = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
const orig = ML._load;
let dbCalls = 0;
ML._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  if (/(^|\/)supabase$/.test(request)) return { supabase: { from() { dbCalls++; throw new Error("no database in this test"); }, rpc() { dbCalls++; throw new Error("no database"); } } };
  return orig.call(this, request, parent, isMain);
};

const SHALEV = "8806fe5e-1238-4228-8078-b3db3ccc9b46", AVI = "b3499c72-069d-46c9-9c31-52b1db27c51f";

async function main() {
  const A = await import("../lib/label-agreements");
  const C = await import("../lib/finance/classify");
  const F = await import("../lib/writes/finance");
  const P = await import("../lib/partner/act/primitives/finance");
  const VB = await import("../lib/coo/victor-ball");
  const { COO_CONFIG } = await import("../lib/coo/config");
  const { teamBallCycle } = await import("../lib/team-ball-cycle");
  const { engineerHandoff } = await import("../lib/partner/mix/handoff");

  section("A. the שליו / אבי agreement — cash out ≠ label share ≠ artist share (funded by the label)");
  for (const [who, id] of [["שליו טסמה", SHALEV], ["אבי מולה", AVI]] as const) {
    for (const ref of [{ id }, { name: who }]) {
      const a = A.allocatePaidCost({ artist: ref, category: "CLIP", amount: 3000, currency: "₪", paid: true });
      ok(`1/2. ${who} clip 3,000₪ (${"id" in ref ? "by id" : "by name"}) → cash 3,000 · label 1,500 · artist 1,500 funded by the label`, a.status === "DEFINED" && a.cashOut === 3000 && a.labelShare === 1500 && a.artistShare === 1500 && a.artistShareFundedByLabel === 1500, a);
    }
  }
  const prod = A.allocatePaidCost({ artist: { id: SHALEV }, category: "PRODUCTION", amount: 3000, currency: "₪", paid: true });
  ok("3. Shalev production 3,000₪ → cash 3,000 · label 3,000 · artist 0", prod.status === "DEFINED" && prod.cashOut === 3000 && prod.labelShare === 3000 && prod.artistShare === 0 && prod.artistShareFundedByLabel === 0, prod);
  const mm = A.allocatePaidCost({ artist: { id: AVI }, category: A.costCategoryOfScope("מיקס / מאסטר"), amount: 1500, currency: "₪", paid: true });
  ok("4. mix / master (Finance scope 'מיקס / מאסטר') → artist 0, label 1,500 — a real company cost with no artist balance", mm.status === "DEFINED" && mm.category === "MIX_MASTER" && mm.artistShare === 0 && mm.labelShare === 1500 && mm.cashOut === 1500, mm);
  const show = A.showAgreementSplit({ artist: "שליו טסמה", show_price: 3000, dj_fee: 500 }, 0);
  ok("5. show: revenue 3,000 − direct 500 → net 2,500 · artist 1,250 · label 1,250 (never 50 / 50 of the gross)", show.status === "DEFINED" && show.netAfterDj === 2500 && show.artistFee === 1250 && show.labelProfit === 1250 && show.directExpenses === 500, show);
  const showReh = A.showAgreementSplit({ artist: "אבי מולה", show_price: 3000, dj_fee: 500 }, 300);
  ok("5b. counted rehearsals are direct show expenses too (net 2,200 → 1,100 / 1,100)", showReh.status === "DEFINED" && showReh.netAfterDj === 2200 && showReh.artistFee === 1100 && showReh.directExpenses === 800, showReh);
  const otherClip = A.allocatePaidCost({ artist: { name: "נגש ביטס" }, category: "CLIP", amount: 3000, currency: "₪", paid: true });
  const otherShow = A.showAgreementSplit({ artist: "DJ CLEANTONE", show_price: 3000, dj_fee: 500 }, 0);
  const fakeId = A.allocatePaidCost({ artist: { id: "00000000-0000-0000-0000-000000000301", name: "שליו טסמה" }, category: "CLIP", amount: 3000, currency: "₪", paid: true });
  const collab = A.showAgreementSplit({ artist: "שליו טסמה, אבי מולה", show_price: 3000, dj_fee: 0 }, 0);
  ok("6. another artist: clip + show NOT_DEFINED (NO_AGREEMENT) — the rules are never applied automatically", otherClip.status === "NOT_DEFINED" && otherClip.reason === "NO_AGREEMENT" && otherClip.cashOut === 3000 && otherShow.status === "NOT_DEFINED" && otherShow.reason === "NO_AGREEMENT", { otherClip, otherShow });
  ok("6b. id-first: a different roster row that only shares the name gets no agreement; a collaboration is never attributed", fakeId.status === "NOT_DEFINED" && fakeId.reason === "NO_AGREEMENT" && collab.status === "NOT_DEFINED" && collab.reason === "COLLAB_NOT_ATTRIBUTED", { fakeId, collab });
  const promo = A.allocatePaidCost({ artist: { id: SHALEV }, category: A.costCategoryOfScope("שיווק"), amount: 400, currency: "₪", paid: true });
  ok("7. an unknown category (promotion / artwork / PR / distribution…) → NOT_DEFINED, no guessed 50 / 50", promo.status === "NOT_DEFINED" && promo.reason === "CATEGORY_NOT_DEFINED" && ["שיווק", "סשן", "נסיעות", "ציוד", "כללי", "אחר", null].every((s) => A.costCategoryOfScope(s) === null), promo);
  const unpaid = A.allocatePaidCost({ artist: { id: SHALEV }, category: "CLIP", amount: 3000, currency: "₪", paid: false });
  ok("7b. only an ACTUALLY PAID cost enters the split (never a budget / an expected row)", unpaid.status === "NOT_DEFINED" && unpaid.reason === "NOT_PAID" && unpaid.cashOut === 0, unpaid);
  const tot = A.allocationTotalsByCurrency([
    A.allocatePaidCost({ artist: { id: SHALEV }, category: "CLIP", amount: 3000, currency: "₪", paid: true }),
    A.allocatePaidCost({ artist: { id: SHALEV }, category: "CLIP", amount: 1000, currency: "$", paid: true }),
    promo,
  ]);
  ok("8. currencies are never mixed: ₪ and $ totals apart; NOT_DEFINED cash out kept apart (never in a share)", JSON.stringify(tot.defined["₪"]) === JSON.stringify({ cashOut: 3000, labelShare: 1500, artistShare: 1500, artistShareFundedByLabel: 1500 }) && tot.defined["$"]?.artistShare === 500 && tot.notDefined["₪"]?.cashOut === 400 && !("labelShare" in (tot.notDefined["₪"] ?? {})), tot);
  const fb = A.fundedBalancePreview(1500, 1250);
  ok("A4. funded balance preview: artist share funded 1,500 − artist net show share 1,250 → 250 remains (a preview, records nothing)", fb.remainingFunded === 250 && fb.artistCredit === 0, fb);
  ok("the agreement layer reuses the app's own computeShowSplit (one show rule)", /computeShowSplit\(/.test(read("lib/label-agreements.ts")) && !/netAfterDj\s*\/\s*2/.test(read("lib/label-agreements.ts")));
  ok("the writers use the agreement split (finance sync, close-show ledger, close dialog) — no artist fee row without an agreement", /showAgreementSplit\(show, rehearsalCounted\)/.test(read("lib/shows-finance-sync.ts")) && /showAgreementSplit\(fresh, rehearsalCounted\)/.test(read("lib/writes/shows.ts")) && /showAgreementSplit\(show, show\.rehearsalCounted/.test(read("components/shows/ShowsHubPreview.tsx")));
  ok("B. the label page: cash out ≠ label share ≠ artist share funded; the P&L counts the LABEL share", /clipLabelShare \+ clipNotAllocated/.test(read("components/label/LabelPage.tsx")) && /חלק האמן שמומן/.test(read("components/label/LabelPage.tsx")) && !/investActual = clips\?\.totals\.byCurrency\["₪"\]\?\.actualCostPaid/.test(read("components/label/LabelPage.tsx")));

  section("C. 'לבדיקה' — retired from the active vocabulary (production inventory 2026-09-27: 0 rows)");
  ok("9a. the income pickers (Finance quick modal, project drawer, album tabs) and Sunny's typed status list never offer it", !P.INCOME_STATUSES.includes("לבדיקה") && JSON.stringify(P.INCOME_STATUSES) === JSON.stringify(C.ACTIVE_INCOME_STATUSES) && ["components/finance/QuickTxModal.tsx", "components/ui/ProjectDrawer.tsx", "components/album/AlbumOverviewTab.tsx", "components/album/AlbumFinanceTab.tsx"].every((f) => !/(INCOME_STATUSES|PMT_STATUS_OPTS)[^=\n]*=\s*\[[^\]]*"לבדיקה"/.test(read(f))));
  let createRefused = false, updateRefused = false;
  try { await F.createTransactionRecord({ type: "income", projectId: "p1", amount: 100, paymentStatus: "לבדיקה" }); } catch (e) { createRefused = e instanceof F.FinanceInputError; }
  try { await F.updateTransactionRecord("t1", { paymentStatus: "לבדיקה" }); } catch (e) { updateRefused = e instanceof F.FinanceInputError; }
  ok("9b. the shared finance writer refuses a NEW 'לבדיקה' on create AND update, before any database call (400 in both routes)", createRefused && updateRefused && dbCalls === 0 && /FinanceInputError\) return NextResponse\.json\(\{ error: err\.message \}, \{ status: 400 \}\)/.test(read("app/api/transactions/[id]/route.ts")), { createRefused, updateRefused, dbCalls });
  ok("10. a legacy 'לבדיקה' stays readable and is never silently reclassified: neither received nor expected", C.isDeprecatedPaymentStatus("לבדיקה") && !C.isReceivedStatus("לבדיקה") && !C.isExpectedStatus("לבדיקה") && !C.isActualMoneyTx({ type: "income", payment_status: "לבדיקה" }));
  ok("expense semantics unchanged: paid = שולם only ('התקבל' is not an expense-paid status)", C.isExpenseFullyPaidStatus("שולם") && !C.isExpenseFullyPaidStatus("התקבל"));

  section("D. Steven / Victor — the ball cycle (version → Owner, feedback → team, new version → Owner)");
  const up = (at: string, name: string) => ({ at, versionKey: VB.victorVersionKeyOf({ name }) });
  const ball = (uploads: Array<{ at: string; versionKey: string | null }>, reviews: Array<{ versionKey: string; sentAt: string | null; draft: boolean }>) =>
    VB.computeVictorBall({ uploads: uploads.map((u) => u.at), filesWithoutTimestamp: 0, reviews: reviews.map((r) => ({ sentAt: r.sentAt, draft: r.draft })), uploadVersions: uploads, reviewVersions: reviews }, COO_CONFIG as never);
  const v1 = up("2026-09-10T10:00:00Z", "Song V1.wav"), v2 = up("2026-09-14T10:00:00Z", "Song V2.wav");
  const s1 = ball([v1], []);
  const s2 = ball([v1], [{ versionKey: "V1", sentAt: "2026-09-11T10:00:00Z", draft: false }]);
  const s3 = ball([v1, v2], [{ versionKey: "V1", sentAt: "2026-09-11T10:00:00Z", draft: false }]);
  ok("11. Victor: a new version → OWNER; Owner notes → VICTOR; a new revision → OWNER", s1.ball.holder === "owner" && s2.ball.holder === "victor" && s3.ball.holder === "owner", [s1.ball, s2.ball, s3.ball]);
  const stale = ball([v1, v2], [{ versionKey: "V1", sentAt: "2026-09-11T10:00:00Z", draft: false }, { versionKey: "V1", sentAt: "2026-09-15T10:00:00Z", draft: false }]);
  const current = ball([v1, v2], [{ versionKey: "V2", sentAt: "2026-09-15T10:00:00Z", draft: false }]);
  ok("12. Victor: notes on the superseded V1 (sent after V2 arrived) do NOT move the ball; notes on V2 do", stale.ball.holder === "owner" && stale.staleFeedback?.length === 1 && stale.staleFeedback[0].supersededBy === "V2" && current.ball.holder === "victor", { stale, current: current.ball });
  const draft = ball([v1], [{ versionKey: "V1", sentAt: null, draft: true }]);
  ok("12b. a draft (never sent) is not feedback", draft.ball.holder === "owner", draft.ball);
  const cyc = teamBallCycle({ team: "Victor", state: "WAITING_ON_OWNER", latestVersionAt: v2.at, lastOwnerFeedbackAt: "2026-09-11T10:00:00Z", todayYmd: "2026-09-17" });
  const cyc2 = teamBallCycle({ team: "Victor", state: "WAITING_ON_VICTOR", latestVersionAt: v1.at, lastOwnerFeedbackAt: "2026-09-11T10:00:00Z", todayYmd: "2026-09-17" });
  ok("cycle answer: who / why / last event / sent when / feedback given? / waiting for a version? / days in state", cyc.ball === "OWNER" && cyc.stage === "WAITING_FOR_OWNER_FEEDBACK" && cyc.lastEvent?.kind === "TEAM_VERSION" && cyc.latestVersionAt === v2.at && !cyc.ownerFeedbackSinceLatestVersion && !cyc.waitingForNewVersion && cyc.daysInState === 3
    && cyc2.ball === "TEAM" && cyc2.stage === "WAITING_FOR_NEW_VERSION_FROM_TEAM" && cyc2.lastEvent?.kind === "OWNER_FEEDBACK" && cyc2.ownerFeedbackSinceLatestVersion && cyc2.waitingForNewVersion && cyc2.daysInState === 6, { cyc, cyc2 });
  ok("time never completes a work (closed only from the recorded status)", teamBallCycle({ team: "x", state: "WAITING_ON_OWNER", latestVersionAt: "2020-01-01T00:00:00Z", lastOwnerFeedbackAt: null, todayYmd: "2026-09-27" }).stage === "WAITING_FOR_OWNER_FEEDBACK");

  const src = (versions: Array<{ id: string; at: string }>, comments: Array<{ versionId: string; at: string }>) => ({
    projectDetail: { status: "OK", value: { mixVersions: { rows: versions.map((v) => ({ id: v.id, workId: "w1", projectId: "p1", targetId: null, createdAt: v.at, uploadedAt: v.at })) }, mixComments: { rows: comments.map((c, i) => ({ id: `c${i}`, versionId: c.versionId, createdAt: c.at })) }, mixTargets: { rows: [] }, mixTargetNotes: { rows: [] }, actions: { rows: [] } } },
    settings: { status: "OK", value: { families: {} } },
  }) as never;
  const W = { id: "w1", projectId: "p1", engineerName: "Steven", status: "בתהליך" };
  const e1 = engineerHandoff(src([{ id: "m1", at: "2026-09-10T10:00:00Z" }], []), W);
  const e2 = engineerHandoff(src([{ id: "m1", at: "2026-09-10T10:00:00Z" }], [{ versionId: "m1", at: "2026-09-11T10:00:00Z" }]), W);
  const e3 = engineerHandoff(src([{ id: "m1", at: "2026-09-10T10:00:00Z" }, { id: "m2", at: "2026-09-14T10:00:00Z" }], [{ versionId: "m1", at: "2026-09-11T10:00:00Z" }]), W);
  const e4 = engineerHandoff(src([{ id: "m1", at: "2026-09-10T10:00:00Z" }, { id: "m2", at: "2026-09-14T10:00:00Z" }], [{ versionId: "m1", at: "2026-09-11T10:00:00Z" }, { versionId: "m1", at: "2026-09-15T10:00:00Z" }]), W);
  ok("11s. Steven: a version → OWNER; Owner feedback → ENGINEER; a new version → OWNER", e1.state === "WAITING_ON_OWNER" && e2.state === "WAITING_ON_ENGINEER" && e3.state === "WAITING_ON_OWNER", [e1.state, e2.state, e3.state]);
  ok("12s. Steven: a comment on the superseded version (written after the newer one arrived) never moves the ball — kept as stale evidence", e4.state === "WAITING_ON_OWNER" && e4.staleComments.length === 1, { state: e4.state, stale: e4.staleComments });

  section("E. Sunny = the same interpretation as the canonical helpers");
  ok("13a. show_view split = the agreement split (showAgreementSplit), with NOT_DEFINED + a signal for any other artist", /showAgreementSplit\(\{ artist: s\.artistText/.test(read("lib/partner/shows/view.ts")) && /SHOW_SPLIT_NOT_DEFINED/.test(read("lib/partner/shows/view.ts")));
  ok("13b. artist_view money.agreement uses the SAME allocation functions (allocatePaidCost / allocationTotalsByCurrency) and compares the ledger + media recoup (never nets them)", /allocatePaidCost\(/.test(read("lib/partner/label/view.ts")) && /allocationTotalsByCurrency\(/.test(read("lib/partner/label/view.ts")) && /doubleOffsetRisk/.test(read("lib/partner/label/view.ts")));
  ok("13c. victor_view + mix_view name the cycle with the SAME helper over the app's own rules", /teamBallCycle\(/.test(read("lib/partner/victor/view.ts")) && /teamBallCycle\(/.test(read("lib/partner/mix/view.ts")) && /computeVictorBall\(/.test(read("lib/partner/victor/view.ts")));
  ok("13d. an outbound pending_feedback waits on the recipient; only a received version is the Owner's feedback due", /OWNER_FEEDBACK_DUE/.test(read("lib/partner/projects/view.ts")) && /WAITING_FEEDBACK: a\("CONTEXT", "EXTERNAL"/.test(read("lib/partner/system/company.ts")) && /OWNER_FEEDBACK_DUE: a\("NEEDS_ATTENTION", "OWNER"/.test(read("lib/partner/system/company.ts")));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
