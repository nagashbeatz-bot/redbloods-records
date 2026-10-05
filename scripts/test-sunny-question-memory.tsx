/**
 * QUESTION MEMORY (Owner-approved Phase 2, 2026-10-05, Q1–Q4) — every question Sunny shows ends in ONE of
 * ASK / KNOWN / RECONCILE / REOPENED_BECAUSE_EVIDENCE_CHANGED; never re-asked after an answer without new canonical evidence.
 *
 *   Q0 (P0-A..G): no false claims — no answer path claimed before it exists; the real Red Films status; the show split
 *                 only for an agreement artist; leaving יצא keeps the first-release date; source missing ≠ fact missing;
 *                 a DJ recorded by name is a DJ; an interrupted create is OUTCOME_UNKNOWN.
 *
 * Run with:   npx tsx scripts/test-sunny-question-memory.tsx      Pure; never touches production.
 */
import fs from "node:fs";
import path from "node:path";
import { mayHaveRun, MAY_HAVE_RUN } from "../lib/partner/act/service";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 700)}` : ""}`); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

(async () => {
  console.log("Q0. P0-A..G — no false claims");
  {
    const kc = read("lib/partner/sunny/known-context.ts");
    ok("P0-A. the case answer is not claimed as a dashboard / existing answer path", !/dashboard "צריך ממך": reviewed outside/.test(kc) && /NO writer records it yet|via the case bridge/.test(kc));
    const rf = code(read("lib/partner/redfilms/view.ts"));
    ok("P0-B. the Red Films STATUS question names each production's REAL status — never a hard-coded 'רעיון'", !/והסטטוס 'רעיון'/.test(rf) && /סטטוס: '\$\{p\.status\}'/.test(rf));
    const op = read("lib/partner/sunny/operating.ts"), lv = read("lib/partner/label/view.ts"), sh = read("lib/partner/act/primitives/shows.ts");
    ok("P0-C. no global 50/50: operating's split item is gated on the agreement (שליו / אבי) and NOT_DEFINED otherwise", /agreementArtistOf\(\{ id: la\?\.id \?\? null, name \}\)/.test(op) && /NOT_DEFINED — no show agreement/.test(op) && !/value: "net = price − DJ fee − counted rehearsal costs; artist half, label half"/.test(op));
    ok("P0-C. the label view's split note follows the agreement (NOT_DEFINED for any other artist)", /agreementArtistOf\(\{ id: artistId, name \}\)/.test(lv) && /split is NOT_DEFINED/.test(lv));
    ok("P0-C. show action previews never claim 50/50 for every artist", !/חלוקת 50\/50 מחושבות מחדש/.test(sh) && !/לפי הכלל \(50\/50 אחרי DJ וחזרות\)/.test(sh) && /רק לשליו טסמה \/ אבי מולה/.test(sh));
    ok("P0-C. the money paths use the agreement rule only (showAgreementSplit) — text-only fix, no historical data affected", /showAgreementSplit/.test(read("lib/shows-finance-sync.ts")) && /showAgreementSplit/.test(read("lib/writes/shows.ts")));
    const w1 = read("lib/partner/act/primitives/wave1.ts"), rs = read("lib/release-store.ts");
    ok("P0-D. CHANGE_RELEASE_STAGE says what the store does: leaving יצא keeps the first-release date", /יציאה מ'יצא' לא מוחקת אותו/.test(w1) && !/יציאה מ'יצא' מוחקת אותו/.test(w1) && /NEVER cleared/.test(rs));
    ok("P0-E. RELEASE asks only when the release detail was READ (source missing ≠ fact missing)", /const relRead = !!c\.det\?\.releases;/.test(lv) && /r\.active && relRead && !r\.nextAction && !r\.blocker/.test(lv));
    const sv = code(read("lib/partner/shows/view.ts"));
    ok("P0-F. NO_DJ / the DJ question check BOTH representations (dj_client_id AND dj_name); a name-only DJ is its own fact", /!s\.djClientId && !s\.djName && s\.status !== "בוטל"\) \{ signals\.push\(\{ code: "NO_DJ"/.test(sv) && /DJ_NAME_ONLY/.test(sv));
    ok("P0-F. the label view and showWorkflow count a name-only DJ too", /s\.djName \? \{ client: null, name: s\.djName/.test(lv) && /!existing\.djClientId && !existingDjName/.test(op));
    ok("P0-G. an interrupted CREATE is written with the MAY_HAVE_RUN marker (OUTCOME_UNKNOWN, never 'not applied')", /stepTargetId\(s\) === "new"\) return out\("FAILED", `\$\{MAY_HAVE_RUN\}/.test(read("lib/partner/act/service.ts"))
      && mayHaveRun({ status: "FAILED", outcome: { detail: `${MAY_HAVE_RUN} the execution was interrupted; a created record cannot be verified` } }));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
