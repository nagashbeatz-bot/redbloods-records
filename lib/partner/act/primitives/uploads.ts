/**
 * SUNNY UNIVERSAL ACTION LAYER — THE FILE CHANNEL. A file the Boss hands Sunny sits in the "Sunny Inbox" (lib/writes/
 * inbox); Sunny addresses it ONLY by its handle (`inboxItem`, 24 hex) — never a path. Each primitive places ONE inbox
 * item at ONE Redbloods destination through the SAME canonical writer the screen upload uses (lib/writes/file-channel →
 * lib/writes/uploads / the existing upload libraries): same limits, types, naming, duplicate rule and metadata. The
 * preview names the file, its size and the exact destination; the destination's own limits are checked before the
 * approval. A placed item leaves the inbox; a failed placement leaves it there. A wrong / missing handle is refused WITH
 * the inbox contents (handle — name — size). Nothing is fetched from a URL; no path is ever accepted.
 */
import type { ArgSpec } from "../types";
import { parseKey, refuse, text, type Fields, type PlanRefusal, type PrimitiveMeta, type PrimitiveSpec, type ResolvedTarget, type WriterDeps } from "./core";

export type InboxView = { ref: string; name: string; size: number; mime: string };
export type UploadDestination = "PROJECT_FILE" | "DELIVERY" | "WORK_MATERIAL" | "MIX_VERSION" | "FINAL_FILE" | "COMMENT_ATTACHMENT" | "SOCIAL" | "RF_DOCUMENT" | "RF_REFERENCE" | "RF_RECEIPT" | "VICTOR_FILE" | "VICTOR_BRIEF" | "SKETCH_NEW" | "SKETCH_VERSION" | "SKETCH_BEAT" | "BEAT_NEW" | "BEAT_FILE" | "PROFILE_IMAGE" | "PORTAL_FILE" | "PROJECT_COVER" | "DISCARD";
export interface UploadFamilyWriters {
  listInbox(): Promise<InboxView[]>;
  inboxItemView(ref: string): Promise<InboxView | null>;
  inboxFits(dest: UploadDestination, ref: string): Promise<string | null>;
  placeInboxItem(dest: UploadDestination, target: Readonly<Record<string, string | null>>, ref: string, opts: Readonly<Record<string, unknown>>): Promise<{ ok: true; receipt: string } | { ok: false; error: string }>;
}
export const WORK_MATERIAL_TYPES: readonly string[] = ["rough", "reference", "stems", "doc"];
export const VICTOR_OWNER_BUCKETS: readonly string[] = ["01_From_Redbloods", "03_Approved", "Production"];
export const RF_DOCUMENT_TYPES: readonly string[] = ["תסריט", "בריף", "שוט ליסט", "לו״ז צילום", "אישור / חוזה", "ציוד", "אחר"];
export const PORTAL_FILE_KINDS: readonly string[] = ["performance", "pressKit"];

const REF = /^[0-9a-f]{24}$/;
const K = (name: string, required = true): ArgSpec => ({ name, kind: "entityKey", required });
const T = (name: string, required = false): ArgSpec => ({ name, kind: "text", required });
const E = (name: string, values: readonly string[], required = false): ArgSpec => ({ name, kind: "enum", required, values });
const INBOX: ArgSpec = { name: "inboxItem", kind: "text", required: true, noteHe: "המזהה מתיבת הקבצים (24 תווים) — טעות / חסר → סאני מקבלת את רשימת הקבצים בתיבה" };
const mb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);

type TargetOut = { id: string; label: string; target: Record<string, string | null>; fields: Fields } | PlanRefusal;
type Spec = {
  actionId: string; dest: UploadDestination; he: string; en: string; args: readonly ArgSpec[];
  target: (d: WriterDeps, a: Readonly<Record<string, unknown>>) => Promise<TargetOut>;
  /** Re-read the target from the stored id (execute-time fingerprint). */
  targetById: (d: WriterDeps, id: string) => Promise<TargetOut>;
  opts?: (a: Readonly<Record<string, unknown>>) => Record<string, unknown> | PlanRefusal;
  effects?: PrimitiveMeta["effects"]; riskClass?: PrimitiveMeta["riskClass"]; disclosuresHe: readonly string[];
};
const isRef = (x: unknown): x is PlanRefusal => !!x && typeof x === "object" && (x as { ok?: unknown }).ok === false;
async function inboxChoices(d: WriterDeps): Promise<string> {
  const xs = await d.listInbox();
  return xs.length ? ` — בתיבת הקבצים (inboxItem — שם — גודל): ${xs.slice(0, 30).map((x) => `${x.ref} — ${x.name.slice(0, 60)} — ${mb(x.size)}`).join("; ")}` : " — תיבת הקבצים ריקה (צריך להכניס את הקובץ ל-Sunny Inbox קודם)";
}
const splitId = (id: string) => { const i = id.lastIndexOf("."); return { targetId: id.slice(0, i), ref: id.slice(i + 1) }; };

function make(s: Spec): PrimitiveSpec {
  const fieldsOf = async (d: WriterDeps, t: Exclude<TargetOut, PlanRefusal>, ref: string): Promise<Fields> => {
    const it = await d.inboxItemView(ref);
    return { ...t.fields, destination: t.label, fileName: it?.name ?? null, fileSize: it ? mb(it.size) : null, inInbox: !!it, fits: it ? (await d.inboxFits(s.dest, ref)) ?? "OK" : null };
  };
  return {
    actionId: s.actionId, kinds: ["upload"],
    meta: { domain: "FILES", he: s.he, en: s.en, args: [...s.args, INBOX], fields: ["inInbox"], effects: s.effects ?? ["FILES"], riskClass: s.riskClass ?? "FILE_MUTATION", reversible: "PARTIAL", writer: `placeInboxItem(${s.dest}) (lib/writes/file-channel → the destination's canonical upload writer)`, compensation: "delete the placed file with the destination's own delete action" },
    async resolve(d, a) {
      const t = await s.target(d, a); if (isRef(t)) return t;
      if (typeof a.inboxItem !== "string" || !REF.test(a.inboxItem)) return refuse("BAD_ENTITY", `inboxItem לא תקין${await inboxChoices(d)}`);
      if (!(await d.inboxItemView(a.inboxItem))) return refuse("ENTITY_NOT_FOUND", `לא מצאתי את הקובץ בתיבה${await inboxChoices(d)}`);
      return { key: `upload:${t.id}.${a.inboxItem}`, id: `${t.id}.${a.inboxItem}`, label: t.label, fields: await fieldsOf(d, t, a.inboxItem) };
    },
    async read(d, id) { const { targetId, ref } = splitId(id); const t = await s.targetById(d, targetId); return isRef(t) ? null : fieldsOf(d, t, ref); },
    plan(a, cur) {
      if (!cur.inInbox) return refuse("NOT_IN_INBOX", "הקובץ כבר לא בתיבה");
      if (cur.fits && cur.fits !== "OK") return refuse("DOES_NOT_FIT", `היעד לא מקבל את הקובץ: ${cur.fits}`);
      if (s.opts) { const o = s.opts(a); if (isRef(o)) return o; }
      return { ok: true, after: { inInbox: false } };
    },
    async apply(d, id, _after, a) {
      const { targetId, ref } = splitId(id);
      const t = await s.targetById(d, targetId); if (isRef(t)) throw new Error(t.messageHe);
      const r = await d.placeInboxItem(s.dest, t.target, ref, s.opts ? (s.opts(a) as Record<string, unknown>) : {});
      if (!r.ok) throw new Error(r.error);
      return { receipt: r.receipt };
    },
    requiredValues: () => [s.dest === "DISCARD" ? "הסרה" : "העלאה"],
    warnings: (c) => [`${c.fileName} (${c.fileSize}) → ${c.destination}`],
    disclosuresHe: [...s.disclosuresHe, "הקובץ עובר מתיבת הקבצים ליעד דרך אותו כותב שהמסך משתמש בו (אותן מגבלות, שמות וטיפול בכפילויות)", "סאני לא רואה נתיב או קישור לקובץ"],
  };
}

// ── target resolvers ──
const bad = (m: string) => refuse("ENTITY_NOT_FOUND", m);
const project = (label: (name: string) => string) => ({
  async target(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<TargetOut> { const k = parseKey(a.project, ["project"]); if (!k) return refuse("BAD_ENTITY", "צריך פרויקט (project:…)"); return this.targetById(d, k.id); },
  async targetById(d: WriterDeps, id: string): Promise<TargetOut> { const p = await d.readProjectMeta(id); return p ? { id, label: label(p.name), target: { projectId: id }, fields: { projectName: p.name } } : bad("לא מצאתי את הפרויקט"); },
});
const mixWork = (label: (t: string) => string, needProject = false) => ({
  async target(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<TargetOut> { const k = parseKey(a.work, ["mix-work"]); if (!k) return refuse("BAD_ENTITY", "צריך עבודת מיקס (mix-work:…)"); return this.targetById(d, k.id); },
  async targetById(d: WriterDeps, id: string): Promise<TargetOut> { const w = await d.readEngineerWork(id); if (!w) return bad("לא מצאתי את עבודת המיקס"); if (needProject && !w.projectId) return refuse("NO_PROJECT", "חומרי עבודה זמינים רק לעבודה עם פרויקט"); return { id, label: label(`${w.engineerName} · ${w.title}`), target: { workId: id }, fields: { work: w.title, engineer: w.engineerName } }; },
});
const rfProduction = (label: (t: string) => string) => ({
  async target(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<TargetOut> { const k = parseKey(a.production, ["rf-production"]); if (!k) return refuse("BAD_ENTITY", "צריך הפקה (rf-production:…)"); return this.targetById(d, k.id); },
  async targetById(d: WriterDeps, id: string): Promise<TargetOut> { const r = await d.readProductionRow(id); return r ? { id, label: label(String(r.title ?? "הפקה")), target: { productionId: id }, fields: { production: String(r.title ?? "") } } : bad("לא מצאתי את ההפקה"); },
});
const victorWork = (label: (t: string) => string) => ({
  async target(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<TargetOut> { const k = parseKey(a.victorWork, ["victor-work"]); if (!k) return refuse("BAD_ENTITY", "צריך עבודת ויקטור (victor-work:…)"); return this.targetById(d, k.id); },
  async targetById(d: WriterDeps, id: string): Promise<TargetOut> { const w = await d.readVictorWorkFull(id); return w ? { id, label: label(w.title || w.projectName), target: { workId: id }, fields: { work: w.title || w.projectName } } : bad("לא מצאתי את עבודת ויקטור"); },
});
const artist = (label: (n: string) => string) => ({
  async target(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<TargetOut> { const k = parseKey(a.labelArtist, ["label-artist"]); if (!k) return refuse("BAD_ENTITY", "צריך אמן לייבל (label-artist:…)"); return this.targetById(d, k.id); },
  async targetById(d: WriterDeps, id: string): Promise<TargetOut> { const r = await d.readLabelArtistFull(id); if (!r) return bad("לא מצאתי את האמן"); if (!r.portalSlug) return refuse("NO_PORTAL", "לאמן הזה אין פורטל"); return { id, label: label(r.name), target: { slug: r.portalSlug }, fields: { artist: r.name } }; },
});
const sketch = (label: (n: string, t: string) => string) => ({
  async target(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<TargetOut> {
    const k = parseKey(a.labelArtist, ["label-artist"]); if (!k) return refuse("BAD_ENTITY", "צריך אמן לייבל (label-artist:…)");
    if (typeof a.sketchId !== "string" || !/^[A-Za-z0-9_-]{4,63}$/.test(a.sketchId)) return refuse("BAD_ENTITY", "מזהה סקיצה לא תקין");
    return this.targetById(d, `${k.id}.${a.sketchId}`);
  },
  async targetById(d: WriterDeps, id: string): Promise<TargetOut> {
    const i = id.indexOf("."); const artistId = id.slice(0, i), sketchId = id.slice(i + 1);
    const r = await d.readLabelArtistFull(artistId); if (!r) return bad("לא מצאתי את האמן"); if (!r.portalSlug) return refuse("NO_PORTAL", "לאמן הזה אין פורטל");
    const s = await d.readSketch(r.portalSlug, sketchId);
    if (!s) { const c = await d.listSketchChoices(r.portalSlug); return bad(`לא מצאתי את הסקיצה — הסקיצות: ${c.slice(0, 30).map((x) => `${x.id} — ${x.title.slice(0, 50)}`).join("; ")}`); }
    return { id, label: label(r.name, s.title), target: { slug: r.portalSlug, sketchId }, fields: { artist: r.name, sketch: s.title, latestVersion: s.latestVersion } };
  },
});
const txt = (a: Readonly<Record<string, unknown>>, k: string, max = 300): string | undefined | PlanRefusal => { if (a[k] === undefined) return undefined; const t = text(a[k], max); return t === null ? refuse("BAD_TEXT", `${k} לא תקין`) : t.trim(); };

export const UPLOAD_PRIMITIVES: readonly PrimitiveSpec[] = [
  make({ actionId: "UPLOAD_PROJECT_FILE", dest: "PROJECT_FILE", he: "העלאת קובץ לפרויקט (מתיבת הקבצים)", en: "Place an inbox file in the project's files (the drawer's upload: project folder, public link, player entry)", args: [K("project"), T("name"), T("subfolder"), K("albumTrack", false), T("versionLabel")], ...project((n) => `קבצי הפרויקט ${n}`),
    opts(a) { const name = txt(a, "name", 200); if (isRef(name)) return name; if (name && /[\\/]/.test(name)) return refuse("BAD_TEXT", "שם בלי / או \\"); const sub = txt(a, "subfolder", 120); if (isRef(sub)) return sub; if (sub && /\.\./.test(sub)) return refuse("BAD_TEXT", "תת-תיקייה לא תקינה"); const vl = txt(a, "versionLabel", 40); if (isRef(vl)) return vl; const tr = a.albumTrack !== undefined ? parseKey(a.albumTrack, ["album-track"]) : null; if (a.albumTrack !== undefined && !tr) return refuse("BAD_ENTITY", "album-track:…"); return { name, subfolder: sub, versionLabel: vl, trackId: tr?.id }; },
    effects: ["FILES", "EXTERNAL_LINK"], disclosuresHe: ["כמו העלאה במגירה: תיקיית הפרויקט (או תת-תיקייה), כפילות שם → שם חדש אוטומטי, נוצר קישור ציבורי לנגן"] }),
  make({ actionId: "UPLOAD_TO_DELIVERY", dest: "DELIVERY", he: "העלאת קובץ לתיקיית המסירה", en: "Place an inbox file in the project's Delivery folder (same name → replaced, like the drawer)", args: [K("project")], ...project((n) => `מסירה — ${n}`),
    disclosuresHe: ["קובץ באותו שם בתיקיית המסירה מוחלף (כמו במגירה)", "לא נשלח כלום ללקוח"] }),
  make({ actionId: "UPLOAD_WORK_MATERIAL", dest: "WORK_MATERIAL", he: "העלאת חומר עבודה לאיש הסאונד", en: "Place an inbox file as a work material (rough / reference / stems / doc) — the engineer's work-materials upload", args: [K("work"), E("materialType", WORK_MATERIAL_TYPES, true)], ...mixWork((t) => `חומרי עבודה — ${t}`, true),
    opts: (a) => (WORK_MATERIAL_TYPES.includes(String(a.materialType)) ? { materialType: String(a.materialType) } : refuse("BAD_ARGS", "materialType: rough / reference / stems / doc")),
    disclosuresHe: ["השם נקבע כמו במסך: \"{פרויקט} {סוג}\" (רפרנסים ממוספרים)", "בלי קישור ציבורי"] }),
  make({ actionId: "UPLOAD_MIX_VERSION", dest: "MIX_VERSION", he: "העלאת גרסת מיקס (מתיבת הקבצים)", en: "Place an inbox file as a mix version of an engineer work (the Owner's version upload; any size — moved inside storage)", args: [K("work"), T("label", true), { name: "addToExisting", kind: "boolean", required: false }, K("mixLine", false)], ...mixWork((t) => `גרסאות — ${t}`),
    opts(a) { const label = txt(a, "label", 60); if (isRef(label)) return label; if (!label) return refuse("BAD_TEXT", "תווית גרסה חסרה"); if (a.addToExisting !== undefined && typeof a.addToExisting !== "boolean") return refuse("BAD_ARGS", "addToExisting = true / false"); const ml = a.mixLine !== undefined ? parseKey(a.mixLine, ["mix-line"]) : null; if (a.mixLine !== undefined && !ml) return refuse("BAD_ENTITY", "mix-line:…"); return { label, addToExisting: a.addToExisting === true, mixTargetId: ml?.id ?? null }; },
    disclosuresHe: ["אותו פתרון יעד כמו במסך (תיקיית Mix Versions, שם נקי, תווית)", "לא נשלחת התראה לאיש הסאונד (כמו העלאה של הבעלים)"] }),
  make({ actionId: "UPLOAD_FINAL_FILE", dest: "FINAL_FILE", he: "העלאת קובץ סופי (מאסטר / סטמים)", en: "Place an inbox file as a final file of an engineer work (name clash = refused, never renamed; the batch notice like the screen)", args: [K("work")], ...mixWork((t) => `קבצים סופיים — ${t}`),
    effects: ["FILES", "PUSH"], disclosuresHe: ["שם שכבר קיים בקבצים הסופיים → נדחה (לא מתחלף ולא משנה שם)", "ההתראה המרוכזת שהמסך שולח אחרי העלאה — פעם אחת"] }),
  make({ actionId: "ATTACH_MIX_COMMENT_FILE", dest: "COMMENT_ATTACHMENT", he: "צירוף קובץ להערת מיקס", en: "Attach an inbox image / short audio to an existing mix comment (≤10MB, jpeg/png/webp/gif or mp3/wav/m4a)", args: [K("comment")],
    async target(d, a) { const k = parseKey(a.comment, ["mix-comment"]); if (!k) return refuse("BAD_ENTITY", "צריך הערה (mix-comment:…)"); return this.targetById(d, k.id); },
    async targetById(d, id) { const c = await d.readMixCommentFull(id); return c ? { id, label: `הערה: ${c.text.slice(0, 40)}`, target: { commentId: id }, fields: { comment: c.text.slice(0, 80), attachments: c.attachments } } : bad("לא מצאתי את ההערה"); },
    disclosuresHe: ["רק צירוף; ההערה עצמה לא משתנה"] } as Spec),
  make({ actionId: "UPLOAD_SOCIAL_FILE", dest: "SOCIAL", he: "צירוף קובץ לפריט תוכן סושיאל", en: "Attach an inbox file to a social content item (≤500MB, the social upload's folders + public link)", args: [K("content")],
    async target(d, a) { const k = parseKey(a.content, ["social-content"]); if (!k) return refuse("BAD_ENTITY", "צריך פריט תוכן (social-content:…)"); return this.targetById(d, k.id); },
    async targetById(d, id) { const r = await d.readSocialContent(id); return r ? { id, label: `תוכן: ${String(r.title ?? "")}`, target: { contentItemId: id, campaignId: String(r.campaign_id ?? ""), projectId: (r.project_id as string | null) ?? null }, fields: { content: String(r.title ?? "") } } : bad("לא מצאתי את פריט התוכן"); },
    effects: ["FILES", "EXTERNAL_LINK"], disclosuresHe: ["לא מתפרסם כלום; רק קובץ לפריט"] } as Spec),
  make({ actionId: "UPLOAD_RF_DOCUMENT", dest: "RF_DOCUMENT", he: "העלאת מסמך להפקה", en: "Place an inbox file as a Red Films document (auto-named; ≤50MB; the documents upload)", args: [K("production"), E("fileType", RF_DOCUMENT_TYPES), T("notes")], ...rfProduction((t) => `מסמכי ${t}`),
    opts(a) { const n = txt(a, "notes", 1000); if (isRef(n)) return n; return { fileType: a.fileType === undefined ? "אחר" : String(a.fileType), notes: n ?? "" }; }, effects: ["FILES", "EXTERNAL_LINK"], disclosuresHe: ["שם אוטומטי: \"{הפקה} - {אמן/לקוח} - {סוג} - {תאריך}\""] }),
  make({ actionId: "UPLOAD_RF_REFERENCE_IMAGE", dest: "RF_REFERENCE", he: "העלאת תמונת רפרנס להפקה", en: "Place an inbox image as a Red Films reference (≤20MB; thumbnail like the screen)", args: [K("production"), T("tag")], ...rfProduction((t) => `רפרנסים — ${t}`),
    opts(a) { const t = txt(a, "tag", 60); if (isRef(t)) return t; return { tag: t || "כללי" }; }, effects: ["FILES", "EXTERNAL_LINK"], disclosuresHe: ["נוצרת תמונה מוקטנת לגריד (כמו במסך)"] }),
  make({ actionId: "ATTACH_RF_RECEIPT", dest: "RF_RECEIPT", he: "צירוף אסמכתא לתשלום Red Films", en: "Attach an inbox file as the receipt of an existing Red Films payment (the receipt upload)", args: [K("payment")],
    async target(d, a) { const k = parseKey(a.payment, ["rf-payment"]); if (!k) return refuse("BAD_ENTITY", "צריך תשלום (rf-payment:…)"); return this.targetById(d, k.id); },
    async targetById(d, id) { const r = await d.readBudgetPaymentRow(id); return r ? { id, label: `תשלום ₪${Number(r.amount) || 0} (${String(r.payment_date ?? "")})`, target: { paymentId: id }, fields: { amount: Number(r.amount) || 0, hasReceipt: r.has_receipt === true } } : bad("לא מצאתי את התשלום"); },
    effects: ["FILES", "EXTERNAL_LINK"], disclosuresHe: ["הסכום והסטטוס של התשלום לא משתנים", "אסמכתא קיימת מוחלפת בקישור החדש (כמו במסך)"] } as Spec),
  make({ actionId: "UPLOAD_VICTOR_FILE", dest: "VICTOR_FILE", he: "העלאת קובץ לעבודת ויקטור", en: "Place an inbox file in a Victor work folder bucket (inside the work folder only; the Owner's upload)", args: [K("victorWork"), E("bucket", VICTOR_OWNER_BUCKETS, true), T("versionLabel")], ...victorWork((t) => `ויקטור — ${t}`),
    opts(a) { const vl = txt(a, "versionLabel", 20); if (isRef(vl)) return vl; return VICTOR_OWNER_BUCKETS.includes(String(a.bucket)) ? { subFolder: String(a.bucket), versionLabel: vl } : refuse("BAD_ARGS", "bucket לא תקין"); },
    effects: ["FILES", "EXTERNAL_LINK"], disclosuresHe: ["ויקטור לא מקבל Push (העלאה של הבעלים)", "רק בתוך תיקיית העבודה"] }),
  make({ actionId: "UPLOAD_VICTOR_BRIEF_FILE", dest: "VICTOR_BRIEF", he: "צירוף קובץ לבריף של ויקטור", en: "Place an inbox file in a Victor work's brief (00_Brief, ≤100MB; needs the work folder)", args: [K("victorWork")], ...victorWork((t) => `בריף — ${t}`),
    effects: ["FILES", "EXTERNAL_LINK"], disclosuresHe: ["צריך שתיקיית העבודה כבר קיימת (SET_UP_VICTOR_FOLDER)"] }),
  make({ actionId: "CREATE_SKETCH_FROM_FILE", dest: "SKETCH_NEW", he: "סקיצה חדשה בספריית האמן (מקובץ בתיבה)", en: "Create a new sketch in the artist's library from an inbox audio file (≤500MB, mp3/wav/aiff/m4a)", args: [K("labelArtist"), T("title", true), T("description"), T("notes")], ...artist((n) => `המוזיקה שלי — ${n}`),
    opts(a) { const title = txt(a, "title", 120); if (isRef(title)) return title; if (!title) return refuse("BAD_TEXT", "שם הסקיצה חסר"); const de = txt(a, "description", 1000); if (isRef(de)) return de; const no = txt(a, "notes", 1000); if (isRef(no)) return no; return { title, description: de, notes: no }; },
    disclosuresHe: ["האמן לא מקבל Push — התראה היא פעולה נפרדת (NOTIFY_SKETCH)", "שם כפול נדחה (כמו במסך)"] }),
  make({ actionId: "ADD_SKETCH_VERSION_FROM_FILE", dest: "SKETCH_VERSION", he: "גרסה חדשה לסקיצה (מקובץ בתיבה)", en: "Add an inbox audio file as the next version of an artist's sketch", args: [K("labelArtist"), T("sketchId", true)], ...sketch((n, t) => `${n} · ${t} — גרסה חדשה`),
    disclosuresHe: ["האמן לא מקבל Push — NOTIFY_SKETCH בנפרד"] }),
  make({ actionId: "SET_SKETCH_BEAT_FROM_FILE", dest: "SKETCH_BEAT", he: "ביט / אינסטרומנטל לסקיצה (מקובץ בתיבה)", en: "Set an inbox audio file as the sketch's companion beat", args: [K("labelArtist"), T("sketchId", true)], ...sketch((n, t) => `${n} · ${t} — ביט`),
    disclosuresHe: ["מחליף ביט קיים של הסקיצה (כמו במסך)"] }),
  make({ actionId: "UPLOAD_BEAT", dest: "BEAT_NEW", he: "העלאת ביט חדש לספריית הביטים", en: "Place an inbox audio file as a new beat (≤150MB; name / genre / key validated by the beat writer; the app's beat notice)", args: [T("name", true), T("genre", true), T("musicalKey")],
    async target() { return { id: "library", label: "ספריית הביטים", target: {}, fields: {} }; }, async targetById() { return { id: "library", label: "ספריית הביטים", target: {}, fields: {} }; },
    opts(a) { const n = txt(a, "name", 120); if (isRef(n)) return n; if (!n) return refuse("BAD_TEXT", "שם הביט חסר"); const g = txt(a, "genre", 40); if (isRef(g)) return g; const k = txt(a, "musicalKey", 40); if (isRef(k)) return k; return { name: n, genre: g ?? "", musicalKey: k ?? "" }; },
    effects: ["FILES", "PUSH"], disclosuresHe: ["התראת 'ביט חדש' של האפליקציה (כמו העלאה במסך)"] } as Spec),
  make({ actionId: "REPLACE_BEAT_FILE", dest: "BEAT_FILE", he: "החלפת קובץ הביט", en: "Replace a beat's audio with an inbox file (name / genre / key unchanged; the app's beat-updated notice)", args: [K("beat")],
    async target(d, a) { const k = parseKey(a.beat, ["beat"]); if (!k) return refuse("BAD_ENTITY", "צריך ביט (beat:…)"); return this.targetById(d, k.id); },
    async targetById(d, id) { const b = await d.readBeat(id); return b ? { id, label: `ביט ${b.name}`, target: { beatId: id, name: b.name, genre: b.genre, musicalKey: b.musicalKey ?? "" }, fields: { beat: b.name } } : bad("לא מצאתי את הביט"); },
    effects: ["FILES", "PUSH", "DELETION"], riskClass: "DESTRUCTIVE", disclosuresHe: ["הקובץ הקודם מוחלף", "התראת 'ביט עודכן' של האפליקציה"] } as Spec),
  make({ actionId: "SET_ARTIST_PROFILE_IMAGE", dest: "PROFILE_IMAGE", he: "תמונת פרופיל לאמן (מקובץ בתיבה)", en: "Set the artist's portal profile image from an inbox image (jpg / png / webp; no crop — the screen's crop tool is not used)", args: [K("labelArtist")], ...artist((n) => `תמונת פרופיל — ${n}`),
    disclosuresHe: ["התמונה נשמרת כמו שהיא (בלי חיתוך / זום)", "מחליף את התמונה הקיימת"] }),
  make({ actionId: "UPLOAD_ARTIST_PORTAL_FILE", dest: "PORTAL_FILE", he: "קובץ הופעה / פרס-קיט לפורטל האמן", en: "Place an inbox file in the artist portal's performance files or press kit (≤140MB, the portal upload's types)", args: [K("labelArtist"), E("kind", PORTAL_FILE_KINDS, true)], ...artist((n) => `קבצי פורטל — ${n}`),
    opts: (a) => (PORTAL_FILE_KINDS.includes(String(a.kind)) ? { kind: String(a.kind) } : refuse("BAD_ARGS", "kind: performance / pressKit")), disclosuresHe: ["האמן רואה את הקובץ בפורטל"] }),
  make({ actionId: "SET_PROJECT_COVER_IMAGE", dest: "PROJECT_COVER", he: "תמונת נושא לפרויקט (JPEG מקובץ בתיבה)", en: "Set a project's custom cover image from an inbox JPEG (≤3MB, like the cover picker)", args: [K("project")], ...project((n) => `תמונת נושא — ${n}`),
    disclosuresHe: ["JPEG בלבד עד 3MB (כמו במסך)", "מחליף תמונת נושא קיימת"] }),
  make({ actionId: "DISCARD_INBOX_ITEM", dest: "DISCARD", he: "הסרת קובץ מתיבת הקבצים", en: "Remove one item from the Sunny Inbox (nothing else changes)", args: [],
    async target() { return { id: "inbox", label: "תיבת הקבצים", target: {}, fields: {} }; }, async targetById() { return { id: "inbox", label: "תיבת הקבצים", target: {}, fields: {} }; },
    effects: ["FILES", "DELETION"], riskClass: "DESTRUCTIVE", disclosuresHe: ["רק הקובץ בתיבה נמחק; שום רשומה ב-Redbloods לא משתנה"] } as Spec),
];
