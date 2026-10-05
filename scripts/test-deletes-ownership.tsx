/**
 * Integrity fix A5 (2026-09-27) — deletes + Finance ownership, on an in-memory database (the REAL shared writers run
 * against a fake Supabase; Google / storage / Victor / tasks are stubs that only log). Proves:
 *   • project delete: final files on its mix works → BLOCKED with ZERO mutations; without blockers → ordered DB steps,
 *     a blocker re-check, the project row, THEN external effects (calendar / Google Tasks / cover file), reported;
 *   • the projects UI never drops a project before the server confirms (static);
 *   • Red Films permanent delete: HAS_PAYMENTS refuses with zero writes; a failing step stops before the productions
 *     (not claimed deleted); clipProductionId cleared only when equal (compare-and-swap);
 *   • promotion / campaign delete keeps the Finance transaction with an appended provenance marker (abort if the marker
 *     write fails); promotion spend = paid only, per currency;
 *   • Finance ownership: owned-row delete refused, amount change refused, fee status change allowed — one rule shared
 *     by the route and Sunny.
 * Run with:   npx tsx scripts/test-deletes-ownership.tsx      Pure; never touches production.
 */
import Module from "node:module";
import fs from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 600)}` : ""}`); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");

// ── in-memory Supabase ──────────────────────────────────────────────────────────────────────────────────────────────
type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
const log: string[] = [];                     // every mutation + external effect, in order
let failOn: { table: string; op: string } | null = null;
let casMissOnce = false;                      // simulate a concurrent change on the next settings CAS
const T = (t: string) => (db[t] ??= []);
const colVal = (r: Row, c: string): unknown => {
  const m = /^(\w+)->>(\w+)$/.exec(c);
  if (m) { const o = r[m[1]] as Row | null | undefined; return o && o[m[2]] !== undefined && o[m[2]] !== null ? String(o[m[2]]) : null; }
  return r[c];
};
function builder(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let op: "select" | "delete" | "update" | "insert" | "upsert" = "select";
  let patch: Row = {}; let rows: Row[] = []; let head = false; let count = false; let returning = false; let single: "one" | "maybe" | null = null;
  const q = {
    select(_c?: string, o?: { count?: string; head?: boolean }) { if (op === "select") { head = !!o?.head; count = !!o?.count; } else returning = true; return q; },
    eq(c: string, v: unknown) { filters.push((r) => (c === "value" && typeof v === "string" ? JSON.stringify(r.value) === v : colVal(r, c) === v)); return q; },
    in(c: string, vs: unknown[]) { filters.push((r) => vs.includes(colVal(r, c))); return q; },
    like(c: string, p: string) { const re = new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`); filters.push((r) => re.test(String(colVal(r, c) ?? ""))); return q; },
    not(c: string, _o: string, _v: null) { filters.push((r) => colVal(r, c) !== null && colVal(r, c) !== undefined); return q; },
    is(c: string, _v: null) { filters.push((r) => colVal(r, c) === null || colVal(r, c) === undefined); return q; },
    order() { return q; }, limit() { return q; },
    delete() { op = "delete"; return q; },
    update(p: Row) { op = "update"; patch = p; return q; },
    insert(r: Row | Row[]) { op = "insert"; rows = Array.isArray(r) ? r : [r]; return q; },
    upsert(r: Row | Row[]) { op = "upsert"; rows = Array.isArray(r) ? r : [r]; return q; },
    maybeSingle() { single = "maybe"; return q; }, single() { single = "one"; return q; },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve().then(run).then(res, rej); },
  };
  function run() {
    if (failOn && failOn.table === table && failOn.op === op) return { data: null, error: { message: `injected ${op} failure on ${table}` }, count: null };
    const match = T(table).filter((r) => filters.every((f) => f(r)));
    if (op === "select") {
      if (head) return { data: null, error: null, count: match.length };
      const data = match.map((r) => ({ ...r }));
      if (single) return { data: data[0] ?? null, error: single === "one" && !data.length ? { message: "no rows" } : null };
      return { data, error: null, count: count ? data.length : null };
    }
    if (op === "delete") { log.push(`db:delete:${table}`); db[table] = T(table).filter((r) => !match.includes(r)); return { data: returning ? match : null, error: null }; }
    if (op === "update") {
      if (table === "settings" && casMissOnce && filters.length > 1) { casMissOnce = false; log.push("db:update:settings(cas-miss)"); return { data: [], error: null }; }
      log.push(`db:update:${table}`); for (const r of match) Object.assign(r, patch);
      const data = match.map((r) => ({ ...r })); return { data: returning ? (single ? data[0] ?? null : data) : null, error: null };
    }
    log.push(`db:${op}:${table}`);
    for (const r of rows) { const row = { id: `new-${T(table).length + 1}`, ...r }; T(table).push(row); }
    return { data: single ? rows[0] : rows, error: null };
  }
  return q;
}
const fakeSupabase = { from: (t: string) => builder(t), rpc: async () => ({ data: null, error: { message: "no rpc" } }) };

// ── module stubs (externals only log) ───────────────────────────────────────────────────────────────────────────────
const ML = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
const orig = ML._load;
const stubs: Record<string, unknown> = {
  "server-only": {},
  "@/lib/google-calendar": { isConnected: async () => true, deleteCalendarEvent: async (id: string) => { log.push(`ext:calendar:${id}`); }, deleteGoogleTask: async (id: string) => { log.push(`ext:gtask:${id}`); } },
  "@/lib/writes/victor": { removeVictorWork: async (id: string) => { log.push(`db:victor:${id}`); db.vendor_project_work = T("vendor_project_work").filter((r) => r.id !== id); return { removedTask: true }; } },
  "@/lib/tasks-store": { listTasks: async (o: { related_id: string }) => T("tasks").filter((t) => t.related_type === "client" && t.related_id === o.related_id), deleteTask: async (id: string) => { log.push(`db:delete:tasks(${id})`); db.tasks = T("tasks").filter((t) => t.id !== id); } },
  "@/lib/project-cover-store": { deleteProjectCoverFile: async (id: string) => { log.push(`ext:cover:${id}`); return true; } },
  "@/lib/projects-store": { touchProject: async () => {}, deleteProject: async (id: string) => { const { error } = (await fakeSupabase.from("projects").delete().eq("id", id)) as { error: { message: string } | null }; if (error) throw new Error(error.message); } },
  "@/lib/dropbox-token": { getDropboxToken: async () => "tok" },
};
ML._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request in stubs) return stubs[request];
  if (/(^|\/)supabase$/.test(request)) return { supabase: fakeSupabase };
  return orig.call(this, request, parent, isMain);
};
let storageFail = false;
(globalThis as { fetch: unknown }).fetch = async (_u: string, init?: { body?: string }) => { const p = JSON.parse(String(init?.body ?? "{}")).path; log.push(`ext:storage:${p}`); return storageFail ? new Response("boom", { status: 500 }) : new Response("{}", { status: 200 }); };

const reset = (seed: Record<string, Row[]>) => { for (const k of Object.keys(db)) delete db[k]; for (const [k, v] of Object.entries(seed)) db[k] = v.map((r) => ({ ...r })); log.length = 0; failOn = null; casMissOnce = false; storageFail = false; };
const mutations = () => log.filter((l) => l.startsWith("db:") || l.startsWith("ext:"));

(async () => {
  const PD = await import("../lib/writes/project-delete");
  const RF = await import("../lib/writes/redfilms");
  const PROMO = await import("../lib/social-promotions-store");
  const SOC = await import("../lib/social-store");
  const OWN = await import("../lib/finance/ownership");
  // the writers load their integrations lazily through an IO table — point it at the logging stubs
  const io = <T,>(k: string) => (async () => stubs[k]) as unknown as T;
  Object.assign(PD.PROJECT_DELETE_IO, { victor: io("@/lib/writes/victor"), tasks: io("@/lib/tasks-store"), google: io("@/lib/google-calendar"), cover: io("@/lib/project-cover-store"), projects: io("@/lib/projects-store") });
  Object.assign(RF.RF_DELETE_IO, { dropbox: io("@/lib/dropbox-token"), google: io("@/lib/google-calendar") });

  // ── 1. project delete ──────────────────────────────────────────────────────────────────────────────────────────
  console.log("Project delete — preflight first");
  const P = "p1";
  const projectSeed = (withFinalFiles: boolean): Record<string, Row[]> => ({
    projects: [{ id: P, name: "קרוב אלייך", dropbox_folder: "/Projects/x" }],
    sessions: [{ id: "s1", project_id: P, calendar_event_id: "ev1" }, { id: "s2", project_id: P, calendar_event_id: null }],
    project_actions: [{ id: "a1", project_id: P }], clip_items: [{ id: "c1", project_id: P }],
    vendor_project_work: [{ id: "v1", project_id: P }],
    sound_engineer_work: [{ id: "w1", project_id: P }],
    final_files: withFinalFiles ? [{ id: "f1", work_id: "w1", project_id: P }, { id: "f2", work_id: "w1", project_id: P }] : [{ id: "f3", work_id: null, project_id: P }],
    mix_versions: [{ id: "mv1", sound_engineer_work_id: "w1" }], mix_comments: [{ id: "mc1", mix_version_id: "mv1" }], mix_comment_attachments: [],
    settings: [{ key: `finance_${P}`, value: { agreedPrice: 1 } }, { key: `project_cover_${P}`, value: { theme: "x", customImage: true } }, { key: `session_limit_${P}`, value: 3 }, { key: `album_prev_info_${P}`, value: {} }, { key: "steven_final_files_requested:w1", value: true }, { key: "unrelated", value: 1 }],
    transactions: [{ id: "t1", project_id: P, linked_session_id: "s1" }, { id: "t2", project_id: "other" }],
    proposals: [{ id: "pr1", linked_project_id: P, client_id: "cl1" }],
    tasks: [{ id: "tk1", related_type: "client", related_id: "cl1", notes: "[proposal_id:pr1]", calendar_event_id: "gt1" }, { id: "tk2", related_type: "project", related_id: P }],
    album_tracks: [], project_release_details: [], social_campaigns: [{ id: "sc1", project_id: P }], meetings: [], red_films_productions: [{ id: "rf1", project_id: P }],
  });
  reset(projectSeed(true));
  const pre = await PD.projectDeletePreflight(P);
  ok("1. preflight is read-only and reports the FINAL_FILES blocker with a Hebrew explanation", mutations().length === 0 && pre.blockers.length === 1 && pre.blockers[0].code === "FINAL_FILES" && pre.blockers[0].count === 2 && /קבצים סופיים/.test(pre.blockers[0].messageHe), pre);
  let blockedErr: unknown = null;
  try { await PD.deleteProjectCompletely(P); } catch (e) { blockedErr = e; }
  ok("2. project with final files → BLOCKED (ProjectDeleteBlockedError, BLOCKED_BY_DEPENDENTS) and ZERO mutations — no writer / external call happened", blockedErr instanceof PD.ProjectDeleteBlockedError && (blockedErr as { code: string }).code === "BLOCKED_BY_DEPENDENTS" && mutations().length === 0 && T("projects").length === 1 && T("sessions").length === 2, { log });

  reset(projectSeed(false));
  const pre2 = await PD.projectDeletePreflight(P);
  ok("3. the preflight discloses every dependent count", pre2.blockers.length === 0 && pre2.counts.sessions === 2 && pre2.counts.calendarEvents === 1 && pre2.counts.engineerWorks === 1 && pre2.counts.mixVersions === 1 && pre2.counts.mixComments === 1 && pre2.counts.settingsKeys === 5 && pre2.counts.coverCustomImage === 1 && pre2.counts.transactionsUnlinked === 1 && pre2.counts.sessionLinkedTransactions === 1 && pre2.counts.socialCampaignsUnlinked === 1 && pre2.counts.finalFilesUnlinked === 1 && pre2.counts.productionsKept === 1 && pre2.counts.storageFolderKept === 1 && pre2.counts.tasksKept === 1, pre2.counts);
  const res = await PD.deleteProjectCompletely(P);
  const L = mutations();
  const idx = (x: string) => L.indexOf(x);
  const lastDb = Math.max(...L.map((l, i) => (l.startsWith("db:") ? i : -1)));
  const firstExt = L.findIndex((l) => l.startsWith("ext:"));
  ok("4. without blockers: ordered DB steps (sessions → send log → clip rows → Victor → settings → transactions → proposals; Agent Alerts retired 2026-10-05 — nothing to soft-close) and the project row LAST in the DB", idx("db:delete:sessions") < idx("db:delete:project_actions") && idx("db:delete:project_actions") < idx("db:delete:clip_items") && idx("db:delete:clip_items") < idx("db:victor:v1") && idx("db:victor:v1") < idx("db:delete:settings") && idx("db:delete:settings") < idx("db:update:transactions") && idx("db:update:transactions") < idx("db:update:proposals") && idx("db:delete:projects") === lastDb && idx("db:update:agent_alerts") < 0, L);
  ok("5. external effects (calendar event, Google Task, cover file) only AFTER the DB commit, and reported", firstExt > lastDb && L.includes("ext:calendar:ev1") && L.includes("ext:gtask:gt1") && L.includes(`ext:cover:${P}`) && res.external.length === 3 && res.external.every((e) => e.failed === 0), { L, ext: res.external });
  ok("6. every per-project settings key (+ the work's final-files flag) removed; unrelated keys kept; money unlinked, never deleted", T("settings").map((s) => s.key).join() === "unrelated" && T("transactions").length === 2 && T("transactions").find((t) => t.id === "t1")!.project_id === null);

  reset(projectSeed(false)); failOn = { table: "transactions", op: "update" };
  let midErr: unknown = null; try { await PD.deleteProjectCompletely(P); } catch (e) { midErr = e; }
  ok("7. a failing DB step aborts BEFORE the project row and before ANY external effect", !!midErr && T("projects").length === 1 && !mutations().some((l) => l.startsWith("ext:")), mutations());

  reset(projectSeed(false));
  // a final file appears between the preflight and the row delete → the re-check stops it
  const origVictor = (stubs["@/lib/writes/victor"] as { removeVictorWork: (id: string) => Promise<unknown> }).removeVictorWork;
  (stubs["@/lib/writes/victor"] as { removeVictorWork: unknown }).removeVictorWork = async (id: string) => { T("final_files").push({ id: "late", work_id: "w1", project_id: P }); return origVictor(id); };
  let lateErr: unknown = null; try { await PD.deleteProjectCompletely(P); } catch (e) { lateErr = e; }
  (stubs["@/lib/writes/victor"] as { removeVictorWork: unknown }).removeVictorWork = origVictor;
  ok("8. the blocker re-check right before the row: a final file added meanwhile stops the row delete (partial, retry-safe) and no external effect runs", lateErr instanceof PD.ProjectDeleteBlockedError && (lateErr as { partial: boolean }).partial === true && T("projects").length === 1 && !mutations().some((l) => l.startsWith("ext:")));

  console.log("\nProjects UI — never drops a project before the server confirms");
  const prov = read("components/ProjectsProvider.tsx");
  const delFn = prov.slice(prov.indexOf("const deleteProject = useCallback"), prov.indexOf("const createProject"));
  ok("9. ProjectsProvider: the filter (removal) comes only after a successful response; a failure throws the server's message", delFn.indexOf('fetch(`/api/projects/${id}`') < delFn.indexOf("setProjects((prev) => prev.filter") && /if \(!res\.ok\)[\s\S]*throw new Error\(data\.error/.test(delFn) && delFn.indexOf("throw new Error(data.error") < delFn.indexOf("setProjects((prev) => prev.filter"));
  const tbl = read("components/projects/ProjectsTable.tsx"), am = read("components/project/ActionMenu.tsx");
  ok("10. ProjectsTable / ActionMenu await the delete and show the refusal", /await deleteProject\(id\);[\s\S]{0,80}setConfirmDeleteId\(null\)/.test(tbl) && /setDeleteErr\(e instanceof Error/.test(tbl) && /setDeleteError\(e instanceof Error && e\.message \? e\.message/.test(am));

  // ── 2. Red Films permanent delete ──────────────────────────────────────────────────────────────────────────────
  console.log("\nRed Films permanent delete");
  const rfSeed = (withPayment: boolean): Record<string, Row[]> => ({
    red_films_productions: [{ id: "r1", title: "הפקה א", status: "בוטל", dropbox_folder_path: "/RF/a" }, { id: "r2", title: "הפקה ב", status: "רעיון" }],
    red_films_budget_payments: withPayment ? [{ id: "pay1", production_id: "r1", amount: 700, currency: "$" }, { id: "pay2", production_id: "r1", amount: 300, currency: "₪" }] : [],
    red_films_reference_images: [{ id: "ri1", production_id: "r1", dropbox_path: "/RF/a/ref.jpg" }], red_films_documents: [{ id: "d1", production_id: "r1", dropbox_path: "/RF/a/doc.pdf" }],
    red_films_reference_links: [{ id: "rl1", production_id: "r1" }], red_films_scenes: [{ id: "sc1", production_id: "r1" }], red_films_crew: [{ id: "cr1", production_id: "r1" }],
    red_films_budget_items: [{ id: "bi1", production_id: "r1", linked_transaction_id: "tx9" }],
    tasks: [{ id: "tk1", related_type: "red_film_production", related_id: "r1", calendar_event_id: "g1" }],
    settings: [{ key: "finance_pA", value: { agreedPrice: 5, clipProductionId: "r1" } }, { key: "finance_pB", value: { clipProductionId: "rOther" } }],
    transactions: [{ id: "tx9", amount: 50 }],
  });
  reset(rfSeed(true));
  const hp = await RF.deleteCancelledProductions(["r1", "r2"]);
  ok("11. a cancelled production WITH payments → HAS_PAYMENTS 409 (per currency), ZERO writes", hp.kind === "bad" && hp.status === 409 && hp.code === "HAS_PAYMENTS" && /\$700/.test(hp.error) && /₪300/.test(hp.error) && mutations().length === 0, { hp, L: mutations() });

  reset(rfSeed(false)); failOn = { table: "red_films_scenes", op: "delete" };
  let rfErr: unknown = null; try { await RF.deleteCancelledProductions(["r1"]); } catch (e) { rfErr = e; }
  ok("12. a failing step is REPORTED (thrown with the step) and the production row is NOT deleted / not claimed deleted; no storage call", rfErr instanceof Error && /red_films_scenes/.test((rfErr as Error).message) && T("red_films_productions").some((p) => p.id === "r1") && !mutations().some((l) => l.startsWith("ext:")), { e: String(rfErr), L: mutations() });

  reset(rfSeed(false)); storageFail = true;
  const okDel = await RF.deleteCancelledProductions(["r1", "r2"]);
  const RL = mutations();
  ok("13. success: children + tasks + the production gone, the non-cancelled one skipped, storage + Google Tasks AFTER the DB", okDel.kind === "ok" && okDel.deleted === 1 && okDel.skipped === 1 && !T("red_films_productions").some((p) => p.id === "r1") && T("red_films_productions").some((p) => p.id === "r2") && ["red_films_reference_links", "red_films_scenes", "red_films_crew", "red_films_documents"].every((t) => T(t).length === 0) && RL.findIndex((l) => l.startsWith("ext:")) > RL.indexOf("db:delete:red_films_productions"), RL);
  ok("14. storage failures are reported, never swallowed", okDel.kind === "ok" && okDel.storageFailures === 2 && /לא נמחקו מהאחסון/.test(String(okDel.warningHe)), okDel);
  ok("15. the Finance transaction of a budget line stays (real money)", T("transactions").some((t) => t.id === "tx9"));
  ok("16. clipProductionId cleared ONLY where it equals the deleted production (the other marker untouched, the rest of the blob kept)", !("clipProductionId" in (T("settings").find((s) => s.key === "finance_pA")!.value as Row)) && (T("settings").find((s) => s.key === "finance_pA")!.value as Row).agreedPrice === 5 && (T("settings").find((s) => s.key === "finance_pB")!.value as Row).clipProductionId === "rOther");
  reset(rfSeed(false)); casMissOnce = true;
  ok("17. the marker clear is a compare-and-swap with one retry on a concurrent change", (await RF.clearClipMarkerIfEqual("finance_pA", "r1")) === true && mutations().includes("db:update:settings(cas-miss)") && !("clipProductionId" in (T("settings").find((s) => s.key === "finance_pA")!.value as Row)));
  reset(rfSeed(false));
  ok("18. a marker that points elsewhere is never touched", (await RF.clearClipMarkerIfEqual("finance_pB", "r1")) === false && mutations().length === 0);

  // ── 3. promotions ─────────────────────────────────────────────────────────────────────────────────────────────
  console.log("\nPromotions — real money stays, with provenance");
  const promoSeed = (): Record<string, Row[]> => ({
    social_campaigns: [{ id: "camp1" }],
    social_promotions: [{ id: "pm1", campaign_id: "camp1", name: "TikTok boost", channel: "TikTok", linked_transaction_id: "tx1" }, { id: "pm2", campaign_id: "camp1", name: "IG", channel: "Instagram", linked_transaction_id: null }],
    transactions: [{ id: "tx1", amount: 480, currency: "₪", payment_status: "שולם", notes: "הערה קיימת" }],
  });
  reset(promoSeed());
  await PROMO.deletePromotion("pm1");
  const tx1 = T("transactions")[0];
  const today = new Date().toISOString().slice(0, 10);
  ok("19. promotion delete keeps the transaction and APPENDS the provenance marker (no overwrite), before the row delete", !!tx1 && String(tx1.notes) === `הערה קיימת\n[קידום נמחק ${today}: TikTok boost · TikTok]` && !T("social_promotions").some((p) => p.id === "pm1") && mutations().indexOf("db:update:transactions") < mutations().indexOf("db:delete:social_promotions"), { tx1, L: mutations() });
  reset(promoSeed()); failOn = { table: "transactions", op: "update" };
  let pmErr: unknown = null; try { await PROMO.deletePromotion("pm1"); } catch (e) { pmErr = e; }
  ok("20. if the marker write fails the promotion is NOT deleted", !!pmErr && T("social_promotions").some((p) => p.id === "pm1"));
  reset(promoSeed());
  await SOC.deleteCampaign("camp1");
  ok("21. campaign delete (promotions cascade) preserves the real money with provenance, then deletes the campaign", T("transactions").length === 1 && /\[קידום נמחק .*TikTok boost/.test(String(T("transactions")[0].notes)) && T("social_campaigns").length === 0 && mutations().indexOf("db:update:transactions") < mutations().indexOf("db:delete:social_campaigns"), mutations());
  reset(promoSeed()); failOn = { table: "transactions", op: "update" };
  let cErr: unknown = null; try { await SOC.deleteCampaign("camp1"); } catch (e) { cErr = e; }
  ok("22. campaign delete aborts when a marker cannot be written", !!cErr && T("social_campaigns").length === 1);
  reset({ social_promotions: [{ id: "pm1", campaign_id: "camp1", name: "x", channel: "TikTok", linked_transaction_id: "gone" }], transactions: [] });
  let syncErr: unknown = null; try { await PROMO.syncActualExpense("pm1", 500); } catch (e) { syncErr = e; }
  ok("23. a 0-row sync update (the linked expense is gone) is an ERROR, never a silent success", syncErr instanceof Error && /לא נמצאה/.test((syncErr as Error).message));
  const sp = PROMO.promotionSpend;
  ok("24. promotion spend = paid only (שולם); unpaid / cancelled / partial = 0; the currency is the transaction's", sp({ amount: 300, currency: "$", payment_status: "שולם" }).amount === 300 && sp({ amount: 300, currency: "$", payment_status: "שולם" }).currency === "$" && sp({ amount: 300, currency: "₪", payment_status: "בוטל" }).amount === 0 && sp({ amount: 300, currency: "₪", payment_status: "צפוי" }).amount === 0 && sp({ amount: 300, currency: "₪", payment_status: "חלקי" }).amount === 0 && sp(null).amount === 0 && sp({ amount: 300, payment_status: "בוטל" }).linkedAmount === 300);
  ok("25. spend totals are per currency (never one mixed number)", JSON.stringify(PROMO.promotionSpendByCurrency([{ actual_amount: 100, actual_currency: "₪" }, { actual_amount: 50, actual_currency: "$" }, { actual_amount: 20, actual_currency: "₪" }, { actual_amount: 0, actual_currency: "€" }])) === JSON.stringify({ "₪": 120, "$": 50 }));
  reset({ social_promotions: [{ id: "a", campaign_id: "c", linked_transaction_id: "t1" }, { id: "b", campaign_id: "c", linked_transaction_id: "t2" }], transactions: [{ id: "t1", amount: 100, currency: "₪", payment_status: "שולם" }, { id: "t2", amount: 70, currency: "$", payment_status: "בוטל" }] });
  const lp = await PROMO.listPromotions("c");
  ok("26. the promotions list reader applies the same rule (cancelled → 0 spend, raw amount kept for editing)", lp[0].actual_amount === 100 && lp[1].actual_amount === 0 && lp[1].linked_amount === 70 && lp[1].actual_currency === "$" && lp[1].linked_status === "בוטל");

  // ── 4. Finance ownership ──────────────────────────────────────────────────────────────────────────────────────
  console.log("\nFinance ownership guard (route + Sunny share ONE rule)");
  const V = OWN.transactionEditVerdict;
  ok("27. owned row delete refused (every owner)", OWN.FINANCE_OWNER_CODES.every((o) => { const v = V(o, "delete"); return !v.ok && v.code === "OWNED_ROW_DELETE"; }));
  ok("28. amount / currency change refused on an owned row, allowed on a free-standing row", !V("DJ_FEE", ["amount"]).ok && !V("MIX_WORK", ["currency"]).ok && !V("PROMOTION", ["amount"]).ok && V(null, ["amount", "currency"]).ok);
  ok("29. fee status change allowed (DJ / artist / rehearsal / Victor salary); a show PAYMENT's status is not (notes / method / date only)", (["DJ_FEE", "ARTIST_FEE", "REHEARSAL", "VICTOR_SALARY"] as const).every((o) => V(o, ["paymentStatus", "date", "paymentMethod", "notes"]).ok) && !V("SHOW_PAYMENT", ["paymentStatus"]).ok && V("SHOW_PAYMENT", ["notes", "paymentMethod", "date"]).ok && !V("SHOW_BALANCE_EXPECTED", ["date"]).ok);
  ok("29b. MIX_WORK (F2, 2026-10-01): payment status / date can NOT be changed in Finance — the engineer work owns the payment; payment method + notes stay editable", !V("MIX_WORK", ["paymentStatus"]).ok && !V("MIX_WORK", ["date"]).ok && !V("MIX_WORK", ["paymentStatus", "date", "notes"]).ok && V("MIX_WORK", ["paymentMethod", "notes"]).ok && V("MIX_WORK", ["notes"]).ok && V("MIX_WORK", []).ok);
  const mixRefused = V("MIX_WORK", ["paymentStatus"]);
  ok("29c. the MIX_WORK refusal names where to change it (the engineer work) and what may still change here", !mixRefused.ok && /בעבודת המיקס/.test(mixRefused.messageHe) && /אמצעי תשלום/.test(mixRefused.messageHe), mixRefused);
  const refused = V("DJ_FEE", ["amount"]);
  ok("30. the refusal names the owner and where to change it (Hebrew)", !refused.ok && /DJ/.test(refused.messageHe) && /בכרטיס ההופעה/.test(refused.messageHe));
  const cur = { date: "2026-09-01", description: "DJ", artist: "", amount: 500, currency: "₪", paymentStatus: "צפוי", paymentMethod: "", receiptRef: "", notes: "", category: "", type: "expense", scope: "project", project_id: "p", linkedSessionId: "", expenseScope: "הופעה" };
  ok("31. re-sending unchanged values is not a change (the Finance modal sends the whole row)", OWN.changedTxFields(cur, { ...cur, amount: "500", notes: "x", paymentStatus: "שולם" }).join() === "paymentStatus,notes");
  ok("32. owner from links: show role → legacy link → Victor salary → mix → clip → RF → promotion", OWN.ownerFromLinks({ showId: "s", showMoneyRole: "DJ_FEE" }) === "DJ_FEE" && OWN.ownerFromLinks({ showId: "s" }) === "SHOW" && OWN.ownerFromLinks({ legacyShowRole: "ARTIST_FEE" }) === "ARTIST_FEE" && OWN.ownerFromLinks({ linkedSessionId: "victor_salary_2026-08" }) === "VICTOR_SALARY" && OWN.ownerFromLinks({ linkedSessionId: "sess-1" }) === null && OWN.ownerFromLinks({ promotion: true }) === "PROMOTION" && OWN.ownerFromLinks({}) === null);

  const route = await import("../app/api/transactions/[id]/route");
  const { NextRequest } = await import("next/server");
  const finSeed = (): Record<string, Row[]> => ({
    transactions: [
      { id: "dj", show_id: "sh1", show_money_role: "DJ_FEE", amount: 500, currency: "₪", payment_status: "צפוי", type: "expense", scope: "project", project_id: null, date: "2026-09-01", description: "DJ", artist: "", payment_method: "", receipt_ref: "", notes: "", category: "", linked_session_id: "", expense_scope: "הופעה" },
      { id: "free", show_id: null, amount: 100, currency: "₪", payment_status: "צפוי", type: "expense", scope: "general", project_id: null, date: "2026-09-01", description: "x", artist: "", payment_method: "", receipt_ref: "", notes: "", category: "", linked_session_id: "", expense_scope: "כללי" },
    ],
    shows: [], sound_engineer_work: [], clip_items: [], red_films_budget_items: [], social_promotions: [],
  });
  const call = (m: "PATCH" | "DELETE", id: string, body?: Row) => (m === "PATCH" ? route.PATCH : route.DELETE)(new NextRequest(`https://app.test/api/transactions/${id}`, { method: m, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }), { params: Promise.resolve({ id }) });
  reset(finSeed());
  const r1 = await call("DELETE", "dj"); const j1 = await r1.json();
  ok("33. route: deleting an owned (DJ fee) row → 409 with the Hebrew reason, nothing deleted", r1.status === 409 && j1.code === "OWNED_ROW_DELETE" && /DJ/.test(j1.error) && T("transactions").length === 2, j1);
  const r2 = await call("PATCH", "dj", { amount: 900 }); const j2 = await r2.json();
  ok("34. route: changing an owned row's amount → 409 (forbidden: amount), row unchanged", r2.status === 409 && JSON.stringify(j2.forbidden) === '["amount"]' && T("transactions")[0].amount === 500, j2);
  const r3 = await call("PATCH", "dj", { paymentStatus: "שולם", amount: 500, notes: "שולם במזומן" });
  ok("35. route: a fee STATUS change (unchanged amount re-sent) is allowed", r3.status === 200 && T("transactions")[0].payment_status === "שולם");
  const r4 = await call("DELETE", "free");
  ok("36. route: a free-standing row is still deletable", r4.status === 200 && T("transactions").length === 1);
  const sv = read("lib/partner/act/server.ts"), fp = read("lib/partner/act/primitives/finance.ts"), rt = read("app/api/transactions/[id]/route.ts"), lr = read("app/api/transactions/route.ts");
  ok("37. the guard is shared: the route and Sunny's finance writers call assertTransactionEditable; Sunny's plan uses the same pure rule", /assertTransactionEditable\(id, body/.test(rt) && /F\.assertTransactionEditable\(id, patch\)/.test(sv) && /F\.assertTransactionEditable\(id, "delete"\)/.test(sv) && /from "@\/lib\/finance\/ownership"/.test(fp) && /transactionEditVerdict\(/.test(fp));
  ok("38. the Finance list GET returns a server-computed owner in ONE batch (financeOwnersFor), and the screen disables forbidden controls", /financeOwnersFor\(list\)/.test(lr) && /owner: ownerUi\(/.test(lr) && /disabled=\{locked\("amount"\)\}/.test(read("components/finance/FinancePage.tsx")) && /setTxError\(d\.error/.test(read("components/finance/FinancePage.tsx")));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
