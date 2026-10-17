/**
 * Sunny Social Intelligence (Owner mission 2026-10-17) — research by basis, approved identity, opportunities, results,
 * recommendation review + the history derivation, the capability modes strategy / weekly, the hub section and the guards.
 * Run with:   npx tsx scripts/test-social-intel.tsx      Pure; local fakes only; never touches production.
 */
import fs from "node:fs";
import path from "node:path";
import type { BrainSnapshot } from "../lib/partner/brain/model";
import type { OwnerKnowledgeRecord } from "../lib/partner/owner-knowledge/store";
import { identityOf, opportunitiesOf, plansToCreated, researchOf, resultsOf, reviewOf, SOCIAL_PROFILE_TOPICS, type ArtistViewLite } from "../lib/partner/label/social-intel";
import { postHashOf } from "../lib/partner/label/post-hash";
import { deriveWithActionHistory, historyDerivationFor } from "../lib/partner/sunny/with-history";
import { PARTNER_KNOWLEDGE_REGISTRY } from "../lib/partner/knowledge/catalog";
import { queryKnowledgeCore } from "../lib/partner/knowledge/query";
import type { GatewaySources } from "../lib/partner/gateway/core";
import { SERVER_INSTRUCTIONS } from "../lib/integrations/partner-mcp/mcp";
import { strategyDataOf } from "../components/social/ArtistStrategySection";
import { NOW, TODAY, U, LA_NAGASH, LA_SHALEV, state } from "./fixtures/integrity-company";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail === undefined ? "" : ` — ${JSON.stringify(detail).slice(0, 500)}`}`); } };
const section = (t: string) => console.log(`\n${t}`);
const read = (f: string) => fs.readFileSync(path.resolve(__dirname, "..", f), "utf8");

// ── fixtures: Nagash's own IG + a post; an inspiration (Rvssian TikTok) + its post; Shalev's IG; a shared label channel ──
const N_IG = U(7001), N_POST = U(7002), N_POST2 = U(7003), N_POST3 = U(7004), N_POST4 = U(7005), RVS = U(7010), RVS_POST = U(7011), SH_IG = U(7020), LABEL = U(7030), AUTH = U(7100);
const iso = (d: string) => `${d}T10:00:00.000Z`;
const POST_URL = "https://www.instagram.com/reel/ABC123xyz/";
const res = (id: string, platform: string, name: string, kind: "ACCOUNT" | "CONTENT" = "ACCOUNT", parent: string | null = null, url: string | null = null) =>
  ({ id, platform, resourceKind: kind, contentKind: kind === "CONTENT" ? "REEL" : null, parentId: parent, identityKey: kind === "CONTENT" ? `content:${id.slice(-6)}` : `account:handle:${name}`, firstHandle: null, canonicalUrl: url, displayName: name, externalActor: null, approvalBasis: "OWNER_APPROVAL", authorizationId: AUTH, createdAt: iso("2026-09-01") });
let seq = 0;
const obs = (id: string, resourceId: string, type: string, value: number, day: string) =>
  ({ id, seq: ++seq, batchId: U(7900), resourceId, entityKey: null, type, valueNum: value, valueText: null, valueBool: null, unit: null, observedAt: iso(day), periodStart: null, periodEnd: null, sourceType: "EXTERNAL_SOURCE", sourceKind: "PUBLIC_CONTENT_PAGE", sourceRef: null, captureMethod: "CLAUDE_READ", confidence: "HIGH", approvalBasis: "TRACKING_AUTHORIZATION", authorizationId: AUTH, correctsId: null, createdAt: iso(day) });
const rec = (id: string, type: string, title: string, o: { entityKeys?: string[]; resourceIds?: string[]; body?: Record<string, unknown>; area?: string }) =>
  ({ id, seq: ++seq, recordType: type, entityKeys: o.entityKeys ?? [], resourceIds: o.resourceIds ?? [], topic: null, area: o.area ?? "SOCIAL", titleHe: title, body: o.body ?? {}, sourceType: "INFERRED", confidence: "LOW", reviewAt: null, supersedesId: null, authorizationId: AUTH, createdAt: iso("2026-10-12") });
const ev = (recordId: string, to: string) => ({ id: U(8000 + ++seq), seq: ++seq, recordId, observationId: null, authorizationId: null, resourceId: null, linkId: null, fromStatus: null, toStatus: to, reasonHe: null, actor: "SUNNY" as const, approvalBasis: "TRACKING_AUTHORIZATION", createdAt: iso("2026-10-12") });
const lk = (id: string, role: string, o: Record<string, string | null>) => ({ id, role, fromRecordId: null, fromObservationId: null, fromRef: null, toRecordId: null, toResourceId: null, toRef: null, noteHe: null, authorizationId: AUTH, createdAt: iso("2026-10-13"), ...o });
const R_OWN = U(7201), R_INSP = U(7202), R_REC_INSP = U(7203), R_OTHER = U(7204), R_NAMED = U(7205), R_DONE = U(7206), R_FIN = U(7207);
function brain(): BrainSnapshot {
  return {
    resources: [res(N_IG, "instagram", "nagashbeatz"), res(N_POST, "instagram", "Red Bars #06", "CONTENT", N_IG, POST_URL), res(N_POST2, "instagram", "p2", "CONTENT", N_IG), res(N_POST3, "instagram", "p3", "CONTENT", N_IG), res(N_POST4, "instagram", "p4", "CONTENT", N_IG),
      res(RVS, "tiktok", "Rvssian"), res(RVS_POST, "tiktok", "Rvssian teaser", "CONTENT", RVS), res(SH_IG, "instagram", "shalev__tasama"), res(LABEL, "instagram", "Redbloods Records")],
    authorizations: [], approvals: null, truncated: false,
    observations: [
      obs(U(7301), N_POST, "INSTAGRAM.VIEWS", 20000, "2026-10-15"), obs(U(7302), N_POST, "INSTAGRAM.LIKES", 400, "2026-10-15"), obs(U(7303), N_POST, "INSTAGRAM.COMMENTS", 60, "2026-10-15"),
      obs(U(7304), N_POST2, "INSTAGRAM.VIEWS", 5000, "2026-10-12"), obs(U(7305), N_POST3, "INSTAGRAM.VIEWS", 7000, "2026-10-12"), obs(U(7306), N_POST4, "INSTAGRAM.VIEWS", 9000, "2026-10-12"),
      obs(U(7307), RVS_POST, "TIKTOK.VIEWS", 14400000, "2026-10-12"),
    ],
    records: [
      rec(R_OWN, "INSIGHT", "רילים בשת״פ מביאים יותר צפיות", { resourceIds: [N_IG], body: { statementHe: "חציון 15.2K מול 7.3K", reasoningHe: "15 רילים אחרונים", counterEvidenceHe: "רק 4 רילים סולו", causalStatus: "CORRELATION_ONLY", insightKind: "COMPARISON" } }),
      rec(R_INSP, "INSIGHT", "שלושה פורמטים אצל Rvssian", { resourceIds: [RVS], body: { statementHe: "טיזר 'מי על הביט'", counterEvidenceHe: "3 סרטונים בולטים בלבד", causalStatus: "CORRELATION_ONLY" } }),
      rec(R_REC_INSP, "RECOMMENDATION", "NagashBeatz x ??? — טיזר", { resourceIds: [RVS_POST], body: { recommendationHe: "עשר שניות של הביט החדש", whyHe: "טיזר Rvssian 14.4M", expectedEffectHe: "ניחושים בתגובות. השערה." } }),
      rec(R_OTHER, "RECOMMENDATION", "רעיון ממחקר אחר", { resourceIds: [U(7999)], body: { recommendationHe: "x" } }),
      rec(R_NAMED, "RECOMMENDATION", "יומן אולפן לשליו ולנגש", { entityKeys: [`label-artist:${LA_NAGASH}`, `label-artist:${LA_SHALEV}`], body: { recommendationHe: "יומן אולפן שבועי" } }),
      rec(R_DONE, "RECOMMENDATION", "Red Bars #06 עם אורח", { resourceIds: [N_IG], body: { recommendationHe: "פרק עם אורח" } }),
      rec(R_FIN, "INSIGHT", "לא סושיאל", { resourceIds: [], area: "FINANCE" }),
    ],
    links: [
      lk(U(7401), "EVIDENCE_FOR", { fromObservationId: U(7304), toRecordId: R_OWN }), lk(U(7402), "EVIDENCE_FOR", { fromObservationId: U(7307), toRecordId: R_INSP }),
      lk(U(7403), "RECOMMENDS", { fromRecordId: R_INSP, toRecordId: R_REC_INSP }), lk(U(7404), "IMPLEMENTED_BY", { fromRecordId: R_DONE, toRef: "plan:pl_DONE1" }),
    ],
    events: [ev(R_OWN, "OPEN"), ev(R_INSP, "OPEN"), ev(R_REC_INSP, "OPEN"), ev(R_OTHER, "OPEN"), ev(R_NAMED, "OPEN"), ev(R_DONE, "OPEN"), ev(R_FIN, "OPEN")],
  } as unknown as BrainSnapshot;
}
const childrenOf = (b: BrainSnapshot, ids: string[]) => new Set([...ids, ...b.resources.filter((r) => r.parentId && ids.includes(r.parentId)).map((r) => r.id)]);
const kr = (o: { id: string; subject: string; kind: string; value: Record<string, unknown>; slot: string; at?: string }): OwnerKnowledgeRecord => ({
  id: o.id, createdAt: o.at ?? iso("2026-10-14"), kind: o.kind, subjectKey: o.subject, identityKeys: [o.subject], slotKey: o.slot, value: o.value as never, epistemic: "OWNER_DECISION" as never, meaningHe: "", operation: "ASSERT",
  supersedesId: null, reviewAt: null, expiresAt: null, provenance: {} as never, confirmationId: U(9000), itemIndex: 0 });
const NK = `label-artist:${LA_NAGASH}`, SK = `label-artist:${LA_SHALEV}`;
const K: OwnerKnowledgeRecord[] = [
  kr({ id: U(7501), subject: NK, kind: "ENTITY_RELATIONSHIP", value: { relation: "OWNS_RESOURCE", resource: `resource:${N_IG}`, channelPurpose: "PRODUCER_BRAND" }, slot: "own:n" }),
  kr({ id: U(7502), subject: NK, kind: "ENTITY_RELATIONSHIP", value: { relation: "INSPIRATION_SOURCE", resource: `resource:${RVS}`, learnHe: "מיתוג מפיק" }, slot: "insp:n" }),
  kr({ id: U(7503), subject: SK, kind: "ENTITY_RELATIONSHIP", value: { relation: "OWNS_RESOURCE", resource: `resource:${SH_IG}`, channelPurpose: "ARTIST_PERSONAL" }, slot: "own:s" }),
  kr({ id: U(7504), subject: "company:REDBLOODS", kind: "ENTITY_RELATIONSHIP", value: { relation: "OWNS_RESOURCE", resource: `resource:${LABEL}`, channelPurpose: "LABEL_MAIN" }, slot: "own:l" }),
  kr({ id: U(7505), subject: "company:REDBLOODS", kind: "BUSINESS_DECISION", value: { area: "SOCIAL", about: NK, topic: "profile-identity", decisionHe: "מפיק דאנסהול ישראלי, רחוב ומקצועי", decidedOn: "2026-10-14" }, slot: `decision:SOCIAL:profile-identity:${NK}` }),
  kr({ id: U(7506), subject: "company:REDBLOODS", kind: "BUSINESS_DECISION", value: { area: "SOCIAL", about: SK, topic: "profile-audience", decisionHe: "קהל של שליו" }, slot: `decision:SOCIAL:profile-audience:${SK}` }),
  kr({ id: U(7507), subject: "company:REDBLOODS", kind: "BUSINESS_DECISION", value: { area: "FINANCE", about: NK, topic: "profile-goals", decisionHe: "לא סושיאל" }, slot: `decision:FINANCE:profile-goals:${NK}` }),
];

(async () => {
  const b = brain();
  const ctxN = { artistKey: NK, todayIL: TODAY, ownIds: childrenOf(b, [N_IG]), inspirationIds: childrenOf(b, [RVS]), sharedIds: childrenOf(b, [LABEL]) };

  section("1. Research by basis — nothing hidden, nothing attributed wrongly");
  const r = researchOf(b, ctxN, NOW);
  const ids = (xs: { recordId: string }[]) => xs.map((x) => x.recordId).sort().join();
  ok("1a. own accounts + named → OWN (the artist's performance)", ids(r.own) === [R_OWN, R_NAMED, R_DONE].sort().join(), r.own.map((x) => x.titleHe));
  ok("1b. records on his INSPIRATION accounts (and their content) reach him — as INSPIRATION", ids(r.inspiration) === [R_INSP, R_REC_INSP].sort().join(), r.inspiration.map((x) => x.titleHe));
  ok("1c. inspiration research is NEVER his performance", r.inspiration.every((x) => !x.performanceOfArtist && x.basis === "INSPIRATION") && r.own.every((x) => x.performanceOfArtist));
  ok("1d. other social research = an idea pool (never attributed); non-social areas are out", ids(r.other) === R_OTHER && ![...r.own, ...r.inspiration, ...r.other].some((x) => x.recordId === R_FIN));
  const own = r.own.find((x) => x.recordId === R_OWN)!;
  ok("1e. the digest carries claim, reasoning, counter-evidence, correlation-vs-cause and the evidence date", own.claimHe === "חציון 15.2K מול 7.3K" && own.whyHe === "15 רילים אחרונים" && own.counterHe === "רק 4 רילים סולו" && own.causalHe === "מתאם בלבד — לא סיבה" && own.evidence.latestCheckedOn === "2026-10-12" && own.evidence.observations === 1);
  const rec2 = r.inspiration.find((x) => x.recordId === R_REC_INSP)!;
  ok("1f. a recommendation keeps why / expected effect and the insight it derives from (RECOMMENDS)", rec2.whyHe === "טיזר Rvssian 14.4M" && rec2.expectedHe === "ניחושים בתגובות. השערה." && rec2.evidence.fromRecords.includes(R_INSP));
  const rs = researchOf(b, { artistKey: SK, todayIL: TODAY, ownIds: childrenOf(b, [SH_IG]), inspirationIds: new Set(), sharedIds: childrenOf(b, [LABEL]) }, NOW);
  ok("1g. one record can serve several artists (entityKeys) — Shalev gets the named studio-diary idea", rs.own.some((x) => x.recordId === R_NAMED) && !rs.own.some((x) => x.recordId === R_OWN));
  ok("1h. the Rvssian research is NOT Shalev's inspiration → only an idea pool for him", rs.other.some((x) => x.recordId === R_INSP) && !rs.inspiration.length);
  ok("1i. IMPLEMENTED_BY plan links are read (canonical Brain link)", r.own.find((x) => x.recordId === R_DONE)!.implementedBy[0]?.planId === "pl_DONE1");

  section("2. Identity — Owner-approved only, never invented");
  const idN = identityOf(K, NK, TODAY);
  ok("2a. the approved SOCIAL decision about the artist is read", idN.known.length === 1 && idN.known[0].decisionHe === "מפיק דאנסהול ישראלי, רחוב ומקצועי" && idN.known[0].he === "זהות ומיצוב מוזיקלי");
  ok("2b. another artist's decision / a non-SOCIAL area never leaks in", !idN.known.some((k) => k.decisionHe === "קהל של שליו" || k.decisionHe === "לא סושיאל"));
  ok("2c. every missing topic comes with ONE question to ask (no guessed answer)", idN.missing.length === SOCIAL_PROFILE_TOPICS.length - 1 && idN.missing.every((m) => m.askHe.endsWith("?")) && !idN.complete);
  ok("2d. no decision → an explicit 'ask, do not guess' note", /לשאול שאלה אחת/.test(identityOf([], NK, TODAY).noteHe));

  section("3. Opportunities — real activity, 14 days, honest link quality");
  const view: ArtistViewLite = {
    projects: [{ key: "project:p1", name: "אין לך", basis: "RELEASE", quality: "CANONICAL_RELATION" }, { key: "project:p2", name: "בלאגן", basis: "NAME_COLLABORATION", quality: "TEXT_MATCH" }, { key: "project:p3", name: "שיר", basis: "NAME_EXACT", quality: "TEXT_MATCH" }],
    releases: [{ key: "release:p1", projectName: "אין לך", stage: "רעיון", active: true, targetDate: addDays(TODAY, 2), releasedAt: null }, { key: "release:p9", projectName: "ישן", stage: "מיקס", active: true, targetDate: addDays(TODAY, -5), releasedAt: null }],
    shows: [{ key: "show:s1", name: "פסטיבל", date: addDays(TODAY, 6), status: "אושרה", upcoming: true, link: "TEXT_MATCH" }, { key: "show:s2", name: "רחוק", date: addDays(TODAY, 30), status: "אושרה", upcoming: true, link: "TEXT_MATCH" }],
    sessions: [{ date: addDays(TODAY, 2), start: "16:30", status: "מתוכנן", type: "סשן", project: "project:p1", show: null }, { date: addDays(TODAY, -1), start: null, status: "התקיים", type: "סשן", project: "project:p1", show: null }, { date: addDays(TODAY, 3), start: null, status: "בוטל", type: "סשן", project: "project:p3", show: null }],
    redFilms: [{ title: "בלאגן — קליפ", type: "קליפ", status: "צולם", shootDate: addDays(TODAY, -13), publishDate: null, editStatus: "לא התחיל", project: "project:p2", link: "via project" }],
    calendar: { status: "CALENDAR_DATA_AVAILABLE", ambiguous: [{ title: "סשן שליו טסמה ונגש ביטס", start: `${addDays(TODAY, 2)}T16:30:00+03:00` }] },
  };
  const op = opportunitiesOf(view, TODAY);
  ok("3a. the upcoming session is an opportunity with a CANONICAL link (project via release)", op.items.some((o) => o.kind === "SESSION" && o.link === "CANONICAL" && o.date === addDays(TODAY, 2)));
  ok("3b. a past or cancelled session is never shown as upcoming", !op.items.some((o) => o.kind === "SESSION" && (o.date === addDays(TODAY, -1) || o.date === addDays(TODAY, 3))));
  ok("3c. a show beyond 14 days is out; within 14 days in (TEXT_MATCH)", op.items.some((o) => o.kind === "SHOW" && o.link === "TEXT_MATCH") && !op.items.some((o) => o.titleHe.includes("רחוק")));
  ok("3d. a collaboration's material is AMBIGUOUS — never attributed with certainty; a passed shoot date never proves it is ready", op.items.some((o) => o.kind === "EDIT_MATERIAL" && o.link === "AMBIGUOUS" && /לא מוכיח/.test(o.noteHe ?? "")));
  ok("3e. a near release still at stage 'רעיון' is flagged to check; a passed release target is ATTENTION (passed ≠ released)", op.items.some((o) => o.kind === "RELEASE" && /לבדוק/.test(o.noteHe ?? "")) && op.attention.some((a) => /עבר הזמן ≠ יצא/.test(a.noteHe ?? "")));
  ok("3f. a calendar title that only names the artist = TEXT_MATCH", op.items.some((o) => o.kind === "CALENDAR_MENTION" && o.link === "TEXT_MATCH"));
  ok("3g. unread activity = UNKNOWN (never 'no activity')", !opportunitiesOf(null, TODAY).readable && /לא אומר שאין/.test(opportunitiesOf(null, TODAY).noteHe));

  section("4. Results — exact post match only, baseline, one result ≠ conclusion");
  const hashes = new Map(b.resources.filter((x) => x.canonicalUrl).map((x) => [x.id, postHashOf(x.canonicalUrl)!]));
  const items = [
    { id: U(7601), title: "Red Bars #06", status: "published", platform: "instagram", publishDate: "2026-10-05", postedHash: postHashOf("https://www.instagram.com/reel/ABC123xyz/?igsh=zzz") },
    { id: U(7602), title: "בלי קישור", status: "published", platform: "instagram", publishDate: "2026-10-06", postedHash: null },
    { id: U(7603), title: "לא נמדד", status: "posted", platform: "instagram", publishDate: "2026-10-07", postedHash: postHashOf("https://www.instagram.com/reel/OTHER/") },
    { id: U(7604), title: "Red Bars #06 (שם דומה)", status: "idea", platform: "instagram", publishDate: null, postedHash: null },
  ];
  const results = resultsOf(items, b, hashes, TODAY, NOW);
  const m = results.find((x) => x.title === "Red Bars #06")!;
  ok("4a. the canonical URL hash matches despite tracking parameters (igsh) — never by name", m.match === "MATCHED" && m.resourceId === N_POST && m.metrics.views === 20000 && m.metrics.comments === 60);
  ok("4b. baseline = median of the same account's OTHER posts (3 → 7,000) → ABOVE", m.baseline.posts === 3 && m.baseline.medianViews === 7000 && m.verdict === "ABOVE_BASELINE");
  ok("4c. no posted link → NO_POSTED_LINK; an unmeasured link → NOT_MEASURED; an unpublished item is never a result", results.find((x) => x.title === "בלי קישור")?.match === "NO_POSTED_LINK" && results.find((x) => x.title === "לא נמדד")?.match === "NOT_MEASURED" && !results.some((x) => x.title.includes("שם דומה")));
  ok("4d. the hash is never the link (32 hex)", /^[0-9a-f]{32}$/.test(String(items[0].postedHash)) && !String(items[0].postedHash).includes("http"));

  section("5. Review — recommendation → plan → item → results (history-aware)");
  const contentKeys = new Set(items.map((x) => `social-content:${x.id}`));
  const recs = [...r.own, ...r.inspiration];
  const noHist = reviewOf(recs, results, null, contentKeys);
  ok("5a. no history read → the implemented one is TRIED_ITEM_UNKNOWN (never 'not tried'); the rest NOT_TRIED", noHist.find((x) => x.recordId === R_DONE)?.verdict === "TRIED_ITEM_UNKNOWN" && noHist.filter((x) => x.recordId !== R_DONE).every((x) => x.verdict === "NOT_TRIED"));
  const hist = plansToCreated([{ planId: "pl_DONE1", steps: [{ actionId: "ADD_SOCIAL_CONTENT", createdKey: `social-content:${U(7601)}`, outcome: "APPLIED_AS_EXPECTED" }] }]);
  const one = reviewOf(recs, results, hist, contentKeys).find((x) => x.recordId === R_DONE)!;
  ok("5b. with history: the plan's created item + its result → ONE_RESULT (no conclusion from one post)", one.verdict === "ONE_RESULT" && one.items[0] === `social-content:${U(7601)}`);
  const failed = plansToCreated([{ planId: "pl_DONE1", steps: [{ actionId: "ADD_SOCIAL_CONTENT", createdKey: `social-content:${U(7601)}`, outcome: "FAILED" }] }]);
  ok("5c. a failed step's key is never trusted", reviewOf(recs, results, failed, contentKeys).find((x) => x.recordId === R_DONE)?.verdict === "TRIED_ITEM_UNKNOWN");
  const two = [...results, { ...m, contentKey: "social-content:x2" }];
  const hist2 = plansToCreated([{ planId: "pl_DONE1", steps: [{ actionId: "ADD_SOCIAL_CONTENT", createdKey: `social-content:${U(7601)}`, outcome: "APPLIED_AS_EXPECTED" }, { actionId: "ADD_SOCIAL_CONTENT", createdKey: "social-content:x2", outcome: "APPLIED_AS_EXPECTED" }] }]);
  ok("5d. two results above baseline → SUPPORTED (a hypothesis, with continue / series / variation options)", reviewOf(recs, two, hist2, contentKeys).find((x) => x.recordId === R_DONE)?.verdict === "SUPPORTED");
  const below = two.map((x) => ({ ...x, verdict: "BELOW_BASELINE" as const }));
  const nr = reviewOf(recs, below, hist2, contentKeys).find((x) => x.recordId === R_DONE)!;
  ok("5e. two below → NOT_SUPPORTED (stop / change format / try another approach)", nr.verdict === "NOT_SUPPORTED" && nr.optionsHe.includes("לעצור את הרעיון"));

  section("6. The connector derivation (history) and the capability modes");
  ok("6a. artist_social strategy / weekly get the 'social' history derivation; mode artist does not", historyDerivationFor({ tool: "partner_query", capability: "artist_social", mode: "strategy" }) === "social" && historyDerivationFor({ tool: "partner_query", capability: "artist_social", mode: "weekly" }) === "social" && historyDerivationFor({ tool: "partner_query", capability: "artist_social", mode: "artist" }) === null);
  const payload = { summary: [{ code: "REVIEW", value: { historyRead: false, reviews: noHist, inputs: { recs, results, contentKeys: [...contentKeys] } } }], items: [] };
  const derived = deriveWithActionHistory("social", payload, [{ planId: "pl_DONE1", at: iso("2026-10-14"), outcome: "EXECUTED", steps: [{ actionId: "ADD_SOCIAL_CONTENT", entity: "social-content:new", outcome: "APPLIED_AS_EXPECTED", createdKey: `social-content:${U(7601)}` }] }], NOW.getTime());
  const dv = (derived.summary as Array<{ code: string; value: { historyRead: boolean; reviews: Array<{ recordId: string; verdict: string }> } }>)[0].value;
  ok("6b. the derivation re-decides the review WITH the history (plan → item → result)", dv.historyRead && dv.reviews.find((x) => x.recordId === R_DONE)?.verdict === "ONE_RESULT");
  const unread = deriveWithActionHistory("social", payload, null, NOW.getTime());
  ok("6c. unread history = historyRead false (never 'not tried')", (unread.summary as Array<{ value: { historyRead: boolean; reviews: Array<{ recordId: string; verdict: string }> } }>)[0].value.historyRead === false && (unread.summary as Array<{ value: { reviews: Array<{ recordId: string; verdict: string }> } }>)[0].value.reviews.find((x) => x.recordId === R_DONE)?.verdict === "TRIED_ITEM_UNKNOWN");

  const src: GatewaySources = { now: NOW, state: { status: "OK", value: state() }, brain: { status: "OK", value: b }, ownerKnowledge: { status: "OK", value: K }, identities: { cleantone: null } as never } as GatewaySources;
  const OWNER = { channel: "INTERNAL", ownerAuthorized: true } as const;
  const q = (mode: string, params: Record<string, string> = {}) => queryKnowledgeCore(PARTNER_KNOWLEDGE_REGISTRY, { capability: "artist_social", mode, params }, src, OWNER);
  const st = q("strategy", { entity: NK });
  const sum = (code: string) => st.summary.find((x) => x.code === code)?.value as Record<string, unknown> | undefined;
  ok("6d. mode strategy answers with identity / research / opportunities / results / review", st.status === "OK" && ["IDENTITY", "RESEARCH", "OPPORTUNITIES", "RESULTS", "REVIEW", "INSPIRATIONS_LEARN"].every((c) => st.summary.some((x) => x.code === c)), st.status);
  const research = sum("RESEARCH") as { own: number; inspiration: number; other: number } | undefined;
  ok("6e. the strategy answer serves the inspiration research too (the 7 hidden records fixed)", !!research && research.inspiration === 2 && research.own === 3 && st.items.some((i) => i.fields.basis === "INSPIRATION"), research);
  ok("6f. activity not loaded here → opportunities UNKNOWN (said so, never empty)", (sum("OPPORTUNITIES") as { readable?: boolean } | undefined)?.readable === false && st.coverage.some((c) => /לא 'אין'/.test(c.text)));
  const sd = strategyDataOf(st as never);
  ok("6g. the hub section reads the same answer (records by basis, identity, review)", !!sd && sd.records.some((x) => x.basis === "INSPIRATION" && !x.performanceOfArtist) && sd.identity?.known.length === 1);
  const wk = q("weekly");
  ok("6h. mode weekly: one item per roster artist, each with decisions for the Owner", wk.status === "OK" && wk.items.length >= 2 && wk.items.every((i) => Array.isArray(i.fields.decisionsHe)), wk.status);
  ok("6i. served answers never carry a post link", !/instagram\.com\/reel|https?:\/\//.test(JSON.stringify(st)) && !/https?:\/\//.test(JSON.stringify(wk)));

  section("7. Instructions, UI and guards");
  ok("7a. Sunny is told to read mode strategy before ANY social idea, never invent identity, judge only from measured results", /before ANY social idea, plan or strategy/.test(SERVER_INSTRUCTIONS) && /never one viral video/.test(SERVER_INSTRUCTIONS) && /one result = no conclusion/.test(SERVER_INSTRUCTIONS) && /IMPLEMENTED_BY plan:<id>/.test(SERVER_INSTRUCTIONS));
  const core = SERVER_INSTRUCTIONS.slice(0, SERVER_INSTRUCTIONS.indexOf("You are talking to the Owner"));
  ok("7b. the instruction core stays ≤ 1,200 chars (the protocol lives after it)", core.length <= 1200, core.length);
  ok("7c. the observe tool asks for entityKeys of every fitting artist + counter-evidence", /entityKeys every label artist a record fits/.test(read("lib/integrations/partner-mcp/observe-tool.ts")));
  const ui = read("components/social/ArtistStrategySection.tsx");
  ok("7d. the hub section only GETs artist_social mode strategy (no write, no other endpoint)", /capability=artist_social&mode=strategy/.test(ui) && !/method:\s*"(POST|PUT|PATCH|DELETE)"/.test(ui) && (ui.match(/fetch\(/g) ?? []).length === 1);
  ok("7e. it is mounted in the artist's full view (not on the cards)", /<ArtistStrategySection /.test(read("components/social/LabelArtistsSocial.tsx")));
  const intel = read("lib/partner/label/social-intel.ts");
  ok("7f. the intel layer is pure: no DB / fetch / push / cron / clock of its own / browser", !/supabase|fetch\(|sendPush|setInterval|cron|\.rpc\(|new Date\(\)/.test(intel));
  ok("7g. no DB change: no new SQL except the OUTCOME candidate (not applied)", fs.readdirSync(path.resolve(__dirname, "sql/sunny-brain")).filter((f) => /2026-10-17/.test(f)).every((f) => /CANDIDATE/.test(f)));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();

function addDays(ymd: string, n: number) { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
