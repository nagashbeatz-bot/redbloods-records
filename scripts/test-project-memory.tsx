/**
 * PROJECT MEMORY (Phase 1, Owner decision 2026-10-01): project_memory + the compact partner_entity section, over a
 * Gateway source set. Three layers never mix (CANONICAL / OWNER MEMORY / SUNNY UNDERSTANDING); canonical wins
 * (OUTDATED_BY_CANONICAL / BALL_CONFLICT / UNVERIFIED — the old next step is never current); nothing is deleted
 * (history mode); only LINKED updates count as the project's memory.
 * Run with:   npx tsx scripts/test-project-memory.tsx      Pure; never touches production.
 */
import type { GatewaySources } from "../lib/partner/gateway/core";
import { buildProjectMemory, projectBasisOf } from "../lib/partner/projects/memory";
import { PARTNER_KNOWLEDGE_REGISTRY } from "../lib/partner/knowledge/catalog";
import { entityKnowledge } from "../lib/partner/knowledge/query";
import { projectMemory } from "../lib/partner/knowledge/capabilities/project-memory";
import { ownerInbox } from "../lib/partner/knowledge/capabilities/sunny";
import type { InboxInterpretation, InboxLink, InboxMemory } from "../lib/inbox-memory";
import type { OwnerInboxItem } from "../lib/owner-inbox";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 700)}` : ""}`); } };
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PID = U(10), KEY = `project:${PID}`, OTHER = U(11);

const item = (id: string, body: string, createdAt: string, status: "NEW" | "PROCESSED" = "PROCESSED"): OwnerInboxItem => ({ id, createdAt, body, author: "OWNER", epistemic: "OWNER_REPORTED", source: "DASHBOARD_V2", status, processedAt: status === "PROCESSED" ? createdAt : null, processedVia: status === "PROCESSED" ? "SUNNY" : null, outcome: status === "PROCESSED" ? "NO_ACTION_NEEDED" : null, outcomeRef: null });
const link = (id: string, itemId: string, entityKey: string, o: Partial<InboxLink> = {}): InboxLink => ({ id, itemId, entityKey, quality: "EXACT_UNIQUE", method: "RESOLVER_UNIQUE", surface: "Closer", candidates: null, createdAt: "2026-10-01T08:01:00Z", retractedAt: null, retractedReason: null, ...o });
const interp = (id: string, seq: number, o: Partial<InboxInterpretation> = {}): InboxInterpretation => ({
  id, seq, itemId: U(1), linkId: U(50), entityKey: KEY, whatHappened: "הגרסה האחרונה השתפרה משמעותית", completed: [], openGaps: ["תיקוני BGV"], blockers: ["תיקוני הבאקים לפני מסירה"],
  ballWith: "ENGINEER", inferredNextStep: "לסיים את תיקוני הבאקים ואז לשלוח לאמן", confidence: "MEDIUM", epistemic: "HYPOTHESIS", source: "OWNER_REPORTED_DERIVED",
  basisStatus: "במיקס", basisBall: "ENGINEER", basisEventAt: "2026-09-30T10:00:00Z", supersedesId: null, supersedeKind: null, supersedeReason: null, createdAt: "2026-10-01T08:02:00Z", retractedAt: null, retractedReason: null, ...o,
});

function src(o: { status?: string; engineerStatus?: string; versions?: string[]; memory?: InboxMemory | null; ops?: boolean; items?: OwnerInboxItem[] } = {}): GatewaySources {
  const status = o.status ?? "במיקס";
  const state = {
    todayIL: "2026-10-01",
    domains: {
      projects: { data: { index: { [PID]: { name: "Closer", status, artistText: "Someone", businessType: "לקוח" }, [OTHER]: { name: "Other", status: "בעבודה", artistText: "X", businessType: "לקוח" } }, open: [] } },
      clients: { data: { items: [] } }, labelArtists: { data: { items: [] } }, victor: { data: { active: [] } }, sessions: { data: { items: [] } },
      releasesFull: { data: { items: [] } }, proposalsFull: { data: { items: [] } }, tasksFull: { data: { items: [] } },
    },
  };
  const ops = {
    projectsMeta: { rows: [{ id: PID, name: "Closer", status, isHidden: false }], capped: false },
    engineerWork: { rows: [{ id: U(70), projectId: PID, engineerName: "Steven", workType: "mix", status: o.engineerStatus ?? "בתהליך", internalDeadline: null }], capped: false },
    mixVersions: { rows: (o.versions ?? ["2026-09-30T10:00:00Z"]).map((t, i) => ({ id: U(80 + i), workId: U(70), createdAt: t })), capped: false },
  };
  return {
    now: new Date("2026-10-01T12:00:00Z"), identities: { cleantone: null },
    state: { status: "OK", value: state } as never,
    operations: o.ops === false ? { status: "UNAVAILABLE", detail: "x" } : ({ status: "OK", value: ops } as never),
    ownerInbox: { status: "OK", value: o.items ?? [item(U(1), "Closer נשמע הרבה יותר טוב, נשאר לסדר את הבאקים", "2026-10-01T08:00:00Z"), item(U(2), "Closer — עוד משהו (לא מקושר)", "2026-10-01T09:00:00Z", "NEW")] },
    inboxMemory: o.memory === null ? { status: "UNAVAILABLE", detail: "x" } : { status: "OK", value: o.memory ?? { links: [link(U(50), U(1), KEY)], interpretations: [interp(U(60), 1)] } },
    audience: { channel: "EXTERNAL", ownerAuthorized: true },
  } as GatewaySources;
}

(async () => {
  console.log("Canonical basis (the SAME one the writer stores)");
  const b = projectBasisOf(src(), PID);
  ok("basis = status + the live ball (from project_view signals: AT_ENGINEER → ENGINEER) + the latest recorded event", !!b && b.status === "במיקס" && b.ball === "ENGINEER" && b.lastEventAt === "2026-09-30T10:00:00Z", b);
  ok("no operations → no basis (never a partial basis)", projectBasisOf(src({ ops: false }), PID) === null);

  console.log("\nThree layers + freshness (canonical wins)");
  const m = buildProjectMemory(src(), PID);
  ok("CURRENT: the understanding is served with its next step as the current next step (HYPOTHESIS)", m.understanding?.freshness === "CURRENT" && m.currentNextStep?.text === "לסיים את תיקוני הבאקים ואז לשלוח לאמן" && m.currentNextStep?.epistemic === "HYPOTHESIS", m.understanding);
  ok("the layers are separate: canonical (records), owner memory (linked updates), understanding (HYPOTHESIS)", m.canonical.status === "במיקס" && m.ownerMemory.total === 1 && m.understanding?.epistemic === "HYPOTHESIS");
  ok("owner memory = LINKED updates only (an update that only names the project is not the project's memory)", m.ownerMemory.latest.map((x) => x.itemId).join() === U(1));
  const later = buildProjectMemory(src({ versions: ["2026-09-30T10:00:00Z", "2026-10-02T09:00:00Z"] }), PID);
  ok("Steven uploaded a newer version → OUTDATED_BY_CANONICAL; the old next step is NOT current; the understanding is kept (context)", later.understanding?.freshness === "OUTDATED_BY_CANONICAL" && later.currentNextStep === null && later.understanding?.whatHappened === "הגרסה האחרונה השתפרה משמעותית");
  const returned = buildProjectMemory(src({ engineerStatus: "חזר" }), PID);
  ok("the engineer returned the work (live ball = OWNER) with no newer event → BALL_CONFLICT, no current next step", returned.understanding?.freshness === "BALL_CONFLICT" && returned.currentNextStep === null, returned.understanding?.freshness);
  const done = buildProjectMemory(src({ status: "הושלם" }), PID);
  ok("the project's status changed → OUTDATED_BY_CANONICAL", done.understanding?.freshness === "OUTDATED_BY_CANONICAL");
  ok("the records not readable → UNVERIFIED (never CURRENT by default)", buildProjectMemory(src({ ops: false }), PID).understanding?.freshness === "UNVERIFIED");

  console.log("\nSupersede / retract — nothing deleted");
  const mem: InboxMemory = {
    links: [link(U(50), U(1), KEY), link(U(51), U(3), KEY, { retractedAt: "2026-10-01T10:00:00Z", retractedReason: "לא התכוונתי" })],
    interpretations: [interp(U(60), 1), interp(U(61), 2, { whatHappened: "הבאקים סודרו", supersedesId: U(60), supersedeKind: "CORRECTION", supersedeReason: "הבוס תיקן", inferredNextStep: "לשלוח לאמן" }), interp(U(62), 3, { whatHappened: "שגוי", retractedAt: "2026-10-01T11:00:00Z", retractedReason: "טעות" })],
  };
  const h = buildProjectMemory(src({ memory: mem }), PID, "history");
  ok("the head = the newest ACTIVE interpretation (a retracted newer one is skipped)", h.understanding?.id === U(61) && h.currentNextStep?.text === "לשלוח לאמן");
  ok("history keeps every version with its state (HEAD / SUPERSEDED / RETRACTED) and the reasons", JSON.stringify(h.history?.map((x) => x.state)) === JSON.stringify(["RETRACTED", "HEAD", "SUPERSEDED"]) && h.history?.[1].supersedeReason === "הבוס תיקן" && h.historyCount === 3);
  ok("history lists every link with its id (incl. the retracted one) — addressable for corrections", h.links?.length === 2 && h.links.some((l) => l.retracted && l.retractedReason === "לא התכוונתי"));
  ok("a retracted link is not the project's owner memory", h.ownerMemory.latest.every((x) => x.itemId !== U(3)));

  console.log("\nproject_memory capability + partner_entity (compact)");
  ok("project_memory is registered (owner-only, needs STATE + OPERATIONS + OWNER_INBOX, ≤ 900-char description)", !!PARTNER_KNOWLEDGE_REGISTRY.get("project_memory") && projectMemory.access.ownerOnly && projectMemory.needs.join() === "STATE,OPERATIONS,OWNER_INBOX" && projectMemory.descriptionForModel.length <= 900, projectMemory.descriptionForModel.length);
  const r = projectMemory.read(src(), { mode: "summary", params: { project: KEY } } as never);
  const u = r.items.find((i) => i.fields.layer === "SUNNY_UNDERSTANDING");
  ok("summary: the understanding is HYPOTHESIS with freshness + confidence; canonical is FACT; the update OWNER_REPORTED", u?.epistemic === "HYPOTHESIS" && u.fields.freshness === "CURRENT" && u.fields.confidence === "MEDIUM" && r.items.some((i) => i.fields.layer === "CANONICAL" && i.epistemic === "FACT") && r.items.some((i) => i.fields.layer === "OWNER_MEMORY" && i.epistemic === "OWNER_REPORTED"));
  ok("the summary carries the current next step (HYPOTHESIS) only when CURRENT", JSON.stringify(r.summary.find((s) => s.code === "CURRENT_NEXT_STEP")?.value).includes("לשלוח לאמן") && projectMemory.read(src({ versions: ["2026-10-02T09:00:00Z"] }), { mode: "summary", params: { project: KEY } } as never).summary.find((s) => s.code === "CURRENT_NEXT_STEP")?.value === null);
  ok("a project with no linked update and no understanding → no items (no noise)", projectMemory.read(src(), { mode: "summary", params: { project: `project:${OTHER}` } } as never).items.length === 0);
  const sections = entityKnowledge(PARTNER_KNOWLEDGE_REGISTRY, { ...src(), audience: { channel: "EXTERNAL", ownerAuthorized: true } } as never, KEY);
  const pm = sections.find((s) => s.capability === "project_memory");
  ok("partner_entity(project) attaches project_memory (compact: ≤ 6 items, no history)", !!pm && pm.items.length <= 6 && !pm.items.some((i) => String((i as { fields?: { layer?: string } }).fields?.layer ?? "").includes("HISTORY")), sections.map((s) => s.capability));
  ok("…and NOT the owner_inbox section for a project (no duplicate updates)", !sections.some((s) => s.capability === "owner_inbox"));
  const oi = ownerInbox.read(src(), { mode: "all", params: {} } as never);
  const withMem = oi.items.find((i) => i.id === U(1))?.fields.memory as { links: Array<{ linkId: string }>; interpretations: Array<{ interpretationId: string; head: boolean }> } | null;
  ok("owner_inbox items carry their memory ids (links / interpretations, head flag) — addressable", !!withMem && withMem.links[0]?.linkId === U(50) && withMem.interpretations[0]?.interpretationId === U(60) && withMem.interpretations[0]?.head === true, withMem);
  ok("memory unreadable → said so, never 'none'", projectMemory.read(src({ memory: null }), { mode: "summary", params: { project: KEY } } as never).coverage.some((c) => c.text.includes("לא נקרא")));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
