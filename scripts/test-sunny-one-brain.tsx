/**
 * ONE BRAIN / ZERO INBOX / CLOSED-LOOP LEARNING (Owner-approved Phase 2, 2026-10-05).
 *   S1 honesty (no fake monitoring; Sunny can act — after approval)   S2 entity resolution (Steven, owner-mix, night rule)
 *   S3 "what happened since" (ONE evidence rule)                       S4 derived inbox lifecycle (display states only)
 *   S6 one truth across views                                          S8 derived patterns (approved levels)
 *   S9 closed-loop outcome learning (never causal, never policy)       + boundaries (no writes from inference)
 * Run with:   npx tsx scripts/test-sunny-one-brain.tsx      Pure; never touches production.
 */
import fs from "node:fs";
import path from "node:path";
import type { GatewaySources } from "../lib/partner/gateway/core";
import type { InboxInterpretation, InboxLink, InboxMemory } from "../lib/inbox-memory";
import type { OwnerInboxItem } from "../lib/owner-inbox";
import { actionsSince, isAfter, projectProgressEvents, summarizeSince, whatHappenedSince, type ActionHistoryItem, type SinceEvent } from "../lib/partner/sunny/since";
import { decideInboxLifecycle, inboxExecutiveSummary, type InboxLifecycleBase } from "../lib/partner/sunny/inbox-lifecycle";
import { inboxLifecycleBaseOf } from "../lib/partner/sunny/inbox-lifecycle-base";
import { patternLevel, derivePatterns, type Occurrence } from "../lib/partner/sunny/patterns";
import { assessOutcomes, ownerPreferences, type OwnerFeedbackEvidence } from "../lib/partner/sunny/learning";
import { inboxTriageOf } from "../lib/partner/sunny/inbox-lifecycle-base";
import { ownerInbox } from "../lib/partner/knowledge/capabilities/sunny";
import { buildProjectMemory } from "../lib/partner/projects/memory";
import { ownerUpdatesOf } from "../lib/partner/gateway/brief";
import { deriveWithActionHistory } from "../lib/partner/sunny/with-history";
import { extractSignals, TEAM_NAMES } from "../lib/partner/knowledge/inbox-signals";
import { QUESTION_HOMES } from "../lib/partner/sunny/known-context";
import { projectLastEventAt } from "../lib/partner/projects/memory";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 700)}` : ""}`); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PID = U(10), KEY = `project:${PID}`, OTHER = U(11), OKEY = `project:${OTHER}`;
const NOW = new Date("2026-10-05T12:00:00Z");

const item = (id: string, body: string, createdAt: string): OwnerInboxItem => ({ id, createdAt, body, author: "OWNER", epistemic: "OWNER_REPORTED", source: "DASHBOARD_V2", status: "NEW", processedAt: null, processedVia: null, outcome: null, outcomeRef: null } as unknown as OwnerInboxItem);
const link = (id: string, itemId: string, entityKey: string): InboxLink => ({ id, itemId, entityKey, quality: "EXACT_UNIQUE", method: "RESOLVER_UNIQUE", surface: "x", candidates: null, createdAt: "2026-10-01T08:01:00Z", retractedAt: null, retractedReason: null });
const interp = (id: string, seq: number, o: Partial<InboxInterpretation> = {}): InboxInterpretation => ({
  id, seq, itemId: U(1), linkId: U(50), entityKey: KEY, whatHappened: "הסשן היה טוב", completed: [], openGaps: ["הוורס השני"], blockers: [], ballWith: "ARTIST", inferredNextStep: "לעבוד על הוורס השני",
  confidence: "MEDIUM", epistemic: "HYPOTHESIS", source: "OWNER_REPORTED_DERIVED", basisStatus: "בעבודה", basisBall: "NONE", basisEventAt: null, supersedesId: null, supersedeKind: null, supersedeReason: null,
  createdAt: "2026-10-01T08:02:00Z", retractedAt: null, retractedReason: null, ...o,
});

function src(o: { versions?: Array<{ work?: string; at: string }>; sessions?: Array<{ id: string; date: string; source?: string | null; project?: string; created?: string | null; status?: string }>; status?: string; items?: OwnerInboxItem[]; memory?: InboxMemory; knowledge?: unknown[]; victorOwner?: number } = {}): GatewaySources {
  const status = o.status ?? "בעבודה";
  const victor = Array.from({ length: o.victorOwner ?? 0 }, (_, i) => ({ id: U(200 + i), projectId: null, title: `W${i}`, ball: { holder: "owner" }, lastUploadAt: "2026-10-01T10:00:00Z", lastNotesSentAt: null, uploads: ["2026-10-01T10:00:00Z"] }));
  const state = {
    todayIL: "2026-10-05",
    domains: {
      projects: { data: { index: { [PID]: { name: "אין לך", status, artistText: "שליו טסמה", businessType: "לייבל" }, [OTHER]: { name: "אחר", status: "בעבודה", artistText: "X", businessType: "לקוח" } }, open: [
        { id: PID, name: "אין לך", status, artistText: "שליו טסמה", projectType: "שיר", businessType: "לייבל", deadline: { raw: null, ymd: null, daysTo: null, parseOk: false }, daysSinceUpdate: 1, active: true, hasFinanceSetting: true },
        { id: OTHER, name: "אחר", status: "בעבודה", artistText: "X", projectType: "שיר", businessType: "לקוח", deadline: { raw: null, ymd: null, daysTo: null, parseOk: false }, daysSinceUpdate: 1, active: true, hasFinanceSetting: true },
      ] } },
      clients: { data: { items: [] } }, labelArtists: { data: { items: [] } }, shows: { data: { items: [] } }, victor: { data: { active: victor } },
      sessions: { data: { items: (o.sessions ?? []).map((s) => ({ id: s.id, projectId: s.project ?? PID, showId: null, dateYmd: s.date, status: s.status ?? "התקיים", createdAt: s.created ?? null, statusSource: s.source ?? "MANUAL", startTime: "10:00", endTime: "12:00", sessionType: "סשן" })) } },
      releasesFull: { data: { items: [] } }, proposalsFull: { data: { items: [] } }, tasksFull: { data: { items: [] } },
    },
  };
  const ops = {
    projectsMeta: { rows: [{ id: PID, name: "אין לך", status, isHidden: false }], capped: false },
    engineerWork: { rows: [{ id: U(70), projectId: PID, engineerName: "Steven", workType: "mix", status: "בתהליך", internalDeadline: null }, { id: U(71), projectId: OTHER, engineerName: "Steven", workType: "mix", status: "בתהליך", internalDeadline: null }], capped: false },
    mixVersions: { rows: (o.versions ?? []).map((v, i) => ({ id: U(80 + i), workId: v.work ?? U(70), createdAt: v.at, status: null })), capped: false },
    finalFiles: { rows: [], capped: false }, deliveries: { rows: [], capped: false }, mixComments: { rows: [], capped: false },
  };
  return {
    now: NOW, identities: { cleantone: null },
    state: { status: "OK", value: state } as never, operations: { status: "OK", value: ops } as never,
    ownerKnowledge: { status: "OK", value: o.knowledge ?? [] } as never,
    ownerInbox: { status: "OK", value: o.items ?? [item(U(1), "הסשן עם שליו היה טוב, צריך לעבוד על הוורס השני", "2026-10-01T08:00:00Z")] },
    inboxMemory: { status: "OK", value: o.memory ?? { links: [link(U(50), U(1), KEY)], interpretations: [] } },
    audience: { channel: "EXTERNAL", ownerAuthorized: true },
  } as GatewaySources;
}
const baseOf = (o: Partial<InboxLifecycleBase> = {}): InboxLifecycleBase => ({
  itemId: U(1), writtenAt: "2026-10-01T08:00:00Z", entityKeys: [KEY], entitySource: "LINKED", technical: false, contradiction: false, understanding: null,
  knowledgeHomes: [], relatedEarlier: [], businessOpen: true, since: summarizeSince([], true, false), ...o,
});
const hist = (planId: string, at: string, actionId: string, entity: string, outcome = "EXECUTED", stepOutcome: string | null = "APPLIED_AS_EXPECTED"): ActionHistoryItem => ({ planId, at, outcome, steps: [{ actionId, entity, outcome: stepOutcome }] });

(async () => {
  console.log("S1. Honest Sunny — no fake monitoring, no false 'cannot act'");
  {
    const om = code(read("lib/partner/system/owner-model.ts"));
    ok("1a. owner-model no longer tells Sunny to 'alert the Owner' / 'keep monitoring' / 'monitor it automatically' / 'Monitor internal deadlines'", !/alert the Owner|keep monitoring|monitor it automatically|Monitor internal deadlines/.test(om));
    ok("1b. it says why: no background alert / cron / push; read at interaction time", /no background alert, cron or push/.test(om) && /never background monitoring/.test(om));
    const sys = read("lib/partner/knowledge/capabilities/system.ts");
    ok("1c. system_awareness / action_inventory no longer claim Sunny cannot execute (the action layer is live, after approval)", !/unavailable everywhere|Sunny executes none of them/.test(sys) && /partner_plan_action → preview → the Boss's explicit approval/.test(sys));
    const mcp = read("lib/integrations/partner-mcp/mcp.ts");
    ok("1d. the connector forbids future promises (אני עוקבת / אזכיר לך / אבדוק בהמשך / אשלח התראה) and gives the honest wording", /NO FUTURE PROMISES/.test(mcp) && /אזכיר לך/.test(mcp) && /חוט פתוח ברשומות/.test(mcp));
    const sunnyText = ["lib/partner/sunny", "lib/partner/knowledge", "lib/partner/system"].flatMap((d) => fs.readdirSync(path.resolve(__dirname, "..", d), { recursive: true }).filter((f) => String(f).endsWith(".ts")).map((f) => read(`${d}/${f}`))).join("\n");
    ok("1e. no Sunny-facing text promises monitoring / a reminder (אני עוקבת / אעקוב / אזכיר לך / אשלח לך התראה)", !/אני עוקבת אחרי|אעקוב אחרי|אזכיר לך|אשלח לך התראה/.test(sunnyText));
  }

  console.log("\nS2. Entity resolution");
  {
    const s = extractSignals("לתקן התראות של סטיבן", "2026-10-05T14:26:48Z");
    ok("2a. 'לתקן התראות של סטיבן' → team STEVEN + a SYSTEM item (the app itself, never project progress)", s.team.includes("STEVEN") && s.work.includes("SYSTEM"), s);
    ok("2b. the inbox name index maps סטיבן to vendor:STEVEN through the SAME team lexicon (no hard-coded entity)", TEAM_NAMES["סטיבן"] === "STEVEN" && /TEAM_NAMES\[normalizeName\(d\.name\)\] !== d\.target/.test(read("lib/partner/knowledge/inbox-mentions.ts")));
    ok("2c. a team member named alone resolves to that vendor (LIKELY, VENDOR level) — never a project guess", /level: "VENDOR", key, name, quality: "CANONICAL"/.test(read("lib/partner/knowledge/inbox-evidence.ts")));
    ok("2d. no engineer work ever → WEAK (the Boss may mix himself), a CLOSED engineer work still contradicts", /NO_ENGINEER_WORK/.test(read("lib/partner/knowledge/inbox-evidence.ts")) && /else ev\.push\(X\("NO_MIX_WORK"/.test(read("lib/partner/knowledge/inbox-evidence.ts")));
    const n = extractSignals("היום עם מאור היה סשן טוב", "2026-09-30T23:21:09Z");
    ok("2e. night rule (unchanged, verified): 'היום' written at 02:21 Israel covers the evening before AND the day", n.days.includes("2026-09-30") && n.days.includes("2026-10-01"), n.days);
  }

  console.log("\nS3. What happened since — ONE evidence rule");
  {
    ok("3a. a session on the SAME Israel day as the note is not 'after' it; a later day is", !isAfter({ at: "2026-10-01T00:00:00Z", kind: "SESSION_HELD" }, "2026-10-01T08:00:00Z") && isAfter({ at: "2026-10-02T00:00:00Z", kind: "SESSION_HELD" }, "2026-10-01T08:00:00Z"));
    const auto = projectProgressEvents(src({ sessions: [{ id: U(90), date: "2026-10-03", source: "AUTO_MARK" }] }), PID);
    ok("3b. an AUTO_MARK held session alone is NOT meaningful progress", auto.length === 0, auto);
    const man = projectProgressEvents(src({ sessions: [{ id: U(90), date: "2026-10-03", source: "MANUAL" }] }), PID);
    ok("3c. a session the Owner recorded IS progress", man.length === 1 && man[0].kind === "SESSION_HELD");
    ok("3d. generic updatedAt never counts (the since rule never reads it)", !/updatedAt|updated_at/.test(code(read("lib/partner/sunny/since.ts"))));
    const sv = whatHappenedSince({ src: src({ versions: [{ at: "2026-10-03T10:00:00Z" }, { work: U(71), at: "2026-10-03T11:00:00Z" }] }), entityKeys: [KEY], sinceIso: "2026-10-01T08:00:00Z", itemId: U(1) });
    ok("3e. a version on THIS project after the note → PROGRESSED; a version on another project never counts (exact entity)", sv.verdict === "PROGRESSED" && sv.progress === 1, sv);
    const acts = [hist("pl_a", "2026-10-02T10:00:00Z", "UPDATE_PROJECT_DEADLINE", KEY), hist("pl_b", "2026-09-30T10:00:00Z", "UPDATE_PROJECT_DEADLINE", KEY), hist("pl_c", "2026-10-02T10:00:00Z", "UPDATE_PROJECT_DEADLINE", OKEY), hist("pl_d", "2026-10-02T10:00:00Z", "MARK_OWNER_INBOX_ITEM", KEY), hist("pl_e", "2026-10-02T10:00:00Z", "SET_AGREED_PRICE", KEY)];
    const ev = actionsSince(acts, [KEY], "2026-10-01T08:00:00Z");
    ok("3f. actions: only on the exact entity, only AFTER the note, inbox housekeeping never counts", ev.length === 2 && ev.every((e) => e.entity === KEY) && !ev.some((e) => e.ref === "pl_b" || e.ref === "pl_d"), ev);
    const sm = summarizeSince(ev, true, true);
    ok("3g. a deadline change = PLANNING, a price = RECORDING — 'action happened' is never 'progress' / 'solved'", sm.verdict === "PLANNED_ONLY" && sm.progress === 0 && /אין התקדמות רשומה/.test(sm.he), sm);
    ok("3h. projectLastEventAt is the latest PROGRESS event of the SAME rule (one truth)", projectLastEventAt(src({ versions: [{ at: "2026-10-03T10:00:00Z" }] }), PID) === "2026-10-03T10:00:00Z" && /projectProgressEvents\(src, projectId\)/.test(read("lib/partner/projects/memory.ts")));
    ok("3i. stateless read → NOT_CHECKED (never 'nothing happened')", summarizeSince([], false, false).verdict === "NOT_CHECKED");
  }

  console.log("\nS4. Inbox derived lifecycle (display states — no store)");
  {
    ok("4a. no entity → NEEDS_OWNER (one question)", decideInboxLifecycle(baseOf({ entitySource: "NONE", entityKeys: [] })).state === "NEEDS_OWNER");
    const un = decideInboxLifecycle(baseOf({ entitySource: "LIKELY" }));
    ok("4b. a LIKELY entity with no home → UNREAD, not closable (not linked yet)", un.state === "UNREAD" && !un.closable);
    const uo = decideInboxLifecycle(baseOf({ understanding: { id: U(60), freshness: "CURRENT" } }));
    ok("4c. item with a durable home leaves the inbox while the business work stays open (UNDERSTOOD_OPEN, closable, NO_ACTION_NEEDED)", uo.state === "UNDERSTOOD_OPEN" && uo.closable && uo.proposedClose?.outcome === "NO_ACTION_NEEDED", uo);
    ok("4d. PROCESSED ≠ completed: the proposal says the thread continues in the records", /ממשיך|ההמשך חי/.test(uo.proposedClose?.whyHe ?? "") && uo.businessOpen === true);
    const rf = decideInboxLifecycle(baseOf({ understanding: { id: U(60), freshness: "CURRENT" }, businessOpen: false }));
    ok("4e. a home + nothing open in the records → REFLECTED", rf.state === "REFLECTED" && rf.closable);
    ok("4f. its understanding OUTDATED_BY_CANONICAL → OVERTAKEN, never closed silently", (() => { const x = decideInboxLifecycle(baseOf({ understanding: { id: U(60), freshness: "OUTDATED_BY_CANONICAL" } })); return x.state === "OVERTAKEN" && !x.closable; })());
    ok("4g. canonical state beats the interpretation: a BALL_CONFLICT is a contradiction → NEEDS_OWNER", decideInboxLifecycle(baseOf({ contradiction: true, understanding: { id: U(60), freshness: "BALL_CONFLICT" } })).state === "NEEDS_OWNER");
    const ev: SinceEvent[] = [{ at: "2026-10-03T10:00:00Z", kind: "MIX_VERSION", meaning: "PROGRESS", he: "Steven העלה גרסה", entity: KEY, source: "MIX_VERSIONS" }];
    ok("4h. a later canonical event with no home → OVERTAKEN ('קרה משהו מאז')", decideInboxLifecycle(baseOf({ since: summarizeSince(ev, true, false) })).state === "OVERTAKEN");
    const withPlan = decideInboxLifecycle(baseOf(), [hist("pl_JZJ", "2026-10-02T10:00:00Z", "UPDATE_PROJECT_DEADLINE", KEY)]);
    ok("4i. a re-planning plan on the exact entity AFTER the note is a home → ACTION_PLANNED with that plan (and it still says action ≠ solved)", withPlan.proposedClose?.outcome === "ACTION_PLANNED" && withPlan.proposedClose.outcomeRef === "pl_JZJ" && /לא אומרת שהבעיה נפתרה/.test(withPlan.proposedClose.whyHe), withPlan.proposedClose);
    ok("4j. a record-keeping plan (price) is NOT a home for a note about the work", decideInboxLifecycle(baseOf(), [hist("pl_P", "2026-10-02T10:00:00Z", "SET_AGREED_PRICE", KEY)]).homes.length === 0);
    ok("4k. an action on ANOTHER entity / BEFORE the note is not a home", decideInboxLifecycle(baseOf(), [hist("pl_O", "2026-10-02T10:00:00Z", "UPDATE_PROJECT_DEADLINE", OKEY), hist("pl_B", "2026-09-30T10:00:00Z", "UPDATE_PROJECT_DEADLINE", KEY)]).homes.length === 0);
    const tech = decideInboxLifecycle(baseOf({ technical: true, entityKeys: ["vendor:STEVEN"], understanding: { id: U(60), freshness: "CURRENT" } }));
    ok("4l. a technical item never closes by itself (a deploy is not proof) — only the Boss's 'עובד'", !tech.closable && /deploy הוא לא הוכחה/.test(tech.nextHe));
    ok("4m. earlier knowledge on the entity is a HINT, never a home by itself", decideInboxLifecycle(baseOf({ relatedEarlier: [{ id: U(77), he: "שליו לא מצליח לסיים את הוורס השני", at: "2026-09-28T10:00:00Z" }] })).state === "UNREAD");
    ok("4n. age alone never changes the state (a 60-day-old note with the same evidence = the same state)", decideInboxLifecycle(baseOf({ writtenAt: "2026-08-01T08:00:00Z" })).state === decideInboxLifecycle(baseOf()).state);
    const ex = inboxExecutiveSummary([uo, un, tech, decideInboxLifecycle(baseOf({ entitySource: "NONE", entityKeys: [] }))]);
    ok("4o. the executive line is need-to-know (states + what can close), never 'יש לך N עדכונים'", /עברתי על 4 העדכונים/.test(ex.he) && !/יש לך \d+ עדכונים/.test(ex.he) && ex.closable === 1 && ex.technical === 1, ex);
  }

  console.log("\nS6. One truth across views");
  {
    const b = inboxLifecycleBaseOf(src({ versions: [{ at: "2026-10-03T10:00:00Z" }] }), item(U(1), "הסשן עם שליו היה טוב", "2026-10-01T08:00:00Z"), null, "2026-10-05");
    ok("6a. a later canonical event changes the inbox state through the shared base (linked → OVERTAKEN)", b.entitySource === "LINKED" && decideInboxLifecycle(b).state === "OVERTAKEN", { since: b.since.verdict });
    const b2 = inboxLifecycleBaseOf(src({ memory: { links: [link(U(50), U(1), KEY)], interpretations: [interp(U(60), 1)] } }), item(U(1), "x", "2026-10-01T08:00:00Z"), null, "2026-10-05");
    ok("6b. the item's own interpretation is read with its freshness (canonical basis, the SAME freshnessOf)", b2.understanding?.id === U(60) && typeof b2.understanding.freshness === "string", b2.understanding);
    ok("6c. owner_inbox, company_view and the connector all use decideInboxLifecycle (no second rule)", /decideInboxLifecycle/.test(read("lib/partner/knowledge/capabilities/sunny.ts")) && /inboxTriageOf/.test(read("lib/partner/knowledge/capabilities/company-view.ts")) && /decideInboxLifecycle\(i\.fields\.lifecycle, history\)/.test(read("lib/partner/sunny/with-history.ts")) && /deps\.gateway\.withActionHistory!\(derive/.test(read("lib/integrations/partner-mcp/mcp.ts")) && !/partner\/sunny/.test(read("lib/integrations/partner-mcp/mcp.ts")) && /decideInboxLifecycle/.test(read("lib/partner/sunny/inbox-lifecycle-base.ts")));
    const op = read("lib/partner/sunny/operating.ts");
    ok("6d. Inbox information appears in PROJECT_STATE reasoning (a CURRENT understanding answers it; label view inherits it via projectOperating)", /questionKind: "PROJECT_STATE"[\s\S]{0,900}knowledgeKind: "INBOX_INTERPRETATION"/.test(op) && /inboxFreshnessOf\(head, projectBasisOf\(src, projectId\)\) === "CURRENT"/.test(op));
    ok("6e. Question Memory reused, not duplicated (PROJECT_STATE / OUTSIDE_COMMUNICATION homes in the ONE map; no new store)", !!QUESTION_HOMES.PROJECT_STATE && !!QUESTION_HOMES.OUTSIDE_COMMUNICATION && !/\.from\(/.test(["since", "inbox-lifecycle", "inbox-lifecycle-base", "patterns", "learning"].map((f) => read(`lib/partner/sunny/${f}.ts`)).join("")));
    ok("6f. the brief drills into the per-update lifecycle (understand), not the raw list", /mode: "understand" }, label: partner\("מה קרה מאז כל עדכון/.test(read("lib/partner/gateway/brief.ts")));
  }

  console.log("\nS8. Derived patterns (approved levels)");
  {
    const now = NOW.getTime();
    const o = (id: string, daysAgo: number, entity = KEY): Occurrence => ({ sourceId: id, at: new Date(now - daysAgo * 86_400_000).toISOString(), entity, he: id });
    ok("8a. 1 → OBSERVATION", patternLevel({ occurrences: [o("a", 1)], nowMs: now, contradicting: 0, consequence: false })?.level === "OBSERVATION");
    ok("8b. 2 within 30 days → WEAK", patternLevel({ occurrences: [o("a", 1), o("b", 20)], nowMs: now, contradicting: 0, consequence: false })?.level === "WEAK");
    ok("8c. 3 within 45 days → REPEATED; the same pattern on 2 entities → REPEATED", patternLevel({ occurrences: [o("a", 1), o("b", 20), o("c", 40)], nowMs: now, contradicting: 0, consequence: false })?.level === "REPEATED" && patternLevel({ occurrences: [o("a", 1), o("b", 2, OKEY)], nowMs: now, contradicting: 0, consequence: false })?.level === "REPEATED");
    ok("8d. STRONG needs REPEATED + no contradicting progress + a consequence", patternLevel({ occurrences: [o("a", 1), o("b", 2), o("c", 3)], nowMs: now, contradicting: 0, consequence: true })?.level === "STRONG" && patternLevel({ occurrences: [o("a", 1), o("b", 2), o("c", 3)], nowMs: now, contradicting: 1, consequence: true })?.level === "WEAK");
    ok("8e. contradicting progress downgrades a level", patternLevel({ occurrences: [o("a", 1), o("b", 2), o("c", 3)], nowMs: now, contradicting: 1, consequence: false })?.level === "WEAK");
    ok("8f. an occurrence older than 60 days does not count; the same source is counted once", patternLevel({ occurrences: [o("a", 70)], nowMs: now, contradicting: 0, consequence: false }) === null && patternLevel({ occurrences: [o("a", 1), o("a", 2)], nowMs: now, contradicting: 0, consequence: false })?.level === "OBSERVATION");
    const items = [item(U(1), "צריך לקדם את אין לך", "2026-09-20T08:00:00Z"), item(U(2), "חייב להתקדם עם אין לך", "2026-09-27T08:00:00Z"), item(U(3), "אין לך תקוע, צריך לקדם", "2026-10-03T08:00:00Z")];
    const pats = derivePatterns(src({ items, memory: { links: [link(U(50), U(1), KEY), link(U(51), U(2), KEY), link(U(52), U(3), KEY)], interpretations: [] } }));
    const rp = pats.find((p) => p.code === "REPEATED_PUSH_NO_PROGRESS");
    ok("8g. 'צריך לקדם X' ×3 with no progress between → REPEATED, raised as a HYPOTHESIS", rp?.level === "REPEATED" && rp.showToOwner && rp.epistemic === "HYPOTHESIS" && /השערה/.test(rp.hypothesisHe), rp);
    const p2 = derivePatterns(src({ items, versions: [{ at: "2026-09-25T10:00:00Z" }], memory: { links: [link(U(50), U(1), KEY), link(U(51), U(2), KEY), link(U(52), U(3), KEY)], interpretations: [] } })).find((p) => p.code === "REPEATED_PUSH_NO_PROGRESS");
    ok("8h. progress between the notes downgrades it (no longer raised)", p2?.level === "WEAK" && !p2.showToOwner, p2);
    const weak = derivePatterns(src({ items: items.slice(1), memory: { links: [link(U(51), U(2), KEY), link(U(52), U(3), KEY)], interpretations: [] } })).find((p) => p.code === "REPEATED_PUSH_NO_PROGRESS");
    ok("8i. a WEAK pattern is hidden from the executive answer (company_view shows only showToOwner)", weak?.level === "WEAK" && !weak.showToOwner && /filter\(\(x\) => x\.showToOwner\)/.test(read("lib/partner/knowledge/capabilities/company-view.ts")));
    const ob = derivePatterns(src({ victorOwner: 4 })).find((p) => p.code === "OWNER_FEEDBACK_BOTTLENECK");
    ok("8j. several works waiting on the Boss → an Owner-bottleneck HYPOTHESIS (never 'Victor is late')", ob?.level === "REPEATED" && !/ויקטור מעכב|תמיד/.test(ob.hypothesisHe), ob);
    ok("8k2. an AUTO_MARK held session is never 'activity' for the pattern", !derivePatterns(src({ status: "לא התחיל", sessions: [{ id: U(92), date: "2026-09-30", source: "AUTO_MARK" }] })).some((p) => p.code === "ACTIVITY_WITHOUT_STATUS"));
    ok("8k. sessions on a 'לא התחיל' project → activity-without-status observation", derivePatterns(src({ status: "לא התחיל", sessions: [{ id: U(91), date: "2026-09-30" }] })).some((p) => p.code === "ACTIVITY_WITHOUT_STATUS"));
  }

  console.log("\nS9. Closed-loop outcome learning");
  {
    const now = NOW.getTime();
    const dl = hist("pl_1", "2026-09-10T10:00:00Z", "UPDATE_PROJECT_DEADLINE", KEY);
    const r1 = assessOutcomes([dl], { [KEY]: [], [OKEY]: [] }, now);
    ok("9a. a deadline change followed by no progress for the whole window → DID_NOT_RESOLVE", r1.assessments[0]?.level === "DID_NOT_RESOLVE", r1.assessments);
    const r2 = assessOutcomes([hist("pl_2", "2026-10-01T10:00:00Z", "UPDATE_PROJECT_DEADLINE", KEY)], { [KEY]: [], [OKEY]: [{ at: "2026-10-02T10:00:00Z", kind: "MIX_VERSION", meaning: "PROGRESS", he: "x", entity: OKEY, source: "x" }] }, now);
    ok("9b. progress only on ANOTHER record (and still early) → INSUFFICIENT_EVIDENCE", r2.assessments[0]?.level === "INSUFFICIENT_EVIDENCE" && /רשומות אחרות/.test(r2.assessments[0].evidenceHe), r2.assessments);
    const r3 = assessOutcomes([hist("pl_3", "2026-09-20T10:00:00Z", "UPDATE_PROJECT_DEADLINE", KEY)], { [KEY]: [{ at: "2026-09-22T10:00:00Z", kind: "MIX_VERSION", meaning: "PROGRESS", he: "x", entity: KEY, source: "x" }] }, now);
    ok("9c. progress after a deadline change → CORRELATED (preceded — never 'caused')", r3.assessments[0]?.level === "CORRELATED" && /לא נטען שהיא גרמה/.test(r3.assessments[0].evidenceHe));
    const r4 = assessOutcomes([hist("pl_4", "2026-09-20T10:00:00Z", "SCHEDULE_SESSION", KEY)], { [KEY]: [{ at: "2026-09-25T00:00:00Z", kind: "SESSION_HELD", meaning: "PROGRESS", he: "x", entity: KEY, source: "x" }] }, now);
    ok("9d. a scheduled session followed by a held session → LIKELY_HELPFUL (the very kind it enables; still 'not proof')", r4.assessments[0]?.level === "LIKELY_HELPFUL");
    const r5 = assessOutcomes([hist("pl_5", "2026-09-01T10:00:00Z", "UPDATE_PROJECT_DEADLINE", KEY), hist("pl_6", "2026-09-20T10:00:00Z", "UPDATE_PROJECT_DEADLINE", KEY), hist("pl_7", "2026-09-05T10:00:00Z", "UPDATE_PROJECT_DEADLINE", OKEY)], { [KEY]: [], [OKEY]: [] }, now);
    ok("9e. the same re-planning again with nothing in between → CONTRADICTED", r5.assessments.some((a) => a.planId === "pl_5" && a.level === "CONTRADICTED"));
    const lesson = r5.lessons.find((l) => l.code === "NO_MOVEMENT_AFTER_UPDATE_PROJECT_DEADLINE");
    ok("9f. a lesson appears as a HYPOTHESIS ('לבדוק blocker / צעד הבא') — routed to existing knowledge only with the Boss's approval", !!lesson && lesson.epistemic === "HYPOTHESIS" && /blocker/.test(lesson.he) && /partner_propose_knowledge/.test(lesson.toKnowledgeHe), r5.lessons);
    const declined = [1, 2, 3].map((n) => hist(`pl_n${n}`, `2026-09-2${n}T10:00:00Z`, "SET_FINANCE_EXCEPTION", `project:${U(300 + n)}`, "NOT_EXECUTED", null));
    ok("9g. the same proposal not carried out on 3 different records → NO preference (pass 2.1: no execution = no signal)", assessOutcomes(declined, {}, now).preferences.length === 0);
    ok("9h. on one record (a re-plan loop) → nothing either", assessOutcomes([1, 2].map((n) => hist(`pl_m${n}`, `2026-09-2${n}T10:00:00Z`, "SET_FINANCE_EXCEPTION", KEY, "NOT_EXECUTED", null)), {}, now).preferences.length === 0);
    ok("9h3. creations (':new') and inbox housekeeping are never a preference signal", assessOutcomes([1, 2, 3].flatMap((n) => [hist(`pl_t${n}`, `2026-09-2${n}T10:00:00Z`, "CREATE_TASK", "task:new", "NOT_EXECUTED", null), hist(`pl_h${n}`, `2026-09-2${n}T10:00:00Z`, "LINK_INBOX_ENTITY", `project:${U(400 + n)}`, "NOT_EXECUTED", null)]), {}, now).preferences.length === 0);
    ok("9i. record-keeping actions are not judged as recommendations", assessOutcomes([hist("pl_8", "2026-09-10T10:00:00Z", "SET_AGREED_PRICE", KEY)], { [KEY]: [] }, now).assessments.length === 0);
  }

  console.log("\nS10. Owner preference = explicit evidence only (completeness pass 2.1)");
  {
    const now = NOW.getTime();
    const notRun = [1, 2, 3, 4].map((n) => hist(`pl_q${n}`, `2026-09-2${n}T10:00:00Z`, "SET_FINANCE_EXCEPTION", `project:${U(500 + n)}`, "NOT_EXECUTED", null));
    ok("10a. plans that were NOT executed → NO owner-preference signal at all (no inference from silence)", assessOutcomes(notRun, {}, now).preferences.length === 0 && ownerPreferences([], now).length === 0);
    const rej = [1, 2, 3].map((n): OwnerFeedbackEvidence => ({ kind: "REJECTED", actionId: "SET_FINANCE_EXCEPTION", entity: `project:${U(510 + n)}`, at: `2026-09-2${n}T10:00:00Z`, ref: `r${n}` }));
    const p1 = ownerPreferences(rej, now);
    ok("10b. explicit rejections → preference EVIDENCE (a hypothesis, asked before any rule)", p1.length === 1 && p1[0].level === "REPEATED" && /דחית/.test(p1[0].he) && /להפוך לכלל עבודה/.test(p1[0].toKnowledgeHe), p1);
    const ch = [1, 2, 3].map((n): OwnerFeedbackEvidence => ({ kind: "CHANGED", actionId: "UPDATE_PROJECT_DEADLINE", from: "+7d", to: "+14d", entity: `project:${U(520 + n)}`, at: `2026-09-2${n}T10:00:00Z`, ref: `c${n}` }));
    const p2 = ownerPreferences(ch, now);
    ok("10c. the same change X → Y repeated → a preference hypothesis naming X → Y", p2.length === 1 && p2[0].level === "REPEATED" && /\+7d/.test(p2[0].he) && /\+14d/.test(p2[0].he), p2);
    ok("10d. approvals of the same action contradict a rejection pattern (downgraded)", ownerPreferences([...rej, ...[1, 2].map((n): OwnerFeedbackEvidence => ({ kind: "APPROVED", actionId: "SET_FINANCE_EXCEPTION", entity: `project:${U(530 + n)}`, at: `2026-09-2${n}T11:00:00Z`, ref: `a${n}` }))], now)[0]?.level === "WEAK");
    ok("10e. an explicit statement is proposed as knowledge right away (still with his approval)", ownerPreferences([{ kind: "STATED", actionId: "UPDATE_PROJECT_DEADLINE", entity: null, at: "2026-10-04T10:00:00Z", ref: "s1" }], now)[0]?.showToOwner === true);
    const out = assessOutcomes([hist("pl_d1", "2026-09-10T10:00:00Z", "UPDATE_PROJECT_DEADLINE", KEY), ...notRun], { [KEY]: [] }, now);
    ok("10f. outcome learning still works without any preference learning (preference ≠ outcome)", out.assessments[0]?.level === "DID_NOT_RESOLVE" && out.preferences.length === 0);
    ok("10g. the connector passes only the Boss's own approvals as preference evidence; un-executed plans never", /approvedBy === "OWNER_APPROVAL"/.test(read("lib/partner/sunny/with-history.ts")) && !/NOT_EXECUTED/.test(code(read("lib/partner/sunny/learning.ts")).split("export function ownerPreferences")[1] ?? "NOT_EXECUTED"));
  }

  console.log("\nS11. Session ↔ project 'what happened since'");
  {
    const w = "2026-10-01T08:00:00Z";
    const sv = (sessions: NonNullable<Parameters<typeof src>[0]>["sessions"]) => whatHappenedSince({ src: src({ sessions }), entityKeys: [KEY], sinceIso: w, itemId: U(1) });
    const sch = sv([{ id: U(600), date: "2026-10-09", status: "מתוכנן", source: "CREATED", created: "2026-10-03T09:00:00Z" }]);
    ok("11a. a session of THIS project scheduled after the note → PLANNED_ONLY (scheduling ≠ progress)", sch.verdict === "PLANNED_ONLY" && sch.planning === 1 && sch.progress === 0, sch);
    ok("11b. a session of ANOTHER project is ignored", sv([{ id: U(601), date: "2026-10-09", status: "מתוכנן", created: "2026-10-03T09:00:00Z", project: OTHER }]).verdict === "NOTHING_RECORDED");
    ok("11c. an AUTO_MARK held session is ignored as progress (its scheduling time before the note is not 'since' either)", sv([{ id: U(602), date: "2026-10-03", source: "AUTO_MARK", created: "2026-09-20T09:00:00Z" }]).progress === 0);
    ok("11d. a held session the Boss recorded counts by the existing rule", sv([{ id: U(603), date: "2026-10-03", source: "MANUAL", created: "2026-09-20T09:00:00Z" }]).verdict === "PROGRESSED");
    const unk = sv([{ id: U(604), date: "2026-10-09", status: "מתוכנן", created: null }]);
    ok("11e. no reliable creation time → NOT_CHECKED (never an invented scheduling date)", unk.verdict === "NOT_CHECKED" && /לא ממציאה/.test(unk.he), unk);
    ok("11f. a scheduled session never makes the note OVERTAKEN (planning only)", decideInboxLifecycle(baseOf({ since: sch })).state !== "OVERTAKEN");
    ok("11g. projectLastEventAt stays PROGRESS-only (scheduling never moves it)", projectLastEventAt(src({ sessions: [{ id: U(605), date: "2026-10-09", status: "מתוכנן", created: "2026-10-03T09:00:00Z" }] }), PID) === null);
  }

  console.log("\nS12. needs_me / partner_entity ← the shared inbox lifecycle");
  {
    const cur = read("lib/partner/needs-me/curate.ts");
    ok("12a. needs_me reads the SAME triage (inboxTriageOf → decideInboxLifecycle), no parallel resolver", /inboxTriageOf\(src\)/.test(cur) && !/resolveUpdate\(|decideInboxLifecycle\(/.test(cur));
    ok("12b. NEEDS_OWNER appears exactly once — ONE summary line, never a top-5 item", (cur.match(/key: "owner-inbox\|NEEDS_OWNER"/g) ?? []).length === 1 && /summaries\.push\(\{\s*key: "owner-inbox\|NEEDS_OWNER"/.test(cur));
    ok("12c. an update about a record already on the board ENRICHES it (no duplicate item); REFLECTED / OVERTAKEN / UNDERSTOOD_OPEN never create one", /match\.evidence\.push\(\{ code: "INBOX_STATE"/.test(cur) && /if \(l\.state === "NEEDS_OWNER"\) needsOwner\.push/.test(cur));
    ok("12d. exact entity identity: an item matches only by its exact key / project id", /l\.entityKeys\.some\(\(k\) => k === i\.entityKey \|\| \(k\.startsWith\("project:"\) && i\.projectId === k\.slice\("project:"\.length\)\)\)/.test(cur));
    const s2 = src({ items: [item(U(1), "הסשן עם שליו היה טוב", "2026-10-01T08:00:00Z"), item(U(2), "משהו על הפרויקט האחר", "2026-10-01T09:00:00Z")], memory: { links: [link(U(50), U(1), KEY), link(U(51), U(2), OKEY)], interpretations: [] } });
    const ent = ownerInbox.read(s2, { capability: "owner_inbox", mode: "new", params: { entity: KEY } } as never) as unknown as { items: Array<{ id: string; fields: Record<string, unknown> }> };
    ok("12e. partner_entity(project) sees the relevant update with its state / since / next — curated, not the raw list", ent.items.length === 1 && ent.items[0].id === U(1) && typeof ent.items[0].fields.state === "string" && !!ent.items[0].fields.sinceHe, ent.items);
    ok("12f. an update about project B never appears on project A", !ent.items.some((x) => x.id === U(2)));
    ok("12g. project is now an enrichment type of owner_inbox (partner_entity attaches it)", /INBOX_ENRICH_TYPES: readonly GatewayEntityType\[\] = \["project",/.test(read("lib/partner/knowledge/capabilities/sunny.ts")));
  }

  console.log("\nS13. One truth: owner_inbox / partner_entity / company_view / needs_me / project_memory / brief agree");
  {
    const s3 = src({ versions: [{ at: "2026-10-03T10:00:00Z" }], items: [item(U(1), "הסשן עם שליו היה טוב", "2026-10-01T08:00:00Z")], memory: { links: [link(U(50), U(1), KEY)], interpretations: [interp(U(60), 1, { createdAt: "2026-10-01T08:02:00Z", basisEventAt: null })] } });
    const und = ownerInbox.read(s3, { capability: "owner_inbox", mode: "understand", params: {} } as never) as unknown as { items: Array<{ id: string; fields: { lifecycle: { state: string; since: { verdict: string }; entityKeys: string[] } } }> };
    const ent = ownerInbox.read(s3, { capability: "owner_inbox", mode: "new", params: { entity: KEY } } as never) as unknown as { items: Array<{ id: string; fields: { state: string; since: string } }> };
    const tri = inboxTriageOf(s3);
    const u0 = und.items[0].fields.lifecycle, e0 = ent.items[0].fields, t0 = tri.items[0].lifecycle;
    ok("13a. owner_inbox understand, partner_entity(project) and the shared triage (needs_me / company_view) give the SAME state, since and entity", u0.state === t0.state && e0.state === t0.state && u0.since.verdict === t0.since.verdict && e0.since === t0.since.verdict && u0.entityKeys.join() === t0.entityKeys.join(), { u0, e0, t0: { state: t0.state, since: t0.since.verdict } });
    const pm = buildProjectMemory(s3, PID);
    ok("13b. project_memory and the lifecycle read the SAME understanding freshness (same freshnessOf + projectBasisOf)", pm.understanding?.freshness === t0.understanding?.freshness, { pm: pm.understanding?.freshness, life: t0.understanding });
    ok("13c. the brief lists the SAME NEW updates the lifecycle covers (and drills into it)", JSON.stringify((ownerUpdatesOf(s3) as { items: Array<{ id: string }> }).items.map((x) => x.id)) === JSON.stringify(tri.items.map((x) => x.item.id)));
    ok("13d. canonical state: every view reads the live project basis — a later version makes the understanding OUTDATED everywhere", t0.understanding?.freshness === "OUTDATED_BY_CANONICAL" && pm.understanding?.freshness === "OUTDATED_BY_CANONICAL" && t0.state === "OVERTAKEN");
    const s4 = src({ items: [item(U(1), "דחוף למקסס את אין לך", "2026-10-01T08:00:00Z")], memory: { links: [link(U(50), U(1), KEY)], interpretations: [] } });
    const hist4 = [hist("pl_DL", "2026-10-02T10:00:00Z", "UPDATE_PROJECT_DEADLINE", KEY)];
    const u4 = deriveWithActionHistory("inbox", ownerInbox.read(s4, { capability: "owner_inbox", mode: "understand", params: {} } as never) as unknown as Record<string, unknown>, hist4, NOW.getTime()) as { items: Array<{ fields: { lifecycle: { state: string; homes: Array<{ kind: string }> } } }> };
    const e4 = deriveWithActionHistory("inbox", ownerInbox.read(s4, { capability: "owner_inbox", mode: "new", params: { entity: KEY } } as never) as unknown as Record<string, unknown>, hist4, NOW.getTime()) as { items: Array<{ fields: { state: string; lifecycle: { state: string } } }> };
    ok("13f. WITH Sunny's action history, owner_inbox and partner_entity(project) still agree (the plan after the note is the home in both)", u4.items[0].fields.lifecycle.state === e4.items[0].fields.state && e4.items[0].fields.state === e4.items[0].fields.lifecycle.state && u4.items[0].fields.lifecycle.homes.some((h) => h.kind === "PLAN"), { u: u4.items[0].fields.lifecycle.state, e: e4.items[0].fields.state });
    ok("13g. the connector applies the history to the partner_entity inbox section too", /k\.capability === "owner_inbox" \? deps\.gateway\.withActionHistory!\("inbox", k, history/.test(read("lib/integrations/partner-mcp/mcp.ts")));
    ok("13e. company_view and needs_me both call inboxTriageOf (no second decision)", /inboxTriageOf\(src\)/.test(read("lib/partner/knowledge/capabilities/company-view.ts")) && /inboxTriageOf\(src\)/.test(read("lib/partner/needs-me/curate.ts")));
  }

  console.log("\nBoundaries — inference never writes; no DB / cron / push / new store");
  {
    const files = ["since", "inbox-lifecycle", "inbox-lifecycle-base", "patterns", "learning", "with-history"].map((f) => code(read(`lib/partner/sunny/${f}.ts`))).join("\n");
    ok("B1. outcome inference / patterns / lifecycle never write canonical state (no writer, store, RPC, push, cron import)", !/lib\/writes|\/writes\/|-store"|\.insert\(|\.update\(|\.rpc\(|sendPush|setInterval|cron/.test(files));
    ok("B2. the send-log rule is untouched (age alone never supersedes; Stage 7 stopped and reported)", !/sendEntryCurrent|send-log/.test(files));
    ok("B3. the close primitive enforces the Zero Inbox guard at execution (an unlinked note can never be 'handled')", /async apply\(d, id, after\)[\s\S]{0,400}zeroInboxGuard/.test(read("lib/partner/act/primitives/owner-inbox.ts")));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
