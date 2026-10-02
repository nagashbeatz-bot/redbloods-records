/**
 * Tests — Sunny Brain v1 + the T2 Owner approval layer + partner:observe (2026-10-02).
 *
 * Run with:   npx tsx scripts/test-sunny-brain.tsx
 *
 * NEVER touches production: every DB call goes to an in-memory fake that records the RPC name + arguments. The SQL
 * itself (security, races, migrations, the URL function) was proven separately on the local Postgres harness; here
 * the TypeScript side is pinned to the applied SQL text (vocabularies, wrapper names, grants) so the two cannot drift.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { canonicalUrl } from "../lib/partner/brain/url";
import * as V from "../lib/partner/brain/vocab";
import { buildTrackingPayload, checkIntel, checkLinks, checkObservationItem, checkTransition, checkContent, trackingSummaryHe, webPageIdentity } from "../lib/partner/brain/requests";
import { brainRefusal, readBrainSnapshot, BRAIN_RPC_CODES, type BrainReadClient } from "../lib/brain-store";
import * as W from "../lib/writes/brain";
import { brainState, type BrainSnapshot } from "../lib/partner/brain/model";
import { buildOwnerApprovalsView } from "../lib/partner/brain/owner-view";
import { RECHECK_POLICY, recheckProposals, researchSeries } from "../lib/partner/brain/research";
import { PARTNER_KNOWLEDGE_REGISTRY } from "../lib/partner/knowledge/catalog";
import { queryKnowledgeCore } from "../lib/partner/knowledge/query";
import type { KnowledgeAudience } from "../lib/partner/knowledge/types";
import type { GatewaySources } from "../lib/partner/gateway/core";
import { readMcpConfig, scopeString, hasObserveScope, MCP_OBSERVE_SCOPE } from "../lib/integrations/partner-mcp/config";
import { advertisedScope, grantedScope } from "../lib/integrations/partner-mcp/oauth";
import { isAllowedMcpOnlyFetch } from "../lib/integrations/partner-mcp/mcp-only";
import { handleMcpHttp, type McpDeps } from "../lib/integrations/partner-mcp/mcp";
import { SlidingWindowLimiter } from "../lib/integrations/partner-mcp/rate-limit";
import { OBSERVE_OPS, OBSERVE_TOOL, OBSERVE_TOOL_DEFINITION, validateObserveInput } from "../lib/integrations/partner-mcp/observe-tool";
import { BASE_ENV } from "./fixtures/mcp-oauth-scenarios";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}${detail === undefined ? "" : `  ${JSON.stringify(detail).slice(0, 400)}`}`); fail++; } };
const section = (t: string) => console.log(`\n${t}`);
const ROOT = path.resolve(__dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const BRAIN_SQL = read("scripts/sql/sunny-brain/2026-10-XX-sunny-brain-v1-CANDIDATE.sql");
const T2_SQL = read("scripts/sql/sunny-brain/2026-10-XX-t2-owner-approval-queue-CANDIDATE.sql");
const SCOPE_SQL = read("scripts/sql/sunny-brain/2026-10-XX-scope-partner-observe-CANDIDATE.sql");
const sha = (f: string) => createHash("sha256").update(fs.readFileSync(path.join(ROOT, f))).digest("hex");
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sqlList = (re: RegExp, src = BRAIN_SQL) => [...(re.exec(src)?.[1] ?? "").matchAll(/'([^']+)'/g)].map((m) => m[1]);
const NOW = new Date("2026-10-02T09:00:00Z");
const TODAY = "2026-10-02";
const OWNER_EXT: KnowledgeAudience = { channel: "EXTERNAL", ownerAuthorized: true };

/** Fake PostgREST client: records every rpc; answers by function name. */
function fakeRpc(answer: (fn: string, args: Record<string, unknown>) => { data: unknown; error: { message: string; code?: string } | null }) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  return { calls, client: { rpc: async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return answer(fn, args); } } };
}

async function main() {
  section("A. The applied SQL is what the repo carries (byte-identical, Owner-verified SHAs)");
  check("Brain v1 forward = 562b47cd…", sha("scripts/sql/sunny-brain/2026-10-XX-sunny-brain-v1-CANDIDATE.sql"), "562b47cdd2d06833c36b40c17bebb782e458ae376ac806a39b2f621f6c1b4f5c");
  check("P2 forward = 4abd0179…", sha("scripts/sql/sunny-brain/2026-10-XX-p2-business-decision-learning-CANDIDATE.sql").slice(0, 8), "4abd0179");
  check("T2 forward = a59e3ccd…", sha("scripts/sql/sunny-brain/2026-10-XX-t2-owner-approval-queue-CANDIDATE.sql"), "a59e3ccd47ebfc7530f8ac5778db3db740686d62e440b327188bb56fec33c266");
  check("scope forward = 17adc6fc…", sha("scripts/sql/sunny-brain/2026-10-XX-scope-partner-observe-CANDIDATE.sql"), "17adc6fc83fc2cd576776c7036d108747caf08cdad6c4008aaaee5fb7eb5b003");

  section("B. Vocabularies = the SQL CHECK literals");
  check("platforms", sqlList(/platform\s+text NOT NULL CHECK \(platform IN \(([^)]*)\)\)/), [...V.BRAIN_PLATFORMS]);
  check("content kinds", sqlList(/content_kind IN \(([^)]*)\)\)/), [...V.CONTENT_KINDS]);
  check("purpose kinds", sqlList(/purpose_kind IN \(([^)]*)\)\)/), [...V.PURPOSE_KINDS]);
  check("authorization source kinds", sqlList(/source_kinds <@ ARRAY\[([^\]]*)\]/), [...V.AUTH_SOURCE_KINDS]);
  check("observation source kinds", sqlList(/source_kind\s+text NOT NULL CHECK \(source_kind IN \(([^)]*)\)\)/).sort(), [...V.OBS_SOURCE_KINDS].sort());
  check("intel areas", sqlList(/area\s+text NOT NULL CHECK \(area IN \(([^)]*)\)\)/), [...V.INTEL_AREAS]);
  check("record types (active + reserved)", sqlList(/record_type\s+text NOT NULL CHECK \(record_type IN \(([^)]*)\)\)/), [...V.RECORD_TYPES, ...V.RESERVED_RECORD_TYPES]);
  check("link roles (active + reserved)", sqlList(/role\s+text NOT NULL CHECK \(role IN \(([^)]*)\)\)/), [...V.LINK_ROLES, ...V.RESERVED_LINK_ROLES]);
  check("reserved link roles refused by CHECK", sqlList(/sunny_links_v1_roles CHECK \(role NOT IN \(([^)]*)\)\)/), [...V.RESERVED_LINK_ROLES]);
  check("insight kinds", sqlList(/insightKind' NOT IN \(([^)]*)\)/), [...V.INSIGHT_KINDS]);
  check("causal statuses", sqlList(/causalStatus' NOT IN \(([^)]*)\)/), [...V.CAUSAL_STATUSES]);
  const tuples = [...(/sunny_intel_transition_ok[\s\S]*?IN \(([\s\S]*?)\)\s*\n\s*-- v1\.1/.exec(BRAIN_SQL)?.[1] ?? "").matchAll(/\('(\w+)','([^']+)','(\w+)','(\w+)'\)/g)].map((m) => [m[1], m[2] === "∅" ? null : m[2], m[3], m[4]]);
  check("lifecycle transitions = sunny_intel_transition_ok (20 tuples)", tuples, V.INTEL_TRANSITIONS.map((t) => [...t]));
  check("reason-required statuses", sqlList(/to_status NOT IN \(([^)]*)\) OR reason_he IS NOT NULL/), [...V.REASON_REQUIRED]);
  check("T2 request kinds", sqlList(/kind\s+text NOT NULL CHECK \(kind IN \(([^)]*)\)\)/, T2_SQL), [...V.T2_KINDS]);
  const raised = [...new Set([...BRAIN_SQL.matchAll(/RAISE EXCEPTION '([A-Z_]+)/g), ...T2_SQL.matchAll(/RAISE EXCEPTION '([A-Z_]+)/g)].map((m) => m[1]))].filter((c) => !["PRECONDITION", "POSTCONDITION", "VALIDATED_ONLY"].includes(c)).sort();
  check("every RPC refusal code is mapped (no code falls through to WRITE_FAILED)", raised, [...BRAIN_RPC_CODES].sort());

  section("C. Grants — only the 5 wrappers for the service role; Owner moves NOT for the service role");
  const granted = /GRANT EXECUTE ON FUNCTION\s+([\s\S]*?)\s+TO service_role;/.exec(BRAIN_SQL)?.[1] ?? "";
  check("Brain service grants = exactly the 5 wrappers", [...granted.matchAll(/public\.(\w+)\(/g)].map((m) => m[1]).sort(), ["sunny_add_links", "sunny_brain_transition", "sunny_create_intel_record", "sunny_record_observations", "sunny_register_content"]);
  ok("T2 decide / revoke / owner transition are granted to authenticated ONLY", /owner_approval_decide\([^)]*\) TO authenticated;/.test(T2_SQL) && /owner_revoke_tracking_authorization\([^)]*\) TO authenticated;/.test(T2_SQL) && /owner_brain_transition\([^)]*\) TO authenticated;/.test(T2_SQL));
  const storeSrc = read("lib/brain-store.ts");
  const serviceFns = [...(/export function createBrainServiceStore[\s\S]*?\n}\n/.exec(storeSrc)?.[0] ?? "").matchAll(/call\(client, "(\w+)"/g)].map((m) => m[1]).sort();
  check("the service store calls exactly the 5 wrappers + request / cancel", serviceFns, ["owner_approval_cancel", "owner_approval_request", "sunny_add_links", "sunny_brain_transition", "sunny_create_intel_record", "sunny_record_observations", "sunny_register_content"]);
  const ownerFns = [...(/export function createBrainOwnerStore[\s\S]*?\n}\n/.exec(storeSrc)?.[0] ?? "").matchAll(/call\(sessionClient, "(\w+)"/g)].map((m) => m[1]).sort();
  check("the Owner store calls exactly decide / revoke / owner transition (session client only)", ownerFns, ["owner_approval_decide", "owner_brain_transition", "owner_revoke_tracking_authorization"]);
  // PostgREST calls an RPC by NAMED arguments: every key the store sends must be exactly the SQL signature's parameter names
  const sigOf = (fn: string) => { const m = new RegExp(`CREATE FUNCTION public\\.${fn}\\(([\\s\\S]*?)\\)\\s*RETURNS`).exec(BRAIN_SQL + T2_SQL); return m ? [...m[1].matchAll(/\b(p_\w+)\s/g)].map((x) => x[1]).sort() : null; };
  const sent = [...storeSrc.matchAll(/call\((?:client|sessionClient), "(\w+)", \{([^}]*)\}/g)].map((m) => [m[1], [...m[2].matchAll(/\b(p_\w+):/g)].map((x) => x[1]).sort()] as const);
  check("every RPC call sends exactly the SQL parameter names (10 functions)", sent.filter(([fn, keys]) => JSON.stringify(sigOf(fn)) !== JSON.stringify(keys)).map(([fn]) => fn), []);
  check("…and all 10 were checked", sent.length, 10);
  ok("no Brain core function name appears anywhere in deployed code", !/sunny_(grant_tracking_authorization|register_resource_core|record_observations_core|brain_transition_core|brain_insert_links)/.test(walkCode().map(([, s]) => s).join("\n")));
  ok("no direct table write to a Brain / T2 table anywhere (only RPCs)", walkCode().every(([, s]) => !/from\((BRAIN_TABLES\.\w+|"(sunny_resources|sunny_tracking_authorizations|sunny_observations|sunny_intel_records|sunny_brain_links|sunny_brain_events|owner_approval_\w+)")\)\s*\.\s*(insert|update|upsert|delete)/.test(s)));
  check("only lib/writes/brain.ts (and the store) build a Brain store", walkCode().filter(([f, s]) => /createBrain(Service|Owner)Store\(/.test(s) && f !== "lib/brain-store.ts").map(([f]) => f), ["lib/writes/brain.ts"]);
  check("only the approvals route and the connector binding call the Brain writer", walkCode().filter(([f, s]) => /lib\/writes\/brain"/.test(s)).map(([f]) => f).sort(), ["app/api/partner/approvals/route.ts", "lib/partner/brain/server.ts"]);
  const route = read("app/api/partner/approvals/route.ts");
  ok("the approvals POST: same-origin first, requireOwner, Owner decisions with createSupabaseServer (his session) — never the service client", /checkSameOriginJson\(req\.headers\)[\s\S]*requireOwner\(\)[\s\S]*createSupabaseServer\(\)[\s\S]*ownerDecide\(session/.test(route) && /ownerRevoke\(session/.test(route) && /ownerTransition\(session/.test(route));
  ok("the approvals route passes no user id / actor / basis to the DB", !/userId|actor|approval_?basis|p_uid|decided_by/i.test(route.replace(/\/\*[\s\S]*?\*\//g, "")));
  ok("no dashboard / page-load path reads the Brain (only the approvals screen)", walkCode().filter(([f, s]) => /(brain-store|partner\/brain\/|\/api\/partner\/approvals)/.test(s) && /^(components|app)\//.test(f)).map(([f]) => f).sort().join() === "app/api/partner/approvals/route.ts,components/partner/SunnyApprovals.tsx");
  ok("no Push / cron / calendar in any Brain module", ["lib/brain-store.ts", "lib/writes/brain.ts", "lib/partner/brain/requests.ts", "lib/partner/brain/model.ts", "lib/partner/brain/server.ts", "lib/partner/brain/owner-view.ts", "app/api/partner/approvals/route.ts"].every((f) => !/sendPush|web-push|node-cron|google-calendar|\/api\/push/.test(read(f))));

  section("D. URL canonicalizer = public.sunny_canonical_url (cases verified against the SQL function on the harness)");
  const URLS: Array<[string, string | null]> = [
    ["https://WWW.Example.com:443/a?utm_source=x&id=7#top", "https://www.example.com/a?id=7"],
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=abc&t=42", "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42"],
    ["https://youtu.be/dQw4w9WgXcQ?si=XYZ", "https://youtu.be/dQw4w9WgXcQ"],
    ["https://www.instagram.com/p/Cabc123/?igsh=MWQ1&img_index=2", "https://www.instagram.com/p/Cabc123/?img_index=2"],
    ["https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=abc&context=spotify%3Aalbum%3A1", "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?context=spotify%3Aalbum%3A1"],
    ["https://x.com/user/status/123?s=20&t=abc", "https://x.com/user/status/123"],
    ["https://example.com/search?s=beats&t=1", "https://example.com/search?s=beats&t=1"],
    ["https://www.tiktok.com/@user/video/72?is_from_webapp=1&sender_device=pc&lang=he", "https://www.tiktok.com/@user/video/72?lang=he"],
    ["https://app.example.com/#/dashboard?x=1", "https://app.example.com/#/dashboard?x=1"],
    ["https://example.com/a#section-2", "https://example.com/a"], ["https://example.com", "https://example.com/"], ["https://example.com.", "https://example.com/"],
    ["https://example.com/a?&&x=1&", "https://example.com/a?x=1"], ["https://example.com/a?UTM_Source=x&FBCLID=y&q=1", "https://example.com/a?q=1"],
    ["http://example.com/a", null], ["https://user:pw@example.com/a", null], ["https://localhost/a", null], ["https://example.com/a b", null], ["https://example.com/" + "a".repeat(490), null],
  ];
  check("every case", URLS.map(([i]) => canonicalUrl(i)), URLS.map(([, o]) => o));
  ok("idempotent", URLS.every(([, o]) => o === null || canonicalUrl(o) === o));

  section("E. Request building — the Owner sees what he approves; nothing is assumed");
  const base = { purposeKind: "OWN_PRESENCE", purposeHe: "מעקב אחרי האינסטגרם של הלייבל", newResources: [{ platform: "instagram", resourceKind: "ACCOUNT", identityKey: "account:handle:RedBloods", displayName: "Redbloods" }], includeChildResources: true, observationFamilies: ["INSTAGRAM"], sourceKinds: ["PUBLIC_PROFILE_PAGE"], insightsAllowed: true, recommendationsAllowed: false, maxObservationsPerDay: 50, validFrom: TODAY, validUntil: "2026-12-31" };
  const p1 = await buildTrackingPayload(base, TODAY);
  ok("a full request builds the EXACT T2 payload (all 14 keys; handle lower-cased)", p1.ok && Object.keys(p1.value).sort().join() === "baseAuthorizationId,entityKeys,includeChildResources,insightsAllowed,maxObservationsPerDay,newResources,observationFamilies,purposeHe,purposeKind,recommendationsAllowed,resourceIds,sourceKinds,validFrom,validUntil" && (p1.value.newResources as Array<Record<string, unknown>>)[0].identityKey === "account:handle:redbloods", p1);
  const noBool = await buildTrackingPayload({ ...base, recommendationsAllowed: undefined }, TODAY);
  ok("a missing boolean is refused (never a default)", !noBool.ok && noBool.errors.some((e) => e.startsWith("recommendationsAllowed")));
  ok("a backdated validFrom is refused", !(await buildTrackingPayload({ ...base, validFrom: "2026-09-01" }, TODAY)).ok);
  ok("content cannot be requested as a new resource (registered later, under an authorization)", !(await buildTrackingPayload({ ...base, newResources: [{ platform: "instagram", resourceKind: "CONTENT", identityKey: "content:x" }] }, TODAY)).ok);
  const web = await buildTrackingPayload({ ...base, newResources: [{ platform: "web", resourceKind: "PAGE", canonicalUrl: "https://Example.com/press?utm_source=x" }] }, TODAY);
  ok("a web page: identity = page:url-sha256:<sha256 of the canonical URL> (the DB CHECK formula)", web.ok && (web.value.newResources as Array<Record<string, unknown>>)[0].identityKey === `page:url-sha256:${createHash("sha256").update("https://example.com/press", "utf8").digest("hex")}` && (await webPageIdentity("https://example.com/press")).length === 80);
  ok("unknown keys are refused (no extra field reaches the request)", !(await buildTrackingPayload({ ...base, approvalRef: "x" }, TODAY)).ok);
  const sum = p1.ok ? trackingSummaryHe(p1.value) : { summaryHe: "", riskHe: "" };
  ok("the Owner summary is derived from the payload (families, sources, insights / recommendations, cap, window)", /INSTAGRAM/.test(sum.summaryHe) && /PUBLIC_PROFILE_PAGE/.test(sum.summaryHe) && /תובנות: כן · המלצות: לא/.test(sum.summaryHe) && /תקרה ליום: 50/.test(sum.summaryHe) && /2026-12-31/.test(sum.summaryHe));
  const obs = { resourceId: U(1), type: "INSTAGRAM.FOLLOWERS", valueNum: 1200, unit: "count", observedAt: "2026-10-02T08:00:00Z", sourceType: "EXTERNAL_SOURCE", sourceKind: "PUBLIC_PROFILE_PAGE", captureMethod: "CLAUDE_READ", confidence: "MEDIUM", sourceRef: "https://www.instagram.com/redbloods/?igsh=abc" };
  const o1 = checkObservationItem(obs, "SUNNY", NOW.toISOString());
  ok("a public reading validates; sourceRef canonicalized", o1.ok && o1.value.sourceRef === "https://www.instagram.com/redbloods/");
  ok("an external reading is never CONFIRMED", !checkObservationItem({ ...obs, confidence: "CONFIRMED" }, "SUNNY", NOW.toISOString()).ok);
  ok("Sunny can never write an OWNER_STATEMENT (only through an approved T2 request)", !checkObservationItem({ ...obs, sourceType: "OWNER_STATEMENT", sourceKind: "OWNER_STATEMENT", captureMethod: "OWNER_PROVIDED" }, "SUNNY", NOW.toISOString()).ok);
  ok("an Owner value validates only as OWNER_STATEMENT / OWNER_PROVIDED", checkObservationItem({ ...obs, sourceType: "OWNER_STATEMENT", sourceKind: "OWNER_SCREENSHOT", captureMethod: "OWNER_PROVIDED", confidence: "CONFIRMED" }, "OWNER", NOW.toISOString()).ok && !checkObservationItem(obs, "OWNER", NOW.toISOString()).ok);
  ok("exactly one subject and one value; never in the future", !checkObservationItem({ ...obs, entityKey: "company:REDBLOODS" }, "SUNNY", NOW.toISOString()).ok && !checkObservationItem({ ...obs, valueText: "x" }, "SUNNY", NOW.toISOString()).ok && !checkObservationItem({ ...obs, observedAt: "2027-01-01T00:00:00Z" }, "SUNNY", NOW.toISOString()).ok);
  const insight = { recordType: "INSIGHT", resourceIds: [U(1)], area: "SOCIAL", titleHe: "הרילס מביאים יותר עוקבים", body: { statementHe: "בשבועות עם רילס העוקבים עלו יותר", insightKind: "PATTERN", causalStatus: "CORRELATION_ONLY" }, confidence: "MEDIUM", links: [{ role: "EVIDENCE_FOR", fromObs: U(9), toRecord: "$self" }] };
  ok("an insight with evidence validates", checkIntel(insight).ok);
  ok("an insight without EVIDENCE_FOR → refused (no evidence, no insight)", !checkIntel({ ...insight, links: [] }).ok);
  ok("an inference is never CONFIRMED", !checkIntel({ ...insight, confidence: "CONFIRMED" }).ok);
  ok("OUTCOME / EXPERIMENT are reserved", !checkIntel({ ...insight, recordType: "OUTCOME" }).ok && !checkIntel({ ...insight, recordType: "EXPERIMENT" }).ok);
  ok("reserved link roles are refused", !checkLinks([{ role: "PRODUCED_LEARNING", fromRecord: U(1), toRef: "known:x-y" }], false).ok && !checkLinks([{ role: "TESTS", fromRecord: U(1), toRecord: U(2) }], false).ok);
  ok("no link may END at Owner memory (citing it as evidence is allowed)", !checkLinks([{ role: "EVIDENCE_FOR", fromRecord: U(1), toRef: `knowledge:${U(2)}` }], false).ok && checkLinks([{ role: "EVIDENCE_FOR", fromRef: `knowledge:${U(2)}`, toRecord: U(1) }], false).ok);
  ok("a recommendation needs grounding and the exact presented text", !checkIntel({ recordType: "RECOMMENDATION", entityKeys: ["company:REDBLOODS"], area: "SOCIAL", titleHe: "להעלות רילס", body: { recommendationHe: "x" }, confidence: "LOW", links: [{ role: "RECOMMENDS", fromRecord: U(3), toRecord: "$self" }] }).ok);
  ok("Sunny can never ENDORSE / REJECT / ACCEPT / REVOKE (the Owner's moves)", ["ENDORSED", "REJECTED", "ACCEPTED", "REVOKED"].every((to) => !checkTransition({ targetKind: "RECORD", targetId: U(1), toStatus: to, reasonHe: "x" }, "SUNNY").ok));
  ok("an authorization is never a Sunny transition target; SUPERSEDED only by creating the successor", !checkTransition({ targetKind: "AUTHORIZATION", targetId: U(1), toStatus: "REVOKED", reasonHe: "x" }, "SUNNY").ok && !checkTransition({ targetKind: "RECORD", targetId: U(1), toStatus: "SUPERSEDED" }, "SUNNY").ok);
  ok("a reason is required where the DB requires it", !checkTransition({ targetKind: "RECORD", targetId: U(1), toStatus: "WITHDRAWN" }, "SUNNY").ok && checkTransition({ targetKind: "RECORD", targetId: U(1), toStatus: "WITHDRAWN", reasonHe: "טעות" }, "SUNNY").ok);
  ok("content: web pages are never registered by Sunny; identity is content:<id>", !checkContent({ platform: "web", contentKind: "ARTICLE", parentId: U(1), identityKey: "content:x" }).ok && checkContent({ platform: "instagram", contentKind: "REEL", parentId: U(1), identityKey: "content:Cabc" }).ok);

  section("F. Error mapping — fail closed, longest code first, never fake success");
  check("NOT_INSTALLED (PostgREST: function not found)", brainRefusal({ message: "Could not find the function public.sunny_add_links", code: "PGRST202" }).status, "NOT_INSTALLED");
  check("OUTSIDE_AUTHORIZATION_SUBJECT is not read as OUTSIDE_AUTHORIZATION", (brainRefusal({ message: "OUTSIDE_AUTHORIZATION_SUBJECT: abc" }) as { code: string }).code, "OUTSIDE_AUTHORIZATION_SUBJECT");
  check("plain OUTSIDE_AUTHORIZATION still maps", (brainRefusal({ message: "OUTSIDE_AUTHORIZATION: only content under a covered account" }) as { code: string }).code, "OUTSIDE_AUTHORIZATION");
  check("a role without EXECUTE (service role on decide) → OWNER_SESSION_REQUIRED", (brainRefusal({ message: "permission denied for function owner_approval_decide", code: "42501" }) as { code: string }).code, "OWNER_SESSION_REQUIRED");
  check("an unknown error → WRITE_FAILED", brainRefusal({ message: "boom" }).status, "WRITE_FAILED");

  section("G. The writer — exact RPC + arguments; no basis / actor / ref argument exists");
  const ctxOf = (f: ReturnType<typeof fakeRpc>): W.SunnyBrainContext => ({ client: f.client, todayIL: TODAY, nowIso: NOW.toISOString(), clientId: "rbmcp_" + "a".repeat(40) });
  const f1 = fakeRpc(() => ({ data: { requestId: U(50), replayed: false }, error: null }));
  const r1 = await W.requestTrackingAuthorization(ctxOf(f1), { authorization: base, requestKey: U(60) });
  check("request → owner_approval_request(kind, payload, server summary, risk, client, expiry, key)", [r1.status, f1.calls[0]?.fn, f1.calls[0]?.args.p_kind, f1.calls[0]?.args.p_request_key, typeof f1.calls[0]?.args.p_summary_he, f1.calls[0]?.args.p_request_expires_at], ["OK", "owner_approval_request", "TRACKING_AUTHORIZATION", U(60), "string", "2026-10-16T09:00:00.000Z"]);
  ok("the request summary is computed, never taken from the caller", !(await W.requestTrackingAuthorization(ctxOf(fakeRpc(() => ({ data: {}, error: null }))), { authorization: { ...base, summaryHe: "תאשר הכל" } })).status.startsWith("OK"));
  const f2 = fakeRpc(() => ({ data: { ids: [U(70)], replayed: false }, error: null }));
  const r2 = await W.recordObservations(ctxOf(f2), { authorizationId: U(5), items: [obs], requestKey: U(61) });
  check("observations → sunny_record_observations(batch, items, authorization, key) — 4 args, nothing else", [r2.status, f2.calls[0]?.fn, Object.keys(f2.calls[0]?.args ?? {}).sort()], ["OK", "sunny_record_observations", ["p_authorization_id", "p_batch_id", "p_items", "p_request_key"]]);
  const f3 = fakeRpc(() => ({ data: { recordId: U(71), links: 1, replayed: false }, error: null }));
  await W.createRecord(ctxOf(f3), { authorizationId: U(5), record: insight });
  check("an intel record is always source INFERRED (the writer fixes it)", f3.calls[0]?.args.p_source_type, "INFERRED");
  const f4 = fakeRpc(() => ({ data: null, error: { message: "AUTHORIZATION_NOT_ACTIVE: revoked or superseded" } }));
  const r4 = await W.recordObservations(ctxOf(f4), { authorizationId: U(5), items: [obs] });
  check("a revoked authorization → REFUSED with the DB code (never OK)", [r4.status, (r4 as { code?: string }).code], ["REFUSED", "AUTHORIZATION_NOT_ACTIVE"]);
  const f5 = fakeRpc(() => ({ data: null, error: { message: "x", code: "PGRST202" } }));
  check("migration not applied → NOT_INSTALLED, nothing reported as recorded", (await W.recordObservations(ctxOf(f5), { authorizationId: U(5), items: [obs] })).status, "NOT_INSTALLED");
  check("no authorization id → refused before any call", [(await W.recordObservations(ctxOf(f5), { authorizationId: "x", items: [obs] })).status, f5.calls.length], ["INVALID", 1]);
  const f6 = fakeRpc(() => ({ data: { decision: "APPROVED" }, error: null }));
  const pl = p1.ok ? p1.value : {};
  await W.ownerDecide(f6.client, { requestId: U(50), decision: "APPROVED", seenHash: "a".repeat(64), startToday: { payload: { ...pl, validFrom: "2026-09-30" }, todayIL: TODAY } });
  check("an Owner approval of a late request narrows validFrom to today (and nothing else)", [f6.calls[0]?.fn, (f6.calls[0]?.args.p_approved as Record<string, unknown>)?.validFrom, (f6.calls[0]?.args.p_approved as Record<string, unknown>)?.validUntil], ["owner_approval_decide", TODAY, "2026-12-31"]);
  const f7 = fakeRpc(() => ({ data: { decision: "APPROVED" }, error: null }));
  await W.ownerDecide(f7.client, { requestId: U(50), decision: "APPROVED", seenHash: "a".repeat(64), startToday: { payload: pl, todayIL: TODAY } });
  check("an on-time approval is AS REQUESTED (p_approved null)", f7.calls[0]?.args.p_approved, null);
  check("decide requires the shown hash", (await W.ownerDecide(f7.client, { requestId: U(50), decision: "APPROVED", seenHash: "nope" })).status, "INVALID");
  check("revoke requires a reason", (await W.ownerRevoke(f7.client, { authorizationId: U(5), reasonHe: "" })).status, "INVALID");

  section("H. Read model + capability brain (progressive disclosure, honest unknowns)");
  const snap: BrainSnapshot = {
    resources: [{ id: U(1), platform: "instagram", resourceKind: "ACCOUNT", contentKind: null, parentId: null, identityKey: "account:handle:redbloods", firstHandle: "redbloods", canonicalUrl: null, displayName: "Redbloods", externalActor: null, approvalBasis: "OWNER_APPROVAL", authorizationId: null, createdAt: "2026-10-02T08:00:00Z" }],
    authorizations: [
      { id: U(5), purposeKind: "OWN_PRESENCE", purposeHe: "אינסטגרם", resourceIds: [U(1)], includeChildResources: true, entityKeys: [], observationFamilies: ["INSTAGRAM"], sourceKinds: ["PUBLIC_PROFILE_PAGE"], insightsAllowed: true, recommendationsAllowed: false, maxObservationsPerDay: null, validFrom: TODAY, validUntil: null, supersedesId: null, approvalRequestId: U(50), createdAt: "2026-10-02T08:00:00Z" },
      { id: U(6), purposeKind: "REFERENCE_RESEARCH", purposeHe: "ישן", resourceIds: [U(1)], includeChildResources: false, entityKeys: [], observationFamilies: ["INSTAGRAM"], sourceKinds: ["PUBLIC_PROFILE_PAGE"], insightsAllowed: false, recommendationsAllowed: false, maxObservationsPerDay: 5, validFrom: "2026-09-01", validUntil: null, supersedesId: null, approvalRequestId: U(49), createdAt: "2026-09-01T08:00:00Z" },
    ],
    observations: [{ id: U(9), seq: 1, batchId: U(9), resourceId: U(1), entityKey: null, type: "INSTAGRAM.FOLLOWERS", valueNum: 1200, valueText: null, valueBool: null, unit: "count", observedAt: "2026-10-02T08:00:00Z", periodStart: null, periodEnd: null, sourceType: "EXTERNAL_SOURCE", sourceKind: "PUBLIC_PROFILE_PAGE", sourceRef: null, captureMethod: "CLAUDE_READ", confidence: "MEDIUM", approvalBasis: "TRACKING_AUTHORIZATION", authorizationId: U(5), correctsId: null, createdAt: "2026-10-02T08:01:00Z" }],
    records: [{ id: U(20), seq: 1, recordType: "INSIGHT", entityKeys: [], resourceIds: [U(1)], topic: "instagram.followers", area: "SOCIAL", titleHe: "צמיחה", body: { statementHe: "עלייה", insightKind: "TREND", causalStatus: "CORRELATION_ONLY" }, sourceType: "INFERRED", confidence: "MEDIUM", reviewAt: null, supersedesId: null, authorizationId: U(5), createdAt: "2026-10-02T08:02:00Z" }],
    links: [{ id: U(30), role: "EVIDENCE_FOR", fromRecordId: null, fromObservationId: U(9), fromRef: null, toRecordId: U(20), toResourceId: null, toRef: null, noteHe: null, authorizationId: U(5), createdAt: "2026-10-02T08:02:00Z" }],
    events: [
      { id: U(40), seq: 1, recordId: U(20), observationId: null, authorizationId: null, resourceId: null, linkId: null, fromStatus: null, toStatus: "OPEN", reasonHe: null, actor: "SUNNY", approvalBasis: "TRACKING_AUTHORIZATION", createdAt: "2026-10-02T08:02:00Z" },
      { id: U(41), seq: 2, recordId: null, observationId: null, authorizationId: U(6), resourceId: null, linkId: null, fromStatus: "ACTIVE", toStatus: "REVOKED", reasonHe: "לא צריך", actor: "OWNER", approvalBasis: "OWNER_APPROVAL", createdAt: "2026-10-02T08:03:00Z" },
    ],
    approvals: { requests: [{ id: U(51), seq: 3, kind: "TRACKING_AUTHORIZATION", payload: pl, payloadHash: "b".repeat(64), summaryHe: "מטרה: x\nעוד", riskHe: "סיכון", requestedVia: "SUNNY", expiresAt: "2026-10-20T00:00:00Z", createdAt: "2026-10-02T08:00:00Z" }], decisions: [] },
    truncated: false,
  };
  const st = brainState(snap, TODAY, NOW.toISOString());
  check("derived state: active / revoked authorization, record status, valid observation, pending request", [st.authorizationState(snap.authorizations[0]), st.authorizationState(snap.authorizations[1]), st.recordStatus(U(20)), st.observationValid(U(9)), st.approvalState(snap.approvals!.requests[0])], ["ACTIVE", "REVOKED", "OPEN", true, "PENDING"]);
  const src = (b: GatewaySources["brain"]): GatewaySources => ({ now: NOW, identities: { cleantone: null }, brain: b });
  const q = (mode: string, params: Record<string, string> = {}, b: GatewaySources["brain"] = { status: "OK", value: snap }) => queryKnowledgeCore(PARTNER_KNOWLEDGE_REGISTRY, { capability: "brain", mode, params }, src(b), OWNER_EXT);
  const ov = q("overview");
  check("overview: the ACTIVE authorization + the PENDING request only", ov.items.map((i) => i.id), [`authorization:${U(5)}`, `approval:${U(51)}`]);
  check("an insight is a HYPOTHESIS; an observation an OBSERVATION; an authorization the Owner's decision", [q("records").items[0]?.epistemic, q("observations").items[0]?.epistemic, q("authorizations").items[0]?.epistemic], ["HYPOTHESIS", "OBSERVATION", "OWNER_DECISION"]);
  const rec = q("record", { id: U(20) }).items[0];
  check("record mode: history + evidence graph", [(rec?.fields.history as unknown[]).length, (rec?.fields.linksIn as unknown[]).length, (rec?.fields.evidenceObservations as unknown[]).length], [1, 1, 1]);
  const ni = q("overview", {}, { status: "UNAVAILABLE", detail: "NOT_INSTALLED: Could not find the table" });
  check("not installed → UNKNOWN with the reason, never 'none'", [ni.completeness, ni.items.length, ni.missing[0]?.whyNeeded], ["UNKNOWN", 0, "the Brain migration is not applied"]);
  const noT2 = q("approvals", {}, { status: "OK", value: { ...snap, approvals: null } });
  check("T2 not installed → approvals UNKNOWN (never 'nothing pending')", noT2.completeness, "UNKNOWN");
  check("brain is Owner-only", queryKnowledgeCore(PARTNER_KNOWLEDGE_REGISTRY, { capability: "brain" }, src({ status: "OK", value: snap }), { channel: "EXTERNAL", ownerAuthorized: false }).items.length, 0);
  const view = buildOwnerApprovalsView(snap, NOW);
  check("approvals screen: pending carries the exact payload hash; authorizations with state", [view.pending.length, view.pending[0]?.payloadHash, view.authorizations.map((a) => a.state)], [1, "b".repeat(64), ["ACTIVE", "REVOKED"]]);

  section("I. Reader — fail closed");
  const fakeRead = (o: { missing?: string[]; bad?: string }): BrainReadClient => ({
    from: (t: string) => ({ select: () => ({ order: () => ({ limit: async () => (o.missing?.includes(t) ? { data: null, error: { message: `Could not find the table 'public.${t}'`, code: "PGRST205" } } : { data: o.bad === t ? [{ id: "nope" }] : [], error: null }) }) }) }),
  });
  check("Brain tables missing → NOT_INSTALLED", (await readBrainSnapshot(fakeRead({ missing: ["sunny_resources"] }))).status, "NOT_INSTALLED");
  const t2missing = await readBrainSnapshot(fakeRead({ missing: ["owner_approval_requests", "owner_approval_decisions"] }));
  check("T2 missing → OK with approvals null (the Brain stays readable)", [t2missing.status, t2missing.status === "OK" ? t2missing.value.approvals : "x"], ["OK", null]);
  check("a row breaking the contract → READ_FAILED (never half-read)", (await readBrainSnapshot(fakeRead({ bad: "sunny_observations" }))).status, "READ_FAILED");

  section("J. partner:observe — scope necessary, never sufficient; canonical order; off by default");
  const cfg = (env: Record<string, string>) => { const r = readMcpConfig(env); if (!r.ok) throw new Error("cfg"); return r.config; };
  const ON = { ...BASE_ENV, REDBLOODS_MCP_ONLY: "true", PARTNER_MCP_OBSERVE_ENABLED: "true" };
  check("default: observe OFF; flag without MCP-only stays OFF", [cfg(BASE_ENV).observeEnabled, cfg({ ...BASE_ENV, PARTNER_MCP_OBSERVE_ENABLED: "true" }).observeEnabled, cfg(ON).observeEnabled], [false, false, true]);
  const to16 = JSON.parse("[" + (/v_to\s+text\[\] := ARRAY\[([\s\S]*?)\];/.exec(SCOPE_SQL)![1]).replace(/'/g, '"') + "]") as string[];
  const ours = [false, true].flatMap((answer) => [false, true].flatMap((knowledge) => [false, true].flatMap((observe) => [false, true].map((act) => scopeString({ answer, knowledge, observe, act })))));
  check("scopeString (16 combos) = the scope migration's 16 strings (canonical order read, answer, knowledge, observe, act)", [...ours].sort(), [...to16].sort());
  check("advertised / granted only when the switch is on", [advertisedScope(cfg(BASE_ENV)), advertisedScope(cfg(ON)), grantedScope(cfg(ON), "partner:read partner:observe"), grantedScope(cfg(BASE_ENV), "partner:read partner:observe")], ["partner:read", "partner:read partner:observe", "partner:read partner:observe", "partner:read"]);
  ok("observe never implies act", !hasObserveScope("partner:read partner:act") && hasObserveScope(`partner:read ${MCP_OBSERVE_SCOPE}`) && !scopeString({ answer: false, knowledge: false, observe: true }).includes("partner:act"));
  const db = "db.example.supabase.co";
  const u = (p: string) => new URL(`https://${db}${p}`);
  check("fetch guard: the 7 Brain RPCs only with the observe switch", ["sunny_record_observations", "owner_approval_request", "owner_approval_cancel"].map((f) => [isAllowedMcpOnlyFetch(u(`/rest/v1/rpc/${f}`), "POST", db, {}), isAllowedMcpOnlyFetch(u(`/rest/v1/rpc/${f}`), "POST", db, { brainRpc: true })]), [[false, true], [false, true], [false, true]]);
  check("fetch guard: never the Owner-only T2 functions, a core, or a Brain table write", ["/rest/v1/rpc/owner_approval_decide", "/rest/v1/rpc/owner_revoke_tracking_authorization", "/rest/v1/rpc/owner_brain_transition", "/rest/v1/rpc/sunny_record_observations_core", "/rest/v1/sunny_observations"].map((p) => isAllowedMcpOnlyFetch(u(p), "POST", db, { brainRpc: true })), [false, false, false, false, false]);
  const mk = (o: { env: Record<string, string>; scope: string; bind?: boolean }) => {
    const audit: Array<Record<string, unknown>> = [];
    const calls: Array<{ op: string; input: Record<string, unknown> }> = [];
    const deps: McpDeps = {
      config: cfg(o.env), authenticate: async () => ({ ok: true as const, principal: { tokenId: U(900), clientId: "rbmcp_" + "c".repeat(40), userId: U(901), scope: o.scope } }),
      gateway: { brief: async () => ({}), resolve: async () => ({}), entity: async () => ({}), query: async () => ({ status: "OK" }), capabilityIndex: () => [] },
      limiter: new SlidingWindowLimiter([{ windowMs: 60_000, max: 500 }]), audit: async (r) => { audit.push(r as unknown as Record<string, unknown>); }, auditRejected: async () => undefined, nowMs: () => Date.now(),
      ...(o.bind === false ? {} : { observe: { limiter: new SlidingWindowLimiter([{ windowMs: 3_600_000, max: 60 }]), call: async (op, input) => { calls.push({ op, input }); return { status: "OK", result: {} }; } } }),
    };
    const rpc = async (method: string, params?: unknown) => { const res = await handleMcpHttp({ method: "POST", header: (h) => (h === "authorization" ? "Bearer t" : null), bodyText: async () => JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params !== undefined ? { params } : {}) }) }, deps); return { status: res.status, json: res.body ? JSON.parse(res.body) : null }; };
    return { audit, calls, rpc };
  };
  const names = async (m: ReturnType<typeof mk>) => ((await m.rpc("tools/list")).json.result.tools as Array<{ name: string }>).map((t) => t.name);
  ok("switch off → partner_observe not listed, Unknown tool", !(await names(mk({ env: BASE_ENV, scope: "partner:read partner:observe", bind: false }))).includes(OBSERVE_TOOL) && (await mk({ env: BASE_ENV, scope: "partner:read partner:observe", bind: false }).rpc("tools/call", { name: OBSERVE_TOOL, arguments: { op: "cancel_request", requestId: U(1) } })).json.error?.message === "Unknown tool");
  ok("switch on but no observe scope → not listed; a call → 403 insufficient_scope, nothing relayed", await (async () => { const m = mk({ env: ON, scope: "partner:read" }); const r = await m.rpc("tools/call", { name: OBSERVE_TOOL, arguments: { op: "cancel_request", requestId: U(1) } }); return !(await names(m)).includes(OBSERVE_TOOL) && r.status === 403 && m.calls.length === 0; })());
  const m = mk({ env: ON, scope: "partner:read partner:observe" });
  ok("switch + scope → listed", (await names(m)).includes(OBSERVE_TOOL));
  const good = await m.rpc("tools/call", { name: OBSERVE_TOOL, arguments: { op: "record_observations", authorizationId: U(5), items: [obs] } });
  check("a valid call is relayed ONCE; audit tool NULL, method observe/<op>, input HASH only", [good.json.result?.isError, m.calls.length, m.audit.filter((a) => String(a.method).startsWith("observe/")).map((a) => [a.tool, a.method, a.status])], [false, 1, [[null, "observe/record_observations_try", "OK"], [null, "observe/record_observations", "OK"]]]);
  ok("no audit row carries the payload", m.audit.every((a) => !JSON.stringify(a).includes("INSTAGRAM.FOLLOWERS")));
  const bad = await m.rpc("tools/call", { name: OBSERVE_TOOL, arguments: { op: "record_observations", authorizationId: U(5), items: [obs], sql: "select 1" } });
  check("an extra / forbidden field → refused before anything runs", [bad.json.error?.message, m.calls.length], ["invalid arguments (FORBIDDEN_FIELD)", 1]);
  check("unknown op / missing field", [validateObserveInput({ op: "decide" }), validateObserveInput({ op: "create_record", authorizationId: U(1) })], [{ ok: false, code: "UNKNOWN_OP" }, { ok: false, code: "MISSING_FIELD" }]);
  ok("there is no Owner op in the tool (decide / revoke / endorse are not ops)", !OBSERVE_OPS.some((o) => /decide|revoke|endorse|approve|accept|grant/.test(o)));
  const consent = read("app/mcp-oauth/authorize/page.tsx");
  ok("the consent screen lists partner:observe separately and says it alone tracks nothing", /data-consent-observe/.test(consent) && /לבדה לא מתירה מעקב/.test(consent));

  section("K. Browser research + recheck proposals (Owner decision 2026-10-02: Owner-requested browser work, no API / crawler / cron)");
  const browserRead = (kind: string, ref: string) => ({ ...obs, sourceKind: kind, sourceRef: ref, captureMethod: "CLAUDE_READ", sourceType: "EXTERNAL_SOURCE", confidence: "HIGH" });
  ok("1. browser source kinds accepted: PUBLIC_PROFILE_PAGE / PUBLIC_CONTENT_PAGE / WEB_PAGE", [browserRead("PUBLIC_PROFILE_PAGE", "https://www.instagram.com/shalev/"), browserRead("PUBLIC_CONTENT_PAGE", "https://www.youtube.com/watch?v=abc&si=x"), browserRead("WEB_PAGE", "https://example.com/press")].every((x) => checkObservationItem(x, "SUNNY", NOW.toISOString()).ok));
  const mapped = checkObservationItem(browserRead("PUBLIC_CONTENT_PAGE", "https://www.youtube.com/watch?v=abc&si=x"), "SUNNY", NOW.toISOString());
  check("2. a browser reading maps to EXTERNAL_SOURCE + CLAUDE_READ, URL canonical (tracking noise dropped)", mapped.ok ? [mapped.value.sourceType, mapped.value.captureMethod, mapped.value.sourceRef] : null, ["EXTERNAL_SOURCE", "CLAUDE_READ", "https://www.youtube.com/watch?v=abc"]);
  ok("2b. a browser read with an Owner source kind / PLATFORM_ANALYTICS_EXPORT is refused (never an Owner value)", !checkObservationItem(browserRead("OWNER_SCREENSHOT", "https://x.com/a"), "SUNNY", NOW.toISOString()).ok);
  const code = walkCode();
  ok("3. no platform API dependency (no Graph / YouTube Data / TikTok / Spotify / X API, no platform credential env)", code.every(([, t]) => !/graph\.facebook\.com|graph\.instagram\.com|youtube\/v3|open\.tiktokapis|api\.spotify\.com|api\.(twitter|x)\.com\/2|(INSTAGRAM|YOUTUBE|TIKTOK|SPOTIFY|FACEBOOK|TWITTER)_(API_KEY|TOKEN|CLIENT_SECRET|ACCESS_TOKEN)/.test(t)), code.filter(([, t]) => /youtube\/v3|api\.spotify\.com/.test(t)).map(([f]) => f));
  const brainFiles = ["lib/partner/brain/research.ts", "lib/partner/brain/requests.ts", "lib/partner/brain/model.ts", "lib/partner/brain/server.ts", "lib/partner/brain/owner-view.ts", "lib/brain-store.ts", "lib/writes/brain.ts", "lib/partner/knowledge/capabilities/brain.ts", "components/partner/SunnyApprovals.tsx", "app/api/partner/approvals/route.ts"];
  ok("4. no background job / cron / timer in any Brain module, and instrumentation schedules nothing for the Brain", brainFiles.every((f) => !/node-cron|setInterval|setTimeout\(|schedule\(/.test(read(f))) && !/brain|observ/i.test(read("instrumentation.ts").replace(/brainRpc: process\.env\.PARTNER_MCP_OBSERVE_ENABLED === "true", /, "")));
  ok("4b. no crawler / scraper / fetch of an external page anywhere in the Brain", brainFiles.every((f) => !/\bfetch\(\s*["'`]https?:|puppeteer|playwright|cheerio|jsdom/.test(read(f).replace(/fetch\("\/api\/partner\/approvals"/g, ""))));
  ok("5/6. no browser action and no observation on page load: the approvals screen only GETs its own route and POSTs on explicit clicks; no observe op from any page", !/partner_observe|record_observations|sunny_record_observations/.test(read("components/partner/SunnyApprovals.tsx")) && (read("components/partner/SunnyApprovals.tsx").match(/method: "POST"/g) ?? []).length === 1 && !code.some(([f, t]) => /^(app|components)\//.test(f) && /recordObservations\(/.test(t)));
  ok("7. no Push / alert / reminder in the Brain", brainFiles.every((f) => !/sendPush|web-push|lib\/push|alerts-store|agent_alerts|createAlert/.test(read(f))));
  const researchSrc = read("lib/partner/brain/research.ts");
  ok("8/10. research + proposals are pure: no RPC, no write, no store, no reviewAt", !/\.rpc\(|\.insert\(|\.update\(|brain-store|writes\/brain|reviewAt\s*[:=]/.test(researchSrc.replace(/\/\*[\s\S]*?\*\//g, "")));
  const old1 = { ...snap.observations[0], id: U(81), seq: 11, valueNum: 1000, observedAt: "2026-09-01T10:00:00Z", createdAt: "2026-09-01T10:00:00Z" };
  const old2 = { ...snap.observations[0], id: U(82), seq: 12, valueNum: 1200, observedAt: "2026-09-02T10:00:00Z", createdAt: "2026-09-02T10:00:00Z", sourceRef: "https://www.instagram.com/redbloods/" };
  const hist: BrainSnapshot = { ...snap, observations: [old1, old2], links: [{ ...snap.links[0], fromObservationId: U(82) }] };
  const ctxR = { todayIL: TODAY, now: NOW };
  const ser = researchSeries(hist, ctxR);
  check("17/18. last check + the previous one + the change, from the existing observations (no second history)", ser.map((x) => [x.points, x.last.observedAt, x.last.value, x.previous?.value, x.comparison, x.last.sourceRef, x.freshness, x.ageDays]),
    [[2, "2026-09-02T10:00:00Z", 1200, 1000, { kind: "NUMBER", delta: 200, deltaPct: 20, daysBetween: 1 }, "https://www.instagram.com/redbloods/", "STALE", 29]]);
  check("11. Owner yes + a covering ACTIVE authorization → CAN_STORE (a new check may be recorded)", [ser[0].storeStatus, ser[0].coveringAuthorizationIds, ser[0].allowedSourceKinds], ["CAN_STORE", [U(5)], ["PUBLIC_PROFILE_PAGE"]]);
  const noAuth = researchSeries({ ...hist, authorizations: [] }, ctxR)[0];
  check("12/16. no authorization → NO_AUTHORIZATION; a proposal leads to requesting authorization, never to 'saved'", [noAuth.storeStatus, recheckProposals([noAuth], { ...ctxR, focus: { resourceId: U(1) } })[0]?.nextStep], ["NO_AUTHORIZATION", "ASK_OWNER_THEN_REQUEST_AUTHORIZATION"]);
  const revoked = researchSeries({ ...hist, authorizations: [snap.authorizations[1]] }, ctxR)[0];
  check("13. revoked authorization → AUTHORIZATION_REVOKED (no store)", revoked.storeStatus, "AUTHORIZATION_REVOKED");
  check("14. expired / not-yet-valid authorization → no store", [researchSeries({ ...hist, authorizations: [{ ...snap.authorizations[0], validUntil: "2026-09-30" }] }, ctxR)[0].storeStatus, researchSeries({ ...hist, authorizations: [{ ...snap.authorizations[0], validFrom: "2026-10-09" }] }, ctxR)[0].storeStatus], ["AUTHORIZATION_EXPIRED", "AUTHORIZATION_NOT_YET_VALID"]);
  check("14b. an authorization without the family does not cover the series", researchSeries({ ...hist, authorizations: [{ ...snap.authorizations[0], observationFamilies: ["YOUTUBE"] }] }, ctxR)[0].storeStatus, "NO_AUTHORIZATION");
  check("9. STALE + a live insight resting on it → a proposal (reason STALE_EVIDENCE), executes nothing", recheckProposals(ser, ctxR).map((x) => [x.reasons, x.executesNothing, x.nextStep, /רוצה שאבדוק עכשיו דרך הדפדפן/.test(x.textHe), /2026-09-02/.test(x.textHe)]), [[["STALE_EVIDENCE"], true, "ASK_OWNER_THEN_BROWSER_CHECK_AND_RECORD", true, true]]);
  const noDep = researchSeries({ ...hist, links: [] }, ctxR);
  check("9b. STALE alone (no material reason) → no proposal (no spam)", recheckProposals(noDep, ctxR), []);
  check("9c. the Owner discussing it → a proposal", recheckProposals(noDep, { ...ctxR, focus: { resourceId: U(1) } }).map((x) => x.reasons), [["OWNER_DISCUSSING"]]);
  const entObs = researchSeries({ ...hist, links: [], observations: [{ ...old2, resourceId: null, entityKey: "label-artist:22222222-2222-4222-8222-222222222221" }] }, ctxR);
  check("9d. a release within the window for that entity → a proposal; a far / released one → none", [recheckProposals(entObs, { ...ctxR, releases: [{ labelArtistId: "22222222-2222-4222-8222-222222222221", targetYmd: "2026-10-12", released: false }] }).map((x) => x.reasons), recheckProposals(entObs, { ...ctxR, releases: [{ labelArtistId: "22222222-2222-4222-8222-222222222221", targetYmd: "2026-12-30", released: false }, { labelArtistId: "22222222-2222-4222-8222-222222222221", targetYmd: "2026-10-12", released: true }] }).length], [[["RELEASE_SOON"]], 0]);
  check("9e. fresh data → no proposal even with a reason", recheckProposals(researchSeries({ ...hist, observations: [{ ...old2, observedAt: "2026-10-01T10:00:00Z" }] }, ctxR), { ...ctxR, focus: { resourceId: U(1) } }), []);
  check("9f. at most RECHECK_POLICY.maxProposals; the policy is explicit (engineering default)", [recheckProposals(Array.from({ length: 5 }, (_, i) => ({ ...ser[0], key: `k${i}` })), ctxR).length, RECHECK_POLICY], [2, { staleAfterDays: 14, releaseWindowDays: 21, maxProposals: 2 }]);
  const before = JSON.stringify(hist);
  const p1x = JSON.stringify(recheckProposals(researchSeries(hist, ctxR), ctxR)), p2x = JSON.stringify(recheckProposals(researchSeries(hist, ctxR), ctxR));
  ok("10/24. proposals are deterministic and write nothing (no persistence → a refresh cannot multiply them)", p1x === p2x && JSON.stringify(hist) === before);
  check("13b. an invalidated reading is history, never the last check", researchSeries({ ...hist, events: [...hist.events, { ...snap.events[0], id: U(83), seq: 9, recordId: null, observationId: U(82), toStatus: "INVALIDATED", reasonHe: "טעות", actor: "SUNNY" }] }, ctxR)[0].last.value, 1000);
  const rr = q("research", { resource: U(1) }, { status: "OK", value: hist });
  check("15b/17. capability research: series item with date + 'not current' note + proposals fact", [rr.items.length, rr.items[0]?.fields.lastCheckedOn, /זה לא נתון של עכשיו/.test(String((rr.items[0]?.fields.note as { text: string }).text)), (rr.summary.find((f) => f.code === "RECHECK_PROPOSALS")?.value as unknown[]).length], [1, "2026-09-02", true, 1]);
  const rs = q("series", { resource: U(1), type: "INSTAGRAM.FOLLOWERS" }, { status: "OK", value: hist });
  check("18b. series: oldest → newest with the change from the previous reading", rs.items.map((i) => [i.fields.value, i.fields.changeFromPrevious]), [[1000, null], [1200, 200]]);
  ok("16b. research tells Sunny a new check will NOT be saved without authorization", /לא תישמר בלי הרשאת מעקב/.test(String((q("research", {}, { status: "OK", value: { ...hist, authorizations: [] } }).items[0]?.fields.note as { text: string }).text)));
  ok("19/20. an insight stays a HYPOTHESIS; a recommendation stays a recommendation (no auto-learning, no execution)", q("records", {}, { status: "OK", value: hist }).items.every((i) => i.epistemic === "HYPOTHESIS") && !/BUSINESS_LEARNING|BUSINESS_DECISION/.test(researchSrc));
  ok("22. no automatic reviewAt: a record without reviewAt is sent with p_review_at NULL", f3.calls[0]?.args.p_review_at === null);
  ok("23. research adds no Agent Alert / attention signal", !/agent|alert|ATTENTION_MAP/.test(researchSrc.replace(/\/\*[\s\S]*?\*\//g, "")));
  const toolDesc = OBSERVE_TOOL_DEFINITION.description;
  ok("tool contract: never browses / monitors; Owner-requested or approved; ask then wait; never say saved without authorization; never OWNER_STATEMENT", /NEVER BROWSES, FETCHES OR MONITORS/.test(toolDesc) && /ask, then WAIT/.test(toolDesc) && /NEVER say it was saved/.test(toolDesc) && /NEVER an OWNER_STATEMENT/.test(toolDesc) && /no platform API, no crawler, no background or scheduled checking/.test(toolDesc) && !/continuous/i.test(toolDesc.replace(/no background or scheduled checking/, "")));
  ok("approval copy: storing / learning, NOT continuous crawling (summary + screen + consent)", (() => { const t = p1.ok ? trackingSummaryHe(p1.value).riskHe : ""; return /כשתבקש מסאני לבדוק, או כשתאשר הצעה שלה לבדוק מחדש/.test(t) && /זו לא הרשאה למעקב רציף/.test(t) && !/בלי לשאול שוב, עד/.test(t); })() && /data-authorization-meaning/.test(read("components/partner/SunnyApprovals.tsx")) && /כשאבקש מסאני לבדוק, או כשאאשר הצעה שלה לבדוק מחדש, היא רשאית לשמור את הנתונים האלה כדי להשוות וללמוד מהם/.test(read("components/partner/SunnyApprovals.tsx")) && /אין מעקב רציף, אין בדיקה ברקע/.test(read("app/mcp-oauth/authorize/page.tsx")));
}

/** Every deployed code file (no scripts / node_modules / .next). */
function walkCode(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const skip = new Set(["node_modules", ".next", ".git", "scripts", "public"]);
  const walk = (d: string) => { for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) { if (skip.has(e.name)) continue; const p = d ? `${d}/${e.name}` : e.name; if (e.isDirectory()) walk(p); else if (/\.(ts|tsx|mjs|js)$/.test(e.name) && !p.endsWith(".d.ts")) out.push([p, fs.readFileSync(path.join(ROOT, p), "utf8")]); } };
  walk("");
  return out;
}

main().then(() => { console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1); }).catch((e) => { console.error(e); process.exit(1); });
