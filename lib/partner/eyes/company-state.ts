/**
 * Assembles the full PartnerCompanyState from an already-computed CooResult
 * (reused, never refetched) and a PartnerEyesRaw read. PURE — no I/O.
 *
 * Mirrors lib/coo/pipeline.ts's own pure/impure split: this file has no
 * "server-only" import and no Supabase; lib/partner/eyes/build.ts is the
 * thin server-only shell that fetches both inputs once and calls this.
 */
import type { CooResult } from "../../coo/pipeline";
import { adaptCooCompanyState } from "./coo-adapter";
import { classifyRelationQuality, coverageFromCounts, coverageFromStatus, reliabilityFrom, statusFromSource } from "./coverage";
import type {
  AgentAlertsFact, ClientsFact, ClipsFact, LabelArtistsFact, PartnerCompanyState, PartnerDomainState, PartnerEyesRaw, PartnerRelation,
} from "./types";

const EYES_SCHEMA_VERSION = "partner-eyes-v0.1"; // bumped: agentAlerts moved off the COO-adapted shape (Phase B.1)
const NEW_READER = "lib/partner/eyes/readers.ts:readPartnerEyesRaw";

function sourceOf(raw: PartnerEyesRaw, name: string) {
  return raw.sources.find((s) => s.source === name);
}

/** Whole days between two ISO timestamps (b - a), floored. Pure: both instants are passed in, never Date.now(). */
function daysBetweenIso(aIso: string, bIso: string): number {
  return Math.floor((new Date(bIso).getTime() - new Date(aIso).getTime()) / 86_400_000);
}
function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
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
    provenance: { source: "supabase:clients", reader: NEW_READER, fetchedAt: asOf },
    relations, warnings: [], data,
  };
}

function buildLabelArtists(raw: PartnerEyesRaw, coo: CooResult, asOf: string): PartnerDomainState<LabelArtistsFact> {
  const status = statusFromSource(sourceOf(raw, "label_artists"));
  const coverage = coverageFromStatus(status);
  const releasesCov = coo.state.coverage.find((c) => c.key === "releases");
  const relations: PartnerRelation[] = [
    { toDomain: "projects", quality: "TEXT_MATCH", via: "projects.artist = label_artists.name", notes: "היחס העיקרי — התאמת שם, לא ID." },
    {
      toDomain: "projects", quality: "ID", via: "project_release_details.label_artist_id",
      coverage: releasesCov ? coverageFromCounts(releasesCov.usable, releasesCov.total) : undefined,
      notes: "אמין כשקיים, אך רק לפרויקטים עם שורת release (ראה domain 'releases'); לא נחשף עדיין ל-Partner בפועל — ראה warnings.",
    },
  ];
  const balanceCounts = raw.artistBalanceCounts ?? {};
  const warnings: string[] = [];
  if (releasesCov) {
    warnings.push(`יחס ה-ID (label_artist_id) קיים לכל היותר ל-${releasesCov.usable ?? "?"} מתוך ${releasesCov.total ?? "?"} פרויקטי לייבל שיש להם שורת release — לרוב הפרויקטים עדיין רק TEXT_MATCH.`);
  }
  warnings.push("תיקון (Phase B.1): lib/coo ReleaseFact לא שומר בפועל label_artist_id (ראה domain 'releases') — יחס ה-ID כאן מתאר את מה שקיים ב-DB/store, לא משהו ש-Partner כבר קורא בפועל.");
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
    warnings.push("artist_balance_entries הוא ledger עצמאי ומעודכן ידנית (backfill חד-פעמי + רישומים ידניים) — לא מסונכרן עם transactions/Finance. אל תניח שהוא עדכני.");
  }
  return {
    domain: "labelArtists", status, coverage, reliability: reliabilityFrom(coverage, "TEXT_MATCH"),
    provenance: { source: "supabase:label_artists + artist_balance_entries", reader: NEW_READER, fetchedAt: asOf },
    relations, warnings, data,
  };
}

/**
 * Phase B.1 correction: quality and coverage are two different questions.
 *   quality  — when project_id IS present, is it a real id? (yes, always — so ID whenever any row has it)
 *   coverage — how many of the fetched rows actually have it? (PARTIAL here: measured 10/12 in production)
 * The earlier version of this function downgraded quality to TEXT_MATCH purely because coverage
 * was partial — that understated a real relation. Fixed: quality=ID stays ID; the exact split lives
 * in relation.coverage + a warning, never folded back into a weaker quality label.
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
    warnings.push(`${withProjectId}/${total} clip productions carry project_id → relation quality ID, coverage ${idCoverage} (לא הורד ל-TEXT_MATCH בגלל כיסוי חלקי — ראה Phase B.1 §2/§6).`);
  }
  const data: ClipsFact | null = raw.clips ? {
    total, withProjectId, withoutProjectId: total - withProjectId,
    items: raw.clips.map((c) => ({ id: c.id, title: c.title, status: c.status, projectId: c.projectId, artistName: c.artistName })),
  } : null;
  return {
    domain: "clips", status, coverage, reliability: reliabilityFrom(coverage, idQuality),
    provenance: { source: "supabase:red_films_productions (production_type=\"קליפ\")", reader: NEW_READER, fetchedAt: asOf },
    relations, warnings, data,
  };
}

/**
 * Agent Alerts — Partner-only, Phase B.1. lib/coo's own read is status="new" only
 * (readCooRaw), then the brief further narrows to allowlisted-type + recent
 * (COO_CONFIG.alerts). This reader sees every status, every type, no age cutoff —
 * but still does NO reasoning: an old/resolved row is a historical fact, not "current".
 */
function buildAgentAlerts(raw: PartnerEyesRaw, coo: CooResult, asOf: string): PartnerDomainState<AgentAlertsFact> {
  const status = statusFromSource(sourceOf(raw, "agent_alerts_eyes"));
  const coverage = coverageFromStatus(status);
  const withRelatedProject = raw.alerts ? raw.alerts.filter((a) => a.relatedProjectId !== null).length : null;
  const relations: PartnerRelation[] = [
    {
      toDomain: "projects", quality: "ID", via: "agent_alerts.related_project_id",
      coverage: raw.alerts ? coverageFromCounts(withRelatedProject, raw.alerts.length) : undefined,
      notes: raw.alerts ? `${withRelatedProject} מתוך ${raw.alerts.length} alerts (כל הסטטוסים) עם related_project_id` : undefined,
    },
  ];
  const brief = coo.state.alerts; // lib/coo's own narrow view (status=new → allowlisted+recent), for cross-reference only
  const cooCov = coo.state.coverage.find((c) => c.key === "alerts");
  const warnings: string[] = [
    `COO (הבריף) רואה subset מכוון בלבד: status="new" בלבד ברמת ה-read, ואז מסונן ל-allowTypes/maxAgeDays. Partner Eyes כאן קורא את כל agent_alerts בלי סינון סטטוס/סוג/גיל — 2 reads שונים ב-DB, לא אותו נתון.`,
  ];
  if (cooCov) warnings.push(`COO מציג בפועל ${cooCov.usable ?? "?"} alerts (מתוך ${cooCov.total ?? "?"} שנקראו בסינון status="new").`);
  warnings.push("Alert ישן/סגור מופיע כאן כרשומה היסטורית בלבד — אין כאן שום קביעה שהוא 'current issue'. אין resolve/delete/mutation.");

  let data: AgentAlertsFact | null = null;
  if (raw.alerts) {
    const ages = raw.alerts.map((a) => daysBetweenIso(a.createdAt, asOf));
    data = {
      total: raw.alerts.length,
      byStatus: raw.alerts.reduce<Record<string, number>>((acc, a) => { acc[a.status] = (acc[a.status] ?? 0) + 1; return acc; }, {}),
      byType: raw.alerts.reduce<Record<string, number>>((acc, a) => { acc[a.type] = (acc[a.type] ?? 0) + 1; return acc; }, {}),
      withEntityKey: raw.alerts.filter((a) => a.hasEntityKey).length,
      withRelatedProject: withRelatedProject ?? 0,
      ageStats: { median: median(ages), oldest: ages.length ? Math.max(...ages) : null },
      cooVisible: { shownByBrief: brief?.shown.length ?? null, note: "מה שה-Dashboard/brief בפועל מציג — subset, לא total" },
      items: raw.alerts.map((a) => ({ ...a, ageDays: daysBetweenIso(a.createdAt, asOf) })),
    };
  }
  return {
    domain: "agentAlerts", status, coverage, reliability: reliabilityFrom(coverage, "ID"),
    provenance: { source: "supabase:agent_alerts (Partner-only broad read)", reader: NEW_READER, fetchedAt: asOf },
    relations, warnings, data,
  };
}

function buildSuppliers(asOf: string): PartnerDomainState<null> {
  return {
    domain: "suppliers", status: "UNAVAILABLE", coverage: "NONE", reliability: "UNKNOWN",
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
      agentAlerts: buildAgentAlerts(raw, coo, asOf),
      suppliers: buildSuppliers(asOf),
    },
    cooSources: coo.state.sources,
  };
}
