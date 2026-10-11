/**
 * Redbloods Partner knowledge — FINANCE: the transactions themselves (Owner mission 2026-10-11).
 *
 * "Every amount Sunny states can be broken down into its rows." The Finance Brain already records, per month, the exact
 * transactions its realized totals count (RealizedMonth.evidence — REALIZED_CASH_IN / REALIZED_CASH_OUT). This
 * capability serves those rows, plus every other Finance row (expected, cancelled, unlinked to a project …) with the
 * reason it was NOT counted. No second money rule:
 *   - counted / not counted = membership in the Finance Brain's month evidence (the ONE source);
 *   - the not-counted reason only EXPLAINS that absence, through the Brain's own row validation (validateTx);
 *   - the summary adds the counted rows per type + currency only to show they reconcile with the Brain's month total
 *     (which is served beside it, from the Brain). ₪ and $ are never added together.
 * Text (description / notes / payment method) comes from the Owner-only detail sources the transaction entity already
 * uses (PROJECT_DETAIL for project rows, CLIENT_DETAIL for rows with no project) — free text is evidence, never a fact.
 * Owner-only (FINANCIAL). Read-only: nothing here writes, decides or executes.
 */
import type { KnowledgeCapability, KnowledgeItem } from "../types";
import type { Evidence } from "../../finance/types";
import { validateTx } from "../../finance/core";
import { normalizeCurrency } from "../../../finance/currency";
import { item, ok, partner, record, result, sfact, unavailable } from "./common";

const ACCESS = { externalRead: true, ownerOnly: true, sensitivity: "FINANCIAL" as const };
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Why a row is not part of any realized month total (explanation only — counting is the Brain's evidence). */
/** NOT_IN_BRAIN_EVIDENCE = the Brain did not count it for a reason this list does not name (never guessed). */
export type NotCountedReason = "MALFORMED" | "CANCELLED" | "NOT_REALIZED_STATUS" | "NO_DATE" | "MONTH_NOT_YET_REALIZED" | "NOT_IN_BRAIN_EVIDENCE";

const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[֑-ׇ]/g, "").replace(/\s+/g, " ").trim();

export const financeTransactions: KnowledgeCapability = {
  id: "finance_transactions", domain: "FINANCE", titleHe: "תנועות כספים",
  descriptionForModel: "The Finance rows THEMSELVES, incl. rows with no project (suppliers, salaries, general). To explain a total: month + currency + counted=yes = EXACTLY the rows the Finance Brain counted in that month (finance_position); the summary shows the Brain's month total beside the rows' sum (must reconcile). Each row: date, type, amount + currency as stored, status, category, business unit, project / show, Owner description / notes (evidence), counted month or the reason not (CANCELLED / NOT_REALIZED_STATUS / NO_DATE / MONTH_NOT_YET_REALIZED / MALFORMED). One row in depth: partner_entity transaction:<id>. Never answer from memory of an earlier action. ₪ and $ never added. Paged; the summary covers ALL matching rows.",
  examplesHe: ["מאיפה הגיעו ההכנסות החודש?", "ממה מורכבות ההוצאות של אוקטובר?", "מה ההוצאה של 500?", "אילו הוצאות בדולרים היו החודש?", "כמה שילמנו לאלווין?", "אילו הוצאות כלליות בלי פרויקט יש?"],
  modes: { list: { descriptionForModel: "Matching Finance rows, newest first" }, no_project: { descriptionForModel: "Only rows with no project (general rows: suppliers, salaries, office …)" } }, defaultMode: "list",
  params: {
    month: { kind: "text", maxLength: 7, descriptionForModel: "YYYY-MM — rows dated in that month" },
    type: { kind: "enum", values: ["income", "expense"], descriptionForModel: "income or expense" },
    counted: { kind: "enum", values: ["yes", "no"], descriptionForModel: "yes = only rows the Finance Brain counted in a realized month total (received income / paid expense); no = only rows it did not count (with the reason)" },
    currency: { kind: "text", maxLength: 3, descriptionForModel: "Only this currency, as stored (e.g. ₪, $; a blank stored currency reads as ₪ — the app's own rule)" },
    project: { kind: "entityKey", types: ["project"], descriptionForModel: "Only rows linked to this project (ID link)" },
    about: { kind: "text", maxLength: 60, descriptionForModel: "Free text to look for in the description, notes, category, project / show name or artist text (e.g. a supplier name)" },
  },
  // maxLimit 30: a full page of worst-case rows stays inside the connector budget (never trimmed past the cursor)
  paging: { defaultLimit: 20, maxLimit: 30 }, access: ACCESS, needs: ["FINANCE"], optionalNeeds: ["PROJECT_DETAIL", "CLIENT_DETAIL"],
  recordTextLimit: 600,
  read(src, q) {
    const f = ok(src.finance);
    if (!f) return unavailable("Finance Brain");
    const p = q.params;
    if (p.month && !MONTH_RE.test(p.month)) return { ...unavailable("month"), missing: [{ fact: "month", whyNeeded: "month must be YYYY-MM — nothing was filtered, nothing here means \"none\"" }] };

    // ── the ONE counting truth: the Finance Brain's realized-month evidence ──
    const realizedMonths = [f.state.realized, ...f.state.history];
    const counted = new Map<string, { month: string; reasonCode: string }>();
    for (const m of realizedMonths) for (const e of m.evidence as Evidence[]) if (e.sourceType === "transaction") counted.set(e.sourceId, { month: m.month, reasonCode: e.reasonCode });
    const realizedKeys = new Set(realizedMonths.map((m) => m.month));
    const brainMonth = p.month ? realizedMonths.find((m) => m.month === p.month) ?? null : null;

    // ── names + Owner text (the same sources the transaction entity uses) ──
    const projectName = new Map(f.raw.projects.map((x) => [x.id, x.name]));
    const projectArtist = new Map(f.raw.projects.map((x) => [x.id, x.artist]));
    const showName = new Map(f.raw.shows.map((x) => [x.id, x.name ?? null]));
    const pd = ok(src.projectDetail);
    const cd = ok(src.clientDetail);
    const linkedText = new Map((pd?.transactionsText?.rows ?? []).map((x) => [x.id, x]));
    const unlinkedText = new Map((cd?.unlinkedTransactionsText?.rows ?? []).map((x) => [x.id, x]));
    const textOf = (id: string, projectId: string | null) => (projectId ? linkedText.get(id) : unlinkedText.get(id)) ?? null;
    const linkedTextRead = !!pd?.transactionsText && !pd.transactionsText.capped;
    const unlinkedTextRead = !!cd?.unlinkedTransactionsText && !cd.unlinkedTransactionsText.capped;

    const wantProject = p.project ? p.project.slice(p.project.indexOf(":") + 1) : null;
    const about = p.about ? norm(p.about) : null;
    let textUnreadForAbout = 0;

    type Row = { item: KnowledgeItem; sortKey: string; type: string; currency: string; amount: number | null; isCounted: boolean };
    const rows: Row[] = [];
    for (const r of f.raw.transactions) {
      const v = validateTx(r);
      const currency = normalizeCurrency(r.currency);
      const date = r.date ? String(r.date).slice(0, 10) : null;
      const c = counted.get(r.id) ?? null;
      const notCounted: NotCountedReason | null = c ? null
        : !v ? "MALFORMED" : v.cancelled ? "CANCELLED" : !v.received ? "NOT_REALIZED_STATUS" : !date ? "NO_DATE" : !realizedKeys.has(date.slice(0, 7)) ? "MONTH_NOT_YET_REALIZED" : "NOT_IN_BRAIN_EVIDENCE";
      const unit = r.businessUnit === undefined ? null : r.businessUnit ?? "UNCLASSIFIED";

      if (p.month && !(date ?? "").startsWith(p.month)) continue;
      if (p.type && r.type !== p.type) continue;
      if (p.counted === "yes" && !c) continue;
      if (p.counted === "no" && c) continue;
      if (p.currency && currency !== p.currency.trim()) continue;
      if (wantProject && r.projectId !== wantProject) continue;
      if (q.mode === "no_project" && r.projectId) continue;

      const text = textOf(r.id, r.projectId);
      const pName = r.projectId ? projectName.get(r.projectId) ?? null : null;
      const sName = r.showId ? showName.get(r.showId) ?? null : null;
      if (about) {
        const hay = [r.category, r.expenseScope, pName, sName, r.projectId ? projectArtist.get(r.projectId) : null, text?.description, text?.notes, text?.artistText, r.description].filter(Boolean).map((x) => norm(String(x))).join(" | ");
        if (!hay.includes(about)) { if (!text && !(r.projectId ? linkedTextRead : unlinkedTextRead)) textUnreadForAbout++; continue; }
      }

      const amount = v ? v.amount : null;
      const typeHe = r.type === "income" ? "הכנסה" : r.type === "expense" ? "הוצאה" : r.type ?? "—";
      const desc = text?.description ?? r.description ?? null;
      rows.push({
        sortKey: `${date ?? "0000-00-00"}|${r.createdAt ?? ""}|${r.id}`, type: r.type ?? "", currency, amount, isCounted: !!c,
        item: item({
          id: `tx:${r.id}`, entity: `transaction:${r.id}`, epistemic: v ? "FACT" : "UNKNOWN", source: "FINANCE", freshness: "LIVE",
          label: record(`${date ?? "ללא תאריך"} · ${typeHe} · ${amount ?? String(r.amount)} ${currency} · ${r.status ?? "—"}${desc ? ` · ${desc}` : r.category ? ` · ${r.category}` : ""}`),
          fields: {
            transactionId: r.id, date, type: r.type, amount, currency, storedCurrency: r.currency, paymentStatus: r.status,
            category: r.category, scope: r.scope, expenseScope: r.expenseScope, businessUnit: unit, businessUnitSource: r.businessUnitSource ?? null,
            project: r.projectId ? { key: `project:${r.projectId}`, name: pName ? record(pName) : null } : null,
            show: r.showId ? { key: `show:${r.showId}`, name: sName ? record(sName) : null, moneyRole: r.showMoneyRole ?? null } : null,
            description: desc ? record(desc) : null, notes: text?.notes ? record(text.notes) : null, paymentMethod: text?.paymentMethod ?? null, hasReceipt: text?.hasReceipt ?? null,
            textRead: !!text,
            countedInRealizedMonth: c ? { month: c.month, reasonCode: c.reasonCode } : null, notCountedReason: notCounted,
            createdAt: r.createdAt,
          },
        }),
      });
    }
    rows.sort((a, b) => b.sortKey.localeCompare(a.sortKey));

    // ── summary over ALL matching rows (not only the page) ──
    const countedTotals: Record<string, Record<string, number>> = {};
    const notCountedTotals: Record<string, Record<string, number>> = {};
    const countedRows = { income: 0, expense: 0 };
    for (const r of rows) {
      if (r.amount === null) continue;
      const bucket = r.isCounted ? countedTotals : notCountedTotals;
      const byCur = (bucket[r.type] ??= {});
      byCur[r.currency] = round2((byCur[r.currency] ?? 0) + r.amount);
      if (r.isCounted && (r.type === "income" || r.type === "expense")) countedRows[r.type]++;
    }
    const sorted = (o: Record<string, Record<string, number>>) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, Object.fromEntries(Object.entries(o[k]).sort(([a], [b]) => a.localeCompare(b)))]));
    const summary = [
      sfact("ROWS", "שורות שנמצאו (כל העמודים)", rows.length, "FACT", "FINANCE"),
      sfact("COUNTED_TOTALS", "סכום השורות שנספרו במאזן החודשי — לפי סוג ומטבע (לא מאוחד)", sorted(countedTotals), "DERIVED", "FINANCE"),
      sfact("COUNTED_ROWS", "מספר שורות שנספרו (הכנסה / הוצאה)", countedRows, "FACT", "FINANCE"),
      sfact("NOT_COUNTED_TOTALS", "שורות שלא נספרו (צפוי / לא שולם / חלקי / בוטל / בלי תאריך) — לפי סוג ומטבע; לא כסף שהתקבל או שולם", sorted(notCountedTotals), "DERIVED", "FINANCE"),
    ];
    // reconciliation with the Finance Brain's own month total — only when the filter is exactly "the month's counted rows"
    const pure = p.month && !p.project && q.mode !== "no_project" && !p.about && p.counted !== "no";
    if (pure) {
      const brain: Record<string, { income: number; expense: number }> = {};
      for (const [cur, fl] of Object.entries(brainMonth?.byCurrency ?? {})) if (!p.currency || p.currency.trim() === cur) brain[cur] = { income: fl.cashIn, expense: fl.cashOut };
      const listed: Record<string, { income: number; expense: number }> = {};
      for (const t of ["income", "expense"] as const) for (const [cur, v] of Object.entries(countedTotals[t] ?? {})) (listed[cur] ??= { income: 0, expense: 0 })[t] = v;
      const curs = new Set([...Object.keys(brain), ...Object.keys(listed)]);
      const same = (a = 0, b = 0) => Math.abs(a - b) < 0.005;
      const reconciles = [...curs].every((cur) => (p.type === "expense" || same(brain[cur]?.income, listed[cur]?.income)) && (p.type === "income" || same(brain[cur]?.expense, listed[cur]?.expense)));
      summary.push(
        sfact("FINANCE_BRAIN_MONTH_TOTAL", `סיכום החודש לפי מנוע הכספים (finance_position) — ${p.month}`, brainMonth ? brain : null, "FACT", "FINANCE"),
        sfact("RECONCILES_WITH_MONTH_TOTAL", "השורות שנספרו = סיכום החודש", brainMonth ? reconciles : null, "DERIVED", "FINANCE"),
      );
    }

    const missing = [] as { fact: string; whyNeeded: string }[];
    if (!linkedTextRead) missing.push({ fact: "description / notes of project rows", whyNeeded: "the project detail text was not read completely — descriptions may be missing (textRead=false)" });
    if (!unlinkedTextRead) missing.push({ fact: "description / notes of rows with no project", whyNeeded: "the client detail text was not read completely — descriptions may be missing (textRead=false)" });
    if (textUnreadForAbout) missing.push({ fact: "text search", whyNeeded: `${textUnreadForAbout} row(s) could not be searched by text (their description was not read) — 'about' found only what could be read` });
    return result(rows.map((r) => r.item), {
      summary,
      completeness: textUnreadForAbout ? "PARTIAL" : "COMPLETE",
      missing,
      coverage: [
        partner("נספר = השורה היא חלק מהסיכום החודשי של מנוע הכספים (הכנסה שהתקבלה / הוצאה ששולמה). לא נספר = עם הסיבה. ₪ ו-$ לעולם לא מחוברים."),
        partner("תיאור / הערות = טקסט חופשי שהבעלים רשם — ראיה, לא עובדה מובנית. לפרטי שורה אחת: partner_entity transaction:<id>."),
      ],
    });
  },
};
