/**
 * The BUSINESS_MOTION company fixture (shaped like the 2026-10-05 production benchmark; never production data) —
 * shared by scripts/test-sunny-motion.tsx and scripts/test-dashboard-sunny-parity.tsx so the dashboard parity proof
 * runs on the SAME company the motion contract is proven on.
 */
import type { GatewaySources } from "../../lib/partner/gateway/core";
import { SHALEV_ARTIST_ID } from "../../lib/red-artists/portal-registry";
import { AVI_ARTIST_ID } from "../../lib/roles";
export const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const TODAY = "2026-10-05";
export const D = (n: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const OWNER = { channel: "INTERNAL" as const, ownerAuthorized: true };

// ── ids (shaped like the 2026-10-05 production benchmark; never production data) ──
export const A_NAGASH = U(3), A_CT = U(4);
export const P_CLOSER = U(10), P_YAHALOM = U(11), P_TZOADIM = U(12), P_BAM = U(13), P_LO = U(14), P_EIN = U(15), P_HALAS = U(16), P_DH = U(17), P_MAOR = U(18), P_CLIP = U(19), P_TAS = U(20), P_KESEF = U(21);
export const W_CLOSER = U(30), W_DH = U(31);
export const RF_CLIP = U(40);
export const K = (id: string) => `project:${id}`;

export interface Fx { calendar?: unknown; holidays?: boolean; busyDays?: number[]; victorRest?: number; finance?: unknown; inbox?: Array<{ id: string; body: string; at: string; link?: string }>; knowledge?: unknown[]; noLabelNeed?: boolean; extraVictor?: unknown[]; closerNoFinals?: boolean; closerPaidOnly?: boolean; noState?: boolean; shows?: unknown[]; noWork?: boolean; extraSendLog?: unknown[] }

export const proj = (name: string, o: Record<string, unknown> = {}) => ({ name, status: "בעבודה", artistText: null, businessType: "לקוח", projectType: "שיר", ...o });
/** the project-detail Victor row behind a vwork: an upload with no notes after it = the Owner's ball; notes after it = Victor's */
export const detVictorRow = (w: { id: string; projectId: string | null; title: string; ball: { holder: string }; lastUploadAt: string }) => ({
  id: w.id, projectId: w.projectId, vendorName: "victor", title: w.title, status: "פעיל", workState: null, sentDate: null, internalDeadline: null, linkedTaskId: null,
  notes: null, briefText: null, references: [], filesSent: [{ name: "v1.wav", uploadedAt: w.lastUploadAt, versionLabel: "v1", durationSeconds: null, size: null, hasShareLink: false, path: null, uploadedBy: "victor" }], filesReceived: [], briefFiles: [],
  reviews: w.ball.holder === "victor" ? [{ version: "v1", sentAt: new Date(Date.parse(w.lastUploadAt) + 3600_000).toISOString(), draft: false, notes: "x", sentNotes: "x", status: "waiting" }] : [],
  returnedDate: null, outcome: null, quality: null, enteredProject: null, dropboxFolder: null, hasFolderLink: false, createdAt: null, updatedAt: null,
});
export const vwork = (id: string, projectId: string | null, title: string, holder: string, uploadAt: string) => ({ id, projectId, title, workState: null, ball: { holder }, isStuck: false, daysSinceSent: 10, lastUploadAt: uploadAt, lastNotesSentAt: null, uploads: [uploadAt], internalDeadline: null });
export const calEvent = (id: string, title: string, startIso: string, endIso: string, o: Record<string, unknown> = {}) => ({ id, calendarId: "primary", calendarName: null, holidayCalendar: false, title, untitled: false, description: null, start: startIso, end: endIso, allDay: false, timeZone: "Asia/Jerusalem", durationMinutes: null, location: null, attendees: [], attendeesOmitted: false, selfResponse: null, organizer: null, creator: null, invited: false, recurringEventId: null, originalStartTime: null, recurrence: null, status: "confirmed", eventType: "default", transparency: "opaque", visibility: null, created: null, updated: null, hasMeetingLink: false, hasAttachments: false, attachmentCount: 0, ...o });
export const holiday = (id: string, title: string, start: string, end: string) => calEvent(id, title, start, end, { allDay: true, holidayCalendar: true, transparency: "transparent" });
export const calWindow = (events: unknown[]) => ({ status: "CALENDAR_DATA_AVAILABLE", window: { start: D(-7), end: D(30), days: 37 }, fetchedAt: `${TODAY}T08:00:00Z`, cache: "NONE", calendars: [], events, truncated: false, reasons: [] });
export const fullDay = (n: number) => calEvent(`full-${n}`, "יום עמוס", `${D(n)}T05:00:00Z`, `${D(n)}T14:30:00Z`);
export const dsession = (id: string, projectId: string | null, date: string, o: Record<string, unknown> = {}) => ({ id, projectId, showId: null, date, startTime: "12:00", endTime: "15:00", status: (o.status as string) ?? "התקיים", type: (o.type as string) ?? "סשן", statusSource: (o.source as string) ?? "MANUAL", statusChangedAt: null, title: null, notes: null, location: null, photographer: null, cost: null, hasCalendarEvent: false, createdAt: (o.created as string) ?? `${D(-40)}T10:00:00Z` });
export const tx = (id: string, projectId: string, type: string, amount: number, status: string) => ({ id, projectId, type, date: D(-20), amount, currency: "₪", status, category: null, scope: null, expenseScope: null, linkedSessionId: null });
export const setting = (projectId: string, agreedPrice: number) => ({ projectId, value: { agreedPrice, currency: "₪" } });
export const inboxItem = (id: string, body: string, createdAt: string) => ({ id, createdAt, body, author: "OWNER", epistemic: "OWNER_REPORTED", source: "DASHBOARD_V2", status: "NEW", processedAt: null, processedVia: null, outcome: null, outcomeRef: null });
export const ilink = (id: string, itemId: string, entityKey: string) => ({ id, itemId, entityKey, quality: "EXACT_UNIQUE", method: "RESOLVER_UNIQUE", surface: "x", candidates: null, createdAt: `${D(-4)}T08:01:00Z`, retractedAt: null, retractedReason: null });
export const blocker = (id: string, subjectKey: string, detail: string, createdAt: string) => ({ id, createdAt, kind: "PROJECT_BLOCKER", subjectKey, identityKeys: [subjectKey], slotKey: `PROJECT_BLOCKER:${subjectKey}`, value: { detail, reason: "WAITING_FOR_ARTIST" }, epistemic: "OWNER_REPORTED", meaningHe: detail, operation: "ASSERT", supersedesId: null, status: "ACTIVE", reviewAt: null, expiresAt: null, via: "SUNNY", notes: [] });

export function src(fx: Fx = {}): GatewaySources {
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
  const sendLog = [{ id: U(73), projectId: P_CLOSER, actionType: "sent", contentType: "הפקה", recipientRole: "external_producer", recipientName: null, status: "pending_version", actionDate: D(-93), followupDate: D(-91) }, ...((fx.extraSendLog ?? []) as never[])];
  const ops = { redFilms: { rows: [{ id: RF_CLIP, title: "בלאגן", productionType: "קליפ", status: "יום צילום נקבע", projectId: P_CLIP, clientId: null, artistName: "טל צגאי", clientSource: null, shootDate: D(-1), publishDate: null, editStatus: null, collectionStatus: null, generalBudget: 0, clientPrice: null, advanceRequired: null, advanceReceived: null }], capped: false },
    projectsMeta: { rows: meta, capped: false }, engineerWork: { rows: fx.noWork ? [] : engineer, capped: false }, mixVersions: { rows: versions, capped: false }, mixComments: { rows: [], capped: false }, finalFiles: { rows: finals, capped: false },
    meetings: { rows: [], capped: false }, projectActions: { rows: sendLog, capped: false }, calendarLinks: { rows: [], capped: false }, clipItems: { rows: [], capped: false }, campaigns: { rows: [], capped: false }, albumTracks: { rows: [], capped: false }, deliveries: { rows: [], capped: false }, budgetPayments: { rows: [], capped: false }, equipment: { rows: [], capped: false } };
  const det = { productions: { rows: [], capped: false }, budgetItems: { rows: [], capped: false }, budgetPayments: { rows: [], capped: false }, rfDocuments: { rows: [], capped: false }, rfRefImages: { rows: [], capped: false }, rfRefLinks: { rows: [], capped: false }, rfCrew: { rows: [], capped: false },
    tasks: { rows: [], capped: false }, sessions: { rows: detSessions, capped: false }, meetings: { rows: [], capped: false }, releases: { rows: [{ projectId: P_LO, nextAction: null, blocker: null, responsible: null, stageEnteredAt: null, releasedAt: null }], capped: false },
    mixVersions: { rows: versions, capped: false }, mixComments: { rows: [], capped: false }, mixTargets: { rows: [], capped: false }, mixTargetNotes: { rows: [], capped: false }, actions: { rows: sendLog, capped: false },
    // the SAME Victor / engineer rows the eyes state carries (production reads both from one table) — needs_me, the ONE
    // recorded project-ball rule (projectBalls), reads them from here
    victor: { rows: victor.map(detVictorRow), capped: false }, engineerWork: { rows: fx.noWork ? [] : engineer, capped: false } };
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
