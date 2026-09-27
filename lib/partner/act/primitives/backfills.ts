/**
 * SUNNY UNIVERSAL ACTION LAYER — company-wide backfills (BULK, idempotent). The preview lists exactly what would change;
 * the plan fingerprints that exact set, so any change before execution makes the plan STALE (a new preview is needed).
 * Writes go through lib/writes/backfills — the same writers the backfill routes use. Paths are never plan values
 * (the folder freeze previews project names + a count only).
 */
import { refuse, type Fields, type PrimitiveMeta, type PrimitiveSpec, type ResolvedTarget, type WriterDeps } from "./core";

export interface BackfillFamilyWriters {
  startDatePlan(): Promise<{ rows: Array<{ projectId: string; name: string; date: string }>; withoutSessions: number }>;
  applyStartDatesNow(): Promise<{ updated: number; failed: number }>;
  missingArtistClients(): Promise<{ all: number; missing: string[] }>;
  createMissingArtistClients(): Promise<number>;
  folderFreezeCandidates(): Promise<Array<{ id: string; name: string }>>;
  applyFolderFreezeNow(): Promise<{ applied: number; failed: number }>;
}
const meta = (domain: string, he: string, en: string, writer: string, o: Partial<PrimitiveMeta> = {}): PrimitiveMeta =>
  ({ domain, he, en, args: [], fields: ["pending", "set"], effects: [], riskClass: "BULK", reversible: "NO", writer, compensation: null, ...o });
const digest = (x: unknown) => { const t = JSON.stringify(x); let h = 5381; for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0; return (h >>> 0).toString(16); };
const sys = (id: string, label: string, fields: Fields): ResolvedTarget => ({ key: `system:${id}`, id, label, fields });
const list = (xs: string[], n = 20) => `${xs.slice(0, n).join("; ")}${xs.length > n ? ` … ועוד ${xs.length - n}` : ""}`;

async function startFields(d: WriterDeps): Promise<Fields> { const p = await d.startDatePlan(); return { pending: p.rows.length, set: digest(p.rows), preview: list(p.rows.map((r) => `${r.name} → ${r.date}`)), withoutSessions: p.withoutSessions }; }
async function clientFields(d: WriterDeps): Promise<Fields> { const m = await d.missingArtistClients(); return { pending: m.missing.length, set: digest(m.missing), preview: list(m.missing, 40) }; }
async function folderFields(d: WriterDeps): Promise<Fields> { const c = await d.folderFreezeCandidates(); return { pending: c.length, set: digest(c.map((x) => x.id)), preview: list(c.map((x) => x.name)) }; }

export const BACKFILL_PRIMITIVES: readonly PrimitiveSpec[] = [
  {
    actionId: "BACKFILL_PROJECT_START_DATES", kinds: ["system"],
    meta: meta("PROJECT", "השלמת תאריכי התחלה לפרויקטים (מהסשן הראשון)", "For every project without a start date, set it to its earliest session's date (the backfill route's rule; never overwrites)", "startDatePlan + applyStartDates (lib/writes/backfills)", { fields: ["pending", "set", "preview", "withoutSessions"] }),
    async resolve(d) { return sys("start-dates", "תאריכי התחלה", await startFields(d)); },
    read: (d) => startFields(d),
    plan: (_a, cur) => (Number(cur.pending) > 0 ? { ok: true, after: { pending: 0 } } : refuse("NO_CHANGE_NEEDED", "אין פרויקט בלי תאריך התחלה שיש לו סשן")),
    async apply(d) { const r = await d.applyStartDatesNow(); return { receipt: `עודכנו ${r.updated}${r.failed ? `, נכשלו ${r.failed}` : ""}` }; },
    async verify(d) { return Number((await startFields(d)).pending) === 0; },
    requiredValues: () => ["עדכון גורף"],
    warnings: (c) => [`${c.pending} פרויקטים יקבלו תאריך התחלה: ${c.preview}`, `${c.withoutSessions} פרויקטים בלי סשנים נשארים בלי תאריך`],
    disclosuresHe: ["רק פרויקט שעדיין אין לו תאריך התחלה — ערך קיים לא נדרס", "לא נשלח כלום"],
  },
  {
    actionId: "CREATE_MISSING_ARTIST_CLIENTS", kinds: ["system"],
    meta: meta("CLIENT", "יצירת כרטיסי לקוח חסרים לכל אמן שמופיע בפרויקטים", "Create the missing client records (type אמן) for every artist name found on projects — the sync-artists backfill (exact names; existing names are never duplicated)", "missingArtistClients + createArtistClients (lib/writes/backfills)", { fields: ["pending", "set", "preview"] }),
    async resolve(d) { return sys("artist-clients", "לקוחות אמנים חסרים", await clientFields(d)); },
    read: (d) => clientFields(d),
    plan: (_a, cur) => (Number(cur.pending) > 0 ? { ok: true, after: { pending: 0 } } : refuse("NO_CHANGE_NEEDED", "לכל האמנים בפרויקטים כבר יש כרטיס לקוח")),
    async apply(d) { return { receipt: `נוצרו ${await d.createMissingArtistClients()}` }; },
    async verify(d) { return Number((await clientFields(d)).pending) === 0; },
    requiredValues: () => ["עדכון גורף"],
    warnings: (c) => [`ייווצרו ${c.pending} כרטיסי לקוח: ${c.preview}`, "שם שונה במעט (רווח / אותיות) ייצור כרטיס נפרד — השמות נלקחים בדיוק כפי שהם בפרויקטים"],
    disclosuresHe: ["סוג 'אמן', סטטוס 'חדש', בלי טלפון / מייל", "לא נשלח כלום"],
  },
  {
    actionId: "FREEZE_PROJECT_FOLDERS", kinds: ["system"],
    meta: meta("FILES", "קיבוע תיקיית הפרויקט לכל פרויקט שעוד לא קובעה", "Freeze each not-yet-frozen project's canonical storage folder (so a rename never moves / creates a folder) — the backfill's freeze-once rule; storage itself is untouched", "folderFreezePlan + applyFolderFreeze (lib/writes/backfills)", { fields: ["pending", "set", "preview"] }),
    async resolve(d) { return sys("project-folders", "קיבוע תיקיות פרויקטים", await folderFields(d)); },
    read: (d) => folderFields(d),
    plan: (_a, cur) => (Number(cur.pending) > 0 ? { ok: true, after: { pending: 0 } } : refuse("NO_CHANGE_NEEDED", "כל הפרויקטים כבר מקובעים")),
    async apply(d) { const r = await d.applyFolderFreezeNow(); return { receipt: `קובעו ${r.applied}${r.failed ? `, נכשלו ${r.failed}` : ""}` }; },
    async verify(d) { return Number((await folderFields(d)).pending) === 0; },
    requiredValues: () => ["עדכון גורף"],
    warnings: (c) => [`${c.pending} פרויקטים יקובעו לתיקייה הנוכחית שלהם: ${c.preview}`],
    disclosuresHe: ["רק פרויקט שעוד לא קובע — ערך קיים לא נדרס", "שום תיקייה או קובץ לא נוצרים / זזים / נמחקים באחסון"],
  },
];
