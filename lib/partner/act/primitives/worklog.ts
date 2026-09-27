/**
 * SUNNY UNIVERSAL ACTION LAYER — project send log ("who waits for whom") and album tracks. Writes go through
 * lib/writes/worklog — the writers the drawer / album screens use. The send-log vocabularies are UI-only in the app
 * (reported rule PROJECT_ACTION_VOCAB_UI_ONLY); Sunny enforces the UI's lists. The link (URL) field is never written
 * through Sunny (plans never persist URLs). Deleting an entry runs the drawer's cascade on the server (hardened).
 */
import type { ArgSpec } from "../types";
import { finishPlan, parseKey, realYmd, refuse, text, type Fields, type PlanRefusal, type PrimitiveMeta, type PrimitiveSpec, type ResolvedTarget, type WriterDeps } from "./core";
import { ALBUM_TRACK_STATUSES } from "@/lib/types";

type Row = Record<string, unknown>;
export interface WorklogFamilyWriters {
  readSendLogEntry(id: string): Promise<Row | null>;
  createSendLogEntry(body: Record<string, unknown>): Promise<string>;
  updateSendLogEntry(id: string, body: Record<string, unknown>): Promise<void>;
  deleteSendLogEntryWithCascade(id: string): Promise<{ cascade: string }>;
  readAlbumTrack(id: string): Promise<Row | null>;
  albumTrackOrder(projectId: string): Promise<Array<{ id: string; track_number: number }>>;
  createAlbumTrack(body: Record<string, unknown>): Promise<string>;
  updateAlbumTrack(id: string, body: Record<string, unknown>): Promise<void>;
  deleteAlbumTrack(id: string): Promise<void>;
  renumberAlbumTracks(tracks: Array<{ id: string; track_number: number }>): Promise<void>;
  readAlbumPrevInfo(projectId: string): Promise<{ rows: PrevRow[]; note: string }>;
  saveAlbumPrevInfo(projectId: string, value: { rows: PrevRow[]; note: string }): Promise<void>;
}
type PrevRow = { id: string; name: string; costWithoutMix: number; mixMaster: number; paid: number };
/** A short digest of the whole table — any change to any row makes a plan stale. */
const digest = (x: unknown) => { const t = JSON.stringify(x); let h = 5381; for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0; return (h >>> 0).toString(16); };
async function prevFields(d: WriterDeps, projectId: string, rowId: string | null): Promise<Fields | null> {
  if (!(await d.readProjectMeta(projectId))) return null;
  const v = await d.readAlbumPrevInfo(projectId);
  const r = rowId ? v.rows.find((x) => x.id === rowId) : undefined;
  return { table: digest(v.rows), rowCount: v.rows.length, rowExists: !!r, name: r?.name ?? "", costWithoutMix: r?.costWithoutMix ?? 0, mixMaster: r?.mixMaster ?? 0, paid: r?.paid ?? 0, note: v.note };
}
const ROW_ID = /^[A-Za-z0-9-]{4,64}$/;
async function onPrev(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> {
  const k = parseKey(a.project, ["project"]); if (!k) return refuse("BAD_ENTITY", "צריך פרויקט (project:…)");
  if (a.rowId !== undefined && (typeof a.rowId !== "string" || !ROW_ID.test(a.rowId))) return refuse("BAD_ENTITY", "מזהה שורה לא תקין");
  const rowId = (a.rowId as string | undefined) ?? null;
  const f = await prevFields(d, k.id, rowId); if (!f) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את הפרויקט");
  if (rowId && !f.rowExists) { const v = await d.readAlbumPrevInfo(k.id); return refuse("ENTITY_NOT_FOUND", `לא מצאתי את השורה — השורות (rowId — שיר): ${v.rows.slice(0, 40).map((r) => `${r.id} — ${r.name.slice(0, 40)}`).join("; ") || "אין"}`); }
  return { key: `album-prev:${k.id}.${rowId ?? "table"}`, id: `${k.id}.${rowId ?? "table"}`, label: "מידע קודם (מאנדיי)", fields: f };
}
const prevSplit = (id: string) => { const i = id.indexOf("."); const r = id.slice(i + 1); return { projectId: id.slice(0, i), rowId: r && r !== "table" ? r : null }; };
const prevRead = (d: WriterDeps, id: string) => { const { projectId, rowId } = prevSplit(id); return prevFields(d, projectId, rowId); };

/** Pinned to components/ui/ProjectDrawer.tsx label maps by the family test. */
export const SEND_ACTION_TYPES: readonly string[] = ["sent", "received", "notes", "approved", "followup", "other"];
export const SEND_CONTENT_TYPES: readonly string[] = ["mix", "master", "production", "stems", "clip", "files", "references", "other"];
export const SEND_RECIPIENT_ROLES: readonly string[] = ["artist", "client", "sound_engineer", "external_producer", "video_editor", "photographer", "other"];
export const SEND_STATUSES: readonly string[] = ["sent", "pending_feedback", "got_notes", "pending_version", "approved", "closed", "cancelled"];
export const MIX_MASTER_STATUSES: readonly string[] = ["לא התחיל", "בתהליך", "הושלם"];
export const TRACK_STATUSES: readonly string[] = ALBUM_TRACK_STATUSES as readonly string[];
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const K = (name: string, required = true): ArgSpec => ({ name, kind: "entityKey", required });
const T = (name: string, required = false): ArgSpec => ({ name, kind: "text", required });
const E = (name: string, values: readonly string[], required = false): ArgSpec => ({ name, kind: "enum", required, values });
const D = (name: string, required = false): ArgSpec => ({ name, kind: "ymd", required });
const meta = (he: string, en: string, args: readonly ArgSpec[], fields: readonly string[], writer: string, o: Partial<PrimitiveMeta>): PrimitiveMeta =>
  ({ domain: "PROJECT", he, en, args, fields, effects: [], riskClass: "SAFE_REVERSIBLE", reversible: "YES", writer, compensation: "a new approved plan restoring the previous value shown in the preview", ...o });

const logFields = async (d: WriterDeps, id: string): Promise<Fields | null> => { const r = await d.readSendLogEntry(id); return r ? { projectId: String(r.project_id ?? ""), actionType: String(r.action_type ?? ""), contentType: (r.content_type as string | null) ?? null, versionLabel: (r.version_label as string | null) ?? null, recipientRole: (r.recipient_role as string | null) ?? null, recipientName: (r.recipient_name as string | null) ?? null, status: String(r.status ?? ""), actionDate: (r.action_date as string | null) ?? null, followupDate: (r.followup_date as string | null) ?? null, notes: (r.notes as string | null) ?? null, linkedWork: !!r.linked_work_id } : null; };
async function onLog(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> {
  const k = parseKey(a.sendLogEntry, ["send-log"]); if (!k) return refuse("BAD_ENTITY", "צריך רשומת שליחה (send-log:…)");
  const f = await logFields(d, k.id); if (!f) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את הרשומה");
  return { key: `send-log:${k.id}`, id: k.id, label: `${f.actionType} → ${f.recipientName ?? f.recipientRole ?? ""} (${f.status})`, fields: f };
}
const trackFields = async (d: WriterDeps, id: string): Promise<Fields | null> => { const r = await d.readAlbumTrack(id); return r ? { projectId: String(r.project_id ?? ""), trackNumber: Number(r.track_number) || 0, title: String(r.title ?? ""), status: String(r.status ?? ""), mixStatus: String(r.mix_status ?? ""), masterStatus: String(r.master_status ?? ""), notes: (r.notes as string | null) ?? null } : null; };
async function onTrack(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> {
  const k = parseKey(a.albumTrack, ["album-track"]); if (!k) return refuse("BAD_ENTITY", "צריך שיר באלבום (album-track:…)");
  const f = await trackFields(d, k.id); if (!f) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את השיר");
  return { key: `album-track:${k.id}`, id: k.id, label: `${f.trackNumber}. ${f.title}`, fields: f };
}
const LOG_ARGS: readonly ArgSpec[] = [E("contentType", SEND_CONTENT_TYPES), T("versionLabel"), E("recipientRole", SEND_RECIPIENT_ROLES), T("recipientName"), T("recipientPhone"), E("status", SEND_STATUSES), D("actionDate"), D("followupDate"), T("notes")];
function logPatch(a: Readonly<Record<string, unknown>>): Fields | PlanRefusal {
  const after: Fields = {};
  for (const k of ["contentType", "recipientRole", "status"] as const) if (a[k] !== undefined) after[k] = String(a[k]);
  for (const k of ["versionLabel", "recipientName", "recipientPhone", "notes"] as const) if (a[k] !== undefined) { const t = text(a[k], 300); if (t === null) return refuse("BAD_TEXT", `${k} לא תקין`); after[k] = t.trim(); }
  for (const k of ["actionDate", "followupDate"] as const) if (a[k] !== undefined) { if (!realYmd(a[k])) return refuse("BAD_DATE", "תאריך לא תקין"); after[k] = String(a[k]); }
  return after;
}
const isRef = (x: unknown): x is PlanRefusal => !!x && typeof x === "object" && (x as { ok?: unknown }).ok === false;

const sendContext = async (d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<Fields> => {
  const k = parseKey(a.project, ["project"]);
  const w = a.linkedWork !== undefined ? parseKey(a.linkedWork, ["victor-work", "mix-work"]) : null;
  const linked = w ? (w.kind === "victor-work" ? (await d.readVictorWorkFull(w.id))?.title : (await d.readEngineerWork(w.id))?.title) ?? null : null;
  return { projectName: k ? (await d.readProjectMeta(k.id))?.name ?? null : null, linkedWork: linked };
};

export const WORKLOG_PRIMITIVES: readonly PrimitiveSpec[] = [
  {
    actionId: "SET_ALBUM_PREV_ROW", kinds: ["album-prev"],
    meta: meta("שורה ב'מידע קודם' של אלבום (היסטוריה ממאנדיי) — הוספה / עדכון", "Add or update one row of an album's 'previous-system info' (historical Monday figures; isolated — never Finance)", [K("project"), T("rowId"), T("name"), { name: "costWithoutMix", kind: "money", required: false }, { name: "mixMaster", kind: "money", required: false }, { name: "paid", kind: "money", required: false }], ["name", "costWithoutMix", "mixMaster", "paid", "rowCount"], "saveAlbumPrevInfo (lib/writes/worklog)", {}),
    resolve: onPrev, read: prevRead,
    plan(a, cur) {
      const after: Fields = {};
      if (a.name !== undefined) { const t = text(a.name, 200); if (t === null) return refuse("BAD_TEXT", "שם לא תקין"); after.name = t.trim(); }
      for (const k of ["costWithoutMix", "mixMaster", "paid"]) if (a[k] !== undefined) { const n = Number(a[k]); if (!Number.isFinite(n) || n < 0) return refuse("BAD_AMOUNT", `${k} ≥ 0`); after[k] = n; }
      if (!cur.rowExists) { if (!after.name) return refuse("BAD_TEXT", "לשורה חדשה צריך שם"); after.rowCount = Number(cur.rowCount) + 1; }
      return finishPlan(cur, after);
    },
    async apply(d, id, after) {
      const { projectId, rowId } = prevSplit(id); const v = await d.readAlbumPrevInfo(projectId);
      const patch = { ...(after.name !== undefined ? { name: String(after.name) } : {}), ...(["costWithoutMix", "mixMaster", "paid"] as const).reduce((o, k) => (after[k] !== undefined ? { ...o, [k]: Number(after[k]) } : o), {}) };
      const rows = rowId ? v.rows.map((r) => (r.id === rowId ? { ...r, ...patch } : r)) : [...v.rows, { id: crypto.randomUUID(), name: "", costWithoutMix: 0, mixMaster: 0, paid: 0, ...patch }];
      await d.saveAlbumPrevInfo(projectId, { rows, note: v.note });
    },
    async verify(d, id, after) { const { projectId, rowId } = prevSplit(id); const v = await d.readAlbumPrevInfo(projectId); const r = rowId ? v.rows.find((x) => x.id === rowId) : v.rows[v.rows.length - 1]; return !!r && (after.name === undefined || r.name === after.name) && (["costWithoutMix", "mixMaster", "paid"] as const).every((k) => after[k] === undefined || r[k] === after[k]); },
    disclosuresHe: ["נתונים היסטוריים בלבד — לא נוצרת ולא משתנה שום רשומה בכספים", "סה״כ ויתרה מחושבים במסך (לא נשמרים)"],
  },
  {
    actionId: "DELETE_ALBUM_PREV_ROW", kinds: ["album-prev"],
    meta: meta("מחיקת שורה מ'מידע קודם' של אלבום", "Delete one row of an album's previous-system info", [K("project"), T("rowId", true)], ["rowExists", "rowCount"], "saveAlbumPrevInfo (lib/writes/worklog)", { effects: ["DELETION"], riskClass: "DESTRUCTIVE", reversible: "NO", compensation: null }),
    resolve: onPrev, read: prevRead,
    plan: (a, cur) => (a.rowId === undefined ? refuse("BAD_ARGS", "צריך rowId") : { ok: true, after: { rowExists: false, rowCount: Number(cur.rowCount) - 1 } }),
    async apply(d, id) { const { projectId, rowId } = prevSplit(id); const v = await d.readAlbumPrevInfo(projectId); await d.saveAlbumPrevInfo(projectId, { rows: v.rows.filter((r) => r.id !== rowId), note: v.note }); },
    requiredValues: () => ["מחיקה"],
    disclosuresHe: ["רק השורה הזאת; כספים לא משתנים"],
  },
  {
    actionId: "SET_ALBUM_PREV_NOTE", kinds: ["album-prev"],
    meta: meta("הערה ל'מידע קודם' של אלבום", "Set the note of an album's previous-system info", [K("project"), T("note", true)], ["note"], "saveAlbumPrevInfo (lib/writes/worklog)", {}),
    resolve: onPrev, read: prevRead,
    plan(a, cur) { const t = a.note === "" ? "" : text(a.note, 2000); if (t === null) return refuse("BAD_TEXT", "הערה לא תקינה"); return finishPlan(cur, { note: t }); },
    async apply(d, id, after) { const { projectId } = prevSplit(id); const v = await d.readAlbumPrevInfo(projectId); await d.saveAlbumPrevInfo(projectId, { rows: v.rows, note: String(after.note) }); },
    disclosuresHe: ["רק ההערה; כספים לא משתנים"],
  },
  {
    actionId: "ADD_SEND_LOG_ENTRY", kinds: ["send-log"],
    meta: meta("רשומה ביומן השליחות של הפרויקט (מי מחכה למי)", "Add a send-log entry to a project (the drawer's 'who waits for whom'); optionally linked to the project's Victor / engineer work (like 'send to Victor / engineer' in the drawer)", [K("project"), E("actionType", SEND_ACTION_TYPES, true), ...LOG_ARGS, K("linkedWork", false)], ["actionType", "status", "actionDate"], "createSendLogEntry (lib/writes/worklog)", { riskClass: "NORMAL_BUSINESS", reversible: "PARTIAL", compensation: "delete the entry" }),
    createContext: (d, a) => sendContext(d, a),
    async resolve(d, a) {
      const k = parseKey(a.project, ["project"]); if (!k) return refuse("BAD_ENTITY", "צריך פרויקט (project:…)");
      const p = await d.readProjectMeta(k.id); if (!p) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את הפרויקט");
      if (a.linkedWork !== undefined) {
        const w = parseKey(a.linkedWork, ["victor-work", "mix-work"]); if (!w) return refuse("BAD_ENTITY", "עבודה מקושרת: victor-work:… או mix-work:…");
        const owner = w.kind === "victor-work" ? (await d.readVictorWorkFull(w.id))?.projectId : (await d.readEngineerWork(w.id))?.projectId;
        if (owner === undefined) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את העבודה המקושרת");
        if (owner !== k.id) return refuse("WRONG_PROJECT", "העבודה המקושרת שייכת לפרויקט אחר");
      }
      return { key: "send-log:new", id: "new", label: `יומן שליחות ${p.name}`, fields: await sendContext(d, a) };
    },
    read: logFields,
    plan(a) {
      const p = logPatch(a); if (isRef(p)) return p;
      const w = a.linkedWork !== undefined ? parseKey(a.linkedWork, ["victor-work", "mix-work"]) : null;
      const role = w ? (w.kind === "mix-work" ? "sound_engineer" : "external_producer") : null;
      if (role && p.recipientRole !== undefined && p.recipientRole !== role) return refuse("BAD_ARGS", `עבודה מקושרת מסוג זה מחייבת נמען ${role}`);
      return { ok: true, after: { actionType: String(a.actionType), status: String(p.status ?? "pending_feedback"), actionDate: String(p.actionDate ?? new Date().toISOString().slice(0, 10)) } };
    },
    async apply(d, _id, after, a) {
      const p = logPatch(a) as Fields;
      const w = a.linkedWork !== undefined ? parseKey(a.linkedWork, ["victor-work", "mix-work"]) : null;
      const link = w ? { linkedWorkId: w.id, recipientRole: w.kind === "mix-work" ? "sound_engineer" : "external_producer" } : {};
      return { createdId: await d.createSendLogEntry({ projectId: parseKey(a.project, ["project"])!.id, actionType: after.actionType, ...p, ...link, status: after.status, actionDate: after.actionDate }) };
    },
    async verify(d, id, after) { const f = await logFields(d, id); return !!f && f.actionType === after.actionType && f.status === after.status; },
    disclosuresHe: ["רשומה ביומן השליחות בלבד — לא נשלח כלום לאף אחד ולא נוצרת עבודה / משימה", "עבודה מקושרת: מחיקת הרשומה בעתיד תמחק גם אותה (כמו במגירה)"],
  },
  {
    actionId: "UPDATE_SEND_LOG_ENTRY", kinds: ["send-log"],
    meta: meta("עדכון רשומת שליחה (סטטוס / נמען / תאריכים / הערות)", "Update a send-log entry (UI vocabularies enforced)", [K("sendLogEntry"), E("actionType", SEND_ACTION_TYPES), ...LOG_ARGS], ["actionType", "contentType", "versionLabel", "recipientRole", "recipientName", "recipientPhone", "status", "actionDate", "followupDate", "notes"], "updateSendLogEntry (lib/writes/worklog)", {}),
    resolve: onLog, read: logFields,
    plan(a, cur) { const p = logPatch(a); if (isRef(p)) return p; if (a.actionType !== undefined) p.actionType = String(a.actionType); return finishPlan(cur, p); },
    apply: (d, id, a) => d.updateSendLogEntry(id, { ...a }),
    disclosuresHe: ["רק הרשומה משתנה; עבודה מקושרת (מהנדס / ויקטור) לא משתנה"],
  },
  {
    actionId: "DELETE_SEND_LOG_ENTRY", kinds: ["send-log"],
    meta: meta("מחיקת רשומת שליחה (+ העבודה המקושרת, כמו במגירה)", "Delete a send-log entry with the drawer's cascade, server-side: engineer send → its work (unpaid expense too); Victor send → its task + work", [K("sendLogEntry")], ["exists"], "deleteSendLogEntryWithCascade (lib/writes/worklog)", { effects: ["DELETION", "CASCADE", "GOOGLE_TASKS", "FINANCE"], riskClass: "DESTRUCTIVE", reversible: "NO", compensation: null }),
    async resolve(d, a) { const r = await onLog(d, a); return "ok" in r ? r : { ...r, fields: { ...r.fields, exists: true } }; },
    async read(d, id) { const f = await logFields(d, id); return f ? { ...f, exists: true } : null; },
    plan: () => ({ ok: true, after: { exists: false } }),
    async apply(d, id) { return { receipt: (await d.deleteSendLogEntryWithCascade(id)).cascade }; },
    async verify(d, id) { return (await d.readSendLogEntry(id)) === null; },
    requiredValues: () => ["מחיקה"],
    warnings: (c) => [c.linkedWork ? (c.recipientRole === "sound_engineer" ? "תימחק גם עבודת המהנדס המקושרת (הוצאה שלא שולמה נמחקת איתה; ששולמה — נשארת)" : "תימחק גם עבודת ויקטור המקושרת ומשימת המעקב שלה") : "אין עבודה מקושרת — רק הרשומה נמחקת"],
    disclosuresHe: ["כמו במגירה — אבל בשרת, כך שאין חצי-מחיקה אם הדפדפן נסגר באמצע", "לא נשלח כלום"],
  },
  {
    actionId: "ADD_ALBUM_TRACK", kinds: ["album-track"],
    meta: meta("הוספת שיר לאלבום", "Add a track to an album project", [K("project"), T("title", true), { name: "trackNumber", kind: "number", required: true }, E("status", TRACK_STATUSES), E("mixStatus", MIX_MASTER_STATUSES), E("masterStatus", MIX_MASTER_STATUSES), T("notes")], ["title", "trackNumber"], "createAlbumTrack (lib/writes/worklog)", { riskClass: "NORMAL_BUSINESS", reversible: "PARTIAL", compensation: "delete the track" }),
    createContext: async (d, a) => { const k = parseKey(a.project, ["project"]); return { taken: k ? (await d.albumTrackOrder(k.id)).map((t) => t.track_number).join(",") : "" }; },
    async resolve(d, a) { const k = parseKey(a.project, ["project"]); if (!k) return refuse("BAD_ENTITY", "צריך פרויקט (project:…)"); const p = await d.readProjectMeta(k.id); if (!p) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את הפרויקט"); return { key: "album-track:new", id: "new", label: `${p.name}: ${String(a.title ?? "")}`, fields: { taken: (await d.albumTrackOrder(k.id)).map((t) => t.track_number).join(",") } }; },
    read: trackFields,
    plan(a, cur) { const t = text(a.title, 200); if (t === null) return refuse("BAD_TEXT", "שם השיר חסר"); const n = Number(a.trackNumber); if (!Number.isInteger(n) || n < 1) return refuse("BAD_NUMBER", "מספר רצועה שלם ≥ 1"); if (String(cur.taken).split(",").includes(String(n))) return refuse("DUPLICATE", `מספר ${n} כבר תפוס`); return { ok: true, after: { title: t.trim(), trackNumber: n } }; },
    async apply(d, _id, after, a) { return { createdId: await d.createAlbumTrack({ project_id: parseKey(a.project, ["project"])!.id, track_number: after.trackNumber, title: after.title, status: a.status, mix_status: a.mixStatus, master_status: a.masterStatus, notes: str(a.notes) }) }; },
    async verify(d, id, after) { const f = await trackFields(d, id); return !!f && f.title === after.title && f.trackNumber === after.trackNumber; },
    disclosuresHe: ["שיר חדש ברשימת האלבום (ברירות מחדל: טרום הקלטה / לא התחיל)", "לא נשלח כלום"],
  },
  {
    actionId: "UPDATE_ALBUM_TRACK", kinds: ["album-track"],
    meta: meta("עדכון שיר באלבום (שם / סטטוסים / הערות)", "Update an album track's title, statuses or notes (validated against the app's vocabularies)", [K("albumTrack"), T("title"), E("status", TRACK_STATUSES), E("mixStatus", MIX_MASTER_STATUSES), E("masterStatus", MIX_MASTER_STATUSES), T("notes")], ["title", "status", "mixStatus", "masterStatus", "notes"], "updateAlbumTrack (lib/writes/worklog)", {}),
    resolve: onTrack, read: trackFields,
    plan(a, cur) {
      const after: Fields = {};
      for (const k of ["status", "mixStatus", "masterStatus"] as const) if (a[k] !== undefined) after[k] = String(a[k]);
      for (const k of ["title", "notes"] as const) if (a[k] !== undefined) { const t = text(a[k], 1000); if (t === null) return refuse("BAD_TEXT", `${k} לא תקין`); after[k] = t.trim(); }
      return finishPlan(cur, after);
    },
    apply: (d, id, a) => d.updateAlbumTrack(id, { ...(a.title !== undefined ? { title: a.title } : {}), ...(a.status !== undefined ? { status: a.status } : {}), ...(a.mixStatus !== undefined ? { mix_status: a.mixStatus } : {}), ...(a.masterStatus !== undefined ? { master_status: a.masterStatus } : {}), ...(a.notes !== undefined ? { notes: a.notes } : {}) }),
    disclosuresHe: ["רק השיר משתנה; הפרויקט עצמו לא", "לא נשלח כלום"],
  },
  {
    actionId: "DELETE_ALBUM_TRACK", kinds: ["album-track"],
    meta: meta("מחיקת שיר מהאלבום", "Delete an album track (its files are a separate files action)", [K("albumTrack")], ["exists"], "deleteAlbumTrack (lib/writes/worklog)", { effects: ["DELETION"], riskClass: "DESTRUCTIVE", reversible: "NO", compensation: null }),
    async resolve(d, a) { const r = await onTrack(d, a); return "ok" in r ? r : { ...r, fields: { ...r.fields, exists: true } }; },
    async read(d, id) { const f = await trackFields(d, id); return f ? { ...f, exists: true } : null; },
    plan: () => ({ ok: true, after: { exists: false } }),
    apply: (d, id) => d.deleteAlbumTrack(id),
    async verify(d, id) { return (await d.readAlbumTrack(id)) === null; },
    requiredValues: () => ["מחיקה"],
    disclosuresHe: ["השיר נמחק מהרשימה לצמיתות; קבצים שלו לא נמחקים בפעולה הזאת"],
  },
  {
    actionId: "MOVE_ALBUM_TRACK", kinds: ["album-track"],
    meta: meta("שינוי מיקום שיר באלבום (מספור מחדש)", "Move a track to a position; the album is renumbered 1…n (the app's two-pass renumber)", [K("albumTrack"), { name: "position", kind: "number", required: true }], ["trackNumber"], "renumberAlbumTracks (lib/writes/worklog)", {}),
    async resolve(d, a) { const r = await onTrack(d, a); if ("ok" in r) return r; const all = await d.albumTrackOrder(String(r.fields.projectId)); return { ...r, fields: { ...r.fields, count: all.length, order: all.map((t) => t.id).join(",") } }; },
    async read(d, id) { const f = await trackFields(d, id); if (!f) return null; const all = await d.albumTrackOrder(String(f.projectId)); return { ...f, count: all.length, order: all.map((t) => t.id).join(",") }; },
    plan(a, cur) { const p = Number(a.position); if (!Number.isInteger(p) || p < 1 || p > Number(cur.count)) return refuse("BAD_NUMBER", `מיקום 1–${cur.count}`); return finishPlan(cur, { trackNumber: p }); },
    async apply(d, id, a) { const f = await trackFields(d, id); if (!f) throw new Error("track not found"); const ids = (await d.albumTrackOrder(String(f.projectId))).map((t) => t.id).filter((x) => x !== id); ids.splice(Number(a.trackNumber) - 1, 0, id); await d.renumberAlbumTracks(ids.map((x, i) => ({ id: x, track_number: i + 1 }))); },
    disclosuresHe: ["כל השירים באלבום ממוספרים מחדש 1…n בסדר החדש (שני מעברים, כמו באפליקציה)"],
  },
];
