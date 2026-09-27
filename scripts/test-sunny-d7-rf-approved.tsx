/**
 * D7 — Red Films "מאושר" (Owner decision 2026-09-27, FINAL; no schema): the Owner approved the CURRENT workflow stage
 * (production status → the production stage; edit status → the edit stage) to proceed to the next stage. It is NOT
 * client approval, payment, the final version, delivery, completion or a global approval. Pure; reads code + contracts.
 * Run with:   npx tsx scripts/test-sunny-d7-rf-approved.tsx
 */
import fs from "node:fs";
import { stageCard } from "../lib/partner/act/next-step";
import { ACTION_REGISTRY, IMPROVEMENT_CANDIDATES } from "../lib/partner/act/registry";
import { COVERAGE_MATRIX } from "../lib/partner/act/matrix";
import { RF_EDIT, RF_STATUSES } from "../lib/partner/act/primitives/redfilms";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 400)}` : ""}`); } };
const read = (f: string) => fs.readFileSync(f, "utf8");

const prod = stageCard("RF_PRODUCTION_STATUS", "מאושר");
const edit = stageCard("RF_EDIT_STATUS", "מאושר");
ok("1. מאושר exists in both vocabularies (production + edit) — one meaning per stage", RF_STATUSES.includes("מאושר") && RF_EDIT.includes("מאושר"));
ok("2. Sunny's stage card: production מאושר = the Owner approved the current PRODUCTION stage to proceed", !!prod?.meaningEn?.includes("approved the CURRENT production stage to proceed"), prod);
ok("3. …edit מאושר = the current EDIT stage", !!edit?.meaningEn?.includes("current EDIT stage"), edit);
ok("4. neither says final / client / payment / delivered — each explicitly denies them", [prod, edit].every((c) => /not client approval/.test(c?.meaningEn ?? "") && /payment/.test(c?.meaningEn ?? "") && /delivery/.test(c?.meaningEn ?? "")));
ok("5. מאושר is not terminal: the next stage (פורסם) is still expected", prod?.terminal === false);
const reg = read("lib/partner/system/registry.ts");
ok("6. the Red Films contract records the meaning as OWNER_POLICY", /R\("RF_APPROVED_MEANING", "OWNER_POLICY"/.test(reg));
const rf = read("lib/partner/system/red-films.ts");
ok("7. the final-video evidence is the final link, never the status מאושר", /FINAL_VIDEO[^\n]*status מאושר is a stage approval, not 'final'/.test(rf) && !/concept: "final link \+ status מאושר"/.test(rf));
ok("8. the screens label the final link 'גרסה סופית' (not 'גרסה מאושרת')", !/גרסה מאושרת/.test(read("components/red-films/RedFilmProductionDrawer.tsx") + read("components/red-films/RedFilmProductionPage.tsx")));
const prim = read("lib/partner/act/primitives/redfilms.ts") + read("lib/partner/act/primitives/links.ts");
ok("9. Sunny's action disclosures say the same (stage approval, not client / payment / final / delivery)", /אישרת את השלב הנוכחי להמשיך לשלב הבא — לא אישור לקוח, לא תשלום, לא גרסה סופית, לא מסירה/.test(prim) && !/D7 לא (הוחלט|שונתה)/.test(prim));
const writers = read("lib/writes/redfilms.ts");
ok("10. nothing in the writers reacts to מאושר (no hidden payment / delivery / completion effect)", !/["']מאושר["']/.test(writers));
const row = COVERAGE_MATRIX.find((r) => r.id === "RF.MARK_PRODUCTION_APPROVED");
ok("11. 'mark the current stage approved' is executable (a status / edit-status change through UPDATE_PRODUCTION_DETAILS)", row?.klass === "EXECUTABLE" && ACTION_REGISTRY.get("UPDATE_PRODUCTION_DETAILS")?.availabilityDetail === "EXECUTABLE", row);
ok("12. approval history (who / when / version) is an improvement candidate, not a blocker", IMPROVEMENT_CANDIDATES.some((c) => c.id === "RF.APPROVAL_HISTORY" && c.kind === "PRODUCT"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
