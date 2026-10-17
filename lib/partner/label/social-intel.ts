/**
 * Sunny Social Intelligence (Owner mission 2026-10-17) — the ONE derived thinking layer behind Sunny as the label's social
 * manager. PURE: it reads what Redbloods already has and copies nothing (no table, no second Brain, no new rule):
 *
 *   identity      the Owner-approved BUSINESS_DECISION (area SOCIAL, about = the artist) per profile topic — never invented;
 *                 a missing topic is a question for the Owner, never a guess.
 *   research      every LIVE Brain insight / recommendation, classified per artist by BASIS:
 *                   ARTIST_NAMED     the record names the artist (entityKeys) — CANONICAL
 *                   ARTIST_ACCOUNTS  it rests on the artist's own accounts / their content — DERIVED (the artist's performance)
 *                   INSPIRATION      it rests on an account the Owner approved as THIS artist's inspiration — research about
 *                                    someone else, NEVER the artist's performance
 *                   OTHER_RESEARCH   any other live social research — an idea pool, never attributed to the artist
 *                 each with the reasoning, counter-evidence, confidence, correlation-vs-cause and its evidence dates.
 *   opportunities the artist's real upcoming activity (sessions, shows, shoots, releases, edit material, calendar mentions) in
 *                 the next 14 days, from the artist view's OWN link rules (buildArtistView) with their honest link quality.
 *   results       a published Redbloods item ↔ the Brain's measured post ONLY by the exact canonical post URL (a hash —
 *                 never a name), against the median of the same account's other measured posts (internal heuristic).
 *   review        a recommendation → the plan that implemented it (Brain IMPLEMENTED_BY, canonical) → the content item that
 *                 plan created (the action history, when read) → its results → a cautious verdict (one result = no verdict).
 *
 * Nothing here writes, schedules, pushes, browses or decides. Every recommendation stays a HYPOTHESIS.
 */
import { brainState, type BrainRecord, type BrainSnapshot } from "../brain/model";
import { STATUS_HE } from "../brain/vocab";
import { activeKnowledge, type OwnerKnowledgeRecord } from "../owner-knowledge/store";
import { socialPhaseOf } from "@/lib/types";

const LIVE = new Set(["OPEN", "ENDORSED", "ACCEPTED"]);
const SOCIAL_AREAS = new Set(["SOCIAL", "MARKETING", "CONTENT"]);
const ilYmd = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
const addDays = (ymd: string, n: number) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
const txt = (v: unknown, max = 240): string | null => {
  const s = typeof v === "string" ? v : v && typeof v === "object" && typeof (v as { text?: unknown }).text === "string" ? String((v as { text: string }).text) : null;
  if (!s || !s.trim()) return null;
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};
const median = (xs: number[]) => { const a = [...xs].sort((x, y) => x - y); const m = Math.floor(a.length / 2); return a.length ? (a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2) : null; };

// ── identity (Owner-approved BUSINESS_DECISION, area SOCIAL, about = the artist) ──
export const SOCIAL_PROFILE_TOPICS = [
  { topic: "profile-identity", he: "זהות ומיצוב מוזיקלי", askHe: "איך היית מתאר את האמן במשפט אחד — מי הוא ומה הוא מביא?" },
  { topic: "profile-genres", he: "סגנון וז׳אנרים", askHe: "באילו ז׳אנרים וסגנונות הוא נמצא, ובמה לא?" },
  { topic: "profile-audience", he: "קהל יעד", askHe: "מי הקהל שאנחנו רוצים להגיע אליו (גיל, אזור, סצנה)?" },
  { topic: "profile-tone", he: "אישיות וטון", askHe: "איך הוא מדבר מול מצלמה — מצחיק, רציני, רחוב, רגשי?" },
  { topic: "profile-goals", he: "מטרות שיווקיות", askHe: "מה המטרה בחצי השנה הקרובה — חשיפה, הופעות, קהל לריליס, מותג?" },
  { topic: "profile-strengths", he: "יתרונות וחוזקות", askHe: "במה הוא הכי חזק — קול, במה, כתיבה, אישיות, הפקה?" },
  { topic: "profile-develop", he: "מה צריך לחזק", askHe: "מה חסר לו היום בסושיאל ושצריך לבנות?" },
  { topic: "profile-boundaries", he: "גבולות — מה לא מפרסמים", askHe: "מה לא מתאים לו לפרסום (נושאים, סגנון, פרטיות)?" },
  { topic: "strategy-short", he: "אסטרטגיה לטווח קצר", askHe: "על מה לשים דגש בחודש-חודשיים הקרובים?" },
  { topic: "strategy-long", he: "אסטרטגיה לטווח ארוך", askHe: "איפה הוא צריך להיות בעוד שנה?" },
] as const;
export interface IdentityEntry { topic: string; he: string; decisionHe: string; rationaleHe: string | null; decidedOn: string | null; reviewAt: string | null; reviewDue: boolean; knowledgeId: string; approvedOn: string }
export interface ArtistIdentity { known: IdentityEntry[]; other: IdentityEntry[]; missing: Array<{ topic: string; he: string; askHe: string }>; complete: boolean; noteHe: string }
const topicSlug = (t: string) => t.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
export function identityOf(knowledge: readonly OwnerKnowledgeRecord[], artistKey: string, todayIL: string): ArtistIdentity {
  const rows = activeKnowledge(knowledge, todayIL).filter((k) => k.kind === "BUSINESS_DECISION" && String(k.value.area ?? "") === "SOCIAL" && String(k.value.about ?? "") === artistKey);
  const entry = (k: (typeof rows)[number], he: string): IdentityEntry => {
    const reviewAt = typeof k.value.reviewAt === "string" ? k.value.reviewAt : null;
    return { topic: topicSlug(String(k.value.topic ?? "")), he, decisionHe: txt(k.value.decisionHe, 200) ?? "", rationaleHe: txt(k.value.rationaleHe, 200), decidedOn: typeof k.value.decidedOn === "string" ? k.value.decidedOn : null, reviewAt, reviewDue: !!reviewAt && reviewAt <= todayIL, knowledgeId: k.id, approvedOn: k.createdAt.slice(0, 10) };
  };
  const byTopic = new Map(rows.map((k) => [topicSlug(String(k.value.topic ?? "")), k]));
  const known = SOCIAL_PROFILE_TOPICS.filter((t) => byTopic.has(t.topic)).map((t) => entry(byTopic.get(t.topic)!, t.he));
  const other = rows.filter((k) => !SOCIAL_PROFILE_TOPICS.some((t) => t.topic === topicSlug(String(k.value.topic ?? "")))).map((k) => entry(k, String(k.value.topic ?? "")));
  const missing = SOCIAL_PROFILE_TOPICS.filter((t) => !byTopic.has(t.topic)).map((t) => ({ topic: t.topic, he: t.he, askHe: t.askHe }));
  return { known, other, missing, complete: missing.length === 0,
    noteHe: known.length ? "רק מה שהבוס אישר (החלטה עסקית, תחום סושיאל). נושא חסר = לשאול, לא לנחש." : "עוד אין זהות ואסטרטגיה מאושרות — כל התאמה לאמן היא השערה עד שהבוס מאשר. לשאול שאלה אחת בכל פעם ולהציע ניסוח לאישור." };
}

// ── research digests ──
export type ResearchBasis = "ARTIST_NAMED" | "ARTIST_ACCOUNTS" | "INSPIRATION" | "OTHER_RESEARCH";
export const BASIS_HE: Record<ResearchBasis, string> = {
  ARTIST_NAMED: "נוגע לאמן במפורש",
  ARTIST_ACCOUNTS: "נשען על החשבונות של האמן (ביצועים שלו)",
  INSPIRATION: "מחקר על חשבון השראה שלו — לא ביצועים שלו",
  OTHER_RESEARCH: "מחקר אחר של הלייבל — רעיון אפשרי, לא שייך לאמן",
};
const CAUSAL_HE: Record<string, string> = { CORRELATION_ONLY: "מתאם בלבד — לא סיבה", PLAUSIBLE_CAUSE: "סיבה סבירה — לא הוכחה", TESTED: "נבדק" };
export interface ResearchDigest {
  recordId: string; recordType: string; titleHe: string; status: string | null; statusHe: string | null; createdOn: string; confidence: string;
  basis: ResearchBasis; basisHe: string; performanceOfArtist: boolean;
  claimHe: string | null; whyHe: string | null; counterHe: string | null; expectedHe: string | null; presentedHe: string | null;
  causalStatus: string | null; causalHe: string | null; insightKind: string | null; period: { from: string | null; to: string | null } | null;
  evidence: { observations: number; latestCheckedOn: string | null; ageDays: number | null; fromRecords: string[] };
  sources: Array<{ resourceId: string; label: string; platform: string; whose: "ARTIST" | "INSPIRATION" | "LABEL_CHANNEL" | "OTHER" }>;
  namedArtists: string[];
  implementedBy: Array<{ planId: string; linkedOn: string }>;
}
export interface ResearchContext {
  artistKey: string; todayIL: string;
  /** the artist's own accounts + their content */ ownIds: ReadonlySet<string>;
  /** THIS artist's inspiration accounts + their content */ inspirationIds: ReadonlySet<string>;
  /** shared label channels + their content */ sharedIds: ReadonlySet<string>;
}
export interface ArtistResearch { own: ResearchDigest[]; inspiration: ResearchDigest[]; other: ResearchDigest[]; acted: ResearchDigest[]; totalLive: number }
export function researchOf(brain: BrainSnapshot, c: ResearchContext, now: Date): ArtistResearch {
  const st = brainState(brain, c.todayIL, now.toISOString());
  const resById = new Map(brain.resources.map((r) => [r.id, r]));
  const labelOf = (id: string) => { const r = resById.get(id); return r ? r.displayName ?? r.identityKey : id; };
  const whose = (id: string): ResearchDigest["sources"][number]["whose"] => (c.ownIds.has(id) ? "ARTIST" : c.inspirationIds.has(id) ? "INSPIRATION" : c.sharedIds.has(id) ? "LABEL_CHANNEL" : "OTHER");
  const digest = (rec: BrainRecord, basis: ResearchBasis): ResearchDigest => {
    const b = rec.body ?? {};
    const status = st.recordStatus(rec.id);
    const evLinks = brain.links.filter((l) => l.toRecordId === rec.id && (l.role === "EVIDENCE_FOR" || l.role === "RECOMMENDS" || l.role === "DERIVED_FROM") && st.linkActive(l.id));
    const obs = evLinks.filter((l) => l.fromObservationId).map((l) => brain.observations.find((o) => o.id === l.fromObservationId)).filter((o): o is NonNullable<typeof o> => !!o);
    const latest = obs.map((o) => ilYmd(o.observedAt)).sort().at(-1) ?? null;
    const fromRecords = [...new Set([...evLinks.filter((l) => l.fromRecordId).map((l) => l.fromRecordId!), ...brain.links.filter((l) => l.fromRecordId === rec.id && l.role === "DERIVED_FROM" && l.toRecordId && st.linkActive(l.id)).map((l) => l.toRecordId!)])];
    const causal = txt(b.causalStatus, 40);
    return {
      recordId: rec.id, recordType: rec.recordType, titleHe: rec.titleHe, status, statusHe: status ? STATUS_HE[status] ?? status : null, createdOn: ilYmd(rec.createdAt), confidence: rec.confidence,
      basis, basisHe: BASIS_HE[basis], performanceOfArtist: basis === "ARTIST_ACCOUNTS" || basis === "ARTIST_NAMED",
      claimHe: txt(b.statementHe) ?? txt(b.recommendationHe), whyHe: txt(b.reasoningHe) ?? txt(b.whyHe), counterHe: txt(b.counterEvidenceHe), expectedHe: txt(b.expectedEffectHe), presentedHe: txt(b.presentedHe, 320),
      causalStatus: causal, causalHe: causal ? CAUSAL_HE[causal] ?? causal : null, insightKind: txt(b.insightKind, 40),
      period: b.periodFrom || b.periodTo ? { from: txt(b.periodFrom, 10), to: txt(b.periodTo, 10) } : null,
      evidence: { observations: obs.length, latestCheckedOn: latest, ageDays: latest ? daysBetween(latest, c.todayIL) : null, fromRecords },
      sources: rec.resourceIds.map((id) => ({ resourceId: id, label: labelOf(id), platform: resById.get(id)?.platform ?? "", whose: whose(id) })),
      namedArtists: rec.entityKeys.filter((k) => k.startsWith("label-artist:")),
      implementedBy: brain.links.filter((l) => l.fromRecordId === rec.id && l.role === "IMPLEMENTED_BY" && l.toRef?.startsWith("plan:") && st.linkActive(l.id)).map((l) => ({ planId: l.toRef!.slice(5), linkedOn: ilYmd(l.createdAt) })),
    };
  };
  const out: ArtistResearch = { own: [], inspiration: [], other: [], acted: [], totalLive: 0 };
  for (const rec of brain.records) {
    const status = st.recordStatus(rec.id) ?? "";
    const named = rec.entityKeys.includes(c.artistKey);
    const own = rec.resourceIds.some((id) => c.ownIds.has(id));
    const insp = rec.resourceIds.some((id) => c.inspirationIds.has(id));
    const social = SOCIAL_AREAS.has(rec.area);
    const basis: ResearchBasis | null = named ? "ARTIST_NAMED" : own ? "ARTIST_ACCOUNTS" : insp ? "INSPIRATION" : social ? "OTHER_RESEARCH" : null;
    if (!basis) continue;
    if (status === "ACTED_ON") { if (basis !== "OTHER_RESEARCH") out.acted.push(digest(rec, basis)); continue; }
    if (!LIVE.has(status)) continue;
    out.totalLive++;
    const d = digest(rec, basis);
    (basis === "INSPIRATION" ? out.inspiration : basis === "OTHER_RESEARCH" ? out.other : out.own).push(d);
  }
  const byNew = (a: ResearchDigest, b: ResearchDigest) => b.createdOn.localeCompare(a.createdOn) || a.recordId.localeCompare(b.recordId);
  out.own.sort(byNew); out.inspiration.sort(byNew); out.other.sort(byNew); out.acted.sort(byNew);
  return out;
}

// ── opportunities (the artist view's own link rules) ──
/** The minimal shape of buildArtistView this layer reads (decoupled for tests). */
export interface ArtistViewLite {
  projects: ReadonlyArray<{ key: string; name: string; basis: string; quality: string }>;
  releases: ReadonlyArray<{ key: string; projectName: string | null; stage: string | null; active: boolean; targetDate: string | null; releasedAt: string | null }>;
  shows: ReadonlyArray<{ key: string; name: string | null; date: string | null; status: string | null; upcoming: boolean; link: string }>;
  sessions: ReadonlyArray<{ date: string | null; start: string | null; status: string | null; type: string | null; project: string | null; show: string | null }>;
  redFilms: ReadonlyArray<{ title: string | null; type: string | null; status: string | null; shootDate: string | null; publishDate: string | null; editStatus: string | null; project: string | null; link: string }>;
  calendar: { status: string; ambiguous?: ReadonlyArray<{ title: string; start: string }> } | { status: string; note: string };
}
export type OpportunityKind = "SESSION" | "SHOOT" | "SHOW" | "RELEASE" | "EDIT_MATERIAL" | "CALENDAR_MENTION";
export type OpportunityLink = "CANONICAL" | "TEXT_MATCH" | "AMBIGUOUS";
export interface ContentOpportunity { kind: OpportunityKind; date: string | null; titleHe: string; source: string | null; link: OpportunityLink; linkHe: string; anglesHe: string[]; noteHe: string | null }
export const OPPORTUNITY_HORIZON_DAYS = 14;
const ANGLES: Record<OpportunityKind, string[]> = {
  SESSION: ["מאחורי הקלעים מהסשן", "רגע תגובה אמיתי לביט / לסקיצה", "בית אחד / פריסטייל מהאולפן"],
  SHOOT: ["BTS מהצילום", "טיזר קצר מהסט"],
  SHOW: ["חזרות", "טיזר לפני ההופעה", "רגעי במה וקהל"],
  RELEASE: ["ספירה לאחור", "יום יציאה", "תודה לקהל אחרי"],
  EDIT_MATERIAL: ["טיזר מחומר שכבר צולם"],
  CALENDAR_MENTION: ["לבדוק עם הבוס אם האמן משתתף — ואז לתכנן תוכן"],
};
const LINK_HE: Record<OpportunityLink, string> = { CANONICAL: "קישור קנוני לאמן", TEXT_MATCH: "התאמה לפי שם — לא קישור קנוני", AMBIGUOUS: "שיתוף פעולה / אורח — האמן לא משויך בוודאות" };
const qualityOf = (basis: string | undefined, quality: string | undefined): OpportunityLink => (basis === "NAME_COLLABORATION" ? "AMBIGUOUS" : quality === "CANONICAL_RELATION" ? "CANONICAL" : "TEXT_MATCH");
export function opportunitiesOf(v: ArtistViewLite | null, todayIL: string, horizon = OPPORTUNITY_HORIZON_DAYS): { readable: boolean; horizonDays: number; items: ContentOpportunity[]; attention: ContentOpportunity[]; noteHe: string } {
  if (!v) return { readable: false, horizonDays: horizon, items: [], attention: [], noteHe: "לא קראתי את פעילות האמן (פרויקטים / סשנים / הופעות / צילומים) — זה לא אומר שאין פעילות." };
  const end = addDays(todayIL, horizon);
  const inWin = (d: string | null) => !!d && /^\d{4}-\d{2}-\d{2}/.test(d) && d.slice(0, 10) >= todayIL && d.slice(0, 10) <= end;
  const proj = new Map(v.projects.map((p) => [p.key, p]));
  const angles = (k: OpportunityKind) => [...ANGLES[k]];
  const items: ContentOpportunity[] = [];
  const attention: ContentOpportunity[] = [];
  for (const s of v.sessions) {
    if (!inWin(s.date) || s.status === "בוטל") continue;
    const p = s.project ? proj.get(s.project) : undefined;
    const link = s.show ? "TEXT_MATCH" : qualityOf(p?.basis, p?.quality);
    const kind: OpportunityKind = /צילום/.test(s.type ?? "") ? "SHOOT" : "SESSION";
    items.push({ kind, date: s.date!.slice(0, 10), titleHe: `${s.type ?? "סשן"}${p ? ` · ${p.name}` : ""}${s.start ? ` · ${s.start}` : ""}`, source: s.project ?? s.show, link, linkHe: LINK_HE[link], anglesHe: angles(kind), noteHe: null });
  }
  for (const s of v.shows) {
    if (!inWin(s.date) || s.status === "בוטל") continue;
    items.push({ kind: "SHOW", date: s.date!.slice(0, 10), titleHe: `הופעה${s.name ? ` · ${s.name}` : ""}`, source: s.key, link: "TEXT_MATCH", linkHe: LINK_HE.TEXT_MATCH, anglesHe: angles("SHOW"), noteHe: null });
  }
  for (const r of v.releases) {
    if (!r.active || r.releasedAt) continue;
    if (inWin(r.targetDate)) items.push({ kind: "RELEASE", date: r.targetDate!.slice(0, 10), titleHe: `ריליס${r.projectName ? ` · ${r.projectName}` : ""} (שלב: ${r.stage ?? "—"})`, source: r.key, link: "CANONICAL", linkHe: LINK_HE.CANONICAL, anglesHe: angles("RELEASE"), noteHe: r.stage === "רעיון" ? "תאריך היעד קרוב והשלב עדיין 'רעיון' — לבדוק עם הבוס אם התאריך עדיין נכון" : null });
    else if (r.targetDate && r.targetDate.slice(0, 10) < todayIL) attention.push({ kind: "RELEASE", date: r.targetDate.slice(0, 10), titleHe: `ריליס${r.projectName ? ` · ${r.projectName}` : ""} — תאריך היעד עבר והוא לא סומן כיצא`, source: r.key, link: "CANONICAL", linkHe: LINK_HE.CANONICAL, anglesHe: [], noteHe: "עבר הזמן ≠ יצא — לשאול את הבוס" });
  }
  for (const r of v.redFilms) {
    if (r.status === "בוטל") continue;
    const p = r.project ? proj.get(r.project) : undefined;
    const link: OpportunityLink = r.link === "via project" ? qualityOf(p?.basis, p?.quality) : "TEXT_MATCH";
    if (inWin(r.shootDate)) items.push({ kind: "SHOOT", date: r.shootDate!.slice(0, 10), titleHe: `יום צילום${r.title ? ` · ${r.title}` : ""}`, source: r.project, link, linkHe: LINK_HE[link], anglesHe: angles("SHOOT"), noteHe: null });
    else if (r.shootDate && r.shootDate.slice(0, 10) < todayIL && !r.publishDate && r.status !== "פורסם")
      items.push({ kind: "EDIT_MATERIAL", date: null, titleHe: `חומר מצילום ${r.shootDate.slice(0, 10)}${r.title ? ` · ${r.title}` : ""} (עריכה: ${r.editStatus ?? "—"})`, source: r.project, link, linkHe: LINK_HE[link], anglesHe: angles("EDIT_MATERIAL"), noteHe: "צולם לפי הרשומה; התאריך שעבר לא מוכיח שהחומר מוכן — לבדוק" });
  }
  if ("ambiguous" in v.calendar && v.calendar.ambiguous) for (const e of v.calendar.ambiguous) {
    const d = e.start?.slice(0, 10) ?? null;
    if (!inWin(d)) continue;
    items.push({ kind: "CALENDAR_MENTION", date: d, titleHe: `ביומן: ${e.title}`, source: null, link: "TEXT_MATCH", linkHe: "השם מופיע בכותרת אירוע ביומן — לא קישור קנוני", anglesHe: angles("CALENDAR_MENTION"), noteHe: null });
  }
  items.sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999") || a.titleHe.localeCompare(b.titleHe));
  return { readable: true, horizonDays: horizon, items, attention,
    noteHe: "נקודות פתיחה כלליות לפי סוג האירוע — ההתאמה לאמן נעשית מול הזהות והאסטרטגיה שאישרת. שום פריט, משימה או אירוע לא נוצר בלי אישור." };
}

// ── results (exact post URL hash only) + recommendation review ──
export interface ResultRow {
  contentKey: string; title: string; publishDate: string | null; platform: string | null;
  match: "MATCHED" | "NO_POSTED_LINK" | "NOT_MEASURED";
  resourceId: string | null; checkedOn: string | null; ageAtCheckDays: number | null;
  metrics: { views: number | null; likes: number | null; comments: number | null };
  baseline: { medianViews: number | null; posts: number };
  verdict: "ABOVE_BASELINE" | "NEAR_BASELINE" | "BELOW_BASELINE" | "BASELINE_TOO_SMALL" | "NO_VIEWS" | null;
  cautionHe: string | null;
}
export const RESULT_HEURISTICS = { aboveRatio: 1.25, belowRatio: 0.75, minBaselinePosts: 3, youngPostDays: 7, heuristic: true } as const;
export interface PublishedItem { id: string; title: string; status: string | null; platform: string | null; publishDate: string | null; postedHash: string | null }
export function resultsOf(items: readonly PublishedItem[], brain: BrainSnapshot, hashOfResource: ReadonlyMap<string, string>, todayIL: string, now: Date): ResultRow[] {
  const st = brainState(brain, todayIL, now.toISOString());
  const byHash = new Map<string, string>();
  for (const [rid, h] of hashOfResource) if (st.resourceActive(rid)) byHash.set(h, rid);
  const latestOf = (rid: string, metric: string) => brain.observations.filter((o) => o.resourceId === rid && o.type.endsWith(`.${metric}`) && typeof o.valueNum === "number" && st.observationValid(o.id))
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0] ?? null;
  return items.filter((x) => socialPhaseOf(x.status) === "PUBLISHED").map((x): ResultRow => {
    const base: ResultRow = { contentKey: `social-content:${x.id}`, title: x.title, publishDate: x.publishDate, platform: x.platform, match: "NO_POSTED_LINK", resourceId: null, checkedOn: null, ageAtCheckDays: null, metrics: { views: null, likes: null, comments: null }, baseline: { medianViews: null, posts: 0 }, verdict: null, cautionHe: null };
    if (!x.postedHash) return { ...base, cautionHe: "אין קישור לפוסט שפורסם — אי אפשר למדוד (לא מתאימים לפי שם)" };
    const rid = byHash.get(x.postedHash);
    if (!rid) return { ...base, match: "NOT_MEASURED", cautionHe: "הפוסט עוד לא נבדק בדפדפן — אין מדידה" };
    const v = latestOf(rid, "VIEWS"), l = latestOf(rid, "LIKES"), cm = latestOf(rid, "COMMENTS");
    const checked = [v, l, cm].filter(Boolean).map((o) => o!.observedAt).sort().at(-1) ?? null;
    const checkedOn = checked ? ilYmd(checked) : null;
    const parent = brain.resources.find((r) => r.id === rid)?.parentId ?? null;
    const peers = parent ? brain.resources.filter((r) => r.parentId === parent && r.id !== rid && r.resourceKind === "CONTENT").map((r) => latestOf(r.id, "VIEWS")?.valueNum).filter((n): n is number => typeof n === "number") : [];
    const med = median(peers);
    const age = checkedOn && x.publishDate ? daysBetween(x.publishDate.slice(0, 10), checkedOn) : null;
    const views = v?.valueNum ?? null;
    const verdict: ResultRow["verdict"] = views === null ? "NO_VIEWS" : peers.length < RESULT_HEURISTICS.minBaselinePosts || med === null || med <= 0 ? "BASELINE_TOO_SMALL"
      : views >= med * RESULT_HEURISTICS.aboveRatio ? "ABOVE_BASELINE" : views <= med * RESULT_HEURISTICS.belowRatio ? "BELOW_BASELINE" : "NEAR_BASELINE";
    return { ...base, match: "MATCHED", resourceId: rid, checkedOn, ageAtCheckDays: age, metrics: { views, likes: l?.valueNum ?? null, comments: cm?.valueNum ?? null }, baseline: { medianViews: med, posts: peers.length }, verdict,
      cautionHe: age !== null && age < RESULT_HEURISTICS.youngPostDays ? `הפוסט היה בן ${age} ימים בבדיקה — מוקדם לשפוט` : verdict === "BASELINE_TOO_SMALL" ? "אין מספיק פוסטים מדודים באותו חשבון להשוואה" : null };
  });
}

export type ReviewVerdict = "NOT_TRIED" | "TRIED_ITEM_UNKNOWN" | "NOT_PUBLISHED_YET" | "NOT_MEASURED" | "ONE_RESULT" | "SUPPORTED" | "NOT_SUPPORTED" | "MIXED";
export const REVIEW_HE: Record<ReviewVerdict, string> = {
  NOT_TRIED: "עוד לא נוסתה",
  TRIED_ITEM_UNKNOWN: "בוצעה דרך תוכנית — הפריט שנוצר לא נקרא כאן (היסטוריית הפעולות)",
  NOT_PUBLISHED_YET: "נוצר תוכן — עוד לא פורסם",
  NOT_MEASURED: "פורסם — עוד לא נמדד",
  ONE_RESULT: "תוצאה אחת — אין עדיין מסקנה",
  SUPPORTED: "יש אינדיקציה שזה עובד (השערה, לא הוכחה)",
  NOT_SUPPORTED: "התוצאות לא תומכות — לא להציג כמבוסס",
  MIXED: "תוצאות מעורבות",
};
const OPTIONS_HE: Record<ReviewVerdict, string[]> = {
  NOT_TRIED: ["להציע לבוס לנסות פעם אחת ולמדוד"],
  TRIED_ITEM_UNKNOWN: ["לבדוק בהיסטוריית הפעולות איזה פריט נוצר"],
  NOT_PUBLISHED_YET: ["לתכנן תאריך פרסום"],
  NOT_MEASURED: ["להציע בדיקה בדפדפן כשהפוסט בן שבוע לפחות"],
  ONE_RESULT: ["לנסות שוב לפני מסקנה", "לבדוק שוב את אותו פוסט אחרי שבוע"],
  SUPPORTED: ["להמשיך", "לשקול סדרה קבועה (באישור)", "לנסות וריאציה"],
  NOT_SUPPORTED: ["לשנות פורמט", "לנסות גישה אחרת", "לעצור את הרעיון"],
  MIXED: ["לבדוק מה שונה בין הפוסטים", "בדיקה נוספת"],
};
export interface ReviewRow { recordId: string; titleHe: string; verdict: ReviewVerdict; verdictHe: string; optionsHe: string[]; plans: string[]; items: string[]; results: Array<{ contentKey: string; verdict: ResultRow["verdict"]; views: number | null }> }
/** history = plan id → the content keys that plan created (null = the action history was not read). */
export function reviewOf(recs: readonly ResearchDigest[], results: readonly ResultRow[], history: ReadonlyMap<string, readonly string[]> | null, contentKeys: ReadonlySet<string>): ReviewRow[] {
  const byKey = new Map(results.map((r) => [r.contentKey, r]));
  return recs.filter((r) => r.recordType === "RECOMMENDATION").map((r): ReviewRow => {
    const plans = r.implementedBy.map((p) => p.planId);
    const mk = (verdict: ReviewVerdict, items: string[] = [], res: ReviewRow["results"] = []): ReviewRow => ({ recordId: r.recordId, titleHe: r.titleHe, verdict, verdictHe: REVIEW_HE[verdict], optionsHe: OPTIONS_HE[verdict], plans, items, results: res });
    if (!plans.length) return mk("NOT_TRIED");
    if (!history) return mk("TRIED_ITEM_UNKNOWN");
    const items = [...new Set(plans.flatMap((p) => history.get(p) ?? []))].filter((k) => k.startsWith("social-content:"));
    if (!items.length) return mk("TRIED_ITEM_UNKNOWN");
    const rs = items.map((k) => byKey.get(k)).filter((x): x is ResultRow => !!x);
    const res = rs.map((x) => ({ contentKey: x.contentKey, verdict: x.verdict, views: x.metrics.views }));
    if (!rs.length) return mk(items.some((k) => contentKeys.has(k)) ? "NOT_PUBLISHED_YET" : "TRIED_ITEM_UNKNOWN", items, res);
    const judged = rs.filter((x) => x.verdict === "ABOVE_BASELINE" || x.verdict === "BELOW_BASELINE" || x.verdict === "NEAR_BASELINE");
    if (!judged.length) return mk("NOT_MEASURED", items, res);
    if (judged.length === 1) return mk("ONE_RESULT", items, res);
    const up = judged.filter((x) => x.verdict === "ABOVE_BASELINE").length, down = judged.filter((x) => x.verdict === "BELOW_BASELINE").length;
    return mk(up >= 2 && down === 0 ? "SUPPORTED" : down >= 2 && up === 0 ? "NOT_SUPPORTED" : "MIXED", items, res);
  });
}

/** The action history answer → plan id → the content keys its steps created (exact createdKey only). */
export function plansToCreated(history: ReadonlyArray<{ planId: string; steps: ReadonlyArray<{ actionId: string; createdKey?: string | null; outcome: string | null }> }> | null): Map<string, string[]> | null {
  if (!history) return null;
  return new Map(history.map((h) => [h.planId, h.steps.filter((s) => s.createdKey && (s.outcome === "APPLIED_AS_EXPECTED")).map((s) => String(s.createdKey))]));
}
