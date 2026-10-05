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
import { assessOutcomes } from "../lib/partner/sunny/learning";
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

function src(o: { versions?: Array<{ work?: string; at: string }>; sessions?: Array<{ id: string; date: string; source?: string | null; project?: string }>; status?: string; items?: OwnerInboxItem[]; memory?: InboxMemory; knowledge?: unknown[]; victorOwner?: number } = {}): GatewaySources {
  const status = o.status ?? "בעבודה";
  const victor = Array.from({ length: o.victorOwner ?? 0 }, (_, i) => ({ id: U(200 + i), projectId: null, title: `W${i}`, ball: { holder: "owner" }, lastUploadAt: "2026-10-01T10:00:00Z", lastNotesSentAt: null, uploads: ["2026-10-01T10:00:00Z"] }));
  const state = {
    todayIL: "2026-10-05",
    domains: {
      projects: { data: { index: { [PID]: { name: "אין לך", status, artistText: "שליו טסמה", businessType: "לייבל" }, [OTHER]: { name: "אחר", status: "בעבודה", artistText: "X", businessType: "לקוח" } }, open: [
        { id: PID, name: "אין לך", status, artistText: "שליו טסמה", projectType: "שיר", businessType: "לייבל", deadline: { raw: null, ymd: null, daysTo: null, parseOk: false }, daysSinceUpdate: 1, active: true, hasFinanceSetting: true },
        { id: OTHER, name: "אחר", status: "בעבודה", artistText: "X", projectType: "שיר", businessType: "לקוח", deadline: { raw: null, ymd: null, daysTo: null, parseOk: false }, daysSinceUpdate: 1, active: true, hasFinanceSetting: true },
      ] } },
      clients: { data: { items: [] } }, labelArtists: { data: { items: [] } }, victor: { data: { active: victor } },
      sessions: { data: { items: (o.sessions ?? []).map((s) => ({ id: s.id, projectId: s.project ?? PID, showId: null, dateYmd: s.date, status: "התקיים", statusSource: s.source ?? "MANUAL", startTime: "10:00", endTime: "12:00", sessionType: "סשן" })) } },
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
    const declined = [1, 2, 3].map((n) => hist(`pl_n${n}`, `2026-09-2${n}T10:00:00Z`, "CREATE_TASK", `task:new`, "NOT_EXECUTED", null));
    const pref = assessOutcomes(declined, {}, now).preferences.find((p) => p.code === "OWNER_DOES_NOT_APPROVE_CREATE_TASK");
    ok("9g. the Boss repeatedly not approving the same proposal → an Owner-PREFERENCE hypothesis (asked, never a rule)", pref?.level === "REPEATED" && /להפוך לכלל עבודה/.test(pref.toKnowledgeHe), pref);
    ok("9h. two declines → WEAK, hidden", assessOutcomes(declined.slice(0, 2), {}, now).preferences.every((p) => !p.showToOwner));
    ok("9i. record-keeping actions are not judged as recommendations", assessOutcomes([hist("pl_8", "2026-09-10T10:00:00Z", "SET_AGREED_PRICE", KEY)], { [KEY]: [] }, now).assessments.length === 0);
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
