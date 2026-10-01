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
  | { type: "entity"; subjectTypes: readonly KnowledgeSubjectType[]; required: boolean };

export type KnowledgeValue = Record<string, string | number>;

/** What the preview knows about the live company for conflict checks (read-only facts, already resolved). */
export interface KnowledgeLiveFacts {
  todayIL: string;
  projectStatus(projectId: string): string | null;
  /** Finance: is there already a canonical paid / received record matching this report? null = cannot tell. */
  financeMatch(i: { subjectKey: string; direction: string; amount: number; currency: string }): boolean | null;
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
const shortHash = (t: string) => { let h = 5381; for (const c of t) h = ((h << 5) + h + c.codePointAt(0)!) >>> 0; return h.toString(36); };

export const ROLE_HE: Record<string, string> = {
  LABEL_DJ: "ה-DJ של הלייבל", LABEL_ARTIST_MANAGER: "מנהל/ת האמנים של הלייבל", MIX_ENGINEER: "מהנדס/ת המיקס", MASTERING_ENGINEER: "מהנדס/ת המאסטרינג",
  PRODUCER: "מפיק/ה", BOOKER: "מזמין/ת ההופעות", TEAM_MEMBER: "חבר/ת צוות",
};
const FREQ_HE: Record<string, string> = { ALWAYS: "תמיד", MOST: "ברוב", SOMETIMES: "לפעמים", RARELY: "לעיתים רחוקות" };
const BLOCKER_HE: Record<string, string> = { WAITING_FOR_ARTIST: "מחכים לאמן", WAITING_FOR_CLIENT: "מחכים ללקוח", WAITING_FOR_PAYMENT: "מחכים לתשלום", WAITING_FOR_VENDOR: "מחכים לספק / איש צוות", WAITING_FOR_OWNER: "מחכה לבעלים", EXTERNAL_DEPENDENCY: "תלות חיצונית" };
const WHEN_HE: Record<string, string> = { AFTER_HOLIDAYS: "אחרי החגים", NEXT_WEEK: "בשבוע הבא", NEXT_MONTH: "בחודש הבא", UNSPECIFIED: "בלי מועד מוגדר" };
const RELATIVE_DAYS: Record<string, number> = { AFTER_HOLIDAYS: 30, NEXT_WEEK: 7, NEXT_MONTH: 30, UNSPECIFIED: 14 };
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
    descriptionForModel: "Who is expected to get back to whom and when (e.g. the client will call after the holidays). The review date is when Sunny re-checks.",
    fields: { who: { type: "enum", values: ["COUNTERPART_WILL_CONTACT", "OWNER_WILL_CONTACT"], required: true }, when: { type: "ymd", required: false }, whenRelative: { type: "enum", values: Object.keys(WHEN_HE), required: false, labelsHe: WHEN_HE } },
    epistemic: "OWNER_REPORTED", slot: (v) => `followup:${s(v.who)}`,
    reviewAt: (v, t) => (v.when ? s(v.when) : addDays(t, RELATIVE_DAYS[s(v.whenRelative) || "UNSPECIFIED"] ?? 14)), expiresAt: () => null,
    readBackHe: (l, v) => `${s(v.who) === "OWNER_WILL_CONTACT" ? `אתה חוזר ל${l}` : `${l} יחזור אליך`} ${v.when ? `עד ${s(v.when)}` : WHEN_HE[s(v.whenRelative) || "UNSPECIFIED"]}.`,
    conflicts: (_k, v, live) => (v.when && s(v.when) < live.todayIL ? [{ code: "DATE_IN_PAST", severity: "BLOCKING", messageHe: "התאריך כבר עבר." }] : []),
    influencesAnalysis: true, mutatesCanonicalState: false, relationQuality: null, notesHe: [],
  },
  {
    kind: "VENDOR_COMMITMENT", family: "WORK_OPERATIONS", titleHe: "התחייבות של איש צוות / ספק", subjectTypes: ["vendor"],
    descriptionForModel: "What a vendor (Victor / Steven) committed to deliver and by when (e.g. \"Victor will finish the beat tomorrow\"). It is his commitment as reported by the Owner, not a delivery.",
    fields: { commitment: { type: "enum", values: ["DELIVER_WORK", "SEND_REVISION", "SEND_FILES"], required: true }, due: { type: "ymd", required: true }, project: { type: "entity", subjectTypes: ["project"], required: false } },
    epistemic: "OWNER_REPORTED", slot: (v) => `commit:${s(v.commitment)}:${s(v.project) || "-"}`, reviewAt: (v) => addDays(s(v.due), 1), expiresAt: (v) => addDays(s(v.due), 30),
    readBackHe: (l, v) => `${l} התחייב ל${s(v.commitment) === "SEND_REVISION" ? "שלוח תיקון" : s(v.commitment) === "SEND_FILES" ? "שלוח קבצים" : "מסור עבודה"}${v.projectLabel ? ` של ${s(v.projectLabel)}` : ""} עד ${s(v.due)}.`,
    conflicts: (_k, v, live) => (s(v.due) < live.todayIL ? [{ code: "DATE_IN_PAST", severity: "BLOCKING", messageHe: "המועד כבר עבר." }] : []),
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
];

export const MAX_FIELDS = 12;
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
