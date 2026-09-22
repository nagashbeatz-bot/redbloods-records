/**
 * Adapts an already-computed lib/coo CooResult into the Partner domains it
 * already covers. PURE — no I/O, no Supabase, takes a CooResult in (from a
 * single buildCoo() call, reused, never refetched) and returns plain data.
 *
 * This is reuse, not reimplementation: every fact below comes from
 * CompanyState as lib/coo/facts.ts already built it (including its own
 * coverage accounting and its Hardening-1 Victor-ball semantics). Nothing
 * here recomputes or reinterprets a COO fact.
 */
import type { CooResult } from "../../coo/pipeline";
import type { CompanyState, SourceStatus } from "../../coo/types";
import { coverageFromCounts, coverageFromStatus, reliabilityFrom, statusFromSource } from "./coverage";
import type { PartnerCompanyState, PartnerDomainState, PartnerRelation } from "./types";

const READER = "lib/coo (reused via buildCoo())";

function sourceOf(sources: SourceStatus[], name: string): SourceStatus | undefined {
  return sources.find((s) => s.source === name);
}
function coverageEntry(state: CompanyState, key: string) {
  return state.coverage.find((c) => c.key === key);
}

function domainState<T>(
  state: CompanyState,
  sourceName: string,
  data: T | null,
  relations: PartnerRelation[],
  opts: { coverage?: ReturnType<typeof coverageFromCounts>; warnings?: string[] } = {},
): Omit<PartnerDomainState<T>, "domain"> {
  const status = statusFromSource(sourceOf(state.sources, sourceName));
  const coverage = opts.coverage ?? coverageFromStatus(status);
  const relQuality = relations[0]?.quality ?? "NONE";
  return {
    status,
    coverage,
    reliability: reliabilityFrom(coverage, relQuality),
    provenance: { source: `lib/coo:${sourceName}`, reader: READER, fetchedAt: state.meta.asOf },
    relations,
    warnings: opts.warnings ?? [],
    data,
  };
}

export type CooAdaptedDomains = Pick<
  PartnerCompanyState["domains"],
  "projects" | "proposals" | "finance" | "receivables" | "sessions" | "releases" | "shows" | "victor" | "steven" | "tasks" | "agentAlerts"
>;

export function adaptCooCompanyState(coo: CooResult): CooAdaptedDomains {
  const { state } = coo;

  const projectsCov = coverageEntry(state, "projects.deadline");
  const projects = { domain: "projects" as const, ...domainState(state, "projects", state.projects, [], {
    warnings: projectsCov ? [`${projectsCov.usable ?? "?"} מתוך ${projectsCov.total ?? "?"} פרויקטים פעילים עם דדליין תקין (${projectsCov.note})`] : [],
  }) };

  const proposals = { domain: "proposals" as const, ...domainState(state, "proposals", state.proposals, [
    { toDomain: "projects", quality: "ID", via: "proposals.linked_project_id", notes: "נאלבל — יכול להיות null" },
  ]) };

  const financeCov = coverageEntry(state, "finance.dated");
  const finance = { domain: "finance" as const, ...domainState(state, "transactions", state.finance, [
    { toDomain: "projects", quality: "ID", via: "transactions.project_id", notes: "נאלבל לתנועות כלליות (לא ספציפיות לפרויקט)" },
  ], {
    coverage: financeCov ? coverageFromCounts(financeCov.usable, financeCov.total) : undefined,
    warnings: financeCov ? [`${financeCov.usable ?? "?"} מתוך ${financeCov.total ?? "?"} תנועות עם תאריך`] : [],
  }) };

  const recCov = coverageEntry(state, "receivables");
  const receivables = { domain: "receivables" as const, ...domainState(state, "finance_settings", state.receivables, [
    { toDomain: "projects", quality: "ID", via: "settings.key = `finance_${projectId}`", notes: "מפתח דטרמיניסטי, לא free text" },
  ], {
    coverage: recCov ? coverageFromCounts(recCov.usable, recCov.total) : undefined,
    warnings: recCov ? [`${recCov.usable ?? "?"} מתוך ${recCov.total ?? "?"} פרויקטים עם מחיר מוסכם (${recCov.note})`] : [],
  }) };

  // Sessions: COO only ever fetches a forward window (see lib/coo/config.ts sessionWindowDays).
  // total is deliberately unknown (no full-history read) — PARTIAL is a statement about SCOPE,
  // not a failure, and must never be confused with one.
  const sessions = { domain: "sessions" as const, ...domainState(state, "sessions", state.sessions, [
    { toDomain: "projects", quality: "ID", via: "sessions.project_id", notes: "נאלבל לסשנים כלליים" },
  ], {
    coverage: state.sessions !== null ? "PARTIAL" : coverageFromStatus(statusFromSource(sourceOf(state.sources, "sessions"))),
    warnings: ["רק חלון קדימה (sessionWindowDays בקונפיג של COO) — אין קריאת היסטוריה. 'PARTIAL' כאן הוא scope, לא כשל מקור."],
  }) };

  const relCov = coverageEntry(state, "releases");
  const releases = { domain: "releases" as const, ...domainState(state, "releases", state.releases, [
    { toDomain: "projects", quality: "ID", via: "project_release_details.project_id" },
    { toDomain: "labelArtists", quality: "ID", via: "project_release_details.label_artist_id", notes: "נאלבל — לא כל שורת release נושאת label_artist_id" },
  ], {
    coverage: relCov ? coverageFromCounts(relCov.usable, relCov.total) : undefined,
    warnings: relCov ? [`${relCov.usable ?? "?"} מתוך ${relCov.total ?? "?"} פרויקטי לייבל עם שורת release (${relCov.note})`] : [],
  }) };

  const shows = { domain: "shows" as const, ...domainState(state, "shows", state.shows, [
    { toDomain: "external", quality: "ID", via: "shows.dj_client_id", notes: "קיים ב-DB ונקרא כבר ע\"י listShows() (select *), אך אינו חשוף כרגע ב-Partner Eyes — ראה warnings" },
  ], {
    warnings: [
      "shows.dj_client_id / dj_confirmation_status / dj_confirmed_at קיימים בטבלה ונקראים ע\"י lib/shows-store.ts (select *), אך lib/coo/readers.ts משמיט אותם בשלב המיפוי ל-RawShow — Partner לא חושף אותם בבלוק הזה כדי לא לגעת ב-lib/coo וגם לא לפתוח query כפול. מועמד ברור לשיפור עתידי מאושר.",
    ],
  }) };

  const victorCov = coverageEntry(state, "victor.link");
  const victor = { domain: "victor" as const, ...domainState(state, "victor", state.team.victor, [
    { toDomain: "projects", quality: "ID", via: "vendor_project_work.project_id", notes: "נאלבל לעבודות כלליות" },
  ], {
    coverage: victorCov ? coverageFromCounts(victorCov.usable, victorCov.total) : undefined,
    warnings: [
      "ball.holder הוא 'latest recorded action' בלבד (Hardening 1: files_sent[].uploadedAt מול version_reviews[].sentAt) — לא הוכחה ש'התור אצל הבעלים' במציאות.",
      ...(victorCov ? [`${victorCov.usable ?? "?"} מתוך ${victorCov.total ?? "?"} עבודות Victor פעילות מקושרות לפרויקט`] : []),
    ],
  }) };

  const stevenCov = coverageEntry(state, "steven.link");
  const steven = { domain: "steven" as const, ...domainState(state, "steven", state.team.steven, [
    { toDomain: "projects", quality: "ID", via: "sound_engineer_work.project_id", notes: "נאלבל לעבודות עצמאיות" },
  ], {
    coverage: stevenCov ? coverageFromCounts(stevenCov.usable, stevenCov.total) : undefined,
    warnings: [
      "BALL_LOCATION = UNKNOWN/UNSUPPORTED: אין ל-Steven marker אמין ל'אצל מי הכדור' (status / mix_comments אינם מספיקים — ראה הדוח הקודם). לא נבנה כאן ball logic חדש.",
      ...(stevenCov ? [`${stevenCov.usable ?? "?"} מתוך ${stevenCov.total ?? "?"} עבודות Steven פתוחות מקושרות לפרויקט`] : []),
    ],
  }) };

  const tasksCov = coverageEntry(state, "tasks.link");
  const tasks = { domain: "tasks" as const, ...domainState(state, "tasks", state.tasks, [
    { toDomain: "projects", quality: "ID", via: "tasks.related_id (when related_type=\"project\")", notes: "קישור לא-נפתר מדווח כ-data quality note, לא מוסתר" },
  ], {
    coverage: tasksCov ? coverageFromCounts(tasksCov.usable, tasksCov.total) : undefined,
    warnings: tasksCov ? [`${tasksCov.usable ?? "?"} מתוך ${tasksCov.total ?? "?"} משימות פתוחות מקושרות לפרויקט קיים (${tasksCov.note})`] : [],
  }) };

  const alertsCov = coverageEntry(state, "alerts");
  const agentAlerts = { domain: "agentAlerts" as const, ...domainState(state, "agent_alerts", state.alerts, [
    { toDomain: "projects", quality: "ID", via: "agent_alerts.related_project_id", notes: "נאלבל" },
  ], {
    coverage: alertsCov ? coverageFromCounts(alertsCov.usable, alertsCov.total) : undefined,
    warnings: alertsCov ? [`מקור משני: ${alertsCov.usable ?? "?"} מוצגות מתוך ${alertsCov.total ?? "?"} שנרשמו (${alertsCov.note})`] : [],
  }) };

  return { projects, proposals, finance, receivables, sessions, releases, shows, victor, steven, tasks, agentAlerts };
}
