/**
 * SUNNY UNIVERSAL ACTION LAYER — regenerates lib/partner/act/handler-map.generated.ts: every API route file that exports
 * a write handler (POST / PATCH / PUT / DELETE) or a GET that writes, with its LF-normalized SHA-256 and the side
 * effects found by a transitive import scan (external sinks are terminal: only the CALL is counted, not the definition).
 *
 * Run:  node scripts/gen-act-handler-map.mjs      (pure; reads the repo only)
 * A route change fails scripts/test-sunny-act-foundation.tsx until this is regenerated AND the registry is reviewed.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
export const WRITE_RE = /export\s+(?:async\s+)?function\s+(POST|PATCH|PUT|DELETE)\b|export\s+const\s+(POST|PATCH|PUT|DELETE)\b/g;
const GET_RE = /export\s+(?:async\s+)?function\s+GET\b|export\s+const\s+GET\b/;
/** The GET handler's own text (up to the next top-level export). */
const getSegment = (src) => src.split(/\n(?=export\s)/).filter((seg) => GET_RE.test(seg));
/** Calls that are writes by name (page-load / GET writers reached through a helper). */
const WRITER_CALL_RE = /^(sync|backfill|upsert|insert|create|save|mark|record|ensure|pull|write|persist|refresh)[A-Z]/;
const DB_WRITE_RE = /\.(insert|update|upsert|delete)\s*\(/;
/** External sinks: never recursed into (their own definitions are not calls). */
const SINKS = new Set(["lib/google-calendar.ts", "lib/push.ts", "lib/reports/email.ts", "lib/dropbox-token.ts", "lib/supabase.ts", "lib/supabase-server.ts"]);
const tableWrite = (tables) => new RegExp(`\\.from\\("(?:${tables})"\\)[\\s\\S]{0,240}?\\.(?:insert|update|upsert|delete)\\s*\\(`);
export const EFFECT_PATTERNS = {
  FINANCE: tableWrite("transactions"),
  LEDGER: tableWrite("artist_balance_entries|artist_balance_cycles|label_media_income"),
  CALENDAR: [/google-calendar["']/, /\b(createCalendarEvent|updateCalendarEvent|deleteCalendarEvent|saveToken|revokeToken)\b/],
  GOOGLE_TASKS: [/google-calendar["']/, /\b(createGoogleTask|updateGoogleTaskStatus|updateGoogleTaskDue|deleteGoogleTask)\b/],
  FILES: /dropboxapi\.com\/2\/files\/(upload|delete|copy|move|create_folder)|upload_session\/(start|finish)|storage\s*\.from\([^)]*\)\s*\.(upload|remove|move)\s*\(/,
  PUSH: /\bsendPushTo[A-Za-z]*\s*\(/,
  EMAIL: /\bsendReportEmail\s*\(|api\.resend\.com/,
  DELETION: /\.delete\s*\(\s*\)|dropboxapi\.com\/2\/files\/delete|storage\s*\.from\([^)]*\)\s*\.remove\s*\(/,
  SETTINGS: tableWrite("settings"),
  EXTERNAL_LINK: /create_shared_link_with_settings/,
};
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");

function resolveImport(fromRel, spec) {
  let base;
  if (spec.startsWith("@/")) base = spec.slice(2);
  else if (spec.startsWith(".")) base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
  else return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (/\.(ts|tsx)$/.test(c) && fs.existsSync(path.join(ROOT, c)) && fs.statSync(path.join(ROOT, c)).isFile()) return c;
  }
  return null;
}
const memo = new Map();
function effectsOf(rel, stack = new Set()) {
  if (memo.has(rel)) return memo.get(rel);
  if (stack.has(rel)) return new Set();
  stack.add(rel);
  const src = stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));
  const out = new Set();
  for (const [k, re] of Object.entries(EFFECT_PATTERNS)) if ((Array.isArray(re) ? re : [re]).every((r) => r.test(src))) out.add(k);
  if (!SINKS.has(rel)) {
    for (const m of src.matchAll(/(?:import|export)\s+(?:type\s+)?[^"';]*?from\s+["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g)) {
      if (/^import\s+type\b|^export\s+type\b/.test(m[0])) continue;
      const r = resolveImport(rel, m[1] ?? m[2]);
      if (r && !SINKS.has(r)) for (const e of effectsOf(r, stack)) out.add(e);
    }
  }
  stack.delete(rel);
  memo.set(rel, out);
  return out;
}
/** Request-body keys a write handler reads (body.x / b.x / destructuring of the parsed body). Approximate by design;
 *  the guard only needs every key it finds to be classified. */
function acceptedFields(src) {
  const keys = new Set();
  for (const m of src.matchAll(/\b(?:body|b|payload|patch|updates|input)\s*(?:\?\.|\.)\s*([A-Za-z_][A-Za-z0-9_]*)/g)) keys.add(m[1]);
  for (const m of src.matchAll(/(?:const|let)\s*\{([^}]{1,600})\}\s*=\s*(?:await\s+(?:req|request)\.json\(\)|body|b|payload)\b/g))
    for (const part of m[1].split(",")) { const k = part.trim().split(/[:=\s]/)[0].replace(/^\.\.\./, ""); if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) keys.add(k); }
  for (const k of ["length", "map", "filter", "some", "every", "forEach", "includes", "trim", "toString", "then", "json"]) keys.delete(k);
  return [...keys].sort();
}
function walk(dir, acc = []) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(p, acc); else if (e.name === "route.ts") acc.push(p);
  }
  return acc;
}
export function buildHandlerMap() {
  const out = {};
  for (const rel of walk("app/api").sort()) {
    const raw = fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
    const src = stripComments(raw);
    const methods = [...new Set([...src.matchAll(WRITE_RE)].map((m) => m[1] || m[2]))].sort();
    const getWrites = getSegment(src).some((seg) => DB_WRITE_RE.test(seg) || [...seg.matchAll(/\b([a-z][A-Za-z0-9]*)\s*\(/g)].some((m) => WRITER_CALL_RE.test(m[1])));
    if (!methods.length && !getWrites) continue;
    out[rel] = { methods, getWrites, sha256: crypto.createHash("sha256").update(raw).digest("hex"), effects: [...effectsOf(rel)].sort(), fields: acceptedFields(src) };
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(ROOT, "scripts/gen-act-handler-map.mjs")) {
  const map = buildHandlerMap();
  const body = `/**\n * GENERATED by scripts/gen-act-handler-map.mjs — do not edit by hand. Every API route file with a write handler (or a\n * GET that writes), its LF-normalized SHA-256 and the side effects found by the transitive scan. Internal (never served).\n */\nexport interface HandlerEntry { methods: readonly string[]; getWrites: boolean; sha256: string; effects: readonly string[]; fields: readonly string[] }\nexport const HANDLER_MAP: Readonly<Record<string, HandlerEntry>> = ${JSON.stringify(map, null, 1)};\n`;
  fs.writeFileSync(path.join(ROOT, "lib/partner/act/handler-map.generated.ts"), body);
  const n = Object.keys(map).length, h = Object.values(map).reduce((s, e) => s + e.methods.length, 0);
  console.log(`routes ${n}, write handlers ${h}, GET-writes ${Object.values(map).filter((e) => e.getWrites).length}`);
}
