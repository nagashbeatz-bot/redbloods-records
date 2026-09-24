/**
 * Redbloods Partner knowledge — FINANCE capabilities. Thin views over the Finance Brain's live state
 * (lib/partner/finance): no money rule is re-implemented here. Canonical semantics stay the Finance Brain's —
 * income received = שולם/התקבל, expense paid = שולם only; צפוי / לא שולם / בוטל are not realized; חלקי is not fully
 * paid; currencies are never merged or converted. Owner-only (FINANCIAL).
 */
import type { KnowledgeCapability, KnowledgeItem } from "../types";
import { item, ok, partner, partnerRecord, record, result, sfact, unavailable } from "./common";

const ACCESS = { externalRead: true, ownerOnly: true, sensitivity: "FINANCIAL" as const };
const SEMANTICS = "Finance Brain semantics: received income = שולם/התקבל; paid expense = שולם only; expected / unpaid / cancelled are not realized; partial is not fully paid; currencies are separate and never converted or summed together.";

export const financePosition: KnowledgeCapability = {
  id: "finance_position", domain: "FINANCE", titleHe: "מצב כספי",
  descriptionForModel: `The company's recorded money position from the Finance Brain: this month's actual income, actual expenses and net per currency, the month-end known position vs the Owner's ILS floor / preferred targets, and past months. ${SEMANTICS} Coverage says when recorded data is partial.`,
  examplesHe: ["איך אנחנו עם כסף?", "כמה נכנס החודש?", "מה הנטו?", "איך היו החודשים הקודמים?"],
  modes: { current_month: { descriptionForModel: "This month, per currency, with pacing vs targets" }, history: { descriptionForModel: "Previous months, per currency" } },
  defaultMode: "current_month", params: {}, paging: { defaultLimit: 12, maxLimit: 36 }, access: ACCESS, needs: ["FINANCE"],
  read(src, q) {
    const f = ok(src.finance);
    if (!f) return unavailable("Finance Brain");
    const s = f.state;
    const partial = f.brief?.coverage === "PARTIAL" || s.coverage.realizedIncome.state !== "RELIABLE" || s.coverage.realizedExpenses.state !== "RELIABLE";
    const coverage = [partner(SEMANTICS), ...(partial ? [partner("הכיסוי חלקי: הנתונים הרשומים לא בהכרח משקפים את כל התוצאה העסקית.")] : []), ...(f.brief?.coverageNoteHe ? [partnerRecord(f.brief.coverageNoteHe)] : [])];
    const months = q.mode === "history" ? [...s.history].sort((a, b) => b.month.localeCompare(a.month)) : [s.realized];
    const items: KnowledgeItem[] = months.flatMap((m) => Object.entries(m.byCurrency).sort(([a], [b]) => a.localeCompare(b)).map(([cur, flow]) => item({
      id: `${m.month}:${cur}`, label: partner(`${m.month} · ${cur}`), epistemic: "FACT", source: "FINANCE", freshness: q.mode === "history" ? "HISTORICAL" : "LIVE",
      fields: { month: m.month, currency: cur, actualIncome: flow.cashIn, actualExpenses: flow.cashOut, net: flow.net, recordedOnly: m.historicalPartial },
    })));
    const summary = q.mode === "history" ? [] : [
      sfact("TARGET_POSITION", "מיקום מול היעדים (₪ בלבד)", s.realized.targetPosition, "DERIVED", "FINANCE"),
      sfact("POLICY_ILS", "רצפה / יעד מועדף (₪)", { floor: s.policy.floorIls, preferred: s.policy.preferredIls }, "OWNER_DECISION", "FINANCE"),
      sfact("KNOWN_MONTH_END_ILS", "מצב ידוע לסוף החודש (₪) — לא תחזית", { recordedNet: s.pacing.recordedRealizedNetIls, knownIncoming: s.pacing.knownIncomingIls, knownOutgoing: s.pacing.knownOutgoingIls, knownPosition: s.pacing.knownMonthEndPositionIls, daysRemaining: s.pacing.daysRemaining }, "DERIVED", "FINANCE"),
      sfact("OTHER_CURRENCIES_KNOWN_FLOWS", "תזרים ידוע במטבעות אחרים (לא מומר)", s.pacing.otherCurrencies, "DERIVED", "FINANCE"),
    ];
    return result(items, { summary, coverage, completeness: partial ? "PARTIAL" : "COMPLETE" });
  },
};

export const financeReceivables: KnowledgeCapability = {
  id: "finance_receivables", domain: "FINANCE", titleHe: "מי חייב כסף",
  descriptionForModel: `Money owed to the company according to the Finance Brain: project / clip balances (agreed price minus received) and explicit expected-income records, each with amount + currency, due date, collection state (OVERDUE / DUE_SOON / NO_DUE_DATE …), the client attribution quality (TEXT_MATCH, never a hard link) and Owner closures. Partner does NOT know why a payment is late (reason UNKNOWN). ${SEMANTICS}`,
  examplesHe: ["מי חייב לי כסף?", "מה פתוח לגבייה?", "מה באיחור?"],
  modes: { open: { descriptionForModel: "Still collectible (default)" }, all: { descriptionForModel: "Including settled and Owner-closed" } }, defaultMode: "open",
  params: { state: { kind: "enum", values: ["UPCOMING", "DUE_SOON", "DUE_TODAY", "OVERDUE", "NO_DUE_DATE", "SETTLED", "NOT_COLLECTIBLE", "NEEDS_REVIEW"], descriptionForModel: "Only this collection state" } },
  paging: { defaultLimit: 15, maxLimit: 40 }, access: ACCESS, needs: ["FINANCE"],
  read(src, q) {
    const f = ok(src.finance);
    if (!f) return unavailable("Finance Brain");
    const rs = f.state.receivables.filter((r) => (q.mode === "all" || !["SETTLED", "NOT_COLLECTIBLE"].includes(r.collection.state)) && (!q.params.state || r.collection.state === q.params.state))
      .sort((a, b) => (a.collection.daysOverdue === null ? 1 : 0) - (b.collection.daysOverdue === null ? 1 : 0) || (b.collection.daysOverdue ?? 0) - (a.collection.daysOverdue ?? 0) || (a.dueDate ?? "9").localeCompare(b.dueDate ?? "9") || a.id.localeCompare(b.id));
    const totals: Record<string, number> = {};
    for (const r of rs) totals[r.currency] = (totals[r.currency] ?? 0) + r.amount;
    return result(rs.map((r) => item({
      id: r.id, entity: r.projectId ? `project:${r.projectId}` : null, label: record(r.projectName ?? "—"),
      epistemic: r.ownerClosure ? "OWNER_DECISION" : r.source === "EXPECTED_TX" ? "FACT" : "DERIVED", source: "FINANCE",
      relationQuality: r.client.attribution === "TEXT_MATCH" ? "TEXT_MATCH" : r.client.attribution === "NONE" ? "UNKNOWN" : "UNKNOWN",
      fields: { source: r.source, amount: r.amount, currency: r.currency, priceKnown: r.priceKnown, dueDate: r.dueDate, collectionState: r.collection.state, daysOverdue: r.collection.daysOverdue, daysUntilDue: r.collection.daysUntilDue, important: r.collection.important, projectStatus: r.projectStatus, clientAttribution: r.client.attribution, ownerClosure: r.ownerClosure ? { answerCode: r.ownerClosure.answerCode, reconciliation: r.ownerClosure.reconciliation } : null, reason: "UNKNOWN" },
    })), { summary: [sfact("TOTAL_BY_CURRENCY", "סה״כ לפי מטבע (לא מאוחד)", totals, "DERIVED", "FINANCE")], coverage: [partner(SEMANTICS)] });
  },
};

export const financeFlows: KnowledgeCapability = {
  id: "finance_flows", domain: "FINANCE", titleHe: "כסף צפוי והוצאות פתוחות",
  descriptionForModel: `Money that is expected but not realized, from the Finance Brain: expected income (dated / undated expected records, proposal pipeline — with certainty) and open expenses the company still owes (transactions, show payouts, engineer work), each with currency and due date. Nothing here is realized money. ${SEMANTICS}`,
  examplesHe: ["כמה כסף צפוי להיכנס?", "מה אני צריך לשלם?", "אילו הוצאות פתוחות?"],
  modes: { expected_income: { descriptionForModel: "Expected (not yet received) income" }, open_expenses: { descriptionForModel: "Expenses still to pay" } }, defaultMode: "expected_income",
  params: {}, paging: { defaultLimit: 15, maxLimit: 40 }, access: ACCESS, needs: ["FINANCE"],
  read(src, q) {
    const f = ok(src.finance);
    if (!f) return unavailable("Finance Brain");
    if (q.mode === "open_expenses") {
      const xs = [...f.state.openExpenses.items].sort((a, b) => (a.dueDate ?? "9").localeCompare(b.dueDate ?? "9") || a.id.localeCompare(b.id));
      return result(xs.map((x) => item({ id: x.id, entity: x.projectId ? `project:${x.projectId}` : null, label: record(x.category ?? x.source), epistemic: "FACT", source: "FINANCE",
        fields: { source: x.source, amount: x.amount, currency: x.currency, dueDate: x.dueDate, overdueDays: x.overdueDays, legacy: x.legacy } })),
        { summary: [sfact("TOTAL_BY_CURRENCY", "סה״כ לפי מטבע (לא מאוחד)", f.state.openExpenses.totalsByCurrency, "DERIVED", "FINANCE"), sfact("POSSIBLE_OVERLAPS", "חפיפות אפשריות", f.state.openExpenses.possibleOverlaps.length, "HYPOTHESIS", "FINANCE")], coverage: [partner(SEMANTICS)] });
    }
    const xs = [...f.state.expected].sort((a, b) => (a.date ?? "9").localeCompare(b.date ?? "9") || a.amount - b.amount);
    return result(xs.map((x, i) => item({ id: `${x.class}:${x.projectId ?? "-"}:${x.date ?? "-"}:${i}`, entity: x.projectId ? `project:${x.projectId}` : null, label: partner(x.class), epistemic: x.certainty === "CONTRACTUAL_RECORD" ? "FACT" : x.certainty === "PROPOSAL_ONLY" ? "HYPOTHESIS" : "UNKNOWN", source: "FINANCE",
      fields: { class: x.class, amount: x.amount, currency: x.currency, date: x.date, certainty: x.certainty } })), { coverage: [partner(SEMANTICS), partner("כסף צפוי אינו כסף שהתקבל.")] });
  },
};

export const financeIntegrity: KnowledgeCapability = {
  id: "finance_integrity", domain: "FINANCE", titleHe: "חוסרים ובעיות בנתוני הכספים",
  descriptionForModel: "Finance data integrity from the Finance Brain: missing evidence and data problems (missing prices, expected income not recorded, expenses outside Finance, ambiguous currencies, label ledger / media income without currency, orphan settings …) with counts, per-currency amounts and whether only the Owner can resolve it; plus per-area coverage.",
  examplesHe: ["מה חסר בכספים?", "על מה אי אפשר לסמוך בנתוני הכסף?"],
  modes: { signals: { descriptionForModel: "Finance data signals" }, coverage: { descriptionForModel: "Coverage per finance area" } }, defaultMode: "signals",
  params: {}, paging: { defaultLimit: 20, maxLimit: 40 }, access: ACCESS, needs: ["FINANCE"],
  read(src, q) {
    const f = ok(src.finance);
    if (!f) return unavailable("Finance Brain");
    if (q.mode === "coverage") {
      return result(Object.entries(f.state.coverage).sort(([a], [b]) => a.localeCompare(b)).map(([k, c]) => item({ id: k, label: partner(k), epistemic: c.state === "RELIABLE" ? "FACT" : "UNKNOWN", source: "FINANCE", fields: { coverage: c.state, reason: partnerRecord(c.reason) } })));
    }
    return result([...f.state.signals].sort((a, b) => a.code.localeCompare(b.code)).map((s) => item({ id: s.code, label: partner(s.code), epistemic: s.epistemic, source: "FINANCE", fields: { count: s.count, amountsByCurrency: s.amounts, needsOwnerReview: s.review === "NEEDS_OWNER_REVIEW" } })),
      { summary: [sfact("OPEN_FINANCE_QUESTIONS", "שאלות כספים פתוחות לבעלים", f.integrity.questions.length, "FACT", "FINANCE")] });
  },
};

export const victorSalary: KnowledgeCapability = {
  id: "victor_salary", domain: "TEAM", titleHe: "משכורת Victor",
  descriptionForModel: "Victor's monthly salary per work month from the canonical salary model (status override > linked Finance transaction > due date): amount + currency, due date, and whether it is found in Finance, paid outside Finance, expected-not-found or upcoming; plus Partner's memory of each month (observations, unresolved source conflicts, Owner answers). Use partner_entity recurring:VICTOR_SALARY:YYYY-MM for one month in depth.",
  examplesHe: ["שילמתי לויקטור?", "מה המצב עם המשכורת של Victor?", "ומה קרה באוגוסט?"],
  modes: { months: { descriptionForModel: "Salary months, newest first" } }, defaultMode: "months",
  params: {}, paging: { defaultLimit: 12, maxLimit: 24 }, access: ACCESS, needs: ["FINANCE", "MEMORY"],
  read(src) {
    const f = ok(src.finance);
    if (!f) return unavailable("Finance Brain");
    const mem = ok(src.memory);
    const known = f.state.recurring.known.filter((k) => k.code === "VICTOR_SALARY").sort((a, b) => b.workMonth.localeCompare(a.workMonth));
    return result(known.map((k) => {
      const m = mem?.entities.find((e) => e.entity.key === `recurring:VICTOR_SALARY:${k.workMonth}`);
      return item({ id: k.workMonth, entity: `recurring:VICTOR_SALARY:${k.workMonth}`, label: partner(`משכורת Victor ${k.workMonth}`), epistemic: k.state === "FOUND_IN_FINANCE" ? "FACT" : "DERIVED", source: "FINANCE",
        fields: { workMonth: k.workMonth, dueDate: k.dueDate, amount: k.amount, currency: k.currency, state: k.state, ownerDecisions: m?.ownerDecisions.filter((d) => d.status === "ACTIVE").map((d) => ({ questionType: d.questionType, answerCode: d.answerCode, epistemic: "OWNER_DECISION" })) ?? [], sourceConflicts: m?.conflicts.map((c) => c.code) ?? [], observations: m?.observations.map((o) => ({ issueType: o.signature.issueType, current: o.current })) ?? [] } });
    }), { completeness: mem ? "COMPLETE" : "PARTIAL", missing: mem ? [] : [{ fact: "organizational memory", whyNeeded: "Owner answers / history per month could not be read" }] });
  },
};
