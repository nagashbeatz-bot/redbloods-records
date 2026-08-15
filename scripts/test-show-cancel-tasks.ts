/**
 * Plain assert-and-print test for lib/show-cancel-tasks-pure.ts — no DB.
 * Matches this repo's existing scripts/test-*.ts convention.
 * Run: npx tsx scripts/test-show-cancel-tasks.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { selectShowTasksToCancel, type CancellableTask } from "../lib/show-cancel-tasks-pure";

let pass = 0;
let fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; }
  else { fail++; console.error(`FAIL: ${label}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`); }
}

const BRAZIA = "11111111-1111-1111-1111-111111111111";
const OTHER  = "22222222-2222-2222-2222-222222222222";

const t = (id: string, status: string, show_id: string | null): CancellableTask => ({ id, status, show_id });

// ── Only "פתוח" is selected ───────────────────────────────────────────────────
check(
  "open task of this show → selected",
  selectShowTasksToCancel([t("a", "פתוח", BRAZIA)], BRAZIA),
  ["a"],
);
check(
  "already בוצע → never touched",
  selectShowTasksToCancel([t("a", "בוצע", BRAZIA)], BRAZIA),
  [],
);
check(
  "already בוטל → never churned",
  selectShowTasksToCancel([t("a", "בוטל", BRAZIA)], BRAZIA),
  [],
);

// ── Other shows' tasks are never touched ──────────────────────────────────────
check(
  "open task of a DIFFERENT show → not selected",
  selectShowTasksToCancel([t("a", "פתוח", OTHER)], BRAZIA),
  [],
);
check(
  "unlinked task (show_id null) → not selected",
  selectShowTasksToCancel([t("a", "פתוח", null)], BRAZIA),
  [],
);

// ── Mixed set: exactly the open + same-show rows, in input order ──────────────
check(
  "mixed set → only open rows of this show",
  selectShowTasksToCancel(
    [
      t("dj",      "פתוח", BRAZIA),   // "לסגור דיג׳יי" — the Brazia case
      t("quote",   "פתוח", BRAZIA),   // quote follow-up, same show
      t("done",    "בוצע", BRAZIA),   // terminal — skip
      t("foreign", "פתוח", OTHER),    // another show — skip
      t("loose",   "פתוח", null),     // no link — skip
    ],
    BRAZIA,
  ),
  ["dj", "quote"],
);

// ── Degenerate inputs ─────────────────────────────────────────────────────────
check("empty task list", selectShowTasksToCancel([], BRAZIA), []);
check("empty showId → selects nothing", selectShowTasksToCancel([t("a", "פתוח", BRAZIA)], ""), []);

// ── Guard: the cancel path must never delete a task ───────────────────────────
{
  const src = readFileSync(join(__dirname, "..", "lib", "show-cancel-tasks.ts"), "utf8");
  check("wrapper never imports deleteTask", src.includes("deleteTask"), false);
  check("wrapper never calls .delete(",     src.includes(".delete("),   false);
  check("wrapper only writes status בוטל",  src.includes('status: "בוטל"'), true);
}

// ── Guard: the route wires this ONLY into the בוטל branch ─────────────────────
{
  const route = readFileSync(join(__dirname, "..", "app", "api", "shows", "[id]", "route.ts"), "utf8");
  const call  = "cancelOpenShowTasks(id)";
  check("route calls the helper exactly once", route.split(call).length - 1, 1);
  // The call must sit after `show.status === "בוטל"` and before the confirmed
  // branch — i.e. inside the cancel branch only. Anchor on the `else if` (a
  // bare `isConfirmedShowStatus(...)` also appears earlier, in the finance block).
  const cancelBranch  = route.indexOf('show.status === "בוטל"');
  const confirmBranch = route.indexOf("else if (isConfirmedShowStatus(show.status))");
  const callAt        = route.indexOf(call);
  check("confirmed branch anchor found", confirmBranch > 0, true);
  check("helper sits inside the cancel branch", cancelBranch < callAt && callAt < confirmBranch, true);
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
