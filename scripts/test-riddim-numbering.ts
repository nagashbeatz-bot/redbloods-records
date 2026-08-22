/**
 * Standalone smoke test for lib/riddim-numbering-pure.ts — the per-mix-line
 * numbering / 409 / file-naming decisions behind lib/mix-version-upload.ts.
 *
 * Run with:   npx tsx scripts/test-riddim-numbering.ts
 *
 * Imports ONLY the pure module (no "server-only", no Supabase, no Dropbox), so
 * nothing here touches production. The two things it exists to prove:
 *   1. a riddim numbers each line independently — Tasama Mix 1, Desto Mix 1 and
 *      Instrumental Mix 1 coexist, and one line's history never pushes another
 *      line's first upload past Mix 1, nor makes it 409;
 *   2. a NON-riddim work behaves exactly as it did before the feature.
 */
import {
  labelsInScope,
  fileNamesInScope,
  nextMixLabel,
  isLabelTaken,
  versionNameParts,
  type VersionRow,
} from "../lib/riddim-numbering-pure";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}

const TASAMA = "tgt-tasama", DESTO = "tgt-desto", INST = "tgt-instrumental";

/** The shape of the Dancehall School work once it has real riddim data. */
const riddimRows: VersionRow[] = [
  // 4 pre-feature rows — no line at all
  { label: "Mix 1", fileName: "דאנסהול סקול Mix 1 Instrumental.wav", mixTargetId: null },
  { label: "Mix 2", fileName: "דאנסהול סקול Mix 2 Instrumental.wav", mixTargetId: null },
  { label: "Mix 3", fileName: "דאנסהול סקול Mix 3.wav",              mixTargetId: null },
  { label: "Mix 4", fileName: "דאנסהול סקול Mix 4.wav",              mixTargetId: null },
  // Tasama is up to Mix 3
  { label: "Mix 1", fileName: "דאנסהול סקול Tasama Mix 1.wav", mixTargetId: TASAMA },
  { label: "Mix 2", fileName: "דאנסהול סקול Tasama Mix 2.wav", mixTargetId: TASAMA },
  { label: "Mix 3", fileName: "דאנסהול סקול Tasama Mix 3.wav", mixTargetId: TASAMA },
  // the instrumental line has one
  { label: "Mix 1", fileName: "דאנסהול סקול Instrumental Mix 1.wav", mixTargetId: INST },
];

console.log("\n── riddim: each line numbers independently ─────────────────────");
check("Tasama at Mix 3 → next is Mix 4",
  nextMixLabel(labelsInScope(riddimRows, { isRiddim: true, mixTargetId: TASAMA })), "Mix 4");
check("Desto has nothing → first upload is Mix 1",
  nextMixLabel(labelsInScope(riddimRows, { isRiddim: true, mixTargetId: DESTO })), "Mix 1");
check("Instrumental at Mix 1 → next is Mix 2",
  nextMixLabel(labelsInScope(riddimRows, { isRiddim: true, mixTargetId: INST })), "Mix 2");
check("4 legacy rows do NOT push the instrumental line past Mix 2",
  nextMixLabel(labelsInScope(riddimRows, { isRiddim: true, mixTargetId: INST })), "Mix 2");

console.log("\n── riddim: the 409 is scoped to the line ───────────────────────");
check("Desto Mix 1 is NOT taken although Tasama has one",
  isLabelTaken(labelsInScope(riddimRows, { isRiddim: true, mixTargetId: DESTO }), "Mix 1"), false);
check("Tasama Mix 1 IS taken on Tasama's own line",
  isLabelTaken(labelsInScope(riddimRows, { isRiddim: true, mixTargetId: TASAMA }), "Mix 1"), true);
check("legacy Mix 4 does not block Tasama's Mix 4",
  isLabelTaken(labelsInScope(riddimRows, { isRiddim: true, mixTargetId: TASAMA }), "Mix 4"), false);
check("the unassigned scope still sees its own legacy labels",
  isLabelTaken(labelsInScope(riddimRows, { isRiddim: true, mixTargetId: null }), "Mix 4"), true);

console.log("\n── file names stay work-global (one Dropbox folder) ────────────");
check("every row counts for collisions, across lines and legacy",
  fileNamesInScope(riddimRows).size, 8);
check("a legacy name is seen from a line's upload",
  fileNamesInScope(riddimRows).has("דאנסהול סקול Mix 3.wav"), true);
check("riddim name carries the line, so two lines' Mix 1 differ",
  versionNameParts("דאנסהול סקול", "Mix 1", { isRiddim: true, mixTargetName: "Tasama" }),
  ["דאנסהול סקול", "Tasama", "Mix 1"]);
check("… and Desto's Mix 1 is a different name",
  versionNameParts("דאנסהול סקול", "Mix 1", { isRiddim: true, mixTargetName: "Desto" }),
  ["דאנסהול סקול", "Desto", "Mix 1"]);
check("the instrumental line names itself too",
  versionNameParts("דאנסהול סקול", "Mix 2", { isRiddim: true, mixTargetName: "Instrumental" }),
  ["דאנסהול סקול", "Instrumental", "Mix 2"]);

console.log("\n── NON-riddim work: byte-for-byte the old behaviour ────────────");
const singleRows: VersionRow[] = [
  { label: "Mix 1", fileName: "Paparazi Mix 1.wav",            mixTargetId: null },
  { label: "Mix 1", fileName: "Paparazi Mix 1 Acapella.wav",   mixTargetId: null }, // addToExisting stack
  { label: "Mix 2", fileName: "Paparazi Mix 2.wav",            mixTargetId: null },
];
check("scope is the whole work", labelsInScope(singleRows, { isRiddim: false, mixTargetId: null }).size, 2);
check("next label is Mix 3", nextMixLabel(labelsInScope(singleRows, { isRiddim: false, mixTargetId: null })), "Mix 3");
check("Mix 2 is taken → 409 unless addToExisting",
  isLabelTaken(labelsInScope(singleRows, { isRiddim: false, mixTargetId: null }), "Mix 2"), true);
check("name has no line in it",
  versionNameParts("Paparazi", "Mix 3", { isRiddim: false, mixTargetName: "" }), ["Paparazi", "Mix 3"]);
check("a stray mixTargetId is ignored off a riddim",
  nextMixLabel(labelsInScope(singleRows, { isRiddim: false, mixTargetId: TASAMA })), "Mix 3");

console.log("\n── empty / first-ever cases ────────────────────────────────────");
check("empty work → Mix 1", nextMixLabel(labelsInScope([], { isRiddim: false, mixTargetId: null })), "Mix 1");
check("empty riddim line → Mix 1", nextMixLabel(labelsInScope([], { isRiddim: true, mixTargetId: DESTO })), "Mix 1");
check("gap in the sequence is filled (Mix 2 free)",
  nextMixLabel(new Set(["Mix 1", "Mix 3"])), "Mix 2");

console.log(`\n${fail === 0 ? "✓ ALL PASS" : "✗ FAILURES"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
