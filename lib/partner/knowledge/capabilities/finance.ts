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
  descriptionForModel: "Victor's monthly salary per work month from the canonical salary model (a live Finance row decides; an Owner statement only fills a month without one — a disagreement is a conflict; else the due date): amount + currency, due date, and whether it is found in Finance, paid outside Finance, expected-not-found or upcoming; plus Partner's memory of each month (observations, unresolved source conflicts, Owner answers). Use partner_entity recurring:VICTOR_SALARY:YYYY-MM for one month in depth.",
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

// ── Unit balance (task 5, Owner decisions 2026-09-28): the SAME numbers as the Finance screen (lib/finance/unit-balance) ──
import { unitBalanceFromFinanceRaw } from "../../finance/unit-view";
const UNIT_NAMES: Record<string, string> = { ALL: "כל Redbloods", STUDIO: "Studio", RECORDS: "Records", FILMS: "Films", CORPORATE: "Corporate" };
export const unitBalance: KnowledgeCapability = {
  id: "unit_balance", domain: "FINANCE", titleHe: "מאזן לפי יחידה עסקית",
  descriptionForModel: `Real money per business unit (STUDIO / RECORDS / FILMS / CORPORATE, and all Redbloods), all time, per currency — the SAME module as the Finance screen. Cash = realized income (שולם/התקבל) − paid expense (שולם); expected is a forecast, never cash; בוטל is never money; ₪ and $ are never added. Records: artist liabilities = positive artist-ledger balances (still owed); available to invest = cash − liabilities − reserve (0); future artist entitlements = active expected show entitlements (NOT cash, NOT a liability); future cash expenses = Records expenses still expected. A real artist payment = a Finance expense + a ledger payment (subtracted once). All Redbloods: cash and, apart, "available after liabilities". Also the artist-payment reconciliation (Finance ↔ ledger); the approved 1,000 + 810 exception is explained.`,
  examplesHe: ["כמה כסף יש ל-Records?", "כמה זמין להשקעה?", "כמה אנחנו חייבים לאמנים?", "מה ה-Cash של Studio?", "כמה כסף יש בכל Redbloods?"],
  modes: { position: { descriptionForModel: "Per unit + all Redbloods: cash, expected in / out, Records settlement" } }, defaultMode: "position", params: {},
  paging: { defaultLimit: 10, maxLimit: 10 }, access: ACCESS, needs: ["FINANCE"],
  read(src) {
    const f = ok(src.finance);
    if (!f) return unavailable("Finance Brain");
    const { balance: b, reconciliation: rec } = unitBalanceFromFinanceRaw(f.raw);
    const units = [["ALL", b.all], ...(["STUDIO", "RECORDS", "FILMS", "CORPORATE"] as const).map((u) => [u, b.units[u]] as const)] as const;
    const items: KnowledgeItem[] = units.map(([u, p]) => item({
      id: `unit:${u}`, label: partner(UNIT_NAMES[u]), epistemic: "DERIVED", source: "FINANCE", freshness: "LIVE",
      fields: {
        unit: u, cash: p.cash, realizedIncome: p.realizedIncome, realizedExpense: p.realizedExpense, expectedIncome: p.expectedIncome, expectedExpense: p.expectedExpense, rows: p.rows,
        ...(u === "ALL" ? { artistLiabilities: b.all.artistLiabilities, availableAfterLiabilities: b.all.availableAfterLiabilities } : {}),
        ...(u === "RECORDS" ? { artistLiabilities: b.records.artistLiabilities, artistReceivables: b.records.artistReceivables, byArtist: b.records.byArtist, reserve: b.records.reserve, availableToInvest: b.records.availableToInvest, futureArtistEntitlements: b.records.futureArtistEntitlements.total, futureCashExpenses: b.records.futureCashExpenses } : {}),
      },
    }));
    const summary = [
      sfact("RECORDS_AVAILABLE_TO_INVEST", "Records — זמין להשקעה (₪)", b.records.availableToInvest["₪"] ?? 0, "DERIVED", "FINANCE"),
      sfact("RECORDS_ARTIST_LIABILITIES", "Records — התחייבויות לאמנים (₪)", b.records.artistLiabilities, "DERIVED", "FINANCE"),
      sfact("UNCLASSIFIED_ROWS", "תנועות שדורשות סיווג יחידה", b.unclassified.rows, "FACT", "FINANCE"),
      sfact("ARTIST_PAYMENT_RECONCILIATION", "תשלומי אמנים: כספים ↔ מאזן", { ledgerWithoutFinance: rec.ledgerPaymentsWithoutFinance.length, financeWithoutLedger: rec.financePaymentsWithoutLedger.length, explained: rec.explained.length }, "DERIVED", "FINANCE"),
    ];
    return result(items, { summary, coverage: [partner("כסף אמיתי לפי יחידה עסקית (כל הזמנים), לפי מטבע — אותו חישוב של מסך הכספים. זכאות עתידית של אמן אינה Cash ואינה התחייבות.")], completeness: "COMPLETE" });
  },
};

// ── Task 6 (Owner decision 2026-09-28): Records ↔ artist expense share — the ONE rule (lib/records-expense-share) ──
import { expenseShareOf, projectSettlementRule } from "../../../records-expense-share";
import { expenseSharesFromFinanceRaw } from "../../finance/unit-view";
export const expenseShares: KnowledgeCapability = {
  id: "expense_shares", domain: "FINANCE", titleHe: "חלוקת הוצאות Records מול האמנים",
  descriptionForModel: `Who carries a real Records expense. Finance keeps the FULL amount Records paid (cash); the artist's part is an expense row in the artist ledger (the settlement). Rule by the project's credits: one Records artist 50/50; Shalev + Avi 50 Records / 25 / 25; NagashBeatz credited 100% Records (no artist charge); a Records artist next to an external host/client/guest (e.g. Balagan) = UNDEFINED, needs an agreement — never guessed. Any expense type. Not artist expenses: show money (inside the show's net split), payments to an artist, mix/master. Owner exceptions: ACUM 400 = 100% Shalev; Principe YouTube 3x100 = 100% Records; Principe clip = the Owner-recorded 2,480 row. Modes: summary (totals, per artist, reconciliation findings), transactions (each Records expense with its split), rule (the split for an artist text).`,
  examplesHe: ["כמה עלה הקליפ של שליו ומי נושא בו?", "מי משלם על קליפ של שליו?", "שליו ואבי ביחד — איך מתחלקים?", "NagashBeatz ושליו?", "אבי מתארח אצל טל צגאי — מי משלם?"],
  modes: {
    summary: { descriptionForModel: "Totals: cash out, Records share, artists' share, undefined cash; per artist; findings (missing / wrong / duplicate share rows)" },
    transactions: { descriptionForModel: "Each paid Records expense: cash, Records share, each artist's share, basis / reason" },
    rule: { descriptionForModel: "The split the rule gives for an artist credit text (param artists)" },
  },
  defaultMode: "summary", params: { artists: { kind: "text", maxLength: 120, descriptionForModel: "rule mode: the project's artist credits, comma separated" } },
  paging: { defaultLimit: 20, maxLimit: 50 }, access: ACCESS, needs: ["FINANCE"],
  read(src, q) {
    if (q.mode === "rule") {
      const r = projectSettlementRule(String(q.params?.artists ?? ""));
      return result([item({ id: "rule", label: partner("חוק החלוקה"), epistemic: "DERIVED", source: "FINANCE", freshness: "LIVE", fields: r.status === "DEFINED" ? { status: r.status, kind: r.kind, recordsPct: r.recordsPct, artists: r.artists, basisHe: r.basisHe } : { status: r.status, reason: r.reason, reasonHe: r.reasonHe, external: r.external } })], { completeness: "COMPLETE" });
    }
    const f = ok(src.finance);
    if (!f) return unavailable("Finance Brain");
    const rec = expenseSharesFromFinanceRaw(f.raw);
    const names = new Map(f.raw.labelArtists.map((a) => [a.id, a.name]));
    if (q.mode === "transactions") {
      const artistText = new Map(f.raw.projects.map((p) => [p.id, p.artist]));
      const items: KnowledgeItem[] = [];
      for (const t of f.raw.transactions) {
        const s = expenseShareOf({ id: t.id, type: t.type, amount: t.amount, currency: t.currency, paymentStatus: t.status, businessUnit: t.businessUnit ?? null, category: t.category, expenseScope: t.expenseScope, showId: t.showId ?? null, showMoneyRole: t.showMoneyRole ?? null, projectId: t.projectId }, t.projectId ? { artistText: artistText.get(t.projectId) ?? null } : null);
        if (s.status === "NOT_APPLICABLE") continue;
        items.push(item({ id: `tx:${t.id}`, label: partner(`${t.date ?? ""} · ${t.expenseScope ?? ""}`), epistemic: "DERIVED", source: "FINANCE", freshness: "LIVE", fields: {
          transactionId: t.id, projectId: t.projectId, date: t.date, paymentStatus: t.status, cashOut: s.amount, currency: s.currency, status: s.status,
          ...(s.status === "DEFINED" ? { basis: s.basis, kind: s.kind, active: s.active, recordsShare: s.recordsAmount, artists: s.artists.map((a) => ({ name: a.name, pct: a.pct, amount: a.amount })), basisHe: s.basisHe } : { reasonHe: s.reasonHe }),
        } }));
      }
      return result(items, { completeness: "COMPLETE" });
    }
    const summary = [
      sfact("RECORDS_EXPENSE_CASH_OUT", "הוצאות Records של אמנים — כסף שיצא בפועל (₪)", rec.totals.cashOut, "FACT", "FINANCE"),
      sfact("RECORDS_EXPENSE_RECORDS_SHARE", "החלק ש-Records נושאת (₪)", rec.totals.recordsShare, "DERIVED", "FINANCE"),
      sfact("RECORDS_EXPENSE_ARTISTS_SHARE", "החלק שנזקף לאמנים (₪)", rec.totals.artistShare, "DERIVED", "FINANCE"),
      sfact("RECORDS_EXPENSE_RECORDED_LUMP", "קליפ פרנציפ — חלק שליו רשום ברשומה אחת של הבעלים (הכסף שיצא, ₪)", rec.totals.recordedElsewhere, "FACT", "FINANCE"),
      sfact("RECORDS_EXPENSE_UNDEFINED", "הוצאות בלי חלוקה מוגדרת — דורש החלטת בעלים (₪)", rec.totals.undefinedCashOut, "DERIVED", "FINANCE"),
      sfact("RECORDS_EXPENSE_SHARE_FINDINGS", "אי-התאמות בין הכספים ליומן האמן", rec.findings.filter((x) => x.code !== "SHARE_UNDEFINED").length, "DERIVED", "FINANCE"),
    ];
    const items: KnowledgeItem[] = [
      ...Object.entries(rec.byArtist).map(([id, amount]) => item({ id: `artist:${id}`, label: partner(names.get(id) ?? id), epistemic: "DERIVED", source: "FINANCE", freshness: "LIVE", fields: { artistId: id, expenseShareIls: amount } })),
      ...rec.findings.map((x, i) => item({ id: `finding:${i}`, label: partner(x.he), epistemic: "DERIVED", source: "FINANCE", freshness: "LIVE", fields: { code: x.code, transactionId: x.transactionId, artist: x.artistId ? names.get(x.artistId) ?? x.artistId : null, expected: x.expected, recorded: x.recorded } })),
    ];
    return result(items, { summary, coverage: [partner("Finance = הסכום המלא ש-Records שילמה; חלק האמן = שורת הוצאה ביומן האמן. business_unit וחלוקת האמן הם שני דברים נפרדים.")], completeness: "COMPLETE" });
  },
};
