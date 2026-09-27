/**
 * Redbloods Partner — Owner company definitions (established by the Owner on 2026-09-24). Pure data.
 *
 * These are OWNER_DECISION knowledge, versioned in code like the Charter: Partner applies them and must never ask
 * the Owner for them again. A change here is a deliberate, reviewed Owner decision — never inferred from data.
 * Where live canonical data disagrees with a definition, the disagreement is surfaced as an integrity finding;
 * the definition is not silently rewritten and the data is not changed.
 */
export interface OwnerCompanyDefinition {
  id: string;
  decidedAt: string;
  epistemic: "OWNER_DECISION";
  statementHe: string;
}

/** 1. The label roster: label_artists is the authoritative roster source; the Owner named the current roster.
 *  2026-09-27 (Owner decision): DJ CLEANTONE (רועי איוב) is TEAM — the label's DJ — not a label artist; his
 *  label_artists row was removed and his portal is a team portal (PORTAL_ARTISTS keeps his slug for the portal only). */
export const LABEL_ROSTER_DEFINITION = {
  id: "LABEL_ROSTER",
  decidedAt: "2026-09-27",
  epistemic: "OWNER_DECISION" as const,
  statementHe:
    "רוסטר הלייבל הקנוני הוא טבלת אמני הלייבל: שליו טסמה, אבי מולה, נגש ביטס. " +
    "DJ CLEANTONE (רועי איוב) הוא איש צוות — ה-DJ של הלייבל — ולא אמן לייבל. " +
    "סוג העסק בפרויקט, סטטוס הלקוח ורישום הפורטלים הם מקורות תומכים בלבד — הם לא קובעים חברות בלייבל.",
  rosterSource: "label_artists",
  rosterNames: ["שליו טסמה", "אבי מולה", "נגש ביטס"] as const,
  /** Supporting / possibly conflicting sources — findings, never competing truth. */
  supportingSources: ["clients.status = אמן לייבל", "projects.project_business_type = לייבל", "PORTAL_ARTISTS (code)"] as const,
};

/** 2. Future schedule truth: Google Calendar (not yet read by Partner); sessions = business records. */
export const SCHEDULE_DEFINITION = {
  id: "FUTURE_SCHEDULE_TRUTH",
  decidedAt: "2026-09-24",
  epistemic: "OWNER_DECISION" as const,
  statementHe:
    "ליומן העתידי, Google Calendar הוא מקור האמת. טבלת הסשנים היא רשומה עסקית (שיוך לפרויקט/הופעה, היסטוריה). " +
    "היעדר סשנים עתידיים בטבלה אומר רק שאין סשנים עתידיים רשומים בה — לא שהיומן ריק.",
  googleCalendarReadApproved: false,
};

/** 3. Finance: Finance Brain is the only financial interpretation; canonical paid/received rules unchanged. */
export const FINANCE_DEFINITION = {
  id: "FINANCE_SOURCE",
  decidedAt: "2026-09-24",
  epistemic: "OWNER_DECISION" as const,
  statementHe:
    "הפרשנות הכספית מגיעה רק מ־Finance Brain: הכנסה שהתקבלה = שולם/התקבל; הוצאה ששולמה = שולם בלבד; " +
    "צפוי / לא שולם / בוטל לא נספרים; חלקי אינו שולם במלואו; מטבעות נפרדים, בלי המרה שקטה.",
};

/** 4. Agent Alerts are not canonical company truth nor action logic. */
export const AGENT_ALERTS_DEFINITION = {
  id: "AGENT_ALERTS_NOT_CANONICAL",
  decidedAt: "2026-09-24",
  epistemic: "OWNER_DECISION" as const,
  statementHe: "התראות ה־Agent אינן אמת עסקית קנונית ואינן בסיס לפעולות של Partner.",
};

/** 5. History: Redbloods has no complete business audit history. */
export const HISTORY_DEFINITION = {
  id: "NO_COMPLETE_AUDIT_HISTORY",
  decidedAt: "2026-09-24",
  epistemic: "OWNER_DECISION" as const,
  statementHe:
    "אין כרגע היסטוריית ביקורת עסקית מלאה. חותמות זמן, פעולות פרויקט, גרסאות מיקס, תנועות, סשנים, הופעות, " +
    "הקשר הבעלים ופעולות Partner יכולים להרכיב ציר ראיות — שאינו שקול ליומן ביקורת מלא.",
};

/** 6. Owner Context is durable organizational knowledge; live canonical facts still override stale interpretations. */
export const OWNER_CONTEXT_DEFINITION = {
  id: "OWNER_CONTEXT_DURABLE",
  decidedAt: "2026-09-24",
  epistemic: "OWNER_DECISION" as const,
  statementHe: "תשובות הבעלים הן ידע ארגוני קבוע ואינן נשאלות שוב; עובדות קנוניות חיות עדיין גוברות על פרשנות ישנה.",
};

export const OWNER_COMPANY_DEFINITIONS: readonly OwnerCompanyDefinition[] = [
  LABEL_ROSTER_DEFINITION, SCHEDULE_DEFINITION, FINANCE_DEFINITION, AGENT_ALERTS_DEFINITION, HISTORY_DEFINITION, OWNER_CONTEXT_DEFINITION,
].map(({ id, decidedAt, epistemic, statementHe }) => ({ id, decidedAt, epistemic, statementHe }));

/**
 * Session status vocabulary — a CODE fact (verified by the integrity test against the files named here):
 * what the sessions writers store vs what other modules still read.
 * A3 (2026-09-27): the readers that looked for נקבע / הושלם (Agent rules + snapshot + goals, daily + weekly reports)
 * now read the real vocabulary (מתוכנן / התקיים, + בוצע for show rehearsals), so there is no legacy reader left and the
 * SESSION_STATUS_VOCABULARY_CONFLICT finding no longer fires. The clock auto-mark route is retired (no writer of
 * התקיים except an explicit Owner action).
 */
export const SESSION_STATUS_VOCABULARY: {
  writers: { statuses: readonly string[]; files: readonly string[] };
  legacyReaders: readonly { file: string; expects: readonly string[] }[];
  alignedReaders: readonly { file: string; reads: readonly string[] }[];
} = {
  writers: {
    statuses: ["מתוכנן", "התקיים", "בוטל", "נדחה", "לא הגיע"],
    files: ["lib/writes/sessions.ts", "app/api/sessions/route.ts", "components/ui/ProjectDrawer.tsx"],
  },
  legacyReaders: [],
  alignedReaders: [
    { file: "lib/agent/rules.ts", reads: ["מתוכנן"] },
    { file: "lib/agent/snapshot.ts", reads: ["מתוכנן", "התקיים", "בוצע"] },
    { file: "lib/agent/goals.ts", reads: ["התקיים", "בוצע"] },
    { file: "lib/reports/data.ts", reads: ["מתוכנן", "התקיים", "בוצע"] },
    { file: "lib/reports/weekly.ts", reads: ["מתוכנן", "התקיים", "בוצע"] },
  ],
};

/**
 * Engineer payment writers of sound_engineer_work.linked_transaction_id — a CODE fact (verified by test). Since the
 * integrity fix A2 (2026-09-27) there is ONE current writer; the two retired writers are listed because their SHAPES
 * still exist in historical data (untouched — the Owner deferred whether the ₪ rows are real).
 */
export const STEVEN_PAYMENT_WRITERS = [
  { name: "RECONCILE_ENGINEER_EXPENSE", status: "CURRENT", file: "lib/writes/mix.ts", marker: "reconcileEngineerExpense", shape: "work currency + agreed amount; שולם rows never overwritten / deleted; expected row for non-Steven engineers" },
  { name: "LEGACY_SYNC_TRANSACTION", status: "RETIRED_HISTORICAL", file: "lib/sound-engineer-store.ts", marker: "syncTransaction", shape: "work currency; status from amounts (צפוי / חלקי / שולם); date nulled" },
  { name: "PAYMENT_EXPENSE_SYNC", status: "RETIRED_HISTORICAL", file: "lib/sound-engineer-store.ts", marker: "syncStevenPaymentExpense", shape: "fixed-rate ₪ conversion; always שולם; deleted when unpaid" },
] as const;

/** A Victor "active" work with no recorded activity for this many days looks stale (NOT abandoned). */
export const VICTOR_STALE_DAYS = 60;
