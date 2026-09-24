/**
 * Shared test fixture — production-shaped company for the Company Integrity tests (anonymous; test-only; no I/O).
 * Built by the REAL computeCoo() + assemblePartnerCompanyState(). Roster = the 4 Owner-named label artists.
 */
import { computeCoo } from "../../lib/coo/pipeline";
import type { CooRawInput } from "../../lib/coo/types";
import { assemblePartnerCompanyState } from "../../lib/partner/eyes/company-state";
import type { PartnerEyesRaw, PartnerCompanyState } from "../../lib/partner/eyes/types";
import type { FinanceRaw } from "../../lib/partner/finance/types";
import type { PartnerMemory } from "../../lib/partner/memory/types";
import type { PersistedOwnerContext } from "../../lib/partner/investigation/context-row";
import { PORTAL_ARTISTS } from "../../lib/red-artists/portal-registry";
import type { IntegrityRegisterInput } from "../../lib/partner/integrity/register";
import type { CompanyIntegrityRegister, IntegrityFinding } from "../../lib/partner/integrity/types";
import { empty, tx, work } from "./finance-mirror";

export const NOW = new Date("2026-09-24T09:00:00Z");
export const TODAY = "2026-09-24";
export const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const LA_SHALEV = U(301), LA_AVI = U(302), LA_CLEAN = U(303), LA_NAGASH = U(304);
export const C_SHALEV = U(201), C_AVI = U(203), C_CLEAN = U(204), C_NAGASH = U(205), C_DUP1 = U(207), C_DUP2 = U(208), C_STRANGER = U(209);
export const P = (n: number) => U(100 + n);

export interface Opts { extraAviProject?: boolean; roster?: string[]; noVictorStale?: boolean; releaseForAll?: boolean; businessType?: Record<string, string>; status?: Record<string, string> }

export function cooRaw(o: Opts): CooRawInput {
  const src = (source: string) => ({ source, status: "ok" as const, rowCount: 1 });
  const proj = (id: string, name: string, artist: string, status: string, businessType: string) =>
    ({ id, name, artist, status: o.status?.[id] ?? status, deadline: null, projectType: "שיר", businessType: o.businessType?.[id] ?? businessType, updatedAt: "2026-09-20T10:00:00Z", isHidden: false });
  const projects = [
    proj(P(1), "שיר לייבל", "שליו טסמה", "בעבודה", "לייבל"),
    proj(P(2), "אבי 1", "אבי מולה", "בעבודה", "לקוח"),
    proj(P(3), "אבי 2", "אבי מולה, שליו טסמה", "הושלם", "לקוח"),
    proj(P(4), "נגש 1", "נגש ביטס", "בעבודה", "לקוח"),
    proj(P(5), "כפול", "לקוח כפול", "בעבודה", "לקוח"),
    proj(P(6), "אלמוני", "אמן לא קיים", "בעבודה", "לקוח"),
    proj(P(7), "זר לייבל", "אמן זר", "בעבודה", "לייבל"),
  ];
  if (o.extraAviProject) projects.push(proj(P(8), "אבי 3", "אבי מולה", "בעבודה", "לקוח"));
  const old = o.noVictorStale ? "2026-09-10" : "2026-05-01";
  return structuredClone<CooRawInput>({
    sources: ["projects", "tasks", "steven", "victor", "proposals", "shows", "sessions", "transactions", "finance_settings", "releases", "agent_alerts"].map(src),
    projects,
    tasks: [],
    steven: [],
    victor: { stuckAfterDays: 5, works: [{ id: U(701), projectId: P(2), title: "Victor old work", status: "פעיל", workState: "נשלח לויקטור", sentDate: old, internalDeadline: null, daysSinceSent: 100, isStuck: true, uploads: [`${old}T10:00:00Z`], filesWithoutTimestamp: 0, reviews: [], linkedTaskId: null }] },
    proposals: [], shows: [], sessions: [], transactions: [], financeSettings: [], orphanFinanceKeyCount: 0,
    releases: { labelProjectsTotal: 1, rows: [{ projectId: P(1), name: "שיר לייבל", projectStatus: "בעבודה", stage: "רעיון", targetDate: "2026-10-05", nextAction: "", blocker: "", responsible: "", stageEnteredAt: "2026-09-01T10:00:00Z", labelArtistId: LA_SHALEV }] },
    alerts: [],
  });
}

export function eyesRaw(o: Opts): PartnerEyesRaw {
  const client = (id: string, name: string, type = "אמן", status = "פעיל") => ({ id, name, type, status, createdAt: "2026-01-01T10:00:00Z" });
  const la = (id: string, name: string) => ({ id, name, status: "פעיל", createdAt: "2026-01-01T10:00:00Z", updatedAt: "2026-08-01T10:00:00Z" });
  const allLa: Record<string, string> = { "שליו טסמה": LA_SHALEV, "אבי מולה": LA_AVI, "DJ CLEANTONE": LA_CLEAN, "נגש ביטס": LA_NAGASH };
  const roster = o.roster ?? Object.keys(allLa);
  const rel = (pid: string, laId: string) => ({ projectId: pid, labelArtistId: laId, stage: "רעיון", targetDate: "2026-10-05", stageEnteredAt: "2026-09-01T10:00:00Z", releasedAt: null, createdAt: "2026-08-01T10:00:00Z", updatedAt: "2026-09-01T10:00:00Z" });
  const releases = [rel(P(1), LA_SHALEV)];
  if (o.releaseForAll) releases.push(rel(P(2), LA_AVI), rel(P(4), LA_NAGASH), rel(P(9), LA_CLEAN));
  return structuredClone<PartnerEyesRaw>({
    sources: ["clients", "label_artists", "clip_productions", "artist_balance_entries", "sessions_eyes", "shows_eyes", "proposals_eyes", "releases_eyes", "transactions_eyes", "tasks_eyes"].map((s) => ({ source: s, status: "ok" as const, rowCount: 1 })),
    clients: [
      client(C_SHALEV, "שליו טסמה", "אמן", "אמן לייבל"), client(C_AVI, "אבי מולה", "אמן", "אמן לייבל"), client(C_NAGASH, "נגש ביטס", "אמן", "אמן לייבל"),
      client(C_CLEAN, "רועי איוב", "איש צוות"), client(C_STRANGER, "אמן זר", "אמן", "אמן לייבל"),
      client(C_DUP1, "לקוח כפול", "לקוח"), client(C_DUP2, "לקוח  כפול", "לקוח"),
    ],
    labelArtists: roster.map((n) => la(allLa[n] ?? U(399), n)),
    clips: [],
    artistBalanceEntries: [{ id: U(1001), artistId: LA_SHALEV, entryType: "הכנסות", amount: 800, entryDate: "2026-08-01" }],
    sessions: [
      { id: U(900), projectId: P(2), showId: null, date: "2026-08-25", startTime: null, endTime: null, status: "התקיים", sessionType: "סשן" },
      { id: U(901), projectId: P(2), showId: null, date: "2026-08-20", startTime: null, endTime: null, status: "התקיים", sessionType: "סשן" },
    ],
    shows: [{ id: U(401), name: "הופעה", status: "בוצע", paymentStatus: "שולם", date: "2026-08-06", djClientId: C_CLEAN, djConfirmationStatus: "אושר", artistClientId: C_SHALEV, bookerClientId: null, price: 1000 }],
    proposalsFull: [], releasesFull: releases, transactions: [], tasksFull: [],
  });
}

export const state = (o: Opts = {}): PartnerCompanyState => assemblePartnerCompanyState(computeCoo(cooRaw(o), NOW), eyesRaw(o));

export function financeRaw(): FinanceRaw {
  const legacyTx = tx({ type: "expense", amount: 200, currency: "$", status: "צפוי" });
  const payTx = tx({ type: "expense", amount: 740, currency: "₪", status: "שולם" });
  return empty({
    transactions: [legacyTx, payTx],
    engineerWorks: [work({ linkedTransactionId: legacyTx.id }), work({ linkedTransactionId: payTx.id, amountPaid: 200 }), work()],
    mediaIncome: [{ labelArtistId: LA_SHALEV, status: "התקבל", grossAmount: 300 } as FinanceRaw["mediaIncome"][number]],
    victorLegacyPayments: [{ month: "2026-05" } as NonNullable<FinanceRaw["victorLegacyPayments"]>[number]],
  });
}

export const memory = (): PartnerMemory => ({
  entities: [{
    entity: { key: "recurring:VICTOR_SALARY:2026-05", kind: "recurring", period: "2026-05" },
    facts: [], ownerDecisions: [], observations: [], actions: [], outcomes: [], resolutions: [],
    conflicts: [{ entity: "recurring:VICTOR_SALARY:2026-05", code: "PAYMENT_STATUS_SOURCES_DISAGREE", epistemic: "UNKNOWN", values: [{ source: "OWNER_CONTEXT", value: "PAID", precedence: 1 }, { source: "LEGACY", value: "UNPAID", precedence: 2 }], winning: { source: "OWNER_CONTEXT", value: "PAID" } }],
  }],
} as unknown as PartnerMemory);

export function input(o: Opts & { contexts?: PersistedOwnerContext[] | null } = {}): IntegrityRegisterInput {
  return {
    now: NOW, todayIL: TODAY, state: state(o), finance: { raw: financeRaw() }, memory: memory(),
    extras: {
      redFilmsProductions: [{ id: U(1301), title: "הפקה", status: "בוטל", productionType: "��" }, { id: U(1302), title: "קליפ", status: "בעבודה", productionType: "קליפ" }],
      meetings: [{ id: U(1401), date: "2026-06-07", status: "נקבעה" }, { id: U(1402), date: "2026-10-07", status: "נקבעה" }],
    },
    portalArtistNames: Object.keys(PORTAL_ARTISTS), cleantoneClientId: C_CLEAN,
    ownerContexts: o.contexts === undefined ? [] : o.contexts,
  };
}

export const ctx = (questionId: string, caseId: string, questionType: string, subjectType: string, subjectId: string, answerCode: string, fingerprint: string, id = U(1201), answeredAt = "2026-09-24T08:00:00.000Z"): PersistedOwnerContext => ({
  id, schemaVersion: "partner-owner-context-schema-v2", questionId, caseId, caseType: questionType, questionType, subjectType, subjectId, answerCode,
  answerValue: null, triggerContextId: null, questionTextHe: "q", caseFactsFingerprint: fingerprint, note: null, answeredAt, scope: "CASE_INSTANCE",
  provenance: { source: "owner_manual" }, caseSchemaVersion: "v", supersedesId: null,
} as unknown as PersistedOwnerContext);

export const find = (r: CompanyIntegrityRegister, type: IntegrityFinding["type"], key?: string) => r.findings.filter((x) => x.type === type && (!key || x.subject.key === key));
export const allText = (r: CompanyIntegrityRegister) => JSON.stringify(r);
