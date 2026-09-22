/**
 * Adapts an already-computed lib/coo CooResult into the Partner domains it
 * already covers. PURE — no I/O, no Supabase, takes a CooResult in (from a
 * single buildCoo() call, reused, never refetched) and returns plain data.
 *
 * This is reuse, not reimplementation: every fact below comes from
 * CompanyState as lib/coo/facts.ts already built it (including its own
 * coverage accounting and its Hardening-1 Victor-ball semantics). Nothing
 * here recomputes or reinterprets a COO fact.
 *
 * Agent Alerts is deliberately NOT adapted here (Phase B.1) — lib/coo's own
 * read is status="new"-only, then further narrowed to allowlisted+recent for
 * the brief. That is correct for a morning brief and too narrow for Eyes, so
 * it gets its own Partner-only reader — see lib/partner/eyes/readers.ts and
 * company-state.ts's buildAgentAlerts().
 */
import type { CooResult } from "../../coo/pipeline";
import type { CompanyState, SourceStatus } from "../../coo/types";
import { coverageFromCounts, coverageFromStatus, reliabilityFrom, statusFromSource } from "./coverage";
import type { Coverage, PartnerCompanyState, PartnerDomainState, PartnerRelation } from "./types";

const READER = "lib/coo (reused via buildCoo())";

function sourceOf(sources: SourceStatus[], name: string): SourceStatus | undefined {
  return sources.find((s) => s.source === name);
}
function coverageEntry(state: CompanyState, key: string) {
  return state.coverage.find((c) => c.key === key);
}
function relCoverage(usable: number | null | undefined, total: number | null | undefined): Coverage | undefined {
  return usable == null || total == null ? undefined : coverageFromCounts(usable, total);
}

function domainState<T>(
  state: CompanyState,
  sourceName: string,
  data: T | null,
  relations: PartnerRelation[],
  opts: { coverage?: Coverage; warnings?: string[] } = {},
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
  "projects" | "proposals" | "finance" | "receivables" | "sessions" | "releases" | "shows" | "victor" | "steven" | "tasks"
>;

export function adaptCooCompanyState(coo: CooResult): CooAdaptedDomains {
  const { state } = coo;

  const projectsCov = coverageEntry(state, "projects.deadline");
  const projects = { domain: "projects" as const, ...domainState(state, "projects", state.projects, [], {
    warnings: projectsCov ? [`${projectsCov.usable ?? "?"} מתוך ${projectsCov.total ?? "?"} פרויקטים פעילים עם דדליין תקין (${projectsCov.note})`] : [],
  }) };

  const proposalsWithProject = state.proposals ? state.proposals.filter((p) => p.linkedProjectId !== null).length : null;
  const proposals = { domain: "proposals" as const, ...domainState(state, "proposals", state.proposals, [
    {
      toDomain: "projects", quality: "ID", via: "proposals.linked_project_id",
      coverage: relCoverage(proposalsWithProject, state.proposals?.length ?? null),
      notes: state.proposals ? `${proposalsWithProject} מתוך ${state.proposals.length} הצעות מקושרות לפרויקט (נאלבל לגיטימי לשאר)` : undefined,
    },
  ]) };

  const financeCov = coverageEntry(state, "finance.dated");
  const finance = { domain: "finance" as const, ...domainState(state, "transactions", state.finance, [
    {
      toDomain: "projects", quality: "ID", via: "transactions.project_id",
      notes: "כיסוי per-row לא ניתן לחישוב מ-FinanceFact המצרפי בלי query נוסף — לא הומצא מספר.",
    },
  ], {
    coverage: financeCov ? coverageFromCounts(financeCov.usable, financeCov.total) : undefined,
    warnings: financeCov ? [`${financeCov.usable ?? "?"} מתוך ${financeCov.total ?? "?"} תנועות עם תאריך`] : [],
  }) };

  const recCov = coverageEntry(state, "receivables");
  const receivables = { domain: "receivables" as const, ...domainState(state, "finance_settings", state.receivables, [
    {
      toDomain: "projects", quality: "ID", via: "settings.key = `finance_${projectId}`",
      coverage: recCov ? coverageFromCounts(recCov.usable, recCov.total) : undefined,
      notes: "מפתח דטרמיניסטי, לא free text",
    },
  ], {
    coverage: recCov ? coverageFromCounts(recCov.usable, recCov.total) : undefined,
    warnings: recCov ? [`${recCov.usable ?? "?"} מתוך ${recCov.total ?? "?"} פרויקטים עם מחיר מוסכם (${recCov.note})`] : [],
  }) };

  // Sessions: COO only ever fetches a forward window (see lib/coo/config.ts sessionWindowDays).
  // Domain coverage = PARTIAL is about SCOPE (no history read), never a source failure.
  // The relation's own coverage below is a SEPARATE number: of the sessions we DID fetch, how many carry project_id.
  const sessionsWithProject = state.sessions ? state.sessions.filter((s) => s.projectId !== null).length : null;
  const sessions = { domain: "sessions" as const, ...domainState(state, "sessions", state.sessions, [
    {
      toDomain: "projects", quality: "ID", via: "sessions.project_id",
      coverage: relCoverage(sessionsWithProject, state.sessions?.length ?? null),
      notes: state.sessions ? `${sessionsWithProject} מתוך ${state.sessions.length} סשנים (בחלון הקדימה) מקושרים לפרויקט` : undefined,
    },
  ], {
    coverage: state.sessions !== null ? "PARTIAL" : coverageFromStatus(statusFromSource(sourceOf(state.sources, "sessions"))),
    warnings: ["רק חלון קדימה (sessionWindowDays בקונפיג של COO) — אין קריאת היסטוריה. 'PARTIAL' כאן הוא scope, לא כשל מקור. ראה recommendation נפרד (Phase B.1 §4)."],
  }) };

  const relCov = coverageEntry(state, "releases");
  // ReleaseFact.projectId is a required (non-nullable) field — every fetched row carries it.
  const releases = { domain: "releases" as const, ...domainState(state, "releases", state.releases, [
    { toDomain: "projects", quality: "ID", via: "project_release_details.project_id", coverage: state.releases ? "FULL" : undefined },
  ], {
    coverage: relCov ? coverageFromCounts(relCov.usable, relCov.total) : undefined,
    warnings: [
      ...(relCov ? [`${relCov.usable ?? "?"} מתוך ${relCov.total ?? "?"} פרויקטי לייבל עם שורת release (${relCov.note})`] : []),
      "תיקון מהדוח הקודם (Phase B): project_release_details.label_artist_id אכן קיים ב-DB ונקרא ע\"י listLabelReleases(), אך lib/coo/types.ts ReleaseFact אינו שומר אותו — הטענה הקודמת שהיחס הזה כבר זמין ל-Partner הייתה שגויה. לא נחשף כרגע (אותה קטגוריה כמו Shows DJ fields לפני התיקון) — מועמד לשינוי additive עתידי, טרם אושר.",
    ],
  }) };

  const showRows = state.shows ? [...state.shows.upcoming, ...state.shows.doneUnpaid] : null;
  const showsWithDj = showRows ? showRows.filter((s) => s.djClientId !== null).length : null;
  const shows = { domain: "shows" as const, ...domainState(state, "shows", state.shows, [
    {
      toDomain: "external", quality: "ID", via: "shows.dj_client_id",
      coverage: relCoverage(showsWithDj, showRows?.length ?? null),
      notes: showRows ? `${showsWithDj} מתוך ${showRows.length} הופעות (upcoming+doneUnpaid) עם dj_client_id — נחשף לראשונה ב-Phase B.1 (שינוי additive ל-lib/coo/types.ts, ללא שינוי signals/cases/brief)` : "shows.dj_client_id נחשף לראשונה ב-Phase B.1",
    },
  ]) };

  const victorCov = coverageEntry(state, "victor.link");
  const victor = { domain: "victor" as const, ...domainState(state, "victor", state.team.victor, [
    {
      toDomain: "projects", quality: "ID", via: "vendor_project_work.project_id",
      coverage: victorCov ? coverageFromCounts(victorCov.usable, victorCov.total) : undefined,
      notes: "נאלבל לעבודות כלליות/עצמאיות — ראה warnings לאבחון (Phase B.1 §5)",
    },
  ], {
    coverage: victorCov ? coverageFromCounts(victorCov.usable, victorCov.total) : undefined,
    warnings: [
      "ball.holder הוא 'latest recorded action' בלבד (Hardening 1: files_sent[].uploadedAt מול version_reviews[].sentAt) — לא הוכחה ש'התור אצל הבעלים' במציאות.",
      ...(victorCov ? [`${victorCov.usable ?? "?"} מתוך ${victorCov.total ?? "?"} עבודות Victor פעילות מקושרות לפרויקט`] : []),
      "אבחון (Phase B.1 §5): כשאין project_id, vendor-store.ts מפיל את projectName ל-title (כותרת העבודה עצמה — לא שם פרויקט/אמן) או לפלייסהולדר \"עבודה ללא פרויקט\". אין שדה טקסט אמין שיכול לשמש fallback relation — לכן לא הומצא TEXT_MATCH חדש. תואם עם עבודות עצמאיות/legacy שלא נועדו להיות מקושרות לפרויקט; לא ניתן לקבוע יחס ללא קריאת תוכן חופשי (מחוץ לתחום read-only Eyes tool).",
    ],
  }) };

  const stevenCov = coverageEntry(state, "steven.link");
  const steven = { domain: "steven" as const, ...domainState(state, "steven", state.team.steven, [
    {
      toDomain: "projects", quality: "ID", via: "sound_engineer_work.project_id",
      coverage: stevenCov ? coverageFromCounts(stevenCov.usable, stevenCov.total) : undefined,
      notes: "נאלבל לעבודות עצמאיות",
    },
  ], {
    coverage: stevenCov ? coverageFromCounts(stevenCov.usable, stevenCov.total) : undefined,
    warnings: [
      "BALL_LOCATION = UNKNOWN/UNSUPPORTED: אין ל-Steven marker אמין ל'אצל מי הכדור' (status / mix_comments אינם מספיקים — ראה הדוח הקודם). לא נבנה כאן ball logic חדש.",
      ...(stevenCov ? [`${stevenCov.usable ?? "?"} מתוך ${stevenCov.total ?? "?"} עבודות Steven פתוחות מקושרות לפרויקט`] : []),
    ],
  }) };

  const tasksCov = coverageEntry(state, "tasks.link");
  const tasks = { domain: "tasks" as const, ...domainState(state, "tasks", state.tasks, [
    {
      toDomain: "projects", quality: "ID", via: "tasks.related_id (when related_type=\"project\")",
      coverage: tasksCov ? coverageFromCounts(tasksCov.usable, tasksCov.total) : undefined,
      notes: "קישור לא-נפתר מדווח כ-data quality note, לא מוסתר",
    },
  ], {
    coverage: tasksCov ? coverageFromCounts(tasksCov.usable, tasksCov.total) : undefined,
    warnings: tasksCov ? [`${tasksCov.usable ?? "?"} מתוך ${tasksCov.total ?? "?"} משימות פתוחות מקושרות לפרויקט קיים (${tasksCov.note})`] : [],
  }) };

  return { projects, proposals, finance, receivables, sessions, releases, shows, victor, steven, tasks };
}
