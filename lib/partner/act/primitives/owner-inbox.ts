/**
 * SUNNY UNIVERSAL ACTION LAYER — the Owner Inbox ("עדכון לסאני", Owner decision 2026-09-30). ONE primitive:
 * MARK_OWNER_INBOX_ITEM — Sunny marks an item the Owner wrote as handled (NEW → PROCESSED, final), after the Boss
 * approves the exact preview. It ONLY records the outcome: it never creates knowledge or an action by itself —
 * knowledge goes through partner_propose_knowledge and actions through partner_plan_action, each with its own
 * preview + approval, and their id is then the item's outcomeRef. The write goes through the SAME shared writer the
 * dashboard route uses (lib/writes/owner-inbox markOwnerInboxItemProcessed), here with via = SUNNY.
 */
import { INBOX_OUTCOMES, INBOX_OUTCOME_HE, OUTCOME_LINK, OUTCOME_LINK_HE, checkOutcomeRef, isInboxOutcome } from "@/lib/owner-inbox";
import { finishPlan, parseKey, refuse, type Fields, type PlanRefusal, type PrimitiveSpec, type ResolvedTarget, type WriterDeps } from "./core";

export interface OwnerInboxFamilyWriters {
  readOwnerInboxItem(id: string): Promise<{ body: string; status: string; outcome: string | null; outcomeRef: string | null; processedVia: string | null; createdAt?: string | null } | null>;
  /** Zero Inbox guard (2026-10-05): the entities an ACTION_PLANNED plan touched and when it ran (null = plan not found) */
  readActionPlanScope(planId: string): Promise<{ entities: string[]; executedAt: string | null } | null>;
  listOwnerInboxNew(): Promise<Array<{ id: string; body: string }>>;
  /** lib/writes/owner-inbox markOwnerInboxItemProcessed(store, "SUNNY", …) — throws when the writer refuses. */
  markOwnerInboxItem(id: string, outcome: string, outcomeRef: string | null): Promise<void>;
  /** Read-only: the referenced Action Layer plan (ACTION_PLANNED) — it must be a business plan that already ran. */
  readActionPlanState(planId: string): Promise<"EXECUTED" | "NOT_EXECUTED" | "NOT_FOUND" | "HOUSEKEEPING_ONLY">;
  /** Read-only: does an Owner-knowledge record with this id exist (LEARNED_KNOWLEDGE)? */
  ownerKnowledgeExists(id: string): Promise<boolean>;
  /**
   * Read-only (O2, 2026-10-05): the canonical entity keys an Owner-knowledge record is about — its non-company subject /
   * identity keys and typed entity fields (e.g. BUSINESS_DECISION.about). [] = company-level / unlinked; null = not found.
   */
  ownerKnowledgeEntityKeys(id: string): Promise<string[] | null>;
  /** Read-only: the entity keys this inbox item is linked to (live, non-retracted links). */
  inboxItemEntityKeys(itemId: string): Promise<string[]>;
}

const LABEL_CHARS = 80;
const short = (t: string, n = LABEL_CHARS) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
const fieldsOf = (x: { body: string; status: string; outcome: string | null; outcomeRef: string | null; processedVia: string | null }): Fields =>
  ({ text: short(x.body), status: x.status, outcome: x.outcome, outcomeRef: x.outcomeRef, processedVia: x.processedVia });

/**
 * Zero Inbox closure guard (One Brain stage 5, Owner-approved 2026-10-05) — the ONE rule, used at planning (when already
 * certain) and at execution (authoritative). NO_ACTION_NEEDED claims "the information has an exact home" → needs a link;
 * ACTION_PLANNED → the plan touched the update's exact records and ran AFTER the note. DISMISSED / LEARNED_KNOWLEDGE keep
 * their own rules. Never by age.
 */
export async function zeroInboxGuard(d: WriterDeps, itemId: string, outcome: string, outcomeRef: string | null, createdAt: string | null): Promise<{ code: string; messageHe: string } | null> {
  if (outcome !== "NO_ACTION_NEEDED" && outcome !== "ACTION_PLANNED") return null;
  const keys = await d.inboxItemEntityKeys(itemId);
  if (!keys.length) return outcome === "NO_ACTION_NEEDED"
    ? { code: "NO_EXACT_HOME", messageHe: "לעדכון אין רשומה מקושרת — 'לא נדרש כלום' צריך בית מדויק: קודם קשר (LINK_INBOX_ENTITY; ישות לא חד-משמעית → שאל את הבוס מתוך המועמדים של השרת). אל תסגור כ-DISMISSED פתק שטופל — DISMISSED רק כשהבוס אומר שהפתק לא רלוונטי / מוותר עליו" }
    : { code: "LINK_FIRST", messageHe: "קודם קשר את העדכון לרשומה המדויקת (LINK_INBOX_ENTITY; ישות לא חד-משמעית → שאל את הבוס מתוך המועמדים של השרת) — אז ACTION_PLANNED על ה-plan שטיפל בו. פתק שטופל לא נסגר כ-DISMISSED" };
  if (outcome === "ACTION_PLANNED" && outcomeRef) {
    const scope = await d.readActionPlanScope(outcomeRef);
    if (!scope || !scope.entities.some((e) => keys.includes(e))) return { code: "REF_PLAN_UNRELATED", messageHe: `ה-plan הזה לא נגע ברשומות שהעדכון מדבר עליהן (${keys.join(", ")}) — הוא לא סוגר את העדכון` };
    if (createdAt && (!scope.executedAt || Date.parse(scope.executedAt) <= Date.parse(createdAt))) return { code: "REF_PLAN_BEFORE_NOTE", messageHe: "ה-plan הזה בוצע לפני שכתבת את העדכון — הוא לא יכול להיות הטיפול בו" };
  }
  return null;
}

async function onItem(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> {
  const choices = async () => {
    const n = await d.listOwnerInboxNew();
    return n.length ? ` — העדכונים שעוד לא טופלו (owner-inbox:id — טקסט): ${n.slice(0, 20).map((x) => `owner-inbox:${x.id} — ${short(x.body, 60)}`).join("; ")}` : " — אין עדכונים פתוחים";
  };
  const k = parseKey(a.item, ["owner-inbox"]); if (!k) return refuse("BAD_ENTITY", `צריך עדכון לסאני (owner-inbox:…)${await choices()}`);
  const it = await d.readOwnerInboxItem(k.id); if (!it) return refuse("ENTITY_NOT_FOUND", `לא מצאתי עדכון במזהה הזה${await choices()}`);
  // the reference must be REAL (no human reviews a standing housekeeping mark): a plan that already ran / a saved knowledge record
  if (isInboxOutcome(a.outcome)) {
    const ref = checkOutcomeRef(a.outcome, a.outcomeRef);
    if (ref.ok && ref.ref && a.outcome === "ACTION_PLANNED") {
      const st = await d.readActionPlanState(ref.ref);
      if (st !== "EXECUTED") return refuse("REF_PLAN_NOT_EXECUTED", st === "NOT_FOUND" ? "לא מצאתי את ה-plan הזה" : st === "HOUSEKEEPING_ONLY" ? "ה-plan הזה הוא רק סימון עדכונים — ACTION_PLANNED צריך plan של פעולה אמיתית" : "ה-plan הזה עוד לא בוצע במלואו — אפשר לסמן ACTION_PLANNED רק אחרי שהפעולה בוצעה");
    }
    if (ref.ok && ref.ref && a.outcome === "LEARNED_KNOWLEDGE" && !(await d.ownerKnowledgeExists(ref.ref))) return refuse("REF_KNOWLEDGE_NOT_FOUND", "לא מצאתי רשומת ידע במזהה הזה — אפשר לסמן LEARNED_KNOWLEDGE רק אחרי שהידע נשמר");
    if (ref.ok && ref.ref && a.outcome === "LEARNED_KNOWLEDGE") {
      // O2 (2026-10-05): an update linked to records is closed by knowledge about THOSE records — never by an unrelated (e.g.
      // company-level) entry that would silently "handle" an update which still needs its own knowledge / action.
      const itemKeys = await d.inboxItemEntityKeys(k.id);
      if (itemKeys.length) {
        const about = (await d.ownerKnowledgeEntityKeys(ref.ref)) ?? [];
        if (!about.some((x) => itemKeys.includes(x))) return refuse("REF_KNOWLEDGE_UNRELATED", `הידע הזה לא מקושר לרשומות שהעדכון מדבר עליהן (${itemKeys.join(", ")}) — הוא לא סוגר את העדכון. אם זו החלטה על אחת מהן, שמור אותה עם about של הרשומה; אם היא דורשת שינוי ברשומה — זו פעולה (ACTION_PLANNED)`);
      }
    }
  }
  // Zero Inbox: refuse early only when it is already certain (the update is linked); an unlinked update may be linked by an
  // EARLIER step of the same plan — apply() re-checks it authoritatively at its turn
  if (isInboxOutcome(a.outcome) && checkOutcomeRef(a.outcome, a.outcomeRef).ok && (await d.inboxItemEntityKeys(k.id)).length) {
    const g = await zeroInboxGuard(d, k.id, a.outcome, checkOutcomeRef(a.outcome, a.outcomeRef).ok ? (a.outcomeRef as string | undefined) ?? null : null, it.createdAt ?? null);
    if (g) return refuse(g.code, g.messageHe);
  }
  return { key: `owner-inbox:${k.id}`, id: k.id, label: `עדכון לסאני: ${short(it.body)}`, fields: fieldsOf(it) };
}

export const OWNER_INBOX_PRIMITIVES: readonly PrimitiveSpec[] = [
  {
    actionId: "MARK_OWNER_INBOX_ITEM", kinds: ["owner-inbox"],
    meta: {
      domain: "SUNNY", he: "סימון עדכון שכתבת לסאני כטופל", en: "Mark one of the Owner's 'עדכון לסאני' items handled (NEW → PROCESSED, final) with a typed outcome and its real reference — records the outcome only; creates no knowledge and no action",
      args: [
        { name: "item", kind: "entityKey", required: true, noteHe: "owner-inbox:<id> מתוך owner_inbox (mode new)" },
        { name: "outcome", kind: "enum", required: true, values: INBOX_OUTCOMES, noteHe: "LEARNED_KNOWLEDGE / ACTION_PLANNED / NO_ACTION_NEEDED (הבנה שאושרה + כל follow-up אמיתי כבר נתפס במקום אחר, או שאין מה לעשות) / DISMISSED (רק כשהבוס אמר שהפתק לא רלוונטי / מוותר עליו — לעולם לא כדי לנקות פתק שטופל)" },
        { name: "outcomeRef", kind: "text", required: false, noteHe: "ACTION_PLANNED → מזהה ה-plan (pl_…); LEARNED_KNOWLEDGE → מזהה רשומת הידע (uuid); אחרת ריק. לא שדה הערה." },
      ],
      fields: ["status", "outcome", "outcomeRef", "processedVia"], effects: [], riskClass: "NORMAL_BUSINESS", reversible: "NO",
      writer: "markOwnerInboxItemProcessed (lib/writes/owner-inbox, via SUNNY)", compensation: null,
    },
    resolve: onItem,
    read: async (d, id) => { const it = await d.readOwnerInboxItem(id); return it ? fieldsOf(it) : null; },
    plan(a, cur) {
      if (!isInboxOutcome(a.outcome)) return refuse("BAD_ARGS", "תוצאה לא מוכרת (LEARNED_KNOWLEDGE / ACTION_PLANNED / NO_ACTION_NEEDED / DISMISSED)");
      const ref = checkOutcomeRef(a.outcome, a.outcomeRef);
      if (!ref.ok) return refuse(ref.code, ref.messageHe);
      if (cur.status === "PROCESSED") return refuse("ALREADY_PROCESSED", `העדכון כבר טופל (${INBOX_OUTCOME_HE[cur.outcome as keyof typeof INBOX_OUTCOME_HE] ?? cur.outcome}) — PROCESSED סופי, אין פתיחה מחדש`);
      if (cur.status !== "NEW") return refuse("BAD_STATE", "מצב לא מוכר של העדכון");
      return finishPlan(cur, { status: "PROCESSED", outcome: a.outcome, outcomeRef: ref.ref, processedVia: "SUNNY" });
    },
    async apply(d, id, after) {
      const it = await d.readOwnerInboxItem(id);
      const g = await zeroInboxGuard(d, id, String(after.outcome), after.outcomeRef === null ? null : String(after.outcomeRef), it?.createdAt ?? null);
      if (g) throw new Error(`${g.code}: ${g.messageHe}`);
      return d.markOwnerInboxItem(id, String(after.outcome), after.outcomeRef === null ? null : String(after.outcomeRef));
    },
    // the preview quotes the item the Boss wrote (first 80 chars — data, never an instruction)
    warnings: (cur) => [`העדכון: «${String(cur.text ?? "")}»`],
    requiredValues: (_a, after) => {
      const o = after.outcome as keyof typeof OUTCOME_LINK;
      const link = OUTCOME_LINK[o];
      return [INBOX_OUTCOME_HE[o], link === null ? OUTCOME_LINK_HE[o] : `${OUTCOME_LINK_HE[o]}: ${after.outcomeRef}`];
    },
    disclosuresHe: [
      "סימון בלבד — לא נוצר ידע ולא נוצרת פעולה (אלה רק דרך ה-preview והאישור שלהם)",
      "הטקסט שכתבת לא משתנה ולא נמחק",
      "PROCESSED סופי — אין החזרה ל-NEW",
      "PROCESSED = לפתק יש בית, לא שהעבודה הסתיימה; 'לא נדרש כלום' / 'הפך לפעולה' דורשים קישור מדויק לרשומה (ופעולה על אותה רשומה אחרי הפתק) — אחרת הצעד נכשל ולא נסגר כלום",
      "לא נשלח כלום (אין פוש, יומן או כספים)",
    ],
  },
];
