/**
 * Tests — Sunny Financial COO / FINANCIAL_FORWARD (Owner decisions 2026-10-05, Phase 2): obligations, settlements,
 * vendor payables, the $210 double-count guard, readiness (≤7 SHOULD / ≤3 MUST / PREPARED quiet), coverage UNKNOWN,
 * currencies, units, the OVERTAKEN money note, and the BUSINESS_MOTION integration (an input — never a second engine).
 * Pure; in-memory fixtures shaped like production 2026-10-05; never touches production.
 *
 * Run with:   npx tsx scripts/test-financial-forward.tsx
 */
import fs from "node:fs";
import path from "node:path";
import type { GatewaySources } from "../lib/partner/gateway/core";
import { cooCtx } from "../lib/partner/coo/context";
import { buildFinancialForward, readinessOf, FINANCIAL_FORWARD_WINDOWS, type FinancialForward } from "../lib/partner/coo/financial-forward";
import { buildCooView } from "../lib/partner/coo/priorities";
import { MOTION_ACTION_IDS } from "../lib/partner/coo/motion";
import { buildFinanceBrain } from "../lib/partner/finance/core";
import type { FinanceRaw } from "../lib/partner/finance/types";
import { moneyAlreadyRecorded } from "../lib/partner/sunny/money-overtaken";
import { decideInboxLifecycle } from "../lib/partner/sunny/inbox-lifecycle";
import { inboxLifecycleBaseOf } from "../lib/partner/sunny/inbox-lifecycle-base";
import { buildMentionIndex, findMentions, isWeakName } from "../lib/partner/knowledge/inbox-mentions";
import { ACTION_REGISTRY } from "../lib/partner/act/registry";
import { PARTNER_KNOWLEDGE_REGISTRY } from "../lib/partner/knowledge/catalog";
import { queryKnowledgeCore } from "../lib/partner/knowledge/query";
import { SERVER_INSTRUCTIONS } from "../lib/integrations/partner-mcp/mcp";
import { SHALEV_ARTIST_ID } from "../lib/red-artists/portal-registry";
import { AVI_ARTIST_ID } from "../lib/roles";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 900)}` : ""}`); } };
const section = (t: string) => console.log(`\n${t}`);
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const TODAY = "2026-10-05";
const NOW = new Date(`${TODAY}T08:00:00Z`);
const D = (n: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const OWNER = { channel: "INTERNAL" as const, ownerAuthorized: true };
const A_NAGASH = U(3);
const P_BAM = U(10), P_YAH = U(11), P_TZO = U(12), P_DH = U(13), P_X = U(14), P_CL = U(15), P_CANC = U(16);
const S1 = U(20), DANIEL = U(21), SHALEV_CLIENT = U(22);

interface Fx { shalevBalance?: number; aviBalance?: number; anchor?: string; victorStatus?: string; victorTx?: boolean; victorDue?: string; dhStatus?: string; dhLinkedTx?: boolean; extraTx?: unknown[]; noFinance?: boolean; proposals?: unknown[]; receivables?: boolean; shows?: unknown[]; noLedger?: boolean }

const tx = (id: string, o: Record<string, unknown>) => ({ id, projectId: null, type: "expense", date: D(0), amount: 0, currency: "₪", status: "צפוי", category: null, scope: null, expenseScope: null, linkedSessionId: null, showId: null, showMoneyRole: null, createdAt: `${D(-6)}T10:00:00Z`, description: null, businessUnit: "STUDIO", businessUnitSource: "RULE", ...o });

function rawOf(fx: Fx): FinanceRaw {
  const transactions = [
    tx("fest", { type: "income", amount: 2500, status: "התקבל", date: D(-3), showId: S1, showMoneyRole: "SHOW_PAYMENT", businessUnit: "RECORDS" }),
    tx("dj", { amount: 500, status: "שולם", date: D(-3), showId: S1, showMoneyRole: "DJ_FEE", category: "שכר דיג'יי", businessUnit: "RECORDS" }),
    tx("m-bam", { projectId: P_BAM, amount: 210, currency: "$", date: "2026-10-01", expenseScope: "מיקס / מאסטר", category: "", description: "מיקס — באם באם" }),
    tx("m-yah", { projectId: P_YAH, amount: 210, currency: "$", date: "2026-10-01", expenseScope: "מיקס / מאסטר", category: "", description: "מיקס — יהלום" }),
    tx("m-tzo", { projectId: P_TZO, amount: 210, currency: "$", date: "2026-10-01", expenseScope: "מיקס / מאסטר", category: "", description: "מיקס — צועדים" }),
    tx("m-dh", { projectId: P_DH, amount: 400, currency: "$", date: "2026-10-01", expenseScope: "מיקס / מאסטר", category: "", description: "מיקס — דאנסהול (ידני)" }),
    tx("rent", { amount: 300, date: D(2), description: "השכרת ציוד" }),
    tx("late", { amount: 150, date: D(-3), description: "הוצאה שעבר מועדה" }),
    tx("cancel", { amount: 999, status: "בוטל", date: D(1), description: "בוטל" }),
    ...(fx.dhLinkedTx ? [tx("dh-linked", { projectId: P_DH, amount: 400, currency: "$", status: "לא שולם", date: null, category: "מיקס / מאסטר" })] : []),
    ...(fx.victorTx ? [tx("victor-sep", { amount: 550, currency: "$", date: "2026-10-10", linkedSessionId: "victor_salary_2026-09", status: "צפוי" })] : []),
    ...((fx.extraTx ?? []) as never[]),
  ];
  return {
    transactions: transactions as never, projects: [], financeSettings: [],
    engineerWorks: [
      { id: "w-ep", projectId: null, engineerName: "Steven", status: "אושר", agreedPrice: 550, amountPaid: 0, currency: "$", linkedTransactionId: null, paymentDate: null },
      { id: "w-200", projectId: P_X, engineerName: "Steven", status: "אושר", agreedPrice: 200, amountPaid: 0, currency: "$", linkedTransactionId: null, paymentDate: null },
      { id: "w-dh", projectId: P_DH, engineerName: "Steven", status: fx.dhStatus ?? "נשלח", agreedPrice: 400, amountPaid: 0, currency: "$", linkedTransactionId: fx.dhLinkedTx ? "dh-linked" : null, paymentDate: null },
      { id: "w-paid", projectId: P_CL, engineerName: "Steven", status: "אושר", agreedPrice: 200, amountPaid: 200, currency: "$", linkedTransactionId: null, paymentDate: D(-3) },
      { id: "w-canc", projectId: P_CANC, engineerName: "Steven", status: "בוטל", agreedPrice: 300, amountPaid: 0, currency: "$", linkedTransactionId: null, paymentDate: null },
    ],
    shows: [{ id: S1, name: "פסטידאנס", date: D(-3), status: "בוצע", dealType: "PAID", paymentStatus: "שולם", price: 2500, incomeTxId: "fest", artistTxId: null, djTxId: "dj", currency: "₪" }],
    proposals: (fx.proposals ?? []) as never, clients: [], labelArtists: [], ledger: [], mediaIncome: [], redFilmsPayments: [],
    victorSalary: [{ workMonth: "2026-09", dueDate: fx.victorDue ?? "2026-10-10", amount: 550, currency: "$", status: fx.victorStatus ?? "צפוי", transactionId: fx.victorTx ? "victor-sep" : null }],
  } as FinanceRaw;
}

function src(fx: Fx = {}): GatewaySources {
  const raw = rawOf(fx);
  const brain = buildFinanceBrain(raw, NOW);
  const projects: Array<[string, Record<string, unknown>]> = [
    [P_BAM, { name: "באם באם", status: "מחכה למיקס", artistText: "ג'רמי קול חבש", businessType: "לקוח" }],
    [P_YAH, { name: "יהלום", status: "בעבודה", artistText: "רוני נגה", businessType: "לקוח" }],
    [P_TZO, { name: "צועדים", status: "בעבודה", artistText: "ג'רמי קול חבש", businessType: "לקוח" }],
    [P_DH, { name: "דאנסהול סקול", status: "במיקס", artistText: "נגש ביטס", businessType: "לייבל" }],
    [P_X, { name: "פרויקט X", status: "הושלם", artistText: "לקוח", businessType: "לקוח" }],
    [P_CL, { name: "קרוב אלייך", status: "במיקס", artistText: "חיים", businessType: "לקוח" }],
    [P_CANC, { name: "מבוטל", status: "בוטל", artistText: "לקוח", businessType: "לקוח" }],
  ];
  const index = Object.fromEntries(projects.map(([id, p]) => [id, p]));
  const open = projects.filter(([, p]) => !["הושלם", "בוטל"].includes(p.status as string)).map(([id, p]) => ({ id, name: p.name, status: p.status, businessType: p.businessType, projectType: "שיר", artistText: p.artistText, deadline: { ymd: null, daysTo: null }, daysSinceUpdate: 1, active: true, hasFinanceSetting: false }));
  const roster = [{ id: SHALEV_ARTIST_ID, name: "שליו טסמה" }, { id: AVI_ARTIST_ID, name: "אבי מולה" }, { id: A_NAGASH, name: "נגש ביטס" }];
  const ledger = fx.noLedger ? [] : [
    ...(fx.shalevBalance === 0 ? [] : [{ id: "l1", artistId: SHALEV_ARTIST_ID, entryType: (fx.shalevBalance ?? 2213) >= 0 ? "הכנסות" : "הוצאות", amount: Math.abs(fx.shalevBalance ?? 2213), entryDate: "2026-09-11", description: "הופעה", note: null, sourceTxId: null, sourceShowId: null, createdAt: "2026-09-11T10:00:00Z", updatedAt: null }]),
    ...(fx.aviBalance ? [{ id: "l2", artistId: AVI_ARTIST_ID, entryType: fx.aviBalance > 0 ? "הכנסות" : "הוצאות", amount: Math.abs(fx.aviBalance), entryDate: "2026-09-15", description: "x", note: null, sourceTxId: null, sourceShowId: null, createdAt: "2026-09-15T10:00:00Z", updatedAt: null }] : []),
  ];
  const anchor = fx.anchor ?? "2026-08-10";
  const settings = { families: { ARTIST_BALANCE_CYCLE_ANCHOR: { rows: roster.map((a) => ({ key: `balance_cycle_anchor:${a.id}`, value: { anchorDate: anchor }, updatedAt: null })) } } };
  const state = {
    todayIL: TODAY,
    domains: {
      projects: { data: { index, open } },
      clients: { data: { items: [{ id: DANIEL, name: "דניאל צגאי", type: "לקוח", status: "פעיל", createdAt: null }, { id: SHALEV_CLIENT, name: "שליו טסמה", type: "אמן לייבל", status: "פעיל", createdAt: null }] } },
      labelArtists: { data: { items: roster.map((a) => ({ ...a, status: "פעיל", createdAt: null, updatedAt: null, balanceEntries: 0 })) } },
      victor: { data: { active: [] } }, sessions: { data: { items: [] } }, releasesFull: { data: { items: [] } }, proposalsFull: { data: { items: [] } }, tasksFull: { data: { items: [] } },
      shows: { data: { items: fx.shows ?? [{ id: S1, name: "פסטידאנס ת\"א", status: "בוצע", paymentStatus: "שולם", dateYmd: D(-3), dealType: "PAID", djClientId: null, djConfirmationStatus: null, artistClientId: SHALEV_CLIENT, bookerClientId: DANIEL, price: 2500 }] } },
    },
  };
  const ops = { redFilms: { rows: [], capped: false }, projectsMeta: { rows: projects.map(([id, p]) => ({ id, name: p.name, status: p.status, projectType: "שיר", businessType: p.businessType, artistText: p.artistText, deadline: null, startDate: null, endDate: null, parentProject: null, isHidden: false, songProjectId: null, plannedHours: null, plannedDays: null, updatedAt: null })), capped: false },
    engineerWork: { rows: raw.engineerWorks.map((w) => ({ ...w, workType: "מיקס", workTitle: null, sentDate: null, internalDeadline: null })), capped: false }, mixVersions: { rows: [], capped: false }, mixComments: { rows: [], capped: false }, finalFiles: { rows: [], capped: false },
    meetings: { rows: [], capped: false }, projectActions: { rows: [], capped: false }, calendarLinks: { rows: [], capped: false }, clipItems: { rows: [], capped: false }, campaigns: { rows: [], capped: false }, albumTracks: { rows: [], capped: false }, deliveries: { rows: [], capped: false }, budgetPayments: { rows: [], capped: false }, equipment: { rows: [], capped: false } };
  const det = { productions: { rows: [], capped: false }, budgetItems: { rows: [], capped: false }, budgetPayments: { rows: [], capped: false }, rfDocuments: { rows: [], capped: false }, rfRefImages: { rows: [], capped: false }, rfRefLinks: { rows: [], capped: false }, rfCrew: { rows: [], capped: false },
    tasks: { rows: [], capped: false }, sessions: { rows: [], capped: false }, meetings: { rows: [], capped: false }, releases: { rows: [], capped: false }, mixVersions: { rows: [], capped: false }, mixComments: { rows: [], capped: false }, mixTargets: { rows: [], capped: false }, mixTargetNotes: { rows: [], capped: false }, actions: { rows: [], capped: false } };
  const labelDetail = { artists: { rows: roster.map((a) => ({ id: a.id, name: a.name, status: "פעיל", hasImage: false, notes: null, createdAt: null, updatedAt: null })), capped: false }, ledger: { rows: ledger, capped: false }, cycles: { rows: [], capped: false }, mediaIncome: { rows: [], capped: false }, mediaAllocations: { rows: [], capped: false }, beats: { rows: [], capped: false }, shows: { rows: [], capped: false } };
  return {
    now: NOW, identities: { cleantone: null },
    state: { status: "OK", value: state } as never,
    finance: fx.noFinance ? { status: "UNAVAILABLE", detail: "x" } as never : { status: "OK", value: { raw, state: brain, integrity: { top: { reconcile: [] }, questions: [] }, actions: [], brief: null, answersAvailable: true } } as never,
    operations: { status: "OK", value: ops } as never, projectDetail: { status: "OK", value: det } as never, labelDetail: { status: "OK", value: labelDetail } as never,
    settings: { status: "OK", value: settings } as never,
    calendar: { status: "OK", value: { status: "CALENDAR_DATA_AVAILABLE", window: { start: D(-7), end: D(30), days: 37 }, fetchedAt: `${TODAY}T08:00:00Z`, cache: "NONE", calendars: [], events: [], truncated: false, reasons: [] } } as never,
    ownerInbox: { status: "OK", value: [] } as never, inboxMemory: { status: "OK", value: { links: [], interpretations: [] } } as never, ownerKnowledge: { status: "OK", value: [] } as never,
    audience: OWNER,
  } as GatewaySources;
}
const ff = (fx: Fx = {}): FinancialForward => buildFinancialForward(src(fx), cooCtx(src(fx)));
const ob = (f: FinancialForward, key: string) => f.obligations.find((o) => o.key === key || o.key.startsWith(key));
const texts = (o: unknown): string[] => (typeof o === "string" ? [o] : Array.isArray(o) ? o.flatMap(texts) : o && typeof o === "object" ? Object.values(o).flatMap(texts) : []);

async function main() {
  const F = ff();
  const brain = buildFinanceBrain(rawOf({}), NOW);

  section("ACTUAL vs EXPECTED");
  ok("1. received income = actual (₪2,500 in this month)", F.actualMonth["₪"]?.in === 2500, F.actualMonth);
  ok("2. a paid expense = actual out (DJ ₪500)", F.actualMonth["₪"]?.out === 500);
  ok("3. expected income never counted as received", F.windows.every((w) => !w.expectedInflow["₪"]) && F.inflow.receivables === 0);
  ok("4. a cancelled expense is never an obligation", !F.obligations.some((o) => o.key.includes("cancel")));
  ok("5. a cancelled engineer work is never a payable", !F.obligations.some((o) => o.provenance.includes("w-canc")));
  ok("6. a paid engineer work never appears as payable", !F.obligations.some((o) => o.provenance.includes("w-paid")));
  ok("7. a proposal is never cash (inflow flag)", F.inflow.proposalsAreNotCash === true);

  section("CURRENCY");
  ok("8. ₪ and $ totals stay separate (no FX)", F.windows.every((w) => Object.keys(w.hardOutflow).every((k) => k === "₪" || k === "$")));
  ok("9. the $ payable stays $", ob(F, "vendor-payable:Steven")?.currency === "$");
  ok("10. no exchange rate anywhere in financial-forward", !/exchange|fxRate|ILS_PER_USD|3\.25|\* ?1\.05/.test(code(read("lib/partner/coo/financial-forward.ts"))));
  ok("11. a ledger settlement says its currency is not stored", ob(F, "settlement:")?.currencyNote?.includes("לא שומר מטבע") === true);

  section("STEVEN $750 — HARD, no due date, NEEDS_DECISION");
  const st = ob(F, "vendor-payable:Steven")!;
  ok("12. EP $550 + $200 = ONE payable $750", !!st && st.amount === 750, st);
  ok("13. HARD + KNOWN_AMOUNT_UNKNOWN_DATE", st.strength === "HARD" && st.timing === "KNOWN_AMOUNT_UNKNOWN_DATE");
  ok("14. NEEDS_DECISION with the Owner's question", st.preparedness === "NEEDS_DECISION" && /מתי אתה רוצה לשלם את ה-\$750 לסטיבן/.test(st.questionHe ?? ""));
  ok("15. no invented due date, never overdue", st.date === null && st.overdue === false);
  ok("16. undated HARD → SHOULD (asks when), never MUST by itself", st.level === "SHOULD");
  ok("17. undated is never inside a dated window — it is 'undated' apart", F.windows[0].undatedHard["$"] === 750 && !F.windows[0].hardOutflow["$"]?.toString().includes("750"));
  const dh = ob(F, "ENGINEER_WORK:w-dh")!;
  ok("18. dansehall $400 = CONDITIONAL on completion (WATCH)", !!dh && dh.strength === "CONDITIONAL" && dh.level === "WATCH", dh);

  section("THE $210 ROWS — P0 double-count guard");
  for (const p of ["m-bam", "m-yah", "m-tzo"]) {
    const o = ob(F, `TX:${p}`)!;
    ok(`19. ${p}: no engineer work yet → CONDITIONAL, never overdue (01.10 = "October")`, !!o && o.timing === "CONDITIONAL" && !o.overdue && o.date === null, o);
  }
  ok("20. the Brain no longer reports them overdue", brain.openExpenses.items.filter((e) => /m-(bam|yah|tzo)/.test(e.id)).every((e) => e.overdueDays === null));
  ok("21. a manual mix row on a project WITH an open engineer work = possibleOverlap (counted once) — by expenseScope, not only category", brain.openExpenses.possibleOverlaps.some((o) => o.id === "TX:m-dh"), brain.openExpenses.possibleOverlaps.map((o) => o.id));
  ok("22. the engineer work stays the canonical obligation (counted once)", brain.openExpenses.items.some((e) => e.id === "ENGINEER_WORK:w-dh") && !brain.openExpenses.items.some((e) => e.id === "TX:m-dh"));
  ok("23. financial-forward shows the duplicate (never deletes / merges)", F.duplicates.some((d) => d.key === "TX:m-dh" && /נספר פעם אחת/.test(d.he) && /באישורך/.test(d.he)));
  const linked = ff({ dhStatus: "אושר", dhLinkedTx: true });
  ok("24. after completion (the writer's linked row) — still ONE obligation: linked row excluded, manual row an overlap", buildFinanceBrain(rawOf({ dhStatus: "אושר", dhLinkedTx: true }), NOW).openExpenses.items.filter((e) => e.projectId === P_DH).length === 1 && linked.duplicates.some((d) => d.key === "TX:m-dh"));
  ok("25. totals never include the duplicate", (F.windows[0].conditional["$"] ?? 0) === 630 + 400, F.windows[0].conditional);
  ok("26. no delete / write path in financial-forward", !/\.(insert|upsert|update|delete|rpc)\(|supabase|fetch\(/.test(code(read("lib/partner/coo/financial-forward.ts"))));

  section("VICTOR — HARD dated, readiness ≤7 SHOULD / ≤3 MUST / PREPARED quiet");
  const v = ob(F, "recurring:VICTOR_SALARY:2026-09")!;
  ok("27. Victor Sept $550 due 10.10 = HARD FIXED_KNOWN", !!v && v.strength === "HARD" && v.timing === "FIXED_KNOWN" && v.amount === 550 && v.currency === "$", v);
  ok("28. 5 days, no plan → SHOULD", v.daysTo === 5 && v.level === "SHOULD" && v.preparedness === "NEEDS_PREPARATION");
  ok("29. ≤3 days, no plan → MUST", ob(ff({ victorDue: D(2) }), "recurring:VICTOR_SALARY")?.level === "MUST");
  ok("30. a Finance row exists (Owner recorded) → not an un-prepared obligation", !ff({ victorTx: true }).obligations.some((o) => o.kind === "RECURRING" && o.preparedness !== "PREPARED"));
  ok("31. readiness rule: PREPARED → INFO (no noise)", readinessOf({ preparedness: "PREPARED", daysTo: 1, strength: "HARD", overdue: false, timing: "FIXED_KNOWN" }) === "INFO");
  ok("32. readiness rule: far (> 7d) no plan → WATCH", readinessOf({ preparedness: "NEEDS_PREPARATION", daysTo: 12, strength: "HARD", overdue: false, timing: "FIXED_KNOWN" }) === "WATCH");
  ok("33. readiness rule: overdue un-prepared → MUST", readinessOf({ preparedness: "NEEDS_PREPARATION", daysTo: -1, strength: "HARD", overdue: true, timing: "FIXED_KNOWN" }) === "MUST");
  ok("34. the windows constant is the approved 3 / 7", FINANCIAL_FORWARD_WINDOWS.mustDays === 3 && FINANCIAL_FORWARD_WINDOWS.shouldDays === 7);

  section("OWNER-RECORDED EXPECTED EXPENSES");
  const rent = ob(F, "TX:rent")!;
  ok("35. an Owner-recorded dated expected expense = PREPARED (quiet)", !!rent && rent.preparedness === "PREPARED" && rent.level === "INFO", rent);
  const late = ob(F, "TX:late")!;
  ok("36. a real past date not marked paid → overdue, asks 'שולם?' (WATCH, not hidden)", !!late && late.overdue && late.level === "WATCH" && /שולם\?/.test(late.questionHe ?? ""));
  ok("37. dated expected outflow inside 7d counted (₪300 + overdue ₪150)", F.windows[0].hardOutflow["₪"] === 450, F.windows[0].hardOutflow);

  section("SETTLEMENT — a review, never a payment; direction in words; dynamic");
  const sh = ob(F, `settlement:label-artist:${SHALEV_ARTIST_ID}`)!;
  ok("38. Shalev ₪2,213 → settlement obligation", !!sh && sh.amount === 2213, F.obligations.map((o) => o.key));
  ok("39. direction: RECORDS_OWES_ARTIST = 'לטובת שליו טסמה'", sh.direction === "RECORDS_OWES_ARTIST" && sh.directionHe === "לטובת שליו טסמה");
  ok("40. DYNAMIC + KNOWN_DATE_DYNAMIC_AMOUNT, never presented final", sh.dynamic && sh.timing === "KNOWN_DATE_DYNAMIC_AMOUNT" && /עדיין משתנה/.test(sh.he));
  ok("41. NEEDS_DECISION: 'משלמים … או מעבירים למחזור הבא?'", sh.preparedness === "NEEDS_DECISION" && /משלמים לשליו טסמה או מעבירים למחזור הבא\?/.test(sh.questionHe ?? ""));
  ok("42. the date is the cycle end (10.10) — 5 days → SHOULD", sh.date === "2026-10-10" && sh.daysTo === 5 && sh.level === "SHOULD");
  ok("43. what can change it is listed", sh.changeDriversHe.length >= 3);
  ok("44. a settlement counts as DYNAMIC exposure — never inside the hard outflow", sh.countsIn === "DYNAMIC" && F.windows[0].dynamicExposure["₪"] === 2213 && !F.windows[0].hardOutflow["₪"]?.toString().includes("2213"));
  ok("45. zero balance → nothing raised (Avi 0)", !F.obligations.some((o) => o.key === `settlement:label-artist:${AVI_ARTIST_ID}`));
  const neg = ff({ shalevBalance: -400 });
  ok("46. artist owes the label → 'לטובת הלייבל' (direction kept, amount positive)", ob(neg, "settlement:")?.directionHe === "לטובת הלייבל" && ob(neg, "settlement:")?.amount === 400);
  ok("47. a negative settlement reduces dynamic exposure (sign kept)", (neg.windows[0].dynamicExposure["₪"] ?? 0) === -400);
  ok("48. the settlement never becomes a transaction / expected expense", !/expected.*transaction|insertTransaction|ADD_TRANSACTION/.test(code(read("lib/partner/coo/financial-forward.ts"))));
  const passed = ff({ anchor: "2026-07-01" });
  ok("49. a cycle grid follows the anchor (another window → another date)", ob(passed, "settlement:")?.date !== "2026-10-10");
  ok("50. no global 50/50 — the settlement is the ledger's own computed balance", !/0\.5|50 ?%/.test(code(read("lib/partner/coo/financial-forward.ts"))));
  ok("51. NagashBeatz with no ledger → no settlement", !F.obligations.some((o) => o.key === `settlement:label-artist:${A_NAGASH}`));
  ok("52. ledger unreadable is said, never 'no settlement'", ff({ noLedger: true }).obligations.every((o) => o.kind !== "SETTLEMENT"));

  section("CASH / COVERAGE / UNITS");
  ok("53. coverage is ALWAYS UNKNOWN (no bank balance)", F.coverage === "UNKNOWN" && /אין לי יתרת בנק/.test(F.coverageHe));
  ok("54. never a solvency claim anywhere", !texts(F).some((t) => /יש מספיק כסף|העסק יציב/.test(t) || (/יש כיסוי/.test(t) && !/אם יש כיסוי/.test(t))));
  ok("55. 'לפי התזרים הרשום במערכת' wording", /לפי התזרים הרשום במערכת/.test(F.lineHe));
  ok("56. known outflow shown without cash", /יוצא בוודאות/.test(F.lineHe));
  ok("57. units shown side by side, never covering each other", !!F.unitsHe && /לא מסיקה שיחידה אחת מכסה אחרת/.test(F.unitsHe));
  ok("58. finance unreadable → UNKNOWN (never empty)", ff({ noFinance: true }).status === "UNKNOWN");

  section("WINDOWS");
  ok("59. three windows 7 / 14 / 30", F.windows.map((w) => w.days).join() === "7,14,30");
  ok("60. Victor in the 7-day window ($550 dated)", F.windows[0].hardOutflow["$"] === 550, F.windows[0].hardOutflow);
  ok("61. windows are cumulative (30 ⊇ 7)", (F.windows[2].hardOutflow["$"] ?? 0) >= (F.windows[0].hardOutflow["$"] ?? 0));
  ok("62. due date (10.10) ≠ decision: the settlement asks now, pays nothing", sh.questionHe !== null && sh.countsIn !== "OUTFLOW");

  section("PIPELINE");
  ok("63. no receivables + no proposals + no shows → commercial gap", F.commercialGap === true);
  ok("64. an open proposal removes the gap but is never inflow cash", (() => { const g = ff({ proposals: [{ id: "pr", clientId: null, status: "נשלח", amount: 5000, currency: "₪", followupDate: D(3), linkedProjectId: null }] }); return g.commercialGap === false && !g.windows[0].expectedInflow["₪"]; })());

  section("SURPRISES — the up-to-3 the Owner is not prepared for");
  ok("65. surprises = Victor + Shalev + Steven (not the prepared rows)", F.surprises.length === 3 && F.surprises.every((o) => o.preparedness !== "PREPARED"), F.surprises.map((o) => o.titleHe));
  ok("66. a prepared obligation is never a surprise (no repeated noise)", !F.surprises.some((o) => o.key.startsWith("TX:")));

  section("OVERTAKEN MONEY NOTE + the 'כסף' resolver bug");
  const m = moneyAlreadyRecorded(src(), "לבדוק מה עם הכסף של דניאל צגאי 2500");
  ok("67. a doubt about money Finance shows received → OVERTAKEN by canonical", !!m && m.entity === `show:${S1}` && /כבר התקבלו/.test(m.he), m);
  ok("68. a different amount → no claim", moneyAlreadyRecorded(src(), "לבדוק מה עם הכסף של דניאל צגאי 3100") === null);
  ok("69. no money words → no claim", moneyAlreadyRecorded(src(), "דניאל צגאי 2500 נפגשנו") === null);
  const item = { id: U(90), createdAt: `${D(0)}T16:59:00Z`, body: "לבדוק מה עם הכסף של דניאל צגאי 2500", author: "OWNER", epistemic: "OWNER_REPORTED", source: "DASHBOARD_V2", status: "NEW", processedAt: null, processedVia: null, outcome: null, outcomeRef: null };
  const lc = decideInboxLifecycle(inboxLifecycleBaseOf(src(), item as never, null, TODAY));
  ok("70. the lifecycle state is OVERTAKEN (never NEEDS_OWNER / reopened)", lc.state === "OVERTAKEN" && /לא לפתוח מחדש ולא לשאול שוב/.test(lc.nextHe), { state: lc.state, next: lc.nextHe });
  ok("71. 'כסף' is a generic word — never a whole-name project link", isWeakName("כסף") && findMentions("לבדוק מה עם הכסף של דניאל", buildMentionIndex(src())).every((x) => x.quality !== "TEXT_MATCH" || !x.name.includes("כסף")));

  section("BUSINESS_MOTION INTEGRATION — an input, never a second engine");
  const V = buildCooView(src());
  const fin = V.motion.all.filter((i) => i.financial);
  ok("72. financial MUST / SHOULD enter motion as moves (Victor / Shalev / Steven)", fin.length === 3 && fin.every((i) => i.level === "SHOULD" || i.level === "MUST"), fin.map((i) => [i.titleHe, i.level]));
  ok("73. a financial MUST can enter TODAY", (() => { const w = buildCooView(src({ victorDue: D(1) })); return w.motion.todayItems.some((i) => i.financial && i.level === "MUST"); })());
  ok("74. prepared / conditional money stays out of motion (no noise)", !V.motion.all.some((i) => i.financial && i.titleHe.startsWith("מיקס —")));
  ok("75. the greeting stays operational — money is ONE line, never moves", V.motion.greeting.every((i) => !i.financial) && (V.motion.answerHe.match(/מבחינת כסף:/g) ?? []).length <= 1);
  ok("76. the money line carries the coverage wording", /מבחינת כסף:[^\n]*לפי התזרים הרשום במערכת/.test(V.motion.answerHe), V.motion.answerHe);
  ok("77. every financial move names a REGISTERED action", fin.every((i) => !i.move || i.move.actionIds.every((a) => ACTION_REGISTRY.has(a) && (MOTION_ACTION_IDS as readonly string[]).includes(a))));
  ok("78. the duplicate appears as a WATCH note on its project (not a new obligation)", V.motion.all.some((i) => i.codes.includes("FIN_DUPLICATE") && i.level !== "MUST" && i.level !== "SHOULD"));
  ok("79. financial-forward has no ranking of its own (motion ranks)", !/sort\(\(a, b\) => lv\(|rankItems|todayItems/.test(code(read("lib/partner/coo/financial-forward.ts")).replace(/surprises[\s\S]*?slice\(0, 3\)/, "")));
  ok("80. capacity opportunity mentions the financial pressure when the pipeline is weak", !V.motion.week.opportunity || /הצנרת חלשה מול ההתחייבויות/.test(V.motion.week.opportunity.he));
  ok("81. coo mode forward served (OK, coverage UNKNOWN)", (() => { const q = queryKnowledgeCore(PARTNER_KNOWLEDGE_REGISTRY, { capability: "coo", mode: "forward" }, src() as never, OWNER); return q.status === "OK" && q.summary.some((x) => x.code === "COVERAGE" && x.value === "UNKNOWN"); })());
  ok("82. brief / motion summary carries the financial block", !!V.motion.financial && V.motion.financial.coverageHe.includes("אין לי יתרת בנק"));

  section("SAFETY");
  ok("83. financial-forward is pure (no server-only, no store, no fetch)", !/server-only|supabase|fetch\(|from ".*store"/.test(read("lib/partner/coo/financial-forward.ts")));
  ok("84. no cron / push / interval", !/setInterval|setTimeout|sendPush|schedule\(|cron\(/.test(code(read("lib/partner/coo/financial-forward.ts"))));
  ok("85. instructions: no solvency words, settlement = review, ask when to pay, OVERTAKEN money note", SERVER_INSTRUCTIONS.includes("NEVER \\\"יש כיסוי\\\"".replace(/\\\\/g, "\\").replace(/\\"/g, "\"")) && SERVER_INSTRUCTIONS.includes("settlement REVIEW") && SERVER_INSTRUCTIONS.includes("ask when to pay") && SERVER_INSTRUCTIONS.includes("OVERTAKEN"));
  ok("86. finance_position wording: not a forecast, not a bank balance, excludes artist liabilities", read("lib/partner/knowledge/capabilities/finance.ts").includes("לא יתרת בנק; לא כולל חוב לאמנים"));
  ok("87. unit_balance wording: Cash = recorded flow, not a bank balance", read("lib/partner/knowledge/capabilities/finance.ts").includes("לא יתרת בנק; אין להסיק ממנו כיסוי"));

  section("PASS 2.1 — STEVEN $750 stays HARD, undated, NEEDS_DECISION, visible");
  const st2 = ob(F, "vendor-payable:Steven")!;
  ok("88. Steven $750 remains HARD with NO date (KNOWN_AMOUNT_UNKNOWN_DATE)", st2.strength === "HARD" && st2.date === null && st2.timing === "KNOWN_AMOUNT_UNKNOWN_DATE");
  ok("89. Steven $750 is never overdue (no invented due date)", st2.overdue === false && !/באיחור|overdue/i.test(`${st2.titleHe} ${st2.questionHe ?? ""}`));
  ok("90. Steven stays NEEDS_DECISION (not PREPARED) while no payment plan exists", st2.preparedness === "NEEDS_DECISION");
  const stMove = V.motion.all.find((i) => i.financial && /סטיבן|Steven/.test(i.titleHe + i.he));
  ok("91. it never disappears: a SHOULD move in motion carrying the Owner's question", !!stMove && stMove.level === "SHOULD" && /מתי אתה רוצה לשלם את ה-\$750 לסטיבן/.test(stMove.he + stMove.reasonsHe.join(" ")), stMove);
  ok("92. it stays in the forward view (surprises) even when dated items lead", F.surprises.some((o) => o.key === st2.key));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
