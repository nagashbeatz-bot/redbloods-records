/**
 * Deterministic Morning Brief — PURE. Assembles the text/sections the dashboard
 * shows, from the Company State, Signals and Cases. No LLM: every sentence here is
 * a template filled with verified facts, and every statement that is about a part
 * of the company says what part (coverage). There is deliberately NO company-wide
 * profit, no per-artist investment and no claim about projects without a price.
 */
import type { CooConfig } from "./config";
import type { Brief, Case, CompanyState, MoneyLine, Rich, Signal, Tier, WeekItem } from "./types";
import { addToTotals, type CurrencyTotals } from "../finance";
import { compareCases } from "./priority";
import { S, T, rich, totalsRich, money } from "./rich";
import { shortDate } from "./dates";

const KIND_ORDER = ["deadline", "release", "steven", "victor", "session", "show", "task", "proposal"];

function weekItems(state: CompanyState, cfg: CooConfig): { items: WeekItem[]; total: number } {
  const w = cfg.weekWindowDays;
  const items: WeekItem[] = [];
  const add = (kind: string, ymd: string | null, daysTo: number | null, text: Rich, entity: WeekItem["entity"]) => {
    if (ymd === null || daysTo === null || daysTo < 0 || daysTo > w) return;
    items.push({ kind, dateYmd: ymd, daysTo, text, entity });
  };
  for (const p of state.projects?.open ?? []) {
    if (p.active) add("deadline", p.deadline.ymd, p.deadline.daysTo, rich(`דדליין: ${p.name}`), { type: "project", id: p.id, name: p.name });
  }
  for (const r of state.releases?.rows ?? []) add("release", r.targetYmd, r.daysTo, rich(`יעד ריליס: ${r.name} (${r.stage})`), { type: "project", id: r.projectId, name: r.name });
  for (const s of state.team.steven?.open ?? []) add("steven", s.internalDeadline, s.daysToInternal, rich(`דדליין פנימי (Steven): ${s.title}`), s.projectId ? { type: "project", id: s.projectId, name: state.projects?.index[s.projectId]?.name ?? s.title } : null);
  for (const v of state.team.victor?.active ?? []) {
    if (v.internalDeadline) {
      const d = daysBetween(state.meta.todayIL, v.internalDeadline);
      add("victor", v.internalDeadline, d, rich(`דדליין פנימי (Victor): ${v.title}`), null);
    }
  }
  for (const s of state.sessions ?? []) add("session", s.dateYmd, s.daysTo, rich(`סשן מתוכנן${s.projectName ? `: ${s.projectName}` : ""}${s.start ? ` · ${s.start.slice(0, 5)}` : ""}`), s.projectId && s.projectName ? { type: "project", id: s.projectId, name: s.projectName } : null);
  for (const s of state.shows?.upcoming ?? []) add("show", s.dateYmd, s.daysTo, rich(`הופעה: ${s.name}`), { type: "show", id: s.id, name: s.name });
  for (const t of state.tasks?.items ?? []) {
    if (t.derivedFrom) continue; // shown as the Victor internal deadline, not twice
    if (t.dueYmd !== null && t.daysOverdue !== null && t.daysOverdue <= 0) add("task", t.dueYmd, -t.daysOverdue, rich(`משימה: ${t.title}`), t.projectId ? { type: "project", id: t.projectId, name: state.projects?.index[t.projectId]?.name ?? "" } : null);
  }
  for (const p of state.proposals ?? []) {
    if (p.followupYmd !== null && p.daysOverdue !== null && p.daysOverdue < 0) add("proposal", p.followupYmd, -p.daysOverdue, rich(`מעקב להצעה: ${p.clientName || p.title}`), { type: "proposal", id: p.id, name: p.clientName });
  }
  items.sort((a, b) => a.daysTo - b.daysTo || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || (a.text[0].t < b.text[0].t ? -1 : 1));
  return { items, total: items.length };
}

function daysBetween(fromYmd: string, toYmd: string): number {
  const [fy, fm, fd] = fromYmd.split("-").map(Number);
  const [ty, tm, td] = toYmd.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

function moneyLines(state: CompanyState, signals: Signal[]): MoneyLine[] {
  const lines: MoneyLine[] = [];
  const fin = state.finance;
  const rec = state.receivables;
  if (fin) {
    lines.push({ id: "received_month", label: "התקבל החודש", text: totalsRich(fin.currentMonth.receivedByCurrency), note: "תנועות עם תאריך בלבד; לפי מטבע, בלי חיבור בין מטבעות" });
    lines.push({ id: "paid_month", label: "הוצאות ששולמו החודש", text: totalsRich(fin.currentMonth.paidExpensesByCurrency), note: "תנועות עם תאריך בלבד; אין חישוב רווח כולל" });
    lines.push({ id: "received_prev", label: "התקבל בחודש הקודם", text: totalsRich(fin.previousMonth.receivedByCurrency) });
  }
  if (rec) {
    if (rec.withPrice === 0) {
      lines.push({ id: "receivables", label: "יתרות גבייה", text: rich(`אין פרויקטים עם מחיר מוסכם (מתוך ${rec.considered}) — אין מידע על יתרות.`) });
    } else {
      lines.push({
        id: "receivables", label: "יתרות גבייה",
        text: rich(`מתוך ${rec.withPrice} פרויקטים עם מחיר מוסכם (מתוך ${rec.considered} סה"כ): `, `${rec.withBalance} עם יתרה פתוחה`, ...(rec.withBalance > 0 ? [T(" — "), ...totalsRich(rec.balanceByCurrency)] : [])),
        note: `ל-${rec.considered - rec.withPrice} הפרויקטים האחרים אין מחיר מוסכם — אין מידע על יתרה (לא אפס).`,
      });
    }
  }
  const overdue = signals.filter((s) => s.type === "EXPECTED_INCOME_OVERDUE");
  if (overdue.length > 0) {
    const byCur: CurrencyTotals = {};
    for (const s of overdue) for (const e of s.evidence) if (e.kind === "money" && e.label === "סכום" && e.currency && typeof e.value === "number") addToTotals(byCur, e.currency, e.value);
    lines.push({ id: "expected_overdue", label: "הכנסות צפויות שתאריכן עבר", text: rich(`${overdue.length} · `, ...totalsRich(byCur)) });
  }
  const st = state.team.steven;
  if (st && st.approvedUnpaid.works.length > 0) {
    lines.push({ id: "steven_unpaid", label: "עבודות Steven מאושרות שלא שולמו", text: rich(`${st.approvedUnpaid.works.length} · `, ...totalsRich(st.approvedUnpaid.byCurrency)), note: "במטבע העבודה, לא מומר" });
  }
  if (fin && fin.undated.count > 0) {
    lines.push({ id: "undated", label: "תנועות ללא תאריך (לא בסכומי החודש)", text: rich(`${fin.undated.count} · `, ...totalsRich(fin.undated.byCurrency)) });
  }
  return lines;
}

function teamLines(state: CompanyState, cfg: CooConfig): Brief["team"] {
  const st = state.team.steven;
  const vi = state.team.victor;
  const stLine: Rich | null = st ? (() => {
    const near = st.open.filter((w) => w.daysToInternal !== null && w.daysToInternal <= cfg.dueSoonDays).length;
    const parts: Rich = [T(`${st.open.length} עבודות פתוחות`)];
    if (near > 0) parts.push(T(` · ${near} עם דדליין פנימי קרוב/שעבר`));
    if (st.approvedUnpaid.works.length > 0) { parts.push(T(` · ${st.approvedUnpaid.works.length} מאושרות שלא שולמו: `)); parts.push(...totalsRich(st.approvedUnpaid.byCurrency)); }
    return parts;
  })() : null;
  const viLine: Rich | null = vi ? rich(`${vi.active.length} עבודות פעילות · פעולה אחרונה מתועדת: העלאה של Victor ב-${vi.ballCounts.owner}, הערות שלך ב-${vi.ballCounts.victor}, לא ידוע ב-${vi.ballCounts.unknown} · חציון ${vi.ageStats.median ?? "?"} ימים מאז שליחה · ${vi.linkedActive} מקושרות לפרויקט`) : null;
  return { steven: stLine, victor: viLine };
}

export function composeBrief(state: CompanyState, signals: Signal[], cases: Case[], notices: Signal[], cfg: CooConfig, now: Date): Brief {
  const tierCounts: Record<Tier, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const c of cases) tierCounts[c.tier]++;
  const counted = cases.filter((c) => cfg.display.tiersCountedInHeadline.includes(c.tier)).sort(compareCases);
  const n = counted.length;

  // Headline: urgent (P0 = today) · this week (P1) · stale metadata (NOT counted as urgent). Numbers come from the state.
  const stale = notices.filter((x) => x.type === "STALE_PROJECT_DEADLINE" || x.type === "STALE_INTERNAL_DEADLINE")
    .reduce((n, x) => { const v = x.evidence.find((e) => e.id === "stale:count")?.value; return n + (typeof v === "number" ? v : 0); }, 0);
  const p0 = tierCounts.P0, p1 = tierCounts.P1;
  const parts: string[] = [];
  // P0 is rare by design: when there is none, say so explicitly instead of staying silent
  parts.push(p0 === 0 ? "אין כרגע דבר שדורש טיפול היום" : p0 === 1 ? "דבר אחד דורש טיפול היום" : `${p0} דברים דורשים טיפול היום`);
  if (p1 > 0) parts.push(p1 === 1 ? "דבר אחד לשבוע הקרוב" : `${p1} לשבוע הקרוב`);
  if (stale > 0) parts.push(stale === 1 ? "פריט מידע אחד דורש עדכון" : `${stale} פריטי מידע דורשים עדכון`);
  const headline: Rich = p0 + p1 === 0
    ? rich(parts.join(" · ") + ". ", "זה לא אומר שהכל תקין — ראה את הכיסוי למטה.")
    : rich(parts.join(" · ") + ".");

  let shown = counted.slice(0, cfg.display.maxCases);
  if (shown.length < cfg.display.minCasesShown) {
    const p2 = cases.filter((c) => c.tier === "P2").sort(compareCases);
    shown = [...shown, ...p2.slice(0, cfg.display.minCasesShown - shown.length)];
  }
  const shownIds = new Set(shown.map((c) => c.id));
  const hiddenCaseCount = counted.filter((c) => !shownIds.has(c.id)).length;
  const lowerTierCaseCount = cases.filter((c) => !shownIds.has(c.id) && !cfg.display.tiersCountedInHeadline.includes(c.tier)).length;

  const w = weekItems(state, cfg);
  const covBits: string[] = [];
  if (state.projects) covBits.push(`${state.projects.total} פרויקטים (${state.projects.open.length} פתוחים)`);
  if (state.receivables) covBits.push(`מחיר מוסכם ב-${state.receivables.withPrice}`);
  if (state.releases) covBits.push(`שורת release ל-${state.releases.withReleaseRow}`);
  covBits.push("סשנים מתוכננים בלבד (ללא יומן Google)");

  return {
    meta: { ...state.meta, generatedAt: now.toISOString(), provisional: cfg.provisional },
    headline, headlineLevel: n > 0 ? "attention" : "calm",
    coverageLine: `מבוסס על: ${covBits.join(" · ")}`,
    tierCounts, cases: shown, hiddenCaseCount, lowerTierCaseCount,
    week: w.items.slice(0, cfg.display.weekItemsShown), weekMore: Math.max(0, w.total - cfg.display.weekItemsShown),
    money: moneyLines(state, signals), team: teamLines(state, cfg), notices,
    dataQuality: state.dataQuality, coverage: state.coverage, sources: state.sources,
  };
}

// re-exported helpers used by tests
export { shortDate, S, money };
