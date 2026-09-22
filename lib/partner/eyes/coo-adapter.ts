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
 * Sessions and Shows are deliberately NOT adapted here (Phase B.2) — lib/coo's
 * own reads are narrower (a forward window; an upcoming+doneUnpaid subset) than
 * what Partner needs. They get their own Partner-only full-history readers —
 * see readers.ts and company-state.ts's buildSessions()/buildShows().
 *
 * Agent Alerts is NOT here and never will be (Owner decision, Phase B.2):
 * agent_alerts is intentionally excluded from Redbloods Partner. The
 * agent_alerts system itself, and lib/coo's own (unrelated) use of it, are
 * completely untouched.
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
/**
 * A domain whose scope is KNOWN to be a filtered subset (e.g. "open tasks only") is capped
 * at PARTIAL when the read actually succeeds — but a failed/unavailable read must still say
 * FAILED/NONE, never PARTIAL (a bug caught by scripts/test-partner-eyes.ts: hardcoding
 * "PARTIAL" unconditionally silently hid a source failure behind the scope caveat).
 */
function scopedCoverage(status: ReturnType<typeof statusFromSource>): Coverage {
  return status === "AVAILABLE" ? "PARTIAL" : coverageFromStatus(status);
}

function domainState<T>(
  state: CompanyState,
  sourceName: string,
  data: T | null,
  relations: PartnerRelation[],
  scopeDescription: string,
  opts: { coverage?: Coverage; warnings?: string[]; currentOperationalCount?: number | null; totalHistoricalCount?: number | null } = {},
): Omit<PartnerDomainState<T>, "domain"> {
  const status = statusFromSource(sourceOf(state.sources, sourceName));
  const coverage = opts.coverage ?? coverageFromStatus(status);
  const relQuality = relations[0]?.quality ?? "NONE";
  return {
    status,
    coverage,
    reliability: reliabilityFrom(coverage, relQuality),
    scopeDescription,
    currentOperationalCount: opts.currentOperationalCount ?? null,
    totalHistoricalCount: opts.totalHistoricalCount ?? null,
    provenance: { source: `lib/coo:${sourceName}`, reader: READER, fetchedAt: state.meta.asOf },
    relations,
    warnings: opts.warnings ?? [],
    data,
  };
}

export type CooAdaptedDomains = Pick<
  PartnerCompanyState["domains"],
  "projects" | "proposals" | "finance" | "receivables" | "releases" | "victor" | "steven" | "tasks"
>;

export function adaptCooCompanyState(coo: CooResult): CooAdaptedDomains {
  const { state } = coo;

  // Projects: lib/projects-store.ts's listProjects() defaults to is_hidden=false when called
  // with no argument (as lib/coo/readers.ts does) — hidden projects are NOT in this data at all.
  // Confirmed by reading the store, not assumed. Coverage is PARTIAL until/unless Partner ever
  // reads listProjects(null) (all, hidden included) — not done this block (no new query approved for it).
  const projectsCov = coverageEntry(state, "projects.deadline");
  const projects = { domain: "projects" as const, ...domainState(
    state, "projects", state.projects, [],
    "all VISIBLE projects (is_hidden=false) — hidden projects excluded (listProjects() default filter)",
    {
      coverage: scopedCoverage(statusFromSource(sourceOf(state.sources, "projects"))),
      warnings: [
        "היקף מדויק: listProjects() ללא ארגומנט = is_hidden=false בלבד (ברירת המחדל). פרויקטים מוסתרים אינם בנתון הזה כלל. לא בוצע query נוסף ל-listProjects(null) בבלוק הזה.",
        ...(projectsCov ? [`${projectsCov.usable ?? "?"} מתוך ${projectsCov.total ?? "?"} פרויקטים פעילים (מהנראים) עם דדליין תקין (${projectsCov.note})`] : []),
      ],
    },
  ) };

  const proposalsWithProject = state.proposals ? state.proposals.filter((p) => p.linkedProjectId !== null).length : null;
  const proposals = { domain: "proposals" as const, ...domainState(
    state, "proposals", state.proposals,
    [{
      toDomain: "projects", quality: "ID", via: "proposals.linked_project_id",
      coverage: relCoverage(proposalsWithProject, state.proposals?.length ?? null),
      notes: state.proposals ? `${proposalsWithProject} מתוך ${state.proposals.length} הצעות מקושרות לפרויקט (נאלבל לגיטימי לשאר)` : undefined,
    }],
    "all proposals — no status/date filter in the reader",
  ) };

  const financeCov = coverageEntry(state, "finance.dated");
  const finance = { domain: "finance" as const, ...domainState(
    state, "transactions", state.finance,
    [{
      toDomain: "projects", quality: "ID", via: "transactions.project_id",
      notes: "כיסוי per-row לא ניתן לחישוב מ-FinanceFact המצרפי בלי query נוסף — לא הומצא מספר.",
    }],
    "all transaction history — every status (שולם/התקבל/צפוי/לא שולם/בוטל), every currency, undated rows included",
    {
      coverage: financeCov ? coverageFromCounts(financeCov.usable, financeCov.total) : undefined,
      warnings: financeCov ? [`${financeCov.usable ?? "?"} מתוך ${financeCov.total ?? "?"} תנועות עם תאריך`] : [],
    },
  ) };

  const recCov = coverageEntry(state, "receivables");
  const receivables = { domain: "receivables" as const, ...domainState(
    state, "finance_settings", state.receivables,
    [{
      toDomain: "projects", quality: "ID", via: "settings.key = `finance_${projectId}`",
      coverage: recCov ? coverageFromCounts(recCov.usable, recCov.total) : undefined,
      notes: "מפתח דטרמיניסטי, לא free text",
    }],
    "DERIVED domain: current outstanding balance per priced (non-hidden) project — not a raw DB table; built from finance_<projectId> settings + transactions. agreedPrice missing → UNKNOWN, never 0.",
    {
      coverage: recCov ? coverageFromCounts(recCov.usable, recCov.total) : undefined,
      warnings: recCov ? [`${recCov.usable ?? "?"} מתוך ${recCov.total ?? "?"} פרויקטים עם מחיר מוסכם (${recCov.note})`] : [],
    },
  ) };

  // Releases: listLabelReleases() = visible (is_hidden=false) label-business-type projects, LEFT
  // JOINed with project_release_details. lib/coo's own row filter then drops "יצא"/"בהשהייה" stages
  // (see lib/coo/facts.ts) — an ACTIVE-stage subset, not full release history. A project with no
  // release row is "no release record exists", not a reader failure.
  const relCov = coverageEntry(state, "releases");
  const releaseRows = state.releases?.rows ?? null;
  const releasesWithArtist = releaseRows ? releaseRows.filter((r) => r.labelArtistId !== null).length : null;
  const releases = { domain: "releases" as const, ...domainState(
    state, "releases", state.releases,
    [
      { toDomain: "projects", quality: "ID", via: "project_release_details.project_id", coverage: state.releases ? "FULL" : undefined },
      {
        toDomain: "labelArtists", quality: "ID", via: "project_release_details.label_artist_id",
        coverage: relCoverage(releasesWithArtist, releaseRows?.length ?? null),
        notes: releaseRows ? `${releasesWithArtist} מתוך ${releaseRows.length} שורות release (הפעילות) נושאות label_artist_id — נחשף לראשונה ב-Phase B.2 (שינוי additive), null אינו הופך ל-relation מומצא` : "נחשף לראשונה ב-Phase B.2",
      },
    ],
    "active release-stage rows only (excludes יצא/released and בהשהייה/on-hold), visible (non-hidden) label projects only",
    {
      coverage: relCov ? coverageFromCounts(relCov.usable, relCov.total) : undefined,
      warnings: relCov ? [`${relCov.usable ?? "?"} מתוך ${relCov.total ?? "?"} פרויקטי לייבל (נראים) עם שורת release פעילה (${relCov.note})`] : [],
    },
  ) };

  // Victor: getVictorWork() has NO status filter — it fetches every vendor_project_work row for
  // Victor (see lib/vendor-store.ts's own comment: "Always return ALL records"). So totalWorks
  // below is a TRUE full-history count. Only the per-row detail (ball/deadline/relation) is
  // limited to status="פעיל" (active) — that subset is what victor.link's coverage describes.
  const victorCov = coverageEntry(state, "victor.link");
  const victorActive = state.team.victor?.active.length ?? null;
  const victorTotal = state.team.victor?.totalWorks ?? null;
  const victor = { domain: "victor" as const, ...domainState(
    state, "victor", state.team.victor,
    [{
      toDomain: "projects", quality: "ID", via: "vendor_project_work.project_id",
      coverage: victorCov ? coverageFromCounts(victorCov.usable, victorCov.total) : undefined,
      notes: "נאלבל לעבודות כלליות/עצמאיות — ראה warnings לאבחון",
    }],
    "count: ALL Victor works ever (totalWorks, no status filter in getVictorWork()); per-row detail (ball/relation/deadline): status=\"פעיל\" (active) works only",
    {
      coverage: victorCov ? coverageFromCounts(victorCov.usable, victorCov.total) : undefined,
      currentOperationalCount: victorActive,
      totalHistoricalCount: victorTotal,
      warnings: [
        "ball.holder הוא 'latest recorded action' בלבד (Hardening 1: files_sent[].uploadedAt מול version_reviews[].sentAt) — לא הוכחה ש'התור אצל הבעלים' במציאות.",
        ...(victorCov ? [`${victorCov.usable ?? "?"} מתוך ${victorCov.total ?? "?"} עבודות Victor פעילות מקושרות לפרויקט`] : []),
        "כשאין project_id, vendor-store.ts מפיל את projectName ל-title (כותרת העבודה עצמה — לא שם פרויקט/אמן) או לפלייסהולדר \"עבודה ללא פרויקט\". אין שדה טקסט אמין שיכול לשמש fallback relation — לכן לא הומצא TEXT_MATCH חדש.",
      ],
    },
  ) };

  // Steven: listSoundEngineerWork("Steven") has NO status filter either — same shape as Victor.
  const stevenCov = coverageEntry(state, "steven.link");
  const stevenOpen = state.team.steven?.open.length ?? null;
  const stevenTotal = state.team.steven?.totalWorks ?? null;
  const steven = { domain: "steven" as const, ...domainState(
    state, "steven", state.team.steven,
    [{
      toDomain: "projects", quality: "ID", via: "sound_engineer_work.project_id",
      coverage: stevenCov ? coverageFromCounts(stevenCov.usable, stevenCov.total) : undefined,
      notes: "נאלבל לעבודות עצמאיות",
    }],
    "count: ALL Steven works ever (totalWorks, no status filter in listSoundEngineerWork()); per-row detail: open (non-closed) works only",
    {
      coverage: stevenCov ? coverageFromCounts(stevenCov.usable, stevenCov.total) : undefined,
      currentOperationalCount: stevenOpen,
      totalHistoricalCount: stevenTotal,
      warnings: [
        "BALL_LOCATION = UNKNOWN/UNSUPPORTED: אין ל-Steven marker אמין ל'אצל מי הכדור' (status / mix_comments אינם מספיקים). לא נבנה כאן ball logic חדש.",
        ...(stevenCov ? [`${stevenCov.usable ?? "?"} מתוך ${stevenCov.total ?? "?"} עבודות Steven פתוחות מקושרות לפרויקט`] : []),
      ],
    },
  ) };

  // Tasks: lib/coo/readers.ts calls listTasks({ status: "פתוח" }) — open only, explicitly.
  const tasksCov = coverageEntry(state, "tasks.link");
  const tasks = { domain: "tasks" as const, ...domainState(
    state, "tasks", state.tasks,
    [{
      toDomain: "projects", quality: "ID", via: "tasks.related_id (when related_type=\"project\")",
      coverage: tasksCov ? coverageFromCounts(tasksCov.usable, tasksCov.total) : undefined,
      notes: "קישור לא-נפתר מדווח כ-data quality note, לא מוסתר",
    }],
    "open tasks only (status=\"פתוח\", explicit filter in lib/coo/readers.ts) — no closed/cancelled task history read",
    {
      coverage: scopedCoverage(statusFromSource(sourceOf(state.sources, "tasks"))),
      currentOperationalCount: state.tasks?.openCount ?? null,
      totalHistoricalCount: null,
      warnings: [
        "לא נקרא full task history בבלוק הזה (אין דרישה, אין reusable all-tasks reader קיים כרגע מעבר ל-listTasks() עם opts.status ריק, שלא נבדק/נעשה בו שימוש כאן).",
        ...(tasksCov ? [`${tasksCov.usable ?? "?"} מתוך ${tasksCov.total ?? "?"} משימות פתוחות מקושרות לפרויקט קיים (${tasksCov.note})`] : []),
      ],
    },
  ) };

  return { projects, proposals, finance, receivables, releases, victor, steven, tasks };
}
