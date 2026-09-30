/**
 * SUNNY UNIVERSAL ACTION LAYER — Owner Inbox MEMORY (Phase 1, Owner decision + approved SQL 2026-10-01). Four primitives
 * over the ONE writer lib/writes/inbox-memory.ts:
 *   LINK_INBOX_ENTITY             an update → an entity (RESOLVER_UNIQUE, or OWNER_ANSWER from the server's candidate list)
 *   RECORD_INBOX_INTERPRETATION   Sunny's understanding of the update for ONE linked project (HYPOTHESIS; supersedes the head)
 *   RETRACT_INBOX_LINK            a wrong link (its interpretations are retracted with it; kept as history)
 *   RETRACT_INBOX_INTERPRETATION  a wrong interpretation (kept as history; the previous one becomes current again)
 * OWNER MEMORY only: no business record changes (no status, task, deadline, finance, proposal, release, alert, push,
 * P2 knowledge). They are the standing-authorization housekeeping set (lib/partner/act/standing.ts) together with
 * MARK_OWNER_INBOX_ITEM. Nothing is ever deleted.
 */
import { BALL_WITH, CONFIDENCE, LINK_KEY_RE, LINK_METHODS, PROJECT_KEY_RE, SUPERSEDE_KINDS, activeLinksOf, headOf, type InboxMemory, type LinkMethod } from "@/lib/inbox-memory";
import { checkInterpretation, type InterpretationInput } from "@/lib/writes/inbox-memory";
import { parseKey, refuse, text, type Fields, type PlanRefusal, type PrimitiveSpec, type ResolvedTarget, type WriterDeps } from "./core";

export interface InboxMemoryFamilyWriters {
  /** Read-only: every link + interpretation (bounded). */
  readInboxMemory(): Promise<InboxMemory>;
  /** Read-only: the server resolver verdict for a link (lib/writes/inbox-memory checkLink — the SAME rule the write applies). */
  checkInboxLink(a: { itemId: string; entityKey: string; method: LinkMethod; surface: string; candidates: string[] | null }): Promise<{ ok: true; method: LinkMethod; candidates: string[] | null } | { ok: false; code: string; messageHe: string }>;
  /** The writer (throws when refused) → the new row id. */
  createInboxLink(a: { itemId: string; entityKey: string; method: LinkMethod; surface: string; candidates: string[] | null }): Promise<string>;
  createInboxInterpretation(a: InterpretationInput): Promise<string>;
  retractInboxLinkRow(linkId: string, reason: string): Promise<void>;
  retractInboxInterpretationRow(interpretationId: string, reason: string): Promise<void>;
}

const LABEL = 80;
const short = (t: string, n = LABEL) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
const keysOf = (v: unknown): string[] | null => (v === undefined || v === null || v === "" ? null : typeof v === "string" ? [...new Set(v.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean))].sort() : null);
const reasonArg = (v: unknown) => text(v, 200)?.trim() ?? null;
const NO_BUSINESS = [
  "זיכרון בלבד — שום רשומה עסקית לא משתנה (סטטוס, משימה, דדליין, כספים, הצעה, ריליס)",
  "לא יישלח Push / התראה / הודעה; היומן לא משתנה",
  "שום דבר לא נמחק — תיקון נשמר כהיסטוריה",
];

async function itemOf(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<{ id: string; body: string; status: string } | PlanRefusal> {
  const k = parseKey(a.item, ["owner-inbox"]);
  if (!k) return refuse("BAD_ENTITY", "צריך עדכון לסאני (owner-inbox:… מתוך owner_inbox)");
  const it = await d.readOwnerInboxItem(k.id);
  return it ? { id: k.id, body: it.body, status: it.status } : refuse("ENTITY_NOT_FOUND", "לא מצאתי עדכון במזהה הזה");
}
const isRef = (x: unknown): x is PlanRefusal => !!x && typeof x === "object" && (x as { ok?: unknown }).ok === false;

// ── LINK ────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function linkContext(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<Fields> {
  const it = await itemOf(d, a);
  if (isRef(it)) return { item: null, checkCode: it.code, checkMessage: it.messageHe, method: null, candidates: null, alreadyLinked: false };
  const entity = typeof a.entity === "string" ? a.entity : "";
  const method = (LINK_METHODS as readonly unknown[]).includes(a.linkMethod) ? (a.linkMethod as LinkMethod) : null;
  const surface = typeof a.surface === "string" ? a.surface : "";
  const mem = await d.readInboxMemory();
  const alreadyLinked = activeLinksOf(mem.links, (l) => l.itemId === it.id && l.entityKey === entity).length > 0;
  if (!method) return { item: it.id, checkCode: "BAD_ENUM", checkMessage: "linkMethod: RESOLVER_UNIQUE / OWNER_ANSWER", method: null, candidates: null, alreadyLinked };
  const v = await d.checkInboxLink({ itemId: it.id, entityKey: entity, method, surface, candidates: keysOf(a.candidates) });
  return v.ok ? { item: it.id, checkCode: "OK", checkMessage: null, method: v.method, candidates: v.candidates ? v.candidates.join(" ") : null, alreadyLinked }
    : { item: it.id, checkCode: v.code, checkMessage: v.messageHe, method, candidates: null, alreadyLinked };
}
async function linkFields(d: WriterDeps, id: string): Promise<Fields | null> {
  const l = (await d.readInboxMemory()).links.find((x) => x.id === id);
  return l ? { item: l.itemId, entity: l.entityKey, quality: l.quality, linkMethod: l.method, surface: l.surface, retracted: !!l.retractedAt, retractedReason: l.retractedReason, interpretationsActive: null } : null;
}

// ── INTERPRETATION ──────────────────────────────────────────────────────────────────────────────────────────────────
/** The creation context: the item + the project + the CURRENT head of that project. Deliberately NOT whether the link
 *  exists yet — a LINK step earlier in the same plan creates it, and must not make this step STALE; the writer requires
 *  the active link at execution (else the step fails, nothing written). */
async function interpretationContext(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<Fields> {
  const it = await itemOf(d, a);
  const p = parseKey(a.project, ["project"]);
  const meta = p ? await d.readProjectMeta(p.id) : null;
  const head = p ? headOf((await d.readInboxMemory()).interpretations, `project:${p.id}`) : null;
  return { item: isRef(it) ? null : it.id, project: meta && p ? `project:${p.id}` : null, projectName: meta?.name ?? null, headId: head?.id ?? null, headWhatHappened: head ? short(head.whatHappened, 120) : null };
}
async function interpretationFields(d: WriterDeps, id: string): Promise<Fields | null> {
  const mem = await d.readInboxMemory();
  const i = mem.interpretations.find((x) => x.id === id);
  if (!i) return null;
  return { project: i.entityKey, item: i.itemId, whatHappened: i.whatHappened, completed: i.completed.join("\n"), openGaps: i.openGaps.join("\n"), blockers: i.blockers.join("\n"), ballWith: i.ballWith, inferredNextStep: i.inferredNextStep, confidence: i.confidence, supersedeKind: i.supersedeKind, isHead: headOf(mem.interpretations, i.entityKey)?.id === i.id, retracted: !!i.retractedAt, retractedReason: i.retractedReason };
}

export const INBOX_MEMORY_PRIMITIVES: readonly PrimitiveSpec[] = [
  {
    actionId: "LINK_INBOX_ENTITY", kinds: ["inbox-link"],
    meta: {
      domain: "SUNNY", he: "קישור עדכון שכתבת לסאני לישות (פרויקט / לקוח / אמן / הופעה …)", en: "Link one of the Owner's 'עדכון לסאני' items to the entity a literal part of its text names — only the server resolver's unique result, or the Owner's answer from the server-computed candidates (OWNER_CONFIRMED). Owner memory only",
      args: [
        { name: "item", kind: "entityKey", required: true, noteHe: "owner-inbox:<id>" },
        { name: "entity", kind: "entityKey", required: true, noteHe: "המפתח מ-partner_resolve (project / client / label-artist / dj / show / session / release / vendor)" },
        { name: "surface", kind: "text", required: true, noteHe: "החלק המילולי מהטקסט שמזכיר את הישות (2–80 תווים, מילה במילה)" },
        { name: "linkMethod", kind: "enum", required: true, values: LINK_METHODS, noteHe: "RESOLVER_UNIQUE (חד-משמעי) / OWNER_ANSWER (הבוס בחר מתוך המועמדים)" },
        { name: "candidates", kind: "text", required: false, noteHe: "רק ב-OWNER_ANSWER: בדיוק המפתחות שהשרת החזיר כמועמדים, מופרדים ברווח" },
      ],
      fields: ["entity", "quality", "linkMethod", "surface"], effects: [], riskClass: "NORMAL_BUSINESS", reversible: "PARTIAL",
      writer: "linkInboxEntity (lib/writes/inbox-memory → sunny_inbox_link_entity)", compensation: "RETRACT_INBOX_LINK (kept as history)",
    },
    createContext: linkContext,
    async resolve(d, a) {
      const it = await itemOf(d, a); if (isRef(it)) return it;
      if (typeof a.entity !== "string" || !LINK_KEY_RE.test(a.entity)) return refuse("BAD_ENTITY", "entity לא לפי חוזה המפתחות (project / client / label-artist / dj / show / session / release: uuid, או vendor:VICTOR / vendor:STEVEN)");
      return { key: "inbox-link:new", id: "new", label: `קישור: «${short(it.body, 60)}» → ${a.entity}`, fields: await linkContext(d, a) } satisfies ResolvedTarget;
    },
    read: async (d, id, a) => (id === "new" && a ? linkContext(d, a) : linkFields(d, id)),
    plan(a, cur) {
      if (cur.item === null) return refuse(String(cur.checkCode), String(cur.checkMessage));
      if (cur.alreadyLinked) return refuse("ALREADY_LINKED", "העדכון כבר מקושר לישות הזו");
      if (cur.checkCode !== "OK") return refuse(String(cur.checkCode), String(cur.checkMessage));
      const surface = text(a.surface, 80)?.trim() ?? "";
      return { ok: true, after: { entity: String(a.entity), quality: cur.method === "OWNER_ANSWER" ? "OWNER_CONFIRMED" : "EXACT_UNIQUE", linkMethod: String(cur.method), surface } };
    },
    async apply(d, _id, after, a) {
      const k = parseKey(a.item, ["owner-inbox"])!;
      return { createdId: await d.createInboxLink({ itemId: k.id, entityKey: String(after.entity), method: after.linkMethod as LinkMethod, surface: String(after.surface), candidates: keysOf(a.candidates) }) };
    },
    async verify(d, id, after) { const l = await linkFields(d, id); return !!l && !l.retracted && l.entity === after.entity && l.quality === after.quality; },
    requiredValues: (a, after) => [`ישות: ${after.entity}`, `לפי: «${after.surface}»`, after.quality === "OWNER_CONFIRMED" ? "איכות: OWNER_CONFIRMED (בחירה שלך מתוך המועמדים)" : "איכות: EXACT_UNIQUE (שם חד-משמעי)"],
    disclosuresHe: ["רק קישור בזיכרון של סאני — לא קשר קנוני בין רשומות", ...NO_BUSINESS],
  },
  {
    actionId: "RECORD_INBOX_INTERPRETATION", kinds: ["inbox-interpretation"],
    meta: {
      domain: "SUNNY", he: "שמירת ההבנה של סאני מעדכון שכתבת — לפרויקט מקושר אחד (HYPOTHESIS)", en: "Record Sunny's understanding of one 'עדכון לסאני' item for ONE linked project: what happened, reported done, open gaps, blockers, ball, inferred next step, confidence — epistemic HYPOTHESIS, never canonical; supersedes the project's current understanding (NEW_UPDATE / CORRECTION). The canonical basis is computed by the server",
      args: [
        { name: "item", kind: "entityKey", required: true, noteHe: "owner-inbox:<id>" },
        { name: "project", kind: "entityKey", required: true, noteHe: "project:<id> — חייב קישור פעיל של העדכון לפרויקט (קיים או משלב קודם בתוכנית)" },
        { name: "whatHappened", kind: "text", required: true, noteHe: "מה קרה בפרויקט לפי העדכון (עד 300 תווים)" },
        { name: "completed", kind: "text", required: false, noteHe: "מה דווח כהושלם — פריט בכל שורה (עד 5 × 160). לא סטטוס" },
        { name: "openGaps", kind: "text", required: false, noteHe: "מה עדיין פתוח — פריט בכל שורה (עד 5 × 160)" },
        { name: "blockers", kind: "text", required: false, noteHe: "מה חוסם — פריט בכל שורה (עד 5 × 160)" },
        { name: "ballWith", kind: "enum", required: false, values: BALL_WITH, noteHe: "רק אם ברור מהטקסט; אחרת UNKNOWN" },
        { name: "inferredNextStep", kind: "text", required: false, noteHe: "הצעד הבא שכנראה יקדם (עד 200 תווים)" },
        { name: "confidence", kind: "enum", required: true, values: CONFIDENCE, noteHe: "LOW / MEDIUM / HIGH" },
        { name: "supersedeKind", kind: "enum", required: false, values: SUPERSEDE_KINDS, noteHe: "כשכבר יש הבנה לפרויקט: NEW_UPDATE (עדכון חדש) / CORRECTION (תיקון)" },
        { name: "supersedeReason", kind: "text", required: false, noteHe: "חובה ב-CORRECTION (עד 200 תווים)" },
      ],
      fields: ["project", "whatHappened", "completed", "openGaps", "blockers", "ballWith", "inferredNextStep", "confidence", "supersedeKind"], effects: [], riskClass: "NORMAL_BUSINESS", reversible: "PARTIAL",
      writer: "recordInboxInterpretation (lib/writes/inbox-memory → sunny_inbox_record_interpretation)", compensation: "RETRACT_INBOX_INTERPRETATION or a CORRECTION (kept as history)",
    },
    createContext: interpretationContext,
    async resolve(d, a) {
      const it = await itemOf(d, a); if (isRef(it)) return it;
      if (typeof a.project !== "string" || !PROJECT_KEY_RE.test(a.project)) return refuse("NOT_A_PROJECT", "הבנה נשמרת רק לפרויקט (project:…) ב-Phase 1");
      const ctx = await interpretationContext(d, a);
      if (!ctx.project) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את הפרויקט");
      return { key: "inbox-interpretation:new", id: "new", label: `הבנה ל-${ctx.projectName}: «${short(it.body, 60)}»`, fields: ctx };
    },
    read: async (d, id, a) => (id === "new" && a ? interpretationContext(d, a) : interpretationFields(d, id)),
    plan(a, cur) {
      if (!cur.item) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את העדכון");
      if (!cur.project) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את הפרויקט");
      const c = checkInterpretation({ whatHappened: a.whatHappened, completed: a.completed, openGaps: a.openGaps, blockers: a.blockers, ballWith: a.ballWith, inferredNextStep: a.inferredNextStep, confidence: a.confidence, supersedeKind: a.supersedeKind, supersedeReason: a.supersedeReason }, cur.headId !== null);
      if (!c.ok) return refuse(c.code, c.messageHe);
      const v = c.value;
      return { ok: true, after: { project: String(cur.project), whatHappened: v.whatHappened, completed: v.completed.join("\n"), openGaps: v.openGaps.join("\n"), blockers: v.blockers.join("\n"), ballWith: v.ballWith, inferredNextStep: v.inferredNextStep, confidence: v.confidence, supersedeKind: cur.headId ? v.supersedeKind : null } };
    },
    async apply(d, _id, _after, a) {
      const k = parseKey(a.item, ["owner-inbox"])!;
      const p = parseKey(a.project, ["project"])!;
      const head = headOf((await d.readInboxMemory()).interpretations, `project:${p.id}`);
      return { createdId: await d.createInboxInterpretation({ itemId: k.id, projectKey: `project:${p.id}`, whatHappened: a.whatHappened, completed: a.completed, openGaps: a.openGaps, blockers: a.blockers, ballWith: a.ballWith, inferredNextStep: a.inferredNextStep, confidence: a.confidence, supersedeKind: a.supersedeKind, supersedeReason: a.supersedeReason, expectedHeadId: head?.id ?? null }) };
    },
    async verify(d, id, after) {
      const f = await interpretationFields(d, id);
      return !!f && !f.retracted && f.isHead === true && (["project", "whatHappened", "completed", "openGaps", "blockers", "ballWith", "inferredNextStep", "confidence"] as const).every((k) => f[k] === after[k]);
    },
    warnings: (cur) => [
      "הבנה של סאני (HYPOTHESIS) — לא מצב הפרויקט; אם הרשומות ישתנו אחריה, הרשומות גוברות והיא תסומן כלא עדכנית",
      ...(cur.headId ? [`מחליפה את ההבנה הנוכחית: «${String(cur.headWhatHappened ?? "")}» (נשמרת בהיסטוריה)`] : []),
      "דורש קישור פעיל של העדכון לפרויקט (קיים, או שנוצר בשלב קודם בתוכנית) — אחרת הצעד נכשל ושום דבר לא נשמר",
    ],
    requiredValues: (_a, after) => [`פרויקט: ${after.project}`, `מה קרה: ${short(String(after.whatHappened), 120)}`, ...(after.inferredNextStep ? [`צעד הבא (השערה): ${short(String(after.inferredNextStep), 120)}`] : []), `ביטחון: ${after.confidence}`],
    disclosuresHe: ["הבסיס הקנוני (סטטוס, כדור, אירוע אחרון) נקבע בשרת מהרשומות — לא ממה שסאני שולחת", "'הושלם' כאן = דווח כהושלם, לא סטטוס", ...NO_BUSINESS],
  },
  {
    actionId: "RETRACT_INBOX_LINK", kinds: ["inbox-link"],
    meta: {
      domain: "SUNNY", he: "ביטול קישור שגוי של עדכון לישות (נשמר כהיסטוריה)", en: "Retract a wrong inbox link with a reason — its interpretations are retracted with it; nothing is deleted. Owner memory only",
      args: [{ name: "link", kind: "entityKey", required: true, noteHe: "inbox-link:<id> מתוך owner_inbox / project_memory (history)" }, { name: "reason", kind: "text", required: true, noteHe: "למה הקישור שגוי (עד 200 תווים)" }],
      fields: ["retracted", "retractedReason"], effects: [], riskClass: "NORMAL_BUSINESS", reversible: "NO",
      writer: "retractInboxLink (lib/writes/inbox-memory → sunny_inbox_retract_link)", compensation: "LINK_INBOX_ENTITY again (a new link)",
    },
    async resolve(d, a) {
      const k = parseKey(a.link, ["inbox-link"]); if (!k) return refuse("BAD_ENTITY", "צריך קישור (inbox-link:… מתוך owner_inbox)");
      const f = await linkFields(d, k.id); if (!f) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את הקישור");
      const mem = await d.readInboxMemory();
      return { key: `inbox-link:${k.id}`, id: k.id, label: `קישור «${f.surface}» → ${f.entity}`, fields: { ...f, interpretationsActive: mem.interpretations.filter((i) => i.linkId === k.id && !i.retractedAt).length } };
    },
    read: async (d, id) => { const f = await linkFields(d, id); if (!f) return null; const mem = await d.readInboxMemory(); return { ...f, interpretationsActive: mem.interpretations.filter((i) => i.linkId === id && !i.retractedAt).length }; },
    plan(a, cur) {
      if (cur.retracted) return refuse("ALREADY_RETRACTED", "הקישור כבר בוטל");
      const r = reasonArg(a.reason); if (!r) return refuse("REASON_REQUIRED", "צריך סיבה (1–200 תווים)");
      return { ok: true, after: { retracted: true, retractedReason: r } };
    },
    apply: (d, id, after) => d.retractInboxLinkRow(id, String(after.retractedReason)),
    warnings: (cur) => (Number(cur.interpretationsActive) > 0 ? [`גם ${cur.interpretationsActive} הבנות שנשענו על הקישור יבוטלו (נשמרות בהיסטוריה)`] : []),
    requiredValues: (_a, after) => [`סיבה: ${after.retractedReason}`],
    disclosuresHe: ["הקישור נשאר בהיסטוריה עם הסיבה; קישור נכון נוצר בנפרד", ...NO_BUSINESS],
  },
  {
    actionId: "RETRACT_INBOX_INTERPRETATION", kinds: ["inbox-interpretation"],
    meta: {
      domain: "SUNNY", he: "ביטול הבנה שגויה של סאני (נשמרת כהיסטוריה)", en: "Retract a wrong interpretation with a reason — kept as history; the previous active one becomes the project's current understanding. Owner memory only",
      args: [{ name: "interpretation", kind: "entityKey", required: true, noteHe: "inbox-interpretation:<id> מתוך project_memory / owner_inbox" }, { name: "reason", kind: "text", required: true, noteHe: "למה ההבנה שגויה (עד 200 תווים)" }],
      fields: ["retracted", "retractedReason"], effects: [], riskClass: "NORMAL_BUSINESS", reversible: "NO",
      writer: "retractInboxInterpretation (lib/writes/inbox-memory → sunny_inbox_retract_interpretation)", compensation: "RECORD_INBOX_INTERPRETATION (a new understanding)",
    },
    async resolve(d, a) {
      const k = parseKey(a.interpretation, ["inbox-interpretation"]); if (!k) return refuse("BAD_ENTITY", "צריך הבנה (inbox-interpretation:… מתוך project_memory)");
      const f = await interpretationFields(d, k.id); if (!f) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את ההבנה");
      return { key: `inbox-interpretation:${k.id}`, id: k.id, label: `הבנה: «${short(String(f.whatHappened), 60)}»`, fields: f };
    },
    read: (d, id) => interpretationFields(d, id),
    plan(a, cur) {
      if (cur.retracted) return refuse("ALREADY_RETRACTED", "ההבנה כבר בוטלה");
      const r = reasonArg(a.reason); if (!r) return refuse("REASON_REQUIRED", "צריך סיבה (1–200 תווים)");
      return { ok: true, after: { retracted: true, retractedReason: r } };
    },
    apply: (d, id, after) => d.retractInboxInterpretationRow(id, String(after.retractedReason)),
    warnings: (cur) => (cur.isHead ? ["זו ההבנה הנוכחית של הפרויקט — אחרי הביטול ההבנה הפעילה הקודמת (אם יש) תחזור להיות הנוכחית"] : []),
    requiredValues: (_a, after) => [`סיבה: ${after.retractedReason}`],
    disclosuresHe: ["ההבנה נשארת בהיסטוריה עם הסיבה", ...NO_BUSINESS],
  },
];
