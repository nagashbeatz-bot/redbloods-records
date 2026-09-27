/**
 * Integrity fix A2 — MIX / STEVEN PAYMENT + mix semantics. Pure + source-level proof, no DB, no network, no push.
 *
 *   npx tsx scripts/test-mix-payment-integrity.tsx
 *
 * Proves: a paid ("שולם") expense is never overwritten by a price edit / the legacy drawer sync / a force sync; un-pay
 * never deletes paid evidence; a ₪ work is never multiplied by 3.25; a $ work is recorded in $ (no silent conversion);
 * THE paid rule is one shared function used by the UI, the store, COO, the Finance Brain and Sunny; completed ≠
 * approved ≠ final files ≠ paid ≠ delivered; an engineer completion never completes the project by itself; the UI and
 * Sunny group mix versions identically; every write path goes through the one writer.
 */
import fs from "node:fs";
import path from "node:path";
import {
  APP_PAYMENT_RATIO, PAYPAL_GROSS_FACTOR, isEngineerWorkPaid, engineerPayStatus, isLegacyPaidWithoutDate, engineerExpenseMode,
  decideEngineerExpense, unpayBlocked, type ReconcileWork, type ReconcileTx,
} from "../lib/mix-payment-pure";
import { baseVersionKey, versionGroupKey, versionGroupLabel } from "../lib/mix-version-group-pure";
import { processStevenCompletion, type StevenCompletionDeps, type CompletionPush } from "../lib/steven-completed-pure";
import { buildMixWork } from "../lib/partner/mix/view";
import { engineerHandoff } from "../lib/partner/mix/handoff";
import type { GatewaySources } from "../lib/partner/gateway/core";
import type { ProjectDetailRaw, DetailEngineerWork, DetailMixVersion } from "../lib/partner/projects/detail-types";

const ROOT = path.resolve(__dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? `  — ${JSON.stringify(detail)}` : ""}`); } };
const section = (t: string) => console.log(`\n${t}`);

const W = (o: Partial<ReconcileWork> = {}): ReconcileWork => ({ id: "w1", projectId: "p1", engineerName: "Bill", workType: "מיקס", workTitle: null, currency: "$", agreedPrice: 200, amountPaid: 0, paymentDate: null, ...o });
const TX = (o: Partial<ReconcileTx> = {}): ReconcileTx => ({ id: "t1", paymentStatus: "לא שולם", amount: 200, currency: "$", date: null, ...o });
const CTX = { artist: "A", projectName: "Song" };

async function main() {
  section("1. THE paid rule (one shared function)");
  ok("paid = agreed > 0 AND paid ≥ agreed AND a payment date", isEngineerWorkPaid({ agreedPrice: 200, amountPaid: 200, paymentDate: "2026-09-01" }) && !isEngineerWorkPaid({ agreedPrice: 200, amountPaid: 200, paymentDate: null }) && !isEngineerWorkPaid({ agreedPrice: 0, amountPaid: 0, paymentDate: "2026-09-01" }) && !isEngineerWorkPaid({ agreedPrice: 200, amountPaid: 199, paymentDate: "2026-09-01" }));
  ok("legacy full amount without a date is NOT paid (reported separately)", isLegacyPaidWithoutDate({ agreedPrice: 200, amountPaid: 200, paymentDate: null }) && engineerPayStatus({ agreedPrice: 200, amountPaid: 200, paymentDate: null }) === "חלקי");
  ok("pay status: שולם / חלקי / לא שולם", engineerPayStatus({ agreedPrice: 200, amountPaid: 200, paymentDate: "2026-09-01" }) === "שולם" && engineerPayStatus({ agreedPrice: 200, amountPaid: 50, paymentDate: null }) === "חלקי" && engineerPayStatus({ agreedPrice: 200, amountPaid: 0, paymentDate: null }) === "לא שולם");
  ok("working values are code constants (3.25 / 1.05), labelled not Owner policy", APP_PAYMENT_RATIO === 3.25 && PAYPAL_GROSS_FACTOR === 1.05 && /code working values?, not Owner policy|WORKING VALUE, NOT Owner policy/i.test(read("lib/mix-payment-pure.ts")));
  const readers: Array<[string, RegExp]> = [
    ["components/team/StevenProfilePage.tsx", /engineerPayStatus\(/],
    ["lib/sound-engineer-store.ts", /isEngineerWorkPaid\(/],
    ["lib/coo/facts.ts", /isEngineerWorkPaid\(/],
    ["lib/partner/finance/core.ts", /isEngineerWorkPaid\(/],
    ["lib/partner/mix/view.ts", /isEngineerWorkPaid\(/],
    ["lib/partner/projects/view.ts", /isEngineerWorkPaid\(/],
    ["lib/partner/knowledge/capabilities/operations.ts", /isEngineerWorkPaid\(/],
  ];
  const inlineCopy = /(amountPaid|amount_paid|curPaid|\bpaid\b)[^;\n]{0,40}>=[^;\n]{0,60}(agreedPrice|agreed_price|agreed|curAgreed)[^;\n]{0,40}&&[^;\n]{0,30}(paymentDate|payment_date)/;
  for (const [f, re] of readers) ok(`${f} uses THE shared rule and has no inline copy`, re.test(read(f)) && /mix-payment-pure/.test(read(f)) && !inlineCopy.test(code(read(f))));
  const FIX = [{ agreedPrice: 200, amountPaid: 200, paymentDate: "2026-09-01" }, { agreedPrice: 200, amountPaid: 200, paymentDate: null }, { agreedPrice: 200, amountPaid: 0, paymentDate: null }, { agreedPrice: 0, amountPaid: 0, paymentDate: "2026-09-01" }];
  const detailOf = (i: number): DetailEngineerWork => ({ id: `w${i}`, projectId: null, engineerName: "Steven", notes: null, hasFilesLink: false, sortOrder: null, createdAt: null, updatedAt: null, workTitle: `W${i}`, status: "אושר", currency: "$", ...FIX[i] });
  const srcBase = { now: new Date("2026-09-27T10:00:00Z"), identities: {} } as unknown as GatewaySources;
  ok("Sunny mix view answers exactly THE rule on the fixtures (UI / COO / Finance Brain call the same function)", FIX.every((f, i) => buildMixWork(srcBase, detailOf(i)).money.paid === isEngineerWorkPaid(f) && buildMixWork(srcBase, detailOf(i)).money.payStatus === (f.agreedPrice > 0 ? engineerPayStatus(f) : "NO_PRICE")));

  section("2. a paid (שולם) expense is never overwritten");
  const paidTx = TX({ paymentStatus: "שולם", amount: 650, currency: "₪", date: "2026-08-01" });
  const priceEdit = decideEngineerExpense(W({ engineerName: "Steven", agreedPrice: 250, amountPaid: 200, paymentDate: "2026-08-01" }), paidTx, { mode: "PAYMENT_ONLY", ...CTX });
  ok("price edit on a paid work → PROTECTED_PAID (+ a reported conflict, nothing written)", priceEdit.kind === "PROTECTED_PAID" && !!priceEdit.conflictHe, priceEdit);
  const legacyDrawer = decideEngineerExpense(W({ agreedPrice: 200, amountPaid: 200, paymentDate: "2026-08-01" }), TX({ paymentStatus: "שולם", date: "2026-08-01" }), { mode: engineerExpenseMode("Bill"), ...CTX, force: true });
  ok("legacy drawer 'sync' (force, non-Steven) on a paid row → PROTECTED_PAID, no conflict when it agrees", legacyDrawer.kind === "PROTECTED_PAID" && legacyDrawer.conflictHe === null, legacyDrawer);
  const force = decideEngineerExpense(W({ engineerName: "Steven", agreedPrice: 200, amountPaid: 200, paymentDate: "2026-08-01" }), paidTx, { mode: "PAYMENT_ONLY", ...CTX, force: true });
  ok("force sync on a historical ₪650 paid row → PROTECTED_PAID and the ₪ ≠ $ disagreement is reported, not fixed", force.kind === "PROTECTED_PAID" && /650/.test(force.conflictHe ?? ""), force);
  ok("a date is never nulled on a paid row, and an unpaid re-price never writes date", (() => { const d = decideEngineerExpense(W({ agreedPrice: 300 }), TX({ date: "2026-07-01" }), { mode: "EXPECTED_AND_PAYMENT", ...CTX }); return d.kind === "UPDATE" && !("date" in d.fields); })());
  ok("force sync refuses a standalone work", decideEngineerExpense(W({ projectId: null }), null, { mode: "EXPECTED_AND_PAYMENT", ...CTX, force: true }).kind === "REFUSED");

  section("3. un-pay never deletes paid evidence");
  const unpayPaid = decideEngineerExpense(W({ engineerName: "Steven", amountPaid: 0, paymentDate: null }), paidTx, { mode: "PAYMENT_ONLY", ...CTX });
  ok("Steven un-pay with a שולם row → PROTECTED_PAID (never REMOVE)", unpayPaid.kind === "PROTECTED_PAID", unpayPaid);
  ok("the un-pay guard refuses the request before any write (store → 409)", unpayBlocked({ touchesPayment: true, projectedPaid: false, linkedStatus: "שולם" }) && !unpayBlocked({ touchesPayment: true, projectedPaid: false, linkedStatus: "לא שולם" }) && !unpayBlocked({ touchesPayment: false, projectedPaid: false, linkedStatus: "שולם" }));
  ok("a partial (חלקי) row is money evidence — never auto-deleted", decideEngineerExpense(W({ engineerName: "Steven" }), TX({ paymentStatus: "חלקי" }), { mode: "PAYMENT_ONLY", ...CTX }).kind === "NONE");
  ok("an UNPAID Steven row is removed on un-pay (no expected row for Steven)", decideEngineerExpense(W({ engineerName: "Steven" }), TX(), { mode: "PAYMENT_ONLY", ...CTX }).kind === "REMOVE_UNPAID");
  const wm = code(read("lib/writes/mix.ts"));
  ok("the writer's delete / update are conditional on payment_status ≠ שולם (race-safe)", /\.delete\(\)\.eq\("id", d\.txId\)\.neq\("payment_status", "שולם"\)\.neq\("payment_status", "חלקי"\)/.test(wm) && /\.update\(d\.fields\)\.eq\("id", d\.txId\)\.neq\("payment_status", "שולם"\)/.test(wm));

  section("4. currency — no silent conversion");
  const ils = decideEngineerExpense(W({ currency: "₪", agreedPrice: 500, amountPaid: 500, paymentDate: "2026-09-10" }), null, { mode: "EXPECTED_AND_PAYMENT", ...CTX });
  ok("a ₪ work is never multiplied by 3.25 (₪500 → ₪500, no estimate)", ils.kind === "INSERT" && ils.fields.amount === 500 && ils.fields.currency === "₪" && !/3\.25/.test(ils.fields.notes), ils);
  const usd = decideEngineerExpense(W({ engineerName: "Steven", agreedPrice: 200, amountPaid: 200, paymentDate: "2026-09-10" }), null, { mode: "PAYMENT_ONLY", ...CTX });
  ok("a $ Steven payment is recorded as $200 (not ₪650), status שולם, dated the payment date", usd.kind === "INSERT" && usd.fields.amount === 200 && usd.fields.currency === "$" && usd.fields.payment_status === "שולם" && usd.fields.date === "2026-09-10", usd);
  ok("the ₪ figure is only an 'הערכה' in the notes (≈ ₪650, PayPal $210)", usd.kind === "INSERT" && /הערכה/.test(usd.fields.notes) && /650/.test(usd.fields.notes) && /210/.test(usd.fields.notes));
  ok("no writer multiplies by the ratio any more", !/\*\s*3\.25|APP_PAYMENT_RATIO\s*\*/.test(code(read("lib/sound-engineer-store.ts")) + wm));
  ok("Steven gets no expected row; other engineers do (work currency)", decideEngineerExpense(W({ engineerName: "Steven" }), null, { mode: engineerExpenseMode("Steven"), ...CTX }).kind === "NONE" && (() => { const d = decideEngineerExpense(W(), null, { mode: engineerExpenseMode("Bill"), ...CTX }); return d.kind === "INSERT" && d.fields.currency === "$" && d.fields.payment_status === "לא שולם" && d.fields.date === null; })());

  section("5. one writer, every path");
  const store = code(read("lib/sound-engineer-store.ts"));
  ok("the store has no direct transactions write (only the un-pay guard read) and no retired writer", !/from\("transactions"\)\s*\.(insert|update|delete|upsert)/.test(store) && !/function (syncTransaction|syncStevenPaymentExpense)\b/.test(store) && (store.match(/await reconcile\(/g) ?? []).length >= 3);
  ok("recordEngineerPayment = ONE store call for every engineer (no second Steven sync)", /await updateSoundEngineerWork\(workId, \{ amountPaid: paid \? w\.agreedPrice : 0, paymentDate: paid \? paymentDate : null \}\)/.test(wm) && !/syncStevenPaymentExpense/.test(wm));
  const route = read("app/api/sound-engineer/[id]/route.ts");
  ok("PATCH maps the protected un-pay to 409; the explicit sync POST checks the Owner in-route", /PaidExpenseProtectedError\) return NextResponse\.json\([^)]*status: 409/.test(route) && /export async function POST[\s\S]*requireOwner\(\)/.test(route));
  ok("payment-expense route runs the one writer (Owner only)", /reconcileWorkPaymentExpense\(id\)/.test(read("app/api/sound-engineer/[id]/payment-expense/route.ts")) && /requireOwner\(\)/.test(read("app/api/sound-engineer/[id]/payment-expense/route.ts")));
  const page = code(read("components/team/StevenProfilePage.tsx"));
  ok("Steven page pays in ONE server call (no second payment-expense call)", !/payment-expense/.test(page) && !/syncPaymentExpense/.test(page));
  const drawer = read("components/ui/ProjectDrawer.tsx");
  const se = drawer.slice(drawer.indexOf("function SoundEngineerSection("), drawer.indexOf("\nfunction ", drawer.indexOf("function SoundEngineerSection(") + 10));
  ok("legacy drawer: full amount records a payment date; its sync shows the protected-row message", /patchPaid\(n\)/.test(se) && /paymentDate: today/.test(se) && /PROTECTED_PAID/.test(se));
  const prim = read("lib/partner/act/primitives/mix.ts");
  ok("Sunny primitives: un-pay refused on a שולם row; force sync refuses standalone + paid rows and discloses it", /PAID_EXPENSE_PROTECTED/.test(prim) && /refuse\("STANDALONE"/.test(prim) && /שורה ששולמה לא נדרסת/.test(prim));

  section("6. completed ≠ approved ≠ final files ≠ paid ≠ delivered");
  const V = (id: string, label: string, status: string, at: string, targetId: string | null = null): DetailMixVersion => ({ id, workId: "wx", projectId: null, label, fileName: `${label}.wav`, status, uploadedBy: "Steven", durationSeconds: null, uploadedAt: at, targetId, path: null, size: null, type: null, createdAt: at, updatedAt: at });
  const det = (versions: DetailMixVersion[], finals = 0): ProjectDetailRaw => ({ mixVersions: { rows: versions, capped: false }, finalFiles: { rows: Array.from({ length: finals }, () => ({ workId: "wx", projectId: null, fileName: "f.wav", path: null, fileType: "mix", fileSize: 1, uploadedBy: "Steven", createdAt: "2026-09-20T00:00:00Z" })), capped: false } } as unknown as ProjectDetailRaw);
  const src = (d: ProjectDetailRaw) => ({ ...srcBase, projectDetail: { status: "OK", value: d } } as unknown as GatewaySources);
  const wx = (o: Partial<DetailEngineerWork>): DetailEngineerWork => ({ id: "wx", projectId: null, engineerName: "Steven", notes: null, hasFilesLink: false, sortOrder: null, createdAt: null, updatedAt: null, workTitle: "X", status: "אושר", agreedPrice: 200, currency: "$", amountPaid: 0, paymentDate: null, ...o });
  const a = buildMixWork(src(det([V("v1", "Mix 1", "בבדיקה", "2026-09-10T00:00:00Z")])), wx({}));
  ok("completed with no version decision, no final files, unpaid: four separate facts", a.completion.completed && /NOT_RECORDED/.test(a.completion.approvalRecord) && a.completion.finalFilesEvidence === false && a.completion.paid === false);
  const b = buildMixWork(src(det([V("v1", "Mix 1", "בבדיקה", "2026-09-10T00:00:00Z"), V("v2", "Mix 2", "מאושר", "2026-09-12T00:00:00Z")], 1)), wx({ status: "בתהליך", amountPaid: 200, paymentDate: "2026-09-13" }));
  ok("a recorded מאושר on the LATEST version is approval evidence (FACT), while the work is NOT completed", /VERSION_STATUS_RECORDED/.test(b.completion.approvalRecord) && b.completion.approvalEpistemic === "FACT" && !b.completion.completed && b.completion.finalFilesEvidence && b.completion.paid);
  const c = buildMixWork(src(det([V("v1", "Mix 1", "מאושר", "2026-09-10T00:00:00Z"), V("v2", "Mix 2", "בבדיקה", "2026-09-12T00:00:00Z")])), wx({}));
  ok("an OLDER version's מאושר is not the latest decision", /NOT_RECORDED/.test(c.completion.approvalRecord));
  ok("no delivery is ever derived from the mix work (delivered comes only from a delivery record)", !/deliver/i.test(JSON.stringify(a.completion)));

  section("7. engineer completion never completes the project by itself");
  const projects: Record<string, { status: string }> = { P1: { status: "בעבודה" } };
  const pushes: CompletionPush[] = [];
  const deps: StevenCompletionDeps = {
    async listOtherStevenWorks() { return []; }, async readProjectStatus(id) { return projects[id].status; },
    async claimFinalFilesRequest() { return "won"; }, async releaseFinalFilesRequest() {}, pushAllowed: () => false, now: () => 0,
    async sendToSteven(p) { pushes.push(p); return [{ status: "fulfilled" }]; }, async sendToOwner(p) { pushes.push(p); }, log: () => {}, logError: () => {},
  };
  const out = await processStevenCompletion({ id: "w1", projectId: "P1", displayName: "Song", fromUpdatedAt: "u" }, deps);
  ok("the last open Steven work completes → projectSync 'suggested', project status unchanged", out.projectSync === "suggested" && projects.P1.status === "בעבודה");
  ok("the deps have no project-write capability at all; the real wiring only reads projects", !("syncProjectCompleted" in deps) && !/from\("projects"\)\s*\.update/.test(code(read("lib/steven-completion.ts"))));
  ok("the Owner's page asks explicitly and only a yes runs the Projects writer", /sync === "suggested"[\s\S]{0,200}window\.confirm\([\s\S]{0,200}updateProjectField\(target\.projectId, "status", "הושלם"\)/.test(page));

  section("8. version grouping — identical in the UI and Sunny");
  ok("base key strips a trailing role qualifier", baseVersionKey("Mix 1 (acapella)") === "Mix 1" && baseVersionKey("Mix 1 - Instrumental") === "Mix 1" && baseVersionKey("") === "" && versionGroupLabel("Mix 2") === "Mix 2");
  ok("key is line-scoped; an empty label is its own group", versionGroupKey({ id: "a", label: "Mix 1", targetId: "L1" }) !== versionGroupKey({ id: "b", label: "Mix 1", targetId: "L2" }) && versionGroupKey({ id: "a", label: "", targetId: null }) === "unassigned|a");
  ok("the Steven page groups with the shared key (no private copy)", /versionGroupKey\(\{ id: v\.id, label: v\.label, targetId \}\)/.test(page) && !/function baseVersionKey/.test(page));
  const g = buildMixWork(src(det([V("v1", "Mix 1", "בבדיקה", "2026-09-10T00:00:00Z"), V("v2", "Mix 1 (acapella)", "בבדיקה", "2026-09-10T00:01:00Z"), V("v3", "Mix 1", "בבדיקה", "2026-09-11T00:00:00Z", "L2")])), wx({ status: "בתהליך" }));
  const uiKeys = new Set([{ id: "v1", label: "Mix 1", targetId: null }, { id: "v2", label: "Mix 1 (acapella)", targetId: null }, { id: "v3", label: "Mix 1", targetId: "L2" }].map(versionGroupKey));
  ok("Sunny's rounds = the UI's groups (same keys, acapella joins its mix)", g.rounds.length === uiKeys.size && g.rounds.every((r) => uiKeys.has(r.key)), g.rounds.map((r) => r.key));

  section("9. the operating model's ball = the mix handoff rule");
  const op = code(read("lib/partner/sunny/operating.ts"));
  ok("operating.ts reuses engineerHandoff (no status-only engineer ball)", /engineerHandoff\(src,/.test(op) && !/basis: `engineer work status/.test(op));
  const h = engineerHandoff(src(det([V("v1", "Mix 1", "בבדיקה", "2026-09-10T00:00:00Z")])), { id: "wx", projectId: null, engineerName: "Steven", status: "חזר" });
  ok("status חזר + an upload with no newer feedback → WAITING_ON_OWNER from timestamps", h.state === "WAITING_ON_OWNER" && h.timestampEvidence);

  console.log(`\n${fail === 0 ? "✓ ALL PASS" : "✗ FAILURES"} — ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
