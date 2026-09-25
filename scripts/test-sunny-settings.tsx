/**
 * Tests — SETTINGS ARE NOT A SUNNY BLIND SPOT + NO ACTION IS "NEVER" FOR SUNNY.
 *   - every settings family in the repository code and in production (snapshot) is explicitly classified;
 *   - a new file touching settings, or a new key literal, fails until it is classified;
 *   - A / C families are readable; B (credentials / bearer tokens) are never queried, never returned, never served;
 *   - the settings reader is bounded to registered families (LIKE wildcards cannot widen it);
 *   - the action vocabulary has no permanent prohibition, and no action became executable.
 *
 * Run with:   npx tsx scripts/test-sunny-settings.tsx      NEVER touches production.
 */
import fs from "node:fs";
import path from "node:path";
import { SETTINGS_FAMILIES, SETTINGS_ACCESS_FILES, PRODUCTION_SETTING_FAMILIES_20260925, familyOfKey, validateSettingsFamilies } from "../lib/partner/system/settings";
import { BUSINESS_ACTIONS, DOMAIN_CONTRACTS, FORBIDDEN_SERVED_TERMS, validateSystemRegistry } from "../lib/partner/system";
import { readSettingsState, SETTINGS_READ_FAMILIES } from "../lib/partner/settings/reader";
import { PROJECT_SETTING_FAMILIES } from "../lib/partner/projects/detail-reader";
import { PARTNER_KNOWLEDGE_REGISTRY } from "../lib/partner/knowledge/catalog";
import { queryKnowledgeCore } from "../lib/partner/knowledge/query";
import type { KnowledgeAudience } from "../lib/partner/knowledge/types";
import { KNOWLEDGE_KINDS } from "../lib/partner/owner-knowledge/kinds";
import { SUPPORTED_ACTIONS, proposeActionPreviewCore } from "../lib/partner/sunny/action-proposal";
import { TOOL_NAMES } from "../lib/integrations/partner-mcp/tools";
import type { OperationsReadClient, OpsQuery } from "../lib/partner/operations/readers";
import type { GatewaySources } from "../lib/partner/gateway/core";
import { NOW, input } from "./fixtures/integrity-company";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}
const ok = (name: string, cond: boolean) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}`); fail++; } };
const section = (t: string) => console.log(`\n${t}`);
const ROOT = path.resolve(__dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const walk = (dir: string, out: string[] = []) => { if (!fs.existsSync(dir)) return out; for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) { if (!["node_modules", ".next"].includes(e.name)) walk(p, out); } else if (/\.(ts|tsx)$/.test(e.name)) out.push(p); } return out; };
const rel = (p: string) => path.relative(ROOT, p).replace(/\\/g, "/");
const OWNER: KnowledgeAudience = { channel: "EXTERNAL", ownerAuthorized: true };
const STRANGER: KnowledgeAudience = { channel: "EXTERNAL", ownerAuthorized: false };
const U = "0b5a1d3e-2f4c-4a6b-8c9d-0e1f2a3b4c5d";
const sample = (fam: string) => fam.replace(/<id>/g, U).replace(/<date>/g, "2026_09").replace(/<num>/g, "12345").replace(/<hex>/g, "a".repeat(32));
/** SQL LIKE → RegExp ('%' any run, '_' any single char). */
const likeRe = (p: string) => new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".")}$`);

/** Literals found in settings-touching code that are NOT settings keys (with the reason). */
const NOT_SETTING_KEYS: Readonly<Record<string, string>> = {
  deadline: "agent context category", finance: "agent context category", proposals: "agent context category", sessions: "agent context category",
  victor: "agent context category", activity: "agent context category", goals: "agent context category",
  "steven-completed-owner-": "notification event key (notifications table), not settings",
  "shalev_weekly_sessions_ack:": "push event id, not settings", "shalev_weekly_sessions_fail:": "push event id, not settings",
  "https:": "a URL literal, not a key", "already_": "a claim-result reason string (already_sent), not a key",
};
/** Builder heads whose full key needs more than a suffix: head → a real sample key (must classify). */
const BUILDER_HEADS: Readonly<Record<string, string>> = { "ai_": "ai_budget_2026_09" };
/** Key-builder helper files (the key text lives here, the settings access in the caller). */
const KEY_BUILDER_FILES = ["lib/shalev-availability-reminder-pure.ts", "lib/shalev-session-reminder-pure.ts", "lib/show-notify-pure.ts", "lib/steven-completed-pure.ts", "lib/steven-deadline-digest-pure.ts", "lib/steven-mix-reminder-pure.ts", "lib/project-cover.ts", "lib/dj-show-notify.ts", "lib/agent/goals.ts", "lib/agent/budget.ts", "lib/red-artists/availability.ts", "lib/vendor-store.ts"];

async function main() {
  section("1. Registry is valid and every class is explicit");
  check("validateSettingsFamilies()", validateSettingsFamilies({ domainIds: DOMAIN_CONTRACTS.map((d) => d.id) }), []);
  const byClass = SETTINGS_FAMILIES.reduce<Record<string, number>>((m, f) => ({ ...m, [f.class]: (m[f.class] ?? 0) + 1 }), {});
  ok(`classes: ${JSON.stringify(byClass)}`, Object.keys(byClass).length === 4);
  check("B = exactly the credentials + bearer share tokens", SETTINGS_FAMILIES.filter((f) => f.class === "B_AUTHENTICATION_SECRET").map((f) => f.id).sort(), ["DROPBOX_CREDENTIAL", "GOOGLE_CALENDAR_CREDENTIAL", "PUBLIC_SHARE_TOKENS"]);
  check("every A / C family is readable (SYSTEM_SETTINGS or PROJECT_DETAIL)", SETTINGS_FAMILIES.filter((f) => (f.class.startsWith("A_") || f.class.startsWith("C_")) && !["SYSTEM_SETTINGS", "PROJECT_DETAIL"].includes(f.read)).map((f) => f.id), []);

  section("2. PROOF: every production settings family (2026-09-25 snapshot) is classified");
  check("unclassified production families", PRODUCTION_SETTING_FAMILIES_20260925.filter((f) => !familyOfKey(sample(f))).map(String), []);
  ok(`${PRODUCTION_SETTING_FAMILIES_20260925.length} production families pinned`, PRODUCTION_SETTING_FAMILIES_20260925.length === 31);
  check("secrets in production map to B", ["google_calendar_token", "dropbox_tokens", `share_token_${"a".repeat(32)}`].map((k) => familyOfKey(k)?.class), ["B_AUTHENTICATION_SECRET", "B_AUTHENTICATION_SECRET", "B_AUTHENTICATION_SECRET"]);

  section("3. PROOF: code cannot introduce a settings family silently");
  const files = [...walk(path.join(ROOT, "lib")), ...walk(path.join(ROOT, "app")), ...walk(path.join(ROOT, "components")), path.join(ROOT, "instrumentation.ts")].map(rel);
  const touching = files.filter((f) => /from\(\s*["']settings["']\s*\)/.test(code(read(f)))).sort();
  check("files touching settings that are not registered (review lib/partner/system/settings.ts)", touching.filter((f) => !SETTINGS_ACCESS_FILES.includes(f as never)), []);
  check("registered files that no longer touch settings", [...SETTINGS_ACCESS_FILES].filter((f) => !touching.includes(f)), []);
  const literals = new Set<string>();
  for (const f of [...touching, ...KEY_BUILDER_FILES]) {
    const t = code(read(f));
    for (const m of t.matchAll(/\.(?:eq|like)\(\s*["']key["']\s*,\s*[`"']([^`"'$%]+)/g)) literals.add(m[1]);
    for (const m of t.matchAll(/\bkey\s*:\s*[`"']([a-z][^`"'$]*)/g)) literals.add(m[1]);
    for (const m of t.matchAll(/\b[A-Z_]*(?:KEY|PREFIX)[A-Z_]*\s*=\s*[`"']([a-z][^`"'$]*)/g)) literals.add(m[1]);
    for (const m of t.matchAll(/return\s+[`"']([a-z][a-z0-9_]*[_:])\$?\{?/g)) literals.add(m[1]);
    for (const m of t.matchAll(/=>\s*[`"']([a-z][a-z0-9_]*[_:])\$\{/g)) literals.add(m[1]);
  }
  const unknown = [...literals].filter((l) => !NOT_SETTING_KEYS[l] && !(BUILDER_HEADS[l] && familyOfKey(BUILDER_HEADS[l])) && !familyOfKey(/[_:]$/.test(l) ? `${l}${U}` : l) && !familyOfKey(`${l}2026_09`));
  check("settings key literals in code without a classified family", unknown, []);
  ok(`${literals.size} key literals checked across ${touching.length + KEY_BUILDER_FILES.length} files`, literals.size >= 30);
  for (const f of KEY_BUILDER_FILES) ok(`key-builder file exists: ${f}`, fs.existsSync(path.join(ROOT, f)));

  section("4. Readers: bounded to registered families; secrets never queried nor returned");
  const calls: Array<{ like: string | null; in: readonly string[] | null; columns: string }> = [];
  const planted = [
    { key: "google_calendar_token", value: { refresh_token: "1//SECRET" }, updated_at: null }, { key: "dropbox_tokens", value: { access_token: "sl.SECRETSECRETSECRETSECRET" }, updated_at: null },
    { key: `share_token_${"b".repeat(32)}`, value: { path: "/x" }, updated_at: null },
    { key: "vendor_victor_settings", value: { monthlySalary: 7000, currency: "₪" }, updated_at: "2026-09-01T00:00:00Z" },
    { key: "shalev_entry_last", value: { at: "2026-07-31T10:00:00Z" }, updated_at: "2026-07-31T10:00:00Z" },
    { key: `balance_cycle_anchor:${U}`, value: { anchorDate: "2026-06-01", link: "https://www.dropbox.com/scl/fi/x?rlkey=K" }, updated_at: null },
    { key: "steven_upload_pending_x", value: { files: 2 }, updated_at: null },
    { key: "maintenance_mode", value: { enabled: false }, updated_at: null },
  ];
  const client: OperationsReadClient = { from(table: string) { return { select(columns: string) {
    const call = { like: null as string | null, in: null as readonly string[] | null, columns }; calls.push(call);
    const q: OpsQuery = { like(_c: string, p: string) { call.like = p; return q; }, in(_c: string, v: readonly string[]) { call.in = v; return q; },
      range() { void table; const data = planted; return { then: (res: (v: { data: unknown[]; error: null }) => unknown) => Promise.resolve(res({ data, error: null })) } as unknown as OpsQuery; }, then: undefined as never } as unknown as OpsQuery;
    return q; } }; } };
  const state = await readSettingsState(client);
  const json = JSON.stringify(state);
  check("secret keys / values in the reader output (fake server returns EVERY row for every query)", ["google_calendar_token", "dropbox_tokens", "share_token_", "1//SECRET", "sl.SECRET", "rlkey="].filter((s) => json.includes(s)), []);
  ok("rows kept only for their own family", (state.families.VICTOR_SALARY_SETTINGS?.rows.length === 1) && state.families.PORTAL_PRESENCE?.rows.length === 1 && state.families.PENDING_UPLOAD_NOTIFICATIONS?.rows.length === 1);
  ok("links inside values reduced to booleans", JSON.stringify(state.families.ARTIST_BALANCE_CYCLE_ANCHOR).includes("has_link"));
  const secretKeys = ["google_calendar_token", "dropbox_tokens", `share_token_${"c".repeat(32)}`];
  check("no query can reach a secret key", calls.filter((c) => (c.like && secretKeys.some((k) => likeRe(c.like!).test(k))) || (c.in && c.in.some((k) => secretKeys.includes(k)))).map((c) => c.like ?? c.in), []);
  check("one query per readable family, nothing else", calls.length, SETTINGS_READ_FAMILIES.length);
  const detailSrc = read("lib/partner/projects/detail-reader.ts");
  check("every PROJECT_DETAIL family is read by the project detail source", SETTINGS_FAMILIES.filter((f) => f.read === "PROJECT_DETAIL" && f.internal.query && "like" in f.internal.query).filter((f) => { const p = (f.internal.query as { like: string }).like; return !PROJECT_SETTING_FAMILIES.some((x) => x.prefix === p) && !detailSrc.includes(`"${p}%"`); }).map((f) => f.id), []);
  ok("readers never select a credential key", !/google_calendar_token|dropbox_tokens|share_token/.test(code(read("lib/partner/settings/reader.ts")) + code(detailSrc)));

  section("5. system_settings capability — Owner-only, semantic, no secret served");
  const src: GatewaySources = { now: NOW, state: { status: "OK", value: input({ contexts: [] }).state! }, identities: { cleantone: null }, settings: { status: "OK", value: state } };
  const q = (mode: string, params: Record<string, string> = {}, aud = OWNER) => queryKnowledgeCore(PARTNER_KNOWLEDGE_REGISTRY, { capability: "system_settings", mode, params, limit: 50 }, src, aud);
  const fams = q("families");
  check("families mode lists every registered family", fams.page?.total, SETTINGS_FAMILIES.length);
  const b = fams.items.find((i) => i.id === "DROPBOX_CREDENTIAL")!;
  check("a secret family is listed as existing + secret, with no entries read", [b.fields.secret, b.fields.entries], [true, null]);
  const vals = q("values", { family: "VICTOR_SALARY_SETTINGS" });
  check("values mode serves the live non-secret value", (vals.items[0].fields.value as Record<string, unknown>).monthlySalary, 7000);
  ok("secret families cannot even be requested", q("values", { family: "DROPBOX_CREDENTIAL" }).status === "INVALID_REQUEST");
  check("refused for a non-Owner", q("families", {}, STRANGER).status === "OK", false);
  const served = JSON.stringify([fams, vals, q("values", { family: "ARTIST_BALANCE_CYCLE_ANCHOR" })]);
  check("forbidden implementation / secret terms served", FORBIDDEN_SERVED_TERMS.filter((t) => served.toLowerCase().includes(t.toLowerCase())), []);
  ok("match patterns / queries never served", !served.includes("\"internal\"") && !served.includes("\"match\""));

  section("6. No action is 'never' for Sunny — and nothing became executable");
  const lib = walk(path.join(ROOT, "lib/partner")).map(rel).filter((f) => !f.endsWith("test.ts"));
  check("'NEVER_EXPOSE_TO_SUNNY' / approval 'NEVER' anywhere in the Partner code", lib.filter((f) => /NEVER_EXPOSE_TO_SUNNY|approval:\s*"NEVER"|"NEVER"\s*[,)]/.test(code(read(f)))), []);
  check("validateSystemRegistry()", validateSystemRegistry({ capabilityIds: PARTNER_KNOWLEDGE_REGISTRY.all().map((c) => c.id), knowledgeKinds: KNOWLEDGE_KINDS.map((k) => k.kind) }), []);
  const act = (id: string) => BUSINESS_ACTIONS.find((a) => a.id === id)!;
  check("DELETE_PROJECT: legitimate future destructive action, not executable", [act("DELETE_PROJECT").class, act("DELETE_PROJECT").approval, act("DELETE_PROJECT").sunnyCanExecuteToday, ["DESTRUCTIVE_CONFIRMATION_REQUIRED", "STRONG_CONFIRMATION_REQUIRED", "EXTERNAL_EFFECT_CONFIRMATION_REQUIRED"].every((c) => act("DELETE_PROJECT").confirmations.includes(c as never))], ["FUTURE_PRIMITIVE_REQUIRED", "NOT_EXECUTABLE_YET", false, true]);
  check("CLOSE_SHOW: financial + strong confirmation, side effects stated", [act("CLOSE_SHOW").class, ["FINANCIAL_CONFIRMATION_REQUIRED", "STRONG_CONFIRMATION_REQUIRED"].every((c) => act("CLOSE_SHOW").confirmations.includes(c as never)), /ledger/.test(act("CLOSE_SHOW").reason)], ["FUTURE_PRIMITIVE_REQUIRED", true, true]);
  check("NOTIFY_ARTIST_DJ: external communication needing explicit approval", [act("NOTIFY_ARTIST_DJ").class, act("NOTIFY_ARTIST_DJ").confirmations.includes("EXTERNAL_EFFECT_CONFIRMATION_REQUIRED"), /recipients/.test(act("NOTIFY_ARTIST_DJ").reason)], ["FUTURE_PRIMITIVE_REQUIRED", true, true]);
  check("SECURITY_RESTRICTED only for auth / roles / credentials", BUSINESS_ACTIONS.filter((a) => a.class === "SECURITY_RESTRICTED").map((a) => a.id), ["SETTINGS_AUTH_PEOPLE"]);
  check("no action executable by Sunny today", BUSINESS_ACTIONS.filter((a) => a.sunnyCanExecuteToday !== false).map((a) => a.id), []);
  check("every domain's execute support is NOT_YET_EXECUTABLE (never 'forbidden forever')", DOMAIN_CONTRACTS.filter((d) => d.support.execute !== "NOT_YET_EXECUTABLE").map((d) => d.id), []);
  check("Sunny proposal primitives unchanged", [...SUPPORTED_ACTIONS], ["UPDATE_PROJECT_DEADLINE"]);
  check("MCP tools unchanged (no new mutation tool)", [...TOOL_NAMES], ["partner_brief", "partner_resolve", "partner_entity", "partner_query", "partner_answer_question", "partner_propose_knowledge"]);
  const del = proposeActionPreviewCore(src as never, { actionType: "DELETE_PROJECT", project: null, newDeadline: null }) as { status: string; known: { class: string } | null };
  check("asking Sunny to delete a project → UNSUPPORTED today, known as a future primitive", [del.status, del.known?.class], ["UNSUPPORTED_ACTION", "FUTURE_PRIMITIVE_REQUIRED"]);
}

main().then(() => { console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1); });
