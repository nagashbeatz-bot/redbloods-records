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
export const COMPANY_KEY = "company:REDBLOODS";

export type KnowledgeSubjectType = "label-artist" | "dj" | "client" | "project" | "show" | "release" | "vendor" | "company";
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
}

const addDays = (ymd: string, n: number) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const s = (v: unknown) => (typeof v === "string" ? v : String(v ?? ""));
const norm = (t: string) => t.normalize("NFKC").trim().replace(/\s+/g, " ");
const shortHash = (t: string) => { let h = 5381; for (const c of t) h = ((h << 5) + h + c.codePointAt(0)!) >>> 0; return h.toString(36); };

export const ROLE_HE: Record<string, string> = {
  LABEL_DJ: "ה-DJ של הלייבל", LABEL_ARTIST_MANAGER: "מנהל/ת האמנים של הלייבל", MIX_ENGINEER: "מהנדס/ת המיקס", MASTERING_ENGINEER: "מהנדס/ת המאסטרינג",
  PRODUCER: "מפיק/ה", BOOKER: "מזמין/ת ההופעות", TEAM_MEMBER: "חבר/ת צוות",
};
const RELATION_HE: Record<string, string> = { PARTICIPATES_IN_SHOWS: "משתתף בהופעות", WORKS_WITH: "עובד עם", REPRESENTS: "מייצג את", COLLABORATES_WITH: "משתף פעולה עם" };
const FREQ_HE: Record<string, string> = { ALWAYS: "תמיד", MOST: "ברוב", SOMETIMES: "לפעמים", RARELY: "לעיתים רחוקות" };
const BLOCKER_HE: Record<string, string> = { WAITING_FOR_ARTIST: "מחכים לאמן", WAITING_FOR_CLIENT: "מחכים ללקוח", WAITING_FOR_PAYMENT: "מחכים לתשלום", WAITING_FOR_VENDOR: "מחכים לספק / איש צוות", WAITING_FOR_OWNER: "מחכה לבעלים", EXTERNAL_DEPENDENCY: "תלות חיצונית" };
const WHEN_HE: Record<string, string> = { AFTER_HOLIDAYS: "אחרי החגים", NEXT_WEEK: "בשבוע הבא", NEXT_MONTH: "בחודש הבא", UNSPECIFIED: "בלי מועד מוגדר" };
const RELATIVE_DAYS: Record<string, number> = { AFTER_HOLIDAYS: 30, NEXT_WEEK: 7, NEXT_MONTH: 30, UNSPECIFIED: 14 };
const CLOSED_PROJECT = new Set(["הושלם", "בוטל"]);
const ENTITY_TYPES_ALL: readonly KnowledgeSubjectType[] = ["label-artist", "dj", "client", "project", "show", "release", "vendor"];

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
    kind: "ENTITY_RELATIONSHIP", family: "IDENTITY_RELATIONSHIP", titleHe: "קשר בין ישויות", subjectTypes: ENTITY_TYPES_ALL,
    descriptionForModel: "A recurring relationship the Owner states (e.g. participates in most label shows). A frequency describes the past — it is never a booking rule.",
    fields: {
      relation: { type: "enum", values: Object.keys(RELATION_HE), required: true, labelsHe: RELATION_HE },
      object: { type: "entity", subjectTypes: ["label-artist", "dj", "client", "project", "vendor", "company"], required: true },
      frequency: { type: "enum", values: Object.keys(FREQ_HE), required: false, labelsHe: FREQ_HE },
    },
    epistemic: "OWNER_DECISION", slot: (v) => `rel:${s(v.relation)}:${s(v.object)}`, reviewAt: () => null, expiresAt: () => null,
    readBackHe: (l, v) => `${l} ${RELATION_HE[s(v.relation)] ?? s(v.relation)}${v.frequency ? ` (${FREQ_HE[s(v.frequency)] ?? ""})` : ""} — ${s(v.objectLabel) || s(v.object)}.`,
    conflicts: () => [], influencesAnalysis: true, mutatesCanonicalState: false, relationQuality: "OWNER_CONFIRMED_RELATION",
    notesHe: ["תדירות מתארת את מה שקורה — היא לא כלל שיבוץ להופעות עתידיות."],
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
    fields: { area: { type: "enum", values: ["PROJECTS", "SHOWS", "FINANCE", "RELEASES", "TEAM", "CLIENTS"], required: true }, frictionHe: { type: "text", maxLength: 160, required: true } },
    epistemic: "OWNER_REPORTED", slot: (v) => `friction:${s(v.area)}:${shortHash(norm(s(v.frictionHe)))}`, reviewAt: (_v, t) => addDays(t, 30), expiresAt: () => null,
    readBackHe: (_l, v) => `חיכוך שדיווחת עליו (${s(v.area)}): ${norm(s(v.frictionHe))}.`, conflicts: () => [],
    influencesAnalysis: true, mutatesCanonicalState: false, relationQuality: null, notesHe: ["זו תצפית, לא מדיניות — לא ישתנה שום תהליך אוטומטית."],
  },
  {
    kind: "WORKING_POLICY_CANDIDATE", family: "OPERATING_KNOWLEDGE", titleHe: "מדיניות עבודה (מועמדת)", subjectTypes: ["company"],
    descriptionForModel: "How the Owner wants something done from now on (\"from now on in such projects we work like X\"). Stored only as a CANDIDATE — never promoted to a rule automatically.",
    fields: { area: { type: "enum", values: ["PROJECTS", "SHOWS", "FINANCE", "RELEASES", "TEAM", "CLIENTS"], required: true }, policyHe: { type: "text", maxLength: 200, required: true }, appliesWhenHe: { type: "text", maxLength: 120, required: false } },
    epistemic: "OWNER_POLICY_CANDIDATE", slot: (v) => `policy:${s(v.area)}:${shortHash(norm(s(v.policyHe)))}`, reviewAt: (_v, t) => addDays(t, 30), expiresAt: () => null,
    readBackHe: (_l, v) => `מדיניות עבודה (${s(v.area)}): ${norm(s(v.policyHe))}${v.appliesWhenHe ? ` — כש${norm(s(v.appliesWhenHe))}` : ""}.`, conflicts: () => [],
    influencesAnalysis: true, mutatesCanonicalState: false, relationQuality: null, notesHe: ["נשמר כמדיניות מועמדת — לא הופך לכלל אוטומטית."],
  },
];

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
    if (!k.subjectTypes.length || Object.keys(k.fields).length === 0 || Object.keys(k.fields).length > 5) e.push(`${k.kind}: needs subjects and 1–5 fields`);
    for (const [n, f] of Object.entries(k.fields)) if (f.type === "text" && f.maxLength > 200) e.push(`${k.kind}.${n}: text too long`);
    if (k.mutatesCanonicalState !== false) e.push(`${k.kind}: must never mutate canonical state`);
  }
  return e;
}
