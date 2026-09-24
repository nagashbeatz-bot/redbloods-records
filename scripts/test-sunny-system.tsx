/**
 * Tests — Sunny Full Brain: system awareness registry, repository-wide awareness enforcement, the OPERATIONS read
 * source (safe read gaps), the new capabilities, capability change awareness, limits honesty and Push safety.
 *
 * Run with:   npx tsx scripts/test-sunny-system.tsx
 *
 * NEVER touches production. The operations reader runs over a recording fake client; capabilities run over the
 * production-shaped fixture + a crafted operations snapshot.
 */
import fs from "node:fs";
import path from "node:path";
import { BUSINESS_ACTIONS, CAPABILITY_CHANGES, DOMAIN_CONTRACTS, FORBIDDEN_SERVED_TERMS, RELATIONSHIPS, SURFACE_EXCLUSIONS, SYSTEM_BASELINE_VERSION, validateSystemRegistry } from "../lib/partner/system";
import { PARTNER_KNOWLEDGE_REGISTRY } from "../lib/partner/knowledge/catalog";
import { entityKnowledge, queryKnowledgeCore } from "../lib/partner/knowledge/query";
import type { KnowledgeAudience, QueryResponse } from "../lib/partner/knowledge/types";
import { KNOWLEDGE_KINDS } from "../lib/partner/owner-knowledge/kinds";
import { readOperationsRaw, ROW_CAP, type OperationsRaw, type OperationsReadClient, type OpsQuery } from "../lib/partner/operations/readers";
import { proposeActionPreviewCore } from "../lib/partner/sunny/action-proposal";
import type { GatewaySources } from "../lib/partner/gateway/core";
import { SERVER_INSTRUCTIONS } from "../lib/integrations/partner-mcp/mcp";
import { buildToolDefinitions } from "../lib/integrations/partner-mcp/tools";
import { NOW, P, U, LA_SHALEV, C_AVI, input } from "./fixtures/integrity-company";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}
const ok = (name: string, cond: boolean) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}`); fail++; } };
const section = (t: string) => console.log(`\n${t}`);
const ROOT = path.resolve(__dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
/** Source without comments (so a comment saying "never calls X" does not count as calling X). */
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const OWNER: KnowledgeAudience = { channel: "EXTERNAL", ownerAuthorized: true };
const STRANGER: KnowledgeAudience = { channel: "EXTERNAL", ownerAuthorized: false };
const REG = PARTNER_KNOWLEDGE_REGISTRY;

// ── fixture: company state + a crafted operations snapshot ──
const sec = <T,>(rows: T[]) => ({ rows, capped: false });
const OPS: OperationsRaw = {
  redFilms: sec([
    { id: U(801), title: "קליפ שליו", productionType: "קליפ", status: "בעריכה", projectId: P(1), clientId: null, artistName: "שליו טסמה", clientSource: "אמן לייבל", shootDate: "2026-09-20", publishDate: null, editStatus: "בעריכה", collectionStatus: "לא רלוונטי", generalBudget: 8000, clientPrice: null, advanceRequired: null, advanceReceived: null },
    { id: U(802), title: "הפקה ישנה", productionType: "יום צילום", status: "פורסם", projectId: null, clientId: null, artistName: null, clientSource: null, shootDate: "2026-01-01", publishDate: "2026-02-01", editStatus: "פורסם", collectionStatus: "שולם", generalBudget: null, clientPrice: 3000, advanceRequired: null, advanceReceived: 3000 },
  ]),
  budgetItems: sec([{ productionId: U(801), planned: 5000, actual: 4200, status: "מתוכנן", hasTransaction: false }, { productionId: U(801), planned: 3000, actual: null, status: "מתוכנן", hasTransaction: false }]),
  budgetPayments: sec([{ productionId: U(801), amount: 2000, paymentDate: "2026-09-10" }]),
  equipment: sec([{ category: "מצלמה", status: "קיים" }]),
  clipItems: sec([{ projectId: P(1), category: "תאורה", amount: 1500, currency: "₪", status: "תכנון בלבד", hasTransaction: false }, { projectId: P(1), category: "ציוד", amount: 200, currency: "$", status: "תכנון בלבד", hasTransaction: false }, { projectId: P(1), category: "בוטל", amount: 999, currency: "₪", status: "בוטל", hasTransaction: false }, { projectId: P(1), category: "לוקיישן", amount: 900, currency: "₪", status: "הועבר לכספים", hasTransaction: false }]),
  meetings: sec([{ id: U(811), date: "2026-09-28", time: "12:00", status: "נקבעה", projectId: P(2), clientId: C_AVI, hasCalendarEvent: true }, { id: U(812), date: "2026-09-01", time: "10:00", status: "התקיימה", projectId: null, clientId: C_AVI, hasCalendarEvent: false }, { id: U(813), date: "2026-09-30", time: "10:00", status: "בוטלה", projectId: null, clientId: null, hasCalendarEvent: false }]),
  projectActions: sec([{ id: U(821), projectId: P(2), actionType: "sent", contentType: "mix", recipientRole: "artist", status: "pending_feedback", actionDate: "2026-09-15", followupDate: "2026-09-20" }, { id: U(822), projectId: P(2), actionType: "approved", contentType: "mix", recipientRole: "artist", status: "approved", actionDate: "2026-09-01", followupDate: null }]),
  beats: sec([{ id: U(831), name: "Riddim A", genre: "dancehall", musicalKey: "A Minor", status: "available", createdAt: "2026-09-01T10:00:00Z" }, { id: U(832), name: "Soul B", genre: "soul", musicalKey: "C Major", status: "available", createdAt: "2026-09-02T10:00:00Z" }]),
  beatAssignments: sec([{ beatId: U(831), artistSlug: "shalev-tasama" }, { beatId: U(832), artistSlug: "avi-molla" }]),
  campaigns: sec([{ id: U(841), projectId: P(1), title: "קמפיין שיר לייבל", artistName: "שליו טסמה", releaseDate: "2026-10-05", status: "active", promotionBudget: 2000 }]),
  contentItems: sec([{ campaignId: U(841), status: "draft", contentType: "reel", platform: "instagram", dueDate: "2026-09-20", publishDate: null }, { campaignId: U(841), status: "published", contentType: "reel", platform: "tiktok", dueDate: "2026-09-10", publishDate: "2026-09-10" }]),
  promotions: sec([{ campaignId: U(841), channel: "instagram", plannedAmount: 500, status: "מתוכנן", promoDate: null, hasTransaction: false }]),
  balanceCycles: sec([{ artistId: LA_SHALEV, cycleIndex: 0, startDate: "2026-06-01", endDate: "2026-08-01", income: 4000, payments: 3000, expenses: 0, endingBalance: 1000, closedAt: "2026-08-02T10:00:00Z" }]),
  albumTracks: sec([{ projectId: P(2), trackNumber: 1, title: "שיר 1", status: "טרום הקלטה", mixStatus: "הושלם", masterStatus: "בתהליך" }]),
  engineerWork: sec([
    { id: U(851), projectId: P(2), engineerName: "Steven", workType: "מיקס + מאסטר", workTitle: null, status: "בתהליך", sentDate: "2026-09-10", internalDeadline: "2026-09-30", agreedPrice: 200, amountPaid: 0, currency: "$", paymentDate: null },
    { id: U(852), projectId: P(4), engineerName: "Bill", workType: "מיקס", workTitle: null, status: "אושר", sentDate: "2026-08-10", internalDeadline: null, agreedPrice: 800, amountPaid: 0, currency: "₪", paymentDate: null },
  ]),
  mixVersions: sec([{ id: U(861), workId: U(851), status: "בבדיקה", createdAt: "2026-09-18T10:00:00Z" }]),
  mixComments: sec([{ versionId: U(861), status: "open" }, { versionId: U(861), status: "resolved" }]),
  finalFiles: sec([{ workId: U(852), createdAt: "2026-09-01T10:00:00Z" }]),
  deliveries: sec([{ projectId: P(3), status: "ready", deliveredAt: null }]),
  integrations: { googleCalendarConnected: true, dropboxConnected: true },
};
function sources(ops: OperationsRaw | "UNAVAILABLE" | undefined = OPS): GatewaySources {
  const st = input({ contexts: [] }).state!;
  return { now: NOW, state: { status: "OK", value: st }, identities: { cleantone: null },
    ...(ops === undefined ? {} : { operations: ops === "UNAVAILABLE" ? { status: "UNAVAILABLE" as const, detail: "x" } : { status: "OK" as const, value: ops } }) };
}
const q = (capability: string, extra: { mode?: string; params?: Record<string, string> } = {}, src = sources(), aud = OWNER): QueryResponse => queryKnowledgeCore(REG, { capability, ...extra }, src, aud);

// ── recording fake client for the reader ──
function fakeClient(o: { fail?: string[]; big?: string } = {}) {
  const calls: Array<{ table: string; columns: string; filters: string[]; ranges: Array<[number, number]> }> = [];
  const client: OperationsReadClient = {
    from(table) {
      return {
        select(columns) {
          const c = { table, columns, filters: [] as string[], ranges: [] as Array<[number, number]> };
          calls.push(c);
          const qb: OpsQuery = {
            range(a, b) { c.ranges.push([a, b]); return qb; },
            like(col, pat) { c.filters.push(`like:${col}:${pat}`); return qb; },
            in(col, vals) { c.filters.push(`in:${col}:${vals.join(",")}`); return qb; },
            then(res, rej) {
              const [a, b] = c.ranges.at(-1) ?? [0, 0];
              if (o.fail?.includes(table)) return Promise.resolve({ data: null, error: { message: "boom" } }).then(res, rej);
              if (o.big === table) return Promise.resolve({ data: Array.from({ length: b - a + 1 }, (_, i) => ({ id: U(10000 + a + i), beat_id: U(1), artist_slug: "x" })), error: null }).then(res, rej);
              const data = table === "settings" && c.filters.some((f) => f.startsWith("in:")) ? [{ key: "google_calendar_token" }]
                : table === "settings" ? [{ key: `delivery_${P(3)}`, status: "ready", delivered: null }, { key: "delivery_not-a-uuid", status: "x", delivered: null }]
                : table === "meetings" ? [{ id: U(9), date: "2026-09-28", time: "10:00", status: "נקבעה", project_id: null, client_id: null, calendar_event_id: "evt" }] : [];
              return Promise.resolve({ data, error: null }).then(res, rej);
            },
          };
          return qb;
        },
      };
    },
  };
  return { client, calls };
}

async function main() {
  section("A. System registry — valid, consistent with the knowledge registry and the kind registry");
  const capIds = REG.all().map((c) => c.id);
  check("validateSystemRegistry()", validateSystemRegistry({ capabilityIds: capIds, knowledgeKinds: KNOWLEDGE_KINDS.map((k) => k.kind) }), []);
  ok(`${DOMAIN_CONTRACTS.length} domains, ${RELATIONSHIPS.length} relationships, ${BUSINESS_ACTIONS.length} actions`, DOMAIN_CONTRACTS.length >= 30 && RELATIONSHIPS.length >= 40 && BUSINESS_ACTIONS.length >= 35);
  ok("the baseline version has change entries (capability change awareness)", CAPABILITY_CHANGES.some((c) => c.version === SYSTEM_BASELINE_VERSION));
  ok("Sunny execute is unavailable for EVERY domain in this baseline", DOMAIN_CONTRACTS.every((d) => d.support.execute === "INTENTIONALLY_UNAVAILABLE" || d.support.execute === "MISSING"));
  ok("FULL is never claimed without a live read capability", DOMAIN_CONTRACTS.filter((d) => d.support.read === "FULL").every((d) => d.readCapabilities.length > 0));
  ok("Push and Agent Alerts are not readable / executable by Sunny", ["PUSH_NOTIFICATIONS", "AGENT_ALERTS"].every((id) => { const d = DOMAIN_CONTRACTS.find((x) => x.id === id)!; return d.readCapabilities.length === 0 && d.support.execute === "INTENTIONALLY_UNAVAILABLE"; }));
  ok("Google Calendar is honestly NOT_CONNECTED (no event read, no write)", (() => { const d = DOMAIN_CONTRACTS.find((x) => x.id === "GOOGLE_CALENDAR")!; return d.states.includes("NOT_CONNECTED") && d.freshness === "NOT_CONNECTED" && d.support.read === "PARTIAL"; })());
  ok("every notification contract says sunnyMayTrigger=false", DOMAIN_CONTRACTS.flatMap((d) => d.notifications ?? []).every((n) => n.sunnyMayTrigger === false));
  ok("CONFLICT / POSSIBLE_BUG rules exist and are never marked as policy", DOMAIN_CONTRACTS.flatMap((d) => d.rules).filter((r) => r.class === "CONFLICT").length >= 10 && DOMAIN_CONTRACTS.flatMap((d) => d.rules).filter((r) => r.class === "POSSIBLE_BUG").length >= 10);
  ok("the canonical finance rules are encoded (received / paid / partial / cancelled / no FX / debt / overpayment)", ["INCOME_RECEIVED", "EXPENSE_PAID", "PARTIAL_NOT_PAID", "CANCELLED_NOT_MONEY", "NO_FX", "PROJECT_DEBT", "FINANCE_EXCEPTION"].every((id) => DOMAIN_CONTRACTS.find((d) => d.id === "FINANCE")!.rules.some((r) => r.id === id && r.class === "CANONICAL_BUSINESS_RULE")));

  section("B. Repository-wide awareness — every page and API group is owned by a domain or explicitly excluded");
  const pages: string[] = [];
  const walk = (dir: string, cb: (f: string) => void) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p, cb); else cb(p); } };
  walk(path.join(ROOT, "app"), (f) => { const rel = path.relative(path.join(ROOT, "app"), f).replace(/\\/g, "/"); if (rel.endsWith("/page.tsx") || rel === "page.tsx") { if (!rel.startsWith("api/")) pages.push("/" + rel.replace(/\/?page\.tsx$/, "")); } });
  const apis: string[] = [];
  walk(path.join(ROOT, "app", "api"), (f) => { if (f.endsWith("route.ts")) apis.push(path.relative(path.join(ROOT, "app", "api"), path.dirname(f)).replace(/\\/g, "/")); });
  const pagePrefixes = [...DOMAIN_CONTRACTS.flatMap((d) => d.surfaces.pages), ...SURFACE_EXCLUSIONS.filter((x) => x.kind === "page").map((x) => x.surface)];
  const apiPrefixes = [...DOMAIN_CONTRACTS.flatMap((d) => d.surfaces.api), ...SURFACE_EXCLUSIONS.filter((x) => x.kind === "api").map((x) => x.surface)];
  const owned = (p: string, prefixes: string[]) => prefixes.some((x) => p === x || (x !== "/" && p.startsWith(x.endsWith("/") ? x : `${x}/`)));
  check("pages not owned by any domain (add to a domain or SURFACE_EXCLUSIONS)", pages.filter((p) => !owned(p === "" ? "/" : p, pagePrefixes)), []);
  check("API routes not owned by any domain", apis.filter((a) => !owned(a, apiPrefixes)), []);
  ok(`scanned ${pages.length} pages and ${apis.length} API routes`, pages.length > 30 && apis.length > 150);
  const META = new Set(["catalog", "brief", "known_unknowns", "improvement_signals", "relations", "owner_knowledge"]);
  check("every registered knowledge capability is claimed by a domain (or is a meta capability)", capIds.filter((c) => !META.has(c) && !DOMAIN_CONTRACTS.some((d) => d.readCapabilities.includes(c))), []);
  ok("AGENTS.md carries the Sunny Awareness Check development contract", /Sunny Awareness Check/.test(read("AGENTS.md")) && /SUNNY IMPACT: NONE/.test(read("AGENTS.md")) && /test-sunny-system\.tsx/.test(read("AGENTS.md")));

  section("C. OPERATIONS reader — narrow, read-only, fail closed per section");
  const f1 = fakeClient({ fail: ["beats"] });
  const raw = await readOperationsRaw(f1.client);
  const cols = f1.calls.map((c) => c.columns).join(",");
  ok("no free text / file paths / links / receipts / phones / secrets are selected", !/notes|caption|hook|script|concept|dropbox_path|dropbox_url|_link|url|receipt|phone|comment_text|body|token|value\b|recipient_name|serial/.test(cols.replace(/value->>deliveryStatus|value->>deliveredAt/g, "")));
  ok("the integrations check selects the settings KEY only (never a credential value)", f1.calls.some((c) => c.table === "settings" && c.columns === "key" && c.filters.includes("in:key:google_calendar_token,dropbox_tokens")));
  ok("delivery selects only status + delivered date out of the setting JSON", f1.calls.some((c) => c.table === "settings" && c.columns === "key, status:value->>deliveryStatus, delivered:value->>deliveredAt" && c.filters.includes("like:key:delivery_%")));
  check("a failing section is null (UNAVAILABLE) while the others still read", [raw.beats, raw.meetings?.rows.length, raw.integrations], [null, 1, { googleCalendarConnected: true, dropboxConnected: false }]);
  check("delivery keys that are not project uuids are ignored", raw.deliveries?.rows, [{ projectId: P(3), status: "ready", deliveredAt: null }]);
  ok("the reader client interface has no write method", !/insert|update|delete|upsert|rpc/.test(read("lib/partner/operations/readers.ts").split("export async function readOperationsRaw")[0].split("export interface OperationsReadClient")[1].split("\n")[0]));
  const f2 = fakeClient({ big: "beat_artist_assignments" });
  const raw2 = await readOperationsRaw(f2.client);
  check("paged + capped at ROW_CAP (capped flagged)", [raw2.beatAssignments?.rows.length, raw2.beatAssignments?.capped], [ROW_CAP, true]);

  section("D. New read capabilities over the fixture");
  const t = q("tasks", { mode: "all" });
  check("tasks: status OK over the existing canonical state", t.status, "OK");
  const rf = q("red_films");
  check("red_films: active only, budget planned / actual / paid summed, separate-ledger coverage", [rf.items.map((i) => i.id), rf.items[0]?.fields.budgetPlanned, rf.items[0]?.fields.budgetActual, rf.items[0]?.fields.budgetPaid, rf.coverage.some((c) => c.text.includes("ספר נפרד"))], [[U(801)], 8000, 4200, 2000, true]);
  check("red_films is FINANCIAL + Owner-only: refused for a caller without Owner authority", q("red_films", {}, sources(), STRANGER).status, "NOT_AUTHORIZED");
  const cp = q("clip_planning", { params: { project: `project:${P(1)}` } });
  check("clip_planning: cancelled + already-promoted ('הועבר לכספים') rows excluded, totals per currency (no FX), planning-only", [cp.items.length, cp.summary[0].value, cp.items.every((i) => i.fields.planningOnly === true)], [2, { "₪": 1500, "$": 200 }, true]);
  const mt = q("meetings");
  check("meetings upcoming: today+ and not cancelled; linked by ID", [mt.items.map((i) => i.id), mt.items[0]?.relationQuality], [[U(811)], "ID"]);
  const pa = q("project_actions", { params: { project: `project:${P(2)}` } });
  check("project_actions open: approved excluded; follow-up overdue flagged", [pa.items.map((i) => i.id), pa.items[0]?.fields.followupOverdue], [[U(821)], true]);
  const bt = q("beats", { params: { artist: `label-artist:${LA_SHALEV}` } });
  check("beats for Shalev's portal (slug mapping)", [bt.items.map((i) => i.id), bt.items[0]?.fields.assignedTo], [[U(831)], ["שליו טסמה"]]);
  const so = q("social");
  check("social: content by status, overdue (draft past due), promotions planned", [so.items[0]?.fields.contentOverdue, so.items[0]?.fields.promotionsPlanned, so.items[0]?.fields.contentByStatus], [1, 500, { draft: 1, published: 1 }]);
  const bc = q("balance_cycles", { params: { artist: `label-artist:${LA_SHALEV}` } });
  check("balance_cycles: closed cycle, own ending balance, no carry-over note", [bc.items.length, bc.items[0]?.fields.endingBalanceOfCycle, bc.coverage.some((c) => c.text.includes("ללא יתרת פתיחה"))], [1, 1000, true]);
  const al = q("albums", { params: { project: `project:${P(2)}` } });
  check("albums: mix / master progress", [al.summary.map((s) => s.value)], [[1, 0]]);
  const mp = q("mix_pipeline", { mode: "all" });
  const steven = mp.items.find((i) => i.id === U(851))!, bill = mp.items.find((i) => i.id === U(852))!;
  check("mix_pipeline: every engineer; versions, OPEN comments only, finals, paid rule", [mp.items.length, steven.fields.versions, steven.fields.openComments, bill.fields.finalFiles, bill.fields.paid], [2, 1, 1, 1, false]);
  check("mix_pipeline unpaid: approved and not fully paid", q("mix_pipeline", { mode: "unpaid" }).items.map((i) => i.id), [U(852)]);
  check("deliveries", q("deliveries").items.map((i) => [i.entity, i.fields.deliveryStatus]), [[`project:${P(3)}`, "ready"]]);
  const ig = q("integrations");
  check("integrations: connected state, and Sunny can neither read nor write the calendar", [ig.items[0].fields.connectedInRedbloods, ig.items[0].fields.sunnyCanRead, ig.items[0].fields.sunnyCanWrite, ig.items[1].fields.sunnyCanReadContents], [true, false, false, false]);
  const un = q("red_films", {}, sources("UNAVAILABLE"));
  check("operations unavailable → UNKNOWN + missing[] (never 'none')", [un.completeness, un.items.length, un.missing.length > 0], ["UNKNOWN", 0, true]);
  const enr = entityKnowledge(REG, { ...sources(), audience: OWNER }, `project:${P(2)}`);
  ok("partner_entity enrichment for a project now includes meetings, project actions, albums, mix pipeline automatically", ["meetings", "project_actions", "albums", "mix_pipeline"].every((c) => enr.some((s) => s.capability === c)));

  section("E. system_awareness — Sunny knows the system and its limits (served semantically)");
  const ov = q("system_awareness");
  check("overview lists every domain", ov.page?.total, DOMAIN_CONTRACTS.length);
  const shows = q("system_awareness", { mode: "domain", params: { domain: "SHOWS" } });
  ok("domain SHOWS: purpose, rules, side effects, notifications, limitations — and NO internal surfaces", !!shows.items[0]?.fields.purpose && !("surfaces" in (shows.items[0]?.fields ?? {})) && (shows.items[0]?.fields.notifications as unknown[]).length >= 3);
  const acts = q("system_awareness", { mode: "actions", params: { domain: "SHOWS" }, });
  const cs = acts.items.find((i) => i.id === "CREATE_SHOW")!;
  check("'can you create a show?' → exists, FUTURE_PRIMITIVE_REQUIRED, with the inputs to collect", [cs.fields.class, cs.fields.approval], ["FUTURE_PRIMITIVE_REQUIRED", "OWNER_APPROVAL_IN_DASHBOARD"]);
  const push = q("system_awareness", { mode: "actions", params: { domain: "PUSH_NOTIFICATIONS" } });
  check("'can you send push?' → NEVER_EXPOSE_TO_SUNNY", push.items.map((i) => i.fields.class), ["NEVER_EXPOSE_TO_SUNNY"]);
  const cal = q("system_awareness", { mode: "coverage", params: { domain: "GOOGLE_CALENDAR" } });
  check("'calendar access?' → read PARTIAL (connection only), execute unavailable, NOT_CONNECTED", [cal.items[0].fields.read, cal.items[0].fields.execute, (cal.items[0].fields.states as string[]).includes("NOT_CONNECTED")], ["PARTIAL", "INTENTIONALLY_UNAVAILABLE", true]);
  const conflicts = q("system_awareness", { mode: "rules", params: { class: "CONFLICT" }, });
  ok("conflicts are served as OBSERVATION and policy=false (never taught as policy)", conflicts.items.length >= 10 && conflicts.items.every((i) => i.epistemic === "OBSERVATION" && i.fields.policy === false));
  const lim = q("system_awareness", { mode: "limitations", params: { domain: "GOOGLE_CALENDAR" } });
  ok("limitations in Hebrew, incl. 'תוסיף ליומן' honesty", lim.items.some((i) => i.label.text.includes("תוסיף ליומן")));
  const ch = q("system_awareness", { mode: "changes" });
  check("changes: newest first, baseline version in summary", [ch.items[0]?.fields.version, ch.summary[0].value], [SYSTEM_BASELINE_VERSION, SYSTEM_BASELINE_VERSION]);
  const all = JSON.stringify(["overview", "domain", "rules", "relationships", "actions", "limitations", "changes", "coverage"].flatMap((m) => DOMAIN_CONTRACTS.map((d) => q("system_awareness", { mode: m, params: m === "domain" ? { domain: d.id } : {} }))));
  check("no implementation term (tables, secrets, source paths) is ever served", FORBIDDEN_SERVED_TERMS.filter((t) => all.toLowerCase().includes(t.toLowerCase())), []);
  check("available to the connector audience", q("system_awareness", {}, sources(), STRANGER).status, "OK");

  section("F. Sunny knows its limits in actions (P3 core)");
  const cr = proposeActionPreviewCore(sources(), { actionType: "CREATE_SHOW", project: null, newDeadline: null }) as { status: string; known: { class: string; design: { inputs: string[] } } | null; messageHe: string };
  check("CREATE_SHOW → UNSUPPORTED_ACTION with the registry's knowledge; nothing created", [cr.status, cr.known?.class, (cr.known?.design.inputs.length ?? 0) > 0, cr.messageHe.includes("שום דבר לא נוצר")], ["UNSUPPORTED_ACTION", "FUTURE_PRIMITIVE_REQUIRED", true, true]);
  check("finance through Sunny still disabled", proposeActionPreviewCore(sources(), { actionType: "RECORD_PAID_EXPENSE", project: null, newDeadline: null }).status, "FINANCE_ACTIONS_DISABLED");

  section("G. Connector: no new tool, capabilities discoverable through partner_query, instructions point at system_awareness");
  const tools = buildToolDefinitions(REG.describe(OWNER).map((c) => ({ id: c.id, title: c.title, description: c.description, modes: Object.keys(c.modes), params: Object.keys(c.params) })), { answer: true });
  check("P1 tool set unchanged (5 tools)", tools.map((t) => t.name), ["partner_brief", "partner_resolve", "partner_entity", "partner_query", "partner_answer_question"]);
  const qd = tools.find((t) => t.name === "partner_query")!.description;
  ok("partner_query lists system_awareness and every new capability", ["system_awareness", "tasks", "red_films", "meetings", "project_actions", "beats", "social", "balance_cycles", "albums", "mix_pipeline", "deliveries", "integrations", "clip_planning"].every((c) => qd.includes(`- ${c} (`)));
  ok("server instructions: ask system_awareness, never claim an unavailable action happened", SERVER_INSTRUCTIONS.includes("system_awareness") && SERVER_INSTRUCTIONS.includes("never claim it was done"));

  section("H. Push safety (read-only verification — Push is NOT modified)");
  const clientFiles: string[] = [];
  for (const d of ["components", "app"]) walk(path.join(ROOT, d), (f) => { if (/\.(tsx|ts)$/.test(f) && !f.includes(`${path.sep}api${path.sep}`)) clientFiles.push(f); });
  check("no page / component calls the push check endpoint", clientFiles.filter((f) => code(fs.readFileSync(f, "utf8")).includes("/api/push/check")).map((f) => path.relative(ROOT, f)), []);
  ok("PushManager only registers / subscribes (never sends)", !/sendPush|push\/check|push\/cron/.test(code(read("components/PushManager.tsx"))));
  ok("no Sunny module imports the push sender", ["lib/partner/operations/readers.ts", "lib/partner/knowledge/capabilities/operations.ts", "lib/partner/knowledge/capabilities/system.ts", "lib/partner/system/registry.ts", "lib/partner/system/index.ts"].every((f) => !/lib\/push|sendPush|web-push/.test(read(f))));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
