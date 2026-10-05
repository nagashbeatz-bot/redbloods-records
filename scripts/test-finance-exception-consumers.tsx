/**
 * Tests — the Owner's finance exception is consumed by every Sunny finance reader (Stage 1, 2026-09-29).
 *
 * Run with:   npx tsx scripts/test-finance-exception-consumers.tsx
 *
 * The case that exposed it: a completed client project with a paid expense, no income and financeException=true
 * (reason + date, the Owner's decision) was asked about again — "הושלם, יש הוצאה, אין הכנסה — מה קרה?" — in a new
 * conversation, and partner_entity showed only "price unknown". The decision is canonical (the `finance_<id>`
 * setting); Stage 1 makes every reader consume it. No new store, no Owner-context / P2 copy of the decision.
 *
 * NEVER touches production: the REAL Finance Brain, integrity, finance view, company state (computeCoo +
 * assemblePartnerCompanyState), memory and Gateway (partner_entity / partner_brief), on in-memory fixtures.
 * Every "conversation" builds all sources from scratch — nothing is carried between them.
 */
import fs from "node:fs";
import path from "node:path";
import { computeCoo } from "../lib/coo/pipeline";
import type { CooRawInput } from "../lib/coo/types";
import { assemblePartnerCompanyState } from "../lib/partner/eyes/company-state";
import type { PartnerEyesRaw } from "../lib/partner/eyes/types";
import { buildPartnerCases } from "../lib/partner/cases/engine";
import { buildFinanceBrain, financeExceptionOf } from "../lib/partner/finance/core";
import { buildFinanceIntegrity } from "../lib/partner/finance/integrity";
import { deriveFinanceView } from "../lib/partner/finance/view";
import { buildFinanceBrief } from "../lib/partner/finance/brief";
import type { FinanceRaw } from "../lib/partner/finance/types";
import { buildPartnerMemory } from "../lib/partner/memory/core";
import { getPartnerEntityCore } from "../lib/partner/gateway/entity";
import { getPartnerBriefCore } from "../lib/partner/gateway/brief";
import type { GatewaySources, GatewayFinance } from "../lib/partner/gateway/core";
import type { EntityResponse } from "../lib/partner/gateway/types";
import { empty, project, tx } from "./fixtures/finance-mirror";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}
const ok = (name: string, cond: boolean) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}`); fail++; } };
const section = (s: string) => console.log(`\n${s}`);

const NOW = new Date("2026-09-29T12:00:00Z");
const U = (n: number) => `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`;
const P_EXC = U(1), P_PLAIN = U(2), P_PRICED = U(3);
const REASON = "מחיר 3,300 ₪ — הכסף התקבל לפני כשנה, לפני הרישום במערכת. לא נרשם כהכנסה.";
const EXC_DATE = "2026-09-29";
const INCOME_Q = "FINANCE_COMPLETED_PROJECT_INCOME_STATUS";

interface Fx { exception?: boolean; keepReasonWhenOff?: boolean; name?: string; updatedAt?: string }

/** The exception project + a plain completed project with the same shape + a normal priced open project. */
function financeRaw(o: Fx = {}): FinanceRaw {
  const on = o.exception ?? true;
  const excValue = on ? { financeException: true, financeExceptionReason: REASON, financeExceptionDate: EXC_DATE }
    : o.keepReasonWhenOff ? { financeException: false, financeExceptionReason: REASON, financeExceptionDate: EXC_DATE } : {};
  return empty({
    projects: [
      project({ id: P_EXC, name: o.name ?? "הסיפור שלי", status: "הושלם", businessType: "לקוח", artist: "לקוח א", updatedAt: o.updatedAt ?? "2026-09-29T08:58:00Z" }),
      project({ id: P_PLAIN, name: "שיר רגיל", status: "הושלם", businessType: "לקוח", artist: "לקוח ב", updatedAt: "2026-09-29T08:00:00Z" }),
      project({ id: P_PRICED, name: "פרויקט פתוח", status: "במיקס", businessType: "לקוח", artist: "לקוח ג", updatedAt: "2026-09-20T08:00:00Z" }),
    ],
    financeSettings: [{ projectId: P_EXC, value: excValue }, { projectId: P_PRICED, value: { agreedPrice: 4000, currency: "₪" } }],
    transactions: [
      tx({ projectId: P_EXC, scope: "project", type: "expense", amount: 650, status: "שולם", date: "2026-07-06" }),
      tx({ projectId: P_PLAIN, scope: "project", type: "expense", amount: 400, status: "שולם", date: "2026-09-10" }),
      tx({ projectId: P_PRICED, scope: "project", type: "income", amount: 1000, status: "שולם", date: "2026-09-15" }),
    ],
  });
}

function cooRaw(o: Fx): CooRawInput {
  const st = (source: string) => ({ source, status: "ok" as const, rowCount: 1 });
  const proj = (id: string, name: string, status: string) => ({ id, name, artist: "לקוח", status, deadline: null, projectType: "שיר", businessType: "לקוח", updatedAt: "2026-09-20T10:00:00Z", isHidden: false });
  const on = o.exception ?? true;
  return structuredClone<CooRawInput>({
    sources: ["projects", "tasks", "steven", "victor", "proposals", "shows", "sessions", "transactions", "finance_settings", "releases"].map(st),
    projects: [proj(P_EXC, o.name ?? "הסיפור שלי", "הושלם"), proj(P_PLAIN, "שיר רגיל", "הושלם"), proj(P_PRICED, "פרויקט פתוח", "במיקס")],
    tasks: [], steven: [], victor: { stuckAfterDays: 5, works: [] }, proposals: [], shows: [], sessions: [],
    transactions: [],
    financeSettings: [{ projectId: P_EXC, agreedPrice: 0, currency: "₪", financeException: on }, { projectId: P_PRICED, agreedPrice: 4000, currency: "₪", financeException: false }],
    orphanFinanceKeyCount: 0, releases: { labelProjectsTotal: 0, rows: [] },
  });
}

function eyesRaw(): PartnerEyesRaw {
  return structuredClone<PartnerEyesRaw>({
    sources: ["clients", "label_artists", "clip_productions", "artist_balance_entries", "sessions_eyes", "shows_eyes", "proposals_eyes", "releases_eyes", "transactions_eyes", "tasks_eyes"].map((s) => ({ source: s, status: "ok" as const, rowCount: 1 })),
    clients: [], labelArtists: [], clips: [], artistBalanceEntries: [], sessions: [], shows: [], proposalsFull: [], releasesFull: [],
    transactions: [{ id: U(900), projectId: P_EXC, type: "expense", amount: 650, currency: "₪", status: "שולם", date: "2026-07-06", expenseScope: "כללי", category: "", createdAt: "2026-07-06T10:00:00Z" }],
    tasksFull: [],
  });
}

/** One brand-new "conversation": every source built from scratch by the real engines, nothing carried over. */
function conversation(o: Fx = {}, now: Date = NOW): GatewaySources {
  const raw = financeRaw(o);
  const view = deriveFinanceView(raw, now, []);
  const s = assemblePartnerCompanyState(computeCoo(cooRaw(o), now), eyesRaw());
  const finance: GatewayFinance = { state: view.state, integrity: view.integrity, actions: view.actions, raw, brief: buildFinanceBrief(view.state, view.integrity, { answersAvailable: true, actionNoteHe: view.actionNoteHe }), answersAvailable: true };
  const memory = buildPartnerMemory({ now, finance: { status: "OK", raw, view }, ownerContexts: { status: "OK", history: [] }, actionEvents: { status: "OK", events: [] }, outcomes: { status: "OK", outcomes: [] } });
  return {
    now, state: { status: "OK", value: s }, finance: { status: "OK", value: finance }, memory: { status: "OK", value: memory },
    cases: { status: "OK", value: buildPartnerCases({ state: s, today: s.todayIL }) }, actions: { status: "OK", value: [] }, outcomes: { status: "OK", value: [] },
    identities: { cleantone: null },
  };
}

const brain = (o: Fx = {}, now: Date = NOW) => { const raw = financeRaw(o); const state = buildFinanceBrain(raw, now); return { state, integrity: buildFinanceIntegrity(raw, state, now) }; };
const noIncomeIssue = (o: Fx, pid: string, now?: Date) => brain(o, now).integrity.issues.some((i) => i.issueType === "COMPLETED_WORK_NO_INCOME" && i.subjectId === pid);
const incomeQuestion = (o: Fx, pid: string, now?: Date) => brain(o, now).integrity.questions.some((q) => q.questionType === INCOME_Q && q.subject.id === pid);
const expenseNoIncomeSig = (o: Fx, pid: string, now?: Date) => {
  const st = brain(o, now).state;
  const sig = st.signals.find((x) => x.code === "COMPLETED_WORK_EXPENSE_NO_INCOME");
  const opp = st.opportunities.find((x) => x.code === "COMPLETED_WORK_EXPENSE_NO_INCOME");
  return !!sig?.evidence.some((e) => e.projectId === pid) || !!opp?.evidence.some((e) => e.projectId === pid);
};
const factOf = (e: EntityResponse, code: string) => e.facts.find((f) => f.code === code);
const briefAsks = (src: GatewaySources, pid: string) => getPartnerBriefCore(src).items.some((i) => i.category === "OWNER_DECISION_NEEDED" && i.subject === `project:${pid}`);
const entityAsks = (e: EntityResponse) => e.openQuestions.some((q) => q.questionType === INCOME_Q);

function main() {
  section("T1 — completed + paid expense + no income + financeException=true → no missing-income signal");
  ok("no COMPLETED_WORK_NO_INCOME issue (integrity)", !noIncomeIssue({}, P_EXC));
  ok(`no ${INCOME_Q} Owner question`, !incomeQuestion({}, P_EXC));
  ok("no COMPLETED_WORK_EXPENSE_NO_INCOME signal / opportunity (Finance Brain)", !expenseNoIncomeSig({}, P_EXC));
  ok("no RECORD_RECEIVED_INCOME candidate for it", !deriveFinanceView(financeRaw(), NOW, []).actions.some((a) => a.subject.id === P_EXC));
  ok("the money figures are identical with the exception on or off (it never changes a total)", JSON.stringify(brain().state.realized.ils) === JSON.stringify(brain({ exception: false }).state.realized.ils) && JSON.stringify(brain().state.realized.byCurrency ?? null) === JSON.stringify(brain({ exception: false }).state.realized.byCurrency ?? null) && financeRaw().transactions.some((t) => t.projectId === P_EXC && t.amount === 650 && t.status === "שולם"));

  section("T2 — the same state with financeException=false → the normal signals still appear");
  ok("COMPLETED_WORK_NO_INCOME issue", noIncomeIssue({ exception: false }, P_EXC));
  ok(`${INCOME_Q} question`, incomeQuestion({ exception: false }, P_EXC));
  ok("COMPLETED_WORK_EXPENSE_NO_INCOME signal", expenseNoIncomeSig({ exception: false }, P_EXC));

  section("T3 — partner_entity explains the exception (OWNER_DECISION, reason, date)");
  const e = getPartnerEntityCore(`project:${P_EXC}`, conversation());
  const fx = factOf(e, "FINANCE_EXCEPTION");
  check("FINANCE_EXCEPTION fact: active, reason (record text), date, OWNER_DECISION, from FINANCE", fx && { v: { active: (fx.value as { active: boolean }).active, reason: (fx.value as { reason: unknown }).reason, date: (fx.value as { date: unknown }).date }, epistemic: fx.epistemic, source: fx.source },
    { v: { active: true, reason: { text: REASON, trust: "RECORD" }, date: EXC_DATE }, epistemic: "OWNER_DECISION", source: "FINANCE" });
  ok("the fact says what the exception means (checks do not apply, data unchanged)", /חריגה כספית/.test(JSON.stringify(fx?.value)) && /לא השתנו/.test(JSON.stringify(fx?.value)));
  const price = factOf(e, "PROJECT_PRICE");
  ok("PROJECT_PRICE is never a bare UNKNOWN on an exception project — it names the reason", price?.epistemic === "OWNER_DECISION" && (price.value as { notUsedBecause: string }).notUsedBecause === "FINANCE_EXCEPTION");
  ok("FINANCE_COVERAGE carries basis FINANCE_EXCEPTION (never confused with a label project)", (factOf(e, "FINANCE_COVERAGE")?.value as { basis?: string }).basis === "FINANCE_EXCEPTION");
  ok("missing[] no longer asks for an agreed price", !e.missing.some((m) => m.fact === "agreed price"));
  ok("openQuestions carries no missing-income question", !entityAsks(e));
  ok("no second decision record is invented (ownerDecisions stays the Owner-context list — empty here)", e.ownerDecisions.length === 0);

  section("T4 — brief + entity built from scratch (a brand-new conversation) → the exception is known, the wrong question never returns");
  const c1 = conversation(), c2 = conversation();
  ok("conversation 1: the brief does not ask about the exception project", !briefAsks(c1, P_EXC));
  ok("conversation 2 (fresh sources): same answer, same fact", !briefAsks(c2, P_EXC) && !!factOf(getPartnerEntityCore(`project:${P_EXC}`, c2), "FINANCE_EXCEPTION"));
  ok("the brief still asks about the plain project (the rule itself is alive)", briefAsks(c1, P_PLAIN));

  section("T5 — a day / a month later, no data change → the same behaviour (no forgetting)");
  for (const [label, days] of [["+1 day", 1], ["+30 days", 30]] as const) {
    const later = new Date(NOW.getTime() + days * 86400000);
    const src = conversation({}, later);
    const ent = getPartnerEntityCore(`project:${P_EXC}`, src);
    ok(`${label}: no question, no signal, the exception fact is there`, !briefAsks(src, P_EXC) && !entityAsks(ent) && !incomeQuestion({}, P_EXC, later) && !expenseNoIncomeSig({}, P_EXC, later) && !!factOf(ent, "FINANCE_EXCEPTION"));
  }

  section("T6 — the exception turned off legitimately (financeException=false) → normal finance behaviour returns");
  const off: Fx = { exception: false, keepReasonWhenOff: true }; // SET_FINANCE_EXCEPTION on=false writes only the flag; the old reason stays stored
  ok("financeExceptionOf ignores a stale reason when the flag is off", financeExceptionOf({ financeException: false, financeExceptionReason: REASON }) === null);
  ok("the issue, the question and the Finance Brain signal come back", noIncomeIssue(off, P_EXC) && incomeQuestion(off, P_EXC) && expenseNoIncomeSig(off, P_EXC));
  const eOff = getPartnerEntityCore(`project:${P_EXC}`, conversation(off));
  ok("partner_entity: no FINANCE_EXCEPTION fact, price UNKNOWN again, the question is back", !factOf(eOff, "FINANCE_EXCEPTION") && factOf(eOff, "PROJECT_PRICE")?.epistemic === "UNKNOWN" && entityAsks(eOff) && eOff.missing.some((m) => m.fact === "agreed price"));

  section("T7 — an irrelevant change (name / updatedAt only) while the exception holds → the problem does not come back");
  const renamed: Fx = { name: "הסיפור שלי (גרסה חדשה)", updatedAt: "2026-10-05T10:00:00Z" };
  ok("no issue / question / signal after a rename + a new updatedAt", !noIncomeIssue(renamed, P_EXC) && !incomeQuestion(renamed, P_EXC) && !expenseNoIncomeSig(renamed, P_EXC));
  const src7 = conversation(renamed);
  ok("brief + entity stay quiet and keep the fact", !briefAsks(src7, P_EXC) && !entityAsks(getPartnerEntityCore(`project:${P_EXC}`, src7)) && !!factOf(getPartnerEntityCore(`project:${P_EXC}`, src7), "FINANCE_EXCEPTION"));

  section("T8 — no regression on projects without an exception");
  ok("the plain completed project still gets COMPLETED_WORK_NO_INCOME + the question + the Brain signal", noIncomeIssue({}, P_PLAIN) && incomeQuestion({}, P_PLAIN) && expenseNoIncomeSig({}, P_PLAIN));
  const plain = getPartnerEntityCore(`project:${P_PLAIN}`, conversation());
  ok("plain project entity: no FINANCE_EXCEPTION, price UNKNOWN, agreed price missing, the question is open", !factOf(plain, "FINANCE_EXCEPTION") && factOf(plain, "PROJECT_PRICE")?.epistemic === "UNKNOWN" && plain.missing.some((m) => m.fact === "agreed price") && entityAsks(plain));
  const rec = brain().state.receivables.filter((r) => r.projectId === P_PRICED && r.source === "PROJECT_BALANCE");
  check("the priced open project keeps its receivable (₪3,000 of ₪4,000) — legitimate money signals are not silenced", rec.map((r) => [r.amount, r.currency]), [[3000, "₪"]]);
  const priced = getPartnerEntityCore(`project:${P_PRICED}`, conversation());
  ok("priced project entity: PROJECT_PRICE is a FACT, no exception fact", factOf(priced, "PROJECT_PRICE")?.epistemic === "FACT" && !factOf(priced, "FINANCE_EXCEPTION"));

  section("Guards — one rule, no second source of truth, no write path");
  const ROOT = path.resolve(__dirname, "..");
  const rd = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
  ok("integrity uses the shared financeExceptionOf (no private truth rule)", /financeExceptionOf\(/.test(rd("lib/partner/finance/integrity.ts")) && !/v\.financeException\)/.test(rd("lib/partner/finance/integrity.ts")));
  ok("partner_entity + the operating model read the exception through financeExceptionOf", /financeExceptionOf\(/.test(rd("lib/partner/gateway/entity.ts")) && /financeExceptionOf\(/.test(rd("lib/partner/sunny/operating.ts")));
  ok("financeExceptionOf reuses parseSetting's truth rule", /parseSetting\(value\)\.exception/.test(rd("lib/partner/finance/core.ts")));
  ok("no Owner-context / P2 copy of the decision is written by any of these readers", !/appendOwnerContext|appendOwnerKnowledge|\.insert\(|\.upsert\(/.test(rd("lib/partner/gateway/entity.ts") + rd("lib/partner/finance/integrity.ts") + rd("lib/partner/sunny/operating.ts")));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main();
