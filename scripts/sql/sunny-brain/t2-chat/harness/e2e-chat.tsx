/**
 * LOCAL end-to-end (harness only, never production): the REAL TypeScript chat-decision flow + writer + store against
 * the REAL candidate SQL on the local Postgres 16 harness (baseline + brain + t2 + seed + p2 + scope + aug-tokens +
 * the t2-chat candidate). RPCs run as PostgREST would (service_role / authenticated + JWT claims), NAMED arguments.
 * Run: E2E_DB=<db> npx tsx scripts/sql/sunny-brain/t2-chat/harness/e2e-chat.tsx
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as W from "../../../../../lib/writes/brain";
import { readBrainSnapshot, type BrainReadClient } from "../../../../../lib/brain-store";
import { PresentationRegistry, runChatDecision } from "../../../../../lib/partner/brain/chat-decision";

const DB = process.env.E2E_DB ?? "e2echat";
const OWNER = "00000000-0000-4000-8000-00000000000a";
const H = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d?: unknown) => { if (c) { pass++; console.log(`PASS  ${n}`); } else { fail++; console.log(`FAIL  ${n}  ${JSON.stringify(d ?? null).slice(0, 300)}`); } };
const lit = (v: unknown): string => {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  if (typeof v === "object") return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
};
function psql(sql: string): { out: string; err: string | null } {
  try { return { out: execFileSync("psql", ["-h", "/tmp", "-p", "54329", "-U", "postgres", "-X", "-q", "-tA", "-v", "ON_ERROR_STOP=1", "-d", DB, "-c", sql], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }), err: null }; }
  catch (e) { const s = String((e as { stderr?: string }).stderr ?? e); return { out: "", err: (/ERROR:\s+(.*)/.exec(s)?.[1] ?? s).trim() }; }
}
const client = (role: "service_role" | "authenticated", sub?: string) => ({
  rpc: async (fn: string, args: Record<string, unknown>) => {
    const claims = JSON.stringify(role === "authenticated" ? { role, sub, aud: "authenticated" } : { role });
    const call = `SELECT public.${fn}(${Object.entries(args).map(([k, v]) => `${k} => ${lit(v)}`).join(", ")})`;
    const r = psql(`BEGIN; SET LOCAL ROLE ${role}; SELECT set_config('request.jwt.claims', '${claims}', true); ${call}; COMMIT;`);
    if (r.err) return { data: null, error: { message: r.err, code: /permission denied/.test(r.err) ? "42501" : /does not exist/.test(r.err) ? "42883" : undefined } };
    return { data: JSON.parse(r.out.trim().split("\n").filter(Boolean).pop() ?? "null"), error: null };
  },
});
const readClient: BrainReadClient = {
  from: (t: string) => ({ select: (cols: string) => ({ order: (col: string) => ({ limit: async (n: number) => {
    const r = psql(`BEGIN; SET LOCAL ROLE service_role; SELECT coalesce(jsonb_agg(x), '[]') FROM (SELECT ${cols} FROM public.${t} ORDER BY ${col} DESC LIMIT ${n}) x; COMMIT;`);
    return r.err ? { data: null, error: { message: r.err, code: /does not exist/.test(r.err) ? "42P01" : undefined } } : { data: JSON.parse(r.out.trim().split("\n").filter(Boolean).pop() ?? "[]"), error: null };
  } }) }) }),
};

async function main() {
  const svc = client("service_role"), owner = client("authenticated", OWNER);
  const now = new Date(), today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(now);
  const ctx: W.SunnyBrainContext = { client: svc, todayIL: today, nowIso: now.toISOString(), clientId: "rbmcp_" + "a".repeat(40) };
  const auth = (h: string) => ({ purposeKind: "OWN_PRESENCE", purposeHe: `מעקב ${h}`, newResources: [{ platform: "instagram", resourceKind: "ACCOUNT", identityKey: `account:handle:${h}` }], entityKeys: [], includeChildResources: false, observationFamilies: ["INSTAGRAM"], sourceKinds: ["PUBLIC_PROFILE_PAGE"], insightsAllowed: false, recommendationsAllowed: false, maxObservationsPerDay: 3, validFrom: today, validUntil: null });
  const ids: string[] = [];
  for (const h of ["shalevtesma", "avimola", "refx"]) {
    const r = await W.requestTrackingAuthorization(ctx, { authorization: auth(h) });
    ok(`Sunny files a request (${h})`, r.status === "OK", r);
    ids.push((r as unknown as { result: { requestId: string } }).result.requestId);
  }
  const reg = new PresentationRegistry();
  const deps = { read: () => readBrainSnapshot(readClient), rpc: svc, registry: reg, now: new Date() };
  const OWN = { tokenId: "t-owner", tokenHash: H("owner-observe") };

  const p0 = await runChatDecision("present_request", { requestId: ids[0] }, OWN, deps);
  ok("present_request reads the real queue (PENDING, real payload hash, 2 others pending)", p0.status === "OK" && (p0.otherPending as unknown[]).length === 2, p0);
  const changed = await runChatDecision("decide_request", { requestId: ids[0], decision: "APPROVED", presentationToken: p0.presentationToken, confirmationText: "מאשר רק את שליו" }, OWN, deps);
  ok("\"מאשר רק את שליו\" → TERMS_CHANGED, nothing in the DB", changed.status === "TERMS_CHANGED" && psql("SELECT count(*) FROM public.owner_approval_decisions").out.trim() === "0", changed);
  const team = await runChatDecision("present_request", { requestId: ids[0] }, { tokenId: "t-team", tokenHash: H("team-observe") }, deps);
  const teamDec = await runChatDecision("decide_request", { requestId: ids[0], decision: "APPROVED", presentationToken: team.presentationToken, confirmationText: "מאשר" }, { tokenId: "t-team", tokenHash: H("team-observe") }, deps);
  ok("a non-owner's live token → refused BY THE DB (OWNER_SESSION_REQUIRED)", (teamDec as { code?: string }).code === "OWNER_SESSION_REQUIRED", teamDec);
  const noObs = await runChatDecision("present_request", { requestId: ids[0] }, { tokenId: "t-noobs", tokenHash: H("owner-noobserve") }, deps);
  const noObsDec = await runChatDecision("decide_request", { requestId: ids[0], decision: "APPROVED", presentationToken: noObs.presentationToken, confirmationText: "מאשר" }, { tokenId: "t-noobs", tokenHash: H("owner-noobserve") }, deps);
  ok("the Owner's token without partner:observe → OWNER_TOKEN_SCOPE (DB)", (noObsDec as { code?: string }).code === "OWNER_TOKEN_SCOPE", noObsDec);
  const rev = await runChatDecision("present_request", { requestId: ids[0] }, { tokenId: "t-rev", tokenHash: H("owner-revoked") }, deps);
  const revDec = await runChatDecision("decide_request", { requestId: ids[0], decision: "APPROVED", presentationToken: rev.presentationToken, confirmationText: "מאשר" }, { tokenId: "t-rev", tokenHash: H("owner-revoked") }, deps);
  ok("the Owner's revoked token → OWNER_TOKEN_INVALID (DB)", (revDec as { code?: string }).code === "OWNER_TOKEN_INVALID", revDec);

  const ap = await runChatDecision("decide_request", { requestId: ids[0], decision: "APPROVED", presentationToken: p0.presentationToken, confirmationText: "מאשר" }, OWN, deps);
  ok("Owner connected → \"מאשר\" → APPROVED by the real DB", ap.status === "OK", ap);
  const row = psql(`SELECT decision || '|' || decided_role || '|' || decided_by FROM public.owner_approval_decisions WHERE request_id = '${ids[0]}'`).out.trim();
  ok("exact audit trail: APPROVED | mcp_owner_token | the Owner", row === `APPROVED|mcp_owner_token|${OWNER}`, row);
  ok("the authorization is ACTIVE with exactly the requested terms", psql("SELECT count(*) FROM public.sunny_tracking_authorizations WHERE max_observations_per_day = 3").out.trim() === "1");
  const replay = await W.ownerDecideFromChat(svc, { tokenHash: OWN.tokenHash, requestId: ids[0], decision: "APPROVED", seenHash: (p0.request as { payloadHash: string }).payloadHash });
  ok("replay straight at the writer → ALREADY_DECIDED (DB), still one decision", (replay as { code?: string }).code === "ALREADY_DECIDED" && psql(`SELECT count(*) FROM public.owner_approval_decisions WHERE request_id = '${ids[0]}'`).out.trim() === "1", replay);
  const stale = await W.ownerDecideFromChat(svc, { tokenHash: OWN.tokenHash, requestId: ids[1], decision: "APPROVED", seenHash: "0".repeat(64) });
  ok("stale hash → SEEN_HASH_MISMATCH (DB)", (stale as { code?: string }).code === "SEEN_HASH_MISMATCH", stale);
  const srAlone = await svc.rpc("owner_approval_decide", { p_request_id: ids[1], p_decision: "APPROVED", p_seen_hash: "0".repeat(64), p_approved: null, p_reason_he: null });
  ok("service_role alone cannot use the session decide", /permission denied/.test(srAlone.error?.message ?? ""), srAlone);

  const p2 = await runChatDecision("present_request", { requestId: ids[2] }, OWN, deps);
  const rj = await runChatDecision("decide_request", { requestId: ids[2], decision: "REJECTED", presentationToken: p2.presentationToken, confirmationText: "לא מאשר" }, OWN, deps);
  ok("reject from chat → REJECTED | mcp_owner_token", rj.status === "OK" && psql(`SELECT decision || '|' || decided_role FROM public.owner_approval_decisions WHERE request_id = '${ids[2]}'`).out.trim() === "REJECTED|mcp_owner_token", rj);

  const h1 = psql(`SELECT payload_hash FROM public.owner_approval_requests WHERE id = '${ids[1]}'`).out.trim();
  const dash = await W.ownerDecide(owner, { requestId: ids[1], decision: "APPROVED", seenHash: h1 });
  ok("/sunny-approvals path (Owner session) still decides", dash.status === "OK" && psql(`SELECT decided_role FROM public.owner_approval_decisions WHERE request_id = '${ids[1]}'`).out.trim() === "authenticated", dash);
  const snap = await readBrainSnapshot(readClient);
  ok("the reader maps an mcp_owner_token decision (no READ_FAILED)", snap.status === "OK" && snap.value.approvals!.decisions.some((d) => d.decidedRole === "mcp_owner_token"), snap.status);
  console.log(`\ne2e-chat: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
