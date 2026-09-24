/**
 * Tests — Sunny User / Portal / Push awareness: every authenticated role is represented, each person's claimed access
 * is PROVEN against the real role allowlists, every actual push sender in the repository is covered, access-control
 * code changes force a Sunny review, and system_awareness answers people / push / access questions semantically.
 *
 * Run with:   npx tsx scripts/test-sunny-people.tsx
 * NEVER touches production; sends nothing.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { AVI_ARTIST_ID, isAviAllowedPath, isCleantoneAllowedPath, isShalevAllowedPath, isStevenAllowedPath, isVictorAllowedPath } from "../lib/roles";
import { ACCESS_REVIEWED_FINGERPRINTS } from "../lib/partner/system/people";
import { accessMatrix, LOGIN_ROLES, PUSH_CONTRACTS, PUSH_MODULE_EXCLUSIONS, SECURITY_GAPS, USER_CONTRACTS, validatePeopleContracts } from "../lib/partner/system/people-view";
import { FORBIDDEN_SERVED_TERMS, validateSystemRegistry } from "../lib/partner/system";
import { PARTNER_KNOWLEDGE_REGISTRY } from "../lib/partner/knowledge/catalog";
import { queryKnowledgeCore } from "../lib/partner/knowledge/query";
import type { KnowledgeAudience } from "../lib/partner/knowledge/types";
import { KNOWLEDGE_KINDS } from "../lib/partner/owner-knowledge/kinds";
import { NOW } from "./fixtures/integrity-company";

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
const walk = (dir: string, out: string[] = []) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== ".next") walk(p, out); } else if (/\.(ts|tsx)$/.test(e.name)) out.push(p); } return out; };
const rel = (p: string) => path.relative(ROOT, p).replace(/\\/g, "/");
const OWNER: KnowledgeAudience = { channel: "EXTERNAL", ownerAuthorized: true };
const q = (mode: string, params: Record<string, string> = {}) => queryKnowledgeCore(PARTNER_KNOWLEDGE_REGISTRY, { capability: "system_awareness", mode, params }, { now: NOW, identities: { cleantone: null } }, OWNER);

function main() {
  section("A. Contracts are valid and consistent with the system registry");
  check("validatePeopleContracts()", validatePeopleContracts(), []);
  check("validateSystemRegistry() (incl. people / push served content)", validateSystemRegistry({ capabilityIds: PARTNER_KNOWLEDGE_REGISTRY.all().map((c) => c.id), knowledgeKinds: KNOWLEDGE_KINDS.map((k) => k.kind) }), []);

  section("B. Every authenticated role in the code is represented");
  const union = read("lib/roles.ts").match(/export type UserRole =([^;]+);/)?.[1] ?? "";
  const codeRoles = [...union.matchAll(/"([a-z]+)"/g)].map((m) => m[1]).sort();
  check("roles in code", codeRoles, ["avi", "cleantone", "owner", "shalev", "steven", "unknown", "victor"]);
  check("every code role has a person contract", codeRoles.filter((r) => !USER_CONTRACTS.some((u) => u.internal.role === r)), []);
  check("LOGIN_ROLES = code roles minus unknown", [...LOGIN_ROLES].sort(), codeRoles.filter((r) => r !== "unknown"));
  ok("every role-specific env var named in the role resolver has a login person", ["OWNER_EMAILS", "VICTOR_EMAIL", "STEVEN_EMAIL", "SHALEV_EMAIL", "CLEANTONE_EMAIL", "AVI_EMAIL"].every((v) => read("lib/roles.ts").includes(v)) && USER_CONTRACTS.filter((u) => u.kind === "LOGIN_ROLE").length === 6);

  section("C. Each person's claimed access is PROVEN against the real allowlists (not screenshots)");
  const fn: Record<string, (p: string) => boolean> = { shalev: isShalevAllowedPath, avi: isAviAllowedPath, cleantone: isCleantoneAllowedPath, victor: isVictorAllowedPath, steven: isStevenAllowedPath };
  const sub = (p: string) => p.replace(/\{AVI\}/g, AVI_ARTIST_ID);
  for (const [role, allowed] of Object.entries(fn)) {
    const u = USER_CONTRACTS.find((x) => x.internal.role === role)!;
    check(`${u.id}: claimed reachable paths are allowed`, u.internal.allowedPaths.map(sub).filter((p) => !allowed(p)), []);
    check(`${u.id}: claimed blocked paths are denied`, u.internal.deniedPaths.map(sub).filter((p) => allowed(p)), []);
    ok(`${u.id}: the landing page is reachable for that role`, allowed(sub(u.landing!.replace("<Avi's label-artist id>", AVI_ARTIST_ID))));
    ok(`${u.id}: finance / dashboard / other portals are denied`, !allowed("/finance") && !allowed("/dashboard") && !allowed("/api/transactions"));
  }

  section("D. Access-control code changes force a Sunny review");
  for (const [f, want] of Object.entries(ACCESS_REVIEWED_FINGERPRINTS)) {
    const got = createHash("sha256").update(fs.readFileSync(path.join(ROOT, f)).toString("utf8").replace(/\r\n/g, "\n")).digest("hex");
    check(`${f} unchanged since the last Sunny access review (update people contracts + fingerprint together)`, got, want);
  }

  section("E. Every push sender in the repository is covered (no UNKNOWN sender)");
  const files = [...walk(path.join(ROOT, "lib")), ...walk(path.join(ROOT, "app")), ...walk(path.join(ROOT, "components")), path.join(ROOT, "instrumentation.ts")];
  const senders = files.filter((f) => /\b(sendPushToRoles|sendPushToAll)\s*\(/.test(code(fs.readFileSync(f, "utf8")))).map(rel).sort();
  const covered = new Set([...PUSH_CONTRACTS.flatMap((p) => p.internal.modules), ...PUSH_MODULE_EXCLUSIONS.map((x) => x.module)]);
  check("push-sending modules not covered by a push contract", senders.filter((f) => !covered.has(f)), []);
  check("push contracts pointing at a module that no longer sends", [...covered].filter((m) => !senders.includes(m)), []);
  ok(`${senders.length} sending modules found, ${PUSH_CONTRACTS.length} push contracts`, senders.length >= 30 && PUSH_CONTRACTS.length >= 30);
  check("the web-push library is imported only by the push primitive", files.filter((f) => /from\s+["']web-push["']|require\(["']web-push["']\)/.test(code(fs.readFileSync(f, "utf8")))).map(rel), ["lib/push.ts"]);
  ok("every push contract: Sunny may NOT trigger it", PUSH_CONTRACTS.every((p) => p.sunnyMayTrigger === false));
  ok("statuses are ACTIVE / DISABLED / LEGACY only; the agent sender is DISABLED and the push check is LEGACY", PUSH_CONTRACTS.find((p) => p.id === "P_AGENT_ALERTS")!.status === "DISABLED" && PUSH_CONTRACTS.find((p) => p.id === "P_PUSH_CHECK_LEGACY")!.status === "LEGACY");
  check("senders WITHOUT a production-only guard are flagged (and match the code)", PUSH_CONTRACTS.filter((p) => !p.productionOnly).map((p) => p.id).sort(), ["P_AGENT_ALERTS", "P_CYCLE_REMIND", "P_EXTERNAL_PUSH_CRON", "P_PUSH_CHECK_LEGACY", "P_SKETCH_NOTIFY_MANUAL"]);
  ok("the flagged senders really have no production guard in code", ["app/api/push/cron/route.ts", "app/api/push/check/route.ts", "app/api/label/artists/[id]/balance/cycles/remind/route.ts", "app/api/label/artists/[id]/sketches/[sketchId]/notify/route.ts", "lib/agent/notifications.ts"].every((f) => !/pushAllowed|ALLOW_SERVER_PUSH/.test(code(read(f)))));

  section("F. Refresh never sends push for the Owner; page-load beacons are the non-owner roles' own opens");
  const beacons = PUSH_CONTRACTS.filter((p) => p.type === "PAGE_LOAD_BEACON" && p.status === "ACTIVE");
  check("active page-load beacons", beacons.map((p) => p.id).sort(), ["P_AVI_PRESENCE", "P_CLEANTONE_PRESENCE", "P_SHALEV_PRESENCE", "P_STEVEN_PRESENCE", "P_VICTOR_PRESENCE"]);
  ok("the Owner triggers no page-load beacon", !USER_CONTRACTS.find((u) => u.id === "OWNER")!.triggersPush.some((id) => beacons.some((b) => b.id === id)));
  const clientFiles = [...walk(path.join(ROOT, "components")), ...walk(path.join(ROOT, "app"))].filter((f) => !f.includes(`${path.sep}api${path.sep}`));
  check("no page / component calls the legacy push check", clientFiles.filter((f) => code(fs.readFileSync(f, "utf8")).includes("/api/push/check")).map(rel), []);
  ok("presence routes are no-ops for the Owner (role checked on the server)", ["app/api/red-artists/ping/route.ts", "app/api/label/artists/[id]/ping/route.ts", "app/api/red-artists/cleantone/ping/route.ts", "app/api/vendor/victor/ping/route.ts", "app/api/supplier/steven/ping/route.ts"].every((f) => /!==\s*["'](shalev|avi|cleantone|victor|steven)["']\)\s*return NextResponse\.json\(\{\s*ok:\s*true\s*\}\)/.test(code(read(f)))));

  section("G. Sunny answers people / push / access questions from the contracts");
  const people = q("people");
  check("'מי יכול להתחבר למערכת?' — every person", people.items.map((i) => i.id).sort(), USER_CONTRACTS.map((u) => u.id).sort());
  const shalev = q("person", { person: "SHALEV" }).items[0].fields as Record<string, unknown>;
  ok("'מה שליו רואה?' — 8 surfaces incl. balance read-only + mandatory availability window", (shalev.tabs as unknown[]).length === 8 && JSON.stringify(shalev.tabs).includes("OWN_LEDGER_READ_ONLY"));
  ok("'איזה פושים שליו מקבל ולמה?' — incl. availability reminder with its schedule", (shalev.pushes as Array<{ id: string; timing: string }>).some((p) => p.id === "P_SHALEV_AVAILABILITY_REMINDER" && p.timing.includes("Thursday")));
  ok("no internal role / allowlist / module detail is served", !("internal" in shalev) && !JSON.stringify(q("push").items).includes("modules"));
  const cl = q("person", { person: "CLEANTONE" }).items[0].fields as Record<string, unknown>;
  ok("'מה קורה כשקלינטון מאשר הופעה?' — confirm → Owner push, Owner-confirmed role kept as OWNER_CONFIRMED", JSON.stringify(cl.tabs).includes("P_DJ_CONFIRMED") && JSON.stringify(cl.entities).includes("OWNER_CONFIRMED_RELATION"));
  const stevenPush = q("push", { recipient: "steven" });
  check("'איזה פושים סטיבן מקבל?'", stevenPush.items.map((i) => i.id).sort(), ["P_STEVEN_COMPLETED", "P_STEVEN_DEADLINE_DIGEST", "P_STEVEN_MIX_READY", "P_STEVEN_MIX_REMINDER", "P_STEVEN_NOTES", "P_STEVEN_PAYMENT"]);
  const victorDone = PUSH_CONTRACTS.find((p) => p.id === "P_VICTOR_COMPLETED")!;
  check("'מי מקבל התראה כשויקטור מסיים עבודה?'", victorDone.recipientRoles, ["victor", "owner"]);
  const acc = accessMatrix();
  check("'מי יכול לראות כסף?'", acc.filter((r) => r.money.length > 0).map((r) => `${r.person}:${r.money.join("+")}`).sort(), ["CLEANTONE:OWN_FEE_ONLY", "OWNER:ALL", "SHALEV:OWN_LEDGER_READ_ONLY", "STEVEN:OWN_PAYMENTS_READ_ONLY", "VICTOR:HIDDEN_BUT_IN_PAYLOAD"]);
  check("'מי יכול רק לקרוא?' (login roles with no writes)", acc.filter((r) => r.readOnly).map((r) => r.person), []);
  check("'מי יכול לשלוח Push ידנית?'", acc.filter((r) => r.canSendPushManually).map((r) => r.person), ["OWNER"]);
  check("'מי יכול להעלות קבצים?'", acc.filter((r) => r.canUpload).map((r) => r.person).sort(), ["SHALEV", "STEVEN", "VICTOR"]);
  const gaps = q("gaps");
  ok("security gaps served as OBSERVATION, report-only, incl. the HIGH Victor Dropbox gap", gaps.items.every((i) => i.epistemic === "OBSERVATION" && i.fields.status === "REPORTED_NOT_FIXED") && gaps.items.some((i) => i.id === "SG_VICTOR_DROPBOX_PATHS" && i.fields.severity === "HIGH"));
  ok("UI-vs-server mismatches are distinguished from security gaps", SECURITY_GAPS.some((g) => g.kind === "UI_SERVER_MISMATCH") && SECURITY_GAPS.some((g) => g.kind === "SECURITY_GAP"));
  const all = JSON.stringify(["people", "push", "access", "gaps"].map((m) => q(m)).concat(USER_CONTRACTS.map((u) => q("person", { person: u.id })))).toLowerCase();
  check("no implementation terms / secrets served", FORBIDDEN_SERVED_TERMS.filter((t) => all.includes(t.toLowerCase())), []);
  ok("no email address is ever served", !/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(all));

  section("H. Development contract covers users / roles / portals / push");
  const agents = read("AGENTS.md");
  ok("AGENTS.md requires a Sunny review for roles, portals, access and push senders", /people\.ts/.test(agents) && /push sender/i.test(agents) && /test-sunny-people\.tsx/.test(agents));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main();
