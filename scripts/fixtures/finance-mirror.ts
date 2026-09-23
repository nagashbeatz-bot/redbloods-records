/**
 * Shared test fixture — anonymous "production mirror" of the Finance data shape on 2026-09-23
 * (same construction as the one inlined in scripts/test-partner-finance-brain.tsx). Test-only; no I/O.
 */
import { randomUUID } from "node:crypto";
import type { FinanceRaw, FinanceTxRow, FinanceProjectRow, EngineerWorkRow, SalaryMonthRow } from "../../lib/partner/finance/types";

// ── fixture helpers ──
let seq = 1000;
export const id = () => { seq++; return `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`; };
export const tx = (o: Partial<FinanceTxRow> = {}): FinanceTxRow => ({ id: id(), projectId: null, type: "income", date: "2026-09-10", amount: 100, currency: "₪", status: "שולם", category: null, scope: "general", expenseScope: "כללי", linkedSessionId: null, createdAt: "2026-09-01T00:00:00Z", ...o });
export const project = (o: Partial<FinanceProjectRow> = {}): FinanceProjectRow => ({ id: id(), name: "פרויקט", status: "בעבודה", isHidden: false, businessType: "לקוח", artist: "אמן", updatedAt: "2026-09-01T00:00:00Z", ...o });
export const work = (o: Partial<EngineerWorkRow> = {}): EngineerWorkRow => ({ id: id(), projectId: null, engineerName: "Steven", status: "אושר", agreedPrice: 200, amountPaid: 0, currency: "$", linkedTransactionId: null, ...o });
export const empty = (o: Partial<FinanceRaw> = {}): FinanceRaw => ({ transactions: [], projects: [], financeSettings: [], engineerWorks: [], shows: [], proposals: [], clients: [], labelArtists: [], ledger: [], mediaIncome: [], redFilmsPayments: [], victorSalary: [], ...o });
export const withPrice = (p: FinanceProjectRow, price: number, extra: Record<string, unknown> = {}) => ({ projectId: p.id, value: { agreedPrice: price, currency: "₪", ...extra } });

// ── production mirror (shape of production on 2026-09-23; anonymous) ──
export function productionMirror(): FinanceRaw {
  const projects: FinanceProjectRow[] = [];
  const transactions: FinanceTxRow[] = [];
  const financeSettings: FinanceRaw["financeSettings"] = [];
  const engineerWorks: EngineerWorkRow[] = [];
  // clip project (song price unknown, clip price 3,500; ₪1,500 received, ₪2,000 expected on 30.09)
  const clipP = project({ status: "בעבודה", artist: "אמן א, אמן ב" }); projects.push(clipP);
  financeSettings.push({ projectId: clipP.id, value: { currency: "₪", clipAgreedPrice: 3500 } });
  transactions.push(tx({ projectId: clipP.id, scope: "project", expenseScope: "קליפ", amount: 1500, status: "התקבל", date: "2026-08-27", category: "מקדמה" }));
  transactions.push(tx({ projectId: clipP.id, scope: "project", expenseScope: "קליפ", amount: 2000, status: "צפוי", date: "2026-09-30", category: "תשלום סופי", createdAt: "2026-08-27T00:00:00Z" }));
  // priced projects
  const p3200 = project({ status: "הושלם", artist: "לקוח 1", updatedAt: "2026-08-10T00:00:00Z" }); projects.push(p3200); financeSettings.push(withPrice(p3200, 3200));
  transactions.push(tx({ projectId: p3200.id, scope: "project", amount: 1600, status: "התקבל", date: "2026-07-01" }));
  for (const [status, price] of [["הושלם", 3100], ["הושלם", 4250], ["מחכה למיקס", 3000]] as const) {
    const p = project({ status }); projects.push(p); financeSettings.push(withPrice(p, price));
    transactions.push(tx({ projectId: p.id, scope: "project", amount: price, status: "התקבל", date: "2026-06-15" }));
  }
  // 14 completed unpriced: 8 with a paid (engineer-linked, ₪) expense and no income; 2 of the rest carry undated $ rows
  const paid = [650, 650, 650, 650, 650, 650, 950, 1240];
  const completedPlain: FinanceProjectRow[] = [];
  for (let i = 0; i < 14; i++) {
    const p = project({ status: "הושלם", updatedAt: "2026-07-20T00:00:00Z" }); projects.push(p);
    if (i < 8) {
      const t = tx({ projectId: p.id, scope: "project", type: "expense", amount: paid[i], status: "שולם", date: "2026-07-05", category: "מיקס / מאסטר" });
      transactions.push(t);
      engineerWorks.push(work({ projectId: p.id, status: "אושר", agreedPrice: 200, amountPaid: 200, linkedTransactionId: t.id }));
    } else completedPlain.push(p);
  }
  for (const [i, amt] of [5, 50, 3, 30, 300].entries()) transactions.push(tx({ projectId: completedPlain[i % 2].id, scope: "project", type: "expense", amount: amt, currency: "$", status: "לא שולם", date: null, category: "מיקס / מאסטר", createdAt: "2026-06-29T00:00:00Z" }));
  // a 9th ambiguous settlement: a paid $ work settled by a ₪ transaction on a priced project
  const linked9 = tx({ projectId: p3200.id, scope: "project", type: "expense", amount: 650, status: "שולם", date: "2026-07-28", category: "מיקס / מאסטר" });
  transactions.push(linked9);
  engineerWorks.push(work({ projectId: p3200.id, status: "אושר", agreedPrice: 200, amountPaid: 200, linkedTransactionId: linked9.id }));
  // 19 more open unpriced projects (5 near delivery)
  const openStatuses = ["מחכה למיקס", "מחכה למיקס", "מחכה למיקס", "במיקס", "במיקס", ...Array(14).fill("בעבודה")];
  const openP = openStatuses.map((s) => project({ status: s }));
  projects.push(...openP);
  // Steven open obligations: 3 approved-unpaid ($150, $550, $200) + in progress $200 + sent $400
  engineerWorks.push(work({ projectId: openP[5].id, status: "אושר", agreedPrice: 150 }), work({ projectId: openP[6].id, status: "אושר", agreedPrice: 550 }), work({ projectId: openP[7].id, status: "אושר", agreedPrice: 200 }));
  engineerWorks.push(work({ projectId: openP[3].id, status: "בתהליך", agreedPrice: 200 }), work({ projectId: openP[4].id, status: "נשלח", agreedPrice: 400 }));
  // shows + payouts
  const inc = tx({ type: "income", amount: 2700, status: "התקבל", date: "2026-09-11", category: "הופעה", expenseScope: "הופעה" });
  const dj = tx({ type: "expense", amount: 500, status: "שולם", date: "2026-09-11", category: "שכר דיג'יי", expenseScope: "הופעה" });
  const artistSep = tx({ type: "expense", amount: 1100, status: "צפוי", date: "2026-09-11", category: "שכר אמן", expenseScope: "הופעה", createdAt: "2026-09-07T00:00:00Z" });
  const artistAug = tx({ type: "expense", amount: 1050, status: "צפוי", date: "2026-08-06", category: "שכר אמן", expenseScope: "הופעה", createdAt: "2026-07-30T00:00:00Z" });
  const djZero = tx({ type: "expense", amount: 0, status: "צפוי", date: "2026-09-03", category: "שכר דיג'יי", expenseScope: "הופעה", createdAt: "2026-08-26T00:00:00Z" });
  transactions.push(inc, dj, artistSep, artistAug, djZero);
  const shows = [
    { id: id(), date: "2026-09-11", status: "בוצע", paymentStatus: "שולם", price: 2700, incomeTxId: inc.id, artistTxId: artistSep.id, djTxId: dj.id },
    { id: id(), date: "2026-08-06", status: "בוצע", paymentStatus: "שולם", price: 2800, incomeTxId: null, artistTxId: artistAug.id, djTxId: null },
    { id: id(), date: "2026-09-03", status: "בוצע", paymentStatus: "צפוי", price: 0, incomeTxId: null, artistTxId: null, djTxId: djZero.id },
    { id: id(), date: "2026-09-16", status: "בוטל", paymentStatus: "בוטל", price: 1000, incomeTxId: null, artistTxId: null, djTxId: null },
  ];
  // duplicate-looking pair (₪100 YouTube, same date + project)
  for (let i = 0; i < 2; i++) transactions.push(tx({ projectId: openP[8].id, scope: "project", type: "expense", amount: 100, status: "שולם", date: "2026-08-01", category: "YouTube" }));
  // 9 orphan price settings (their projects no longer exist)
  for (let i = 0; i < 9; i++) financeSettings.push({ projectId: randomUUID(), value: { agreedPrice: 3000, currency: "₪" } });
  const victorSalary: SalaryMonthRow[] = [
    { workMonth: "2026-08", dueDate: "2026-09-10", amount: 550, currency: "$", status: "שולם", transactionId: null },
    { workMonth: "2026-09", dueDate: "2026-10-10", amount: 550, currency: "$", status: "צפוי", transactionId: null },
  ];
  const clients = [
    { id: id(), name: "אמן א", status: "חדש", type: "אמן" }, { id: id(), name: "אמן ב", status: "חדש", type: "אמן" }, { id: id(), name: "לקוח 1", status: "חדש", type: "לקוח" },
    ...Array.from({ length: 4 }, (_, i) => ({ id: id(), name: `VIP ${i}`, status: "VIP", type: "אמן" })),
  ];
  const proposals = [0, 1, 2].map(() => ({ id: id(), clientId: clients[2].id, status: "נסגר", amount: 3000, currency: "₪", followupDate: "2026-06-10", linkedProjectId: p3200.id }));
  const artistId = id();
  return {
    transactions, projects, financeSettings, engineerWorks, shows, proposals, clients,
    labelArtists: [{ id: artistId, name: "אמן לייבל" }],
    ledger: Array.from({ length: 16 }, (_, i) => ({ artistId, entryType: "הכנסות", amount: 100, sourceTxId: i < 3 ? inc.id : null })),
    mediaIncome: [{ labelArtistId: artistId, status: "התקבל", grossAmount: 765.5 }],
    redFilmsPayments: Array.from({ length: 9 }, () => ({ id: id(), amount: 400, paymentDate: "2026-07-01" })),
    victorSalary,
  };
}
