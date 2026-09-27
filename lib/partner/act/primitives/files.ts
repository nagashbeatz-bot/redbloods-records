/**
 * SUNNY UNIVERSAL ACTION LAYER — project files that ALREADY exist, and the work materials text. A file is addressed by
 * project + fileRef (a server-computed handle of its stored path — the path never reaches a plan and is never accepted
 * from Sunny). A wrong / missing fileRef is refused WITH the project's files (fileRef — name). Writes go through
 * lib/writes/files — the writers the project screens and the portal link use. Uploading new bytes = the file channel.
 */
import type { ArgSpec } from "../types";
import { finishPlan, parseKey, refuse, text, type Fields, type PlanRefusal, type PrimitiveMeta, type PrimitiveSpec, type ResolvedTarget, type WriterDeps } from "./core";

export interface ProjectFileView { ref: string; name: string; category: string | null; versionLabel: string | null; trackId: string | null }
export interface FilesFamilyWriters {
  projectFiles(projectId: string): Promise<ProjectFileView[] | null>;
  deleteProjectFile(projectId: string, fileRef: string): Promise<{ unlinked: number }>;
  readWorkMaterials(projectId: string): Promise<{ bpm?: string; key?: string; instructions?: string } | null>;
  setWorkMaterials(projectId: string, patch: { bpm?: string; key?: string; instructions?: string }): Promise<void>;
  portalOfProject(projectId: string): Promise<{ artistName: string; slug: string } | null>;
  shareProjectFileToPortal(projectId: string, fileRef: string, sketchId: string, newTitle: string): Promise<{ sketchId: string }>;
}
const REF = /^[0-9a-f]{24}$/;
const K = (name: string): ArgSpec => ({ name, kind: "entityKey", required: true });
const T = (name: string, required = false): ArgSpec => ({ name, kind: "text", required });
const meta = (he: string, en: string, args: readonly ArgSpec[], fields: readonly string[], writer: string, o: Partial<PrimitiveMeta>): PrimitiveMeta =>
  ({ domain: "PROJECT", he, en, args, fields, effects: [], riskClass: "SAFE_REVERSIBLE", reversible: "YES", writer, compensation: "a new approved plan restoring the previous value shown in the preview", ...o });

async function onFile(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> {
  const k = parseKey(a.project, ["project"]); if (!k) return refuse("BAD_ENTITY", "צריך פרויקט (project:…)");
  const p = await d.readProjectMeta(k.id); if (!p) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את הפרויקט");
  const files = (await d.projectFiles(k.id)) ?? [];
  const choices = () => (files.length ? ` — קבצי הפרויקט (fileRef — שם): ${files.slice(0, 40).map((f) => `${f.ref} — ${f.name.slice(0, 60)}${f.category ? ` (${f.category})` : ""}`).join("; ")}` : " — לפרויקט אין קבצים");
  if (typeof a.fileRef !== "string" || !REF.test(a.fileRef)) return refuse("BAD_ENTITY", `fileRef לא תקין${choices()}`);
  const f = files.find((x) => x.ref === a.fileRef); if (!f) return refuse("ENTITY_NOT_FOUND", `לא מצאתי את הקובץ בפרויקט${choices()}`);
  return { key: `project-asset:${k.id}.${f.ref}`, id: `${k.id}.${f.ref}`, label: `${p.name} · ${f.name}`, fields: { projectName: p.name, fileName: f.name, category: f.category, versionLabel: f.versionLabel, exists: true } };
}
const split = (id: string) => { const i = id.indexOf("."); return { projectId: id.slice(0, i), ref: id.slice(i + 1) }; };
async function fileRead(d: WriterDeps, id: string): Promise<Fields | null> {
  const { projectId, ref } = split(id);
  const p = await d.readProjectMeta(projectId); if (!p) return null;
  const f = ((await d.projectFiles(projectId)) ?? []).find((x) => x.ref === ref);
  return f ? { projectName: p.name, fileName: f.name, category: f.category, versionLabel: f.versionLabel, exists: true } : null;
}
const wmFields = async (d: WriterDeps, id: string): Promise<Fields | null> => { const w = await d.readWorkMaterials(id); return w ? { bpm: w.bpm ?? "", key: w.key ?? "", instructions: w.instructions ?? "" } : null; };

export const FILES_PRIMITIVES: readonly PrimitiveSpec[] = [
  {
    actionId: "DELETE_PROJECT_FILE", kinds: ["project-asset"],
    meta: meta("מחיקת קובץ מהפרויקט (אחסון + רשימה)", "Delete one of the project's own files: the artist-library reference is removed first, then the stored file, then the record (the drawer's delete, path-checked)", [K("project"), T("fileRef", true)], ["exists"], "deleteProjectFileByPath (lib/writes/files)", { effects: ["FILES", "DELETION", "CASCADE"], riskClass: "DESTRUCTIVE", reversible: "NO", compensation: null }),
    resolve: onFile, read: fileRead,
    plan: () => ({ ok: true, after: { exists: false } }),
    async apply(d, id) { const { projectId, ref } = split(id); const r = await d.deleteProjectFile(projectId, ref); return { receipt: r.unlinked ? `הוסרו ${r.unlinked} הפניות מספריית האמן` : "נמחק" }; },
    async verify(d, id) { return (await fileRead(d, id)) === null; },
    requiredValues: () => ["מחיקה"],
    warnings: (c) => [`הקובץ "${c.fileName}" נמחק מהאחסון לצמיתות`, "אם הקובץ מקושר לספריית אמן (המוזיקה שלי) — ההפניה מוסרת קודם"],
    disclosuresHe: ["רק קובץ שהפרויקט עצמו מחזיק — נתיב אחר לעולם לא", "לא נשלח כלום"],
  },
  {
    actionId: "UPDATE_WORK_MATERIALS", kinds: ["project"],
    meta: meta("עדכון חומרי עבודה לאיש הסאונד (BPM / סולם / הוראות)", "Update the work materials text sent to the sound engineer (BPM, key, instructions) — the engineer's work-materials screen", [K("project"), T("bpm"), T("key"), T("instructions")], ["bpm", "key", "instructions"], "updateProjectWorkMaterials (lib/projects-store via lib/writes/files)", {}),
    async resolve(d, a) { const k = parseKey(a.project, ["project"]); if (!k) return refuse("BAD_ENTITY", "צריך פרויקט (project:…)"); const p = await d.readProjectMeta(k.id); if (!p) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את הפרויקט"); return { key: `project:${k.id}`, id: k.id, label: `חומרי עבודה — ${p.name}`, fields: (await wmFields(d, k.id))! }; },
    read: wmFields,
    plan(a, cur) {
      const after: Fields = {};
      for (const k of ["bpm", "key"]) if (a[k] !== undefined) { const t = a[k] === "" ? "" : text(a[k], 40); if (t === null) return refuse("BAD_TEXT", `${k} לא תקין`); after[k] = t.trim(); }
      if (a.instructions !== undefined) { const t = a.instructions === "" ? "" : text(a.instructions, 4000); if (t === null) return refuse("BAD_TEXT", "הוראות לא תקינות"); after.instructions = t; }
      return finishPlan(cur, after);
    },
    apply: (d, id, after) => d.setWorkMaterials(id, after as { bpm?: string; key?: string; instructions?: string }),
    disclosuresHe: ["איש הסאונד רואה את הטקסט המעודכן במסך חומרי העבודה", "לא נשלח Push / מייל; קבצים לא משתנים"],
  },
  {
    actionId: "SHARE_FILE_TO_PORTAL", kinds: ["project-asset"],
    meta: meta("הוספת קובץ מהפרויקט ל'המוזיקה שלי' של האמן (בהפניה)", "Attach an existing project file to the portal artist's 'My music' by reference (new version of a sketch, or a new sketch) — only for the project's own primary artist, only link-enabled portals", [K("project"), T("fileRef", true), T("sketchId"), T("newTitle")], ["shared"], "linkProjectFileToPortal (lib/writes/files)", { effects: ["FILES"], riskClass: "FILE_MUTATION", reversible: "PARTIAL", compensation: "ARCHIVE_SKETCH / a new version" }),
    async resolve(d, a) {
      const f = await onFile(d, a); if ("ok" in f) return f;
      const { projectId } = split(f.id);
      const portal = await d.portalOfProject(projectId); if (!portal) return refuse("NOT_LINKABLE", "לאמן הראשי של הפרויקט אין ספריית מוזיקה מקושרת (רק אבי / שליו / נגש)");
      if (a.sketchId !== undefined) { const c = await d.listSketchChoices(portal.slug); if (!c.some((x) => x.id === a.sketchId)) return refuse("ENTITY_NOT_FOUND", `לא מצאתי את הסקיצה — הסקיצות של ${portal.artistName}: ${c.slice(0, 40).map((x) => `${x.id} — ${x.title.slice(0, 60)}`).join("; ")}`); }
      return { ...f, fields: { ...f.fields, artistName: portal.artistName, shared: false } };
    },
    async read(d, id) { const f = await fileRead(d, id); if (!f) return null; const portal = await d.portalOfProject(split(id).projectId); return portal ? { ...f, artistName: portal.artistName, shared: false } : null; },
    plan(a) { if (a.sketchId !== undefined && a.newTitle !== undefined) return refuse("BAD_ARGS", "או סקיצה קיימת או שם חדש — לא שניהם"); if (a.newTitle !== undefined && text(a.newTitle, 120) === null) return refuse("BAD_TEXT", "שם לא תקין"); return { ok: true, after: { shared: true } }; },
    async apply(d, id, _after, a) { const { projectId, ref } = split(id); const r = await d.shareProjectFileToPortal(projectId, ref, String(a.sketchId ?? ""), String(a.newTitle ?? "")); return { receipt: `sketch ${r.sketchId}` }; },
    async verify() { return true; },
    requiredValues: (_a, _after) => ["המוזיקה שלי"],
    warnings: (c) => [`הקובץ יופיע ל${c.artistName} ב'המוזיקה שלי' (אותו קובץ, לא עותק)`],
    disclosuresHe: ["לא נשלח Push — התראה לאמן היא פעולה נפרדת (NOTIFY_SKETCH)", "אם לא נבחרה סקיצה — נוצרת סקיצה חדשה בשם הפרויקט"],
  },
];
