/**
 * Redbloods Partner — Company Integrity detectors. Pure, deterministic (now injected), read-only by construction.
 *
 * Each detector turns canonical facts (Partner Eyes state, the Finance Brain raw read, Organizational Memory,
 * a few narrow extra reads) into evidence-backed findings. None of them changes, reconciles or recomputes data:
 *   - label membership: the Owner-defined roster (label_artists) wins; other sources only disagree;
 *   - money is never summed here (Finance Brain owns money; missing currency stays UNKNOWN);
 *   - absence is never turned into a negative fact (no future sessions ≠ empty calendar; no release row ≠ no plan);
 *   - a stale-looking work is never called abandoned;
 *   - text links stay TEXT_MATCH; ambiguity is never resolved by picking.
 */
import { createHash } from "node:crypto";
import type { PartnerCompanyState } from "../eyes/types";
import type { FinanceRaw } from "../finance/types";
import type { PartnerMemory } from "../memory/types";
import { splitArtistNames } from "../dossiers/relations";
import { normalizeName } from "../gateway/resolve";
import { LABEL_ROSTER_DEFINITION, SCHEDULE_DEFINITION, SESSION_STATUS_VOCABULARY, STEVEN_PAYMENT_WRITERS, VICTOR_STALE_DAYS } from "./definitions";
import type { IntegrityFinding, IntegrityFindingType, IntegritySeverity, IntegrityStance, IntegrityEpistemic, IntegritySubject, IntegrityEvidence } from "./types";

export interface IntegrityExtras {
  redFilmsProductions: Array<{ id: string; title: string; status: string | null; productionType: string | null }> | null;
  meetings: Array<{ id: string; date: string | null; status: string | null }> | null;
}

export interface IntegrityInput {
  now: Date;
  todayIL: string;
  state: PartnerCompanyState | null;
  finance: { raw: FinanceRaw } | null;
  memory: PartnerMemory | null;
  extras: IntegrityExtras | null;
  /** PORTAL_ARTISTS names (code registry) — a supporting source only. */
  portalArtistNames: readonly string[];
  /** The app's canonical DJ CLEANTONE client link (code constant) — lets the roster be compared to clients honestly. */
  cleantoneClientId: string | null;
}

/** A detector's draft; questions are attached by the register. */
export interface FindingDraft extends Omit<IntegrityFinding, "observedAt" | "freshness" | "questionId" | "ownerDecision"> {
  question?: {
    type: "INTEGRITY_LABEL_PROJECT_CLASSIFICATION" | "INTEGRITY_CLIENT_IDENTITY";
    subjectType: string;
    subjectId: string;
    subjectLabel: string | null;
    facts: unknown;
    textHe: string;
    whyHe: string;
    /** Owner-readable evidence (names + statuses; never ids / tables / hashes). */
    evidenceHe: string[];
    /**
     * Question minimization: does the ambiguity affect a CURRENT business conclusion (e.g. active work)?
     * When false, the finding stays visible but the Owner is not asked.
     */
    affectsCurrentConclusion: boolean;
    priority: number;
  };
}

export const fingerprintOf = (facts: unknown) => createHash("sha256").update(JSON.stringify(facts)).digest("hex");

const f = (type: IntegrityFindingType, subject: IntegritySubject, o: {
  severity: IntegritySeverity; epistemic: IntegrityEpistemic; stance: IntegrityStance; evidence: IntegrityEvidence[];
  canonical: string[]; conflicting: string[]; owner?: boolean; he: string;
}): FindingDraft => ({
  id: `${type}:${subject.key}`, type, subject, severity: o.severity, epistemic: o.epistemic, stance: o.stance, evidence: o.evidence,
  canonicalSources: o.canonical, conflictingSources: o.conflicting, ownerInputRequired: !!o.owner, interpretationHe: o.he,
});

const LABEL_STATUS = "אמן לייבל";
const daysBetween = (fromIso: string | null | undefined, today: string): number | null => {
  if (!fromIso) return null;
  const t = Date.parse(fromIso.length === 10 ? `${fromIso}T00:00:00Z` : fromIso);
  return Number.isFinite(t) ? Math.floor((Date.parse(`${today}T00:00:00Z`) - t) / 86_400_000) : null;
};

// ── 1 + 2. label membership and label project classification ────────────────

export function detectLabelMembership(input: IntegrityInput): FindingDraft[] {
  const s = input.state;
  const roster = s?.domains.labelArtists.data?.items ?? null;
  if (!s || !roster) return [f("LABEL_MEMBERSHIP_SOURCE_DISAGREEMENT", { type: "company", key: "label-roster", label: "רוסטר הלייבל" }, {
    severity: "MEDIUM", epistemic: "UNKNOWN", stance: "UNKNOWN", evidence: [], canonical: ["label_artists"], conflicting: [],
    he: "טבלת אמני הלייבל לא נקראה — חברות בלייבל לא ידועה כרגע (לא מוסקת ממקורות אחרים).",
  })];
  const rosterNames = new Set(roster.map((a) => a.name));
  const defined = new Set<string>(LABEL_ROSTER_DEFINITION.rosterNames);
  const clients = s.domains.clients.data?.items ?? [];
  const clientLabel = new Set(clients.filter((c) => c.status === LABEL_STATUS).map((c) => c.name));
  const cleantoneLinked = !!input.cleantoneClientId && clients.some((c) => c.id === input.cleantoneClientId);
  const idx = s.domains.projects.data?.index ?? {};
  const labelTypedArtists = new Set(Object.values(idx).filter((p) => p.businessType === "לייבל").flatMap((p) => splitArtistNames(p.artistText)));
  const diffs: IntegrityEvidence[] = [];
  const missingFromTable = [...defined].filter((n) => !rosterNames.has(n));
  const extraInTable = [...rosterNames].filter((n) => !defined.has(n));
  if (missingFromTable.length || extraInTable.length) diffs.push({ source: "label_artists vs Owner roster definition", fact: "roster table differs from the Owner-defined roster", value: { missingFromTable, extraInTable } });
  const rosterNotClientLabel = [...rosterNames].filter((n) => !clientLabel.has(n) && !(n === LABEL_ROSTER_DEFINITION.rosterNames[2] && cleantoneLinked));
  const clientLabelNotRoster = [...clientLabel].filter((n) => !rosterNames.has(n));
  if (rosterNotClientLabel.length || clientLabelNotRoster.length) diffs.push({ source: "clients.status = אמן לייבל", fact: "client label status differs from the roster", value: { rosterArtistsWithoutLabelClientStatus: rosterNotClientLabel, labelStatusClientsNotInRoster: clientLabelNotRoster } });
  const portal = new Set(input.portalArtistNames);
  const rosterNotPortal = [...rosterNames].filter((n) => !portal.has(n));
  const portalNotRoster = [...portal].filter((n) => !rosterNames.has(n));
  if (rosterNotPortal.length || portalNotRoster.length) diffs.push({ source: "PORTAL_ARTISTS (code)", fact: "portal registry differs from the roster", value: { rosterArtistsWithoutPortal: rosterNotPortal, portalArtistsNotInRoster: portalNotRoster } });
  const labelTypedNotRoster = [...labelTypedArtists].filter((n) => !rosterNames.has(n));
  const rosterWithLabelTypedProject = [...rosterNames].filter((n) => labelTypedArtists.has(n));
  if (labelTypedNotRoster.length || rosterWithLabelTypedProject.length < rosterNames.size) {
    diffs.push({ source: "projects.project_business_type = לייבל", fact: "label-typed projects do not cover the roster", value: { labelTypedProjectArtistsNotInRoster: labelTypedNotRoster, rosterArtistsWithALabelTypedProject: rosterWithLabelTypedProject, labelTypedProjects: Object.values(idx).filter((p) => p.businessType === "לייבל").length } });
  }
  if (!diffs.length) return [];
  const tableDrift = missingFromTable.length > 0 || extraInTable.length > 0;
  return [f("LABEL_MEMBERSHIP_SOURCE_DISAGREEMENT", { type: "company", key: "label-roster", label: "רוסטר הלייבל" }, {
    severity: tableDrift ? "HIGH" : "LOW", epistemic: "DERIVED", stance: tableDrift ? "CONFLICT" : "OWNER_DECIDED",
    evidence: [{ source: "label_artists", fact: "canonical roster", value: [...rosterNames].sort() }, ...diffs],
    canonical: ["label_artists (Owner definition LABEL_ROSTER)"], conflicting: diffs.map((d) => d.source),
    he: tableDrift
      ? "טבלת אמני הלייבל לא תואמת את הרוסטר שהבעלים הגדיר — צריך בדיקה (שום נתון לא שונה)."
      : `הרוסטר הקנוני הוא ${[...rosterNames].join(", ")} (הגדרת הבעלים). מקורות תומכים אחרים לא תואמים אותו — הם מוצגים כממצא, לא כאמת מתחרה.`,
  })];
}

export function detectLabelProjectClassification(input: IntegrityInput): FindingDraft[] {
  const s = input.state;
  const roster = s?.domains.labelArtists.data?.items;
  if (!s || !roster) return [];
  const idx = s.domains.projects.data?.index ?? {};
  const releaseArtist = new Map((s.domains.releasesFull.data?.items ?? []).map((r) => [r.projectId, r.labelArtistId]));
  const out: FindingDraft[] = [];
  for (const a of [...roster].sort((x, y) => x.name.localeCompare(y.name))) {
    const projects = Object.entries(idx)
      .filter(([pid, p]) => p.businessType !== "לייבל" && (splitArtistNames(p.artistText).includes(a.name) || releaseArtist.get(pid) === a.id))
      .map(([pid, p]) => ({ projectId: pid, name: p.name, status: p.status, businessType: p.businessType, collab: splitArtistNames(p.artistText).length > 1, link: releaseArtist.get(pid) === a.id ? "ID" : "TEXT_MATCH" }))
      .sort((x, y) => x.projectId.localeCompare(y.projectId));
    if (!projects.length) continue;
    const active = projects.filter((p) => !["הושלם", "בוטל"].includes(p.status)).length;
    const facts = { labelArtistId: a.id, projects: projects.map((p) => [p.projectId, p.businessType]) };
    out.push({
      ...f("LABEL_PROJECT_CLASSIFICATION_MISMATCH", { type: "label-artist", key: `label-artist:${a.id}`, label: a.name }, {
        severity: active > 0 ? "MEDIUM" : "LOW", epistemic: "DERIVED", stance: "CONFLICT",
        evidence: [
          { source: "label_artists", fact: "canonical roster artist", value: a.name },
          { source: "projects.artist (TEXT_MATCH) / project_release_details.label_artist_id (ID)", fact: "projects connected to this artist", value: projects.slice(0, 12) },
          { source: "projects.project_business_type", fact: "their business type", value: [...new Set(projects.map((p) => p.businessType))] },
        ],
        canonical: ["label_artists", "projects.project_business_type (as stored)"], conflicting: ["projects.project_business_type"], owner: true,
        he: `${projects.length} פרויקטים של ${a.name} (אמן לייבל) מסומנים "${[...new Set(projects.map((p) => p.businessType))].join("/")}". זו אי-התאמה בנתונים — לא שונה דבר, ולא הוחלט שהם לא תקינים.`,
      }),
      question: {
        type: "INTEGRITY_LABEL_PROJECT_CLASSIFICATION", subjectType: "label-artist", subjectId: a.id, subjectLabel: a.name, facts,
        textHe: `יש לי ${projects.length} פרויקטים של ${a.name} שמסומנים כ'לקוח', אבל ${a.name} נמצא ברשימת אמני הלייבל. איך להתייחס לפרויקטים האלה?`,
        whyHe: `התשובה קובעת איך אני מבין את העבודה עם ${a.name}. היא לא משנה שום פרויקט — הסימון במערכת נשאר כמו שהוא.`,
        evidenceHe: [
          ...projects.slice(0, 8).map((p) => `${p.name} — ${p.status}${p.collab ? " (שיתוף עם אמן נוסף)" : ""}`),
          ...(projects.length > 8 ? [`ועוד ${projects.length - 8}`] : []),
        ],
        affectsCurrentConclusion: active > 0,
        priority: 100 + active * 10 + projects.length,
      },
    });
  }
  return out;
}

// ── 3. project ↔ client text links ───────────────────────────────────────────

export function detectProjectClientMatch(input: IntegrityInput): FindingDraft[] {
  const s = input.state;
  const clients = s?.domains.clients.data?.items;
  if (!s || !clients) return [];
  const idx = s.domains.projects.data?.index ?? {};
  const byExact = new Map<string, typeof clients>();
  const byNorm = new Map<string, typeof clients>();
  for (const c of clients) {
    byExact.set(c.name, [...(byExact.get(c.name) ?? []), c]);
    const n = normalizeName(c.name);
    byNorm.set(n, [...(byNorm.get(n) ?? []), c]);
  }
  const counts = { EXACT: 0, NORMALIZED_ONLY: 0, AMBIGUOUS: 0, NO_MATCH: 0, EMPTY: 0 };
  const noMatch: Array<{ projectId: string; name: string; token: string }> = [];
  const ambiguousNames = new Map<string, Array<{ projectId: string; name: string; status: string }>>();
  for (const [pid, p] of Object.entries(idx).sort(([x], [y]) => x.localeCompare(y))) {
    const tokens = splitArtistNames(p.artistText);
    if (!tokens.length) { counts.EMPTY++; continue; }
    let cls: keyof typeof counts = "EXACT";
    for (const t of tokens) {
      const exact = byExact.get(t) ?? [];
      const norm = byNorm.get(normalizeName(t)) ?? [];
      // An exact hit does not settle it while another record shares the normalized name — never a silent pick.
      if (exact.length > 1 || norm.length > 1) { cls = "AMBIGUOUS"; ambiguousNames.set(normalizeName(t), [...(ambiguousNames.get(normalizeName(t)) ?? []), { projectId: pid, name: p.name, status: p.status }]); }
      else if (!exact.length && norm.length === 1 && cls === "EXACT") cls = "NORMALIZED_ONLY";
      else if (!exact.length && !norm.length) { if (cls !== "AMBIGUOUS") cls = "NO_MATCH"; noMatch.push({ projectId: pid, name: p.name, token: t }); }
    }
    counts[cls]++;
  }
  const out: FindingDraft[] = [f("PROJECT_CLIENT_MATCH_INTEGRITY", { type: "company", key: "project-client-links", label: "קישורי פרויקט ↔ לקוח" }, {
    severity: counts.AMBIGUOUS || counts.NO_MATCH ? "MEDIUM" : "LOW", epistemic: "DERIVED", stance: "KNOWN",
    evidence: [{ source: "projects.artist (free text) ↔ clients.name", fact: "link classes per project (TEXT_MATCH only — no client_id exists)", value: counts }],
    canonical: ["clients", "projects.artist (text)"], conflicting: [],
    he: `פרויקטים מקושרים ללקוחות רק לפי שם (אין מזהה לקוח בפרויקט): ${counts.EXACT} תואמים בדיוק, ${counts.NORMALIZED_ONLY} רק אחרי נרמול, ${counts.AMBIGUOUS} עמומים, ${counts.NO_MATCH} בלי התאמה.`,
  })];
  if (noMatch.length) out.push(f("PROJECT_CLIENT_MATCH_INTEGRITY", { type: "company", key: "project-client-no-match", label: "פרויקטים בלי לקוח תואם" }, {
    severity: "LOW", epistemic: "UNKNOWN", stance: "UNKNOWN",
    evidence: [{ source: "projects.artist ↔ clients.name", fact: "artist names with no client record", value: noMatch.slice(0, 10) }, { source: "count", fact: "total", value: noMatch.length }],
    canonical: ["clients"], conflicting: [],
    he: `${noMatch.length} שמות אמן בפרויקטים לא נמצאו בלקוחות — הלקוח של הפרויקטים האלה לא ידוע (לא מנוחש).`,
  }));
  for (const [norm, projects] of [...ambiguousNames.entries()].sort(([x], [y]) => x.localeCompare(y))) {
    const recs = (byNorm.get(norm) ?? []).map((c) => ({ clientId: c.id, name: c.name, type: c.type, status: c.status })).sort((x, y) => x.clientId.localeCompare(y.clientId));
    out.push({
      ...f("PROJECT_CLIENT_MATCH_INTEGRITY", { type: "client-name", key: `client-name:${norm}`, label: recs[0]?.name ?? norm }, {
        severity: "MEDIUM", epistemic: "DERIVED", stance: "CONFLICT",
        evidence: [{ source: "clients", fact: "client records sharing this name", value: recs }, { source: "projects.artist", fact: "projects naming it", value: projects.slice(0, 10) }],
        canonical: ["clients"], conflicting: ["projects.artist (text)"], owner: true,
        he: `${recs.length} רשומות לקוח עם השם "${recs[0]?.name ?? norm}" — הפרויקטים שמזכירים אותו נשארים עמומים (לא נבחרה רשומה).`,
      }),
      question: {
        type: "INTEGRITY_CLIENT_IDENTITY", subjectType: "client-name", subjectId: norm, subjectLabel: recs[0]?.name ?? norm, facts: { norm, clients: recs.map((r) => r.clientId) },
        textHe: `יש ${recs.length} רשומות לקוח בשם "${recs[0]?.name ?? norm}" — זה אותו אדם?`,
        whyHe: "בלי זה אני לא יכול לשייך את הפרויקטים של השם הזה ללקוח אחד. שום רשומה לא תשתנה.",
        evidenceHe: [
          `${recs.length} כרטיסי לקוח עם השם הזה`,
          ...projects.slice(0, 6).map((p) => `${p.name} — ${p.status}`),
          ...(projects.length > 6 ? [`ועוד ${projects.length - 6}`] : []),
        ],
        affectsCurrentConclusion: projects.some((p) => !["הושלם", "בוטל"].includes(p.status)),
        priority: 50 + projects.length,
      },
    });
  }
  return out;
}

// ── 4. session status vocabulary ─────────────────────────────────────────────

export function detectSessionStatusVocabulary(input: IntegrityInput): FindingDraft[] {
  const byStatus = input.state?.domains.sessions.data?.byStatus;
  if (!byStatus) return [];
  const actual = Object.keys(byStatus).sort();
  const expected = [...new Set(SESSION_STATUS_VOCABULARY.legacyReaders.flatMap((r) => r.expects as readonly string[]))];
  const neverMatched = expected.filter((st) => !byStatus[st]);
  if (!neverMatched.length) return [];
  return [f("SESSION_STATUS_VOCABULARY_CONFLICT", { type: "domain", key: "sessions.status", label: "סטטוסים של סשנים" }, {
    severity: "MEDIUM", epistemic: "DERIVED", stance: "CONFLICT",
    evidence: [
      { source: "sessions (live)", fact: "statuses actually stored", value: byStatus },
      { source: "session writers (code)", fact: "statuses written", value: SESSION_STATUS_VOCABULARY.writers.statuses },
      { source: "legacy readers (code)", fact: "statuses they look for", value: SESSION_STATUS_VOCABULARY.legacyReaders },
    ],
    canonical: ["sessions.status as written by the sessions API"], conflicting: SESSION_STATUS_VOCABULARY.legacyReaders.map((r) => r.file),
    he: `הסשנים נשמרים בסטטוסים ${actual.join(" / ")}, אבל ה־Agent והדוחות מחפשים ${neverMatched.join(" / ")} — הספירות שלהם לסשנים כנראה תמיד אפס. שום שורה לא נורמלה.`,
  })];
}

// ── 5. future schedule coverage ──────────────────────────────────────────────

export function detectFutureScheduleGap(input: IntegrityInput): FindingDraft[] {
  const sessions = input.state?.domains.sessions.data?.items ?? null;
  const future = sessions ? sessions.filter((x) => x.dateYmd >= input.todayIL && x.status !== "בוטל").length : null;
  if (SCHEDULE_DEFINITION.googleCalendarReadApproved && future !== null && future > 0) return [];
  return [f("FUTURE_SCHEDULE_COVERAGE_GAP", { type: "domain", key: "future-schedule", label: "יומן עתידי" }, {
    severity: "MEDIUM", epistemic: "UNKNOWN", stance: "UNKNOWN",
    evidence: [
      { source: "sessions (live)", fact: "future sessions recorded (not cancelled)", value: future },
      { source: "Owner definition FUTURE_SCHEDULE_TRUTH", fact: "future schedule truth", value: "Google Calendar" },
      { source: "Partner", fact: "Google Calendar read", value: SCHEDULE_DEFINITION.googleCalendarReadApproved ? "approved" : "not approved yet — not read" },
    ],
    canonical: ["Google Calendar (not read by Partner yet)"], conflicting: [],
    he: future === 0
      ? "אין סשנים עתידיים רשומים כרגע בטבלת הסשנים. זה לא אומר שהיומן ריק — Google Calendar הוא מקור האמת ו־Partner עוד לא קורא אותו. היומן העתידי: לא ידוע."
      : `רשומים ${future ?? "?"} סשנים עתידיים בטבלה, אבל Google Calendar (מקור האמת ליומן) עוד לא נקרא — התמונה העתידית חלקית.`,
  })];
}

// ── 6. release plan coverage ─────────────────────────────────────────────────

export function detectReleasePlanGap(input: IntegrityInput): FindingDraft[] {
  const s = input.state;
  const roster = s?.domains.labelArtists.data?.items;
  const releases = s?.domains.releasesFull.data?.items;
  if (!s || !roster) return [];
  const out: FindingDraft[] = [];
  for (const a of [...roster].filter((x) => x.status === "פעיל").sort((x, y) => x.name.localeCompare(y.name))) {
    if (!releases) {
      out.push(f("RELEASE_PLAN_COVERAGE_GAP", { type: "label-artist", key: `label-artist:${a.id}`, label: a.name }, {
        severity: "MEDIUM", epistemic: "UNKNOWN", stance: "UNKNOWN", evidence: [], canonical: ["project_release_details"], conflicting: [],
        he: `נתוני הריליסים לא נקראו — תוכנית הריליסים של ${a.name} לא ידועה.`,
      }));
      continue;
    }
    const mine = releases.filter((r) => r.labelArtistId === a.id);
    const upcoming = mine.filter((r) => r.stage !== "יצא");
    if (upcoming.length && upcoming.every((r) => r.targetYmd)) continue;
    out.push(f("RELEASE_PLAN_COVERAGE_GAP", { type: "label-artist", key: `label-artist:${a.id}`, label: a.name }, {
      severity: upcoming.length ? "LOW" : "MEDIUM", epistemic: "UNKNOWN", stance: "UNKNOWN",
      evidence: [{ source: "project_release_details (ID label_artist_id)", fact: "release rows for this artist", value: mine.map((r) => ({ projectId: r.projectId, stage: r.stage, targetDate: r.targetYmd })) }],
      canonical: ["project_release_details"], conflicting: [],
      he: upcoming.length
        ? `ל־${a.name} יש ריליס רשום בלי תאריך יעד — תוכנית הריליסים חלקית.`
        : `אין ל־${a.name} נתוני ריליס מובנים. זה לא אומר שלא מתוכנן ריליס — תוכנית הריליסים לא ידועה.`,
    }));
  }
  return out;
}

// ── 7. Victor work + salary sources ──────────────────────────────────────────

export function detectVictorIntegrity(input: IntegrityInput): FindingDraft[] {
  const out: FindingDraft[] = [];
  const v = input.state?.domains.victor.data;
  if (v) {
    const stale = v.active
      .map((w) => {
        const last = [w.lastUploadAt, w.lastNotesSentAt, w.updatedAt, w.sentDate, w.createdAt].filter((x): x is string => !!x).sort().pop() ?? null;
        return { workId: w.id, title: w.title, projectId: w.projectId, workState: w.workState, lastActivity: last, daysSince: daysBetween(last, input.todayIL) };
      })
      .filter((w) => w.daysSince === null || w.daysSince > VICTOR_STALE_DAYS)
      .sort((x, y) => (y.daysSince ?? 1e9) - (x.daysSince ?? 1e9) || x.workId.localeCompare(y.workId));
    if (stale.length) out.push(f("VICTOR_WORK_INTEGRITY", { type: "vendor", key: "vendor:VICTOR:stale-active", label: "Victor — עבודות פעילות ללא פעילות" }, {
      severity: stale.length > 5 ? "MEDIUM" : "LOW", epistemic: "DERIVED", stance: "DERIVED",
      evidence: [{ source: "vendor_project_work (status פעיל)", fact: `active works with no recorded activity for > ${VICTOR_STALE_DAYS} days`, value: stale.slice(0, 10) }, { source: "count", fact: "total / active", value: { stale: stale.length, active: v.active.length } }],
      canonical: ["vendor_project_work"], conflicting: [],
      he: `${stale.length} מתוך ${v.active.length} העבודות ה"פעילות" של Victor בלי פעילות מתועדת מעל ${VICTOR_STALE_DAYS} יום. זה לא אומר שהן נזנחו — הסטטוס האמיתי שלהן לא ידוע.`,
    }));
  }
  const raw = input.finance?.raw;
  const legacy = raw?.victorLegacyPayments ?? [];
  const conflicts = (input.memory?.entities ?? []).flatMap((m) => m.conflicts.filter((c) => c.code === "PAYMENT_STATUS_SOURCES_DISAGREE" && m.entity.key.startsWith("recurring:VICTOR_SALARY:")).map((c) => ({ period: m.entity.period ?? m.entity.key.split(":").pop(), values: c.values.map((x) => `${x.source}=${x.value}`) })));
  if (legacy.length || conflicts.length) out.push(f("VICTOR_WORK_INTEGRITY", { type: "vendor", key: "vendor:VICTOR:salary-sources", label: "Victor — מקורות סטטוס משכורת" }, {
    severity: conflicts.length ? "MEDIUM" : "LOW", epistemic: "DERIVED", stance: conflicts.length ? "CONFLICT" : "KNOWN",
    evidence: [
      { source: "settings vendor_victor_payment_* (legacy)", fact: "legacy per-month records still stored (ignored by the salary page)", value: legacy.map((l) => l.month) },
      { source: "Organizational Memory", fact: "periods where the sources disagree", value: conflicts },
    ],
    canonical: ["Finance Brain salary view (status override > transaction > due date)", "Owner Context"], conflicting: ["settings vendor_victor_payment_* (legacy)"],
    he: conflicts.length
      ? `ב־${conflicts.length} חודשים מקורות סטטוס המשכורת של Victor לא מסכימים (${conflicts.map((c) => c.period).join(", ")}). הפרשנות נשארת של Finance Brain ותשובות הבעלים; שום נתון לא שונה.`
      : "המאגר הישן של תשלומי Victor עדיין שמור אך לא משפיע על דף המשכורת — מידע בלבד.",
  }));
  return out;
}

// ── 8. Steven payment writers ────────────────────────────────────────────────

export function detectStevenPaymentSources(input: IntegrityInput): FindingDraft[] {
  const raw = input.finance?.raw;
  if (!raw) return [];
  const tx = new Map(raw.transactions.map((t) => [t.id, t]));
  const shapes = { PAYMENT_EXPENSE_SHAPE: 0, LEGACY_SYNC_SHAPE: 0, UNCLASSIFIED: 0, NO_LINK: 0, LINK_MISSING_TX: 0 };
  for (const w of raw.engineerWorks) {
    if (!w.linkedTransactionId) { shapes.NO_LINK++; continue; }
    const t = tx.get(w.linkedTransactionId);
    if (!t) { shapes.LINK_MISSING_TX++; continue; }
    if (t.currency && w.currency && t.currency !== w.currency && t.status === "שולם") shapes.PAYMENT_EXPENSE_SHAPE++;
    else if (t.currency && w.currency && t.currency === w.currency) shapes.LEGACY_SYNC_SHAPE++;
    else shapes.UNCLASSIFIED++;
  }
  const both = shapes.PAYMENT_EXPENSE_SHAPE > 0 && shapes.LEGACY_SYNC_SHAPE > 0;
  return [f("STEVEN_PAYMENT_SOURCE_CONFLICT", { type: "vendor", key: "vendor:STEVEN:payment-writers", label: "Steven — מקורות תשלום" }, {
    severity: both || shapes.LINK_MISSING_TX ? "MEDIUM" : "LOW", epistemic: "DERIVED", stance: both ? "CONFLICT" : "KNOWN",
    evidence: [
      { source: "code", fact: "two writers of sound_engineer_work.linked_transaction_id", value: STEVEN_PAYMENT_WRITERS.map((w) => ({ name: w.name, shape: w.shape })) },
      { source: "sound_engineer_work × transactions (live)", fact: "linked-transaction shapes", value: shapes },
    ],
    canonical: ["transactions (Finance Brain)"], conflicting: STEVEN_PAYMENT_WRITERS.map((w) => w.name),
    he: both
      ? `בנתונים יש סימנים לשני מסלולי סנכרון תשלום של מהנדסי סאונד (${shapes.PAYMENT_EXPENSE_SHAPE} בהמרה קבועה ל־₪, ${shapes.LEGACY_SYNC_SHAPE} במטבע העבודה). שום תנועה לא נוצרה או שונתה.`
      : "בקוד יש שני מסלולים שכותבים את קישור התשלום של עבודות מהנדסי סאונד; בנתונים הנוכחיים רואים רק צורה אחת. מידע בלבד — שום תנועה לא נוצרה.",
  })];
}

// ── 9. label economics sources ───────────────────────────────────────────────

export function detectLabelEconomics(input: IntegrityInput): FindingDraft[] {
  const s = input.state;
  const roster = s?.domains.labelArtists.data?.items;
  if (!s || !roster) return [];
  const media = input.finance?.raw.mediaIncome ?? null;
  const clips = s.domains.clips.data?.items ?? [];
  const clients = s.domains.clients.data?.items ?? [];
  const shows = s.domains.shows.data?.items ?? [];
  const out: FindingDraft[] = [];
  for (const a of [...roster].sort((x, y) => x.name.localeCompare(y.name))) {
    const clientIds = new Set(clients.filter((c) => normalizeName(c.name) === normalizeName(a.name) || (input.cleantoneClientId && a.name === LABEL_ROSTER_DEFINITION.rosterNames[2] && c.id === input.cleantoneClientId)).map((c) => c.id));
    const sources = {
      ledger: { entries: a.balanceEntries, currency: a.balanceEntries ? "NONE (no currency column)" : null },
      mediaIncome: media ? { rows: media.filter((m) => m.labelArtistId === a.id).length, currency: "NONE (no currency column)" } : "NOT_READ",
      clips: { productions: clips.filter((c) => splitArtistNames(c.artistName).includes(a.name)).length, link: "TEXT_MATCH (artist_name)", budgets: "NOT_READ" },
      shows: { count: shows.filter((x) => (x.artistClientId && clientIds.has(x.artistClientId)) || (x.djClientId && clientIds.has(x.djClientId))).length, link: "TEXT_MATCH via same-name client / app DJ link" },
      recoup: "COMPUTED VIEW — not read by Partner",
    };
    const moneySources = [a.balanceEntries > 0, typeof sources.mediaIncome === "object" && sources.mediaIncome.rows > 0, sources.clips.productions > 0, sources.shows.count > 0].filter(Boolean).length;
    if (moneySources === 0) continue;
    const present = [
      a.balanceEntries > 0 ? "יומן יתרה בלי מטבע" : null,
      typeof sources.mediaIncome === "object" && sources.mediaIncome.rows > 0 ? "הכנסות מדיה בלי מטבע" : null,
      sources.clips.productions > 0 ? "קליפים לפי שם" : null,
      sources.shows.count > 0 ? "הופעות לפי שם" : null,
    ].filter(Boolean).join(", ");
    out.push(f("LABEL_ECONOMICS_SOURCE_DIVERGENCE", { type: "label-artist", key: `label-artist:${a.id}`, label: a.name }, {
      severity: a.balanceEntries > 0 && moneySources > 1 ? "MEDIUM" : "LOW", epistemic: "UNKNOWN", stance: "UNKNOWN",
      evidence: [{ source: "label economics sources", fact: "which sources exist for this artist (no amounts combined)", value: sources }],
      canonical: ["Finance Brain (transactions)"], conflicting: ["artist_balance_entries (no currency)", "label_media_income (no currency)", "computed recoup (clips + shows + media)"],
      he: `נתוני הכלכלה של ${a.name} נמצאים במקורות נפרדים (${present}; ה־recoup מחושב ולא נקרא). Partner לא מחשב יתרה מאוחדת — היתרה האמיתית לא ידועה.`,
    }));
  }
  return out;
}

// ── 10. bounded general data quality ─────────────────────────────────────────

const KNOWN_PRODUCTION_TYPE = /^[֐-׿A-Za-z0-9 ._/-]{1,40}$/;

export function detectDataQuality(input: IntegrityInput): FindingDraft[] {
  const out: FindingDraft[] = [];
  const prods = input.extras?.redFilmsProductions;
  if (prods) {
    const garbled = prods.filter((p) => !p.productionType || p.productionType.includes("�") || !KNOWN_PRODUCTION_TYPE.test(p.productionType)).sort((x, y) => x.id.localeCompare(y.id));
    if (garbled.length) out.push(f("GENERAL_DATA_QUALITY", { type: "domain", key: "red_films_productions.production_type", label: "Red Films — סוג הפקה" }, {
      severity: "LOW", epistemic: "FACT", stance: "KNOWN",
      evidence: [{ source: "red_films_productions", fact: "unreadable / missing production type", value: garbled.slice(0, 5).map((p) => ({ id: p.id, title: p.title, status: p.status })) }, { source: "count", fact: "total", value: garbled.length }],
      canonical: ["red_films_productions"], conflicting: [],
      he: `${garbled.length} הפקות Red Films עם סוג הפקה לא קריא — הן לא נספרות כקליפים. שום נתון לא שונה.`,
    }));
  }
  const meetings = input.extras?.meetings;
  if (meetings) {
    const stale = meetings.filter((m) => m.status === "נקבעה" && !!m.date && m.date < input.todayIL).sort((x, y) => (x.date ?? "").localeCompare(y.date ?? ""));
    if (stale.length) out.push(f("GENERAL_DATA_QUALITY", { type: "domain", key: "meetings.status", label: "פגישות שעברו ועדיין 'נקבעה'" }, {
      severity: "LOW", epistemic: "FACT", stance: "KNOWN",
      evidence: [{ source: "meetings", fact: "past meetings still marked נקבעה", value: stale.slice(0, 5) }, { source: "count", fact: "total", value: stale.length }],
      canonical: ["meetings"], conflicting: [],
      he: `${stale.length} פגישות שהתאריך שלהן עבר עדיין מסומנות "נקבעה" — לא ידוע אם התקיימו.`,
    }));
  }
  return out;
}

export const DETECTORS = [
  detectLabelMembership, detectLabelProjectClassification, detectProjectClientMatch, detectSessionStatusVocabulary,
  detectFutureScheduleGap, detectReleasePlanGap, detectVictorIntegrity, detectStevenPaymentSources, detectLabelEconomics, detectDataQuality,
] as const;
