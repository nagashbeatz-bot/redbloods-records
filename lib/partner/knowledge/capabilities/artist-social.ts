/**
 * Artist social — stage 0 read capability `artist_social` (Owner-only, read-only). Pure over the request-scoped sources
 * (BRAIN + OWNER_KNOWLEDGE + STATE); every rule lives in lib/partner/label/social.ts (connect, never copy).
 *
 * Per label artist: the artist's accounts (Owner-approved OWNS_RESOURCE), the shared label channels served apart (never the
 * artist's own performance), the artist's inspirations (INSPIRATION_SOURCE + what we learn), every measurement with its date / age / change since
 * the previous check, and the insights / recommendations that name the artist or rest on the artist's accounts — each with its epistemic
 * status. Unreadable Brain / knowledge = UNKNOWN, never "no social".
 */
import { artistSocialOf, type ArtistSocial, type SocialAccount } from "../../label/social";
import { identityOf, opportunitiesOf, researchOf, resultsOf, reviewOf, BASIS_HE, RESULT_HEURISTICS, SOCIAL_PROFILE_TOPICS, type ArtistViewLite, type ResearchDigest } from "../../label/social-intel";
import { postHashOf } from "../../label/post-hash";
import { buildArtistView } from "../../label/view";
import type { BrainSnapshot } from "../../brain/model";
import type { KnowledgeCapability, KnowledgeItem, KnowledgeReadResult, KnowledgeSources } from "../types";
import { item, ok, partner, record, result, sfact, state } from "./common";

const ilToday = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

function sourcesMissing(src: KnowledgeSources): KnowledgeReadResult | null {
  const missing: KnowledgeReadResult["missing"] = [];
  if (src.brain?.status !== "OK") missing.push({ fact: "sunny_brain", whyNeeded: "the tracked accounts and measurements could not be read" });
  if (!ok(src.ownerKnowledge)) missing.push({ fact: "owner_knowledge", whyNeeded: "whose account it is comes from the Owner's approved knowledge, which could not be read" });
  if (!state(src)?.domains.labelArtists.data) missing.push({ fact: "label_roster", whyNeeded: "the roster could not be read" });
  return missing.length ? result([], { completeness: "UNKNOWN", coverage: [partner("לא הצלחתי לקרוא את מקורות הסושיאל — שום דבר כאן לא אומר 'אין סושיאל'.")], missing }) : null;
}

const accountItem = (a: SocialAccount, entity: string, kind: "ACCOUNT" | "LABEL_CHANNEL" | "INSPIRATION", extra: Record<string, unknown> = {}): KnowledgeItem => item({
  id: `${kind.toLowerCase()}:${a.resourceId}`, entity, label: record(a.label), epistemic: "OWNER_DECISION", source: "SUNNY_BRAIN",
  freshness: a.lastCheckedOn ? "HISTORICAL" : "LIVE", relationQuality: "OWNER_CONFIRMED",
  fields: {
    kind, resourceId: a.resourceId, platform: a.platform, ownership: a.ownership, shared: a.shared,
    lastCheckedOn: a.lastCheckedOn, lastCheckFreshnessHe: a.lastCheckFreshnessHe,
    metrics: a.metrics.map((m) => ({ ...m, epistemic: "OBSERVATION" })), content: { tracked: a.content.tracked, items: a.content.items.map((c) => ({ ...c, label: record(c.label) })) },
    note: partner(kind === "LABEL_CHANNEL" ? "ערוץ לייבל משותף — לא נספר כביצועים האישיים של האמן." : kind === "INSPIRATION" ? "חשבון השראה — לא שלנו; מדידה היא ערך בזמן נתון, לא מסקנה." : "השיוך לאמן אושר על ידי הבוס; כל מדידה היא ערך בזמן נתון עם התאריך שלה, לא מצב של עכשיו."),
    ...extra,
  },
});

function artistItems(v: ArtistSocial): KnowledgeItem[] {
  return [
    ...v.accounts.map((a) => accountItem(a, v.artistKey, "ACCOUNT")),
    ...v.inspirations.map((a) => accountItem(a, v.artistKey, "INSPIRATION", { learnHe: a.learnHe ? record(a.learnHe) : null, approvedOn: a.approvedOn })),
    ...v.records.map((r) => item({
      id: `${r.recordType.toLowerCase()}:${r.recordId}`, entity: v.artistKey, label: record(r.titleHe), epistemic: "HYPOTHESIS", source: "SUNNY_BRAIN", freshness: "HISTORICAL",
      relationQuality: r.tie === "CANONICAL" ? "ID" : "DERIVED",
      fields: { ...r, titleHe: record(r.titleHe), note: partner(`${r.recordType === "INSIGHT" ? "תובנה" : "המלצה"} = השערה של סאני, לא עובדה. נוצרה ב-${r.createdOn}${r.evidenceCheckedOn ? `, על סמך בדיקה מ-${r.evidenceCheckedOn}` : ""}.${r.tie === "DERIVED" ? " מקושרת לאמן דרך החשבונות שלו (נגזר מהשיוך שאישרת)." : ""}${r.alsoSharedChannel ? " נוגעת גם בערוץ לייבל משותף." : ""}`) },
    })),
    ...v.labelChannels.map((a) => accountItem(a, v.artistKey, "LABEL_CHANNEL")),
  ];
}

const cadenceFact = (v: ArtistSocial) => v.cadence.readable ? {
  week: v.cadence.weeks[0], previousWeeks: v.cadence.weeks.slice(1),
  targets: v.cadence.targets.map((t) => ({ current: t.current, history: t.history })),
  series: v.cadence.series, overdueItems: v.cadence.overdueItems, externalEvidence: v.cadence.external,
  metricsNote: "items = unique content items; publications = item x platform — never added together; external evidence = browser checks, never counted",
} : null;
const summaryOf = (v: ArtistSocial) => [
  sfact("CADENCE", "יעדים, סדרות ומעקב שבועי (ראשון–שבת) — פריטים ופרסומים בנפרד", cadenceFact(v), "FACT", "OPERATIONS"),
  sfact("CONTENT", "התוכן של האמן (קישור קנוני — עם או בלי קמפיין)", v.content.readable ? { total: v.content.total, byPhase: v.content.byPhase, upcoming: v.content.upcoming, overdue: v.content.overdue, undated: v.content.undated, recentPublished: v.content.recentPublished, withoutCampaign: v.content.withoutCampaign, campaignsLinked: v.content.campaignsLinked } : null, "FACT", "OPERATIONS"),
  sfact("ACCOUNTS", "החשבונות של האמן (שיוך שאישרת)", v.accounts.length, "OWNER_DECISION", "OWNER_KNOWLEDGE"),
  sfact("LAST_CHECKED_ON", "בדיקה אחרונה של החשבונות שלו", v.lastCheckedOn, "OBSERVATION", "SUNNY_BRAIN", "HISTORICAL"),
  sfact("INSPIRATIONS", "חשבונות השראה שלו", v.inspirations.length, "OWNER_DECISION", "OWNER_KNOWLEDGE"),
  sfact("LIVE_RECORDS", "תובנות / המלצות פתוחות שקשורות אליו", v.records.length, "HYPOTHESIS", "SUNNY_BRAIN"),
  sfact("RECHECK_PROPOSAL", "הצעה לבדיקה חוזרת — לשאול את הבוס, לא לבצע לבד", v.recheck, "DERIVED", "SUNNY_BRAIN"),
  sfact("UNASSIGNED_ACCOUNTS", "חשבונות במעקב שעוד לא שויכו לאף אחד (פער — לא מנחשים לפי שם)", v.unassignedAccounts, "FACT", "SUNNY_BRAIN"),
];

// ── Sunny Social Intelligence (2026-10-17): strategy + weekly modes over the SAME sources (lib/partner/label/social-intel) ──
const childrenOf = (brain: BrainSnapshot, ids: readonly string[]) => new Set([...ids, ...brain.resources.filter((r) => r.parentId && ids.includes(r.parentId)).map((r) => r.id)]);
function intelOf(src: KnowledgeSources, v: ArtistSocial, brain: BrainSnapshot, today: string) {
  const ownIds = childrenOf(brain, v.accounts.map((a) => a.resourceId));
  const inspirationIds = childrenOf(brain, v.inspirations.map((a) => a.resourceId));
  const sharedIds = childrenOf(brain, v.labelChannels.map((a) => a.resourceId));
  const research = researchOf(brain, { artistKey: v.artistKey, todayIL: today, ownIds, inspirationIds, sharedIds }, src.now);
  const identity = identityOf(ok(src.ownerKnowledge) ?? [], v.artistKey, today);
  const artistId = v.artistKey.slice("label-artist:".length);
  const view = ok(src.projectDetail) ? (buildArtistView(src, artistId) as unknown as ArtistViewLite | null) : null;
  const opportunities = opportunitiesOf(view, today);
  const o = ok(src.operations);
  const rows = o?.contentItems?.rows ?? null;
  const hashOfResource = new Map(brain.resources.filter((x) => x.resourceKind === "CONTENT" && x.canonicalUrl).map((x) => [x.id, postHashOf(x.canonicalUrl)!] as const).filter(([, h]) => !!h));
  const mine = (rows ?? []).filter((x) => x.labelArtistId === artistId && x.id).map((x) => ({ id: String(x.id), title: x.title ?? "", status: x.status, platform: x.platform, publishDate: x.publishDate, postedHash: x.postedHash ?? null }));
  const results = rows ? resultsOf(mine, brain, hashOfResource, today, src.now) : null;
  const contentKeys = (rows ?? []).filter((x) => x.id).map((x) => `social-content:${x.id}`);
  const recs = [...research.own, ...research.inspiration, ...research.acted];
  const slim = (d: ResearchDigest) => ({ recordId: d.recordId, recordType: d.recordType, titleHe: d.titleHe, implementedBy: d.implementedBy }) as unknown as ResearchDigest;
  const review = { historyRead: false, reviews: reviewOf(recs, results ?? [], null, new Set(contentKeys)), inputs: { recs: recs.map(slim), results: results ?? [], contentKeys },
    noteHe: "המלצה ← התוכנית שביצעה אותה (קישור ב-Brain) ← הפריט שנוצר (היסטוריית הפעולות) ← התוצאה. תוצאה אחת = אין מסקנה." };
  return { research, identity, opportunities, results, review, viewRead: !!view };
}
const digestItem = (d: ResearchDigest, entity: string) => item({
  id: `${d.recordType.toLowerCase()}:${d.recordId}`, entity, label: record(d.titleHe), epistemic: "HYPOTHESIS", source: "SUNNY_BRAIN", freshness: "HISTORICAL",
  relationQuality: d.basis === "ARTIST_NAMED" ? "ID" : "DERIVED",
  fields: { ...d, titleHe: record(d.titleHe), claimHe: d.claimHe ? record(d.claimHe) : null, whyHe: d.whyHe ? record(d.whyHe) : null, counterHe: d.counterHe ? record(d.counterHe) : null, expectedHe: d.expectedHe ? record(d.expectedHe) : null, presentedHe: d.presentedHe ? record(d.presentedHe) : null,
    note: partner(`${d.recordType === "INSIGHT" ? "תובנה" : "המלצה"} = השערה של סאני. ${d.basisHe}.${d.performanceOfArtist ? "" : " אסור לייחס את המספרים האלה לאמן."}${d.evidence.latestCheckedOn ? ` ראיות נבדקו ב-${d.evidence.latestCheckedOn}.` : ""}`) },
});
const OTHER_RESEARCH_LIMIT = 10;
function strategyResult(src: KnowledgeSources, v: ArtistSocial, brain: BrainSnapshot, today: string) {
  const x = intelOf(src, v, brain, today);
  const other = x.research.other.slice(0, OTHER_RESEARCH_LIMIT);
  return result([
    ...x.research.own.map((d) => digestItem(d, v.artistKey)),
    ...x.research.inspiration.map((d) => digestItem(d, v.artistKey)),
    ...other.map((d) => digestItem(d, v.artistKey)),
    ...x.research.acted.map((d) => digestItem(d, v.artistKey)),
  ], {
    summary: [
      sfact("IDENTITY", "זהות ואסטרטגיה מאושרות (החלטה עסקית, תחום סושיאל)", x.identity, "OWNER_DECISION", "OWNER_KNOWLEDGE"),
      sfact("RESEARCH", "מחקר לפי בסיס — ביצועי האמן / השראה / מחקר אחר (לא מחברים ביניהם)", { own: x.research.own.length, inspiration: x.research.inspiration.length, other: x.research.other.length, otherServed: other.length, acted: x.research.acted.length, basisHe: BASIS_HE }, "HYPOTHESIS", "SUNNY_BRAIN"),
      sfact("INSPIRATIONS_LEARN", "מה לומדים מכל השראה (באישור הבוס)", v.inspirations.map((a) => ({ resourceId: a.resourceId, label: a.label, platform: a.platform, learnHe: a.learnHe, lastCheckedOn: a.lastCheckedOn })), "OWNER_DECISION", "OWNER_KNOWLEDGE"),
      sfact("OPPORTUNITIES", `הזדמנויות תוכן מהפעילות האמיתית (${x.opportunities.horizonDays} יום קדימה)`, x.opportunities, x.opportunities.readable ? "DERIVED" : "UNKNOWN", "PROJECTS"),
      sfact("RESULTS", "תוצאות התוכן שפורסם (התאמה מדויקת לפי קישור הפוסט בלבד)", x.results === null ? null : { rows: x.results, heuristics: RESULT_HEURISTICS }, x.results === null ? "UNKNOWN" : "DERIVED", "OPERATIONS"),
      sfact("REVIEW", "בחינת המלצות מול מה שבוצע ומה שנמדד", x.review, "DERIVED", "SUNNY_BRAIN"),
      sfact("CADENCE", "יעדים, סדרות ומעקב שבועי (ראשון–שבת) — פריטים ופרסומים בנפרד", cadenceFact(v), "FACT", "OPERATIONS"),
    ],
    coverage: [
      partner("תובנה והמלצה הן השערות של סאני. מחקר על חשבון השראה הוא לא ביצועים של האמן. מחקר אחר הוא מאגר רעיונות, לא שייך לאמן."),
      ...(x.identity.known.length ? [] : [partner("עוד אין זהות ואסטרטגיה מאושרות לאמן הזה — לשאול את הבוס, להציע ניסוח, ולשמור רק אחרי אישור.")]),
      ...(x.viewRead ? [] : [partner("לא קראתי את פעילות האמן (סשנים / הופעות / צילומים) — ההזדמנויות לא ידועות, לא 'אין'.")]),
      ...(x.research.other.length > other.length ? [partner(`הוגשו ${other.length} מתוך ${x.research.other.length} רשומות מחקר אחרות (החדשות). השאר — brain mode records.`)] : []),
    ],
  });
}
function weeklyResult(src: KnowledgeSources, views: ArtistSocial[], brain: BrainSnapshot, today: string) {
  const since = new Date(Date.parse(`${today}T12:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10);
  const items = views.map((v) => {
    const x = intelOf(src, v, brain, today);
    const w = v.cadence.readable ? v.cadence.weeks[0] : null;
    const fresh = [...x.research.own, ...x.research.inspiration].filter((d) => d.createdOn >= since);
    const recent = (x.results ?? []).filter((r) => r.publishDate && r.publishDate >= since);
    const decisions = [
      ...(x.identity.complete ? [] : [`זהות ואסטרטגיה: חסרים ${x.identity.missing.length} נושאים לאישור`]),
      ...(v.cadence.readable && !v.cadence.targets.length ? ["אין יעד שבועי — להחליט אם לקבוע"] : []),
      ...(x.review.reviews.filter((r) => r.verdict === "NOT_TRIED").length ? [`${x.review.reviews.filter((r) => r.verdict === "NOT_TRIED").length} המלצות פתוחות שעוד לא נוסו — לאשר / לדחות`] : []),
      ...x.opportunities.attention.map((a) => a.titleHe),
    ];
    return item({
      id: `week:${v.artistKey}`, entity: v.artistKey, label: record(v.artistName), epistemic: "DERIVED", source: "OPERATIONS", freshness: "LIVE",
      fields: {
        week: w ? { weekStart: w.weekStart, items: w.items, publications: w.publications, overall: w.overall?.progress ?? null, breakdown: w.breakdown.map((b) => b.progress), series: w.series.map((s) => ({ name: s.series.name, progress: s.progress })), signals: w.signals } : null,
        results: recent, newResearch: fresh.map((d) => ({ recordId: d.recordId, recordType: d.recordType, titleHe: d.titleHe, basis: d.basis, createdOn: d.createdOn })),
        opportunities: x.opportunities.readable ? x.opportunities.items.slice(0, 5) : null, opportunitiesTotal: x.opportunities.items.length,
        identity: { known: x.identity.known.map((k) => k.topic), missing: x.identity.missing.length },
        review: x.review, decisionsHe: decisions,
        note: partner("תמונת מצב לפי בקשה בלבד. פריטים ≠ פרסומים; תוצאה אחת = אין מסקנה; מחקר השראה ≠ ביצועים של האמן."),
      },
    });
  });
  return result(items, { summary: [
    sfact("WEEK", "השבוע (ראשון–שבת, שעון ישראל)", { from: views[0]?.cadence.weeks[0]?.weekStart ?? null, to: views[0]?.cadence.weeks[0]?.weekEnd ?? null, newSince: since }, "FACT", "OPERATIONS"),
    sfact("PROFILE_TOPICS", "נושאי הזהות שסאני שואלת עליהם (שאלה אחת בכל פעם)", SOCIAL_PROFILE_TOPICS, "DERIVED", "OWNER_KNOWLEDGE"),
  ], coverage: [partner("שלוש ההמלצות ברמת הלייבל הן החשיבה של סאני מעל העובדות האלה — עם הבסיס לכל אחת, ובלי לשמור או לבצע דבר בלי אישור.")] });
}

export const artistSocial: KnowledgeCapability = {
  id: "artist_social", domain: "LABEL", titleHe: "סושיאל לכל אמן — זהות, השראות, מעקב",
  descriptionForModel: "Sunny as the label's social manager. artist = accounts, measurements (dated, old ≠ now), inspirations, content, CADENCE (Sun–Sat; items ≠ publications). BEFORE any social idea / plan / strategy call mode strategy: approved IDENTITY (missing topic → ask ONE question, propose wording, save only via partner_propose_knowledge BUSINESS_DECISION area SOCIAL about the artist after approval — never invent identity), research by basis (inspiration ≠ the artist's performance), OPPORTUNITIES (real activity, 14 days), RESULTS + REVIEW (one result = no conclusion). weekly = the label's week. Recommend concrete pieces with the why + basis (hypothesis); a target / series / content item is created only via its typed action after the Owner approves the preview.",
  examplesHe: ["מה מצב הסושיאל של אבי?", "מה החשבונות של שליו?", "ממי נגש לומד?", "מתי בדקנו את האינסטגרם של שליו?", "איזה חשבונות עוד לא שויכו?", "איך שליו עומד ביעד השבועי?", "מה מצב הסדרה Red Bars?"],
  modes: {
    artist: { descriptionForModel: "ONE label artist (params.entity = label-artist:<id>): accounts, inspirations, measurements, insights, content, weekly cadence (targets, series, 4 weeks back), label channels apart, unassigned accounts" },
    roster: { descriptionForModel: "Every roster artist side by side: accounts, last check, inspirations, open insights; plus the shared label channels and the unassigned accounts" },
    strategy: { descriptionForModel: "THE thinking package for ONE artist (params.entity): IDENTITY (Owner-approved profile topics + missing ones with the question to ask), research digests by BASIS (ARTIST_NAMED / ARTIST_ACCOUNTS = his performance; INSPIRATION = research on his inspiration, never his performance; OTHER_RESEARCH = idea pool) with claim / why / counter-evidence / confidence / correlation-vs-cause / evidence dates, INSPIRATIONS_LEARN, OPPORTUNITIES (real sessions / shows / shoots / releases, 14 days, link quality), RESULTS (exact post match only), REVIEW (recommendation → plan → item → results), CADENCE" },
    weekly: { descriptionForModel: "The label's social week (on request only), per artist: this week's items / publications / targets / signals, results published in the last 7 days, new research, the next opportunities, identity gaps, recommendation reviews and the decisions the Owner must make" },
  },
  defaultMode: "artist",
  params: { entity: { kind: "entityKey", types: ["label-artist"], descriptionForModel: "The label artist (mode artist)" } },
  entityScope: { types: ["label-artist"], param: "entity", mode: "artist", limit: 10 },
  paging: { defaultLimit: 20, maxLimit: 40 }, recordTextLimit: 300,
  access: { externalRead: true, ownerOnly: true, sensitivity: "STANDARD" }, needs: ["BRAIN", "OWNER_KNOWLEDGE", "STATE"], optionalNeeds: ["OPERATIONS"],
  // the thinking modes read the artist's real activity too (the artist view's own sources); mode artist stays light
  modeNeeds: { strategy: ["PROJECT_DETAIL", "LABEL_DETAIL", "CALENDAR"], weekly: ["PROJECT_DETAIL", "LABEL_DETAIL", "CALENDAR"] },
  read(src, q) {
    const bad = sourcesMissing(src);
    if (bad) return bad;
    const brain = src.brain!.status === "OK" ? src.brain!.value : null;
    const st = state(src)!;
    const today = st.todayIL ?? ilToday(src.now);
    const releases = (st.domains.releasesFull.data?.items ?? []).map((r) => ({ labelArtistId: r.labelArtistId, targetYmd: r.targetYmd, released: !!r.releasedAt, changedAt: r.stageEnteredAt ?? r.createdAt }));
    const roster = st.domains.labelArtists.data!.items;
    const o = ok(src.operations);
    const ops = o?.campaigns && o.contentItems ? { campaigns: o.campaigns.rows, items: o.contentItems.rows, series: o.socialSeries?.rows ?? null, targets: o.socialTargets?.rows ?? null } : null;
    const viewOf = (a: { id: string; name: string }) => artistSocialOf({ brain: brain!, knowledge: ok(src.ownerKnowledge)!, todayIL: today, now: src.now, artist: { id: a.id, name: a.name }, releases, ops });
    const partial = brain!.truncated ? { completeness: "PARTIAL" as const, coverage: [partner("נקראו רק 1,000 השורות האחרונות מכל סוג במוח של סאני.")] } : {};
    if (q.mode === "roster") {
      const views = roster.map(viewOf);
      const first = views[0];
      return result(views.map((v) => item({
        id: `artist:${v.artistKey}`, entity: v.artistKey, label: record(v.artistName), epistemic: "DERIVED", source: "SUNNY_BRAIN", freshness: "HISTORICAL",
        fields: { accounts: v.accounts.map((a) => ({ resourceId: a.resourceId, label: record(a.label), channelPurposeHe: a.ownership?.channelPurposeHe ?? null, lastCheckedOn: a.lastCheckedOn })), lastCheckedOn: v.lastCheckedOn, inspirations: v.inspirations.length, liveRecords: v.records.length,
          content: v.content.readable ? { total: v.content.total, byPhase: v.content.byPhase, overdue: v.content.overdue.length, upcoming: v.content.upcoming.length, undated: v.content.undated } : null,
          week: v.cadence.readable ? { items: v.cadence.weeks[0]?.items, publications: v.cadence.weeks[0]?.publications, overallTarget: v.cadence.weeks[0]?.overall?.progress ?? null, signals: v.cadence.weeks[0]?.signals ?? [], activeSeries: v.cadence.series.filter((x) => x.status === "ACTIVE").map((x) => x.name) } : null,
          note: partner(v.accounts.length ? "רק חשבונות שהבוס אישר כשלו נספרים כאן." : "עוד אין חשבון שאושר כשלו — אין לפרש זאת כ'אין לו סושיאל'.") },
      })), { summary: [
        sfact("LABEL_CHANNELS", "ערוצי לייבל משותפים (לא נספרים לאף אמן)", first ? first.labelChannels.map((a) => ({ resourceId: a.resourceId, label: a.label, lastCheckedOn: a.lastCheckedOn })) : [], "OWNER_DECISION", "OWNER_KNOWLEDGE"),
        sfact("UNASSIGNED_ACCOUNTS", "חשבונות במעקב שעוד לא שויכו (פער)", first ? first.unassignedAccounts : [], "FACT", "SUNNY_BRAIN"),
      ], ...partial });
    }
    if (q.mode === "weekly") return weeklyResult(src, roster.map(viewOf), brain!, today);
    const key = q.params.entity;
    if (!key) return result([], { completeness: "UNKNOWN", missing: [{ fact: "entity", whyNeeded: "pass params.entity = label-artist:<id> (mode roster lists every artist)" }] });
    const a = roster.find((x) => `label-artist:${x.id}` === key);
    if (!a) return result([], { completeness: "UNKNOWN", missing: [{ fact: "label_artist", whyNeeded: `${key} is not on the current roster` }] });
    const v = viewOf(a);
    if (q.mode === "strategy") return strategyResult(src, v, brain!, today);
    return result(artistItems(v), {
      summary: summaryOf(v), ...partial,
      coverage: [
        ...(partial.coverage ?? []),
        ...(v.accounts.length ? [] : [partner("עוד אין חשבון שאושר כשל האמן הזה — זה לא אומר שאין לו סושיאל. שיוך נעשה רק באישור הבוס.")]),
        partner("המדידות מגיעות רק מבדיקות דפדפן שהבוס ביקש — אין API ואין מעקב ברקע."),
        ...(v.content.readable ? [] : [partner("לא הצלחתי לקרוא את התוכן של האמן — זה לא אומר שאין תוכן.")]),
      ],
    });
  },
};
