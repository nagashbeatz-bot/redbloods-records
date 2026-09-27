/**
 * The Owner push digest (external push cron /api/push/cron + the legacy /api/push/check) — pure, one builder for both.
 * No server-only / Supabase / push imports; tests drive it directly.
 *
 * Rules (2026-09-27):
 *   - Israel calendar day and Israel hour (Intl, DST-safe) — never a fixed UTC+3.
 *   - A project is a deadline candidate only when it is NOT hidden and NOT closed / cancelled / paused
 *     (הושלם / בוטל / בהשהייה): a hidden or cancelled project is never "overdue".
 *   - Overdue expected income is summed PER CURRENCY — amounts in different currencies are never added, and a mixed
 *     sum never borrows the first row's currency label.
 *   - Victor stuck is computed by the ONE rule (lib/victor-stuck.ts) and returned, but NEVER pushed and never counted
 *     in a pushed summary (Owner decision Q3, 2026-09-27: the Victor-stuck push is disabled).
 *   - Each notification carries a claim TYPE; the caller claims push_cron:<type>:<day> before sending, so the same
 *     type is sent at most once per Israel day (cron and the legacy check share the claim).
 */
import { NOT_OVERDUE_STATUSES, isProjectOverdue, isStrictYmd } from "./project-deadline";

/** The shared closed set (lib/project-deadline.ts NOT_OVERDUE_STATUSES) — re-exported for the digest query. */
export const NOT_DEADLINE_CANDIDATE_STATUSES: readonly string[] = NOT_OVERDUE_STATUSES;

export interface DigestProject { id: string; name: string; status: string | null; deadline: string | null; is_hidden?: boolean | null }
export interface DigestSession { id: string; start_time: string | null; projects?: { name?: string | null; artist?: string | null } | Array<{ name?: string | null; artist?: string | null }> | null }
export interface DigestTxn { id: string; amount: number | null; currency: string | null; projects?: { name?: string | null } | Array<{ name?: string | null }> | null }
export interface DigestNotification { type: string; title: string; body: string; url: string; tag: string; projectId?: string; entityType?: string; entityId?: string }

/** A project that can be overdue / due soon (not hidden; not completed / cancelled / paused). */
export function isDeadlineCandidate(p: DigestProject): boolean {
  return p.is_hidden !== true && !NOT_DEADLINE_CANDIDATE_STATUSES.includes(p.status ?? "");
}

const dayDiff = (fromYmd: string, toYmd: string) => {
  const [a, b] = [fromYmd, toYmd].map((d) => { const [y, m, dd] = d.split("-").map(Number); return Date.UTC(y, m - 1, dd); });
  return Math.round((b - a) / 86400000);
};

/** Totals per currency (a missing currency is "₪", the app's default). Never adds across currencies. */
export function sumByCurrency(txns: readonly DigestTxn[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of txns) { const c = t.currency || "₪"; out[c] = Math.round(((out[c] ?? 0) + (t.amount ?? 0)) * 100) / 100; }
  return out;
}
export function formatByCurrency(totals: Record<string, number>): string {
  return Object.entries(totals).map(([c, v]) => `${v.toLocaleString("he-IL")}${c}`).join(" · ");
}
const one = <T,>(x: T | T[] | null | undefined): T | null => (Array.isArray(x) ? x[0] ?? null : x ?? null);

export function buildOwnerDigest(input: {
  today: string; hour: number;
  projects: readonly DigestProject[]; sessions: readonly DigestSession[]; overdueIncome: readonly DigestTxn[];
  /** Victor stuck count — computed, returned by the caller, NEVER part of a push (Owner decision Q3). */
  victorStuckCount?: number;
  /** false for the legacy check (it never sent summaries). */
  withSummary: boolean;
}): { notifications: DigestNotification[]; overdue: DigestProject[]; soon: DigestProject[]; paymentTotals: Record<string, number> } {
  const { today, hour } = input;
  const candidates = input.projects.filter(isDeadlineCandidate);
  const notifications: DigestNotification[] = [];

  const overdue = candidates.filter((p) => isProjectOverdue({ deadline: p.deadline, status: p.status, isHidden: p.is_hidden }, today));
  if (overdue.length === 1) notifications.push({ type: "overdue", title: `⚠ דדליין עבר — ${overdue[0].name}`, body: "פתח כדי לראות את הפרויקט ולסדר עדיפויות", url: "/dashboard", tag: "overdue", projectId: overdue[0].id, entityType: "project", entityId: overdue[0].id });
  else if (overdue.length > 1) notifications.push({ type: "overdue", title: `⚠ דדליין עבר — ${overdue.length} פרויקטים`, body: "פתח כדי לראות את הפרויקטים ולסדר עדיפויות", url: "/dashboard", tag: "overdue" });

  const soon = candidates.filter((p) => { if (!isStrictYmd(p.deadline) || p.deadline <= today) return false; const d = dayDiff(today, p.deadline); return d >= 1 && d <= 3; });
  if (soon.length === 1) {
    const d = dayDiff(today, soon[0].deadline!);
    notifications.push({ type: "due-soon", title: `⏳ דדליין מתקרב: ${soon[0].name}`, body: `עוד ${d === 1 ? "יום אחד" : `${d} ימים`} — כדאי לבדוק סטטוס`, url: "/dashboard", tag: "due-soon", projectId: soon[0].id, entityType: "project", entityId: soon[0].id });
  } else if (soon.length > 1) notifications.push({ type: "due-soon", title: `⏳ ${soon.length} דדליינים מתקרבים`, body: "פתח כדי לראות מה צריך טיפול השבוע", url: "/dashboard", tag: "due-soon" });

  for (const s of input.sessions) {
    const proj = one(s.projects);
    const name = proj?.name ?? "סשן";
    const artist = proj?.artist ?? "";
    const time = s.start_time ? `ב־${s.start_time.slice(0, 5)}` : "היום";
    notifications.push({ type: `session-${s.id}`, title: `🎵 סשן ${time}`, body: artist ? `${artist} — ${name}` : name, url: "/setup/calendar", tag: `session-${s.id}` });
  }

  const txns = input.overdueIncome;
  const paymentTotals = sumByCurrency(txns);
  if (txns.length === 1) {
    const t = txns[0];
    notifications.push({ type: "payments", title: "💸 תשלום בפיגור", body: `${(t.amount ?? 0).toLocaleString("he-IL")}${t.currency || "₪"} — ${one(t.projects)?.name ?? ""}`, url: "/finance", tag: "payments" });
  } else if (txns.length > 1) {
    notifications.push({ type: "payments", title: `💸 ${txns.length} תשלומים בפיגור`, body: `סה״כ ${formatByCurrency(paymentTotals)} — פתח כדי לעדכן מה התקבל`, url: "/finance", tag: "payments" });
  }

  if (input.withSummary) {
    const totalIssues = overdue.length + soon.length + txns.length; // Victor stuck is deliberately NOT here (push disabled)
    if (hour >= 8 && hour < 10 && totalIssues > 0) {
      notifications.unshift({
        type: "morning-summary",
        title: `בוקר טוב ☀️ — יש ${totalIssues} דבר${totalIssues > 1 ? "ים" : ""} לטיפול`,
        body: [overdue.length ? `${overdue.length} עברו דדליין` : "", soon.length ? `${soon.length} מתקרבים` : "", txns.length ? `${txns.length} תשלומים` : ""].filter(Boolean).join(" · "),
        url: "/dashboard", tag: "morning-summary",
      });
    } else if (hour >= 19 && hour < 21) {
      notifications.unshift({
        type: "evening-summary", title: "סיכום יום 🌙",
        body: totalIssues > 0 ? `נשארו ${totalIssues} דבר${totalIssues > 1 ? "ים" : ""} — פתח לראות מה נשאר למחר` : "כל הדברים מטופלים — עבודה טובה 🎵",
        url: "/dashboard", tag: "evening-summary",
      });
    }
  }
  return { notifications, overdue, soon, paymentTotals };
}
