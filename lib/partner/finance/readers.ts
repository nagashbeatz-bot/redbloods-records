/**
 * Redbloods Partner — Finance Brain V1 reader CORE (injected client). READ-ONLY by construction:
 * the only query capabilities it is given are select / like / range. Minimal columns, no free text
 * (descriptions / notes are never read). Any table read error fails the whole read (the brief must
 * never be built from a silently partial read); only the canonical salary read may be absent
 * (recurring coverage then becomes MISSING — never guessed).
 */
import type { FinanceRaw, SalaryMonthRow } from "./types";

export interface FinanceReadResponse { data: unknown[] | null; error: { message?: string } | null }
export interface FinanceSelect extends PromiseLike<FinanceReadResponse> {
  range(from: number, to: number): FinanceSelect;
  like(column: string, pattern: string): FinanceSelect;
}
export interface FinanceReadClient { from(table: string): { select(columns: string): FinanceSelect } }

export class FinanceReadError extends Error {
  constructor(message: string) { super(message); this.name = "FinanceReadError"; }
}

const PAGE = 1000;
type Row = Record<string, unknown>;
const s = (v: unknown): string | null => (typeof v === "string" ? v : v === null || v === undefined ? null : String(v));

async function readAll(client: FinanceReadClient, table: string, columns: string, like?: [string, string]): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = client.from(table).select(columns);
    if (like) q = q.like(like[0], like[1]);
    const res = await q.range(from, from + PAGE - 1);
    if (res.error) throw new FinanceReadError(`${table} read failed`);
    if (!Array.isArray(res.data)) throw new FinanceReadError(`${table} returned no rows array`);
    rows.push(...(res.data as Row[]));
    if (res.data.length < PAGE) break;
  }
  return rows;
}

const FINANCE_KEY = /^finance_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export async function readFinanceRaw(client: FinanceReadClient, readSalary: () => Promise<SalaryMonthRow[]>): Promise<FinanceRaw> {
  const [tx, projects, settings, works, shows, proposals, clients, labelArtists, ledger, media, rfPay, legacyVictor, victorConfig, victorDescribed] = await Promise.all([
    readAll(client, "transactions", "id,project_id,type,date,amount,currency,payment_status,category,scope,expense_scope,linked_session_id,created_at"),
    readAll(client, "projects", "id,name,status,is_hidden,project_business_type,artist,updated_at"),
    readAll(client, "settings", "key,value", ["key", "finance_%"]),
    readAll(client, "sound_engineer_work", "id,project_id,engineer_name,status,agreed_price,amount_paid,currency,linked_transaction_id"),
    readAll(client, "shows", "id,date,status,payment_status,show_price,linked_income_transaction_id,linked_artist_expense_transaction_id,linked_dj_expense_transaction_id"),
    readAll(client, "proposals", "id,client_id,status,amount,currency,followup_date,linked_project_id"),
    readAll(client, "clients", "id,name,status,type"),
    readAll(client, "label_artists", "id,name"),
    readAll(client, "artist_balance_entries", "artist_id,entry_type,amount,source_tx_id"),
    readAll(client, "label_media_income", "label_artist_id,status,gross_amount"),
    readAll(client, "red_films_budget_payments", "id,amount,payment_date"),
    readAll(client, "settings", "key,value", ["key", "vendor_victor_payment_%"]),
    // F2.31: vendor_victor_settings / _salary_overrides / _salary_status_overrides, raw (the executor never uses code defaults)
    readAll(client, "settings", "key,value", ["key", "vendor_victor_s%"]),
    // F2.31: the ONLY free-text read — rows whose text starts with the canonical Victor salary prefix (duplicate guard)
    readAll(client, "transactions", "id,description", ["description", "משכורת Victor%"]),
  ]);
  const victorText = new Map(victorDescribed.map((r) => [String(r.id), s(r.description)]));
  let victorSalary: SalaryMonthRow[] | null = null;
  try { victorSalary = await readSalary(); } catch { victorSalary = null; }
  return {
    transactions: tx.map((r) => ({ id: String(r.id), projectId: s(r.project_id), type: s(r.type), date: s(r.date), amount: r.amount, currency: s(r.currency), status: s(r.payment_status), category: s(r.category), scope: s(r.scope), expenseScope: s(r.expense_scope), linkedSessionId: s(r.linked_session_id), createdAt: s(r.created_at), description: victorText.get(String(r.id)) ?? null })),
    projects: projects.map((r) => ({ id: String(r.id), name: String(r.name ?? ""), status: String(r.status ?? ""), isHidden: r.is_hidden === true, businessType: s(r.project_business_type), artist: s(r.artist), updatedAt: s(r.updated_at) })),
    financeSettings: settings.flatMap((r) => { const m = FINANCE_KEY.exec(String(r.key)); return m ? [{ projectId: m[1], value: r.value }] : []; }),
    engineerWorks: works.map((r) => ({ id: String(r.id), projectId: s(r.project_id), engineerName: s(r.engineer_name), status: s(r.status), agreedPrice: r.agreed_price, amountPaid: r.amount_paid, currency: s(r.currency), linkedTransactionId: s(r.linked_transaction_id) })),
    shows: shows.map((r) => ({ id: String(r.id), date: s(r.date), status: s(r.status), paymentStatus: s(r.payment_status), price: r.show_price, incomeTxId: s(r.linked_income_transaction_id), artistTxId: s(r.linked_artist_expense_transaction_id), djTxId: s(r.linked_dj_expense_transaction_id) })),
    proposals: proposals.map((r) => ({ id: String(r.id), clientId: s(r.client_id), status: s(r.status), amount: r.amount, currency: s(r.currency), followupDate: s(r.followup_date), linkedProjectId: s(r.linked_project_id) })),
    clients: clients.map((r) => ({ id: String(r.id), name: String(r.name ?? ""), status: s(r.status), type: s(r.type) })),
    labelArtists: labelArtists.map((r) => ({ id: String(r.id), name: String(r.name ?? "") })),
    ledger: ledger.map((r) => ({ artistId: String(r.artist_id), entryType: s(r.entry_type), amount: r.amount, sourceTxId: s(r.source_tx_id) })),
    mediaIncome: media.map((r) => ({ labelArtistId: s(r.label_artist_id), status: s(r.status), grossAmount: r.gross_amount })),
    redFilmsPayments: rfPay.map((r) => ({ id: String(r.id), amount: r.amount, paymentDate: s(r.payment_date) })),
    victorSalary,
    victorSalaryConfig: {
      settings: victorConfig.find((r) => r.key === "vendor_victor_settings")?.value ?? null,
      overrides: victorConfig.find((r) => r.key === "vendor_victor_salary_overrides")?.value ?? null,
      statusOverrides: victorConfig.find((r) => r.key === "vendor_victor_salary_status_overrides")?.value ?? null,
    },
    victorLegacyPayments: legacyVictor.flatMap((r) => {
      const m = /^vendor_victor_payment_(\d{4})_(\d{2})$/.exec(String(r.key));
      const v = r.value && typeof r.value === "object" ? (r.value as Record<string, unknown>) : {};
      return m ? [{ month: `${m[1]}-${m[2]}`, status: s(v.status), paidDate: s(v.paidDate) }] : [];
    }),
  };
}
