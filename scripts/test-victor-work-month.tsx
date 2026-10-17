/**
 * "העבר לחודש אחר" for Victor works (Owner decision + approved SQL 2026-10-17): vendor_project_work.attributed_month is
 * the Owner's month attribution. ONE month rule (lib/victor-segments monthRef: attributed_month, else sent_date, else
 * created_at) feeds every list / count / capacity / KPI / report and Sunny. The writer (lib/writes/victor-month) changes
 * ONLY that column (compare-and-swap), never the sent date / completion / deadline / status / files / notes / money, and
 * sends no push. The route is Owner-only IN the route (the proxy lets Victor reach /api/vendor/victor/work/*).
 * Run with:   npx tsx scripts/test-victor-work-month.tsx
 */
import Module from "node:module";
import fs from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 500)}` : ""}`); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

// ── in-memory table + an auth double ────────────────────────────────────────────────────────────────────────────
type Row = Record<string, unknown>;
const ROWS: Row[] = [];
const UPDATES: Row[] = [];
const RACE = { on: false }; // a concurrent writer changes the attribution between the read and the conditional update
function from(table: string) {
  if (table !== "vendor_project_work") throw new Error(`unexpected table ${table}`);
  const filters: Array<(r: Row) => boolean> = [];
  let patch: Row | null = null;
  const run = (one: boolean) => {
    if (patch && RACE.on) { RACE.on = false; for (const r of ROWS) r.attributed_month = "2026-12"; }
    const rows = ROWS.filter((r) => filters.every((f) => f(r)));
    if (patch) { UPDATES.push({ ...patch }); for (const r of rows) Object.assign(r, patch); }
    const data = rows.map((r) => ({ ...r }));
    return { data: one ? data[0] ?? null : data, error: null };
  };
  const c: Record<string, unknown> = {
    select() { return c; },
    eq(k: string, v: unknown) { filters.push((r) => r[k] === v); return c; },
    is(k: string, v: unknown) { filters.push((r) => (v === null ? r[k] == null : r[k] === v)); return c; },
    maybeSingle() { return Promise.resolve(run(true)); },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(run(false)).then(res, rej); },
  };
  return { select: () => c, update(p: Row) { patch = p; return c; } };
}
const AUTH = { role: "owner" as "owner" | "victor" };
const ML = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
const orig = ML._load;
ML._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  if (/(^|\/)supabase$/.test(request)) return { supabase: { from } };
  if (/require-auth$/.test(request)) return {
    async requireOwner() { const { NextResponse } = await import("next/server"); return AUTH.role === "owner" ? null : NextResponse.json({ error: "forbidden" }, { status: 403 }); },
  };
  return orig.call(this, request, parent, isMain);
};

const W = (o: Row = {}): Row => ({ id: "w1", vendor_name: "victor", sent_date: "2026-09-08", created_at: "2026-09-08T10:00:00Z", attributed_month: null, status: "הושלם", internal_deadline: "2026-09-20", returned_date: "2026-09-25", notes: "n", files_sent: [], ...o });

(async () => {
  const S = await import("../lib/victor-segments");
  const M = await import("../lib/writes/victor-month");
  const route = await import("../app/api/vendor/victor/work/[id]/month/route");

  console.log("The ONE month rule (lib/victor-segments)");
  const base = { sentDate: "2026-09-08", createdAt: "2026-09-01T00:00:00Z" };
  ok("1a. no attribution → the sent-date month", S.workMonthOf(base) === "2026-09");
  ok("1b. the Owner's attribution wins", S.workMonthOf({ ...base, attributedMonth: "2026-10" }) === "2026-10");
  ok("1c. no sent date → created month", S.workMonthOf({ sentDate: null, createdAt: "2026-08-30T00:00:00Z" }) === "2026-08");
  ok("1d. the natural month ignores the attribution (stuck / age keep reading sent_date)", S.naturalMonthRef({ ...base }) === "2026-09-08");
  const mk = (id: string, status: string, attributedMonth: string | null) => ({ id, status, sentDate: "2026-09-08", createdAt: "2026-09-08T00:00:00Z", attributedMonth, isStuck: false, workState: null, outcome: null } as never);
  const works = [mk("a", "הושלם", "2026-10"), mk("b", "הושלם", null), mk("c", "פעיל", null)];
  const sep = S.segmentVictorWork(works, "2026-09"), oct = S.segmentVictorWork(works, "2026-10");
  ok("1e. a moved completed work counts in the target month only (no duplicate)", sep.completed.length === 1 && oct.completed.length === 1 && sep.sentThisMonth.length + oct.sentThisMonth.length === 3, { sep: sep.completed.length, oct: oct.completed.length });

  console.log("The writer (lib/writes/victor-month) — only attributed_month, compare-and-swap");
  ROWS.length = 0; ROWS.push(W());
  UPDATES.length = 0;
  const r1 = await M.moveVictorWorkMonth("w1", "2026-10");
  ok("2a. moves September → October", r1.kind === "ok" && r1.from === "2026-09" && r1.to === "2026-10" && ROWS[0].attributed_month === "2026-10", r1);
  ok("2b. the ONLY column written is attributed_month", UPDATES.length === 1 && JSON.stringify(Object.keys(UPDATES[0])) === '["attributed_month"]', UPDATES);
  ok("2c. sent date / status / deadline / completion / notes untouched", ROWS[0].sent_date === "2026-09-08" && ROWS[0].status === "הושלם" && ROWS[0].internal_deadline === "2026-09-20" && ROWS[0].returned_date === "2026-09-25" && ROWS[0].notes === "n");
  ok("2d. the same month again → no_change (nothing written)", (await M.moveVictorWorkMonth("w1", "2026-10")).kind === "no_change" && UPDATES.length === 1);
  const r3 = await M.moveVictorWorkMonth("w1", "2026-09");
  ok("2e. back to the sent-date month clears the attribution", r3.kind === "ok" && ROWS[0].attributed_month === null, ROWS[0]);
  ok("2f. an invalid month is refused before any read / write", (await M.moveVictorWorkMonth("w1", "10/2026")).kind === "invalid" && (await M.moveVictorWorkMonth("w1", "2026-13")).kind === "invalid");
  ok("2g. not a Victor work / missing → not_found", (ROWS.push(W({ id: "s1", vendor_name: "steven" })), (await M.moveVictorWorkMonth("s1", "2026-10")).kind === "not_found") && (await M.moveVictorWorkMonth("nope", "2026-10")).kind === "not_found");
  // a concurrent move: the stored attribution changes between the read and the conditional update
  ROWS.length = 0; ROWS.push(W({ attributed_month: "2026-11" }));
  RACE.on = true;
  const rc = await M.moveVictorWorkMonth("w1", "2026-10");
  ok("2h. a concurrent change → conflict, never overwritten", rc.kind === "conflict" && ROWS[0].attributed_month === "2026-12", { rc, row: ROWS[0] });

  console.log("The route — Owner only, enforced in the route");
  ROWS.length = 0; ROWS.push(W()); UPDATES.length = 0;
  const call = async (toMonth: unknown) => { const res = await route.POST(new Request("http://x/api/vendor/victor/work/w1/month", { method: "POST", body: JSON.stringify({ toMonth }) }), { params: Promise.resolve({ id: "w1" }) }); return { status: res!.status, body: await res!.json() }; };
  AUTH.role = "victor";
  const v = await call("2026-10");
  ok("3a. a Victor session is refused (403) and nothing is written", v.status === 403 && UPDATES.length === 0 && ROWS[0].attributed_month === null, v);
  AUTH.role = "owner";
  const o = await call("2026-10");
  ok("3b. the Owner moves it (200, from / to)", o.status === 200 && o.body.ok === true && o.body.from === "2026-09" && o.body.to === "2026-10", o);
  ok("3c. the same month → 400", (await call("2026-10")).status === 400);
  ok("3d. a bad month → 400", (await call("oct")).status === 400);
  const routeSrc = read("app/api/vendor/victor/work/[id]/month/route.ts");
  ok("3e. requireOwner is the route's first statement", /export async function POST\([^\n]*\) \{\n\s*const denied = await requireOwner\(\); if \(denied\) return denied;/.test(routeSrc));
  ok("3f. the proxy lets Victor reach the path (so the in-route check is the boundary — documented)", /lets a Victor session reach \/api\/vendor\/victor\/work\/\*/.test(routeSrc));

  console.log("No push / no other side effect; Victor and Sunny read the same month");
  const writerSrc = read("lib/writes/victor-month.ts");
  ok("4a. the writer imports no push / notify / finance / dropbox / calendar module", !/push|notify|finance|dropbox|calendar|google/i.test(writerSrc.split("\n").filter((l) => l.startsWith("import")).join("\n")));
  ok("4b. the route imports only auth + the month writer", (routeSrc.match(/^import /gm) ?? []).length === 3 && !/push|notify/i.test(routeSrc.split("\n").filter((l) => l.startsWith("import")).join("\n")));
  const store = read("lib/vendor-store.ts");
  ok("4c. every work read maps attributed_month (owner, Victor, reports, goals, COO / Sunny all use mapRow)", /attributedMonth:\s+\(row\.attributed_month as string \| null\) \?\? null/.test(store));
  ok("4d. Victor's sanitized payload keeps the month (his counts match the Owner's)", !/attributedMonth/.test(store.slice(store.indexOf("export function sanitizeWorkForVictor"), store.indexOf("export function sanitizeWorkForVictor") + 1500)));
  ok("4e. Sunny's Victor view serves month + monthSource by the same rule", /month: workMonthOf\(/.test(read("lib/partner/victor/view.ts")) && /monthSource:/.test(read("lib/partner/victor/view.ts")));
  ok("4f. Sunny's primitive MOVE_VICTOR_WORK_MONTH exists, writes through the month writer, says 'no push'", /actionId: "MOVE_VICTOR_WORK_MONTH"/.test(read("lib/partner/act/primitives/victor.ts")) && /moveVictorWorkMonth \(lib\/writes\/victor-month\)/.test(read("lib/partner/act/primitives/victor.ts")) && /לא יישלח Push/.test(read("lib/partner/act/primitives/victor.ts")));

  console.log("UI — the button sits between 'שלח עבודה לויקטור' and 'מחק פרויקט', Owner only");
  const page = read("components/team/VictorProfilePage.tsx");
  const iSend = page.indexOf('{t("drawer.sendWork")}'), iMove = page.indexOf('{t("drawer.moveMonth")}'), iRemove = page.indexOf('{t("drawer.removeProject")}');
  ok("5a. order: send → move → remove", iSend > 0 && iMove > iSend && iRemove > iMove, { iSend, iMove, iRemove });
  ok("5b. rendered only for the Owner", /\{isOwner && \(moveStep === "closed" \?/.test(page));
  ok("5c. the confirm names the work, the source month and the target month", /t\("drawer\.moveMonthConfirm", \{ title: [^}]+from: victorMonthYear\(workMonth, lang\), to: victorMonthYear\(moveTo, lang\) \}\)/.test(page));
  ok("5d. the same month cannot be confirmed", /disabled=\{moveTo === workMonth\}/.test(page));
  ok("5e. '+N more projects' expands the list (button, not text)", /onClick=\{\(\) => setShowAllWork\(\(v\) => !v\)\}/.test(page) && /const displayWork = showAllWork \? monthWork : monthWork\.slice\(0, 12\);/.test(page));
  const i18n = read("lib/victor-i18n.ts");
  ok("5f. every new key exists in he / en / ru", ["drawer.moveMonth", "drawer.moveMonthPick", "drawer.moveMonthConfirm", "drawer.moveMonthSame", "drawer.moveMonthNote", "drawer.moveMonthMoving", "drawer.moveMonthNext", "projects.less"].every((k) => (i18n.match(new RegExp(`"${k.replace(".", "\\.")}":`, "g")) ?? []).length === 3));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
