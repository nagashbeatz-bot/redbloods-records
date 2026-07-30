/**
 * Plain assert-and-print test for lib/artist-balance-show-sync-pure.ts —
 * no DB, no push, matches this repo's existing scripts/test-*.ts convention
 * (no jest/vitest in this project). Run: npx tsx scripts/test-artist-balance-show-sync.ts
 */
import {
  singleArtistToken,
  desiredEntryTypeFor,
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

// ── desiredEntryTypeFor ───────────────────────────────────────────────────────
check("paid → הכנסות", desiredEntryTypeFor("שולם"), "הכנסות");
check("expected → הכנסות צפויות", desiredEntryTypeFor("צפוי"), "הכנסות צפויות");
check("cancelled (defensive — caller should never pass this) → הכנסות צפויות", desiredEntryTypeFor("בוטל"), "הכנסות צפויות");

// ── decideSyncAction ──────────────────────────────────────────────────────────
check("no existing row → insert", decideSyncAction(null), { action: "insert" });
check("existing still-expected row → update", decideSyncAction({ id: "e1", entry_type: "הכנסות צפויות" }), { action: "update", entryId: "e1" });
check("existing already-received row → skip (frozen)", decideSyncAction({ id: "e2", entry_type: "הכנסות" }), { action: "skip_already_received" });
check("existing manual unrelated type still updatable (not הכנסות)", decideSyncAction({ id: "e3", entry_type: "הוצאות" }), { action: "update", entryId: "e3" });

// ── decideRemovalAction ────────────────────────────────────────────────────────
check("nothing synced → none", decideRemovalAction(null), { action: "none" });
check("synced + still expected → delete", decideRemovalAction({ id: "e4", entry_type: "הכנסות צפויות" }), { action: "delete", entryId: "e4" });
check("synced + already received → keep_received", decideRemovalAction({ id: "e5", entry_type: "הכנסות" }), { action: "keep_received" });

// ── Scenario walk-throughs matching the approved QA checklist ────────────────
{
  // 1) Fresh show, unpaid → first sync call finds nothing → insert.
  const d1 = decideSyncAction(null);
  check("QA: create show with unpaid artist fee → insert", d1.action, "insert");

  // 2) Retry (e.g. concurrent/duplicate call) after the row now exists, still expected → update, not a second insert.
  const d2 = decideSyncAction({ id: "row-1", entry_type: "הכנסות צפויות" });
  check("QA: retry after row exists (still expected) → update same row, no duplicate", d2, { action: "update", entryId: "row-1" });

  // 3) Show marked paid → type flips to הכנסות via update (row still existed as expected).
  const d3 = decideSyncAction({ id: "row-1", entry_type: "הכנסות צפויות" });
  check("QA: payment marked שולם while still expected → update allowed (will set type=הכנסות)", d3.action, "update");

  // 4) Further edits after already הכנסות → frozen, never reverts.
  const d4 = decideSyncAction({ id: "row-1", entry_type: "הכנסות" });
  check("QA: further show edit after already הכנסות → frozen, no update", d4, { action: "skip_already_received" });

  // 5) Cancel/delete while still expected → the exact row is removed.
  const d5 = decideRemovalAction({ id: "row-1", entry_type: "הכנסות צפויות" });
  check("QA: cancel/delete while still expected → delete", d5, { action: "delete", entryId: "row-1" });

  // 6) Cancel/delete after already received → kept as paid history.
  const d6 = decideRemovalAction({ id: "row-1", entry_type: "הכנסות" });
  check("QA: cancel/delete after already received → kept, not deleted", d6, { action: "keep_received" });

  // 7) Backfilled rows (פאצ'ה / סאמר טיים) already הכנסות — a future re-sync must be a no-op, not a duplicate.
  const d7 = decideSyncAction({ id: "backfill-1", entry_type: "הכנסות" });
  check("QA: backfill row re-sync → frozen no-op (never duplicated, never reverted)", d7, { action: "skip_already_received" });

  // 8) A collab show (2 tokens) never resolves to a single artist → caller must skip before even reaching decideSyncAction.
  check("QA: collab show artist field never yields a single token", singleArtistToken("שליו טסמה, אמן אחר"), null);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
