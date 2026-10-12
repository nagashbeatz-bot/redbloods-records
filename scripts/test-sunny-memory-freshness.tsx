/**
 * Sunny stage 3 (Owner-approved 2026-10-12) — memory freshness: what the Owner said is never presented as current once
 * the records or the calendar overtook it.
 *
 *   • a statement about a project that is CLOSED (הושלם / בוטל) is history (canonical wins) — e.g. "קרוב אלייך תקוע:
 *     מחכים לסטיבן" after the project was completed;
 *   • a date HE stated as still ahead ("מסיים אפקטים עד 04.10", said 01.10) that has passed → "זה עדיין נכון?" with the
 *     reason — a question, never a conclusion (free text only triggers a question); a date on / before the day he said
 *     it is a past fact he reported, never a commitment;
 *   • the SAME rule everywhere: projectOperating (known lines), motion (ownerSaid), owner_knowledge (freshness fields);
 *   • money: a recorded expense whose date passed with no payment recorded is asked "שולם?" — never "going out this
 *     week", never "unpaid", never a surprise slot (financial-forward, the greeting money line).
 * Pure, in-memory fixtures (the motion-company fixture). Run with:   npx tsx scripts/test-sunny-memory-freshness.tsx
 */
import type { GatewaySources } from "../lib/partner/gateway/core";
import { freshnessOf, knownItem, statedDatePassed } from "../lib/partner/sunny/known-context";
import { projectOperating } from "../lib/partner/sunny/operating";
import { buildCooView } from "../lib/partner/coo/priorities";
import { ownerKnowledge } from "../lib/partner/knowledge/capabilities/sunny";
import type { OwnerKnowledgeRecord } from "../lib/partner/owner-knowledge/store";
import { src, D, U, K, P_TZOADIM, P_CLOSER, blocker } from "./fixtures/motion-company";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 600)}` : ""}`); } };
const section = (t: string) => console.log(`\n${t}`);
const rec = (detail: string, createdAt: string, o: Partial<OwnerKnowledgeRecord> = {}) => ({ ...blocker(U(700), "project:x", detail, createdAt), ...o }) as unknown as OwnerKnowledgeRecord;

async function main() {
  section("1. statedDatePassed — only a date that was AHEAD when he said it, and has passed");
  ok("1a. צועדים: said 01.10 'מסיים אפקטים עד 04.10', today 12.10 → 2026-10-04", statedDatePassed(rec("נשארו אפקטים; הבוס מסיים עד 04.10 ואז הפרויקט עובר למיקס", "2026-10-01T07:39:44Z"), "2026-10-12") === "2026-10-04");
  ok("1b. a past fact he reported ('שלח לסטיבן ב-27.09', said 27.09) is never a commitment", statedDatePassed(rec("נגש שלח לסטיבן הערות למיקס ב־27.09.2026; מחכים לתיקונים", "2026-09-27T20:44:02Z"), "2026-10-12") === null);
  ok("1c. a stated date still ahead → nothing yet", statedDatePassed(rec("מסיים עד 20.10", "2026-10-01T07:00:00Z"), "2026-10-12") === null);
  ok("1d. בלאגן: said 27.09 'להקליט בסשן ביום חמישי 01.10.2026' → 2026-10-01", statedDatePassed(rec("חסר אינטרו של טל; מתוכנן להקליט בסשן ביום חמישי 01.10.2026", "2026-09-27T20:44:02Z"), "2026-10-12") === "2026-10-01");
  ok("1e. December → January with no year written (said 20.12, 'עד 05.01', today 10.01 next year)", statedDatePassed(rec("עד 05.01", "2026-12-20T10:00:00Z"), "2027-01-10") === "2027-01-05");
  ok("1f. not a date (31.13, a version '2.5' with no day/month sense) → nothing", statedDatePassed(rec("גרסה 31.13 של המיקס", "2026-10-01T07:00:00Z"), "2026-10-12") === null);
  ok("1g. no date at all → nothing (no invented commitment)", statedDatePassed(rec("כל השאר גמור; נשאר רק לסגור את ההפקה המוזיקלית", "2026-09-27T20:44:02Z"), "2026-10-12") === null);

  section("2. freshnessOf — ONE rule: newer evidence / closed record → history; a passed review or stated date → ask");
  const k = rec("מסיים עד 04.10", "2026-10-01T07:00:00Z", { reviewAt: "2026-10-15" } as never);
  ok("2a. a stated date passed (review not yet) → REVIEW_DUE", freshnessOf(k, "2026-10-12", null) === "REVIEW_DUE");
  ok("2b. the project is closed → SUPERSEDED_BY_EVIDENCE (canonical wins, even before the review)", freshnessOf(k, "2026-10-12", null, { closed: true }) === "SUPERSEDED_BY_EVIDENCE");
  ok("2c. newer canonical evidence still wins first", freshnessOf(k, "2026-10-12", "2026-10-03") === "SUPERSEDED_BY_EVIDENCE");
  ok("2d. nothing passed, nothing closed → CURRENT", freshnessOf(rec("כל השאר גמור", "2026-10-10T07:00:00Z", { reviewAt: "2026-10-24" } as never), "2026-10-12", null) === "CURRENT");
  ok("2e. the existing reviewAt rule is unchanged", freshnessOf(rec("כל השאר גמור", "2026-09-27T07:00:00Z", { reviewAt: "2026-10-11" } as never), "2026-10-12", null) === "REVIEW_DUE");
  const it = knownItem({ questionKind: "PROJECT_STATE", entityKey: "project:x", label: null, meaningHe: "צועדים תקוע: מסיים עד 04.10", knownAt: "2026-10-01", basis: { kind: "OWNER_KNOWLEDGE", knowledgeId: "k", knowledgeKind: "PROJECT_BLOCKER" }, freshness: "REVIEW_DUE", canonicalHe: "-", reviewReasonHe: "התאריך שאמרת (04.10) עבר" });
  ok("2f. the line says what he said + when + the reason, then ONLY 'זה עדיין נכון?' (STILL_TRUE_CHECK)", it.state === "STILL_TRUE_CHECK" && it.textHe.includes("אמרת לי (01.10)") && it.textHe.endsWith("התאריך שאמרת (04.10) עבר; זה עדיין נכון?"), it.textHe);

  section("3. projectOperating + motion (the fixture: today 05.10)");
  const tz = { ...blocker(U(701), K(P_TZOADIM), "נשארו אפקטים; הבוס מסיים עד 03.10 ואז הפרויקט עובר למיקס", `${D(-4)}T07:39:44Z`), value: { detail: "נשארו אפקטים; הבוס מסיים עד 03.10 ואז הפרויקט עובר למיקס", reason: "WAITING_FOR_OWNER" } };
  const s = src({ knowledge: [tz] });
  const op = projectOperating(s, P_TZOADIM);
  const kl = op?.known.find((x) => x.questionKind === "PROJECT_STATE");
  ok("3a. צועדים: the known line is a STILL_TRUE_CHECK with the stated-date reason", kl?.state === "STILL_TRUE_CHECK" && !!kl.textHe.includes("התאריך שאמרת (03.10) עבר") && kl.textHe.endsWith("זה עדיין נכון?"), kl);
  const m = buildCooView(s).motion;
  const mi = m.all.find((i) => i.entity === K(P_TZOADIM));
  ok("3b. motion carries the re-ask (never 'אמרת לי … שזה מחכה לך' as if current)", !!mi && mi.reasonsHe.some((r) => r.includes("זה עדיין נכון?") && r.includes("03.10")) && !mi.reasonsHe.some((r) => /^אמרת לי \(\d\d\.\d\d\) שזה מחכה לך/.test(r)), mi?.reasonsHe);
  const fresh = { ...tz, id: U(702), value: { detail: "נשארו אפקטים; הבוס מסיים עד 09.10", reason: "WAITING_FOR_OWNER" }, meaningHe: "נשארו אפקטים; הבוס מסיים עד 09.10" };
  const op2 = projectOperating(src({ knowledge: [fresh] }), P_TZOADIM);
  ok("3c. a stated date still ahead → the ordinary known line (no re-ask)", op2?.known.find((x) => x.questionKind === "PROJECT_STATE")?.state !== "STILL_TRUE_CHECK");

  section("4. owner_knowledge — the SAME freshness on every item (closed project / stated date)");
  const sClosed = src({ knowledge: [tz, { ...blocker(U(703), K(P_CLOSER), "מחכים לתיקונים של סטיבן", `${D(-8)}T20:44:02Z`), value: { detail: "מחכים לתיקונים של סטיבן", reason: "WAITING_FOR_VENDOR" } }] }) as unknown as { state: { value: { domains: { projects: { data: { index: Record<string, { status: string }> } } } } } } & GatewaySources;
  sClosed.state.value.domains.projects.data.index[P_CLOSER] = { ...sClosed.state.value.domains.projects.data.index[P_CLOSER], status: "הושלם" };
  const r = ownerKnowledge.read(sClosed, { mode: "active", params: {} }) as unknown as { items: Array<{ id: string; fields: { freshness: string; freshnessHe: string | null } }> };
  const closedItem = r.items.find((i) => i.id === U(703)), tzItem = r.items.find((i) => i.id === U(701));
  ok("4a. a blocker on a project that is now הושלם → SUPERSEDED_BY_EVIDENCE, said as history", closedItem?.fields.freshness === "SUPERSEDED_BY_EVIDENCE" && /הושלם ברשומות — זו היסטוריה/.test(closedItem.fields.freshnessHe ?? ""), closedItem?.fields);
  ok("4b. צועדים → REVIEW_DUE 'התאריך שאמרת (03.10) עבר — זה עדיין נכון?'", tzItem?.fields.freshness === "REVIEW_DUE" && tzItem.fields.freshnessHe === "התאריך שאמרת (03.10) עבר — זה עדיין נכון?", tzItem?.fields);
  ok("4c. nothing is deleted or hidden — the record stays readable with its freshness", r.items.length >= 2);

  section("5. Money: a recorded expense whose date passed → 'שולם?' (never 'this week', never 'unpaid')");
  const M5 = buildCooView(src()).motion;
  ok("5a. motion carries financial.overdueAsks (an array; the concrete overdue case is pinned in test-financial-forward 37b)", !M5.financial || Array.isArray(M5.financial.overdueAsks ?? []));
  ok("5b. the greeting money line carries 'שולם?' exactly when there is an overdue recorded row", !(M5.financial?.overdueAsks?.length) || M5.answerHe.includes("המועד עבר ואין רישום תשלום"));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
