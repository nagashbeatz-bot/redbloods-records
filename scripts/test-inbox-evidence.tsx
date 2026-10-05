/**
 * Owner Inbox — contextual business resolution (Owner decision 2026-10-01). The cases the Owner asked for, on fixtures
 * built like the real records:
 *   A  חיים — the REFERENCE case: two people named חיים, only חיים באינסאי has an active mix at Steven ("קרוב אלייך")
 *   B  חיים — both have an active mix (both recent) → ask
 *   C  מאור — a first name + a session on the day the update refers to (night rule) → that project; record says "מתוכנן"
 *   D  שליו — several שליו; only one project had a session yesterday → it; and without any session → do not invent
 *   E  גרמי — nothing in the records → UNRESOLVED with what was searched; deep notes → weak only (never LIKELY)
 *   F  no name ("נשארו רק שני תיקונים במיקס") from the dashboard → NONE even with one active mix in the company
 *   G  a name that matches but the business contradicts (no mix work) → never chosen by name
 *   H  an album with a project-level mix work → no invented song; a track only when the work title IS a track title
 *   I  the text names Steven, the candidate's mix is at another engineer → not chosen
 *   J  an approved Owner alias resolves the entity
 *   K  two similar candidates, only one moving NOW (a recent version) → that one, LIKELY
 * Run with:   npx tsx scripts/test-inbox-evidence.tsx      Pure; never touches production.
 */
import { buildMentionIndex } from "../lib/partner/knowledge/inbox-mentions";
import { resolverProjectsOf } from "../lib/partner/knowledge/inbox-understand";
import { graphOf, resolveUpdate, type UnderstoodUpdateV2 } from "../lib/partner/knowledge/inbox-evidence";
import { extractSignals } from "../lib/partner/knowledge/inbox-signals";
import { ownerInbox } from "../lib/partner/knowledge/capabilities/sunny";
import type { OwnerInboxItem } from "../lib/owner-inbox";
import type { GatewaySources } from "../lib/partner/gateway/core";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 900)}` : ""}`); } };
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

interface P { id: string; name: string; status: string; artist: string; type?: string; deadline?: string | null; songProjectId?: string | null; hidden?: boolean }
interface Fx {
  clients?: Array<{ id: string; name: string }>; artists?: Array<{ id: string; name: string }>; projects: P[];
  works?: Array<{ id: string; projectId: string; engineer: string; type?: string; status: string; title?: string | null }>;
  versions?: Array<{ id: string; workId: string; createdAt: string }>; comments?: Array<{ versionId: string; status: string }>;
  sessions?: Array<{ id: string; projectId: string; date: string; status: string }>; tracks?: Array<{ id: string; projectId: string; n: number; title: string }>;
  knowledge?: Array<Record<string, unknown>>; notes?: Array<{ id: string; notes: string }>;
}
function src(f: Fx): GatewaySources {
  const empty = { data: { items: [] } };
  const state = {
    todayIL: "2026-10-01",
    domains: {
      projects: { data: { index: Object.fromEntries(f.projects.map((p) => [p.id, { name: p.name, status: p.status, artistText: p.artist, businessType: "לקוח" }])), open: f.projects.filter((p) => !["הושלם", "בוטל"].includes(p.status)).map((p) => ({ id: p.id, projectType: p.type ?? "שיר", deadline: { ymd: p.deadline ?? null, daysTo: null }, daysSinceUpdate: 1 })) } },
      clients: { data: { items: (f.clients ?? []).map((c) => ({ ...c, type: "אמן", status: "פעיל" })) } },
      labelArtists: { data: { items: (f.artists ?? []).map((a) => ({ ...a, status: "פעיל" })) } },
      shows: empty, victor: { data: { active: [] } }, releasesFull: empty, proposalsFull: empty, tasksFull: empty,
      sessions: { data: { items: (f.sessions ?? []).map((s) => ({ id: s.id, projectId: s.projectId, showId: null, dateYmd: s.date, status: s.status, sessionType: "סשן" })) } },
    },
  };
  const ops = {
    projectsMeta: { rows: f.projects.map((p) => ({ id: p.id, name: p.name, status: p.status, projectType: p.type ?? "שיר", businessType: "לקוח", artistText: p.artist, deadline: p.deadline ?? null, startDate: null, endDate: null, parentProject: null, isHidden: !!p.hidden, songProjectId: p.songProjectId ?? null, plannedHours: null, plannedDays: null, updatedAt: null })), capped: false },
    engineerWork: { rows: (f.works ?? []).map((w) => ({ id: w.id, projectId: w.projectId, engineerName: w.engineer, workType: w.type ?? "מיקס + מאסטר", workTitle: w.title ?? null, status: w.status, sentDate: null, internalDeadline: null, agreedPrice: null, amountPaid: null, currency: null, paymentDate: null })), capped: false },
    mixVersions: { rows: (f.versions ?? []).map((v) => ({ ...v, status: null })), capped: false },
    mixComments: { rows: f.comments ?? [], capped: false },
    albumTracks: { rows: (f.tracks ?? []).map((t) => ({ id: t.id, projectId: t.projectId, trackNumber: t.n, title: t.title, status: null, mixStatus: null, masterStatus: null })), capped: false },
    projectActions: { rows: [], capped: false }, redFilms: { rows: [], capped: false },
  };
  const detail = { projects: { rows: (f.notes ?? []).map((n) => ({ id: n.id, createdAt: null, legacyMondayId: null, notes: n.notes, workMaterials: null, dropboxFolder: null, files: [] })), capped: false }, sessions: { rows: [], capped: false }, tasks: { rows: [], capped: false } };
  return { now: new Date("2026-10-01T09:00:00Z"), identities: { cleantone: null }, state: { status: "OK", value: state }, operations: { status: "OK", value: ops }, ownerKnowledge: { status: "OK", value: f.knowledge ?? [] }, projectDetail: { status: "OK", value: detail }, ownerInbox: { status: "OK", value: [] }, inboxMemory: { status: "OK", value: { links: [], interpretations: [] } } } as never;
}
const item = (body: string, at = "2026-10-01T09:00:00Z"): OwnerInboxItem => ({ id: U(999), createdAt: at, body, author: "OWNER", epistemic: "OWNER_REPORTED", source: "DASHBOARD_V2", status: "NEW", processedAt: null, processedVia: null, outcome: null, outcomeRef: null });
const run = (f: Fx, body: string, at?: string, deep = false): UnderstoodUpdateV2 => { const s = src(f); return resolveUpdate(item(body, at), graphOf(s, buildMentionIndex(s), resolverProjectsOf(s)), deep); };
const codes = (r: UnderstoodUpdateV2) => (r.resolution.chosen?.evidence ?? []).map((e) => e.code);
const chain = (r: UnderstoodUpdateV2) => (r.resolution.chosen?.chain ?? []).map((c) => `${c.level}:${c.name}`);

// ── the real records, as fixtures ──
const C_HB = U(1), C_HT = U(2), P_KAROV = U(10), P_PESHA = U(11);
const haim: Fx = {
  clients: [{ id: C_HB, name: "חיים באינסאי" }, { id: C_HT, name: "חיים טסאו" }],
  projects: [
    { id: P_KAROV, name: "קרוב אלייך", status: "במיקס", artist: "חיים באינסאי", deadline: "2026-10-07" },
    { id: P_PESHA, name: "פשע", status: "בעבודה", artist: "נגש ביטס, שליו טסמה, ליל גטי, חיים טסאו", deadline: "2026-05-18" },
  ],
  works: [{ id: U(20), projectId: P_KAROV, engineer: "Steven", status: "בתהליך" }],
  versions: Array.from({ length: 22 }, (_, n) => ({ id: U(100 + n), workId: U(20), createdAt: `2026-09-${String(5 + n).padStart(2, "0")}T10:00:00Z` })),
  comments: [{ versionId: U(121), status: "open" }],
  knowledge: [{ id: U(30), createdAt: "2026-09-27T20:44:02Z", kind: "PROJECT_BLOCKER", subjectKey: `project:${P_KAROV}`, identityKeys: [`project:${P_KAROV}`], slotKey: "x", value: {}, epistemic: "OWNER_REPORTED", meaningHe: "קרוב אלייך תקוע: מחכים לתיקונים מסטיבן מאז 27.09", operation: "ASSERT", supersedesId: null, reviewAt: null, expiresAt: null, provenance: {}, confirmationId: "c", itemIndex: 0 }],
};
const HAIM_TEXT = "חיים אוהב את המיקס , יש עוד איזה 2 תיקונים וסיימנו עם המיקס";

console.log("Signals (fixed lexicon, team, time with the night rule)");
const sg = extractSignals(HAIM_TEXT, "2026-09-30T23:22:26Z");
ok("MIX words, the number 2, no team named", sg.work.includes("MIX") && sg.numbers.includes(2) && sg.team.length === 0);
const sm = extractSignals("היום עם מאור היה סשן טוב אבל חייב להתקדם", "2026-09-30T23:21:09Z");
ok("night rule: 'היום' written at 02:21 (Israel) covers 01.10 AND 30.09; reports it happened", sm.work.includes("SESSION") && sm.days.join() === "2026-09-30,2026-10-01" && sm.reportsHappened);
ok("a team name with a Hebrew prefix ('לסטיבן') is the team member", extractSignals("שלחתי לסטיבן", "2026-10-01T09:00:00Z").team.join() === "STEVEN");

console.log("\nA — the reference case (חיים → קרוב אלייך → mix at Steven)");
const a = run(haim, HAIM_TEXT, "2026-09-30T23:22:26Z");
ok("LIKELY with HIGH confidence", a.resolution.status === "LIKELY" && a.resolution.confidence === "HIGH", a.resolution);
ok("the chain reaches חיים באינסאי → קרוב אלייך → the song → the mix + master at Steven", JSON.stringify(chain(a)) === JSON.stringify(["PERSON:חיים באינסאי", "PROJECT:קרוב אלייך", "SONG:קרוב אלייך", "WORK:מיקס + מאסטר אצל Steven (בתהליך)"]), chain(a));
ok("evidence: MIX_ACTIVE (22 versions) + STATUS_MATCH + OPEN_REVISIONS + ACTIVE_ENGINEER_MATCH + DEADLINE_SOON", ["MIX_ACTIVE", "STATUS_MATCH", "OPEN_REVISIONS", "ACTIVE_ENGINEER_MATCH", "DEADLINE_SOON"].every((c) => codes(a).includes(c)) && (a.resolution.chosen?.evidence.find((e) => e.code === "MIX_ACTIVE")?.he ?? "").includes("22 גרסאות"), codes(a));
ok("NOT ENGINEER_NAMED — the Boss did not write Steven", !codes(a).includes("ENGINEER_NAMED"));
ok("the other חיים is an alternative with only weak evidence — no engineer work is NOT a contradiction (the Boss may mix himself; One Brain 2026-10-05)", a.resolution.alternatives.some((x) => x.project === "פשע" && x.evidence.includes("NO_ENGINEER_WORK") && !x.evidence.some((e) => e.endsWith("!"))), a.resolution.alternatives);
ok("context: status, deadline 2026-10-07, and the Owner's blocker (waiting for Steven's fixes since 27.09)", a.context?.status === "במיקס" && a.context.deadline === "2026-10-07" && (a.context.blocker ?? "").includes("27.09"), a.context);

console.log("\nB — two חיים, both with an active (recent) mix → ask");
const b = run({ ...haim, works: [...haim.works!, { id: U(21), projectId: P_PESHA, engineer: "Steven", status: "בתהליך" }], versions: [...haim.versions!, { id: U(200), workId: U(21), createdAt: "2026-09-29T10:00:00Z" }] }, HAIM_TEXT, "2026-09-30T23:22:26Z");
ok("AMBIGUOUS, no chosen, both options with their evidence", b.resolution.status === "AMBIGUOUS" && b.resolution.chosen === null && b.resolution.alternatives.length === 2, b.resolution);

console.log("\nC — מאור: a first name + the session of that day");
const P_MAOR = U(40);
const maor: Fx = { clients: [{ id: U(41), name: "מאור אהרון" }], projects: [{ id: P_MAOR, name: "מאור ראנקינג אהרון", status: "לא התחיל", artist: "מאור אהרון", deadline: null }], sessions: [{ id: U(42), projectId: P_MAOR, date: "2026-09-30", status: "מתוכנן" }, { id: U(43), projectId: P_MAOR, date: "2026-09-02", status: "התקיים" }] };
const c = run(maor, "היום עם מאור היה סשן טוב אבל חייב להתקדם ,", "2026-09-30T23:21:09Z");
ok("LIKELY: מאור אהרון → מאור ראנקינג אהרון → the 30.09 session (SESSION_ON_DAY)", c.resolution.status === "LIKELY" && codes(c).includes("SESSION_ON_DAY") && chain(c).includes("SESSION:סשן 30.09 (מתוכנן)") && chain(c)[0] === "PERSON:מאור אהרון", { s: c.resolution.status, chain: chain(c), codes: codes(c) });
ok("record vs report: he says it happened, the record still says מתוכנן (never changed by itself)", (c.resolution.chosen?.recordVsReport ?? []).some((x) => x.includes("מתוכנן") && x.includes("לא משנה לבד")));
ok("context: no next session", c.context?.nextSession === null);

console.log("\nD — שליו: several people; the session of yesterday decides");
const A_ST = U(50), P_EIN = U(51), P_HAL = U(52), P_BIT = U(53);
const shalev: Fx = {
  artists: [{ id: A_ST, name: "שליו טסמה" }], clients: [{ id: U(54), name: "שליו טסמה" }, { id: U(55), name: "שליו ביטון" }],
  projects: [{ id: P_EIN, name: "אין לך", status: "בעבודה", artist: "שליו טסמה" }, { id: P_HAL, name: "חלהס אמפיאנו", status: "בעבודה", artist: "שליו טסמה" }, { id: P_BIT, name: "ריקוד", status: "בעבודה", artist: "שליו ביטון" }],
  sessions: [{ id: U(56), projectId: P_EIN, date: "2026-09-30", status: "התקיים" }, { id: U(57), projectId: P_HAL, date: "2026-09-22", status: "התקיים" }],
};
const SH_TEXT = "הסשן עם שליו היה די טוב אתמול , צריך לעבוד עדיין על הוורס השני";
const d = run(shalev, SH_TEXT);
ok("LIKELY: the one project with a session yesterday (אין לך)", d.resolution.status === "LIKELY" && chain(d).includes("PROJECT:אין לך") && codes(d).includes("SESSION_ON_DAY"), { s: d.resolution.status, chain: chain(d), alts: d.resolution.alternatives });
const d2 = run({ ...shalev, sessions: [] }, SH_TEXT);
ok("without any session around yesterday → NOT LIKELY (contradictions shown) — nothing invented", d2.resolution.status !== "LIKELY" && d2.resolution.contradictions.some((x) => x.code === "NO_SESSION_ON_DAY"), d2.resolution);

console.log("\nE — גרמי: nothing in the records");
const e = run(haim, "צריך לקדם את הפרויקט עם גרמי");
ok("UNRESOLVED + what was searched + 'not found: גרמי'", e.resolution.status === "UNRESOLVED" && e.resolution.searched.length >= 2 && e.resolution.missing.some((m) => m.includes("גרמי")), e.resolution);
const eDeep = run({ ...haim, notes: [{ id: P_KAROV, notes: "לדבר עם גרמי על הבאקים" }] }, "צריך לקדם את הפרויקט עם גרמי", undefined, true);
ok("deep: a notes mention is WEAK — AMBIGUOUS with the project as an option, never LIKELY", eDeep.resolution.status === "AMBIGUOUS" && eDeep.resolution.alternatives.some((x) => x.project === "קרוב אלייך" && x.evidence.includes("NOTES_MENTION")), eDeep.resolution);

console.log("\nF — no name, from the dashboard");
const f = run(haim, "נשארו רק שני תיקונים במיקס");
ok("NONE — never 'the only active mix in the company'", f.resolution.status === "NONE" && f.resolution.chosen === null, f.resolution);

console.log("\nG — the name matches, the business contradicts");
const g = run({ ...haim, works: [], versions: [], comments: [], projects: [{ ...haim.projects[0], status: "לא התחיל" }, haim.projects[1]] }, HAIM_TEXT);
ok("not chosen by name: two weak candidates (no engineer work anywhere) stay AMBIGUOUS — never a pick, never a contradiction", g.resolution.status === "AMBIGUOUS" && g.resolution.chosen === null && !g.resolution.contradictions.length, g.resolution);
const g2 = run({ ...haim, works: (haim.works ?? []).map((w) => ({ ...w, status: "בוטל" })), versions: [], comments: [], projects: [{ ...haim.projects[0], status: "לא התחיל" }, haim.projects[1]] }, HAIM_TEXT);
ok("a CLOSED engineer work still contradicts \"we are mixing\" (NO_MIX_WORK)", g2.resolution.contradictions.some((x) => x.code === "NO_MIX_WORK"), g2.resolution);

console.log("\nH — an album: no invented song");
const P_ALB = U(60);
const alb: Fx = { clients: [{ id: U(61), name: "רוני נגה" }], projects: [{ id: P_ALB, name: "אלבום — רוני נגה", status: "במיקס", artist: "רוני נגה", type: "אלבום" }], works: [{ id: U(62), projectId: P_ALB, engineer: "Steven", status: "בתהליך", title: "מיקס אלבום" }], versions: [{ id: U(63), workId: U(62), createdAt: "2026-09-29T10:00:00Z" }], tracks: [{ id: U(64), projectId: P_ALB, n: 1, title: "פתיחה" }, { id: U(65), projectId: P_ALB, n: 3, title: "ים" }] };
const h = run(alb, "רוני נגה אוהבת את המיקס");
ok("LIKELY at the PROJECT + WORK level — no SONG / TRACK invented", h.resolution.status === "LIKELY" && !chain(h).some((x) => x.startsWith("SONG:") || x.startsWith("TRACK:")) && chain(h).includes("PROJECT:אלבום — רוני נגה"), chain(h));
const h2 = run({ ...alb, works: [{ ...alb.works![0], title: "ים" }] }, "רוני נגה אוהבת את המיקס");
ok("a TRACK only when the active work's title IS a track title (TEXT_MATCH)", h2.resolution.chosen?.chain.some((x) => x.level === "TRACK" && x.name === "ים" && x.quality === "TEXT_MATCH") === true, h2.resolution.chosen?.chain);

console.log("\nI — engineer mismatch");
const iFx: Fx = { ...haim, works: [{ id: U(20), projectId: P_KAROV, engineer: "Elvin", status: "בתהליך" }, { id: U(21), projectId: P_PESHA, engineer: "Steven", status: "בתהליך" }], versions: [] };
const i = run(iFx, "סטיבן החזיר את המיקס של חיים");
ok("the candidate whose mix is at another engineer is NOT chosen (ENGINEER_MISMATCH); the Steven one is, with ENGINEER_NAMED", i.resolution.status === "LIKELY" && chain(i).includes("PROJECT:פשע") && codes(i).includes("ENGINEER_NAMED") && i.resolution.contradictions.some((x) => x.code === "ENGINEER_MISMATCH"), { s: i.resolution.status, chain: chain(i), cx: i.resolution.contradictions });

console.log("\nJ — an approved Owner alias");
const jFx: Fx = { ...haim, knowledge: [...haim.knowledge!, { id: U(31), createdAt: "2026-09-20T10:00:00Z", kind: "ENTITY_ALIAS", subjectKey: `project:${P_KAROV}`, identityKeys: [`project:${P_KAROV}`], slotKey: "alias:גרמי", value: { alias: "גרמי" }, epistemic: "OWNER_DECISION", meaningHe: "\"גרמי\" הוא כינוי של קרוב אלייך.", operation: "ASSERT", supersedesId: null, reviewAt: null, expiresAt: null, provenance: {}, confirmationId: "c", itemIndex: 0 }] };
const j = run(jFx, "צריך לקדם את הפרויקט עם גרמי");
ok("the alias resolves to the project (OWNER_ALIAS) — LIKELY", j.resolution.status === "LIKELY" && codes(j).includes("OWNER_ALIAS") && chain(j).includes("PROJECT:קרוב אלייך"), { s: j.resolution.status, chain: chain(j) });

console.log("\nK — what is moving NOW decides between two similar candidates");
const kFx: Fx = { ...haim, works: [...haim.works!, { id: U(21), projectId: P_PESHA, engineer: "Steven", status: "בתהליך" }], versions: [...haim.versions!, { id: U(200), workId: U(21), createdAt: "2026-07-01T10:00:00Z" }], comments: [] };
const k = run(kFx, HAIM_TEXT, "2026-09-30T23:22:26Z");
ok("both have an active mix at Steven; only קרוב אלייך has a recent version → LIKELY קרוב אלייך", k.resolution.status === "LIKELY" && chain(k).includes("PROJECT:קרוב אלייך") && codes(k).includes("RECENT_VERSION"), { s: k.resolution.status, chain: chain(k), alts: k.resolution.alternatives });

console.log("\nPayload — compact, processed evidence");
ok("chosen + at most 2 alternatives; every evidence has code / he / quality / source", [a, b, c, d, i, k].every((r) => r.resolution.alternatives.length <= 2) && (a.resolution.chosen?.evidence ?? []).every((x) => x.code && x.he && x.quality && x.source));
ok("one update ≤ 3 KB of JSON", [a, b, c, d, e, h].every((r) => JSON.stringify(r).length <= 3000), [a, b, c, d, e, h].map((r) => JSON.stringify(r).length));
ok("owner_inbox: understand adds OWNER_KNOWLEDGE; deep alone adds PROJECT_DETAIL; new stays without company state", (ownerInbox.modeNeeds?.understand ?? []).join() === "STATE,OPERATIONS,OWNER_KNOWLEDGE" && (ownerInbox.modeNeeds?.deep ?? []).includes("PROJECT_DETAIL") && ownerInbox.needs.join() === "OWNER_INBOX" && !(ownerInbox.modeNeeds?.new));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
