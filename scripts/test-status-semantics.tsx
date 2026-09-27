/**
 * B5 — STATUS / DERIVED FACTS: one meaning per status / date everywhere (screens, reports, push, agent, Sunny).
 *
 *   1. overdue           THE project-overdue rule (lib/project-deadline): strict YYYY-MM-DD, Israel day, never
 *                        הושלם / בוטל / בהשהייה, never hidden — the same answer in the UI helpers, reports, push digest,
 *                        agent rules, COO config and Sunny.
 *   2. end_date          stamped only on a real transition into הושלם; a re-save keeps it.
 *   3. Victor projectToo the server rule completeProjectIfAllowed: a protected / completed project is refused.
 *   4. releases          released_at = first released at (kept when the stage moves back; stamped on a direct create).
 *   5. social            shared phases: published never overdue, ready_to_post is ready (checker + Sunny agree).
 *   6. delivery          delivered ⇔ a date; lastDeliveredAt survives a status change and a folder delete; requestOpen
 *                        = the app's final-files flags.
 *   7. Victor salary     Finance precedence, Owner-statement conflict, duplicate month.
 *   8. send log          a pending entry superseded by a later upload is history.
 *   9. sections ball     = the mix handoff rule.
 *  10. Steven texts      the completion never claims the project completed; a new work created as paid has a date.
 *
 * Run with:   npx tsx scripts/test-status-semantics.tsx      Pure + fakes; never touches production.
 */
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import { NextRequest } from "next/server";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 600)}` : ""}`); } };
const eq = (name: string, got: unknown, want: unknown) => ok(name, JSON.stringify(got) === JSON.stringify(want), { got, want });
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");
const section = (t: string) => console.log(`\n${t}`);

// ── fakes: Supabase REST + Dropbox (no network, no production) ──────────────────────────────────────────────────
process.env.SUPABASE_URL = "https://fake-supabase.test";
process.env.SUPABASE_SECRET_KEY = "test-only";
type Row = Record<string, unknown>;
let db: Record<string, Row[]> = {};
const writes: Array<{ method: string; table: string; query: string; body: unknown }> = [];
const dropboxCalls: string[] = [];
const KEY_COL: Record<string, string> = { settings: "key", project_release_details: "project_id" };
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url);
  const method = (init?.method ?? "GET").toUpperCase();
  const headers = new Headers(init?.headers as HeadersInit | undefined);
  const j = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
  if (url.host === "fake-supabase.test") {
    const table = url.pathname.split("/").pop()!;
    db[table] ??= [];
    let rows = db[table];
    for (const [k, v] of url.searchParams) {
      if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(k)) continue;
      if (v.startsWith("eq.")) rows = rows.filter((r) => String(r[k]) === v.slice(3));
      else if (v === "is.null") rows = rows.filter((r) => r[k] == null);
    }
    const one = (headers.get("accept") ?? "").includes("vnd.pgrst.object");
    const out = (rs: Row[]) => (one ? (rs.length === 1 ? j(rs[0]) : j({ code: "PGRST116", message: "no rows" }, 406)) : j(rs));
    if (method === "GET" || method === "HEAD") return out(rows);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    writes.push({ method, table, query: url.search, body });
    if (method === "PATCH") { for (const r of rows) Object.assign(r, body); return (headers.get("prefer") ?? "").includes("return=representation") ? out(rows) : new Response(null, { status: 204 }); }
    if (method === "POST") {
      const list = (Array.isArray(body) ? body : [body]) as Row[];
      const kc = KEY_COL[table] ?? "id";
      const inserted: Row[] = [];
      for (const b of list) {
        const r: Row = { id: b.id ?? `row-${db[table].length + 1}`, created_at: "2026-09-27T09:00:00Z", updated_at: "2026-09-27T09:00:00Z", ...b };
        const i = db[table].findIndex((x) => x[kc] === r[kc] && r[kc] !== undefined);
        if (i >= 0) db[table][i] = r; else db[table].push(r);
        inserted.push(r);
      }
      return (headers.get("prefer") ?? "").includes("return=representation") ? out(inserted) : new Response(null, { status: 201 });
    }
    return new Response(null, { status: 204 });
  }
  if (url.host === "api.dropboxapi.com") { dropboxCalls.push(url.pathname); return url.pathname.includes("create_shared_link") ? j({ url: "https://www.dropbox.com/s/fake" }) : j({}); }
  return realFetch(input as RequestInfo, init);
}) as typeof fetch;
const ML = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
const origLoad = ML._load;
ML._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  if (/[\\/]require-auth(\.ts)?$/.test(request)) return { requireOwner: async () => null, requireAuth: async () => null, requireVictorAccess: async () => null, async getAuthRole() { return "owner"; }, async getAuthUser() { return { id: "u", email: "x@test" }; } };
  if (/[\\/]dropbox-token(\.ts)?$/.test(request)) return { getDropboxToken: async () => "fake-token" };
  if (/[\\/]steven-completion(\.ts)?$/.test(request)) return { __esModule: true, releaseStevenFinalFilesRequestFor: async () => {} };
  return origLoad.call(this, request, parent, isMain);
};
const reset = (seed: Record<string, Row[]> = {}) => { db = JSON.parse(JSON.stringify(seed)); writes.length = 0; dropboxCalls.length = 0; };
const json = (u: string, method: string, body: unknown) => new NextRequest(`https://app.test${u}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) } as ConstructorParameters<typeof NextRequest>[1]);
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const addDays = (ymd: string, n: number) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };

async function main() {
  const PD = await import("../lib/project-deadline");
  const { buildOwnerDigest, NOT_DEADLINE_CANDIDATE_STATUSES } = await import("../lib/push-digest-pure");
  const { checkOverdueProjects } = await import("../lib/agent/rules");
  const { COO_CONFIG } = await import("../lib/coo/config");

  // ═════ 1. overdue ═════
  section("1. overdue — one rule everywhere (strict date, Israel day, closed / on hold / hidden never)");
  const T = PD.israelTodayYmd();
  const Y = addDays(T, -1);
  const matrix: Array<{ id: string; deadline: string | null; status: string; hidden?: boolean; want: boolean }> = [
    { id: "active-passed", deadline: Y, status: "בעבודה", want: true },
    { id: "mix-passed", deadline: addDays(T, -40), status: "במיקס", want: true },
    { id: "completed", deadline: Y, status: "הושלם", want: false },
    { id: "cancelled", deadline: Y, status: "בוטל", want: false },
    { id: "on-hold", deadline: Y, status: "בהשהייה", want: false },
    { id: "hidden", deadline: Y, status: "בעבודה", hidden: true, want: false },
    { id: "unparseable", deadline: "26/09/2026", status: "בעבודה", want: false },
    { id: "impossible-date", deadline: "2026-02-30", status: "בעבודה", want: false },
    { id: "timestamp", deadline: `${Y}T10:00:00Z`, status: "בעבודה", want: false },
    { id: "today", deadline: T, status: "בעבודה", want: false },
    { id: "future", deadline: addDays(T, 3), status: "בעבודה", want: false },
    { id: "none", deadline: null, status: "בעבודה", want: false },
  ];
  const expected = matrix.filter((m) => m.want).map((m) => m.id).sort();
  const viaHelper = matrix.filter((m) => PD.isProjectOverdue({ deadline: m.deadline, status: m.status, isHidden: m.hidden }, T)).map((m) => m.id).sort();
  eq("isProjectOverdue matrix", viaHelper, expected);
  const digest = buildOwnerDigest({ today: T, hour: 9, projects: matrix.map((m) => ({ id: m.id, name: m.id, status: m.status, deadline: m.deadline, is_hidden: m.hidden ?? false })), sessions: [], overdueIncome: [], withSummary: false });
  eq("push digest overdue = the same set", digest.overdue.map((p) => p.id).sort(), expected);
  ok("push digest: an unparseable / hidden / closed project is never due-soon either", !digest.soon.some((p) => ["unparseable", "hidden", "completed", "cancelled", "on-hold", "timestamp"].includes(p.id)));
  const agentIds = (() => {
    const alerts = checkOverdueProjects(matrix.filter((m) => !m.hidden).map((m) => ({ id: m.id, name: m.id, artist: "", status: m.status, deadline: m.deadline })));
    return alerts.flatMap((a) => (a.relatedProjectId ? [a.relatedProjectId] : ((a.metadata as { projectIds?: string[] } | undefined)?.projectIds ?? []))).sort();
  })();
  eq("agent rules (hidden filtered by the caller) = the same set", agentIds, expected);
  eq("the push digest's closed set IS the shared set", [...NOT_DEADLINE_CANDIDATE_STATUSES], [...PD.NOT_OVERDUE_STATUSES]);
  eq("the COO inactive set IS the shared set", [...COO_CONFIG.inactiveProjectStatuses].sort(), [...PD.NOT_OVERDUE_STATUSES].sort());
  ok("parse issue surfaced for a non-date deadline (and not for a real one / empty)", PD.deadlineParseIssue("26/09/2026") && PD.deadlineParseIssue("2026-02-30") && !PD.deadlineParseIssue(Y) && !PD.deadlineParseIssue(null) && !PD.deadlineParseIssue(""));
  // Israel-day boundary: 00:30 in Israel on 2026-09-27 is still 2026-09-26 in UTC
  const lateNight = new Date("2026-09-26T21:30:00Z");
  eq("Israel day at 00:30 IDT is the NEW day (UTC is still the 26th)", [PD.israelTodayYmd(lateNight), lateNight.toISOString().slice(0, 10)], ["2026-09-27", "2026-09-26"]);
  ok("a 2026-09-26 deadline is overdue at 00:30 Israel time (the UTC day would say not yet)", PD.isProjectOverdue({ deadline: "2026-09-26", status: "בעבודה" }, PD.israelTodayYmd(lateNight)));
  ok("…and not overdue at 23:30 Israel time on the 26th", !PD.isProjectOverdue({ deadline: "2026-09-26", status: "בעבודה" }, PD.israelTodayYmd(new Date("2026-09-26T20:30:00Z"))));
  eq("daysUntilProjectDeadline is Israel-day based and null for an unparseable date", [PD.daysUntilProjectDeadline("2026-09-30", "2026-09-27"), PD.daysUntilProjectDeadline("30/09", "2026-09-27")], [3, null]);

  const readers: Array<[string, RegExp]> = [
    ["lib/projects-store.ts", /isOverdue:\s+isProjectOverdue\(\{ deadline: db\.deadline, status: db\.status, isHidden/],
    ["components/ProjectsProvider.tsx", /next\.isOverdue = isProjectOverdue\(/],
    ["components/projects/ProjectsTable.tsx", /isProjectOverdue\(p\)/],
    ["components/dashboard/ProjectSection.tsx", /isProjectOverdue\(p\)/],
    ["components/dashboard/DailyHeader.tsx", /isProjectOverdue\(p\)/],
    ["components/projects/ProjectsDesignPreview.tsx", /isProjectOverdue\(p\)/],
    ["components/dashboard/StatsGrid.tsx", /isProjectOverdue\(p\)/],
    ["components/dashboard/DashboardDesignPreview.tsx", /isProjectOverdue\(p\)/],
    ["app/dashboard/DashboardContent.tsx", /isProjectOverdue\(p\)/],
    ["lib/reports/data.ts", /isOverdue: isProjectOverdue\(p, todayIL\)/],
    ["lib/reports/weekly.ts", /isProjectOverdue\(p\)/],
    ["lib/agent/snapshot.ts", /isProjectOverdue\(p\)/],
    ["lib/health.ts", /isProjectOverdue\(p\)/],
    ["lib/push-digest-pure.ts", /isProjectOverdue\(\{ deadline: p\.deadline, status: p\.status, isHidden: p\.is_hidden \}, today\)/],
    ["lib/partner/projects/view.ts", /isProjectOverdue\(\{ deadline: identity\.deadline, status, isHidden: identity\.hidden \}, today\)/],
    ["lib/partner/sunny/operating.ts", /isProjectOverdue\(\{ deadline: dl, status: id\.status, isHidden: id\.hidden \}, today\)/],
  ];
  for (const [f, re] of readers) ok(`${f} uses THE rule`, re.test(read(f)));
  const stale = ["components/projects/ProjectsTable.tsx", "components/dashboard/ProjectSection.tsx", "components/dashboard/DailyHeader.tsx", "components/projects/ProjectsDesignPreview.tsx", "components/dashboard/StatsGrid.tsx", "components/dashboard/DashboardDesignPreview.tsx", "app/dashboard/DashboardContent.tsx", "lib/reports/data.ts", "lib/reports/weekly.ts", "lib/agent/snapshot.ts", "components/insights/InsightsPage.tsx", "components/project/ProjectDetail.tsx"]
    .filter((f) => /\.isOverdue && \w+\.status !== "הושלם"/.test(read(f)));
  eq("no reader keeps the old 'isOverdue && status !== הושלם' rule", stale, []);
  ok("Sunny operating: on-hold / hidden / unparseable are their own classes (never PASSED_NEW_FAILURE)", /deadlineClass = "ON_HOLD"/.test(read("lib/partner/sunny/operating.ts")) && /deadlineClass = "HIDDEN"/.test(read("lib/partner/sunny/operating.ts")) && /deadlineClass = "UNPARSEABLE_DEADLINE"/.test(read("lib/partner/sunny/operating.ts")));
  ok("Sunny project view surfaces an unparseable deadline (DEADLINE_UNPARSEABLE) and maps it in the attention map", /DEADLINE_UNPARSEABLE/.test(read("lib/partner/projects/view.ts")) && /DEADLINE_UNPARSEABLE:/.test(read("lib/partner/system/company.ts")));

  // ═════ 2. end_date ═════
  section("2. end_date — only on a real transition into הושלם");
  const WP = await import("../lib/writes/projects");
  eq("בעבודה → הושלם stamps today", WP.statusPatch("הושלם", { status: "בעבודה", endDate: null }, "2026-09-27"), { status: "הושלם", end_date: "2026-09-27" });
  eq("re-saving הושלם keeps the existing end date (no end_date key)", WP.statusPatch("הושלם", { status: "הושלם", endDate: "2026-09-01" }, "2026-09-27"), { status: "הושלם" });
  eq("הושלם without a stored end date gets one", WP.statusPatch("הושלם", { status: "הושלם", endDate: null }, "2026-09-27"), { status: "הושלם", end_date: "2026-09-27" });
  eq("any other status clears it", WP.statusPatch("בעבודה", { status: "הושלם", endDate: "2026-09-01" }, "2026-09-27"), { status: "בעבודה", end_date: null });
  eq("unknown current = a transition", WP.statusPatch("הושלם", null, "2026-09-27"), { status: "הושלם", end_date: "2026-09-27" });
  const route = read("app/api/projects/[id]/route.ts");
  ok("projects route: the field PATCH pre-reads the project and applies end_date only when the patch carries it", /const sp = statusPatch\(value, current \? \{ status: current\.status, endDate: current\.endDate \} : null\);/.test(route) && /if \("end_date" in sp\) patch\.end_date = sp\.end_date;/.test(route));
  ok("projects route: the full PATCH pre-reads the current status", /const currentForStatus = status !== undefined \? await getProject\(id\) : null;/.test(route) && /statusPatch\(status, currentForStatus/.test(route));
  ok("Sunny's status writer pre-reads too", /writeProjectStatus: async \(id, status\) => \{ const cur = await getProject\(id\); await updateProject\(id, W\.statusPatch\(status, cur/.test(read("lib/partner/act/server.ts")));
  reset({ projects: [{ id: "p1", name: "שיר", artist: "א", status: "הושלם", deadline: null, end_date: "2026-09-01", is_hidden: false, files: [] }] });
  const projRoute = await import("../app/api/projects/[id]/route");
  let res = await projRoute.PATCH(json("/api/projects/p1", "PATCH", { field: "status", value: "הושלם" }), ctx("p1"));
  ok("route re-save of הושלם keeps end_date 2026-09-01", res.status === 200 && db.projects[0].end_date === "2026-09-01", { status: res.status, row: db.projects[0] });
  reset({ projects: [{ id: "p1", name: "שיר", artist: "א", status: "בעבודה", deadline: null, end_date: null, is_hidden: false, files: [] }] });
  res = await projRoute.PATCH(json("/api/projects/p1", "PATCH", { status: "הושלם" }), ctx("p1"));
  ok("route full PATCH בעבודה → הושלם stamps an end date", res.status === 200 && typeof db.projects[0].end_date === "string" && PD.isStrictYmd(db.projects[0].end_date), db.projects[0]);

  // ═════ 3. Victor projectToo ═════
  section("3. Victor 'projectToo' — the server rule refuses protected / completed projects");
  eq("decision matrix", [WP.completionDecision(null), WP.completionDecision({ status: "בוטל" }), WP.completionDecision({ status: "בהשהייה" }), WP.completionDecision({ status: "הושלם" }), WP.completionDecision({ status: "במיקס" })],
    [{ allowed: false, refused: "NOT_FOUND" }, { allowed: false, refused: "PROTECTED_STATUS" }, { allowed: false, refused: "PROTECTED_STATUS" }, { allowed: false, refused: "ALREADY_COMPLETED" }, { allowed: true }]);
  const { PROJECT_PROTECTED_STATUSES } = await import("../lib/steven-completed-pure");
  eq("the protected set IS the Steven-completion set", [...WP.COMPLETION_PROTECTED_STATUSES], [...PROJECT_PROTECTED_STATUSES]);
  for (const st of ["בוטל", "בהשהייה", "הושלם"]) {
    reset({ projects: [{ id: "p2", name: "שיר", artist: "א", status: st, deadline: null, end_date: st === "הושלם" ? "2026-09-01" : null, is_hidden: false, files: [] }] });
    const r = await projRoute.PATCH(json("/api/projects/p2", "PATCH", { field: "status", value: "הושלם", completeIfAllowed: true }), ctx("p2"));
    const b = await r.json();
    ok(`completeIfAllowed on ${st} → 409 refused, nothing written`, r.status === 409 && b.ok === false && writes.filter((w) => w.table === "projects").length === 0 && db.projects[0].status === st, { status: r.status, b, writes });
  }
  reset({ projects: [{ id: "p3", name: "שיר", artist: "א", status: "במיקס", deadline: null, end_date: null, is_hidden: false, files: [] }] });
  res = await projRoute.PATCH(json("/api/projects/p3", "PATCH", { field: "status", value: "הושלם", completeIfAllowed: true }), ctx("p3"));
  ok("completeIfAllowed on an open project completes it with an end date", res.status === 200 && db.projects[0].status === "הושלם" && PD.isStrictYmd(db.projects[0].end_date), db.projects[0]);
  const vp = read("components/team/VictorProfilePage.tsx");
  ok("Victor page sends completeIfAllowed and surfaces a refusal to the Owner (never console.warn only)", /completeIfAllowed: true/.test(vp) && /window\.alert\(`העבודה סומנה כהושלמה, אבל הפרויקט לא עודכן/.test(vp) && !/console\.warn\(`\[WorkStatusDropdown\] עדכון פרויקט נכשל/.test(vp));
  ok("the Owner confirm dialog is still explicit (projectToo only from the confirm)", /setShowConfirm\(true\)/.test(vp) && /doUpdateWork\(projectToo: boolean\)/.test(vp));

  // ═════ 4. releases ═════
  section("4. releases — released_at = first released at");
  const RS = await import("../lib/release-store");
  reset({ project_release_details: [{ project_id: "r1", label_artist_id: "a1", release_stage: "יצא", release_target_date: null, next_action: "", blocker: "", responsible: "", stage_entered_at: "2026-09-01T10:00:00Z", released_at: "2026-09-01T10:00:00Z", created_at: "2026-08-01T00:00:00Z", updated_at: "U1" }] });
  const up = await RS.updateReleaseDetails("r1", "U1", { releaseStage: "מוכן ליציאה" });
  const patchBody = writes.find((w) => w.table === "project_release_details" && w.method === "PATCH")?.body as Row | undefined;
  ok("restage out of יצא never clears released_at", up.status === "ok" && !!patchBody && !("released_at" in patchBody) && db.project_release_details[0].released_at === "2026-09-01T10:00:00Z", { up, patchBody });
  reset({ projects: [{ id: "r2", project_type: "שיר", project_business_type: "לקוח", artist: "שליו" }], label_artists: [{ id: "a1", name: "שליו" }], project_release_details: [] });
  const conv = await RS.convertProjectToLabelRelease("r2", "a1", { releaseStage: "יצא" });
  const ins = writes.find((w) => w.table === "project_release_details" && w.method === "POST")?.body as Row | undefined;
  ok("a release created directly as יצא is stamped released_at", conv.status === "ok" && typeof ins?.released_at === "string", { conv, ins });
  reset({ projects: [{ id: "r3", project_type: "שיר", project_business_type: "לקוח", artist: "שליו" }], label_artists: [{ id: "a1", name: "שליו" }], project_release_details: [] });
  await RS.convertProjectToLabelRelease("r3", "a1", { releaseStage: "רעיון" });
  ok("…and a non-released create is not", !("released_at" in ((writes.find((w) => w.table === "project_release_details" && w.method === "POST")?.body as Row) ?? {})));
  const rs = read("lib/release-store.ts");
  ok("the RPC create path stamps released_at in an app follow-up when the stage is יצא (RPC unchanged)", /if \(\(fields\.releaseStage \?\? "רעיון"\) === "יצא"\)/.test(rs) && /\.is\("released_at", null\)/.test(rs) && !/else if \(newStage !== "יצא"\) set\.released_at = null/.test(rs));
  ok("Sunny label view counts released by STAGE (a released row without a date = UNKNOWN_DATE, still counted)", /const releasedRows = releaseRows\.filter\(\(r\) => r\.stage === "יצא"\)/.test(read("lib/partner/label/view.ts")) && /releasedCount: releasedRows\.length, releasedUnknownDate/.test(read("lib/partner/label/view.ts")));
  const cv = read("lib/partner/company/view.ts");
  ok("company view current state by stage (upcoming / target passed / released last 90)", /upcoming: releases\.filter\(\(r\) => r\.stage !== "יצא"/.test(cv) && /targetPassed: releases\.filter\(\(r\) => r\.stage !== "יצא"/.test(cv) && /releasedLast90: releases\.filter\(\(r\) => r\.stage === "יצא" && r\.releasedAt/.test(cv) && /released: a\.cadence\.releasedCount/.test(cv));
  ok("project view + operating model: 'not released' = stage ≠ יצא", /release\.stage !== "יצא"\) signals\.push/.test(read("lib/partner/projects/view.ts")) && /releasesPlanned: releases\.filter\(\(r\) => r\.stage !== "יצא"\)/.test(read("lib/partner/sunny/operating.ts")));
  ok("Label page: days since the last release from released rows' released_at", /r\.release\.releaseStage === "יצא" && r\.release\.releasedAt/.test(read("components/label/LabelPage.tsx")));

  // ═════ 5. social ═════
  section("5. social — one phase vocabulary (published never overdue, ready_to_post is ready)");
  const TY = await import("../lib/types");
  const { checkMissing } = await import("../lib/social-missing-checker");
  eq("phases cover both vocabularies", ["draft", "idea", "in_progress", "in_edit", "ready_to_post", "scheduled", "published", "posted", "cancelled", "weird"].map((s) => TY.socialPhaseOf(s)), ["IDEA", "IDEA", "WORK", "WORK", "READY", "READY", "PUBLISHED", "PUBLISHED", "CANCELLED", "UNKNOWN"]);
  eq("every status is in exactly one phase", TY.SOCIAL_CONTENT_STATUSES.filter((s) => [TY.SOCIAL_PHASE_IDEA, TY.SOCIAL_PHASE_WORK, TY.SOCIAL_PHASE_READY, TY.SOCIAL_PHASE_PUBLISHED, TY.SOCIAL_PHASE_CANCELLED].filter((set) => set.includes(s)).length !== 1), []);
  const past = "2026-09-01", today = "2026-09-27";
  const camp = { id: "c", status: "active", release_date: null } as unknown as Parameters<typeof checkMissing>[0];
  const item = (status: string, extra: Row = {}) => ({ id: status, status, content_type: "טיזר", due_date: past, asset_link: "x", dropbox_link: "", ...extra }) as unknown as Parameters<typeof checkMissing>[1][number];
  const labels = (items: Parameters<typeof checkMissing>[1]) => checkMissing(camp, items, today).map((m) => m.label);
  ok("a published (new vocabulary) item past its due date is NOT overdue", !labels([item("published"), item("ready_to_post", { due_date: null })]).some((l) => /עבר תאריך יעד/.test(l)));
  ok("a posted (legacy) item is not overdue either", !labels([item("posted"), item("ready", { due_date: null })]).some((l) => /עבר תאריך יעד/.test(l)));
  ok("an idea past its due date IS overdue", labels([item("draft")]).some((l) => /1 תוכן שעבר תאריך יעד/.test(l)));
  ok("ready_to_post counts as ready (no 'אין תוכן מוכן להעלאה')", !labels([item("ready_to_post")]).some((l) => /אין תוכן מוכן להעלאה/.test(l)));
  ok("…and a ready_to_post item without an asset is flagged like a legacy ready one", labels([item("ready_to_post", { asset_link: "" })]).some((l) => /תוכן מוכן ללא קישור קובץ/.test(l)));
  eq("isSocialItemOverdue agrees", [TY.isSocialItemOverdue({ status: "published", due_date: past }, today), TY.isSocialItemOverdue({ status: "ready_to_post", due_date: past }, today), TY.isSocialItemOverdue({ status: "cancelled", due_date: past }, today), TY.isSocialItemOverdue({ status: "draft", due_date: "bad" }, today)], [false, true, false, false]);
  const wv = read("lib/partner/work/view.ts");
  ok("Sunny social view uses the SAME phases + the checker with Sunny's today", /overdue: its\.filter\(\(i\) => isSocialItemOverdue\(\{ status: i\.status, due_date: i\.dueDate \}, c\.today\)\)/.test(wv) && /checkMissing\(asCampaign, asItems, c\.today\)/.test(wv) && /byPhase: count/.test(wv));
  ok("social screens use the shared phase sets", /new Set<string>\(SOCIAL_PHASE_READY\)/.test(read("components/social/SocialDesignPreview.tsx")) && /new Set<string>\(SOCIAL_PHASE_READY\)/.test(read("components/social/SocialHubPreview.tsx")));

  // ═════ 6. delivery ═════
  section("6. delivery — status ⇔ date; the delivery fact survives");
  const DV = await import("../lib/writes/delivery");
  eq("delivered without a date → today (never delivered without a date)", DV.nextDeliveryRecord({ folderPath: "/x", deliveryStatus: "ready", deliveredAt: null }, { deliveryStatus: "delivered" }, "2026-09-27"), { folderPath: "/x", deliveryStatus: "delivered", deliveredAt: "2026-09-27", lastDeliveredAt: "2026-09-27" });
  eq("delivered with a date keeps it", DV.nextDeliveryRecord({ deliveryStatus: "ready" }, { deliveryStatus: "delivered", deliveredAt: "2026-09-20" }, "2026-09-27").deliveredAt, "2026-09-20");
  eq("back to ready clears deliveredAt but keeps lastDeliveredAt", DV.nextDeliveryRecord({ folderPath: "/x", deliveryStatus: "delivered", deliveredAt: "2026-09-20", lastDeliveredAt: "2026-09-20" }, { deliveryStatus: "ready" }, "2026-09-27"), { folderPath: "/x", deliveryStatus: "ready", deliveredAt: null, lastDeliveredAt: "2026-09-20" });
  eq("a legacy delivered record without lastDeliveredAt still keeps its date as history", DV.nextDeliveryRecord({ deliveryStatus: "delivered", deliveredAt: "2026-08-01" }, { deliveryStatus: "ready" }, "2026-09-27").lastDeliveredAt, "2026-08-01");
  let threw = ""; try { DV.nextDeliveryRecord({ deliveryStatus: "ready" }, { deliveredAt: "2026-09-20" }, "2026-09-27"); } catch (e) { threw = String((e as Error).message); }
  ok("a delivered date on a non-delivered record is refused", /נמסר/.test(threw), threw);
  reset({ settings: [{ key: "delivery_p9", value: { folderPath: "/Projects/a/b/Delivery", deliveryLink: "https://www.dropbox.com/s/l", deliveryStatus: "delivered", deliveredAt: "2026-09-20", lastDeliveredAt: "2026-09-20" } }] });
  await DV.deleteDeliveryFolder("p9");
  eq("folder delete → not_created for the drawer, lastDeliveredAt kept", db.settings.find((r) => r.key === "delivery_p9")?.value, { deliveryStatus: "not_created", lastDeliveredAt: "2026-09-20" });
  reset({ settings: [{ key: "delivery_p8", value: { deliveryStatus: "not_created", lastDeliveredAt: "2026-09-20" } }], projects: [{ id: "p8", name: "שיר", artist: "א", status: "הושלם", dropbox_folder: null, is_hidden: false, files: [] }] });
  await DV.createDeliveryFolder("p8", "א", "שיר");
  const created = db.settings.find((r) => r.key === "delivery_p8")?.value as Row;
  ok("re-creating the folder keeps lastDeliveredAt (status ready, no current date)", created?.deliveryStatus === "ready" && created?.deliveredAt === null && created?.lastDeliveredAt === "2026-09-20", created);
  reset({ settings: [{ key: "delivery_p7", value: { folderPath: "/x", deliveryStatus: "ready", deliveredAt: null } }] });
  await DV.setDeliveryStatus("p7", { deliveryStatus: "delivered" });
  const set7 = db.settings.find((r) => r.key === "delivery_p7")?.value as Row;
  ok("setDeliveryStatus delivered (no date) stamps today in Israel", set7?.deliveryStatus === "delivered" && set7?.deliveredAt === PD.israelTodayYmd() && set7?.lastDeliveredAt === PD.israelTodayYmd(), set7);
  ok("Sunny delivery: DELIVERY_RECORDED only from status delivered; lastDeliveredAt = DELIVERED_BEFORE history", /d\?\.status === "delivered" \? "DELIVERY_RECORDED" : d\?\.lastDeliveredAt \? "DELIVERED_BEFORE"/.test(wv) && /deliveredAt: d\.status === "delivered" \? d\.deliveredAt : null, lastDeliveredAt/.test(wv));
  ok("Sunny delivery: requestOpen = computeFinalFilesFlags (never 'a request row exists')", /requestOpen: requestOpenOf\(id\)/.test(wv) && /computeFinalFilesFlags\(\[\{ id: `project:\$\{projectId\}`, projectId \}\]/.test(wv) && !/requestOpen: requests\.some/.test(wv));
  const { computeFinalFilesFlags } = await import("../lib/steven-completed-pure");
  const flags = (fileAt: string | null) => computeFinalFilesFlags([{ id: "project:P", projectId: "P" }], { finalRows: fileAt ? [{ project_id: "P", created_at: fileAt }] : [], requestRows: [{ key: "steven_final_files_requested_project:P", value: { at: "2026-09-20T10:00:00Z" } }] });
  const open = (f: ReturnType<typeof flags>) => f.finalFilesRequested.has("project:P") && !f.hasCurrentFinalFiles.has("project:P");
  eq("request open: no file / a file BEFORE the request → open; a file after → satisfied", [open(flags(null)), open(flags("2026-09-19T10:00:00Z")), open(flags("2026-09-21T10:00:00Z"))], [true, true, false]);
  ok("agent completed_no_delivery reads the delivery record (not projects.files)", /deliveries: ReadonlyMap<string, \{ deliveryStatus\?: string; folderPath\?: string; lastDeliveredAt\?: string \}>/.test(read("lib/agent/rules.ts")) && /checkCompletedNoDelivery\(projects, deliveryMap\)/.test(read("app/api/agent/check/route.ts")));

  // ═════ 7. Victor salary ═════
  section("7. Victor salary — Finance precedence, Owner statement, duplicates");
  const VS = await import("../lib/victor-salary-format");
  const base = { dueDate: "2026-07-10", todayYmd: "2026-09-27", defaultAmount: 550, defaultCurrency: "$" };
  const r1 = VS.resolveSalaryMonth({ ...base, amountOverride: 500, statusOverride: "שולם", txs: [{ id: "t1", paymentStatus: "צפוי", amount: 550, currency: "$" }] });
  ok("a live Finance row decides (not paid, 550) and the disagreeing Owner statement is a conflict", r1.status === "נשלח לכספים" && r1.amount === 550 && r1.source === "FINANCE" && r1.conflict?.kind === "OWNER_STATEMENT_DISAGREES" && r1.conflict.owner?.amount === 500, r1);
  const r2 = VS.resolveSalaryMonth({ ...base, amountOverride: 500, statusOverride: "שולם", txs: [] });
  ok("no live row → the Owner statement fills the month (no conflict)", r2.status === "שולם" && r2.amount === 500 && r2.source === "OWNER_STATEMENT" && r2.conflict === null, r2);
  const r3 = VS.resolveSalaryMonth({ ...base, txs: [{ id: "tb", paymentStatus: "שולם", amount: 550, currency: "$" }, { id: "ta", paymentStatus: "צפוי", amount: 550, currency: "$" }] });
  ok("two live rows → a DUPLICATE conflict, never claimed paid, deterministic row", r3.conflict?.kind === "DUPLICATE_FINANCE_ROWS" && r3.conflict.finance.length === 2 && r3.status !== "שולם" && r3.transactionId === "ta", r3);
  const r4 = VS.resolveSalaryMonth({ ...base, txs: [{ id: "tc", paymentStatus: "בוטל", amount: 550, currency: "$" }] });
  ok("a cancelled row is not live (due passed → לא שולם, the row id kept for reuse)", r4.status === "לא שולם" && r4.transactionId === "tc" && r4.source === "CONFIGURED_DEFAULT", r4);
  const r5 = VS.resolveSalaryMonth({ ...base, txs: [{ id: "td", paymentStatus: "שולם", amount: 1800, currency: "₪" }] });
  ok("the month currency + amount come from the Finance row", r5.currency === "₪" && r5.amount === 1800 && r5.status === "שולם", r5);
  ok("התקבל on an expense is never paid", VS.resolveSalaryMonth({ ...base, txs: [{ id: "te", paymentStatus: "התקבל", amount: 550, currency: "$" }] }).status !== "שולם");
  reset({
    settings: [{ key: "vendor_victor_settings", value: { monthlySalary: 550, salaryCurrency: "$" } }, { key: "vendor_victor_salary_overrides", value: { "2026-06": 500 } }, { key: "vendor_victor_salary_status_overrides", value: { "2026-05": "שולם" } }],
    transactions: [
      { id: "x1", linked_session_id: "victor_salary_2026-06", payment_status: "צפוי", amount: 550, currency: "$" },
      { id: "x2", linked_session_id: "victor_salary_2026-07", payment_status: "שולם", amount: 550, currency: "$" },
      { id: "x3", linked_session_id: "victor_salary_2026-07", payment_status: "צפוי", amount: 550, currency: "$" },
    ],
  });
  const { getVictorSalaryMonths } = await import("../lib/vendor-store");
  const months = await getVictorSalaryMonths(2026);
  const m = (k: string) => months.find((x) => x.workMonth === k)!;
  ok("store: May (no Finance row) = the Owner statement", m("2026-05").status === "שולם" && m("2026-05").source === "OWNER_STATEMENT" && !m("2026-05").conflict, m("2026-05"));
  ok("store: June = Finance (550, not paid) + conflict with the 500 override", m("2026-06").amount === 550 && m("2026-06").status === "נשלח לכספים" && m("2026-06").conflict?.kind === "OWNER_STATEMENT_DISAGREES", m("2026-06"));
  ok("store: July = duplicate conflict (not silently the last row)", m("2026-07").conflict?.kind === "DUPLICATE_FINANCE_ROWS" && m("2026-07").status !== "שולם", m("2026-07"));
  const vd = read("components/team/VictorDrawer.tsx");
  ok("Victor drawer: totals per currency + conflicts shown (Finance + הצהרת בעלים)", /const byCurrency = \(rows: typeof salaryMonths\)/.test(vd) && /fmtTotals\(paidTotal\)/.test(vd) && /הצהרת בעלים/.test(vd) && /DUPLICATE_FINANCE_ROWS/.test(vd));
  ok("Sunny Victor money: an override without a live row is not a conflict; texts state Finance precedence", /status override says paid, the live finance row is not paid \(Finance decides\)/.test(read("lib/partner/victor/view.ts")) && /Precedence \(B5\)/.test(read("lib/partner/victor/view.ts")));

  // ═════ 8. send log ═════
  section("8. send log — a pending entry answered later is history");
  const SL = await import("../lib/partner/work/send-log");
  const pv = { status: "pending_version", actionDate: "2026-09-10" };
  eq("pending_version + a later upload → SUPERSEDED", SL.sendEntryCurrent(pv, { versionUploads: ["2026-09-12T08:00:00Z"] }).state, "SUPERSEDED");
  eq("…same Israel day → AMBIGUOUS (kept as evidence)", SL.sendEntryCurrent(pv, { versionUploads: ["2026-09-10T08:00:00Z"] }).state, "AMBIGUOUS_SAME_DAY");
  eq("…an upload that is still the 9th in Israel (UTC) → CURRENT", SL.sendEntryCurrent(pv, { versionUploads: ["2026-09-09T20:00:00Z"] }).state, "CURRENT");
  eq("…23:30 UTC on the 9th = the 10th in Israel → AMBIGUOUS, not before", SL.sendEntryCurrent(pv, { versionUploads: ["2026-09-09T21:30:00Z"] }).state, "AMBIGUOUS_SAME_DAY");
  eq("pending_feedback + a later recorded response → SUPERSEDED", SL.sendEntryCurrent({ status: "pending_feedback", actionDate: "2026-09-10" }, { responses: ["2026-09-11T08:00:00Z"] }).state, "SUPERSEDED");
  eq("other statuses → NOT_PENDING", SL.sendEntryCurrent({ status: "got_notes", actionDate: "2026-09-10" }, {}).state, "NOT_PENDING");
  eq("evidence by recipient: engineer → mix versions, external producer → Victor uploads, client → none",
    [SL.evidenceFor({ status: "pending_version", actionDate: null, recipientRole: "sound_engineer" }, { mixVersionCreatedAt: ["m"], victorUploads: ["v"] }).versionUploads, SL.evidenceFor({ status: "pending_version", actionDate: null, recipientRole: "external_producer" }, { mixVersionCreatedAt: ["m"], victorUploads: ["v"] }).versionUploads, SL.evidenceFor({ status: "pending_version", actionDate: null, recipientRole: "client" }, { mixVersionCreatedAt: ["m"], victorUploads: ["v"] }).versionUploads],
    [["m"], ["v"], undefined]);
  ok("Victor view: a superseded entry is never the holder nor CONFLICTING_EVIDENCE", /const openLog = sendLog\.filter\(\(s\) => s\.status === "got_notes" \|\| isOpenSendState\(s\.current\)\)/.test(read("lib/partner/victor/view.ts")) && /openLog\.find\(\(s\) => s\.status === "pending_version"\)/.test(read("lib/partner/victor/view.ts")));
  const pvw = read("lib/partner/projects/view.ts");
  ok("project view: WAITING_VERSION is a DERIVED_SIGNAL only for non-superseded entries; counts exclude superseded", /liveActs\?\.some\(\(a\) => a\.status === "pending_version"\)\) signals\.push\(\{ code: "WAITING_VERSION", kind: "DERIVED_SIGNAL"/.test(pvw) && /waitingVersion: liveActs\.filter/.test(pvw) && /SEND_LOG_SUPERSEDED/.test(pvw) && /SEND_LOG_SUPERSEDED:/.test(read("lib/partner/system/company.ts")));
  ok("operating model: a superseded entry is not a ball holder", /sendEntryCurrent\(x, evidenceFor\(x, sendEvidence\)\)\.state !== "SUPERSEDED"/.test(read("lib/partner/sunny/operating.ts")));

  // ═════ 9. sections ═════
  section("9. project sections 'waiting' — engineer ball = the mix handoff rule");
  const sec = read("lib/partner/projects/sections.ts");
  ok("waitingOf uses engineerHandoff (never the status alone)", /const h = engineerHandoff\(c\.src, \{ id: w\.id, projectId: w\.projectId, engineerName: w\.engineerName, status: w\.status, sentDate: w\.sentDate \}\);/.test(sec) && !/waitingOn: w\.status === "חזר" \? "OWNER" : "ENGINEER"/.test(sec));
  ok("waitingOf drops superseded send-log entries", /if \(cur\.state === "SUPERSEDED"\) continue;/.test(sec));

  // ═════ 10. Steven ═════
  section("10. Steven — texts never claim the project completed; a paid new work has a date");
  const SC = await import("../lib/steven-completed-pure");
  const sp = SC.buildStevenPush("W1", "G Thang", "U0");
  const oc = SC.buildOwnerConfirmPush("W1", "G Thang");
  const sf = SC.buildOwnerProjectSyncFailedPush("W1", "G Thang");
  ok("Steven push: the JOB is completed (not 'Project completed')", sp.title === "Job completed" && !/project completed/i.test(sp.title + sp.body), sp);
  ok("Owner confirm: never 'הפרויקט … הושלם'; says the project was NOT marked", !/הפרויקט "G Thang" הושלם|הפרויקט הושלם/.test(oc.body) && /הפרויקט עצמו לא סומן כהושלם/.test(oc.body), oc);
  ok("sync-failed push = the project could not be READ", /לא ניתן היה לקרוא את הפרויקט/.test(sf.body) && sf.title === "קריאת הפרויקט נכשלה" && !/לעדכן את סטטוס הפרויקט/.test(sf.body), sf);
  ok("the bell text mapper knows the new titles (legacy rows keep theirs)", /title === "קריאת הפרויקט נכשלה"/.test(read("lib/owner-steven-notification-text.ts")) && /title !== "סנכרון הפרויקט נכשל"/.test(read("lib/owner-steven-notification-text.ts")));
  const sPage = read("components/team/StevenProfilePage.tsx");
  ok("Steven new-work modal sends paymentDate when created as paid", /paymentDate:      pay === "שולם" \? \(paidDate\.trim\(\) \|\| isoDay\(0\)\) : null/.test(sPage) && /focusTitle: "Job completed"/.test(sPage) && /focusTitle: "העבודה הושלמה"/.test(sPage));
  reset({ sound_engineer_work: [] });
  const seRoute = await import("../app/api/sound-engineer/route");
  let r = await seRoute.POST(json("/api/sound-engineer", "POST", { workTitle: "סינגל", engineerName: "Steven", status: "אושר", agreedPrice: 200, amountPaid: 200, paymentDate: "2026-09-20", skipFinanceSync: true }));
  let insRow = writes.find((w) => w.table === "sound_engineer_work" && w.method === "POST")?.body as Row | undefined;
  ok("POST /api/sound-engineer: a work created as paid stores its payment date", r.status === 200 && insRow?.payment_date === "2026-09-20" && insRow?.amount_paid === 200, { status: r.status, insRow });
  const { isEngineerWorkPaid } = await import("../lib/mix-payment-pure");
  ok("…so the shared paid rule sees it paid", isEngineerWorkPaid({ agreedPrice: 200, amountPaid: 200, paymentDate: String(insRow?.payment_date ?? "") || null }));
  reset({ sound_engineer_work: [] });
  r = await seRoute.POST(json("/api/sound-engineer", "POST", { workTitle: "סינגל", engineerName: "Steven", status: "אושר", agreedPrice: 200, amountPaid: 0, paymentDate: "2026-09-20", skipFinanceSync: true }));
  insRow = writes.find((w) => w.table === "sound_engineer_work" && w.method === "POST")?.body as Row | undefined;
  ok("…an unpaid work never stores a payment date", r.status === 200 && !("payment_date" in (insRow ?? {})), insRow);
  reset({ sound_engineer_work: [] });
  r = await seRoute.POST(json("/api/sound-engineer", "POST", { workTitle: "סינגל", engineerName: "Steven", agreedPrice: 200, amountPaid: 200, paymentDate: "20/09/2026" }));
  ok("…an invalid payment date is refused (400), nothing written", r.status === 400 && writes.length === 0, { status: r.status, writes });

  console.log(`\n${fail === 0 ? "✓ ALL PASS" : "✗ FAILURES"} — ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
