/**
 * Assembles the full PartnerCompanyState from an already-computed CooResult
 * (reused, never refetched) and a PartnerEyesRaw read. PURE — no I/O.
 *
 * Mirrors lib/coo/pipeline.ts's own pure/impure split: this file has no
 * "server-only" import and no Supabase; lib/partner/eyes/build.ts is the
 * thin server-only shell that fetches both inputs once and calls this.
 *
 * Agent Alerts is NOT built here (Owner decision, Phase B.2) — see
 * lib/partner/eyes/types.ts's module doc for the full statement.
 */
import type { CooResult } from "../../coo/pipeline";
import { adaptCooCompanyState } from "./coo-adapter";
import { buildChangeReadinessMatrix } from "./changeReadiness";
import { classifyRelationQuality, coverageFromCounts, coverageFromStatus, reliabilityFrom, statusFromSource } from "./coverage";
import type {
  ClientsFact, ClipsFact, LabelArtistBalanceTotals, LabelArtistsFact, PartnerCompanyState, PartnerDomainState, PartnerEyesRaw,
  PartnerRelation, ProposalsFullFact, RawBalanceEntry, ReleasesFullFact, SessionsFact, ShowsEyesFact, TasksFullFact, TransactionsFact,
} from "./types";

const EYES_SCHEMA_VERSION = "partner-eyes-v0.4"; // Phase C.3: proposalsFull/releasesFull/transactions/tasksFull domains + changeReadiness matrix
const NEW_READER = "lib/partner/eyes/readers.ts:readPartnerEyesRaw";

function sourceOf(raw: PartnerEyesRaw, name: string) {
  return raw.sources.find((s) => s.source === name);
}

/**
 * Mirrors lib/artist-balance-store.ts:computeArtistBalanceTotals() EXACTLY —
 * same 5 Hebrew entry types, same formula. Duplicated (not imported) because
 * that file has `import "server-only"`; do not let the two definitions drift.
 * The table has no currency column — this is one implicit ledger, not
 * currency-aware (see the domain's warnings).
 */
const BALANCE_ENTRY_TYPES = ["הכנסות", "הכנסות צפויות", "תשלומים", "הוצאות", "הוצאות צפויות"] as const;
function computeBalanceTotals(entries: RawBalanceEntry[]): LabelArtistBalanceTotals {
  const sum = (type: (typeof BALANCE_ENTRY_TYPES)[number]) => entries.filter((e) => e.entryType === type).reduce((acc, e) => acc + e.amount, 0);
  const income = sum("הכנסות"), expectedIncome = sum("הכנסות צפויות"), payments = sum("תשלומים"), expenses = sum("הוצאות"), expectedExpenses = sum("הוצאות צפויות");
  return { income, expectedIncome, payments, expenses, expectedExpenses, currentBalance: income - payments - expenses };
}

function buildClients(raw: PartnerEyesRaw, asOf: string): PartnerDomainState<ClientsFact> {
  const status = statusFromSource(sourceOf(raw, "clients"));
  const coverage = coverageFromStatus(status);
  const relations: PartnerRelation[] = [
    { toDomain: "projects", quality: "TEXT_MATCH", via: "projects.artist = clients.name", notes: "אין client_id על projects — נבדק בקוד, לא קיימת עמודה כזו. תלוי בהתאמת שם מדויקת (case/whitespace)." },
  ];
  const data: ClientsFact | null = raw.clients ? {
    total: raw.clients.length,
    byType: raw.clients.reduce<Record<string, number>>((acc, c) => { acc[c.type] = (acc[c.type] ?? 0) + 1; return acc; }, {}),
    items: raw.clients.map((c) => ({ id: c.id, name: c.name, type: c.type, status: c.status, createdAt: c.createdAt })),
  } : null;
  return {
    domain: "clients", status, coverage, reliability: reliabilityFrom(coverage, relations[0].quality),
    scopeDescription: "all clients — listClients() has no filter (no deleted/hidden semantics on this table)",
    currentOperationalCount: null, totalHistoricalCount: null,
    provenance: { source: "supabase:clients", reader: NEW_READER, fetchedAt: asOf },
    relations, warnings: [], data,
  };
}

function buildLabelArtists(raw: PartnerEyesRaw, coo: CooResult, asOf: string): PartnerDomainState<LabelArtistsFact> {
  const status = statusFromSource(sourceOf(raw, "label_artists"));
  const coverage = coverageFromStatus(status);
  const releaseRows = coo.state.releases?.rows ?? null;
  const releasesWithArtist = releaseRows ? releaseRows.filter((r) => r.labelArtistId !== null).length : null;
  const relations: PartnerRelation[] = [
    { toDomain: "projects", quality: "TEXT_MATCH", via: "projects.artist = label_artists.name", notes: "היחס העיקרי — התאמת שם, לא ID." },
    {
      toDomain: "projects", quality: "ID", via: "project_release_details.label_artist_id",
      coverage: releasesWithArtist == null || releaseRows == null ? undefined : coverageFromCounts(releasesWithArtist, releaseRows.length),
      notes: releaseRows ? `זמין בפועל (Phase B.2): ${releasesWithArtist} מתוך ${releaseRows.length} שורות release (הפעילות) נושאות label_artist_id — ראה domain 'releases'.` : "אמין כשקיים, אך רק לפרויקטים עם שורת release פעילה.",
    },
  ];
  const entriesByArtist = new Map<string, RawBalanceEntry[]>();
  for (const e of raw.artistBalanceEntries ?? []) {
    const list = entriesByArtist.get(e.artistId);
    if (list) list.push(e); else entriesByArtist.set(e.artistId, [e]);
  }
  const warnings: string[] = [
    "היחס ל-ID (label_artist_id) קיים רק לתת-קבוצת הפרויקטים שיש להם שורת release פעילה (ראה domain 'releases') — לרוב אמני הלייבל עדיין רק TEXT_MATCH דרך projects.artist.",
  ];
  const data: LabelArtistsFact | null = raw.labelArtists ? {
    total: raw.labelArtists.length,
    byStatus: raw.labelArtists.reduce<Record<string, number>>((acc, a) => { acc[a.status] = (acc[a.status] ?? 0) + 1; return acc; }, {}),
    items: raw.labelArtists.map((a) => {
      const entries = entriesByArtist.get(a.id) ?? [];
      return { id: a.id, name: a.name, status: a.status, createdAt: a.createdAt, updatedAt: a.updatedAt, balanceEntries: entries.length, balanceTotals: entries.length ? computeBalanceTotals(entries) : null };
    }),
    balanceCoverage: {
      artistsWithEntries: [...entriesByArtist.values()].filter((v) => v.length > 0).length,
      totalEntries: raw.artistBalanceEntries?.length ?? 0,
    },
  } : null;
  if (raw.artistBalanceEntries === null) {
    warnings.push("artist_balance_entries לא נקרא (label_artists לא זמין, או שהקריאה נכשלה).");
  } else {
    warnings.push(
      "artist_balance_entries הוא ledger עצמאי ומעודכן ידנית (backfill חד-פעמי + רישומים ידניים, all-time — אין cycle/date filter בקריאה) — לא מסונכרן עם transactions/Finance. אל תניח שהוא עדכני.",
      "balanceTotals מחושב באותה נוסחה בדיוק כמו lib/artist-balance-store.ts:computeArtistBalanceTotals() (income − payments − expenses) — לא לוגיקה חדשה. הטבלה ללא עמודת מטבע — מוצג כ-ledger אחד ללא הנחת מטבע.",
    );
  }
  return {
    domain: "labelArtists", status, coverage, reliability: reliabilityFrom(coverage, "TEXT_MATCH"),
    scopeDescription: "all label artists — listLabelArtists() has no filter",
    currentOperationalCount: null, totalHistoricalCount: null,
    provenance: { source: "supabase:label_artists + artist_balance_entries", reader: NEW_READER, fetchedAt: asOf },
    relations, warnings, data,
  };
}

/**
 * Phase B.1 fix, kept: quality and coverage are two different questions.
 *   quality  — when project_id IS present, is it a real id? (yes, always — so ID whenever any row has it)
 *   coverage — how many of the fetched rows actually have it?
 */
function buildClips(raw: PartnerEyesRaw, asOf: string): PartnerDomainState<ClipsFact> {
  const status = statusFromSource(sourceOf(raw, "clip_productions"));
  const coverage = coverageFromStatus(status);
  const total = raw.clips?.length ?? 0;
  const withProjectId = raw.clips?.filter((c) => c.projectId !== null).length ?? 0;
  const idQuality = raw.clips ? classifyRelationQuality(withProjectId, total) : "UNKNOWN";
  const idCoverage = raw.clips ? coverageFromCounts(withProjectId, total) : undefined;
  const relations: PartnerRelation[] = [
    {
      toDomain: "projects", quality: idQuality, coverage: idCoverage, via: "red_films_productions.project_id",
      notes: raw.clips ? `${withProjectId} מתוך ${total} שורות נושאות project_id — נבדק בפועל, לא הונח.` : undefined,
    },
    { toDomain: "clients", quality: "TEXT_MATCH", via: "red_films_productions.artist_name = clients.name / label_artists.name", notes: `fallback ל-${total - withProjectId} שורות ללא project_id` },
  ];
  const warnings: string[] = [];
  if (raw.clips) {
    warnings.push(`${withProjectId}/${total} clip productions carry project_id → relation quality ID, coverage ${idCoverage} (לא הורד ל-TEXT_MATCH בגלל כיסוי חלקי).`);
  }
  const data: ClipsFact | null = raw.clips ? {
    total, withProjectId, withoutProjectId: total - withProjectId,
    items: raw.clips.map((c) => ({ id: c.id, title: c.title, status: c.status, projectId: c.projectId, artistName: c.artistName })),
  } : null;
  return {
    domain: "clips", status, coverage, reliability: reliabilityFrom(coverage, idQuality),
    scopeDescription: "all clip (קליפ) productions, INCLUDING cancelled — no status filter beyond production_type=\"קליפ\" (deliberately broader than listArtistClips(), which excludes cancelled)",
    currentOperationalCount: null, totalHistoricalCount: null,
    provenance: { source: "supabase:red_films_productions (production_type=\"קליפ\")", reader: NEW_READER, fetchedAt: asOf },
    relations, warnings, data,
  };
}

/**
 * Sessions — Phase B.2, full history (approved). lib/coo only ever reads a
 * forward window (sessionWindowDays); this reads every session ever recorded
 * via lib/sessions-store.ts's listAllSessions() — a separate read, lib/coo's
 * own window-limited behavior is completely unchanged.
 */
function buildSessions(raw: PartnerEyesRaw, coo: CooResult, asOf: string): PartnerDomainState<SessionsFact> {
  const status = statusFromSource(sourceOf(raw, "sessions_eyes"));
  const coverage = coverageFromStatus(status);
  const withProject = raw.sessions ? raw.sessions.filter((s) => s.projectId !== null).length : null;
  const relations: PartnerRelation[] = [
    {
      toDomain: "projects", quality: "ID", via: "sessions.project_id",
      coverage: withProject == null || raw.sessions == null ? undefined : coverageFromCounts(withProject, raw.sessions.length),
      notes: raw.sessions ? `${withProject} מתוך ${raw.sessions.length} סשנים (כל ההיסטוריה) מקושרים לפרויקט` : undefined,
    },
  ];
  const cooCount = coo.state.sessions?.length ?? null;
  const warnings: string[] = [
    `lib/coo רואה רק חלון קדימה (sessionWindowDays בקונפיג שלו) — ${cooCount ?? "?"} סשנים כרגע באותה קריאה. Partner Eyes כאן קורא את כל ההיסטוריה בנפרד (listAllSessions()), לא אותו read.`,
    "אין הסקת attendance/reliability מ-status — 'בוצע'/'בוטל' וכו' הם ערכים שמורים בלבד.",
  ];
  const data: SessionsFact | null = raw.sessions ? {
    total: raw.sessions.length,
    withProject: withProject ?? 0,
    byStatus: raw.sessions.reduce<Record<string, number>>((acc, s) => { acc[s.status] = (acc[s.status] ?? 0) + 1; return acc; }, {}),
    byType: raw.sessions.reduce<Record<string, number>>((acc, s) => { acc[s.sessionType] = (acc[s.sessionType] ?? 0) + 1; return acc; }, {}),
    cooVisible: { count: cooCount, note: "מה ש-lib/coo רואה בפועל בחלון הקדימה שלו — cross-reference בלבד" },
    items: raw.sessions.map((s) => ({ id: s.id, projectId: s.projectId, showId: s.showId, dateYmd: s.date, status: s.status, sessionType: s.sessionType })),
  } : null;
  return {
    domain: "sessions", status, coverage, reliability: reliabilityFrom(coverage, "ID"),
    scopeDescription: "all session history, no date window (lib/sessions-store.ts:listAllSessions())",
    currentOperationalCount: cooCount, totalHistoricalCount: data?.total ?? null,
    provenance: { source: "supabase:sessions (Partner-only full-history read)", reader: NEW_READER, fetchedAt: asOf },
    relations, warnings, data,
  };
}

/**
 * Shows — Phase B.2, full history (approved, reuses listShows() — the exact
 * function lib/coo already calls — a second time; lib/coo's own operational
 * subset, upcoming+doneUnpaid, is completely unchanged).
 */
function buildShows(raw: PartnerEyesRaw, coo: CooResult, asOf: string): PartnerDomainState<ShowsEyesFact> {
  const status = statusFromSource(sourceOf(raw, "shows_eyes"));
  const coverage = coverageFromStatus(status);
  const withDj = raw.shows ? raw.shows.filter((s) => s.djClientId !== null).length : null;
  const withArtist = raw.shows ? raw.shows.filter((s) => s.artistClientId !== null).length : null;
  const withBooker = raw.shows ? raw.shows.filter((s) => s.bookerClientId !== null).length : null;
  const relCov = (n: number | null) => n == null || raw.shows == null ? undefined : coverageFromCounts(n, raw.shows.length);
  const relations: PartnerRelation[] = [
    {
      toDomain: "external", quality: "ID", via: "shows.artist_client_id",
      coverage: relCov(withArtist),
      notes: raw.shows ? `${withArtist} מתוך ${raw.shows.length} הופעות עם artist_client_id (המבצע/ת — נחשף לראשונה ב-Phase C.2) — null אינו הופך ל-relation מומצא` : undefined,
    },
    {
      toDomain: "external", quality: "ID", via: "shows.booker_client_id",
      coverage: relCov(withBooker),
      notes: raw.shows ? `${withBooker} מתוך ${raw.shows.length} הופעות עם booker_client_id (נחשף לראשונה ב-Phase C.2)` : undefined,
    },
    {
      toDomain: "external", quality: "ID", via: "shows.dj_client_id",
      coverage: relCov(withDj),
      notes: raw.shows ? `${withDj} מתוך ${raw.shows.length} הופעות (כל ההיסטוריה) עם dj_client_id — null אינו הופך ל-relation מומצא` : undefined,
    },
  ];
  const cooUpcoming = coo.state.shows?.upcoming.length ?? null;
  const cooDoneUnpaid = coo.state.shows?.doneUnpaid.length ?? null;
  const warnings: string[] = [
    `lib/coo רואה subset תפעולי בלבד: upcoming=${cooUpcoming ?? "?"}, doneUnpaid=${cooDoneUnpaid ?? "?"}. Partner Eyes כאן קורא היסטוריה מלאה דרך אותו listShows() בדיוק — קריאה שנייה, לא query חדש מבחינת צורה.`,
    "shows.artist_client_id ו-booker_client_id (Phase C.2) הם ID relations אמיתיים ל-clients — נפרדים מ-dj_client_id. שלושתם יכולים להצביע על clients שונים על אותה הופעה.",
  ];
  const data: ShowsEyesFact | null = raw.shows ? {
    total: raw.shows.length,
    withDjClientId: withDj ?? 0,
    byStatus: raw.shows.reduce<Record<string, number>>((acc, s) => { acc[s.status] = (acc[s.status] ?? 0) + 1; return acc; }, {}),
    cooVisible: { upcoming: cooUpcoming, doneUnpaid: cooDoneUnpaid, note: "מה ש-lib/coo רואה בפועל (subset תפעולי) — cross-reference בלבד" },
    items: raw.shows.map((s) => ({
      id: s.id, name: s.name, status: s.status, paymentStatus: s.paymentStatus, dateYmd: s.date,
      djClientId: s.djClientId, djConfirmationStatus: s.djConfirmationStatus, artistClientId: s.artistClientId, bookerClientId: s.bookerClientId,
    })),
  } : null;
  return {
    domain: "shows", status, coverage, reliability: reliabilityFrom(coverage, "ID"),
    scopeDescription: "all show history (lib/shows-store.ts:listShows(), called again for Partner — no filter)",
    currentOperationalCount: (cooUpcoming ?? 0) + (cooDoneUnpaid ?? 0), totalHistoricalCount: data?.total ?? null,
    provenance: { source: "supabase:shows (Partner-only full-history read)", reader: NEW_READER, fetchedAt: asOf },
    relations, warnings, data,
  };
}

/**
 * Proposals — Phase C.3, full history (approved, §36-41). proposals.client_id
 * is a real FK (confirmed against the live schema and app/api/proposals/
 * route.ts's own .eq("client_id", ...) usage) — the PRIMARY relation here.
 * lib/coo's own "proposals" domain (status-filtered, clientName only) is
 * completely unchanged — this is an additive sibling, same pattern as
 * Sessions/Shows in Phase B.2.
 */
function buildProposalsFull(raw: PartnerEyesRaw, coo: CooResult, asOf: string): PartnerDomainState<ProposalsFullFact> {
  const status = statusFromSource(sourceOf(raw, "proposals_eyes"));
  const coverage = coverageFromStatus(status);
  const withClientId = raw.proposalsFull ? raw.proposalsFull.filter((p) => p.clientId !== null).length : null;
  const withLinkedProjectId = raw.proposalsFull ? raw.proposalsFull.filter((p) => p.linkedProjectId !== null).length : null;
  const relations: PartnerRelation[] = [
    {
      toDomain: "clients", quality: "ID", via: "proposals.client_id",
      coverage: withClientId == null || raw.proposalsFull == null ? undefined : coverageFromCounts(withClientId, raw.proposalsFull.length),
      notes: raw.proposalsFull ? `${withClientId} מתוך ${raw.proposalsFull.length} הצעות (כל ההיסטוריה) נושאות client_id — שורות legacy בלבד עשויות להיות ללא` : undefined,
    },
    {
      toDomain: "projects", quality: "ID", via: "proposals.linked_project_id",
      coverage: withLinkedProjectId == null || raw.proposalsFull == null ? undefined : coverageFromCounts(withLinkedProjectId, raw.proposalsFull.length),
      notes: raw.proposalsFull ? `${withLinkedProjectId} מתוך ${raw.proposalsFull.length} הצעות מקושרות לפרויקט` : undefined,
    },
  ];
  const cooCount = coo.state.proposals?.length ?? null;
  const warnings: string[] = [
    `lib/coo רואה subset מסונן סטטוס בלבד (מוריד נסגר/לא נסגר) — ${cooCount ?? "?"} הצעות כרגע באותה קריאה. Partner Eyes כאן קורא את כל ההיסטוריה בנפרד (proposals, ללא סינון סטטוס), לא אותו read.`,
    "client_id הוא FK אמיתי (Phase C.3 finding) — clientName הוא fallback תצוגה בלבד לשורות legacy נדירות ללא client_id, לא ה-relation העיקרי.",
  ];
  const data: ProposalsFullFact | null = raw.proposalsFull ? {
    total: raw.proposalsFull.length,
    byStatus: raw.proposalsFull.reduce<Record<string, number>>((acc, p) => { acc[p.status] = (acc[p.status] ?? 0) + 1; return acc; }, {}),
    withClientId: withClientId ?? 0,
    withLinkedProjectId: withLinkedProjectId ?? 0,
    cooVisible: { count: cooCount, note: "מה ש-lib/coo רואה בפועל (מסונן סטטוס, ללא נסגר/לא נסגר) — cross-reference בלבד" },
    items: raw.proposalsFull.map((p) => ({
      id: p.id, clientId: p.clientId, clientName: p.clientName, linkedProjectId: p.linkedProjectId, title: p.title,
      amount: p.amount, currency: p.currency, status: p.status, followupYmd: p.followupDate, sentYmd: p.sentDate,
      createdAt: p.createdAt, updatedAt: p.updatedAt,
    })),
  } : null;
  return {
    domain: "proposalsFull", status, coverage, reliability: reliabilityFrom(coverage, "ID"),
    scopeDescription: "all proposals, full history, no status filter (Partner-only read — separate from lib/coo's own status-filtered proposals domain, which is unchanged)",
    currentOperationalCount: cooCount, totalHistoricalCount: data?.total ?? null,
    provenance: { source: "supabase:proposals (Partner-only full-history read)", reader: NEW_READER, fetchedAt: asOf },
    relations, warnings, data,
  };
}

/**
 * Releases — Phase C.3, full history (approved, §52-54). Reads
 * project_release_details directly (project_id IS the primary key), with no
 * project-visibility/business-type/stage filter (unlike lib/coo's
 * listLabelReleases(), which stays completely unchanged).
 */
function buildReleasesFull(raw: PartnerEyesRaw, coo: CooResult, asOf: string): PartnerDomainState<ReleasesFullFact> {
  const status = statusFromSource(sourceOf(raw, "releases_eyes"));
  const coverage = coverageFromStatus(status);
  const withLabelArtistId = raw.releasesFull ? raw.releasesFull.filter((r) => r.labelArtistId !== null).length : null;
  const relations: PartnerRelation[] = [
    { toDomain: "projects", quality: "ID", via: "project_release_details.project_id", coverage: raw.releasesFull ? "FULL" : undefined, notes: "project_id הוא ה-primary key של הטבלה — כל שורה מקושרת." },
    {
      toDomain: "labelArtists", quality: "ID", via: "project_release_details.label_artist_id",
      coverage: withLabelArtistId == null || raw.releasesFull == null ? undefined : coverageFromCounts(withLabelArtistId, raw.releasesFull.length),
      notes: raw.releasesFull ? `${withLabelArtistId} מתוך ${raw.releasesFull.length} שורות release (כל ההיסטוריה, כל stage) נושאות label_artist_id` : undefined,
    },
  ];
  const cooCount = coo.state.releases?.rows.length ?? null;
  const warnings: string[] = [
    `lib/coo רואה subset פעיל בלבד (מוציא יצא/בהשהייה, פרויקטי לייבל נראים בלבד) — ${cooCount ?? "?"} שורות כרגע באותה קריאה. Partner Eyes כאן קורא ישירות מ-project_release_details, ללא סינון stage/visibility/business_type.`,
  ];
  const data: ReleasesFullFact | null = raw.releasesFull ? {
    total: raw.releasesFull.length,
    byStage: raw.releasesFull.reduce<Record<string, number>>((acc, r) => { acc[r.stage] = (acc[r.stage] ?? 0) + 1; return acc; }, {}),
    withLabelArtistId: withLabelArtistId ?? 0,
    cooVisible: { count: cooCount, note: "מה ש-lib/coo רואה בפועל (active-stage, visible label projects בלבד) — cross-reference בלבד" },
    items: raw.releasesFull.map((r) => ({
      projectId: r.projectId, labelArtistId: r.labelArtistId, stage: r.stage, targetYmd: r.targetDate,
      stageEnteredAt: r.stageEnteredAt, releasedAt: r.releasedAt, createdAt: r.createdAt, updatedAt: r.updatedAt,
    })),
  } : null;
  return {
    domain: "releasesFull", status, coverage, reliability: reliabilityFrom(coverage, "ID"),
    scopeDescription: "all project_release_details rows, every stage, no project-visibility/business-type filter (Partner-only read — separate from lib/coo's own active-stage/visible-label-only releases domain, which is unchanged)",
    currentOperationalCount: cooCount, totalHistoricalCount: data?.total ?? null,
    provenance: { source: "supabase:project_release_details (Partner-only full-history read)", reader: NEW_READER, fetchedAt: asOf },
    relations, warnings, data,
  };
}

/**
 * Transactions — Phase C.3, per-row detail (approved, §42-46). lib/coo's
 * "finance" domain (FinanceFact) is an aggregate built from this same table;
 * this is the first per-row Partner read. Finance semantics (received/not
 * received, UNKNOWN vs 0, no FX) are NOT recomputed here — this is raw row
 * exposure only, no derived balance logic.
 */
function buildTransactions(raw: PartnerEyesRaw, asOf: string): PartnerDomainState<TransactionsFact> {
  const status = statusFromSource(sourceOf(raw, "transactions_eyes"));
  const coverage = coverageFromStatus(status);
  const withProjectId = raw.transactions ? raw.transactions.filter((t) => t.projectId !== null).length : null;
  const relations: PartnerRelation[] = [
    {
      toDomain: "projects", quality: "ID", via: "transactions.project_id",
      coverage: withProjectId == null || raw.transactions == null ? undefined : coverageFromCounts(withProjectId, raw.transactions.length),
      notes: raw.transactions ? `${withProjectId} מתוך ${raw.transactions.length} תנועות (כל ההיסטוריה) מקושרות לפרויקט — השאר scope="general" או orphan` : undefined,
    },
  ];
  const warnings: string[] = [
    "חשיפת שורות גולמיות בלבד — לא מחשב מחדש יתרה/received/UNKNOWN. הסמנטיקה הפיננסית (lib/coo:finance/receivables) נשארת מקור האמת היחיד לחישובים.",
    "אין updated_at בטבלת transactions (נבדק מול הסכימה בפועל) — עדכון שדה בתנועה קיימת אינו ניתן לזיהוי מ-created_at בלבד.",
  ];
  const data: TransactionsFact | null = raw.transactions ? {
    total: raw.transactions.length,
    withProjectId: withProjectId ?? 0,
    byStatus: raw.transactions.reduce<Record<string, number>>((acc, t) => { acc[t.status] = (acc[t.status] ?? 0) + 1; return acc; }, {}),
    byType: raw.transactions.reduce<Record<string, number>>((acc, t) => { acc[t.type] = (acc[t.type] ?? 0) + 1; return acc; }, {}),
    byCurrency: raw.transactions.reduce<Record<string, number>>((acc, t) => { const c = t.currency ?? "?"; acc[c] = (acc[c] ?? 0) + 1; return acc; }, {}),
    items: raw.transactions.map((t) => ({
      id: t.id, projectId: t.projectId, type: t.type, amount: t.amount, currency: t.currency ?? "?", status: t.status,
      dateYmd: t.date, expenseScope: t.expenseScope, category: t.category ?? "", createdAt: t.createdAt,
    })),
  } : null;
  return {
    domain: "transactions", status, coverage, reliability: reliabilityFrom(coverage, "ID"),
    scopeDescription: "all transaction rows, full history, every status/currency/scope (Partner-only per-row read — lib/coo's own aggregated finance domain is unchanged)",
    currentOperationalCount: null, totalHistoricalCount: data?.total ?? null,
    provenance: { source: "supabase:transactions (Partner-only full-history read)", reader: NEW_READER, fetchedAt: asOf },
    relations, warnings, data,
  };
}

/**
 * Tasks — Phase C.3, full history (approved, §49-51). Reuses the SAME
 * lib/tasks-store.ts:listTasks() lib/coo's own open-only read already calls,
 * with no status filter — not a new query shape, a second call. lib/coo's
 * own "tasks" domain (open-only) is completely unchanged.
 */
function buildTasksFull(raw: PartnerEyesRaw, coo: CooResult, asOf: string): PartnerDomainState<TasksFullFact> {
  const status = statusFromSource(sourceOf(raw, "tasks_eyes"));
  const coverage = coverageFromStatus(status);
  const linkedToProject = raw.tasksFull ? raw.tasksFull.filter((t) => t.relatedType === "project" && t.relatedId !== null).length : null;
  const relations: PartnerRelation[] = [
    {
      toDomain: "projects", quality: "ID", via: "tasks.related_type=\"project\" AND tasks.related_id",
      coverage: linkedToProject == null || raw.tasksFull == null ? undefined : coverageFromCounts(linkedToProject, raw.tasksFull.length),
      notes: raw.tasksFull ? `${linkedToProject} מתוך ${raw.tasksFull.length} משימות (כל ההיסטוריה) מקושרות לפרויקט` : undefined,
    },
  ];
  const cooOpenCount = coo.state.tasks?.openCount ?? null;
  const warnings: string[] = [
    `lib/coo רואה open בלבד (status="פתוח") — ${cooOpenCount ?? "?"} משימות פתוחות כרגע באותה קריאה. Partner Eyes כאן קורא listTasks() ללא פילטר סטטוס — אותו store, קריאה שנייה.`,
  ];
  const data: TasksFullFact | null = raw.tasksFull ? {
    total: raw.tasksFull.length,
    byStatus: raw.tasksFull.reduce<Record<string, number>>((acc, t) => { acc[t.status] = (acc[t.status] ?? 0) + 1; return acc; }, {}),
    linkedToProject: linkedToProject ?? 0,
    cooVisible: { openCount: cooOpenCount, note: "מה ש-lib/coo רואה בפועל (open בלבד) — cross-reference בלבד" },
    items: raw.tasksFull.map((t) => ({
      id: t.id, title: t.title, status: t.status, dueYmd: t.dueDate, relatedType: t.relatedType, relatedId: t.relatedId,
      createdAt: t.createdAt, updatedAt: t.updatedAt,
    })),
  } : null;
  return {
    domain: "tasksFull", status, coverage, reliability: reliabilityFrom(coverage, "ID"),
    scopeDescription: "all tasks, full history, every status (Partner-only read — separate from lib/coo's own open-only tasks domain, which is unchanged)",
    currentOperationalCount: cooOpenCount, totalHistoricalCount: data?.total ?? null,
    provenance: { source: "supabase:tasks (Partner-only full-history read, listTasks() with no filter)", reader: NEW_READER, fetchedAt: asOf },
    relations, warnings, data,
  };
}

function buildSuppliers(asOf: string): PartnerDomainState<null> {
  return {
    domain: "suppliers", status: "UNAVAILABLE", coverage: "NONE", reliability: "UNKNOWN",
    scopeDescription: "N/A — no dedicated suppliers/vendors table exists",
    currentOperationalCount: null, totalHistoricalCount: null,
    provenance: { source: "N/A", reader: "manual re-audit — Partner Phase B report", fetchedAt: asOf },
    relations: [],
    warnings: [
      "אין טבלת suppliers/vendors ייעודית. 'supplier'/'vendor' הם כרגע שמות ה-routing של Victor ו-Steven בלבד " +
        "(app/api/vendor/victor/*, app/api/supplier/steven/*). vendor_project_work.vendor_name הוא עמודה גנרית " +
        "בסכימה, אך כל query/insert בקוד קובע אותה ל-\"victor\" בלבד — לא נמצא vendor שני בפועל בקוד.",
      "אם domain ספקים אמיתי יעלה בעתיד (שאינו Victor/Steven) — יש למדל אותו במפורש, לא לעשות reuse ל-vendor_project_work/sound_engineer_work.",
    ],
    data: null,
  };
}

export function assemblePartnerCompanyState(coo: CooResult, raw: PartnerEyesRaw): PartnerCompanyState {
  const asOf = coo.state.meta.asOf;
  const cooDomains = adaptCooCompanyState(coo);
  const domains = {
    ...cooDomains,
    clients: buildClients(raw, asOf),
    labelArtists: buildLabelArtists(raw, coo, asOf),
    clips: buildClips(raw, asOf),
    sessions: buildSessions(raw, coo, asOf),
    shows: buildShows(raw, coo, asOf),
    suppliers: buildSuppliers(asOf),
    proposalsFull: buildProposalsFull(raw, coo, asOf),
    releasesFull: buildReleasesFull(raw, coo, asOf),
    transactions: buildTransactions(raw, asOf),
    tasksFull: buildTasksFull(raw, coo, asOf),
  };
  return {
    capturedAt: asOf,
    todayIL: coo.state.meta.todayIL,
    schemaVersion: EYES_SCHEMA_VERSION,
    cooSchemaVersion: coo.state.meta.schemaVersion,
    domains,
    changeReadiness: buildChangeReadinessMatrix(domains),
    cooSources: coo.state.sources,
  };
}
