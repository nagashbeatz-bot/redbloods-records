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
import { classifyRelationQuality, coverageFromStatus, reliabilityFrom, statusFromSource } from "./coverage";
import type {
  ClientsFact, ClipsFact, LabelArtistsFact, PartnerCompanyState, PartnerDomainState, PartnerEyesRaw, PartnerRelation,
} from "./types";

const EYES_SCHEMA_VERSION = "partner-eyes-v0";
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
    provenance: { source: "supabase:clients", reader: NEW_READER, fetchedAt: asOf },
    relations, warnings: [], data,
  };
}

function buildLabelArtists(raw: PartnerEyesRaw, coo: CooResult, asOf: string): PartnerDomainState<LabelArtistsFact> {
  const status = statusFromSource(sourceOf(raw, "label_artists"));
  const coverage = coverageFromStatus(status);
  const relations: PartnerRelation[] = [
    { toDomain: "projects", quality: "TEXT_MATCH", via: "projects.artist = label_artists.name", notes: "היחס העיקרי — התאמת שם, לא ID." },
    { toDomain: "projects", quality: "ID", via: "project_release_details.label_artist_id", notes: "אמין כשקיים, אך רק לפרויקטים עם שורת release (ראה domain 'releases')." },
  ];
  const balanceCounts = raw.artistBalanceCounts ?? {};
  const releasesCov = coo.state.coverage.find((c) => c.key === "releases");
  const warnings: string[] = [];
  if (releasesCov) {
    warnings.push(`יחס ה-ID (label_artist_id) קיים לכל היותר ל-${releasesCov.usable ?? "?"} מתוך ${releasesCov.total ?? "?"} פרויקטי לייבל שיש להם שורת release — לרוב הפרויקטים עדיין רק TEXT_MATCH.`);
  }
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

function buildClips(raw: PartnerEyesRaw, asOf: string): PartnerDomainState<ClipsFact> {
  const status = statusFromSource(sourceOf(raw, "clip_productions"));
  const coverage = coverageFromStatus(status);
  const total = raw.clips?.length ?? 0;
  const withProjectId = raw.clips?.filter((c) => c.projectId !== null).length ?? 0;
  const idQuality = raw.clips ? classifyRelationQuality(withProjectId, total) : "UNKNOWN";
  const relations: PartnerRelation[] = [
    { toDomain: "projects", quality: idQuality, via: "red_films_productions.project_id", notes: raw.clips ? `${withProjectId} מתוך ${total} שורות נושאות project_id — נבדק בפועל, לא הונח.` : undefined },
    { toDomain: "clients", quality: "TEXT_MATCH", via: "red_films_productions.artist_name = clients.name / label_artists.name" },
  ];
  const warnings: string[] = [];
  if (raw.clips && withProjectId > 0 && withProjectId < total) {
    warnings.push(`כיסוי ID חלקי: ${withProjectId}/${total} — סווג כ-TEXT_MATCH באופן שמרני (לא כל השורות מקושרות ב-id).`);
  }
  const data: ClipsFact | null = raw.clips ? {
    total, withProjectId, withoutProjectId: total - withProjectId,
    items: raw.clips.map((c) => ({ id: c.id, title: c.title, status: c.status, projectId: c.projectId, artistName: c.artistName })),
  } : null;
  return {
    domain: "clips", status, coverage, reliability: reliabilityFrom(coverage, idQuality === "ID" ? "ID" : "TEXT_MATCH"),
    provenance: { source: "supabase:red_films_productions (production_type=\"קליפ\")", reader: NEW_READER, fetchedAt: asOf },
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
      suppliers: buildSuppliers(asOf),
    },
    cooSources: coo.state.sources,
  };
}
