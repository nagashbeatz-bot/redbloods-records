/**
 * Tests — Redbloods Partner Company Integrity Register + CompanyReadContext foundation.
 *
 * Run with:   npx tsx scripts/test-partner-integrity.tsx
 *
 * NEVER touches production. The company state is built by the REAL computeCoo() + assemblePartnerCompanyState()
 * over a production-shaped fixture; the register is the REAL buildCompanyIntegrityRegister(). Plus static guards:
 * no write capability, no Agent Alerts dependency, no Google Calendar, no Finance / MCP change.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { computeCoo } from "../lib/coo/pipeline";
import type { CooRawInput } from "../lib/coo/types";
import { assemblePartnerCompanyState } from "../lib/partner/eyes/company-state";
import type { PartnerEyesRaw, PartnerCompanyState } from "../lib/partner/eyes/types";
import type { FinanceRaw } from "../lib/partner/finance/types";
import type { PartnerMemory } from "../lib/partner/memory/types";
import type { PersistedOwnerContext } from "../lib/partner/investigation/context-row";
import { ANSWER_OPTIONS } from "../lib/partner/investigation/questions";
import { PORTAL_ARTISTS } from "../lib/red-artists/portal-registry";
import { buildCompanyIntegrityRegister, type IntegrityRegisterInput } from "../lib/partner/integrity/register";
import { LABEL_ROSTER_DEFINITION, SESSION_STATUS_VOCABULARY, STEVEN_PAYMENT_WRITERS } from "../lib/partner/integrity/definitions";
import { MAX_INTEGRITY_QUESTIONS, type CompanyIntegrityRegister, type IntegrityFinding } from "../lib/partner/integrity/types";
import { readIntegrityExtras, type CompanyExtrasReadClient } from "../lib/partner/company/readers";
import { empty, tx, work } from "./fixtures/finance-mirror";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}
const ok = (name: string, cond: boolean) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}`); fail++; } };

const NOW = new Date("2026-09-24T09:00:00Z");
const TODAY = "2026-09-24";
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const LA_SHALEV = U(301), LA_AVI = U(302), LA_CLEAN = U(303), LA_NAGASH = U(304);
const C_SHALEV = U(201), C_AVI = U(203), C_CLEAN = U(204), C_NAGASH = U(205), C_DUP1 = U(207), C_DUP2 = U(208), C_STRANGER = U(209);
const P = (n: number) => U(100 + n);

interface Opts { extraAviProject?: boolean; roster?: string[]; noVictorStale?: boolean; releaseForAll?: boolean }

function cooRaw(o: Opts): CooRawInput {
  const src = (source: string) => ({ source, status: "ok" as const, rowCount: 1 });
  const proj = (id: string, name: string, artist: string, status: string, businessType: string) =>
    ({ id, name, artist, status, deadline: null, projectType: "שיר", businessType, updatedAt: "2026-09-20T10:00:00Z", isHidden: false });
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

function eyesRaw(o: Opts): PartnerEyesRaw {
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

const state = (o: Opts = {}): PartnerCompanyState => assemblePartnerCompanyState(computeCoo(cooRaw(o), NOW), eyesRaw(o));

function financeRaw(): FinanceRaw {
  const legacyTx = tx({ type: "expense", amount: 200, currency: "$", status: "צפוי" });
  const payTx = tx({ type: "expense", amount: 740, currency: "₪", status: "שולם" });
  return empty({
    transactions: [legacyTx, payTx],
    engineerWorks: [work({ linkedTransactionId: legacyTx.id }), work({ linkedTransactionId: payTx.id, amountPaid: 200 }), work()],
    mediaIncome: [{ labelArtistId: LA_SHALEV, status: "התקבל", grossAmount: 300 } as FinanceRaw["mediaIncome"][number]],
    victorLegacyPayments: [{ month: "2026-05" } as NonNullable<FinanceRaw["victorLegacyPayments"]>[number]],
  });
}

const memory = (): PartnerMemory => ({
  entities: [{
    entity: { key: "recurring:VICTOR_SALARY:2026-05", kind: "recurring", period: "2026-05" },
    facts: [], ownerDecisions: [], observations: [], actions: [], outcomes: [], resolutions: [],
    conflicts: [{ entity: "recurring:VICTOR_SALARY:2026-05", code: "PAYMENT_STATUS_SOURCES_DISAGREE", epistemic: "UNKNOWN", values: [{ source: "OWNER_CONTEXT", value: "PAID", precedence: 1 }, { source: "LEGACY", value: "UNPAID", precedence: 2 }], winning: { source: "OWNER_CONTEXT", value: "PAID" } }],
  }],
} as unknown as PartnerMemory);

function input(o: Opts & { contexts?: PersistedOwnerContext[] | null } = {}): IntegrityRegisterInput {
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

const ctx = (questionId: string, caseId: string, questionType: string, subjectType: string, subjectId: string, answerCode: string, fingerprint: string, id = U(1201), answeredAt = "2026-09-24T08:00:00.000Z"): PersistedOwnerContext => ({
  id, schemaVersion: "partner-owner-context-schema-v2", questionId, caseId, caseType: questionType, questionType, subjectType, subjectId, answerCode,
  answerValue: null, triggerContextId: null, questionTextHe: "q", caseFactsFingerprint: fingerprint, note: null, answeredAt, scope: "CASE_INSTANCE",
  provenance: { source: "owner_manual" }, caseSchemaVersion: "v", supersedesId: null,
} as unknown as PersistedOwnerContext);

const find = (r: CompanyIntegrityRegister, type: IntegrityFinding["type"], key?: string) => r.findings.filter((x) => x.type === type && (!key || x.subject.key === key));
const allText = (r: CompanyIntegrityRegister) => JSON.stringify(r);

// ────────────────────────────────────────────────────────────────────────────
console.log("\n1. label roster (Owner definition)");
{
  const r = buildCompanyIntegrityRegister(input());
  check("roster definition = the 4 Owner-named artists", [...LABEL_ROSTER_DEFINITION.rosterNames], ["שליו טסמה", "אבי מולה", "DJ CLEANTONE", "נגש ביטס"]);
  const m = find(r, "LABEL_MEMBERSHIP_SOURCE_DISAGREEMENT")[0];
  ok("membership finding exists (supporting sources disagree)", !!m);
  check("roster evidence = the 4 label_artists (canonical)", m.evidence[0].value, ["DJ CLEANTONE", "אבי מולה", "נגש ביטס", "שליו טסמה"]);
  check("roster is not overridden: stance OWNER_DECIDED, LOW", [m.stance, m.severity], ["OWNER_DECIDED", "LOW"]);
  ok("conflicting sources listed as conflicting, never canonical", m.conflictingSources.some((s) => s.includes("clients.status")) && m.conflictingSources.some((s) => s.includes("project_business_type")) && m.canonicalSources.every((s) => s.startsWith("label_artists")));
  ok("client 'אמן זר' with אמן לייבל status is reported, not added to the roster", JSON.stringify(m.evidence).includes("אמן זר") && !(m.evidence[0].value as string[]).includes("אמן זר"));
  ok("DJ CLEANTONE counted via the app identity link (client רועי איוב is איש צוות) — not flagged", !JSON.stringify(m.evidence.find((e) => e.source.startsWith("clients.status"))?.value).includes("DJ CLEANTONE"));
  const drift = buildCompanyIntegrityRegister(input({ roster: ["שליו טסמה", "אבי מולה", "נגש ביטס"] }));
  const d = find(drift, "LABEL_MEMBERSHIP_SOURCE_DISAGREEMENT")[0];
  check("label_artists drifting from the Owner roster → HIGH CONFLICT", [d.stance, d.severity], ["CONFLICT", "HIGH"]);
}

console.log("\n2. label project classification");
{
  const inp = input();
  const before = JSON.stringify(inp);
  const r = buildCompanyIntegrityRegister(inp);
  check("inputs are not mutated", JSON.stringify(inp) === before, true);
  const avi = find(r, "LABEL_PROJECT_CLASSIFICATION_MISMATCH", `label-artist:${LA_AVI}`)[0];
  ok("אבי מולה's לקוח projects detected", !!avi && JSON.stringify(avi.evidence).includes(P(2)) && JSON.stringify(avi.evidence).includes(P(3)));
  ok("project_business_type reported as stored (לקוח), not changed", JSON.stringify(avi.evidence).includes('"businessType":"לקוח"'));
  ok("the label-typed project of שליו is not a mismatch", !JSON.stringify(find(r, "LABEL_PROJECT_CLASSIFICATION_MISMATCH", `label-artist:${LA_SHALEV}`)).includes(P(1)));
  ok("collab project (אבי + שליו) is flagged for both, marked collab", JSON.stringify(find(r, "LABEL_PROJECT_CLASSIFICATION_MISMATCH", `label-artist:${LA_SHALEV}`)).includes(P(3)) && JSON.stringify(avi.evidence).includes('"collab":true'));
  const st = state();
  check("state project types unchanged after the build", Object.values(st.domains.projects.data!.index).map((p) => p.businessType), ["לייבל", "לקוח", "לקוח", "לקוח", "לקוח", "לקוח", "לייבל"]);
}

console.log("\n3. project ↔ client links");
{
  const r = buildCompanyIntegrityRegister(input());
  const summary = find(r, "PROJECT_CLIENT_MATCH_INTEGRITY", "project-client-links")[0];
  ok("summary counts present", !!summary && typeof (summary.evidence[0].value as Record<string, number>).AMBIGUOUS === "number");
  const amb = r.findings.find((x) => x.type === "PROJECT_CLIENT_MATCH_INTEGRITY" && x.subject.type === "client-name")!;
  ok("ambiguous same-name clients stay ambiguous (CONFLICT, both records listed)", amb.stance !== "KNOWN" && JSON.stringify(amb.evidence).includes(C_DUP1) && JSON.stringify(amb.evidence).includes(C_DUP2));
  ok("no client id is picked for the ambiguous project", !JSON.stringify(amb).includes("clientIdChosen") && !/"linkedClientId"/.test(JSON.stringify(amb)));
  const nm = find(r, "PROJECT_CLIENT_MATCH_INTEGRITY", "project-client-no-match")[0];
  check("no-match stays UNKNOWN", nm?.stance, "UNKNOWN");
  ok("no-match lists the unmatched artist text", JSON.stringify(nm.evidence).includes("אמן לא קיים"));
}

console.log("\n4. session status vocabulary");
{
  const r = buildCompanyIntegrityRegister(input());
  const v = find(r, "SESSION_STATUS_VOCABULARY_CONFLICT")[0];
  ok("vocabulary conflict detected (stored התקיים vs legacy readers' נקבע/בוצע/הושלם)", !!v && v.stance === "CONFLICT" && v.interpretationHe.includes("נקבע"));
  ok("no session row normalized (wording + evidence only)", v.interpretationHe.includes("שום שורה לא נורמלה"));
}

console.log("\n5. future schedule ≠ empty calendar");
{
  const r = buildCompanyIntegrityRegister(input());
  const s = find(r, "FUTURE_SCHEDULE_COVERAGE_GAP")[0];
  check("0 future sessions → UNKNOWN (not 'no schedule')", [s.stance, s.ownerInputRequired], ["UNKNOWN", false]);
  ok("wording: no future sessions RECORDED; calendar not empty; Google not read", s.interpretationHe.includes("אין סשנים עתידיים רשומים כרגע בטבלת הסשנים") && s.interpretationHe.includes("לא אומר שהיומן ריק") && s.interpretationHe.includes("לא ידוע"));
  ok("never says 'אין שום דבר ביומן'", !allText(r).includes("אין שום דבר ביומן"));
  ok("no Owner question for the schedule", !r.questions.some((q) => q.subject.type === "domain"));
}

console.log("\n6. release plan ≠ no release planned");
{
  const r = buildCompanyIntegrityRegister(input());
  const nagash = find(r, "RELEASE_PLAN_COVERAGE_GAP", `label-artist:${LA_NAGASH}`)[0];
  check("artist with no release row → UNKNOWN", nagash?.stance, "UNKNOWN");
  ok("wording: not 'no release planned'", nagash.interpretationHe.includes("זה לא אומר שלא מתוכנן ריליס") && !/^אין ריליס מתוכנן/.test(nagash.interpretationHe));
  ok("artist with a dated release row → no gap finding", find(r, "RELEASE_PLAN_COVERAGE_GAP", `label-artist:${LA_SHALEV}`).length === 0);
  ok("all artists with dated rows → no release gap", find(buildCompanyIntegrityRegister(input({ releaseForAll: true })), "RELEASE_PLAN_COVERAGE_GAP").length === 0);
}

console.log("\n7. Victor");
{
  const r = buildCompanyIntegrityRegister(input());
  const stale = find(r, "VICTOR_WORK_INTEGRITY", "vendor:VICTOR:stale-active")[0];
  ok("stale-looking active work detected", !!stale && JSON.stringify(stale.evidence).includes(U(701)));
  ok("stale is NOT abandoned (wording + stance)", stale.interpretationHe.includes("זה לא אומר שהן נזנחו") && stale.stance === "DERIVED" && !allText(r).includes("ABANDONED"));
  ok("recent work → no stale finding", find(buildCompanyIntegrityRegister(input({ noVictorStale: true })), "VICTOR_WORK_INTEGRITY", "vendor:VICTOR:stale-active").length === 0);
  const sal = find(r, "VICTOR_WORK_INTEGRITY", "vendor:VICTOR:salary-sources")[0];
  ok("salary source conflict from Organizational Memory, Finance Brain stays canonical", sal.stance === "CONFLICT" && sal.canonicalSources[0].startsWith("Finance Brain") && sal.interpretationHe.includes("2026-05"));
}

console.log("\n8. Steven payment writers");
{
  const inp = input();
  const rawBefore = JSON.stringify(inp.finance);
  const r = buildCompanyIntegrityRegister(inp);
  const s = find(r, "STEVEN_PAYMENT_SOURCE_CONFLICT")[0];
  check("both writer shapes seen → CONFLICT", s.stance, "CONFLICT");
  check("shape counts", (s.evidence[1].value as Record<string, number>), { PAYMENT_EXPENSE_SHAPE: 1, LEGACY_SYNC_SHAPE: 1, UNCLASSIFIED: 0, NO_LINK: 1, LINK_MISSING_TX: 0 });
  check("no finance data created / changed", JSON.stringify(inp.finance), rawBefore);
  ok("no amount totals in the finding", !/"amount"|"total"|"sum"/i.test(JSON.stringify(s)));
}

console.log("\n9. label economics — no unified balance");
{
  const r = buildCompanyIntegrityRegister(input());
  const e = find(r, "LABEL_ECONOMICS_SOURCE_DIVERGENCE", `label-artist:${LA_SHALEV}`)[0];
  check("ledger without currency → UNKNOWN", [e.stance, e.epistemic], ["UNKNOWN", "UNKNOWN"]);
  ok("ledger currency reported as NONE", JSON.stringify(e.evidence).includes("NONE (no currency column)"));
  ok("no combined balance / total emitted", !/balanceTotal|unifiedBalance|"total"|"sum"/i.test(JSON.stringify(e)) && e.interpretationHe.includes("לא מחשב יתרה מאוחדת"));
}

console.log("\n10. data quality");
{
  const r = buildCompanyIntegrityRegister(input());
  ok("garbled production_type detected (only the garbled one)", JSON.stringify(find(r, "GENERAL_DATA_QUALITY", "red_films_productions.production_type")[0]?.evidence).includes(U(1301)) && !JSON.stringify(find(r, "GENERAL_DATA_QUALITY", "red_films_productions.production_type")[0]?.evidence).includes(U(1302)));
  const m = find(r, "GENERAL_DATA_QUALITY", "meetings.status")[0];
  ok("past meeting still נקבעה detected, future one not", JSON.stringify(m.evidence).includes(U(1401)) && !JSON.stringify(m.evidence).includes(U(1402)));
}

console.log("\n11. Owner questions — ceiling, suppression, live override");
{
  const r = buildCompanyIntegrityRegister(input());
  check("max 2 questions", r.questions.length, MAX_INTEGRITY_QUESTIONS);
  ok("remaining questions counted as deferred, not dropped", r.deferredQuestions >= 1);
  ok("questions are answerable (fixed options) and bounded", r.questions.every((q) => q.options.length >= 3 && q.options.every((o) => !!ANSWER_OPTIONS[q.questionType].find((x) => x.code === o.code)) && /^[0-9a-f]{64}$/.test(q.fingerprint)));
  ok("never asks for Owner-provided definitions (roster / schedule / finance / alerts)", r.questions.every((q) => q.questionType === "INTEGRITY_LABEL_PROJECT_CLASSIFICATION" || q.questionType === "INTEGRITY_CLIENT_IDENTITY"));
  const again = buildCompanyIntegrityRegister(input());
  check("deterministic across reads", JSON.stringify(again.questions), JSON.stringify(r.questions));

  const q = r.questions.find((x) => x.questionType === "INTEGRITY_LABEL_PROJECT_CLASSIFICATION" && x.subject.id === LA_AVI)!;
  ok("אבי מולה classification question surfaced", !!q);
  const answered = buildCompanyIntegrityRegister(input({ contexts: [ctx(q.questionId, q.caseId, q.questionType, "label-artist", LA_AVI, "LABEL_SONGS", q.fingerprint)] }));
  ok("an ACTIVE answer for the same facts suppresses the question", !answered.questions.some((x) => x.questionId === q.questionId) && answered.answeredQuestions.some((a) => a.questionId === q.questionId));
  const f = find(answered, "LABEL_PROJECT_CLASSIFICATION_MISMATCH", `label-artist:${LA_AVI}`)[0];
  check("finding becomes OWNER_DECIDED, canonical field still reported", [f.stance, JSON.stringify(f.evidence).includes('"businessType":"לקוח"')], ["OWNER_DECIDED", true]);
  const unk = buildCompanyIntegrityRegister(input({ contexts: [ctx(q.questionId, q.caseId, q.questionType, "label-artist", LA_AVI, "UNKNOWN", q.fingerprint)] }));
  ok("UNKNOWN for unchanged facts is not re-asked, stays a conflict", !unk.questions.some((x) => x.questionId === q.questionId) && find(unk, "LABEL_PROJECT_CLASSIFICATION_MISMATCH", `label-artist:${LA_AVI}`)[0].stance === "CONFLICT");

  const live = buildCompanyIntegrityRegister(input({ extraAviProject: true, contexts: [ctx(q.questionId, q.caseId, q.questionType, "label-artist", LA_AVI, "LABEL_SONGS", q.fingerprint)] }));
  const q2 = [...live.questions].find((x) => x.questionId === q.questionId);
  const fl = find(live, "LABEL_PROJECT_CLASSIFICATION_MISMATCH", `label-artist:${LA_AVI}`)[0];
  ok("live data overrides the stale answer: new project → answer no longer applies", !live.answeredQuestions.some((a) => a.questionId === q.questionId) && fl.stance === "NEEDS_OWNER" && fl.ownerInputRequired);
  ok("re-asked question carries the previous answer (when surfaced)", !q2 || (q2.previousAnswer?.answerCode === "LABEL_SONGS" && q2.fingerprint !== q.fingerprint));
  ok("new live project appears in the evidence", JSON.stringify(fl.evidence).includes(P(8)));

  const blind = buildCompanyIntegrityRegister(input({ contexts: null }));
  check("Owner Context unreadable → no questions (fail closed), ambiguity still visible", [blind.questions.length, blind.findings.some((x) => x.ownerInputRequired)], [0, true]);
  check("sources report owner-context UNAVAILABLE", blind.sources.find((s) => s.source === "owner-context")?.status, "UNAVAILABLE");
}

console.log("\n12. degraded sources fail closed");
{
  const r = buildCompanyIntegrityRegister({ ...input(), state: null, finance: null, memory: null, extras: null });
  check("no state → membership UNKNOWN, schedule UNKNOWN", [find(r, "LABEL_MEMBERSHIP_SOURCE_DISAGREEMENT")[0].stance, find(r, "FUTURE_SCHEDULE_COVERAGE_GAP")[0].stance], ["UNKNOWN", "UNKNOWN"]);
  ok("no fabricated findings for unread domains", find(r, "STEVEN_PAYMENT_SOURCE_CONFLICT").length === 0 && find(r, "GENERAL_DATA_QUALITY").length === 0);
}

console.log("\n13. CompanyReadContext extras reader");
void (async () => {
  const calls: string[] = [];
  const fake: CompanyExtrasReadClient = { from: (t) => ({ select: (c) => { calls.push(`${t}|${c}`); const resp = { data: t === "meetings" ? [{ id: 1, date: "2026-06-07", status: "נקבעה" }] : [{ id: "x", title: "t", status: null, production_type: "קליפ" }], error: null }; return Object.assign(Promise.resolve(resp), { limit: () => Promise.resolve(resp) }); } }) };
  const ex = await readIntegrityExtras(fake);
  check("bounded columns read", calls.sort(), ["meetings|id, date, status", "red_films_productions|id, title, status, production_type"]);
  check("rows mapped", [ex.meetings?.[0].id, ex.redFilmsProductions?.[0].productionType], ["1", "קליפ"]);
  const bad: CompanyExtrasReadClient = { from: () => ({ select: () => Object.assign(Promise.resolve({ data: null, error: { message: "x" } }), { limit: () => Promise.resolve({ data: null, error: { message: "x" } }) }) }) };
  const ex2 = await readIntegrityExtras(bad);
  check("read failure → null (never an empty list)", [ex2.meetings, ex2.redFilmsProductions], [null, null]);

  console.log("\n14. static guards");
  const root = path.resolve(__dirname, "..");
  const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
  const files = ["lib/partner/integrity/types.ts", "lib/partner/integrity/definitions.ts", "lib/partner/integrity/detectors.ts", "lib/partner/integrity/register.ts", "lib/partner/company/readers.ts", "lib/partner/company/read-context.ts"];
  const src = files.map(read).join("\n");
  ok("no write capability (insert / update / upsert / delete / rpc)", !/\.(insert|update|upsert|delete|rpc)\(/.test(src.replace(/createHash\("sha256"\)\.update\(/g, "")));
  ok("no appendOwnerContext / Owner Context write path", !/appendOwnerContext|buildOwnerContextDraft/.test(src));
  ok("no Agent Alerts dependency", !/from\s+["'][^"']*(lib\/agent|agent-alerts|agent_alerts)[^"']*["']/.test(src) && !/from\(\s*["']agent_alerts["']/.test(src));
  ok("no Google Calendar access", !/googleapis|google-calendar|calendar\.events/i.test(src));
  ok("no push / cron / email", !/web-push|sendPush|sendEmail|cron/i.test(src));
  const diff = (p: string) => execFileSync("git", ["status", "--porcelain", "--", p], { cwd: root, encoding: "utf8" }).trim();
  check("Finance Brain untouched", diff("lib/partner/finance"), "");
  check("MCP contract untouched", [diff("lib/integrations/partner-mcp"), diff("app/api/mcp"), diff("app/api/mcp-oauth"), diff("app/.well-known")], ["", "", "", ""]);
  check("Gateway untouched", diff("lib/partner/gateway"), "");
  check("Agent Alerts untouched", diff("lib/agent"), "");
  check("no migration added", diff("supabase"), "");
  ok("register not wired into MCP / Gateway payloads", !/integrity/i.test(fs.readdirSync(path.join(root, "lib/integrations/partner-mcp")).map((f) => read(`lib/integrations/partner-mcp/${f}`)).join("\n")) && !/integrity\/register|company\/read-context/.test(fs.readdirSync(path.join(root, "lib/partner/gateway")).map((f) => read(`lib/partner/gateway/${f}`)).join("\n")));
  ok("session writers really store the declared statuses", SESSION_STATUS_VOCABULARY.writers.files.some((fl) => read(fl).includes("התקיים")) && read("app/api/sessions/route.ts").includes("מתוכנן"));
  ok("legacy readers really expect the declared statuses", SESSION_STATUS_VOCABULARY.legacyReaders.every((r) => r.expects.every((s) => read(r.file).includes(`"${s}"`))));
  ok("both Steven writers exist in code", STEVEN_PAYMENT_WRITERS.every((w) => read(w.file).includes(w.marker)));
  check("PORTAL_ARTISTS = the roster (supporting source)", Object.keys(PORTAL_ARTISTS).sort(), [...LABEL_ROSTER_DEFINITION.rosterNames].sort());
  ok("integrity answer types are in the Owner Context taxonomy", !!ANSWER_OPTIONS.INTEGRITY_LABEL_PROJECT_CLASSIFICATION && !!ANSWER_OPTIONS.INTEGRITY_CLIENT_IDENTITY);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
