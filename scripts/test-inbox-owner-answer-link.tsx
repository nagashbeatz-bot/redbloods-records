/**
 * Tests — Owner Inbox: an ambiguous name → the Boss answers → an exact link → a truthful close (Owner-approved fix
 * 2026-10-05, the production "חיים אוהב את המיקס" case). Pure / fakes; never touches production.
 *   1. an ambiguous "חיים" never guesses (RESOLVER_UNIQUE refused; the refusal SHOWS the server's candidates)
 *   2. the Boss chooses קרוב אלייך → OWNER_ANSWER with the server's list → the exact link is written
 *   3. an unrelated entity id → refused (NOT_A_CANDIDATE); an arbitrary / malformed key → refused before any write
 *   4. a project completed AFTER the note stays eligible; completed before / with no stamp → not
 *   5. ACTION_PLANNED closes truthfully (a plan on the linked record that ran after the note)
 *   6. no server guidance offers DISMISSED to clear a handled note
 * Run with:   npx tsx scripts/test-inbox-owner-answer-link.tsx
 */
import fs from "node:fs";
import path from "node:path";
import { eligibleProject, linkVerdict, resolveSurface, type ResolverProject } from "../lib/partner/knowledge/inbox-resolver";
import type { MentionEntry } from "../lib/partner/knowledge/inbox-mentions";
import { linkInboxEntity, type InboxMemoryDeps } from "../lib/writes/inbox-memory";
import { zeroInboxGuard } from "../lib/partner/act/primitives/owner-inbox";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 700)}` : ""}`); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const C_HB = `client:${U(1)}`, C_HT = `client:${U(2)}`, P_KAROV = `project:${U(10)}`, P_PESHA = `project:${U(11)}`, P_OTHER = `project:${U(12)}`;
const NOTE_ID = U(99), NOTE_AT = "2026-09-30T23:22:26Z", NOTE_YMD = "2026-10-01"; // Israel day of the note
const BODY = "חיים אוהב את המיקס , יש עוד איזה 2 תיקונים וסיימנו עם המיקס";
const index: MentionEntry[] = [
  { key: C_HB, type: "client", name: "חיים באינסאי", norm: "חיים באינסאי", group: C_HB },
  { key: C_HT, type: "client", name: "חיים טסאו", norm: "חיים טסאו", group: C_HT },
  { key: P_KAROV, type: "project", name: "קרוב אלייך", norm: "קרוב אלייך", group: P_KAROV },
  { key: P_PESHA, type: "project", name: "פשע", norm: "פשע", group: P_PESHA },
  { key: P_OTHER, type: "project", name: "שיר אחר", norm: "שיר אחר", group: P_OTHER },
] as never;
const projects = (karov: Partial<ResolverProject> = {}): ResolverProject[] => [
  { key: P_KAROV, name: "קרוב אלייך", status: "הושלם", artistText: "חיים באינסאי", hidden: false, endDate: "2026-10-05", ...karov },
  { key: P_PESHA, name: "פשע", status: "בעבודה", artistText: "נגש ביטס, חיים טסאו", hidden: false, endDate: null },
  { key: P_OTHER, name: "שיר אחר", status: "בעבודה", artistText: "מישהו אחר", hidden: false, endDate: null },
];

async function main() {
  console.log("\n1. an ambiguous 'חיים' never guesses");
  const r = resolveSurface(BODY, "חיים", index, projects(), NOTE_YMD);
  ok("1a. the surface resolves to a QUESTION (no direct / unique key)", r.status === "OK" && r.direct.length === 0 && r.ambiguous.length >= 2, r);
  const uniq = linkVerdict(r, P_KAROV, "RESOLVER_UNIQUE", null);
  ok("1b. RESOLVER_UNIQUE to קרוב אלייך is refused — AMBIGUOUS_ASK_OWNER (never a guess)", !uniq.ok && uniq.code === "AMBIGUOUS_ASK_OWNER", uniq);
  ok("1c. …and to חיים טסאו too (no lean to either)", (() => { const v = linkVerdict(r, C_HT, "RESOLVER_UNIQUE", null); return !v.ok && v.code === "AMBIGUOUS_ASK_OWNER"; })());
  ok("1d. the refusal SHOWS the server's exact list with names (Sunny never guesses it)", !uniq.ok && uniq.messageHe.includes(`${P_KAROV} (קרוב אלייך)`) && uniq.messageHe.includes(`${C_HT} (חיים טסאו)`), !uniq.ok ? uniq.messageHe : null);

  console.log("\n2. the Boss chooses קרוב אלייך → exact link");
  const list = r.status === "OK" ? r.ambiguous : [];
  const v = linkVerdict(r, P_KAROV, "OWNER_ANSWER", list);
  ok("2a. OWNER_ANSWER with the server's list → OK (quality OWNER_CONFIRMED in the plan)", v.ok && v.method === "OWNER_ANSWER" && JSON.stringify(v.candidates) === JSON.stringify(list), v);
  const writes: unknown[] = [];
  const deps: InboxMemoryDeps = {
    store: { linkEntity: async (a: unknown) => { writes.push(a); return { status: "OK", value: { id: U(500), replayed: false } }; } } as never,
    readItem: async () => ({ body: BODY, status: "NEW", createdAt: NOTE_AT }),
    readMemory: async () => ({ links: [], interpretations: [] }) as never,
    resolverContext: async () => ({ index, projects: projects() }),
    projectBasis: async () => null,
  };
  const w = await linkInboxEntity(deps, { itemId: NOTE_ID, entityKey: P_KAROV, method: "OWNER_ANSWER", surface: "חיים", candidates: list });
  ok("2b. the writer (the note's own day → the completed-after project is eligible) writes the exact link", w.status === "OK" && writes.length === 1 && (writes[0] as { entityKey: string }).entityKey === P_KAROV, { w, writes });
  const before = await linkInboxEntity({ ...deps, readItem: async () => ({ body: BODY, status: "NEW", createdAt: null }) }, { itemId: NOTE_ID, entityKey: P_KAROV, method: "OWNER_ANSWER", surface: "חיים", candidates: list });
  ok("2c. without the note's time the completed project is NOT invented as eligible (refused, nothing written)", before.status === "REFUSED" && writes.length === 1, before);

  console.log("\n3. an unrelated / arbitrary id is refused");
  const un = linkVerdict(r, P_OTHER, "OWNER_ANSWER", list);
  ok("3a. an existing project NOT tied to the name 'חיים' → NOT_A_CANDIDATE", !un.ok && un.code === "NOT_A_CANDIDATE", un);
  const w3 = await linkInboxEntity(deps, { itemId: NOTE_ID, entityKey: P_OTHER, method: "OWNER_ANSWER", surface: "חיים", candidates: list });
  ok("3b. …and the writer writes nothing", w3.status === "REFUSED" && writes.length === 1, w3);
  const w4 = await linkInboxEntity(deps, { itemId: NOTE_ID, entityKey: "project:not-a-uuid", method: "OWNER_ANSWER", surface: "חיים", candidates: list });
  ok("3c. a malformed / unsupported key is refused before any write (BAD_ENTITY_KEY)", w4.status === "REFUSED" && w4.code === "BAD_ENTITY_KEY" && writes.length === 1, w4);
  const w5 = await linkInboxEntity(deps, { itemId: NOTE_ID, entityKey: P_KAROV, method: "OWNER_ANSWER", surface: "חיים", candidates: [P_KAROV, P_OTHER] });
  ok("3d. a candidate list that is not the server's → CANDIDATES_MISMATCH, nothing written", w5.status === "REFUSED" && w5.code === "CANDIDATES_MISMATCH" && writes.length === 1, w5);

  console.log("\n4. one eligibility: completed AFTER the note stays a candidate");
  ok("4a. completed after the note (end 05.10 > note 01.10) → eligible", eligibleProject({ status: "הושלם", hidden: false, endDate: "2026-10-05" }, NOTE_YMD));
  ok("4b. completed BEFORE the note → not eligible", !eligibleProject({ status: "הושלם", hidden: false, endDate: "2026-09-20" }, NOTE_YMD));
  ok("4c. completed with no stamp → not eligible (no invented timeline)", !eligibleProject({ status: "הושלם", hidden: false, endDate: null }, NOTE_YMD));
  ok("4d. cancelled / hidden → never", !eligibleProject({ status: "בוטל", hidden: false, endDate: null }, NOTE_YMD) && !eligibleProject({ status: "בעבודה", hidden: true, endDate: null }, NOTE_YMD));
  const rBefore = resolveSurface(BODY, "חיים", index, projects({ endDate: "2026-09-20" }), NOTE_YMD);
  ok("4e. the resolver's list drops a project completed before the note", rBefore.status === "OK" && !rBefore.ambiguous.includes(P_KAROV), rBefore);
  ok("4f. resolver, understand / evidence and the writer use the SAME eligibility (no second rule)", /eligibleProject\(p, noteYmd\)/.test(read("lib/partner/knowledge/inbox-evidence.ts")) && /openCreditedProjects\(n, projects, noteYmd\)/.test(read("lib/partner/knowledge/inbox-resolver.ts")) && /resolveSurface\(item\.body, a\.surface, ctx\.index, ctx\.projects, noteYmd\)/.test(read("lib/writes/inbox-memory.ts")) && /endDate: meta\.get\(id\)\?\.endDate/.test(read("lib/partner/knowledge/inbox-understand.ts")));

  console.log("\n5. ACTION_PLANNED closes truthfully");
  const guardDeps = (keys: string[], scope: { entities: string[]; executedAt: string | null } | null) => ({ inboxItemEntityKeys: async () => keys, readActionPlanScope: async () => scope }) as never;
  ok("5a. linked + the plan that completed קרוב אלייך ran after the note → passes", (await zeroInboxGuard(guardDeps([P_KAROV], { entities: [P_KAROV], executedAt: "2026-10-05T20:27:49Z" }), NOTE_ID, "ACTION_PLANNED", "pl_x", NOTE_AT)) === null);
  const g2 = await zeroInboxGuard(guardDeps([P_KAROV], { entities: [P_KAROV], executedAt: "2026-09-20T10:00:00Z" }), NOTE_ID, "ACTION_PLANNED", "pl_x", NOTE_AT);
  ok("5b. a plan that ran BEFORE the note never closes it", g2?.code === "REF_PLAN_BEFORE_NOTE", g2);
  const g3 = await zeroInboxGuard(guardDeps([P_KAROV], { entities: [P_OTHER], executedAt: "2026-10-05T20:27:49Z" }), NOTE_ID, "ACTION_PLANNED", "pl_x", NOTE_AT);
  ok("5c. a plan on another record never closes it", g3?.code === "REF_PLAN_UNRELATED", g3);
  const g4 = await zeroInboxGuard(guardDeps([], null), NOTE_ID, "ACTION_PLANNED", "pl_x", NOTE_AT);
  ok("5d. not linked yet → LINK_FIRST, pointing to the link + ACTION_PLANNED path", g4?.code === "LINK_FIRST" && /LINK_INBOX_ENTITY/.test(g4.messageHe) && /ACTION_PLANNED/.test(g4.messageHe), g4);

  console.log("\n6. DISMISSED is never offered to clear a handled note");
  const g5 = await zeroInboxGuard(guardDeps([], null), NOTE_ID, "NO_ACTION_NEEDED", null, NOTE_AT);
  ok("6a. NO_EXACT_HOME points to linking, and says DISMISSED is only when the Boss drops the note", g5?.code === "NO_EXACT_HOME" && /LINK_INBOX_ENTITY/.test(g5.messageHe) && /אל תסגור כ-DISMISSED פתק שטופל/.test(g5.messageHe), g5);
  const guidance = read("lib/partner/act/primitives/owner-inbox.ts") + read("lib/partner/knowledge/inbox-resolver.ts") + read("lib/integrations/partner-mcp/mcp.ts");
  ok("6b. no server text offers DISMISSED as a way out ('או DISMISSED' / 'DISMISSED אם הבוס מוותר')", !/או DISMISSED|DISMISSED אם הבוס מוותר/.test(guidance));
  ok("6c. the instructions forbid DISMISSED for a handled note", /NEVER to clear a note that was handled/.test(read("lib/integrations/partner-mcp/mcp.ts")));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
