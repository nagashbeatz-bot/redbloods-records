/**
 * Tests — artist social, stage 0 (Owner approval 2026-10-17): identity + inspirations + tracking per label artist.
 *
 * Run with:   npx tsx scripts/test-artist-social.tsx
 *
 * Proves: the two resource relations (OWNS_RESOURCE / INSPIRATION_SOURCE) are typed Owner knowledge with exact account keys,
 * previewed and committed only with the Owner's approval; one current owner per account; a shared label channel is the
 * company's and never counted as an artist's; every measurement carries its date / age / change; insights tie CANONICAL /
 * DERIVED; the capability is Owner-only, read-only and UNKNOWN when a source is unreadable; the UI tab is Owner-only and
 * read-only; no DB change, no API, no push / cron. NEVER touches production (in-memory store + fixtures).
 */
import fs from "node:fs";
import path from "node:path";
import { KNOWLEDGE_KINDS, knowledgeKind, validateKnowledgeKinds } from "../lib/partner/owner-knowledge/kinds";
import { CLASSIFICATION_REGISTRY, RELATION_TYPES, RESOURCE_RELATIONS } from "../lib/partner/owner-knowledge/taxonomy";
import { commitKnowledgeCore, createNonceGuard, normalizeItems, previewKnowledgeCore, type KnowledgeLive, type KnowledgeProposeDeps } from "../lib/partner/owner-knowledge/propose";
import { activeKnowledge, terminalOfSlot, type OwnerKnowledgeDraft, type OwnerKnowledgeRecord, type OwnerKnowledgeStore } from "../lib/partner/owner-knowledge/store";
import { artistSocialOf, freshnessHeOf } from "../lib/partner/label/social";
import type { BrainSnapshot } from "../lib/partner/brain/model";
import { PARTNER_KNOWLEDGE_REGISTRY } from "../lib/partner/knowledge/catalog";
import { queryKnowledgeCore } from "../lib/partner/knowledge/query";
import type { KnowledgeAudience } from "../lib/partner/knowledge/types";
import type { GatewaySources } from "../lib/partner/gateway/core";
import { DOMAIN_CONTRACTS } from "../lib/partner/system";
import { KNOWLEDGE_GAPS } from "../lib/partner/system/gaps";
import { NOW, TODAY, U, LA_SHALEV, LA_AVI, LA_NAGASH, state } from "./fixtures/integrity-company";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}${detail === undefined ? "" : ` — ${JSON.stringify(detail).slice(0, 400)}`}`); fail++; } };
const section = (t: string) => console.log(`\n${t}`);
const ROOT = path.resolve(__dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");

// ── fixtures ──
const A_SH_IG = U(5001), A_SH_YT = U(5002), A_REC_IG = U(5003), A_KHALED = U(5004), A_AVI_IG = U(5005), C_REEL = U(5006);
const AUTH = U(5100);
const iso = (d: string) => `${d}T10:00:00.000Z`;
const res = (id: string, platform: string, name: string, kind: "ACCOUNT" | "CONTENT" = "ACCOUNT", parent: string | null = null) =>
  ({ id, platform, resourceKind: kind, contentKind: kind === "CONTENT" ? "REEL" : null, parentId: parent, identityKey: kind === "CONTENT" ? `content:${id.slice(-4)}` : `account:handle:${name.toLowerCase().replace(/\s/g, "")}`, firstHandle: null, canonicalUrl: null, displayName: name, externalActor: null, approvalBasis: "OWNER_APPROVAL", authorizationId: null, createdAt: iso("2026-09-01") });
let seq = 0;
const obs = (id: string, resourceId: string, type: string, value: number, day: string) =>
  ({ id, seq: ++seq, batchId: U(5900), resourceId, entityKey: null, type, valueNum: value, valueText: null, valueBool: null, unit: null, observedAt: iso(day), periodStart: null, periodEnd: null, sourceType: "EXTERNAL_SOURCE", sourceKind: "PUBLIC_PROFILE_PAGE", sourceRef: null, captureMethod: "CLAUDE_READ", confidence: "MEDIUM", approvalBasis: "TRACKING_AUTHORIZATION", authorizationId: AUTH, correctsId: null, createdAt: iso(day) });
const rec = (id: string, type: string, title: string, o: { entityKeys?: string[]; resourceIds?: string[] }) =>
  ({ id, seq: ++seq, recordType: type, entityKeys: o.entityKeys ?? [], resourceIds: o.resourceIds ?? [], topic: null, area: "SOCIAL", titleHe: title, body: {}, sourceType: "INFERRED", confidence: "MEDIUM", reviewAt: null, supersedesId: null, authorizationId: AUTH, createdAt: iso("2026-09-21") });
const ev = (recordId: string, to: string) => ({ id: U(6000 + ++seq), seq: ++seq, recordId, observationId: null, authorizationId: null, resourceId: null, linkId: null, fromStatus: null, toStatus: to, reasonHe: null, actor: "SUNNY" as const, approvalBasis: "TRACKING_AUTHORIZATION", createdAt: iso("2026-09-21") });
const R1 = U(5201), R2 = U(5202), R3 = U(5203), R4 = U(5204);
function brain(): BrainSnapshot {
  return {
    resources: [res(A_SH_IG, "instagram", "shalev__tasama"), res(A_SH_YT, "youtube", "shalevtasama"), res(A_REC_IG, "instagram", "Redbloods Records"), res(A_KHALED, "instagram", "DJ Khaled"), res(A_AVI_IG, "instagram", "molla_avi"), res(C_REEL, "instagram", "reel 1", "CONTENT", A_SH_IG)],
    authorizations: [{ id: AUTH, purposeKind: "OWN_PRESENCE", purposeHe: "נוכחות", resourceIds: [A_SH_IG, A_SH_YT, A_REC_IG, A_AVI_IG, A_KHALED], includeChildResources: true, entityKeys: [], observationFamilies: ["INSTAGRAM", "YOUTUBE"], sourceKinds: ["PUBLIC_PROFILE_PAGE"], insightsAllowed: true, recommendationsAllowed: true, maxObservationsPerDay: null, validFrom: "2026-09-01", validUntil: null, supersedesId: null, approvalRequestId: null, createdAt: iso("2026-09-01") }],
    observations: [
      obs(U(5301), A_SH_IG, "INSTAGRAM.FOLLOWERS", 1000, "2026-09-02"), obs(U(5302), A_SH_IG, "INSTAGRAM.FOLLOWERS", 1100, "2026-09-20"),
      obs(U(5303), C_REEL, "INSTAGRAM.VIEWS", 5000, "2026-09-20"), obs(U(5304), A_REC_IG, "INSTAGRAM.FOLLOWERS", 9000, "2026-09-20"),
      obs(U(5305), A_KHALED, "INSTAGRAM.FOLLOWERS", 99000000, "2026-09-20"), obs(U(5306), A_SH_YT, "YOUTUBE.SUBSCRIBERS", 300, "2026-09-24"),
    ],
    records: [rec(R1, "INSIGHT", "הרילס של שליו עובד", { resourceIds: [A_SH_IG] }), rec(R2, "RECOMMENDATION", "ללייבל: פוסט שבועי", { resourceIds: [A_REC_IG] }),
      rec(R3, "INSIGHT", "ישנה", { entityKeys: [`label-artist:${LA_SHALEV}`] }), rec(R4, "RECOMMENDATION", "שליו + הלייבל", { resourceIds: [A_SH_IG, A_REC_IG] })],
    links: [{ id: U(5401), role: "EVIDENCE_FOR", fromRecordId: null, fromObservationId: U(5302), fromRef: null, toRecordId: R1, toResourceId: null, toRef: null, noteHe: null, authorizationId: AUTH, createdAt: iso("2026-09-21") }],
    events: [ev(R1, "OPEN"), ev(R2, "OPEN"), ev(R3, "REJECTED"), ev(R4, "OPEN")],
    approvals: null, truncated: false,
  } as unknown as BrainSnapshot;
}

const OWNER_ID = "0f0f0f0f-0000-4000-8000-00000000a0a0";
const ACTOR = { userId: OWNER_ID, clientId: "rbmcp_" + "c".repeat(40), tokenId: "00000000-0000-4000-8000-00000000abcd" };
const IDS: GatewaySources["identities"] = { cleantone: null } as never;
function srcOf(b: BrainSnapshot | null, knowledge?: OwnerKnowledgeRecord[]): GatewaySources {
  return { now: NOW, state: { status: "OK", value: state() }, ...(b ? { brain: { status: "OK" as const, value: b } } : { brain: { status: "UNAVAILABLE" as const, detail: "down" } }), ...(knowledge ? { ownerKnowledge: { status: "OK" as const, value: knowledge } } : {}), identities: IDS };
}
const live = (b: BrainSnapshot | null, records: OwnerKnowledgeRecord[] = []): KnowledgeLive => ({ src: srcOf(b), records, facts: { todayIL: TODAY, projectStatus: () => null, financeMatch: () => null } });

/** In-memory append-only store (one root per slot, one successor per row, one row per confirmation item). */
function memStore(): OwnerKnowledgeStore & { rows: OwnerKnowledgeRecord[] } {
  const rows: OwnerKnowledgeRecord[] = [];
  let n = 0;
  return {
    rows,
    async list() { return { status: "OK", records: rows.map((r) => structuredClone(r)) }; },
    async appendBatch(drafts: OwnerKnowledgeDraft[]) {
      if (drafts.some((d) => rows.some((r) => r.confirmationId === d.confirmationId && r.itemIndex === d.itemIndex))) return { status: "ALREADY_COMMITTED" };
      const out = drafts.map((d) => ({ ...d, id: U(7000 + ++n), createdAt: new Date(NOW.getTime() + n * 1000).toISOString() }));
      rows.push(...out);
      return { status: "APPENDED", records: out };
    },
  };
}
const own = (subject: string, resource: string, channelPurpose: string, extra: Record<string, string> = {}) => ({ kind: "ENTITY_RELATIONSHIP", subject, fields: { relation: "OWNS_RESOURCE", resource: `resource:${resource}`, channelPurpose, ...extra } });
const insp = (subject: string, resource: string, learnHe?: string) => ({ kind: "ENTITY_RELATIONSHIP", subject, fields: { relation: "INSPIRATION_SOURCE", resource: `resource:${resource}`, ...(learnHe ? { learnHe } : {}) } });
const SH = `label-artist:${LA_SHALEV}`, AVI = `label-artist:${LA_AVI}`, NG = `label-artist:${LA_NAGASH}`;

(async () => {
  section("1. taxonomy + kind (typed, no generic note, no new knowledge kind / DB CHECK)");
  ok("1a. OWNS_RESOURCE / INSPIRATION_SOURCE are relation types", RELATION_TYPES.includes("OWNS_RESOURCE") && RELATION_TYPES.includes("INSPIRATION_SOURCE") && RESOURCE_RELATIONS.length === 2);
  ok("1b. CHANNEL_PURPOSE gains PRODUCER_BRAND (a registry value, not a kind)", "PRODUCER_BRAND" in CLASSIFICATION_REGISTRY.CHANNEL_PURPOSE.values);
  ok("1c. registry still valid, no new kind (the live kind CHECK is unchanged)", validateKnowledgeKinds().length === 0 && KNOWLEDGE_KINDS.length === 14, validateKnowledgeKinds());
  const ER = knowledgeKind("ENTITY_RELATIONSHIP")!;
  ok("1d. resource field is typed 'resource'", ER.fields.resource?.type === "resource" && ER.fields.object?.required === false);
  ok("1e. an entity relation still needs object", ER.check!({ relation: "WORKS_WITH" }).some((e) => /object: required/.test(e)));
  ok("1f. OWNS_RESOURCE needs resource + channelPurpose and refuses object", (() => { const e = ER.check!({ relation: "OWNS_RESOURCE", object: "company:REDBLOODS" }); return e.some((x) => /resource:/.test(x)) && e.some((x) => /channelPurpose/.test(x)) && e.some((x) => /object:/.test(x)); })());
  ok("1g. the old slot shape is unchanged for entity relations", ER.slot({ relation: "OWNER_OF", object: "company:REDBLOODS" }) === "rel:OWNER_OF:company:REDBLOODS");
  ok("1h. a resource relation's slot is per account", ER.slot({ relation: "OWNS_RESOURCE", resource: `resource:${A_SH_IG}` }) === `rel:OWNS_RESOURCE:resource:${A_SH_IG}`);

  section("2. preview validation (exact account key, real account, right subject)");
  const n1 = normalizeItems([own(SH, A_SH_IG, "ARTIST_PERSONAL")], live(brain()));
  ok("2a. Shalev ← his Instagram account: normalized, labelled, linked to his key", n1.ok && n1.items[0].subjectKey === SH && n1.items[0].value.resource === `resource:${A_SH_IG}` && /instagram shalev__tasama/.test(String(n1.items[0].value.resourceLabel)), n1);
  ok("2b. the read-back names the account, the artist and the channel purpose", n1.ok && /instagram shalev__tasama — החשבון של שליו טסמה \(ערוץ אישי של אמן\)/.test(n1.items[0].meaningHe), n1.ok && n1.items[0].meaningHe);
  const bad = (items: unknown, b: BrainSnapshot | null = brain(), records: OwnerKnowledgeRecord[] = []) => { const r = normalizeItems(items, live(b, records)); return r.ok ? null : r.result; };
  ok("2c. a handle / name instead of the exact key is refused", bad([{ kind: "ENTITY_RELATIONSHIP", subject: SH, fields: { relation: "OWNS_RESOURCE", resource: "shalev__tasama", channelPurpose: "ARTIST_PERSONAL" } }])?.status === "INVALID");
  ok("2d. a content item is not an account", JSON.stringify(bad([own(SH, C_REEL, "ARTIST_PERSONAL")])).includes("not an account"));
  ok("2e. an unknown resource is refused", JSON.stringify(bad([own(SH, U(5999), "ARTIST_PERSONAL")])).includes("not a tracked resource"));
  ok("2f. Brain unreadable → refused, never guessed", JSON.stringify(bad([own(SH, A_SH_IG, "ARTIST_PERSONAL")], null)).includes("could not be read"));
  ok("2g. LABEL_MAIN with an artist subject is refused (a shared channel is never one artist's)", JSON.stringify(bad([own(NG, A_REC_IG, "LABEL_MAIN")])).includes("LABEL_MAIN"));
  const n2 = normalizeItems([own("Redbloods", A_REC_IG, "LABEL_MAIN")], live(brain()));
  ok("2h. Redbloods ← Records Instagram as LABEL_MAIN is valid", n2.ok && n2.items[0].subjectKey === "company:REDBLOODS", n2);
  ok("2i. an inspiration needs a label-artist subject", JSON.stringify(bad([insp("Redbloods", A_KHALED)])).includes("inspiration"));
  ok("2j. inspiration with learnHe is valid", (() => { const r = normalizeItems([insp(NG, A_KHALED, "ביטים קצרים עם חתימה קולית")], live(brain())); return r.ok && /DJ Khaled — חשבון השראה של נגש ביטס — מה לומדים: ביטים קצרים/.test(r.items[0].meaningHe); })());
  ok("2k. a project subject cannot own an account", bad([own(`project:${U(101)}`, A_SH_IG, "ARTIST_PERSONAL")])?.status === "INVALID");

  section("3. preview → Owner approval → commit (the ONLY write) → fresh read; one owner per account");
  const store = memStore();
  const deps: KnowledgeProposeDeps = {
    secret: "s".repeat(48), nowMs: () => NOW.getTime(), isOwner: async (u) => u === OWNER_ID,
    loadLive: async () => ({ ok: true, live: { src: srcOf(brain()), records: store.rows, facts: { todayIL: TODAY, projectStatus: () => null, financeMatch: () => null } } }),
    store, freshRecords: async () => store.rows.slice(), consumeNonce: createNonceGuard(),
  };
  const items = [own(SH, A_SH_IG, "ARTIST_PERSONAL"), own(SH, A_SH_YT, "ARTIST_PERSONAL"), own("Redbloods", A_REC_IG, "LABEL_MAIN")];
  const p = await previewKnowledgeCore(deps, ACTOR, items);
  ok("3a. preview writes nothing and says it changes no record", p.status === "PREVIEW" && store.rows.length === 0 && p.canonicalEffect === "NONE", p);
  const noApproval = p.status === "PREVIEW" ? await commitKnowledgeCore(deps, ACTOR, items, p.confirmationToken, U(8001), "") : null;
  ok("3b. no approval words → nothing written", noApproval?.status === "APPROVAL_MISSING" && store.rows.length === 0, noApproval);
  const c = p.status === "PREVIEW" ? await commitKnowledgeCore(deps, ACTOR, items, p.confirmationToken, U(8002), "מאשר") : null;
  ok("3c. 'מאשר' → LEARNED, 3 rows, each its slot's terminal", c?.status === "LEARNED" && store.rows.length === 3 && store.rows.every((r) => terminalOfSlot(store.rows, r.slotKey)?.id === r.id), c);
  const p2 = await previewKnowledgeCore(deps, ACTOR, [own(AVI, A_SH_IG, "ARTIST_PERSONAL")]);
  ok("3d. a second current owner is refused (CONFLICT_WITH_LIVE, nothing written)", p2.status === "CONFLICT_WITH_LIVE" && /כבר משויך/.test(JSON.stringify(p2)) && store.rows.length === 3, p2);
  const p3 = await previewKnowledgeCore(deps, ACTOR, [own(SH, A_SH_IG, "ARTIST_PERSONAL")]);
  ok("3e. the same link again = ALREADY_KNOWN", p3.status === "ALREADY_KNOWN", p3);
  const pi = await previewKnowledgeCore(deps, ACTOR, [insp(NG, A_KHALED, "ביטים קצרים")]);
  const ci = pi.status === "PREVIEW" ? await commitKnowledgeCore(deps, ACTOR, [insp(NG, A_KHALED, "ביטים קצרים")], pi.confirmationToken, U(8003), "כן, מאשר") : null;
  ok("3f. inspiration learned for נגש", ci?.status === "LEARNED", ci);

  section("4. the artist view: his accounts, shared channel apart, inspirations, dates, insights");
  const K = store.rows;
  const v = artistSocialOf({ brain: brain(), knowledge: K, todayIL: TODAY, now: NOW, artist: { id: LA_SHALEV, name: "שליו טסמה" } });
  ok("4a. Shalev has exactly his two approved accounts", v.accounts.map((a) => a.resourceId).sort().join() === [A_SH_IG, A_SH_YT].sort().join(), v.accounts.map((a) => a.label));
  ok("4b. the Records channel is served apart, shared, never among his accounts", v.labelChannels.length === 1 && v.labelChannels[0].shared && !v.accounts.some((a) => a.resourceId === A_REC_IG));
  const ig = v.accounts.find((a) => a.resourceId === A_SH_IG)!;
  const f = ig.metrics.find((m) => m.type === "INSTAGRAM.FOLLOWERS")!;
  ok("4c. measurement = last value + previous + change + its date", f.value === 1100 && f.previous?.value === 1000 && f.change?.kind === "NUMBER" && (f.change as { delta: number }).delta === 100 && f.checkedOn === "2026-09-20", f);
  ok("4d. an old reading is EARLIER with its age — never 'now'", f.freshness === "EARLIER" && f.ageDays === 3 && /לא נתון של עכשיו/.test(f.freshnessHe), f.freshnessHe);
  const yt = v.accounts.find((a) => a.resourceId === A_SH_YT)!;
  ok("4e. today's reading is TODAY", yt.metrics[0].freshness === "TODAY" && /נבדק היום/.test(yt.metrics[0].freshnessHe));
  ok("4f. content under his account is his (tracked + metrics)", ig.content.tracked === 1 && ig.content.items[0].metrics[0]?.value === 5000);
  ok("4g. ownership carries its approval date + quality", ig.ownership?.relationQuality === "OWNER_CONFIRMED_RELATION" && ig.ownership.channelPurpose === "ARTIST_PERSONAL" && !!ig.ownership.approvedOn);
  ok("4h. insights: R1 DERIVED (his account) + R4 (also the shared channel); R2 (label only) excluded; R3 rejected = history", v.records.map((r) => r.recordId).sort().join() === [R1, R4].sort().join() && v.records.every((r) => r.tie === "DERIVED") && v.records.find((r) => r.recordId === R4)!.alsoSharedChannel && v.historyRecords === 1, v.records);
  ok("4i. an insight carries its creation date and its evidence check date", v.records.find((r) => r.recordId === R1)!.createdOn === "2026-09-21" && v.records.find((r) => r.recordId === R1)!.evidenceCheckedOn === "2026-09-20");
  ok("4j. unassigned = Avi's Instagram (nobody approved it; never matched by name)", v.unassignedAccounts.map((u) => u.resourceId).join() === A_AVI_IG);
  const vn = artistSocialOf({ brain: brain(), knowledge: K, todayIL: TODAY, now: NOW, artist: { id: LA_NAGASH, name: "נגש ביטס" } });
  ok("4k. נגש: no own account yet, the inspiration is his, the label channel stays apart", vn.accounts.length === 0 && vn.inspirations.length === 1 && vn.inspirations[0].learnHe === "ביטים קצרים" && vn.labelChannels.length === 1);
  const va = artistSocialOf({ brain: brain(), knowledge: K, todayIL: TODAY, now: NOW, artist: { id: LA_AVI, name: "אבי מולה" } });
  ok("4l. Avi: nothing of Shalev's leaks to him", va.accounts.length === 0 && va.records.length === 0 && va.inspirations.length === 0);
  ok("4m. freshnessHeOf: one wording", freshnessHeOf(iso("2026-09-24"), TODAY, NOW).freshness === "TODAY" && freshnessHeOf(iso("2026-09-10"), TODAY, NOW).ageDays === 13);
  const ended = [...K, { ...K[0], id: U(7999), createdAt: new Date(NOW.getTime() + 99000).toISOString(), supersedesId: K[0].id, value: { ...K[0].value, status: "ENDED" } }];
  ok("4n. an ENDED ownership is history — the account is unassigned again", !artistSocialOf({ brain: brain(), knowledge: ended, todayIL: TODAY, now: NOW, artist: { id: LA_SHALEV, name: "שליו טסמה" } }).accounts.some((a) => a.resourceId === A_SH_IG));

  section("5. capability artist_social (Owner-only, read-only, UNKNOWN when unreadable)");
  const cap = PARTNER_KNOWLEDGE_REGISTRY.get("artist_social");
  ok("5a. registered, Owner-only, label-artist entity scope, needs BRAIN + OWNER_KNOWLEDGE + STATE", !!cap && cap.access.ownerOnly && cap.entityScope?.types.join() === "label-artist" && ["BRAIN", "OWNER_KNOWLEDGE", "STATE"].every((n) => cap.needs.includes(n as never)));
  const OWNER: KnowledgeAudience = { channel: "EXTERNAL", ownerAuthorized: true };
  const q = (s: GatewaySources, mode: string, params: Record<string, string> = {}) => queryKnowledgeCore(PARTNER_KNOWLEDGE_REGISTRY, { capability: "artist_social", mode, params }, s, OWNER);
  const r = q(srcOf(brain(), K), "artist", { entity: SH });
  ok("5b. Shalev: his 2 accounts + 2 live insights + the shared channel item, measurements = OBSERVATION", r.status === "OK" && r.items.filter((i) => i.fields.kind === "ACCOUNT").length === 2 && r.items.filter((i) => i.fields.recordType).length === 2 && r.items.some((i) => i.fields.kind === "LABEL_CHANNEL"), r.items.map((i) => i.id));
  ok("5c. insights are HYPOTHESIS; ownership is OWNER_DECISION", r.items.filter((i) => i.fields.recordType).every((i) => i.epistemic === "HYPOTHESIS") && r.items.filter((i) => i.fields.kind === "ACCOUNT").every((i) => i.epistemic === "OWNER_DECISION"));
  const unk = q(srcOf(null, K), "artist", { entity: SH });
  ok("5d. Brain unreadable → UNKNOWN (never 'no social')", unk.status === "OK" && unk.completeness === "UNKNOWN" && unk.items.length === 0, unk.completeness);
  const noK = q(srcOf(brain()), "artist", { entity: SH });
  ok("5e. Owner knowledge unreadable → UNKNOWN", noK.completeness === "UNKNOWN");
  const ext = queryKnowledgeCore(PARTNER_KNOWLEDGE_REGISTRY, { capability: "artist_social", params: { entity: SH } }, srcOf(brain(), K), { channel: "EXTERNAL", ownerAuthorized: false });
  ok("5f. without the Owner's authority → refused", ext.status === "NOT_AUTHORIZED" || ext.status === "UNKNOWN_CAPABILITY", ext.status);
  const ro = q(srcOf(brain(), K), "roster");
  ok("5g. roster: every roster artist + label channels + unassigned in the summary", ro.status === "OK" && ro.items.length === 3 && Array.isArray(ro.summary.find((s) => s.code === "UNASSIGNED_ACCOUNTS")?.value));
  ok("5h. a non-roster key → UNKNOWN", q(srcOf(brain(), K), "artist", { entity: `label-artist:${U(399)}` }).completeness === "UNKNOWN");
  const rel = queryKnowledgeCore(PARTNER_KNOWLEDGE_REGISTRY, { capability: "relations", params: { entity: SH } }, srcOf(brain(), K), OWNER);
  ok("5i. relations shows the ownership edge with the account as counterpart", rel.items.some((i) => i.fields.relation === "OWNS_RESOURCE" && String(i.fields.counterpartKey) === `resource:${A_SH_IG}`), rel.items.map((i) => i.fields.relation));

  section("6. contracts + guards (no DB change, no write path, Owner-only tab)");
  const la = DOMAIN_CONTRACTS.find((d) => d.id === "LABEL_ARTISTS")!;
  ok("6a. LABEL_ARTISTS claims artist_social + a stage-0 rule + a limitation", la.readCapabilities.includes("artist_social") && la.rules.some((x) => x.id === "ARTIST_SOCIAL_STAGE0") && la.limitationsHe.some((x) => /סושיאל לאמן \(שלב 0\)/.test(x)));
  ok("6b. the ownership gap is partially closed (data waits for the Owner)", KNOWLEDGE_GAPS.find((g) => g.id === "BRAIN_RESOURCE_OWNERSHIP")?.status === "PARTIALLY_CLOSED");
  const pure = read("lib/partner/label/social.ts") + read("lib/partner/knowledge/capabilities/artist-social.ts");
  ok("6c. the view + capability are pure: no DB / fetch / push / cron / browser", !/supabase|fetch\(|sendPush|setInterval|cron|\.from\(|\.rpc\(/.test(pure));
  const panel = read("components/label/ArtistSocialPanel.tsx");
  ok("6d. the panel only GETs the Owner-only knowledge route (no write, no other endpoint)", /\/api\/partner\/knowledge\?capability=artist_social/.test(panel) && !/method:\s*"(POST|PUT|PATCH|DELETE)"/.test(panel) && (panel.match(/fetch\(/g) ?? []).length === 1);
  const portal = read("components/red-artists/ArtistPortalPage.tsx");
  ok("6e. the tab is Owner-only, needs an artist id, never the DJ portal; never in an artist's own list", /const visibleTabs: readonly Tab\[\] = isOwner && !!artistId && !isCleantonePortal \? \[\.\.\.baseTabs, "סושיאל"\] : baseTabs;/.test(portal) && /const PORTAL_TABS: readonly Tab\[\] = TABS\.filter\(\(t\) => t !== "סושיאל"\);/.test(portal) && /: PORTAL_TABS;/.test(portal));
  ok("6f. the panel renders only for the Owner", /tab === "סושיאל" && isOwner && artistId \? <ArtistSocialPanel/.test(portal));
  ok("6g. no SQL / migration added for stage 0", !fs.readdirSync(path.join(ROOT, "scripts/sql")).some((f) => /social|artist-social/i.test(f)));
  ok("6h. the knowledge tool documents both resource relations", /OWNS_RESOURCE \{resource/.test(read("lib/integrations/partner-mcp/tools.ts")) && /INSPIRATION_SOURCE \{resource/.test(read("lib/integrations/partner-mcp/tools.ts")));
  ok("6i. activeKnowledge is the one 'current' rule used by the view", /activeKnowledge\(records, todayIL\)/.test(read("lib/partner/label/social.ts")) && activeKnowledge(K, TODAY).length === 4);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
