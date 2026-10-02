/**
 * P2 writer guard (Owner decision: option B — contract + T1 + this static guard). Proves, over the whole repo, that
 * the ONLY code path able to write public.partner_owner_knowledge is store.ts appendBatch, reached only from
 * propose.ts commitKnowledgeCore (T1-gated). It is a CONVENTION guard, not DB enforcement: service_role still holds INSERT.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
const ROOT = join(__dirname, "..");
const SKIP = new Set(["node_modules", ".next", ".git", "scripts"]);   // scripts/ = tests + SQL, never deployed
const files: string[] = [];
(function walk(d: string) { for (const n of readdirSync(d)) { const p = join(d, n); if (SKIP.has(n)) continue; const s = statSync(p);
  if (s.isDirectory()) walk(p); else if (/\.(ts|tsx|js|mjs|cjs)$/.test(n)) files.push(p); } })(ROOT);
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = "") => { if (cond) { pass++; console.log(`PASS  ${name}`); } else { fail++; console.log(`FAIL  ${name}  ${detail}`); } };
const src = Object.fromEntries(files.map((f) => [relative(ROOT, f), readFileSync(f, "utf8")]));
const where = (re: RegExp) => Object.entries(src).filter(([, t]) => re.test(t)).map(([f]) => f).sort();

ok("the table name literal appears only in the store, the connector allowlist and descriptive contracts",
  JSON.stringify(where(/["'`]partner_owner_knowledge["'`]/)) === JSON.stringify(["lib/partner/owner-knowledge/store.ts", "lib/partner/system/index.ts"]),
  JSON.stringify(where(/["'`]partner_owner_knowledge["'`]/)));
ok("OWNER_KNOWLEDGE_TABLE is used only inside the store", JSON.stringify(where(/\bOWNER_KNOWLEDGE_TABLE\b/)) === JSON.stringify(["lib/partner/owner-knowledge/store.ts"]), JSON.stringify(where(/\bOWNER_KNOWLEDGE_TABLE\b/)));
const store = src["lib/partner/owner-knowledge/store.ts"];
ok("the store has exactly ONE insert and no update / upsert / delete / rpc", (store.match(/\.insert\(/g) ?? []).length === 1 && !/\.(update|upsert|delete|rpc)\(/.test(store));
ok("appendBatch( is called only by propose.ts", JSON.stringify(where(/\.appendBatch\(/)) === JSON.stringify(["lib/partner/owner-knowledge/propose.ts"]), JSON.stringify(where(/\.appendBatch\(/)));
const propose = src["lib/partner/owner-knowledge/propose.ts"];
const commitIdx = propose.indexOf("export async function commitKnowledgeCore"), appendIdx = propose.indexOf(".appendBatch(");
const nextFn = propose.indexOf("\nexport ", commitIdx + 10);
ok("…and only inside commitKnowledgeCore, after the T1 approval verdict", commitIdx >= 0 && appendIdx > commitIdx && (nextFn < 0 || appendIdx < nextFn) && propose.slice(commitIdx, appendIdx).includes("ownerApprovalVerdict"));
// dynamic table writers: every .from(<identifier>) followed by a write must take its table from a constant list without the P2 table
const dyn = Object.entries(src).flatMap(([f, t]) => [...t.matchAll(/\.from\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\.\s*(insert|upsert|update|delete)\(/g)].map((m) => `${f}:${m[1]}.${m[2]}`));
ok("no dynamic-table WRITE can reach the P2 table (dynamic writes use constant child-table lists)", dyn.every((d) => /^lib\/writes\/redfilms\.ts:t\.delete$|^lib\/partner\/owner-knowledge\/store\.ts:OWNER_KNOWLEDGE_TABLE\.insert$/.test(d) || (/^lib\/social-promotions-store\.ts:TABLE\./.test(d) && /const TABLE = "social_promotions"/.test(src["lib/social-promotions-store.ts"]))), JSON.stringify(dyn));
ok("RF_CHILD_TABLES (the one dynamic delete list) does not name the P2 table", !/partner_owner_knowledge/.test((/RF_CHILD_TABLES\s*=\s*\[([^\]]*)\]/.exec(src["lib/writes/redfilms.ts"]) ?? ["", ""])[1]));
ok("no generic SQL executor (rpc exec_sql / query / raw postgres client) in deployed code", where(/\.rpc\(\s*["'`](exec|execute|sql|query|run)_?sql/i).length === 0 && where(/from\s+["'](pg|postgres)["']/).length === 0, JSON.stringify(where(/from\s+["'](pg|postgres)["']/)));
ok("raw REST writes to the P2 path exist only as the connector's exact-path allowlist", JSON.stringify(where(/rest\\?\/v1\\?\/partner_owner_knowledge/)) === JSON.stringify(["lib/integrations/partner-mcp/mcp-only.ts"]));
console.log(`p2-writer-guard: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
