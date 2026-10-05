/**
 * Tests — Sunny PROACTIVE COO / BUSINESS_MOTION (Owner mission 2026-10-05, Phase 2): ONE derived reasoning layer that
 * turns what Sunny knows into the few concrete moves that push Redbloods forward — near completion, stage vs deadline,
 * calendar capacity × work need, protected label motion, curated Owner bottleneck, commercial gap, closed-loop learning,
 * the greeting. Pure; in-memory fixtures shaped like the production benchmark (2026-10-05); never touches production.
 *
 * Run with:   npx tsx scripts/test-sunny-motion.tsx
 */
import fs from "node:fs";
import path from "node:path";
import type { GatewaySources } from "../lib/partner/gateway/core";
import { cooCtx } from "../lib/partner/coo/context";
import { buildCooView, prioritiesHe } from "../lib/partner/coo/priorities";
import { applyMotionLearning, learnItem, MOTION_ACTION_IDS, MOTION_HEURISTICS, motionSummary, type BusinessMotion, type MotionItem } from "../lib/partner/coo/motion";
import { completionEvidence, stageBehind } from "../lib/partner/coo/stage";
import { readinessBoard } from "../lib/partner/coo/readiness";
import { getPartnerBriefCore } from "../lib/partner/gateway/brief";
import { deriveWithActionHistory } from "../lib/partner/sunny/with-history";
import { ACTION_REGISTRY } from "../lib/partner/act/registry";
import { PARTNER_KNOWLEDGE_REGISTRY } from "../lib/partner/knowledge/catalog";
import { queryKnowledgeCore } from "../lib/partner/knowledge/query";
import { SERVER_INSTRUCTIONS } from "../lib/integrations/partner-mcp/mcp";
import { buildMentionIndex, findPartialMentions } from "../lib/partner/knowledge/inbox-mentions";
import { SHALEV_ARTIST_ID } from "../lib/red-artists/portal-registry";
import { AVI_ARTIST_ID } from "../lib/roles";
import type { OutcomeAssessment } from "../lib/partner/sunny/learning";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 900)}` : ""}`); } };
const section = (t: string) => console.log(`\n${t}`);
const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const TODAY = "2026-10-05";
const D = (n: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const OWNER = { channel: "INTERNAL" as const, ownerAuthorized: true };

// ── ids (shaped like the 2026-10-05 production benchmark; never production data) ──
const A_NAGASH = U(3), A_CT = U(4);
const P_CLOSER = U(10), P_YAHALOM = U(11), P_TZOADIM = U(12), P_BAM = U(13), P_LO = U(14), P_EIN = U(15), P_HALAS = U(16), P_DH = U(17), P_MAOR = U(18), P_CLIP = U(19), P_TAS = U(20), P_KESEF = U(21);
const W_CLOSER = U(30), W_DH = U(31);
const RF_CLIP = U(40);
const K = (id: string) => `project:${id}`;

interface Fx { calendar?: unknown; holidays?: boolean; busyDays?: number[]; victorRest?: number; finance?: unknown; inbox?: Array<{ id: string; body: string; at: string; link?: string }>; knowledge?: unknown[]; noLabelNeed?: boolean; extraVictor?: unknown[]; closerNoFinals?: boolean; closerPaidOnly?: boolean; noState?: boolean; shows?: unknown[]; noWork?: boolean }

const proj = (name: string, o: Record<string, unknown> = {}) => ({ name, status: "בעבודה", artistText: null, businessType: "לקוח", projectType: "שיר", ...o });
const vwork = (id: string, projectId: string | null, title: string, holder: string, uploadAt: string) => ({ id, projectId, title, workState: null, ball: { holder }, isStuck: false, daysSinceSent: 10, lastUploadAt: uploadAt, lastNotesSentAt: null, uploads: [uploadAt], internalDeadline: null });
const calEvent = (id: string, title: string, startIso: string, endIso: string, o: Record<string, unknown> = {}) => ({ id, calendarId: "primary", calendarName: null, holidayCalendar: false, title, untitled: false, description: null, start: startIso, end: endIso, allDay: false, timeZone: "Asia/Jerusalem", durationMinutes: null, location: null, attendees: [], attendeesOmitted: false, selfResponse: null, organizer: null, creator: null, invited: false, recurringEventId: null, originalStartTime: null, recurrence: null, status: "confirmed", eventType: "default", transparency: "opaque", visibility: null, created: null, updated: null, hasMeetingLink: false, hasAttachments: false, attachmentCount: 0, ...o });
const holiday = (id: string, title: string, start: string, end: string) => calEvent(id, title, start, end, { allDay: true, holidayCalendar: true, transparency: "transparent" });
const calWindow = (events: unknown[]) => ({ status: "CALENDAR_DATA_AVAILABLE", window: { start: D(-7), end: D(30), days: 37 }, fetchedAt: `${TODAY}T08:00:00Z`, cache: "NONE", calendars: [], events, truncated: false, reasons: [] });
const fullDay = (n: number) => calEvent(`full-${n}`, "יום עמוס", `${D(n)}T05:00:00Z`, `${D(n)}T14:30:00Z`);
const dsession = (id: string, projectId: string | null, date: string, o: Record<string, unknown> = {}) => ({ id, projectId, showId: null, date, startTime: "12:00", endTime: "15:00", status: (o.status as string) ?? "התקיים", type: (o.type as string) ?? "סשן", statusSource: (o.source as string) ?? "MANUAL", statusChangedAt: null, title: null, notes: null, location: null, photographer: null, cost: null, hasCalendarEvent: false, createdAt: (o.created as string) ?? `${D(-40)}T10:00:00Z` });
const tx = (id: string, projectId: string, type: string, amount: number, status: string) => ({ id, projectId, type, date: D(-20), amount, currency: "₪", status, category: null, scope: null, expenseScope: null, linkedSessionId: null });
const setting = (projectId: string, agreedPrice: number) => ({ projectId, value: { agreedPrice, currency: "₪" } });
const inboxItem = (id: string, body: string, createdAt: string) => ({ id, createdAt, body, author: "OWNER", epistemic: "OWNER_REPORTED", source: "DASHBOARD_V2", status: "NEW", processedAt: null, processedVia: null, outcome: null, outcomeRef: null });
const ilink = (id: string, itemId: string, entityKey: string) => ({ id, itemId, entityKey, quality: "EXACT_UNIQUE", method: "RESOLVER_UNIQUE", surface: "x", candidates: null, createdAt: `${D(-4)}T08:01:00Z`, retractedAt: null, retractedReason: null });
const blocker = (id: string, subjectKey: string, detail: string, createdAt: string) => ({ id, createdAt, kind: "PROJECT_BLOCKER", subjectKey, identityKeys: [subjectKey], slotKey: `PROJECT_BLOCKER:${subjectKey}`, value: { detail, reason: "WAITING_FOR_ARTIST" }, epistemic: "OWNER_REPORTED", meaningHe: detail, operation: "ASSERT", supersedesId: null, status: "ACTIVE", reviewAt: null, expiresAt: null, via: "SUNNY", notes: [] });

function src(fx: Fx = {}): GatewaySources {
  const projects: Array<[string, Record<string, unknown>]> = [
    [P_CLOSER, proj("קרוב אלייך", { status: "במיקס", artistText: "חיים באינסאי", deadline: D(2) })],
    [P_YAHALOM, proj("יהלום", { artistText: "רוני נגה", deadline: D(6) })],
    [P_TZOADIM, proj("צועדים", { artistText: "ג'רמי קול חבש", deadline: D(-1) })],
    [P_BAM, proj("באם באם", { status: "מחכה למיקס", artistText: "ג'רמי קול חבש" })],
    [P_LO, proj("לא מאמינה", { businessType: "לייבל", artistText: "אבי מולה" })],
    [P_EIN, proj("אין לך", { businessType: "לייבל", artistText: "שליו טסמה" })],
    [P_HALAS, proj("חלהס אמפיאנו", { businessType: "לייבל", artistText: "שליו טסמה" })],
    [P_DH, proj("דאנסהול סקול", { status: "במיקס", businessType: "לייבל", artistText: "נגש ביטס" })],
    [P_MAOR, proj("מאור ראנקינג אהרון", { status: "לא התחיל", artistText: "מאור אהרון", projectType: "EP" })],
    [P_CLIP, proj("בלאגן — קליפ", { projectType: "קליפ", artistText: "טל צגאי, אבי מולה" })],
    [P_TAS, proj("טס", { status: "מחכה למיקס", artistText: "טל צגאי" })],
    [P_KESEF, proj("כסף", { businessType: "לייבל", artistText: "אבי מולה" })],
  ];
  if (fx.noWork) projects.length = 0;
  const index = Object.fromEntries(projects.map(([id, p]) => [id, p]));
  const open = projects.map(([id, p]) => ({ id, name: p.name, status: p.status, businessType: p.businessType, projectType: p.projectType, artistText: p.artistText, deadline: { ymd: (p.deadline as string) ?? null, daysTo: p.deadline ? Math.round((Date.parse(`${p.deadline}T00:00:00Z`) - Date.parse(`${TODAY}T00:00:00Z`)) / 86_400_000) : null }, daysSinceUpdate: 2, active: true, hasFinanceSetting: true }));
  const meta = projects.map(([id, p]) => ({ id, name: p.name, status: p.status, projectType: p.projectType, businessType: p.businessType, artistText: p.artistText, deadline: p.deadline ?? null, startDate: null, endDate: null, parentProject: null, isHidden: false, songProjectId: null, plannedHours: null, plannedDays: null, updatedAt: null }));
  const roster = [{ id: AVI_ARTIST_ID, name: "אבי מולה" }, { id: SHALEV_ARTIST_ID, name: "שליו טסמה" }, { id: A_NAGASH, name: "נגש ביטס" }, { id: A_CT, name: "DJ CLEANTONE" }];
  const victor = [
    vwork(U(50), P_LO, "Can't believe", "owner", `${D(-16)}T13:00:00Z`),
    vwork(U(51), P_EIN, "Bedroom", "owner", `${D(-16)}T14:00:00Z`),
    ...Array.from({ length: fx.victorRest ?? 10 }, (_, i) => vwork(U(300 + i), null, `Beat ${i}`, "owner", `${D(-20 + i)}T05:00:00Z`)),
    ...((fx.extraVictor ?? []) as never[]),
  ];
  const detSessions = [
    dsession(U(60), P_MAOR, D(-35)), dsession(U(61), P_MAOR, D(-5), { source: "AUTO_MARK" }),
    dsession(U(62), P_EIN, D(-7), { source: "AUTO_MARK" }), dsession(U(63), P_HALAS, D(-13)), dsession(U(64), P_KESEF, D(-35)),
    dsession(U(65), P_CLIP, D(-1), { type: "צילום קליפ", source: "AUTO_MARK" }), dsession(U(66), P_YAHALOM, D(-39)),
  ];
  const sessionsEyes = detSessions.map((s) => ({ id: s.id, projectId: s.projectId, showId: null, dateYmd: s.date, status: s.status, sessionType: s.type, startTime: s.startTime, endTime: s.endTime, statusSource: s.statusSource, createdAt: s.createdAt }));
  const state = {
    todayIL: TODAY,
    domains: {
      projects: { data: { index, open } },
      clients: { data: { items: [{ id: U(90), name: "DJ CLEANTONE", type: "DJ", status: "פעיל", createdAt: null }, { id: U(91), name: "שליו טסמה", type: "אמן לייבל", status: "פעיל", createdAt: null }, { id: U(92), name: "ג'רמי קול חבש", type: "לקוח", status: "פעיל", createdAt: null }] } },
      labelArtists: { data: { items: roster.map((a) => ({ ...a, status: "פעיל", createdAt: null, updatedAt: null, balanceEntries: 0 })) } },
      victor: { data: { active: victor } }, sessions: { data: { items: sessionsEyes } },
      releasesFull: { data: { items: fx.noWork ? [] : [{ projectId: P_LO, labelArtistId: AVI_ARTIST_ID, stage: "רעיון", targetYmd: D(7), stageEnteredAt: `${D(-30)}T10:00:00Z`, releasedAt: null, createdAt: null, updatedAt: null }] } },
      proposalsFull: { data: { items: [] } }, tasksFull: { data: { items: [] } },
      shows: { data: { items: fx.shows ?? [{ id: U(95), name: "פסטידאנס", status: "בוצע", paymentStatus: "שולם", dateYmd: D(-3), dealType: "PAID", djClientId: null, djConfirmationStatus: null, artistClientId: U(91), bookerClientId: null, price: 2500 }] } },
    },
  };
  const engineer = [
    { id: W_CLOSER, projectId: P_CLOSER, engineerName: "Steven", workType: "מיקס + מאסטר", workTitle: null, status: fx.closerPaidOnly ? "נשלח" : "אושר", sentDate: D(-26), internalDeadline: D(-15), agreedPrice: 200, amountPaid: 200, currency: "$", paymentDate: D(-3) },
    { id: W_DH, projectId: P_DH, engineerName: "Steven", workType: "מיקס + מאסטר", workTitle: null, status: "נשלח", sentDate: D(-30), internalDeadline: D(-14), agreedPrice: 200, amountPaid: 0, currency: "$", paymentDate: null },
  ];
  const finals = fx.closerNoFinals ? [] : [{ id: U(70), workId: W_CLOSER, createdAt: `${D(-3)}T10:00:00Z` }];
  const versions = [{ id: U(71), workId: W_DH, createdAt: `${D(-14)}T00:04:00Z`, uploadedAt: `${D(-14)}T00:04:00Z`, targetId: null, status: null }, { id: U(72), workId: W_CLOSER, createdAt: `${D(-4)}T00:13:00Z`, uploadedAt: `${D(-4)}T00:13:00Z`, targetId: null, status: null }];
  const sendLog = [{ id: U(73), projectId: P_CLOSER, actionType: "sent", contentType: "הפקה", recipientRole: "external_producer", recipientName: null, status: "pending_version", actionDate: D(-93), followupDate: D(-91) }];
  const ops = { redFilms: { rows: [{ id: RF_CLIP, title: "בלאגן", productionType: "קליפ", status: "יום צילום נקבע", projectId: P_CLIP, clientId: null, artistName: "טל צגאי", clientSource: null, shootDate: D(-1), publishDate: null, editStatus: null, collectionStatus: null, generalBudget: 0, clientPrice: null, advanceRequired: null, advanceReceived: null }], capped: false },
    projectsMeta: { rows: meta, capped: false }, engineerWork: { rows: fx.noWork ? [] : engineer, capped: false }, mixVersions: { rows: versions, capped: false }, mixComments: { rows: [], capped: false }, finalFiles: { rows: finals, capped: false },
    meetings: { rows: [], capped: false }, projectActions: { rows: sendLog, capped: false }, calendarLinks: { rows: [], capped: false }, clipItems: { rows: [], capped: false }, campaigns: { rows: [], capped: false }, albumTracks: { rows: [], capped: false }, deliveries: { rows: [], capped: false }, budgetPayments: { rows: [], capped: false }, equipment: { rows: [], capped: false } };
  const det = { productions: { rows: [], capped: false }, budgetItems: { rows: [], capped: false }, budgetPayments: { rows: [], capped: false }, rfDocuments: { rows: [], capped: false }, rfRefImages: { rows: [], capped: false }, rfRefLinks: { rows: [], capped: false }, rfCrew: { rows: [], capped: false },
    tasks: { rows: [], capped: false }, sessions: { rows: detSessions, capped: false }, meetings: { rows: [], capped: false }, releases: { rows: [{ projectId: P_LO, nextAction: null, blocker: null, responsible: null, stageEnteredAt: null, releasedAt: null }], capped: false },
    mixVersions: { rows: versions, capped: false }, mixComments: { rows: [], capped: false }, mixTargets: { rows: [], capped: false }, mixTargetNotes: { rows: [], capped: false }, actions: { rows: sendLog, capped: false } };
  const financeState = { receivables: [], credits: [], priceCoverage: { liveProjects: 0, priced: 0, priceUnknownOpen: 0, priceUnknownCompleted: 0, financeExceptions: 0, malformedSettings: 0 }, realized: { month: "2026-10", byCurrency: {}, ils: { cashIn: 2000, cashOut: 0, net: 2000 }, historicalPartial: false, evidence: [] }, proposalPipeline: { state: "NO_ACTIVE_PIPELINE_DATA", openCount: 0, amounts: {} } };
  const finance = fx.finance ?? { raw: { transactions: [tx("t1", P_YAHALOM, "income", 3800, "שולם"), tx("t2", P_BAM, "income", 2200, "התקבל"), tx("t3", P_TZOADIM, "income", 3000, "התקבל")], financeSettings: [setting(P_YAHALOM, 3800), setting(P_BAM, 2200), setting(P_TZOADIM, 3000)], projects: [], engineerWorks: [], shows: [], proposals: [], clients: [], labelArtists: [], ledger: [], mediaIncome: [], redFilmsPayments: [] }, state: financeState, integrity: { top: { reconcile: [] }, questions: [] }, actions: [], brief: null, answersAvailable: true };
  const hol = fx.holidays === false ? [] : [holiday("sukkot", "סוכות", D(-8), D(-6))];
  const cal = fx.calendar !== undefined ? fx.calendar : { status: "OK", value: calWindow([...hol, calEvent("lic", "שחרור רישיון", `${D(2)}T09:00:00Z`, `${D(2)}T10:00:00Z`), ...(fx.busyDays ?? []).map(fullDay)]) };
  const inbox = fx.inbox ?? [{ id: U(80), body: "היום עם מאור היה סשן טוב אבל חייב להתקדם", at: `${D(-5)}T23:21:00Z`, link: K(P_MAOR) }];
  const knowledge = fx.knowledge ?? [blocker(U(85), K(P_EIN), "שליו לא מצליח לסיים את הוורס השני", `${D(-7)}T13:17:00Z`), blocker(U(86), K(P_DH), "מחכים לפידבק של איילו על המיקס (הבטיח אחרי סוכות)", `${D(-9)}T10:00:00Z`)];
  return {
    now: new Date(`${TODAY}T08:00:00Z`), identities: { cleantone: { clientId: U(90), displayName: "DJ CLEANTONE", retiredKeys: [`label-artist:${A_CT}`] } },
    state: fx.noState ? { status: "UNAVAILABLE", detail: "x" } as never : { status: "OK", value: state } as never,
    finance: { status: "OK", value: finance } as never,
    operations: { status: "OK", value: ops } as never, projectDetail: { status: "OK", value: det } as never,
    labelDetail: { status: "OK", value: { shows: { rows: [], capped: false }, artists: { rows: [], capped: false } } } as never,
    settings: { status: "OK", value: { families: {} } } as never,
    calendar: cal as never,
    ownerKnowledge: { status: "OK", value: knowledge } as never,
    ownerInbox: { status: "OK", value: inbox.map((i) => inboxItem(i.id, i.body, i.at)) } as never,
    inboxMemory: { status: "OK", value: { links: inbox.filter((i) => i.link).map((i, n) => ilink(U(400 + n), i.id, i.link!)), interpretations: [] } } as never,
    cases: { status: "OK", value: Array.from({ length: 55 }, (_, i) => ({ caseType: "PROJECT_DEADLINE_PASSED", classification: "RISK", subjectType: "project", subjectId: U(500 + i) })) } as never,
    audience: OWNER,
  } as GatewaySources;
}

const motionOf = (fx: Fx = {}): BusinessMotion => buildCooView(src(fx)).motion;
const itemFor = (m: BusinessMotion, entity: string): MotionItem | undefined => m.all.find((i) => i.entity === entity) ?? m.all.find((i) => i.entities.includes(entity) && i.entity?.startsWith("project:"));
const texts = (o: unknown): string[] => (typeof o === "string" ? [o] : Array.isArray(o) ? o.flatMap(texts) : o && typeof o === "object" ? Object.values(o).flatMap(texts) : []);

async function main() {
  const M = motionOf();

  section("1. NEAR COMPLETION — done in the records ≠ done in the project; never a status change");
  const closer = itemFor(M, K(P_CLOSER))!;
  ok("1. approved + final files → COMPLETION_NOT_RECORDED (a loop to close)", !!closer && closer.codes.includes("COMPLETION_NOT_RECORDED"), closer);
  ok("2. it is a CLOSE_LOOP, NOT an AT_RISK / WAITING_EXTERNAL top risk (#53)", closer.sections.includes("CLOSE_LOOPS") && !closer.sections.includes("AT_RISK") && closer.level !== "MUST");
  ok("3. the old send-log signal is shown as a CONFLICT with the current state — never resolved", closer.codes.includes("STALE_SIGNAL_CONFLICT") || M.all.some((i) => i.codes.includes("STALE_SIGNAL_CONFLICT") && i.entity === K(P_CLOSER)));
  ok("4. the move: confirm done + delivery (registered actions, after his approval)", !!closer.move && closer.move.actionIds.includes("UPDATE_PROJECT_STATUS") && closer.move.approval === "OWNER_APPROVAL");
  ok("5. payment alone never proves completion (#54)", !itemFor(motionOf({ closerPaidOnly: true }), K(P_CLOSER))?.codes.includes("COMPLETION_NOT_RECORDED"));
  ok("6. approved but no final files → not complete", completionEvidence(cooCtx(src({ closerNoFinals: true })), P_CLOSER)?.complete === false);
  ok("7. a stage that is complete is never 'behind'", stageBehind(cooCtx(src()), P_CLOSER).behind === false);
  const bam = itemFor(M, K(P_BAM))!;
  ok("8. 'מחכה למיקס' + no engineer work → ONE_MOVE_TO_MIX", !!bam && bam.codes.includes("ONE_MOVE_TO_MIX"), bam);
  ok("9. a paid project waiting for the mix is at least SHOULD; an unpriced one with no client money is WATCH", (bam.level === "SHOULD" || bam.level === "MUST") && itemFor(M, K(P_TAS))?.level === "WATCH", [bam.level, itemFor(M, K(P_TAS))?.level]);
  const dh = itemFor(M, K(P_DH))!;
  ok("10. a mix version only the Owner can open → OWNER_ONE_ACTION (engineerHandoff)", !!dh && dh.codes.includes("OWNER_ONE_ACTION"), dh);
  ok("11. readiness: completion is CONFIRMED context, never an open stage check", readinessBoard(cooCtx(src())).events.find((e) => e.key === `readiness:deadline:${P_CLOSER}`)?.checks.some((c) => c.id === "deps.completion" && c.state === "CONFIRMED") === true);
  ok("12. motion never changes a status — no write verbs in motion / stage", !/\.(insert|upsert|rpc)\(|supabase|fetch\(|sendPush|createEvent/.test(code(read("lib/partner/coo/motion.ts") + read("lib/partner/coo/stage.ts"))));

  section("2. STAGE VS DEADLINE — uncertainty when the deliverable is unknown");
  const yah = itemFor(M, K(P_YAHALOM))!;
  ok("13. יהלום: deadline in 6 days, still 'בעבודה', no mix open → STAGE_VS_DEADLINE MUST", !!yah && yah.codes.includes("STAGE_VS_DEADLINE") && yah.level === "MUST", yah);
  ok("14. readiness is no longer 'מוכן' for it (ATTENTION with the stage check)", readinessBoard(cooCtx(src())).events.find((e) => e.key === `readiness:deadline:${P_YAHALOM}`)?.state === "ATTENTION");
  ok("15. the wording carries the uncertainty ('לא יודעת מה כלול בדדליין') — never 'the mix must be ready' (#56)", yah.reasonsHe.some((r) => r.includes("אני לא יודעת בדיוק מה כלול בדדליין")) && !texts(M).some((t) => /המיקס חייב להיות מוכן/.test(t)));
  const tz = M.all.find((i) => i.entities.includes(K(P_TZOADIM)))!;
  ok("16. צועדים: a recently passed deadline + no mix → MUST", !!tz && tz.level === "MUST" && tz.codes.includes("STAGE_VS_DEADLINE"), tz);
  ok("17. no recently-overdue rule uses an update age — only the deadline date", !/daysSinceUpdate/.test(code(read("lib/partner/coo/motion.ts"))));

  section("3. ONE CLIENT = ONE MOVE; ONE PROJECT = ONE PACKAGE");
  ok("18. צועדים + באם באם (same client) → ONE move 'לשלוח את שניהם למיקס' (#67)", !!tz && tz.entities.includes(K(P_BAM)) && /שניהם/.test(tz.move?.he ?? ""), tz);
  ok("19. the merged item keeps both reasons (nothing dropped)", tz.reasonsHe.length >= 2);
  const maor = itemFor(M, K(P_MAOR))!;
  ok("20. מאור: sessions on 'לא התחיל' + no next session → ONE package (not separate alerts)", !!maor && maor.codes.includes("STATUS_BEHIND_ACTIVITY") && M.all.filter((i) => i.entity === K(P_MAOR)).length === 1, maor);
  ok("21. an exactly LINKED Owner update raises its record one level (WATCH → SHOULD) with his words", maor.level === "SHOULD" && maor.codes.includes("OWNER_UPDATE_LINKED") && maor.reasonsHe.some((r) => r.includes("כתבת")));
  ok("22. without the linked update the same package stays WATCH", itemFor(motionOf({ inbox: [] }), K(P_MAOR))?.level === "WATCH");

  section("4. LABEL — protected Shalev / Avi, one level only, no cadence");
  const shalev = M.label.find((i) => i.entity === `label-artist:${SHALEV_ARTIST_ID}`)!;
  ok("23. Shalev: no session + projects waiting / without a step + an open week → SHOULD", !!shalev && shalev.level === "SHOULD" && shalev.labelProtected, shalev);
  ok("24. his blocker ('הוורס השני') is part of the reasoning", shalev.reasonsHe.some((r) => r.includes("הוורס השני")));
  ok("25. the Victor wait on אין לך is absorbed into the artist move (one move per artist, not two alerts)", !M.all.some((i) => i.entity === K(P_EIN)) && shalev.codes.includes("OWNER_BOTTLENECK_EXTRACT"));
  ok("26. the move = Victor notes + a session (registered actions)", !!shalev.move && shalev.move.actionIds.includes("SCHEDULE_SESSION") && shalev.move.actionIds.includes("SEND_VICTOR_VERSION_NOTES"));
  const busy = motionOf({ busyDays: [0, 1, 2, 3, 4, 5, 6] });
  ok("27. a busy week → protected label stays WATCH (promoted only with capacity) (#50)", busy.label.find((i) => i.entity === `label-artist:${SHALEV_ARTIST_ID}`)?.level === "WATCH", busy.label.map((i) => [i.titleHe, i.level]));
  const lo = itemFor(M, K(P_LO))!;
  ok("28. protected label + release ≤7 days not ready → MUST (#51)", !!lo && lo.level === "MUST" && lo.labelProtected, lo);
  ok("29. the release move is a DECISION (continue vs reconsider) — the date is never changed by Sunny", /לשקול מחדש את התאריך/.test(lo.move?.he ?? "") && /אני לא משנה תאריך לבד/.test(lo.move?.he ?? ""));
  const nag = M.all.find((i) => i.entity === `label-artist:${A_NAGASH}`);
  ok("30. NagashBeatz never inherits the Shalev / Avi protection (#52)", !nag || (!nag.labelProtected && nag.level !== "MUST"), nag);
  ok("31. DJ / team identities never enter the label moves", !M.all.some((i) => i.entity === `label-artist:${A_CT}`));
  ok("32. a completed show counts as artist ACTIVITY in the reasoning (not as music movement)", shalev.reasonsHe.some((r) => r.includes("הופעה אחרונה")));
  ok("33. no cadence / quota exists in motion (no 'every week' rule)", !/כל שבוע|weekly quota|sessionsPerWeek/i.test(read("lib/partner/coo/motion.ts")));
  ok("34. rosterCare and motion agree on label identity (#62)", M.label.every((i) => buildCooView(src()).artists.some((a) => a.key === i.entity)));

  section("5. CAPACITY × WORK NEED — an opportunity, never an obligation");
  ok("35. a relatively open week + label / mix need → CAPACITY opportunity (#49)", M.week.capacity === "OPEN" && !!M.week.opportunity && M.week.opportunity.candidates.length > 0 && M.week.opportunity.candidates.length <= 3, M.week);
  ok("36. the opportunity is a HYPOTHESIS and says it schedules nothing", M.week.opportunity?.epistemic === "HYPOTHESIS" && /לא קובעת כלום ביומן/.test(M.week.opportunity.he));
  const unread = motionOf({ calendar: { status: "UNAVAILABLE", detail: "x" } });
  ok("37. calendar unreadable → capacity UNKNOWN, never 'free'; no opportunity (#47)", unread.week.capacity === "UNKNOWN" && !unread.week.opportunity && unread.unchecked.some((u) => u.includes("לא אומרת שהשבוע פנוי")));
  const noNeed = buildCooView(src({ inbox: [] })).motion;
  void noNeed;
  const emptyNeed = motionOf({ victorRest: 0, knowledge: [] });
  ok("38. personal events count as occupied (a full day is never 'open')", !busy.week.openDays.length && busy.week.capacity !== "OPEN");
  const idle = motionOf({ noWork: true, inbox: [], knowledge: [] });
  ok("39. free calendar + no work need = no capacity recommendation (#48)", idle.week.capacity === "OPEN" && idle.week.opportunity === null, idle.week);
  ok("40. no fixed work hours: the capacity windows are labelled internal heuristics", MOTION_HEURISTICS.note.includes("never Owner policy") && /never a work-hours rule/.test(MOTION_HEURISTICS.note));
  ok("41. a heavy day today → the greeting carries ONE move", motionOf({ busyDays: [0] }).greeting.length === 1);

  section("6. OWNER BOTTLENECK — curated, never 26 tasks");
  ok("42. Victor waits = ONE line + the extracted business-priority ones (#68)", M.ownerBottleneck.victorWaiting === 12 && M.ownerBottleneck.extracted.length === 2 && M.ownerBottleneck.restCount === 10 && /בלוק האזנה מרוכז אחד/.test(M.ownerBottleneck.lineHe ?? ""), M.ownerBottleneck);
  ok("43. 'לא מאמינה' (release) and 'אין לך' (protected label) are extracted out of the group", M.ownerBottleneck.extracted.includes(`victor-work:${U(50)}`) && M.ownerBottleneck.extracted.includes(`victor-work:${U(51)}`));
  ok("44. the unrelated Victor works never become individual items", !M.all.some((i) => i.key.startsWith(`victor-owner:${U(300)}`)));
  ok("45. no 'N משימות' are created — the line says one listening block", !M.all.some((i) => i.move?.actionIds.some((a) => a.startsWith("CREATE_TASK"))));

  section("7. MONEY / PIPELINE — a commercial gap; conflicting goals never drive it");
  ok("46. no receivables + no proposals + no shows → REVENUE_PIPELINE_EMPTY", M.revenue.state === "PIPELINE_EMPTY" && M.all.some((i) => i.codes.includes("REVENUE_PIPELINE_EMPTY")));
  ok("47. goal conflict detected → stated, never used as a priority (#57)", M.revenue.goalConflict === true && /לא משתמשת בהם לקביעת עדיפות/.test(M.revenue.lineHe ?? "") && !texts(M).some((t) => /חסרים ₪?[\d,]+ (ל|עד)(יעד|רף)/.test(t)));
  const rev = M.all.find((i) => i.codes.includes("REVENUE_PIPELINE_EMPTY"))!;
  ok("48. missing-price projects create the commercial move (SET_AGREED_PRICE, his approval) (#58)", !!rev.move && rev.move.actionIds.includes("SET_AGREED_PRICE") && rev.entities.some((e) => e === K(P_MAOR) || e === K(P_TAS)));
  ok("49. Sunny never sets a price — the move is a proposal (canAct = with his approval)", rev.move!.approval === "OWNER_APPROVAL");
  ok("50. the per-project price gaps fold into ONE commercial line (no N price alerts)", M.all.filter((i) => i.codes.length === 1 && i.codes[0] === "PRICE_MISSING").length === 0);
  const unk = motionOf({ finance: { raw: { transactions: [], financeSettings: [], projects: [], engineerWorks: [], shows: [], proposals: [], clients: [], labelArtists: [], ledger: [], mediaIncome: [], redFilmsPayments: [] }, state: { receivables: [], credits: [] } } });
  ok("51. finance not readable → revenue UNKNOWN (never 'empty')", unk.revenue.state === "UNKNOWN" && unk.unchecked.some((u) => u.includes("הצנרת המסחרית לא נבדקה")));

  section("8. LEARNING — a planning move that did not work is not proposed again");
  const tzItem = M.all.find((i) => i.entities.includes(K(P_TZOADIM)))!;
  const tried: OutcomeAssessment[] = [{ planId: "pl_a", actionId: "UPDATE_PROJECT_DEADLINE", entity: K(P_TZOADIM), at: `${D(-4)}T07:39:00Z`, meaning: "PLANNING", level: "DID_NOT_RESOLVE", heuristic: true, evidenceHe: "", laterEvents: [] }];
  const learned = learnItem(tzItem, tried);
  ok("52. deadline already moved without progress → move becomes 'check the blocker', never 'move it again' (#59)", learned.learning?.changed === true && !learned.move!.actionIds.includes("UPDATE_PROJECT_DEADLINE") && /לא להזיז שוב את התאריך/.test(learned.move!.he));
  ok("53. INSUFFICIENT_EVIDENCE changes nothing", learnItem(tzItem, [{ ...tried[0], level: "INSUFFICIENT_EVIDENCE" }]) === tzItem);
  ok("54. a plan that never executed is not assessed at all → no change (#60)", learnItem(tzItem, []) === tzItem);
  ok("55. a learned change is marked a HYPOTHESIS, never a rule", learned.reasonsHe.some((r) => r.includes("השערה מתוך התוצאות, לא כלל")));
  const lm = applyMotionLearning(M, tried);
  ok("56. applyMotionLearning: the same item is changed everywhere it appears (today / atRisk / all)", lm.learning.status === "READ" && lm.learning.changed >= 1 && lm.all.find((i) => i.key === tzItem.key)?.learning?.changed === true);
  const slim = motionSummary(M) as Record<string, unknown>;
  const history = [{ planId: "pl_a", at: `${D(-4)}T07:39:00Z`, outcome: "EXECUTED", steps: [{ actionId: "UPDATE_PROJECT_DEADLINE", entity: K(P_TZOADIM), outcome: "APPLIED_AS_EXPECTED" }], approvedBy: "OWNER_APPROVAL" }];
  const viaConnector = deriveWithActionHistory("motion", { motion: { status: "OK", ...slim } }, history as never, Date.parse(`${TODAY}T08:00:00Z`)) as { motion: Record<string, unknown> };
  ok("57. the connector path (brief motion) applies the SAME learning and drops the raw progress map", (viaConnector.motion.learning as { status: string }).status === "READ" && !("progress" in viaConnector.motion));
  const noHist = deriveWithActionHistory("motion", { motion: { status: "OK", ...slim } }, null, Date.parse(`${TODAY}T08:00:00Z`)) as { motion: Record<string, unknown> };
  ok("58. history unreadable → said so (NOT_READ), never 'nothing was tried'", (noHist.motion.learning as { status: string }).status === "NOT_READ");

  section("9. OTHER EVIDENCE");
  const clip = itemFor(M, K(P_CLIP))!;
  ok("59. a passed shoot date + AUTO_MARK never proves the shoot happened (#69)", !!clip && clip.codes.includes("SHOOT_AUTO_MARKED") && clip.reasonsHe.some((r) => r.includes("לא הוכחה שצולם")), clip);
  const dhItem = M.all.find((i) => i.entities.includes(K(P_DH)))!;
  ok("60. 'אחרי סוכות' + the holiday visibly passed in the calendar → follow-up HYPOTHESIS", dhItem.codes.includes("FOLLOW_UP_AFTER_CONDITION") && dhItem.reasonsHe.some((r) => r.includes("כנראה זה הזמן לחזור לזה (השערה)")));
  ok("61. no holiday in the calendar → no follow-up claim (no holiday engine)", !motionOf({ holidays: false }).all.some((i) => i.codes.includes("FOLLOW_UP_AFTER_CONDITION")));
  ok("62. technical / uncertain items stay hypotheses (epistemic HYPOTHESIS where inferred) (#70)", M.all.filter((i) => i.codes.length === 1 && (i.codes[0] === "SHOOT_AUTO_MARKED" || i.codes[0] === "FOLLOW_UP_AFTER_CONDITION" || i.codes[0] === "OWNER_REPORTED_NEAR")).every((i) => i.epistemic === "HYPOTHESIS"));
  const near = motionOf({ inbox: [{ id: U(81), body: "חיים אוהב את המיקס, יש עוד איזה 2 תיקונים", at: `${D(-5)}T23:22:00Z`, link: K(P_DH) }] });
  ok("63. an exactly linked 'עוד 2 תיקונים' → OWNER_REPORTED_NEAR (hypothesis, no status change)", near.all.some((i) => i.codes.includes("OWNER_REPORTED_NEAR")));
  ok("64. an UNLINKED note never moves anything", !motionOf({ inbox: [{ id: U(82), body: "עוד 2 תיקונים", at: `${D(-5)}T23:22:00Z` }] }).all.some((i) => i.codes.includes("OWNER_REPORTED_NEAR")));

  section("10. ONE ENGINE — priorities = motion.today; brief carries motion");
  const V = buildCooView(src());
  ok("65. coo priorities exactly equal motion.todayItems (#63)", V.priorities.map((p) => p.key).join("|") === V.motion.todayItems.map((i) => i.key).join("|"));
  ok("66. priorities.ts holds no ranking of its own (no candidates / prioritize engine)", !/function candidates|export function prioritize/.test(read("lib/partner/coo/priorities.ts")));
  const brief = getPartnerBriefCore(src());
  ok("67. partner_brief carries motion (OK) with ≤3 greeting moves (#64, #46)", brief.motion?.status === "OK" && Array.isArray((brief.motion as Record<string, unknown>).greeting) && ((brief.motion as unknown as { greeting: unknown[] }).greeting.length <= 3));
  ok("68. the brief adds no ranking: its greeting = the motion greeting", JSON.stringify((brief.motion as unknown as { greeting: Array<{ key: string }> }).greeting.map((g) => g.key)) === JSON.stringify(V.motion.greeting.map((g) => g.key)));
  ok("69. with motion, the raw '55 מקרים' line is context only — not an item (#45)", !brief.items.some((i) => i.category === "ATTENTION") && brief.casesContext?.count === 55);
  const briefNoState = getPartnerBriefCore(src({ noState: true }));
  ok("70. no company state → motion UNAVAILABLE (never 'nothing to do') and the cases line stays", briefNoState.motion?.status === "UNAVAILABLE" && briefNoState.items.some((i) => i.category === "ATTENTION"));
  ok("71. the brief imports motion — never re-implements it", read("lib/partner/gateway/brief.ts").includes("motionSummary(buildCooView(src).motion)"));

  section("11. GREETING");
  ok("72. greeting ≤3 MUST / SHOULD moves, in the motion order", M.greeting.length <= 3 && M.greeting.every((i) => i.level === "MUST" || i.level === "SHOULD"));
  ok("73. the greeting leads with moves, not a raw count or a raw inbox list", !/מקרים פתוחים/.test(M.answerHe) && /המהלכים שהייתי עושה עכשיו|המהלך שהייתי עושה עכשיו/.test(M.answerHe));
  ok("74. the greeting carries ONE week line (+ capacity only when readable)", /השבוע:/.test(M.answerHe) && !/ימים כמעט פנויים/.test(unread.answerHe));
  ok("75. the greeting never asks 'במה נתחיל?'", !texts(M).some((t) => t.includes("במה נתחיל")));
  ok("76. WATCH / INFO never in the greeting", !M.greeting.some((i) => i.level === "WATCH" || i.level === "INFO"));
  ok("77. MUST before SHOULD; the nearest date first inside a level", M.todayItems.every((x, i, a) => i === 0 || ["MUST", "SHOULD"].indexOf(a[i - 1].level) <= ["MUST", "SHOULD"].indexOf(x.level)));
  ok("78. server instructions: a greeting calls partner_brief and leads with motion (core ≤1,200 chars)", (() => { const core = SERVER_INSTRUCTIONS.slice(0, SERVER_INSTRUCTIONS.indexOf("You are talking to the Owner")); return core.length <= 1200 && core.includes("partner_brief") && core.includes("motion"); })());
  ok("79. server instructions: never a raw count / raw list / 'במה נתחיל?'; same motion for 'מה תקוע' / 'מה לעשות השבוע' / 'מה עם האמנים'", SERVER_INSTRUCTIONS.includes("BUSINESS MOTION") && SERVER_INSTRUCTIONS.includes("never \\\"במה נתחיל?\\\"".replace(/\\\\/g, "\\").replace(/\\"/g, "\"")) && SERVER_INSTRUCTIONS.includes("מה תקוע") && SERVER_INSTRUCTIONS.includes("never a parallel ranking"));
  ok("80. prioritiesHe and the motion answer use the same items", prioritiesHe(V).includes(V.motion.todayItems[0]?.titleHe ?? "∅"));

  section("12. SAFETY — read-only, registered actions only, no background");
  ok("81. every action id a move may name is a registered Partner action (#66)", MOTION_ACTION_IDS.every((a) => ACTION_REGISTRY.has(a)), MOTION_ACTION_IDS.filter((a) => !ACTION_REGISTRY.has(a)));
  ok("82. every move in the live view names only registered ids", M.all.every((i) => !i.move || i.move.actionIds.every((a) => ACTION_REGISTRY.has(a))));
  ok("83. motion never writes / pushes / schedules / crons (#65)", !/sendPush|setInterval|setTimeout|cron|createCalendarEvent|supabase|\.from\(/.test(code(read("lib/partner/coo/motion.ts"))));
  ok("84. patterns / learning are INPUTS (no separate competing priority list) (#61)", !M.all.some((i) => i.key.startsWith("pattern:")) && Array.isArray(M.patterns));
  ok("85. the send log is untouched: motion has no send-log write / liveBall rewrite (#55)", !/UPDATE_SEND_LOG_ENTRY|DELETE_SEND_LOG_ENTRY|liveBall\s*=/.test(code(read("lib/partner/coo/motion.ts"))));
  const q = queryKnowledgeCore(PARTNER_KNOWLEDGE_REGISTRY, { capability: "coo", mode: "motion" }, src() as never, OWNER);
  ok("86. capability coo mode motion: OK, MOTION fact + answer", q.status === "OK" && q.summary.some((x) => x.code === "MOTION") && q.summary.some((x) => x.code === "ANSWER"), q.status);
  const qp = queryKnowledgeCore(PARTNER_KNOWLEDGE_REGISTRY, { capability: "coo" }, src() as never, OWNER);
  ok("87. capability coo priorities: items = motion today (keys)", qp.status === "OK" && qp.items.map((i) => (i.fields as { key: string }).key).join("|") === V.motion.todayItems.map((i) => i.key).join("|"));

  section("13. TRANSLITERATION — a candidate, never a link");
  const idx = buildMentionIndex(src());
  const pm = findPartialMentions("צריך לקדם את הפרויקט עם גרמי", idx);
  ok("88. 'גרמי' finds the 'ג'רמי קול חבש' records as a PARTIAL_NAME candidate (AMBIGUOUS, never a link)", pm.some((m) => m.reason === "PARTIAL_NAME" && m.quality === "AMBIGUOUS" && m.keys.some((k) => k === `client:${U(92)}` || k === K(P_TZOADIM) || k === K(P_BAM))), pm);
  ok("89. no hard-coded Jeremy alias anywhere", !/גרמי|jeremy/i.test(code(read("lib/partner/knowledge/inbox-mentions.ts") + read("lib/partner/coo/motion.ts"))));

  section("14. COVERAGE TEXT");
  ok("90. no capability claims Partner cannot read Google Calendar any more", !/Partner לא קורא את Google Calendar|Sunny does NOT read or write the calendar|Google Calendar itself is not read by Sunny/.test(read("lib/partner/knowledge/capabilities/label.ts") + read("lib/partner/knowledge/capabilities/operations.ts") + read("lib/partner/knowledge/capabilities/work.ts")));

  section("15. ZERO INBOX = ROUTE, NOT HIDE (Owner decision 2026-10-05)");
  const N = (id: number, body: string, d: number, link?: string) => ({ id: U(id), body, at: `${D(d)}T10:00:00Z`, ...(link ? { link } : {}) });
  const MAOR = { id: U(80), body: "היום עם מאור היה סשן טוב אבל חייב להתקדם", at: `${D(-5)}T23:21:00Z`, link: K(P_MAOR) };
  const YAH_MIX = N(101, "דחוף למקססס את יהלום", 0);
  const YAH_CHORUS = N(102, "לשנות את העטיפה של יהלום", 0);
  const TECH = N(103, "לתקן התראות של סטיבן", 0);
  const ASK = N(104, "צריך לחשוב על זה שוב", -1);
  const TZ = N(106, "חיזקתי את ההפקה לצועדים", -4, K(P_TZOADIM));
  const OLD_CLOSER = N(105, "צריך לבדוק את המיקס של קרוב אלייך", -6, K(P_CLOSER));
  const mix = motionOf({ inbox: [MAOR, TZ, YAH_MIX, YAH_CHORUS, TECH, ASK, OLD_CLOSER] });
  const entry = (m: BusinessMotion, id: string) => m.inbox.entries.find((e) => e.lifecycle.itemId === id);
  const yMix = entry(mix, YAH_MIX.id)!, yCh = entry(mix, YAH_CHORUS.id)!;
  ok("96. (1) a NEW unlinked update went through understand → lifecycle BEFORE curation (entity resolved, state decided)", !!yMix && yMix.lifecycle.entitySource === "LIKELY" && yMix.lifecycle.entityKeys.includes(K(P_YAHALOM)) && !!yMix.lifecycle.state, yMix?.lifecycle);
  ok("97. (2) a meaningful UNREAD not covered by a move does NOT disappear — counted as 'צריך ניתוב'", yCh.lifecycle.state === "UNREAD" && !yCh.absorbedBy && mix.inbox.unrouted >= 1 && /צריך ניתוב|צריכים ניתוב/.test(mix.inbox.lineHe ?? ""), mix.inbox.lineHe);
  ok("98. (3) LIKELY same project but the move does not cover its content (עטיפה ≠ open mix) → NOT absorbed", !yCh.absorbedBy);
  const yItem = itemFor(mix, K(P_YAHALOM))!;
  ok("99. (4) LIKELY same project + the proposed move covers it (מיקס ↔ CREATE_ENGINEER_WORK) → absorbed AS A HYPOTHESIS ('כנראה', evidence HYPOTHESIS, no link stored)", !!yMix.absorbedBy && yItem.reasonsHe.some((r) => r.startsWith("כנראה זה גם מה שכתבת")) && yItem.evidence.some((e) => e.ref === `owner-inbox:${YAH_MIX.id}` && e.epistemic === "HYPOTHESIS") && yMix.lifecycle.entitySource === "LIKELY", { absorbedBy: yMix.absorbedBy, reasons: yItem.reasonsHe });
  const maorE = entry(mix, TZ.id)!;
  ok("100. (5) LINKED + reflected in a move → not duplicated in the greeting (absorbed, not counted, text not repeated)", !!maorE.absorbedBy && !/חיזקתי/.test(mix.inbox.lineHe ?? ""));
  const maorOnly = entry(mix, MAOR.id)!;
  ok("100d. a LINKED update whose only carrier is an unserved INFO move is NOT 'משוקף' — it stays 'צריך ניתוב'", !maorOnly.absorbedBy && maorOnly.lifecycle.state === "UNREAD" && /ועוד 2 עדיין צריכים ניתוב/.test(mix.inbox.lineHe ?? ""), mix.inbox.lineHe);
  ok("100b. absorbedBy names a move that really carries the update as evidence", mix.inbox.entries.filter((e) => e.absorbedBy).every((e) => mix.all.some((i) => i.key === e.absorbedBy && i.evidence.some((x) => x.ref === `owner-inbox:${e.lifecycle.itemId}`))), mix.inbox.entries.map((e) => e.absorbedBy));
  const servedKeys = new Set([...mix.todayItems, ...mix.greeting, ...mix.atRisk, ...mix.closeLoops, ...mix.label, ...mix.watch].map((i) => i.key));
  ok("100c. absorbed only by a move Sunny SERVES (an unserved INFO move never makes an update 'משוקף')", mix.inbox.entries.filter((e) => e.absorbedBy).every((e) => servedKeys.has(e.absorbedBy!)));
  const tech = entry(mix, TECH.id)!;
  ok("101. (6) a technical unresolved update is represented ('עדכון טכני אחד עדיין פתוח'), never silently dropped", tech.lifecycle.technical && (tech.lifecycle.state === "UNREAD" ? /עדכון טכני אחד עדיין פתוח/.test(mix.inbox.lineHe ?? "") : tech.lifecycle.state === "NEEDS_OWNER"), { state: tech.lifecycle.state, line: mix.inbox.lineHe });
  const old = entry(mix, OLD_CLOSER.id)!;
  ok("102. (7) OVERTAKEN → not shown (no count, no text)", old.lifecycle.state === "OVERTAKEN" && !/קרוב אלייך/.test(mix.inbox.lineHe ?? ""), old.lifecycle.state);
  ok("103. (8) NEEDS_OWNER → appears once (one count, the inbox mentioned once in the answer, no raw text)", mix.inbox.needsOwner === 1 && /עדכון אחד צריך ממך הבהרה/.test(mix.inbox.lineHe ?? "") && (mix.answerHe.match(/מהתיבה/g) ?? []).length === 1 && !/לחשוב על זה שוב/.test(mix.answerHe), mix.inbox.lineHe);
  // (9) + (10) — the SAME history through the SAME decideInboxLifecycle on both surfaces
  const hist = [{ planId: "pl_deadline", at: `${D(0)}T12:00:00Z`, outcome: "EXECUTED", approvedBy: "OWNER_APPROVAL", steps: [{ actionId: "UPDATE_PROJECT_DEADLINE", entity: K(P_YAHALOM), outcome: "APPLIED_AS_EXPECTED" }] }];
  const fx9 = { inbox: [MAOR, YAH_MIX, YAH_CHORUS, TECH, ASK, OLD_CLOSER] };
  const ib = deriveWithActionHistory("inbox", queryKnowledgeCore(PARTNER_KNOWLEDGE_REGISTRY, { capability: "owner_inbox", mode: "understand" }, src(fx9) as never, OWNER) as never, hist, Date.parse(`${TODAY}T18:00:00Z`)) as { items: Array<{ fields: { lifecycle: { itemId: string; state: string } } }>; summary: Array<{ code: string; value: { counts: Record<string, number> } }> };
  const brief9 = deriveWithActionHistory("motion", { motion: motionSummary(motionOf(fx9)) } as never, hist, Date.parse(`${TODAY}T18:00:00Z`)) as { motion: { inbox: { entries: Array<{ lifecycle: { itemId: string; state: string } }>; counts: Record<string, number>; needsOwner: number; unread: number; lineHe: string | null }; answerHe: string } };
  const ibState = (id: string) => ib.items.find((i) => i.fields.lifecycle?.itemId === id)?.fields.lifecycle.state;
  const mState = (id: string) => brief9.motion.inbox.entries.find((e) => e.lifecycle.itemId === id)?.lifecycle.state;
  ok("104. (9) יהלום: owner_inbox lifecycle == motion lifecycle under the same history (both see the deadline plan)", ibState(YAH_MIX.id) === mState(YAH_MIX.id) && mState(YAH_MIX.id) === "UNDERSTOOD_OPEN", { inbox: ibState(YAH_MIX.id), motion: mState(YAH_MIX.id) });
  const ibCounts = ib.summary.find((x) => x.code === "EXECUTIVE")!.value.counts;
  ok("105. (10) every state count is identical in owner_inbox and motion (NEEDS_OWNER / UNREAD …)", JSON.stringify(ibCounts) === JSON.stringify(brief9.motion.inbox.counts) && brief9.motion.inbox.needsOwner === ibCounts.NEEDS_OWNER && brief9.motion.inbox.unread === ibCounts.UNREAD, { ibCounts, motion: brief9.motion.inbox.counts });
  ok("105b. the re-derived line is inside the answer the greeting serves", brief9.motion.inbox.lineHe !== null && brief9.motion.answerHe.includes(brief9.motion.inbox.lineHe));
  const onlyAsk = motionOf({ inbox: [ASK] });
  const onlyUnrouted = motionOf({ inbox: [YAH_CHORUS] });
  ok("106. (11) 'משוקפים' only when something really is reflected / absorbed / overtaken / understood", !/משוקפים/.test(onlyAsk.inbox.lineHe ?? "") && !/משוקפים/.test(onlyUnrouted.inbox.lineHe ?? "") && /משוקפים/.test(mix.inbox.lineHe ?? "") && motionOf({ inbox: [TZ] }).inbox.lineHe === null, { ask: onlyAsk.inbox.lineHe, unrouted: onlyUnrouted.inbox.lineHe, mix: mix.inbox.lineHe });
  ok("106b. the greeting never dumps the update list", !/דחוף למקססס|העטיפה|התראות של סטיבן/.test(mix.inbox.lineHe ?? "") && !/עדכונים מהתיבה:/.test(mix.answerHe));
  const mot = read("lib/partner/coo/motion.ts"), wh = read("lib/partner/sunny/with-history.ts");
  ok("107. (12) no new lifecycle and no writes: motion uses inboxTriageOf; the re-decision is the ONE decideInboxLifecycle (with-history); no link / store / push", mot.includes("inboxTriageOf(src)") && !mot.includes("decideInboxLifecycle") && /motionInboxOf\(ib\.read, ib\.entries\.map\(\(e\) => motionInboxEntry\(decideInboxLifecycle\(e\.lifecycle, history\)/.test(wh) && !/LINK_INBOX_ENTITY|supabase|\.from\(|sendPush/.test(code(mot)));


  section("16. FRESH-CHAT QA CORRECTNESS (2026-10-05)");
  const closerItem = itemFor(M, K(P_CLOSER));
  ok("108. completion provenance: no invented actor ('אצל Steven אושר' never) — the work is marked 'אושר' and the finals were uploaded", !!closerItem && closerItem.reasonsHe.some((r) => r.includes("מסומנת 'אושר' והקבצים הסופיים הועלו")) && !/אצל \S+ אושר/.test(JSON.stringify(M)), closerItem?.reasonsHe);
  const protectedArtists = M.label.filter((i) => i.labelProtected && i.move);
  const weekAnswerLine = M.answerHe.split("\n").find((l) => l.startsWith("השבוע:")) ?? "";
  ok("109. the week line names the CONCRETE existing move of every protected label artist (never generic; no cadence)", M.week.capacity === "OPEN" && protectedArtists.length > 0 && protectedArtists.every((i) => M.week.lineHe.includes(`${i.titleHe} → ${i.move!.he}`) && weekAnswerLine.includes(`${i.titleHe} → ${i.move!.he}`)) && !/יש זמן לסשנים/.test(M.answerHe), { week: M.week.lineHe, protected: protectedArtists.map((i) => i.titleHe) });
  ok("109b. the opportunity line does not repeat what the week line already names", protectedArtists.every((i) => !M.week.opportunity?.candidates.includes(i.key)));
  const lastLine = M.answerHe.split("\n").pop() ?? "";
  ok("111. the greeting ENDS with the recommendation (never 'במה מתחילים?') — execution needs approval", lastLine.startsWith(`אני הייתי מתחילה ב${M.greeting[0].titleHe}`) && !/במה (נתחיל|מתחילים)\?/.test(M.answerHe), lastLine);
  ok("111b. the instructions forbid handing the ranking back to the Boss", SERVER_INSTRUCTIONS.includes("never which to start with"));
  ok("110. the capacity line stays a suggestion (never a calendar write)", /הצעה בלבד/.test(M.week.opportunity?.he ?? ""));


  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
