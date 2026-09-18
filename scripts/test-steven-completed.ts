/**
 * Standalone smoke test for lib/steven-completed-pure.ts (the decision logic +
 * orchestration behind lib/steven-completion.ts).
 *
 * Run with:   npx tsx scripts/test-steven-completed.ts
 *
 * Imports ONLY from steven-completed-pure.ts (and the pure modules it pulls in),
 * which has no "server-only"/Supabase/push dependency. Every scenario runs
 * against an in-memory world (projects, Steven works, settings rows, pushes)
 * injected through StevenCompletionDeps — NO real Supabase writes and NO real
 * push anywhere in this file.
 *
 * Scenario letters (A–L) follow the QA list of the feature request. Those that
 * live in the UI (Blur, refresh, mobile, /projects refresh) can't be exercised
 * here; the server-side ones (transition, project sync, dedupe, cycles, no Victor)
 * can. The "PROJECT-LEVEL CONCURRENCY" section drives two/three works finishing
 * together through EVERY valid interleaving of (commit, sibling-list) events, with
 * seeded random delays in every later step, and asserts the exactly-once result.
 */
import {
  PROJECT_COMPLETED_STATUS,
  PROJECT_PROTECTED_STATUSES,
  isCompletionTransition,
  isBecameOpenTransition,
  hasOtherOpenWork,
  decideProjectSync,
  computeFinalFilesFlags,
  finalFilesFocusVisible,
  parseRequestAt,
  finalFilesRequestedKey,
  finalFilesRequestedProjectKey,
  finalFilesRequestKeyFor,
  workIdFromRequestedKey,
  projectIdFromRequestedKey,
  buildStevenPush,
  buildOwnerConfirmPush,
  buildOwnerPushFailedPush,
  buildOwnerProjectSyncFailedPush,
  processStevenCompletion,
  releaseStevenFinalFilesRequest,
  type CompletionPush,
  type StevenCompletionDeps,
  type StevenCompletionOutcome,
} from "../lib/steven-completed-pure";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `  — ${detail}` : ""}`); }
}

const TODAY = "2026-09-18";
const OK   = [{ status: "fulfilled" }];
const NONE: { status: string }[] = [];
const REJ  = [{ status: "rejected" }];
const tick = () => new Promise<void>((r) => setImmediate(r));

// deterministic PRNG so every "random" schedule is reproducible from its seed
function mulberry32(a: number) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

interface WorldOpts {
  projects?: Record<string, { status: string; endDate: string | null }>;
  /** Steven works: id → { projectId, status }. The work being completed may or may not be in here. */
  works?: Record<string, { projectId: string | null; status: string }>;
  pushAllowed?: boolean;
  steven?: { status: string }[] | "throw";
  failList?: boolean;
  failSync?: boolean;
  failRelease?: boolean;
  claimError?: boolean;
}

function makeWorld(o: WorldOpts = {}) {
  const projects = o.projects ?? {};
  const works = o.works ?? {};
  const rows = new Map<string, unknown>();               // settings rows = final-files request rows
  const clock = { t: Date.UTC(2026, 8, 18, 10, 0, 0) };  // the injected "now" (ms) — the tests move it explicitly
  const files: { work_id: string | null; project_id: string | null; created_at: string }[] = [];  // final_files rows (never deleted)
  const stevenPushes: CompletionPush[] = [];
  const ownerPushes: CompletionPush[] = [];
  const errors: string[] = [];
  const counters = { syncCalls: 0, listCalls: 0, syncUpdated: 0, claimWon: 0 };
  // controllable timing: `hop` = a random number of event-loop turns; `gateList` blocks a
  // sibling-list until the test releases that exact event (see runOrder).
  const ctl: { hop: () => Promise<void>; gateList: ((id: string) => Promise<void>) | null } = { hop: async () => {}, gateList: null };

  const deps: StevenCompletionDeps = {
    async listOtherStevenWorks(projectId, excludeWorkId) {
      counters.listCalls++;
      if (o.failList) throw new Error("db down");
      if (ctl.gateList) await ctl.gateList(excludeWorkId);
      // the SNAPSHOT is taken here (the moment the read happens), like a real SELECT
      const snap = Object.entries(works).filter(([id, w]) => w.projectId === projectId && id !== excludeWorkId).map(([, w]) => ({ status: w.status }));
      await ctl.hop();
      return snap;
    },
    async syncProjectCompleted(projectId) {
      counters.syncCalls++;
      if (o.failSync) throw new Error("update failed");
      const read = () => { const p = projects[projectId]; if (!p) throw new Error("linked project not found"); return p; };
      const before = decideProjectSync(read().status);
      await ctl.hop();
      if (before !== "sync") return before;
      await ctl.hop(); // the window between the read and the conditional write
      // conditional write, atomic like the real UPDATE … WHERE status NOT IN (הושלם, בוטל, בהשהייה)
      const p = read();
      if (p.status !== PROJECT_COMPLETED_STATUS && !PROJECT_PROTECTED_STATUSES.includes(p.status)) {
        p.status = PROJECT_COMPLETED_STATUS; p.endDate = TODAY; counters.syncUpdated++; return "updated";
      }
      const after = decideProjectSync(p.status);
      if (after === "sync") throw new Error("matched no row although open");
      return after;
    },
    async claimFinalFilesRequest(key, value) {
      if (o.claimError) return "error";
      await ctl.hop();
      if (rows.has(key)) return "lost";               // unique-key INSERT: check+set with no await between
      rows.set(key, value); counters.claimWon++; return "won";
    },
    async releaseFinalFilesRequest(key) {
      if (o.failRelease) throw new Error("settings down");
      rows.delete(key);
    },
    pushAllowed: () => o.pushAllowed ?? true,
    now: () => clock.t,
    async sendToSteven(p) {
      await ctl.hop();
      if (o.steven === "throw") throw new Error("webpush blew up");
      stevenPushes.push(p);
      return o.steven ?? OK;
    },
    async sendToOwner(p) { await ctl.hop(); ownerPushes.push(p); },
    log: () => {},
    logError: (m) => { errors.push(m); },
  };

  const run = (id: string, projectId: string | null, fromUpdatedAt = "U0", name = "G Thang"): Promise<StevenCompletionOutcome> =>
    processStevenCompletion({ id, projectId, displayName: name, fromUpdatedAt }, deps);
  /** the store's committed UPDATE of one work's status */
  const commit = (id: string, status = "אושר") => { const w = works[id]; if (w) w.status = status; };
  /** a Steven work going closed → open (store hook): status write + release of the cycle's row */
  const reopen = async (id: string, status = "בתהליך") => {
    commit(id, status);
    await releaseStevenFinalFilesRequest({ id, projectId: works[id]?.projectId ?? null }, deps);
  };
  const ownerConfirms = () => ownerPushes.filter((p) => p.title === "התראה נשלחה ל-Steven").length;
  const ownerFailures = () => ownerPushes.filter((p) => p.title === "התראה ל-Steven לא נשלחה" || p.title === "סנכרון הפרויקט נכשל").length;
  const advance = (ms: number) => { clock.t += ms; };
  /** a final file uploaded through work `workId` at the current clock (project_id copied from the work, like the real writer) */
  const upload = (workId: string) => { files.push({ work_id: workId, project_id: works[workId]?.projectId ?? null, created_at: new Date(clock.t).toISOString() }); };
  /** exactly what the works list computes on every open of the modal, from the stored rows */
  const flags = () => computeFinalFilesFlags(
    Object.entries(works).map(([id, w]) => ({ id, projectId: w.projectId })),
    { finalRows: files, requestRows: [...rows].map(([key, value]) => ({ key, value })) });
  /** the client's Blur condition: completed && requested && no final file uploaded after the request */
  const blur = (id: string) => works[id]?.status === "אושר" && flags().finalFilesRequested.has(id) && !flags().hasCurrentFinalFiles.has(id);
  return { run, commit, reopen, deps, ctl, projects, works, rows, files, clock, advance, upload, flags, blur, stevenPushes, ownerPushes, errors, counters, ownerConfirms, ownerFailures };
}
type World = ReturnType<typeof makeWorld>;

async function main() {
  console.log("\n— transition detection (refresh / save / payment edit / hold-over never fire) —");
  check("פעיל -> הושלם fires", isCompletionTransition("בתהליך", "אושר", "אושר"));
  check("לא התחיל -> הושלם fires", isCompletionTransition("לא נשלח", "אושר", "אושר"));
  check("הושלם -> הושלם does NOT fire (re-save)", !isCompletionTransition("אושר", "אושר", "אושר"));
  check("a PATCH without a status (payment edit / refresh path) does NOT fire", !isCompletionTransition("בתהליך", undefined, "אושר"));
  check("a PATCH that keeps the work open does NOT fire", !isCompletionTransition("בתהליך", "בתהליך", "בתהליך"));
  check("moving to בוטל does NOT fire", !isCompletionTransition("בתהליך", "בוטל", "בוטל"));
  check("an unrelated concurrent PATCH that merely READ the completed row back does NOT fire",
    !isCompletionTransition("בתהליך", undefined, "אושר"));

  console.log("\n— reopen detection (what ends a cycle) —");
  check("הושלם -> פעיל is a reopen", isBecameOpenTransition("אושר", "בתהליך", "בתהליך"));
  check("הושלם -> לא התחיל is a reopen", isBecameOpenTransition("אושר", "לא נשלח", "לא נשלח"));
  check("בוטל -> פעיל is a reopen (an open work exists again)", isBecameOpenTransition("בוטל", "בתהליך", "בתהליך"));
  check("הושלם -> בוטל is NOT (still no open work)", !isBecameOpenTransition("אושר", "בוטל", "בוטל"));
  check("פעיל -> הושלם is NOT", !isBecameOpenTransition("בתהליך", "אושר", "אושר"));
  check("פעיל -> פעיל is NOT", !isBecameOpenTransition("בתהליך", "בתהליך", "בתהליך"));
  check("a PATCH that carries no status never counts (payment edit on a completed work)", !isBecameOpenTransition("אושר", undefined, "אושר"));

  console.log("\n— open-work / project decisions —");
  check("לא נשלח / נשלח / בתהליך / חזר are all OPEN",
    hasOtherOpenWork([{ status: "לא נשלח" }]) && hasOtherOpenWork([{ status: "נשלח" }]) &&
    hasOtherOpenWork([{ status: "בתהליך" }]) && hasOtherOpenWork([{ status: "חזר" }]));
  check("אושר and בוטל are closed (a cancelled sibling does not block)", !hasOtherOpenWork([{ status: "אושר" }, { status: "בוטל" }]));
  check("no other work → not open", !hasOtherOpenWork([]));
  check("project decisions: open → sync", decideProjectSync("בעבודה") === "sync" && decideProjectSync("במיקס") === "sync" && decideProjectSync("לא התחיל") === "sync");
  check("project decisions: הושלם → already", decideProjectSync("הושלם") === "already_completed");
  check("project decisions: בוטל / בהשהייה → protected", decideProjectSync("בוטל") === "protected" && decideProjectSync("בהשהייה") === "protected");

  console.log("\n— A. one Steven work on the project: פעיל → הושלם —");
  {
    const w = makeWorld({ projects: { P1: { status: "בעבודה", endDate: null } } });
    const out = await w.run("W1", "P1");
    check("project → הושלם", w.projects.P1.status === "הושלם", w.projects.P1.status);
    check("end_date = today", w.projects.P1.endDate === TODAY, String(w.projects.P1.endDate));
    check("outcome: updated + lastOpenWork", out.projectSync === "updated" && out.lastOpenWork);
    check("ONE project-scoped request row (claim + marker) exists", w.rows.size === 1 && w.rows.has(finalFilesRequestedProjectKey("P1")) && out.finalFilesRequested);
    check("exactly ONE push to Steven", w.stevenPushes.length === 1, String(w.stevenPushes.length));
    check("Steven push title", w.stevenPushes[0]?.title === "Project completed");
    check("Steven push body is English, {name} — please upload the final files.", w.stevenPushes[0]?.body === "G Thang — please upload the final files.", w.stevenPushes[0]?.body);
    check("Steven push deep-links to the work", w.stevenPushes[0]?.url === "/team/steven?work=W1");
    check("Steven push carries NO project/entity fields (his bell must not open the owner drawer)",
      !("projectId" in (w.stevenPushes[0] ?? {})) && !w.stevenPushes[0]?.entityType && !w.stevenPushes[0]?.entityId);
    check("owner confirmation sent once", w.ownerConfirms() === 1 && out.push === "sent");
    check("owner confirmation text (Hebrew, 'נשלחה' — never 'קיבל')",
      w.ownerPushes[0]?.body === 'נשלחה ל-Steven התראה שהפרויקט "G Thang" הושלם ושיש להעלות קבצים סופיים.' && !/קיבל/.test(w.ownerPushes[0]?.title + w.ownerPushes[0]?.body), w.ownerPushes[0]?.body);
  }

  console.log("\n— A2. לא התחיל → הושלם behaves the same (transition input differs only in the store) —");
  {
    const w = makeWorld({ projects: { P1: { status: "לא התחיל", endDate: null } } });
    const out = await w.run("W1", "P1");
    check("project completed + one push", out.projectSync === "updated" && w.stevenPushes.length === 1);
  }

  console.log("\n— B. two Steven works on the project —");
  {
    const w = makeWorld({
      projects: { P1: { status: "במיקס", endDate: null } },
      works: { WA: { projectId: "P1", status: "אושר" }, WB: { projectId: "P1", status: "בתהליך" } },
    });
    const a = await w.run("WA", "P1");
    check("A completes while B is open → outcome other_open_work", a.projectSync === "other_open_work" && !a.lastOpenWork);
    check("project NOT completed", w.projects.P1.status === "במיקס");
    check("end_date NOT set", w.projects.P1.endDate === null);
    check("project sync never even attempted", w.counters.syncCalls === 0);
    check("no request row (no Final Files request yet)", w.rows.size === 0 && !a.finalFilesRequested);
    check("no push to Steven", w.stevenPushes.length === 0);
    check("no owner notice either", w.ownerPushes.length === 0);
    // now B completes; A is already closed
    w.commit("WB");
    const b = await w.run("WB", "P1", "U1", "G Thang — Master");
    check("B (the last open one) completes → project הושלם", b.projectSync === "updated" && w.projects.P1.status === "הושלם");
    check("end_date = today", w.projects.P1.endDate === TODAY);
    check("ONE request row for the project, won by B", w.rows.size === 1 && (w.rows.get(finalFilesRequestedProjectKey("P1")) as { workId: string })?.workId === "WB");
    check("push for B only", w.stevenPushes.length === 1 && w.stevenPushes[0].url === "/team/steven?work=WB");
  }
  {
    const w = makeWorld({
      projects: { P1: { status: "בעבודה", endDate: null } },
      works: { WB: { projectId: "P1", status: "בוטל" } },
    });
    const a = await w.run("WA", "P1");
    check("a CANCELLED sibling does not block the sync", a.projectSync === "updated" && w.projects.P1.status === "הושלם");
  }

  console.log("\n— C. project already הושלם —");
  {
    const w = makeWorld({ projects: { P1: { status: "הושלם", endDate: "2026-01-05" } } });
    const out = await w.run("W1", "P1");
    check("outcome already_completed (no-op)", out.projectSync === "already_completed");
    check("end_date NOT moved", w.projects.P1.endDate === "2026-01-05", String(w.projects.P1.endDate));
    check("Steven is still asked for the final files", w.stevenPushes.length === 1 && w.rows.size === 1);
  }

  console.log("\n— D / E. project בוטל / בהשהייה are never overwritten —");
  for (const st of ["בוטל", "בהשהייה"]) {
    const w = makeWorld({ projects: { P1: { status: st, endDate: null } } });
    const out = await w.run("W1", "P1");
    check(`${st}: outcome protected`, out.projectSync === "protected");
    check(`${st}: status unchanged`, w.projects.P1.status === st);
    check(`${st}: end_date untouched`, w.projects.P1.endDate === null);
    check(`${st}: the Steven work still completes its own flow (push + request row)`, w.stevenPushes.length === 1 && w.rows.size === 1);
  }

  console.log("\n— F. no project_id (standalone) —");
  {
    const w = makeWorld({ projects: { P1: { status: "בעבודה", endDate: null } } });
    const out = await w.run("W1", null, "U0", "Standalone job");
    check("no project lookup or sync at all (never guessed by name)", w.counters.listCalls === 0 && w.counters.syncCalls === 0);
    check("outcome no_project; some other project is untouched", out.projectSync === "no_project" && w.projects.P1.status === "בעבודה");
    check("Steven still gets the push with the work's own name", w.stevenPushes[0]?.body === "Standalone job — please upload the final files.");
    check("its request row is WORK-scoped (no project to scope it to)", w.rows.size === 1 && w.rows.has(finalFilesRequestedKey("W1")));
  }

  console.log("\n— G / H. duplicate protection (same cycle) —");
  {
    const w = makeWorld({ projects: { P1: { status: "בעבודה", endDate: null } } });
    const first  = await w.run("W1", "P1", "U0");
    const second = await w.run("W1", "P1", "U0");
    check("first sends, second is skipped_duplicate", first.push === "sent" && second.push === "skipped_duplicate", `${first.push}/${second.push}`);
    check("exactly ONE Steven push and ONE owner notice", w.stevenPushes.length === 1 && w.ownerPushes.length === 1);
    const third = await w.run("W1", "P1", "U-later");
    check("even a request with a different pre-update stamp is the SAME cycle until a reopen/new work releases it", third.push === "skipped_duplicate" && w.stevenPushes.length === 1);
  }
  {
    const w = makeWorld({ projects: { P1: { status: "בעבודה", endDate: null } } });
    const outs = await Promise.all([w.run("W1", "P1", "U0"), w.run("W1", "P1", "U0"), w.run("W1", "P1", "U0")]);
    check("3 concurrent requests → ONE push", w.stevenPushes.length === 1, String(w.stevenPushes.length));
    check("the losers are skipped_duplicate", outs.filter((o) => o.push === "skipped_duplicate").length === 2);
  }
  {
    const w = makeWorld({ projects: { P1: { status: "בעבודה", endDate: null } }, claimError: true });
    const out = await w.run("W1", "P1");
    check("a request-row DB error sends nothing (no dedupe guarantee) but the project still synced",
      out.push === "claim_error" && w.stevenPushes.length === 0 && out.projectSync === "updated" && w.rows.size === 0);
    check("…and the owner is told nothing was sent to Steven", w.ownerFailures() === 1 && w.errors.some((e) => /could not record/.test(e)));
  }

  console.log("\n— push outcomes → owner notice —");
  {
    const w = makeWorld({ projects: { P1: { status: "בעבודה", endDate: null } }, steven: NONE });
    const out = await w.run("W1", "P1");
    check("no Steven subscription → no_subscription", out.push === "no_subscription");
    check("owner told it could not be sent (and why)", w.ownerPushes.length === 1 && w.ownerPushes[0].body === 'לא ניתן היה לשלוח ל-Steven התראה עבור "G Thang". אין ל-Steven מכשיר רשום להתראות.', w.ownerPushes[0]?.body);
    check("NO 'success' confirmation is sent", w.ownerConfirms() === 0);
    check("the work/project completion is not undone; the request row (Blur marker) still exists", w.projects.P1.status === "הושלם" && w.rows.size === 1);
  }
  {
    const w = makeWorld({ projects: { P1: { status: "בעבודה", endDate: null } }, steven: REJ });
    const out = await w.run("W1", "P1");
    check("every device rejected → send_failed + owner failure notice", out.push === "send_failed" && w.ownerPushes[0]?.body.includes("השליחה נכשלה"));
  }
  {
    const w = makeWorld({ projects: { P1: { status: "בעבודה", endDate: null } }, steven: "throw" });
    const out = await w.run("W1", "P1");
    check("a thrown send → send_failed + owner failure notice", out.push === "send_failed" && w.ownerPushes.length === 1);
  }
  {
    const w = makeWorld({ projects: { P1: { status: "בעבודה", endDate: null } }, pushAllowed: false });
    const out = await w.run("W1", "P1");
    check("localhost / dev: no push at all", out.push === "disabled" && w.stevenPushes.length === 0 && w.ownerPushes.length === 0);
    check("…but the state is still real: project synced + request row written", w.projects.P1.status === "הושלם" && w.rows.size === 1 && out.finalFilesRequested);
  }

  console.log("\n— project-sync failure is reported, never silent, never a rollback —");
  {
    const w = makeWorld({ projects: { P1: { status: "בעבודה", endDate: null } }, failSync: true });
    const out = await w.run("W1", "P1");
    check("outcome failed", out.projectSync === "failed");
    check("logged loudly", w.errors.some((e) => /PROJECT SYNC FAILED/.test(e)));
    check("owner gets the failure notice (exact wording)",
      w.ownerPushes[0]?.body === '"G Thang": העבודה של Steven סומנה כהושלמה, אך לא ניתן היה לעדכן את סטטוס הפרויקט.', w.ownerPushes[0]?.body);
    check("project untouched", w.projects.P1.status === "בעבודה");
    check("the work's own flow continues: request row + Steven push still happen", w.rows.size === 1 && w.stevenPushes.length === 1);
    check("owner also gets the delivery confirmation for the push (two distinct facts)", w.ownerPushes.length === 2);
  }
  {
    const w = makeWorld({ projects: {} });
    const out = await w.run("W1", "PX");
    check("a dangling project_id is a reported failure, not a guess", out.projectSync === "failed" && w.ownerPushes.some((p) => p.title === "סנכרון הפרויקט נכשל"));
  }
  {
    const w = makeWorld({ projects: { P1: { status: "בעבודה", endDate: null } }, failList: true });
    const out = await w.run("W1", "P1");
    check("cannot tell if it's the last open work → no sync, no request row, no Final Files push; reported",
      out.projectSync === "failed" && !out.lastOpenWork && w.rows.size === 0 && w.stevenPushes.length === 0 &&
      w.projects.P1.status === "בעבודה" && w.ownerPushes.length === 1);
  }

  console.log("\n— L. Victor is never involved —");
  {
    const w = makeWorld({ projects: { P1: { status: "בעבודה", endDate: null } } });
    await w.run("W1", "P1");
    check("only Steven + owner receive anything (no Victor push/sync path exists in the deps)",
      w.stevenPushes.length === 1 && w.ownerPushes.length === 1 &&
      [...w.stevenPushes, ...w.ownerPushes].every((p) => !/victor|viktor|ויקטור/i.test(JSON.stringify(p))));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n— PROJECT-LEVEL CONCURRENCY: two Steven works on one project finish together —");
  {
    // The whole scenario spelled out once, explicitly: A and B both "פעיל"; both PATCHes commit
    // BEFORE either lists its siblings, so BOTH conclude they are the last open work.
    const w = makeWorld({
      projects: { P: { status: "בעבודה", endDate: null } },
      works: { A: { projectId: "P", status: "בתהליך" }, B: { projectId: "P", status: "בתהליך" } },
    });
    const gates = new Map<string, { p: Promise<void>; res: () => void }>();
    const gate = (k: string) => { let g = gates.get(k); if (!g) { let res!: () => void; const p = new Promise<void>((r) => (res = r)); g = { p, res }; gates.set(k, g); } return g; };
    w.ctl.gateList = (id) => gate("l:" + id).p;
    const reqA = (async () => { await gate("c:A").p; w.commit("A"); return w.run("A", "P", "UA", "G Thang — Mix"); })();
    const reqB = (async () => { await gate("c:B").p; w.commit("B"); return w.run("B", "P", "UB", "G Thang — Master"); })();
    for (const ev of ["c:A", "c:B", "l:A", "l:B"]) { gate(ev).res(); await tick(); await tick(); }
    const [oa, ob] = await Promise.all([reqA, reqB]);

    check("both works are completed", w.works.A.status === "אושר" && w.works.B.status === "אושר");
    check("BOTH requests concluded they were the last open work (the case being defended)", oa.lastOpenWork && ob.lastOpenWork);
    check("project.status = הושלם, written exactly ONCE", w.projects.P.status === "הושלם" && w.counters.syncUpdated === 1, String(w.counters.syncUpdated));
    check("end_date set once, to today", w.projects.P.endDate === TODAY);
    check("exactly ONE final-files request row (project-scoped), no per-work markers",
      w.rows.size === 1 && w.rows.has(finalFilesRequestedProjectKey("P")) && !w.rows.has(finalFilesRequestedKey("A")) && !w.rows.has(finalFilesRequestedKey("B")));
    check("exactly ONE winner: one request created, one skipped_duplicate",
      [oa, ob].filter((o) => o.finalFilesRequested).length === 1 && [oa, ob].filter((o) => o.push === "skipped_duplicate").length === 1);
    check("exactly ONE push to Steven", w.stevenPushes.length === 1, String(w.stevenPushes.length));
    check("exactly ONE owner confirmation and no owner failure notice", w.ownerConfirms() === 1 && w.ownerFailures() === 0);
    check("one project-level request time: the single row's value.at is what BOTH completed works read (one logical Blur)",
      w.blur("A") && w.blur("B") && (w.rows.get(finalFilesRequestedProjectKey("P")) as { at: string }).at === new Date(w.clock.t).toISOString());
  }

  // Every valid interleaving of the four events (commit_i must precede list_i), each under
  // several seeded random-delay schedules for everything that happens AFTER the list.
  async function runOrder(w: World, order: string[], ids: string[], seed: number, statusFrom = "בתהליך") {
    const rng = mulberry32(seed);
    w.ctl.hop = async () => { const n = Math.floor(rng() * 3); for (let i = 0; i < n; i++) await tick(); };
    const gates = new Map<string, { p: Promise<void>; res: () => void }>();
    const gate = (k: string) => { let g = gates.get(k); if (!g) { let res!: () => void; const p = new Promise<void>((r) => (res = r)); g = { p, res }; gates.set(k, g); } return g; };
    w.ctl.gateList = (id) => gate("l:" + id).p;
    for (const id of ids) w.works[id].status = statusFrom;
    const reqs = ids.map((id) => (async () => { await gate("c:" + id).p; w.commit(id); return w.run(id, w.works[id].projectId, "U-" + id + "-" + seed, "Work " + id); })());
    for (const ev of order) { gate(ev).res(); await tick(); await tick(); }
    const outs = await Promise.all(reqs);
    w.ctl.gateList = null; w.ctl.hop = async () => {};
    return outs;
  }
  function permutations<T>(a: T[]): T[][] { return a.length <= 1 ? [a] : a.flatMap((x, i) => permutations([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p])); }

  {
    const orders = permutations(["c:A", "c:B", "l:A", "l:B"]).filter((o) => o.indexOf("c:A") < o.indexOf("l:A") && o.indexOf("c:B") < o.indexOf("l:B"));
    const SEEDS = 25;
    const viol: Record<string, string> = {};
    const note = (k: string, d: string) => { if (!viol[k]) viol[k] = d; };
    let runs = 0, bothLast = 0, oneLast = 0, neitherLast = 0;
    for (const order of orders) for (let seed = 1; seed <= SEEDS; seed++) {
      runs++;
      const w = makeWorld({
        projects: { P: { status: "בעבודה", endDate: null } },
        works: { A: { projectId: "P", status: "בתהליך" }, B: { projectId: "P", status: "בתהליך" } },
      });
      const outs = await runOrder(w, order, ["A", "B"], seed * 7919 + orders.indexOf(order));
      const last = outs.filter((o) => o.lastOpenWork).length;
      if (last === 2) bothLast++; else if (last === 1) oneLast++; else neitherLast++;
      const tag = `${order.join(",")} seed ${seed}`;
      if (w.works.A.status !== "אושר" || w.works.B.status !== "אושר") note("both works completed", tag);
      if (!(w.projects.P.status === "הושלם" && w.counters.syncUpdated === 1)) note("project completed exactly once", `${tag}: updated ${w.counters.syncUpdated}`);
      if (w.projects.P.endDate !== TODAY) note("end_date set once, to today", tag);
      if (!(w.rows.size === 1 && w.rows.has(finalFilesRequestedProjectKey("P")))) note("exactly one project-level request row", `${tag}: rows ${[...w.rows.keys()].join("|")}`);
      if (w.stevenPushes.length === 0) note("NEVER zero pushes (someone always requests)", tag);
      if (w.stevenPushes.length > 1) note("never two pushes", `${tag}: ${w.stevenPushes.length}`);
      if (w.ownerConfirms() !== 1) note("exactly one owner confirmation", `${tag}: ${w.ownerConfirms()}`);
      if (w.ownerFailures() !== 0) note("no owner failure notice", tag);
      if (outs.filter((o) => o.finalFilesRequested).length !== 1) note("exactly one winner", tag);
    }
    console.log(`  · ${orders.length} valid interleavings × ${SEEDS} delay schedules = ${runs} runs  (both-last: ${bothLast}, one-last: ${oneLast}, neither-last: ${neitherLast})`);
    check("the both-think-last case was genuinely exercised", bothLast > 0, String(bothLast));
    check("the one-is-last case was genuinely exercised (A listed before B committed)", oneLast > 0, String(oneLast));
    check('"neither is last" NEVER occurs (commit precedes the sibling list)', neitherLast === 0, String(neitherLast));
    for (const k of ["both works completed", "project completed exactly once", "end_date set once, to today", "exactly one project-level request row",
      "NEVER zero pushes (someone always requests)", "never two pushes", "exactly one owner confirmation", "no owner failure notice", "exactly one winner"]) {
      check(`all ${runs} runs: ${k}`, !(k in viol), viol[k]);
    }
  }

  {
    // three works finishing together, random valid interleavings
    const ids = ["A", "B", "C"];
    const SEEDS = 120;
    let bad = "", runs = 0, allLast = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const rng = mulberry32(seed * 104729);
      const committed = new Set<string>(), listed = new Set<string>();
      const order: string[] = [];
      while (listed.size < ids.length) {
        const avail = [...ids.filter((i) => !committed.has(i)).map((i) => "c:" + i), ...ids.filter((i) => committed.has(i) && !listed.has(i)).map((i) => "l:" + i)];
        const ev = avail[Math.floor(rng() * avail.length)];
        order.push(ev); (ev[0] === "c" ? committed : listed).add(ev.slice(2));
      }
      const w = makeWorld({
        projects: { P: { status: "בעבודה", endDate: null } },
        works: Object.fromEntries(ids.map((i) => [i, { projectId: "P", status: "בתהליך" }])),
      });
      const outs = await runOrder(w, order, ids, seed);
      runs++;
      if (outs.filter((o) => o.lastOpenWork).length === 3) allLast++;
      const ok = ids.every((i) => w.works[i].status === "אושר") && w.projects.P.status === "הושלם" && w.counters.syncUpdated === 1 &&
        w.rows.size === 1 && w.stevenPushes.length === 1 && w.ownerConfirms() === 1 && w.ownerFailures() === 0;
      if (!ok && !bad) bad = `${order.join(",")} → pushes ${w.stevenPushes.length}, rows ${w.rows.size}, updated ${w.counters.syncUpdated}`;
    }
    console.log(`  · 3 works × ${runs} random interleavings (all three thought they were last in ${allLast})`);
    check(`3 works: all ${runs} runs → all completed, project once, ONE request row, ONE push, ONE confirmation`, bad === "", bad);
  }

  console.log("\n— CYCLES: reopen still allows a genuinely new request (no permanent marker) —");
  {
    const w = makeWorld({
      projects: { P: { status: "בעבודה", endDate: null } },
      works: { A: { projectId: "P", status: "בתהליך" }, B: { projectId: "P", status: "בתהליך" } },
    });
    // cycle 1: A then B
    w.commit("A"); await w.run("A", "P", "A0");
    w.commit("B"); const c1 = await w.run("B", "P", "B0");
    check("cycle 1: one push", c1.push === "sent" && w.stevenPushes.length === 1);
    // a repeat request in the same cycle is a duplicate…
    const dup = await w.run("B", "P", "B0-again");
    check("cycle 1: a repeat is a duplicate", dup.push === "skipped_duplicate" && w.stevenPushes.length === 1);
    // …owner reopens A (הושלם → פעיל): cycle over, row released; project stays as the owner has it
    await w.reopen("A");
    check("reopen releases the project's request row", w.rows.size === 0);
    const whileOpen = await w.run("B", "P", "B1");           // B "completes" again while A is open → not last
    check("while A is open again nothing is requested", whileOpen.projectSync === "other_open_work" && w.rows.size === 0 && w.stevenPushes.length === 1);
    // cycle 2: A completes again
    w.projects.P.endDate = "2026-09-01";                       // the project kept its cycle-1 end_date
    w.commit("A"); const c2 = await w.run("A", "P", "A2");
    check("cycle 2 (הושלם → פעיל → הושלם): a NEW request + push", c2.push === "sent" && w.stevenPushes.length === 2 && w.ownerConfirms() === 2);
    check("cycle 2: the project was already הושלם → no-op, end_date NOT re-stamped", c2.projectSync === "already_completed" && w.projects.P.endDate === "2026-09-01");
    check("cycle 2: a fresh request row exists for the project", w.rows.size === 1 && (w.rows.get(finalFilesRequestedProjectKey("P")) as { workId: string })?.workId === "A");
    // cycle 3, and this time the owner had also moved the project back to "בעבודה"
    await w.reopen("B");
    w.projects.P.status = "בעבודה"; w.projects.P.endDate = null;
    w.commit("B"); const c3 = await w.run("B", "P", "B3");
    check("cycle 3: request + push again, and the reopened project is completed again with a fresh end_date",
      c3.push === "sent" && w.stevenPushes.length === 3 && c3.projectSync === "updated" && w.projects.P.endDate === TODAY);
  }
  {
    // the same double-completion race, but in cycle 2 (after a reopen released the row)
    const w = makeWorld({
      projects: { P: { status: "בעבודה", endDate: null } },
      works: { A: { projectId: "P", status: "בתהליך" }, B: { projectId: "P", status: "בתהליך" } },
    });
    await runOrder(w, ["c:A", "c:B", "l:A", "l:B"], ["A", "B"], 11);
    check("cycle 1 (concurrent): one push", w.stevenPushes.length === 1);
    await w.reopen("A"); await w.reopen("B");
    const outs = await runOrder(w, ["c:B", "c:A", "l:B", "l:A"], ["A", "B"], 12);
    check("cycle 2 (concurrent again after a reopen): exactly ONE more push, ONE more confirmation",
      w.stevenPushes.length === 2 && w.ownerConfirms() === 2 && w.rows.size === 1 && outs.filter((o) => o.finalFilesRequested).length === 1,
      `pushes ${w.stevenPushes.length}, confirms ${w.ownerConfirms()}`);
  }
  {
    // a new OPEN Steven work created on a finished project also ends the previous cycle
    const w = makeWorld({ projects: { P: { status: "בעבודה", endDate: null } }, works: { A: { projectId: "P", status: "אושר" } } });
    await w.run("A", "P", "A0");
    check("cycle 1 done: request row + one push", w.rows.size === 1 && w.stevenPushes.length === 1);
    w.works.C = { projectId: "P", status: "לא נשלח" };                      // owner sends Steven a new job on the same project
    await releaseStevenFinalFilesRequest({ id: "C", projectId: "P" }, w.deps);   // what createSoundEngineerWork does
    check("creating a new open Steven work releases the row", w.rows.size === 0);
    w.commit("C"); const out = await w.run("C", "P", "C0");
    check("the new work's completion is a NEW cycle: request + push", out.push === "sent" && w.stevenPushes.length === 2);
  }
  {
    // WITHOUT the release the second completion would be swallowed — this is what the hooks prevent
    const w = makeWorld({ projects: { P: { status: "בעבודה", endDate: null } }, works: { A: { projectId: "P", status: "אושר" }, C: { projectId: "P", status: "אושר" } } });
    await w.run("A", "P", "A0");
    const swallowed = await w.run("C", "P", "C0");
    check("(documents why the hooks exist) no release ⇒ the next request is a duplicate", swallowed.push === "skipped_duplicate" && w.stevenPushes.length === 1);
  }
  {
    const w = makeWorld({
      projects: { P1: { status: "בעבודה", endDate: null }, P2: { status: "בעבודה", endDate: null } },
      works: { A: { projectId: "P1", status: "אושר" }, B: { projectId: "P2", status: "אושר" }, S: { projectId: null, status: "אושר" } },
    });
    await w.run("A", "P1"); await w.run("B", "P2"); await w.run("S", null, "U0", "Standalone");
    check("three independent requests exist (two projects + one standalone work)", w.rows.size === 3 && w.stevenPushes.length === 3);
    await releaseStevenFinalFilesRequest({ id: "A", projectId: "P1" }, w.deps);
    check("releasing project P1 touches ONLY P1's row", w.rows.size === 2 && !w.rows.has(finalFilesRequestedProjectKey("P1")) && w.rows.has(finalFilesRequestedProjectKey("P2")) && w.rows.has(finalFilesRequestedKey("S")));
    await releaseStevenFinalFilesRequest({ id: "S", projectId: null }, w.deps);
    check("releasing a standalone work touches ONLY its own work-scoped row", w.rows.size === 1 && w.rows.has(finalFilesRequestedProjectKey("P2")));
    const again = await w.run("S", null, "U9", "Standalone");
    check("a standalone work can be re-requested after its own reopen", again.push === "sent" && w.stevenPushes.length === 4);
  }
  {
    const w = makeWorld({ projects: { P: { status: "בעבודה", endDate: null } }, works: { A: { projectId: "P", status: "אושר" } }, failRelease: true });
    await w.run("A", "P", "A0");
    w.works.A.status = "בתהליך";
    await releaseStevenFinalFilesRequest({ id: "A", projectId: "P" }, w.deps);
    check("a release failure is logged LOUDLY (a stale row would swallow the next request) and never thrown",
      w.errors.some((e) => /COULD NOT RELEASE/.test(e)) && w.rows.size === 1);
  }

  console.log("\n— CYCLE-AWARE FINAL FILES: a final file satisfies only the CURRENT request —");
  const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
  const reqAt = (w: World, key: string) => Date.parse((w.rows.get(key) as { at: string }).at);
  {
    // 1. No final files → completion → Push + Blur
    const w = makeWorld({ projects: { P: { status: "בעבודה", endDate: null } }, works: { A: { projectId: "P", status: "בתהליך" } } });
    w.commit("A"); const out = await w.run("A", "P");
    check("1. no final files → completion → ONE push", out.push === "sent" && w.stevenPushes.length === 1);
    check("1. …and the Blur is on (requested, nothing uploaded)", w.blur("A"));
    check("1. the request time is the row's value.at (ISO, the injected clock)", (w.rows.get(finalFilesRequestedProjectKey("P")) as { at: string }).at === new Date(w.clock.t).toISOString());
  }
  {
    // 2. An OLD final file exists before the request → completion → Push + Blur still appear
    const w = makeWorld({ projects: { P: { status: "בעבודה", endDate: null } }, works: { A: { projectId: "P", status: "בתהליך" } } });
    w.clock.t -= DAY; w.upload("A"); w.clock.t += DAY;            // yesterday's final file
    w.commit("A"); const out = await w.run("A", "P");
    check("2. old final file before the request → the push is STILL sent", out.push === "sent" && w.stevenPushes.length === 1);
    check("2. …and the Blur is STILL on (the old file does not satisfy the new request)", w.blur("A") && !w.flags().hasCurrentFinalFiles.has("A"));
    check("2. the old file is left exactly as it was (not deleted, not marked)", w.files.length === 1 && w.files[0].created_at === new Date(w.clock.t - DAY).toISOString());
  }
  {
    // 3 + 4. A final file uploaded AFTER the request → Blur goes away, and stays away when the modal is re-opened
    const w = makeWorld({ projects: { P: { status: "בעבודה", endDate: null } }, works: { A: { projectId: "P", status: "בתהליך" } } });
    w.commit("A"); await w.run("A", "P");
    check("3. before the upload: Blur on", w.blur("A"));
    w.advance(20 * MIN); w.upload("A");
    check("3. a final file uploaded AFTER the request → Blur gone", !w.blur("A") && w.flags().hasCurrentFinalFiles.has("A"));
    // "close and re-open the modal" = the list is re-read from the server: the flags are a pure function of stored rows
    const first = w.blur("A"); w.advance(3 * HOUR);
    check("4. closing and re-opening the modal later → the Blur does NOT come back (server-derived, no local state needed)", !first && !w.blur("A"));
    check("4. …the request row is still there (only the flag changed, nothing was written)", w.rows.size === 1);
  }
  {
    // 5 + 6 + 7. Reopen → the row is released; the next completion is a NEW cycle with a NEW request time
    const w = makeWorld({ projects: { P: { status: "בעבודה", endDate: null } }, works: { A: { projectId: "P", status: "בתהליך" } } });
    w.commit("A"); await w.run("A", "P", "U0");                    // cycle 1, 10:00
    const at1 = reqAt(w, finalFilesRequestedProjectKey("P"));
    w.advance(20 * MIN); w.upload("A");                             // 10:20 — cycle 1 satisfied
    check("(cycle 1 satisfied)", !w.blur("A") && w.stevenPushes.length === 1);
    w.advance(DAY);                                                 // a day later the job is reopened for fixes
    await w.reopen("A");
    check("5. reopen → the OLD request row is released", w.rows.size === 0);
    check("5. …and yesterday's final file is untouched", w.files.length === 1);
    w.advance(5 * HOUR);                                            // and finished again at "15:00"
    w.commit("A"); const c2 = await w.run("A", "P", "U1");
    const at2 = reqAt(w, finalFilesRequestedProjectKey("P"));
    check("6. second completion → a NEW request row with a NEW, later timestamp", w.rows.size === 1 && at2 > at1, `${at1} → ${at2}`);
    check("6. exactly ONE new push (2 in total)", c2.push === "sent" && w.stevenPushes.length === 2 && w.ownerConfirms() === 2);
    check("6. the push goes out even though final files from the previous cycle exist", w.stevenPushes[1]?.title === "Project completed" && w.files.length === 1);
    check("6. the previous cycle's file does NOT count for the new request → Blur on", w.blur("A") && !w.flags().hasCurrentFinalFiles.has("A"));
    w.advance(10 * MIN); w.upload("A");
    check("7. a NEW final file after the new request → Blur gone", !w.blur("A") && w.flags().hasCurrentFinalFiles.has("A"));
    check("7. both cycles' files are kept (2 rows), nothing was deleted", w.files.length === 2);
    // cycle 3
    await w.reopen("A"); w.advance(DAY); w.commit("A"); const c3 = await w.run("A", "P", "U2");
    check("cycle 3: one more push (3 in total); both older files ignored → Blur on again", c3.push === "sent" && w.stevenPushes.length === 3 && w.blur("A") && w.files.length === 2);
  }
  {
    // 8 + 9. Two works of one project finish together in cycle 2, with cycle-1 files present
    const w = makeWorld({
      projects: { P: { status: "בעבודה", endDate: null } },
      works: { A: { projectId: "P", status: "בתהליך" }, B: { projectId: "P", status: "בתהליך" } },
    });
    await runOrder(w, ["c:A", "c:B", "l:A", "l:B"], ["A", "B"], 21);          // cycle 1, concurrent
    check("(cycle 1, concurrent) one push, one request row", w.stevenPushes.length === 1 && w.rows.size === 1);
    w.advance(20 * MIN); w.upload("A");                                       // cycle-1 file, via Work A
    check("(cycle 1) Work A's upload satisfies BOTH works", !w.blur("A") && !w.blur("B"));
    w.advance(DAY); await w.reopen("A"); await w.reopen("B");
    w.advance(5 * HOUR);
    const outs = await runOrder(w, ["c:B", "c:A", "l:B", "l:A"], ["A", "B"], 22);   // cycle 2, concurrent again
    const at2 = reqAt(w, finalFilesRequestedProjectKey("P"));
    check("8. two works finishing together → ONE request row, ONE request timestamp", w.rows.size === 1 && at2 === w.clock.t && outs.filter((o) => o.finalFilesRequested).length === 1);
    check("8. …ONE push (2 in total) and ONE owner confirmation for the cycle", w.stevenPushes.length === 2 && w.ownerConfirms() === 2 && w.ownerFailures() === 0);
    check("8. the cycle-1 file does not count for either work → one logical Blur, seen from both works", w.blur("A") && w.blur("B"));
    w.advance(5 * MIN); w.upload("A");
    check("9. Work A uploads after the request → Work B of the same project sees the request as already satisfied", !w.blur("B") && w.flags().hasCurrentFinalFiles.has("B") && !w.blur("A"));
    check("9. …and nothing was deleted (2 files kept)", w.files.length === 2);
  }
  {
    // 10. Standalone work (no project_id): the same behaviour, keyed by work_id
    const w = makeWorld({ projects: {}, works: { S: { projectId: null, status: "בתהליך" }, O: { projectId: null, status: "בתהליך" } } });
    w.commit("S"); const c1 = await w.run("S", null, "U0", "Standalone job");
    check("10. standalone: request row is work-scoped, push sent, Blur on", c1.push === "sent" && w.rows.has(finalFilesRequestedKey("S")) && w.blur("S"));
    w.advance(10 * MIN); w.upload("O");
    check("10. …another standalone work's file does NOT satisfy it (work_id, not a shared scope)", w.blur("S"));
    w.advance(10 * MIN); w.upload("S");
    check("10. …its own file after the request does", !w.blur("S"));
    w.advance(DAY); await w.reopen("S"); w.advance(HOUR); w.commit("S"); const c2 = await w.run("S", null, "U1", "Standalone job");
    check("10. reopen → new cycle: new push, and the earlier file no longer satisfies it → Blur on", c2.push === "sent" && w.stevenPushes.length === 2 && w.blur("S"));
    w.advance(MIN); w.upload("S");
    check("10. a new file after the new request → Blur gone; the older files are all still there", !w.blur("S") && w.files.length === 3);
  }
  {
    // edge cases of the comparison itself
    const w = makeWorld({ projects: { P: { status: "בעבודה", endDate: null } }, works: { A: { projectId: "P", status: "אושר" }, X: { projectId: "Q", status: "אושר" } } });
    await w.run("A", "P");
    w.upload("A");                                                            // stamped at EXACTLY the request instant
    check("a file stamped at exactly the request instant does not satisfy it (strict >)", w.blur("A"));
    w.advance(1); w.files.length = 0; w.upload("A");
    check("…one millisecond later it does", !w.blur("A"));
    w.files.length = 0; w.advance(MIN); w.works.Q = { projectId: "Q", status: "אושר" }; w.upload("X");
    check("a final file of ANOTHER project never satisfies this project's request", w.blur("A"));
    // CLOCK SKEW (request time = app clock, file time = DB clock): measured skew is < ~0.1 s, and a
    // real upload lands seconds after the request. Strict `>` with no tolerance must be safe both ways.
    {
      const c = makeWorld({ projects: { P: { status: "בעבודה", endDate: null } }, works: { A: { projectId: "P", status: "אושר" } } });
      await c.run("A", "P");
      const at = c.clock.t;
      const put = (deltaMs: number) => { c.files.length = 0; c.files.push({ work_id: "A", project_id: "P", created_at: new Date(at + deltaMs).toISOString() }); return !c.blur("A"); };
      check("skew: the app clock runs 100 ms AHEAD of the DB, upload lands 3 s after the request → still recognised as new", put(3000 - 100));
      check("skew: even a 2× worse 200 ms of skew, upload 2 s after → still recognised", put(2000 - 200));
      check("skew: the app clock runs 100 ms BEHIND the DB, upload 3 s after → recognised", put(3000 + 100));
      check("no tolerance: a file stamped 500 ms BEFORE the request (previous cycle, quick reopen → re-complete) is NOT new", !put(-500));
      check("no tolerance: …nor 1 s, nor 5 s before", !put(-1000) && !put(-5000));
      check("the first instant after the request counts", put(1));
    }
    // an early upload in the same cycle (before the request) does NOT count — the request time is what matters
    const e = makeWorld({ projects: { P: { status: "בעבודה", endDate: null } }, works: { A: { projectId: "P", status: "בתהליך" }, B: { projectId: "P", status: "בתהליך" } } });
    e.upload("A"); e.advance(5 * MIN);                                         // Steven uploaded via A while B was still open
    e.commit("A"); await e.run("A", "P"); e.commit("B"); await e.run("B", "P");
    check("an upload made BEFORE the request (even earlier in the same working period) does not satisfy it → Blur on", e.blur("A") && e.blur("B"));
    // unreadable request time → fail closed (never a wrong Blur)
    const g = computeFinalFilesFlags([{ id: "A", projectId: "P" }], { finalRows: [], requestRows: [{ key: finalFilesRequestedProjectKey("P"), value: { workId: "A" } }] });
    check("a request row whose value.at is missing/unreadable fails CLOSED (requested, but counted as satisfied → no Blur)", g.finalFilesRequested.has("A") && g.hasCurrentFinalFiles.has("A"));
    check("parseRequestAt: ISO ok; junk / missing → null", parseRequestAt({ at: "2026-09-18T10:00:00.000Z" }) === Date.UTC(2026, 8, 18, 10) && parseRequestAt({ at: "nope" }) === null && parseRequestAt(null) === null && parseRequestAt({}) === null);
    // no request row → nothing to satisfy, never a Blur (a legacy completed project)
    const h = computeFinalFilesFlags([{ id: "A", projectId: "P" }], { finalRows: [{ work_id: "A", project_id: "P", created_at: "2026-01-01T00:00:00.000Z" }], requestRows: [] });
    check("a legacy completed project with no request row: not requested, never blurred", h.finalFilesRequested.size === 0);
    // a work-scoped row on a project-linked work is ignored; project-linked works read the project's row
    const k = computeFinalFilesFlags([{ id: "A", projectId: "P" }], { finalRows: [], requestRows: [{ key: finalFilesRequestedKey("A"), value: { at: "2026-09-18T10:00:00.000Z" } }] });
    check("a stray work-scoped row on a project-linked work is ignored", k.finalFilesRequested.size === 0);
  }

  console.log("\n— FOCUS STATE VISIBILITY: Steven AND the owner (no role gating) —");
  {
    // The server truth is shared; each VIEWER keeps its own local UI state (opening the modal = fresh local state).
    type Viewer = { role: "owner" | "steven"; fresh: boolean; dismissed: boolean; finalUploaded: boolean };
    const open = (role: Viewer["role"]): Viewer => ({ role, fresh: true, dismissed: false, finalUploaded: false });
    const uiStatus = (db: string) => (db === "אושר" ? "הושלם" : db === "לא נשלח" ? "לא התחיל" : "פעיל");
    const shows = (w: World, v: Viewer, id: string) => {
      const f = w.flags();
      return finalFilesFocusVisible({
        fresh: v.fresh, dismissed: v.dismissed, finalUploaded: v.finalUploaded, uiStatus: uiStatus(w.works[id].status),
        finalFilesRequested: f.finalFilesRequested.has(id), hasCurrentFinalFiles: f.hasCurrentFinalFiles.has(id),
      });
    };
    const w = makeWorld({
      projects: { P: { status: "בעבודה", endDate: null }, Q: { status: "בעבודה", endDate: null }, L: { status: "הושלם", endDate: "2026-01-05" } },
      works: { A: { projectId: "P", status: "בתהליך" }, N: { projectId: "Q", status: "בתהליך" }, O: { projectId: "L", status: "אושר" } },
    });
    w.commit("A"); await w.run("A", "P");                                       // A completes → request row for project P

    const owner = open("owner"), steven = open("steven");
    check("1. Owner opens a completed job with no final files → Blur", shows(w, owner, "A"));
    check("2. Steven opens the same job → Blur", shows(w, steven, "A"));
    const before = JSON.stringify([...w.rows]) + "|" + w.files.length;
    owner.dismissed = true;                                                     // the owner clicks the blurred area
    check("3. Owner dismisses → it goes away for the owner", !shows(w, owner, "A"));
    check("4. …and Steven STILL sees it (dismissal is local to each viewer)", shows(w, steven, "A"));
    check("3/4. dismissing writes nothing (request row and files untouched)", JSON.stringify([...w.rows]) + "|" + w.files.length === before);
    const ownerAgain = open("owner");                                           // owner closes and re-opens the modal
    check("5. Owner closes and re-opens → the Blur is back (nothing was persisted)", shows(w, ownerAgain, "A"));
    steven.dismissed = true;
    check("5b. Steven dismissing does not affect the owner's view either", shows(w, ownerAgain, "A") && !shows(w, steven, "A"));

    // Owner uploads through the same flow → only a file AFTER the request lifts it, for BOTH
    const ownerUploader: Viewer = { ...open("owner"), finalUploaded: true };
    check("(local) right after an upload in THIS session the uploader's Blur is gone even before the list catches up", !shows(w, ownerUploader, "A") && shows(w, open("steven"), "A"));
    w.advance(10 * MIN); w.upload("A");
    check("6. A new final file (after the request) uploaded → Blur gone for the OWNER", !shows(w, open("owner"), "A"));
    check("6. …and for STEVEN", !shows(w, open("steven"), "A"));
    w.advance(3 * HOUR);
    check("7. a further open → it does not come back, for either", !shows(w, open("owner"), "A") && !shows(w, open("steven"), "A"));

    check("8. an ACTIVE job → no Blur, for either", !shows(w, open("owner"), "N") && !shows(w, open("steven"), "N"));
    check("9. an OLD completed job with no request row → no Blur, for either", !shows(w, open("owner"), "O") && !shows(w, open("steven"), "O"));

    // a job the owner just completed from the table: the local list has never seen the request row
    const stale = finalFilesFocusVisible({ fresh: false, dismissed: false, finalUploaded: false, uiStatus: "הושלם", finalFilesRequested: true, hasCurrentFinalFiles: false });
    const staleFlags = finalFilesFocusVisible({ fresh: true, dismissed: false, finalUploaded: false, uiStatus: "הושלם", finalFilesRequested: false, hasCurrentFinalFiles: false });
    const refreshed = finalFilesFocusVisible({ fresh: true, dismissed: false, finalUploaded: false, uiStatus: "הושלם", finalFilesRequested: true, hasCurrentFinalFiles: false });
    check("not shown until the server refresh has landed (stale list is never trusted)", !stale && !staleFlags && refreshed);

    // a new cycle is seen by both again, even though last cycle's file exists
    await w.reopen("A"); w.advance(DAY); w.commit("A"); await w.run("A", "P", "U9");
    check("a new cycle (reopen → complete again): both see the Blur again despite last cycle's file", shows(w, open("owner"), "A") && shows(w, open("steven"), "A"));

    check("the decision has NO role input at all (structural: one object param, no role/isSteven/isOwner in it)",
      finalFilesFocusVisible.length === 1 && !/isSteven|isOwner|role/i.test(finalFilesFocusVisible.toString()));
  }

  console.log("\n— keys / texts —");
  check("project request key", finalFilesRequestedProjectKey("P1") === "steven_final_files_requested_project:P1");
  check("work request key (standalone)", finalFilesRequestedKey("W1") === "steven_final_files_requested:W1");
  check("finalFilesRequestKeyFor: project-linked → project key; standalone → work key",
    finalFilesRequestKeyFor({ id: "W1", projectId: "P1" }) === "steven_final_files_requested_project:P1" && finalFilesRequestKeyFor({ id: "W1", projectId: null }) === "steven_final_files_requested:W1");
  check("the two key families never parse as each other",
    workIdFromRequestedKey("steven_final_files_requested_project:P1") === null && projectIdFromRequestedKey("steven_final_files_requested:W1") === null);
  check("keys round-trip, unrelated keys → null",
    workIdFromRequestedKey("steven_final_files_requested:W1") === "W1" && projectIdFromRequestedKey("steven_final_files_requested_project:P1") === "P1" &&
    workIdFromRequestedKey("steven_upload_pending_W1") === null && projectIdFromRequestedKey("steven_upload_pending_W1") === null);
  check("empty name still reads sensibly", buildStevenPush("W1", "  ", "U0").body === "Please upload the final files." && buildOwnerConfirmPush("W1", "").body.startsWith("נשלחה ל-Steven התראה שהפרויקט הושלם"));
  check("owner failure notice without a name", buildOwnerPushFailedPush("W1", "", "send_failed").body.startsWith("לא ניתן היה לשלוח ל-Steven התראה."));
  check("sync-failure notice without a name", buildOwnerProjectSyncFailedPush("W1", "").body === "העבודה של Steven סומנה כהושלמה, אך לא ניתן היה לעדכן את סטטוס הפרויקט.");

  console.log(`\n${fail === 0 ? "✓ ALL PASS" : "✗ FAILURES"} — ${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
