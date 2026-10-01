/**
 * Business unit of a Finance transaction — the ONE pure rule (Owner decisions 2026-09-28, task 4). No I/O.
 *
 * `transactions.business_unit` says which Redbloods unit OWNS the real money of a row: STUDIO / RECORDS / FILMS /
 * CORPORATE. NULL = "דורש סיווג" (unclassified) — never a default, and CORPORATE is never a fallback (only an explicit
 * Owner choice sets it). It is a property of the TRANSACTION, not of the project, and it is NOT the artist ledger
 * (a 50 / 50 split with an artist never changes the unit of the money).
 *
 * `business_unit_source` is BUSINESS provenance (why it is this unit, not how it was written):
 *   RULE                 derived by this module
 *   OWNER_DECISION       the Owner chose it (a manual choice in Finance, Sunny's SET_TRANSACTION_UNIT)
 *   HISTORICAL_APPROVED  the Owner-approved historical alignment (2026-09-28 backfill)
 * OWNER_DECISION and HISTORICAL_APPROVED are never overwritten automatically (`mayRecomputeUnit`).
 *
 * Precedence (the first match decides):
 *   1. an explicit Owner choice
 *   2. the writer's own nature: Victor's salary (the monthly retainer) → STUDIO; a mix / master / engineer cost → the unit
 *      of its PROJECT (Owner decision 2026-09-28: a Records / label project → RECORDS, a client project → STUDIO, no project
 *      → NULL) — the engineer being a Studio resource never decides it
 *   3. a show row: a show of a Records roster artist → RECORDS; any other show (collab / not on the roster) → NULL
 *   4. the approved transaction + project rules:
 *        label project → RECORDS (song / clip / promotion / show money of Records; mix was already STUDIO in step 2)
 *        client project, song money (income, not clip) → STUDIO
 *        client project, a studio session cost (expense scope סשן) → STUDIO
 *        client project, clip money → FILMS only when the project has a Red Films production made for an external
 *          client (client_source "לקוח חיצוני") — otherwise NULL (a client clip is not automatically Films work:
 *          e.g. בלאגן is a Studio deal, Owner decision)
 *      A rule result that differs from a unit the Owner already DECIDED on another row of the same project is not
 *      guessed either: NULL, the Owner decides (a guard — nothing is inherited from other rows).
 *   5. anything else → NULL ("דורש סיווג").
 * Payment status never matters (expected / cancelled rows get a unit too; they are never realized cash).
 */

export const BUSINESS_UNITS = ["STUDIO", "RECORDS", "FILMS", "CORPORATE"] as const;
export type BusinessUnit = (typeof BUSINESS_UNITS)[number];
export const BUSINESS_UNIT_SOURCES = ["RULE", "OWNER_DECISION", "HISTORICAL_APPROVED"] as const;
export type BusinessUnitSource = (typeof BUSINESS_UNIT_SOURCES)[number];

export const BUSINESS_UNIT_HE: Readonly<Record<BusinessUnit, string>> = { STUDIO: "Studio", RECORDS: "Records", FILMS: "Films", CORPORATE: "Corporate" };
export const BUSINESS_UNIT_SOURCE_HE: Readonly<Record<BusinessUnitSource, string>> = { RULE: "לפי כלל", OWNER_DECISION: "החלטת בעלים", HISTORICAL_APPROVED: "יישור היסטורי מאושר" };
export const UNCLASSIFIED_HE = "דורש סיווג";

export const isBusinessUnit = (v: unknown): v is BusinessUnit => typeof v === "string" && (BUSINESS_UNITS as readonly string[]).includes(v);
export const isBusinessUnitSource = (v: unknown): v is BusinessUnitSource => typeof v === "string" && (BUSINESS_UNIT_SOURCES as readonly string[]).includes(v);

/** Who creates the row. MANUAL writers must end with a unit (the person chooses); automatic writers may leave NULL. */
export type UnitWriter =
  | "FINANCE_MANUAL" | "SUNNY"                                   // a person / the Owner through Sunny
  | "SHOW_SYNC" | "MIX" | "VICTOR" | "CLIP_PROMOTE" | "RF_PAYMENT" | "PROMOTION" | "SPLIT"
  | "ARTIST_PAYMENT";                                             // a real payment to a Records roster artist (net model)
export const MANUAL_UNIT_WRITERS: readonly UnitWriter[] = ["FINANCE_MANUAL", "SUNNY"];

export const MIX_MASTER_CATEGORY = "מיקס / מאסטר";
const CLIP_SCOPE = "קליפ";
const SESSION_SCOPE = "סשן";

export interface UnitInput {
  writer: UnitWriter;
  type: string;                                 // income / expense
  category?: string | null;
  expenseScope?: string | null;
  /** the row belongs to a show: whether its artist is a Records roster artist (false = collab / not on the roster) */
  show?: { artistIsRecords: boolean } | null;
  project?: {
    businessType: string | null;                // לקוח / לייבל (stored)
    hasExternalClipProduction?: boolean;        // a Red Films production for this project with client_source "לקוח חיצוני"
    ownerDecidedUnits?: readonly BusinessUnit[]; // units the Owner decided on OTHER rows of this project (guard only)
  } | null;
  ownerChoice?: string | null;
}
export interface UnitDecision { unit: BusinessUnit | null; source: BusinessUnitSource | null; reasonHe: string }

const rule = (unit: BusinessUnit, reasonHe: string): UnitDecision => ({ unit, source: "RULE", reasonHe });
const none = (reasonHe: string): UnitDecision => ({ unit: null, source: null, reasonHe: `${UNCLASSIFIED_HE}: ${reasonHe}` });

export function inferBusinessUnit(i: UnitInput): UnitDecision {
  // 1. an explicit Owner choice
  if (i.ownerChoice != null && i.ownerChoice !== "") {
    if (!isBusinessUnit(i.ownerChoice)) return none("יחידה לא מוכרת");
    return { unit: i.ownerChoice, source: "OWNER_DECISION", reasonHe: "בחירה מפורשת של הבעלים" };
  }
  // 2. the writer's own nature (audio capability / Victor = Studio, Owner decisions 2–4)
  if (i.writer === "VICTOR") return rule("STUDIO", "משכורת Victor — משאב Studio");
  // the net settlement model (Owner 2026-09-28): a real payment to a Records roster artist is Records money
  if (i.writer === "ARTIST_PAYMENT") return rule("RECORDS", "תשלום אמיתי לאמן Records (התחשבנות)");
  if (i.writer === "MIX" || (i.type === "expense" && i.category === MIX_MASTER_CATEGORY)) {
    const bt = i.project?.businessType ?? null;
    if (bt === "לייבל") return rule("RECORDS", "מיקס / מאסטר של פרויקט Records — 100% Records, 0% אמן");
    if (bt === "לקוח") return rule("STUDIO", "מיקס / מאסטר של פרויקט לקוח Studio");
    return none("עלות מיקס / מאסטר בלי פרויקט עם סוג עסקי — לא יודעים של איזה עסק");
  }
  // 3. a show row
  if (i.show) return i.show.artistIsRecords ? rule("RECORDS", "הופעה של אמן Records") : none("הופעה של שת״פ או של אמן שאינו ברוסטר Records");
  // 4. the approved transaction + project rules
  const p = i.project;
  if (!p) return none("אין הופעה, פרויקט או כלל ודאי לתנועה");
  let d: UnitDecision;
  if (p.businessType === "לייבל") d = rule("RECORDS", "כסף של פרויקט Records (לייבל)");
  else if (p.businessType === "לקוח") {
    const clip = i.expenseScope === CLIP_SCOPE;
    if (clip) {
      if (!p.hasExternalClipProduction) return none("כסף קליפ בפרויקט לקוח בלי הפקת Red Films ללקוח חיצוני");
      d = rule("FILMS", "קליפ ללקוח חיצוני (הפקת Red Films 'לקוח חיצוני')");
    } else if (i.type === "income") d = rule("STUDIO", "הכנסה מלקוח על שיר / אודיו");
    else if (i.expenseScope === SESSION_SCOPE) d = rule("STUDIO", "עלות סשן בפרויקט לקוח");
    else return none("הוצאה בפרויקט לקוח בלי כלל ודאי");
  } else return none("לפרויקט אין סוג עסקי שמור");
  // the guard: never guess against a unit the Owner already decided in this project
  const decided = p.ownerDecidedUnits ?? [];
  if (decided.length && !decided.includes(d.unit!)) return none(`הכלל נותן ${BUSINESS_UNIT_HE[d.unit!]}, אבל בפרויקט הזה כבר הוחלט ${[...new Set(decided)].map((u) => BUSINESS_UNIT_HE[u]).join(" / ")}`);
  return d;
}

/** An automatic writer may re-derive a row's unit only when nobody decided it (RULE or unclassified). */
export function mayRecomputeUnit(source: string | null | undefined): boolean {
  return source == null || source === "" || source === "RULE";
}

/** The DB columns for a decision (NULL unit ⇒ NULL source — the table's CHECK). */
export function unitColumns(d: UnitDecision): { business_unit: BusinessUnit | null; business_unit_source: BusinessUnitSource | null } {
  return d.unit ? { business_unit: d.unit, business_unit_source: d.source ?? "RULE" } : { business_unit: null, business_unit_source: null };
}

/** An unclassified row = no unit. The UI badge / Sunny signal / Records view all use this ONE check. */
export function isUnclassifiedUnit(row: { business_unit?: string | null; businessUnit?: string | null }): boolean {
  const u = row.business_unit ?? row.businessUnit ?? null;
  return !isBusinessUnit(u);
}
