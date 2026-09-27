/**
 * SUNNY UNIVERSAL ACTION LAYER — LINK FIELDS (Owner decision 2026-09-27). Sunny stores a URL the Boss gives her ONLY in a
 * Redbloods field that is meant for a link, through a typed `url` argument (http(s), no user / password, no credential
 * parameter, no token shape — lib/partner/act/persist urlProblem). The preview shows the exact URL and the exact field;
 * the old value is shown only as a fingerprint (link#…) — a stored link is never read back to Sunny. Nothing is fetched,
 * opened or executed because a link was stored. Writes go through the same shared writers the screens use.
 */
import type { ArgSpec } from "../types";
import { finishPlan, parseKey, refuse, text, type Fields, type PlanRefusal, type PrimitiveMeta, type PrimitiveSpec, type ResolvedTarget, type WriterDeps } from "./core";
import { isSafeUrl } from "../persist";

export interface LinkFamilyWriters {
  productionLinks(id: string): Promise<{ title: string; links: Record<string, string | null> } | null>;
  setProductionLinks(id: string, patch: Readonly<Record<string, string | null>>, appendReference: string | null): Promise<void>;
  youtubeVideoId(url: string): string | null;
  videoReferenceCount(productionId: string): Promise<number>;
  addVideoReference(productionId: string, input: { url: string; videoId: string; title: string; notes: string }): Promise<string>;
  socialContentLinks(id: string): Promise<{ title: string; links: Record<string, string | null> } | null>;
  setSocialContentLinks(id: string, patch: Readonly<Record<string, string | null>>): Promise<void>;
  victorReferenceViews(workId: string): Promise<Array<{ id: string; title: string; note: string; link: string | null }> | null>;
  addVictorReference(workId: string, input: { url: string; title: string; note: string }): Promise<string>;
  updateVictorReference(workId: string, refId: string, patch: { url?: string; title?: string; note?: string }): Promise<void>;
  removeVictorReference(workId: string, refId: string): Promise<void>;
  previewIntakeLink(url: string, projectName: string): Promise<{ ok: true; files: Array<{ name: string; category: string; folder: string }>; digest: string } | { ok: false; error: string }>;
  importIntakeLink(projectId: string, url: string, projectName: string, deleteEmptySource: boolean): Promise<{ moved: number; total: number; sourceDeleted: boolean }>;
  readVideoReference(linkId: string): Promise<{ productionId: string; title: string; notes: string; provider: string } | null>;
  updateVideoReference(linkId: string, patch: { title?: string; notes?: string }): Promise<void>;
  deleteVideoReference(linkId: string): Promise<void>;
  briefFileViews(workId: string): Promise<Array<{ ref: string; name: string; segments: string }> | null>;
  removeBriefFile(workId: string, ref: string): Promise<void>;
  setBriefSegments(workId: string, ref: string, segments: ReadonlyArray<{ type: string; start: number; end: number; label?: string }>): Promise<string>;
}
/** field (arg name) → the column it writes. Pinned by the links test to the writers' allowlists. */
export const PRODUCTION_LINK_FIELDS: Readonly<Record<string, string>> = { rawFilesLink: "files_raw_link", editFolderLink: "files_edit_folder", version1Link: "version_1_link", version2Link: "version_2_link", finalVersionLink: "final_version_link" };
/** The social content link args (MAIN's wiring maps them to the content columns — SOCIAL_LINK_COLUMNS in server.ts). */
export const SOCIAL_LINK_FIELDS: readonly string[] = ["assetLink", "storageLink", "postedLink"];

const U = (name: string, noteHe?: string): ArgSpec => ({ name, kind: "url", required: false, ...(noteHe ? { noteHe } : {}) });
const K = (name: string, required = true): ArgSpec => ({ name, kind: "entityKey", required });
const T = (name: string, required = false): ArgSpec => ({ name, kind: "text", required });
const meta = (domain: string, he: string, en: string, args: readonly ArgSpec[], fields: readonly string[], writer: string, o: Partial<PrimitiveMeta> = {}): PrimitiveMeta =>
  ({ domain, he, en, args, fields, effects: ["EXTERNAL_LINK"], riskClass: "SAFE_REVERSIBLE", reversible: "YES", writer, compensation: "a new approved plan restoring the previous link (the Boss re-supplies it)", ...o });
const NEVER = ["הקישור נשמר כמו שהוא — Redbloods לא פותחת אותו, לא מורידה ממנו ולא מריצה אותו", "קישור קודם מוצג רק כטביעה (link#…) — סאני לא קוראת קישורים שמורים"];

/** url args → after values (validated) + `removeLink` (enum of the same field names) → null. */
function linkPatch(a: Readonly<Record<string, unknown>>, names: readonly string[]): Fields | PlanRefusal {
  const after: Fields = {};
  for (const k of names) if (a[k] !== undefined) { if (!isSafeUrl(a[k])) return refuse("BAD_URL", `${k}: קישור לא תקין (http/https, בלי סיסמה / טוקן)`); after[k] = String(a[k]); }
  if (a.removeLink !== undefined) { const f = String(a.removeLink); if (!names.includes(f)) return refuse("BAD_ARGS", "removeLink לא מוכר"); if (f in after) return refuse("BAD_ARGS", "אותו שדה גם נקבע וגם מוסר"); after[f] = null; }
  return after;
}
const toColumns = (after: Fields, map: Readonly<Record<string, string>>) => Object.fromEntries(Object.entries(after).filter(([k]) => map[k]).map(([k, v]) => [map[k], (v as string | null) ?? null]));

async function intakeFields(d: WriterDeps, projectId: string, url: unknown): Promise<Fields | PlanRefusal | null> {
  const p = await d.readProjectMeta(projectId); if (!p) return null;
  if (!isSafeUrl(url)) return refuse("BAD_URL", "צריך קישור לתיקייה (shared link / home link)");
  const s = await d.previewIntakeLink(String(url), p.name);
  if (!s.ok) return refuse("SCAN_FAILED", `לא ניתן לקרוא את התיקייה בקישור: ${s.error}`);
  return { projectName: p.name, files: s.files.length, scan: s.digest, list: s.files.slice(0, 40).map((f) => `${f.folder ? `${f.folder}/` : ""}${f.name} (${f.category})`).join("; "), imported: 0, sourceLink: null };
}
export const LINK_PRIMITIVES: readonly PrimitiveSpec[] = [
  {
    actionId: "IMPORT_DELIVERY_FROM_LINK", kinds: ["project"],
    meta: meta("PROJECT", "קליטת קבצים מתיקייה בקישור אל תיקיית המסירה של הפרויקט", "The intake: read the folder behind a link the Boss gives (a shared / home link in the connected storage), classify its files like the intake modal, move exactly those files into the project's Delivery folder (nothing overwritten) and optionally delete the emptied FINAL DELIVERABLES source", [K("project"), U("sourceLink", "קישור לתיקייה ב-Dropbox (shared link או home link)"), { name: "deleteEmptySource", kind: "boolean", required: false }], ["imported", "sourceLink"], "runIntake scan + move (lib/writes/intake)", { effects: ["FILES", "DELETION"], riskClass: "DESTRUCTIVE", reversible: "PARTIAL", compensation: null }),
    async resolve(d, a) { const k = parseKey(a.project, ["project"]); if (!k) return refuse("BAD_ENTITY", "צריך פרויקט (project:…)"); const f = await intakeFields(d, k.id, a.sourceLink); if (!f) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את הפרויקט"); if ((f as PlanRefusal).ok === false) return f as PlanRefusal; return { key: `project:${k.id}`, id: k.id, label: `קליטה למסירה — ${(f as Fields).projectName}`, fields: f as Fields }; },
    async read(d, id, args) { const f = await intakeFields(d, id, args?.sourceLink); return f && (f as PlanRefusal).ok !== false ? (f as Fields) : null; },
    plan(a, cur) { if (!Number(cur.files)) return refuse("EMPTY", "אין קבצים בתיקייה"); if (a.deleteEmptySource !== undefined && typeof a.deleteEmptySource !== "boolean") return refuse("BAD_ARGS", "deleteEmptySource = true / false"); return { ok: true, after: { imported: Number(cur.files), sourceLink: String(a.sourceLink) } }; },
    async apply(d, id, _after, a) { const p = await d.readProjectMeta(id); if (!p) throw new Error("project not found"); const r = await d.importIntakeLink(id, String(a.sourceLink), p.name, a.deleteEmptySource === true); if (r.moved !== r.total) throw new Error(`moved ${r.moved}/${r.total}`); return { receipt: `הועברו ${r.moved} קבצים${r.sourceDeleted ? "; תיקיית המקור הריקה נמחקה" : ""}` }; },
    async verify() { return true; },
    requiredValues: () => ["קליטה"],
    warnings: (c) => [`${c.files} קבצים יועברו לתיקיית המסירה: ${c.list}`],
    disclosuresHe: ["הקישור נקרא רק כדי לבנות את התצוגה (רשימת קבצים) — אחרי האישור מועברים בדיוק הקבצים שהוצגו; שינוי בתיקייה = תצוגה חדשה", "שום קובץ קיים לא נדרס (שם כפול → שם חדש)", "תיקיית המקור נמחקת רק אם ביקשת, רק אם היא 'FINAL DELIVERABLES' ורק אם נשארה ריקה", "הקישור עצמו לא נשמר באף שדה"],
  },
  {
    actionId: "SET_PRODUCTION_LINKS", kinds: ["rf-production"],
    meta: meta("RF", "קישורים של הפקה (חומרי גלם / תיקיית עריכה / גרסה 1 / גרסה 2 / גרסה סופית / רפרנסים)", "Set, replace or remove the production's link fields (raw files, edit folder, version 1 / 2, final version) and append a reference link to the references box", [K("production"), U("rawFilesLink"), U("editFolderLink"), U("version1Link"), U("version2Link"), U("finalVersionLink"), U("addReferenceLink", "נוסף בשורה חדשה לתיבת הרפרנסים (מה שכבר שם נשאר)"), { name: "removeLink", kind: "enum", required: false, values: Object.keys(PRODUCTION_LINK_FIELDS) }], [...Object.keys(PRODUCTION_LINK_FIELDS), "addReferenceLink"], "updateProduction (lib/writes/redfilms)"),
    async resolve(d, a) { const k = parseKey(a.production, ["rf-production"]); if (!k) return refuse("BAD_ENTITY", "צריך הפקה (rf-production:…)"); const r = await d.productionLinks(k.id); if (!r) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את ההפקה"); return { key: `rf-production:${k.id}`, id: k.id, label: `קישורי ${r.title}`, fields: { ...r.links } }; },
    async read(d, id) { const r = await d.productionLinks(id); return r ? { ...r.links } : null; },
    plan(a, cur) { const p = linkPatch(a, [...Object.keys(PRODUCTION_LINK_FIELDS), "addReferenceLink"]); if (p && (p as PlanRefusal).ok === false) return p as PlanRefusal; return finishPlan(cur, p as Fields); },
    async apply(d, id, after) { await d.setProductionLinks(id, toColumns(after, PRODUCTION_LINK_FIELDS), (after.addReferenceLink as string | undefined) ?? null); },
    disclosuresHe: [...NEVER, "'מאושר' / 'גרסה מאושרת' לא נקבעים מזה (D7 לא הוחלט)"],
  },
  {
    actionId: "ADD_RF_VIDEO_REFERENCE", kinds: ["rf-production"],
    meta: meta("RF", "רפרנס יוטיוב להפקה", "Add a YouTube video reference to a production (the references grid; the screen's YouTube rule — watch / youtu.be / shorts / embed)", [K("production"), U("videoLink"), T("title"), T("notes")], ["videoReferences", "videoLink"], "addVideoReference (lib/writes/redfilms)", { riskClass: "NORMAL_BUSINESS", reversible: "PARTIAL", compensation: "delete the reference in the production page" }),
    async resolve(d, a) { const k = parseKey(a.production, ["rf-production"]); if (!k) return refuse("BAD_ENTITY", "צריך הפקה (rf-production:…)"); const r = await d.productionLinks(k.id); if (!r) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את ההפקה"); return { key: `rf-production:${k.id}`, id: k.id, label: `רפרנסים — ${r.title}`, fields: { videoReferences: await d.videoReferenceCount(k.id), videoLink: null } }; },
    async read(d, id) { return (await d.productionLinks(id)) ? { videoReferences: await d.videoReferenceCount(id), videoLink: null } : null; },
    plan(a, cur) {
      if (!isSafeUrl(a.videoLink)) return refuse("BAD_URL", "צריך קישור יוטיוב תקין");
      for (const k of ["title", "notes"]) if (a[k] !== undefined && text(a[k], 300) === null) return refuse("BAD_TEXT", `${k} לא תקין`);
      return { ok: true, after: { videoReferences: Number(cur.videoReferences) + 1, videoLink: String(a.videoLink) } };
    },
    async apply(d, id, _after, a) { const vid = d.youtubeVideoId(String(a.videoLink)); if (!vid) throw new Error("לינק לא תקין — ודא שזה YouTube"); await d.addVideoReference(id, { url: String(a.videoLink), videoId: vid, title: String(a.title ?? "").trim(), notes: String(a.notes ?? "").trim() }); },
    async verify(d, id, after) { return (await d.videoReferenceCount(id)) === Number(after.videoReferences); },
    disclosuresHe: [...NEVER, "רק קישורי YouTube (כמו במסך); התמונה הממוזערת היא של יוטיוב"],
  },
  {
    actionId: "SET_SOCIAL_CONTENT_LINKS", kinds: ["social-content"],
    meta: meta("SOCIAL", "קישורים של פריט תוכן (נכס / אחסון / הפוסט שפורסם)", "Set, replace or remove a social content item's asset link, storage link or posted-URL (the content editor's link fields)", [K("content"), U("assetLink"), U("storageLink"), U("postedLink"), { name: "removeLink", kind: "enum", required: false, values: SOCIAL_LINK_FIELDS }], SOCIAL_LINK_FIELDS, "updateSocialContent (lib/writes/social)"),
    async resolve(d, a) { const k = parseKey(a.content, ["social-content"]); if (!k) return refuse("BAD_ENTITY", "צריך פריט תוכן (social-content:…)"); const r = await d.socialContentLinks(k.id); if (!r) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את פריט התוכן"); return { key: `social-content:${k.id}`, id: k.id, label: `קישורי ${r.title}`, fields: { ...r.links } }; },
    async read(d, id) { const r = await d.socialContentLinks(id); return r ? { ...r.links } : null; },
    plan(a, cur) { const p = linkPatch(a, SOCIAL_LINK_FIELDS); if ((p as PlanRefusal).ok === false) return p as PlanRefusal; return finishPlan(cur, p as Fields); },
    async apply(d, id, after) { await d.setSocialContentLinks(id, after as Record<string, string | null>); },
    disclosuresHe: [...NEVER, "קישור 'פורסם' הוא רישום — לא מפרסם כלום"],
  },
  {
    actionId: "ADD_VICTOR_REFERENCE", kinds: ["victor-work"],
    meta: meta("VICTOR", "רפרנס לבריף של ויקטור (קישור + כותרת + הערה)", "Add a reference link to a Victor work's brief (the profile page's references)", [K("victorWork"), U("referenceLink"), T("title"), T("note")], ["references", "referenceLink"], "addVictorReference (lib/writes/victor)", { riskClass: "NORMAL_BUSINESS", reversible: "PARTIAL", compensation: "REMOVE_VICTOR_REFERENCE" }),
    async resolve(d, a) { const k = parseKey(a.victorWork, ["victor-work"]); if (!k) return refuse("BAD_ENTITY", "צריך עבודת ויקטור (victor-work:…)"); const r = await d.victorReferenceViews(k.id); if (!r) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את עבודת ויקטור"); return { key: `victor-work:${k.id}`, id: k.id, label: "רפרנסים לויקטור", fields: { references: r.length, referenceLink: null } }; },
    async read(d, id) { const r = await d.victorReferenceViews(id); return r ? { references: r.length, referenceLink: null } : null; },
    plan(a, cur) { if (!isSafeUrl(a.referenceLink)) return refuse("BAD_URL", "קישור לא תקין"); for (const k of ["title", "note"]) if (a[k] !== undefined && text(a[k], 300) === null) return refuse("BAD_TEXT", `${k} לא תקין`); return { ok: true, after: { references: Number(cur.references) + 1, referenceLink: String(a.referenceLink) } }; },
    async apply(d, id, _after, a) { await d.addVictorReference(id, { url: String(a.referenceLink), title: String(a.title ?? "").trim(), note: String(a.note ?? "").trim() }); },
    async verify(d, id, after) { const r = await d.victorReferenceViews(id); return !!r && r.length === Number(after.references); },
    disclosuresHe: [...NEVER, "ויקטור רואה את הרפרנס בבריף; לא נשלח לו Push"],
  },
  {
    actionId: "UPDATE_VICTOR_REFERENCE", kinds: ["victor-reference"],
    meta: meta("VICTOR", "עדכון רפרנס של ויקטור (קישור / כותרת / הערה)", "Update one reference of a Victor work (link, title, note)", [K("victorWork"), T("referenceId", true), U("referenceLink"), T("title"), T("note")], ["referenceLink", "title", "note"], "updateVictorReference (lib/writes/victor)"),
    async resolve(d, a) { return onRef(d, a); }, read: refRead,
    plan(a, cur) { const after: Fields = {}; if (a.referenceLink !== undefined) { if (!isSafeUrl(a.referenceLink)) return refuse("BAD_URL", "קישור לא תקין"); after.referenceLink = String(a.referenceLink); } for (const k of ["title", "note"]) if (a[k] !== undefined) { const t = a[k] === "" ? "" : text(a[k], 300); if (t === null) return refuse("BAD_TEXT", `${k} לא תקין`); after[k] = t.trim(); } return finishPlan(cur, after); },
    async apply(d, id, after) { const { workId, refId } = refSplit(id); await d.updateVictorReference(workId, refId, { ...(after.referenceLink !== undefined ? { url: String(after.referenceLink) } : {}), ...(after.title !== undefined ? { title: String(after.title) } : {}), ...(after.note !== undefined ? { note: String(after.note) } : {}) }); },
    disclosuresHe: NEVER,
  },
  {
    actionId: "REMOVE_VICTOR_REFERENCE", kinds: ["victor-reference"],
    meta: meta("VICTOR", "הסרת רפרנס של ויקטור", "Remove one reference from a Victor work's brief", [K("victorWork"), T("referenceId", true)], ["exists"], "removeVictorReference (lib/writes/victor)", { effects: ["DELETION", "EXTERNAL_LINK"], riskClass: "DESTRUCTIVE", reversible: "NO", compensation: null }),
    async resolve(d, a) { const r = await onRef(d, a); return "ok" in r ? r : { ...r, fields: { ...r.fields, exists: true } }; },
    async read(d, id) { const f = await refRead(d, id); return f ? { ...f, exists: true } : null; },
    plan: () => ({ ok: true, after: { exists: false } }),
    async apply(d, id) { const { workId, refId } = refSplit(id); await d.removeVictorReference(workId, refId); },
    async verify(d, id) { return (await refRead(d, id)) === null; },
    requiredValues: () => ["מחיקה"],
    disclosuresHe: ["רק הרפרנס הזה"],
  },
  {
    actionId: "UPDATE_RF_VIDEO_REFERENCE", kinds: ["rf-video-reference"],
    meta: meta("RF", "עדכון כותרת / הערות של רפרנס וידאו", "Change a production video reference's title or notes (the hardened PATCH: only title / notes; the link itself is never changed)", [K("videoReference"), T("title"), T("notes")], ["title", "notes"], "updateVideoReference (lib/writes/redfilms)", { effects: [] }),
    async resolve(d, a) { const k = parseKey(a.videoReference, ["rf-video-reference"]); if (!k) return refuse("BAD_ENTITY", "צריך רפרנס וידאו (rf-video-reference:…)"); const r = await d.readVideoReference(k.id); if (!r) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את הרפרנס"); return { key: `rf-video-reference:${k.id}`, id: k.id, label: r.title || "רפרנס וידאו", fields: { title: r.title, notes: r.notes } }; },
    async read(d, id) { const r = await d.readVideoReference(id); return r ? { title: r.title, notes: r.notes } : null; },
    plan(a, cur) { const after: Fields = {}; for (const k of ["title", "notes"]) if (a[k] !== undefined) { const t = a[k] === "" ? "" : text(a[k], 300); if (t === null) return refuse("BAD_TEXT", `${k} לא תקין`); after[k] = t.trim(); } return finishPlan(cur, after); },
    async apply(d, id, after) { await d.updateVideoReference(id, { ...(after.title !== undefined ? { title: String(after.title) } : {}), ...(after.notes !== undefined ? { notes: String(after.notes) } : {}) }); },
    disclosuresHe: ["הקישור עצמו לא משתנה (כדי להחליף סרטון: הסרה + הוספה)"],
  },
  {
    actionId: "DELETE_RF_VIDEO_REFERENCE", kinds: ["rf-video-reference"],
    meta: meta("RF", "מחיקת רפרנס וידאו מהפקה", "Delete one video reference of a production (the grid's delete)", [K("videoReference")], ["exists"], "deleteVideoReference (lib/writes/redfilms)", { effects: ["DELETION", "EXTERNAL_LINK"], riskClass: "DESTRUCTIVE", reversible: "NO", compensation: null }),
    async resolve(d, a) { const k = parseKey(a.videoReference, ["rf-video-reference"]); if (!k) return refuse("BAD_ENTITY", "צריך רפרנס וידאו (rf-video-reference:…)"); const r = await d.readVideoReference(k.id); if (!r) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את הרפרנס"); return { key: `rf-video-reference:${k.id}`, id: k.id, label: r.title || "רפרנס וידאו", fields: { exists: true } }; },
    async read(d, id) { return (await d.readVideoReference(id)) ? { exists: true } : null; },
    plan: () => ({ ok: true, after: { exists: false } }),
    async apply(d, id) { await d.deleteVideoReference(id); },
    async verify(d, id) { return (await d.readVideoReference(id)) === null; },
    requiredValues: () => ["מחיקה"],
    disclosuresHe: ["רק הרפרנס הזה; הסרטון ביוטיוב לא נוגע"],
  },
  {
    actionId: "DELETE_VICTOR_BRIEF_FILE", kinds: ["victor-brief"],
    meta: meta("VICTOR", "מחיקת קובץ מהבריף של ויקטור", "Remove one brief file from a Victor work: the entry is dropped and the stored file deleted (the brief's delete)", [K("victorWork"), T("briefRef", true)], ["exists"], "removeBriefFile (lib/writes/victor)", { effects: ["DELETION", "FILES"], riskClass: "DESTRUCTIVE", reversible: "NO", compensation: null }),
    async resolve(d, a) { const r = await onBrief(d, a); return "ok" in r ? r : { ...r, fields: { exists: true } }; },
    async read(d, id) { return (await briefRead(d, id)) ? { exists: true } : null; },
    plan: () => ({ ok: true, after: { exists: false } }),
    async apply(d, id) { const { workId, refId } = refSplit(id); await d.removeBriefFile(workId, refId); },
    async verify(d, id) { return (await briefRead(d, id)) === null; },
    requiredValues: () => ["מחיקה"],
    disclosuresHe: ["הקובץ נמחק מהאחסון וממסך הבריף; ויקטור לא יראה אותו יותר", "לא נשלח Push"],
  },
  {
    actionId: "SET_VICTOR_BRIEF_SEGMENTS", kinds: ["victor-brief"],
    meta: meta("VICTOR", "סימוני מבנה (פתיח / בית / פזמון…) על קובץ בריף של ויקטור", "Set the structure markers of one brief audio file (replaces its markers; the screen's segment editor; sanitized like the route: known types, 40 max)", [K("victorWork"), T("briefRef", true), T("segments", true)], ["segments"], "setBriefSegments (lib/writes/victor)", { effects: [], compensation: "a new approved plan with the previous markers (shown in the preview)" }),
    async resolve(d, a) { return onBrief(d, a); },
    read: briefRead,
    plan(a, cur) { const p = parseSegments(a.segments); if (typeof p === "string") return refuse("BAD_SEGMENTS", p); return finishPlan(cur, { segments: segmentsText(p) }); },
    async apply(d, id, _after, a) { const { workId, refId } = refSplit(id); await d.setBriefSegments(workId, refId, parseSegments(a.segments) as Seg[]); },
    disclosuresHe: ["מחליף את כל הסימונים של הקובץ הזה; ויקטור רואה אותם בבריף", "פורמט: type start-end מופרד ב-; (למשל: intro 0-12.5; chorus1 40-62; custom:Hook 62-70); none = ניקוי"],
  },
];

const SEGMENT_TYPES = ["intro", "verse1", "prechorus", "chorus1", "verse2", "chorus3", "cpart", "bridge", "finalChorus", "outro", "custom"] as const;
type Seg = { type: string; start: number; end: number; label?: string };
/** "intro 0-12.5; chorus1 40-62; custom:Hook 62-70" → markers (the route sanitizes again). "" / "none" = clear all. */
export function parseSegments(v: unknown): Seg[] | string {
  if (typeof v !== "string" || v.length > 2000) return "segments = טקסט (type start-end; …)";
  const t = v.trim(); if (!t || t === "none") return [];
  const out: Seg[] = [];
  for (const part of t.split(";").map((x) => x.trim()).filter(Boolean)) {
    const m = /^([A-Za-z0-9]+)(?::([^\s].{0,39}?))?\s+(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/.exec(part);
    if (!m) return `לא הבנתי "${part}" — פורמט: type start-end`;
    const type = m[1]; if (!(SEGMENT_TYPES as readonly string[]).includes(type)) return `סוג לא מוכר "${type}" — ${SEGMENT_TYPES.join(" / ")}`;
    const start = Number(m[3]), end = Number(m[4]); if (end < start) return `"${part}": הסוף לפני ההתחלה`;
    out.push({ type, start, end, ...(type === "custom" && m[2] ? { label: m[2].trim() } : {}) });
    if (out.length > 40) return "עד 40 סימונים";
  }
  return out;
}
const segmentsText = (s: readonly Seg[]) => s.map((x) => `${x.type}${x.label ? `:${x.label}` : ""} ${x.start}-${x.end}`).join("; ");
export { segmentsText };
async function onBrief(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> {
  const k = parseKey(a.victorWork, ["victor-work"]); if (!k) return refuse("BAD_ENTITY", "צריך עבודת ויקטור (victor-work:…)");
  const files = await d.briefFileViews(k.id); if (!files) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את עבודת ויקטור");
  const f = files.find((x) => x.ref === a.briefRef);
  if (!f) return refuse("ENTITY_NOT_FOUND", `לא מצאתי את קובץ הבריף — הקבצים (briefRef — שם): ${files.map((x) => `${x.ref} — ${x.name}`).join("; ") || "אין"}`);
  return { key: `victor-brief:${k.id}.${f.ref}`, id: `${k.id}.${f.ref}`, label: f.name, fields: { segments: f.segments } };
}
async function briefRead(d: WriterDeps, id: string): Promise<Fields | null> { const { workId, refId } = refSplit(id); const f = (await d.briefFileViews(workId))?.find((x) => x.ref === refId); return f ? { segments: f.segments } : null; }

const refSplit = (id: string) => { const i = id.indexOf("."); return { workId: id.slice(0, i), refId: id.slice(i + 1) }; };
async function onRef(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> {
  const k = parseKey(a.victorWork, ["victor-work"]); if (!k) return refuse("BAD_ENTITY", "צריך עבודת ויקטור (victor-work:…)");
  const refs = await d.victorReferenceViews(k.id); if (!refs) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את עבודת ויקטור");
  const r = refs.find((x) => x.id === a.referenceId);
  if (!r) return refuse("ENTITY_NOT_FOUND", `לא מצאתי את הרפרנס — הרפרנסים (referenceId — כותרת): ${refs.map((x) => `${x.id} — ${x.title || "—"}`).join("; ") || "אין"}`);
  return { key: `victor-reference:${k.id}.${r.id}`, id: `${k.id}.${r.id}`, label: r.title || "רפרנס", fields: { referenceLink: r.link, title: r.title, note: r.note } };
}
async function refRead(d: WriterDeps, id: string): Promise<Fields | null> { const { workId, refId } = refSplit(id); const r = (await d.victorReferenceViews(workId))?.find((x) => x.id === refId); return r ? { referenceLink: r.link, title: r.title, note: r.note } : null; }
