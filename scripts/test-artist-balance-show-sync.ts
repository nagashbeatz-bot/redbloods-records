/**
 * Plain assert-and-print test for lib/artist-balance-show-sync-pure.ts —
 * no DB, no push, matches this repo's existing scripts/test-*.ts convention
 * (no jest/vitest in this project). Run: npx tsx scripts/test-artist-balance-show-sync.ts
 */
import {
  singleArtistToken,
  AUTO_SYNC_ENTRY_TYPE,
  decideSyncAction,
  decideRemovalAction,
} from "../lib/artist-balance-show-sync-pure";

let pass = 0;
let fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; }
  else { fail++; console.error(`FAIL: ${label}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`); }
}

// ── singleArtistToken ────────────────────────────────────────────────────────
check("solo artist", singleArtistToken("שליו טסמה"), "שליו טסמה");
check("solo artist, extra whitespace", singleArtistToken("  שליו טסמה  "), "שליו טסמה");
check("collab (comma)", singleArtistToken("שליו טסמה, אמן אחר"), null);
check("collab (Arabic comma)", singleArtistToken("שליו טסמה،אמן אחר"), null);
check("collab (semicolon)", singleArtistToken("שליו טסמה;אמן אחר"), null);
check("empty string", singleArtistToken(""), null);
check("null", singleArtistToken(null), null);
check("undefined", singleArtistToken(undefined), null);
check("whitespace only", singleArtistToken("   "), null);
check("trailing delimiter collapses to one token", singleArtistToken("שליו טסמה,"), "שליו טסמה");

// ── AUTO_SYNC_ENTRY_TYPE ────────────────────────────────────────────────────
// The automatic sync ALWAYS targets this single type — payment_status (שולם
// vs צפוי) never changes what the automatic path writes. Promotion to
// "הכנסות" is manual-only ("סמן כהתקבל" on the balance page).
check("automatic sync always targets הכנסות צפויות", AUTO_SYNC_ENTRY_TYPE, "הכנסות צפויות");

// ── decideSyncAction ──────────────────────────────────────────────────────────
check("no existing row → insert", decideSyncAction(null), { action: "insert" });
check("existing still-expected row → update", decideSyncAction({ id: "e1", entry_type: "הכנסות צפויות" }), { action: "update", entryId: "e1" });
check("existing already-received (manually confirmed) row → skip (frozen)", decideSyncAction({ id: "e2", entry_type: "הכנסות" }), { action: "skip_already_received" });
check("existing manual unrelated type still updatable (not הכנסות)", decideSyncAction({ id: "e3", entry_type: "הוצאות" }), { action: "update", entryId: "e3" });

// ── decideRemovalAction ────────────────────────────────────────────────────────
check("nothing synced → none", decideRemovalAction(null), { action: "none" });
check("synced + still expected → delete", decideRemovalAction({ id: "e4", entry_type: "הכנסות צפויות" }), { action: "delete", entryId: "e4" });
check("synced + already received (manually confirmed) → keep_received", decideRemovalAction({ id: "e5", entry_type: "הכנסות" }), { action: "keep_received" });

// ── Scenario walk-throughs matching the approved QA checklist ────────────────
{
  // 1) New show, transaction marked שולם → automatic sync still only inserts
  //    "הכנסות צפויות" (AUTO_SYNC_ENTRY_TYPE never varies with payment_status).
  const d1 = decideSyncAction(null);
  check("QA: new show, tx already שולם → still inserts as הכנסות צפויות", d1, { action: "insert" });
  check("QA: the value that would be written is הכנסות צפויות regardless of payment_status", AUTO_SYNC_ENTRY_TYPE, "הכנסות צפויות");

  // 2) New show, transaction צפוי → same insert, same type.
  const d2 = decideSyncAction(null);
  check("QA: new show, tx צפוי → inserts as הכנסות צפויות", d2, { action: "insert" });

  // 3) Retry / re-sync while still expected → updates the SAME row, no duplicate.
  const d3 = decideSyncAction({ id: "row-1", entry_type: "הכנסות צפויות" });
  check("QA: amount/date/name change while still expected → update same row, no duplicate", d3, { action: "update", entryId: "row-1" });

  // 4) Manual "סמן כהתקבל" flips the row to הכנסות OUTSIDE this sync (the balance
  //    page's own action, not modeled here) — after that, any further automatic
  //    sync attempt must freeze, never touch it again.
  const d4 = decideSyncAction({ id: "row-1", entry_type: "הכנסות" });
  check("QA: show edit after manual סמן כהתקבל → frozen, no update, no new צפויה row", d4, { action: "skip_already_received" });

  // 5) Cancel/delete while still expected → the exact synced row is removed.
  const d5 = decideRemovalAction({ id: "row-1", entry_type: "הכנסות צפויות" });
  check("QA: cancel/delete while still expected → delete", d5, { action: "delete", entryId: "row-1" });

  // 6) Cancel/delete after manual סמן כהתקבל → kept as paid history, never touched.
  const d6 = decideRemovalAction({ id: "row-1", entry_type: "הכנסות" });
  check("QA: cancel/delete after manual סמן כהתקבל → kept, not deleted/changed", d6, { action: "keep_received" });

  // 7) Backfilled rows (פאצ'ה / סאמר טיים) already הכנסות — any future re-sync
  //    attempt on them must be a frozen no-op, never a duplicate, never reverted.
  const d7 = decideSyncAction({ id: "backfill-1", entry_type: "הכנסות" });
  check("QA: פאצ'ה/סאמר טיים re-sync → frozen no-op (stay הכנסות, no duplicate)", d7, { action: "skip_already_received" });

  // 8) A collab show (2 tokens) never resolves to a single artist → caller must skip before even reaching decideSyncAction.
  check("QA: collab show artist field never yields a single token", singleArtistToken("שליו טסמה, אמן אחר"), null);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
