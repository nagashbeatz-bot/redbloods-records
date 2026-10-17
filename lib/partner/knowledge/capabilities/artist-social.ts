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
import type { KnowledgeCapability, KnowledgeItem, KnowledgeReadResult, KnowledgeSources } from "../types";
import { item, ok, partner, record, result, sfact, state } from "./common";

const ilToday = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

function sourcesMissing(src: KnowledgeSources): KnowledgeReadResult | null {
  const missing: KnowledgeReadResult["missing"] = [];
  if (src.brain?.status !== "OK") missing.push({ fact: "sunny_brain", whyNeeded: "the tracked accounts and measurements could not be read" });
  if (!ok(src.ownerKnowledge)) missing.push({ fact: "owner_knowledge", whyNeeded: "whose account it is comes from the Owner's approved knowledge, which could not be read" });
  if (!state(src)?.domains.labelArtists.data) missing.push({ fact: "label_artists", whyNeeded: "the roster could not be read" });
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

const summaryOf = (v: ArtistSocial) => [
  sfact("ACCOUNTS", "החשבונות של האמן (שיוך שאישרת)", v.accounts.length, "OWNER_DECISION", "OWNER_KNOWLEDGE"),
  sfact("LAST_CHECKED_ON", "בדיקה אחרונה של החשבונות שלו", v.lastCheckedOn, "OBSERVATION", "SUNNY_BRAIN", "HISTORICAL"),
  sfact("INSPIRATIONS", "חשבונות השראה שלו", v.inspirations.length, "OWNER_DECISION", "OWNER_KNOWLEDGE"),
  sfact("LIVE_RECORDS", "תובנות / המלצות פתוחות שקשורות אליו", v.records.length, "HYPOTHESIS", "SUNNY_BRAIN"),
  sfact("RECHECK_PROPOSAL", "הצעה לבדיקה חוזרת — לשאול את הבוס, לא לבצע לבד", v.recheck, "DERIVED", "SUNNY_BRAIN"),
  sfact("UNASSIGNED_ACCOUNTS", "חשבונות במעקב שעוד לא שויכו לאף אחד (פער — לא מנחשים לפי שם)", v.unassignedAccounts, "FACT", "SUNNY_BRAIN"),
];

export const artistSocial: KnowledgeCapability = {
  id: "artist_social", domain: "LABEL", titleHe: "סושיאל לכל אמן — זהות, השראות, מעקב",
  descriptionForModel: "Per label artist: the artist's social accounts (only those the Owner approved — ENTITY_RELATIONSHIP OWNS_RESOURCE + channelPurpose), shared label channels APART (owner Redbloods, never the artist's own performance), the artist's inspirations (INSPIRATION_SOURCE + what we learn), every stored measurement with its check date, age, TODAY / EARLIER and change since the previous check (old is never now), insights / recommendations that name the artist or rest on the artist's accounts (HYPOTHESIS, tie CANONICAL / DERIVED), at most ONE recheck proposal (ask first, never browse before the Owner's yes) and unassignedAccounts (a gap — never guess by name; link via partner_propose_knowledge with the Owner's approval). mode roster = all artists. Data = Owner-requested browser checks only.",
  examplesHe: ["מה מצב הסושיאל של אבי?", "מה החשבונות של שליו?", "ממי נגש לומד?", "מתי בדקנו את האינסטגרם של שליו?", "איזה חשבונות עוד לא שויכו?"],
  modes: {
    artist: { descriptionForModel: "ONE label artist (params.entity = label-artist:<id>): accounts, inspirations, measurements, insights, label channels apart, unassigned accounts" },
    roster: { descriptionForModel: "Every roster artist side by side: accounts, last check, inspirations, open insights; plus the shared label channels and the unassigned accounts" },
  },
  defaultMode: "artist",
  params: { entity: { kind: "entityKey", types: ["label-artist"], descriptionForModel: "The label artist (mode artist)" } },
  entityScope: { types: ["label-artist"], param: "entity", mode: "artist", limit: 10 },
  paging: { defaultLimit: 20, maxLimit: 40 }, recordTextLimit: 300,
  access: { externalRead: true, ownerOnly: true, sensitivity: "STANDARD" }, needs: ["BRAIN", "OWNER_KNOWLEDGE", "STATE"],
  read(src, q) {
    const bad = sourcesMissing(src);
    if (bad) return bad;
    const brain = src.brain!.status === "OK" ? src.brain!.value : null;
    const st = state(src)!;
    const today = st.todayIL ?? ilToday(src.now);
    const releases = (st.domains.releasesFull.data?.items ?? []).map((r) => ({ labelArtistId: r.labelArtistId, targetYmd: r.targetYmd, released: !!r.releasedAt, changedAt: r.stageEnteredAt ?? r.createdAt }));
    const roster = st.domains.labelArtists.data!.items;
    const viewOf = (a: { id: string; name: string }) => artistSocialOf({ brain: brain!, knowledge: ok(src.ownerKnowledge)!, todayIL: today, now: src.now, artist: { id: a.id, name: a.name }, releases });
    const partial = brain!.truncated ? { completeness: "PARTIAL" as const, coverage: [partner("נקראו רק 1,000 השורות האחרונות מכל סוג במוח של סאני.")] } : {};
    if (q.mode === "roster") {
      const views = roster.map(viewOf);
      const first = views[0];
      return result(views.map((v) => item({
        id: `artist:${v.artistKey}`, entity: v.artistKey, label: record(v.artistName), epistemic: "DERIVED", source: "SUNNY_BRAIN", freshness: "HISTORICAL",
        fields: { accounts: v.accounts.map((a) => ({ resourceId: a.resourceId, label: record(a.label), channelPurposeHe: a.ownership?.channelPurposeHe ?? null, lastCheckedOn: a.lastCheckedOn })), lastCheckedOn: v.lastCheckedOn, inspirations: v.inspirations.length, liveRecords: v.records.length,
          note: partner(v.accounts.length ? "רק חשבונות שהבוס אישר כשלו נספרים כאן." : "עוד אין חשבון שאושר כשלו — אין לפרש זאת כ'אין לו סושיאל'.") },
      })), { summary: [
        sfact("LABEL_CHANNELS", "ערוצי לייבל משותפים (לא נספרים לאף אמן)", first ? first.labelChannels.map((a) => ({ resourceId: a.resourceId, label: a.label, lastCheckedOn: a.lastCheckedOn })) : [], "OWNER_DECISION", "OWNER_KNOWLEDGE"),
        sfact("UNASSIGNED_ACCOUNTS", "חשבונות במעקב שעוד לא שויכו (פער)", first ? first.unassignedAccounts : [], "FACT", "SUNNY_BRAIN"),
      ], ...partial });
    }
    const key = q.params.entity;
    if (!key) return result([], { completeness: "UNKNOWN", missing: [{ fact: "entity", whyNeeded: "pass params.entity = label-artist:<id> (mode roster lists every artist)" }] });
    const a = roster.find((x) => `label-artist:${x.id}` === key);
    if (!a) return result([], { completeness: "UNKNOWN", missing: [{ fact: "label_artist", whyNeeded: `${key} is not on the current roster` }] });
    const v = viewOf(a);
    return result(artistItems(v), {
      summary: summaryOf(v), ...partial,
      coverage: [
        ...(partial.coverage ?? []),
        ...(v.accounts.length ? [] : [partner("עוד אין חשבון שאושר כשל האמן הזה — זה לא אומר שאין לו סושיאל. שיוך נעשה רק באישור הבוס.")]),
        partner("המדידות מגיעות רק מבדיקות דפדפן שהבוס ביקש — אין API ואין מעקב ברקע."),
      ],
    });
  },
};
