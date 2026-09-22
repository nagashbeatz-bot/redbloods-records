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
import { classifyRelationQuality, coverageFromCounts, coverageFromStatus, reliabilityFrom, statusFromSource } from "./coverage";
import type {
  ClientsFact, ClipsFact, LabelArtistsFact, PartnerCompanyState, PartnerDomainState, PartnerEyesRaw, PartnerRelation,
  SessionsFact, ShowsEyesFact,
} from "./types";

const EYES_SCHEMA_VERSION = "partner-eyes-v0.2"; // Phase B.2: agent_alerts removed; sessions/shows are now full-history
const NEW_READER = "lib/partner/eyes/readers.ts:readPartnerEyesRaw";

function sourceOf(raw: PartnerEyesRaw, name: string) {
  return raw.sources.find((s) => s.source === name);
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
    items: raw.clients.map((c) => ({ id: c.id, name: c.name, type: c.type, status: c.status })),
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
  const balanceCounts = raw.artistBalanceCounts ?? {};
  const warnings: string[] = [
    "היחס ל-ID (label_artist_id) קיים רק לתת-קבוצת הפרויקטים שיש להם שורת release פעילה (ראה domain 'releases') — לרוב אמני הלייבל עדיין רק TEXT_MATCH דרך projects.artist.",
  ];
  const data: LabelArtistsFact | null = raw.labelArtists ? {
    total: raw.labelArtists.length,
    byStatus: raw.labelArtists.reduce<Record<string, number>>((acc, a) => { acc[a.status] = (acc[a.status] ?? 0) + 1; return acc; }, {}),
    items: raw.labelArtists.map((a) => ({ id: a.id, name: a.name, status: a.status, balanceEntries: balanceCounts[a.id] ?? 0 })),
    balanceCoverage: {
      artistsWithEntries: raw.labelArtists.filter((a) => (balanceCounts[a.id] ?? 0) > 0).length,
      totalEntries: Object.values(balanceCounts).reduce((s, n) => s + n, 0),
    },
  } : null;
  if (raw.artistBalanceCounts === null) {
    warnings.push("artist_balance_entries לא נקרא (label_artists לא זמין, או שהקריאה נכשלה).");
  } else {
    warnings.push("artist_balance_entries הוא ledger עצמאי ומעודכן ידנית (backfill חד-פעמי + רישומים ידניים, all-time — אין cycle/date filter בקריאה) — לא מסונכרן עם transactions/Finance. אל תניח שהוא עדכני.");
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
  const relations: PartnerRelation[] = [
    {
      toDomain: "external", quality: "ID", via: "shows.dj_client_id",
      coverage: withDj == null || raw.shows == null ? undefined : coverageFromCounts(withDj, raw.shows.length),
      notes: raw.shows ? `${withDj} מתוך ${raw.shows.length} הופעות (כל ההיסטוריה) עם dj_client_id — null אינו הופך ל-relation מומצא` : undefined,
    },
  ];
  const cooUpcoming = coo.state.shows?.upcoming.length ?? null;
  const cooDoneUnpaid = coo.state.shows?.doneUnpaid.length ?? null;
  const warnings: string[] = [
    `lib/coo רואה subset תפעולי בלבד: upcoming=${cooUpcoming ?? "?"}, doneUnpaid=${cooDoneUnpaid ?? "?"}. Partner Eyes כאן קורא היסטוריה מלאה דרך אותו listShows() בדיוק — קריאה שנייה, לא query חדש מבחינת צורה.`,
  ];
  const data: ShowsEyesFact | null = raw.shows ? {
    total: raw.shows.length,
    withDjClientId: withDj ?? 0,
    byStatus: raw.shows.reduce<Record<string, number>>((acc, s) => { acc[s.status] = (acc[s.status] ?? 0) + 1; return acc; }, {}),
    cooVisible: { upcoming: cooUpcoming, doneUnpaid: cooDoneUnpaid, note: "מה ש-lib/coo רואה בפועל (subset תפעולי) — cross-reference בלבד" },
    items: raw.shows.map((s) => ({ id: s.id, name: s.name, status: s.status, paymentStatus: s.paymentStatus, dateYmd: s.date, djClientId: s.djClientId, djConfirmationStatus: s.djConfirmationStatus })),
  } : null;
  return {
    domain: "shows", status, coverage, reliability: reliabilityFrom(coverage, "ID"),
    scopeDescription: "all show history (lib/shows-store.ts:listShows(), called again for Partner — no filter)",
    currentOperationalCount: (cooUpcoming ?? 0) + (cooDoneUnpaid ?? 0), totalHistoricalCount: data?.total ?? null,
    provenance: { source: "supabase:shows (Partner-only full-history read)", reader: NEW_READER, fetchedAt: asOf },
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
  return {
    capturedAt: asOf,
    todayIL: coo.state.meta.todayIL,
    schemaVersion: EYES_SCHEMA_VERSION,
    cooSchemaVersion: coo.state.meta.schemaVersion,
    domains: {
      ...cooDomains,
      clients: buildClients(raw, asOf),
      labelArtists: buildLabelArtists(raw, coo, asOf),
      clips: buildClips(raw, asOf),
      sessions: buildSessions(raw, coo, asOf),
      shows: buildShows(raw, coo, asOf),
      suppliers: buildSuppliers(asOf),
    },
    cooSources: coo.state.sources,
  };
}
