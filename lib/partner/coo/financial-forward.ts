/**
 * Sunny Financial COO — FINANCIAL_FORWARD (Owner mission 2026-10-05, Phase 2). Pure, read-only, interaction time only.
 *
 * "Zero financial surprises": what is about to go out / come in, when, how certain, what can still change, whether the
 * Owner is prepared — derived ONLY from what Redbloods already computes. It is a reasoning PROJECTION, never a truth
 * store: no forecast table, no settlement mirror, no transaction, no payment, no ledger change, no cron, no push.
 * It is an INPUT to BUSINESS_MOTION (lib/partner/coo/motion.ts) — never a second priority engine.
 *
 * Sources (composed, never re-derived):
 *   the Finance Brain state  realized month, open expenses (ENGINEER_WORK / TRANSACTION / SHOW_PAYOUT — its own dedupe,
 *                            incl. possibleOverlaps), the Victor salary months, receivables, the proposal pipeline
 *   the artist view          the open cycle's settlement picture (the app's own computeOpenCycle — sign = who owes whom)
 *   the company state        upcoming shows (a commercial signal only)
 *
 * Owner decisions 2026-10-05 (Financial COO Phase 2):
 *   - a cycle end is a SETTLEMENT REVIEW, not a payment due date — never an automatic payment or carry-forward:
 *     current balance + direction in words + DYNAMIC + what can change it → NEEDS_DECISION ("משלמים בסגירה או מעבירים?")
 *   - Steven's completed unpaid works are a HARD payable with NO due date → KNOWN_AMOUNT_UNKNOWN_DATE + NEEDS_DECISION
 *     ("מתי אתה רוצה לשלם?"); never overdue, never an invented date
 *   - readiness: an obligation ≤ 7 days with no plan → SHOULD; ≤ 3 days with no plan / decision → MUST;
 *     Owner-aware + plan → PREPARED, never repeated as noise (a reasoning rule — no reminder, no cron, no push)
 *   - the manual mix rows dated 01.10 mean "in October": a mix row on a project with no engineer work is CONDITIONAL
 *     (never overdue); once an engineer work exists it is the canonical obligation and the manual row is a
 *     DUPLICATE_CANDIDATE counted once (never deleted, never merged automatically)
 *   - no bank balance → coverage UNKNOWN; "לפי התזרים הרשום במערכת"; never "יש כיסוי" / "יש מספיק כסף" / "העסק יציב"
 *   - units may be shown side by side; never "Studio covers Records" / money moving between units
 *   - currencies stay separate (no FX); expected income is never cash; a proposal is never cash
 */
import type { GatewaySources } from "../gateway/core";
import { ok } from "../gateway/core";
import type { CooCtx } from "./context";
import { addDaysYmd, daysBetween, heDate, isYmd } from "./model";
import type { PartnerFinanceState, OpenExpense, FinanceRaw } from "../finance/types";
import { isMixExpenseRow } from "../finance/core";
import { buildArtistView } from "../label/view";

/** INTERNAL readiness windows (Owner-approved 2026-10-05 as a reasoning rule — never a reminder schedule). */
export const FINANCIAL_FORWARD_WINDOWS = { mustDays: 3, shouldDays: 7, windows: [7, 14, 30] as const, note: "derived readiness only — no reminder, no cron, no push" } as const;

export type ObligationKind = "VENDOR_PAYABLE" | "RECURRING" | "SETTLEMENT" | "EXPECTED_EXPENSE" | "SHOW_PAYOUT" | "CONDITIONAL_COST";
export type Strength = "HARD" | "LIKELY" | "DISCRETIONARY" | "DYNAMIC" | "CONDITIONAL" | "UNKNOWN";
export type Timing = "FIXED_KNOWN" | "KNOWN_AMOUNT_UNKNOWN_DATE" | "KNOWN_DATE_DYNAMIC_AMOUNT" | "CONDITIONAL" | "FORECAST_ONLY" | "UNKNOWN";
export type Preparedness = "PREPARED" | "NEEDS_PREPARATION" | "NEEDS_DECISION" | "UNCERTAIN" | "WATCH";
export type Confidence = "CONFIRMED" | "DYNAMIC" | "EXPECTED" | "CONDITIONAL" | "UNKNOWN";
export type FinLevel = "MUST" | "SHOULD" | "WATCH" | "INFO";
export type Totals = Record<string, number>;

export interface Obligation {
  key: string;
  kind: ObligationKind;
  /** the entity the money is about (project / vendor / label-artist / show / recurring) */
  entity: string | null;
  titleHe: string;
  amount: number | null;
  /** the stored currency; the artist ledger stores none (screens show ₪) — said so in currencyNote */
  currency: string | null;
  currencyNote: string | null;
  /** the money date (due / settlement review); null = unknown — NEVER treated as "now" */
  date: string | null;
  daysTo: number | null;
  strength: Strength;
  timing: Timing;
  dynamic: boolean;
  /** RECORDS_OWES_ARTIST / ARTIST_OWES_RECORDS for a settlement; OUT for a payable */
  direction: "OUT" | "IN" | "RECORDS_OWES_ARTIST" | "ARTIST_OWES_RECORDS";
  directionHe: string;
  changeDriversHe: string[];
  /** a plan = a record the Owner made for it (an expected Finance row / a Finance salary row) */
  plan: boolean;
  preparedness: Preparedness;
  level: FinLevel;
  questionHe: string | null;
  confidence: Confidence;
  provenance: string;
  businessUnit: string | null;
  /** where it counts: hard outflow / dynamic exposure / conditional / nothing (a duplicate counted elsewhere) */
  countsIn: "OUTFLOW" | "DYNAMIC" | "CONDITIONAL" | "NONE";
  overdue: boolean;
  he: string;
}

export interface ForwardWindow { days: number; hardOutflow: Totals; expectedInflow: Totals; dynamicExposure: Totals; undatedHard: Totals; conditional: Totals; overdueInflow: Totals }

export interface FinancialForward {
  status: "OK" | "UNKNOWN";
  today: string;
  coverage: "UNKNOWN";
  coverageHe: string;
  actualMonth: Record<string, { in: number; out: number; net: number }>;
  obligations: Obligation[];
  windows: ForwardWindow[];
  settlements: Obligation[];
  vendorPayables: Obligation[];
  duplicates: Array<{ key: string; canonical: string; he: string }>;
  inflow: { receivables: number; expectedInflow: Totals; overdueInflow: Totals; proposals: number; shows14: number; proposalsAreNotCash: true };
  commercialGap: boolean;
  /** the up-to-3 financial events that could surprise the Owner (not PREPARED) */
  surprises: Obligation[];
  unitsHe: string | null;
  lineHe: string;
  unchecked: string[];
}

const add = (t: Totals, cur: string | null, n: number | null) => { if (n === null || !Number.isFinite(n)) return; const k = cur ?? "?"; t[k] = Math.round(((t[k] ?? 0) + n) * 100) / 100; };
const fmtMoney = (n: number | null, cur: string | null) => (n === null ? "סכום לא ידוע" : `${cur === "$" ? "$" : cur === "₪" || cur === null ? "₪" : `${cur} `}${Math.abs(n).toLocaleString("en-US")}`);
const totalsHe = (t: Totals) => Object.entries(t).filter(([, v]) => v).map(([c, v]) => fmtMoney(v, c)).join(" + ") || "0";
const LEVEL_ORDER: FinLevel[] = ["MUST", "SHOULD", "WATCH", "INFO"];

/** The approved readiness rule (reasoning only). */
export function readinessOf(o: Pick<Obligation, "preparedness" | "daysTo" | "strength" | "overdue" | "timing">): FinLevel {
  const W = FINANCIAL_FORWARD_WINDOWS;
  if (o.preparedness === "PREPARED") return o.overdue ? "WATCH" : "INFO";
  if (o.preparedness === "WATCH") return "WATCH";
  if (o.preparedness === "UNCERTAIN") return "WATCH";
  // NEEDS_DECISION / NEEDS_PREPARATION
  if (o.overdue) return "MUST";
  if (o.daysTo === null) return o.timing === "KNOWN_AMOUNT_UNKNOWN_DATE" && o.strength === "HARD" ? "SHOULD" : "WATCH";
  if (o.daysTo <= W.mustDays) return "MUST";
  if (o.daysTo <= W.shouldDays) return "SHOULD";
  return "WATCH";
}

function finish(o: Omit<Obligation, "level" | "he">): Obligation {
  const level = readinessOf(o);
  const when = o.date ? (o.daysTo === 0 ? "היום" : o.daysTo === 1 ? "מחר" : o.daysTo !== null && o.daysTo < 0 ? `עבר ${heDate(o.date)}` : `${heDate(o.date)} (בעוד ${o.daysTo} ימים)`) : "בלי תאריך";
  const he = `${o.titleHe}: ${fmtMoney(o.amount, o.currency)}${o.kind === "SETTLEMENT" ? ` ${o.directionHe}` : ""} · ${when}${o.dynamic ? " · עדיין משתנה" : ""}${o.questionHe ? ` → ${o.questionHe}` : ""}`;
  return { ...o, level, he };
}

const ilToday = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

export function buildFinancialForward(src: GatewaySources, c: CooCtx): FinancialForward {
  const today = c.today ?? ilToday(src.now);
  const fin = ok(src.finance) as { state?: PartnerFinanceState; raw?: FinanceRaw } | null;
  const state = fin?.state ?? null;
  const raw = fin?.raw ?? null;
  const unchecked: string[] = [];
  const coverageHe = "לפי התזרים הרשום במערכת — אין לי יתרת בנק, ולכן אני לא יכולה לקבוע אם יש כיסוי בפועל";
  if (!state || !raw || !Array.isArray(state.openExpenses?.items)) {
    return { status: "UNKNOWN", today, coverage: "UNKNOWN", coverageHe, actualMonth: {}, obligations: [], windows: [], settlements: [], vendorPayables: [], duplicates: [],
      inflow: { receivables: 0, expectedInflow: {}, overdueInflow: {}, proposals: 0, shows14: 0, proposalsAreNotCash: true }, commercialGap: false, surprises: [], unitsHe: null,
      lineHe: "לא קראתי את הכספים — לא יודעת מה צפוי לצאת או להיכנס (לא ידוע, לא ריק)", unchecked: ["הכספים לא נקראו"] };
  }
  const dTo = (d: string | null) => (isYmd(d) ? daysBetween(today, d) : null);
  const txById = new Map(raw.transactions.map((t) => [t.id, t]));
  const workById = new Map(raw.engineerWorks.map((w) => [w.id, w]));
  const projName = (pid: string | null) => (pid ? c.projectName(pid) ?? "פרויקט" : null);
  const projectsWithWork = new Set(raw.engineerWorks.filter((w) => (w.status ?? "") !== "בוטל" && w.projectId).map((w) => w.projectId as string));
  const obligations: Obligation[] = [];

  // ── engineer works (the Brain's ENGINEER_WORK items): completed unpaid = HARD undated; open = conditional on completion ──
  const hardByEngineer = new Map<string, OpenExpense[]>();
  for (const e of state.openExpenses.items) {
    if (e.source !== "ENGINEER_WORK") continue;
    const w = workById.get(e.id.replace(/^ENGINEER_WORK:/, ""));
    const completed = (w?.status ?? "") === "אושר";
    if (completed) { const k = `${w?.engineerName ?? "מהנדס"}|${e.currency}`; hardByEngineer.set(k, [...(hardByEngineer.get(k) ?? []), e]); continue; }
    obligations.push(finish({ key: e.id, kind: "CONDITIONAL_COST", entity: e.projectId ? `project:${e.projectId}` : null, titleHe: `${w?.engineerName ?? "מהנדס"} — ${projName(e.projectId) ?? "עבודה"} (בהשלמה)`,
      amount: e.amount, currency: e.currency, currencyNote: null, date: null, daysTo: null, strength: "CONDITIONAL", timing: "CONDITIONAL", dynamic: false, direction: "OUT", directionHe: "יוצא",
      changeDriversHe: ["נהיה התחייבות רק כשהעבודה מושלמת (EXPECTED_ON_COMPLETION)"], plan: true, preparedness: "WATCH", questionHe: null, confidence: "CONDITIONAL",
      provenance: "engineer work (agreed price, not completed)", businessUnit: null, countsIn: "CONDITIONAL", overdue: false }));
  }
  for (const [k, es] of hardByEngineer) {
    const [name, cur] = k.split("|");
    const amount = Math.round(es.reduce((s, e) => s + e.amount, 0) * 100) / 100;
    obligations.push(finish({ key: `vendor-payable:${name}:${cur}`, kind: "VENDOR_PAYABLE", entity: name === "Steven" ? "vendor:STEVEN" : null,
      titleHe: `${name === "Steven" ? "סטיבן" : name} — ${es.length === 1 ? "עבודה שהושלמה ולא שולמה" : `${es.length} עבודות שהושלמו ולא שולמו`}`, amount, currency: cur, currencyNote: null,
      date: null, daysTo: null, strength: "HARD", timing: "KNOWN_AMOUNT_UNKNOWN_DATE", dynamic: false, direction: "OUT", directionHe: "יוצא", changeDriversHe: [],
      plan: false, preparedness: "NEEDS_DECISION", questionHe: `מתי אתה רוצה לשלם את ה-${fmtMoney(amount, cur)} ל${name === "Steven" ? "סטיבן" : name}?`, confidence: "CONFIRMED",
      provenance: `engineer works (agreed price − paid): ${es.map((e) => e.id.replace(/^ENGINEER_WORK:/, "mix-work:")).join(", ")}`, businessUnit: null, countsIn: "OUTFLOW", overdue: false }));
  }

  // ── Finance expected expenses (the Brain's TRANSACTION / SHOW_PAYOUT items, already deduped) ──
  for (const e of state.openExpenses.items) {
    if (e.source === "ENGINEER_WORK") continue;
    const tx = txById.get(e.id.replace(/^TX:/, ""));
    const mixAwaiting = !!tx && isMixExpenseRow(tx) && !!tx.projectId && !projectsWithWork.has(tx.projectId);
    const unit = tx?.businessUnit ?? null;
    if (mixAwaiting) {
      obligations.push(finish({ key: e.id, kind: "CONDITIONAL_COST", entity: `project:${tx!.projectId}`, titleHe: `מיקס — ${projName(tx!.projectId)}`, amount: e.amount, currency: e.currency, currencyNote: null,
        date: null, daysTo: null, strength: "CONDITIONAL", timing: "CONDITIONAL", dynamic: false, direction: "OUT", directionHe: "יוצא",
        changeDriversHe: [`נרשם ל${e.dueDate ? `חודש ${e.dueDate.slice(5, 7)}.${e.dueDate.slice(0, 4)}` : "בהמשך"} — יוצא כשהמיקס נפתח (התאריך הוא חודש יעד, לא מועד תשלום)`],
        plan: true, preparedness: "PREPARED", questionHe: null, confidence: "CONDITIONAL", provenance: `Finance expected row ${e.id} (Owner-recorded; no engineer work yet)`, businessUnit: unit, countsIn: "CONDITIONAL", overdue: false }));
      continue;
    }
    const daysTo = dTo(e.dueDate);
    const overdue = daysTo !== null && daysTo < 0;
    obligations.push(finish({ key: e.id, kind: e.source === "SHOW_PAYOUT" ? "SHOW_PAYOUT" : "EXPECTED_EXPENSE", entity: e.projectId ? `project:${e.projectId}` : null,
      titleHe: `${e.source === "SHOW_PAYOUT" ? "תשלום הופעה" : tx?.description || e.category || "הוצאה צפויה"}${e.projectId ? ` — ${projName(e.projectId)}` : ""}`, amount: e.amount, currency: e.currency, currencyNote: null,
      date: e.dueDate, daysTo, strength: "LIKELY", timing: e.dueDate ? "FIXED_KNOWN" : "KNOWN_AMOUNT_UNKNOWN_DATE", dynamic: false, direction: "OUT", directionHe: "יוצא", changeDriversHe: [],
      plan: true, preparedness: "PREPARED", questionHe: overdue ? "התאריך עבר והשורה לא סומנה שולמה — שולם?" : null, confidence: "EXPECTED",
      provenance: `Finance expected row ${e.id} (Owner-recorded)`, businessUnit: unit, countsIn: "OUTFLOW", overdue }));
  }
  const duplicates = (state.openExpenses.possibleOverlaps ?? []).map((o) => ({ key: o.id, canonical: o.projectId ? `project:${o.projectId}` : "engineer work",
    he: `${projName(o.projectId) ?? "פרויקט"}: שורת ההוצאה ${fmtMoney(o.amount, o.currency)} ועבודת המהנדס הן כנראה אותה התחייבות — נספר פעם אחת (לפי עבודת המהנדס); לאחד בכספים באישורך` }));

  // ── recurring (Victor's salary months the Brain evaluates) ──
  for (const r of state.recurring?.known ?? []) {
    if (r.state !== "COMMITTED_UPCOMING" && r.state !== "EXPECTED_EXPENSE_NOT_FOUND") continue;
    const daysTo = dTo(r.dueDate);
    obligations.push(finish({ key: `recurring:VICTOR_SALARY:${r.workMonth}`, kind: "RECURRING", entity: `recurring:VICTOR_SALARY:${r.workMonth}`, titleHe: `משכורת ויקטור (${r.workMonth.slice(5, 7)}.${r.workMonth.slice(0, 4)})`,
      amount: r.amount, currency: r.currency, currencyNote: null, date: r.dueDate, daysTo, strength: "HARD", timing: "FIXED_KNOWN", dynamic: false, direction: "OUT", directionHe: "יוצא", changeDriversHe: [],
      plan: false, preparedness: "NEEDS_PREPARATION", questionHe: "אין שורה בכספים — לרשום / לתכנן את התשלום?", confidence: "CONFIRMED",
      provenance: "Victor salary (retainer, due the 10th of the next month)", businessUnit: "STUDIO", countsIn: "OUTFLOW", overdue: daysTo !== null && daysTo < 0 }));
  }

  // ── settlements: the open cycle of every roster artist (the app's own computation); 0 = nothing to raise ──
  for (const a of c.roster) {
    type Cur = { endExclusive: string; daysUntilClose: number; closingBalance: number; result: string; resultHe: string };
    let found: Cur | null = null;
    try {
      const v = buildArtistView(src, a.id) as unknown as { money?: { cycles?: { current?: Cur | null } } } | null;
      found = v?.money?.cycles?.current ?? null;
    } catch { unchecked.push(`מחזור ההתחשבנות של ${a.name} לא נקרא`); continue; }
    if (!found || !found.closingBalance) continue;
    const cur: Cur = found;
    const owes = cur.result === "RECORDS_OWES_ARTIST";
    const amount = Math.abs(cur.closingBalance);
    const daysTo = dTo(cur.endExclusive);
    const late = daysTo !== null && daysTo < 0;
    obligations.push(finish({ key: `settlement:${a.key}`, kind: "SETTLEMENT", entity: a.key, titleHe: `התחשבנות ${a.name}${late ? " (המחזור היה אמור להיסגר)" : ""}`,
      amount, currency: "₪", currencyNote: "המאזן לא שומר מטבע — המסכים מציגים ₪", date: cur.endExclusive, daysTo, strength: "DYNAMIC", timing: "KNOWN_DATE_DYNAMIC_AMOUNT", dynamic: true,
      direction: owes ? "RECORDS_OWES_ARTIST" : "ARTIST_OWES_RECORDS", directionHe: owes ? `לטובת ${a.name}` : "לטובת הלייבל",
      changeDriversHe: ["הוצאת Records משותפת ששולמה", "הופעה שתבוצע", "הכנסות מדיה", "תשלום / תיקון ידני במאזן"],
      plan: false, preparedness: "NEEDS_DECISION", questionHe: owes ? `בסגירה ב-${heDate(cur.endExclusive)}: משלמים ל${a.name} או מעבירים למחזור הבא?` : `בסגירה ב-${heDate(cur.endExclusive)}: גובים מ${a.name} או מעבירים למחזור הבא?`,
      confidence: "DYNAMIC", provenance: "artist ledger — open cycle (computeOpenCycle); a close is a review, never a payment", businessUnit: "RECORDS", countsIn: "DYNAMIC", overdue: late }));
  }

  // ── inflow (expected is never cash; a proposal is never cash) ──
  const expectedInflow: Totals = {}, overdueInflow: Totals = {};
  const collectible = (state.receivables ?? []).filter((r) => !["SETTLED", "NOT_COLLECTIBLE"].includes(r.collection?.state ?? ""));
  for (const r of collectible) { add(expectedInflow, r.currency, r.amount); if (r.collection?.state === "OVERDUE") add(overdueInflow, r.currency, r.amount); }
  const proposals = state.proposalPipeline?.openCount ?? 0;
  const shows14 = (c.st?.domains.shows.data?.items ?? []).filter((s) => s.status !== "בוטל" && s.dealType !== "UNPAID_COLLAB" && isYmd(s.dateYmd) && s.dateYmd >= today && daysBetween(today, s.dateYmd) <= 14).length;

  // ── windows (per currency; hard ≠ dynamic ≠ conditional; undated never "now") ──
  const windows: ForwardWindow[] = FINANCIAL_FORWARD_WINDOWS.windows.map((days) => {
    const w: ForwardWindow = { days, hardOutflow: {}, expectedInflow: {}, dynamicExposure: {}, undatedHard: {}, conditional: {}, overdueInflow: { ...overdueInflow } };
    const end = addDaysYmd(today, days);
    for (const o of obligations) {
      const inWin = o.date !== null && o.date <= end;
      if (o.countsIn === "OUTFLOW") { if (o.date === null) add(w.undatedHard, o.currency, o.amount); else if (inWin) add(w.hardOutflow, o.currency, o.amount); }
      else if (o.countsIn === "DYNAMIC" && inWin) add(w.dynamicExposure, o.currency, o.direction === "ARTIST_OWES_RECORDS" ? -(o.amount ?? 0) : o.amount);
      else if (o.countsIn === "CONDITIONAL") add(w.conditional, o.currency, o.amount);
    }
    for (const r of collectible) if (r.dueDate && r.dueDate >= today && r.dueDate <= end) add(w.expectedInflow, r.currency, r.amount);
    return w;
  });

  const actualMonth: FinancialForward["actualMonth"] = {};
  for (const [cur, f] of Object.entries(state.realized?.byCurrency ?? {})) actualMonth[cur] = { in: f.cashIn, out: f.cashOut, net: f.net };
  const commercialGap = collectible.length === 0 && proposals === 0 && shows14 === 0;
  const rank = (o: Obligation) => LEVEL_ORDER.indexOf(o.level);
  const surprises = obligations.filter((o) => o.preparedness !== "PREPARED" && (o.level === "MUST" || o.level === "SHOULD"))
    .sort((a, b) => rank(a) - rank(b) || (a.daysTo ?? 999) - (b.daysTo ?? 999)).slice(0, 3);

  const units = new Map<string, string[]>();
  for (const o of obligations.filter((x) => (x.countsIn === "OUTFLOW" || x.countsIn === "DYNAMIC") && x.businessUnit)) units.set(o.businessUnit!, [...(units.get(o.businessUnit!) ?? []), fmtMoney(o.amount, o.currency)]);
  const unitsHe = units.size ? `${[...units.entries()].map(([u, xs]) => `${u}: ${xs.join(", ")}`).join(" · ")} (כל יחידה בנפרד — לא מסיקה שיחידה אחת מכסה אחרת)` : null;

  const w7 = windows[0];
  const lineHe = [
    `כסף, 7 ימים: יוצא בוודאות ${totalsHe(w7.hardOutflow)}${Object.keys(w7.undatedHard).length ? ` · חוב פתוח בלי תאריך ${totalsHe(w7.undatedHard)}` : ""}${Object.keys(w7.dynamicExposure).length ? ` · התחשבנות דינמית ${totalsHe(w7.dynamicExposure)}` : ""}`,
    `נכנס צפוי ${totalsHe(w7.expectedInflow)}${commercialGap ? " (אין גבייה, הצעות או הופעות קרובות)" : ""}`,
    coverageHe,
  ].join(" · ");
  return { status: "OK", today, coverage: "UNKNOWN", coverageHe, actualMonth, obligations, windows, settlements: obligations.filter((o) => o.kind === "SETTLEMENT"),
    vendorPayables: obligations.filter((o) => o.kind === "VENDOR_PAYABLE"), duplicates,
    inflow: { receivables: collectible.length, expectedInflow, overdueInflow, proposals, shows14, proposalsAreNotCash: true }, commercialGap, surprises, unitsHe, lineHe, unchecked };
}
