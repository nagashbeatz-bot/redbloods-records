/**
 * Sunny organizational memory — the Knowledge Kind Registry (P2). Pure.
 *
 * Durable, unsolicited Owner knowledge ("קלינטון הוא הדי-ג׳יי של הלייבל") is accepted ONLY as one of these typed kinds.
 * There is deliberately NO generic "note" kind: every kind declares its subjects, typed bounded fields, normalization,
 * epistemic class, supersession slot, review / expiry behaviour, conflicts with live state, and how it may be used.
 *
 * Organizational knowledge is NEVER canonical business state: `mutatesCanonicalState` is the literal `false` for every
 * kind (compile-enforced). An Owner-reported payment stays OWNER_REPORTED; a Finance record only ever comes from a
 * Finance Action. A frequency ("most shows") never becomes a booking rule; a policy stays a CANDIDATE.
 */
import { BUSINESS_AREAS, BUSINESS_AREA_HE, ALL_CLASSIFICATION_VALUES, CLASSIFICATION_REGISTRY, CLASSIFICATION_TYPES, CLASSIFICATION_VALUE_HE, CONFIDENCES, RELATION_HE, RELATION_TYPES, SOURCE_TYPES, SOURCE_TYPE_HE, TIME_STATUSES, TIME_STATUS_HE, classificationValueAllowed } from "./taxonomy";
import { checkProvenanceAndTime, provenanceOf } from "./provenance";
import { checkDecisionTiming, decisionTimingHe, DECISION_TIMINGS, DECISION_TIMING_HE } from "./decision-timing";

export const COMPANY_KEY = "company:REDBLOODS";

/** "known" = a controlled identity declared through KNOWN_ENTITY (key `known:<slug>`) for an entity with NO canonical Redbloods record. */
export type KnowledgeSubjectType = "label-artist" | "dj" | "client" | "project" | "show" | "release" | "vendor" | "company" | "known";
export type KnowledgeEpistemic = "OWNER_DECISION" | "OWNER_REPORTED" | "OWNER_POLICY_CANDIDATE";
export type KnowledgeFamily = "IDENTITY_RELATIONSHIP" | "WORK_OPERATIONS" | "OWNER_REPORTED_BUSINESS" | "OPERATING_KNOWLEDGE";

export type FieldSpec =
  | { type: "enum"; values: readonly string[]; required: boolean; labelsHe?: Readonly<Record<string, string>> }
  | { type: "text"; maxLength: number; required: boolean }
  | { type: "ymd"; required: boolean }
  | { type: "amount"; required: boolean }
  | { type: "entity"; subjectTypes: readonly KnowledgeSubjectType[]; required: boolean }
  /** A typed reference to a record that is not a knowledge subject (a proposal / a Victor work / a mix work) — exact key only. */
  | { type: "ref"; refKinds: readonly KnowledgeRefKind[]; required: boolean };
/** Records a value may point at without being a subject (2026-10-05): the most specific identity of a follow-up / commitment. */
export type KnowledgeRefKind = "proposal" | "victor-work" | "mix-work" | "transaction" | "rf-production";
/** Who a referenced record belongs to (for the ownership check) — client / project / vendor keys, null = unknown. */
export interface KnowledgeRefOwner { clientKey: string | null; projectKey: string | null; vendorKey: string | null }

export type KnowledgeValue = Record<string, string | number>;

/** What the preview knows about the live company for conflict checks (read-only facts, already resolved). */
export interface KnowledgeLiveFacts {
  todayIL: string;
  projectStatus(projectId: string): string | null;
  /** Finance: is there already a canonical paid / received record matching this report? null = cannot tell. */
  financeMatch(i: { subjectKey: string; direction: string; amount: number; currency: string }): boolean | null;
  /** The owner of a referenced record (proposal → its client / linked project; work → its project + vendor). Optional: absent = not checked. */
  refOwner?(refKey: string): KnowledgeRefOwner | null;
}

export interface KnowledgeConflict { code: string; severity: "BLOCKING" | "NOTE"; messageHe: string }

export interface KnowledgeKind {
  kind: string;
  family: KnowledgeFamily;
  titleHe: string;
  descriptionForModel: string;
  subjectTypes: readonly KnowledgeSubjectType[];
  fields: Readonly<Record<string, FieldSpec>>;
  epistemic: KnowledgeEpistemic;
  /** The supersession slot discriminator: the same slot = the same piece of knowledge (a newer assertion supersedes). */
  slot(value: KnowledgeValue): string;
  /** review_at (re-check the knowledge) — derived from the value / today; null = durable until superseded. */
  reviewAt(value: KnowledgeValue, todayIL: string): string | null;
  /** expires_at — after it the knowledge is history only (never applied). null = no expiry. */
  expiresAt(value: KnowledgeValue): string | null;
  readBackHe(subjectLabel: string, value: KnowledgeValue): string;
  conflicts(subjectKey: string, value: KnowledgeValue, live: KnowledgeLiveFacts): KnowledgeConflict[];
  /** May Sunny use it when analysing (always as OWNER knowledge, never as a FACT)? */
  influencesAnalysis: boolean;
  /** Compile-enforced: organizational knowledge can never mutate canonical business state. */
  mutatesCanonicalState: false;
  /** Relationship quality it creates in the entity graph (null = not a relationship). */
  relationQuality: "OWNER_CONFIRMED_RELATION" | null;
  /** Fixed notes shown with every read-back (e.g. "a frequency is not a booking rule"). */
  notesHe: readonly string[];
  /** Carries provenance (sourceType / confidence / sourceRef / observedAt) in its value — enforced by validateKnowledgeKinds. */
  provenance?: true;
  /** Carries time-awareness (status / validFrom / validUntil) in its value. */
  timeAware?: true;
  /** Cross-field validation after the single fields passed (clear errors, empty = valid). */
  check?(value: KnowledgeValue): string[];
  /** DECLARE_KNOWN: the subject is the NEW identity being declared (KNOWN_ENTITY), not an existing entity to resolve. */
  subjectMode?: "DECLARE_KNOWN";
}

const addDays = (ymd: string, n: number) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const s = (v: unknown) => (typeof v === "string" ? v : String(v ?? ""));
const norm = (t: string) => t.normalize("NFKC").trim().replace(/\s+/g, " ");
/** The one deterministic topic key of a decision / learning slot: lower-case [a-z0-9-], ≤ 40 (empty = not representable). */
export const topicSlug = (t: string) => t.normalize("NFKC").trim().toLowerCase().replace(/[\s_.]+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
const shortHash = (t: string) => { let h = 5381; for (const c of t) h = ((h << 5) + h + c.codePointAt(0)!) >>> 0; return h.toString(36); };

export const ROLE_HE: Record<string, string> = {
  LABEL_DJ: "ה-DJ של הלייבל", LABEL_ARTIST_MANAGER: "מנהל/ת האמנים של הלייבל", MIX_ENGINEER: "מהנדס/ת המיקס", MASTERING_ENGINEER: "מהנדס/ת המאסטרינג",
  PRODUCER: "מפיק/ה", BOOKER: "מזמין/ת ההופעות", TEAM_MEMBER: "חבר/ת צוות",
};
const FREQ_HE: Record<string, string> = { ALWAYS: "תמיד", MOST: "ברוב", SOMETIMES: "לפעמים", RARELY: "לעיתים רחוקות" };
const BLOCKER_HE: Record<string, string> = { WAITING_FOR_ARTIST: "מחכים לאמן", WAITING_FOR_CLIENT: "מחכים ללקוח", WAITING_FOR_PAYMENT: "מחכים לתשלום", WAITING_FOR_VENDOR: "מחכים לספק / איש צוות", WAITING_FOR_OWNER: "מחכה לבעלים", EXTERNAL_DEPENDENCY: "תלות חיצונית" };
const WHEN_HE: Record<string, string> = { AFTER_HOLIDAYS: "אחרי החגים", NEXT_WEEK: "בשבוע הבא", NEXT_MONTH: "בחודש הבא", UNSPECIFIED: "בלי מועד מוגדר", NOT_NOW: "לא כרגע" };
const RELATIVE_DAYS: Record<string, number> = { AFTER_HOLIDAYS: 30, NEXT_WEEK: 7, NEXT_MONTH: 30, UNSPECIFIED: 14, NOT_NOW: 30 };
/** A referenced record must belong to the subject (a proposal of THIS client / project; a work of THIS vendor) — never cross-entity. */
const refBelongs = (field: string, subjectKey: string, v: KnowledgeValue, live: KnowledgeLiveFacts): KnowledgeConflict[] => {
  const ref = typeof v[field] === "string" ? String(v[field]) : "";
  if (!ref || !live.refOwner) return [];
  const o = live.refOwner(ref);
  if (!o) return [{ code: "REF_NOT_FOUND", severity: "BLOCKING", messageHe: "הרשומה שהפנית אליה לא נמצאה." }];
  const ok = subjectKey.startsWith("vendor:") ? o.vendorKey === subjectKey : o.clientKey === subjectKey || o.projectKey === subjectKey;
  return ok ? [] : [{ code: "REF_NOT_OF_SUBJECT", severity: "BLOCKING", messageHe: "הרשומה שהפנית אליה לא שייכת לישות הזאת — לא אקשר ביניהן." }];
};
const CLOSED_PROJECT = new Set(["הושלם", "בוטל"]);
const ENTITY_TYPES_ALL: readonly KnowledgeSubjectType[] = ["label-artist", "dj", "client", "project", "show", "release", "vendor"];
/** Subjects / objects of the generic model: every canonical entity, the company, and a declared KNOWN_ENTITY. */
const RELATABLE: readonly KnowledgeSubjectType[] = [...ENTITY_TYPES_ALL, "company", "known"];

const PROVENANCE_FIELDS: Record<string, FieldSpec> = {
  sourceType: { type: "enum", values: SOURCE_TYPES, required: false, labelsHe: SOURCE_TYPE_HE },
  confidence: { type: "enum", values: CONFIDENCES, required: false },
  sourceRef: { type: "text", maxLength: 120, required: false },
  observedAt: { type: "ymd", required: false },
};
const TIME_FIELDS: Record<string, FieldSpec> = {
  status: { type: "enum", values: TIME_STATUSES, required: false, labelsHe: TIME_STATUS_HE },
  validFrom: { type: "ymd", required: false },
  validUntil: { type: "ymd", required: false },
};
const timeHe = (v: KnowledgeValue) => {
  const st = s(v.status) as keyof typeof TIME_STATUS_HE;
  const parts = [st && st !== "ACTIVE" ? TIME_STATUS_HE[st] : "", v.validFrom ? `מ־${s(v.validFrom)}` : "", v.validUntil ? `עד ${s(v.validUntil)}` : ""].filter(Boolean);
  return parts.length ? ` (${parts.join(", ")})` : "";
};
const provHe = (v: KnowledgeValue) => (provenanceOf(v).sourceType === "INFERRED" ? " [הסקה של סאני — לא עובדה מאושרת]" : "");

export const KNOWLEDGE_KINDS: readonly KnowledgeKind[] = [
  // ── IDENTITY / RELATIONSHIP ──
  {
    kind: "ENTITY_ALIAS", family: "IDENTITY_RELATIONSHIP", titleHe: "כינוי", subjectTypes: ENTITY_TYPES_ALL,
    descriptionForModel: "Another name the Owner uses for an entity (e.g. \"קלינטון\" for DJ CLEANTONE). Only when the Owner states it; never from similar spellings.",
    fields: { alias: { type: "text", maxLength: 60, required: true } }, epistemic: "OWNER_DECISION",
    slot: (v) => `alias:${norm(s(v.alias)).toLowerCase()}`, reviewAt: () => null, expiresAt: () => null,
    readBackHe: (l, v) => `"${norm(s(v.alias))}" הוא כינוי של ${l}.`, conflicts: () => [],
    influencesAnalysis: true, mutatesCanonicalState: false, relationQuality: null, notesHe: [],
  },
  {
    kind: "ORGANIZATIONAL_ROLE", family: "IDENTITY_RELATIONSHIP", titleHe: "תפקיד בארגון", subjectTypes: ["dj", "label-artist", "client", "vendor"],
    descriptionForModel: "The role an entity holds for Redbloods / the label (e.g. LABEL_DJ). Answers \"who is our DJ?\".",
    fields: { role: { type: "enum", values: Object.keys(ROLE_HE), required: true, labelsHe: ROLE_HE } }, epistemic: "OWNER_DECISION",
    slot: (v) => `role:${s(v.role)}`, reviewAt: () => null, expiresAt: () => null,
    readBackHe: (l, v) => `${l} הוא ${ROLE_HE[s(v.role)] ?? s(v.role)}.`, conflicts: () => [],
    influencesAnalysis: true, mutatesCanonicalState: false, relationQuality: "OWNER_CONFIRMED_RELATION", notesHe: [],
  },
  {
    kind: "ENTITY_RELATIONSHIP", family: "IDENTITY_RELATIONSHIP", titleHe: "קשר בין ישויות", subjectTypes: RELATABLE,
    descriptionForModel: "A typed relationship between two entities the Owner states: OWNER_OF, FOUNDER_OF, LABEL_ARTIST_OF (the label roster; the object is the company), WORKS_WITH (is NOT a label artist), PRODUCER_FOR, MANAGES, COLLABORATES_WITH — plus the legacy PARTICIPATES_IN_SHOWS / REPRESENTS (a frequency describes the past, never a booking rule). status ACTIVE / ENDED / HISTORICAL with validFrom / validUntil: an ended relationship is kept as history (assert the same relation again with status ENDED), never deleted.",
    fields: {
      relation: { type: "enum", values: RELATION_TYPES, required: true, labelsHe: RELATION_HE },
      object: { type: "entity", subjectTypes: RELATABLE, required: true },
      frequency: { type: "enum", values: Object.keys(FREQ_HE), required: false, labelsHe: FREQ_HE },
      ...TIME_FIELDS, ...PROVENANCE_FIELDS,
    },
    epistemic: "OWNER_DECISION", slot: (v) => `rel:${s(v.relation)}:${s(v.object)}`, reviewAt: () => null, expiresAt: () => null,
    readBackHe: (l, v) => `${l} ${RELATION_HE[s(v.relation) as keyof typeof RELATION_HE] ?? s(v.relation)}${v.frequency ? ` (${FREQ_HE[s(v.frequency)] ?? ""})` : ""} — ${s(v.objectLabel) || s(v.object)}${timeHe(v)}${provHe(v)}.`,
    check: (v) => {
      const e = checkProvenanceAndTime(v);
      if (v.relation === "LABEL_ARTIST_OF" && v.object !== COMPANY_KEY) e.push("object: LABEL_ARTIST_OF points at the company (Redbloods) — someone who only works with us is WORKS_WITH");
      return e;
    },
    conflicts: () => [], influencesAnalysis: true, mutatesCanonicalState: false, relationQuality: "OWNER_CONFIRMED_RELATION", provenance: true, timeAware: true,
    notesHe: ["תדירות מתארת את מה שקורה — היא לא כלל שיבוץ להופעות עתידיות.", "קשר שהסתיים נשמר כהיסטוריה — לא נמחק."],
  },
  {
    kind: "ENTITY_CLASSIFICATION", family: "IDENTITY_RELATIONSHIP", titleHe: "סיווג ישות", subjectTypes: RELATABLE,
    descriptionForModel: `What an entity IS, as a typed classification (type + controlled value, never free text): ${CLASSIFICATION_TYPES.map((t) => `${t}{${Object.keys(CLASSIFICATION_REGISTRY[t].values).join("|")}}`).join(", ")}. One current value per type per entity; a change supersedes the old value (history kept). Optional status / validFrom / validUntil.`,
    fields: {
      classificationType: { type: "enum", values: CLASSIFICATION_TYPES, required: true, labelsHe: Object.fromEntries(CLASSIFICATION_TYPES.map((t) => [t, CLASSIFICATION_REGISTRY[t].titleHe])) },
      value: { type: "enum", values: ALL_CLASSIFICATION_VALUES, required: true, labelsHe: CLASSIFICATION_VALUE_HE },
      ...TIME_FIELDS, ...PROVENANCE_FIELDS,
    },
    epistemic: "OWNER_DECISION", slot: (v) => `class:${s(v.classificationType)}`, reviewAt: () => null, expiresAt: () => null,
    readBackHe: (l, v) => `${l}: ${CLASSIFICATION_REGISTRY[s(v.classificationType) as keyof typeof CLASSIFICATION_REGISTRY]?.titleHe ?? s(v.classificationType)} = ${CLASSIFICATION_VALUE_HE[s(v.value)] ?? s(v.value)}${timeHe(v)}${provHe(v)}.`,
    check: (v) => {
      const e = checkProvenanceAndTime(v);
      const reg = CLASSIFICATION_REGISTRY[s(v.classificationType) as keyof typeof CLASSIFICATION_REGISTRY];
      if (!classificationValueAllowed(s(v.classificationType), s(v.value))) e.push(`value: "${s(v.value)}" is not a registered value of ${s(v.classificationType)} (allowed: ${reg ? Object.keys(reg.values).join(", ") : "—"})`);
      return e;
    },
    conflicts: () => [], influencesAnalysis: true, mutatesCanonicalState: false, relationQuality: null, provenance: true, timeAware: true,
    notesHe: ["סיווג הוא ידע ארגוני — לא משנה שום רשומה במערכת."],
  },
  {
    kind: "KNOWN_ENTITY", family: "IDENTITY_RELATIONSHIP", titleHe: "ישות מוכרת (ללא רשומה קנונית)", subjectTypes: ["known"], subjectMode: "DECLARE_KNOWN",
    descriptionForModel: "A controlled identity (key known:<slug>) for an entity that has NO canonical Redbloods record — a FALLBACK only: declare it ONLY after partner_resolve found nothing, with the one canonical Latin display name (subject = displayName). Never for a variant, nickname or spelling of an existing entity (no aliases are stored). Refused when a canonical entity or a similar known entity exists.",
    fields: { displayName: { type: "text", maxLength: 60, required: true }, ...PROVENANCE_FIELDS },
    epistemic: "OWNER_DECISION", slot: () => "identity", reviewAt: () => null, expiresAt: () => null,
    readBackHe: (_l, v) => `ישות מוכרת: ${norm(s(v.displayName))}${provHe(v)}.`,
    check: (v) => checkProvenanceAndTime(v),
    conflicts: () => [], influencesAnalysis: true, mutatesCanonicalState: false, relationQuality: null, provenance: true,
    notesHe: ["זו זהות בלבד — לא מאגר אנשים מקביל. אם קיימת ישות קנונית משתמשים בה."],
  },
  // ── WORK / OPERATIONS ──
  {
    kind: "PROJECT_BLOCKER", family: "WORK_OPERATIONS", titleHe: "מה תוקע פרויקט", subjectTypes: ["project"],
    descriptionForModel: "Why a project is stuck, as the Owner says (waiting for the artist / client / payment / vendor…). Reviewed after 14 days.",
    fields: { reason: { type: "enum", values: Object.keys(BLOCKER_HE), required: true, labelsHe: BLOCKER_HE }, waitingOn: { type: "entity", subjectTypes: ["label-artist", "client", "dj", "vendor"], required: false }, detail: { type: "text", maxLength: 120, required: false } },
    epistemic: "OWNER_REPORTED", slot: () => "blocker", reviewAt: (_v, t) => addDays(t, 14), expiresAt: () => null,
    readBackHe: (l, v) => `${l} תקוע: ${BLOCKER_HE[s(v.reason)] ?? s(v.reason)}${v.waitingOnLabel ? ` (${s(v.waitingOnLabel)})` : ""}${v.detail ? ` — ${s(v.detail)}` : ""}.`,
    conflicts: (key, _v, live) => { const st = live.projectStatus(key.slice(key.indexOf(":") + 1)); return st && CLOSED_PROJECT.has(st) ? [{ code: "PROJECT_CLOSED", severity: "BLOCKING", messageHe: `הפרויקט מסומן "${st}" — לא אשמור עליו חסם.` }] : []; },
    influencesAnalysis: true, mutatesCanonicalState: false, relationQuality: null, notesHe: [],
  },
  {
    kind: "FOLLOW_UP_EXPECTATION", family: "WORK_OPERATIONS", titleHe: "מתי חוזרים", subjectTypes: ["client", "project"],
    descriptionForModel: "Who is expected to get back to whom and when (e.g. the client will call after the holidays; NOT_NOW = do not follow up now). When it is about ONE proposal, give proposal (its proposal:<id> key) — a decision about one proposal never applies to another. The review date is when Sunny re-checks.",
    fields: { who: { type: "enum", values: ["COUNTERPART_WILL_CONTACT", "OWNER_WILL_CONTACT"], required: true }, when: { type: "ymd", required: false }, whenRelative: { type: "enum", values: Object.keys(WHEN_HE), required: false, labelsHe: WHEN_HE }, proposal: { type: "ref", refKinds: ["proposal"], required: false } },
    // one current expectation per subject + who — and per proposal when one is named (two proposals never supersede each other)
    epistemic: "OWNER_REPORTED", slot: (v) => (v.proposal ? `followup:${s(v.who)}:${s(v.proposal)}` : `followup:${s(v.who)}`),
    reviewAt: (v, t) => (v.when ? s(v.when) : addDays(t, RELATIVE_DAYS[s(v.whenRelative) || "UNSPECIFIED"] ?? 14)), expiresAt: () => null,
    readBackHe: (l, v) => `${s(v.who) === "OWNER_WILL_CONTACT" ? `אתה חוזר ל${l}` : `${l} יחזור אליך`}${v.proposalLabel ? ` (הצעה: ${s(v.proposalLabel)})` : ""} ${v.when ? `עד ${s(v.when)}` : WHEN_HE[s(v.whenRelative) || "UNSPECIFIED"]}.`,
    conflicts: (k, v, live) => [...(v.when && s(v.when) < live.todayIL ? [{ code: "DATE_IN_PAST", severity: "BLOCKING" as const, messageHe: "התאריך כבר עבר." }] : []), ...refBelongs("proposal", k, v, live)],
    influencesAnalysis: true, mutatesCanonicalState: false, relationQuality: null, notesHe: [],
  },
  {
    kind: "VENDOR_COMMITMENT", family: "WORK_OPERATIONS", titleHe: "התחייבות של איש צוות / ספק", subjectTypes: ["vendor"],
    descriptionForModel: "What a vendor (Victor / Steven) COMMITTED to do (e.g. \"Victor will finish the beat tomorrow\", \"הוא על זה\", \"הוא אמר שיעשה\"). Only an explicit commitment — \"I talked to him / sent him / we went over it\" is outside communication, NOT a commitment: never record it here. Give work (victor-work:<id> / mix-work:<id>) when it is about ONE work; due is optional (\"הוא על זה\" has no date). It is his commitment as reported by the Owner, not a delivery.",
    fields: { commitment: { type: "enum", values: ["DELIVER_WORK", "SEND_REVISION", "SEND_FILES"], required: true }, due: { type: "ymd", required: false }, project: { type: "entity", subjectTypes: ["project"], required: false }, work: { type: "ref", refKinds: ["victor-work", "mix-work"], required: false } },
    epistemic: "OWNER_REPORTED", slot: (v) => (v.work ? `commit:${s(v.commitment)}:work:${s(v.work)}` : `commit:${s(v.commitment)}:${s(v.project) || "-"}`),
    reviewAt: (v, t) => (v.due ? addDays(s(v.due), 1) : addDays(t, 14)), expiresAt: (v) => (v.due ? addDays(s(v.due), 30) : null),
    readBackHe: (l, v) => `${l} התחייב ל${s(v.commitment) === "SEND_REVISION" ? "שלוח תיקון" : s(v.commitment) === "SEND_FILES" ? "שלוח קבצים" : "מסור עבודה"}${v.workLabel ? ` של ${s(v.workLabel)}` : v.projectLabel ? ` של ${s(v.projectLabel)}` : ""}${v.due ? ` עד ${s(v.due)}` : " (בלי מועד)"}.`,
    conflicts: (k, v, live) => [...(v.due && s(v.due) < live.todayIL ? [{ code: "DATE_IN_PAST", severity: "BLOCKING" as const, messageHe: "המועד כבר עבר." }] : []), ...refBelongs("work", k, v, live)],
    influencesAnalysis: true, mutatesCanonicalState: false, relationQuality: null, notesHe: [],
  },
  {
    kind: "RELEASE_PRIORITY", family: "WORK_OPERATIONS", titleHe: "דחיפות ריליס", subjectTypes: ["release", "project", "label-artist"],
    descriptionForModel: "How urgent a release is for the Owner / artist (e.g. \"Shalev isn't in a hurry with this release\"). Never changes the release schedule.",
    fields: { priority: { type: "enum", values: ["URGENT", "NORMAL", "NOT_URGENT"], required: true } }, epistemic: "OWNER_DECISION",
    slot: () => "release-priority", reviewAt: (_v, t) => addDays(t, 60), expiresAt: () => null,
    readBackHe: (l, v) => `הריליס של ${l}: ${s(v.priority) === "URGENT" ? "דחוף" : s(v.priority) === "NOT_URGENT" ? "לא דחוף" : "רגיל"}.`, conflicts: () => [],
    influencesAnalysis: true, mutatesCanonicalState: false, relationQuality: null, notesHe: [],
  },
  // ── OWNER-REPORTED BUSINESS CONTEXT ──
  {
    kind: "PAYMENT_REPORTED_BY_OWNER", family: "OWNER_REPORTED_BUSINESS", titleHe: "תשלום שדיווחת עליו", subjectTypes: ["project", "client", "show"],
    descriptionForModel: "A payment the Owner reports (received from / paid to). It is OWNER_REPORTED — it NEVER creates or changes a Finance record; if Finance has no matching record Sunny reports the gap and may propose the proper Finance action later.",
    fields: { direction: { type: "enum", values: ["RECEIVED", "PAID"], required: true }, amount: { type: "amount", required: true }, currency: { type: "enum", values: ["₪", "$", "€"], required: true }, date: { type: "ymd", required: false } },
    epistemic: "OWNER_REPORTED", slot: (v) => `payment:${s(v.direction)}:${s(v.amount)}:${s(v.currency)}:${s(v.date) || "-"}`, reviewAt: (_v, t) => addDays(t, 7), expiresAt: () => null,
    readBackHe: (l, v) => `לפי הדיווח שלך: ${s(v.direction) === "RECEIVED" ? "התקבל" : "שולם"} ${s(v.currency)}${Number(v.amount).toLocaleString("en-US")}${v.date ? ` ב־${s(v.date)}` : ""} (${l}). זה לא רישום בכספים.`,
    conflicts: (key, v, live) => {
      if (v.date && s(v.date) > live.todayIL) return [{ code: "DATE_IN_FUTURE", severity: "BLOCKING", messageHe: "תאריך תשלום לא יכול להיות בעתיד." }];
      const m = live.financeMatch({ subjectKey: key, direction: s(v.direction), amount: Number(v.amount), currency: s(v.currency) });
      return m === true ? [{ code: "ALREADY_RECORDED_IN_FINANCE", severity: "NOTE", messageHe: "יש כבר רישום תואם בכספים." }]
        : m === false ? [{ code: "NOT_RECORDED_IN_FINANCE", severity: "NOTE", messageHe: "התשלום עדיין לא רשום בכספים — אפשר להציע פעולת כספים נפרדת." }]
        : [{ code: "FINANCE_UNKNOWN", severity: "NOTE", messageHe: "לא הצלחתי לבדוק מול הכספים." }];
    },
    influencesAnalysis: true, mutatesCanonicalState: false, relationQuality: null, notesHe: ["דיווח שלך אינו רישום בכספים."],
  },
  // ── OPERATING KNOWLEDGE ──
  {
    kind: "PROCESS_FRICTION", family: "OPERATING_KNOWLEDGE", titleHe: "חיכוך בתהליך", subjectTypes: ["company"],
    descriptionForModel: "A recurring operational problem the Owner reports (e.g. \"we forget to confirm the DJ before shows\"). Evidence for a pattern candidate — never a rule and never an automatic change.",
    fields: { area: { type: "enum", values: BUSINESS_AREAS, required: true, labelsHe: BUSINESS_AREA_HE }, frictionHe: { type: "text", maxLength: 160, required: true } },
    epistemic: "OWNER_REPORTED", slot: (v) => `friction:${s(v.area)}:${shortHash(norm(s(v.frictionHe)))}`, reviewAt: (_v, t) => addDays(t, 30), expiresAt: () => null,
    readBackHe: (_l, v) => `חיכוך שדיווחת עליו (${s(v.area)}): ${norm(s(v.frictionHe))}.`, conflicts: () => [],
    influencesAnalysis: true, mutatesCanonicalState: false, relationQuality: null, notesHe: ["זו תצפית, לא מדיניות — לא ישתנה שום תהליך אוטומטית."],
  },
  {
    kind: "WORKING_POLICY_CANDIDATE", family: "OPERATING_KNOWLEDGE", titleHe: "מדיניות עבודה (מועמדת)", subjectTypes: ["company"],
    descriptionForModel: "How the Owner wants something done from now on in a business area (PROJECTS / SHOWS / FINANCE / RELEASES / TEAM / CLIENTS / SOCIAL / MARKETING / CONTENT / OPERATIONS — SOCIAL is a policy area only). Stored only as a CANDIDATE — never promoted to a rule automatically. Optional status ACTIVE / ENDED / HISTORICAL with validFrom / validUntil.",
    fields: { area: { type: "enum", values: BUSINESS_AREAS, required: true, labelsHe: BUSINESS_AREA_HE }, policyHe: { type: "text", maxLength: 200, required: true }, appliesWhenHe: { type: "text", maxLength: 120, required: false }, ...TIME_FIELDS, ...PROVENANCE_FIELDS },
    epistemic: "OWNER_POLICY_CANDIDATE", slot: (v) => `policy:${s(v.area)}:${shortHash(norm(s(v.policyHe)))}`, reviewAt: (_v, t) => addDays(t, 30), expiresAt: () => null,
    readBackHe: (_l, v) => `מדיניות עבודה (${BUSINESS_AREA_HE[s(v.area) as keyof typeof BUSINESS_AREA_HE] ?? s(v.area)}): ${norm(s(v.policyHe))}${v.appliesWhenHe ? ` — כש${norm(s(v.appliesWhenHe))}` : ""}${timeHe(v)}${provHe(v)}.`,
    check: (v) => checkProvenanceAndTime(v), conflicts: () => [],
    influencesAnalysis: true, mutatesCanonicalState: false, relationQuality: null, provenance: true, timeAware: true, notesHe: ["נשמר כמדיניות מועמדת — לא הופך לכלל אוטומטית."],
  },
  // ── DECISION MEMORY + OWNER-APPROVED LEARNINGS (P2 kinds, DB CHECK applied 2026-10-02) ──
  {
    kind: "BUSINESS_DECISION", family: "OPERATING_KNOWLEDGE", titleHe: "החלטה עסקית", subjectTypes: ["company"],
    descriptionForModel: "A business decision the Owner MADE and states (decision memory): what was decided, why, the alternatives he rejected and when to revisit it. One current decision per area + topic (+ about) (a newer one supersedes; history kept). Only the Owner's own statement — never Sunny's recommendation, never inferred, never from company data. It changes nothing in Redbloods (a decision is not an action). A decision about ONE record (a project / client / show / release / artist) sets 'about' to that record's key — that is the ONLY link Sunny uses (a name inside the text links nothing); a company-wide decision leaves 'about' empty.",
    fields: {
      area: { type: "enum", values: BUSINESS_AREAS, required: true, labelsHe: BUSINESS_AREA_HE },
      // 2026-10-05 (decision memory): the ONE record the decision is about — a canonical key, never a name in the text. The subject
      // stays the company (no subjectTypes change); the finance decision gate reads this key (lib/partner/finance/decision-gate.ts).
      about: { type: "entity", subjectTypes: ["project", "client", "show", "release", "label-artist", "dj"], required: false },
      // Question memory (2026-10-05, Q2): the EXACT non-subject record a context answer is about (a proposal / a Victor or mix
      // work / an orphan Finance row / a Red Films production) — the same exact-entity rule as about; never company-wide.
      ref: { type: "ref", refKinds: ["proposal", "victor-work", "mix-work", "transaction", "rf-production"], required: false },
      topic: { type: "text", maxLength: 40, required: true },
      decisionHe: { type: "text", maxLength: 200, required: true },
      rationaleHe: { type: "text", maxLength: 200, required: false },
      alternativesHe: { type: "text", maxLength: 200, required: false },
      revisitWhenHe: { type: "text", maxLength: 160, required: false },
      decidedOn: { type: "ymd", required: false },
      reviewAt: { type: "ymd", required: false },
      // Decision Persistence (Owner decision 2026-10-06): the typed WHEN of the decision (decision-timing.ts) — never money,
      // never a Finance row, never an invented due date. THIS_MONTH is anchored to decidedOn's month; conditionHe = his words.
      timing: { type: "enum", values: DECISION_TIMINGS, required: false, labelsHe: DECISION_TIMING_HE },
      timingDate: { type: "ymd", required: false },
      conditionHe: { type: "text", maxLength: 160, required: false },
      ...TIME_FIELDS,
    },
    epistemic: "OWNER_DECISION", slot: (v) => `decision:${s(v.area)}:${topicSlug(s(v.topic))}${v.about ? `:${s(v.about)}` : ""}${v.ref ? `:${s(v.ref)}` : ""}`,
    reviewAt: (v) => (v.reviewAt ? s(v.reviewAt) : null), expiresAt: () => null,
    readBackHe: (_l, v) => `החלטה (${BUSINESS_AREA_HE[s(v.area) as keyof typeof BUSINESS_AREA_HE] ?? s(v.area)} / ${topicSlug(s(v.topic))}${v.aboutLabel ? ` — על ${s(v.aboutLabel)}` : ""}): ${norm(s(v.decisionHe))}${v.rationaleHe ? ` — כי ${norm(s(v.rationaleHe))}` : ""}${v.alternativesHe ? `. חלופות שנדחו: ${norm(s(v.alternativesHe))}` : ""}${decisionTimingHe(v) ? `. מתי: ${decisionTimingHe(v)}` : ""}${v.revisitWhenHe ? `. לבחון מחדש כש${norm(s(v.revisitWhenHe))}` : ""}${v.decidedOn ? ` (הוחלט ${s(v.decidedOn)})` : ""}${v.reviewAt ? ` [לבדיקה ב־${s(v.reviewAt)}]` : ""}${timeHe(v)}.`,
    check: (v) => {
      const e = [...checkProvenanceAndTime(v), ...checkDecisionTiming(v)];
      if (!topicSlug(s(v.topic))) e.push("topic: a short topic in Latin letters / digits (e.g. clip-pricing)");
      return e;
    },
    conflicts: (_k, v, live) => (v.decidedOn && s(v.decidedOn) > live.todayIL ? [{ code: "DATE_IN_FUTURE", severity: "BLOCKING", messageHe: "תאריך ההחלטה לא יכול להיות בעתיד." }] : []),
    influencesAnalysis: true, mutatesCanonicalState: false, relationQuality: null, timeAware: true,
    notesHe: ["החלטה היא זיכרון של מה שהחלטת — היא לא משנה שום רשומה ולא מפעילה פעולה.", "מצב הרשומות לא משתנה: מה שנבדק (כספים / חובות / שאלות) ימשיך להופיע עד פעולה קנונית שתאשר — אז אציג אותו כ\"כבר אמרת לי — לסנכרן?\" ולא כשאלה חדשה.", "תאריך הבדיקה (reviewAt) הוא תזכורת לקריאה בלבד — אין בדיקה או תפוגה אוטומטית."],
  },
  {
    kind: "BUSINESS_LEARNING", family: "OPERATING_KNOWLEDGE", titleHe: "לקח עסקי (באישור הבעלים)", subjectTypes: ["company"],
    descriptionForModel: "Something the Owner confirms Redbloods has LEARNED (e.g. \"a clip released on Thursday performs better for us\"). Only with the Owner's explicit approval of the exact read-back. A Sunny insight is NEVER turned into a learning silently: to learn from one, the Owner states / approves the learning and sourceRef may cite it (insight:<uuid>). sourceType OWNER_STATEMENT (default) or SYSTEM_RECORD (with sourceRef); INFERRED is refused.",
    fields: {
      area: { type: "enum", values: BUSINESS_AREAS, required: true, labelsHe: BUSINESS_AREA_HE },
      topic: { type: "text", maxLength: 40, required: true },
      statementHe: { type: "text", maxLength: 200, required: true },
      appliesWhenHe: { type: "text", maxLength: 160, required: false },
      basisHe: { type: "text", maxLength: 200, required: false },
      reviewAt: { type: "ymd", required: false },
      ...PROVENANCE_FIELDS,
    },
    epistemic: "OWNER_DECISION", slot: (v) => `learning:${s(v.area)}:${topicSlug(s(v.topic))}`,
    reviewAt: (v) => (v.reviewAt ? s(v.reviewAt) : null), expiresAt: () => null,
    readBackHe: (_l, v) => `לקח (${BUSINESS_AREA_HE[s(v.area) as keyof typeof BUSINESS_AREA_HE] ?? s(v.area)} / ${topicSlug(s(v.topic))}): ${norm(s(v.statementHe))}${v.appliesWhenHe ? ` — כש${norm(s(v.appliesWhenHe))}` : ""}${v.basisHe ? `. על סמך: ${norm(s(v.basisHe))}` : ""}${v.reviewAt ? ` [לבדיקה ב־${s(v.reviewAt)}]` : ""}.`,
    check: (v) => {
      const e = checkProvenanceAndTime(v);
      if (!topicSlug(s(v.topic))) e.push("topic: a short topic in Latin letters / digits (e.g. release-day)");
      const st = provenanceOf(v).sourceType;
      if (st !== "OWNER_STATEMENT" && st !== "SYSTEM_RECORD") e.push("sourceType: a learning is the Owner's (OWNER_STATEMENT) or cites a record (SYSTEM_RECORD + sourceRef) — never INFERRED / EXTERNAL_SOURCE");
      if (v.sourceRef && !/^(insight|recommendation|observation|record):[0-9a-f-]{36}$|^[a-z-]+:[A-Za-z0-9._:-]{1,100}$/.test(s(v.sourceRef))) e.push("sourceRef: a reference such as insight:<uuid>");
      return e;
    },
    conflicts: () => [], influencesAnalysis: true, mutatesCanonicalState: false, relationQuality: null, provenance: true,
    notesHe: ["לקח נשמר רק באישור שלך — תובנה של סאני לא הופכת ללקח בעצמה.", "לקח הוא ידע, לא כלל אוטומטי — שום תהליך לא משתנה."],
  },
];

export const MAX_FIELDS = 16; // 16 since 2026-10-06: BUSINESS_DECISION timing / timingDate / conditionHe (decision persistence); 13 since 2026-10-05: .ref
const BY_KIND = new Map(KNOWLEDGE_KINDS.map((k) => [k.kind, k]));
export const knowledgeKind = (kind: unknown): KnowledgeKind | null => (typeof kind === "string" && BY_KIND.has(kind) ? BY_KIND.get(kind)! : null);

/** Registry sanity (tests + module load): unique kinds, no generic note kind, bounded fields, never canonical. */
export function validateKnowledgeKinds(kinds: readonly KnowledgeKind[] = KNOWLEDGE_KINDS): string[] {
  const e: string[] = [];
  const seen = new Set<string>();
  for (const k of kinds) {
    if (!/^[A-Z][A-Z0-9_]{2,40}$/.test(k.kind)) e.push(`${k.kind}: bad id`);
    if (seen.has(k.kind)) e.push(`${k.kind}: duplicate`);
    seen.add(k.kind);
    if (/NOTE|MEMO|FREE|GENERIC/.test(k.kind)) e.push(`${k.kind}: generic kinds are not allowed`);
    if (!k.subjectTypes.length || Object.keys(k.fields).length === 0 || Object.keys(k.fields).length > MAX_FIELDS) e.push(`${k.kind}: needs subjects and 1–${MAX_FIELDS} fields`);
    for (const [n, f] of Object.entries(k.fields)) if (f.type === "text" && f.maxLength > 200) e.push(`${k.kind}.${n}: text too long`);
    if (k.mutatesCanonicalState !== false) e.push(`${k.kind}: must never mutate canonical state`);
    if (k.provenance && !["sourceType", "confidence", "sourceRef", "observedAt"].every((f) => f in k.fields)) e.push(`${k.kind}: provenance kinds declare sourceType / confidence / sourceRef / observedAt`);
    if (k.timeAware && !["status", "validFrom", "validUntil"].every((f) => f in k.fields)) e.push(`${k.kind}: time-aware kinds declare status / validFrom / validUntil`);
  }
  return e;
}
